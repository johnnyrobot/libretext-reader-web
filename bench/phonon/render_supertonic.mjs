/**
 * THROWAWAY SPIKE (LT-213). Render the bench items with the shipped Supertonic
 * engine, the baseline Phonon is measured against.
 *
 *   python3 scripts/serve-local.py --root bench/phonon/out/stage --port 8788 &
 *   node bench/phonon/render_supertonic.mjs [--voice M1] [--channel chrome] [--headed]
 *
 * It drives the staged worker (/_assets/tts/engine.worker.js) from a staged,
 * cross-origin-isolated page, exactly as scripts/render-sample.mjs does, but
 * posts each bench item's Speech Text and times it:
 *
 *   load_s     init -> ready (model download from the local server + sessions)
 *   ttfa_s     synth posted -> audio message; the worker returns a sentence
 *              whole, so this is also its total time
 *   rtf        ttfa_s / audio_s
 *
 * Item one runs straight after a cold load (fresh browser profile, empty
 * cache). Peak memory is the largest summed RSS of the browser process and all
 * its descendants (renderer, GPU, utility), polled every 100 ms.
 *
 * Writes bench/phonon/out/supertonic-<voice>/<id>.wav (44.1 kHz mono s16) and
 * timings.json.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAvg1m, parseArgs, summarise, treeRssMb, wav } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const VOICE = args.voice ?? 'M1';
const HERE = dirname(fileURLToPath(import.meta.url));
// --run N writes a repeat to its own folder (<engine>-rN).
const ENGINE = `supertonic-${VOICE}` + (args.run ? `-r${args.run}` : '');
const OUT = join(HERE, 'out', ENGINE);
// Serve bench/phonon/out/stage (a clone of .stage with a fresh build laid over it).
const PAGE = 'http://127.0.0.1:8788/social_psychology/'
  + '13%3A_Competition_and_Cooperation_in_Our_Social_Worlds/'
  + '13.01%3A_Conflict_Cooperation_Morality_and_Fairness/';
const items = JSON.parse(readFileSync(join(HERE, 'out', 'sentences.json'), 'utf8'));

const server = await chromium.launchServer({
  channel: args.channel === true ? undefined : args.channel,
  args: ['--enable-unsafe-webgpu'],
  headless: !args.headed,
});
const browserPid = server.process().pid;
const browser = await chromium.connect(server.wsEndpoint());
const page = await browser.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.log('console:', m.text()); });

let peak = 0;
const poll = setInterval(() => { peak = Math.max(peak, treeRssMb(browserPid)); }, 100);
const idle = treeRssMb(browserPid);

await page.goto(PAGE, { waitUntil: 'load' });
if (!(await page.evaluate(() => self.crossOriginIsolated))) throw new Error('page is not cross-origin isolated');

await page.exposeFunction('saveItem', (id, samples, rate) => {
  writeFileSync(join(OUT, `${id}.wav`), wav(samples, rate));
});
mkdirSync(OUT, { recursive: true });

const result = await page.evaluate(async ({ items, voice }) => {
  const worker = new Worker('/_assets/tts/engine.worker.js', { type: 'module' });
  const once = (pred) => new Promise((resolve, reject) => {
    worker.addEventListener('message', function on({ data }) {
      if (data.type === 'error') { worker.removeEventListener('message', on); reject(new Error(data.message)); }
      if (pred(data)) { worker.removeEventListener('message', on); resolve(data); }
    });
  });
  const notes = [];
  worker.addEventListener('message', ({ data }) => {
    if (data.type === 'progress' && /webgpu/.test(data.file ?? '')) notes.push(data.file);
  });
  const t0 = performance.now();
  const readyP = once((d) => d.type === 'ready');
  worker.postMessage({ type: 'init', voice, lang: 'en', manifestUrl: '/_assets/tts/manifest.json' });
  const ready = await readyP;
  const loadS = (performance.now() - t0) / 1000;
  const rows = [];
  for (const it of items) {
    const s = performance.now();
    const audioP = once((d) => d.type === 'audio' && d.id === it.id);
    worker.postMessage({ type: 'synth', id: it.id, text: it.speech });
    const audio = await audioP;
    const took = (performance.now() - s) / 1000;
    const audioS = audio.samples.length / audio.sampleRate;
    await window.saveItem(it.id, Array.from(audio.samples), audio.sampleRate);
    rows.push({ id: it.id, chars: it.speech.length, ttfa_s: +took.toFixed(4), total_s: +took.toFixed(4),
                audio_s: +audioS.toFixed(3), rtf: +(took / audioS).toFixed(4) });
  }
  return { provider: ready.provider, loadS, rows, notes };
}, { items, voice: VOICE });

clearInterval(poll);
peak = Math.max(peak, treeRssMb(browserPid));
const summary = {
  engine: ENGINE, voice: VOICE, provider: result.provider, notes: result.notes,
  browser: (args.channel === true || !args.channel ? 'playwright chromium' : args.channel) + (args.headed ? ' headed' : ' headless'),
  load_avg_1m: loadAvg1m(),
  load_s: +result.loadS.toFixed(3),
  cold_ttfa_s: +(result.loadS + result.rows[0].ttfa_s).toFixed(3),
  ...summarise(result.rows),
  browser_idle_rss_mb: +idle.toFixed(1), browser_peak_rss_mb: +peak.toFixed(1),
  rows: result.rows,
};
writeFileSync(join(OUT, 'timings.json'), JSON.stringify(summary, null, 1));
const { rows, ...head } = summary;
console.log(JSON.stringify(head, null, 1));
await browser.close();
await server.close();
