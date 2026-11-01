// THROWAWAY SPIKE (LT-213). Phonon 31m-en in a module worker on Transformers.js
// 4.2.0, following the "Streaming without the pipeline" loop on the
// onnx-community/phonon-31m-en-ONNX model card (bench/assets/phonon/onnx-community/
// README.md). transformers.min.js is the build with ONNX Runtime 1.26 bundled in,
// because a module worker cannot use an import map for the web build's bare
// specifiers. This is NOT the shipped engine (src/engine.worker.mjs, ORT 1.17.3).
//
// Messages in:  {type:'init', device:'webgpu'|'wasm', dtype:'fp32'|'q4'|'q4f16', voice:'default'}
//               {type:'synth', id, text}
// Messages out: {type:'ready', provider, load_s, threads}
//               {type:'first', id}                       first 80 ms frame exists
//               {type:'audio', id, samples, sampleRate, chunks, tokens}
//               {type:'error', message}
import { AutoConfig, AutoTokenizer, PreTrainedModel, Tensor, env }
  from '/node_modules/@huggingface/transformers/dist/transformers.min.js';

const REPO = 'onnx-community';            // resolved under env.localModelPath
const MAX_TOKENS = 50;                    // the card: keep each call to at most ~50 tokens
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = '/bench/assets/phonon/';
env.backends.onnx.wasm.wasmPaths = '/node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist/';
if (self.crossOriginIsolated) env.backends.onnx.wasm.numThreads = Math.min(8, navigator.hardwareConcurrency);

let cfg, tokenizer, flow, mimi, voiceState, device;

const f32 = (dims, data) => new Tensor('float32', data ?? new Float32Array(dims.reduce((a, b) => a * b, 1)), dims);
const i64 = (values, dims) => new Tensor('int64', BigInt64Array.from(values, BigInt), dims);
const emptyCache = ({ num_layers, num_heads, head_dim }) => Object.fromEntries(
  Array.from({ length: num_layers }, (_, i) => ['key', 'value'].map((k) => [`past_key_values.${i}.${k}`, f32([1, num_heads, 0, head_dim])])).flat());
const nextState = (outputs) => Object.fromEntries(Object.entries(outputs)
  .filter(([name]) => name.startsWith('present'))
  .map(([name, value]) => [name.replace('present.', 'past_key_values.').replace('present_', 'past_'), value]));
const release = (...states) => states.forEach((s) => Object.values(s).forEach((t) => t?.location === 'gpu-buffer' && t.dispose()));
const runFlow = (past, { text = [], voiceLatents = f32([1, cfg.voice_dim, 0]), latent = f32([1, 0, cfg.latent_dim]), noise = f32([1, cfg.latent_dim]) }) =>
  flow({ text_ids: i64(text, [1, text.length]), voice_latents: voiceLatents, latent, noise, num_speakers: i64([1], [1]), duration_delta: f32([1]), ...past });

const prep = (s) => {
  let t = s.trim().replace(/\s+/g, ' ');
  return t[0].toUpperCase() + t.slice(1) + (/[\p{L}\p{N}]$/u.test(t) ? '.' : '');
};
const count = (t) => tokenizer.encode(prep(t), { add_special_tokens: false }).length;

// Split text into calls of at most MAX_TOKENS: sentence and clause boundaries
// first, then words. The shipped engine's equivalent is chunk() at MAX_CHARS=300.
function chunks(text) {
  const clauses = text.split(/(?<=[.!?;:,])\s+/).flatMap((c) => {
    if (count(c) <= MAX_TOKENS) return [c];
    const out = [];
    let cur = '';
    for (const w of c.split(' ')) {
      if (cur && count(`${cur} ${w}`) > MAX_TOKENS) { out.push(cur); cur = w; } else cur = cur ? `${cur} ${w}` : w;
    }
    return cur ? [...out, cur] : out;
  });
  const packed = [];
  for (const c of clauses) {
    const last = packed.at(-1);
    if (last && count(`${last} ${c}`) <= MAX_TOKENS) packed[packed.length - 1] = `${last} ${c}`;
    else packed.push(c);
  }
  return packed;
}

async function* speak(sentence, temperature = cfg.temperature) {
  const text = prep(sentence);
  const ids = tokenizer.encode(text, { add_special_tokens: false });
  let state = nextState(await runFlow(voiceState, { text: ids }));
  let codec = { past_offset: i64([0], [1]), ...emptyCache(cfg.mimi_decoder) };
  for (const [name, dims] of Object.entries(cfg.mimi_decoder.conv_states)) codec[name] = f32(dims);
  let latent = f32([1, 1, cfg.latent_dim], new Float32Array(cfg.latent_dim).fill(NaN));
  const randn = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
  let countdown = null;
  try {
    for (let frame = 0; frame < Math.ceil((ids.length / 3 + 2) * cfg.frame_rate); frame++) {
      const noise = f32([1, cfg.latent_dim], Float32Array.from({ length: cfg.latent_dim }, () => randn() * Math.sqrt(temperature)));
      const step = await runFlow(state, { latent, noise });
      release(state, { latent });
      [state, latent] = [nextState(step), step.latent_out];
      const decoded = await mimi({ latent, ...codec });
      release(codec);
      codec = nextState(decoded);
      const audio = decoded.audio.location === 'gpu-buffer' ? await decoded.audio.getData() : decoded.audio.data;
      yield audio;
      if (countdown === null && step.eos_logit.data[0] > cfg.eos_threshold) countdown = text.split(' ').length <= 4 ? 3 : 1;
      if (countdown !== null && countdown-- === 0) break;
    }
  } finally {
    release(state, codec, { latent });
  }
}

async function init({ device: d, dtype, voice = 'default' }) {
  const t0 = performance.now();
  device = d;
  const config = await AutoConfig.from_pretrained(REPO);
  cfg = config.phonon;
  const onGpu = (names) => (device === 'webgpu' ? { session_options: { preferredOutputLocation: Object.fromEntries(names.map((n) => [n, 'gpu-buffer'])) } } : {});
  const caches = ({ num_layers }) => Array.from({ length: num_layers }, (_, i) => [`present.${i}.key`, `present.${i}.value`]).flat();
  const convStates = Object.keys(cfg.mimi_decoder.conv_states).map((n) => n.replace('past_', 'present_'));
  tokenizer = await AutoTokenizer.from_pretrained(REPO);
  flow = await PreTrainedModel.from_pretrained(REPO, { config, model_file_name: 'flow_lm', dtype, device, ...onGpu(['latent_out', ...caches(cfg.flow_lm)]) });
  mimi = await PreTrainedModel.from_pretrained(REPO, { config, model_file_name: 'mimi_decoder', dtype, device, ...onGpu([...caches(cfg.mimi_decoder), ...convStates]) });
  const unigram = tokenizer._tokenizer.model;
  if (!unigram.byte_fallback) {
    const encodePieces = unigram.encode.bind(unigram);
    unigram.encode = (tokens) => encodePieces(tokens).flatMap((piece) => {
      if (unigram.tokens_to_ids.has(piece)) return [piece];
      const bytes = Array.from(new TextEncoder().encode(piece), (b) => `<0x${b.toString(16).toUpperCase().padStart(2, '0')}>`);
      return bytes.every((b) => unigram.tokens_to_ids.has(b)) ? bytes : [piece];
    });
  }
  const data = new Float32Array(await (await fetch(`/bench/assets/phonon/onnx-community/voices/${voice}.bin`)).arrayBuffer());
  voiceState = nextState(await runFlow(emptyCache(cfg.flow_lm), { voiceLatents: f32([1, cfg.voice_dim, data.length / cfg.voice_dim], data) }));
  return { load_s: (performance.now() - t0) / 1000 };
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'init') {
      const { load_s } = await init(data);
      self.postMessage({ type: 'ready', provider: device, load_s, threads: env.backends.onnx.wasm.numThreads });
    } else if (data.type === 'synth') {
      const parts = [];
      let first = false;
      const pieces = chunks(data.text);
      for (const piece of pieces) {
        for await (const pcm of speak(piece)) {
          if (!first) { first = true; self.postMessage({ type: 'first', id: data.id }); }
          parts.push(Float32Array.from(pcm));
        }
      }
      const samples = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
      parts.reduce((o, p) => (samples.set(p, o), o + p.length), 0);
      self.postMessage({ type: 'audio', id: data.id, samples, sampleRate: 24000, chunks: pieces.length,
                         tokens: pieces.map((p) => count(p)) }, [samples.buffer]);
    }
  } catch (e) {
    self.postMessage({ type: 'error', message: String(e?.stack ?? e?.message ?? e).slice(0, 1500) });
  }
};
