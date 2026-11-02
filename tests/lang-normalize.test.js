import { describe, it, expect } from 'vitest';
import parity from './fixtures/normalize-parity.json';
import {
  NORMALIZERS, normalizeEsForSpeech, normalizeFrForSpeech, normalizeDeForSpeech,
  normalizePtForSpeech,
} from '../src/lang-normalize.mjs';

/**
 * Ported from `pipeline/tests/test_lang_normalize.py`, case for case.
 *
 * Why this module has to exist client-side, with a number: an oracle diff
 * against the deployed Spanish tracks measured that
 * **21.0% of the book's sentences** reach the Spanish voice carrying raw digits
 * without it — `Había 21 mujeres` where the deployed track says `veintiuno`. Of
 * everything that changed when translation moved into the browser, it is the
 * only difference that is unambiguously a defect rather than a variation.
 *
 * Every expectation is Spanish-as-SPOKEN, not Spanish-as-written: the output
 * goes to a voice, so `1999` must arrive as words.
 *
 * The port is the point. `pipeline/lang_normalize.py` is the specification, and
 * a divergence is silent — a number read wrong sounds like a number, and only
 * the Python side ever had a gate downstream to notice.
 */

const cases = (name, rows, run = normalizeEsForSpeech) => {
  it.each(rows)(`${name}: %s → %s`, (source, expected) => {
    expect(run(source)).toBe(expected);
  });
};

describe('normalizeEsForSpeech — the four shapes the plan named', () => {
  cases('', [
    ['Sidanius, J., & Pratto, F. (1999).',
      'Sidanius, J., & Pratto, F. (mil novecientos noventa y nueve).'],
    ['El estudio costó $1,200.', 'El estudio costó mil doscientos dólares.'],
    ['El 68% de los participantes cumplió.',
      'El sesenta y ocho por ciento de los participantes cumplió.'],
    ['Jost et al. (2003) encontraron que...',
      'Jost y otros (dos mil tres) encontraron que...'],
  ]);
});

describe('the registry', () => {
  it('exposes Spanish', () => {
    expect(NORMALIZERS.es).toBe(normalizeEsForSpeech);
  });

  it('leaves a language with no normaliser yet exactly as it was', () => {
    // Rolling out language by language must not block the languages that do not
    // have one. An unregistered code is not an error.
    //
    // This example was `fr` until French became the second shipped normaliser
    // and `de` until German became the eighth. Both times it failed loudly
    // rather than quietly asserting nothing, which is the point of it. Polish
    // is the durable name: no ONNX export of opus-mt-en-pl exists and an export
    // is gate 1 of shipping a language, so `pl` cannot acquire a normaliser the
    // way `fr` and `de` did.
    const identity = (t) => t;
    expect(NORMALIZERS.pl).toBeUndefined();
    expect((NORMALIZERS.pl ?? identity)('Witaj 1999.')).toBe('Witaj 1999.');
  });
});

describe('cardinals — the irregular forms nobody remembers', () => {
  cases('regular spine', [
    ['0 casos', 'cero casos'],
    ['2 casos', 'dos casos'],
    ['15 casos', 'quince casos'],
  ]);

  // 16-19 and 21-29 are single fused words in Spanish. A TENS + ONES join gets
  // every one of them wrong: "diez y seis", "veinte y uno".
  cases('fused teens and twenties', [
    ['16 casos', 'dieciséis casos'],
    ['19 casos', 'diecinueve casos'],
    ['21 casos', 'veintiuno casos'],
    ['22 casos', 'veintidós casos'],
    ['26 casos', 'veintiséis casos'],
  ]);

  // From 31 up the joiner IS "y", and it is a separate word.
  cases('the y joiner starts at 31', [
    ['31 casos', 'treinta y uno casos'],
    ['68 casos', 'sesenta y ocho casos'],
  ]);

  cases('cien against ciento', [
    ['100 casos', 'cien casos'],
    ['101 casos', 'ciento uno casos'],
    ['199 casos', 'ciento noventa y nueve casos'],
  ]);

  // Irregular at 5, 7 and 9 — never "cincocientos".
  cases('hundreds', [
    ['200 casos', 'doscientos casos'],
    ['500 casos', 'quinientos casos'],
    ['700 casos', 'setecientos casos'],
    ['900 casos', 'novecientos casos'],
  ]);

  // 1000 is bare "mil", never "un mil" — unlike "un millón", which keeps its un.
  cases('thousands and millions', [
    ['1,000 casos', 'mil casos'],
    ['1,200 casos', 'mil doscientos casos'],
    ['2,415 casos', 'dos mil cuatrocientos quince casos'],
    ['21,000 casos', 'veintiún mil casos'],
    ['1,000,000 casos', 'un millón casos'],
    ['2,000,000 casos', 'dos millones casos'],
  ]);
});

describe('years are plain cardinals, not English century splits', () => {
  // Measured, not assumed: where Opus-MT got a year right unaided it produced
  // "mil novecientos sesenta y uno". Porting English's century split would give
  // "diecinueve sesenta y uno" — the exact defect this decision exists to avoid.
  cases('', [
    ['en 1961.', 'en mil novecientos sesenta y uno.'],
    ['en 1900.', 'en mil novecientos.'],
    ['en 1993.', 'en mil novecientos noventa y tres.'],
    ['en 2000.', 'en dos mil.'],
    ['en 2010.', 'en dos mil diez.'],
  ]);
});

describe('currency reads as dollars and cents, not as a decimal', () => {
  cases('', [
    // The measured checkpoint output puts a space after the sign, so the space
    // is optional rather than required.
    ['costó $15.50 por sesión.', 'costó quince dólares y cincuenta centavos por sesión.'],
    ['costó $ 15.50 por sesión.', 'costó quince dólares y cincuenta centavos por sesión.'],
    ['costó $1 por sesión.', 'costó un dólar por sesión.'],
    ['costó $21 por sesión.', 'costó veintiún dólares por sesión.'],
    ['costó $100 por sesión.', 'costó cien dólares por sesión.'],
    ['costó $15.00 por sesión.', 'costó quince dólares por sesión.'],
  ]);
});

describe('percentages', () => {
  cases('', [
    ['el 82% de los ensayos', 'el ochenta y dos por ciento de los ensayos'],
    ['el 82 % de los ensayos', 'el ochenta y dos por ciento de los ensayos'],
    ['el 61,5% de los ensayos', 'el sesenta y uno coma cinco por ciento de los ensayos'],
  ]);
});

describe('et al. is the ONE abbreviation with a rule', () => {
  it('expands et al. and leaves the rest alone', () => {
    // `e.g.,` and `i.e.,` were measured translating correctly UNAIDED into
    // `por ejemplo` / `es decir`, and only `et al.` failing — twice,
    // reproducibly. The rest of normalize.py's ABBREVIATIONS table is
    // deliberately not ported; each entry has to be measured before it earns a
    // rule.
    expect(normalizeEsForSpeech('Jost et al. encontraron')).toBe('Jost y otros encontraron');
    expect(normalizeEsForSpeech('por ejemplo, la equidad')).toBe('por ejemplo, la equidad');
    expect(normalizeEsForSpeech('es decir, el propio grupo')).toBe('es decir, el propio grupo');
  });
});

describe('the ordering this module depends on', () => {
  it('leaves protected placeholders untouched', () => {
    // This runs BEFORE restore(), so every URL, email and math token is still a
    // [[KIND0]] placeholder. If a number pass ever bit into one, restore() would
    // raise and the sentence would silently fall back to English.
    expect(normalizeEsForSpeech('Véase [[URL0]] y [[MATH12]] en 1999.'))
      .toBe('Véase [[URL0]] y [[MATH12]] en mil novecientos noventa y nueve.');
  });

  it('does not read a Spanish decimal comma as a thousands group', () => {
    // A thousands group is ALWAYS exactly three digits, so `1,25` cannot be one
    // and `1,250` cannot be anything else. Backwards, this turns 1.25 into 125 —
    // a wrong VALUE, the worst class of defect there is here.
    expect(normalizeEsForSpeech('un valor de 1,25')).toBe('un valor de uno coma dos cinco');
    expect(normalizeEsForSpeech('un valor de 1,250'))
      .toBe('un valor de mil doscientos cincuenta');
  });

  it('reads a decimal digit by digit after the separator', () => {
    // Digit-by-digit on BOTH separators, deliberately. Reading the fraction as a
    // cardinal is idiomatic for money and produces a wrong value for anything
    // else — 1,205 would become "coma doscientos cinco".
    expect(normalizeEsForSpeech('p = 0.05')).toBe('p = cero punto cero cinco');
  });

  it('returns text with no numbers unchanged', () => {
    const text = 'La cooperación intergrupal reduce el prejuicio.';
    expect(normalizeEsForSpeech(text)).toBe(text);
  });
});

describe('a word boundary is a TRANSITION, not just "no word char after"', () => {
  // Found by running the port over the real corpus, not by inspection: it
  // diverged on 450 of 23,848 lines and every one was this.
  //
  // Python's `\b` at the end of `\b\d[\d,]*\b` cannot sit after a comma —
  // comma and space are both non-word, so there is no transition there — so the
  // engine backtracks and matches `1` alone, leaving the comma in place. A naive
  // `(?!\w)` is satisfied by that same position and swallows the comma, which
  // silently deletes the pause between every item in a list.
  it('keeps the commas in a list of numbers', () => {
    expect(normalizeEsForSpeech('áreas 1, 2, 4 y 5.'))
      .toBe('áreas uno, dos, cuatro y cinco.');
  });

  it('keeps the comma after a number mid-sentence', () => {
    expect(normalizeEsForSpeech('era la Línea 1, todos dirían'))
      .toBe('era la Línea uno, todos dirían');
  });

  it('leaves a Spanish ordinal alone, as the Python does', () => {
    // `ª` and `º` are word characters to Python and not to JavaScript. With an
    // ASCII boundary this reads "tres ª", which is not a word.
    expect(normalizeEsForSpeech('la 3ª edición')).toBe('la 3ª edición');
    expect(normalizeEsForSpeech('el 1º puesto')).toBe('el 1º puesto');
  });
});

describe('long ungrouped digit runs are identifiers, not quantities', () => {
  cases('', [
    // The real failure this rule exists for: the checkpoint collapses an en-dash
    // page range into one digit run, and a cardinal reading invents a value
    // seven orders of magnitude off.
    ['páginas 4064412.', 'páginas cuatro cero seis cuatro cuatro uno dos.'],
    ['doi: 10.1177/0956797611398495.',
      'doi: diez punto uno uno siete siete/cero nueve cinco seis siete nueve '
      + 'siete seis uno uno tres nueve ocho cuatro nueve cinco.'],
    // A leading zero is an identifier tell at any length, and a cardinal reading
    // deletes it outright.
    ['la sala 007.', 'la sala cero cero siete.'],
    // A thousands separator is the signal that a run IS a quantity, so a grouped
    // number keeps its cardinal reading however long it gets.
    ['2,415 casos', 'dos mil cuatrocientos quince casos'],
    ['1,000,000 casos', 'un millón casos'],
    // Under the threshold, still a quantity.
    ['406 páginas', 'cuatrocientos seis páginas'],
    ['1961 en el texto', 'mil novecientos sesenta y uno en el texto'],
  ]);
});

describe('parity with pipeline/lang_normalize.py', () => {
  // 315 cases, 300 of them REAL translated lines from the deployed book. Unlike
  // protect's parity fixture -- which has to be hand-built, because only 50 of
  // 14,418 sentences carry a protected span -- the book exercises every pass in
  // this module hundreds of times, so the corpus is the strongest evidence
  // available rather than a convenience.
  //
  // Regenerate with scripts/gen-normalize-parity.py after ANY change to the
  // Python, and read the diff.
  //
  // Keyed by `lang` rather than run through one function: the two normalisers
  // disagree on purpose about what a comma and a space mean, so feeding a French
  // case to the Spanish pass would fail for a reason that has nothing to do with
  // parity.
  const run = {
    es: normalizeEsForSpeech, fr: normalizeFrForSpeech, de: normalizeDeForSpeech, pt: normalizePtForSpeech,
  };
  it.each(parity.map((c, i) => [i, c]))('case %i (%o)', (_i, { lang, source, expected }) => {
    expect(run[lang](source)).toBe(expected);
  });

  it('covers every shipped language', () => {
    // A fixture that quietly lost a language would still pass every case it has.
    for (const code of Object.keys(NORMALIZERS)) {
      expect(parity.some((c) => c.lang === code), `no ${code} cases`).toBe(true);
    }
  });

  it('is a fixture with teeth: most cases actually change', () => {
    // A fixture of unchanged prose would assert that the module does nothing,
    // which an empty implementation passes.
    const changed = parity.filter((c) => c.source !== c.expected).length;
    expect(changed).toBeGreaterThan(parity.length * 0.9);
  });
});

/**
 * French — the SECOND language, and the one that proves this file was right to be
 * per-language rather than a shared number-speller with a word table.
 *
 * The en-fr checkpoint was measured before any of these were written, and it
 * LOCALISES what the en-es one preserved:
 *
 *   $1,200   → "1 200 $"        thousands split by U+0020, sign trailing
 *   $15.50   → "15,50 dollars"  decimal COMMA, unit spelled out
 *   68%      → "68 %"           space before the sign
 *   p = 0.05 → "p = 0,05"       decimal COMMA
 *   et al.   → "et al."         already correct French; no rule earned
 *
 * A comma is a DECIMAL here and never a thousands group, and a SPACE is a
 * thousands group — the exact inverse of Spanish on both counts. Reading `1 200`
 * as two numbers gives "un deux cents", a wrong VALUE.
 */
describe('normalizeFrForSpeech — cardinals, where French is at its most irregular', () => {
  const fr = (rows) => it.each(rows)('%s → %s', (source, expected) => {
    expect(normalizeFrForSpeech(source)).toBe(expected);
  });

  fr([
    ['0 cas', 'zéro cas'],
    ['16 cas', 'seize cas'],
    // 17-19 are BUILT, not listed. French fuses nothing above 16, where Spanish
    // runs to 29.
    ['17 cas', 'dix-sept cas'],
    ['19 cas', 'dix-neuf cas'],
    // "et" at 21/31/41/51/61 and at 71 — and never at 81 or 91.
    ['21 cas', 'vingt et un cas'],
    ['22 cas', 'vingt-deux cas'],
    ['31 cas', 'trente et un cas'],
    ['68 cas', 'soixante-huit cas'],
    // 70-79 is 60 + 10..19, which is what makes 71 "soixante et onze".
    ['70 cas', 'soixante-dix cas'],
    ['71 cas', 'soixante et onze cas'],
    ['79 cas', 'soixante-dix-neuf cas'],
    // 80 alone takes the plural s; 81-99 never do, and 90-99 is 80 + 10..19.
    ['80 cas', 'quatre-vingts cas'],
    ['81 cas', 'quatre-vingt-un cas'],
    ['90 cas', 'quatre-vingt-dix cas'],
    ['91 cas', 'quatre-vingt-onze cas'],
    ['99 cas', 'quatre-vingt-dix-neuf cas'],
    // "cent" takes an s only when nothing follows it.
    ['100 cas', 'cent cas'],
    ['101 cas', 'cent un cas'],
    ['200 cas', 'deux cents cas'],
    ['201 cas', 'deux cent un cas'],
    ['180 cas', 'cent quatre-vingts cas'],
    // "mille" is invariable and never carries "un".
    ['1 000 cas', 'mille cas'],
    ['2 000 cas', 'deux mille cas'],
    ['1 200 cas', 'mille deux cents cas'],
    ['21 000 cas', 'vingt et un mille cas'],
    ['1 000 000 cas', 'un million cas'],
    ['2 000 000 cas', 'deux millions cas'],
  ]);
});

describe('French: the conventions that differ from Spanish', () => {
  it('reads a space-grouped thousand as ONE number', () => {
    // The dangerous one. Two numbers would be "un deux cents" — a wrong value,
    // spoken. Measured: across the 9,430 attempted sentences a "N NNN" adjacency
    // that is NOT a grouped thousand occurs zero times, and a grouped thousand
    // occurs 15 times.
    expect(normalizeFrForSpeech('1 200 cas')).toBe('mille deux cents cas');
  });

  it('does not join two numbers that merely sit next to each other', () => {
    // The guard is that a group is EXACTLY three digits: 2010 is four, so the
    // trailing lookahead rejects it and the two years stay two years.
    expect(normalizeFrForSpeech('en 1961 2010'))
      .toBe('en mille neuf cent soixante et un deux mille dix');
  });

  it('reads a comma as a decimal, never as a thousands group', () => {
    expect(normalizeFrForSpeech('le seuil p = 0,05'))
      .toBe('le seuil p = zéro virgule zéro cinq');
  });

  it('reads a dot between digits as a dot, because it is not a French decimal', () => {
    expect(normalizeFrForSpeech('doi: 10.1177')).toBe('doi: dix point un un sept sept');
  });

  it('handles both currency shapes the checkpoint actually emits', () => {
    expect(normalizeFrForSpeech('a coûté 1 200 $ au total.'))
      .toBe('a coûté mille deux cents dollars au total.');
    expect(normalizeFrForSpeech('a coûté 1 $ au total.')).toBe('a coûté un dollar au total.');
    expect(normalizeFrForSpeech('Il coûte 15,50 dollars par session.'))
      .toBe('Il coûte quinze dollars et cinquante cents par session.');
  });

  it('takes the space before the percent sign', () => {
    expect(normalizeFrForSpeech('68 % des participants'))
      .toBe('soixante-huit pour cent des participants');
    expect(normalizeFrForSpeech('68% des participants'))
      .toBe('soixante-huit pour cent des participants');
  });

  it('leaves et al. alone, because the French checkpoint gets it right', () => {
    // MEASURED, not assumed, and the opposite result from Spanish. The es rule
    // exists because that checkpoint mangled `et al.` twice, reproducibly; the fr
    // one passes it through, and `et al.` IS correct French academic prose.
    expect(normalizeFrForSpeech('Jost et al. ont trouvé')).toBe('Jost et al. ont trouvé');
  });

  it('keeps placeholders and identifiers intact', () => {
    expect(normalizeFrForSpeech('Voir [[URL0]] en 1999.'))
      .toBe('Voir [[URL0]] en mille neuf cent quatre-vingt-dix-neuf.');
    expect(normalizeFrForSpeech('pages 4064412.'))
      .toBe('pages quatre zéro six quatre quatre un deux.');
    expect(normalizeFrForSpeech('la salle 007.')).toBe('la salle zéro zéro sept.');
  });

  it('registers French', () => {
    expect(NORMALIZERS.fr).toBe(normalizeFrForSpeech);
  });
});


/**
 * A decimal written without its leading zero. NOT per-language: every
 * registered normaliser read `.30` as THIRTY before this — a wrong VALUE, in
 * five languages that were already live. Measured across the deployed corpora:
 * nl 5, hu 4, da 4, it 4, sv 4, fr 3, all correlation coefficients.
 */
describe('a decimal without its leading zero', () => {
  it.each(Object.keys(NORMALIZERS))('%s reads .30 exactly as it reads 0.30', (code) => {
    // The whole specification, as an equivalence rather than a word list — which
    // is what makes the fix incapable of inventing a reading, and correct for
    // the next language without another constant.
    const n = NORMALIZERS[code];
    expect(n('r = .30 och')).toBe(n('r = 0.30 och'));
    expect(n('omkring .7 av')).toBe(n('omkring 0.7 av'));
    expect(n('r = .30 och')).not.toMatch(/\d/);
  });

  it.each(Object.keys(NORMALIZERS))('%s does not touch a dot after a word', (code) => {
    // `Fig.2` must not become `Fig0.2` and `1.3` must not become `10.3`.
    const n = NORMALIZERS[code];
    expect(n('se Fig.2 nedan')).not.toContain('0.2');
    expect(n('figur 1.3 visar')).not.toContain('10.3');
  });
});

/**
 * German — the EIGHTH language and the FIFTH distinct convention, and the first
 * that both preserves and localises. Measured with bench/formats/measure.py on
 * the deployed post-splitter corpus; counts in bench/formats/de.json.
 *
 *   1,200     → "1.200"      DOT thousands           20 occurrences
 *   1.3 / 2.0 → unchanged     short dot KEPT         328 occurrences
 *   $8.3 tn   → "8,3 Billionen"  comma decimal         5 occurrences
 *   68%       → "20 %" (24) AND "35%" (54)  BOTH spacings in one corpus
 *   et al.    → "et al."      preserved 100 times, no rule earned
 *   20th C    → "20. Jahrhundert"  ORDINAL DOT — recorded, not handled
 */
describe('German cardinals — the unit goes FIRST, joined with "und"', () => {
  const de = (rows) => it.each(rows)('%s → %s', (source, expected) => {
    expect(normalizeDeForSpeech(source)).toBe(expected);
  });

  de([
    ['0 Fälle', 'null Fälle'],
    ['2 Fälle', 'zwei Fälle'],
    // The two elisions a TENS + ONES join gets wrong, in the teens and again
    // in the tens: sechzehn/sechzig, siebzehn/siebzig.
    ['16 Fälle', 'sechzehn Fälle'],
    ['17 Fälle', 'siebzehn Fälle'],
    ['20 Fälle', 'zwanzig Fälle'],
    // Swedish, shipped immediately before German, puts the TEN first with no
    // joiner (tjugoett). This is the one rule a port from it gets wrong on
    // every number between 21 and 99.
    ['21 Fälle', 'einundzwanzig Fälle'],
    ['35 Fälle', 'fünfunddreißig Fälle'],
    ['68 Fälle', 'achtundsechzig Fälle'],
    ['99 Fälle', 'neunundneunzig Fälle'],
    ['30 Fälle', 'dreißig Fälle'],
    ['60 Fälle', 'sechzig Fälle'],
    ['70 Fälle', 'siebzig Fälle'],
    ['100 Fälle', 'hundert Fälle'],
    // Standalone 1 is "eins"; the compound form is "ein". Same language.
    ['101 Fälle', 'hunderteins Fälle'],
    ['512 Fälle', 'fünfhundertzwölf Fälle'],
    // German writes a whole number as ONE word, as Swedish does.
    ['2500 Fälle', 'zweitausendfünfhundert Fälle'],
    ['100.000 Fälle', 'hunderttausend Fälle'],
    ['40.320 Fälle', 'vierzigtausenddreihundertzwanzig Fälle'],
    // FEMININE: eine Million, not ein.
    ['1.000.000 Fälle', 'eine Million Fälle'],
    ['Jahr 1961.', 'Jahr neunzehnhunderteinundsechzig.'],
    ['März 1997', 'März neunzehnhundertsiebenundneunzig'],
    ['Jahr 2010.', 'Jahr zweitausendzehn.'],
  ]);
});

describe('German dots, percent spacings and currency', () => {
  const de = (rows) => it.each(rows)('%s → %s', (source, expected) => {
    expect(normalizeDeForSpeech(source)).toBe(expected);
  });

  de([
    // 20 real thousands groups against 328 short dot forms over all 9,430
    // sentences — Italian's split (20 against 335) almost exactly.
    ['über 8.000 Morde', 'über achttausend Morde'],
    ['über 20.000 Forscher', 'über zwanzigtausend Forscher'],
    ['(das sind 40.320)', '(das sind vierzigtausenddreihundertzwanzig)'],
    ['Abbildung 1.3 Der', 'Abbildung eins Punkt drei Der'],
    ['CC BY 2.0.', 'CC BY zwei Punkt null.'],
    // 24 spaced against 54 attached, sometimes in the same sentence. Neither
    // French's constant nor Italian's would do.
    ['20 % der Jugendlichen', 'zwanzig Prozent der Jugendlichen'],
    ['54% der LGBT-Jugend', 'vierundfünfzig Prozent der LGBT-Jugend'],
    // A German numeral agrees with the noun it counts: "ein Prozent".
    ['machte nur 1 % aus', 'machte nur ein Prozent aus'],
    ['für $1', 'für ein Dollar'],
    ['für $50.', 'für fünfzig Dollar.'],
    ['bekommt $60', 'bekommt sechzig Dollar'],
    // 5 comma decimals in 9,430 sentences. German is not French: 328 English
    // dot decimals survive untouched against those five.
    ['löschte 8,3 Billionen Dollar', 'löschte acht Komma drei Billionen Dollar'],
    // A German "Billion" is 10^12 and an English "billion" is 10^9, so nothing
    // maps one onto the other — the checkpoint already gets the word right.
    ['etwa 100 Milliarden Neuronen', 'etwa hundert Milliarden Neuronen'],
  ]);

  it('leaves et al. alone', () => {
    expect(normalizeDeForSpeech('von Berman et al. (2009).'))
      .toBe('von Berman et al. (zweitausendneun).');
  });

  it('leaves placeholders alone and spells identifiers digit by digit', () => {
    expect(normalizeDeForSpeech('Siehe [[URL0]] im Jahr 1999.'))
      .toBe('Siehe [[URL0]] im Jahr neunzehnhundertneunundneunzig.');
    expect(normalizeDeForSpeech('Seite 4064412.'))
      .toBe('Seite vier null sechs vier vier eins zwei.');
  });

  it('reads an ordinal as a cardinal, which is a RECORDED gap', () => {
    // Not fixed: correct German needs declension ("zwanzigsten"), and that
    // trailing dot is indistinguishable from a sentence-final period before a
    // capitalised noun — and German capitalises every noun. This asserts the
    // current reading so building that system is a visible change, not a
    // silent one. The year beside it is still read correctly.
    expect(normalizeDeForSpeech('im 20. Jahrhundert')).toBe('im zwanzig. Jahrhundert');
    expect(normalizeDeForSpeech('Am 26. März 1997 wurden'))
      .toBe('Am sechsundzwanzig. März neunzehnhundertsiebenundneunzig wurden');
  });
});

describe('German — the two defects the whole-track audit caught', () => {
  it('reads a decade suffix rather than leaving its digits', () => {
    // 23 occurrences reached the voice as RAW DIGITS. German glues the suffix
    // straight onto the numeral where Swedish hyphenates it (1960-talet), so
    // checking for a hyphen construction found nothing while the phenomenon
    // was there. Nothing \b-anchored can see `1970er` — there is no boundary
    // between `0` and `e` — so the year and integer passes both skipped it.
    expect(normalizeDeForSpeech('In den 1970er und 1980er Jahren'))
      .toBe('In den neunzehnhundertsiebziger und neunzehnhundertachtziger Jahren');
    expect(normalizeDeForSpeech('in den 40er Jahren')).toBe('in den vierziger Jahren');
    expect(normalizeDeForSpeech('die 1950er Jahre')).toBe('die neunzehnhundertfünfziger Jahre');
  });

  it('leaves an identifier glued to other letters alone', () => {
    for (const text of ['Fenix_21 – DSC01311 – CC BY-NC-ND', 'ein 497px breites Bild',
      'LindaDee2006 und 83bf']) {
      expect(normalizeDeForSpeech(text)).toBe(text);
    }
  });

  it('expands the two abbreviations that read as letters', () => {
    // z.B. 103 times and d.h. 38, both spellings. Swedish earned its m.fl.
    // rule at 29 occurrences; this is 141.
    expect(normalizeDeForSpeech('Wissen (z.B. unser Wissen)'))
      .toBe('Wissen (zum Beispiel unser Wissen)');
    expect(normalizeDeForSpeech('etwa z. B. wenn')).toBe('etwa zum Beispiel wenn');
    expect(normalizeDeForSpeech('d.h. über 7 Millionen')).toBe('das heißt über sieben Millionen');
  });

  it('leaves author initials and et al. alone', () => {
    // Why the rule names two literal strings instead of matching the dotted
    // shape: B. F. / R. H. / R. J. have the identical shape and must survive.
    expect(normalizeDeForSpeech('Skinner, B. F. und Fazio, R. H. et al. (1998)'))
      .toBe('Skinner, B. F. und Fazio, R. H. et al. (neunzehnhundertachtundneunzig)');
  });
});


/**
 * Portuguese (LT-217), Brazilian, because the en-pt export writes Brazilian —
 * "colônias", "US$". Shapes measured on 146 corpus sentences translated one at a
 * time by Douglasrambo/opus-mt-tc-big-en-pt-onnx; there is no deployed pt track.
 * The same cases as pipeline/tests/test_lang_normalize.py.
 *
 *   1,200     → "1.200"        DOT thousands
 *   $1,250    → "1,250 dólares" a leaked English COMMA group
 *   0.5 / 37.5% → "0,5", "37,5%"  decimal COMMA
 *   1.3 / 3.14 → unchanged       short dot KEPT, as in German
 *   $3 million → "US$ 3 milhões"
 */
describe('Portuguese', () => {
  const pt = (name, rows) => cases(name, rows, normalizePtForSpeech);

  it('is registered', () => {
    expect(NORMALIZERS.pt).toBe(normalizePtForSpeech);
  });

  pt('cardinals', [
    ['0 casos', 'zero casos'],
    ['14 casos', 'catorze casos'],
    ['16 casos', 'dezesseis casos'],
    ['19 casos', 'dezenove casos'],
    ['21 casos', 'vinte e um casos'],
    ['100 casos', 'cem casos'],
    ['101 casos', 'cento e um casos'],
    ['500 casos', 'quinhentos casos'],
    ['999 casos', 'novecentos e noventa e nove casos'],
    ['1000 casos', 'mil casos'],
    ['1200 casos', 'mil e duzentos casos'],
    ['1250 casos', 'mil duzentos e cinquenta casos'],
    ['2019 casos', 'dois mil e dezenove casos'],
  ]);

  pt('years', [
    ['Em 1776, 13 colônias declararam independência.',
      'Em mil setecentos e setenta e seis, treze colônias declararam independência.'],
    ['na década de 1990.', 'na década de mil novecentos e noventa.'],
  ]);

  pt('separators', [
    ['dos 1.200 alunos', 'dos mil e duzentos alunos'],
    ['Pesa 0,5 kg', 'Pesa zero vírgula cinco kg'],
    ['custava 1,250 reais', 'custava mil duzentos e cinquenta reais'],
    ['Tabela 1.3 Exemplos', 'Tabela um ponto três Exemplos'],
    ['de 3.14 para', 'de três ponto um quatro para'],
    ['1.000.000 casos', 'um milhão casos'],
    ['1246120 e', 'um dois quatro seis um dois zero e'],
    ['pesa 1.234,5 kg', 'pesa mil duzentos e trinta e quatro vírgula cinco kg'],
  ]);

  pt('currency', [
    ['O bilhete custava 12,50 dólares.', 'O bilhete custava doze dólares e cinquenta centavos.'],
    ['o livro custava 1,250 dólares.', 'o livro custava mil duzentos e cinquenta dólares.'],
    ['custou 1 dólar', 'custou um dólar'],
    ['custou US$ 12,50.', 'custou doze dólares e cinquenta centavos.'],
    ['custou US $ 1.200.', 'custou mil e duzentos dólares.'],
    ['custou $0,50.', 'custou cinquenta centavos.'],
    ['custou $1.', 'custou um dólar.'],
    ['45% de US$ 3 milhões', 'quarenta e cinco por cento de três milhões de dólares'],
    ['US$ 2,5 bilhões', 'dois vírgula cinco bilhões de dólares'],
    ['US$ 1.000.000', 'um milhão de dólares'],
    // A grouped amount with cents is one amount, in Brazilian or leaked
    // English form; English-dot cents and scales too.
    ['custou US$ 1.250,50.', 'custou mil duzentos e cinquenta dólares e cinquenta centavos.'],
    ['custava 1.250,50 dólares', 'custava mil duzentos e cinquenta dólares e cinquenta centavos'],
    ['custou $1,250.50.', 'custou mil duzentos e cinquenta dólares e cinquenta centavos.'],
    ['custou $3.50.', 'custou três dólares e cinquenta centavos.'],
    ['US$ 1.5 bilhão', 'um vírgula cinco bilhão de dólares'],
  ]);

  pt('percent', [
    ['Cerca de 37,5% dos alunos', 'Cerca de trinta e sete vírgula cinco por cento dos alunos'],
    ['apenas 15% a 20%', 'apenas quinze por cento a vinte por cento'],
    ['só 1 % deles', 'só um por cento deles'],
  ]);

  pt('et al.', [
    ['(Kirsch et al., 2005)', '(Kirsch e outros, dois mil e cinco)'],
  ]);
});
