/**
 * English speech with Phonon 31M (onnx-community/phonon-31m-en, Apache 2.0), in
 * the reader's browser. LT-214 moved English Listen mode here from Supertonic;
 * the nine translation tracks stay on `engine.worker.mjs`, which a reader who
 * only ever listens in English never downloads. Given a staged manifest, it also
 * speaks the Phonon 40M French, German, Spanish and Portuguese models
 * (scripts/stage-phonon-lang.py, LT-216); the reader does not offer them yet.
 *
 * Protocol, the same shape as `engine.worker.mjs` so `engine.mjs` drives both,
 * with two additions for streaming:
 *
 *   -> { type: 'init', voice, lang, manifestUrl }
 *   <- { type: 'progress', file, loaded, total, phase }
 *   <- { type: 'ready', provider: 'wasm' }
 *   -> { type: 'synth', id, text, stream? }
 *   <- { type: 'chunk', id, samples, sampleRate }   stream only: audio that may play now
 *   <- { type: 'reset', id }               stream only: drop every chunk sent for id
 *   <- { type: 'audio', id, samples, sampleRate, outcome }
 *   -> { type: 'cancel', id }
 *   -> { type: 'setVoice', voice }  <- { type: 'voiceSet', voice }
 *   -> { type: 'setLang', lang }    <- { type: 'langSet', lang }   English only
 *   <- { type: 'error', id, code, message }
 *
 * `outcome` is the length guard's verdict (src/phonon-guard.mjs): 'ok',
 * 'retried', 'split', or 'skipped' with empty samples. A skipped sentence is
 * reported, not hidden, so the reader can mark it.
 *
 * Sentences render one at a time, in order. Phonon is autoregressive and its
 * cost is the model, not the scheduling; two sentences interleaved would each
 * take twice as long to first sound, and first sound is what streaming is for.
 */

import { ensureModels, PHONON_CACHE_NAME } from './models.mjs';
import { renderGuarded } from './phonon-guard.mjs';

// The ORT 1.26 binaries transformers.js bundles, staged once for the translator
// (see translate.worker.mjs for why they must not be engine.worker.mjs's 1.17).
const ORT_WASM_PATH = '/_assets/tts/ort-mt/';
const MAX_THREADS = 8;

export const SAMPLE_RATE = 24000;

// The reader's voice menu is M1/F1 whichever engine speaks. Both are Apache 2.0
// voices from gradium/phonon-voices (revision 0ee17205): Preston and Hadley.
export const VOICES = Object.freeze({ M1: 'qIxlZ7Ei8KvWlyQH', F1: 'bXwrkHhURL1VFJdG' });

/**
 * The voice file for a menu voice. A translation model staged by
 * scripts/stage-phonon-lang.py (LT-216) carries one voice, its release's
 * default, which it speaks whichever of M1/F1 is chosen.
 */
export function voiceBuffer(buffers, voiceId) {
  const buffer = buffers[`voices/${voiceId}.bin`] ?? buffers['voices/default.bin'];
  if (!buffer) throw new Error(`no voices/${voiceId}.bin and no voices/default.bin`);
  return buffer;
}

// Sampling settings calibrated on the LT-213 bench set (bench/phonon/FINDINGS.md,
// "LT-214 calibration"). DURATION_DELTA slows Phonon from ~16.2 to ~14.3
// characters a second, Supertonic's default rate (14.1); it is also what made
// s18 read cleanly. TEMPERATURE 0.1 tied 0.3 and 0.2 within run-to-run noise
// and had the lowest mean WER; 0.05 was worst and once cut s16 short.
export const TEMPERATURE = 0.1;
export const DURATION_DELTA = 1.0;

// The model card: keep each call to at most ~50 tokens.
const MAX_TOKENS = 50;

/**
 * A call's text as the model is given it: capitalised and closed with a full
 * stop, as the model card's examples are; without the stop Phonon is markedly
 * more likely not to end. A call cut at a comma, semicolon or colon ends with a
 * full stop instead: Phonon es ran on past "en nuestros pensamientos," in 8
 * renders of 8 and stopped cleanly at "pensamientos." in 8 of 8 (LT-216).
 */
function callText(s) {
  const t = s.trim().replace(/\s+/g, ' ').replace(/[,;:]$/, '.');
  return t[0].toUpperCase() + t.slice(1) + (/[\p{L}\p{N}]$/u.test(t) ? '.' : '');
}

/**
 * Split `text` into the calls Phonon speaks, each at most `maxTokens` by
 * `count` (which is given the call's text as the model will see it): clause
 * boundaries first, then words, packed back together while they fit.
 */
export function speechCalls(text, count, maxTokens = MAX_TOKENS) {
  const size = (t) => count(callText(t));
  const clauses = text.split(/(?<=[.!?;:,])\s+/).filter(Boolean).flatMap((c) => {
    if (size(c) <= maxTokens) return [c];
    const out = [];
    let cur = '';
    for (const w of c.split(' ')) {
      if (cur && size(`${cur} ${w}`) > maxTokens) { out.push(cur); cur = w; } else cur = cur ? `${cur} ${w}` : w;
    }
    return cur ? [...out, cur] : out;
  });
  const packed = [];
  for (const c of clauses) {
    const last = packed.at(-1);
    if (last && size(`${last} ${c}`) <= maxTokens) packed[packed.length - 1] = `${last} ${c}`;
    else packed.push(c);
  }
  return packed.map(callText);
}

/**
 * Load Phonon from our own verified cache and return `{ setVoice, speak }`.
 *
 * Every byte comes from `ensureModels` through `env.customCache`, as in
 * translate.worker.mjs: the CDN is blocked by CSP, and a request there would
 * tell a third party which book a reader opened.
 */
async function loadPhonon({ manifestUrl, onProgress }) {
  const buffers = await ensureModels(manifestUrl, onProgress, PHONON_CACHE_NAME);

  const base = new URL(manifestUrl, self.location.href);
  const manifest = await (await fetch(manifestUrl)).json();
  const byPath = new Map(
    manifest.files.map((file) => [new URL(file.path, base).pathname, buffers[file.name]]),
  );
  const dir = new URL('.', base).pathname;                  // /_assets/tts/phonon/
  const repo = dir.split('/').filter(Boolean).at(-1);

  const { AutoConfig, AutoTokenizer, PreTrainedModel, Tensor, env } = await import('@huggingface/transformers');

  env.allowLocalModels = true;
  env.allowRemoteModels = false;
  env.localModelPath = new URL('..', base).pathname;
  env.useBrowserCache = false;
  env.useFSCache = false;
  env.useWasmCache = false;
  env.useCustomCache = true;
  env.customCache = {
    async match(request) {
      const buffer = byPath.get(typeof request === 'string' ? new URL(request, self.location.href).pathname : request);
      return buffer ? new Response(buffer) : undefined;
    },
    async put() {},
  };
  env.backends.onnx.wasm.wasmPaths = ORT_WASM_PATH;
  if (self.crossOriginIsolated) {
    env.backends.onnx.wasm.numThreads = Math.min(MAX_THREADS, navigator.hardwareConcurrency || 1);
  }

  const config = await AutoConfig.from_pretrained(repo);
  const cfg = config.phonon;
  const tokenizer = await AutoTokenizer.from_pretrained(repo);
  // wasm fp32 is the one build (LT-214): q4 and q4f16 were
  // measured worse in LT-213, and WebGPU is a later ticket.
  const flow = await PreTrainedModel.from_pretrained(repo, { config, model_file_name: 'flow_lm', dtype: 'fp32', device: 'wasm' });
  const mimi = await PreTrainedModel.from_pretrained(repo, { config, model_file_name: 'mimi_decoder', dtype: 'fp32', device: 'wasm' });

  // The tokenizer.json declares byte_fallback on its Unigram model, and
  // transformers.js 4.2 ignores it: a character outside the vocabulary becomes
  // <unk>, which Phonon reads as a stutter. Split such pieces into the <0xNN>
  // byte tokens the model was trained to read.
  const unigram = tokenizer._tokenizer.model;
  if (!unigram.byte_fallback) {
    const encodePieces = unigram.encode.bind(unigram);
    unigram.encode = (tokens) => encodePieces(tokens).flatMap((piece) => {
      if (unigram.tokens_to_ids.has(piece)) return [piece];
      const bytes = Array.from(new TextEncoder().encode(piece), (b) => `<0x${b.toString(16).toUpperCase().padStart(2, '0')}>`);
      return bytes.every((b) => unigram.tokens_to_ids.has(b)) ? bytes : [piece];
    });
  }

  const f32 = (dims, data) => new Tensor('float32', data ?? new Float32Array(dims.reduce((a, b) => a * b, 1)), dims);
  const i64 = (values, dims) => new Tensor('int64', BigInt64Array.from(values, BigInt), dims);
  const emptyCache = ({ num_layers, num_heads, head_dim }) => Object.fromEntries(
    Array.from({ length: num_layers }, (_, i) => ['key', 'value']
      .map((k) => [`past_key_values.${i}.${k}`, f32([1, num_heads, 0, head_dim])])).flat());
  const nextState = (outputs) => Object.fromEntries(Object.entries(outputs)
    .filter(([name]) => name.startsWith('present'))
    .map(([name, value]) => [name.replace('present.', 'past_key_values.').replace('present_', 'past_'), value]));
  const runFlow = (past, {
    text = [], voiceLatents = f32([1, cfg.voice_dim, 0]),
    latent = f32([1, 0, cfg.latent_dim]), noise = f32([1, cfg.latent_dim]),
  }) => flow({
    text_ids: i64(text, [1, text.length]), voice_latents: voiceLatents, latent, noise,
    num_speakers: i64([1], [1]), duration_delta: f32([1], Float32Array.of(DURATION_DELTA)), ...past,
  });

  const count = (t) => tokenizer.encode(t, { add_special_tokens: false }).length;

  const randn = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
  let voiceState = null;

  // One call: 80 ms frames until end of speech, or the frame ceiling (eos false).
  async function* speakCall(text) {
    const ids = tokenizer.encode(text, { add_special_tokens: false });
    let state = nextState(await runFlow(voiceState, { text: ids }));
    let codec = { past_offset: i64([0], [1]), ...emptyCache(cfg.mimi_decoder) };
    for (const [name, dims] of Object.entries(cfg.mimi_decoder.conv_states)) codec[name] = f32(dims);
    let latent = f32([1, 1, cfg.latent_dim], new Float32Array(cfg.latent_dim).fill(NaN));
    let countdown = null;
    const ceiling = Math.ceil((ids.length / 3 + 2) * cfg.frame_rate);
    for (let frame = 0; frame < ceiling; frame++) {
      const noise = f32([1, cfg.latent_dim],
        Float32Array.from({ length: cfg.latent_dim }, () => randn() * Math.sqrt(TEMPERATURE)));
      const step = await runFlow(state, { latent, noise });
      [state, latent] = [nextState(step), step.latent_out];
      const decoded = await mimi({ latent, ...codec });
      codec = nextState(decoded);
      yield Float32Array.from(decoded.audio.data);
      if (countdown === null && step.eos_logit.data[0] > cfg.eos_threshold) countdown = text.split(' ').length <= 4 ? 3 : 1;
      if (countdown !== null && countdown-- === 0) return { eos: true };
    }
    return { eos: false };
  }

  return {
    async setVoice(voiceId) {
      const data = new Float32Array(voiceBuffer(buffers, voiceId).slice(0));
      voiceState = nextState(await runFlow(emptyCache(cfg.flow_lm), {
        voiceLatents: f32([1, cfg.voice_dim, data.length / cfg.voice_dim], data),
      }));
    },
    async* speak(text) {
      let eos = true;
      for (const call of speechCalls(text, count)) eos = (yield* speakCall(call)).eos && eos;
      return { eos };
    },
  };
}

export function createHandler({ post, load = loadPhonon }) {
  let loading = null;
  let model = null;
  let queue = Promise.resolve();
  // Ids queued or rendering, and how many times: a cancel for an id that is not
  // here is late (its audio is already sent) and must not be remembered, or it
  // would kill the next request for that id -- a seek back to a sentence.
  const live = new Map();
  const cancelled = new Set();

  const ready = async () => model ?? (model = await (loading ?? Promise.reject(new Error('engine not initialised'))));
  const enqueue = (job) => (queue = queue.then(job, job));

  async function synth({ id, text, stream }) {
    try {
      if (cancelled.has(id)) return;
      const speaker = await ready();
      const result = await renderGuarded(text, (t) => speaker.speak(t), {
        onChunk: stream ? (samples) => post({ type: 'chunk', id, samples, sampleRate: SAMPLE_RATE }) : undefined,
        onReset: stream ? () => post({ type: 'reset', id }) : undefined,
        isCancelled: () => cancelled.has(id),
      });
      if (result.outcome === 'cancelled') return;
      post({ type: 'audio', id, samples: result.samples, sampleRate: SAMPLE_RATE, outcome: result.outcome },
        [result.samples.buffer]);
    } catch (error) {
      post({ type: 'error', id, code: 'ENGINE_ERROR', message: String(error?.message ?? error) });
    } finally {
      const left = live.get(id) - 1;
      if (left > 0) live.set(id, left); else live.delete(id);
      cancelled.delete(id);
    }
  }

  return async function handle(data) {
    switch (data.type) {
      case 'init':
        try {
          loading = load({
            manifestUrl: data.manifestUrl,
            onProgress: (p) => post({ type: 'progress', file: p.file, loaded: p.loaded, total: p.total, phase: p.phase }),
          });
          model = await loading;
          await model.setVoice(VOICES[data.voice] ?? VOICES.M1);
          post({ type: 'ready', provider: 'wasm' });
        } catch (error) {
          post({ type: 'error', code: 'INIT_FAILED', message: String(error?.message ?? error) });
        }
        return;

      case 'synth':
        live.set(data.id, (live.get(data.id) ?? 0) + 1);
        return enqueue(() => synth(data));

      case 'cancel':
        if (live.has(data.id)) cancelled.add(data.id);
        return;

      case 'setVoice':
        return enqueue(async () => {
          try {
            await (await ready()).setVoice(VOICES[data.voice] ?? VOICES.M1);
            post({ type: 'voiceSet', voice: data.voice });
          } catch (error) {
            post({ type: 'error', id: 'voice', code: 'ENGINE_ERROR', message: String(error?.message ?? error) });
          }
        });

      case 'setLang':
        // English only: the reader routes every other language to Supertonic
        // before it gets here, so anything else is a routing bug, said loudly.
        if (data.lang === 'en') post({ type: 'langSet', lang: 'en' });
        else post({ type: 'error', id: 'lang', code: 'UNSUPPORTED_LANG', message: `Phonon speaks English only, not ${data.lang}` });
        return;

      default:
    }
  };
}

// Guarded so importing this module in a test does not require a worker scope.
if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
  const handle = createHandler({ post: (message, transfer) => self.postMessage(message, transfer ?? []) });
  self.onmessage = ({ data }) => handle(data);
}
