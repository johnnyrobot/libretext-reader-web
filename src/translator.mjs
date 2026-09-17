/**
 * The reader's half of the translation worker -- the same role `engine.mjs`
 * plays for synthesis, and deliberately the same shape.
 *
 * Everything here is bookkeeping around one Worker: promises for its replies,
 * one init per pair, and a language list read from disk. The translation itself
 * lives in `translate.worker.mjs`, where it cannot block the page.
 */

// The DEPLOYED filename. Vite builds src/translate.worker.mjs to
// translate.worker.js; pointing at the .mjs name 404s and surfaces only as a
// worker error event -- the same trap engine.mjs names.
const DEFAULT_WORKER_URL = '/_assets/tts/translate.worker.js';

export const MT_ROOT = '/_assets/tts/mt/';

/**
 * The language pairs this deployment hosts models for.
 *
 * This REPLACES `manifest.languages` as the menu's source. A build-time track
 * was a file next to the page, so the page could list its own languages; a model
 * is hosted once for the whole site, so the site lists them. A deployment with no
 * models answers 404 and offers nothing but English, which is the honest result
 * rather than a failure -- the reader still gets English speech.
 */
export async function hostedPairs(root = MT_ROOT) {
  try {
    const res = await fetch(`${root}pairs.json`);
    if (!res.ok) return [];
    const { pairs } = await res.json();
    return Array.isArray(pairs) ? pairs : [];
  } catch {
    return [];
  }
}

export function createTranslator({ createWorker, workerUrl = DEFAULT_WORKER_URL, root = MT_ROOT } = {}) {
  const spawn = createWorker ?? (() => new Worker(workerUrl, { type: 'module' }));
  const worker = spawn();
  const pending = new Map();
  let nextId = 0;
  let readyResolve;
  let readyReject;
  let onProgress = () => {};
  // One init per pair, remembered: switching es -> en -> es must not rebuild a
  // session that is already loaded, and the reader should not have to track
  // which pair the worker currently holds to avoid it.
  let loaded = null;
  let loadedPair = null;

  worker.onmessage = ({ data }) => {
    switch (data.type) {
      case 'progress':
        onProgress(data);
        break;
      case 'ready':
        readyResolve?.();
        break;
      case 'translated': {
        pending.get(data.id)?.resolve(data.lines);
        pending.delete(data.id);
        break;
      }
      case 'error': {
        const error = new Error(data.message);
        if (data.id !== undefined && pending.has(data.id)) {
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
    const error = new Error(event.message || 'translation worker failed');
    readyReject?.(error);
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
  };

  return {
    init({ pair, onProgress: progress = () => {} }) {
      if (loadedPair === pair) return loaded;
      onProgress = progress;
      loadedPair = pair;
      loaded = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; })
        // A failed load must not be remembered as the loaded pair, or every
        // later attempt returns the same rejection without ever retrying.
        .catch((error) => { loadedPair = null; loaded = null; throw error; });
      worker.postMessage({ type: 'init', manifestUrl: `${root}${pair}/manifest.json`, pair });
      return loaded;
    },

    // `onProgress` again, because the worker reports progress during a long
    // translation too, and a run that reuses init's callback would label
    // translation progress with the download's wording. Only one operation is in
    // flight at a time, so one slot is enough.
    translate(lines, progress) {
      if (progress) onProgress = progress;
      const id = nextId;
      nextId += 1;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker.postMessage({ type: 'translate', id, lines });
      });
    },

    terminate() {
      worker.terminate();
      const error = new Error('translation worker terminated');
      for (const entry of pending.values()) entry.reject(error);
      pending.clear();
    },
  };
}
