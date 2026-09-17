/**
 * See AND hear every equation on a page, side by side with what the voice says.
 *
 * The build reports "N spoken, 0 failed", and that number is blind to the only
 * question that matters: does it sound right? A span converts successfully and
 * still says "1 lines Line 1: six thirds equals 2 period". This is the harness
 * that makes that audible instead of hypothetical.
 *
 *   node scripts/math-audit.mjs --url <page url> [--out demo-out/math-audit]
 *   node scripts/math-audit.mjs --url <page url> --no-audio     (text only, fast)
 *
 * Writes <out>/index.html: one row per equation with the LaTeX, the equation
 * typeset by MathJax, the spoken text, and a play button wired to a WAV
 * rendered by the SAME engine and voice the reader uses -- not a stand-in.
 * Open it, read the middle column, click through the right one.
 *
 * Audio is rendered by driving the deployed translate/engine worker in a real
 * browser, the way scripts/render-sample.mjs does, so what you hear is what a
 * reader hears.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { reviewRows } from './math-review.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).join(' ').split('--').filter(Boolean)
    .map((s) => s.trim().split(/\s+/)).map(([k, v]) => [k, v ?? true]));

const URL_ = args.url;
const OUT = args.out ?? 'demo-out/math-audit';
const VOICE = args.voice ?? 'F1';
const WANT_AUDIO = !args['no-audio'];
// A second opinion, not a second author. See scripts/math-review.mjs for why
// the model never writes the spoken form. --no-review skips it; an unreachable
// model leaves the column blank rather than failing the run.
const WANT_REVIEW = !args['no-review'];
const REVIEW_MODEL = args.model ?? 'gemma4:31b';
if (!URL_) { console.error('need --url <page url>'); process.exit(1); }

const STYLE = `body{font:15px/1.5 -apple-system,system-ui,sans-serif;margin:0 auto;padding:24px;max-width:1200px;color:#111}
 h1{font-size:20px} .meta{color:#555;margin-bottom:18px}
 table{border-collapse:collapse;width:100%} td,th{border-top:1px solid #ddd;padding:10px 8px;vertical-align:top}
 th{text-align:left;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#666}
 code{font:12px/1.4 ui-monospace,Menlo,monospace;color:#444;white-space:pre-wrap;word-break:break-word}
 .said{font-size:15px} .said.bad{background:#fff2f2}
 .n{color:#999;font-size:12px} .d{font-size:11px;color:#888}
 audio{height:32px}
 .v{font-size:12px;white-space:nowrap} .v-good{color:#1a7f37} .v-awkward{color:#9a6700}
 .v-wrong{color:#b42318;font-weight:600} .v-unknown,.v-unavailable{color:#aaa}
 .note{font-size:11px;color:#666;display:block;white-space:normal;max-width:200px}`;

const decode = (token) => Buffer.from(token.slice('[[latex:'.length, -2), 'base64').toString('utf8');

const manifest = await (await fetch(new URL('speech.json', URL_))).json();
const rows = Object.entries(manifest.mathSpeech ?? {}).map(([token, speech], i) => {
  const span = decode(token);
  return {
    i: i + 1,
    display: span.startsWith('\\['),
    tex: span.slice(2, -2).trim(),
    speech,
  };
});
if (!rows.length) { console.error('no mathSpeech on that page'); process.exit(1); }
console.log(`${rows.length} equations; math = ${JSON.stringify(manifest.math)}`);

mkdirSync(OUT, { recursive: true });
// Served under the mirror's CSP (style-src/script-src 'self'), so the page
// carries no inline <style> and no inline <script>.
writeFileSync(join(OUT, 'audit.css'), STYLE);

// --- second opinion from a language model (advisory only) -------------------
if (WANT_REVIEW) {
  const { used, cached, asked } = await reviewRows(rows, REVIEW_MODEL,
    (i, n) => process.stdout.write(`  review ${i}/${n}\r`));
  console.log(used ? `review: ${asked} asked, ${cached} cached (${REVIEW_MODEL})`
                   : `review: ${REVIEW_MODEL} unavailable, column left blank`);
} else {
  for (const row of rows) row.review = { verdict: 'unavailable', note: '' };
}

// --- audio, rendered by the real engine in a real browser ---------------------
if (WANT_AUDIO) {
  const browser = await chromium.launch({ args: ['--enable-features=SharedArrayBuffer'] });
  const page = await browser.newPage();
  await page.goto(URL_, { waitUntil: 'load' });
  console.log(`rendering ${rows.length} clips in voice ${VOICE} (first one loads the 380 MB model)`);

  // One worker for the whole run, driven exactly as scripts/render-sample.mjs
  // drives it -- same engine, same voice, same code path as a reader's.
  const clips = await page.evaluate(async ({ items, voice }) => {
    const worker = new Worker('/_assets/tts/engine.worker.js', { type: 'module' });
    const ready = new Promise((resolve, reject) => {
      worker.addEventListener('message', function onReady({ data }) {
        if (data.type === 'ready') { worker.removeEventListener('message', onReady); resolve(); }
        if (data.type === 'error') reject(new Error(data.message));
      });
      worker.onerror = (e) => reject(new Error(e.message));
    });
    worker.postMessage({ type: 'init', voice, lang: 'en', manifestUrl: '/_assets/tts/manifest.json' });
    await ready;

    const out = [];
    for (const item of items) {
      const audio = await new Promise((resolve, reject) => {
        worker.addEventListener('message', function onAudio({ data }) {
          if (data.type === 'audio' && data.id === item.id) {
            worker.removeEventListener('message', onAudio);
            resolve(data);
          }
          if (data.type === 'error') reject(new Error(data.message));
        });
        worker.postMessage({ type: 'synth', id: item.id, text: item.speech });
      });
      out.push({ id: item.id, samples: Array.from(audio.samples), rate: audio.sampleRate });
    }
    return out;
  }, { items: rows.map((r) => ({ id: String(r.i), speech: r.speech })), voice: VOICE });

  for (const clip of clips) {
    const row = rows[Number(clip.id) - 1];
    writeFileSync(join(OUT, `eq-${clip.id}.wav`), toWav(clip.samples, clip.rate));
    row.wav = `eq-${clip.id}.wav`;
  }
  await browser.close();
}

function toWav(samples, rate) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + samples.length * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((s, i) => buf.writeInt16LE(Math.max(-1, Math.min(1, s)) * 32767, 44 + i * 2));
  return buf;
}

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

writeFileSync(join(OUT, 'index.html'), `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Math audit — ${esc(manifest.title ?? '')}</title>
<script defer src="https://library.libretexts.dev/_assets/mathjax/tex-mml-svg.js"></script>
<link rel="stylesheet" href="audit.css"></head><body>
<h1>Math audit — ${esc(manifest.title ?? '')}</h1>
<div class="meta">${rows.length} equations · spoken ${manifest.math?.spoken ?? '?'} · failed ${manifest.math?.failed ?? '?'}
 · <a href="${esc(URL_)}">page</a><br>
 Read the <b>Said</b> column aloud in your head; play the audio to check it against the voice.
 Rows are highlighted when they still contain wording a person would not say.<br>
 <b>2nd opinion</b> is a local language model's advisory judgement, not a build input &mdash; it is
 wrong often enough to need your ear: small models over-flag with false reasoning, large ones
 rubber-stamp. Treat a flag as a candidate to listen to, never as a defect.</div>
<table><tr><th>#</th><th>Equation</th><th>LaTeX</th><th>Said</th><th>Hear</th><th>2nd opinion</th></tr>
${rows.map((r) => {
  const bad = /\bLine \d|\d+ lines|\bblank\b|period$|\bcomma$|(?:\b[A-Za-z] ){3,}/.test(r.speech);
  return `<tr>
  <td class="n">${r.i}<div class="d">${r.display ? 'display' : 'inline'}</div></td>
  <td>${r.display ? '\\[' : '\\('}${esc(r.tex)}${r.display ? '\\]' : '\\)'}</td>
  <td><code>${esc(r.tex)}</code></td>
  <td class="said${bad ? ' bad' : ''}">${esc(r.speech)}</td>
  <td>${r.wav ? `<audio controls preload="none" src="${r.wav}"></audio>` : '<span class="d">—</span>'}</td>
  <td class="v v-${r.review?.verdict ?? 'unavailable'}">${r.review && r.review.verdict !== 'unavailable' ? esc(r.review.verdict) : ''}
   ${r.review?.note ? `<span class="note">${esc(r.review.note)}</span>` : ''}</td>
 </tr>`;
}).join('\n')}
</table></body></html>
`);
console.log(`wrote ${join(OUT, 'index.html')}`);
