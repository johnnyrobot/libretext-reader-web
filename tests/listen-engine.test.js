import { describe, it, expect, vi } from 'vitest';
import { createListenEngine } from '../src/listen-engine.mjs';

// An engine that records what it was asked and settles when told to.
function fakeEngine(name, log) {
  let release;
  return {
    name,
    init: vi.fn((options) => {
      log.push(`${name}:init:${options.lang}:${options.voice}`);
      return new Promise((resolve, reject) => { release = { resolve, reject }; });
    }),
    ready: () => release.resolve({ provider: 'wasm' }),
    fail: (error) => release.reject(error),
    synthesize: vi.fn((id) => { log.push(`${name}:synth:${id}`); return Promise.resolve({ id }); }),
    cancel: vi.fn((id) => log.push(`${name}:cancel:${id}`)),
    setVoice: vi.fn((voice) => { log.push(`${name}:voice:${voice}`); return Promise.resolve(); }),
    setLang: vi.fn((lang) => { log.push(`${name}:lang:${lang}`); return Promise.resolve(); }),
    terminate: vi.fn(() => log.push(`${name}:terminate`)),
  };
}

function setup() {
  const log = [];
  const english = fakeEngine('phonon', log);
  const others = [];
  const createOther = vi.fn(() => { const e = fakeEngine('supertonic', log); others.push(e); return e; });
  const engine = createListenEngine({ english, createOther });
  return { log, english, others, createOther, engine };
}

async function started() {
  const s = setup();
  const ready = s.engine.init({ voice: 'M1', onProgress: () => {} });
  s.english.ready();
  await ready;
  return s;
}

describe('createListenEngine (LT-214)', () => {
  it('starts English on Phonon and creates nothing else', async () => {
    const { engine, english, createOther, log } = setup();
    const ready = engine.init({ voice: 'F1', onProgress: () => {} });
    english.ready();
    await expect(ready).resolves.toEqual({ provider: 'wasm' });
    expect(log).toEqual(['phonon:init:en:F1']);
    // An English-only reader never downloads Supertonic.
    expect(createOther).not.toHaveBeenCalled();
  });

  it('speaks English through Phonon', async () => {
    const { engine, log } = await started();
    await engine.synthesize('s1', 'Hello.', {});
    expect(log).toContain('phonon:synth:s1');
  });

  it('prepare() creates and loads Supertonic once, with the current voice', async () => {
    const { engine, createOther, others, log } = await started();
    await engine.setVoice('F1');
    const onProgress = () => {};
    const first = engine.prepare('es', { onProgress });
    const second = engine.prepare('es', { onProgress });
    others[0].ready();
    await Promise.all([first, second]);
    expect(createOther).toHaveBeenCalledTimes(1);
    expect(others[0].init).toHaveBeenCalledWith({ voice: 'F1', lang: 'es', onProgress });
    expect(log.filter((line) => line.startsWith('supertonic:init'))).toHaveLength(1);
  });

  it('a voice chosen while Supertonic loads is applied once it has', async () => {
    const { engine, others, log } = await started();
    const prepared = engine.prepare('es', {});
    await engine.setVoice('F1');
    others[0].ready();
    await prepared;
    expect(log).toContain('supertonic:voice:F1');
  });

  it('says whether the translation voice is loaded, so the reader shows a wait only when there is one', async () => {
    const { engine, others } = await started();
    expect(engine.prepared()).toBe(false);
    const loading = engine.prepare('es', {});
    expect(engine.prepared()).toBe(false);
    others[0].ready();
    await loading;
    expect(engine.prepared()).toBe(true);
  });

  it('a failed prepare is torn down and may be tried again', async () => {
    const { engine, createOther, others } = await started();
    const failed = engine.prepare('es', {});
    others[0].fail(new Error('quota'));
    await expect(failed).rejects.toThrow('quota');
    expect(others[0].terminate).toHaveBeenCalled();

    const retry = engine.prepare('es', {});
    others[1].ready();
    await retry;
    expect(createOther).toHaveBeenCalledTimes(2);
  });

  it('setLang to a translation routes synthesis to Supertonic from the same tick', async () => {
    const { engine, others, log } = await started();
    const prepared = engine.prepare('es', {});
    others[0].ready();
    await prepared;

    const switched = engine.setLang('es');
    // The player requests the next sentence straight after changeLanguage
    // returns; it must not reach Phonon under a Spanish text.
    engine.synthesize('s2', 'Hola.', {});
    await switched;
    expect(log).toContain('supertonic:lang:es');
    expect(log).toContain('supertonic:synth:s2');
    expect(log).not.toContain('phonon:synth:s2');
  });

  it('setLang back to English returns to Phonon', async () => {
    const { engine, others, log } = await started();
    const prepared = engine.prepare('es', {});
    others[0].ready();
    await prepared;
    await engine.setLang('es');
    await engine.setLang('en');
    engine.synthesize('s3', 'Hello.', {});
    expect(log).toContain('phonon:synth:s3');
  });

  it('refuses a translation that was never prepared, and English keeps playing', async () => {
    const { engine, log } = await started();
    await expect(engine.setLang('es')).rejects.toThrow(/not loaded/i);
    engine.synthesize('s4', 'Hello.', {});
    expect(log).toContain('phonon:synth:s4');
  });

  it('cancel reaches both engines, since a sentence may be in either', async () => {
    const { engine, others, log } = await started();
    const prepared = engine.prepare('es', {});
    others[0].ready();
    await prepared;
    engine.cancel('s5');
    expect(log).toContain('phonon:cancel:s5');
    expect(log).toContain('supertonic:cancel:s5');
  });

  it('setVoice reaches every loaded engine', async () => {
    const { engine, others, log } = await started();
    const prepared = engine.prepare('es', {});
    others[0].ready();
    await prepared;
    await engine.setVoice('F1');
    expect(log).toContain('phonon:voice:F1');
    expect(log).toContain('supertonic:voice:F1');
  });

  it('terminate stops both, including a Supertonic still loading', async () => {
    const { engine, english, others } = await started();
    engine.prepare('es', {}).catch(() => {});
    engine.terminate();
    expect(english.terminate).toHaveBeenCalled();
    expect(others[0].terminate).toHaveBeenCalled();
  });
});
