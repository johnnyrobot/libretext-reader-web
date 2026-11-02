import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPlayer } from '../src/player.mjs';

// Web Audio with a clock nobody moves: nodes end only when a test ends them.
function audio() {
  const nodes = [];
  return {
    nodes,
    currentTime: 0,
    state: 'running',
    resume: async () => {},
    destination: {},
    createBuffer: (channels, length, sampleRate) => {
      if (length === 0) throw new Error('NotSupportedError: zero-length buffer');
      return { length, sampleRate, duration: length / sampleRate, getChannelData: () => new Float32Array(length) };
    },
    createBufferSource() {
      const node = {
        buffer: null, playbackRate: { value: 1 }, onended: null, started: false, stopped: false,
        connect() {}, disconnect() {},
        start() { node.started = true; },
        stop() { node.stopped = true; },
        end() { node.onended?.(); },
      };
      nodes.push(node);
      return node;
    },
  };
}

// An engine whose sentences the test drives by hand: chunk, reset, finish.
function streamingEngine() {
  const jobs = new Map();
  const engine = {
    jobs,
    synthesize: vi.fn((id, text, { onChunk = () => {}, onReset = () => {} } = {}) => new Promise((resolve, reject) => {
      jobs.set(id, {
        chunk: (n = 1920) => onChunk(new Float32Array(n), 24000),
        reset: onReset,
        finish: (outcome = 'ok', n = 1920) => resolve({ id, samples: new Float32Array(outcome === 'skipped' ? 0 : n), sampleRate: 24000, outcome }),
        fail: () => reject(new Error('boom')),
        cancel: () => reject(new Error('cancelled')),
      });
    })),
    // Like engine.mjs: a cancel rejects the pending request at once.
    cancel: vi.fn((id) => engine.jobs.get(id)?.cancel()),
  };
  return engine;
}

const SENTENCES = () => [
  { id: 'a', speech: 'First.' },
  { id: 'b', speech: 'Second.' },
  { id: 'c', speech: 'Third.' },
];

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const live = (context) => context.nodes.filter((n) => n.started && !n.stopped);

let context;
let engine;
let seen;
let skipped;
let player;

beforeEach(() => {
  context = audio();
  engine = streamingEngine();
  seen = [];
  skipped = [];
  player = createPlayer({
    engine, sentences: SENTENCES(), audioContext: context,
    onSentenceChange: (id) => seen.push(id),
    onSentenceSkipped: (id) => skipped.push(id),
  });
});

describe('player.mjs streaming (Phonon, LT-214)', () => {
  it('starts speaking on the first chunk, before the sentence has finished rendering', async () => {
    player.play();
    await tick();
    expect(live(context)).toHaveLength(0);

    engine.jobs.get('a').chunk();
    await tick();

    expect(live(context)).toHaveLength(1);
    expect(seen).toEqual(['a']);
  });

  it('plays later chunks as they arrive, then moves on once the sentence is done', async () => {
    player.play();
    await tick();
    const a = engine.jobs.get('a');
    a.chunk(); await tick();
    a.chunk(); a.chunk();
    expect(live(context)).toHaveLength(3);

    a.finish('ok', 3 * 1920);
    await tick();
    live(context).forEach((n) => n.end());
    engine.jobs.get('b').finish();
    await tick();

    expect(seen).toEqual(['a', 'b']);
  });

  it('a reset silences what was streamed and the retry plays from its start', async () => {
    player.play();
    await tick();
    const a = engine.jobs.get('a');
    a.chunk(); await tick();
    a.chunk();
    const before = live(context);

    a.reset();
    expect(before.every((n) => n.stopped)).toBe(true);

    a.chunk();
    expect(live(context)).toHaveLength(1);
    expect(seen).toEqual(['a']);           // still the same sentence
  });

  // Some of a was heard before the guard withdrew it, so b is not the first
  // sentence heard: it was rendered ahead, and waits to be whole.
  it('a skipped sentence is marked, nothing of it is left playing, and the next one plays whole', async () => {
    player.play();
    await tick();
    const a = engine.jobs.get('a');
    a.chunk(); await tick();
    a.reset();
    a.finish('skipped');
    await tick();
    const b = engine.jobs.get('b');
    b.chunk(); await tick();
    expect(seen).toEqual(['a']);
    b.finish();
    await tick();

    expect(skipped).toEqual(['a']);
    expect(seen).toEqual(['a', 'b']);
    expect(live(context)).toHaveLength(1);
  });

  it('a sentence skipped before its turn is marked and passed over', async () => {
    player.play();
    await tick();
    engine.jobs.get('b').finish('skipped');
    const a = engine.jobs.get('a');
    a.chunk(); await tick();
    a.finish();
    await tick();
    live(context).forEach((n) => n.end());
    await tick();
    engine.jobs.get('c')?.finish();
    await tick();

    expect(skipped).toEqual(['b']);
    expect(seen).toEqual(['a', 'c']);
  });

  it('a sentence rendered in full before its turn plays as one buffer', async () => {
    player.play();
    await tick();
    engine.jobs.get('a').finish();
    await tick();
    expect(live(context)).toHaveLength(1);
    expect(live(context)[0].buffer.length).toBe(1920);
  });

  it('setRate reaches the streaming sentence', async () => {
    player.play();
    await tick();
    engine.jobs.get('a').chunk(); await tick();
    player.setRate(1.5);
    expect(live(context)[0].playbackRate.value).toBe(1.5);
    engine.jobs.get('a').chunk();
    expect(live(context)[1].playbackRate.value).toBe(1.5);
  });

  it('pause silences the stream, and chunks arriving after it are not played', async () => {
    player.play();
    await tick();
    const a = engine.jobs.get('a');
    a.chunk(); await tick();
    player.pause();
    expect(live(context)).toHaveLength(0);
    a.chunk();
    expect(live(context)).toHaveLength(0);
  });

  it('a failed synthesis plays what streamed and then moves on', async () => {
    player.play();
    await tick();
    const a = engine.jobs.get('a');
    a.chunk(); await tick();
    a.fail();
    await tick();
    live(context).forEach((n) => n.end());
    engine.jobs.get('b').finish();
    await tick();
    expect(seen).toEqual(['a', 'b']);
  });

  it('measures the time from play to first sound', async () => {
    performance.clearMeasures?.('tts:first-sound');
    player.play();
    await tick();
    engine.jobs.get('a').chunk();
    await tick();
    engine.jobs.get('a').chunk();
    expect(performance.getEntriesByName('tts:first-sound')).toHaveLength(1);
  });

  // The runaway trade-off (LT-214). Only the sentence the reader is waiting on
  // streams; one rendered ahead plays only once the length guard has passed it
  // whole, so a runaway is never heard. Time to first sound is unchanged; the
  // cost is a pause before a sentence that is not whole by its turn.
  it('a sentence rendered ahead that has streamed but not finished waits to be whole', async () => {
    player.play();
    await tick();
    const a = engine.jobs.get('a');
    a.chunk(); await tick();
    a.finish();
    const b = engine.jobs.get('b');
    b.chunk(); b.chunk();
    await tick();

    live(context).forEach((n) => n.end());
    const nodesBefore = context.nodes.length;
    await tick();
    b.chunk();
    await tick();
    expect(seen).toEqual(['a']);              // b's turn, but nothing of it plays yet
    expect(context.nodes).toHaveLength(nodesBefore);

    b.finish('ok', 3 * 1920);
    await tick();
    expect(seen).toEqual(['a', 'b']);
    expect(live(context)).toHaveLength(1);    // one buffer: the whole sentence
    expect(live(context)[0].buffer.length).toBe(3 * 1920);
  });

  // Nothing of b was heard, and what it streamed was never guarded whole, so it
  // is not played: it is marked, like a sentence the guard skipped.
  it('a sentence rendered ahead that fails after streaming is marked skipped', async () => {
    player.play();
    await tick();
    const a = engine.jobs.get('a');
    a.chunk(); await tick();
    a.finish();
    const b = engine.jobs.get('b');
    b.chunk();
    await tick();
    live(context).forEach((n) => n.end());
    await tick();

    const nodesBefore = context.nodes.length;
    b.fail();
    await tick();
    expect(skipped).toEqual(['b']);
    expect(context.nodes).toHaveLength(nodesBefore);   // none of b is played
    engine.jobs.get('c').finish();
    await tick();
    expect(seen).toEqual(['a', 'c']);
  });

  // A seek while a sentence rendered ahead waits to be whole cancels it; the
  // cancelled wait must not clear the "Preparing audio…" the seek has shown.
  it('a seek during a wait keeps showing that the sentence sought is preparing', async () => {
    const states = [];
    player = createPlayer({
      engine, sentences: SENTENCES(), audioContext: context,
      onStateChange: (s) => states.push(s),
    });
    player.play();
    await tick();
    const a = engine.jobs.get('a');
    a.chunk(); await tick();
    a.finish();
    engine.jobs.get('b').chunk();
    await tick();
    live(context).forEach((n) => n.end());
    await tick();

    player.seekTo('c');
    await tick();
    expect(states.at(-1)).toMatchObject({ buffering: true, message: 'Preparing audio…' });
  });

  // Next onto a sentence still rendering. seekTo cancels every request, and the
  // cancelled one used to stay tracked until its promise settled: the re-request
  // was swallowed, so the sentence played only what it had streamed, or nothing.
  it('Next onto a sentence that has streamed a chunk renders it again and plays it in full', async () => {
    player.play();
    await tick();
    engine.jobs.get('a').chunk(); await tick();
    engine.jobs.get('b').chunk();

    player.next();
    await tick();

    expect(engine.synthesize.mock.calls.filter(([id]) => id === 'b')).toHaveLength(2);
    expect(live(context)).toHaveLength(0);   // the cancelled fragment is not played
    const b = engine.jobs.get('b');
    b.chunk(); await tick();
    b.chunk();
    expect(live(context)).toHaveLength(2);
    b.finish('ok', 2 * 1920);
    await tick();
    expect(seen.at(-1)).toBe('b');            // still on b, not skipped to c
    expect(seen).not.toContain('c');
    expect(skipped).toEqual([]);
  });

  it('Next onto a sentence queued with nothing streamed waits for it instead of skipping it', async () => {
    player.play();
    await tick();
    engine.jobs.get('a').chunk(); await tick();

    player.next();
    await tick();

    expect(engine.synthesize.mock.calls.filter(([id]) => id === 'b')).toHaveLength(2);
    expect(seen).not.toContain('c');
    engine.jobs.get('b').chunk(); await tick();
    expect(live(context)).toHaveLength(1);
    expect(seen.at(-1)).toBe('b');
    expect(seen).not.toContain('c');
  });

  // The guard withdrew what the next sentence had streamed and is rendering it
  // again. `first` had already resolved on the withdrawn chunk, so its turn
  // found nothing to play and passed it over, unmarked. a is skipped before a
  // sound of it is heard, so b is the sentence the reader is waiting on, and
  // may stream.
  it('a sentence reset before its turn waits for its retry instead of being passed over', async () => {
    player.play();
    await tick();
    const b = engine.jobs.get('b');
    b.chunk();
    b.reset();
    engine.jobs.get('a').finish('skipped');
    await tick();
    expect(seen).not.toContain('b');
    expect(seen).not.toContain('c');

    b.chunk(); await tick();
    expect(seen).toEqual(['b']);
    expect(live(context)).toHaveLength(1);
    expect(skipped).toEqual(['a']);
  });
});

