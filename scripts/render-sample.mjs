/**
 * Render the first few sentences of a live page to a WAV file.
 *
 * This exists because the video half of a demo cannot carry the product:
 * Playwright records no audio, and this feature IS audio. Run this to get a
 * file you can actually listen to, or drop into a recording.
 *
 *   node scripts/render-sample.mjs [--sentences 6] [--voice M1] [--out demo-out/sample.wav]
 *
 * It drives the deployed worker in a real browser, so what comes out is what a
 * reader hears -- not a separate code path that might diverge.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).join(' ').split('--').filter(Boolean)
    .map((s) => s.trim().split(/\s+/)).map(([k, v]) => [k, v ?? true]));

const URL = args.url
  ?? 'https://library.libretexts.dev/social_psychology/13%3A_Competition_and_Cooperation_in_Our_Social_Worlds/13.01%3A_Conflict_Cooperation_Morality_and_Fairness/';
const COUNT = Number(args.sentences ?? 6);
const VOICE = args.voice ?? 'M1';
const OUT = args.out ?? 'demo-out/sample.wav';

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(URL, { waitUntil: 'load' });

const sentences = await page.evaluate(async (count) => {
  const manifest = await (await fetch('speech.json')).json();
  return manifest.blocks
    .flatMap((b) => b.sentences)
    .filter((s) => s.display)
    .slice(0, count)
    .map((s) => ({ id: s.id, speech: s.speech, display: s.display }));
}, COUNT);

console.log(`rendering ${sentences.length} sentences in voice ${VOICE}:`);
for (const s of sentences) console.log(`  ${s.id}  ${s.display.replace(/\s+/g, ' ').slice(0, 78)}`);

const { samples, sampleRate } = await page.evaluate(async ({ items, voice }) => {
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

  const chunks = [];
  let rate = 44100;
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
    rate = audio.sampleRate;
    chunks.push(Array.from(audio.samples));
  }
  return { samples: chunks.flat(), sampleRate: rate };
}, { items: sentences, voice: VOICE });

// 16-bit PCM WAV.
const pcm = Buffer.alloc(samples.length * 2);
for (let i = 0; i < samples.length; i += 1) {
  pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), i * 2);
}
const header = Buffer.alloc(44);
header.write('RIFF', 0);
header.writeUInt32LE(36 + pcm.length, 4);
header.write('WAVE', 8);
header.write('fmt ', 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);            // PCM
header.writeUInt16LE(1, 22);            // mono
header.writeUInt32LE(sampleRate, 24);
header.writeUInt32LE(sampleRate * 2, 28);
header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34);
header.write('data', 36);
header.writeUInt32LE(pcm.length, 40);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, Buffer.concat([header, pcm]));
console.log(`\nwrote ${OUT} — ${(samples.length / sampleRate).toFixed(1)}s, ${sampleRate} Hz`);
await browser.close();
