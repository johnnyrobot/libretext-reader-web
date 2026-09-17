/* The JS half of the oracle diff's controls (build plan step 9).
 *
 *   node scripts/oracle-js.mjs   # seconds; no model inference
 *
 * Two of the four things that differ between the browser and the deployed tracks
 * can be isolated without running a model at all, and both are worth isolating
 * because both are silent when they go wrong:
 *
 *   js-mask.json    src/protect.mjs over the whole corpus, against
 *                   pipeline/protect.py's py-mask.json. tests/protect.test.js
 *                   already asserts a 427-case parity fixture, but that fixture is
 *                   built from shapes that have gone wrong before. This is the
 *                   real book -- weaker per case, and the only check that covers
 *                   the cases nobody thought to write.
 *
 *   js-tokens.json  the transformers.js MarianTokenizer's ids for the masked
 *                   lines, against Python's. transformers.js prints "MarianTokenizer
 *                   has no fast implementation, results may be slightly inaccurate"
 *                   on every load and quantifies it nowhere. Two id sequences either
 *                   match or they do not, and that is the whole of that warning.
 *
 * Node rather than the browser, deliberately, and only for these two: both are
 * pure JS with no wasm underneath, so the browser would add nothing but 35 minutes.
 * The TRANSLATION is a different matter and runs in a real browser -- see
 * scripts/oracle-browser.mjs.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { mask } from '../src/protect.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CORPUS = path.join(ROOT, 'bench/oracle');
// The STAGED model directory, not the Hugging Face cache: this must be the exact
// tokenizer.json the browser is served, sha256-verified by models.mjs. A tokenizer
// resolved from anywhere else would make a parity pass mean nothing.
const MODELS = path.join(ROOT, 'bench/assets/mt');

function corpus() {
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
        out.push({
          key: `${page}\t${sentence.id}`,
          english: sentence.display || sentence.speech,
        });
      }
    }
  }
  return out;
}

const rows = corpus();
console.log(`${rows.length} sentences`);

const masked = Object.fromEntries(rows.map((row) => {
  const [text, spans] = mask(row.english);
  // Object rather than Map, and plain string keys, so this serialises to the same
  // JSON shape pipeline/protect.py's dict does and the diff can compare them
  // directly instead of normalising two shapes first.
  return [row.key, [text, spans]];
}));
writeFileSync(path.join(CORPUS, 'js-mask.json'), JSON.stringify(masked));
console.log('  wrote js-mask.json');

const { AutoTokenizer, env } = await import('@huggingface/transformers');
env.allowRemoteModels = false;
env.localModelPath = MODELS;
const tokenizer = await AutoTokenizer.from_pretrained('en-es');

const tokens = {};
for (const row of rows) {
  // `input_ids` from the tokenizer call rather than `.encode()`, so this is the
  // path the translation pipeline itself takes.
  const encoded = await tokenizer(masked[row.key][0]);
  tokens[row.key] = Array.from(encoded.input_ids.data, Number);
}
writeFileSync(path.join(CORPUS, 'js-tokens.json'), JSON.stringify(tokens));
console.log('  wrote js-tokens.json');
