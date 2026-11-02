import { describe, it, expect, vi } from 'vitest';
import { createTranslator, hostedPairs, MT_ROOT } from '../src/translator.mjs';

class FakeWorker {
  constructor({ failInit = false } = {}) {
    this.sent = [];
    this.onmessage = null;
    this.terminated = false;
    this.failInit = failInit;
  }

  postMessage(message) {
    this.sent.push(message);
    queueMicrotask(() => {
      if (message.type === 'init') {
        return this.reply(this.failInit
          ? { type: 'error', initId: message.initId, message: 'model unavailable (404)' }
          : { type: 'ready', initId: message.initId });
      }
      if (message.type === 'translate') {
        this.reply({ type: 'translated', id: message.id, lines: message.lines.map((l) => `ES: ${l}`) });
      }
    });
  }

  reply(data) { this.onmessage?.({ data }); }
  terminate() { this.terminated = true; }
}

function withFakeWorker(options) {
  const worker = new FakeWorker(options);
  return { worker, translator: createTranslator({ createWorker: () => worker }) };
}

describe('hostedPairs', () => {
  it('reads the pairs this deployment hosts', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      version: 1, pairs: [{ code: 'es', pair: 'en-es', bytes: 121097315 }],
    })));

    await expect(hostedPairs()).resolves.toEqual([{ code: 'es', pair: 'en-es', bytes: 121097315 }]);
    expect(fetch).toHaveBeenCalledWith(`${MT_ROOT}pairs.json`);
  });

  it('offers nothing rather than throwing when no models are hosted', async () => {
    // A deployment without translation models is a legitimate state, not a
    // failure: the reader still gets English speech. Throwing here would take
    // the whole reader down over an absent optional feature.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
    await expect(hostedPairs()).resolves.toEqual([]);

    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network'); }));
    await expect(hostedPairs()).resolves.toEqual([]);
  });

  it('refuses a pairs.json whose shape is wrong', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ pairs: 'es' })));
    await expect(hostedPairs()).resolves.toEqual([]);
  });
});

describe('translator.mjs', () => {
  it('points init at the pair\'s own manifest', async () => {
    const { worker, translator } = withFakeWorker();
    await translator.init({ pair: 'en-es' });

    expect(worker.sent[0]).toEqual({
      type: 'init', pair: 'en-es', manifestUrl: '/_assets/tts/mt/en-es/manifest.json', initId: 1,
    });
  });

  it('loads a pair once, however many times the reader switches back to it', async () => {
    // es -> en -> es must not rebuild a 115 MB session. The reader should not
    // have to remember which pair the worker holds to get that.
    const { worker, translator } = withFakeWorker();
    await translator.init({ pair: 'en-es' });
    await translator.init({ pair: 'en-es' });

    expect(worker.sent.filter((m) => m.type === 'init')).toHaveLength(1);
  });

  it('retries after a failed load instead of remembering the rejection', async () => {
    // A remembered failure is worse than the failure: every later attempt
    // returns the same stale rejection without ever touching the worker again.
    const { worker, translator } = withFakeWorker({ failInit: true });

    await expect(translator.init({ pair: 'en-es' })).rejects.toThrow(/model unavailable/);
    worker.failInit = false;
    await expect(translator.init({ pair: 'en-es' })).resolves.toBeUndefined();

    expect(worker.sent.filter((m) => m.type === 'init')).toHaveLength(2);
  });

  it('a newer pair replaces a load still in flight: the old one is cancelled (LT-217)', async () => {
    const worker = { sent: [], onmessage: null, postMessage(m) { this.sent.push(m); }, terminate() {} };
    const translator = createTranslator({ createWorker: () => worker });
    const french = translator.init({ pair: 'en-fr' });
    const german = translator.init({ pair: 'en-de' });
    worker.onmessage({ data: { type: 'ready', initId: worker.sent[1].initId } });

    await expect(german).resolves.toBeUndefined();
    await expect(french).rejects.toThrow(/cancelled/);
    // And French is not remembered as loaded: picking it again loads it again.
    translator.init({ pair: 'en-fr' });
    expect(worker.sent.filter((m) => m.type === 'init').map((m) => m.pair)).toEqual(['en-fr', 'en-de', 'en-fr']);
  });

  it('ignores a reply still in transit from the load it replaced', async () => {
    const worker = { sent: [], onmessage: null, postMessage(m) { this.sent.push(m); }, terminate() {} };
    const translator = createTranslator({ createWorker: () => worker });
    translator.init({ pair: 'en-fr' }).catch(() => {});
    const german = translator.init({ pair: 'en-de' });
    const [fr, de] = worker.sent.map((m) => m.initId);
    expect(fr).not.toBe(de);

    let settled = false;
    german.then(() => { settled = true; }, () => { settled = true; });
    worker.onmessage({ data: { type: 'ready', initId: fr } });
    worker.onmessage({ data: { type: 'error', initId: fr, message: 'French failed' } });
    await Promise.resolve();
    expect(settled).toBe(false);

    worker.onmessage({ data: { type: 'ready', initId: de } });
    await expect(german).resolves.toBeUndefined();
  });

  it('shows only the current load\'s download progress; a batch\'s goes to that batch', () => {
    // A stopped Portuguese queue's batch still running in the worker must not
    // move the bar of the French download that replaced it.
    const worker = { sent: [], onmessage: null, postMessage(m) { this.sent.push(m); }, terminate() {} };
    const translator = createTranslator({ createWorker: () => worker });
    translator.init({ pair: 'en-fr' }).catch(() => {});
    const download = [];
    const batch = [];
    translator.init({ pair: 'en-de', onProgress: (p) => download.push(p.loaded) });
    translator.translate(['one.'], (p) => batch.push(p.loaded)).catch(() => {});
    translator.translate(['two.']).catch(() => {});
    const [fr, de] = worker.sent.filter((m) => m.type === 'init').map((m) => m.initId);
    const [withBar, without] = worker.sent.filter((m) => m.type === 'translate').map((m) => m.id);
    worker.onmessage({ data: { type: 'progress', initId: fr, loaded: 1, total: 9 } });
    worker.onmessage({ data: { type: 'progress', initId: de, loaded: 2, total: 9 } });
    worker.onmessage({ data: { type: 'progress', id: withBar, loaded: 3, total: 9, phase: 'translate' } });
    worker.onmessage({ data: { type: 'progress', id: without, loaded: 4, total: 9, phase: 'translate' } });
    expect(download).toEqual([2]);
    expect(batch).toEqual([3]);
  });

  it('forwards download progress while loading', async () => {
    const { worker, translator } = withFakeWorker();
    const seen = [];
    const ready = translator.init({ pair: 'en-es', onProgress: (p) => seen.push(p) });
    const { initId } = worker.sent[0];
    worker.reply({ type: 'progress', initId, file: 'onnx/encoder_model_quantized.onnx', loaded: 5, total: 10, phase: 'download' });
    await ready;

    expect(seen).toEqual([{
      type: 'progress', initId, file: 'onnx/encoder_model_quantized.onnx', loaded: 5, total: 10, phase: 'download',
    }]);
  });

  it('correlates concurrent batches by id', async () => {
    const { translator } = withFakeWorker();
    await translator.init({ pair: 'en-es' });

    const [a, b] = await Promise.all([
      translator.translate(['one.']),
      translator.translate(['two.', 'three.']),
    ]);

    expect(a).toEqual(['ES: one.']);
    expect(b).toEqual(['ES: two.', 'ES: three.']);
  });

  it('rejects the batch that failed, by id', async () => {
    const worker = new FakeWorker();
    worker.postMessage = function (message) {
      this.sent.push(message);
      queueMicrotask(() => this.reply(message.type === 'init'
        ? { type: 'ready', initId: message.initId }
        : { type: 'error', id: message.id, message: 'translator returned 1 lines for 2 sentences' }));
    };
    const translator = createTranslator({ createWorker: () => worker });
    await translator.init({ pair: 'en-es' });

    await expect(translator.translate(['one.', 'two.'])).rejects.toThrow(/1 lines for 2 sentences/);
  });

  it('rejects everything still in flight when the worker dies', async () => {
    const worker = new FakeWorker();
    worker.postMessage = function (message) { this.sent.push(message); };  // never answers
    const translator = createTranslator({ createWorker: () => worker });

    const ready = translator.init({ pair: 'en-es' });
    const batch = translator.translate(['one.']);
    worker.onerror({ message: 'boom' });

    await expect(ready).rejects.toThrow(/boom/);
    await expect(batch).rejects.toThrow(/boom/);
  });

  it('terminating rejects pending work rather than leaving it hanging', async () => {
    const worker = new FakeWorker();
    worker.postMessage = function (message) { this.sent.push(message); };
    const translator = createTranslator({ createWorker: () => worker });

    const batch = translator.translate(['one.']);
    translator.terminate();

    expect(worker.terminated).toBe(true);
    await expect(batch).rejects.toThrow(/terminated/);
  });
});
