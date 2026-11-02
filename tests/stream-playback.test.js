import { describe, it, expect, vi } from 'vitest';
import { createStreamPlayback, LEAD_SECONDS } from '../src/stream-playback.mjs';

// A Web Audio stand-in whose clock the test moves, and whose nodes end only when
// the test says so: what is asserted is WHEN each chunk is scheduled.
function clockContext() {
  const nodes = [];
  return {
    nodes,
    currentTime: 10,
    destination: {},
    createBuffer: (channels, length, sampleRate) => ({
      length, sampleRate, duration: length / sampleRate, data: null,
      getChannelData() { return (this.data ??= new Float32Array(length)); },
    }),
    createBufferSource() {
      const node = {
        buffer: null, playbackRate: { value: 1 }, onended: null, startedAt: null, stopped: false,
        connect() {}, disconnect() {},
        start(when) { node.startedAt = when; },
        stop() { node.stopped = true; },
        end() { node.onended?.(); },
      };
      nodes.push(node);
      return node;
    },
  };
}

const FRAME = new Float32Array(1920);   // 80 ms at 24 kHz
const live = (context) => context.nodes.filter((n) => !n.stopped);

describe('createStreamPlayback', () => {
  it('plays chunks back to back, the first a moment from now', () => {
    const context = clockContext();
    const playback = createStreamPlayback({ context });
    for (let i = 0; i < 3; i++) playback.push(FRAME, 24000);
    expect(context.nodes.map((n) => n.startedAt)).toEqual([
      10 + LEAD_SECONDS, expect.closeTo(10 + LEAD_SECONDS + 0.08, 6), expect.closeTo(10 + LEAD_SECONDS + 0.16, 6),
    ]);
  });

  it('spaces chunks by their duration at the playback rate', () => {
    const context = clockContext();
    const playback = createStreamPlayback({ context, rate: 2 });
    playback.push(FRAME, 24000);
    playback.push(FRAME, 24000);
    expect(context.nodes[1].startedAt - context.nodes[0].startedAt).toBeCloseTo(0.04, 6);
    expect(context.nodes.every((n) => n.playbackRate.value === 2)).toBe(true);
  });

  it('starts a chunk that arrives late a moment from now, not in the past', () => {
    const context = clockContext();
    const playback = createStreamPlayback({ context });
    playback.push(FRAME, 24000);
    context.currentTime = 20;
    playback.push(FRAME, 24000);
    expect(context.nodes[1].startedAt).toBeCloseTo(20 + LEAD_SECONDS, 6);
  });

  it('a rate change re-times the chunk playing and reschedules the ones waiting', () => {
    const context = clockContext();
    const playback = createStreamPlayback({ context });
    for (let i = 0; i < 3; i++) playback.push(FRAME, 24000);
    const start = 10 + LEAD_SECONDS;
    context.currentTime = start + 0.04;          // halfway through the first chunk

    playback.setRate(2);

    const [first, ...rest] = context.nodes;
    expect(first.stopped).toBe(false);
    expect(first.playbackRate.value).toBe(2);
    // 0.04 s of the first chunk left at rate 1 is 0.02 s at rate 2.
    const waiting = live(context).slice(1);
    expect(rest.slice(0, 2).every((n) => n.stopped)).toBe(true);
    expect(waiting.map((n) => n.startedAt)).toEqual([
      expect.closeTo(start + 0.06, 6), expect.closeTo(start + 0.10, 6),
    ]);
    expect(waiting.every((n) => n.playbackRate.value === 2)).toBe(true);
  });

  it('reports the end only after finish(), once the last chunk has played', () => {
    const context = clockContext();
    const onEnded = vi.fn();
    const playback = createStreamPlayback({ context, onEnded });
    playback.push(FRAME, 24000);
    playback.push(FRAME, 24000);
    context.nodes.forEach((n) => n.end());
    expect(onEnded).not.toHaveBeenCalled();        // more may still be coming
    playback.finish();
    expect(onEnded).toHaveBeenCalledTimes(1);
  });

  it('reports the end when the last chunk ends after finish()', () => {
    const context = clockContext();
    const onEnded = vi.fn();
    const playback = createStreamPlayback({ context, onEnded });
    playback.push(FRAME, 24000);
    playback.push(FRAME, 24000);
    playback.finish();
    context.nodes[0].end();
    expect(onEnded).not.toHaveBeenCalled();
    context.nodes[1].end();
    expect(onEnded).toHaveBeenCalledTimes(1);
  });

  it('a rescheduled chunk does not count as ended when its old node is stopped', () => {
    const context = clockContext();
    const onEnded = vi.fn();
    const playback = createStreamPlayback({ context, onEnded });
    playback.push(FRAME, 24000);
    playback.push(FRAME, 24000);
    playback.finish();
    playback.setRate(1.5);
    context.nodes.filter((n) => n.stopped).forEach((n) => n.end());   // a stopped node still fires onended
    expect(onEnded).not.toHaveBeenCalled();
    live(context).forEach((n) => n.end());
    expect(onEnded).toHaveBeenCalledTimes(1);
  });

  it('stop() silences everything and never reports an end', () => {
    const context = clockContext();
    const onEnded = vi.fn();
    const playback = createStreamPlayback({ context, onEnded });
    playback.push(FRAME, 24000);
    playback.finish();
    playback.stop();
    context.nodes.forEach((n) => n.end());
    expect(context.nodes.every((n) => n.stopped)).toBe(true);
    expect(onEnded).not.toHaveBeenCalled();
    playback.push(FRAME, 24000);                   // a late chunk after stop
    expect(context.nodes).toHaveLength(1);
  });

  it('finish() with nothing pushed ends at once', () => {
    const onEnded = vi.fn();
    createStreamPlayback({ context: clockContext(), onEnded }).finish();
    expect(onEnded).toHaveBeenCalledTimes(1);
  });
});
