import * as ort from 'onnxruntime-web';
import { ensureModels } from './models.mjs';
import { loadTextToSpeechFromBuffers, loadVoiceStyleFromJson } from './vendor/helper.js';

const STEPS = 8;
const SPEED = 1.0;            // playback rate is applied in Web Audio, not here,
const SILENCE_SECONDS = 0.3;  // so changing speed never re-synthesizes
const MAX_CHARS = 300;

self.ort = ort;
ort.env.wasm.wasmPaths = '/_assets/tts/ort/';
// Threads are what make the timing budget: 0.410 RTF isolated against 0.912 without.
if (self.crossOriginIsolated) ort.env.wasm.numThreads = Math.min(8, navigator.hardwareConcurrency);

let textToSpeech = null;
let style = null;
let lang = 'en';
let manifestUrl = '/_assets/tts/manifest.json';
const cancelled = new Set();

async function loadStyle(voice) {
  const res = await fetch(`/_assets/tts/voice_styles/${voice}.json`);
  if (!res.ok) throw new Error(`voice ${voice} unavailable (${res.status})`);
  return loadVoiceStyleFromJson(await res.json());
}

// Splits on the nearest clause boundary under MAX_CHARS. The model's memory
// use grows with input length, and 300 is upstream's own chunk limit.
function chunk(text) {
  if (text.length <= MAX_CHARS) return [text];
  const out = [];
  let rest = text;
  while (rest.length > MAX_CHARS) {
    const window = rest.slice(0, MAX_CHARS);
    const cut = Math.max(window.lastIndexOf('; '), window.lastIndexOf(', '), window.lastIndexOf(' '));
    const at = cut > 40 ? cut + 1 : MAX_CHARS;
    out.push(rest.slice(0, at).trim());
    rest = rest.slice(at);
  }
  if (rest.trim()) out.push(rest.trim());
  return out;
}

function concat(parts) {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

async function createSessions(buffers, post) {
  const options = { graphOptimizationLevel: 'all' };
  try {
    return {
      ...(await loadTextToSpeechFromBuffers(buffers, { ...options, executionProviders: ['webgpu'] })),
      provider: 'webgpu',
    };
  } catch (webgpuError) {
    // Report WHY, not just that it happened. This catch used to discard the
    // message, and that single omission hid two real defects for weeks: the
    // bundled runtime did not contain the WebGPU backend at all, and once it
    // did, ORT 1.17.3 died calling adapter.requestAdapterInfo(), a method
    // removed from the WebGPU spec. Both looked like "this machine has no GPU".
    //
    // Neither could be seen from outside the worker, because a fallback that
    // works is indistinguishable from a fallback that was never needed.
    const reason = String(webgpuError?.message ?? webgpuError).slice(0, 300);
    post({ type: 'progress', file: `webgpu unavailable, using wasm: ${reason}`,
           loaded: 0, total: 0 });
    return {
      ...(await loadTextToSpeechFromBuffers(buffers, { ...options, executionProviders: ['wasm'] })),
      provider: 'wasm',
    };
  }
}

self.onmessage = async ({ data }) => {
  const post = (msg, transfer) => self.postMessage(msg, transfer ?? []);
  try {
    if (data.type === 'init') {
      lang = data.lang ?? 'en';
      manifestUrl = data.manifestUrl ?? manifestUrl;
      const buffers = await ensureModels(manifestUrl, (p) =>
        post({ type: 'progress', file: p.file, loaded: p.loaded, total: p.total, phase: p.phase }));
      const created = await createSessions(buffers, post);
      textToSpeech = created.textToSpeech;
      style = await loadStyle(data.voice ?? 'M1');
      post({ type: 'ready', provider: created.provider });
      return;
    }

    if (data.type === 'setVoice') {
      style = await loadStyle(data.voice);
      post({ type: 'voiceSet', voice: data.voice });
      return;
    }

    if (data.type === 'setLang') {
      // No fetch and no session rebuild: language is a tag helper.js wraps around
      // the text (`<es>...</es>`), not a model input -- tts.json declares
      // n_langs: 0. So this is genuinely just a variable, unlike setVoice, which
      // loads a ~291 KB style file.
      lang = data.lang;
      post({ type: 'langSet', lang });
      return;
    }

    if (data.type === 'cancel') {
      cancelled.add(data.id);
      return;
    }

    if (data.type === 'synth') {
      if (!textToSpeech) throw new Error('engine not initialised');
      const parts = [];
      for (const piece of chunk(data.text)) {
        if (cancelled.has(data.id)) { cancelled.delete(data.id); return; }
        // call() returns { wav, duration }; wav is a plain Array, not a Float32Array.
        const { wav } = await textToSpeech.call(piece, lang, style, STEPS, SPEED, SILENCE_SECONDS);
        parts.push(Float32Array.from(wav));
      }
      if (cancelled.has(data.id)) { cancelled.delete(data.id); return; }
      const samples = concat(parts);
      post({ type: 'audio', id: data.id, samples, sampleRate: 44100 }, [samples.buffer]);
    }
  } catch (error) {
    post({ type: 'error', id: data.id, code: 'ENGINE_ERROR', message: String(error?.message ?? error) });
  }
};
