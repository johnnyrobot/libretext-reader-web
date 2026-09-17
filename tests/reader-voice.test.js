import { describe, it, expect, vi } from 'vitest';
import { changeVoice, changeLanguage, recoverToEnglish } from '../src/reader.mjs';

/* Changing voice must invalidate cached audio IMMEDIATELY, not after the engine
 * round-trip.
 *
 * The first fix cleared the cache after `await engine.setVoice(voice)`, which
 * reads as the careful order and is wrong: the synthesis worker is single
 * threaded and handles messages in order, so setVoice queues BEHIND whatever
 * sentence it is already rendering. Measured on the live page, `voiceSet` came
 * back many seconds later.
 *
 * In that window the pre-switch synthesis completes and is written into the
 * cache -- legitimately, because the epoch has not been bumped yet -- the reader
 * presses play, and hears the voice they just changed away from. The flush was
 * right; its position was not. */
function fakes({ setVoiceResolves = false } = {}) {
  const calls = [];
  let releaseSetVoice;
  const engine = {
    setVoice: vi.fn(() => {
      calls.push('setVoice:posted');
      return setVoiceResolves
        ? Promise.resolve().then(() => calls.push('setVoice:resolved'))
        : new Promise((r) => { releaseSetVoice = () => { calls.push('setVoice:resolved'); r(); }; });
    }),
  };
  const player = {
    pause: vi.fn(() => calls.push('pause')),
    flushAudio: vi.fn(() => calls.push('flushAudio')),
  };
  return { engine, player, calls, release: () => releaseSetVoice?.() };
}

describe('changeVoice', () => {
  it('flushes cached audio before waiting on the engine', async () => {
    const { engine, player, calls, release } = fakes();
    const pending = changeVoice(player, engine, 'F1');
    // Not awaited yet: everything that must happen synchronously has happened.
    expect(calls).toEqual(['pause', 'flushAudio', 'setVoice:posted']);
    release();
    await pending;
  });

  it('still posts setVoice before any new synthesis could be requested', async () => {
    // Ordering matters at the worker too: it applies messages in order, so
    // setVoice must be posted before the player asks for the next sentence.
    const { engine, player, calls } = fakes({ setVoiceResolves: true });
    await changeVoice(player, engine, 'F1');
    expect(calls.indexOf('setVoice:posted')).toBeGreaterThan(calls.indexOf('flushAudio'));
    expect(engine.setVoice).toHaveBeenCalledWith('F1');
  });

  it('pauses first, so nothing is mid-sentence while the cache is dropped', async () => {
    const { engine, player, calls, release } = fakes();
    const pending = changeVoice(player, engine, 'F1');
    expect(calls[0]).toBe('pause');
    release();
    await pending;
  });
});

describe('changeLanguage', () => {
  it('changeLanguage flushes and swaps text before awaiting the engine', async () => {
    const order = [];
    const speechById = { b0s0: 'Uno.' };
    const player = {
      pause: vi.fn(() => order.push('pause')),
      flushAudio: vi.fn(() => order.push('flush')),
      setSpeechText: vi.fn(() => order.push('setSpeechText')),
    };
    const engine = {
      setLang: vi.fn(() => { order.push('setLang'); return new Promise(() => {}); }),
    };

    changeLanguage(player, engine, 'es', speechById);

    // Everything synchronous has already happened, even though setLang never settles.
    expect(order).toEqual(['pause', 'flush', 'setSpeechText', 'setLang']);
    // Order alone would still pass if the arguments got swapped between the two
    // calls; pin those too, the same way changeVoice's tests pin engine.setVoice.
    expect(player.setSpeechText).toHaveBeenCalledWith(speechById);
    expect(engine.setLang).toHaveBeenCalledWith('es');
  });

  it('changeLanguage back to English passes an empty track', async () => {
    const seen = [];
    const player = {
      pause() {}, flushAudio() {},
      setSpeechText: (map) => seen.push(map),
    };
    const engine = { setLang: vi.fn(() => Promise.resolve()) };

    await changeLanguage(player, engine, 'en', {});
    expect(seen).toEqual([{}]);
    expect(engine.setLang).toHaveBeenCalledWith('en');
  });
});

describe('recoverToEnglish', () => {
  // The recovery itself can fail -- e.g. exitReaderMode() terminated the engine
  // mid-switch, so the recovery's own setLang('en') posts to a dead worker and
  // never settles. R36: that second failure must not swallow the first, and the
  // reader must not end up with NOTHING reported at all.
  it('reports the original error even when the recovery itself fails', async () => {
    const player = { pause() {}, flushAudio() {}, setSpeechText() {} };
    const engine = { setLang: vi.fn(() => Promise.reject(new Error('recovery failed'))) };
    const controls = { setLang: vi.fn() };
    const reportError = vi.fn();

    await recoverToEnglish(player, engine, controls, new Error('original failure'), reportError);

    // The menu is corrected regardless of whether the recovery's own setLang
    // call ever completes.
    expect(controls.setLang).toHaveBeenCalledWith('en');
    expect(engine.setLang).toHaveBeenCalledWith('en');
    // The ORIGINAL error is what gets reported -- not the recovery's -- and
    // exactly once.
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledWith('original failure');
  });

  it('reports the original error when the recovery succeeds too', async () => {
    const player = { pause() {}, flushAudio() {}, setSpeechText() {} };
    const engine = { setLang: vi.fn(() => Promise.resolve()) };
    const controls = { setLang: vi.fn() };
    const reportError = vi.fn();

    await recoverToEnglish(player, engine, controls, new Error('original failure'), reportError);

    expect(controls.setLang).toHaveBeenCalledWith('en');
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledWith('original failure');
  });
});
