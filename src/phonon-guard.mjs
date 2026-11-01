/**
 * The length guard around Phonon synthesis: what stops a sentence the model has
 * lost its way in from being played.
 *
 * Phonon generates speech one 80 ms frame at a time until it predicts the end of
 * speech. On long formula text with no punctuation it can fail to stop: in LT-213,
 * s18 (329 characters, not one comma) looped in 2 of 4 fp32 runs. Two signals
 * catch a runaway, and both are cheap:
 *
 *   - the audio runs well past the length its text predicts (`overrunSeconds`);
 *   - the model ran into its frame ceiling without predicting end of speech.
 *
 * What happens then is LT-214's rule, in order: retry once; render
 * the sentence split at punctuation; skip it with a visible mark. Never play
 * nonsense, and never fall back to Supertonic for English.
 *
 * Streaming and the guard pull against each other: a frame that has been played
 * cannot be taken back. So frames are streamed only while the attempt is still
 * within the length its text predicts; anything past that is held until the
 * model ends the sentence on its own, and is dropped if it does not. A runaway is
 * therefore heard for at most its expected length before `onReset` withdraws it.
 *
 * What it cannot catch, and does not claim to: a derail that stays inside the
 * predicted length. In LT-213 the worst s18 runs came out at 1.02-1.10x their
 * expected length -- nonsense of the right duration. What removed those in the
 * LT-214 calibration was the slower speaking rate (duration_delta 1), not
 * the temperature: s18 read cleanly in all 8 runs (bench/phonon/FINDINGS.md).
 * This is the net under it.
 *
 * Pure: the renderer is a parameter, so every branch is tested without a model.
 */

// Calibrated on the LT-213 bench set at the shipped settings (wasm fp32,
// temperature and duration_delta in phonon.worker.mjs): 168 renders, 21 items x
// 4 temperatures x 2 runs. With these, the longest clean render was 1.15x its
// expected length, so the cap clears it by about 30%. The fit is in
// bench/phonon/FINDINGS.md, "LT-214 calibration".
export const GUARD = Object.freeze({
  charsPerSecond: 11.5,   // per spoken-length character, see spokenLength
  offsetSeconds: 1.1,     // a short sentence's fixed cost: lead-in, lead-out, EOS countdown
  digitWeight: 5,         // "1024" is four characters and "one thousand twenty four" said
  letterWeight: 4,        // a lone capital ("N O two") is said as a name, with a pause
  factor: 1.5,            // the cap, as a multiple of the expected length
  splitMaxChars: 80,      // a split piece with no punctuation is cut at words to this
  sampleRate: 24000,
});

/** Characters, with digits and lone capital letters weighted by how long they
 * take to say: Phonon reads digits itself, and Speech Text keeps them in math. */
export function spokenLength(text) {
  const digits = text.match(/\d/g)?.length ?? 0;
  const letters = text.match(/\b[A-Z]\b/g)?.length ?? 0;
  return text.length + digits * (GUARD.digitWeight - 1) + letters * (GUARD.letterWeight - 1);
}

/** Seconds of audio a sentence of this text should take. */
export function expectedSeconds(text) {
  return GUARD.offsetSeconds + spokenLength(text) / GUARD.charsPerSecond;
}

/** Seconds of audio past which an attempt is stopped as a runaway. */
export function overrunSeconds(text) {
  return expectedSeconds(text) * GUARD.factor;
}

/**
 * Split at commas, semicolons, colons and sentence ends, keeping each mark with
 * the words before it. A piece that is still longer than `splitMaxChars` -- a
 * formula, which is exactly the text that needs splitting -- is cut at word
 * boundaries. Joining the pieces with single spaces gives the text back.
 */
export function splitAtPunctuation(text) {
  return text.trim().split(/(?<=[,;:.!?])\s+/).filter(Boolean).flatMap(wrapWords);
}

function wrapWords(clause) {
  if (clause.length <= GUARD.splitMaxChars) return [clause];
  const pieces = [];
  let current = '';
  for (const word of clause.split(/\s+/)) {
    if (current && current.length + 1 + word.length > GUARD.splitMaxChars) {
      pieces.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  return current ? [...pieces, current] : pieces;
}

function concat(parts) {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  parts.reduce((offset, p) => (out.set(p, offset), offset + p.length), 0);
  return out;
}

/**
 * Render one sentence through the guard.
 *
 * `synth(text)` is an async generator of Float32Array frames whose return value
 * is `{ eos }`: whether the model ended the text itself (true) or ran into its
 * frame ceiling (false).
 *
 * Callbacks: `onChunk(samples)` for audio that may be played now; `onReset()`
 * when every chunk streamed so far for this sentence must be dropped;
 * `onAttemptEnd()` just before held-back audio is released; `isCancelled()` is
 * polled between frames.
 *
 * Resolves `{ outcome, samples }`. outcome is 'ok', 'retried', 'split',
 * 'skipped' (samples empty) or 'cancelled'. On every outcome but 'cancelled',
 * the chunks streamed since the last reset are exactly `samples`.
 */
export async function renderGuarded(text, synth, {
  onChunk = () => {}, onReset = () => {}, onAttemptEnd = () => {}, isCancelled = () => false,
} = {}) {
  let dirty = false;  // chunks streamed since the last reset
  const emit = (samples) => { dirty = true; onChunk(samples); };
  const withdraw = () => { if (dirty) { dirty = false; onReset(); } };

  async function attempt(piece) {
    const hold = expectedSeconds(piece) * GUARD.sampleRate;
    const cap = overrunSeconds(piece) * GUARD.sampleRate;
    const frames = synth(piece);
    const parts = [];
    const held = [];
    let total = 0;
    let eos = true;
    try {
      for (;;) {
        if (isCancelled()) return { status: 'cancelled' };
        const { value, done } = await frames.next();
        if (done) { eos = value?.eos ?? true; break; }
        total += value.length;
        if (total > cap) return { status: 'overrun' };
        parts.push(value);
        if (total <= hold && held.length === 0) emit(value);
        else held.push(value);
      }
    } finally {
      // Stop the model generating frames nobody will hear.
      await frames.return?.();
    }
    if (!eos) return { status: 'overrun' };
    onAttemptEnd();
    for (const samples of held) emit(samples);
    return { status: 'ok', samples: concat(parts) };
  }

  for (const outcome of ['ok', 'retried']) {
    const result = await attempt(text);
    if (result.status === 'cancelled') return { outcome: 'cancelled', samples: new Float32Array(0) };
    if (result.status === 'ok') return { outcome, samples: result.samples };
    withdraw();
  }

  const pieces = [];
  for (const piece of splitAtPunctuation(text)) {
    const result = await attempt(piece);
    if (result.status === 'cancelled') return { outcome: 'cancelled', samples: new Float32Array(0) };
    if (result.status !== 'ok') {
      withdraw();
      return { outcome: 'skipped', samples: new Float32Array(0) };
    }
    pieces.push(result.samples);
  }
  return { outcome: 'split', samples: concat(pieces) };
}
