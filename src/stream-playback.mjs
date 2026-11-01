/**
 * Play one sentence's audio as it is generated: Phonon's 80 ms frames, each
 * scheduled to start the moment the one before it ends.
 *
 * Gapless scheduling is the Web Audio clock's job, not a timer's: every chunk is
 * a buffer source started at an exact `context.currentTime`, so the joins are
 * sample-accurate however late the main thread runs. The cost is that a chunk's
 * start is fixed when it is scheduled, so a rate change has to re-time what is
 * already queued -- see `setRate`.
 */

// How far ahead of now the first chunk (and any chunk after an underrun) starts.
// Long enough that the start is never already in the past by the time the audio
// thread sees it, short enough not to be heard as latency.
export const LEAD_SECONDS = 0.05;

export function createStreamPlayback({ context, rate = 1, onEnded = () => {} }) {
  const queued = [];   // { buffer, node, start, end }, in play order
  let tail = 0;        // context time at which the next chunk starts
  let finished = false;
  let stopped = false;
  let reported = false;

  function maybeEnded() {
    if (reported || stopped || !finished) return;
    if (queued.some((entry) => !entry.ended)) return;
    reported = true;
    onEnded();
  }

  function schedule(entry, at) {
    const node = context.createBufferSource();
    node.buffer = entry.buffer;
    node.playbackRate.value = rate;
    node.connect(context.destination);
    node.onended = () => {
      if (entry.node !== node) return;   // replaced by setRate; its old node does not count
      entry.ended = true;
      maybeEnded();
    };
    node.start(at);
    entry.node = node;
    entry.start = at;
    entry.end = at + entry.buffer.duration / rate;
    tail = entry.end;
  }

  // Straight after the chunk before when that is still ahead; after a gap (the
  // model fell behind), a moment from now.
  const nextStart = (now) => (tail > now ? tail : now + LEAD_SECONDS);

  function retire(entry) {
    entry.node.onended = null;
    try { entry.node.stop(); } catch { /* not started, or already stopped */ }
    entry.node.disconnect();
  }

  return {
    push(samples, sampleRate) {
      if (stopped || samples.length === 0) return;
      const buffer = context.createBuffer(1, samples.length, sampleRate);
      buffer.getChannelData(0).set(samples);
      const entry = { buffer, node: null, start: 0, end: 0, ended: false };
      queued.push(entry);
      schedule(entry, nextStart(context.currentTime));
    },

    /** No more chunks are coming: report the end once the queued ones have played. */
    finish() {
      finished = true;
      maybeEnded();
    },

    /**
     * Change speed mid-sentence. The chunk playing keeps playing, sped up, and
     * its end moves; every chunk not yet started is cancelled and rescheduled
     * from that new end. A rescheduled node replaces its old one rather than
     * having its start moved, because a scheduled start cannot be moved.
     */
    setRate(value) {
      const now = context.currentTime;
      const old = rate;
      rate = value;
      tail = 0;
      for (const entry of queued) {
        if (entry.ended || entry.end <= now) continue;
        if (entry.start <= now) {
          entry.node.playbackRate.value = value;
          entry.end = now + ((entry.end - now) * old) / value;
          tail = entry.end;
        } else {
          retire(entry);
          schedule(entry, nextStart(now));
        }
      }
    },

    /** Silence it now. Nothing more plays and no end is reported. */
    stop() {
      stopped = true;
      for (const entry of queued) retire(entry);
      queued.length = 0;
    },
  };
}
