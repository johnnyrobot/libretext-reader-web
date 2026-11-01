/**
 * THROWAWAY SPIKE (LT-213). Path A: Phonon 31m-en in the browser, in a worker,
 * on ONNX Runtime Web via Transformers.js 4.2.0.
 *
 *   python3 bench/phonon/serve.py --port 8789 &
 *   node bench/phonon/render_path_a.mjs --device webgpu --dtype q4f16 [--channel chrome] [--headed]
 *   node bench/phonon/render_path_a.mjs --device wasm --dtype fp32
 *
 * Same measurements as render_supertonic.mjs, except that ttfa_s is the time to
 * the first 80 ms frame, because this engine streams frame by frame:
 *
 *   load_s     init -> ready (graphs and tokenizer from the local server,
 *              session creation, voice prefill)
 *   ttfa_s     synth posted -> first frame
 *   total_s    synth posted -> whole item
 *   rtf        total_s / audio_s
 *
 * Writes bench/phonon/out/patha-<device>-<dtype>/<id>.wav (24 kHz) and timings.json.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAvg1m, parseArgs, summarise, treeRssMb, wav } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const DEVICE = args.device ?? 'webgpu';
const DTYPE = args.dtype ?? (DEVICE === 'webgpu' ? 'q4f16' : 'fp32');
const CHANNEL = args.channel === true ? undefined : (args.channel ?? 'chrome');
const HERE = dirname(fileURLToPath(import.meta.url));
// --run N writes a repeat to its own folder (<engine>-rN): Phonon samples, so runs differ.
const ENGINE = `patha-${DEVICE}-${DTYPE}` + (args.run ? `-r${args.run}` : '');
const OUT = join(HERE, 'out', ENGINE);
const items = JSON.parse(readFileSync(join(HERE, 'out', 'sentences.json'), 'utf8'));

const server = await chromium.launchServer({
  channel: CHANNEL,
  headless: !args.headed,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan'],
});
const browserPid = server.process().pid;
const browser = await chromium.connect(server.wsEndpoint());
const page = await browser.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.log('console:', m.text().slice(0, 300)); });

const idle = treeRssMb(browserPid);
let peak = idle;
const poll = setInterval(() => { peak = Math.max(peak, treeRssMb(browserPid)); }, 100);

await page.goto('http://127.0.0.1:8789/bench/phonon/path-a/index.html', { waitUntil: 'load' });
if (!(await page.evaluate(() => self.crossOriginIsolated))) throw new Error('page is not cross-origin isolated');
mkdirSync(OUT, { recursive: true });
await page.exposeFunction('saveItem', (id, samples, rate) => writeFileSync(join(OUT, `${id}.wav`), wav(samples, rate)));

const result = await page.evaluate(async ({ items, device, dtype }) => {
  const gpu = navigator.gpu ? await navigator.gpu.requestAdapter() : null;
  const adapter = gpu ? { shaderF16: gpu.features.has('shader-f16'), vendor: gpu.info?.vendor, arch: gpu.info?.architecture } : null;
  const worker = new Worker('/bench/phonon/path-a/worker.mjs', { type: 'module' });
  const once = (pred) => new Promise((resolve, reject) => {
    worker.addEventListener('message', function on({ data }) {
      if (data.type === 'error') { worker.removeEventListener('message', on); reject(new Error(data.message)); }
      if (pred(data)) { worker.removeEventListener('message', on); resolve(data); }
    });
  });
  const t0 = performance.now();
  const readyP = once((d) => d.type === 'ready');
  worker.postMessage({ type: 'init', device, dtype });
  const ready = await readyP;
  const loadS = (performance.now() - t0) / 1000;
  const rows = [];
  for (const it of items) {
    const s = performance.now();
    const firstP = once((d) => d.type === 'first' && d.id === it.id).then(() => performance.now());
    const audioP = once((d) => d.type === 'audio' && d.id === it.id);
    worker.postMessage({ type: 'synth', id: it.id, text: it.speech });
    const audio = await audioP;
    const end = performance.now();
    const first = await firstP;
    const audioS = audio.samples.length / audio.sampleRate;
    await window.saveItem(it.id, Array.from(audio.samples), audio.sampleRate);
    rows.push({ id: it.id, chars: it.speech.length, calls: audio.chunks, tokens: audio.tokens,
                ttfa_s: +((first - s) / 1000).toFixed(4), total_s: +((end - s) / 1000).toFixed(4),
                audio_s: +audioS.toFixed(3), rtf: +(((end - s) / 1000) / audioS).toFixed(4) });
  }
  return { ready, adapter, loadS, rows };
}, { items, device: DEVICE, dtype: DTYPE });

clearInterval(poll);
peak = Math.max(peak, treeRssMb(browserPid));
const summary = {
  engine: ENGINE, device: DEVICE, dtype: DTYPE, threads: result.ready.threads, adapter: result.adapter,
  browser: (CHANNEL ?? 'playwright chromium') + (args.headed ? ' headed' : ' headless'),
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
