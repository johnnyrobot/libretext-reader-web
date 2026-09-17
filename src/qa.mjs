/**
 * What survives of the build-time QA gate when there is no back-translation.
 *
 * `pipeline/qa.py` scores a sentence by translating it BACK to English and
 * comparing. That needs the reverse checkpoint -- another ~120 MB per pair on top
 * of the 115 MB the reader already accepted -- and it doubles the inference cost
 * of a feature that must stay ahead of playback. It does not go in the browser.
 *
 * Three of its checks only ever look at ONE side of a pair, so they cost nothing
 * and are ported here:
 *
 *   isDegenerate          empty output, one word looped, a short phrase repeated
 *                         back to back, one letter repeated. Pure string
 *                         inspection, a straight port of `qa.is_degenerate`.
 *   referenceSentenceIds  a bibliography is not translated at all. A structural
 *                         rule, not a quality judgement.
 *   isImplausiblyShort    gross truncation, by word count.
 *
 * What does NOT survive is the part that catches a FLUENT mistranslation, and
 * that is not a hypothetical: on this book the back-translation gate pruned
 * exactly six sentences, and one of them was the heading `Key Takeaways`, which
 * the checkpoint rendered as `Comidas para llevar` -- "takeaway meals". Nothing
 * single-sided sees that. It is a known, accepted cost of moving translation into
 * the browser (design section 9), recorded here rather than left to be
 * rediscovered.
 *
 * Every check ACTS rather than reports, as the pipeline's do: a sentence that
 * fires is dropped to its English source, which is the outcome the sparse-track
 * contract already exists to make safe.
 */

import { stripPlaceholders } from './protect.mjs';

/**
 * Below this fraction of the source's word count, a translation is presumed
 * truncated.
 *
 * MEASURED, not chosen (R26 requires that, and `pipeline/qa.py`'s own
 * TRUNCATION_RATIO is flagged PROVISIONAL because nothing had been measured
 * when it was written). Over the 9,407 gate-vetted Spanish pairs deployed on
 * library.libretexts.dev, target/source word ratio runs:
 *
 *   min 0.47   p1 0.75   p25 1.00   median 1.09   p99 2.00
 *
 * The floor sits below the observed minimum with margin, so it fires on NO
 * vetted pair. That margin is real rather than cosmetic: the lowest legitimate
 * ratios are Spanish doing ordinary Spanish things -- "What do you do?" is
 * "¿Qué haces?", 4 words to 2 -- and a floor tight enough to catch a mild
 * shortening would drop those.
 *
 * This is NOT the same comparison `pipeline/qa._is_truncated` makes. That one
 * compares English source against English ROUND TRIP, where the target
 * language's own terseness can never reach the ratio. This one compares English
 * against SPANISH, so it had to be recalibrated against Spanish output rather
 * than ported as a constant -- which is exactly why the plan says a length-ratio
 * check is not a straight port.
 */
export const SHORT_RATIO = 0.40;

const words = (text) => stripPlaceholders(text).split(/\s+/).filter(Boolean);

/**
 * A short (2-10 word) phrase repeated back to back at least `minRepeats` times,
 * covering all but a partial trailing repeat.
 *
 * The single-word check in `isDegenerate` catches only one token looping ("the
 * the the the"). A model that loops a multi-word fragment instead has more than
 * one unique word and slips past it.
 */
function isRepeatingPhrase(list, minRepeats = 3) {
  const n = list.length;
  const maxPhraseLen = Math.min(10, Math.floor(n / minRepeats));
  for (let len = 2; len <= maxPhraseLen; len += 1) {
    const phrase = list.slice(0, len);
    let i = 0;
    let repeats = 0;
    while (i + len <= n && phrase.every((w, j) => list[i + j] === w)) {
      repeats += 1;
      i += len;
    }
    if (repeats >= minRepeats && i >= n - len) return true;
  }
  return false;
}

/** Port of `pipeline/qa.is_degenerate`, case for case. */
export function isDegenerate(text) {
  const stripped = stripPlaceholders(text).trim();
  if (!stripped) return true;

  const list = stripped.toLowerCase().split(/\s+/).filter(Boolean);
  if (list.length >= 4 && new Set(list).size === 1) return true;
  if (isRepeatingPhrase(list)) return true;

  // `\p{L}` rather than /[a-z]/i: the target languages include Greek, Russian,
  // Bulgarian and Ukrainian, and an ASCII letter class would find no letters at
  // all in a Cyrillic loop and pass it as healthy.
  const letters = [...stripped].filter((c) => /\p{L}/u.test(c));
  return letters.length >= 8 && new Set(letters).size === 1;
}

/** Gross truncation by word count. See SHORT_RATIO for the calibration. */
export function isImplausiblyShort(source, translated, ratio = SHORT_RATIO) {
  const sourceLength = words(source).length;
  if (sourceLength === 0) return false;
  return words(translated).length / sourceLength < ratio;
}

/**
 * A heading that opens a bibliography. Anchored on the WHOLE heading, never a
 * substring: "References to Prior Work" and "Cross-Cultural References" are
 * ordinary sections, and a false positive here mutes real prose to English with
 * nothing to signal it happened. Port of `pipeline/translate.REFERENCE_HEADING_RE`,
 * including the singular "Reference" -- one heading in this book says exactly
 * that, and the plural-only first version of the Python pattern missed it.
 */
const REFERENCE_HEADING_RE = /^\s*(?:references?|reference\s+list|bibliography|works\s+cited)\s*$/i;

/**
 * Sentence ids inside a reference section, which is not translated.
 *
 * A bibliography is language-neutral: author surnames, years and journal titles
 * are proper nouns, and translating them introduces factual errors rather than
 * style differences. The real checkpoint rendered `Psychological Science` as
 * `Ciencia Psicológica`, renaming a journal, and `Sidanius` as `Sidanio`,
 * corrupting an author.
 *
 * Port of `pipeline/translate.reference_sentence_ids`. The section runs from its
 * heading to the NEXT heading, not to the end of the page -- the manifest carries
 * no heading level, so end-of-page would mute a real section that happens to
 * follow the bibliography. The heading itself is not excluded: hearing
 * "Referencias" just before the English citations start is what tells a listener
 * the switch was deliberate.
 *
 * On this book it withholds 4,988 of 14,418 sentences -- a third of the page
 * count, and the largest single saving available to the translator. Skipping them
 * is not only a quality rule; it is also the cheapest speed-up in the feature.
 */
export function referenceSentenceIds(blocks) {
  const ids = new Set();
  let inReferences = false;
  for (const block of blocks) {
    if (block.kind === 'heading') {
      inReferences = REFERENCE_HEADING_RE.test(block.text ?? '');
      continue;
    }
    if (inReferences) for (const sentence of block.sentences ?? []) ids.add(sentence.id);
  }
  return ids;
}

/**
 * The single decision: keep this translation, or fall back to English?
 *
 * One function rather than three call sites, for the reason
 * `pipeline/qa.is_sentence_failure` is one function: two places that decide what
 * "failed" means eventually disagree, and the disagreement is invisible.
 */
export function shouldFallBack(source, translated) {
  return isDegenerate(translated) || isImplausiblyShort(source, translated);
}
