/**
 * Record the demo WITH its audio.
 *
 * Playwright captures video and no audio, which for a text-to-speech reader
 * loses the entire product. Rather than reconstruct a soundtrack from the
 * sentence list -- which drifts the moment synthesis stalls -- this taps the
 * page's own AudioContext and records exactly what was played.
 *
 * Two patches, installed before any page script runs:
 *
 *   1. window.AudioContext is pinned to one instance created at document start,
 *      so the player's `new AudioContext()` returns the same graph we are
 *      recording. The MediaRecorder therefore starts within milliseconds of the
 *      video, and records silence until playback begins -- which is what makes
 *      the two tracks line up without any offset arithmetic.
 *   2. AudioBufferSourceNode.connect also connects to a MediaStreamDestination.
 *      The real output to context.destination is untouched, so nothing about
 *      playback changes; the tap is an extra edge in the graph, not a detour.
 *
 *   node scripts/record-demo-av.mjs [--out demo-out] [--profile .demo-av-profile]
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync, readdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).join(' ').split('--').filter(Boolean)
    .map((s) => s.trim().split(/\s+/)).map(([k, v]) => [k, v ?? true]));

const URL = args.url
  ?? 'https://library.libretexts.dev/social_psychology/13%3A_Competition_and_Cooperation_in_Our_Social_Worlds/13.01%3A_Conflict_Cooperation_Morality_and_Fairness/';
const OUT = args.out ?? 'demo-out';
const PROFILE = args.profile ?? '.demo-av-profile';
const SENTENCES = Number(args.sentences ?? 5);

mkdirSync(OUT, { recursive: true });
mkdirSync(PROFILE, { recursive: true });

const context = await chromium.launchPersistentContext(PROFILE, {
  headless: true,
  viewport: { width: 1280, height: 820 },
  args: ['--autoplay-policy=no-user-gesture-required'],
  recordVideo: { dir: OUT, size: { width: 1280, height: 820 } },
});

const page = context.pages()[0] ?? await context.newPage();
const beat = (ms) => page.waitForTimeout(ms);

await page.addInitScript(() => {
  const Native = window.AudioContext || window.webkitAudioContext;
  const ctx = new Native();
  const tap = ctx.createMediaStreamDestination();
  const chunks = [];
  const rec = new MediaRecorder(tap.stream, { mimeType: 'audio/webm;codecs=opus' });
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  rec.start(250);

  window.__tts = { ctx, tap, chunks, rec, marks: [] };

  // Hand the player this exact context, so its sources feed the tap.
  const Pinned = function () { return ctx; };
  Pinned.prototype = Native.prototype;
  window.AudioContext = Pinned;
  window.webkitAudioContext = Pinned;

  // Tap every source without changing where it really goes.
  const connect = AudioBufferSourceNode.prototype.connect;
  AudioBufferSourceNode.prototype.connect = function (target, ...rest) {
    try { connect.call(this, tap); } catch { /* already tapped */ }
    return connect.call(this, target, ...rest);
  };
});

console.log('opening the page');
await page.goto(URL, { waitUntil: 'load' });
await beat(1800);                       // hold on the untouched page

console.log('entering reader mode');
await page.locator('#tts-enter').click();

const dialog = page.locator('.tts-dialog-card').first();
const bar = page.locator('.tts-bar');
const outcome = await Promise.race([
  dialog.waitFor({ state: 'visible', timeout: 60_000 }).then(() => 'consent'),
  bar.waitFor({ state: 'visible', timeout: 60_000 }).then(() => 'warm'),
]);

if (outcome === 'consent') {
  console.log('consent dialog — holding so it is readable, then accepting');
  await beat(4000);
  await page.locator('[data-act="accept"]').click();
}
await bar.waitFor({ timeout: 900_000 });
console.log('engine ready:', await page.locator('[data-act="provider"]').textContent());
await beat(1200);

// Record which sentence was current at which moment, for the report.
await page.evaluate(() => {
  const t0 = performance.now();
  new MutationObserver(() => {
    const id = document.querySelector('.tts-current')?.dataset.ttsId;
    const marks = window.__tts.marks;
    if (id && marks[marks.length - 1]?.id !== id) {
      marks.push({ id, at: +((performance.now() - t0) / 1000).toFixed(2) });
    }
  }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
});

console.log('playing');
await page.locator('[data-act="toggle"]').click();
await page.locator('.tts-current').waitFor({ timeout: 180_000 });

let id = await page.locator('.tts-current').getAttribute('data-tts-id');
for (let i = 0; i < SENTENCES; i += 1) {
  await page.waitForFunction(
    (prev) => document.querySelector('.tts-current')?.dataset.ttsId !== prev, id,
    { timeout: 180_000 });
  id = await page.locator('.tts-current').getAttribute('data-tts-id');
  process.stdout.write(`\r  sentence ${i + 2}/${SENTENCES + 1}: ${id}   `);
}
process.stdout.write('\n');

console.log('seeking by clicking a sentence further down');
const target = page.locator('.tts-sentence').nth(30);
await target.scrollIntoViewIfNeeded();
await beat(800);
await target.click();
await beat(9000);

console.log('exiting');
await page.keyboard.press('Escape');
await beat(1600);

const { audio, marks } = await page.evaluate(async () => {
  const { rec, chunks, marks } = window.__tts;
  await new Promise((resolve) => { rec.onstop = resolve; rec.stop(); });
  const buffer = await new Blob(chunks, { type: 'audio/webm' }).arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return { audio: btoa(binary), marks };
});

const audioPath = join(OUT, 'demo-audio.webm');
writeFileSync(audioPath, Buffer.from(audio, 'base64'));
console.log(`\naudio: ${audioPath} (${(Buffer.from(audio, 'base64').length / 1e6).toFixed(1)} MB)`);
console.log('sentence timeline:', marks.map((m) => `${m.at}s ${m.id}`).join('  '));

await context.close();

const video = readdirSync(OUT).find((f) => f.endsWith('.webm') && f.startsWith('page'));
if (video) {
  const videoPath = join(OUT, 'demo-video.webm');
  renameSync(join(OUT, video), videoPath);
  console.log(`video: ${videoPath}`);
  console.log(`\nmux with:\n  ffmpeg -y -i ${videoPath} -i ${audioPath} -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest ${join(OUT, 'demo.mp4')}`);
}
