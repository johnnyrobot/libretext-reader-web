// THROWAWAY SPIKE (LT-216). Speak the test set through the listening page in Chrome and keep the
// audio and timings, for score.py to check with Whisper.
//
//   node bench/phonon/lt216/measure.mjs [--base http://127.0.0.1:8820] [--out DIR] [fr de es pt en]
//
// One fresh Chrome per language, so its cold load and memory are its own. The
// first item is spoken twice: the first time includes the model load (the cold
// first sound), the second is the warm figure the bar is about.
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(name);
  return at === -1 ? fallback : args.splice(at, 2)[1];
};
const base = flag('--base', 'http://127.0.0.1:8820');
const out = flag('--out', '/Users/Shared/LT-216/work/measure');
const langs = args.length ? args : ['fr', 'de', 'es', 'pt', 'en'];
const set = JSON.parse(readFileSync(new URL('./sentences.json', import.meta.url)));

/** Resident memory of a process and all its descendants, in bytes. */
function treeRss(root) {
  const rows = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,rss=']).toString().trim().split('\n')
    .map((line) => line.trim().split(/\s+/).map(Number));
  const kids = new Map();
  for (const [pid, ppid] of rows) kids.set(ppid, [...(kids.get(ppid) ?? []), pid]);
  const rss = new Map(rows.map(([pid, , kb]) => [pid, kb * 1024]));
  let total = 0;
  for (const stack = [root]; stack.length;) {
    const pid = stack.pop();
    total += rss.get(pid) ?? 0;
    stack.push(...(kids.get(pid) ?? []));
  }
  return total;
}

function wav(int16, sampleRate) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + int16.length, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36);
  header.writeUInt32LE(int16.length, 40);
  return Buffer.concat([header, int16]);
}

const results = [];
for (const lang of langs) {
  const items = set.items.filter((item) => item[lang]);
  const dir = path.join(out, lang);
  mkdirSync(dir, { recursive: true });
  // Tagged so its process tree can be found: Playwright does not expose the pid.
  const tag = `--lt216-measure=${lang}-${process.pid}`;
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: [tag] });
  const pid = Number(execFileSync('pgrep', ['-f', '--', tag]).toString().trim().split('\n')[0]);
  let peak = 0;
  const sampler = setInterval(() => { peak = Math.max(peak, treeRss(pid)); }, 250);
  try {
    const page = await browser.newPage();
    page.on('pageerror', (error) => console.error(`  [${lang}] page error: ${error.message}`));
    await page.goto(`${base}/social_psychology/listen-lt216/?lang=${lang}`);
    const isolated = await page.evaluate(() => crossOriginIsolated);
    const idle = treeRss(pid);
    const runs = [];
    for (const [n, item] of [[0, items[0]], ...items.map((it, i) => [i + 1, it])]) {
      const run = await page.evaluate(async ({ lang, text }) => {
        const result = await window.lt216.speak(lang, text, { mute: true });
        const { samples } = window.lt216.last;
        const pcm = new Int16Array(samples.length);
        samples.forEach((s, i) => { pcm[i] = Math.max(-1, Math.min(1, s)) * 0x7fff; });
        let binary = '';
        const bytes = new Uint8Array(pcm.buffer);
        for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return { ...result, sampleRate: window.lt216.last.sampleRate, pcm: btoa(binary) };
      }, { lang, text: item[lang] });
      const { pcm, sampleRate, ...timing } = run;
      const name = n === 0 ? `${item.id}-cold` : item.id;
      writeFileSync(path.join(dir, `${name}.wav`), wav(Buffer.from(pcm, 'base64'), sampleRate));
      runs.push({ id: item.id, name, category: item.category, ...timing, text: undefined });
      console.log(`  ${lang} ${name}: ${timing.seconds.toFixed(1)} s audio, first sound ${timing.firstSoundMs?.toFixed(0)} ms, ` +
        `RTF ${timing.rtf.toFixed(3)}${timing.loadMs ? `, load ${(timing.loadMs / 1000).toFixed(1)} s` : ''} (${timing.outcome})`);
    }
    const warm = runs.slice(1);
    const sum = (key) => warm.reduce((total, r) => total + r[key], 0);
    const summary = {
      lang, isolated, load1: loadavg()[0],
      bytes: runs[0].bytes, loadMs: runs[0].loadMs, coldFirstSoundMs: runs[0].firstSoundMs,
      firstSoundMs: { p00: runs[1].firstSoundMs, max: Math.max(...warm.map((r) => r.firstSoundMs)),
        median: warm.map((r) => r.firstSoundMs).sort((a, b) => a - b)[Math.floor(warm.length / 2)] },
      rtf: sum('renderMs') / 1000 / sum('seconds'),
      rssIdle: idle, rssPeak: peak, outcomes: warm.map((r) => r.outcome),
    };
    writeFileSync(path.join(dir, 'timings.json'), JSON.stringify({ summary, runs }, null, 1));
    results.push(summary);
    console.log(`${lang}: RTF ${summary.rtf.toFixed(3)}, first sound ${summary.firstSoundMs.median.toFixed(0)} ms median, ` +
      `peak RSS ${(peak / 2 ** 20).toFixed(0)} MB, load avg ${summary.load1.toFixed(1)}`);
  } finally {
    clearInterval(sampler);
    await browser.close();
  }
}
writeFileSync(path.join(out, 'summary.json'), JSON.stringify(results, null, 1));
