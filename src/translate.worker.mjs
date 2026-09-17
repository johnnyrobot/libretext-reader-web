/**
 * Translate English sentences to the target language, in the reader's browser.
 *
 * A SEPARATE worker from `engine.worker.mjs`, for two reasons that are not
 * stylistic. Inference on the main thread freezes the tab for its whole
 * duration. And translation and synthesis must run CONCURRENTLY: the design
 * depends on the translator staying ahead of playback (2.99 sent/s measured
 * against playback's ~0.33), and sharing one worker serialises them, which
 * guarantees it cannot.
 *
 * Protocol, deliberately the same shape as `engine.worker.mjs`:
 *
 *   -> { type: 'init', manifestUrl, pair }
 *   <- { type: 'progress', file, loaded, total, phase }
 *   <- { type: 'ready' }
 *   -> { type: 'translate', id, lines: string[] }
 *   <- { type: 'translated', id, lines: string[] }
 *   <- { type: 'error', id, message }
 *
 * `lines` out is the same length as `lines` in, always. Highlighting is keyed by
 * position, so a length mismatch does not lose one sentence -- it misaligns
 * every sentence after it, silently. `pipeline/translate.SentenceCountError`
 * exists for exactly this and this is its port.
 */

import { ensureModels, MT_CACHE_NAME } from './models.mjs';
import { mask, restore, PlaceholderError } from './protect.mjs';
import { shouldFallBack } from './qa.mjs';
import { NORMALIZERS } from './lang-normalize.mjs';

// A SECOND ONNX Runtime, in its own directory, and this is load-bearing:
// `engine.worker.mjs` pins onnxruntime-web 1.17.3 and reads its wasm from
// /_assets/tts/ort/, while transformers.js bundles 1.26.0-dev. The two builds
// are not interchangeable -- loading 1.17 binaries into 1.26's JS aborts inside
// the wasm module with nothing that says "wrong version". scripts/stage-local.sh
// resolves the binaries through transformers.js's own dependency so they cannot
// drift from the runtime that is actually bundled.
//
// ABSOLUTE, for the reason engine.worker.mjs is: a relative path resolves
// against the ORT module's URL, not the page's.
const ORT_WASM_PATH = '/_assets/tts/ort-mt/';

const MAX_THREADS = 8;

// Sentences per inference run. NOT a throughput tuning knob -- a memory ceiling.
// transformers.js pads a batch to its longest sequence, so cost grows with
// batch x longest^2, and handing it a whole page at once is what it sounds like:
// 303 sentences in one run died with
// `failed to call OrtRun(). ERROR_CODE: 6, ERROR_MESSAGE: std::bad_alloc`.
// Chunking lives HERE rather than in the caller because the caller cannot know
// this, and because every caller would otherwise have to.
const MAX_BATCH = 8;

/** The translator returned a different number of lines than it was given. */
export class SentenceCountError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SentenceCountError';
  }
}

/**
 * Mask, translate, restore -- the port of `pipeline/translate.translate_sentences`.
 *
 * `translate` takes masked lines and returns translated ones. Keeping it a
 * parameter is what makes the 1:1 invariant and the fallback testable without a
 * 115 MB model.
 *
 * A line whose protected spans did not survive falls back to its ENGLISH source
 * rather than shipping a mangled URL to be read aloud. The Python omits the id
 * and lets the reader's per-id fallback do it; here the contract is a dense
 * array, so the English goes in the slot. Same outcome, and the sparse-track
 * contract on the reader side is why either is safe.
 */
const identity = (text) => text;

export async function translateBatch(translate, lines, onProgress = () => {}, code = null) {
  const out = [];
  for (let start = 0; start < lines.length; start += MAX_BATCH) {
    out.push(...await translateChunk(
      translate, lines.slice(start, start + MAX_BATCH), NORMALIZERS[code] ?? identity));
    // Whole-page translation blocks playback until M2 step 6, and a 45-second
    // wait with a static message is indistinguishable from a hung tab.
    onProgress({ phase: 'translate', loaded: out.length, total: lines.length });
  }
  return out;
}

async function translateChunk(translate, lines, normalize) {
  if (lines.length === 0) return [];

  const masked = lines.map((line) => mask(line));
  const translated = await translate(masked.map(([text]) => text));

  if (translated.length !== lines.length) {
    // Not zipped and not truncated. Either would produce a plausible-looking
    // track in which every later sentence is captioned with its neighbour's text.
    throw new SentenceCountError(
      `translator returned ${translated.length} lines for ${lines.length} sentences`,
    );
  }

  return lines.map((source, i) => {
    let restored;
    try {
      // The normaliser runs on the MASKED line, BEFORE restore, and that order
      // is load-bearing rather than incidental. After restore the sentence holds
      // real URLs, email addresses and `[[latex:...]]` payloads, every one of
      // them full of digits and dots that the number passes would spell out in
      // Spanish -- corrupting a span restore() has just put back. On the masked
      // line those are `[[KIND0]]` placeholders whose digit is glued to a
      // letter, so no boundary-anchored number pattern can reach inside one.
      // pipeline/translate.translate_sentences has the same ordering for the
      // same reason.
      restored = restore(normalize(translated[i]), masked[i][1]);
    } catch (error) {
      if (error instanceof PlaceholderError) return source;
      throw error;
    }
    // The single-sided half of the build-time QA gate (src/qa.mjs). It lands
    // HERE, beside the PlaceholderError fallback, because it is the same
    // decision with the same action: this line is not fit to be read aloud, so
    // the reader hears the English. Two places that decide that eventually
    // disagree, and the disagreement is silent.
    //
    // Everything it cannot catch is named in qa.mjs: a FLUENT mistranslation
    // needs the back-translation gate, and that does not fit in a browser.
    return shouldFallBack(source, restored) ? source : restored;
  });
}

/**
 * Build the transformers.js pipeline, served entirely from our own verified cache.
 *
 * transformers.js normally fetches model files from the Hugging Face CDN and
 * caches them itself. Both halves of that are wrong here: the mirror's CSP blocks
 * the cross-origin request, and the request would tell a third party which book
 * a reader just opened. `env.customCache` is the seam that avoids reimplementing
 * the loader -- every file it asks for is answered from the buffers
 * `ensureModels` already downloaded, sha256-verified and stored, so no model byte
 * is ever fetched by transformers.js at all.
 *
 * The import is dynamic so this module can be imported by a test without pulling
 * in the runtime, and so the ~1 MB of pipeline machinery is parsed only by a
 * reader who actually asked for a translation.
 */
async function loadTranslator({ manifestUrl, pair, onProgress }) {
  const buffers = await ensureModels(manifestUrl, onProgress, MT_CACHE_NAME);

  // Re-read to recover each buffer's PATH: ensureModels returns buffers keyed by
  // name, and the custom cache below is keyed by URL. Sub-kilobyte, and already
  // in the HTTP cache from the call above -- cheaper than duplicating the file
  // list here, where it would silently rot the first time the script changes.
  const base = new URL(manifestUrl, self.location.href);
  const manifest = await (await fetch(manifestUrl)).json();
  const byPath = new Map(
    manifest.files.map((file) => [new URL(file.path, base).pathname, buffers[file.name]]),
  );

  const { pipeline, env } = await import('@huggingface/transformers');

  env.allowLocalModels = true;
  // A miss must fail loudly here rather than quietly reaching for the CDN, where
  // it would fail again as an opaque CSP violation one layer further away.
  env.allowRemoteModels = false;
  env.localModelPath = new URL('..', base).pathname;  // the directory holding <pair>/
  env.useBrowserCache = false;
  env.useFSCache = false;
  env.useWasmCache = false;   // the wasm is served from ORT_WASM_PATH, not cached through us
  env.useCustomCache = true;
  env.customCache = {
    async match(request) {
      const buffer = byPath.get(request);
      return buffer ? new Response(buffer) : undefined;
    },
    // Everything this cache can serve is already stored and verified by
    // models.mjs. Anything it cannot serve must not be written here, or an
    // unverified byte would be indistinguishable from a verified one.
    async put() {},
  };

  env.backends.onnx.wasm.wasmPaths = ORT_WASM_PATH;
  // Threads are the entire lever: 0.90 sent/s single-threaded against 2.99 with
  // 8. Cross-origin isolation buys nothing by itself; it matters only because it
  // is what allows wasm threads at all, and the reader already sets COOP/COEP.
  if (self.crossOriginIsolated) {
    env.backends.onnx.wasm.numThreads = Math.min(MAX_THREADS, navigator.hardwareConcurrency || 1);
  }

  // ONE config, no fallback ladder -- the opposite of engine.worker.mjs's
  // webgpu-then-wasm try/catch, and deliberately so. A failed session poisons
  // ORT for the whole page: after one config fails, every later config fails
  // with the identical error, so a second attempt here would not be a fallback,
  // it would be a guaranteed second failure reported as if the first had been
  // fine. fp16 is already known dead on ORT-web 1.26 for this export
  // (graph_utils.cc:30 GetIndexFromName on session create); q8 with
  // optimizations disabled is what was measured, and 2.99 sent/s IS that number,
  // not a degraded one.
  const translator = await pipeline('translation', pair, {
    dtype: 'q8',
    device: 'wasm',
    session_options: { graphOptimizationLevel: 'disabled' },
  });

  return async (lines) => (await translator(lines)).map((result) => result.translation_text);
}

export function createHandler({ post, load = loadTranslator }) {
  let loading = null;
  let translate = null;
  // The TARGET half of the pair, which is what picks the spoken-form normaliser.
  // Read from init rather than passed per batch: it cannot change without a new
  // session, and a per-batch parameter invites two callers to disagree.
  let code = null;

  return async function handle(data) {
    try {
      if (data.type === 'init') {
        code = String(data.pair ?? '').split('-')[1] ?? null;
        loading = load({
          manifestUrl: data.manifestUrl,
          pair: data.pair,
          onProgress: (p) => post({
            type: 'progress', file: p.file, loaded: p.loaded, total: p.total, phase: p.phase,
          }),
        });
        translate = await loading;
        post({ type: 'ready' });
        return;
      }

      if (data.type === 'translate') {
        // Awaiting the in-flight init rather than rejecting means the host does
        // not have to serialise init against the first batch; a translate that
        // arrives before any init at all is still a programming error and says so.
        if (!translate) {
          if (!loading) throw new Error('translator not initialised');
          translate = await loading;
        }
        const lines = await translateBatch(translate, data.lines, (p) => post({
          type: 'progress', file: null, loaded: p.loaded, total: p.total, phase: p.phase,
        }), code);
        post({ type: 'translated', id: data.id, lines });
      }
    } catch (error) {
      post({ type: 'error', id: data.id, message: String(error?.message ?? error) });
    }
  };
}

// Guarded so importing this module in a test does not require a worker scope.
if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
  const handle = createHandler({ post: (message) => self.postMessage(message) });
  self.onmessage = ({ data }) => handle(data);
}
