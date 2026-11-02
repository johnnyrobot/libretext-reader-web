// THROWAWAY SPIKE (LT-219). Check the listening page's Save MP3 in Chrome, the way a
// person uses it: type a sentence, press Play, press Save, keep the download. Also
// keeps the raw render of each sentence, for score.py to compare against the MP3.
//
//   node bench/phonon/lt219/check-save.mjs [--base http://127.0.0.1:8820] [--out DIR] [en fr de es pt]
//
// Fails (exit 1) unless Save is off during a render and Play during a Save, and every
// saved file is phonon-<lang>.mp3, 24000 Hz mono 112 kbps MPEG-2 Layer III within 0.1 s
// of its render, plays in Chrome and in afplay, and the encoder was fetched once, on
// the first Save and not before.
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { mp3Frames, mp3Seconds } from './mp3-frames.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(name);
  return at === -1 ? fallback : args.splice(at, 2)[1];
};
const base = flag('--base', 'http://127.0.0.1:8820');
const out = path.resolve(flag('--out', '/Users/Shared/LT-216/work/lt219'));
const langs = args.length ? args : ['en', 'fr', 'de', 'es', 'pt'];
const WITHIN = 0.1;          // seconds an MP3 may differ from its render (LT-219)
const KBPS = 112;            // what Save writes (LT-219: the Chief's 22:10 PT decision)
const SAVE_MS = 120_000;     // longest a Save may take

// The LT-216 test set. Its English column has only p00; s01-s11 were translated from
// the prose, numbers and dates items of bench/phonon/out/sentences.json, in order, so
// English speaks those.
const set = JSON.parse(readFileSync(new URL('../lt216/sentences.json', import.meta.url)));
const english = JSON.parse(readFileSync(new URL('../out/sentences.json', import.meta.url)))
  .filter((s) => ['prose', 'numbers', 'dates'].includes(s.category));
const itemsFor = (lang) => set.items.map((item, i) => ({
  id: item.id,
  text: lang === 'en' && i > 0 ? english[i - 1].speech : item[lang],
}));

function wav(int16, sampleRate) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + int16.length, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36);
  header.writeUInt32LE(int16.length, 40);
  return Buffer.concat([header, int16]);
}

/** What macOS's own audio stack reads in the file. */
function afinfo(file) {
  const text = execFileSync('afinfo', [file]).toString();
  return {
    format: /File type ID:\s+MPG3/.test(text),
    mono24k: /1 ch,\s+24000 Hz/.test(text),
    bitRate: Number(text.match(/bit rate: (\d+)/)?.[1]),
    seconds: Number(text.match(/estimated duration: ([\d.]+)/)?.[1]),
  };
}

const problems = [];
const check = (ok, what) => { if (!ok) { problems.push(what); console.error(`  FAIL ${what}`); } };
const results = [];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const lang of langs) {
    const dir = path.join(out, lang);
    mkdirSync(dir, { recursive: true });
    const page = await browser.newPage({ acceptDownloads: true });
    page.on('pageerror', (error) => console.error(`  [${lang}] page error: ${error.message}`));
    const encoderFetches = [];
    page.on('request', (request) => { if (request.url().endsWith('/lame.min.js')) encoderFetches.push(request.url()); });
    await page.goto(`${base}/social_psychology/listen-lt216/?lang=${lang}`);
    check(await page.textContent('#save') === 'Save MP3', `${lang}: the button reads "Save MP3"`);
    const rows = [];
    let savesTried = 0;
    for (const { id, text } of itemsFor(lang)) {
      await page.fill('#text', text);
      // Click and read the other button in one go, so a fast step cannot finish first.
      const saveOff = await page.evaluate(() => { document.getElementById('play').click(); return document.getElementById('save').disabled; });
      check(saveOff, `${lang} ${id}: Save is off while the voice renders`);
      await page.waitForFunction(() => !document.getElementById('play').disabled
        && !/^Speaking|^Loading/.test(document.getElementById('status').textContent), null, { timeout: 600_000 });
      const said = await page.textContent('#status');
      if (said !== 'Done.') { check(false, `${lang} ${id}: render ended "${said}"`); continue; }
      check(encoderFetches.length === (savesTried ? 1 : 0), `${lang} ${id}: encoder fetched ${encoderFetches.length} times before Save`);
      const raw = await page.evaluate(() => {
        const { samples, sampleRate } = window.lt216.last;
        const pcm = new Int16Array(samples.length);
        samples.forEach((s, i) => { pcm[i] = Math.max(-1, Math.min(1, s)) * 0x7fff; });
        let binary = '';
        const bytes = new Uint8Array(pcm.buffer);
        for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return { pcm: btoa(binary), sampleRate, seconds: samples.length / sampleRate };
      });
      writeFileSync(path.join(dir, `${id}.wav`), wav(Buffer.from(raw.pcm, 'base64'), raw.sampleRate));
      await page.evaluate(() => { (window.lt219renders ??= []).push(window.lt216.last.samples); });

      // A Save that fails shows "Could not make the MP3" and downloads nothing.
      const download = page.waitForEvent('download', { timeout: SAVE_MS }).catch(() => null);
      const playOff = await page.evaluate(() => { document.getElementById('save').click(); return document.getElementById('play').disabled; });
      savesTried++;
      check(playOff, `${lang} ${id}: Play is off while the MP3 is made`);
      await page.waitForFunction(() => /^Saved|^Could not/.test(document.getElementById('status').textContent),
        null, { timeout: SAVE_MS });
      if (/^Could not/.test(await page.textContent('#status'))) {
        check(false, `${lang} ${id}: ${await page.textContent('#status')}`);
        continue;
      }
      const saved = await download;
      if (!saved) { check(false, `${lang} ${id}: no download`); continue; }
      check(saved.suggestedFilename() === `phonon-${lang}.mp3`, `${lang} ${id}: saved as ${saved.suggestedFilename()}`);
      const file = path.join(dir, `${id}.mp3`);
      await saved.saveAs(file);
      const save = await page.evaluate(() => window.lt216.saves.at(-1));

      const bytes = readFileSync(file);
      const frames = mp3Frames(bytes);
      const seconds = mp3Seconds(frames);
      check(frames.every((f) => f.version === 2 && f.sampleRate === 24000 && f.kbps === KBPS && f.mono),
        `${lang} ${id}: every frame MPEG-2, 24000 Hz, ${KBPS} kbps, mono`);
      check(Math.abs(seconds - raw.seconds) <= WITHIN, `${lang} ${id}: MP3 ${seconds.toFixed(3)} s vs render ${raw.seconds.toFixed(3)} s`);
      const mac = afinfo(file);
      check(mac.format && mac.mono24k && mac.bitRate === KBPS * 1000 && Math.abs(mac.seconds - raw.seconds) <= WITHIN,
        `${lang} ${id}: afinfo ${JSON.stringify(mac)}`);

      // Chrome plays it back: the page decodes it, and the file opened in Chrome, as a
      // person would open the download, starts and advances.
      const decodedSeconds = await page.evaluate(async (b64) => {
        const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        return (await new OfflineAudioContext(1, 1, 24000).decodeAudioData(data.buffer)).duration;
      }, bytes.toString('base64'));
      const viewer = await browser.newPage();
      await viewer.goto(pathToFileURL(file).href);
      const chrome = await viewer.evaluate(async () => {
        const media = document.querySelector('video, audio');
        media.muted = true;
        if (media.readyState < 1) await new Promise((resolve, reject) => { media.onloadedmetadata = resolve; media.onerror = () => reject(new Error('media error')); });
        await media.play();
        await new Promise((resolve) => setTimeout(resolve, 400));
        return { elementSeconds: media.duration, played: media.currentTime };
      });
      await viewer.close();
      chrome.decodedSeconds = decodedSeconds;
      check(Math.abs(chrome.decodedSeconds - raw.seconds) <= WITHIN && chrome.played > 0,
        `${lang} ${id}: Chrome ${JSON.stringify(chrome)}`);

      rows.push({ id, text, seconds: raw.seconds, mp3Seconds: seconds, mp3Bytes: bytes.length,
        wavBytes: 44 + raw.seconds * raw.sampleRate * 2, encodeMs: save.encodeMs, chrome, afinfo: mac });
      console.log(`  ${lang} ${id}: ${raw.seconds.toFixed(2)} s, MP3 ${seconds.toFixed(2)} s ${(bytes.length / 1e3).toFixed(0)} kB, ` +
        `encoded in ${save.encodeMs.toFixed(0)} ms${rows.length === 1 ? ' (first Save: includes fetching the encoder)' : ''}`);
    }
    check(encoderFetches.length === 1, `${lang}: encoder fetched ${encoderFetches.length} times in all`);
    if (!rows.length) { await page.close(); continue; }

    // A minute or more of this language's speech, encoded in one go by the warm Worker.
    const long = await page.evaluate(async () => {
      const parts = window.lt219renders;
      const all = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
      parts.reduce((at, p) => (all.set(p, at), at + p.length), 0);
      const { mp3, encodeMs } = await window.lt216.encodeMp3(all, window.lt216.last.sampleRate);
      return { seconds: all.length / window.lt216.last.sampleRate, encodeMs, bytes: mp3.size };
    });
    const totalSeconds = rows.reduce((sum, r) => sum + r.seconds, 0);
    const warm = rows.slice(1);
    const perMinute = (key) => warm.reduce((sum, r) => sum + r[key], 0) / (warm.reduce((sum, r) => sum + r.seconds, 0) / 60);
    const summary = { lang, items: rows.length, seconds: totalSeconds, load1: loadavg()[0],
      firstSaveMs: rows[0]?.encodeMs, encodeMsPerMinute: perMinute('encodeMs'),
      long: { ...long, msPerMinute: long.encodeMs / (long.seconds / 60) },
      mp3MBPerMinute: perMinute('mp3Bytes') / 1e6, wavMBPerMinute: perMinute('wavBytes') / 1e6 };
    writeFileSync(path.join(dir, 'texts.json'), JSON.stringify(Object.fromEntries(rows.map((r) => [r.id, r.text])), null, 1));
    writeFileSync(path.join(dir, 'save.json'), JSON.stringify({ summary, rows }, null, 1));
    results.push(summary);
    console.log(`${lang}: ${rows.length} saves, ${summary.encodeMsPerMinute.toFixed(0)} ms to encode a minute (warm saves), ` +
      `${summary.long.msPerMinute.toFixed(0)} ms/min in one ${long.seconds.toFixed(0)} s encode, ` +
      `MP3 ${summary.mp3MBPerMinute.toFixed(3)} MB/min vs WAV ${summary.wavMBPerMinute.toFixed(3)} MB/min, load avg ${summary.load1.toFixed(1)}`);
    await page.close();
  }
} finally {
  await browser.close();
}

// macOS plays one file per language out loud at volume 0, for half a second.
for (const lang of langs) {
  try {
    execFileSync('afplay', ['-v', '0', '-t', '0.5', path.join(out, lang, 'p00.mp3')]);
  } catch (error) {
    check(false, `${lang}: afplay failed: ${error.message}`);
  }
}
writeFileSync(path.join(out, 'summary.json'), JSON.stringify({ results, problems }, null, 1));
if (problems.length) {
  console.error(`${problems.length} problems`);
  process.exit(1);
}
console.log('all checks passed');
