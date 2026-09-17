/**
 * Spans that must survive translation byte-identical — the browser half.
 *
 * A direct port of pipeline/protect.py. That file is the SPECIFICATION and this
 * one must not drift from it: both mask the same corpus for the same Marian
 * checkpoints, and only the Python side has a back-translation gate downstream to
 * notice when masking goes wrong. tests/protect.test.js mirrors
 * pipeline/tests/test_protect.py case for case so drift shows up as a failure
 * rather than as a mangled sentence nobody hears.
 *
 * Neural MT reorders, translates, truncates and hallucinates inside anything it
 * does not recognise as opaque. A base64 math token is the worst case: it looks
 * like text, so the model rewrites it, and the corruption is silent.
 *
 * The placeholder shape is `[[KIND0]]` — double square ASCII brackets — and it was
 * MEASURED, not chosen. The original scheme used U+2E24/U+2E25 on the theory that
 * exotic characters would be left alone by Marian's tokeniser. That theory was
 * wrong: the tokeniser drops them and emits the bare kind+digit, so every sentence
 * containing a URL, email or math token was silently dropped to English in every
 * shipped language. Do not "improve" this back to an exotic bracket.
 *
 * Known, deliberate divergences from the Python, none of which the corpus reaches:
 * JavaScript's `\w` and `\b` are ASCII-only where Python 3's are Unicode-aware, so
 * an email containing accented letters would be matched differently here. Every
 * address in this corpus is ASCII. If that stops being true, this is where to look.
 */

/** Thrown when a protected span did not survive translation intact. */
export class PlaceholderError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PlaceholderError';
  }
}

const PLACEHOLDER_RE = /\[\[[A-Z]+\d+\]\]/g;

// The TLDs a bare-domain URL may end in. An explicit list, not `[a-z]{2,}`, because
// the whole risk of matching a scheme-less URL is a FALSE POSITIVE: the span is
// replaced by a placeholder, restored verbatim, and any real prose it swallowed is
// never spoken in the target language — silently. `[a-z]{2,}` would swallow
// "cooperation.Social" from a page whose extraction dropped a space, and this
// corpus really does produce that shape.
const TLD = '(?:org|com|edu|net|gov|int|mil|info|io)';

// A scheme-less, www-less URL: `commons.wikimedia.org/wiki/File:...`. Real, and
// once unprotected — the checkpoint rewrote `File:` to `Archivo:`, stripped the
// underscores and doubled a letter.
//
// Two guards make it safe against a DOI, the shape it is easiest to confuse with
// (`10.1177/0956797611398495` is also `label.label/path`):
//   1. The TLD comes from the list above, so it is ALPHABETIC. A DOI's is always
//      numeric. This is the load-bearing guard.
//   2. Labels are 2+ characters, so a single initial cannot start a match —
//      "U.S.Gov" from a de-spaced extraction yields nothing rather than "S.Gov".
const BARE_DOMAIN = String.raw`\b(?:[a-z0-9-]{2,}\.)+${TLD}\b(?:/[^\s\[\]]*)?`;

/** The one definition of "this is a URL" on the browser side. */
export const URL_RE = new RegExp(
  String.raw`\bhttps?://[^\s\[\]]+|\bwww\.[^\s\[\]]+|${BARE_DOMAIN}`,
  'gi',
);

// Order matters, twice over.
//
// MATH is claimed before URLs, because a base64 payload can contain a '/' run that
// the URL pattern would otherwise bite into.
//
// EMAIL is claimed before URLs, because an address's own domain (`example.org`
// inside `john@example.org`) matches the bare-domain rule on its own — with URL
// first, the domain was masked out from under EMAIL and the address shipped as a
// naked `john@`. EMAIL requires an '@', so it can never make the opposite mistake.
//
// The URL pattern's greedy classes exclude the placeholder delimiters rather than
// using `\S+`, so a URL processed after MATH cannot swallow an already-substituted
// MATH placeholder when the two sit adjacent with no separating whitespace.
// A bare media filename: `1.1-collage-0-1024x1024.jpg`, `House_1993-09-13.jpg`.
// Not prose, and leaving it visible corrupts it twice over — the checkpoint
// rewrites the stem, and anything still visible to lang-normalize.mjs is prose as
// far as it knows, so `1.1-collage-0-...` was spoken as
// "uno punto uno-collage-zero-..." and the year in `House_1993-09-13.jpg` as
// "millenovecentonovantatré". MEASURED on the deployed book: 29 file-like tokens,
// 22 of them NOT inside a URL and so unprotected. Spanish and French shipped with
// that defect.
//
// The extension list is EXPLICIT for the same reason the TLD list is, and it is
// the same risk: a false positive is restored verbatim and the prose it swallowed
// is never spoken — silently. Audio and video extensions are deliberately absent;
// none occur in this corpus and a guess costs a silent swallow.
export const FILE_RE = /\b\w[\w.%-]*\.(?:jpe?g|png|gif|svg|webp|pdf)\b/gi;

const PROTECTED = [
  { kind: 'MATH', pattern: /\[\[(?:mathml|latex):[A-Za-z0-9+/=]+\]\]/g },
  { kind: 'EMAIL', pattern: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g },
  { kind: 'URL', pattern: URL_RE },
  // AFTER url on purpose: 7 of the book's 29 file-like tokens sit inside a
  // wikimedia URL and must stay ONE span rather than splitting in two.
  { kind: 'FILE', pattern: FILE_RE },
];

function placeholder(kind, n) {
  // MUST agree with PLACEHOLDER_RE. This shape also matches the existing
  // `[[latex:...]]` / `[[mathml:...]]` MATH convention and cannot collide with it:
  // MATH requires a literal `mathml:` or `latex:` prefix inside the brackets, which
  // `[A-Z]+\d+` never matches.
  return `[[${kind}${n}]]`;
}

// Punctuation that ends a sentence or clause, never a URL.
const TRAILING_PUNCT = '.,;:!?';

function occurrences(text, character) {
  let n = 0;
  for (const c of text) if (c === character) n += 1;
  return n;
}

/**
 * Split a matched URL into the URL and the punctuation sitting after it.
 *
 * The URL classes exclude only whitespace and the placeholder delimiters, so they
 * happily eat the punctuation that follows a URL in prose.
 * `(https://LibreTexts.org)` matched WITH its closing paren, which masked to
 * `Project ([[URL0]] and like...` — an opening bracket with nothing to close it.
 * The real opus-mt-tc-big-en-es checkpoint repaired the sentence by rewriting the
 * placeholder, restore() raised, and the whole sentence fell back to English.
 * Measured on `b0s0` of the deployed book.
 *
 * Two rules, applied until the span stops shrinking, because they feed each other —
 * `...org),` needs the comma peeled before the paren underneath it is visible at
 * all (measured on `b7s0`, where trimming only ')' left the span ending in ',' and
 * the sentence went out unbalanced anyway):
 *
 *   1. A trailing '.', ',', ';', ':', '!' or '?' is sentence punctuation.
 *   2. A trailing ')' with no opener inside the span is punctuation around the URL.
 *      COUNTING rather than stripping blindly is what keeps
 *      `en.wikipedia.org/wiki/Mercury_(planet)` intact — there the paren belongs to
 *      the path and its opener is inside the span.
 *
 * Peeling is safe by construction: the tail is re-emitted immediately after the
 * placeholder, so the sentence the translator sees is unchanged apart from the
 * punctuation no longer hiding inside an opaque token.
 */
function splitTrailingPunctuation(span) {
  let head = span;
  let tail = '';
  while (head) {
    const last = head[head.length - 1];
    if (TRAILING_PUNCT.includes(last)) {
      head = head.slice(0, -1);
      tail = last + tail;
    } else if (last === ')' && occurrences(head, ')') > occurrences(head, '(')) {
      head = head.slice(0, -1);
      tail = ')' + tail;
    } else {
      break;
    }
  }
  return [head, tail];
}

/**
 * Replace every protected span with an opaque placeholder.
 *
 * Returns `[maskedText, spans]`, where `spans` maps placeholder to original text.
 * Insertion order is the restore order, matching the Python's dict iteration.
 */
export function mask(text) {
  const spans = {};
  let out = text;
  let counter = 0;
  for (const { kind, pattern } of PROTECTED) {
    out = out.replace(pattern, (match) => {
      // URL only: MATH's own brackets are balanced by construction, and an address
      // cannot end in ')' and still match EMAIL's `\b`-anchored class.
      const [span, tail] = kind === 'URL' ? splitTrailingPunctuation(match) : [match, ''];
      const token = placeholder(kind, counter);
      counter += 1;
      spans[token] = span;
      return token + tail;
    });
  }
  return [out, spans];
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Put every protected span back, or throw.
 *
 * The match CONSUMES one or two brackets on each side INDEPENDENTLY rather than
 * looking for a degraded token as a substring. Measured on the real checkpoint:
 * `([[URL0]])` comes back as `([URL0])`, and a URL-only sentence's `[[URL0]]` comes
 * back as `[[URL0]` — both openers kept, one closer lost. The token itself survives
 * every time; only brackets are damaged.
 *
 * Substring matching is what makes that dangerous rather than merely unhandled:
 * `'[[URL0]'.includes('[URL0]')` is true, so a substring fallback substitutes the
 * URL and leaves the orphan '[' behind, shipping `[http://www.bbc.com/...` into a
 * track to be read aloud. Falling back to English beats that.
 *
 * A bracket-less `URL0` is deliberately NOT accepted: that is the shape the old
 * exotic-bracket scheme failed with, and matching a short run of ordinary uppercase
 * text is an unmeasured risk taken to save a sentence that already has a correct
 * fallback.
 */
export function restore(text, spans) {
  let out = text;
  for (const [token, original] of Object.entries(spans)) {
    const bare = token.replace(/^\[+|\]+$/g, '');
    let pattern = new RegExp(String.raw`\[{1,2}${escapeRegExp(bare)}\]{1,2}`, 'g');
    let found = out.match(pattern);
    if (!found) {
      // The token is intact and only its KIND WORD was damaged. Measured on the
      // deployed corpora, and it is 53 sentences across three LIVE languages —
      // more than twice the bracket damage above:
      //
      //     nl  [[FILE0]] -> [[BESTAND0]]   22   translated outright
      //     da  [[FILE0]] -> [[FIL0]]       21   translated outright
      //     sv  [[URL0]]  -> [[Url0]]       10   case-folded
      //
      // FILE is an ordinary English noun and a translator has every reason to
      // translate it; URL mostly survives because it is an acronym. Every one of
      // the 53 threw below and fell back to English — nothing crashed, nothing
      // looked wrong, and a reader simply heard an English sentence in the
      // middle of German prose.
      //
      // Renaming the kind to something opaque was measured FIRST and does not
      // solve it: across the eight shipping checkpoints the best candidate
      // survived 22 of 24 probes and nothing reached 24
      // (bench/formats/probe_placeholder.py). The residual failure is a DROPPED
      // placeholder, which no naming choice fixes and this does not either.
      //
      // THE INDEX is what makes this safe rather than merely lenient. mask()
      // numbers placeholders with ONE counter across all kinds, so an index
      // identifies a span on its own and a translated kind word cannot pull the
      // wrong span back. The closing bracket anchors it, so index 0 cannot match
      // `[[BESTAND10]]`.
      const index = bare.replace(/^[A-Za-z]+/, '');
      pattern = new RegExp(String.raw`\[{1,2}[A-Za-z]+${index}\]{1,2}`, 'g');
      found = out.match(pattern);
    }
    if (!found) {
      // Still nothing: the placeholder was DROPPED, not damaged. There is no way
      // to say what was there, so English is the right answer.
      throw new PlaceholderError(`placeholder ${token} missing from translated text`);
    }
    if (found.length > 1) {
      // A model that emitted the token twice made two URLs out of one.
      throw new PlaceholderError(`placeholder ${token} appears twice in translated text`);
    }
    // A function replacement, never a string: `original` is real text and may
    // contain '$&' or '$1', which a string replacement would interpret.
    out = out.replace(pattern, () => original);
  }
  return out;
}

/**
 * Drop placeholders entirely, for scoring.
 *
 * A placeholder present on both sides of a comparison would count as a matching
 * token and inflate the score; one present on only one side would deflate it.
 */
export function stripPlaceholders(text) {
  return text.replace(PLACEHOLDER_RE, '');
}
