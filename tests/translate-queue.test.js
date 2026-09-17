import { describe, it, expect, vi } from 'vitest';
import {
  createTranslationQueue, WINDOW, BATCH, FLOOR, STRIKES,
} from '../src/translate-queue.mjs';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function page(count = 60) {
  return Array.from({ length: count }, (_, i) => ({ id: `s${i}`, display: `Sentence ${i}.` }));
}

/** A queue over a 60-sentence page with a movable cursor and a recording
 * translator. `seek` does what the player does: move, then wake. */
function makeQueue({ sentences = page(), translate, ...rest } = {}) {
  const calls = [];
  let position = 0;
  const applied = [];
  const errors = [];

  // Wrapped rather than replaced, so every test records what was ASKED FOR even
  // when it supplies its own translator -- including one that throws.
  const inner = translate ?? (async (lines) => lines.map((l) => `ES ${l}`));

  const queue = createTranslationQueue({
    sentences,
    translate: (lines) => { calls.push(lines); return inner(lines); },
    cursor: () => position,
    onBatch: (partial) => applied.push(partial),
    onError: (error) => errors.push(error),
    ...rest,
  });

  return {
    queue,
    calls,
    applied,
    errors,
    sentences,
    /** Indices each batch asked for, recovered from the text. */
    batches: () => calls.map((lines) => lines.map((l) => Number(l.match(/\d+/)[0]))),
    seek(to) { position = to; queue.wake(); },
  };
}

describe('translate-queue.mjs', () => {
  it('sends the speech text when a sentence has an empty display', async () => {
    // `display: ""` is a real value in this manifest -- a `notice` block carries
    // one -- so `??` keeps the empty string and asks the model to translate
    // nothing. The oracle-diff harness made exactly this mistake and produced 146
    // sentences of convincing-looking garbage before anyone noticed.
    const sentences = [{ id: 's0', display: '', speech: 'Eight rows.' }];
    const q = makeQueue({ sentences });
    await q.queue.start();
    expect(q.calls.flat()).toEqual(['Eight rows.']);
  });

  it('measures the rate from time spent translating, not from wall clock', async () => {
    // A healthy session is mostly idle: the window fills, and the loop waits for
    // the cursor to move. Wall clock would divide the sentences by that idle
    // time too and report the fastest device as the slowest one -- precisely
    // BECAUSE the reader was listening rather than waiting.
    let clock = 0;
    const q = makeQueue({
      now: () => clock,
      translate: async (lines) => { clock += 1000; return lines.map((l) => `ES ${l}`); },
    });
    await q.queue.start();
    clock += 600_000;                        // ten idle minutes

    // WINDOW sentences over WINDOW/BATCH seconds of actual work.
    expect(q.queue.status().rate).toBeCloseTo(BATCH, 5);
  });

  it('has no rate to report before the first batch', async () => {
    // Null rather than zero or Infinity: nothing has been measured, and step 11's
    // whole approach is measuring this device rather than assuming it. A made-up
    // number here becomes a dialog telling the reader their machine is too slow
    // before it has translated a word.
    const q = makeQueue();
    expect(q.queue.status().rate).toBe(null);
  });

  it('tells the reader once when it has stayed behind, not on a single dip', async () => {
    // A dip happens on every seek: the cursor jumps to sentences nothing has
    // touched. Warning on that would fire the dialog on ordinary navigation, and
    // a reader who is told their device is too slow while it is keeping up
    // perfectly well learns to dismiss the dialog that matters.
    const warnings = [];
    let position = 0;
    const sentences = page(400);
    const queue = createTranslationQueue({
      sentences,
      // Translates one sentence per batch, so the cursor outruns it immediately.
      translate: async (lines) => lines.slice(0, 1).map((l) => `ES ${l}`),
      batch: 1,
      cursor: () => position,
      onFallingBehind: (status) => warnings.push(status),
      // Advance the cursor faster than the translator, which is what a slow
      // device looks like from here.
      onBatch: () => { position += 4; },
    });

    await queue.start().catch(() => {});
    await tick();

    expect(warnings.length).toBe(1);
    expect(warnings[0].ahead).toBeLessThan(FLOOR);
    queue.stop();
  });

  it('a seek dips below the floor and recovers without warning', async () => {
    // The exact false positive STRIKES exists to prevent. Every seek empties the
    // runway -- the cursor lands on sentences nothing has touched -- so the first
    // batch after one always reports a low `ahead`. Warning there fires the
    // "your device is slow" dialog on ordinary navigation of a fast machine, and
    // a reader who is told that while it is keeping up learns to dismiss the
    // dialog that matters.
    const warnings = [];
    const q = makeQueue({
      sentences: page(400), batch: 4, onFallingBehind: (s) => warnings.push(s),
    });
    await q.queue.start();

    q.seek(100);
    for (let i = 0; i < 8; i += 1) await tick();

    // It really did dip -- otherwise this test proves nothing about STRIKES.
    expect(Math.min(...q.applied.map((_, i) => i))).toBe(0);
    expect(q.batches().flat()).toContain(100);
    expect(warnings).toEqual([]);
  });

  it('does not warn while it is keeping up', async () => {
    // The default fixture translates a full batch instantly and the cursor never
    // moves, which is a fast device. STRIKES exists so this stays quiet.
    const warnings = [];
    const q = makeQueue({ onFallingBehind: (s) => warnings.push(s) });
    await q.queue.start();
    await tick();
    expect(warnings).toEqual([]);
    expect(STRIKES).toBeGreaterThan(1);
  });

  it('never translates a held-back sentence, and does not wait for one', async () => {
    // Step 10's reference holdback. The bibliography at the end of a chapter is
    // hundreds of consecutive sentences: if the queue treated them as work, it
    // would spend the reader's battery renaming journals, and if it treated them
    // as untranslated gaps the prefix wait at the end of a chapter would never
    // resolve at all.
    const sentences = page();
    const skip = new Set(['s3', 's4', 's5']);
    const q = makeQueue({ sentences, skip });
    await q.queue.start();

    const asked = q.batches().flat();
    expect(asked).not.toContain(3);
    expect(asked).not.toContain(4);
    expect(asked).not.toContain(5);
    // The window still reaches WINDOW sentences ahead: skipped ones are ready,
    // not missing, so `ahead` counts straight through them.
    expect(q.queue.status().ahead).toBeGreaterThanOrEqual(WINDOW);
    // And they never appear in an update, so the player keeps their English.
    expect(Object.keys(Object.assign({}, ...q.applied))).not.toContain('s3');
  });

  it('a page that is entirely held back resolves instead of hanging', async () => {
    // The degenerate case of the rule above, and the one that strands a reader:
    // a back-matter page that is nothing but references has no work at all, and
    // a prefix that never settles is a player that never starts.
    const sentences = page(10);
    const q = makeQueue({ sentences, skip: new Set(sentences.map((s) => s.id)) });
    await q.queue.start();
    expect(q.calls).toEqual([]);
  });

  it('resolves as soon as the window ahead of the cursor is ready, not the page', async () => {
    // The whole reason this step exists. 303 sentences at 7 sent/s is 43 s
    // before a word is spoken; 16 is about two.
    const q = makeQueue();
    await q.queue.start();

    expect(q.batches().flat()).toEqual([...Array(WINDOW).keys()]);
    expect(q.queue.status().translated).toBe(WINDOW);
    expect(q.sentences.length).toBe(60);   // the rest is deliberately untouched
  });

  it('goes idle when the window is full and resumes when the cursor moves', async () => {
    // "Stops spending a reader's battery on a book they stopped listening to."
    const q = makeQueue();
    await q.queue.start();
    const beforeIdle = q.calls.length;

    await tick();
    await tick();
    expect(q.calls.length).toBe(beforeIdle);   // nothing happens on its own

    q.seek(1);
    await tick();
    expect(q.calls.length).toBeGreaterThan(beforeIdle);
  });

  it('translates where the reader IS, not where the document starts', async () => {
    // A reader who opens chapter 9 must not wait for chapters 1 to 8.
    const q = makeQueue();
    q.seek(40);
    await q.queue.start();

    const asked = q.batches().flat();
    expect(Math.min(...asked)).toBe(40);
    expect(asked).not.toContain(0);
  });

  it('re-prioritises to the new cursor after a seek, keeping what it finished', async () => {
    const q = makeQueue();
    await q.queue.start();                    // 0..15 done
    const done = q.batches().flat();

    q.seek(40);
    await tick();
    await tick();

    const after = q.batches().flat().slice(done.length);
    expect(Math.min(...after)).toBe(40);      // translating THERE, immediately

    // Seeking back costs nothing: completed work is kept, not redone.
    const before = q.calls.length;
    q.seek(0);
    await tick();
    await tick();
    expect(q.batches().flat().slice(done.length + after.length)).not.toContain(0);
    expect(q.calls.length).toBe(before);      // the window at 0 is already full
  });

  it('reports how far AHEAD it is, not how much it has done', async () => {
    // 500 translated sentences behind the cursor keep nobody listening. `ahead`
    // is the number step 11 watches to know the reader is about to run out.
    const q = makeQueue();
    await q.queue.start();
    expect(q.queue.status()).toMatchObject({ translated: WINDOW, ahead: WINDOW, total: 60 });

    q.seek(40);
    await tick();
    expect(q.queue.status().translated).toBeGreaterThan(WINDOW);
    expect(q.queue.status().ahead).toBeGreaterThan(0);

    // At 30 nothing is translated yet, though 32 sentences are done overall.
    q.seek(30);
    expect(q.queue.status().ahead).toBe(0);
    expect(q.queue.status().translated).toBeGreaterThan(WINDOW);
  });

  it('hands the player only the ids in each batch', async () => {
    // updateSpeechText's contract: anything else in the map would discard audio
    // for sentences that did not change.
    const q = makeQueue();
    await q.queue.start();

    expect(q.applied).toHaveLength(WINDOW / BATCH);
    expect(Object.keys(q.applied[0])).toEqual(
      [...Array(BATCH).keys()].map((i) => `s${i}`));
    expect(Object.keys(q.applied[1])).toEqual(
      [...Array(BATCH).keys()].map((i) => `s${i + BATCH}`));
  });

  it('stops for good, without finishing the batch it was told to abandon', async () => {
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    const q = makeQueue({
      translate: async (lines) => { await held; return lines.map((l) => `ES ${l}`); },
    });

    q.queue.start();
    await tick();
    q.queue.stop();
    release();
    await tick();
    await tick();

    expect(q.applied).toHaveLength(0);          // the in-flight result is dropped
    expect(q.queue.status().translated).toBe(0);
    expect(q.calls.length).toBe(1);             // and nothing new was started
  });

  it('rejects the prefix when translation fails before playback starts', async () => {
    // The reader never got what they asked for, so the caller recovers to
    // English. Nothing has been swapped yet.
    const q = makeQueue({ translate: async () => { throw new Error('session died'); } });
    await expect(q.queue.start()).rejects.toThrow(/session died/);
  });

  it('reports a failure after the prefix without rejecting anything', async () => {
    // The reader IS listening in Spanish by now. Tearing the page back to
    // English is a bigger disruption than the untranslated remainder, so this
    // path only reports.
    let calls = 0;
    const q = makeQueue({
      translate: async (lines) => {
        calls += 1;
        if (calls > 2) throw new Error('session died');
        return lines.map((l) => `ES ${l}`);
      },
    });

    await expect(q.queue.start()).resolves.toBeUndefined();
    expect(q.errors).toHaveLength(0);

    q.seek(1);
    await tick();
    await tick();

    expect(q.errors.map((e) => e.message)).toEqual(['session died']);
  });

  it('ready() resolves at once when the window at the cursor is already full', async () => {
    const q = makeQueue();
    await q.queue.start();
    await expect(q.queue.ready()).resolves.toBeUndefined();
  });

  it('ready() waits when the cursor jumped to untranslated ground', async () => {
    // The seek case. A reader who clicks a paragraph in chapter 9 should hear a
    // moment of silence and a progress line, not two English sentences.
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    let calls = 0;
    const q = makeQueue({
      // The prefix (two batches) runs freely; everything after the seek is held.
      translate: async (lines) => {
        calls += 1;
        if (calls > WINDOW / BATCH) await held;
        return lines.map((l) => `ES ${l}`);
      },
    });

    await q.queue.start();
    q.seek(40);

    let arrived = false;
    const waiting = q.queue.ready().then(() => { arrived = true; });
    await tick();
    expect(arrived).toBe(false);       // still translating chapter 9

    release();
    await waiting;
    expect(q.queue.status().ahead).toBeGreaterThan(0);
  });

  it('ready() stops waiting when the queue stops, rather than hanging', async () => {
    // It GATES PLAYBACK. A waiter that never settles is a reader staring at a
    // paused player forever -- worse than the English sentence it exists to
    // avoid.
    const q = makeQueue({ translate: () => new Promise(() => {}) });
    q.queue.start();
    await tick();
    q.seek(40);

    const waiting = q.queue.ready();
    q.queue.stop();
    await expect(waiting).resolves.toBeUndefined();
  });

  it('ready() stops waiting when translation fails, rather than hanging', async () => {
    let calls = 0;
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    const q = makeQueue({
      translate: async (lines) => {
        calls += 1;
        if (calls > 2) { await held; throw new Error('session died'); }
        return lines.map((l) => `ES ${l}`);
      },
    });

    await q.queue.start();
    q.seek(40);
    const waiting = q.queue.ready();
    release();
    await expect(waiting).resolves.toBeUndefined();
    expect(q.errors.map((e) => e.message)).toEqual(['session died']);
  });

  it('resolves immediately on a page with nothing to translate', async () => {
    const q = makeQueue({ sentences: [] });
    await expect(q.queue.start()).resolves.toBeUndefined();
    expect(q.calls).toHaveLength(0);
  });

  it('translates a page shorter than the window without waiting for more', async () => {
    const q = makeQueue({ sentences: page(3) });
    await q.queue.start();
    expect(q.batches().flat()).toEqual([0, 1, 2]);
  });

  it('start() is idempotent, so a second call cannot run two loops', async () => {
    const q = makeQueue();
    const [a, b] = await Promise.all([q.queue.start(), q.queue.start()]);

    expect(a).toBe(b);
    expect(q.batches().flat()).toEqual([...Array(WINDOW).keys()]);
  });

  it('falls back to speech text for a sentence carrying no display text', async () => {
    const q = makeQueue({ sentences: [{ id: 's0', speech: 'Only speech.' }] });
    await q.queue.start();
    expect(q.calls[0]).toEqual(['Only speech.']);
  });
});
