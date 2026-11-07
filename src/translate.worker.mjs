/**
 * Translate English sentences to the target language, in the reader's browser.
 *
 * A SEPARATE worker from the speech worker, for two reasons that are not
 * stylistic. Inference on the main thread freezes the tab for its whole
 * duration. And translation and synthesis must run CONCURRENTLY: the design
 * depends on the translator staying ahead of playback (about 20 sentences/s
 * for Bergamot in Chrome against playback's ~0.33), and sharing one worker
 * serialises them, which guarantees it cannot.
 *
 * The translator is Mozilla's Firefox Translations engine (LT-255): Bergamot,
 * a wasm build of Marian, with Firefox's own models and settings. It replaced
 * Opus-MT on Transformers.js, which it beat in all four languages (LT-252) at a
 * third of the download.
 *
 * Protocol, deliberately the same shape as the speech worker's:
 *
 *   -> { type: 'init', manifestUrl, pair, initId }
 *   <- { type: 'progress', initId, file, loaded, total, phase }   while loading
 *   <- { type: 'progress', id, loaded, total, phase: 'translate' }  during a batch
 *   <- { type: 'ready', initId }          only for the latest init
 *   -> { type: 'translate', id, lines: string[] }
 *   <- { type: 'translated', id, lines: string[] }
 *   <- { type: 'error', id, initId, message }   id for a batch, initId for an init
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
// Mozilla's glue, vendored unchanged; vite.config.js turns it into a module.
// Imported statically: this worker only starts once a reader picks a language.
import loadBergamot from './vendor/bergamot/bergamot-translator.js';

// Sentences per call into the engine. Neither a memory ceiling nor a speed
// knob any more: Bergamot batches internally by word count (`mini-batch-words`
// below) and pads nothing across calls. What a chunk still buys is PROGRESS --
// one report per chunk, so a whole-page translation shows movement -- and a
// short hold on the worker, since a call is synchronous (~0.3 s for 8).
//
// Opus-MT needed German and Portuguese one sentence at a time (LT-217), because
// those exports ran on past the sentence when padded. Bergamot does not: 0
// runaway lines in 472 textbook sentences per language, translated as ONE
// batch (LT-252). So every language batches the same.
const MAX_BATCH = 8;

// Firefox's own model settings, from Firefox's translations-engine.worker.js
// (bergamot-translator v0.6.0). Copied rather than tuned: these are what the
// LT-252 scores measured. `skip-cost` turns off the quality model, which these
// models do not ship; `cpu-threads: 0` is the single-threaded wasm path.
// int8shiftAlphaAll matches the `.intgemm.alphas.bin` models in the lock file;
// an `intgemm8.bin` model would need int8shiftAll instead.
const MODEL_CONFIG = {
  'beam-size': '1',
  normalize: '1.0',
  'word-penalty': '0',
  'max-length-break': '128',
  'mini-batch-words': '1024',
  workspace: '128',
  'max-length-factor': '2.0',
  'skip-cost': 'true',
  'cpu-threads': '0',
  quiet: 'true',
  'quiet-translation': 'true',
  'gemm-precision': 'int8shiftAlphaAll',
  alignment: 'soft',
};

// The byte alignment each model file needs inside the wasm heap. Firefox's values.
const ALIGNMENT = { model: 256, lex: 64, vocab: 64 };

// Where the engine's own manifest sits, relative to any pair's manifest: one
// wasm for every language, so it is downloaded and verified once.
const ENGINE_MANIFEST = '../bergamot/manifest.json';

// Firefox's starting heap, 40 MiB. The heap grows to fit a model (~37 MB each).
const INITIAL_MEMORY = 41_943_040;

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
 * 37 MB model and a wasm engine.
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
 * Make a value the engine threw into an Error a reader can be shown.
 *
 * A C++ exception reaches JS as a bare number: the address of the exception
 * object in the wasm heap. Passed on as it is, the reader saw "The voice could
 * not start: 38307768". Everything Bergamot and Marian throw derives from
 * std::runtime_error, whose second word points at the what() string, so that
 * is read back. If it does not look like text the number is kept, labelled.
 * Anything that is not a number (an abort's RuntimeError, our own Errors) is
 * already readable and passes through unchanged.
 */
export function engineError(bergamot, thrown) {
  if (typeof thrown !== 'number') return thrown;
  try {
    const at = bergamot.HEAPU32[(thrown >>> 2) + 1];
    const end = bergamot.HEAPU8.indexOf(0, at);
    if (at > 0 && end > at && end - at <= 1000) {
      const what = new TextDecoder().decode(bergamot.HEAPU8.subarray(at, end));
      if (/^[\P{C}\s]+$/u.test(what)) return new Error(`translation engine: ${what}`);
    }
  } catch {
    // An address outside the heap; fall through to the number.
  }
  return new Error(`translation engine error ${thrown}`);
}

/**
 * The engine's one BlockingService. Bergamot's service registers a logger named
 * "general" when it is built, and a second one in the same module throws
 * "logger with name 'general' already exists" -- which is what a reader got on
 * picking a second language. One service runs any number of models, so every
 * pair shares it.
 */
const services = new WeakMap();
function serviceFor(bergamot) {
  if (!services.has(bergamot)) services.set(bergamot, new bergamot.BlockingService({ cacheSize: 0 }));
  return services.get(bergamot);
}

/**
 * Turn the Bergamot module and one pair's verified files into `translate(lines)`.
 *
 * `buffers` is what `ensureModels` returns for a pair's manifest: `model`, `lex`
 * and `vocab`, each an ArrayBuffer whose sha256 has already been checked.
 * Exported so a test can run the real engine on the real files.
 */
export function createBergamotSession(bergamot, buffers, source, target) {
  const model = guarded(bergamot, () => loadModel(bergamot, buffers, source, target));
  // The session is made in a function of its own. A closure keeps its whole
  // enclosing scope alive, so one made here would keep `buffers` reachable: the
  // engine has copied every byte into its heap, and the ~37 MB of ArrayBuffers
  // would stay as a second copy per language for as long as `sessions` holds it.
  return translateWith(bergamot, model, guarded(bergamot, () => serviceFor(bergamot)));
}

/** Run a C++ call, rethrowing anything it throws as a readable Error. */
function guarded(bergamot, fn) {
  try {
    return fn();
  } catch (error) {
    throw engineError(bergamot, error);
  }
}

/** `translate(lines)` on one loaded model. */
function translateWith(bergamot, model, service) {
  return async (lines) => guarded(bergamot, () => {
    const messages = new bergamot.VectorString();
    const options = new bergamot.VectorResponseOptions();
    let responses;
    try {
      for (const line of lines) {
        messages.push_back(line);
        options.push_back({ qualityScores: false, alignment: false, html: false });
      }
      responses = service.translate(model, messages, options);
      const out = [];
      for (let i = 0; i < responses.size(); i += 1) {
        // get() hands back a COPY of the response, with its own share of the
        // heap, so it is freed here like everything else this call made.
        const response = responses.get(i);
        try {
          // A newline inside a line is a paragraph break to Bergamot, and comes
          // back as one. A line here is one spoken sentence, so it is joined up.
          out.push(response.getTranslatedText().replace(/\s*\n\s*/g, ' '));
        } finally {
          response.delete();
        }
      }
      return out;
    } finally {
      // wasm-side vectors are not garbage-collected; each call frees its own.
      messages.delete();
      options.delete();
      responses?.delete();
    }
  });
}

/** One pair's TranslationModel, from its verified files. */
function loadModel(bergamot, buffers, source, target) {
  const aligned = (name) => {
    const bytes = new Uint8Array(buffers[name]);
    const memory = new bergamot.AlignedMemory(bytes.byteLength, ALIGNMENT[name]);
    memory.getByteArrayView().set(bytes);
    return memory;
  };
  // Bergamot reads its settings as YAML.
  const config = Object.entries(MODEL_CONFIG).map(([key, value]) => `${key}: ${value}`).join('\n');
  const vocabs = new bergamot.AlignedMemoryList();
  vocabs.push_back(aligned('vocab'));
  return new bergamot.TranslationModel(
    source, target, config, aligned('model'), aligned('lex'), vocabs, null);
}

/**
 * Start the engine from its verified wasm bytes. Exported for tests/bergamot.test.js.
 *
 * `onDead` is called if the engine ever aborts -- a model that does not parse,
 * or the heap running out. An aborted module fails every later call, so the
 * worker drops it and its sessions, and the next language a reader picks starts
 * a fresh one.
 */
export async function startEngine(wasmBinary, onDead = () => {}) {
  return new Promise((resolve, reject) => {
    const bergamot = loadBergamot({
      INITIAL_MEMORY,
      // The bytes come from our own verified cache, so the glue never fetches.
      wasmBinary,
      print: () => {},
      printErr: (message) => console.warn('bergamot:', message),
      onAbort: (reason) => {
        onDead(reason);
        reject(new Error(`translation engine aborted: ${reason}`));
      },
      // Resolving with the module itself from inside its own init callback would
      // make the promise adopt it as a thenable. A microtask later is what
      // Firefox's worker does too.
      onRuntimeInitialized: async () => {
        await Promise.resolve();
        resolve(bergamot);
      },
    });
  });
}

let engine = null;              // Promise of the started module, one per worker

/**
 * The worker's memory of its pairs: one loaded or loading model per pair.
 *
 * A loaded pair is KEPT. Switching es -> fr -> es then costs nothing the second
 * time, and a batch still running on the Spanish model when French is picked
 * keeps a model to run on: freeing it there would be a use-after-free inside the
 * wasm heap, between two chunks. The cost is ~37 MB of heap per language a
 * reader has tried, which wasm never hands back anyway.
 *
 * A pair still LOADING is shared too. es -> fr -> es before the first Spanish
 * load ends would otherwise build a second Spanish model, and the one the map
 * dropped would be ~37 MB of heap that nothing could free. The shared load's
 * progress goes to whichever init asked last, since that is the one the reader
 * is watching. A failed load is forgotten so the next pick retries it.
 *
 * `clear()` is for an engine that aborted: every session on it is dead, and so
 * is any load in flight on it, whose result is then not remembered.
 * Exported for tests/translate.worker.test.js.
 */
export function createPairCache(loadPair) {
  const sessions = new Map();   // pair -> translate(lines)
  const pending = new Map();    // pair -> { promise, onProgress }

  function load({ manifestUrl, pair, onProgress }) {
    if (sessions.has(pair)) return Promise.resolve(sessions.get(pair));
    const inFlight = pending.get(pair);
    if (inFlight) {
      inFlight.onProgress = onProgress;
      return inFlight.promise;
    }
    const entry = { onProgress };
    const mine = () => pending.get(pair) === entry;
    entry.promise = Promise.resolve()
      .then(() => loadPair({ manifestUrl, pair, onProgress: (p) => entry.onProgress(p) }))
      .then((translate) => {
        if (mine()) sessions.set(pair, translate);
        return translate;
      })
      .finally(() => {
        if (mine()) pending.delete(pair);
      });
    pending.set(pair, entry);
    return entry.promise;
  }

  function clear() {
    sessions.clear();
    pending.clear();
  }

  return { load, clear };
}

/**
 * Load one pair, served entirely from our own verified cache.
 *
 * Every byte -- the engine's wasm and the pair's three model files -- comes from
 * our own origin through `ensureModels`, sha256-checked, and is stored in the
 * translation cache. Nothing is fetched from Mozilla: the mirror's CSP blocks
 * the cross-origin request, and the request would tell a third party which book
 * a reader just opened. Reuse of loaded and loading pairs is `createPairCache`'s.
 */
async function loadPair({ manifestUrl, pair, onProgress }) {
  const engineManifest = new URL(ENGINE_MANIFEST, new URL(manifestUrl, self.location.href)).pathname;
  const { wasm } = await ensureModels(engineManifest, onProgress, MT_CACHE_NAME);
  const buffers = await ensureModels(manifestUrl, onProgress, MT_CACHE_NAME);

  // Neither a failed start nor an engine that later aborts is remembered: the
  // next init starts a fresh one. Only one engine is ever live in a worker --
  // the glue publishes its wasm exports as globals, so a second module would
  // overwrite the first one's.
  // `forget` checks the engine is still this one, so a late abort from an
  // engine already replaced cannot drop its successor.
  if (!engine) {
    let started = null;
    const forget = () => {
      if (engine !== started) return;
      engine = null;
      pairs.clear();
    };
    started = startEngine(wasm, forget).catch((error) => { forget(); throw error; });
    engine = started;
  }
  const bergamot = await engine;

  const [source, target] = pair.split('-');
  return createBergamotSession(bergamot, buffers, source, target);
}

const pairs = createPairCache(loadPair);

export function createHandler({ post, load = pairs.load }) {
  let loading = null;
  // Which init is the latest. Counted rather than compared by promise: two
  // inits for the same pair can share one load (createPairCache), and then the
  // promise no longer says which of them the reader is waiting on.
  let inits = 0;
  let translate = null;
  // The TARGET half of the pair, which is what picks the spoken-form normaliser.
  // Read from init rather than passed per batch: it cannot change without a new
  // session, and a per-batch parameter invites two callers to disagree.
  let code = null;

  return async function handle(data) {
    // Only the LATEST init is the reader's (LT-217). A cancelled download keeps
    // loading after the reader picks another language, and may finish last: its
    // model must not replace the newer one, and its failure is nobody's error.
    let replaced = false;
    try {
      if (data.type === 'init') {
        code = String(data.pair ?? '').split('-')[1] ?? null;
        translate = null;
        const mine = ++inits;
        const loadingNow = load({
          manifestUrl: data.manifestUrl,
          pair: data.pair,
          onProgress: (p) => post({
            type: 'progress', initId: data.initId, file: p.file, loaded: p.loaded, total: p.total, phase: p.phase,
          }),
        });
        loading = loadingNow;
        try {
          const loadedSession = await loadingNow;
          if (inits !== mine) return;
          translate = loadedSession;
        } catch (error) {
          replaced = inits !== mine;
          throw error;
        }
        post({ type: 'ready', initId: data.initId });
        return;
      }

      if (data.type === 'translate') {
        // Awaiting the in-flight init rather than rejecting means the host does
        // not have to serialise init against the first batch; a translate that
        // arrives before any init at all is still a programming error and says so.
        // Kept local: a newer init may replace `translate` during the wait.
        if (!translate && !loading) throw new Error('translator not initialised');
        const session = translate ?? await loading;
        const lines = await translateBatch(session, data.lines, (p) => post({
          type: 'progress', id: data.id, file: null, loaded: p.loaded, total: p.total, phase: p.phase,
        }), code);
        post({ type: 'translated', id: data.id, lines });
      }
    } catch (error) {
      if (replaced) return;
      post({ type: 'error', id: data.id, initId: data.initId, message: String(error?.message ?? error) });
    }
  };
}

// Guarded so importing this module in a test does not require a worker scope.
if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
  const handle = createHandler({ post: (message) => self.postMessage(message) });
  self.onmessage = ({ data }) => handle(data);
}
