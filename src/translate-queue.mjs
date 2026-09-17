/**
 * Decide WHAT to translate next, and when to stop.
 *
 * Translating the page and then starting is not viable: 9,430 sentences at the
 * fastest rate anyone has measured is 22 minutes before a word is spoken. The
 * translator has to run while the reader listens, and that turns "translate the
 * page" into two scheduling questions this module answers.
 *
 * WHICH SENTENCES FIRST. Priority is distance ahead of the PLAYER'S CURSOR, not
 * position in the document. A reader who opens chapter 9 and presses play must
 * not wait for chapters 1 to 8, and a reader who seeks mid-book must have
 * translation start THERE, not finish where it was. So the cursor is read fresh
 * on every batch rather than captured, and completed work is kept -- seeking back
 * costs nothing.
 *
 * HOW FAR AHEAD. A window, not the rest of the page. Three reasons, and the
 * third is the one that is easy to forget: it bounds memory; it makes the worst
 * batch rate the one that governs rather than the average over thousands of
 * sentences; and it stops spending a reader's battery on a book they stopped
 * listening to ten minutes ago. When the window is full this goes idle until the
 * cursor moves.
 *
 * Deliberately NOT in the worker. The worker is a pure function of the lines it
 * is given -- that is what makes it testable without a 115 MB model -- and the
 * cursor lives out here, next to the player. Sending cursor updates into the
 * worker would move the scheduler away from the only thing it schedules against.
 */

// Sentences to keep translated ahead of the cursor. Twice the player's
// SLOW_LOOKAHEAD (8), which is how far AUDIO renders ahead when the engine is
// struggling: the translator has to stay ahead of synthesis, not just ahead of
// playback, or the player renders English and step 5 has to throw it away again.
export const WINDOW = 16;

// Matches MAX_BATCH in translate.worker.mjs. Larger here would be split there
// anyway; smaller would give up throughput for nothing.
export const BATCH = 8;

// Consecutive translated sentences ahead of the cursor below which this device
// is losing the race against playback. Half the window: one full batch of margin
// is gone and the next one has not landed.
//
// Not a tuning knob so much as the definition of "falling behind" -- above it the
// reader hears Spanish continuously, below it they are about to hear silence.
export const FLOOR = 8;

// Batches in a row below FLOOR before the reader is told. A single dip is normal
// -- it happens on every seek, because the cursor jumps to sentences nothing has
// touched yet. Three in a row while the cursor is advancing is a device that is
// not going to catch up.
export const STRIKES = 3;

// Sentences per second below which this device should not START in the target
// language at all. Playback consumes about 0.33 sent/s (measured), so this is
// roughly 1.5x what is needed -- margin, because a device sitting exactly at
// playback's rate stalls the moment anything else happens on it.
//
// The one number here NOT measured on the hardware that matters. 2.99 sent/s is
// an M1 Ultra and 0.90 is the same machine single-threaded; a school Chromebook
// is unmeasured and deprioritised (build plan step 11). The design does not need
// that measurement, because the prefix wait measures THIS device before playback
// starts -- but the threshold it is compared against is still a judgement, and
// saying so is the difference between a provisional number and a wrong one.
export const MIN_RATE = 0.5;

export function createTranslationQueue({
  sentences,
  translate,
  cursor = () => 0,
  onBatch = () => {},
  onProgress = () => {},
  onError = () => {},
  window = WINDOW,
  batch = BATCH,
  skip = new Set(),
  onFallingBehind = () => {},
  floor = FLOOR,
  strikes = STRIKES,
  now = () => Date.now(),
}) {
  const done = new Map();                                  // id -> translated text
  // `skip` is the reference-section holdback (src/qa.mjs): a bibliography is
  // author surnames, journal titles and years, and translating it introduces
  // factual errors rather than style differences. Held OUT of `pending` rather
  // than filtered out of `sentences`, because the cursor is an index into the
  // player's list and a shorter list would silently reindex every priority
  // decision this module makes.
  //
  // It is also the largest speed-up available: on the deployed book it withholds
  // 4,988 of 14,418 sentences, so a third of the work never runs.
  const pending = new Set(sentences.map((_, i) => i).filter((i) => !skip.has(sentences[i].id)));
  let stopped = false;
  let wakeUp = null;
  let started = false;

  // Step 11: this device's OWN measured rate, rather than an assumption about
  // it. 2.99 sent/s is an M1 Ultra and 0.90 is the same machine single-threaded;
  // a school Chromebook is unmeasured and could be 0.3-0.6, at or below
  // playback's ~0.33. The design cannot know which machine it is on, so it does
  // not guess -- the prefix wait in start() is already a real sample of this
  // device on this page, and every batch after it refines the number.
  //
  // Only time spent INSIDE translate() counts. Wall-clock would include the
  // stretch where the window was full and this loop was idle, which is most of a
  // healthy session -- and would report a fast device as a slow one purely
  // because the reader was listening rather than waiting.
  let busyMs = 0;
  let translatedCount = 0;
  let consecutiveLow = 0;
  let warned = false;

  /** Sentences per second while actually translating, or null before the first
   * batch -- the honest answer when nothing has been measured yet. */
  function rate() {
    return busyMs > 0 ? translatedCount / (busyMs / 1000) : null;
  }

  // Everyone waiting for the window at the CURRENT cursor to fill. The prefix
  // promise answers that question once, at the start; a seek asks it again.
  const waiters = [];
  let settled = false;   // stopped or failed: never leave a waiter hanging

  let resolvePrefix;
  let rejectPrefix;
  let prefixSettled = false;
  const prefix = new Promise((resolve, reject) => { resolvePrefix = resolve; rejectPrefix = reject; });
  // Nothing awaits `prefix` until start() returns it, and a synchronous
  // rejection before then is an unhandled rejection in every browser.
  prefix.catch(() => {});

  /** Consecutive translated sentences from the cursor -- the only number that
   * says whether the reader is about to run out. Not `done.size`: 500 translated
   * sentences behind the cursor keep nobody listening. */
  function ahead() {
    const from = cursor();
    let n = 0;
    // A skipped sentence counts as READY, not as a gap. English is its final
    // text, so the reader is not about to run out when they reach one -- and a
    // bibliography is thousands of sentences long, so treating it as untranslated
    // would stall the prefix wait forever at the end of every chapter.
    while (from + n < sentences.length
           && (done.has(sentences[from + n].id) || skip.has(sentences[from + n].id))) n += 1;
    return n;
  }

  function status() {
    return {
      translated: done.size, total: pending.size + done.size, ahead: ahead(), window,
      rate: rate(),
    };
  }

  /** The next few untranslated sentences inside the window, nearest first. */
  function nextBatch() {
    const from = Math.max(0, cursor());
    const limit = Math.min(sentences.length, from + window);
    const out = [];
    for (let i = from; i < limit && out.length < batch; i += 1) {
      if (pending.has(i)) out.push(i);
    }
    return out;
  }

  function settlePrefix(error) {
    if (!prefixSettled) {
      prefixSettled = true;
      if (error) rejectPrefix(error); else resolvePrefix();
    }
    // Waiters RESOLVE even on failure or stop. They gate playback, so a waiter
    // that never settles is a reader staring at a paused player forever -- worse
    // than the English sentence the wait exists to avoid.
    waiters.splice(0).forEach((resume) => resume());
  }

  function idle() {
    return new Promise((resolve) => { wakeUp = resolve; });
  }

  async function loop() {
    try {
      while (!stopped) {
        const indices = nextBatch();
        if (!indices.length) {
          // The window is full. This is the ONLY place the prefix resolves: it
          // means everything the player can reach before it needs more is ready.
          settlePrefix();
          await idle();
          continue;
        }

        const startedAt = now();
        // `||` rather than `??`, for the reason src/reader.mjs gives where it
        // builds this list: an empty display is a real value and a useless one.
        const lines = await translate(
          indices.map((i) => sentences[i].display || sentences[i].speech));
        if (stopped) return;
        busyMs += now() - startedAt;
        translatedCount += indices.length;

        const partial = {};
        indices.forEach((position, k) => {
          pending.delete(position);
          done.set(sentences[position].id, lines[k]);
          partial[sentences[position].id] = lines[k];
        });

        onBatch(partial);
        onProgress(status());

        // Reported once, from the only place that can see it: the queue knows
        // both how fast this device translates and how much runway is left, and
        // nothing else knows either. Silence is the one behaviour ruled out --
        // from the listener's side a translator that quietly stops keeping up is
        // indistinguishable from the feature being broken.
        consecutiveLow = ahead() < floor ? consecutiveLow + 1 : 0;
        if (consecutiveLow >= strikes && !warned) {
          warned = true;
          onFallingBehind(status());
        }
      }
      settled = stopped;
    } catch (error) {
      settled = true;
      // Reported BOTH ways on purpose, and the caller tells them apart. Before
      // playback starts, the rejected prefix is the failure -- the reader never
      // got what they asked for. After it starts, the prefix is long resolved and
      // only onError is left; the page keeps playing what it already has.
      settlePrefix(error);
      onError(error);
    }
  }

  return {
    /** Begin translating, and resolve once the window ahead of the cursor is
     * ready. Playback must not start before that: a reader who picked Spanish
     * and hears five English sentences reads it as broken, so there is no
     * start-in-English-and-upgrade path here. */
    start() {
      if (!started) { started = true; loop(); }
      return prefix;
    },

    /** The cursor moved. Cheap and idempotent -- call it from every place the
     * cursor can change rather than trying to work out which ones matter. */
    wake() {
      const resume = wakeUp;
      wakeUp = null;
      resume?.();
    },

    stop() {
      stopped = true;
      settled = true;
      settlePrefix();
      this.wake();
    },

    /** Resolve once the window at the cursor RIGHT NOW is translated.
     *
     * `start()` answers this once, before playback. A seek asks it again: the
     * reader who jumps to chapter 9 should hear silence and a progress line for a
     * moment, not two English sentences. Same rule as the start, applied to the
     * only other place the cursor jumps.
     *
     * Never rejects. It gates playback, so its job is to stop waiting, one way or
     * another.
     */
    ready() {
      if (settled || !nextBatch().length) return Promise.resolve();
      return new Promise((resume) => { waiters.push(resume); });
    },

    /** Everything translated so far, sparse. Ids it omits stay English, which is
     * the contract player.setSpeechText already has. */
    textById() { return Object.fromEntries(done); },

    status,
  };
}
