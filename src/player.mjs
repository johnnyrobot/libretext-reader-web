/**
 * Schedule synthesis and playback across a page's sentences.
 *
 * Buffer and lookahead are smaller than the desktop reader's (3 and 10): that
 * app drives a fast native engine, and a long pre-roll in a browser reads as
 * broken rather than careful. Lookahead grows only when measurement says the
 * engine is falling behind.
 *
 * Phonon (English, LT-214) streams: a sentence starts speaking on its first 80 ms
 * frame rather than when it has finished rendering. Every request asks for the
 * stream; an engine that cannot stream (Supertonic) simply never sends any, and
 * the sentence plays as one buffer as it always did.
 */

import { createStreamPlayback } from './stream-playback.mjs';

const INITIAL_BUFFER = 2;
const BASE_LOOKAHEAD = 4;
const SLOW_LOOKAHEAD = 8;
const RETAIN = 24;
const SLOW_RTF = 0.8;
const STALL_RTF = 1.0;

export function createPlayer({
  engine,
  sentences,
  audioContext,
  onSentenceChange = () => {},
  onStateChange = () => {},
  // A sentence the length guard gave up on (src/phonon-guard.mjs): silence,
  // never nonsense, and the reader marks it so the silence is explained.
  onSentenceSkipped = () => {},
}) {
  const context = audioContext ?? new (globalThis.AudioContext ?? globalThis.webkitAudioContext)();
  const buffers = new Map();   // id → AudioBuffer
  const inFlight = new Map();  // id → Promise
  // id → { chunks, sampleRate, first, arrived, listener }: what a sentence still
  // rendering has streamed so far. `listener` is set while it is the one playing.
  const streams = new Map();
  const index = new Map(sentences.map((s, i) => [s.id, i]));
  // The source text, kept so a language can be switched away from and back to
  // without refetching -- and, since translation moved into the browser, without
  // re-translating either. A translation may omit ids it could not handle, so
  // every lookup falls back to this.
  const english = new Map(sentences.map((s) => [s.id, s.speech]));

  let cursor = 0;
  let playing = false;
  let rate = 1;
  let source = null;
  let streamPlayback = null;
  let awaitingFirstSound = false;
  let lookahead = BASE_LOOKAHEAD;
  let generation = 0;
  // A SECOND COUNTER, deliberately not the one above. `generation` cancels an
  // in-flight playback CHAIN (pause, seek, dispose); this one invalidates
  // synthesised AUDIO. They change for different reasons -- pausing must not
  // throw away buffers, and changing voice must -- so sharing one counter would
  // make every pause re-synthesise the page.
  let audioEpoch = 0;

  const state = (buffering, message = '') => onStateChange({ playing, buffering, message });

  function toAudioBuffer({ samples, sampleRate }) {
    const buffer = context.createBuffer(1, samples.length, sampleRate);
    buffer.getChannelData(0).set(samples);
    return buffer;
  }

  function trim() {
    if (buffers.size <= RETAIN) return;
    for (const id of [...buffers.keys()]) {
      if (buffers.size <= RETAIN) break;
      const position = index.get(id) ?? 0;
      if (position < cursor - 4) buffers.delete(id);
    }
  }

  function request(position) {
    const sentence = sentences[position];
    if (!sentence || buffers.has(sentence.id) || inFlight.has(sentence.id)) return;

    const started = performance.now();
    const epoch = audioEpoch;
    const stream = { chunks: [], sampleRate: 0, listener: null };
    stream.first = new Promise((resolve) => { stream.arrived = resolve; });
    streams.set(sentence.id, stream);
    const current = () => epoch === audioEpoch && streams.get(sentence.id) === stream;

    const promise = engine.synthesize(sentence.id, sentence.speech, {
      onChunk: (samples, sampleRate) => {
        if (!current()) return;
        stream.chunks.push(samples);
        stream.sampleRate = sampleRate;
        stream.arrived();
        stream.listener?.chunk(samples, sampleRate);
      },
      onReset: () => {
        if (!current()) return;
        stream.chunks = [];
        stream.listener?.reset();
      },
    })
      .then((result) => {
        // THE RACE A PLAIN buffers.clear() LOSES. This synthesis was started
        // before the voice changed and resolves after it, so writing it now
        // would put old-voice audio straight back into the cache the flush just
        // emptied -- and the sentence the reader hears next is in the very voice
        // they changed away from. Drop it; waitFor() re-requests under the new
        // epoch.
        if (epoch !== audioEpoch) return;
        const wall = (performance.now() - started) / 1000;
        const audio = result.samples.length / result.sampleRate;
        const rtf = audio > 0 ? wall / audio : 0;
        if (rtf > SLOW_RTF) lookahead = SLOW_LOOKAHEAD;
        // No AudioBuffer for no samples: Web Audio refuses a zero-length one.
        buffers.set(sentence.id, {
          buffer: result.samples.length > 0 ? toAudioBuffer(result) : null,
          skipped: result.outcome === 'skipped',
          rtf,
        });
        trim();
      })
      .catch(() => { /* cancelled or failed; playAt reports it if still needed */ })
      .finally(() => {
        inFlight.delete(sentence.id);
        const live = current();
        if (streams.get(sentence.id) === stream) streams.delete(sentence.id);
        stream.arrived();
        stream.listener?.done(live ? buffers.get(sentence.id) ?? null : null);
      });

    inFlight.set(sentence.id, promise);
  }

  function fill() {
    for (let offset = 0; offset < lookahead; offset += 1) request(cursor + offset);
  }

  async function waitFor(position) {
    const sentence = sentences[position];
    if (!sentence) return null;
    if (buffers.has(sentence.id)) return buffers.get(sentence.id);

    request(position);
    const stream = streams.get(sentence.id);
    if (stream?.chunks.length) return { stream };
    state(true, 'Preparing audio…');
    // Whichever comes first: the first streamed chunk, or the whole sentence.
    await Promise.race([inFlight.get(sentence.id), stream?.first].filter(Boolean));
    state(false);
    if (buffers.has(sentence.id)) return buffers.get(sentence.id);
    if (stream?.chunks.length && streams.get(sentence.id) === stream) return { stream };
    return null;
  }

  // performance.measure('tts:first-sound') from play() to the first audio being
  // scheduled: the number LT-214 reports. A streamed chunk is heard
  // LEAD_SECONDS (src/stream-playback.mjs) after it is scheduled.
  function markFirstSound() {
    if (!awaitingFirstSound) return;
    awaitingFirstSound = false;
    try { performance.measure('tts:first-sound', 'tts:play'); } catch { /* no mark: not measured */ }
  }

  function playStream(position, mine, stream) {
    const { id } = sentences[position];
    const advance = () => { if (mine === generation && playing) playAt(position + 1); };
    const begin = () => {
      streamPlayback = createStreamPlayback({ context, rate, onEnded: advance });
      for (const samples of stream.chunks) streamPlayback.push(samples, stream.sampleRate);
    };

    stopSource();
    begin();
    stream.listener = {
      chunk(samples, sampleRate) { if (mine === generation) streamPlayback.push(samples, sampleRate); },
      // The guard withdrew what it streamed and is starting the sentence again.
      reset() { if (mine === generation) { streamPlayback.stop(); begin(); } },
      done(entry) {
        stream.listener = null;
        if (mine !== generation) return;
        if (entry?.skipped) {
          stopSource();
          onSentenceSkipped(id);
          advance();
          return;
        }
        // Rendered, or failed after streaming some of it: play what streamed.
        streamPlayback.finish();
      },
    };

    onSentenceChange(id);
    state(false);
    markFirstSound();
    fill();
  }

  function stopSource() {
    if (streamPlayback) {
      streamPlayback.stop();
      streamPlayback = null;
    }
    if (!source) return;
    source.onended = null;
    try { source.stop(); } catch { /* already stopped */ }
    source.disconnect();
    source = null;
  }

  async function playAt(position) {
    const mine = ++generation;

    // The bounds check comes before the cursor moves. Assigning first would
    // leave the cursor one past the last sentence when the page finishes, so
    // currentId() would report null -- and pause, resume and position memory
    // all read currentId().
    if (position >= sentences.length) {
      playing = false;
      onSentenceChange(null);
      state(false);
      return;
    }

    cursor = position;

    const entry = await waitFor(position);
    if (mine !== generation || !playing) return;
    if (!entry) { await playAt(position + 1); return; }
    if (entry.stream) { playStream(position, mine, entry.stream); return; }
    if (!entry.buffer) {
      if (entry.skipped) onSentenceSkipped(sentences[position].id);
      await playAt(position + 1);
      return;
    }

    if (entry.rtf > STALL_RTF) state(true, 'Preparing audio…');

    stopSource();
    source = context.createBufferSource();
    source.buffer = entry.buffer;
    source.playbackRate.value = rate;
    source.connect(context.destination);
    source.onended = () => { if (mine === generation && playing) playAt(position + 1); };

    onSentenceChange(sentences[position].id);
    state(false);
    source.start();
    markFirstSound();
    fill();
  }

  return {
    async play() {
      if (playing) return;
      playing = true;
      awaitingFirstSound = true;
      try { performance.mark('tts:play'); } catch { /* not measured */ }
      if (context.state === 'suspended') await context.resume();
      for (let offset = 0; offset < INITIAL_BUFFER; offset += 1) request(cursor + offset);
      await playAt(cursor);
    },

    pause() {
      playing = false;
      generation += 1;
      stopSource();
      state(false);
    },

    /** Discard every synthesised buffer. Called when the voice OR the language
     * changes.
     *
     * `request()` skips any sentence already in `buffers`, so without this the
     * lookahead's 4-8 already-rendered sentences (and up to RETAIN=24 behind the
     * cursor) keep playing in the previous voice. engine.setVoice() had already
     * done its half correctly -- the worker loads the new style -- which is what
     * made this look like the voice menu doing nothing at all.
     *
     * The player fix (final-review): cancels every pending synthesis before
     * clearing the map, mirroring what seekTo already does. Without this, up
     * to 8 lookahead syntheses stay QUEUED in the single-threaded worker ahead
     * of whatever request comes next -- untracking them here does not dequeue
     * them there. On a language switch the new language's first sentence sat
     * behind the old language's still-in-flight lookahead and arrived seconds
     * late; this improves changeVoice too, for the same reason. */
    flushAudio() {
      audioEpoch += 1;
      for (const pending of inFlight.keys()) engine.cancel(pending);
      buffers.clear();
      inFlight.clear();
      streams.clear();
    },

    /** Swap what each sentence SAYS, leaving ids, positions and the cursor alone.
     *
     * The id-to-position index and the reader's highlighting both key off the
     * sentence ids, so the array is mutated in place rather than rebuilt: a new
     * array would mean a new player, and a new player loses the reader's place.
     *
     * Pass an empty object to go back to English. Any id the track omits falls
     * back to English individually -- one English sentence inside a Spanish page
     * is the intended outcome when the translator mangled that sentence.
     */
    setSpeechText(textById = {}) {
      for (const sentence of sentences) {
        sentence.speech = textById[sentence.id] ?? english.get(sentence.id);
      }
      this.flushAudio();
    },

    /** Swap what SOME sentences say, without throwing the rest of the page away.
     *
     * `setSpeechText` is right for the two cases it serves -- switching language
     * and returning to English -- and catastrophic for streaming. It rewrites
     * EVERY sentence and calls `flushAudio()`, which discards the lookahead's 4-8
     * rendered sentences and up to RETAIN=24 behind. Called once per translated
     * sentence on a 9,430-sentence book that is 9,430 flushes, and nothing ever
     * finishes rendering long enough to play. Hence a second entry point rather
     * than a flag on the first.
     *
     * THREE RULES, and each one is a bug that a naive implementation ships.
     *
     * 1. Only the ids in `partial` are touched. Rewriting the others would put
     *    identical text back and gain nothing, but discarding their audio -- the
     *    whole point of the flush -- costs everything.
     * 2. Only at or after the cursor. Discarding audio the reader has already
     *    passed spends synthesis on sentences nobody is going to hear again in
     *    this pass. The cost is real and named: a sentence behind the cursor
     *    keeps whatever audio it was rendered with, so seeking BACK into one that
     *    was updated since plays the older text. That is the same one-sentence-in-
     *    the-wrong-language outcome the sparse-track contract already tolerates,
     *    and it is cheaper than re-rendering the past on every update.
     * 3. Never the sentence being spoken. Cutting audio out from under a listener
     *    mid-utterance is exactly the "sounds like neither" hazard changeLanguage
     *    documents; the sentence finishes in whatever language it started in. The
     *    `playing` guard also covers the subtler case: while `waitFor` is awaiting
     *    the cursor's synthesis, cancelling it makes `waitFor` resolve null and
     *    `playAt` SKIP the sentence entirely.
     *
     * A sentence whose text did not actually change keeps its audio. Streaming
     * re-sends overlapping windows, and re-rendering an identical sentence is
     * indistinguishable from the bug this function exists to avoid.
     */
    updateSpeechText(partial = {}) {
      for (const id of Object.keys(partial)) {
        const position = index.get(id);
        if (position === undefined) continue;   // not a mounted sentence

        const sentence = sentences[position];
        const text = partial[id] ?? english.get(id);
        if (sentence.speech === text) continue;
        sentence.speech = text;

        if (position < cursor) continue;
        if (position === cursor && playing) continue;

        buffers.delete(id);
        if (inFlight.has(id)) {
          // Cancel, not merely untrack: an untracked synthesis stays QUEUED in
          // the single-threaded worker ahead of the re-request, so the new text
          // arrives behind the old one it replaced. flushAudio learned this the
          // same way.
          engine.cancel(id);
          inFlight.delete(id);
          streams.delete(id);
        }
      }
    },

    async next() { await this.seekTo(sentences[Math.min(cursor + 1, sentences.length - 1)]?.id); },
    async prev() { await this.seekTo(sentences[Math.max(cursor - 1, 0)]?.id); },

    async seekTo(id) {
      const position = index.get(id);
      if (position === undefined) return;
      for (const pending of inFlight.keys()) engine.cancel(pending);
      generation += 1;
      stopSource();
      cursor = position;
      onSentenceChange(id);
      if (playing) await playAt(position);
    },

    setRate(value) {
      rate = value;
      if (source) source.playbackRate.value = value;
      streamPlayback?.setRate(value);
    },

    currentId() { return sentences[cursor]?.id ?? null; },

    /** Whether audio is running. Read by the reader to decide whether a seek
     * should resume afterwards -- it pauses across a seek so translation can
     * catch up, and must put the reader back where it found them. */
    isPlaying() { return playing; },

    dispose() {
      playing = false;
      generation += 1;
      stopSource();
      buffers.clear();
      inFlight.clear();
      streams.clear();
    },
  };
}
