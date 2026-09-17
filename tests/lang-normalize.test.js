import { describe, it, expect } from 'vitest';
import parity from './fixtures/normalize-parity.json';
import {
  NORMALIZERS, normalizeEsForSpeech, normalizeFrForSpeech, normalizeItForSpeech,
  normalizeNlForSpeech, normalizeHuForSpeech, normalizeDaForSpeech,
  normalizeSvForSpeech, normalizeDeForSpeech, normalizeCsForSpeech,
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
 * goes to Supertonic, so `1999` must arrive as words.
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
    es: normalizeEsForSpeech, fr: normalizeFrForSpeech,
    it: normalizeItForSpeech, nl: normalizeNlForSpeech,
    hu: normalizeHuForSpeech, da: normalizeDaForSpeech,
    sv: normalizeSvForSpeech, de: normalizeDeForSpeech,
    cs: normalizeCsForSpeech,
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


// ---------------------------------------------------------------------------
// Italian. Ported from pipeline/tests/test_lang_normalize.py, case for case.
// ---------------------------------------------------------------------------

describe('Italian inverts BOTH marks relative to English', () => {
  it('reads a three-digit dot group as a thousands separator', () => {
    expect(normalizeItForSpeech('40.000 partecipanti')).toBe('quarantamila partecipanti');
    expect(normalizeItForSpeech('1.200 casi')).toBe('milleduecento casi');
  });

  // MEASURED: across the 9,423 shipped Italian sentences the 1-2 digit dot form
  // occurs 335 times against 20 real thousands groups — 17x more often. Reading
  // a dot as thousands unconditionally turns "Figura 7.5" into
  // "figura settemilacinque", a wrong VALUE, 335 times over to fix 20.
  it('reads a one or two digit dot group as a section number, not a thousand', () => {
    expect(normalizeItForSpeech('Figura 7.5 mostra')).toBe('Figura sette punto cinque mostra');
    expect(normalizeItForSpeech('Tabella 12.2 elenca')).toBe('Tabella dodici punto due elenca');
    expect(normalizeItForSpeech('CC BY 2.0.')).toBe('CC BY due punto zero.');
  });

  it('reads a comma between digits as a decimal', () => {
    expect(normalizeItForSpeech('la soglia p 0,05')).toBe('la soglia p zero virgola zero cinque');
  });
});

describe('Italian cardinals — the elisions a port gets wrong', () => {
  it.each([
    ['20 casi', 'venti casi'],
    // The tens elide their final vowel before uno and otto.
    ['21 casi', 'ventuno casi'],
    ['22 casi', 'ventidue casi'],
    // "tre" takes an accent as the final element of a compound.
    ['23 casi', 'ventitré casi'],
    ['28 casi', 'ventotto casi'],
    ['31 casi', 'trentuno casi'],
    ['33 casi', 'trentatré casi'],
    ['68 casi', 'sessantotto casi'],
    ['91 casi', 'novantuno casi'],
    // cento is invariable, and elides before otto/ottanta.
    ['100 casi', 'cento casi'],
    ['101 casi', 'centouno casi'],
    ['108 casi', 'centotto casi'],
    ['180 casi', 'centottanta casi'],
    ['200 casi', 'duecento casi'],
    // mille singular, -mila plural, fused into one word.
    ['1.000 casi', 'mille casi'],
    ['2.000 casi', 'duemila casi'],
    ['21.000 casi', 'ventunomila casi'],
    ['1.000.000 casi', 'un milione casi'],
    ['2.000.000 casi', 'due milioni casi'],
  ])('%s -> %s', (source, expected) => {
    expect(normalizeItForSpeech(source)).toBe(expected);
  });

  it.each([
    ['nel 1961.', 'nel millenovecentosessantuno.'],
    ['nel 1900.', 'nel millenovecento.'],
    ['nel 1993.', 'nel millenovecentonovantatré.'],
    ['nel 2000.', 'nel duemila.'],
    ['nel 2010.', 'nel duemiladieci.'],
  ])('year %s -> %s', (source, expected) => {
    expect(normalizeItForSpeech(source)).toBe(expected);
  });
});

describe('Italian currency and percentages', () => {
  it.each([
    ['costa $ 1.200 in totale.', 'costa milleduecento dollari in totale.'],
    ['costa $ 1 in totale.', 'costa un dollaro in totale.'],
    ['costa $ 15,50.', 'costa quindici dollari e cinquanta centesimi.'],
  ])('%s -> %s', (source, expected) => {
    expect(normalizeItForSpeech(source)).toBe(expected);
  });

  // MEASURED on the shipped track: "$ 8,3 trilioni" was reading as "otto dollari
  // e trenta centesimi trilioni" — $8.30 rather than $8.3 trillion, a wrong
  // VALUE. One occurrence in 9,423 sentences; the rule is earned by the severity
  // of the failure, not its frequency.
  it('does not read a scaled currency amount as dollars and cents', () => {
    expect(normalizeItForSpeech('ha cancellato $ 8,3 trilioni di ricchezza.'))
      .toBe('ha cancellato otto virgola tre trilioni di dollari di ricchezza.');
    expect(normalizeItForSpeech('circa $ 3 miliardi persi.'))
      .toBe('circa tre miliardi di dollari persi.');
  });

  // MEASURED: the en-it checkpoint emits NO space before the sign, 82 times out
  // of 82. The spaced form is accepted anyway, because it costs nothing.
  it.each([
    ['il 68% dei partecipanti', 'il sessantotto per cento dei partecipanti'],
    ['il 68 % dei partecipanti', 'il sessantotto per cento dei partecipanti'],
    ['lo 0,5% dei casi', 'lo zero virgola cinque per cento dei casi'],
  ])('%s -> %s', (source, expected) => {
    expect(normalizeItForSpeech(source)).toBe(expected);
  });
});

describe('Italian leaves alone what it was measured not to break', () => {
  // MEASURED, like French and unlike Spanish: `et al.` survives the en-it
  // checkpoint intact 100 times out of 100, and it IS correct Italian academic
  // prose. Porting the Spanish rule here would be cargo-culting.
  it('leaves et al. alone', () => {
    expect(normalizeItForSpeech('Jost et al. hanno trovato')).toBe('Jost et al. hanno trovato');
  });

  it('protects placeholders and reads long ungrouped runs as identifiers', () => {
    expect(normalizeItForSpeech('Vedi [[URL0]] nel 1999.'))
      .toBe('Vedi [[URL0]] nel millenovecentonovantanove.');
    expect(normalizeItForSpeech('pagine 4064412.'))
      .toBe('pagine quattro zero sei quattro quattro uno due.');
  });

  it('leaves text with no numbers unchanged', () => {
    const text = 'La cooperazione tra gruppi riduce il pregiudizio.';
    expect(normalizeItForSpeech(text)).toBe(text);
  });
});


/**
 * Dutch — the FOURTH language, and the fourth distinct convention in four tries.
 *
 * The en-nl checkpoint was MEASURED before any of these were written, and it
 * takes ITALIAN's dot thousands while keeping ENGLISH's dot decimal:
 *
 *   8,000     → "8.000"          DOT thousands, 14 of 15
 *   $50       → "$50"            sign LEADING, tight
 *   $400 bil  → "$ 400 miljard"  sign LEADING, spaced — both forms occur
 *   $8.3 tril → "$8,3 triljoen"  decimal COMMA inside a scaled amount
 *   Figure 1.3→ "Figuur 1.3"     decimal DOT preserved
 *   20%       → "20%"            NO space before the sign, 58 of 58
 *   et al.    → "et al."         preserved 59 of 60, so NO rule
 *
 * One mark doing two jobs in the same sentence is new here: es/fr/it each gave
 * the dot exactly one meaning. GROUP SIZE is the only thing that separates a
 * thousand from a section number, and it has to be exactly three digits.
 */
describe('Dutch cardinals — unit before ten, and the trema on the joint', () => {
  const nl = (rows) => it.each(rows)('%s → %s', (source, expected) => {
    expect(normalizeNlForSpeech(source)).toBe(expected);
  });

  nl([
    ['0 gevallen', 'nul gevallen'],
    // A standalone 1 is the NUMERAL, spelled "één". Bare "een" is the
    // indefinite article, so "1 geval" → "een geval" would say "a case".
    ['1 geval', 'één geval'],
    ['12 gevallen', 'twaalf gevallen'],
    ['20 gevallen', 'twintig gevallen'],
    // The unit comes FIRST and joins with "en" — nothing in es/fr/it does this.
    ['21 gevallen', 'eenentwintig gevallen'],
    // A unit ending in -e takes a trema on the joint, or "tweeen" reads as one
    // long vowel.
    ['22 gevallen', 'tweeëntwintig gevallen'],
    ['23 gevallen', 'drieëntwintig gevallen'],
    ['33 gevallen', 'drieëndertig gevallen'],
    ['68 gevallen', 'achtenzestig gevallen'],
    ['99 gevallen', 'negenennegentig gevallen'],
    ['100 gevallen', 'honderd gevallen'],
    ['156 gevallen', 'honderdzesenvijftig gevallen'],
    ['512 gevallen', 'vijfhonderdtwaalf gevallen'],
    ['1.000 gevallen', 'duizend gevallen'],
    ['2.500 gevallen', 'tweeduizend vijfhonderd gevallen'],
    ['8.000 gevallen', 'achtduizend gevallen'],
    ['40.320 gevallen', 'veertigduizend driehonderdtwintig gevallen'],
    ['100.000 gevallen', 'honderdduizend gevallen'],
    ['1.000.000 gevallen', 'één miljoen gevallen'],
  ]);
});

describe('Dutch reads a year BY HUNDREDS below 2000, as English does', () => {
  // es, fr and it all read 1961 as a plain cardinal. Porting that rule here
  // gives "duizend negenhonderdeenenzestig", a date nobody says.
  const nl = (rows) => it.each(rows)('%s → %s', (source, expected) => {
    expect(normalizeNlForSpeech(source)).toBe(expected);
  });

  nl([
    ['in 1961.', 'in negentienhonderdeenenzestig.'],
    ['in 1900.', 'in negentienhonderd.'],
    ['in 1993.', 'in negentienhonderddrieënnegentig.'],
    ['in 1520.', 'in vijftienhonderdtwintig.'],
    ['in 2000.', 'in tweeduizend.'],
    ['in 2010.', 'in tweeduizend tien.'],
    ['in 2042.', 'in tweeduizend tweeënveertig.'],
  ]);
});

describe('Dutch: one dot, two jobs, separated only by group size', () => {
  it('reads a three-digit dot group as thousands', () => {
    expect(normalizeNlForSpeech('40.000 deelnemers')).toBe('veertigduizend deelnemers');
  });

  it('reads a one- or two-digit dot group as a section number', () => {
    expect(normalizeNlForSpeech('Figuur 7.5 toont')).toBe('Figuur zeven punt vijf toont');
    expect(normalizeNlForSpeech('Tabel 12.2 somt')).toBe('Tabel twaalf punt twee somt');
    expect(normalizeNlForSpeech('CC BY 2.0.')).toBe('CC BY twee punt nul.');
  });

  it('reads a comma between digits as a decimal', () => {
    expect(normalizeNlForSpeech('de drempel p 0,05')).toBe('de drempel p nul komma nul vijf');
  });
});

describe('Dutch currency and percentages', () => {
  const nl = (rows) => it.each(rows)('%s → %s', (source, expected) => {
    expect(normalizeNlForSpeech(source)).toBe(expected);
  });

  nl([
    // Dutch keeps a measure word SINGULAR after a numeral — "vijftig dollar",
    // never "vijftig dollars". Every Romance language here pluralises.
    ['kost $50 in totaal.', 'kost vijftig dollar in totaal.'],
    ['kost $ 400 in totaal.', 'kost vierhonderd dollar in totaal.'],
    ['kost $30.000 per jaar.', 'kost dertigduizend dollar per jaar.'],
    ['kost $1,00.', 'kost één dollar.'],
    ['kost $15,50.', 'kost vijftien dollar en vijftig cent.'],
    ['20% van de jongeren', 'twintig procent van de jongeren'],
    ['20 % van de jongeren', 'twintig procent van de jongeren'],
    ['0,5% van de gevallen', 'nul komma vijf procent van de gevallen'],
  ]);

  it('drops a zero dollars part and reads only the cents', () => {
    // Found by running the finished pass over the whole 9,430-sentence track,
    // not by any of the cases above. "$0,25" was "nul dollar en vijfentwintig
    // cent"; the price is "vijfentwintig cent".
    expect(normalizeNlForSpeech('vermeld als $0,25 elk')).toBe('vermeld als vijfentwintig cent elk');
  });

  it('does not read a scaled amount as dollars and cents', () => {
    // The Italian defect, checked for rather than assumed absent: "$8,3
    // triljoen" read as cents is $8.30 for $8.3 trillion, a wrong VALUE.
    expect(normalizeNlForSpeech('wiste $8,3 triljoen aan rijkdom.'))
      .toBe('wiste acht komma drie triljoen dollar aan rijkdom.');
    expect(normalizeNlForSpeech('meer dan $ 400 miljard.'))
      .toBe('meer dan vierhonderd miljard dollar.');
  });
});

describe('Dutch leaves alone what it was measured not to break', () => {
  it('leaves et al. alone', () => {
    // Measured: intact 59 of 60, and correct Dutch academic prose.
    expect(normalizeNlForSpeech('Jost et al. vonden')).toBe('Jost et al. vonden');
  });

  it('leaves placeholders alone and spells identifiers digit by digit', () => {
    expect(normalizeNlForSpeech('Zie [[URL0]] in 1999.'))
      .toBe('Zie [[URL0]] in negentienhonderdnegenennegentig.');
    expect(normalizeNlForSpeech('pagina 4064412.'))
      .toBe('pagina vier nul zes vier vier een twee.');
  });

  it('leaves text with no numbers unchanged', () => {
    const text = 'Samenwerking tussen groepen vermindert vooroordelen.';
    expect(normalizeNlForSpeech(text)).toBe(text);
  });
});


/**
 * Hungarian — the FIFTH language and the first AGGLUTINATIVE one, which is a
 * different KIND of problem rather than a harder version of the previous four.
 *
 * The en-hu checkpoint was MEASURED before any of these were written:
 *
 *   8,000     → "8000"          NO separator at four digits
 *   20,000    → "20 000"        SPACE separator from five
 *   $50       → "50 dollárért"  sign already gone: WORD + case suffix
 *   $8.3 tril → "8,3 trillió dollárt"   decimal COMMA
 *   Figure 1.3→ "1.3 ábra"      decimal DOT preserved
 *   20%       → "20%-a"         percent sign carrying a HYPHENATED SUFFIX
 *   2042      → "2042-ig"       year carrying a HYPHENATED SUFFIX
 *
 * The hyphen is the new mechanism: spelling the number out deletes it and fuses
 * the case ending onto the word. A pass that ignores it leaves "húsz százalék
 * -a", a dangling morpheme the voice reads as a word.
 */
describe('Hungarian cardinals — tizen-/huszon- and the 2000 rule', () => {
  const hu = (rows) => it.each(rows)('%s → %s', (source, expected) => {
    expect(normalizeHuForSpeech(source)).toBe(expected);
  });

  hu([
    ['0 eset', 'nulla eset'],
    ['7 eset', 'hét eset'],
    ['10 eset', 'tíz eset'],
    // 11-19 and 21-29 do NOT reuse the bare tens word — tíz becomes tizen-,
    // húsz becomes huszon-. From 30 up it is regular.
    ['11 eset', 'tizenegy eset'],
    ['19 eset', 'tizenkilenc eset'],
    ['20 eset', 'húsz eset'],
    ['21 eset', 'huszonegy eset'],
    ['30 eset', 'harminc eset'],
    ['68 eset', 'hatvannyolc eset'],
    ['100 eset', 'száz eset'],
    ['300 eset', 'háromszáz eset'],
    // THE 2000 RULE: one word up to 2000, hyphenated thousands group above it.
    // The threshold is the VALUE, so 1999 and 2001 differ despite both being
    // four digits.
    ['1000 eset', 'ezer eset'],
    ['1999 eset', 'ezerkilencszázkilencvenkilenc eset'],
    ['2000 eset', 'kétezer eset'],
    ['2001 eset', 'kétezer-egy eset'],
    ['2500 eset', 'kétezer-ötszáz eset'],
    // MEASURED: four digits solid, a SPACE from five. Both must read the same.
    ['8000 eset', 'nyolcezer eset'],
    ['20 000 eset', 'húszezer eset'],
    ['40 320 eset', 'negyvenezer-háromszázhúsz eset'],
    ['100 000 eset', 'százezer eset'],
    ['1 000 000 eset', 'egymillió eset'],
  ]);
});

describe('Hungarian carries a hyphenated case suffix onto the spelled number', () => {
  const hu = (rows) => it.each(rows)('%s → %s', (source, expected) => {
    expect(normalizeHuForSpeech(source)).toBe(expected);
  });

  hu([
    ['a serdülők 20%-a', 'a serdülők húsz százaléka'],
    ['a rablások 90%-át', 'a rablások kilencven százalékát'],
    ['csak 1%-ot tett ki', 'csak egy százalékot tett ki'],
    ['várhatóan 2042-ig', 'várhatóan kétezer-negyvenkettőig'],
    ['2050-re az USA', 'kétezer-ötvenre az USA'],
    ['1990-ben történt', 'ezerkilencszázkilencvenben történt'],
    ['a 2010-es évek', 'a kétezer-tízes évek'],
    ['20% felett', 'húsz százalék felett'],
  ]);

  it('reads a leaked English thousands comma as a thousand, not a decimal', () => {
    // Found on the whole track: the checkpoint leaks one English comma in 9,430
    // sentences. Read as a decimal, "40,320" is forty-point-three-two for forty
    // thousand three hundred twenty — a wrong VALUE.
    expect(normalizeHuForSpeech('(ami 40,320), de')).toBe('(ami negyvenezer-háromszázhúsz), de');
    // A genuine 1-2 digit decimal must still be a decimal.
    expect(normalizeHuForSpeech('a küszöb p 0,05')).toBe('a küszöb p nulla egész nulla öt');
  });

  it('carries a suffix that lands on a currency amount', () => {
    // "$30-os" was claimed by the currency pass, which spelled the number and
    // stranded "-os" — two of this module's own passes orphaning a morpheme.
    expect(normalizeHuForSpeech('egy $30-os díjért')).toBe('egy harminc dolláros díjért');
  });

  it('does not read a hyphen between two numbers as a suffix', () => {
    // The suffix rule requires a LETTER after the hyphen, which is what
    // separates "2042-ig" from a page range.
    expect(normalizeHuForSpeech('406-412 oldal')).toBe('négyszázhat-négyszáztizenkét oldal');
  });
});

describe('Hungarian kettő/két — the one form this module chooses', () => {
  const hu = (rows) => it.each(rows)('%s → %s', (source, expected) => {
    expect(normalizeHuForSpeech(source)).toBe(expected);
  });

  hu([
    ['2 csoport vizsgálata', 'két csoport vizsgálata'],
    ['2 és 3 között', 'kettő és három között'],
    ['22 résztvevő', 'huszonkét résztvevő'],
    ['22 és 23', 'huszonkettő és huszonhárom'],
    ['512 eset', 'ötszáztizenkét eset'],
  ]);
});

describe('Hungarian currency, decimals and section numbers', () => {
  const hu = (rows) => it.each(rows)('%s → %s', (source, expected) => {
    expect(normalizeHuForSpeech(source)).toBe(expected);
  });

  hu([
    // MEASURED: the checkpoint has usually already turned "$50" into
    // "50 dollárért", so the sign survives rarely.
    ['kapott $4 kezdeni', 'kapott négy dollár kezdeni'],
    ['$2 volt', 'két dollár volt'],
    ['8,3 trillió dollárt', 'nyolc egész három trillió dollárt'],
    ['a küszöb p 0,05', 'a küszöb p nulla egész nulla öt'],
    // A dot is preserved by this checkpoint and stays a section number or a
    // version — "pont", never a thousands group.
    ['1.3 ábra', 'egy pont három ábra'],
    ['CC BY-NC 2.0.', 'CC BY-NC kettő pont nulla.'],
  ]);
});

describe('Hungarian leaves alone what it was measured not to break', () => {
  it('leaves et al. alone', () => {
    expect(normalizeHuForSpeech('Jost et al. megállapította')).toBe('Jost et al. megállapította');
  });

  it('leaves placeholders alone and spells identifiers digit by digit', () => {
    expect(normalizeHuForSpeech('Lásd [[URL0]] 1999-ben.'))
      .toBe('Lásd [[URL0]] ezerkilencszázkilencvenkilencben.');
    expect(normalizeHuForSpeech('oldal 4064412.'))
      .toBe('oldal négy nulla hat négy négy egy kettő.');
  });

  it('leaves text with no numbers unchanged', () => {
    const text = 'A csoportok közötti együttműködés csökkenti az előítéletet.';
    expect(normalizeHuForSpeech(text)).toBe(text);
  });
});


/**
 * Danish — the SIXTH language, and the one whose number FORMATS match Dutch's
 * exactly while its WORDS do not. Measured before any of these were written:
 *
 *   8,000     → "8.000"          DOT thousands
 *   $50       → "50 dollars"     often already a WORD, and PLURAL
 *   $8.3 tril → "$8,3 billioner" decimal COMMA, and the LONG scale
 *   Figure 1.3→ "figur 1.3"      decimal DOT preserved
 *   20%       → "20%"            NO space, 58 of 58
 *   et al.    → "et al."         preserved 100 of 100
 *   20th c.   → "det 20. århundrede"   ORDINAL as digits plus a PERIOD
 */
describe('Danish cardinals — vigesimal tens, and where "og" goes', () => {
  const da = (rows) => it.each(rows)('%s → %s', (source, expected) => {
    expect(normalizeDaForSpeech(source)).toBe(expected);
  });

  da([
    ['0 sager', 'nul sager'],
    ['1 sag', 'en sag'],
    ['19 sager', 'nitten sager'],
    // Unit BEFORE the ten joined by "og", as Dutch does but with no trema.
    ['21 sager', 'enogtyve sager'],
    ['31 sager', 'enogtredive sager'],
    // THE VIGESIMAL TENS — scores, not derivable from the unit words at all.
    ['50 sager', 'halvtreds sager'],
    ['55 sager', 'femoghalvtreds sager'],
    ['60 sager', 'tres sager'],
    ['68 sager', 'otteogtres sager'],
    ['70 sager', 'halvfjerds sager'],
    ['80 sager', 'firs sager'],
    ['99 sager', 'nioghalvfems sager'],
    // "og" joins a SUB-HUNDRED tail to whatever precedes it, and only that.
    ['100 sager', 'hundrede sager'],
    ['101 sager', 'hundrede og en sager'],
    ['512 sager', 'fem hundrede og tolv sager'],
    ['1.000 sager', 'tusind sager'],
    ['2.500 sager', 'to tusind fem hundrede sager'],
    ['2.042 sager', 'to tusind og toogfyrre sager'],
    ['40.320 sager', 'fyrre tusind tre hundrede og tyve sager'],
    ['100.000 sager', 'hundrede tusind sager'],
    ['1.000.000 sager', 'en million sager'],
    ['i 1961.', 'i nitten hundrede og enogtres.'],
    ['i 1900.', 'i nitten hundrede.'],
    ['i 2010.', 'i to tusind og ti.'],
  ]);
});

describe('Danish reads a digit plus a period as an ordinal', () => {
  const da = (rows) => it.each(rows)('%s → %s', (source, expected) => {
    expect(normalizeDaForSpeech(source)).toBe(expected);
  });

  da([
    ['det 20. århundrede oplevede', 'det tyvende århundrede oplevede'],
    ['I det 21. århundrede er', 'I det enogtyvende århundrede er'],
    ['hvert 10. sekund.', 'hvert tiende sekund.'],
    ['på 42. gade i New York', 'på toogfyrretyvende gade i New York'],
    ['Den 26. marts 1997 blev', 'Den seksogtyvende marts nitten hundrede og syvoghalvfems blev'],
  ]);

  it('does not read a sentence-final number as an ordinal', () => {
    // The guard is the following word's CASE, and it was measured: 13 forms
    // followed by a lowercase word, every one a real ordinal, and ZERO followed
    // by an uppercase one.
    expect(normalizeDaForSpeech('Svaret var 20. Det næste spørgsmål.'))
      .toBe('Svaret var tyve. Det næste spørgsmål.');
  });
});

describe('Danish currency, percentages and the dot', () => {
  const da = (rows) => it.each(rows)('%s → %s', (source, expected) => {
    expect(normalizeDaForSpeech(source)).toBe(expected);
  });

  da([
    // PLURAL after a numeral, which inverts Dutch.
    ['koster $50 i alt.', 'koster halvtreds dollars i alt.'],
    ['koster $30.000 om året.', 'koster tredive tusind dollars om året.'],
    ['koster $1,00.', 'koster en dollar.'],
    ['koster $15,50.', 'koster femten dollars og halvtreds cent.'],
    ['koster $0,25 hver.', 'koster femogtyve cent hver.'],
    ['slettet $8,3 billioner i rigdom.', 'slettet otte komma tre billioner dollars i rigdom.'],
    ['20% af de unge', 'tyve procent af de unge'],
    ['0,5% af sagerne', 'nul komma fem procent af sagerne'],
    // 19 real thousands groups against 316 short dot forms, measured.
    ['40.000 deltagere', 'fyrre tusind deltagere'],
    ['figur 7.5 viser', 'figur syv punktum fem viser'],
    ['CC BY 2.0.', 'CC BY to punktum nul.'],
  ]);

  it('leaves et al. alone and spells identifiers digit by digit', () => {
    expect(normalizeDaForSpeech('Jost et al. fandt')).toBe('Jost et al. fandt');
    expect(normalizeDaForSpeech('side 4064412.')).toBe('side fire nul seks fire fire en to.');
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
 * Swedish — the SEVENTH language, and the one that broke "Scandinavian, so it
 * will be Danish". Measured before any of these were written:
 *
 *   8,000     → "8.000" AND "20 000"   BOTH separators, in the same book
 *   $50       → "50 dollar"            INVARIABLE, where Danish pluralises
 *   20%       → "20 %" AND "35%"       BOTH spacings, 37 against 31
 *   et al.    → "et al." (71) AND "m.fl." (29)
 *   1900s     → "1900-talet"           HYPHEN suffix, as Hungarian does
 */
describe('Swedish cardinals — the tens go FIRST, with no joiner', () => {
  const sv = (rows) => it.each(rows)('%s → %s', (source, expected) => {
    expect(normalizeSvForSpeech(source)).toBe(expected);
  });

  sv([
    ['0 fall', 'noll fall'],
    ['1 fall', 'ett fall'],
    ['19 fall', 'nitton fall'],
    ['20 fall', 'tjugo fall'],
    // Dutch, Danish and German all put the UNIT first. Swedish drops the one
    // structural habit those three share, so a port from Danish is wrong on
    // every number between 21 and 99.
    ['21 fall', 'tjugoett fall'],
    ['35 fall', 'trettiofem fall'],
    ['68 fall', 'sextioåtta fall'],
    ['99 fall', 'nittionio fall'],
    ['100 fall', 'hundra fall'],
    ['512 fall', 'femhundratolv fall'],
    // Swedish writes a whole number as ONE word.
    ['2500 fall', 'tvåtusenfemhundra fall'],
    ['8000 fall', 'åttatusen fall'],
    ['100 000 fall', 'hundratusen fall'],
    ['40 320 fall', 'fyrtiotusentrehundratjugo fall'],
    ['1.000.000 fall', 'en miljon fall'],
    ['år 1961.', 'år nittonhundrasextioett.'],
    ['år 2010.', 'år tvåtusentio.'],
  ]);
});

describe('Swedish reads both separators and both percent spacings', () => {
  const sv = (rows) => it.each(rows)('%s → %s', (source, expected) => {
    expect(normalizeSvForSpeech(source)).toBe(expected);
  });

  sv([
    // No earlier checkpoint was inconsistent like this: a dot group 12 times
    // and a space group 7 in the same book.
    ['över 8.000 mord', 'över åttatusen mord'],
    ['över 20 000 deltagare', 'över tjugotusen deltagare'],
    // 311 short dot forms against those 12 real thousands groups.
    ['figur 1.3 visar', 'figur ett punkt tre visar'],
    ['CC BY 2.0.', 'CC BY två punkt noll.'],
    // 37 spaced against 31 tight, and 12 already written as the word.
    ['20 % av ungdomarna', 'tjugo procent av ungdomarna'],
    ['35% av lagets', 'trettiofem procent av lagets'],
    ['99 procent av rånen', 'nittionio procent av rånen'],
  ]);
});

describe('Swedish currency, suffixes and abbreviations', () => {
  const sv = (rows) => it.each(rows)('%s → %s', (source, expected) => {
    expect(normalizeSvForSpeech(source)).toBe(expected);
  });

  sv([
    // INVARIABLE, as in Dutch and unlike Danish — the other Scandinavian
    // language here. The checkpoint writes "dollar" 13 times, "dollars" never.
    ['för $50.', 'för femtio dollar.'],
    ['$ 30.000 per år', 'trettiotusen dollar per år'],
    ['8,3 biljoner dollar i', 'åtta komma tre biljoner dollar i'],
    ['kostar $15,50.', 'kostar femton dollar och femtio cent.'],
    // 35 hyphen suffixes — Hungarian's mechanism in a Germanic language. Inside
    // a decade the number is read as a YEAR.
    ['under 1900-talet utvidgades', 'under nittonhundratalet utvidgades'],
    ['Under 2000-talet har', 'Under tvåtusentalet har'],
    ['på 1960-talet', 'på nittonhundrasextiotalet'],
    ['5-åriga barn', 'femåriga barn'],
    ['i 40-årsåldern', 'i fyrtioårsåldern'],
  ]);

  it('expands m.fl. but leaves et al. alone', () => {
    // `et al.` survives 71 times and reads as words; `m.fl.` appears 29 times
    // and reads as letters. Same standard the Spanish et al. rule was held to.
    expect(normalizeSvForSpeech('Schwarz m.fl., 1991'))
      .toBe('Schwarz med flera, nittonhundranittioett');
    expect(normalizeSvForSpeech('McGregor et al. visade')).toBe('McGregor et al. visade');
  });

  it('leaves placeholders alone and spells identifiers digit by digit', () => {
    expect(normalizeSvForSpeech('Se [[URL0]] år 1999.'))
      .toBe('Se [[URL0]] år nittonhundranittionio.');
    expect(normalizeSvForSpeech('sida 4064412.')).toBe('sida fyra noll sex fyra fyra ett två.');
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
 * Czech — the NINTH language, the SIXTH distinct convention, and the first that
 * is neither Germanic nor Romance. Measured with bench/formats/measure.py and
 * counted over all 9,430 translated sentences with bench/formats/count.py;
 * shapes in bench/formats/cs.json.
 *
 *   8,000     → "8 000"       SPACE thousands            17 occurrences
 *   dot groups  none at all                               0 occurrences
 *   1.3 / 2.0 → unchanged      every dot is a section    301 occurrences
 *   3% / 54%  → attached, ALWAYS; spaced percent:         0 occurrences
 *   8,3       → "osm celých tři"  comma decimal, INFLECTED joiner
 *   50,000    → leaked English comma, a WRONG VALUE        3 occurrences
 *   $50       → the checkpoint already writes "50 dolarů"; 3 signs survive
 *   20. stol. → ORDINAL DOT — recorded, not handled       29 lines
 */
describe('Czech cardinals — separate words, ten first', () => {
  const cs = (rows) => it.each(rows)('%s → %s', (source, expected) => {
    expect(normalizeCsForSpeech(source)).toBe(expected);
  });

  cs([
    ['0 případů', 'nula případů'],
    ['3 případy', 'tři případy'],
    ['11 případů', 'jedenáct případů'],
    ['19 případů', 'devatenáct případů'],
    ['20 případů', 'dvacet případů'],
    // Czech's fused unit-first form ("jedenadvacet") is archaic, so this is
    // neither German's "einundzwanzig" nor Swedish's solid "tjugoett".
    ['21 případů', 'dvacet jedna případů'],
    ['22 případů', 'dvacet dva případů'],
    ['99 případů', 'devadesát devět případů'],
    ['100 případů', 'sto případů'],
    ['101 případů', 'sto jedna případů'],
    // 200 is a surviving DUAL — "dvě stě", not the "sta" of 300 and 400, not
    // the genitive "set" of 500 upward. Three forms of one word.
    ['200 případů', 'dvě stě případů'],
    ['300 případů', 'tři sta případů'],
    ['500 případů', 'pět set případů'],
    ['512 případů', 'pět set dvanáct případů'],
    // "tisíc" runs the same paradigm: bare at 1, "tisíce" at 2-4, back to
    // "tisíc" (genitive plural, spelled like the singular) from 5.
    ['1000 případů', 'tisíc případů'],
    ['2 500 členů', 'dva tisíce pět set členů'],
    ['8 000 vražd', 'osm tisíc vražd'],
    ['40 320', 'čtyřicet tisíc tři sta dvacet'],
    ['1 000 000 lidí', 'milion lidí'],
    // The PLAIN CARDINAL, not the by-hundreds reading Dutch, Danish, Swedish
    // and German all take. Family did not predict this, as it never has here.
    ['v roce 1961.', 'v roce tisíc devět set šedesát jedna.'],
    ['března 1997', 'března tisíc devět set devadesát sedm'],
    ['v roce 2010.', 'v roce dva tisíce deset.'],
  ]);
});

describe('Czech separators, the counted noun and the inflected decimal', () => {
  const cs = (rows) => it.each(rows)('%s → %s', (source, expected) => {
    expect(normalizeCsForSpeech(source)).toBe(expected);
  });

  cs([
    // 17 space groups and ZERO dot groups, so the exactly-three-digits test
    // Italian, Dutch, Danish and German all needed is load-bearing for nothing.
    ['přes 8 000 vražd', 'přes osm tisíc vražd'],
    ['(což je 40 320)', '(což je čtyřicet tisíc tři sta dvacet)'],
    ['Obrázek 1.3 Mozková kůra', 'Obrázek jedna tečka tři Mozková kůra'],
    ['CC BY-NC 2.0.', 'CC BY-NC dva tečka nula.'],
    // The counted-noun paradigm, and the checkpoint's own output is the
    // evidence: en-cs writes `$4` as "4 dolary" and `$50` as "50 dolarů".
    ['1% skupiny', 'jedno procento skupiny'],
    ['2% případů', 'dvě procenta případů'],
    ['20% dospívajících', 'dvacet procent dospívajících'],
    ['100% jisté', 'sto procent jisté'],
    ['platba ($20) za lež', 'platba (dvacet dolarů) za lež'],
    ['platbu ($1) za lež', 'platbu (jeden dolar) za lež'],
    ['dostala $4 na začátek', 'dostala čtyři dolary na začátek'],
    // The joiner is not the name of the mark but a COUNTED ADJECTIVE agreeing
    // with the number in front of it — three forms where every earlier
    // language had one invariable word.
    ['prahu 1,5', 'prahu jedna celá pět'],
    ['mrhayata 2,0', 'mrhayata dvě celé nula'],
    ['vymazal 8,3 bilionu', 'vymazal osm celých tři bilionu'],
    // LONG scale: a Czech "bilion" is 10^12 and an English "billion" 10^9.
    ['asi 100 miliard neuronů', 'asi sto miliard neuronů'],
    ['více než 7 milionů lidí', 'více než sedm milionů lidí'],
  ]);

  it('drops gender once the noun is genitive plural', () => {
    // Found by the whole-track run, not by a test written from the measured
    // shapes: `82%` read as "osmdesát dvě procent". A numeral agrees with its
    // noun only where the noun is nominative — 1, and 2-4. From 5 up, and for
    // every compound, the noun drops to the genitive plural and the numeral
    // reverts to its base form.
    expect(normalizeCsForSpeech('82% dostalo')).toBe('osmdesát dva procent dostalo');
    expect(normalizeCsForSpeech('22% lidí')).toBe('dvacet dva procent lidí');
    expect(normalizeCsForSpeech('42, 9')).toBe('čtyřicet dva celých devět');
  });

  it('rewrites a leaked English thousands comma rather than reading it', () => {
    // Three commas the checkpoint failed to localise, all three wrong VALUES
    // as decimals. `5 000,000` is the interesting one: a 5,000,000 whose first
    // group was localised and whose second was not, so rewriting the comma to
    // a space makes the halves agree and the grouped rule reads it correctly.
    expect(normalizeCsForSpeech('více než 50,000 lidí')).toBe('více než padesát tisíc lidí');
    expect(normalizeCsForSpeech('chování 1,424 chodců'))
      .toBe('chování tisíc čtyři sta dvacet čtyři chodců');
    expect(normalizeCsForSpeech('je 1 k 5 000,000, více')).toBe('je jedna k pět milionů, více');
  });

  it('reads a whole-line spaced decimal but never a list', () => {
    // Ten table cells whose entire text is a decimal the checkpoint localised
    // AND spaced (`57.1` → `57, 1`). The whole-line anchor is the guard: the
    // same shape inside a sentence is a list of brain regions or of years, and
    // an earlier version of the comma rule turned the first into a decimal.
    expect(normalizeCsForSpeech('57, 1')).toBe('padesát sedm celých jedna');
    expect(normalizeCsForSpeech('(28, 5%)')).toBe('(dvacet osm celých pět procenta)');
    expect(normalizeCsForSpeech('oblasti 1, 2, 4 a 5')).toBe('oblasti jedna, dva, čtyři a pět');
    expect(normalizeCsForSpeech('Rosenthal, 1990, 1992).'))
      .toBe('Rosenthal, tisíc devět set devadesát, tisíc devět set devadesát dva).');
  });

  it('leaves et al., placeholders and identifiers alone', () => {
    // et al. survives 95 times and already reads as words, the measured reason
    // French, Italian and German were denied a rule too.
    expect(normalizeCsForSpeech('z Berman et al. (2009).'))
      .toBe('z Berman et al. (dva tisíce devět).');
    expect(normalizeCsForSpeech('Viz [[URL0]] v roce 1999.'))
      .toBe('Viz [[URL0]] v roce tisíc devět set devadesát devět.');
    expect(normalizeCsForSpeech('Strana 4064412.'))
      .toBe('Strana čtyři nula šest čtyři čtyři jedna dva.');
  });

  it('reads an ordinal as a cardinal, which is a RECORDED gap', () => {
    // Not fixed, and Czech is the strongest case for that call yet: the
    // ordinal must decline to agree with its noun in whatever case that noun
    // stands in — "dvacátého století" genitive, "dvacátým prvním prosincem"
    // instrumental. Danish took this rule because a Danish ordinal has ONE
    // form; German was denied it because the dot is ambiguous. Czech has both
    // problems at once. This asserts the current reading so that building the
    // declension system would be a visible change.
    expect(normalizeCsForSpeech('V druhé části 20. století'))
      .toBe('V druhé části dvacet. století');
    expect(normalizeCsForSpeech('26. března 1997 byli'))
      .toBe('dvacet šest. března tisíc devět set devadesát sedm byli');
  });

  it('leaves a numeral glued to a Czech adjective, and every identifier, alone', () => {
    // RECORDED, NOT FIXED: 4 occurrences of `10sekundové` / `29letý` reach the
    // voice as raw digits, below German's 23 glued decades. The fix is also a
    // different shape — German appends "er" to the cardinal and gets a real
    // word, while Czech needs the numeral's COMBINING stem
    // ("desetisekundové"), a second numeral system rather than a suffix. The
    // hyphenated forms are already read, because a hyphen is a word boundary.
    expect(normalizeCsForSpeech('tři 10sekundové videoklipy')).toBe('tři 10sekundové videoklipy');
    expect(normalizeCsForSpeech('12-gauge brokovnice')).toBe('dvanáct-gauge brokovnice');
    for (const text of ['videohry (Wolfenstein 3D)', 'šířka: 497px', '6SN7 Reflexní',
      'Fenix_21 DSC01314', 'LindaDee2006']) {
      expect(normalizeCsForSpeech(text)).toBe(text);
    }
  });

  it('restores a decimal that lost its leading zero', () => {
    // The English convention every checkpoint passes through, and the defect
    // that was live in six languages until the Swedish measurement found it.
    // Asserted as the EQUIVALENCE rather than a word list, so it is
    // automatically right for language ten.
    expect(normalizeCsForSpeech('r = .30 a asi .7'))
      .toBe(normalizeCsForSpeech('r = 0.30 a asi 0.7'));
    expect(normalizeCsForSpeech('a .38-kalibr revolver'))
      .toBe('a nula tečka tři osm-kalibr revolver');
  });
});
