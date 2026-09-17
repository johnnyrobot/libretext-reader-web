// The deployed filename, not the source filename. Vite builds
// src/engine.worker.mjs to engine.worker.js; pointing at the .mjs name
// 404s and the failure surfaces only as a worker error event.
const DEFAULT_WORKER_URL = '/_assets/tts/engine.worker.js';

export class SpeechCancelledError extends Error {
  constructor(id) { super(`synthesis cancelled: ${id}`); this.name = 'SpeechCancelledError'; }
}

export function createEngine({ createWorker, workerUrl = DEFAULT_WORKER_URL, manifestUrl = '/_assets/tts/manifest.json' } = {}) {
  const spawn = createWorker ?? (() => new Worker(workerUrl, { type: 'module' }));
  const worker = spawn();
  const pending = new Map();
  let readyResolve;
  let readyReject;
  let onProgress = () => {};

  worker.onmessage = ({ data }) => {
    switch (data.type) {
      case 'progress':
        onProgress(data);
        break;
      case 'ready':
        readyResolve?.({ provider: data.provider });
        break;
      case 'voiceSet':
        pending.get('voice')?.resolve(undefined);
        pending.delete('voice');
        break;
      case 'langSet':
        pending.get('lang')?.resolve(undefined);
        pending.delete('lang');
        break;
      case 'audio': {
        const entry = pending.get(data.id);
        if (!entry) return; // cancelled; drop the late result
        pending.delete(data.id);
        entry.resolve({ id: data.id, samples: data.samples, sampleRate: data.sampleRate });
        break;
      }
      case 'error': {
        const error = new Error(data.message);
        error.code = data.code;
        if (data.id && pending.has(data.id)) {
          pending.get(data.id).reject(error);
          pending.delete(data.id);
        } else {
          readyReject?.(error);
        }
        break;
      }
    }
  };

  worker.onerror = (event) => {
    const error = new Error(event.message || 'speech worker failed');
    readyReject?.(error);
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
  };

  return {
    init({ voice, lang, onProgress: progress = () => {} }) {
      onProgress = progress;
      const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
      worker.postMessage({ type: 'init', voice, lang, manifestUrl });
      return ready;
    },

    synthesize(id, text) {
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker.postMessage({ type: 'synth', id, text });
      });
    },

    cancel(id) {
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      entry.reject(new SpeechCancelledError(id));
      worker.postMessage({ type: 'cancel', id });
    },

    setVoice(voice) {
      return new Promise((resolve, reject) => {
        // A second setVoice before the first's reply arrives supersedes it --
        // the worker applies messages in order, so by the time this call lands
        // the caller has already done its synchronous flush/swap and the final
        // voice is whatever THIS call sets regardless of the superseded call's
        // outcome. Resolve (not reject) the superseded entry: the superseded
        // caller's await completing normally is accurate, and rejecting it
        // would drive an error-handling path that could actively undo a choice
        // the reader has since moved past. A promise that never settles is the
        // one outcome that's definitely wrong -- it makes the caller's own
        // error handling unreachable. (Ruling R35.)
        pending.get('voice')?.resolve(undefined);
        pending.set('voice', { resolve, reject });
        worker.postMessage({ type: 'setVoice', voice });
      });
    },

    setLang(lang) {
      return new Promise((resolve, reject) => {
        // Same fixed-key clobbering as setVoice above, same fix -- see its
        // comment. (Ruling R35.)
        pending.get('lang')?.resolve(undefined);
        pending.set('lang', { resolve, reject });
        worker.postMessage({ type: 'setLang', lang });
      });
    },

    terminate() {
      for (const entry of pending.values()) entry.reject(new SpeechCancelledError('terminated'));
      pending.clear();
      worker.terminate();
    },
  };
}
