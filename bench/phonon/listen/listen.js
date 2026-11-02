// THROWAWAY SPIKE (LT-216). A listening page for Phonon's translation voices:
// pick a language, press Play, hear src/phonon.worker.mjs speak it in this
// browser from the files scripts/stage-phonon-lang.py staged. Not part of the
// reader.
//
// It also keeps what it measured on `window.lt216`, which
// bench/phonon/lt216/measure.mjs reads. measure.mjs --voice asks for a voice
// by its file name (LT-222), M1 when it names none.

const WORKER = '/_assets/tts/phonon.worker.js';
const NC = 'Phonon by Gradium, CC BY-NC 4.0. Voices: Phonon by Gradium, phonon-voices, Apache 2.0. Demo use only.';

// The opening sentence of Social Psychology, chapter 1, as the Chief's
// reference clips (rendered by Ollama, 2026-11-01 17:58 PT) speak it.
export const LANGS = {
  en: { name: 'English (Phonon 31M)', manifest: '/_assets/tts/phonon/manifest.json',
    credit: 'Phonon 31M by Gradium, Apache 2.0.',
    text: 'Social psychology is the scientific study of how we feel about, think about, and behave toward the other people around us, and how those people influence our thoughts, feelings, and behavior.' },
  fr: { name: 'Français (Phonon 40M)', manifest: '/_assets/tts/phonon-fr/manifest.json', credit: NC,
    text: "La psychologie sociale est l'étude scientifique de la manière dont nous ressentons, pensons et nous comportons envers les personnes qui nous entourent et de la manière dont ces personnes influencent nos pensées, nos sentiments et notre comportement." },
  de: { name: 'Deutsch (Phonon 40M)', manifest: '/_assets/tts/phonon-de/manifest.json', credit: NC,
    text: 'Die Sozialpsychologie ist die wissenschaftliche Untersuchung dessen, wie wir gegenüber den Menschen um uns herum fühlen, denken und uns verhalten und wie diese Menschen unsere Gedanken, Gefühle und unser Verhalten beeinflussen.' },
  es: { name: 'Español (Phonon 40M)', manifest: '/_assets/tts/phonon-es/manifest.json', credit: NC,
    text: 'La psicología social es el estudio científico de cómo sentimos, pensamos y nos comportamos hacia las demás personas que nos rodean, y de cómo esas personas influyen en nuestros pensamientos, sentimientos y comportamiento.' },
  pt: { name: 'Português (Phonon 40M)', manifest: '/_assets/tts/phonon-pt/manifest.json', credit: NC,
    text: 'A psicologia social é o estudo científico de como sentimos, pensamos e nos comportamos em relação às outras pessoas ao nosso redor e de como essas pessoas influenciam nossos pensamentos, sentimentos e comportamento.' },
};

const $ = (id) => document.getElementById(id);
const engines = new Map();   // lang -> Promise<{ worker, loadMs, bytes }>
let audio = null;            // { ctx, sources, next }
let nextId = 0;
let stopCurrent = null;      // ends the run being spoken, for the Stop button
const lt216 = (window.lt216 = { runs: [], last: null });

function startEngine(lang, voice) {
  if (engines.has(lang)) return engines.get(lang);
  const worker = new Worker(WORKER, { type: 'module' });
  const started = performance.now();
  const ready = new Promise((resolve, reject) => {
    const progress = new Map();
    worker.addEventListener('message', function onInit({ data }) {
      if (data.type === 'progress') {
        progress.set(data.file, [data.loaded ?? 0, data.total ?? 0]);
        const [got, all] = [...progress.values()].reduce(([a, b], [c, d]) => [a + c, b + d], [0, 0]);
        if (all) status(`Loading ${LANGS[lang].name}: ${(got / 1e6).toFixed(0)} of ${(all / 1e6).toFixed(0)} MB`);
      } else if (data.type === 'ready') {
        worker.removeEventListener('message', onInit);
        const bytes = [...progress.values()].reduce((sum, [, total]) => sum + total, 0);
        resolve({ worker, loadMs: performance.now() - started, bytes, voice });
      } else if (data.type === 'error' && !data.id) {
        worker.removeEventListener('message', onInit);
        reject(new Error(data.message));
      }
    });
  });
  worker.postMessage({ type: 'init', voice, lang, manifestUrl: LANGS[lang].manifest });
  engines.set(lang, ready);
  ready.catch(() => engines.delete(lang));
  return ready;
}

function stopAudio() {
  if (!audio) return;
  for (const s of audio.sources) s.stop();
  audio.ctx.close();
  audio = null;
}

function playChunk(samples, sampleRate) {
  if (!audio) audio = { ctx: new AudioContext({ sampleRate }), sources: [], next: 0 };
  const { ctx } = audio;
  const buffer = ctx.createBuffer(1, samples.length, sampleRate);
  buffer.copyToChannel(samples, 0);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  audio.next = Math.max(audio.next, ctx.currentTime + 0.05);
  source.start(audio.next);
  audio.next += buffer.duration;
  audio.sources.push(source);
}

/** Switch `engine` to `voice`, once the worker says it has. */
function useVoice(engine, voice) {
  if (engine.voice === voice) return Promise.resolve();
  return new Promise((resolve, reject) => {
    engine.worker.addEventListener('message', function onVoice({ data }) {
      if (data.type === 'voiceSet' && data.voice === voice) {
        engine.worker.removeEventListener('message', onVoice);
        engine.voice = voice;
        resolve();
      } else if (data.type === 'error' && data.id === 'voice') {
        engine.worker.removeEventListener('message', onVoice);
        reject(new Error(data.message));
      }
    });
    engine.worker.postMessage({ type: 'setVoice', voice });
  });
}

/** Speak `text` in `lang`, streaming it to the speakers; resolves with what was measured. */
export async function speak(lang, text, { mute = false, voice = 'M1' } = {}) {
  const coldStart = !engines.has(lang);
  // Stop while the model is still loading: nothing is rendering yet, so just don't start.
  let stoppedLoading = false;
  stopCurrent = () => { stoppedLoading = true; stopCurrent = null; };
  const engine = await startEngine(lang, voice);
  const { worker, loadMs, bytes } = engine;
  if (stoppedLoading) return { lang, text, outcome: 'stopped' };
  await useVoice(engine, voice);
  // And again: Stop may have come while the worker was switching voice.
  if (stoppedLoading) return { lang, text, outcome: 'stopped' };
  stopAudio();
  const id = `lt216-${nextId++}`;
  const sent = performance.now();
  let firstSoundMs = null;
  return new Promise((resolve, reject) => {
    // A cancelled sentence gets no reply from the worker, so Stop settles the run itself.
    stopCurrent = () => {
      worker.removeEventListener('message', onSynth);
      worker.postMessage({ type: 'cancel', id });
      stopAudio();
      stopCurrent = null;
      resolve({ lang, text, outcome: 'stopped' });
    };
    worker.addEventListener('message', onSynth);
    function onSynth({ data }) {
      if (data.id !== id) return;
      if (data.type === 'chunk') {
        firstSoundMs ??= performance.now() - sent;
        if (!mute) playChunk(data.samples, data.sampleRate);
      } else if (data.type === 'reset') {
        stopAudio();
        firstSoundMs = null;
      } else if (data.type === 'audio') {
        worker.removeEventListener('message', onSynth);
        stopCurrent = null;
        const renderMs = performance.now() - sent;
        const seconds = data.samples.length / data.sampleRate;
        const run = { lang, text, coldStart, loadMs: coldStart ? loadMs : null, bytes, firstSoundMs, renderMs,
          seconds, rtf: renderMs / 1000 / seconds, outcome: data.outcome, at: new Date().toISOString() };
        lt216.runs.push(run);
        lt216.last = { ...run, samples: data.samples, sampleRate: data.sampleRate };
        resolve(run);
      } else if (data.type === 'error') {
        worker.removeEventListener('message', onSynth);
        stopCurrent = null;
        reject(new Error(data.message));
      }
    }
    worker.postMessage({ type: 'synth', id, text, stream: true });
  });
}
lt216.speak = speak;

function wav(samples, sampleRate) {
  const out = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const put = (at, s) => [...s].forEach((c, i) => out.setUint8(at + i, c.charCodeAt(0)));
  put(0, 'RIFF'); out.setUint32(4, 36 + samples.length * 2, true); put(8, 'WAVEfmt ');
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true);
  out.setUint32(24, sampleRate, true); out.setUint32(28, sampleRate * 2, true);
  out.setUint16(32, 2, true); out.setUint16(34, 16, true); put(36, 'data'); out.setUint32(40, samples.length * 2, true);
  samples.forEach((s, i) => out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s)) * 0x7fff, true));
  return new Blob([out], { type: 'audio/wav' });
}

const status = (text) => { $('status').textContent = text; };

function showStats(run) {
  const rows = [
    ['First sound', `${(run.firstSoundMs / 1000).toFixed(2)} s after Play`],
    ['Speed (RTF)', `${run.rtf.toFixed(2)} (render ${(run.renderMs / 1000).toFixed(1)} s for ${run.seconds.toFixed(1)} s of speech)`],
    ['Model download', `${(run.bytes / 1e6).toFixed(0)} MB${run.loadMs ? `, loaded in ${(run.loadMs / 1000).toFixed(1)} s` : ''}`],
  ];
  $('stats').replaceChildren(...rows.flatMap(([k, v]) => {
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = v;
    return [dt, dd];
  }));
}

function choose(lang) {
  $('text').value = LANGS[lang].text;
  $('text').lang = lang;
  $('credit').textContent = LANGS[lang].credit;
}

addEventListener('DOMContentLoaded', () => {
  for (const [code, { name }] of Object.entries(LANGS)) $('lang').add(new Option(name, code));
  const asked = new URLSearchParams(location.search).get('lang');
  $('lang').value = Object.hasOwn(LANGS, asked ?? '') ? asked : 'fr';
  choose($('lang').value);
  $('lang').addEventListener('change', () => choose($('lang').value));
  $('play').addEventListener('click', async () => {
    const lang = $('lang').value;
    $('play').disabled = true; $('stop').disabled = false;
    status(`Speaking ${LANGS[lang].name}…`);
    try {
      const run = await speak(lang, $('text').value);
      if (run.outcome === 'stopped') { status('Stopped.'); return; }
      status(run.outcome === 'skipped' ? 'The voice could not finish this text.' : 'Done.');
      showStats(run);
      $('save').disabled = false;
    } catch (error) {
      status(`Something went wrong: ${error.message}`);
    } finally {
      $('play').disabled = false;
    }
  });
  // The render finishes well before its audio does: after it, Stop just silences.
  $('stop').addEventListener('click', () => { (stopCurrent ?? stopAudio)(); $('stop').disabled = true; });
  $('save').addEventListener('click', () => {
    const { samples, sampleRate, lang } = lt216.last;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(wav(samples, sampleRate));
    a.download = `phonon-${lang}.wav`;
    a.click();
  });
});
