/**
 * Turn TRANSLATED text into the target language's spoken form, in the browser.
 *
 * Port of `pipeline/lang_normalize.py`. That module is the specification; read
 * its docstring for WHY the job sits on this side of the translator at all
 * (short version: handing Opus-MT English that already reads "nineteen ninety
 * three" makes it emit three separate Spanish numbers, so the raw text is
 * translated and normalised afterwards, one module per language).
 *
 * **Why this port exists, with a number.** An oracle diff measured the
 * client-side reader against the 9,407 deployed Spanish sentences. Of the four
 * things that differ, three are variations — quantisation, checkpoint, tokenizer.
 * This one is a defect: without it **21.0% of the book's sentences** reach
 * the voice carrying raw digits, and it says `Había 21 mujeres` where the
 * deployed track says `Había veintiuno mujeres`.
 *
 * **This runs BEFORE `restore()`, on the masked line.** Load-bearing, and the
 * same ordering the Python depends on: after `restore()` the sentence holds real
 * URLs, email addresses and `[[latex:...]]` payloads, all full of digits and dots
 * that the number passes would happily spell out. On the masked line those spans
 * are opaque `[[KIND0]]` placeholders whose digit is glued to a letter, so no
 * boundary-anchored number pattern can reach inside one.
 *
 * TWO DELIBERATE DIVERGENCES FROM `protect.mjs`'s HANDLING OF THE SAME PROBLEM,
 * both because this module's input is Spanish prose rather than ASCII URLs:
 *
 * 1. **Word boundaries are Unicode-aware here.** `protect.mjs` documents that it
 *    accepts JavaScript's ASCII-only `\b` because every address in the corpus is
 *    ASCII. That reasoning does not carry over. Python treats `ª`, `º`, `ñ` and
 *    `é` as word characters, so `la 3ª edición` is left ALONE by the Python — and
 *    an ASCII `\b` would match the `3` and read it "tres ª". Spanish ordinals are
 *    ordinary Spanish. So `\b` is spelled out as a lookaround over `WORD` below.
 *    (Measured on the deployed corpus: only 3 of 9,430 lines put a digit next to
 *    a non-ASCII character today, and all three are typographic quotes. This is
 *    protection against the next book, not a fix for this one.)
 *
 * 2. **`\d` stays ASCII, and that IS a divergence.** Python's `\d` also matches
 *    Devanagari and Arabic-Indic digits, and `int()` parses them. Matching that
 *    would mean reimplementing `int()`'s Unicode digit handling to feed a
 *    SPANISH number-speller. Recorded rather than emulated: the gain is
 *    unreachable for a Latin-script target and the cost is a whole parsing
 *    surface. If a target language ever needs it, this is the note to find.
 */

// Python's `\w` for str patterns is "alphanumeric as defined by str.isalnum(),
// plus underscore". `\p{L}` + `\p{N}` + `_` is that set.
const WORD = '[\\p{L}\\p{N}_]';

/**
 * `\b` — a TRANSITION between a word character and a non-word character, in
 * either direction. Not "there is no word character after me".
 *
 * The distinction is the whole of a bug this port shipped and the corpus caught,
 * on 450 of 23,848 real lines. `\b\d[\d,]*\b` against `áreas 1, 2, 4 y 5`:
 * the greedy class takes `1,`, and Python then finds NO boundary after the comma
 * — comma and space are both non-word, so nothing transitions — so it backtracks
 * and matches `1` alone, leaving the comma where it was. A plain negative
 * lookahead is satisfied at that same position, keeps the comma inside the match,
 * and deletes the pause between every item in every list of numbers in the book.
 *
 * Written once and used at both ends, because `\b` genuinely is the same
 * assertion at both ends.
 */
const B = `(?:(?<=${WORD})(?!${WORD})|(?<!${WORD})(?=${WORD}))`;

// 0-29 are listed rather than composed. Spanish fuses them into single words --
// "dieciséis", not "diez y seis"; "veintiuno", not "veinte y uno" -- and the
// joining "y" only appears from 31 up. A TENS + ONES join gets 16-29 wrong.
const ONES = [
  'cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho',
  'nueve', 'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis',
  'diecisiete', 'dieciocho', 'diecinueve', 'veinte', 'veintiuno', 'veintidós',
  'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete',
  'veintiocho', 'veintinueve',
];
const TENS = {
  3: 'treinta', 4: 'cuarenta', 5: 'cincuenta', 6: 'sesenta',
  7: 'setenta', 8: 'ochenta', 9: 'noventa',
};
// Irregular at 5, 7 and 9: quinientos/setecientos/novecientos, never
// "cincocientos"/"sietecientos"/"nuevecientos".
const HUNDREDS = {
  1: 'ciento', 2: 'doscientos', 3: 'trescientos', 4: 'cuatrocientos',
  5: 'quinientos', 6: 'seiscientos', 7: 'setecientos',
  8: 'ochocientos', 9: 'novecientos',
};

function underHundred(value) {
  if (value < 30) return ONES[value];
  const tens = Math.floor(value / 10);
  const ones = value % 10;
  return TENS[tens] + (ones ? ` y ${ONES[ones]}` : '');
}

function underThousand(value) {
  if (value < 100) return underHundred(value);
  // 100 exactly is "cien"; 101 upward is "ciento ...". Not interchangeable.
  if (value === 100) return 'cien';
  const hundreds = Math.floor(value / 100);
  const rest = value % 100;
  return HUNDREDS[hundreds] + (rest ? ` ${underHundred(rest)}` : '');
}

/**
 * `uno` shortens to `un` directly before a masculine noun -- including `mil`,
 * `millón` and `dólar`, which is the only place this is used. 21,000 is
 * "veintiún mil", not "veintiuno mil"; $1 is "un dólar".
 *
 * A bare integer in running prose stays "uno", because the noun that follows is
 * in the translated text, not in this function's hands, and its gender is
 * unknowable from here.
 */
function apocopate(phrase) {
  if (phrase === 'uno') return 'un';
  if (phrase.endsWith('veintiuno')) return `${phrase.slice(0, -'veintiuno'.length)}veintiún`;
  if (phrase.endsWith(' y uno')) return `${phrase.slice(0, -'uno'.length)}un`;
  return phrase;
}

function intToWords(value) {
  if (value < 0) return `menos ${intToWords(-value)}`;
  if (value >= 1_000_000) {
    const millions = Math.floor(value / 1_000_000);
    const rest = value % 1_000_000;
    const head = apocopate(intToWords(millions));
    const name = millions === 1 ? 'millón' : 'millones';
    return `${head} ${name}` + (rest ? ` ${intToWords(rest)}` : '');
  }
  if (value >= 1_000) {
    const thousands = Math.floor(value / 1_000);
    const rest = value % 1_000;
    // 1000 is bare "mil", never "un mil" -- unlike "un millón", which does carry
    // its "un".
    const head = thousands === 1 ? '' : `${apocopate(underThousand(thousands))} `;
    return `${head}mil` + (rest ? ` ${underThousand(rest)}` : '');
  }
  return underThousand(value);
}

const digitsToWords = (digits) => [...digits].map((d) => ONES[Number(d)]).join(' ');

// A dot decimal is the English form the checkpoint was measured to preserve.
const DOT_DECIMAL = /^(\d{1,3}(?:,\d{3})*|\d+)\.(\d+)$/;
// A comma decimal is the Spanish form. It is told apart from an English
// thousands group by the group size and nothing else: a thousands group is
// ALWAYS exactly three digits, so `1,25` cannot be one and `1,250` cannot be
// anything else. Getting this backwards turns 1.25 into 125 -- a wrong VALUE,
// the worst class of defect there is here.
const COMMA_DECIMAL = /^(\d+),(\d{1,2})$/;

// An ungrouped run this long is an IDENTIFIER, not a quantity: a DOI tail, an
// ISBN, or an en-dash page range the translator collapsed into one run ("406-412"
// came back from the real checkpoint as "4064412"). Reading those as cardinals is
// how "406-412" becomes "cuatro millones sesenta y cuatro mil cuatrocientos doce"
// -- a wrong VALUE, and worse than the garbled-but-recoverable reading that going
// digit-by-digit gives.
//
// Five is where an UNGROUPED run stops being a plausible quantity in this corpus:
// a real quantity that size carries a thousands separator. The trade-off is real
// and recorded: "25000 participantes" written without its comma reads
// digit-by-digit here where English's normalize.py would say "twenty five
// thousand".
const IDENTIFIER_DIGITS = 5;

/** One numeric token, in whichever of the four shapes it arrived. */
function numberPhrase(token) {
  const trimmed = token.trim();

  const dotted = DOT_DECIMAL.exec(trimmed);
  if (dotted) {
    const whole = Number(dotted[1].replace(/,/g, '') || 0);
    return `${intToWords(whole)} punto ${digitsToWords(dotted[2])}`;
  }

  const comma = COMMA_DECIMAL.exec(trimmed);
  if (comma) {
    return `${intToWords(Number(comma[1]))} coma ${digitsToWords(comma[2])}`;
  }

  const digits = trimmed.replace(/,/g, '');
  // A leading zero is the other identifier tell, at any length -- and reading it
  // as a cardinal silently DELETES it ("007" -> "siete"), the same class of
  // defect at a smaller scale.
  if (!trimmed.includes(',')
      && (digits.length >= IDENTIFIER_DIGITS || (digits.length > 1 && digits[0] === '0'))) {
    return digitsToWords(digits);
  }
  return intToWords(Number(digits));
}

/**
 * Spanish reads a year as the plain cardinal: 1961 is "mil novecientos sesenta y
 * uno".
 *
 * Measured, not assumed: where the checkpoint got a year RIGHT of its own
 * accord, that is the form it produced. English's century split — "nineteen
 * sixty one" — does not transfer, and porting `normalize.py`'s `_year_phrase`
 * unchanged would have produced "diecinueve sesenta y uno", the exact defect
 * this whole decision exists to avoid.
 *
 * So in Spanish the year form and the cardinal form coincide, and this function
 * is the cardinal. It stays a named function with its own pass because the
 * per-language year convention needs one obvious home: the next language's
 * author has to answer this question, and finding it already asked is the point.
 */
const yearPhrase = (token) => intToWords(Number(token));

const ET_AL_RE = new RegExp(`${B}et\\s+al\\.`, 'gu');
const CURRENCY_RE = /\$\s?([\d,]+(?:\.\d+)?)/gu;
const PERCENT_RE = new RegExp(`${B}([\\d,]+(?:\\.\\d+)?)\\s?%`, 'gu');
const DOT_DECIMAL_RE = new RegExp(`${B}(\\d+)\\.(\\d+)${B}`, 'gu');
const COMMA_DECIMAL_RE = new RegExp(`${B}(\\d+),(\\d{1,2})(?!\\d)`, 'gu');
// Same bounds and same reasoning as normalize.py's YEAR_RE: no comma group (the
// thousands separator marks a quantity, not a year), floor 1500 because
// reference lists carry four-digit page numbers, ceiling 2099.
const YEAR_RE = new RegExp(`${B}(?:1[5-9]\\d{2}|20\\d{2})${B}`, 'gu');
const INTEGER_RE = new RegExp(`${B}\\d[\\d,]*${B}`, 'gu');

const money = (value) => `${apocopate(intToWords(value))} ${value === 1 ? 'dólar' : 'dólares'}`;

/**
 * Dollars-and-cents structure, not a decimal read: $15.50 is "quince dólares y
 * cincuenta centavos" (measured), never "quince punto cinco cero dólares".
 */
function currency(_match, amount) {
  if (amount.includes('.')) {
    const [whole, fraction] = amount.split('.');
    const cents = fraction.padEnd(2, '0').slice(0, 2);
    let phrase = money(Number(whole.replace(/,/g, '') || 0));
    if (Number(cents)) {
      const noun = Number(cents) === 1 ? 'centavo' : 'centavos';
      phrase += ` y ${apocopate(intToWords(Number(cents)))} ${noun}`;
    }
    return phrase;
  }
  return money(Number(amount.replace(/,/g, '')));
}

/**
 * Collapse the whitespace and the comma stumbles that `et al.` -> `y otros` can
 * leave behind. Narrower than the English `_cleanup_speech_punctuation` on
 * purpose: that one also strips a LEADING comma, which only an English
 * abbreviation expansion can strand, and Spanish carries `¿`/`¡` openers that no
 * shared helper should ever learn about.
 */
// A decimal written WITHOUT its leading zero — `r = .30`, `omkring .7` — an
// English convention the checkpoints pass straight through. Every language here
// already reads `0.30` correctly and every one read `.30` as THIRTY, a wrong
// VALUE, because the bare integer pass claimed the digits and left the dot as
// punctuation. Measured across the deployed corpora: nl 5, hu 4, da 4, it 4,
// sv 4, fr 3.
//
// The fix restores the zero and lets each language's OWN decimal rule do the
// rest, so it can only produce what that language already produces for the
// written-out form — an equivalence the tests assert per language.
//
// The lookbehind excludes a WORD character, not just a digit: `Fig.2` must not
// become `Fig0.2`, and `1.3` must not become `10.3`.
const LEADING_DOT_RE = /(?<![\w.,])\.(?=\d)/gu;
const restoreLeadingZero = (text) => text.replace(LEADING_DOT_RE, '0.');

function cleanup(text) {
  let out = text.split(/\s+/u).filter(Boolean).join(' ');
  for (const [bad, good] of [[' ,', ','], [',,', ','], [',.', '.'], [',!', '!'], [',?', '?']]) {
    out = out.split(bad).join(good);
  }
  return out.trim();
}

/**
 * Spanish translated text -> Spanish spoken form.
 *
 * Pass order matters for the same reason it does in the English module: currency
 * and percentages claim their digits before the bare-number passes can, decimals
 * before integers so `0.05` is never read as "cero" then "cero cinco", and years
 * before integers so the year pass is the one that decides — even where, in
 * Spanish, the two agree.
 */
export function normalizeEsForSpeech(text) {
  let out = restoreLeadingZero(text).replace(ET_AL_RE, 'y otros');
  out = out.replace(CURRENCY_RE, currency);
  out = out.replace(PERCENT_RE, (_m, amount) => `${numberPhrase(amount)} por ciento`);
  out = out.replace(DOT_DECIMAL_RE,
    (_m, whole, fraction) => `${intToWords(Number(whole))} punto ${digitsToWords(fraction)}`);
  out = out.replace(COMMA_DECIMAL_RE,
    (_m, whole, fraction) => `${intToWords(Number(whole))} coma ${digitsToWords(fraction)}`);
  out = out.replace(YEAR_RE, (m) => yearPhrase(m));
  out = out.replace(INTEGER_RE, (m) => numberPhrase(m));
  return cleanup(out);
}


// ---------------------------------------------------------------------------
// French. The SECOND language, and the one that proves this module was right to
// be per-language rather than a shared number-speller with a word table.
//
// The en-fr checkpoint was MEASURED before any rule below was written, and it
// localises what the en-es checkpoint preserved:
//
//     $1,200    -> "1 200 $"           thousands split by U+0020, sign trailing
//     $15.50    -> "15,50 dollars"     decimal COMMA, unit spelled out
//     68%       -> "68 %"              space before the sign
//     p = 0.05  -> "p = 0,05"          decimal COMMA
//
// Two consequences a port of the Spanish constants would have got wrong in
// opposite directions. A comma is a DECIMAL here and never a thousands group, so
// Spanish's group-size guard is unnecessary. And a SPACE is a thousands group,
// which Spanish never has to consider -- and reading `1 200` as two numbers
// gives "un deux cents", a wrong VALUE.
//
// The space rule is the one real risk, so it was measured rather than reasoned
// about: across the 9,430 sentences the pipeline attempts, a "N NNN" adjacency
// that is NOT a grouped thousand occurs ZERO times, while a grouped thousand
// occurs 15 times. That is a fact about this corpus and French typography; a
// corpus of tabulated results could invert it, and this is where to look.
// ---------------------------------------------------------------------------

// 0-16 listed; 17-19 built as "dix-sept" and so on. French fuses nothing above
// 16, which is where it parts company with Spanish's run to 29.
const FR_ONES = [
  'zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit',
  'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize',
];
// 70 and 90 are deliberately absent: French builds them as 60+10 and 80+10,
// which is exactly why 71 is "soixante et onze" and 91 "quatre-vingt-onze".
const FR_TENS = { 2: 'vingt', 3: 'trente', 4: 'quarante', 5: 'cinquante', 6: 'soixante' };

const frUnderTwenty = (value) => (value <= 16 ? FR_ONES[value] : `dix-${FR_ONES[value - 10]}`);

function frUnderHundred(value) {
  if (value < 20) return frUnderTwenty(value);
  if (value >= 80) {
    // 80 alone takes the plural s; 81-99 never do. 90-99 is 80 + 10..19, which
    // makes 91 "quatre-vingt-onze" rather than "quatre-vingt-et-onze".
    const rest = value - 80;
    return rest === 0 ? 'quatre-vingts' : `quatre-vingt-${frUnderTwenty(rest)}`;
  }
  if (value >= 70) {
    // 70-79 is 60 + 10..19. The "et" appears at 71 for the same reason it
    // appears at 21: the ones part is "un" or "onze".
    const rest = value - 60;
    return `soixante${rest === 11 ? ' et ' : '-'}${frUnderTwenty(rest)}`;
  }
  const tens = Math.floor(value / 10);
  const ones = value % 10;
  if (ones === 0) return FR_TENS[tens];
  return `${FR_TENS[tens]}${ones === 1 ? ' et ' : '-'}${FR_ONES[ones]}`;
}

function frUnderThousand(value) {
  if (value < 100) return frUnderHundred(value);
  const hundreds = Math.floor(value / 100);
  const rest = value % 100;
  // "cent" carries its s only when NOTHING follows: "deux cents" but "deux cent
  // un". One hundred is bare "cent", never "un cent".
  const head = hundreds === 1 ? 'cent' : `${FR_ONES[hundreds]} cent`;
  if (rest === 0) return hundreds === 1 ? head : `${head}s`;
  return `${head} ${frUnderHundred(rest)}`;
}

function frIntToWords(value) {
  if (value < 0) return `moins ${frIntToWords(-value)}`;
  if (value >= 1_000_000) {
    const millions = Math.floor(value / 1_000_000);
    const rest = value % 1_000_000;
    const name = millions === 1 ? 'million' : 'millions';
    return `${frIntToWords(millions)} ${name}` + (rest ? ` ${frIntToWords(rest)}` : '');
  }
  if (value >= 1_000) {
    const thousands = Math.floor(value / 1_000);
    const rest = value % 1_000;
    // "mille" is INVARIABLE -- never "milles" -- and never takes "un".
    const head = thousands === 1 ? '' : `${frUnderThousand(thousands)} `;
    return `${head}mille` + (rest ? ` ${frUnderThousand(rest)}` : '');
  }
  return frUnderThousand(value);
}

const frDigitsToWords = (digits) => [...digits].map((d) => FR_ONES[Number(d)]).join(' ');

function frNumberPhrase(token) {
  const digits = token.replace(/ /g, '');
  // The same two identifier tells as the Spanish pass, for the same reasons: an
  // ungrouped run this long is a DOI tail or a collapsed page range, and a
  // leading zero is deleted outright by a cardinal reading.
  if (!token.includes(' ')
      && (digits.length >= IDENTIFIER_DIGITS || (digits.length > 1 && digits[0] === '0'))) {
    return frDigitsToWords(digits);
  }
  return frIntToWords(Number(digits));
}

// A grouped thousand: 1-3 digits, then one or more space-separated groups of
// EXACTLY three. The exactness is the whole guard -- "en 1961 2010" cannot
// match, because 2010 is four digits and the trailing lookahead rejects it.
const FR_GROUPED = '\\d{1,3}(?: \\d{3})+(?!\\d)';
const FR_AMOUNT = `(?:${FR_GROUPED}|\\d+)(?:,\\d+)?`;

const FR_CURRENCY_SIGN_RE = new RegExp(`${B}(${FR_GROUPED}|\\d+)\\s?\\$`, 'gu');
const FR_CURRENCY_WORD_RE = new RegExp(`${B}(\\d+),(\\d{1,2})\\s+dollars${B}`, 'gu');
const FR_PERCENT_RE = new RegExp(`${B}(${FR_AMOUNT})\\s?%`, 'gu');
const FR_COMMA_DECIMAL_RE = new RegExp(`${B}(\\d+),(\\d+)${B}`, 'gu');
const FR_DOT_DECIMAL_RE = new RegExp(`${B}(\\d+)\\.(\\d+)${B}`, 'gu');
const FR_YEAR_RE = new RegExp(`${B}(?:1[5-9]\\d{2}|20\\d{2})${B}`, 'gu');
const FR_INTEGER_RE = new RegExp(`${B}(?:${FR_GROUPED}|\\d+)${B}`, 'gu');

const frInt = (token) => Number(token.replace(/ /g, ''));
const frMoney = (value) => `${frIntToWords(value)} ${value === 1 ? 'dollar' : 'dollars'}`;

/**
 * `15,50 dollars` -- the checkpoint's own spelled-out form. Dollars-and-cents
 * structure, not a decimal read, for the reason the Spanish pass does the same:
 * "quinze virgule cinq zéro dollars" is not how anyone says a price.
 */
function frCurrencyWord(_match, whole, fraction) {
  const cents = Number(fraction.padEnd(2, '0').slice(0, 2));
  let phrase = frMoney(Number(whole));
  if (cents) phrase += ` et ${frIntToWords(cents)} ${cents === 1 ? 'cent' : 'cents'}`;
  return phrase;
}

/**
 * French translated text -> French spoken form.
 *
 * Pass order matters exactly as it does for Spanish, with one addition: both
 * currency shapes are claimed before the decimal passes, or `15,50 dollars`
 * becomes a decimal followed by the word "dollars".
 *
 * `et al.` has NO rule here, and that is a measurement rather than an omission:
 * the en-fr checkpoint passes it through unchanged and `et al.` is the correct
 * form in French academic prose. The Spanish rule exists because the en-es
 * checkpoint was measured mangling it, twice.
 */
export function normalizeFrForSpeech(text) {
  let out = restoreLeadingZero(text).replace(FR_CURRENCY_WORD_RE, frCurrencyWord);
  out = out.replace(FR_CURRENCY_SIGN_RE, (_m, amount) => frMoney(frInt(amount)));
  out = out.replace(FR_PERCENT_RE, (_m, amount) => {
    if (!amount.includes(',')) return `${frNumberPhrase(amount)} pour cent`;
    const [whole, fraction] = amount.split(',');
    return `${frIntToWords(frInt(whole))} virgule ${frDigitsToWords(fraction)} pour cent`;
  });
  out = out.replace(FR_COMMA_DECIMAL_RE,
    (_m, whole, fraction) => `${frIntToWords(Number(whole))} virgule ${frDigitsToWords(fraction)}`);
  out = out.replace(FR_DOT_DECIMAL_RE,
    (_m, whole, fraction) => `${frIntToWords(Number(whole))} point ${frDigitsToWords(fraction)}`);
  out = out.replace(FR_YEAR_RE, (m) => frIntToWords(Number(m)));
  out = out.replace(FR_INTEGER_RE, (m) => frNumberPhrase(m));
  return cleanup(out);
}

// German. The EIGHTH language and the FIFTH distinct convention — and the first
// that both preserves and localises. Measured with bench/formats/measure.py on
// the deployed post-splitter corpus; counts in bench/formats/de.json:
//
//     thousands -> DOT       20   8,000 -> 8.000, 40,320 -> 40.320
//     short dot KEPT        328   Figure 1.3, CC BY 2.0
//     comma decimal           5   $8.3 trillion -> 8,3 Billionen
//     percent spaced         24   20 %
//     percent attached       54   35%
//     et al. preserved      100   no rule earned
//
// Counted over all 9,430 translated sentences. 20 against 328 is Italian's
// split almost exactly (20 against 335). An earlier revision said 17 against
// 15 — measure.py's 12-per-bucket examples, not the corpus — which reads as
// near parity and as a far riskier rule than this actually is.
const DE_ONES = [
  'null', 'eins', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht',
  'neun', 'zehn', 'elf', 'zwölf', 'dreizehn', 'vierzehn', 'fünfzehn',
  // sechzehn and siebzehn ELIDE — not "sechszehn", not "siebenzehn". The same
  // two elisions repeat in the tens, and a TENS + ONES join gets all four wrong.
  'sechzehn', 'siebzehn', 'achtzehn', 'neunzehn',
];
const DE_TENS = {
  2: 'zwanzig', 3: 'dreißig', 4: 'vierzig', 5: 'fünfzig',
  6: 'sechzig', 7: 'siebzig', 8: 'achtzig', 9: 'neunzig',
};
// The COMPOUND form of 1, which is not its standalone form: "einundzwanzig" and
// "hunderteins" in the same language. The only digit needing two forms.
const DE_ONE_COMPOUND = 'ein';

function deUnderHundred(value) {
  if (value < 20) return DE_ONES[value];
  const tens = Math.floor(value / 10);
  const ones = value % 10;
  if (!ones) return DE_TENS[tens];
  // THE UNIT GOES FIRST, JOINED WITH "und" — einundzwanzig. Swedish, shipped
  // immediately before this, puts the ten first with no joiner (tjugoett).
  const unit = ones === 1 ? DE_ONE_COMPOUND : DE_ONES[ones];
  return `${unit}und${DE_TENS[tens]}`;
}

function deUnderThousand(value) {
  if (value < 100) return deUnderHundred(value);
  const hundreds = Math.floor(value / 100);
  const rest = value % 100;
  const head = hundreds === 1 ? 'hundert' : `${DE_ONES[hundreds]}hundert`;
  return head + (rest ? deUnderHundred(rest) : '');
}

function deIntToWords(value) {
  if (value < 0) return `minus ${deIntToWords(-value)}`;
  // LONG SCALE, spelled out here rather than mapped from English: a German
  // "Billion" is 10^12 where an English "billion" is 10^9. The checkpoint
  // already emits the right word unaided, so nothing translates scale words —
  // this table only fires on a numeral large enough to need one of its own.
  for (const [limit, singular, plural] of [
    [1_000_000_000_000, 'Billion', 'Billionen'],
    [1_000_000_000, 'Milliarde', 'Milliarden'],
    [1_000_000, 'Million', 'Millionen'],
  ]) {
    if (value >= limit) {
      const head = Math.floor(value / limit);
      const rest = value % limit;
      // All three scale nouns are FEMININE: "eine Million", not "ein".
      const word = head === 1 ? `eine ${singular}` : `${deIntToWords(head)} ${plural}`;
      return word + (rest ? ` ${deIntToWords(rest)}` : '');
    }
  }
  if (value >= 1_000) {
    const thousands = Math.floor(value / 1_000);
    const rest = value % 1_000;
    // German writes a whole number as ONE word, as Swedish does and as Danish
    // does not. Per language, not per family.
    const head = thousands === 1 ? 'tausend' : `${deUnderThousand(thousands)}tausend`;
    return head + (rest ? deUnderThousand(rest) : '');
  }
  return deUnderThousand(value);
}

const deDigitsToWords = (digits) => [...digits].map((d) => DE_ONES[Number(d)]).join(' ');
const deStrip = (token) => token.replace(/\./gu, '');
const deInt = (token) => Number(deStrip(token));

/** `1 %` is "ein Prozent", never "eins Prozent" — a German numeral agrees with
 * the noun it counts. This module inserts Prozent, Dollar and Cent itself, so
 * those are the only places agreement can be got right without the declension
 * system `20. Jahrhundert` would need. A bare 1 in running text reads "eins". */
const deBeforeNoun = (value) => (value === 1 ? DE_ONE_COMPOUND : deIntToWords(value));

/** Read BY HUNDREDS below 2000, as in Dutch, Danish and Swedish. */
function deYearPhrase(value) {
  if (value >= 2000) return deIntToWords(value);
  const hundreds = Math.floor(value / 100);
  const rest = value % 100;
  return `${deUnderHundred(hundreds)}hundert${rest ? deUnderHundred(rest) : ''}`;
}

function deNumberPhrase(token) {
  const digits = deStrip(token);
  if (!token.includes('.')
      && (digits.length >= IDENTIFIER_DIGITS || (digits.length > 1 && digits[0] === '0'))) {
    return deDigitsToWords(digits);
  }
  return deIntToWords(Number(digits));
}

// A DOT and nothing else. Swedish needed a dot AND a space because en-sv writes
// both; en-de was measured writing 20 dot groups and ZERO space or comma groups,
// so that alternation is not ported. The group must be EXACTLY three digits,
// which is what keeps "1.3" and "2.0" out of it.
const DE_GROUPED = '\\d{1,3}(?:\\.\\d{3})+(?!\\d)';
const DE_AMOUNT = `(?:${DE_GROUPED}|\\d+)(?:,\\d+)?`;
const DE_SCALE = '(?:Million|Millionen|Milliarde|Milliarden|Billion|Billionen)';
const DE_CURRENCY_SCALE_RE = new RegExp(`\\$\\s?(\\d+(?:,\\d+)?)\\s+(${DE_SCALE})${B}`, 'gu');
const DE_CURRENCY_CENTS_RE = new RegExp(`\\$\\s?(\\d+),(\\d{1,2})(?!\\d)(?!\\s+${DE_SCALE}${B})`, 'gu');
const DE_CURRENCY_SIGN_RE = new RegExp(`\\$\\s?(${DE_GROUPED}|\\d+)`, 'gu');
const DE_PERCENT_RE = new RegExp(`${B}(${DE_AMOUNT})\\s?%`, 'gu');
// NOT capped at two digits the way Hungarian's is. Hungarian needed the cap
// because a leaked English thousands comma was MEASURED there; German localises
// all 20 of its thousands groups to a dot and leaks none, so the cap would be an
// unmeasured rule. Recorded so the day one leaks, this is where it lands.
const DE_COMMA_DECIMAL_RE = new RegExp(`${B}(\\d+),(\\d+)${B}`, 'gu');
const DE_SECTION_DOT_RE = new RegExp(`${B}(\\d+)\\.(\\d{1,2})(?!\\d)`, 'gu');
const DE_YEAR_RE = new RegExp(`${B}(?:1[5-9]\\d{2}|20\\d{2})${B}`, 'gu');
const DE_YEAR_ONLY_RE = /^(?:1[5-9]\d{2}|20\d{2})$/u;
const DE_INTEGER_RE = new RegExp(`${B}(?:${DE_GROUPED}|\\d+)${B}`, 'gu');
// The decade suffix, 23 occurrences, and the one defect the whole-track audit
// caught that every unit test had missed. German glues it straight onto the
// numeral — `1970er`, `40er` — where Swedish hyphenates (`1960-talet`), so
// checking for a hyphen construction found nothing while the phenomenon was
// there all along. Nothing \b-anchored can see it either: there is no boundary
// between `0` and `e`, so the year and integer passes both skipped it and the
// raw digits reached the voice.
//
// Anchored on the suffix `er` EXACTLY, because the same corpus carries `497px`,
// `DSC01311`, `8f` and `83bf`, which must stay untouched.
const DE_DECADE_RE = new RegExp(`${B}(\\d+)er${B}`, 'gu');
// `z.B.` 103 times and `d.h.` 38, in both spellings — dot-separated
// abbreviations a voice reads out as letters, the standard that earned Spanish
// `et al. -> y otros` and Swedish `m.fl.` (which earned it at 29).
//
// LITERAL STRINGS, not the dotted-abbreviation shape: the same corpus carries
// `B. F.`, `R. H.` and `R. J.` — author initials with the identical shape — and
// `et al.` 100 times, left alone because it already reads as words. Measured
// and deliberately NOT expanded: `bzw.` (5) and `usw.` (4) carry only a
// trailing dot, a different shape at a fifteenth of the frequency.
const DE_ABBREVIATIONS = [[/\bz\.\s?B\./gu, 'zum Beispiel'],
  [/\bd\.\s?h\./gu, 'das heißt']];

/** INVARIABLE after a numeral — "fünfzig Dollar", never "Dollars". */
const deMoney = (value) => `${deBeforeNoun(value)} Dollar`;
const deFraction = (whole, part, joiner) => `${deIntToWords(Number(whole))} ${joiner} ${deDigitsToWords(part)}`;

/** `1970er` → "neunzehnhundertsiebziger", `40er` → "vierziger". Appending the
 * suffix to the German cardinal is the whole rule: "vierzig" + "er" and
 * "neunzehnhundertsiebzig" + "er" are both already the right word. A decade
 * reads its number as a YEAR, so this cannot run after the year pass. */
function deDecade(_match, digits) {
  const phrase = DE_YEAR_ONLY_RE.test(digits)
    ? deYearPhrase(Number(digits)) : deNumberPhrase(digits);
  return `${phrase}er`;
}

function deCurrencyScale(_match, amount, scale) {
  const phrase = amount.includes(',')
    ? deFraction(...amount.split(','), 'Komma')
    : deBeforeNoun(Number(amount));
  return `${phrase} ${scale} Dollar`;
}

function deCurrencyCents(_match, whole, fraction) {
  const cents = Number(fraction.padEnd(2, '0').slice(0, 2));
  const dollars = Number(whole);
  if (dollars === 0 && cents) return `${deBeforeNoun(cents)} Cent`;
  let phrase = deMoney(dollars);
  if (cents) phrase += ` und ${deBeforeNoun(cents)} Cent`;
  return phrase;
}

/**
 * German translated text -> German spoken form.
 *
 * The pass order is the shared one. German adds no ordering of its own — it has
 * no hyphen-suffix construction like Swedish's `1960-talet` and no dotted
 * abbreviation like `m.fl.`, both checked for rather than assumed.
 *
 * ORDINALS ARE NOT HANDLED, deliberately. German marks one with a trailing dot
 * — `20. Jahrhundert`, `26. März`, `42. Straße` — and reading it takes
 * declension ("zwanzigsten"), the ordinal-stem system Hungarian's `42-ik` was
 * also denied. It is strictly harder than Hungarian's: that dot is
 * indistinguishable from a sentence-final period before a capitalised German
 * noun, and German capitalises every noun, so a rule would have to settle
 * sentence segmentation first. The numeral is read correctly and its ending is
 * missing — a stray syllable rather than a wrong value.
 */
export function normalizeDeForSpeech(text) {
  let out = restoreLeadingZero(text);
  // Abbreviations first, before any dot rule can look at their full stops —
  // the same ordering Swedish's m.fl. needs.
  for (const [pattern, expansion] of DE_ABBREVIATIONS) out = out.replace(pattern, expansion);
  out = out.replace(DE_CURRENCY_SCALE_RE, deCurrencyScale);
  out = out.replace(DE_CURRENCY_CENTS_RE, deCurrencyCents);
  out = out.replace(DE_CURRENCY_SIGN_RE, (_m, amount) => deMoney(deInt(amount)));
  out = out.replace(DE_PERCENT_RE, (_m, amount) => {
    if (!amount.includes(',')) return `${deBeforeNoun(deInt(amount))} Prozent`;
    return `${deFraction(...amount.split(','), 'Komma')} Prozent`;
  });
  out = out.replace(DE_COMMA_DECIMAL_RE,
    (_m, whole, fraction) => deFraction(whole, fraction, 'Komma'));
  out = out.replace(DE_SECTION_DOT_RE,
    (_m, whole, fraction) => deFraction(whole, fraction, 'Punkt'));
  out = out.replace(DE_DECADE_RE, deDecade);
  out = out.replace(DE_YEAR_RE, (m) => deYearPhrase(Number(m)));
  out = out.replace(DE_INTEGER_RE, (m) => deNumberPhrase(m));
  return cleanup(out);
}

// ---------------------------------------------------------------------------
// Portuguese (LT-217), BRAZILIAN: the en-pt export writes "colônias" and "US$",
// so the voice gets Brazilian forms (dezesseis, bilhão) rather than European
// ones (dezasseis, mil milhões). Measured on 146 corpus sentences translated
// one at a time by Douglasrambo/opus-mt-tc-big-en-pt-onnx, the only en-pt ONNX
// export transformers.js can load; there is no deployed pt track to count over.
// Still Brazilian after LT-255: Firefox Translations' en-pt writes "As treze
// colônias custam um bilhão de dólares", "trem", "arquivo" (checked 2026-11-06),
// though the odd European noun ("telemóvel") gets through.
// ---------------------------------------------------------------------------

const PT_ONES = [
  'zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito',
  'nove', 'dez', 'onze', 'doze', 'treze', 'catorze', 'quinze', 'dezesseis',
  'dezessete', 'dezoito', 'dezenove',
];
const PT_TENS = {
  2: 'vinte', 3: 'trinta', 4: 'quarenta', 5: 'cinquenta',
  6: 'sessenta', 7: 'setenta', 8: 'oitenta', 9: 'noventa',
};
// 100 alone is "cem"; 101-199 take "cento". Every other hundred is one word.
const PT_HUNDREDS = {
  1: 'cento', 2: 'duzentos', 3: 'trezentos', 4: 'quatrocentos', 5: 'quinhentos',
  6: 'seiscentos', 7: 'setecentos', 8: 'oitocentos', 9: 'novecentos',
};

function ptUnderThousand(value) {
  if (value === 100) return 'cem';
  const hundreds = Math.floor(value / 100);
  const rest = value % 100;
  const parts = hundreds ? [PT_HUNDREDS[hundreds]] : [];
  if (rest >= 20) {
    parts.push(PT_TENS[Math.floor(rest / 10)]);
    if (rest % 10) parts.push(PT_ONES[rest % 10]);
  } else if (rest || !parts.length) {
    parts.push(PT_ONES[rest]);
  }
  // Every part is joined with "e": cento e vinte e um.
  return parts.join(' e ');
}

/** Whether "e" joins a scale word to what follows it. Only before a single
 * group that is under 100 or a round hundred: "mil e duzentos", "dois mil e
 * dezenove", but "mil duzentos e cinquenta". */
function ptTakesE(rest) {
  let group = rest;
  while (group && group % 1000 === 0) group /= 1000;
  return group < 100 || (group < 1000 && group % 100 === 0);
}

// Short scale, as in Brazil: bilhão is 10^9.
const PT_SCALES = [
  [1_000_000_000_000, 'trilhão', 'trilhões'],
  [1_000_000_000, 'bilhão', 'bilhões'],
  [1_000_000, 'milhão', 'milhões'],
  [1_000, 'mil', 'mil'],
];

function ptIntToWords(value) {
  if (value < 0) return `menos ${ptIntToWords(-value)}`;
  for (const [limit, singular, plural] of PT_SCALES) {
    if (value < limit) continue;
    const head = Math.floor(value / limit);
    const rest = value % limit;
    let word;
    if (limit === 1_000) word = head === 1 ? 'mil' : `${ptIntToWords(head)} mil`; // "mil", never "um mil"
    else word = head === 1 ? `um ${singular}` : `${ptIntToWords(head)} ${plural}`;
    if (!rest) return word;
    return word + (ptTakesE(rest) ? ' e ' : ' ') + ptIntToWords(rest);
  }
  return ptUnderThousand(value);
}

const ptDigitsToWords = (digits) => [...digits].map((d) => PT_ONES[Number(d)]).join(' ');
const ptStrip = (token) => token.replace(/[.,]/gu, '');

function ptNumberPhrase(token) {
  const digits = ptStrip(token);
  if (digits === token
      && (digits.length >= IDENTIFIER_DIGITS || (digits.length > 1 && digits[0] === '0'))) {
    return ptDigitsToWords(digits);
  }
  return ptIntToWords(Number(digits));
}

// Thousands are a DOT, and the one leaked English COMMA group measured
// ("$1,250" -> "1,250 dólares") reads as a group too. A group is exactly three
// digits after a 1-3 digit head that does not start with 0, which keeps "1.3",
// "0,5" and "12,50" out of it. The cost, recorded: a three-place decimal such as
// "3,141" would read as a thousand; en-pt wrote none, every decimal measured had
// one or two places. The space group ("1 250") appeared only in BATCHED output,
// which the browser never runs (src/translate.worker.mjs), so it has no rule.
const PT_GROUPED = '[1-9]\\d{0,2}(?:\\.\\d{3})+(?!\\d)|[1-9]\\d{0,2}(?:,\\d{3})+(?!\\d)';
const PT_GROUPED_RE = new RegExp(`${B}(?:${PT_GROUPED})`, 'gu');
const PT_GROUPED_ONLY_RE = new RegExp(`^(?:${PT_GROUPED})$`, 'u');
// A whole part, grouped or not. With a decimal after it, "1.250,50" (or the
// leaked "1,250.50") is ONE amount: read apart, the head became a number and
// the ",50" was left behind.
const PT_WHOLE = `(?:${PT_GROUPED}|\\d+)`;
// The English form leaks through as well: "1,250.5", its dot the decimal.
const PT_EN_DECIMAL = '[1-9]\\d{0,2}(?:,\\d{3})+\\.\\d+';
const PT_EN_DECIMAL_ONLY_RE = new RegExp(`^${PT_EN_DECIMAL}$`, 'u');
const PT_GROUPED_DECIMAL_RE = new RegExp(
  `${B}([1-9]\\d{0,2}(?:\\.\\d{3})+),(\\d+)${B}|${B}([1-9]\\d{0,2}(?:,\\d{3})+)\\.(\\d+)${B}`, 'gu');
const PT_COMMA_DECIMAL_RE = new RegExp(`${B}(\\d+),(\\d+)${B}`, 'gu');
// A short dot is KEPT from English, as in German: "Tabela 1.3", "3.14", "2.0".
const PT_SECTION_DOT_RE = new RegExp(`${B}(\\d+)\\.(\\d{1,2})(?!\\d)`, 'gu');
const PT_INTEGER_RE = new RegExp(`${B}\\d+${B}`, 'gu');
const PT_AMOUNT = `(?:${PT_EN_DECIMAL}|(?:${PT_GROUPED}|\\d+)(?:,\\d+)?)`;

// The sign was measured three ways: "US$ 3 milhões", "US $" and a bare "$".
const PT_SIGN = `(?:${B}US\\s?)?\\$\\s?`;
const PT_SCALE = '(?:milhão|milhões|bilhão|bilhões|trilhão|trilhões)';
const PT_SCALE_END_RE = new RegExp(`${PT_SCALE}$`, 'u');
// An English dot before a scale ("US$ 1.5 bilhão") is a decimal, read as a comma.
const PT_CURRENCY_SCALE_RE = new RegExp(
  `${PT_SIGN}(\\d+(?:,\\d+|\\.\\d{1,2}(?!\\d))?)\\s+(${PT_SCALE})${B}`, 'gu');
// Cents after a sign, with either mark: "US$ 12,50", or English "$3.50".
const PT_CURRENCY_CENTS_RE = new RegExp(
  `${PT_SIGN}(${PT_WHOLE})[.,](\\d{1,2})(?!\\d)(?!\\s+${PT_SCALE}${B})`, 'gu');
const PT_CURRENCY_SIGN_RE = new RegExp(`${PT_SIGN}(${PT_GROUPED}|\\d+)`, 'gu');
// And spelled out after the amount: "12,50 dólares", or English "1,250.50 dólares".
const PT_CURRENCY_WORD_RE = new RegExp(`${B}(${PT_WHOLE})[.,](\\d{1,2})\\s+dólares${B}`, 'gu');
const PT_PERCENT_RE = new RegExp(`${B}(${PT_AMOUNT})\\s?%`, 'gu');
// en-pt kept "et al." three times in four; the voice would read the Latin.
const PT_ET_AL_RE = new RegExp(`${B}et\\s+al\\.`, 'gu');

const ptFraction = (whole, part, joiner) => `${ptIntToWords(Number(whole))} ${joiner} ${ptDigitsToWords(part)}`;

function ptAmount(amount) {
  if (PT_EN_DECIMAL_ONLY_RE.test(amount)) {
    const dot = amount.lastIndexOf('.');
    return ptFraction(amount.slice(0, dot).replace(/,/gu, ''), amount.slice(dot + 1), 'vírgula');
  }
  if (PT_GROUPED_ONLY_RE.test(amount) || !amount.includes(',')) return ptNumberPhrase(amount);
  const cut = amount.lastIndexOf(',');
  return ptFraction(amount.slice(0, cut).replace(/\./gu, ''), amount.slice(cut + 1), 'vírgula');
}

/** A whole scale word takes "de": "um milhão de dólares", "mil dólares". */
function ptMoney(value) {
  const words = ptIntToWords(value);
  if (PT_SCALE_END_RE.test(words)) return `${words} de dólares`;
  return `${words} ${value === 1 ? 'dólar' : 'dólares'}`;
}

function ptCurrencyCents(_match, whole, fraction) {
  const dollars = Number(ptStrip(whole));
  const cents = Number(fraction.padEnd(2, '0'));
  const centavos = `${ptIntToWords(cents)} ${cents === 1 ? 'centavo' : 'centavos'}`;
  if (dollars === 0 && cents) return centavos;
  return ptMoney(dollars) + (cents ? ` e ${centavos}` : '');
}

/** Portuguese translated text -> Brazilian Portuguese spoken form. */
export function normalizePtForSpeech(text) {
  let out = restoreLeadingZero(text);
  out = out.replace(PT_ET_AL_RE, 'e outros');
  // Currency and percentages claim their digits first, as in every language.
  out = out.replace(PT_CURRENCY_SCALE_RE,
    (_m, amount, scale) => `${ptAmount(amount.replace('.', ','))} ${scale} de dólares`);
  out = out.replace(PT_CURRENCY_CENTS_RE, ptCurrencyCents);
  out = out.replace(PT_CURRENCY_SIGN_RE, (_m, amount) => ptMoney(Number(ptStrip(amount))));
  out = out.replace(PT_CURRENCY_WORD_RE, ptCurrencyCents);
  out = out.replace(PT_PERCENT_RE, (_m, amount) => `${ptAmount(amount)} por cento`);
  out = out.replace(PT_GROUPED_DECIMAL_RE,
    (_m, whole, fraction, enWhole, enFraction) => ptFraction(ptStrip(whole ?? enWhole), fraction ?? enFraction, 'vírgula'));
  // Groups before the comma decimal, so "1,250" is never "um vírgula dois...".
  out = out.replace(PT_GROUPED_RE, (m) => ptNumberPhrase(m));
  out = out.replace(PT_COMMA_DECIMAL_RE,
    (_m, whole, fraction) => ptFraction(whole, fraction, 'vírgula'));
  out = out.replace(PT_SECTION_DOT_RE,
    (_m, whole, fraction) => ptFraction(whole, fraction, 'ponto'));
  out = out.replace(PT_INTEGER_RE, (m) => ptNumberPhrase(m));
  return cleanup(out);
}

/**
 * Keyed by the same ISO 639-1 codes as `pipeline.languages.TARGETS`. A code that
 * is absent is not an error — callers look one up with a fallback to identity, so
 * a language without a normaliser behaves exactly as it did before this existed.
 *
 * Since LT-217 Listen mode translates into es, fr, de and pt only, the
 * languages Phonon can speak; the other normalisers were removed with their
 * tracks. A code missing here gets identity.
 */
export const NORMALIZERS = {
  es: normalizeEsForSpeech,
  fr: normalizeFrForSpeech,
  de: normalizeDeForSpeech,
  pt: normalizePtForSpeech,
};
