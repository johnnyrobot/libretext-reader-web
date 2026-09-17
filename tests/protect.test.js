import { describe, it, expect } from 'vitest';
import parity from './fixtures/protect-parity.json';
import { mask, restore, stripPlaceholders, PlaceholderError } from '../src/protect.mjs';

/**
 * Ported from pipeline/tests/test_protect.py, case for case.
 *
 * The port is the point: pipeline/protect.py is the specification, and the two
 * implementations must agree because they translate the same corpus with the
 * same checkpoints. A divergence here is not a JS bug, it is two pipelines that
 * mangle different sentences -- and only one of them has a QA gate downstream to
 * notice.
 */

// A restricted ASCII-ish vocabulary standing in for what a real Marian checkpoint
// passes through. NOT identity: identity preserves any input, which is exactly why
// the old exotic-bracket scheme's failure went undetected by the Python suite for
// so long. A real tokenizer DROPS codepoints outside its vocabulary.
const MARIAN_LIKE_VOCAB = new Set(
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,!?:;\'"()[]/_-=+@',
);

function marianLike(line) {
  return [...line].filter((c) => MARIAN_LIKE_VOCAB.has(c)).join('');
}

describe('mask/restore', () => {
  it('survives a tokenizer that drops unknown characters', () => {
    const [masked, spans] = mask('See https://example.org/a_b for details.');
    expect(restore(marianLike(masked), spans)).toBe('See https://example.org/a_b for details.');
  });

  it('masks and restores a url', () => {
    const source = 'See https://example.org/a_b for details.';
    const [masked, spans] = mask(source);
    expect(masked).not.toContain('https://example.org/a_b');
    expect(Object.keys(spans)).toHaveLength(1);
    expect(restore(masked, spans)).toBe(source);
  });

  it('masks math tokens', () => {
    const source = 'The result [[latex:eDpeMg==]] follows.';
    const [masked, spans] = mask(source);
    expect(masked).not.toContain('eDpeMg==');
    expect(restore(masked, spans)).toBe(source);
  });

  it('survives word reordering', () => {
    const [, spans] = mask('Visit https://example.org now.');
    const placeholder = Object.keys(spans)[0];
    expect(restore(`Ahora visite ${placeholder}.`, spans))
      .toBe('Ahora visite https://example.org.');
  });

  it('treats a dropped placeholder as an error, not a warning', () => {
    const [, spans] = mask('Visit https://example.org now.');
    expect(() => restore('Ahora visite el sitio.', spans)).toThrow(PlaceholderError);
    expect(() => restore('Ahora visite el sitio.', spans)).toThrow(/missing/);
  });

  it('treats a duplicated placeholder as an error', () => {
    const [, spans] = mask('Visit https://example.org now.');
    const placeholder = Object.keys(spans)[0];
    expect(() => restore(`${placeholder} y ${placeholder}`, spans)).toThrow(/twice/);
  });

  it('leaves text with no protected spans unchanged', () => {
    const source = 'Ordinary prose with nothing to protect.';
    const [masked, spans] = mask(source);
    expect(masked).toBe(source);
    expect(spans).toEqual({});
    expect(restore(masked, spans)).toBe(source);
  });

  it('strips placeholders for scoring', () => {
    const [masked] = mask('Visit https://example.org now.');
    expect(stripPlaceholders(masked).split(/\s+/).filter(Boolean)).toEqual(['Visit', 'now.']);
  });

  it('masks adjacent spans of different kinds with no whitespace', () => {
    // The URL pattern's greedy classes exclude '[' and ']' so it cannot swallow a
    // MATH placeholder substituted in by the earlier pass.
    const source = 'See http://example.com[[latex:eDpeMg==]] end.';
    const [masked, spans] = mask(source);
    expect(Object.keys(spans)).toHaveLength(2);
    expect(restore(masked, spans)).toBe(source);
  });

  it('masks an uppercase-scheme url', () => {
    const source = 'See HTTP://EXAMPLE.COM for details.';
    const [masked, spans] = mask(source);
    expect(masked).not.toContain('HTTP://EXAMPLE.COM');
    expect(Object.keys(spans)).toHaveLength(1);
    expect(restore(masked, spans)).toBe(source);
  });
});

describe('bare-domain urls', () => {
  it('protects a scheme-less, www-less url', () => {
    const text = 'Source: commons.wikimedia.org/wiki/File:Bill_Clinton,_Yitzhak_Rabin'
      + '_at_the_White_House_1993-09-13.jpg';
    const [masked, spans] = mask(text);
    expect(masked).not.toContain('wikimedia');
    expect(Object.keys(spans)).toHaveLength(1);
    expect(restore(masked, spans)).toBe(text);
  });

  it('survives a real tokenizer', () => {
    const text = 'Ver creativecommons.org/licenses/by-nc-sa/3.0/ para la licencia.';
    const [masked, spans] = mask(text);
    expect(restore(marianLike(masked), spans)).toBe(text);
  });

  it('protects a bare domain with no path', () => {
    const text = 'Donations go to libretexts.org today.';
    const [masked, spans] = mask(text);
    expect(Object.keys(spans)).toHaveLength(1);
    expect(restore(masked, spans)).toBe(text);
  });

  // A false positive here is silent and expensive: the span is replaced by a
  // placeholder, restored verbatim, and whatever real prose it swallowed is never
  // spoken in the target language. Every string below is real content from the
  // staged book or its fixtures.
  it.each([
    // A DOI is the dangerous lookalike -- `10.1177/0956797611398495` has exactly the
    // `label.label/path` shape. It is told apart by its TLD being NUMERIC.
    'doi: 10.1177/0956797611398495.',
    'doi: 10.1002/ejsp.375.',
    'See Figure 13.1 for the layout.',
    'Many norms, e.g., fairness, guide behavior.',
    'That is, i.e., the ingroup.',
    '(4th ed., Vols. 1 and 2, pp. 595-629).',
    'Attitudes in the U.S. Government are mixed.',
  ])('does not treat %s as a url', (text) => {
    const [masked, spans] = mask(text);
    expect(spans).toEqual({});
    expect(masked).toBe(text);
  });

  // Moved out of the list above when FILE_RE was added, and kept rather than
  // deleted: the point was that `d67b...fb.jpg` has the `label.label` shape a
  // bare domain has and must NOT be claimed as a URL. Still true, still worth
  // asserting — what changed is that a different pattern now claims it
  // legitimately. A repoint, not a weakening.
  it('claims a hash filename as a FILE and never as a url', () => {
    const text = 'Image unavailable: d67b022f5b1e28272a5d29f61be9d6fb.jpg';
    const [masked, spans] = mask(text);
    expect(Object.keys(spans)).toEqual(['[[FILE0]]']);
    expect(restore(masked, spans)).toBe(text);
  });

  it('claims an email as an email, not as a url', () => {
    // An address's domain matches the bare-domain rule on its own, so with URL
    // running first the domain was masked out from under EMAIL, leaving a bare
    // `john@` behind and the address itself unprotected.
    const [masked, spans] = mask('Write to john@example.org today.');
    expect(Object.values(spans)).toEqual(['john@example.org']);
    expect(restore(masked, spans)).toBe('Write to john@example.org today.');
  });
});

describe('measured failures from the first shipped Spanish run', () => {
  it('leaves a parenthesised url\'s closing paren behind', () => {
    // b0s0. The URL class allows ')', so `(https://LibreTexts.org)` masked as the
    // span `https://LibreTexts.org)` and the model was handed an opening bracket
    // with nothing to close it. It repaired the sentence by rewriting the
    // placeholder, restore() raised, and the sentence fell back to English.
    const source = 'the LibreTexts Project (https://LibreTexts.org) and like the others';
    const [masked, spans] = mask(source);
    expect(Object.values(spans)).toEqual(['https://LibreTexts.org']);
    expect(masked).toBe('the LibreTexts Project ([[URL0]]) and like the others');
    expect(restore(masked, spans)).toBe(source);
  });

  it('keeps parens that really belong to the url', () => {
    // The counter-case, and why the rule COUNTS rather than stripping blindly.
    const source = 'See en.wikipedia.org/wiki/Mercury_(planet) for more.';
    const [, spans] = mask(source);
    expect(Object.values(spans)).toEqual(['en.wikipedia.org/wiki/Mercury_(planet)']);
  });

  it('leaves a comma and its paren behind together', () => {
    // b7s0. Trimming only ')' is not enough: the URL class also allows ',', so the
    // span ended in a comma, the paren rule never fired, and the sentence went out
    // unbalanced anyway -- shipping `...org),):` once the span was restored.
    const source = 'in the Innocence Project (http://www.innocenceproject.org), the mind';
    const [masked, spans] = mask(source);
    expect(Object.values(spans)).toEqual(['http://www.innocenceproject.org']);
    expect(masked).toBe('in the Innocence Project ([[URL0]]), the mind');
    expect(restore(masked, spans)).toBe(source);
  });

  it('does not swallow the full stop that ends a sentence', () => {
    const source = 'Donations go to libretexts.org.';
    const [, spans] = mask(source);
    expect(Object.values(spans)).toEqual(['libretexts.org']);
  });

  it('accepts a placeholder the model stripped one bracket layer from', () => {
    // Measured: `Project ([[URL0]] and like...` came back as `Project ([URL0]) y...`.
    // The token survived -- kind, digit, ordering -- and only brackets were lost.
    const [masked, spans] = mask('Visit https://libretexts.org for details.');
    const degraded = masked.replace('[[URL0]]', '[URL0]');
    expect(degraded).not.toBe(masked);
    expect(restore(degraded, spans)).toBe('Visit https://libretexts.org for details.');
  });

  it('accepts an asymmetrically stripped placeholder', () => {
    // b15s0/b18s0/b19s0/b20s0/b30s1-3: a URL-only sentence masks to a bare
    // `[[URL0]]` and comes back as `[[URL0]` -- both openers kept, one closer lost.
    // A SUBSTRING match on `[URL0]` finds it and leaves the orphan '[' behind,
    // shipping `[http://www.bbc.com/...` to be read aloud. Falling back to English
    // beats that, so the match must consume brackets on each side independently.
    const [masked, spans] = mask('http://www.bbc.com/news/world-europe-25778272');
    expect(masked).toBe('[[URL0]]');
    expect(restore('[[URL0]', spans)).toBe('http://www.bbc.com/news/world-europe-25778272');
    expect(restore('[URL0]]', spans)).toBe('http://www.bbc.com/news/world-europe-25778272');
  });

  it('still refuses a placeholder with no brackets at all', () => {
    // The recovery is for a LOST BRACKET LAYER, not a bare token. `URL0` is the
    // shape the old U+2E24/U+2E25 scheme failed with, and matching a short run of
    // ordinary uppercase text is an unmeasured risk taken to save a sentence that
    // already has a correct fallback.
    const [, spans] = mask('http://www.bbc.com/news/world-europe-25778272');
    expect(() => restore('Consulte URL0 para detalles.', spans)).toThrow(PlaceholderError);
  });

  it('still refuses a degraded placeholder seen twice', () => {
    const [masked, spans] = mask('Visit https://libretexts.org for details.');
    const degraded = masked.replace('[[URL0]]', '[URL0] and [URL0]');
    expect(() => restore(degraded, spans)).toThrow(PlaceholderError);
  });
});

describe('parity with pipeline/protect.py', () => {
  // Two implementations mask the same corpus for the same checkpoints, and only the
  // Python side has a back-translation gate downstream to notice when masking goes
  // wrong. A divergence is therefore SILENT in the browser -- a mangled URL read
  // aloud, with nothing to catch it. The ported unit tests above do not prove
  // agreement: they prove this implementation satisfies the cases someone thought
  // to write down, which is exactly the coverage a hand-ported regex slips through.
  //
  // The real book is not the corpus for this either -- only 36 of its 9,430
  // sentences carry a protected span at all. These 427 cases are built from the
  // shapes that have actually gone wrong, plus non-ASCII wrappers where Python's
  // Unicode-aware \w and \b differ from JavaScript's ASCII-only ones.
  //
  // Regenerate with scripts/gen-protect-parity.py after any change to
  // pipeline/protect.py, and READ THE DIFF: a changed fixture is either the fix you
  // intended or the drift this exists to catch.
  it('has a corpus that actually exercises masking', () => {
    expect(parity.length).toBeGreaterThan(400);
    expect(parity.filter((c) => Object.keys(c.spans).length > 0).length).toBeGreaterThan(300);
  });

  // ONE test, not 427: a divergence is reported with every diverging case listed
  // at once. Per-case tests would surface the first failure and bury the shape of
  // the rest, and the shape is the diagnosis -- one bad case is a typo, forty
  // sharing a wrapper is a regex that means something different in JavaScript.
  it('reproduces python byte for byte, on every case', () => {
    const divergences = [];
    for (const { text, masked, spans, roundTrip } of parity) {
      const [jsMasked, jsSpans] = mask(text);
      let jsRoundTrip;
      try {
        jsRoundTrip = restore(jsMasked, jsSpans);
      } catch (error) {
        if (!(error instanceof PlaceholderError)) throw error;
        jsRoundTrip = `<ERR ${error.message}>`;
      }
      if (jsMasked !== masked
        || JSON.stringify(jsSpans) !== JSON.stringify(spans)
        || jsRoundTrip !== roundTrip) {
        divergences.push({
          text,
          python: { masked, spans, roundTrip },
          javascript: { masked: jsMasked, spans: jsSpans, roundTrip: jsRoundTrip },
        });
      }
    }
    expect(divergences).toEqual([]);
  });
});

describe('restore tolerates a translated KIND word — the live defect', () => {
  // MEASURED on the deployed corpora: 53 sentences across three LIVE languages,
  // more than twice the bracket damage this module already tolerates.
  //
  //     nl  [[FILE0]] -> [[BESTAND0]]   22   translated outright
  //     da  [[FILE0]] -> [[FIL0]]       21   translated outright
  //     sv  [[URL0]]  -> [[Url0]]       10   case-folded
  //
  // FILE is an ordinary English noun and a translator has every reason to
  // translate it; URL mostly survives because it is an acronym. THIS file is
  // the one that matters for a reader — protect.mjs runs in the browser, where
  // the translation happens, so the pipeline's copy cannot fix what they hear.
  it('recovers a placeholder whose kind word was translated', () => {
    const [masked, spans] = mask('Image unavailable: cat.jpg');
    expect(masked).toBe('Image unavailable: [[FILE0]]');
    expect(restore('Afbeelding niet beschikbaar: [[BESTAND0]]', spans))
      .toBe('Afbeelding niet beschikbaar: cat.jpg');
    expect(restore('Billede er ikke tilgængeligt: [[FIL0]]', spans))
      .toBe('Billede er ikke tilgængeligt: cat.jpg');
    expect(restore('Bild otillgänglig: [[Url0]]', spans)).toBe('Bild otillgänglig: cat.jpg');
  });

  it('keeps two translated placeholders apart by their index', () => {
    // mask() numbers placeholders with ONE counter across all kinds, so an
    // index identifies a span on its own and a translated kind word can never
    // pull the wrong span back.
    const [masked, spans] = mask('Source: http://example.com/a and cat.jpg');
    expect(masked).toBe('Source: [[URL0]] and [[FILE1]]');
    expect(restore('Forrás: [[Url0]] és [[FIL1]]', spans))
      .toBe('Forrás: http://example.com/a és cat.jpg');
  });

  it('still falls back when a placeholder is DROPPED rather than damaged', () => {
    const [, spans] = mask('Image unavailable: cat.jpg');
    expect(() => restore('Afbeelding niet beschikbaar.', spans)).toThrow(PlaceholderError);
  });

  it('still refuses a translated placeholder with no brackets, or a doubled one', () => {
    const [, spans] = mask('Image unavailable: cat.jpg');
    expect(() => restore('Afbeelding: BESTAND0', spans)).toThrow(PlaceholderError);
    expect(() => restore('Beschikbaar: [[BESTAND0]] en [[BESTAND0]]', spans))
      .toThrow(PlaceholderError);
  });
});
