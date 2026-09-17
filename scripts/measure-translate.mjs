/* Measure the translation worker's sustained rate on real sentences.
 *
 *   npm run stage          # needs .stage/_assets/tts/mt/en-es and .../ort-mt
 *   node scripts/measure-translate.mjs [count]
 *
 * Serves .stage through scripts/serve-local.py, because the COOP/COEP headers it
 * sets are what allow wasm threads, and threads are the entire lever: 0.90
 * sent/s single-threaded against 2.99 with 8. A run without cross-origin
 * isolation is measuring a different thing, so this refuses to report one.
 *
 * A warm-up batch runs first and is NOT counted. The first batch pays for lazy
 * wasm compilation and the first allocation of the decoder's KV cache; including
 * it reports a number no later batch will reproduce.
 */

import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';

const PORT = Number(process.env.PORT ?? 8799);
const COUNT = Number(process.argv[2] ?? 10);
const PAGE = '/social_psychology/13:_Competition_and_Cooperation_in_Our_Social_Worlds'
  + '/13.01:_Conflict_Cooperation_Morality_and_Fairness/';

async function waitForServer(url, attempts = 60) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      if ((await fetch(url)).ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`server never answered on ${url}`);
}

const server = spawn('.venv/bin/python',
  ['scripts/serve-local.py', '--root', '.stage', '--port', String(PORT)],
  { stdio: ['ignore', 'ignore', 'inherit'] });

try {
  const origin = `http://127.0.0.1:${PORT}`;
  await waitForServer(origin + PAGE);

  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.error('  [page]', m.text()); });
  await page.goto(origin + PAGE);

  const result = await page.evaluate(async (count) => {
    if (!self.crossOriginIsolated) throw new Error('page is not cross-origin isolated');

    const manifest = await (await fetch('speech.json')).json();
    // display, not speech: the pipeline translates RAW English and the target
    // language's own spoken-form pass is a separate, still-open decision.
    const lines = manifest.blocks.flatMap((b) => b.sentences)
      .map((s) => s.display).filter((t) => t && t.length > 40);
    if (lines.length < count + 2) throw new Error(`page has only ${lines.length} usable sentences`);

    const worker = new Worker('/_assets/tts/translate.worker.js', { type: 'module' });
    const pending = new Map();
    let ready;
    const readyPromise = new Promise((resolve, reject) => { ready = { resolve, reject }; });

    worker.onmessage = ({ data }) => {
      if (data.type === 'ready') return ready.resolve();
      if (data.type === 'error') {
        const waiting = pending.get(data.id);
        return waiting ? waiting.reject(new Error(data.message)) : ready.reject(new Error(data.message));
      }
      if (data.type === 'translated') pending.get(data.id)?.resolve(data.lines);
    };
    worker.onerror = (e) => ready.reject(new Error(e.message || 'worker failed'));

    const send = (id, batch) => new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker.postMessage({ type: 'translate', id, lines: batch });
    });

    const t0 = performance.now();
    worker.postMessage({
      type: 'init', manifestUrl: '/_assets/tts/mt/en-es/manifest.json', pair: 'en-es',
    });
    await readyPromise;
    const loadSeconds = (performance.now() - t0) / 1000;

    await send('warmup', lines.slice(0, 2));

    const batch = lines.slice(2, 2 + count);
    const t1 = performance.now();
    const translated = await send('timed', batch);
    const seconds = (performance.now() - t1) / 1000;

    worker.terminate();
    return {
      threads: navigator.hardwareConcurrency,
      loadSeconds: Number(loadSeconds.toFixed(1)),
      count: batch.length,
      seconds: Number(seconds.toFixed(2)),
      sentPerSecond: Number((batch.length / seconds).toFixed(2)),
      sample: batch.slice(0, 3).map((english, i) => ({ english, spanish: translated[i] })),
    };
  }, COUNT);

  await browser.close();
  console.log(JSON.stringify(result, null, 2));
} finally {
  server.kill();
}
