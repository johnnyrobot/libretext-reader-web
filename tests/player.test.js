import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPlayer } from '../src/player.mjs';

function fakeAudioContext() {
  const started = [];
  return {
    started,
    currentTime: 0,
    state: 'running',
    resume: vi.fn(async () => {}),
    createBuffer: (channels, length, rate) => ({
      length, sampleRate: rate, duration: length / rate,
      getChannelData: () => new Float32Array(length),
    }),
    createBufferSource() {
      const node = {
        buffer: null,
        playbackRate: { value: 1 },
        connect: () => {},
        onended: null,
        start() { started.push(node); queueMicrotask(() => node.onended?.()); },
        stop() {},
        disconnect: () => {},
      };
      return node;
    },
    destination: {},
  };
}

function fakeEngine(order = []) {
  return {
    synthesize: vi.fn(async (id) => {
      order.push(id);
      return { id, samples: new Float32Array(4410), sampleRate: 44100 };
    }),
    cancel: vi.fn(),
  };
}

const SENTENCES = [
  { id: 'b0s0', speech: 'One.' },
  { id: 'b0s1', speech: 'Two.' },
  { id: 'b1s0', speech: 'Three.' },
  { id: 'b1s1', speech: 'Four.' },
  { id: 'b2s0', speech: 'Five.' },
];

let audioContext;
let synthOrder;
let engine;

beforeEach(() => {
  audioContext = fakeAudioContext();
  synthOrder = [];
  engine = fakeEngine(synthOrder);
});

describe('player.mjs', () => {
  it('buffers 2 sentences before the first one plays', async () => {
    const player = createPlayer({ engine, sentences: SENTENCES, audioContext });
    await player.play();
    expect(synthOrder.slice(0, 2)).toEqual(['b0s0', 'b0s1']);
    player.dispose();
  });

  it('advances through sentences in order and reports each one', async () => {
    const seen = [];
    const player = createPlayer({
      engine, sentences: SENTENCES, audioContext,
      onSentenceChange: (id) => seen.push(id),
    });
    await player.play();
    await new Promise((r) => setTimeout(r, 20));
    expect(seen.slice(0, 3)).toEqual(['b0s0', 'b0s1', 'b1s0']);
    player.dispose();
  });

  it('never has more than 4 sentences of lookahead outstanding', async () => {
    const player = createPlayer({ engine, sentences: SENTENCES, audioContext });
    await player.play();
    expect(engine.synthesize.mock.calls.length).toBeLessThanOrEqual(2 + 4);
    player.dispose();
  });

  it('seekTo cancels pending work and restarts from the requested sentence', async () => {
    const player = createPlayer({ engine, sentences: SENTENCES, audioContext });
    await player.play();
    await player.seekTo('b2s0');
    expect(player.currentId()).toBe('b2s0');
    expect(engine.cancel).toHaveBeenCalled();
    player.dispose();
  });

  it('pause stops playback and leaves the position where it was', async () => {
    const player = createPlayer({ engine, sentences: SENTENCES, audioContext });
    await player.play();
    const at = player.currentId();
    player.pause();
    expect(player.currentId()).toBe(at);
    player.dispose();
  });

  it('setRate applies to the playing source without re-synthesising', async () => {
    const player = createPlayer({ engine, sentences: SENTENCES, audioContext });
    await player.play();
    const before = engine.synthesize.mock.calls.length;
    player.setRate(1.25);
    expect(engine.synthesize.mock.calls.length).toBe(before);
    expect(audioContext.started.at(-1).playbackRate.value).toBe(1.25);
    player.dispose();
  });

  it('reports a buffering state instead of stuttering when audio is not ready', async () => {
    // INITIAL_BUFFER is 2, so play() issues two synthesis requests before it
    // awaits either. Holding only the most recent resolver would release the
    // wrong promise and leave the one playback is waiting on pending forever.
    const holds = [];
    const release = () => { for (const resolve of holds.splice(0)) resolve(); };
    const slow = {
      synthesize: vi.fn((id) => new Promise((resolve) => {
        holds.push(() => resolve({ id, samples: new Float32Array(4410), sampleRate: 44100 }));
      })),
      cancel: vi.fn(),
    };
    const states = [];
    const player = createPlayer({
      engine: slow, sentences: SENTENCES, audioContext,
      onStateChange: (s) => states.push(s),
    });
    const playing = player.play();
    await new Promise((r) => setTimeout(r, 0));
    expect(states.some((s) => s.buffering)).toBe(true);
    release();
    await playing;
    player.dispose();
  });

  it('stops cleanly at the end of the page', async () => {
    const seen = [];
    const player = createPlayer({
      engine, sentences: SENTENCES.slice(0, 2), audioContext,
      onSentenceChange: (id) => seen.push(id),
    });
    await player.play();
    await new Promise((r) => setTimeout(r, 30));
    expect(seen.at(-1)).toBeNull();
    player.dispose();
  });
});

describe('player.mjs — changing voice mid-page', () => {
  // BUG: pause, select Female, resume -- and the male voice keeps reading.
  //
  // engine.setVoice() does its job: the worker loads the new style. The stale
  // audio is the player's. `request()` skips any sentence already in `buffers`,
  // and the lookahead has synthesised 4-8 sentences AHEAD in the old voice, with
  // up to RETAIN=24 behind it. Nothing invalidated them, so playback continued
  // from cached male audio.
  it('re-synthesises sentences it had already cached', async () => {
    const player = createPlayer({ engine, sentences: SENTENCES, audioContext });
    await player.play();
    await player.pause();

    const before = [...synthOrder];
    expect(before.length).toBeGreaterThan(0);

    player.flushAudio();
    await player.seekTo(SENTENCES[0].id);
    await player.play();

    const after = synthOrder.slice(before.length);
    // The point is not that MORE was synthesised -- it is that something already
    // in the cache was synthesised AGAIN. Without the flush these are all skipped.
    const resynthesised = after.filter((id) => before.includes(id));
    expect(resynthesised.length).toBeGreaterThan(0);
  });

  it('does not re-synthesise on an ordinary pause', () => {
    // The guard on the guard. Sharing the playback-sequencing counter would make
    // every pause throw the page away and re-render it, which is the opposite
    // failure and far more expensive.
    const player = createPlayer({ engine, sentences: SENTENCES, audioContext });
    return player.play().then(async () => {
      const before = synthOrder.length;
      await player.pause();
      await player.play();
      const reAsked = synthOrder.slice(before).filter((id) => synthOrder.slice(0, before).includes(id));
      expect(reAsked).toEqual([]);
    });
  });

  it('discards a synthesis that was already in flight when the voice changed', async () => {
    // THE RACE A PLAIN buffers.clear() LOSES. A synth started before the switch
    // resolves after it and writes old-voice audio straight back into the cache
    // the flush just emptied -- so the sentence the reader hears next is in the
    // very voice they changed away from.
    let release;
    const slow = new Promise((resolve) => { release = resolve; });
    const calls = [];
    const slowEngine = {
      synthesize: vi.fn(async (id) => {
        calls.push(id);
        if (id === 'b0s0' && calls.filter((c) => c === 'b0s0').length === 1) await slow;
        return { id, samples: new Float32Array(4410), sampleRate: 44100 };
      }),
      cancel: vi.fn(),
    };
    const player = createPlayer({ engine: slowEngine, sentences: SENTENCES, audioContext });

    player.play();                       // starts the slow synthesis of b0s0
    await Promise.resolve();
    player.flushAudio();                 // the voice changes mid-flight

    // The player fix (final-review): flushAudio must CANCEL b0s0's still-
    // in-flight synthesis, not merely untrack it -- mirroring what seekTo
    // already does. Without this, a queued synthesis stays ahead of whatever
    // request comes next in the single-threaded worker, so on a language
    // switch the new language's first sentence arrives seconds late behind
    // up to 8 stale lookahead requests.
    expect(slowEngine.cancel).toHaveBeenCalledWith('b0s0');

    release();
    await slow;
    await new Promise((r) => setTimeout(r, 0));

    // The stale result must NOT be in the cache, so asking for it synthesises again.
    await player.seekTo('b0s0');
    await player.play();
    expect(calls.filter((c) => c === 'b0s0').length).toBeGreaterThan(1);
    player.pause();
  });

  it('setSpeechText changes what is synthesised without moving the cursor', async () => {
    const synthesised = [];
    const engine = {
      synthesize: (id, text) => {
        synthesised.push([id, text]);
        return Promise.resolve({ id, samples: new Float32Array(8), sampleRate: 44100 });
      },
      cancel: () => {},
    };
    const sentences = [
      { id: 'b0s0', speech: 'One.' },
      { id: 'b0s1', speech: 'Two.' },
    ];
    const player = createPlayer({ engine, sentences, audioContext: fakeAudioContext() });

    await player.seekTo('b0s1');
    player.setSpeechText({ b0s0: 'Uno.', b0s1: 'Dos.' });

    expect(player.currentId()).toBe('b0s1');

    synthesised.length = 0;
    await player.play();
    expect(synthesised.some(([, text]) => text === 'Dos.')).toBe(true);
    expect(synthesised.some(([, text]) => text === 'Two.')).toBe(false);
    player.dispose();
  });

  it('setSpeechText falls back to English for an id the track omits', async () => {
    const synthesised = [];
    const engine = {
      synthesize: (id, text) => {
        synthesised.push(text);
        return Promise.resolve({ id, samples: new Float32Array(8), sampleRate: 44100 });
      },
      cancel: () => {},
    };
    const sentences = [
      { id: 'b0s0', speech: 'One.' },
      { id: 'b0s1', speech: 'Two.' },
    ];
    const player = createPlayer({ engine, sentences, audioContext: fakeAudioContext() });

    // b0s1 is absent: the QA gate dropped it, so the reader should hear the English.
    player.setSpeechText({ b0s0: 'Uno.' });
    await player.play();

    expect(synthesised).toContain('Uno.');
    expect(synthesised).toContain('Two.');
    player.dispose();
  });

  it('setSpeechText discards audio rendered in the previous language', async () => {
    const engine = {
      synthesize: (id) => Promise.resolve({ id, samples: new Float32Array(8), sampleRate: 44100 }),
      cancel: () => {},
    };
    const sentences = [{ id: 'b0s0', speech: 'One.' }];
    const player = createPlayer({ engine, sentences, audioContext: fakeAudioContext() });

    await player.play();
    player.pause();
    player.setSpeechText({ b0s0: 'Uno.' });

    const engineCalls = [];
    engine.synthesize = (id, text) => {
      engineCalls.push(text);
      return Promise.resolve({ id, samples: new Float32Array(8), sampleRate: 44100 });
    };
    await player.play();
    expect(engineCalls).toContain('Uno.');
    player.dispose();
  });
});

describe('player.mjs — updateSpeechText, the streaming seam', () => {
  // ------------------------------------------------------------------
  // updateSpeechText: the one function streaming cannot work without.
  //
  // setSpeechText flushes EVERYTHING. Called once per translated sentence on a
  // 9,430-sentence book that is 9,430 flushes and nothing ever plays. These
  // tests are about what must SURVIVE an update, which is the half a naive
  // implementation gets wrong.
  // ------------------------------------------------------------------

  /** A player with a recording engine, played and paused so `buffers` is warm. */
  function warmPlayer(sentences) {
    const synthesised = [];
    const engine = {
      synthesize: (id, text) => {
        synthesised.push([id, text]);
        return Promise.resolve({ id, samples: new Float32Array(8), sampleRate: 44100 });
      },
      cancel: vi.fn(),
    };
    const player = createPlayer({ engine, sentences, audioContext: fakeAudioContext() });
    return { player, engine, synthesised };
  }

  const FIVE = () => [
    { id: 'b0s0', speech: 'One.' },
    { id: 'b0s1', speech: 'Two.' },
    { id: 'b1s0', speech: 'Three.' },
    { id: 'b1s1', speech: 'Four.' },
    { id: 'b2s0', speech: 'Five.' },
  ];

  it('updateSpeechText leaves the buffers it did not update alone', async () => {
    // THE POINT OF THE WHOLE FUNCTION. If this fails, streaming discards the
    // lookahead on every translated sentence and playback never gets ahead.
    const sentences = FIVE();
    const { player, synthesised } = warmPlayer(sentences);

    await player.play();
    await player.pause();
    const rendered = synthesised.map(([id]) => id);
    expect(rendered).toContain('b1s1');

    player.updateSpeechText({ b1s0: 'Tres.' });

    synthesised.length = 0;
    await player.play();
    const again = synthesised.map(([id]) => id);

    expect(again).toContain('b1s0');        // the one that changed, re-rendered
    expect(again).not.toContain('b1s1');    // everything else, untouched
    expect(again).not.toContain('b0s1');
    player.dispose();
  });

  it('updateSpeechText keeps audio for a sentence whose text did not change', async () => {
    // Streaming re-sends overlapping windows. Re-rendering an identical sentence
    // is indistinguishable from the bug this function exists to avoid.
    const sentences = FIVE();
    const { player, synthesised } = warmPlayer(sentences);

    await player.play();
    await player.pause();
    player.updateSpeechText({ b1s0: 'Tres.' });
    synthesised.length = 0;
    await player.play();
    await player.pause();

    player.updateSpeechText({ b1s0: 'Tres.' });   // same text, second time
    synthesised.length = 0;
    await player.play();

    expect(synthesised.map(([id]) => id)).not.toContain('b1s0');
    player.dispose();
  });

  it('updateSpeechText does not cut the sentence being spoken out from under the listener', async () => {
    // Swapping mid-utterance is the "sounds like neither" hazard changeLanguage
    // documents. The sentence finishes in whatever language it started in.
    const sentences = FIVE();
    const synthesised = [];
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    const engine = {
      synthesize: (id, text) => {
        synthesised.push([id, text]);
        // Hold b0s1 so playback stays parked on b0s0 with `playing` true.
        return id === 'b0s1'
          ? held.then(() => ({ id, samples: new Float32Array(8), sampleRate: 44100 }))
          : Promise.resolve({ id, samples: new Float32Array(8), sampleRate: 44100 });
      },
      cancel: vi.fn(),
    };
    const player = createPlayer({ engine, sentences, audioContext: fakeAudioContext() });

    player.play();
    await new Promise((r) => setTimeout(r, 0));

    const current = player.currentId();
    player.updateSpeechText({ [current]: 'CAMBIADO' });

    expect(engine.cancel).not.toHaveBeenCalledWith(current);
    release();
    player.dispose();
  });

  it('updateSpeechText refreshes the cursor sentence when nothing is playing', async () => {
    // The mirror image of the test above: paused at a sentence the reader has
    // not heard yet, the new text is what they should get when they press play.
    const sentences = FIVE();
    const { player, synthesised } = warmPlayer(sentences);

    await player.seekTo('b1s0');
    await player.play();
    await player.pause();
    await player.seekTo('b1s0');

    player.updateSpeechText({ b1s0: 'Tres.' });

    synthesised.length = 0;
    await player.play();
    expect(synthesised.some(([id, text]) => id === 'b1s0' && text === 'Tres.')).toBe(true);
    player.dispose();
  });

  it('updateSpeechText updates text behind the cursor without re-rendering it', async () => {
    // Rule 2, and its cost stated plainly: the audio behind the cursor is stale
    // until it is trimmed, so seeking back plays the older text. That is the
    // same one-sentence-in-the-wrong-language outcome the sparse-track contract
    // already tolerates, and cheaper than re-rendering the past on every update.
    const sentences = FIVE();
    const { player, engine, synthesised } = warmPlayer(sentences);

    await player.play();
    await player.pause();
    await player.seekTo('b2s0');

    player.updateSpeechText({ b0s0: 'Uno.' });

    expect(sentences[0].speech).toBe('Uno.');        // text updated
    expect(engine.cancel).not.toHaveBeenCalledWith('b0s0');

    synthesised.length = 0;
    await player.seekTo('b0s0');
    await player.play();
    expect(synthesised.map(([id]) => id)).not.toContain('b0s0');  // audio kept
    player.dispose();
  });

  it('updateSpeechText cancels an in-flight synthesis for an id it changed', async () => {
    // Untracking is not enough: an untracked synthesis stays QUEUED in the
    // single-threaded worker ahead of the re-request, so the new text arrives
    // behind the old one it replaced.
    const sentences = FIVE();
    const engine = {
      synthesize: (id) => new Promise((resolve) => setTimeout(
        () => resolve({ id, samples: new Float32Array(8), sampleRate: 44100 }), 50)),
      cancel: vi.fn(),
    };
    const player = createPlayer({ engine, sentences, audioContext: fakeAudioContext() });

    player.play();                       // b0s0 and b0s1 go in flight
    await Promise.resolve();
    player.updateSpeechText({ b0s1: 'Dos.' });

    expect(engine.cancel).toHaveBeenCalledWith('b0s1');
    expect(engine.cancel).not.toHaveBeenCalledWith('b0s0');   // the one being played
    player.dispose();
  });

  it('updateSpeechText ignores ids this page does not have', async () => {
    // A translated track can name a sentence the DOM no longer carries: blocks
    // that changed since the page was built are dropped at mount, on purpose.
    const sentences = FIVE();
    const { player } = warmPlayer(sentences);

    expect(() => player.updateSpeechText({ nope: 'Nada.', b0s0: 'Uno.' })).not.toThrow();
    expect(sentences[0].speech).toBe('Uno.');
    player.dispose();
  });

  it('updateSpeechText falls back to English for an id it is given no text for', async () => {
    const sentences = FIVE();
    const { player } = warmPlayer(sentences);

    player.updateSpeechText({ b0s0: 'Uno.' });
    expect(sentences[0].speech).toBe('Uno.');

    player.updateSpeechText({ b0s0: undefined });
    expect(sentences[0].speech).toBe('One.');
    player.dispose();
  });
});
