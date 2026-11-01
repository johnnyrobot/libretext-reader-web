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
  // Each synthesis goes to the worker under its own key, not the sentence id.
  // The player cancels a sentence and asks for it again at once on a seek, and
  // the worker can still send the cancelled render's chunks or audio after
  // that; keyed by sentence id, they would reach the new request.
  const requests = new Map(); // sentence id → key of its live request
  let serial = 0;
  const settle = (key) => {
    const entry = pending.get(key);
    pending.delete(key);
    if (entry && requests.get(entry.id) === key) requests.delete(entry.id);
    return entry;
  };
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
      case 'chunk':
        // Streamed audio for a sentence still rendering (Phonon only). Dropped
        // once its request is cancelled, like a late 'audio'.
        pending.get(data.id)?.onChunk?.(data.samples, data.sampleRate);
        break;
      case 'reset':
        pending.get(data.id)?.onReset?.();
        break;
      case 'audio': {
        const entry = pending.get(data.id);
        if (!entry) return; // cancelled; drop the late result
        // Supertonic has no length guard and reports no outcome: its audio is ok.
        settle(data.id);
        entry.resolve({ id: entry.id, samples: data.samples, sampleRate: data.sampleRate, outcome: data.outcome ?? 'ok' });
        break;
      }
      case 'error': {
        const error = new Error(data.message);
        error.code = data.code;
        if (data.id && pending.has(data.id)) {
          pending.get(data.id).reject(error);
          settle(data.id);
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
    requests.clear();
  };

  return {
    init({ voice, lang, onProgress: progress = () => {} }) {
      onProgress = progress;
      const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
      worker.postMessage({ type: 'init', voice, lang, manifestUrl });
      return ready;
    },

    // `onChunk(samples, sampleRate)` asks for the sentence to be streamed: called
    // with each piece of audio that may be played now. `onReset()` means every
    // chunk so far must be dropped (the length guard withdrew them). The final
    // whole sentence still resolves, with the guard's `outcome`. A worker that
    // cannot stream (Supertonic) ignores the flag and only resolves.
    synthesize(id, text, { onChunk, onReset } = {}) {
      return new Promise((resolve, reject) => {
        serial += 1;
        const key = `${id}#${serial}`;
        requests.set(id, key);
        pending.set(key, { id, resolve, reject, onChunk, onReset });
        worker.postMessage({ type: 'synth', id: key, text, stream: Boolean(onChunk) });
      });
    },

    cancel(id) {
      const key = requests.get(id);
      if (key === undefined) return;
      settle(key).reject(new SpeechCancelledError(id));
      worker.postMessage({ type: 'cancel', id: key });
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
      requests.clear();
      worker.terminate();
    },
  };
}
