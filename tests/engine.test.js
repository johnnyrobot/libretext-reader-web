import { describe, it, expect, vi } from 'vitest';
import { createEngine } from '../src/engine.mjs';

class FakeWorker {
  constructor() { this.sent = []; this.onmessage = null; this.terminated = false; }
  postMessage(msg) {
    this.sent.push(msg);
    queueMicrotask(() => {
      if (msg.type === 'init') this.reply({ type: 'ready', provider: 'wasm' });
      if (msg.type === 'setVoice') this.reply({ type: 'voiceSet', voice: msg.voice });
      if (msg.type === 'synth') {
        this.reply({ type: 'audio', id: msg.id, samples: new Float32Array([0.1, 0.2]), sampleRate: 44100 });
      }
    });
  }
  reply(data) { this.onmessage?.({ data }); }
  terminate() { this.terminated = true; }
}

function engineWithFakeWorker() {
  const worker = new FakeWorker();
  return { worker, engine: createEngine({ createWorker: () => worker }) };
}

describe('engine.mjs', () => {
  it('resolves init with the provider the worker reports', async () => {
    const { engine } = engineWithFakeWorker();
    await expect(engine.init({ voice: 'M1', lang: 'en' })).resolves.toEqual({ provider: 'wasm' });
  });

  it('forwards progress events to the callback', async () => {
    const { worker, engine } = engineWithFakeWorker();
    const seen = [];
    const ready = engine.init({ voice: 'M1', lang: 'en', onProgress: (p) => seen.push(p) });
    worker.reply({ type: 'progress', file: 'onnx/vocoder.onnx', loaded: 5, total: 10 });
    await ready;
    expect(seen).toEqual([{ type: 'progress', file: 'onnx/vocoder.onnx', loaded: 5, total: 10 }]);
  });

  it('correlates concurrent synthesis requests by id', async () => {
    const { engine } = engineWithFakeWorker();
    await engine.init({ voice: 'M1', lang: 'en' });
    const [a, b] = await Promise.all([
      engine.synthesize('b1s0', 'First sentence.'),
      engine.synthesize('b1s1', 'Second sentence.'),
    ]);
    expect(a.id).toBe('b1s0');
    expect(b.id).toBe('b1s1');
    expect(a.sampleRate).toBe(44100);
  });

  it('rejects a pending request when the worker reports an error for it', async () => {
    const worker = new FakeWorker();
    worker.postMessage = (msg) => {
      worker.sent.push(msg);
      queueMicrotask(() => {
        if (msg.type === 'init') worker.reply({ type: 'ready', provider: 'wasm' });
        if (msg.type === 'synth') worker.reply({ type: 'error', id: msg.id, code: 'SYNTH_FAILED', message: 'boom' });
      });
    };
    const engine = createEngine({ createWorker: () => worker });
    await engine.init({ voice: 'M1', lang: 'en' });
    await expect(engine.synthesize('b1s0', 'text')).rejects.toThrow(/boom/);
  });

  it('cancel discards a late result instead of resolving it', async () => {
    const worker = new FakeWorker();
    worker.postMessage = (msg) => { worker.sent.push(msg); if (msg.type === 'init') queueMicrotask(() => worker.reply({ type: 'ready', provider: 'wasm' })); };
    const engine = createEngine({ createWorker: () => worker });
    await engine.init({ voice: 'M1', lang: 'en' });

    const pending = engine.synthesize('b1s0', 'text');
    const outcome = vi.fn();
    pending.then(outcome, outcome);
    engine.cancel('b1s0');
    worker.reply({ type: 'audio', id: 'b1s0', samples: new Float32Array([1]), sampleRate: 44100 });
    await new Promise((r) => setTimeout(r, 0));

    expect(outcome).toHaveBeenCalledTimes(1);
    expect(outcome.mock.calls[0][0]).toBeInstanceOf(Error);
  });

  it('terminate stops the worker', async () => {
    const { worker, engine } = engineWithFakeWorker();
    await engine.init({ voice: 'M1', lang: 'en' });
    engine.terminate();
    expect(worker.terminated).toBe(true);
  });

  // A translation voice still loading is terminated when the reader picks
  // another language (LT-217). Its loader must hear about it, not wait forever.
  it('terminate rejects an init still loading', async () => {
    const worker = { postMessage: () => {}, terminate: () => {} };
    const engine = createEngine({ createWorker: () => worker });
    const ready = engine.init({ voice: 'M1', lang: 'fr' });
    engine.terminate();
    await expect(ready).rejects.toThrow(/terminated/);
  });

  it('setLang resolves when the worker acknowledges', async () => {
    const posted = [];
    const worker = {
      postMessage: (msg) => {
        posted.push(msg);
        if (msg.type === 'setLang') {
          queueMicrotask(() => worker.onmessage({ data: { type: 'langSet', lang: msg.lang } }));
        }
      },
      terminate: () => {},
    };
    const engine = createEngine({ createWorker: () => worker });

    await engine.setLang('es');
    expect(posted.at(-1)).toEqual({ type: 'setLang', lang: 'es' });
  });

  it('setLang and setVoice do not resolve each other', async () => {
    const worker = {
      postMessage: (msg) => {
        if (msg.type === 'setVoice') {
          queueMicrotask(() => worker.onmessage({ data: { type: 'voiceSet', voice: msg.voice } }));
        }
      },
      terminate: () => {},
    };
    const engine = createEngine({ createWorker: () => worker });

    let langSettled = false;
    engine.setLang('es').then(() => { langSettled = true; });
    await engine.setVoice('F1');
    await Promise.resolve();
    expect(langSettled).toBe(false);
  });

  // Ruling R35: a second setLang/setVoice before the first's reply arrives
  // must not leave the first call's promise unsettled forever. `await`ing an
  // unsettled promise directly would just hang the test, and attaching a
  // `.then` without racing it against something bounded lets the test pass
  // vacuously (the callback that would prove settlement never runs, but
  // nothing fails). So each check below races "both calls settle" against a
  // bounded timer sentinel: if either call is still pending when the timer
  // fires, the race resolves to the sentinel and the assertion fails fast
  // instead of hanging or silently skipping the check.
  it('setLang resolves a superseded call instead of leaving it hanging', async () => {
    const worker = { postMessage: () => {}, terminate: () => {} };
    const engine = createEngine({ createWorker: () => worker });

    let firstStatus = 'pending';
    let secondStatus = 'pending';
    const first = engine.setLang('es').then(
      () => { firstStatus = 'fulfilled'; },
      () => { firstStatus = 'rejected'; },
    );
    const second = engine.setLang('fr').then(
      () => { secondStatus = 'fulfilled'; },
      () => { secondStatus = 'rejected'; },
    );

    // Only the superseding call's reply ever arrives -- the superseded call's
    // reply is never separately delivered, matching a real worker that only
    // replies once per in-flight 'lang' operation it still recognises.
    worker.onmessage({ data: { type: 'langSet', lang: 'fr' } });

    const sentinel = Symbol('timed out');
    const raced = await Promise.race([
      Promise.all([first, second]).then(() => 'settled'),
      new Promise((resolve) => setTimeout(() => resolve(sentinel), 20)),
    ]);

    expect(raced).toBe('settled');
    expect(firstStatus).toBe('fulfilled');
    expect(secondStatus).toBe('fulfilled');
  });

  it('setVoice resolves a superseded call instead of leaving it hanging', async () => {
    const worker = { postMessage: () => {}, terminate: () => {} };
    const engine = createEngine({ createWorker: () => worker });

    let firstStatus = 'pending';
    let secondStatus = 'pending';
    const first = engine.setVoice('M1').then(
      () => { firstStatus = 'fulfilled'; },
      () => { firstStatus = 'rejected'; },
    );
    const second = engine.setVoice('F1').then(
      () => { secondStatus = 'fulfilled'; },
      () => { secondStatus = 'rejected'; },
    );

    worker.onmessage({ data: { type: 'voiceSet', voice: 'F1' } });

    const sentinel = Symbol('timed out');
    const raced = await Promise.race([
      Promise.all([first, second]).then(() => 'settled'),
      new Promise((resolve) => setTimeout(() => resolve(sentinel), 20)),
    ]);

    expect(raced).toBe('settled');
    expect(firstStatus).toBe('fulfilled');
    expect(secondStatus).toBe('fulfilled');
  });

  describe('streaming (Phonon, LT-214)', () => {
    function streamingWorker(script) {
      const worker = new FakeWorker();
      worker.postMessage = (msg) => {
        worker.sent.push(msg);
        queueMicrotask(() => {
          if (msg.type === 'init') worker.reply({ type: 'ready', provider: 'wasm' });
          if (msg.type === 'synth') script(msg, (data) => worker.reply({ id: msg.id, ...data }));
        });
      };
      return { worker, engine: createEngine({ createWorker: () => worker }) };
    }

    it('asks the worker to stream only when a chunk listener is given', async () => {
      const { worker, engine } = streamingWorker((msg, reply) => reply({ type: 'audio', samples: new Float32Array(1), sampleRate: 24000, outcome: 'ok' }));
      await engine.init({ voice: 'M1', lang: 'en' });
      await engine.synthesize('a', 'Lookahead.');
      await engine.synthesize('b', 'Now playing.', { onChunk: () => {} });
      const synths = worker.sent.filter((m) => m.type === 'synth');
      expect(synths.map((m) => m.stream)).toEqual([false, true]);
    });

    it('delivers chunks and resets for a sentence before its final audio, with the outcome', async () => {
      const { engine } = streamingWorker((msg, reply) => {
        reply({ type: 'chunk', samples: new Float32Array([0.1]), sampleRate: 24000 });
        reply({ type: 'reset' });
        reply({ type: 'chunk', samples: new Float32Array([0.2]), sampleRate: 24000 });
        reply({ type: 'audio', samples: new Float32Array([0.2]), sampleRate: 24000, outcome: 'retried' });
      });
      await engine.init({ voice: 'M1', lang: 'en' });
      const events = [];
      const result = await engine.synthesize('b1s0', 'Text.', {
        onChunk: (samples, sampleRate) => events.push(['chunk', samples[0], sampleRate]),
        onReset: () => events.push(['reset']),
      });
      expect(events).toEqual([['chunk', expect.closeTo(0.1), 24000], ['reset'], ['chunk', expect.closeTo(0.2), 24000]]);
      expect(result).toMatchObject({ id: 'b1s0', sampleRate: 24000, outcome: 'retried' });
    });

    it('drops chunks for a cancelled sentence', async () => {
      let replyLater;
      const { engine } = streamingWorker((msg, reply) => { replyLater = reply; });
      await engine.init({ voice: 'M1', lang: 'en' });
      const onChunk = vi.fn();
      const pending = engine.synthesize('b1s0', 'Text.', { onChunk });
      await Promise.resolve();
      engine.cancel('b1s0');
      replyLater({ type: 'chunk', samples: new Float32Array([0.1]) });
      await expect(pending).rejects.toThrow(/cancelled/);
      expect(onChunk).not.toHaveBeenCalled();
    });

    // seekTo cancels a sentence and asks for it again at once. The worker may
    // still send a chunk or the audio of the cancelled render after that; it
    // belongs to the old request and must not reach the new one.
    it('late messages from a cancelled request do not reach a re-request of the same sentence', async () => {
      const replies = [];
      const { engine } = streamingWorker((msg, reply) => { replies.push(reply); });
      await engine.init({ voice: 'M1', lang: 'en' });
      const first = engine.synthesize('b1s0', 'Text.', { onChunk: () => {} });
      first.catch(() => {});
      await Promise.resolve();
      engine.cancel('b1s0');
      const onChunk = vi.fn();
      const second = engine.synthesize('b1s0', 'Text.', { onChunk });
      await Promise.resolve();
      expect(replies).toHaveLength(2);

      const [late, current] = replies;
      late({ type: 'chunk', samples: new Float32Array([0.9]), sampleRate: 24000 });
      late({ type: 'audio', samples: new Float32Array([0.9]), sampleRate: 24000, outcome: 'ok' });
      expect(onChunk).not.toHaveBeenCalled();

      current({ type: 'audio', samples: new Float32Array([0.2]), sampleRate: 24000, outcome: 'ok' });
      const result = await second;
      expect(result.id).toBe('b1s0');
      expect(result.samples[0]).toBeCloseTo(0.2);
    });

    it('cancel reaches the worker for the request it cancels', async () => {
      const { worker, engine } = streamingWorker(() => {});
      await engine.init({ voice: 'M1', lang: 'en' });
      engine.synthesize('b1s0', 'Text.').catch(() => {});
      engine.cancel('b1s0');
      const [synth] = worker.sent.filter((m) => m.type === 'synth');
      const [cancel] = worker.sent.filter((m) => m.type === 'cancel');
      expect(cancel.id).toBe(synth.id);
    });

    it('a sentence from a worker with no length guard resolves with outcome ok', async () => {
      const { engine } = engineWithFakeWorker();
      await engine.init({ voice: 'M1', lang: 'en' });
      await expect(engine.synthesize('b1s0', 'Text.')).resolves.toMatchObject({ outcome: 'ok' });
    });
  });
});
