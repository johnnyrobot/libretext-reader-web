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
  return {
    jobs,
    synthesize: vi.fn((id, text, { onChunk = () => {}, onReset = () => {} } = {}) => new Promise((resolve, reject) => {
      jobs.set(id, {
        chunk: (n = 1920) => onChunk(new Float32Array(n), 24000),
        reset: onReset,
        finish: (outcome = 'ok', n = 1920) => resolve({ id, samples: new Float32Array(outcome === 'skipped' ? 0 : n), sampleRate: 24000, outcome }),
        fail: () => reject(new Error('boom')),
      });
    })),
    cancel: vi.fn(),
  };
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
    engine.jobs.get('b').chunk();
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

  it('a skipped sentence is marked, nothing of it is left playing, and the next one plays', async () => {
    player.play();
    await tick();
    const a = engine.jobs.get('a');
    a.chunk(); await tick();
    a.reset();
    a.finish('skipped');
    await tick();
    engine.jobs.get('b').chunk();
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
    engine.jobs.get('c')?.chunk();
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
    engine.jobs.get('b').chunk();
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
});
