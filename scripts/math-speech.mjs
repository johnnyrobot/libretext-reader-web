#!/usr/bin/env node
/**
 * TeX -> MathML -> Clearspeak text, for pipeline/math_speech.py.
 *
 * This is the engine behind MathJax's own Accessibility > Speech menu, run at
 * build time so the reader's voice gets words rather than LaTeX. One process per
 * pipeline run; `{"reset": true}` starts a fresh TeX parser per page so one page's
 * \newcommand preamble can never leak into the next.
 *
 * Protocol: one JSON object per stdin line, one JSON reply per stdout line.
 *   {"reset": true, "macros": {"PageIndex": "1.4"}}   -> {"ok": true}
 *   {"define": "\\newcommand..."}                      -> {"ok": true}
 *   {"id": "t0", "tex": "...", "display": false}       -> {"id": "t0", "speech": "..."}
 *                                                       | {"id": "t0", "error": "..."}
 */
import { createInterface } from 'node:readline';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { mathjax } from 'mathjax-full/js/mathjax.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';
import { AllPackages } from 'mathjax-full/js/input/tex/AllPackages.js';
import { SerializedMmlVisitor } from 'mathjax-full/js/core/MmlTree/SerializedMmlVisitor.js';

// SRE ships CommonJS only.
const sre = createRequire(import.meta.url)('speech-rule-engine');

let handlerRegistered = false;
let engineReady = null;

function ensureEngine() {
  engineReady ??= (async () => {
    await sre.setupEngine({
      locale: 'en', domain: 'clearspeak', modality: 'speech',
      // TriangleSymbol_Delta reads \Delta as "Delta" rather than "triangle".
      // Ellipses_AndSoOn turns "dot dot dot" into "and so on", which is how a
      // person reads 0.333... aloud.
      style: 'TriangleSymbol_Delta:Ellipses_AndSoOn',
    });
    await sre.engineReady();
  })();
  return engineReady;
}

/**
 * LibreTexts defines \PageIndex{n} in its site MathJax config from the page
 * number, not in LaTeX, so the pipeline supplies the prefix. \label and \ref
 * need equation tags to resolve, and tags wrap every equation in a one-row
 * table that Clearspeak announces as "1 lines Line 1:" -- so both are rewritten
 * as text before MathJax sees them.
 */
function preprocess(tex, prefix) {
  let out = tex.replace(/\\label\{[^}]*\}/g, '');
  out = out.replace(/\\ref\{([^}]*)\}/g, '\\text{Equation $1}');
  if (prefix !== undefined) {
    out = out.replace(/\\PageIndex\{([^}]*)\}/g, (_, n) => `\\text{${prefix}.${n}}`);
  }

  // \nonumber suppresses an equation NUMBER, which is a visual concern with no
  // spoken form -- but its presence puts MathJax into the tagged-equation
  // machinery, wrapping even a one-line equation in a table that Clearspeak
  // announces as "1 lines Line 1:". Measured on one LibreTexts page: 11 of 41
  // spans opened with that phrase. It is pure noise to a listener.
  out = out.replace(/\\nonumber\b/g, '');

  // \ldotp is a full stop set as punctuation. Clearspeak reads it aloud as the
  // WORD "period", which lands mid-sentence in the reader's prose.
  out = out.replace(/\\ldotp\b/g, '');

  // A word set off by thick spaces was meant as prose, not a product: authors
  // write `\; meaning \;` where they should have written \text{meaning}. Left
  // alone, MathJax parses it as seven variables and Clearspeak spells it out --
  // "m e a n i n g". Only runs of 3+ letters BRACKETED by spacing commands
  // qualify, because that bracketing is the author's own signal; a bare `xyz`
  // stays a product, which in algebra is what it almost always is.
  out = out.replace(/\\[;,](\s*)([A-Za-z]{3,})(\s*)\\[;,]/g, ' \\text{$2} ');

  // Spacing commands are typography. \; between a number and a \text{} makes
  // Clearspeak infer multiplication -- "341 \; \text{R} 1" becomes "341 TIMES
  // R 1" where the author meant "341 remainder 1". Without the space the same
  // markup reads correctly, so the space is what has to go.
  out = out.replace(/\\(?:quad|qquad|thinspace|medspace|thickspace)\b/g, ' ');
  out = out.replace(/\\[;,:!]/g, ' ');

  // "341 \text{R} 1" is long division: quotient, then remainder. Spoken as the
  // bare letter it is a shrug -- "341 R 1" -- so the word goes in.
  //
  // Deliberately narrow: a DIGIT either side. R is the gas constant all over
  // Chem 4B (nRT, PV = nRT) and a general \text{R} -> "remainder" would speak
  // nonsense there. A digit-R-digit sandwich only happens in long division.
  out = out.replace(/(\d)\s*\\text\{R\}\s*(?=\d)/g, '$1 \\text{remainder} ');

  // A comma or full stop at the very END of a span belongs to the sentence
  // around it, not to the maths. Kept, it becomes "comma" -- and after an
  // ellipsis it turns into "and so on UP TO comma", inventing a range.
  out = out.replace(/[\s,.]+$/, '');

  return out;
}

export async function createConverter({ macros = {} } = {}) {
  await ensureEngine();
  if (!handlerRegistered) {
    RegisterHTMLHandler(liteAdaptor());
    handlerRegistered = true;
  }
  // bussproofs demands an output renderer; nothing on LibreTexts uses it.
  // noundefined swallows an undefined control sequence into red placeholder text
  // instead of failing the parse -- excluding it is what lets speak() below turn
  // a genuinely broken equation into a thrown error instead of spoken gibberish.
  const tex = new TeX({ packages: AllPackages.filter((p) => p !== 'bussproofs' && p !== 'noundefined') });
  const doc = mathjax.document('', { InputJax: tex });
  const visitor = new SerializedMmlVisitor();
  const prefix = macros.PageIndex;

  const toMml = (source, display) => visitor.visitTree(doc.convert(source, { display }));

  return {
    define(source) { toMml(source, false); },
    speak(source, display) {
      const mml = toMml(preprocess(source, prefix), display);
      const error = /<merror[^>]*>.*?<mtext>(.*?)<\/mtext>/s.exec(mml);
      if (error) throw new Error(error[1]);
      return sre.toSpeech(mml).replace(/\s+/g, ' ').trim();
    },
  };
}

async function main() {
  let converter = await createConverter();
  const out = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    let msg;
    try { msg = JSON.parse(line); } catch (e) { out({ error: `bad json: ${e.message}` }); continue; }
    try {
      if (msg.reset) { converter = await createConverter({ macros: msg.macros ?? {} }); out({ ok: true }); }
      else if (msg.define !== undefined) { converter.define(msg.define); out({ ok: true }); }
      else out({ id: msg.id, speech: converter.speak(msg.tex, Boolean(msg.display)) });
    } catch (e) {
      out({ id: msg.id, error: String(e?.message ?? e) });
    }
  }
}

// Compares full resolved URLs, not basenames -- `src/math-speech.mjs` shares
// this file's basename, and `endsWith(process.argv[1].split('/').pop())`
// would treat running THAT file as though it were this one.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
