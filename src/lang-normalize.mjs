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
 * Supertonic carrying raw digits, and it says `Había 21 mujeres` where the
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

// ---------------------------------------------------------------------------
// Italian. The THIRD language, and the first to invert BOTH marks relative to
// English. The en-it checkpoint was MEASURED before any rule below was written:
//
//     $1,200   -> "$ 1.200"   DOT thousands, sign LEADING with a space
//     $15.50   -> "$ 15,50"   decimal COMMA
//     68%      -> "68%"       NO space before the sign (French has one)
//     25,000   -> "25.000"    DOT thousands
//     et al.   -> "et al."    preserved
//     1st/2nd  -> "il primo"/"il secondo"   already spelled out
//
// So a DOT is a thousands group and a COMMA is a decimal — the inverse of
// English on both marks, where Spanish preserved the English forms and French
// inverted only one. Reading either the English way gives a wrong VALUE.
//
// THE HARD PART is that the dot is ambiguous WITHIN Italian, which neither
// previous language had to face: "1.200" is twelve hundred, "7.5" in
// "Figura 7.5" is a section number, "2.0" in "CC BY 2.0" is a version. Only
// GROUP SIZE tells them apart — a thousands group is ALWAYS exactly three
// digits — and the priority is the opposite of what a port would assume.
// Measured across the 9,423 shipped Italian sentences: the 1-2 digit dot form
// occurs 335 times against 20 real thousands groups, so reading a dot as
// thousands unconditionally corrupts 335 readings to fix 20.
// ---------------------------------------------------------------------------

const IT_ONES = [
  'zero', 'uno', 'due', 'tre', 'quattro', 'cinque', 'sei', 'sette', 'otto',
  'nove', 'dieci', 'undici', 'dodici', 'tredici', 'quattordici', 'quindici',
  'sedici', 'diciassette', 'diciotto', 'diciannove',
];
const IT_TENS = {
  2: 'venti', 3: 'trenta', 4: 'quaranta', 5: 'cinquanta',
  6: 'sessanta', 7: 'settanta', 8: 'ottanta', 9: 'novanta',
};

function itUnderHundred(value) {
  if (value < 20) return IT_ONES[value];
  const tens = Math.floor(value / 10);
  const ones = value % 10;
  let head = IT_TENS[tens];
  if (ones === 0) return head;
  // The tens ELIDE their final vowel before the two vowel-initial ones:
  // ventuno and ventotto, never "ventiuno"/"ventiotto". Nothing in Spanish or
  // French does this, so it is the first thing a port gets wrong.
  if (ones === 1 || ones === 8) head = head.slice(0, -1);
  // "tre" takes an accent as the final element of a compound: ventitré.
  return head + (ones === 3 ? 'tré' : IT_ONES[ones]);
}

function itUnderThousand(value) {
  if (value < 100) return itUnderHundred(value);
  const hundreds = Math.floor(value / 100);
  const rest = value % 100;
  // "cento" is INVARIABLE — duecento, never "duecenti" — and one hundred is
  // bare "cento", never "unocento".
  let head = hundreds === 1 ? 'cento' : `${IT_ONES[hundreds]}cento`;
  if (rest === 0) return head;
  const tail = itUnderHundred(rest);
  // cento drops its own final o before a tail starting with one: centottanta.
  if (tail.startsWith('o')) head = head.slice(0, -1);
  return head + tail;
}

function itIntToWords(value) {
  if (value < 0) return `meno ${itIntToWords(-value)}`;
  if (value >= 1000000) {
    const millions = Math.floor(value / 1000000);
    const rest = value % 1000000;
    const head = millions === 1 ? 'un milione' : `${itIntToWords(millions)} milioni`;
    return head + (rest ? ` ${itIntToWords(rest)}` : '');
  }
  if (value >= 1000) {
    const thousands = Math.floor(value / 1000);
    const rest = value % 1000;
    // Singular "mille", plural "-mila", fused onto whatever precedes it.
    const head = thousands === 1 ? 'mille' : `${itUnderThousand(thousands)}mila`;
    return head + (rest ? itUnderThousand(rest) : '');
  }
  return itUnderThousand(value);
}

const itDigitsToWords = (digits) => [...digits].map((d) => IT_ONES[Number(d)]).join(' ');
const itInt = (token) => Number(token.replace(/\./g, ''));
// "uno" loses its final vowel before a noun: un dollaro, ventun dollari.
const itApocopate = (phrase) => (phrase === 'uno' ? 'un'
  : (phrase.endsWith('uno') ? phrase.slice(0, -1) : phrase));

function itNumberPhrase(token) {
  const digits = token.replace(/\./g, '');
  // Same two identifier tells as the Spanish and French passes.
  if (!token.includes('.')
      && (digits.length >= IDENTIFIER_DIGITS || (digits.length > 1 && digits[0] === '0'))) {
    return itDigitsToWords(digits);
  }
  return itIntToWords(Number(digits));
}

// 1-3 digits then one or more DOT groups of EXACTLY three. The exactness is the
// entire guard keeping "Figura 7.5" and "CC BY 2.0" out.
const IT_GROUPED = '\\d{1,3}(?:\\.\\d{3})+(?!\\d)';
const IT_AMOUNT = `(?:${IT_GROUPED}|\\d+)(?:,\\d+)?`;
// A scale word after a currency amount means the comma is a DECIMAL inside a
// scaled quantity, not a cents separator: "$ 8,3 trilioni" read as dollars and
// cents gives $8.30 rather than $8.3 trillion, a wrong VALUE.
const IT_SCALE = '(?:mila|milione|milioni|miliardo|miliardi|bilione|bilioni|trilione|trilioni)';
const IT_CURRENCY_SCALE_RE = new RegExp(`\\$\\s?(\\d+(?:,\\d+)?)\\s+(${IT_SCALE})${B}`, 'gu');
const IT_CURRENCY_CENTS_RE = new RegExp(`\\$\\s?(\\d+),(\\d{1,2})(?!\\d)(?!\\s+${IT_SCALE}${B})`, 'gu');
const IT_CURRENCY_SIGN_RE = new RegExp(`\\$\\s?(${IT_GROUPED}|\\d+)`, 'gu');
const IT_PERCENT_RE = new RegExp(`${B}(${IT_AMOUNT})\\s?%`, 'gu');
const IT_COMMA_DECIMAL_RE = new RegExp(`${B}(\\d+),(\\d+)${B}`, 'gu');
// A dot group of ONE OR TWO digits: a section, figure or version number, never
// a thousand. 335 occurrences against 20 real thousands groups.
const IT_SECTION_DOT_RE = new RegExp(`${B}(\\d+)\\.(\\d{1,2})(?!\\d)`, 'gu');
const IT_YEAR_RE = new RegExp(`${B}(?:1[5-9]\\d{2}|20\\d{2})${B}`, 'gu');
const IT_INTEGER_RE = new RegExp(`${B}(?:${IT_GROUPED}|\\d+)${B}`, 'gu');

const itMoney = (value) => `${itApocopate(itIntToWords(value))} ${value === 1 ? 'dollaro' : 'dollari'}`;
const itFraction = (whole, part, joiner) => `${itIntToWords(Number(whole))} ${joiner} ${itDigitsToWords(part)}`;

function itCurrencyScale(_match, amount, scale) {
  const phrase = amount.includes(',')
    ? itFraction(...amount.split(','), 'virgola')
    : itIntToWords(Number(amount));
  return `${phrase} ${scale} di dollari`;
}

function itCurrencyCents(_match, whole, fraction) {
  const cents = Number(fraction.padEnd(2, '0').slice(0, 2));
  let phrase = itMoney(Number(whole));
  if (cents) {
    phrase += ` e ${itApocopate(itIntToWords(cents))} ${cents === 1 ? 'centesimo' : 'centesimi'}`;
  }
  return phrase;
}

/**
 * Italian translated text -> Italian spoken form.
 *
 * Pass order is load-bearing, with one ordering specific to Italian: the
 * SECTION-DOT pass must run before the integer pass but may run in any order
 * relative to the grouped-thousand pass, because the two regexes are made
 * mutually exclusive by GROUP SIZE rather than by sequence.
 *
 * `et al.` has NO rule, measured rather than omitted: it survives the en-it
 * checkpoint intact 100 times out of 100, and it is correct Italian academic
 * prose. The Spanish rule exists because that checkpoint mangled it.
 */
export function normalizeItForSpeech(text) {
  let out = restoreLeadingZero(text).replace(IT_CURRENCY_SCALE_RE, itCurrencyScale);
  out = out.replace(IT_CURRENCY_CENTS_RE, itCurrencyCents);
  out = out.replace(IT_CURRENCY_SIGN_RE, (_m, amount) => itMoney(itInt(amount)));
  out = out.replace(IT_PERCENT_RE, (_m, amount) => {
    if (!amount.includes(',')) return `${itNumberPhrase(amount)} per cento`;
    return `${itFraction(...amount.split(','), 'virgola')} per cento`;
  });
  out = out.replace(IT_COMMA_DECIMAL_RE,
    (_m, whole, fraction) => itFraction(whole, fraction, 'virgola'));
  out = out.replace(IT_SECTION_DOT_RE,
    (_m, whole, fraction) => itFraction(whole, fraction, 'punto'));
  out = out.replace(IT_YEAR_RE, (m) => itIntToWords(Number(m)));
  out = out.replace(IT_INTEGER_RE, (m) => itNumberPhrase(m));
  return cleanup(out);
}

// ---------------------------------------------------------------------------
// Dutch. The FOURTH language, and the fourth distinct convention in four tries.
// The en-nl checkpoint was MEASURED on the deployed corpus before any rule below
// was written (bench/formats/measure.py, 2026-08-27):
//
//     8,000     -> "8.000"          DOT thousands, 14 of 15
//     $50       -> "$50"            sign LEADING, tight
//     $400 bil  -> "$ 400 miljard"  sign LEADING, spaced — both forms occur
//     $8.3 tril -> "$8,3 triljoen"  decimal COMMA inside a scaled amount
//     $1.00     -> "$1,00"          decimal COMMA in cents
//     Figure 1.3-> "Figuur 1.3"     decimal DOT preserved
//     20%       -> "20%"            NO space before the sign, 58 of 58
//     et al.    -> "et al."         preserved 59 of 60, so NO rule
//
// Dutch takes ITALIAN's dot thousands and keeps ENGLISH's dot decimal at the
// same time, so one mark does two jobs in the same sentence — which no earlier
// language here had to face:
//
//     es  dot = decimal      comma = thousands   (English forms kept)
//     fr  comma = decimal    space = thousands
//     it  comma = decimal    dot   = thousands
//     nl  dot = decimal AND dot = thousands      <- both, same mark
//
// GROUP SIZE is the only thing separating them: a thousands group is ALWAYS
// exactly three digits.
//
// Two things a port from any earlier language gets wrong: Dutch puts the UNIT
// BEFORE THE TEN and joins with "en" (eenentwintig), taking a trema on that
// joint after a unit ending in -e (tweeëntwintig); and Dutch reads a YEAR BY
// HUNDREDS like English — 1961 is "negentienhonderdeenenzestig", where the
// es/fr/it plain-cardinal rule would give "duizend negenhonderdeenenzestig".
// ---------------------------------------------------------------------------

const NL_ONES = [
  'nul', 'een', 'twee', 'drie', 'vier', 'vijf', 'zes', 'zeven', 'acht',
  'negen', 'tien', 'elf', 'twaalf', 'dertien', 'veertien', 'vijftien',
  'zestien', 'zeventien', 'achttien', 'negentien',
];
const NL_TENS = {
  2: 'twintig', 3: 'dertig', 4: 'veertig', 5: 'vijftig',
  6: 'zestig', 7: 'zeventig', 8: 'tachtig', 9: 'negentig',
};

function nlUnderHundred(value) {
  if (value < 20) return NL_ONES[value];
  const tens = Math.floor(value / 10);
  const ones = value % 10;
  if (ones === 0) return NL_TENS[tens];
  const unit = NL_ONES[ones];
  // "twee" + "en" would spell "tweeen", three vowels reading as one long sound.
  // Dutch marks the boundary with a diaeresis instead.
  const joint = unit.endsWith('e') ? 'ën' : 'en';
  return unit + joint + NL_TENS[tens];
}

function nlUnderThousand(value) {
  if (value < 100) return nlUnderHundred(value);
  const hundreds = Math.floor(value / 100);
  const rest = value % 100;
  // One hundred is bare "honderd", never "eenhonderd", and the whole
  // sub-thousand number is ONE word.
  const head = hundreds === 1 ? 'honderd' : `${NL_ONES[hundreds]}honderd`;
  return head + (rest ? nlUnderHundred(rest) : '');
}

function nlIntToWords(value) {
  if (value < 0) return `min ${nlIntToWords(-value)}`;
  // Standalone, the numeral one is "een" — which is also the indefinite
  // article. Dutch disambiguates the numeral with accents, and this module only
  // ever emits numerals. Compounds (eenentwintig, honderdeen) are built from the
  // bare table entry and are deliberately not touched.
  if (value === 1) return 'één';
  if (value >= 1_000_000_000) {
    const billions = Math.floor(value / 1_000_000_000);
    const rest = value % 1_000_000_000;
    return `${nlIntToWords(billions)} miljard${rest ? ` ${nlIntToWords(rest)}` : ''}`;
  }
  if (value >= 1_000_000) {
    const millions = Math.floor(value / 1_000_000);
    const rest = value % 1_000_000;
    return `${nlIntToWords(millions)} miljoen${rest ? ` ${nlIntToWords(rest)}` : ''}`;
  }
  if (value >= 1_000) {
    const thousands = Math.floor(value / 1_000);
    const rest = value % 1_000;
    // The multiplier FUSES onto "duizend" (tweeduizend, twintigduizend) but the
    // remainder is a separate word: "tweeduizend vijfhonderd".
    const head = thousands === 1 ? 'duizend' : `${nlUnderThousand(thousands)}duizend`;
    return head + (rest ? ` ${nlUnderThousand(rest)}` : '');
  }
  return nlUnderThousand(value);
}

const nlDigitsToWords = (digits) => [...digits].map((d) => NL_ONES[Number(d)]).join(' ');
const nlInt = (token) => Number(token.replace(/\./g, ''));

/**
 * A year below 2000 is read BY HUNDREDS, as in English and unlike es/fr/it.
 * From 2000 the hundreds reading stops being how anyone says it and the plain
 * cardinal takes over.
 */
function nlYearPhrase(value) {
  if (value >= 2000) return nlIntToWords(value);
  const hundreds = Math.floor(value / 100);
  const rest = value % 100;
  return `${nlUnderHundred(hundreds)}honderd${rest ? nlUnderHundred(rest) : ''}`;
}

function nlNumberPhrase(token) {
  const digits = token.replace(/\./g, '');
  // The same two identifier tells as every other language here: an ungrouped run
  // this long is a DOI tail or a collapsed page range, and a leading zero is
  // deleted outright by a cardinal reading.
  if (!token.includes('.')
      && (digits.length >= IDENTIFIER_DIGITS || (digits.length > 1 && digits[0] === '0'))) {
    return nlDigitsToWords(digits);
  }
  return nlIntToWords(Number(digits));
}

// A grouped thousand: 1-3 digits then one or more DOT-separated groups of
// EXACTLY three. That exactness is the whole guard separating "8.000" from
// "Figuur 7.5" and "CC BY 2.0".
const NL_GROUPED = '\\d{1,3}(?:\\.\\d{3})+(?!\\d)';
const NL_AMOUNT = `(?:${NL_GROUPED}|\\d+)(?:,\\d+)?`;

// A scale word after a currency amount means the comma is a DECIMAL inside a
// scaled quantity, not a cents separator: "$8,3 triljoen" read as cents gives
// $8.30 for $8.3 trillion, a wrong VALUE.
const NL_SCALE = '(?:duizend|miljoen|miljard|biljoen|triljoen)';
const NL_CURRENCY_SCALE_RE = new RegExp(`\\$\\s?(\\d+(?:,\\d+)?)\\s+(${NL_SCALE})${B}`, 'gu');
const NL_CURRENCY_CENTS_RE = new RegExp(`\\$\\s?(\\d+),(\\d{1,2})(?!\\d)(?!\\s+${NL_SCALE}${B})`, 'gu');
const NL_CURRENCY_SIGN_RE = new RegExp(`\\$\\s?(${NL_GROUPED}|\\d+)`, 'gu');
const NL_PERCENT_RE = new RegExp(`${B}(${NL_AMOUNT})\\s?%`, 'gu');
const NL_COMMA_DECIMAL_RE = new RegExp(`${B}(\\d+),(\\d+)${B}`, 'gu');
// A dot group of ONE OR TWO digits: a section number, a figure number or a
// version, never a thousand.
const NL_SECTION_DOT_RE = new RegExp(`${B}(\\d+)\\.(\\d{1,2})(?!\\d)`, 'gu');
const NL_YEAR_RE = new RegExp(`${B}(?:1[5-9]\\d{2}|20\\d{2})${B}`, 'gu');
const NL_INTEGER_RE = new RegExp(`${B}(?:${NL_GROUPED}|\\d+)${B}`, 'gu');

// Dutch keeps a measure word SINGULAR after a numeral — "vijftig dollar", never
// "vijftig dollars". Every Romance language shipped here pluralises, so this is
// the line a port gets wrong without ever looking wrong.
const nlMoney = (value) => `${nlIntToWords(value)} dollar`;
const nlFraction = (whole, part, joiner) => `${nlIntToWords(Number(whole))} ${joiner} ${nlDigitsToWords(part)}`;

function nlCurrencyScale(_match, amount, scale) {
  const phrase = amount.includes(',')
    ? nlFraction(...amount.split(','), 'komma')
    : nlIntToWords(Number(amount));
  return `${phrase} ${scale} dollar`;
}

// A zero DOLLARS part is dropped, not read: `$0,25` as "nul dollar en
// vijfentwintig cent" is not how a price is said. Found by running the finished
// pass over the whole 9,430-sentence track, not by any unit test.
function nlCurrencyCents(_match, whole, fraction) {
  const cents = Number(fraction.padEnd(2, '0').slice(0, 2));
  const dollars = Number(whole);
  if (dollars === 0 && cents) return `${nlIntToWords(cents)} cent`;
  let phrase = nlMoney(dollars);
  if (cents) phrase += ` en ${nlIntToWords(cents)} cent`;
  return phrase;
}

/**
 * Dutch translated text -> Dutch spoken form.
 *
 * Pass order is the same shape as the other three: currency claims its digits
 * first or `$15,50` becomes a decimal beside a dollar sign. The year pass runs
 * before the integer pass because in Dutch the two genuinely DISAGREE — 1961 is
 * "negentienhonderdeenenzestig" as a year and "duizend negenhonderdeenenzestig"
 * as a quantity. In es/fr/it the two agree and the ordering only decides which
 * rule gets the credit; here it decides the words.
 */
export function normalizeNlForSpeech(text) {
  let out = restoreLeadingZero(text).replace(NL_CURRENCY_SCALE_RE, nlCurrencyScale);
  out = out.replace(NL_CURRENCY_CENTS_RE, nlCurrencyCents);
  out = out.replace(NL_CURRENCY_SIGN_RE, (_m, amount) => nlMoney(nlInt(amount)));
  out = out.replace(NL_PERCENT_RE, (_m, amount) => {
    if (!amount.includes(',')) return `${nlNumberPhrase(amount)} procent`;
    return `${nlFraction(...amount.split(','), 'komma')} procent`;
  });
  out = out.replace(NL_COMMA_DECIMAL_RE,
    (_m, whole, fraction) => nlFraction(whole, fraction, 'komma'));
  out = out.replace(NL_SECTION_DOT_RE,
    (_m, whole, fraction) => nlFraction(whole, fraction, 'punt'));
  out = out.replace(NL_YEAR_RE, (m) => nlYearPhrase(Number(m)));
  out = out.replace(NL_INTEGER_RE, (m) => nlNumberPhrase(m));
  return cleanup(out);
}

// ---------------------------------------------------------------------------
// Hungarian. The FIFTH language and the first AGGLUTINATIVE one — a different
// KIND of problem, not a harder version of the previous four. The en-hu
// checkpoint MEASURED (the SMALL opus-mt-en-hu, which is what this browser
// ships; the build-time gate is registered against tc-big, a different model):
//
//     8,000     → "8000"          NO separator at four digits
//     20,000    → "20 000"        SPACE separator from five
//     $50       → "50 dollárért"  sign already gone: WORD + case suffix
//     $8.3 tril → "8,3 trillió dollárt"   decimal COMMA
//     Figure 1.3→ "1.3 ábra"      decimal DOT preserved
//     20%       → "20%-a"         percent sign carrying a HYPHENATED SUFFIX
//     2042      → "2042-ig"       year carrying a HYPHENATED SUFFIX
//     et al.    → "et al."        preserved 59 of 60, so NO rule
//
// THE NEW PROBLEM is the hyphen. Hungarian attaches a case ending directly to a
// numeral written in digits, joined by a hyphen. Spelling the number out
// DELETES that hyphen and fuses the ending onto the word: "húsz százaléka",
// "kétezer-negyvenkettőig". Every earlier language could substitute a number in
// place; here the substitution has to carry a suffix across, and a pass that
// ignores the hyphen leaves "húsz százalék -a" — a dangling morpheme read aloud
// as a word.
//
// The suffix is NOT generated, only re-attached: the checkpoint already chose
// its form (vowel harmony picked -ben over -ban) for the digit's own reading.
//
// THE 2000 RULE decides where hyphens go INSIDE a number, and no other language
// here has anything like it: one word up to 2000, hyphenated thousands group
// above it. 1999 is ezerkilencszázkilencvenkilenc; 2042 is kétezer-negyvenkettő.
// The threshold is the VALUE, not the digit count.
//
// kettő/két is the one form this module CHOOSES rather than reads: "kettő"
// stands alone, "két" goes before the noun it counts. Prose is almost always
// attributive, so a following word selects "két" — except after a coordinating
// conjunction, where "2 és 3" is "kettő és három".
// ---------------------------------------------------------------------------

const HU_ONES = ['nulla', 'egy', 'kettő', 'három', 'négy', 'öt', 'hat', 'hét',
  'nyolc', 'kilenc'];
const HU_TENS = {
  1: 'tíz', 2: 'húsz', 3: 'harminc', 4: 'negyven', 5: 'ötven',
  6: 'hatvan', 7: 'hetven', 8: 'nyolcvan', 9: 'kilencven',
};
// 11-19 and 21-29 do NOT reuse the bare tens word — it changes shape before a
// unit. From 30 up it is regular.
const HU_TEEN_STEMS = { 1: 'tizen', 2: 'huszon' };
// A numeral standing before the noun it counts uses the attributive form.
const HU_ATTRIBUTIVE = { 2: 'két' };
// A numeral followed by one of these is an item in a LIST, not a quantity.
const HU_CONJUNCTIONS = new Set(['és', 'vagy', 'illetve', 'meg', 'valamint']);

const huOnes = (value, attributive) => (
  attributive && HU_ATTRIBUTIVE[value] ? HU_ATTRIBUTIVE[value] : HU_ONES[value]);

function huUnderHundred(value, attributive = false) {
  if (value < 10) return huOnes(value, attributive);
  const tens = Math.floor(value / 10);
  const ones = value % 10;
  if (ones === 0) return HU_TENS[tens];
  return (HU_TEEN_STEMS[tens] ?? HU_TENS[tens]) + huOnes(ones, attributive);
}

function huUnderThousand(value, attributive = false) {
  if (value < 100) return huUnderHundred(value, attributive);
  const hundreds = Math.floor(value / 100);
  const rest = value % 100;
  const head = hundreds === 1 ? 'száz' : `${huUnderHundred(hundreds, true)}száz`;
  return head + (rest ? huUnderHundred(rest, attributive) : '');
}

/**
 * The 2000 rule lives here: one word up to 2000, hyphenated above it.
 * The threshold is the VALUE, so 1999 and 2001 are spelled differently despite
 * both being four digits.
 */
function huIntToWords(value, attributive = false) {
  if (value < 0) return `mínusz ${huIntToWords(-value, attributive)}`;
  if (value >= 1_000_000_000) {
    const head = Math.floor(value / 1_000_000_000);
    const rest = value % 1_000_000_000;
    return `${huUnderThousand(head, true)}milliárd${rest ? `-${huIntToWords(rest, attributive)}` : ''}`;
  }
  if (value >= 1_000_000) {
    const head = Math.floor(value / 1_000_000);
    const rest = value % 1_000_000;
    return `${huUnderThousand(head, true)}millió${rest ? `-${huIntToWords(rest, attributive)}` : ''}`;
  }
  if (value >= 1_000) {
    const thousands = Math.floor(value / 1_000);
    const rest = value % 1_000;
    const head = thousands === 1 ? 'ezer' : `${huUnderThousand(thousands, true)}ezer`;
    if (!rest) return head;
    return head + (value > 2000 ? '-' : '') + huUnderThousand(rest, attributive);
  }
  return huUnderThousand(value, attributive);
}

const huDigitsToWords = (digits) => [...digits].map((d) => HU_ONES[Number(d)]).join(' ');
const huInt = (token) => Number(token.replace(/[  ]/g, ''));

// A grouped thousand: 1-3 digits then SPACE-separated groups of exactly three,
// as French does. Four-digit numbers are written solid in Hungarian and are
// matched by the plain integer pattern instead.
const HU_GROUPED = '\\d{1,3}(?:[\\u0020\\u00a0]\\d{3})+(?!\\d)';
const HU_AMOUNT = `(?:${HU_GROUPED}|\\d+)(?:,\\d+)?`;
// The accented letters are LISTED rather than given as a range: `á-ű` spans
// most of Latin Extended-A and would match letters no Hungarian ending contains.
const HU_WORD = '[a-zA-ZáéíóöőúüűÁÉÍÓÖŐÚÜŰ]';

// The hyphenated-suffix forms, which must both run BEFORE their bare
// counterparts or the bare rule consumes the number and strands the ending.
const HU_PERCENT_SUFFIX_RE = new RegExp(`(${HU_AMOUNT})\\s?%-(${HU_WORD}+)`, 'gu');
const HU_PERCENT_RE = new RegExp(`(${HU_AMOUNT})\\s?%`, 'gu');
// A comma before EXACTLY three digits is an English thousands separator the
// checkpoint failed to localise, not a Hungarian decimal. MEASURED: five commas
// between digits, four genuine 1-2 digit decimals and one leak — `40,320`,
// which read as a decimal is forty-point-three-two for forty thousand three
// hundred twenty. A wrong VALUE, which is what earns a rule from one occurrence.
const HU_COMMA_THOUSANDS_RE = new RegExp(`${B}(\\d{1,3}),(\\d{3})(?!\\d)`, 'gu');
// ...so the decimal rule is capped at two fractional digits, and the two are
// mutually exclusive by group size.
const HU_COMMA_DECIMAL_RE = new RegExp(`${B}(\\d+),(\\d{1,2})(?!\\d)`, 'gu');
const HU_SECTION_DOT_RE = new RegExp(`${B}(\\d+)\\.(\\d{1,2})(?!\\d)`, 'gu');
const HU_NUMBER_SUFFIX_RE = new RegExp(`${B}(${HU_GROUPED}|\\d+)-(${HU_WORD}+)`, 'gu');
// The currency form CARRYING a suffix, claimed before the bare one. `$30-os`
// reached by the bare rule becomes "harminc dollár" with "-os" stranded beside
// it — this module's own two passes orphaning a morpheme between them.
const HU_CURRENCY_SUFFIX_RE = new RegExp(`\\$\\s?(${HU_GROUPED}|\\d+)-(${HU_WORD}+)`, 'gu');
const HU_CURRENCY_RE = new RegExp(`\\$\\s?(${HU_GROUPED}|\\d+)`, 'gu');
const HU_INTEGER_RE = new RegExp(`${B}(?:${HU_GROUPED}|\\d+)${B}`, 'gu');
const HU_FOLLOWING_WORD_RE = new RegExp(`^[\\u0020\\u00a0]+(${HU_WORD}+)`, 'u');

const huFraction = (whole, part, joiner) => `${huIntToWords(Number(whole))} ${joiner} ${huDigitsToWords(part)}`;

function huNumberPhrase(token, attributive = false) {
  const digits = token.replace(/[  ]/g, '');
  if (!/[  ]/.test(token)
      && (digits.length >= IDENTIFIER_DIGITS || (digits.length > 1 && digits[0] === '0'))) {
    return huDigitsToWords(digits);
  }
  return huIntToWords(Number(digits), attributive);
}

/**
 * True when a word follows the number, so it is counting that word. A numeral
 * before a coordinating conjunction is an item in a list, not a quantity.
 */
function huIsAttributive(text, end) {
  const match = HU_FOLLOWING_WORD_RE.exec(text.slice(end));
  return Boolean(match) && !HU_CONJUNCTIONS.has(match[1].toLowerCase());
}

/**
 * Hungarian translated text -> Hungarian spoken form.
 *
 * Pass order carries one requirement no earlier language had: BOTH suffixed
 * forms must run before their bare counterparts. `20%-a` reached by the bare
 * percent rule becomes "húsz százalék -a", leaving the case ending as a
 * separate token the voice reads as a word.
 */
export function normalizeHuForSpeech(text) {
  let out = restoreLeadingZero(text).replace(HU_PERCENT_SUFFIX_RE, (_m, amount, suffix) => {
    if (!amount.includes(',')) return `${huNumberPhrase(amount)} százalék${suffix}`;
    return `${huFraction(...amount.split(','), 'egész')} százalék${suffix}`;
  });
  out = out.replace(HU_PERCENT_RE, (_m, amount) => {
    if (!amount.includes(',')) return `${huNumberPhrase(amount)} százalék`;
    return `${huFraction(...amount.split(','), 'egész')} százalék`;
  });
  out = out.replace(HU_CURRENCY_SUFFIX_RE,
    (_m, amount, suffix) => `${huIntToWords(huInt(amount), true)} dollár${suffix}`);
  out = out.replace(HU_CURRENCY_RE, (_m, amount) => `${huIntToWords(huInt(amount), true)} dollár`);
  // Rewritten to the SPACE Hungarian actually uses rather than deleted: deleting
  // it pushes 40320 past IDENTIFIER_DIGITS and the number comes out read digit
  // by digit, which is how the first version of this rule failed.
  out = out.replace(HU_COMMA_THOUSANDS_RE, (_m, head, tail) => `${head} ${tail}`);
  out = out.replace(HU_COMMA_DECIMAL_RE,
    (_m, whole, fraction) => huFraction(whole, fraction, 'egész'));
  out = out.replace(HU_SECTION_DOT_RE,
    (_m, whole, fraction) => huFraction(whole, fraction, 'pont'));
  out = out.replace(HU_NUMBER_SUFFIX_RE,
    (_m, amount, suffix) => huNumberPhrase(amount) + suffix);
  // HU_INTEGER_RE has NO capture groups — B and HU_GROUPED are both
  // non-capturing — so the callback's second argument is the OFFSET, not a
  // group. Getting that wrong reads `undefined.slice` at the first integer.
  out = out.replace(HU_INTEGER_RE,
    (m, offset, whole) => huNumberPhrase(m, huIsAttributive(whole, offset + m.length)));
  return cleanup(out);
}

// ---------------------------------------------------------------------------
// Danish. The SIXTH language. Its number FORMATS look exactly like Dutch's —
// dot thousands, dot decimal preserved, percent tight, `et al.` untouched —
// which is the trap, because the WORDS behind them are not portable. MEASURED
// on the deployed corpus before any rule below was written:
//
//     8,000     → "8.000"          DOT thousands, 14 of 15
//     $50       → "50 dollars"     often already a WORD, and PLURAL
//     $30,000   → "$ 30.000"       when the sign survives, LEADING
//     $8.3 tril → "$8,3 billioner" decimal COMMA, and the LONG scale
//     Figure 1.3→ "figur 1.3"      decimal DOT preserved
//     20%       → "20%"            NO space before the sign, 58 of 58
//     et al.    → "et al."         preserved 100 of 100, so NO rule
//     20th c.   → "det 20. århundrede"   ORDINAL as digits plus a PERIOD
//
// Three things a port from Dutch gets wrong, all measured: the measure word is
// PLURAL ("halvtreds dollars", where Dutch keeps it singular); the tens are
// VIGESIMAL from fifty up (halvtreds/tres/halvfjerds/firs/halvfems are scores,
// not derivable from the unit words); and "og" joins a SUB-HUNDRED tail to
// whatever precedes it — "to tusind og toogfyrre" but "to tusind fem hundrede".
//
// Shared with Dutch: the unit comes BEFORE the ten (enogtyve), and a year below
// 2000 is read BY HUNDREDS with the plain cardinal taking over from 2000.
// ---------------------------------------------------------------------------

const DA_ONES = [
  'nul', 'en', 'to', 'tre', 'fire', 'fem', 'seks', 'syv', 'otte', 'ni',
  'ti', 'elleve', 'tolv', 'tretten', 'fjorten', 'femten', 'seksten',
  'sytten', 'atten', 'nitten',
];
const DA_TENS = {
  2: 'tyve', 3: 'tredive', 4: 'fyrre', 5: 'halvtreds',
  6: 'tres', 7: 'halvfjerds', 8: 'firs', 9: 'halvfems',
};
const DA_ORDINAL_ONES = [
  null, 'første', 'anden', 'tredje', 'fjerde', 'femte', 'sjette', 'syvende',
  'ottende', 'niende', 'tiende', 'ellevte', 'tolvte', 'trettende',
  'fjortende', 'femtende', 'sekstende', 'syttende', 'attende', 'nittende',
];
// The tens ordinals restore the LONG vigesimal forms the cardinals abbreviate:
// "fyrre" but "fyrretyvende", "tres" but "tresindstyvende". Not derivable.
const DA_ORDINAL_TENS = {
  2: 'tyvende', 3: 'tredivte', 4: 'fyrretyvende', 5: 'halvtredsindstyvende',
  6: 'tresindstyvende', 7: 'halvfjerdsindstyvende', 8: 'firsindstyvende',
  9: 'halvfemsindstyvende',
};

function daUnderHundred(value) {
  if (value < 20) return DA_ONES[value];
  const tens = Math.floor(value / 10);
  const ones = value % 10;
  if (ones === 0) return DA_TENS[tens];
  // Unit BEFORE the ten, joined by "og". No vowel change, unlike Dutch's trema.
  return `${DA_ONES[ones]}og${DA_TENS[tens]}`;
}

function daUnderThousand(value) {
  if (value < 100) return daUnderHundred(value);
  const hundreds = Math.floor(value / 100);
  const rest = value % 100;
  const head = hundreds === 1 ? 'hundrede' : `${DA_ONES[hundreds]} hundrede`;
  return head + (rest ? ` og ${daUnderHundred(rest)}` : '');
}

/**
 * "og" joins a SUB-HUNDRED tail to whatever precedes it, and only that:
 * "to tusind og toogfyrre" but "to tusind fem hundrede".
 */
function daIntToWords(value) {
  if (value < 0) return `minus ${daIntToWords(-value)}`;
  for (const [limit, singular, plural] of [
    [1_000_000_000, 'milliard', 'milliarder'], [1_000_000, 'million', 'millioner'],
  ]) {
    if (value >= limit) {
      const head = Math.floor(value / limit);
      const rest = value % limit;
      const word = `${daIntToWords(head)} ${head === 1 ? singular : plural}`;
      if (!rest) return word;
      return word + (rest < 100 ? ` og ${daUnderHundred(rest)}` : ` ${daIntToWords(rest)}`);
    }
  }
  if (value >= 1_000) {
    const thousands = Math.floor(value / 1_000);
    const rest = value % 1_000;
    const head = thousands === 1 ? 'tusind' : `${daUnderThousand(thousands)} tusind`;
    if (!rest) return head;
    return head + (rest < 100 ? ` og ${daUnderHundred(rest)}` : ` ${daUnderThousand(rest)}`);
  }
  return daUnderThousand(value);
}

/** 1-99 only — every date and every century. A compound takes the unit's
 * CARDINAL and the ten's ORDINAL: enogtyvende, toogfyrretyvende. */
function daOrdinal(value) {
  if (value < 20) return DA_ORDINAL_ONES[value];
  const tens = Math.floor(value / 10);
  const ones = value % 10;
  if (ones === 0) return DA_ORDINAL_TENS[tens];
  return `${DA_ONES[ones]}og${DA_ORDINAL_TENS[tens]}`;
}

const daDigitsToWords = (digits) => [...digits].map((d) => DA_ONES[Number(d)]).join(' ');
const daInt = (token) => Number(token.replace(/\./g, ''));

/** A year below 2000 is read BY HUNDREDS. From 2000 the plain cardinal takes over. */
function daYearPhrase(value) {
  if (value >= 2000) return daIntToWords(value);
  const hundreds = Math.floor(value / 100);
  const rest = value % 100;
  return `${daUnderHundred(hundreds)} hundrede${rest ? ` og ${daUnderHundred(rest)}` : ''}`;
}

function daNumberPhrase(token) {
  const digits = token.replace(/\./g, '');
  if (!token.includes('.')
      && (digits.length >= IDENTIFIER_DIGITS || (digits.length > 1 && digits[0] === '0'))) {
    return daDigitsToWords(digits);
  }
  return daIntToWords(Number(digits));
}

const DA_GROUPED = '\\d{1,3}(?:\\.\\d{3})+(?!\\d)';
const DA_AMOUNT = `(?:${DA_GROUPED}|\\d+)(?:,\\d+)?`;
// Danish uses the LONG scale, so the checkpoint writes "billioner" for the
// English trillion. The rule reads whatever word is there rather than
// converting, so the scale system never has to be modelled.
const DA_SCALE = '(?:tusind|million|millioner|milliard|milliarder|billion|billioner)';
const DA_CURRENCY_SCALE_RE = new RegExp(`\\$\\s?(\\d+(?:,\\d+)?)\\s+(${DA_SCALE})${B}`, 'gu');
const DA_CURRENCY_CENTS_RE = new RegExp(`\\$\\s?(\\d+),(\\d{1,2})(?!\\d)(?!\\s+${DA_SCALE}${B})`, 'gu');
const DA_CURRENCY_SIGN_RE = new RegExp(`\\$\\s?(${DA_GROUPED}|\\d+)`, 'gu');
const DA_PERCENT_RE = new RegExp(`${B}(${DA_AMOUNT})\\s?%`, 'gu');
const DA_COMMA_DECIMAL_RE = new RegExp(`${B}(\\d+),(\\d+)${B}`, 'gu');
const DA_SECTION_DOT_RE = new RegExp(`${B}(\\d+)\\.(\\d{1,2})(?!\\d)`, 'gu');
// THE ORDINAL. Danish writes one as digits plus a PERIOD, so without this the
// cardinal pass says "det tyve. århundrede" — a number and a stray full stop.
// 13 occurrences in the 9,430 translated sentences.
//
// THE GUARD IS THE FOLLOWING WORD'S CASE, measured rather than reasoned: `20.`
// ending a sentence is character-for-character an ordinal. Measured on this
// corpus: 13 forms followed by a LOWERCASE word, every one a real ordinal, and
// ZERO followed by an uppercase one.
const DA_ORDINAL_RE = /(?<!\d)(\d{1,2})\.(?=\s+[a-zæøå])/gu;
const DA_YEAR_RE = new RegExp(`${B}(?:1[5-9]\\d{2}|20\\d{2})${B}`, 'gu');
const DA_INTEGER_RE = new RegExp(`${B}(?:${DA_GROUPED}|\\d+)${B}`, 'gu');

// PLURAL after a numeral, which the checkpoint itself writes and which inverts
// Dutch — the language whose number formats Danish otherwise matches exactly.
const daMoney = (value) => `${daIntToWords(value)} ${value === 1 ? 'dollar' : 'dollars'}`;
const daFraction = (whole, part, joiner) => `${daIntToWords(Number(whole))} ${joiner} ${daDigitsToWords(part)}`;

function daCurrencyScale(_match, amount, scale) {
  const phrase = amount.includes(',')
    ? daFraction(...amount.split(','), 'komma')
    : daIntToWords(Number(amount));
  return `${phrase} ${scale} dollars`;
}

function daCurrencyCents(_match, whole, fraction) {
  const cents = Number(fraction.padEnd(2, '0').slice(0, 2));
  const dollars = Number(whole);
  if (dollars === 0 && cents) return `${daIntToWords(cents)} cent`;
  let phrase = daMoney(dollars);
  if (cents) phrase += ` og ${daIntToWords(cents)} cent`;
  return phrase;
}

/**
 * Danish translated text -> Danish spoken form.
 *
 * Same pass order as Dutch, and for the same reasons. The ORDINAL pass is
 * Danish's own and runs before the year and integer passes: `Den 26. marts` has
 * to be claimed as an ordinal before the integer pass reads it as a cardinal
 * and leaves the period behind as a sentence end.
 */
export function normalizeDaForSpeech(text) {
  let out = restoreLeadingZero(text).replace(DA_CURRENCY_SCALE_RE, daCurrencyScale);
  out = out.replace(DA_CURRENCY_CENTS_RE, daCurrencyCents);
  out = out.replace(DA_CURRENCY_SIGN_RE, (_m, amount) => daMoney(daInt(amount)));
  out = out.replace(DA_PERCENT_RE, (_m, amount) => {
    if (!amount.includes(',')) return `${daNumberPhrase(amount)} procent`;
    return `${daFraction(...amount.split(','), 'komma')} procent`;
  });
  out = out.replace(DA_COMMA_DECIMAL_RE,
    (_m, whole, fraction) => daFraction(whole, fraction, 'komma'));
  out = out.replace(DA_SECTION_DOT_RE,
    (_m, whole, fraction) => daFraction(whole, fraction, 'punktum'));
  out = out.replace(DA_ORDINAL_RE, (_m, value) => daOrdinal(Number(value)));
  out = out.replace(DA_YEAR_RE, (m) => daYearPhrase(Number(m)));
  out = out.replace(DA_INTEGER_RE, (m) => daNumberPhrase(m));
  return cleanup(out);
}

// ---------------------------------------------------------------------------
// Swedish. The SEVENTH language, and the one that broke the "Scandinavian, so
// it will be Danish" prediction hardest. MEASURED on the deployed corpus:
//
//     8,000     → "8.000" AND "20 000"   BOTH separators, in the same book
//     $50       → "50 dollar"            INVARIABLE, where Danish pluralises
//     $8.3 tril → "8,3 biljoner dollar"  decimal COMMA, LONG scale
//     20%       → "20 %" AND "35%"       BOTH spacings, 37 against 31
//     et al.    → "et al." (71) AND "m.fl." (29)
//     1900s     → "1900-talet"           HYPHEN suffix, as Hungarian does
//     r = .30   → "r = .30"              LEADING-DOT decimal, no zero
//
// The checkpoint is INCONSISTENT about two things at once, which no earlier one
// was: a thousands group with a dot 12 times and a space 7, and a percent sign
// spaced 37 times and tight 31. A rule written from either half is wrong a
// third of the time.
//
// THE TENS GO FIRST AND THERE IS NO JOINER: tjugoett, trettiofem, nittionio.
// Dutch, Danish and German all put the UNIT first, so the one structural habit
// those three share is exactly the one Swedish drops — and it is the rule a
// port from Danish gets wrong on every number between 21 and 99.
//
// `dollar` is INVARIABLE, as in Dutch and unlike Danish. `m.fl.` earns a rule
// where `et al.` does not: `et al.` reads as words, `m.fl.` reads as letters.
// ---------------------------------------------------------------------------

const SV_ONES = [
  'noll', 'ett', 'två', 'tre', 'fyra', 'fem', 'sex', 'sju', 'åtta', 'nio',
  'tio', 'elva', 'tolv', 'tretton', 'fjorton', 'femton', 'sexton',
  'sjutton', 'arton', 'nitton',
];
const SV_TENS = {
  2: 'tjugo', 3: 'trettio', 4: 'fyrtio', 5: 'femtio',
  6: 'sextio', 7: 'sjuttio', 8: 'åttio', 9: 'nittio',
};

function svUnderHundred(value) {
  if (value < 20) return SV_ONES[value];
  const tens = Math.floor(value / 10);
  const ones = value % 10;
  // TEN FIRST, no joiner — tjugoett. Dutch, Danish and German do the opposite.
  return SV_TENS[tens] + (ones ? SV_ONES[ones] : '');
}

function svUnderThousand(value) {
  if (value < 100) return svUnderHundred(value);
  const hundreds = Math.floor(value / 100);
  const rest = value % 100;
  const head = hundreds === 1 ? 'hundra' : `${SV_ONES[hundreds]}hundra`;
  return head + (rest ? svUnderHundred(rest) : '');
}

function svIntToWords(value) {
  if (value < 0) return `minus ${svIntToWords(-value)}`;
  for (const [limit, singular, plural] of [
    [1_000_000_000_000, 'biljon', 'biljoner'],
    [1_000_000_000, 'miljard', 'miljarder'],
    [1_000_000, 'miljon', 'miljoner'],
  ]) {
    if (value >= limit) {
      const head = Math.floor(value / limit);
      const rest = value % limit;
      const word = head === 1 ? `en ${singular}` : `${svIntToWords(head)} ${plural}`;
      return word + (rest ? ` ${svIntToWords(rest)}` : '');
    }
  }
  if (value >= 1_000) {
    const thousands = Math.floor(value / 1_000);
    const rest = value % 1_000;
    // Swedish writes a whole number as ONE word — "tvåtusenfemhundra" — which
    // is standard orthography. Danish spaces its parts because Danish does.
    const head = thousands === 1 ? 'tusen' : `${svUnderThousand(thousands)}tusen`;
    return head + (rest ? svUnderThousand(rest) : '');
  }
  return svUnderThousand(value);
}

const svDigitsToWords = (digits) => [...digits].map((d) => SV_ONES[Number(d)]).join(' ');
const svStrip = (token) => token.replace(/[.  ]/g, '');
const svInt = (token) => Number(svStrip(token));

/** Read BY HUNDREDS below 2000, as in Dutch and Danish. */
function svYearPhrase(value) {
  if (value >= 2000) return svIntToWords(value);
  const hundreds = Math.floor(value / 100);
  const rest = value % 100;
  return `${svUnderHundred(hundreds)}hundra${rest ? svUnderHundred(rest) : ''}`;
}

function svNumberPhrase(token) {
  const digits = svStrip(token);
  const grouped = /[.  ]/.test(token);
  if (!grouped
      && (digits.length >= IDENTIFIER_DIGITS || (digits.length > 1 && digits[0] === '0'))) {
    return svDigitsToWords(digits);
  }
  return svIntToWords(Number(digits));
}

// BOTH separators, because the checkpoint writes both. Either way the group must
// be EXACTLY three digits — 311 short dot forms against 12 real thousands.
const SV_GROUPED = '\\d{1,3}(?:(?:\\.|[\\u0020\\u00a0])\\d{3})+(?!\\d)';
const SV_AMOUNT = `(?:${SV_GROUPED}|\\d+)(?:,\\d+)?`;
const SV_SCALE = '(?:tusen|miljon|miljoner|miljard|miljarder|biljon|biljoner)';
const SV_CURRENCY_SCALE_RE = new RegExp(`\\$\\s?(\\d+(?:,\\d+)?)\\s+(${SV_SCALE})${B}`, 'gu');
const SV_CURRENCY_CENTS_RE = new RegExp(`\\$\\s?(\\d+),(\\d{1,2})(?!\\d)(?!\\s+${SV_SCALE}${B})`, 'gu');
const SV_CURRENCY_SIGN_RE = new RegExp(`\\$\\s?(${SV_GROUPED}|\\d+)`, 'gu');
const SV_PERCENT_RE = new RegExp(`${B}(${SV_AMOUNT})\\s?%`, 'gu');
const SV_COMMA_DECIMAL_RE = new RegExp(`${B}(\\d+),(\\d+)${B}`, 'gu');
const SV_SECTION_DOT_RE = new RegExp(`${B}(\\d+)\\.(\\d{1,2})(?!\\d)`, 'gu');
const SV_WORD = '[a-zA-ZåäöÅÄÖ]';
// The hyphen suffix, 35 occurrences — Hungarian's mechanism in a Germanic
// language. Runs BEFORE the year and integer passes or the word is stranded.
const SV_SUFFIX_RE = new RegExp(`${B}(\\d+)-(${SV_WORD}+)`, 'gu');
const SV_YEAR_RE = new RegExp(`${B}(?:1[5-9]\\d{2}|20\\d{2})${B}`, 'gu');
const SV_YEAR_ONLY_RE = /^(?:1[5-9]\d{2}|20\d{2})$/u;
const SV_INTEGER_RE = new RegExp(`${B}(?:${SV_GROUPED}|\\d+)${B}`, 'gu');
const SV_M_FL_RE = /\bm\.\s?fl\./gu;

// INVARIABLE after a numeral, as in Dutch. The checkpoint writes "dollar" 13
// times and "dollars" never.
const svMoney = (value) => `${svIntToWords(value)} dollar`;
const svFraction = (whole, part, joiner) => `${svIntToWords(Number(whole))} ${joiner} ${svDigitsToWords(part)}`;

function svCurrencyScale(_match, amount, scale) {
  const phrase = amount.includes(',')
    ? svFraction(...amount.split(','), 'komma')
    : svIntToWords(Number(amount));
  return `${phrase} ${scale} dollar`;
}

function svCurrencyCents(_match, whole, fraction) {
  const cents = Number(fraction.padEnd(2, '0').slice(0, 2));
  const dollars = Number(whole);
  if (dollars === 0 && cents) return `${svIntToWords(cents)} cent`;
  let phrase = svMoney(dollars);
  if (cents) phrase += ` och ${svIntToWords(cents)} cent`;
  return phrase;
}

/** `1960-talet` → "nittonhundrasextiotalet", `5-åriga` → "femåriga". A decade
 * reads its number as a YEAR, which is why this cannot run after the year pass. */
function svSuffixed(_match, digits, word) {
  const phrase = SV_YEAR_ONLY_RE.test(digits)
    ? svYearPhrase(Number(digits)) : svNumberPhrase(digits);
  return phrase + word;
}

/**
 * Swedish translated text -> Swedish spoken form.
 *
 * Two orderings are Swedish's own: the HYPHEN-SUFFIX pass runs before the year
 * and integer passes, or `1960-talet` loses its word; and `m.fl.` is expanded
 * first, before any dot rule can look at its two full stops.
 */
export function normalizeSvForSpeech(text) {
  let out = restoreLeadingZero(text).replace(SV_M_FL_RE, 'med flera');
  out = out.replace(SV_CURRENCY_SCALE_RE, svCurrencyScale);
  out = out.replace(SV_CURRENCY_CENTS_RE, svCurrencyCents);
  out = out.replace(SV_CURRENCY_SIGN_RE, (_m, amount) => svMoney(svInt(amount)));
  out = out.replace(SV_PERCENT_RE, (_m, amount) => {
    if (!amount.includes(',')) return `${svNumberPhrase(amount)} procent`;
    return `${svFraction(...amount.split(','), 'komma')} procent`;
  });
  out = out.replace(SV_COMMA_DECIMAL_RE,
    (_m, whole, fraction) => svFraction(whole, fraction, 'komma'));
  out = out.replace(SV_SECTION_DOT_RE,
    (_m, whole, fraction) => svFraction(whole, fraction, 'punkt'));
  out = out.replace(SV_SUFFIX_RE, svSuffixed);
  out = out.replace(SV_YEAR_RE, (m) => svYearPhrase(Number(m)));
  out = out.replace(SV_INTEGER_RE, (m) => svNumberPhrase(m));
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


// Czech. The NINTH language, the SIXTH distinct convention, and the first that
// is neither Germanic nor Romance. Measured with bench/formats/measure.py and
// COUNTED over all 9,430 translated sentences with bench/formats/count.py;
// shapes in bench/formats/cs.json.
//
//     thousands -> SPACE     17   8,000 -> 8 000, 40,320 -> 40 320
//     dot groups              0   <- see below; this is the finding
//     short dot KEPT        301   obr. 1.3, CC BY 2.0
//     percent attached       80   3%, 54%          percent spaced: 0
//     comma decimal           7   8,3 bilionu / 14,4% / 2,0
//     leaked English comma    3   50,000 / 1,424 / 5 000,000
//     $ surviving             3   ($20), ($1)
//     et al. preserved       95   no rule earned
//
// THE DOT AMBIGUITY IS GONE, and that is a measurement. Italian, Dutch, Danish
// and German each had to separate a thousands dot from a section number by
// GROUP SIZE, on ratios of 20-against-335, 19-against-281, 19-against-316 and
// 20-against-328. en-cs writes ZERO dot groups, so all 301 of its dots are
// section numbers or versions. What replaces it is Hungarian's problem: a SPACE
// separator, and three English commas that survived unlocalised.
const CS_ONES = [
  'nula', 'jedna', 'dva', 'tři', 'čtyři', 'pět', 'šest', 'sedm', 'osm',
  'devět', 'deset', 'jedenáct', 'dvanáct', 'třináct', 'čtrnáct', 'patnáct',
  'šestnáct', 'sedmnáct', 'osmnáct', 'devatenáct',
];
const CS_TENS = {
  2: 'dvacet', 3: 'třicet', 4: 'čtyřicet', 5: 'padesát',
  6: 'šedesát', 7: 'sedmdesát', 8: 'osmdesát', 9: 'devadesát',
};
// 200 is a surviving DUAL — "dvě stě", not the plural "sta" that 300 and 400
// take, and not the genitive "set" that 500 upward take. Three forms of one
// word across nine entries, which is why this is a table.
const CS_HUNDREDS = {
  1: 'sto', 2: 'dvě stě', 3: 'tři sta', 4: 'čtyři sta', 5: 'pět set',
  6: 'šest set', 7: 'sedm set', 8: 'osm set', 9: 'devět set',
};
// ONLY 1 and 2 inflect for gender. Neuter and feminine share a form for 2 and
// differ for 1, so this is a table rather than a pair of suffix rules.
const CS_GENDERED = { 1: { m: 'jeden', f: 'jedna', n: 'jedno' }, 2: { m: 'dva', f: 'dvě', n: 'dvě' } };

const csOnes = (value, gender) => (gender && CS_GENDERED[value]
  ? CS_GENDERED[value][gender] : CS_ONES[value]);

function csUnderHundred(value, gender) {
  if (value < 20) return csOnes(value, gender);
  const tens = Math.floor(value / 10);
  const ones = value % 10;
  if (!ones) return CS_TENS[tens];
  // Separate words, ten first — "dvacet jedna". Czech's fused unit-first form
  // ("jedenadvacet") is archaic and the checkpoint uses neither, because it
  // leaves the digits.
  return `${CS_TENS[tens]} ${csOnes(ones, gender)}`;
}

function csUnderThousand(value, gender) {
  if (value < 100) return csUnderHundred(value, gender);
  const hundreds = Math.floor(value / 100);
  const rest = value % 100;
  return CS_HUNDREDS[hundreds] + (rest ? ` ${csUnderHundred(rest, gender)}` : '');
}

// LONG SCALE, and it is the checkpoint's as well as the language's: a Czech
// "bilion" is 10^12 where an English "billion" is 10^9. en-cs already emits the
// right word unaided, so nothing here translates a scale word. Each entry
// carries the noun's GENDER, because the numeral in front of it agrees:
// "dva miliony" but "dvě miliardy".
const CS_SCALES = [
  [1e12, 'm', ['bilion', 'biliony', 'bilionů']],
  [1e9, 'f', ['miliarda', 'miliardy', 'miliard']],
  [1e6, 'm', ['milion', 'miliony', 'milionů']],
];

function csIntToWords(value, gender) {
  if (value < 0) return `minus ${csIntToWords(-value, gender)}`;
  for (const [limit, scaleGender, forms] of CS_SCALES) {
    if (value >= limit) {
      const head = Math.floor(value / limit);
      const rest = value % limit;
      // Bare "milion", not "jeden milion" — as with "tisíc" below, and unlike
      // German's "eine Million".
      const word = head === 1 ? forms[0] : csCounted(head, forms, scaleGender);
      return word + (rest ? ` ${csIntToWords(rest, gender)}` : '');
    }
  }
  if (value >= 1000) {
    const thousands = Math.floor(value / 1000);
    const rest = value % 1000;
    const head = thousands === 1 ? 'tisíc'
      : csCounted(thousands, ['tisíc', 'tisíce', 'tisíc'], 'm');
    return head + (rest ? ` ${csUnderThousand(rest, gender)}` : '');
  }
  return csUnderThousand(value, gender);
}

/**
 * A numeral and the noun it counts, in the form that numeral governs.
 *
 * The one piece of Czech morphology no earlier language needed, and the
 * checkpoint's own output is the evidence: en-cs writes `$4` as "4 dolary" and
 * `$50` as "50 dolarů", two different words for one noun.
 *
 *     1        nominative singular   jeden dolar     jedno procento
 *     2, 3, 4  nominative plural     dva dolary      dvě procenta
 *     anything genitive plural       padesát dolarů  dvacet procent
 *
 * Gender reaches only 1 and 2 and belongs to the noun, so the caller names it:
 * procento is neuter and dolar masculine, which is why 2% and $2 do not read
 * the numeral the same way.
 */
function csCounted(value, forms, gender) {
  if (value === 1) return `${csIntToWords(1, gender)} ${forms[0]}`;
  if (value >= 2 && value <= 4) return `${csIntToWords(value, gender)} ${forms[1]}`;
  // NO GENDER here: a numeral agrees with its noun only where the noun is
  // nominative, which is the two branches above. Once it drops to the genitive
  // plural the numeral takes its base form — "osmdesát dva procent", not
  // "osmdesát dvě procent".
  return `${csIntToWords(value)} ${forms[2]}`;
}

const csDigitsToWords = (digits) => [...digits].map((d) => CS_ONES[Number(d)]).join(' ');
const csStrip = (token) => token.replace(/[   ]/gu, '');
const csInt = (token) => Number(csStrip(token));

/** Czech reads a year as the PLAIN CARDINAL — 1997 is "tisíc devět set
 * devadesát sedm", not the by-hundreds reading Dutch, Danish, Swedish and
 * German all take. It keeps its own pass for the reason `yearPhrase` records:
 * the next language's author has to answer this question. */
const csYearPhrase = (value) => csIntToWords(value);

function csNumberPhrase(token) {
  const digits = csStrip(token);
  if (digits === token
      && (digits.length >= IDENTIFIER_DIGITS || (digits.length > 1 && digits[0] === '0'))) {
    return csDigitsToWords(digits);
  }
  return csIntToWords(Number(digits));
}

// A SPACE and nothing else: 17 space groups against zero dot groups. The
// separator is a plain U+0020 in all 17, checked rather than assumed; the
// no-break and narrow no-break spaces are accepted anyway because the cost is
// nothing.
const CS_GROUPED = '\\d{1,3}(?:[\\u0020\\u00a0\\u202f]\\d{3})+(?!\\d)';
const CS_AMOUNT = `(?:${CS_GROUPED}|\\d+)(?:,\\s?\\d+)?`;
// THREE `$` survive translation in the whole corpus, because en-cs otherwise
// writes the word already inflected. So this is the only currency rule, and the
// cents and scale-word rules every earlier language carries are absent by
// MEASUREMENT: no `$N,NN` and no `$N bilionu` form occurs.
const CS_CURRENCY_RE = new RegExp(`\\$\\s?(${CS_GROUPED}|\\d+)`, 'gu');
const CS_PERCENT_RE = new RegExp(`(${CS_AMOUNT})\\s?%`, 'gu');
// A comma before EXACTLY three digits is an English thousands separator the
// checkpoint failed to localise — Hungarian's leak, and the same fix. Three
// occurrences, all wrong VALUES if read as decimals. Rewritten to the SPACE
// Czech uses rather than deleted, because deleting it pushes `1424` past
// IDENTIFIER_DIGITS and it comes out read digit by digit.
const CS_COMMA_THOUSANDS_RE = new RegExp(`${B}(\\d{1,3}),(\\d{3})(?!\\d)`, 'gu');
// TIGHT COMMA ONLY. Allowing `,\s?` was the first version of this rule and the
// corpus caught it at once: `oblasti 1, 2, 4 a 5` came out as "oblasti jedna
// celá dva, čtyři a pět". The spaced forms the checkpoint really does write are
// claimed by rules carrying their own guard — the `%` below, and the whole-line
// anchor after it.
const CS_COMMA_DECIMAL_RE = new RegExp(`${B}(\\d+),(\\d{1,2})(?!\\d)`, 'gu');
// Capped at two fraction digits like every other language here, for a DIFFERENT
// reason than any of them: Czech needs no group-size test, since the corpus
// holds no dot thousands at all. The cap keeps `doi: 10.1177` out.
const CS_SECTION_DOT_RE = new RegExp(`${B}(\\d+)\\.(\\d{1,2})(?!\\d)`, 'gu');
// Ten table cells whose entire text is a decimal the checkpoint both localised
// and spaced: `57.1` -> `57, 1`. The whole-line anchor IS the guard — the same
// shape inside a sentence is a list.
const CS_CELL_DECIMAL_RE = /^\s*(\d+), (\d{1,2})\s*$/u;
const CS_YEAR_RE = new RegExp(`${B}(?:1[5-9]\\d{2}|20\\d{2})${B}`, 'gu');
const CS_INTEGER_RE = new RegExp(`${B}(?:${CS_GROUPED}|\\d+)${B}`, 'gu');

// "dolar" is masculine, "procento" neuter, and both inflect after a numeral.
// These are the only nouns this module inserts, so they are the only places the
// agreement can be got right at all.
const CS_DOLLAR = ['dolar', 'dolary', 'dolarů'];
const CS_PERCENT = ['procento', 'procenta', 'procent'];

/** The word between a decimal's two halves, which in Czech is not the name of
 * the mark but a COUNTED ADJECTIVE agreeing with the number in front of it:
 * "jedna celá pět", "dvě celé pět", "pět celých pět". Czech's two decimal
 * joiners therefore behave differently, and only this one inflects — the dot is
 * read "tečka", the name of the character, because a dot between digits is a
 * section number or a version and never a decimal. */
function csWholeWord(value) {
  if (value <= 1) return 'celá';
  if (value >= 2 && value <= 4) return 'celé';
  return 'celých';
}

/** A comma decimal. Feminine where the whole part is 1-4, agreeing with "celá";
 * above 4 the noun is genitive plural and the numeral reverts to its base form,
 * so 42,9 is "čtyřicet dva celých devět". Same rule as csCounted. */
function csFraction(whole, part) {
  const value = Number(whole);
  const gender = value >= 1 && value <= 4 ? 'f' : undefined;
  return `${csIntToWords(value, gender)} ${csWholeWord(value)} ${csDigitsToWords(part)}`;
}

const csSection = (whole, part) => `${csIntToWords(Number(whole))} tečka ${csDigitsToWords(part)}`;

function csPercent(_match, amount) {
  if (!amount.includes(',')) return csCounted(csInt(amount), CS_PERCENT, 'n');
  // Genitive singular after a decimal — "čtrnáct celých čtyři procenta", which
  // is spelled like the nominative plural above and reached by another rule.
  const [whole, part] = amount.split(',').map((p) => p.trim());
  return `${csFraction(whole, part)} procenta`;
}

/**
 * Czech translated text -> Czech spoken form.
 *
 * Pass order is the shared one with a single Czech addition: the comma
 * THOUSANDS rewrite runs before anything that reads a comma, so a leaked
 * `1,424` reaches the speller by the same path a written `1 424` does. It runs
 * before the currency rule too — Hungarian puts its own after — so a leaked
 * `$50,000` would be read as fifty thousand rather than as fifty.
 *
 * ORDINALS ARE NOT HANDLED, deliberately, and Czech is the strongest case for
 * that call yet. The checkpoint marks one with a trailing dot in 29 lines —
 * `20. století`, `26. března`, `21. prosincem` — and reading it needs the
 * ordinal declined to agree with its noun in whatever case that noun stands in.
 * Danish could take this rule because a Danish ordinal has ONE form; German was
 * denied it because the dot is ambiguous. Czech has both problems at once.
 *
 * Full list of what else is recorded rather than fixed — the glued
 * `10sekundové`, the surviving `1970s`, `0,25 dolarů`, the six dotted
 * abbreviations — is in `pipeline/lang_normalize.normalize_cs_for_speech`,
 * which is the specification.
 */
export function normalizeCsForSpeech(text) {
  let out = restoreLeadingZero(text);
  out = out.replace(CS_COMMA_THOUSANDS_RE, '$1 $2');
  out = out.replace(CS_CELL_DECIMAL_RE, (_m, whole, part) => csFraction(whole, part));
  out = out.replace(CS_CURRENCY_RE, (_m, amount) => csCounted(csInt(amount), CS_DOLLAR, 'm'));
  out = out.replace(CS_PERCENT_RE, csPercent);
  out = out.replace(CS_COMMA_DECIMAL_RE, (_m, whole, part) => csFraction(whole, part));
  out = out.replace(CS_SECTION_DOT_RE, (_m, whole, part) => csSection(whole, part));
  out = out.replace(CS_YEAR_RE, (m) => csYearPhrase(Number(m)));
  out = out.replace(CS_INTEGER_RE, (m) => csNumberPhrase(m));
  return cleanup(out);
}

/**
 * Keyed by the same ISO 639-1 codes as `pipeline.languages.TARGETS`. A code that
 * is absent is not an error — callers look one up with a fallback to identity, so
 * a language without a normaliser behaves exactly as it did before this existed.
 *
 * Spanish is first because it is the only pair with a hosted ONNX export, and the
 * only one the oracle diff has measured evidence for at all. Next cheapest, once
 * Spanish is proven: the other Romance languages that share the plain-cardinal
 * year reading (fr, it, pt, ro).
 */
export const NORMALIZERS = {
  es: normalizeEsForSpeech,
  fr: normalizeFrForSpeech,
  it: normalizeItForSpeech,
  nl: normalizeNlForSpeech,
  hu: normalizeHuForSpeech,
  da: normalizeDaForSpeech,
  sv: normalizeSvForSpeech,
  de: normalizeDeForSpeech,
  cs: normalizeCsForSpeech,
};
