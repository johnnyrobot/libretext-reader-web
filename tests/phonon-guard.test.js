import { describe, it, expect } from 'vitest';
import {
  expectedSeconds, overrunSeconds, spokenLength, splitAtPunctuation, renderGuarded, GUARD,
} from '../src/phonon-guard.mjs';

const RATE = 24000;
const FRAME = 1920; // one 80 ms Phonon frame

// A fake Phonon renderer: yields `frames` 80 ms frames, then returns whether the
// model reached end-of-speech on its own (`eos`) or ran into its frame ceiling.
function renderer(plan) {
  const calls = [];
  const synth = async function* (text) {
    calls.push(text);
    const { frames, eos = true } = plan(text, calls.length);
    for (let i = 0; i < frames; i++) yield new Float32Array(FRAME).fill((calls.length * 1000 + i) / 1e6);
    return { eos };
  };
  return { synth, calls };
}

const framesFor = (seconds) => Math.round(seconds * 12.5);

function collect() {
  const events = [];
  return {
    events,
    onChunk: (samples) => events.push(['chunk', samples.length]),
    onReset: () => events.push(['reset']),
  };
}

// s18 of the LT-213 bench set: 329 characters of formula and not one comma.
const S18 = 'K one equals the concentration of N O squared over the concentration of N two times '
  + 'the concentration of O two K two equals the concentration of N O two squared over the '
  + 'concentration of N O squared times the concentration of O two K three equals the '
  + 'concentration of N O two squared over the concentration of N two O two squared';

describe('expectedSeconds', () => {
  it('grows with the text at the calibrated speaking rate', () => {
    const short = expectedSeconds('a'.repeat(100));
    const long = expectedSeconds('a'.repeat(200));
    expect(long - short).toBeCloseTo(100 / GUARD.charsPerSecond, 5);
  });

  it('gives a very short sentence its fixed allowance, not zero', () => {
    expect(expectedSeconds('ok')).toBeGreaterThan(GUARD.offsetSeconds);
  });

  it('weighs digits and lone capitals by how long they take to say', () => {
    // s21 "1024 divided by 3 ..." is 80 characters and runs 12.6-14.9 s at the
    // shipped settings, nearly twice what its characters predict: "1024" is
    // four characters and "one thousand twenty four" spoken. s15 "N O two"
    // is seven and runs 2.2-2.6 s.
    expect(spokenLength('1024')).toBe(4 * GUARD.digitWeight);
    expect(spokenLength('N O two')).toBe(2 * GUARD.letterWeight + 5);
    expect(spokenLength('An apple')).toBe(8);     // "An" is a word, not a letter
  });

  it('predicts every clean calibration render to within the cap', () => {
    // From the LT-214 calibration (168 renders, 4 temperatures x 2 runs): the
    // longest clean render was 1.15x its expected length (s15, s18).
    const clean = [
      ['N O two', 2.56],
      ['1024 divided by 3 equals 341 remainder 1, meaning 1024 equals 341 times 3 plus 1', 14.88],
    ];
    for (const [text, seconds] of clean) {
      expect(seconds / expectedSeconds(text)).toBeLessThan(1.2);
      expect(seconds).toBeLessThan(overrunSeconds(text));
    }
  });
});

describe('overrunSeconds', () => {
  it('is the expected length times the calibrated factor', () => {
    const text = 'a'.repeat(160);
    expect(overrunSeconds(text)).toBeCloseTo(expectedSeconds(text) * GUARD.factor, 5);
  });
});

describe('splitAtPunctuation', () => {
  it('splits at commas, semicolons, colons and sentence ends, keeping the marks', () => {
    expect(splitAtPunctuation('First, the base; then: the acid. Done!'))
      .toEqual(['First,', 'the base;', 'then:', 'the acid.', 'Done!']);
  });

  it('cuts a piece with no punctuation at word boundaries, never mid-word', () => {
    const pieces = splitAtPunctuation(S18);
    expect(pieces.length).toBeGreaterThan(1);
    for (const piece of pieces) expect(piece.length).toBeLessThanOrEqual(GUARD.splitMaxChars);
    expect(pieces.join(' ')).toBe(S18);
  });

  it('returns the text as one piece when there is nothing to split', () => {
    expect(splitAtPunctuation('Hello there')).toEqual(['Hello there']);
  });
});

describe('renderGuarded', () => {
  it('streams a clean sentence frame by frame and returns all of it', async () => {
    const text = 'The general idea is cognitive in orientation.';
    const { synth, calls } = renderer(() => ({ frames: framesFor(expectedSeconds(text) * 0.9) }));
    const sink = collect();

    const result = await renderGuarded(text, synth, sink);

    expect(result.outcome).toBe('ok');
    expect(calls).toEqual([text]);
    expect(sink.events.every(([kind]) => kind === 'chunk')).toBe(true);
    expect(result.samples.length).toBe(framesFor(expectedSeconds(text) * 0.9) * FRAME);
    expect(sink.events.reduce((n, [, len]) => n + len, 0)).toBe(result.samples.length);
  });

  it('holds back audio past the expected length until the sentence ends cleanly', async () => {
    const text = 'a'.repeat(160);
    const expected = expectedSeconds(text);
    const frames = framesFor(expected * 1.1);
    const { synth } = renderer(() => ({ frames }));
    const streamed = [];
    let releasedAtEnd = false;
    let done = false;

    await renderGuarded(text, synth, {
      onChunk: (samples) => { streamed.push(samples.length); if (done) releasedAtEnd = true; },
      onReset: () => {},
      onAttemptEnd: () => { done = true; },
    });

    const heardBeforeEnd = streamed.length;
    expect(heardBeforeEnd).toBe(frames);       // all of it is played in the end
    expect(releasedAtEnd).toBe(true);          // but the tail only after EOS
  });

  it('stops a runaway sentence at the cap, retries once, and keeps the clean retry', async () => {
    const text = 'a'.repeat(160);
    const { synth, calls } = renderer((_, n) => (n === 1
      ? { frames: framesFor(overrunSeconds(text) * 3), eos: false }
      : { frames: framesFor(expectedSeconds(text)) }));
    const sink = collect();

    const result = await renderGuarded(text, synth, sink);

    expect(result.outcome).toBe('retried');
    expect(calls).toEqual([text, text]);
    // The runaway attempt was cut at the cap, not rendered to the end.
    expect(sink.events.filter(([k]) => k === 'reset')).toHaveLength(1);
    expect(result.samples.length).toBe(framesFor(expectedSeconds(text)) * FRAME);
  });

  it('never streams more of a runaway attempt than the expected length', async () => {
    const text = 'a'.repeat(160);
    const { synth } = renderer(() => ({ frames: 10_000, eos: false }));
    const heard = [];
    await renderGuarded(text, synth, { onChunk: (s) => heard.push(s.length), onReset: () => heard.push('reset') });
    const firstAttempt = heard.slice(0, heard.indexOf('reset'));
    const seconds = firstAttempt.reduce((n, len) => n + len, 0) / RATE;
    expect(seconds).toBeLessThanOrEqual(expectedSeconds(text) + 0.08);
  });

  it('treats ending without end-of-speech as an overrun even inside the cap', async () => {
    const text = 'a'.repeat(160);
    const { synth, calls } = renderer((_, n) => (n === 1
      ? { frames: framesFor(expectedSeconds(text)), eos: false }
      : { frames: framesFor(expectedSeconds(text)) }));

    const result = await renderGuarded(text, synth, collect());

    expect(result.outcome).toBe('retried');
    expect(calls).toHaveLength(2);
  });

  it('after two overruns renders the sentence split at punctuation', async () => {
    const text = 'First, the base; then the acid.';
    const { synth, calls } = renderer((piece) => (piece === text
      ? { frames: 10_000, eos: false }
      : { frames: framesFor(expectedSeconds(piece)) }));

    const result = await renderGuarded(text, synth, collect());

    expect(result.outcome).toBe('split');
    expect(calls).toEqual([text, text, 'First,', 'the base;', 'then the acid.']);
    const pieceFrames = ['First,', 'the base;', 'then the acid.']
      .reduce((n, piece) => n + framesFor(expectedSeconds(piece)), 0);
    expect(result.samples.length).toBe(pieceFrames * FRAME);
  });

  it('skips the sentence, with nothing left playing, when a split piece also overruns', async () => {
    const text = 'First, the base; then the acid.';
    const { synth } = renderer((piece) => (piece === 'the base;'
      ? { frames: 10_000, eos: false }
      : piece === text ? { frames: 10_000, eos: false } : { frames: framesFor(expectedSeconds(piece)) }));
    const sink = collect();

    const result = await renderGuarded(text, synth, sink);

    expect(result.outcome).toBe('skipped');
    expect(result.samples.length).toBe(0);
    expect(sink.events.at(-1)).toEqual(['reset']);   // whatever streamed is withdrawn
  });

  it('a long formula that keeps looping is skipped, never played in full', async () => {
    // The LT-213 failure: s18 at fp32 looped in 2 of 4 runs. Every attempt and
    // every piece loops here, which is worse than the model ever did.
    const { synth } = renderer(() => ({ frames: 10_000, eos: false }));
    const sink = collect();

    const result = await renderGuarded(S18, synth, sink);

    expect(result.outcome).toBe('skipped');
    expect(result.samples.length).toBe(0);
    expect(sink.events.at(-1)).toEqual(['reset']);
  });

  it('stops promptly when cancelled and plays nothing more', async () => {
    const text = 'a'.repeat(160);
    let cancelled = false;
    const { synth } = renderer(() => ({ frames: 1000 }));
    const sink = collect();
    const result = await renderGuarded(text, synth, {
      ...sink,
      onChunk: (s) => { sink.onChunk(s); cancelled = true; },
      isCancelled: () => cancelled,
    });
    expect(result.outcome).toBe('cancelled');
    expect(sink.events.filter(([k]) => k === 'chunk')).toHaveLength(1);
  });
});
