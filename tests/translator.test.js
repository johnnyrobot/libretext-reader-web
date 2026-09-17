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
          ? { type: 'error', message: 'model unavailable (404)' }
          : { type: 'ready' });
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
      type: 'init', pair: 'en-es', manifestUrl: '/_assets/tts/mt/en-es/manifest.json',
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

  it('forwards download progress while loading', async () => {
    const { worker, translator } = withFakeWorker();
    const seen = [];
    const ready = translator.init({ pair: 'en-es', onProgress: (p) => seen.push(p) });
    worker.reply({ type: 'progress', file: 'onnx/encoder_model_quantized.onnx', loaded: 5, total: 10, phase: 'download' });
    await ready;

    expect(seen).toEqual([{
      type: 'progress', file: 'onnx/encoder_model_quantized.onnx', loaded: 5, total: 10, phase: 'download',
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
        ? { type: 'ready' }
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
