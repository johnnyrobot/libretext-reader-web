/**
 * Ask a language model whether the voice would read an equation the way a
 * teacher would, and cache the verdict.
 *
 * WHY A REVIEWER AND NOT A GENERATOR. The obvious idea is to have a model
 * produce the spoken form directly. It reads better and it is the wrong trade:
 * a model can turn 0.125 into 0.25 fluently and nothing downstream would catch
 * it, which in a maths textbook is worse than any amount of awkward phrasing.
 * The Speech Rule Engine cannot do that -- it is a deterministic walk over
 * MathML. So SRE keeps writing the words, and the model only renders an
 * opinion about them. A wrong opinion costs a false entry on a list; a wrong
 * number costs a student.
 *
 * It is also why nothing here writes to a manifest. The output is advice for a
 * human reading the audit page, never an input to the build.
 *
 *   node scripts/math-review.mjs --url <page url> [--model gemma4:31b]
 *
 * Needs OLLAMA_API_KEY for Ollama Cloud; see the host note below.
 *
 * Verdicts are cached in bench/math-review-cache.json keyed by a hash of
 * (latex, speech, model), so a re-run after a phrasing change only asks about
 * the spans that actually changed.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * The reviewer runs on a cloud model. Ollama Cloud serves the same /api/tags and
 * /api/generate as a local daemon, so nothing else here changes -- but the
 * default is the cloud, and a local daemon is reached only by asking for it:
 *
 *   OLLAMA_HOST=http://localhost:11434 node scripts/math-review.mjs ...
 *
 * Read at call time, not module load, so a caller that sets the variable after
 * importing this file is honoured.
 */
const ollamaHost = () => process.env.OLLAMA_HOST || 'https://ollama.com';
const CACHE_PATH = 'bench/math-review-cache.json';

/**
 * Ollama Cloud serves the same /api/tags and /api/generate as a local daemon
 * and differs only in wanting a bearer token, so pointing OLLAMA_HOST at
 * https://ollama.com and setting OLLAMA_API_KEY is the whole of "use a cloud
 * model". Read at call time rather than module load so the key can be set by a
 * caller that has already imported this file. No key means no header, which is
 * what a local daemon expects.
 */
const authHeaders = () =>
  process.env.OLLAMA_API_KEY ? { authorization: `Bearer ${process.env.OLLAMA_API_KEY}` } : {};

/** A verdict depends on the PROMPT as much as on the model and the text, so the
 *  rubric is part of the key. Without it, sharpening the rubric would leave
 *  every cached row answering the old question, silently and forever. */
export const cacheKey = (tex, speech, model, prompt) =>
  createHash('sha256').update(`${model}\0${tex}\0${speech}\0${prompt}`).digest('hex').slice(0, 16);

export function loadCache() {
  try { return JSON.parse(readFileSync(CACHE_PATH, 'utf8')); } catch { return {}; }
}

export function saveCache(cache) {
  mkdirSync(dirname(CACHE_PATH), { recursive: true });
  writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 1) + '\n');
}

/** Is a model actually reachable? Absence is normal, not an error. */
export async function reviewerAvailable(model) {
  try {
    const r = await fetch(`${ollamaHost()}/api/tags`, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(3000),
    });
    if (!r.ok) return false;
    const names = (await r.json()).models.map((m) => m.name);
    return model ? names.includes(model) : names.length > 0;
  } catch { return false; }
}

export const PROMPT = `You are checking how a text-to-speech reader will say a mathematical expression aloud to a student listening to a textbook. You are NOT rewriting it.

LaTeX source:
{tex}

What the voice will say:
"{speech}"

Answer whether a teacher reading this aloud in class would say something close to that.

Reply with STRICT JSON, no other text:
{"verdict":"good"|"awkward"|"wrong","note":"<at most 12 words>"}

- "good": a teacher would say this, or near enough that a student follows.
- "awkward": understandable but stilted, verbose, or robotic.
- "wrong": says something mathematically different from the LaTeX, or omits part of it.

Judge only the wording. Do not comment on the LaTeX itself. Digit-by-digit reading of the repeating part of a decimal is CORRECT, not awkward.

Before answering, check IN THIS ORDER and stop at the first that applies:
1. Does every number and operator in the speech match the LaTeX exactly? If any value differs or is missing, the verdict is "wrong".
2. Is any bare multi-digit numeral left as digits rather than words? That is "wrong" -- the voice cannot pronounce it.
3. Would a teacher actually utter this phrasing? "ten halves" for 10/2 is NOT what a teacher says; that is "awkward".
Only if all three pass is the verdict "good". Most expressions are good, but do not default to "good" without running the checks.`;

export async function review(tex, speech, model) {
  const body = {
    model,
    prompt: PROMPT.replace('{tex}', tex).replace('{speech}', speech),
    stream: false,
    think: false,
    options: { temperature: 0 },
  };
  const r = await fetch(`${ollamaHost()}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  if (!r.ok) throw new Error(`ollama ${r.status}`);
  const text = (await r.json()).response ?? '';
  const m = /\{[\s\S]*?\}/.exec(text);
  if (!m) return { verdict: 'unknown', note: 'no json in reply' };
  try {
    const p = JSON.parse(m[0]);
    const verdict = ['good', 'awkward', 'wrong'].includes(p.verdict) ? p.verdict : 'unknown';
    return { verdict, note: String(p.note ?? '').slice(0, 90) };
  } catch { return { verdict: 'unknown', note: 'unparseable reply' }; }
}

/**
 * Review many rows, using and updating the cache. Returns rows annotated in
 * place. Never throws for model reasons: an unreachable model leaves every
 * verdict `unavailable`, which the audit page renders as a blank column.
 */
export async function reviewRows(rows, model, onProgress = () => {}) {
  const cache = loadCache();
  const ok = await reviewerAvailable(model);
  if (!ok) {
    for (const row of rows) row.review = { verdict: 'unavailable', note: '' };
    return { rows, used: false, cached: 0, asked: 0 };
  }
  let cached = 0; let asked = 0;
  for (const [i, row] of rows.entries()) {
    const k = cacheKey(row.tex, row.speech, model, PROMPT);
    if (cache[k]) { row.review = cache[k]; cached += 1; }
    else {
      try { row.review = await review(row.tex, row.speech, model); }
      catch (e) { row.review = { verdict: 'unknown', note: String(e.message).slice(0, 60) }; }
      cache[k] = row.review; asked += 1;
    }
    onProgress(i + 1, rows.length, row.review.verdict);
  }
  saveCache(cache);
  return { rows, used: true, cached, asked };
}

// CLI: review one page and print a summary, without building the HTML.
if (process.argv[1] && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href) {
  const args = Object.fromEntries(process.argv.slice(2).join(' ').split('--').filter(Boolean)
    .map((s) => s.trim().split(/\s+/)).map(([k, v]) => [k, v ?? true]));
  const model = args.model ?? 'gemma4:31b';
  const manifest = await (await fetch(new URL('speech.json', args.url))).json();
  const rows = Object.entries(manifest.mathSpeech ?? {}).map(([t, speech]) => ({
    tex: Buffer.from(t.slice(8, -2), 'base64').toString('utf8').slice(2, -2).trim(), speech,
  }));
  const { used, cached, asked } = await reviewRows(rows, model,
    (i, n, v) => process.stdout.write(`  ${i}/${n} ${v}        \r`));
  console.log('\n' + (used ? `${asked} asked, ${cached} cached` : `model ${model} unavailable`));
  for (const r of rows) {
    if (r.review.verdict !== 'good' && r.review.verdict !== 'unavailable') {
      console.log(`\n[${r.review.verdict}] ${r.tex.slice(0, 70)}\n   said: ${r.speech.slice(0, 90)}\n   note: ${r.review.note}`);
    }
  }
}
