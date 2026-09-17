/* Translate the whole validation corpus IN THE BROWSER, through the shipping worker.
 *
 *   scripts/oracle-fetch.sh          # the corpus
 *   npm run stage                    # .stage/_assets/tts/mt/en-es + ort-mt
 *   node scripts/oracle-browser.mjs  # ~35 min for 14,418 sentences
 *
 * This is the side of the oracle diff (build plan step 9) that cannot be faked.
 * Everything else in the comparison runs in Node or Python; the artefact actually
 * under test is what `translate.worker.js` produces inside a real browser, on wasm,
 * with the q8 export and the JS tokenizer. Running the same model through
 * onnxruntime-node instead would be measuring a different thing and would quietly
 * remove the tokenizer implementation from the comparison, which is the single
 * item transformers.js explicitly warns about ("MarianTokenizer has no fast
 * implementation, results may be slightly inaccurate").
 *
 * It goes through the WORKER, not through a hand-rolled pipeline call, so masking
 * and restore are the ones that ship. A `PlaceholderError` fallback therefore
 * appears in the output as the English source, exactly as a reader would hear it.
 *
 * ONE CONSEQUENCE OF THAT, and it changes what a re-run measures. Since step 10
 * the worker also drops a degenerate or grossly truncated line to English, so a
 * run today reports the GATED output. The original oracle-diff numbers were
 * produced before that gate existed and are therefore raw model output, which is what a diff
 * about the MODEL should compare. scripts/oracle-diff.py reports the gate's
 * effect separately, over the same rows, for exactly this reason. A row equal to
 * its English source is the signature of either fallback.
 *
 * It also bypasses src/reader.mjs entirely and posts to the worker directly, so
 * the reference holdback does not apply here: all 14,418 sentences are
 * translated, including the 4,988 a reader will never hear in Spanish. That is
 * deliberate -- the holdback is a policy, and this is measuring the machinery
 * under it.
 *
 * Output is JSONL, appended per batch, and a re-run resumes: a 35-minute run that
 * loses everything to one bad batch is a run nobody repeats.
 */

import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CORPUS = path.join(ROOT, 'bench/oracle');
const OUT = path.join(CORPUS, 'browser.jsonl');
const PORT = Number(process.env.PORT ?? 8801);
const BATCH = Number(process.env.BATCH ?? 32);
// Any staged page will do: this script uses the origin for its COOP/COEP headers,
// its worker and its models, and never reads the page's own content.
const PAGE = '/social_psychology/13:_Competition_and_Cooperation_in_Our_Social_Worlds'
  + '/13.01:_Conflict_Cooperation_Morality_and_Fairness/';

/** Every English sentence in the corpus, in page then document order. */
function corpusSentences() {
  const pages = readFileSync(path.join(ROOT, 'scripts/oracle-pages.txt'), 'utf8')
    .split('\n').filter(Boolean);
  const out = [];
  for (const page of pages) {
    const manifest = JSON.parse(readFileSync(path.join(CORPUS, page, 'speech.json'), 'utf8'));
    for (const block of manifest.blocks) {
      for (const sentence of block.sentences) {
        // `display || speech`, matching pipeline/translate.source_sentences. NOT
        // `??`: a `notice` block (tts_manifest.py's generated "eight rows.")
        // carries `display: ""` -- present and empty, not absent -- and `??` keeps
        // the empty string, handing the translator nothing for 146 sentences of
        // this book. `display` is the RAW English, which is what the pipeline
        // translates because `speech` has already been through the ENGLISH
        // spoken-form pass.
        out.push({ page, id: sentence.id, english: sentence.display || sentence.speech });
      }
    }
  }
  return out;
}

function alreadyDone() {
  if (!existsSync(OUT)) return new Set();
  return new Set(readFileSync(OUT, 'utf8').split('\n').filter(Boolean)
    .map((line) => { const r = JSON.parse(line); return `${r.page} ${r.id}`; }));
}

async function waitForServer(url, attempts = 60) {
  for (let i = 0; i < attempts; i += 1) {
    try { if ((await fetch(url)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`server never answered on ${url}`);
}

const all = corpusSentences();
const done = alreadyDone();
// LIMIT exists so the wiring can be proved in a minute rather than in half an hour.
const todo = all.filter((s) => !done.has(`${s.page} ${s.id}`))
  .slice(0, Number(process.env.LIMIT ?? Infinity));
mkdirSync(CORPUS, { recursive: true });
console.log(`${all.length} sentences, ${done.size} already translated, ${todo.length} to go`);
if (todo.length === 0) process.exit(0);

const server = spawn('.venv/bin/python',
  ['scripts/serve-local.py', '--root', '.stage', '--port', String(PORT)],
  { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] });

const started = Date.now();
let translated = 0;

try {
  const origin = `http://127.0.0.1:${PORT}`;
  await waitForServer(origin + PAGE);

  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('  [page]', e.message));
  await page.goto(origin + PAGE);

  await page.exposeBinding('reportBatch', (_source, rows) => {
    appendFileSync(OUT, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    translated += rows.length;
    const rate = translated / ((Date.now() - started) / 1000);
    const left = Math.round((todo.length - translated) / rate / 60);
    process.stdout.write(
      `\r  ${translated}/${todo.length}  ${rate.toFixed(2)} sent/s  ~${left} min left   `);
  });

  await page.evaluate(async ({ items, batch }) => {
    if (!self.crossOriginIsolated) throw new Error('page is not cross-origin isolated');

    const worker = new Worker('/_assets/tts/translate.worker.js', { type: 'module' });
    const pending = new Map();
    let ready;
    const readyPromise = new Promise((resolve, reject) => { ready = { resolve, reject }; });

    worker.onmessage = ({ data }) => {
      if (data.type === 'ready') return ready.resolve();
      if (data.type === 'error') {
        const waiting = pending.get(data.id);
        return waiting ? waiting.reject(new Error(data.message))
          : ready.reject(new Error(data.message));
      }
      if (data.type === 'translated') pending.get(data.id)?.resolve(data.lines);
    };
    worker.onerror = (e) => ready.reject(new Error(e.message || 'worker failed'));

    const send = (id, lines) => new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker.postMessage({ type: 'translate', id, lines });
    });

    worker.postMessage({
      type: 'init', manifestUrl: '/_assets/tts/mt/en-es/manifest.json', pair: 'en-es',
    });
    await readyPromise;

    for (let start = 0; start < items.length; start += batch) {
      const slice = items.slice(start, start + batch);
      const lines = await send(`b${start}`, slice.map((s) => s.english));
      pending.delete(`b${start}`);
      await self.reportBatch(slice.map((s, i) => ({
        page: s.page, id: s.id, spanish: lines[i],
      })));
    }
    worker.terminate();
  }, { items: todo, batch: BATCH });

  await browser.close();
  console.log(`\ndone: ${translated} sentences in ${Math.round((Date.now() - started) / 60000)} min`);
} finally {
  server.kill();
}
