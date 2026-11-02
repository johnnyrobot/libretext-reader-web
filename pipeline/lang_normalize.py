"""Turn TRANSLATED text into the target language's spoken form.

`pipeline/normalize.py` does this job for English, before translation. Task 15
settled spec §11 in favour of translating `sentence.display` -- the raw text --
rather than `sentence.speech`, because handing an Opus-MT checkpoint English
that already reads "nineteen ninety three" makes it emit three separate Spanish
numbers ("diecinueve noventa y tres" = 19, 90, 3), silently un-normalise back to
"1993", or hallucinate a different value entirely ("twenty eleven" ->
"veintiocho"). Nine of twenty stress sentences failed that way against three for
translating raw text.

Translating raw text does not make the normalisation job disappear. It moves it
to the far side of the translator, one module per language -- which is what this
file is. A translated sentence arrives carrying raw digits, `$`, `%` and one
stubborn Latin abbreviation, and the voice will read every one of them wrong.

**This runs before `pipeline.protect.restore()`, on the masked line.** That is
deliberate and load-bearing: after `restore()` the sentence contains real URLs,
email addresses and `[[latex:...]]` math payloads, all of them full of digits and
dots that the number passes below would happily spell out in Spanish. On the
masked line those spans are opaque `[[KIND0]]` placeholders whose digit is glued
to a letter, so no `\\b`-anchored number pattern can reach inside one.

**Scope of the Spanish implementation**, per the finding doc's measured evidence:

  - Cardinals, years, currency and percentages -- built here.
  - `et al.` -> `y otros` -- the ONE abbreviation that needed a rule. Raw `e.g.,`
    and `i.e.,` were measured translating correctly and unaided into
    `por ejemplo` / `es decir`, so the rest of `normalize.py`'s ABBREVIATIONS
    table is deliberately NOT ported. Measure an entry before adding it.
  - Citation compression (`normalize.py`'s "Surname and others, year") is NOT
    built. Under "before", a translated author list arrives in full, using the
    target language's own list syntax -- compressing it means parsing Spanish
    list grammar, not English's. Shipping without it is more information, not
    wrong information; the plan names this as acceptable v1 scope.

**Known limitation, recorded rather than guessed at:** the number formats below
are ENGLISH ones (`1,200` grouped by comma, `15.50` pointed by dot), because that
is what the converted `opus-mt-tc-big-en-es` checkpoint was measured to emit --
its Spanish for "$1,200" was "$ 1,200", not "$ 1.200". If a checkpoint ever
starts localising separators, a Spanish thousands dot (`1.200`) would read here
as a decimal. The comma case is already guarded (see `_COMMA_DECIMAL`); the dot
case is not, because inventing a rule for output nobody has measured is exactly
what Task 15 was dispatched to stop.
"""

import re
from collections.abc import Callable

# 0-29 are listed rather than composed. Spanish fuses them into single words --
# "dieciséis", not "diez y seis"; "veintiuno", not "veinte y uno" -- and the
# joining "y" only appears from 31 up. A TENS + ONES join gets 16-29 wrong.
_ONES = [
    "cero", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho",
    "nueve", "diez", "once", "doce", "trece", "catorce", "quince", "dieciséis",
    "diecisiete", "dieciocho", "diecinueve", "veinte", "veintiuno", "veintidós",
    "veintitrés", "veinticuatro", "veinticinco", "veintiséis", "veintisiete",
    "veintiocho", "veintinueve",
]
_TENS = {3: "treinta", 4: "cuarenta", 5: "cincuenta", 6: "sesenta",
         7: "setenta", 8: "ochenta", 9: "noventa"}
# Irregular at 5, 7 and 9: quinientos/setecientos/novecientos, never
# "cincocientos"/"sietecientos"/"nuevecientos".
_HUNDREDS = {1: "ciento", 2: "doscientos", 3: "trescientos", 4: "cuatrocientos",
             5: "quinientos", 6: "seiscientos", 7: "setecientos",
             8: "ochocientos", 9: "novecientos"}


def _under_hundred(value: int) -> str:
    if value < 30:
        return _ONES[value]
    tens, ones = divmod(value, 10)
    return _TENS[tens] + (f" y {_ONES[ones]}" if ones else "")


def _under_thousand(value: int) -> str:
    if value < 100:
        return _under_hundred(value)
    # 100 exactly is "cien"; 101 upward is "ciento ...". The two are not
    # interchangeable.
    if value == 100:
        return "cien"
    hundreds, rest = divmod(value, 100)
    return _HUNDREDS[hundreds] + (f" {_under_hundred(rest)}" if rest else "")


def _apocopate(phrase: str) -> str:
    """`uno` shortens to `un` directly before a masculine noun -- including
    `mil`, `millón` and `dólar`, which is the only place this function is used.
    21,000 is "veintiún mil", not "veintiuno mil"; $1 is "un dólar".

    A bare integer in running prose is left as "uno", because the noun that
    follows is in the translated text, not in this function's hands, and its
    gender is unknowable from here -- the same limit `normalize.py` lives with
    for English plurals.
    """
    if phrase == "uno":
        return "un"
    if phrase.endswith("veintiuno"):
        return phrase[: -len("veintiuno")] + "veintiún"
    if phrase.endswith(" y uno"):
        return phrase[: -len("uno")] + "un"
    return phrase


def _int_to_words(value: int) -> str:
    if value < 0:
        return "menos " + _int_to_words(-value)
    if value >= 1_000_000:
        millions, rest = divmod(value, 1_000_000)
        head = _apocopate(_int_to_words(millions))
        name = "millón" if millions == 1 else "millones"
        return f"{head} {name}" + (f" {_int_to_words(rest)}" if rest else "")
    if value >= 1_000:
        thousands, rest = divmod(value, 1_000)
        # 1000 is bare "mil", never "un mil" -- unlike "un millón", which does
        # carry its "un".
        head = "" if thousands == 1 else _apocopate(_under_thousand(thousands)) + " "
        return f"{head}mil" + (f" {_under_thousand(rest)}" if rest else "")
    return _under_thousand(value)


def _digits_to_words(digits: str) -> str:
    return " ".join(_ONES[int(d)] for d in digits)


# A dot decimal is the English form the checkpoint was measured to preserve.
_DOT_DECIMAL = re.compile(r"(\d{1,3}(?:,\d{3})*|\d+)\.(\d+)")
# A comma decimal is the Spanish form. It is told apart from an English
# thousands group by the group size and nothing else: a thousands group is
# ALWAYS exactly three digits, so `1,25` cannot be one and `1,250` cannot be
# anything else. Getting this backwards turns 1.25 into 125 -- a wrong VALUE,
# the worst class of defect Task 15 found.
_COMMA_DECIMAL = re.compile(r"(\d+),(\d{1,2})(?!\d)")


# An ungrouped run this long is an IDENTIFIER, not a quantity: a DOI tail, an
# ISBN, or an en-dash page range the translator collapsed into one run ("406-412"
# came back from the real checkpoint as "4064412"; the finding doc records the
# same collapse at b92s2, "339-347" -> "3393347"). Reading those as cardinals is
# how "406-412" becomes "cuatro millones sesenta y cuatro mil cuatrocientos
# doce" -- a wrong VALUE, which the finding doc calls the worst class of defect,
# and worse than the garbled-but-recoverable reading digit-by-digit gives.
#
# Five is where an UNGROUPED run stops being a plausible quantity in this
# corpus: a real quantity that size carries a thousands separator, and the
# checkpoint was measured to preserve the source's separators (see the module
# docstring). The trade-off is real and recorded: "25000 participantes" written
# without its comma reads digit-by-digit here where English's normalize.py would
# say "twenty five thousand".
_IDENTIFIER_DIGITS = 5


def _number_phrase(token: str) -> str:
    """One numeric token, in whichever of the four shapes above it arrived."""
    token = token.strip()
    dotted = _DOT_DECIMAL.fullmatch(token)
    if dotted:
        whole = int(dotted.group(1).replace(",", "") or 0)
        return f"{_int_to_words(whole)} punto {_digits_to_words(dotted.group(2))}"
    comma = _COMMA_DECIMAL.fullmatch(token)
    if comma:
        return f"{_int_to_words(int(comma.group(1)))} coma {_digits_to_words(comma.group(2))}"
    digits = token.replace(",", "")
    # A leading zero is the other identifier tell, at any length -- and reading
    # it as a cardinal silently DELETES it ("007" -> "siete"), which is the same
    # class of defect at a smaller scale.
    if "," not in token and (len(digits) >= _IDENTIFIER_DIGITS
                             or (len(digits) > 1 and digits[0] == "0")):
        return _digits_to_words(digits)
    return _int_to_words(int(digits))


def _year_phrase(token: str) -> str:
    """Spanish reads a year as the plain cardinal: 1961 is "mil novecientos
    sesenta y uno".

    Measured, not assumed (Task 15, `b8s0`/`b19s2`/`b20s0`): where the
    checkpoint got a year RIGHT of its own accord, that is the form it produced.
    English's century split -- "nineteen sixty one" -- does not transfer, and
    porting `normalize.py`'s `_year_phrase` unchanged would have produced
    "diecinueve sesenta y uno", which is the exact defect this whole decision
    exists to avoid.

    So in Spanish the year form and the cardinal form coincide, and this
    function is the cardinal. It stays a named function with its own pass
    because the per-language year convention needs one obvious home: the next
    language's author has to answer this question, and finding the answer
    already asked and recorded here is the point.
    """
    return _int_to_words(int(token))


_ET_AL_RE = re.compile(r"\bet\s+al\.")
_CURRENCY_RE = re.compile(r"\$\s?([\d,]+(?:\.\d+)?)")
_PERCENT_RE = re.compile(r"\b([\d,]+(?:\.\d+)?)\s?%")
_DOT_DECIMAL_RE = re.compile(r"\b(\d+)\.(\d+)\b")
_COMMA_DECIMAL_RE = re.compile(r"\b(\d+),(\d{1,2})(?!\d)")
# Same bounds and same reasoning as normalize.py's YEAR_RE: no comma group (the
# thousands separator marks a quantity, not a year), floor 1500 because
# reference lists carry four-digit page numbers, ceiling 2099.
_YEAR_RE = re.compile(r"\b(?:1[5-9]\d{2}|20\d{2})\b")
_INTEGER_RE = re.compile(r"\b\d[\d,]*\b")


def _currency(match: re.Match) -> str:
    """Dollars-and-cents structure, not a decimal read: $15.50 is "quince
    dólares y cincuenta centavos" (measured, Task 15 `synthetic-5`), never
    "quince punto cinco cero dólares"."""
    amount = match.group(1)
    if "." in amount:
        whole, cents = amount.split(".", 1)
        cents = cents.ljust(2, "0")[:2]
        phrase = _money(int(whole.replace(",", "") or 0))
        if int(cents):
            noun = "centavo" if int(cents) == 1 else "centavos"
            phrase += f" y {_apocopate(_int_to_words(int(cents)))} {noun}"
        return phrase
    return _money(int(amount.replace(",", "")))


def _money(value: int) -> str:
    return f"{_apocopate(_int_to_words(value))} " + ("dólar" if value == 1 else "dólares")


# A decimal written WITHOUT its leading zero -- `r = .30`, `omkring .7` -- which
# is an English convention the checkpoints pass straight through. Every language
# here already reads `0.30` correctly and every one of them read `.30` as
# THIRTY, a wrong VALUE, because the bare integer pass claimed the digits and
# left the dot behind as punctuation. Measured across the deployed corpora:
# nl 5, hu 4, da 4, it 4, sv 4, fr 3.
#
# The fix restores the zero and lets each language's OWN decimal rule do the
# rest, so it can only ever produce what that language already produces for the
# written-out form. `pipeline/tests/test_lang_normalize.py` asserts exactly that
# equivalence for every registered language, which is why this needs no
# per-language constant.
#
# The lookbehind excludes a WORD character, not just a digit: `Fig.2` must not
# become `Fig0.2`, and `1.3` must not become `10.3`.
_LEADING_DOT_RE = re.compile(r"(?<![\w.,])\.(?=\d)")


def _restore_leading_zero(text: str) -> str:
    return _LEADING_DOT_RE.sub("0.", text)


def _cleanup(text: str) -> str:
    """Collapse the whitespace and the comma stumbles that `et al.` -> `y otros`
    can leave behind. Narrower than normalize.py's `_cleanup_speech_punctuation`
    on purpose: that one also strips a LEADING comma, which only an English
    abbreviation expansion can strand, and Spanish carries `¿`/`¡` openers that
    no shared helper should ever learn about."""
    out = " ".join(text.split())
    for bad, good in ((" ,", ","), (",,", ","), (",.", "."), (",!", "!"), (",?", "?")):
        out = out.replace(bad, good)
    return out.strip()


def normalize_es_for_speech(text: str) -> str:
    """Spanish translated text -> Spanish spoken form.

    Pass order matters for the same reason it does in normalize.py: currency and
    percentages claim their digits before the bare-number passes can, decimals
    before integers so `0.05` is never read as "cero" then "cero cinco", and
    years before integers so the year pass is the one that decides -- even where,
    in Spanish, the two agree (see `_year_phrase`).
    """
    out = _ET_AL_RE.sub("y otros", _restore_leading_zero(text))
    out = _CURRENCY_RE.sub(_currency, out)
    out = _PERCENT_RE.sub(lambda m: f"{_number_phrase(m.group(1))} por ciento", out)
    out = _DOT_DECIMAL_RE.sub(
        lambda m: f"{_int_to_words(int(m.group(1)))} punto {_digits_to_words(m.group(2))}", out)
    out = _COMMA_DECIMAL_RE.sub(
        lambda m: f"{_int_to_words(int(m.group(1)))} coma {_digits_to_words(m.group(2))}", out)
    out = _YEAR_RE.sub(lambda m: _year_phrase(m.group(0)), out)
    out = _INTEGER_RE.sub(lambda m: _number_phrase(m.group(0)), out)
    return _cleanup(out)



# ---------------------------------------------------------------------------
# French. The SECOND language, and the one that proves this file was right to be
# per-language rather than a shared number-speller with a word table.
#
# The en-fr checkpoint was measured before any rule below was written, and it
# LOCALISES what the en-es checkpoint preserved:
#
#     $1,200    -> "1 200 $"           thousands split by U+0020, sign trailing
#     $15.50    -> "15,50 dollars"     decimal COMMA, unit spelled out
#     68%       -> "68 %"              space before the sign
#     p = 0.05  -> "p = 0,05"          decimal COMMA
#
# Two consequences that a port of the Spanish constants would have got wrong in
# opposite directions. A comma is a DECIMAL here, never a thousands group, so
# Spanish's `_COMMA_DECIMAL` group-size guard is unnecessary. And a SPACE is a
# thousands group, which Spanish never has to consider -- and reading `1 200` as
# two numbers gives "un deux cents", a wrong VALUE.
#
# The space rule is the one real risk in this module, so it was measured rather
# than reasoned about: across the 9,430 sentences the pipeline attempts, a
# "N NNN" adjacency that is NOT a grouped thousand occurs ZERO times, while a
# grouped thousand occurs 15 times. That is a fact about this corpus and about
# French typography; a corpus of, say, tabulated results could easily invert it,
# and this comment is where to look when it does.
# ---------------------------------------------------------------------------

# 0-16 are listed; 17-19 are built as "dix-sept" and so on. French fuses nothing
# above 16, which is where it differs from Spanish's run to 29.
_FR_ONES = [
    "zéro", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit",
    "neuf", "dix", "onze", "douze", "treize", "quatorze", "quinze", "seize",
]
# 70 and 90 are deliberately absent: French builds them as 60+10 and 80+10, which
# is exactly why 71 is "soixante et onze" and 91 is "quatre-vingt-onze".
_FR_TENS = {2: "vingt", 3: "trente", 4: "quarante", 5: "cinquante", 6: "soixante"}


def _fr_under_twenty(value: int) -> str:
    if value <= 16:
        return _FR_ONES[value]
    return f"dix-{_FR_ONES[value - 10]}"


def _fr_under_hundred(value: int) -> str:
    if value < 20:
        return _fr_under_twenty(value)
    if value >= 80:
        # 80 alone takes the plural s; 81-99 never do. 90-99 is 80 + 10..19,
        # which is what makes 91 "quatre-vingt-onze" and not "quatre-vingt-et-onze".
        rest = value - 80
        if rest == 0:
            return "quatre-vingts"
        return f"quatre-vingt-{_fr_under_twenty(rest)}"
    if value >= 70:
        # 70-79 is 60 + 10..19. The "et" appears at 71 for the same reason it
        # appears at 21: the ones part is "un" or "onze".
        rest = value - 60
        joiner = " et " if rest == 11 else "-"
        return f"soixante{joiner}{_fr_under_twenty(rest)}"
    tens, ones = divmod(value, 10)
    if ones == 0:
        return _FR_TENS[tens]
    joiner = " et " if ones == 1 else "-"
    return f"{_FR_TENS[tens]}{joiner}{_FR_ONES[ones]}"


def _fr_under_thousand(value: int) -> str:
    if value < 100:
        return _fr_under_hundred(value)
    hundreds, rest = divmod(value, 100)
    # "cent" carries its s only when NOTHING follows: "deux cents" but
    # "deux cent un". One hundred is bare "cent", never "un cent".
    head = "cent" if hundreds == 1 else f"{_FR_ONES[hundreds]} cent"
    if rest == 0:
        return head if hundreds == 1 else head + "s"
    return f"{head} {_fr_under_hundred(rest)}"


def _fr_int_to_words(value: int) -> str:
    if value < 0:
        return "moins " + _fr_int_to_words(-value)
    if value >= 1_000_000:
        millions, rest = divmod(value, 1_000_000)
        name = "million" if millions == 1 else "millions"
        head = _fr_int_to_words(millions)
        return f"{head} {name}" + (f" {_fr_int_to_words(rest)}" if rest else "")
    if value >= 1_000:
        thousands, rest = divmod(value, 1_000)
        # "mille" is INVARIABLE -- never "milles" -- and never takes "un".
        head = "" if thousands == 1 else f"{_fr_under_thousand(thousands)} "
        return f"{head}mille" + (f" {_fr_under_thousand(rest)}" if rest else "")
    return _fr_under_thousand(value)


def _fr_digits_to_words(digits: str) -> str:
    return " ".join(_FR_ONES[int(d)] for d in digits)


def _fr_int(token: str) -> int:
    """A French integer token, with its space thousands separators removed."""
    return int(token.replace(" ", ""))


def _fr_number_phrase(token: str) -> str:
    digits = token.replace(" ", "")
    # Same two identifier tells as the Spanish pass, and the same reasoning: an
    # ungrouped run this long is a DOI tail or a collapsed page range, and a
    # leading zero is deleted outright by a cardinal reading.
    if " " not in token and (len(digits) >= _IDENTIFIER_DIGITS
                             or (len(digits) > 1 and digits[0] == "0")):
        return _fr_digits_to_words(digits)
    return _fr_int_to_words(int(digits))


# A grouped thousand: 1-3 digits, then one or more space-separated groups of
# EXACTLY three. The exactness is the whole guard -- "en 1961 2010" cannot match,
# because 2010 is four digits and the trailing lookahead rejects it.
_FR_GROUPED = r"\d{1,3}(?: \d{3})+(?!\d)"
_FR_AMOUNT = rf"(?:{_FR_GROUPED}|\d+)(?:,\d+)?"

_FR_CURRENCY_SIGN_RE = re.compile(rf"\b({_FR_GROUPED}|\d+)\s?\$")
_FR_CURRENCY_WORD_RE = re.compile(r"\b(\d+),(\d{1,2})\s+dollars\b")
_FR_PERCENT_RE = re.compile(rf"\b({_FR_AMOUNT})\s?%")
_FR_COMMA_DECIMAL_RE = re.compile(r"\b(\d+),(\d+)\b")
_FR_DOT_DECIMAL_RE = re.compile(r"\b(\d+)\.(\d+)\b")
_FR_YEAR_RE = re.compile(r"\b(?:1[5-9]\d{2}|20\d{2})\b")
_FR_INTEGER_RE = re.compile(rf"\b(?:{_FR_GROUPED}|\d+)\b")


def _fr_money(value: int) -> str:
    return f"{_fr_int_to_words(value)} " + ("dollar" if value == 1 else "dollars")


def _fr_currency_word(match: re.Match) -> str:
    """`15,50 dollars` -- the checkpoint's own spelled-out form. Dollars-and-cents
    structure, not a decimal read, for the same reason the Spanish pass does it:
    "quinze virgule cinq zéro dollars" is not how anyone says a price."""
    cents = int(match.group(2).ljust(2, "0")[:2])
    phrase = _fr_money(int(match.group(1)))
    if cents:
        phrase += f" et {_fr_int_to_words(cents)} " + ("cent" if cents == 1 else "cents")
    return phrase


def normalize_fr_for_speech(text: str) -> str:
    """French translated text -> French spoken form.

    Pass order matters exactly as it does for Spanish, with one addition: the
    two currency shapes are claimed before the decimal passes, or `15,50 dollars`
    becomes a decimal followed by the word "dollars".

    `et al.` has NO rule here, and that is a measurement rather than an omission:
    the en-fr checkpoint passes it through unchanged and `et al.` is the correct
    form in French academic prose. The Spanish rule exists because the en-es
    checkpoint was measured mangling it, twice.
    """
    out = _FR_CURRENCY_WORD_RE.sub(_fr_currency_word, _restore_leading_zero(text))
    out = _FR_CURRENCY_SIGN_RE.sub(lambda m: _fr_money(_fr_int(m.group(1))), out)
    out = _FR_PERCENT_RE.sub(
        lambda m: f"{_fr_number_phrase(m.group(1))} pour cent"
        if "," not in m.group(1) else
        f"{_fr_int_to_words(_fr_int(m.group(1).split(',')[0]))} virgule "
        f"{_fr_digits_to_words(m.group(1).split(',')[1])} pour cent", out)
    out = _FR_COMMA_DECIMAL_RE.sub(
        lambda m: f"{_fr_int_to_words(int(m.group(1)))} virgule "
                  f"{_fr_digits_to_words(m.group(2))}", out)
    out = _FR_DOT_DECIMAL_RE.sub(
        lambda m: f"{_fr_int_to_words(int(m.group(1)))} point "
                  f"{_fr_digits_to_words(m.group(2))}", out)
    out = _FR_YEAR_RE.sub(lambda m: _fr_int_to_words(int(m.group(0))), out)
    out = _FR_INTEGER_RE.sub(lambda m: _fr_number_phrase(m.group(0)), out)
    return _cleanup(out)


# ---------------------------------------------------------------------------
# German. The EIGHTH language and the FIFTH distinct convention -- and the first
# that is not summarised by "preserves English forms" or "localises them". It
# does both at once, which is why the dot rule below carries more weight here
# than in any earlier language:
#
#     thousands -> DOT       20 occurrences  8,000 -> 8.000, 40,320 -> 40.320
#     short dot KEPT        328 occurrences  Figure 1.3, CC BY 2.0
#     comma decimal           5 occurrences  $8.3 trillion -> 8,3 Billionen
#     percent spaced         24 occurrences  20 %
#     percent attached       54 occurrences  35%
#     et al. preserved      100 occurrences  no rule earned
#
# 20 against 328 is Italian's split almost exactly (20 against 335), so the
# exactly-three-digits test is doing the same job here that it does there.
#
# THE FIRST FIVE COUNTS WERE WRONG BEFORE THE WHOLE-TRACK RUN, in the direction
# that flatters a sample: measure.py's 12-examples-per-bucket output put the
# split at 17 against 15, which reads as near parity and as a far riskier rule
# than it is. Counts here are over all 9,430 translated sentences; the shapes
# come from bench/formats/de.json. NOT ported from any earlier language.
# ---------------------------------------------------------------------------

_DE_ONES = [
    "null", "eins", "zwei", "drei", "vier", "fünf", "sechs", "sieben", "acht",
    "neun", "zehn", "elf", "zwölf", "dreizehn", "vierzehn", "fünfzehn",
    # sechzehn and siebzehn ELIDE -- not "sechszehn", not "siebenzehn". The same
    # two elisions repeat in the tens below, and a TENS + ONES join gets all
    # four wrong.
    "sechzehn", "siebzehn", "achtzehn", "neunzehn",
]
_DE_TENS = {2: "zwanzig", 3: "dreißig", 4: "vierzig", 5: "fünfzig",
            6: "sechzig", 7: "siebzig", 8: "achtzig", 9: "neunzig"}
# The COMPOUND form of 1, which is not its standalone form: "einundzwanzig" and
# "hunderteins" in the same language. Every other digit spells the same either
# way, so this is the only entry that needs two forms.
_DE_ONE_COMPOUND = "ein"


def _de_under_hundred(value: int) -> str:
    if value < 20:
        return _DE_ONES[value]
    tens, ones = divmod(value, 10)
    if not ones:
        return _DE_TENS[tens]
    # THE UNIT GOES FIRST, JOINED WITH "und" -- einundzwanzig. Swedish, the
    # language shipped immediately before this one, puts the ten first with no
    # joiner (tjugoett), so a port from it is wrong on every number 21-99.
    unit = _DE_ONE_COMPOUND if ones == 1 else _DE_ONES[ones]
    return f"{unit}und{_DE_TENS[tens]}"


def _de_under_thousand(value: int) -> str:
    if value < 100:
        return _de_under_hundred(value)
    hundreds, rest = divmod(value, 100)
    head = "hundert" if hundreds == 1 else _DE_ONES[hundreds] + "hundert"
    return head + (_de_under_hundred(rest) if rest else "")


def _de_int_to_words(value: int) -> str:
    if value < 0:
        return "minus " + _de_int_to_words(-value)
    # LONG SCALE, and the reason it is spelled out here rather than mapped from
    # English: a German "Billion" is 10^12 where an English "billion" is 10^9.
    # The checkpoint already emits the right word unaided (100 billion neurons
    # -> 100 Milliarden), so nothing translates scale words -- this table only
    # ever fires on a numeral large enough to need one of its own.
    for limit, singular, plural in ((1_000_000_000_000, "Billion", "Billionen"),
                                    (1_000_000_000, "Milliarde", "Milliarden"),
                                    (1_000_000, "Million", "Millionen")):
        if value >= limit:
            head, rest = divmod(value, limit)
            # All three scale nouns are FEMININE: "eine Million", not "ein".
            word = (f"eine {singular}" if head == 1
                    else f"{_de_int_to_words(head)} {plural}")
            return word + (f" {_de_int_to_words(rest)}" if rest else "")
    if value >= 1_000:
        thousands, rest = divmod(value, 1_000)
        # German writes a whole number as ONE word -- "zweitausendfünfhundert",
        # "vierzigtausenddreihundertzwanzig" -- as Swedish does and as Danish
        # does not. Per language, not per family.
        head = ("tausend" if thousands == 1
                else _de_under_thousand(thousands) + "tausend")
        return head + (_de_under_thousand(rest) if rest else "")
    return _de_under_thousand(value)


def _de_digits_to_words(digits: str) -> str:
    return " ".join(_DE_ONES[int(d)] for d in digits)


def _de_before_noun(value: int) -> str:
    """`1 %` is "ein Prozent", never "eins Prozent" -- a German numeral agrees
    with the noun it counts. This module inserts Prozent, Dollar and Cent
    itself, so those are the only places agreement can be got right without the
    declension system that `20. Jahrhundert` would need. A bare `1` in running
    text still reads "eins"; see the ordinal note on normalize_de_for_speech."""
    return _DE_ONE_COMPOUND if value == 1 else _de_int_to_words(value)


def _de_year_phrase(value: int) -> str:
    """Read BY HUNDREDS below 2000, as in Dutch, Danish and Swedish; the plain
    cardinal takes over from 2000 ("zweitausendzehn")."""
    if value >= 2000:
        return _de_int_to_words(value)
    hundreds, rest = divmod(value, 100)
    return (_de_under_hundred(hundreds) + "hundert"
            + (_de_under_hundred(rest) if rest else ""))


def _de_int(token: str) -> int:
    return int(token.replace(".", ""))


def _de_number_phrase(token: str) -> str:
    digits = token.replace(".", "")
    if "." not in token and (len(digits) >= _IDENTIFIER_DIGITS
                             or (len(digits) > 1 and digits[0] == "0")):
        return _de_digits_to_words(digits)
    return _de_int_to_words(int(digits))


# A DOT and nothing else. Swedish needed both a dot and a space because en-sv
# writes both; en-de was measured writing 20 dot groups and ZERO space or comma
# groups, so the alternation Swedish carries is not ported. The group must be
# EXACTLY three digits, which is what keeps "1.3" and "2.0" out of it.
_DE_GROUPED = r"\d{1,3}(?:\.\d{3})+(?!\d)"
_DE_AMOUNT = rf"(?:{_DE_GROUPED}|\d+)(?:,\d+)?"

_DE_SCALE = r"(?:Million|Millionen|Milliarde|Milliarden|Billion|Billionen)"
_DE_CURRENCY_SCALE_RE = re.compile(rf"\$\s?(\d+(?:,\d+)?)\s+({_DE_SCALE})\b")
_DE_CURRENCY_CENTS_RE = re.compile(rf"\$\s?(\d+),(\d{{1,2}})(?!\d)(?!\s+{_DE_SCALE}\b)")
_DE_CURRENCY_SIGN_RE = re.compile(rf"\$\s?({_DE_GROUPED}|\d+)")
_DE_PERCENT_RE = re.compile(rf"\b({_DE_AMOUNT})\s?%")
# NOT capped at two digits the way Hungarian's is. Hungarian needed the cap
# because a leaked English thousands comma was MEASURED there; German localises
# every one of its 20 thousands groups to a dot and leaks none, so the cap would
# be an unmeasured rule. Recorded so the day one leaks, this is where it lands.
_DE_COMMA_DECIMAL_RE = re.compile(r"\b(\d+),(\d+)\b")
_DE_SECTION_DOT_RE = re.compile(r"\b(\d+)\.(\d{1,2})(?!\d)")
_DE_YEAR_RE = re.compile(r"\b(?:1[5-9]\d{2}|20\d{2})\b")
_DE_YEAR_ONLY_RE = re.compile(r"(?:1[5-9]\d{2}|20\d{2})")
_DE_INTEGER_RE = re.compile(rf"\b(?:{_DE_GROUPED}|\d+)\b")
# The decade suffix, 23 occurrences, and the ONE defect the whole-track audit
# caught that every unit test had missed. German glues it straight onto the
# numeral -- `1970er`, `40er` -- where Swedish hyphenates (`1960-talet`), so
# checking for a hyphen construction found nothing while the phenomenon was
# there all along. Nothing `\b`-anchored can see it either: there is no boundary
# between `0` and `e`, so the year and integer passes both skipped it and the
# raw digits reached the voice.
#
# Anchored on the suffix `er` EXACTLY, because the same corpus carries `497px`,
# `DSC01311`, `8f` and `83bf`, which must stay untouched.
_DE_DECADE_RE = re.compile(r"\b(\d+)er\b")
# `z.B.` 103 times and `d.h.` 38, in both the spaced and unspaced spellings --
# dot-separated abbreviations that a voice reads out as letters, which is the
# standard that earned Spanish `et al. -> y otros` and Swedish `m.fl.`. Swedish
# earned its rule at 29 occurrences.
#
# LITERAL STRINGS, not the dotted-abbreviation shape: the same corpus carries
# `B. F.`, `R. H.` and `R. J.` -- author initials with the identical shape --
# and `et al.` 100 times, which is left alone because it already reads as words.
# Measured and deliberately NOT expanded: `bzw.` (5) and `usw.` (4) carry only a
# trailing dot rather than internal ones, which is a different shape and a
# different question at a fifteenth of the frequency.
_DE_ABBREVIATIONS = ((re.compile(r"\bz\.\s?B\."), "zum Beispiel"),
                     (re.compile(r"\bd\.\s?h\."), "das heißt"))


def _de_money(value: int) -> str:
    """INVARIABLE after a numeral -- "fünfzig Dollar", never "Dollars"."""
    return f"{_de_before_noun(value)} Dollar"


def _de_fraction(whole: str, part: str, joiner: str) -> str:
    return f"{_de_int_to_words(int(whole))} {joiner} {_de_digits_to_words(part)}"


def _de_currency_scale(match: re.Match) -> str:
    amount, scale = match.group(1), match.group(2)
    if "," in amount:
        phrase = _de_fraction(*amount.split(",", 1), "Komma")
    else:
        phrase = _de_before_noun(int(amount))
    return f"{phrase} {scale} Dollar"


def _de_currency_cents(match: re.Match) -> str:
    cents = int(match.group(2).ljust(2, "0")[:2])
    dollars = int(match.group(1))
    if dollars == 0 and cents:
        return f"{_de_before_noun(cents)} Cent"
    phrase = _de_money(dollars)
    if cents:
        phrase += f" und {_de_before_noun(cents)} Cent"
    return phrase


def _de_decade(match: re.Match) -> str:
    """`1970er` -> "neunzehnhundertsiebziger", `40er` -> "vierziger". Appending
    the suffix to the German cardinal is the whole rule: "vierzig" + "er" and
    "neunzehnhundertsiebzig" + "er" are both already the right word. A decade
    reads its number as a YEAR, so this cannot simply run after the year pass."""
    digits = match.group(1)
    phrase = (_de_year_phrase(int(digits)) if _DE_YEAR_ONLY_RE.fullmatch(digits)
              else _de_number_phrase(digits))
    return phrase + "er"


def _de_percent(match: re.Match) -> str:
    amount = match.group(1)
    if "," in amount:
        return _de_fraction(*amount.split(",", 1), "Komma") + " Prozent"
    return f"{_de_before_noun(_de_int(amount))} Prozent"


def normalize_de_for_speech(text: str) -> str:
    """German translated text -> German spoken form.

    The pass order is the shared one: currency and percentages claim their
    digits first, decimals before integers, years before the bare integer pass.
    German adds no ordering of its own -- it has no hyphen-suffix construction
    like Swedish's `1960-talet` and no dotted abbreviation like `m.fl.`, both
    checked for rather than assumed.

    **ORDINALS ARE NOT HANDLED, deliberately.** German marks one with a trailing
    dot -- `20. Jahrhundert`, `26. März`, `42. Straße` -- and reading it takes
    declension ("zwanzigsten", not "zwanzig"), the same ordinal-stem system
    Hungarian's `42-ik` was denied at two occurrences. It is also strictly
    harder than Hungarian's: that dot is indistinguishable from a sentence-final
    period before a capitalised German noun, and German capitalises every noun.
    A rule would have to settle sentence segmentation first. The numeral is read
    correctly and its ending is missing, which is a stray syllable rather than a
    wrong value -- the same standard applied to Hungarian's spaced hyphen.
    """
    out = _restore_leading_zero(text)
    # Abbreviations first, before any dot rule can look at their full stops --
    # the same ordering Swedish's `m.fl.` needs.
    for pattern, expansion in _DE_ABBREVIATIONS:
        out = pattern.sub(expansion, out)
    out = _DE_CURRENCY_SCALE_RE.sub(_de_currency_scale, out)
    out = _DE_CURRENCY_CENTS_RE.sub(_de_currency_cents, out)
    out = _DE_CURRENCY_SIGN_RE.sub(lambda m: _de_money(_de_int(m.group(1))), out)
    out = _DE_PERCENT_RE.sub(_de_percent, out)
    out = _DE_COMMA_DECIMAL_RE.sub(
        lambda m: _de_fraction(m.group(1), m.group(2), "Komma"), out)
    out = _DE_SECTION_DOT_RE.sub(
        lambda m: _de_fraction(m.group(1), m.group(2), "Punkt"), out)
    out = _DE_DECADE_RE.sub(_de_decade, out)
    out = _DE_YEAR_RE.sub(lambda m: _de_year_phrase(int(m.group(0))), out)
    out = _DE_INTEGER_RE.sub(lambda m: _de_number_phrase(m.group(0)), out)
    return _cleanup(out)


# ---------------------------------------------------------------------------
# Portuguese (LT-217), BRAZILIAN: the en-pt export writes "colônias" and "US$",
# so the voice gets Brazilian forms (dezesseis, bilhão) rather than European
# ones (dezasseis, mil milhões). Measured on 146 corpus sentences translated one
# at a time by Douglasrambo/opus-mt-tc-big-en-pt-onnx, the only en-pt ONNX
# export transformers.js can load; there is no deployed pt track to count over.
# ---------------------------------------------------------------------------

_PT_ONES = [
    "zero", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito",
    "nove", "dez", "onze", "doze", "treze", "catorze", "quinze", "dezesseis",
    "dezessete", "dezoito", "dezenove",
]
_PT_TENS = {2: "vinte", 3: "trinta", 4: "quarenta", 5: "cinquenta",
            6: "sessenta", 7: "setenta", 8: "oitenta", 9: "noventa"}
# 100 alone is "cem"; 101-199 take "cento". Every other hundred is one word.
_PT_HUNDREDS = {1: "cento", 2: "duzentos", 3: "trezentos", 4: "quatrocentos",
                5: "quinhentos", 6: "seiscentos", 7: "setecentos",
                8: "oitocentos", 9: "novecentos"}


def _pt_under_thousand(value: int) -> str:
    if value == 100:
        return "cem"
    hundreds, rest = divmod(value, 100)
    parts = [_PT_HUNDREDS[hundreds]] if hundreds else []
    if rest >= 20:
        tens, ones = divmod(rest, 10)
        parts.append(_PT_TENS[tens])
        if ones:
            parts.append(_PT_ONES[ones])
    elif rest or not parts:
        parts.append(_PT_ONES[rest])
    # Every part is joined with "e": cento e vinte e um.
    return " e ".join(parts)


def _pt_takes_e(rest: int) -> bool:
    """Whether "e" joins a scale word to what follows it. Only before a single
    group that is under 100 or a round hundred: "mil e duzentos", "dois mil e
    dezenove", but "mil duzentos e cinquenta"."""
    while rest and rest % 1000 == 0:
        rest //= 1000
    return rest < 100 or (rest < 1000 and rest % 100 == 0)


def _pt_int_to_words(value: int) -> str:
    if value < 0:
        return "menos " + _pt_int_to_words(-value)
    # Short scale, as in Brazil: bilhão is 10^9.
    for limit, singular, plural in ((1_000_000_000_000, "trilhão", "trilhões"),
                                    (1_000_000_000, "bilhão", "bilhões"),
                                    (1_000_000, "milhão", "milhões"),
                                    (1_000, "mil", "mil")):
        if value >= limit:
            head, rest = divmod(value, limit)
            if limit == 1_000:
                # "mil", never "um mil".
                word = "mil" if head == 1 else f"{_pt_int_to_words(head)} mil"
            else:
                word = f"um {singular}" if head == 1 else f"{_pt_int_to_words(head)} {plural}"
            if not rest:
                return word
            return word + (" e " if _pt_takes_e(rest) else " ") + _pt_int_to_words(rest)
    return _pt_under_thousand(value)


def _pt_digits_to_words(digits: str) -> str:
    return " ".join(_PT_ONES[int(d)] for d in digits)


def _pt_number_phrase(token: str) -> str:
    digits = re.sub(r"[.,]", "", token)
    if digits == token and (len(digits) >= _IDENTIFIER_DIGITS
                            or (len(digits) > 1 and digits[0] == "0")):
        return _pt_digits_to_words(digits)
    return _pt_int_to_words(int(digits))


# Thousands are a DOT, and the one leaked English COMMA group measured
# ("$1,250" -> "1,250 dólares") reads as a group too. A group is exactly three
# digits after a 1-3 digit head that does not start with 0, which keeps "1.3",
# "0,5" and "12,50" out of it. The cost, recorded: a three-place decimal such as
# "3,141" would read as a thousand; en-pt wrote none, every decimal measured
# had one or two places. The space group ("1 250") appeared only in BATCHED
# output, which the browser never runs (src/translate.worker.mjs), so it has no
# rule.
_PT_GROUPED = r"[1-9]\d{0,2}(?:\.\d{3})+(?!\d)|[1-9]\d{0,2}(?:,\d{3})+(?!\d)"
_PT_GROUPED_RE = re.compile(rf"\b(?:{_PT_GROUPED})")
# A whole part, grouped or not. With a decimal after it, "1.250,50" (or the
# leaked "1,250.50") is ONE amount: read apart, the head became a number and
# the ",50" was left behind.
_PT_WHOLE = rf"(?:{_PT_GROUPED}|\d+)"
# The English form leaks through as well: "1,250.5", its dot the decimal.
_PT_EN_DECIMAL = r"[1-9]\d{0,2}(?:,\d{3})+\.\d+"
_PT_GROUPED_DECIMAL_RE = re.compile(
    r"\b([1-9]\d{0,2}(?:\.\d{3})+),(\d+)\b|\b([1-9]\d{0,2}(?:,\d{3})+)\.(\d+)\b")
_PT_COMMA_DECIMAL_RE = re.compile(r"\b(\d+),(\d+)\b")
# A short dot is KEPT from English, as in German: "Tabela 1.3", "3.14", "2.0".
_PT_SECTION_DOT_RE = re.compile(r"\b(\d+)\.(\d{1,2})(?!\d)")
_PT_INTEGER_RE = re.compile(r"\b\d+\b")
_PT_AMOUNT = rf"(?:{_PT_EN_DECIMAL}|(?:{_PT_GROUPED}|\d+)(?:,\d+)?)"

# The sign was measured three ways: "US$ 3 milhões", "US $" and a bare "$".
_PT_SIGN = r"(?:\bUS\s?)?\$\s?"
_PT_SCALE = r"(?:milhão|milhões|bilhão|bilhões|trilhão|trilhões)"
# An English dot before a scale ("US$ 1.5 bilhão") is a decimal, read as a comma.
_PT_CURRENCY_SCALE_RE = re.compile(
    rf"{_PT_SIGN}(\d+(?:,\d+|\.\d{{1,2}}(?!\d))?)\s+({_PT_SCALE})\b")
# Cents after a sign, with either mark: "US$ 12,50", or English "$3.50".
_PT_CURRENCY_CENTS_RE = re.compile(
    rf"{_PT_SIGN}({_PT_WHOLE})[.,](\d{{1,2}})(?!\d)(?!\s+{_PT_SCALE}\b)")
_PT_CURRENCY_SIGN_RE = re.compile(rf"{_PT_SIGN}({_PT_GROUPED}|\d+)")
# And spelled out after the amount: "12,50 dólares", or English "1,250.50 dólares".
_PT_CURRENCY_WORD_RE = re.compile(rf"\b({_PT_WHOLE})[.,](\d{{1,2}})\s+dólares\b")
_PT_PERCENT_RE = re.compile(rf"\b({_PT_AMOUNT})\s?%")
# en-pt kept "et al." three times in four; the voice would read the Latin.
_PT_ET_AL_RE = re.compile(r"\bet\s+al\.")


def _pt_amount(amount: str) -> str:
    if re.fullmatch(_PT_EN_DECIMAL, amount):
        whole, part = amount.rsplit(".", 1)
        return _pt_fraction(whole.replace(",", ""), part, "vírgula")
    if re.fullmatch(_PT_GROUPED, amount) or "," not in amount:
        return _pt_number_phrase(amount)
    whole, part = amount.rsplit(",", 1)
    return _pt_fraction(whole.replace(".", ""), part, "vírgula")


def _pt_money(value: int) -> str:
    """A whole scale word takes "de": "um milhão de dólares", "mil dólares"."""
    words = _pt_int_to_words(value)
    if re.search(rf"{_PT_SCALE}$", words):
        return f"{words} de dólares"
    return f"{words} {'dólar' if value == 1 else 'dólares'}"


def _pt_currency_scale(match: re.Match) -> str:
    return f"{_pt_amount(match.group(1).replace('.', ',', 1))} {match.group(2)} de dólares"


def _pt_currency_cents(match: re.Match) -> str:
    dollars = int(re.sub(r"[.,]", "", match.group(1)))
    cents = int(match.group(2).ljust(2, "0"))
    centavos = f"{_pt_int_to_words(cents)} {'centavo' if cents == 1 else 'centavos'}"
    if dollars == 0 and cents:
        return centavos
    return _pt_money(dollars) + (f" e {centavos}" if cents else "")


def _pt_fraction(whole: str, part: str, joiner: str) -> str:
    return f"{_pt_int_to_words(int(whole))} {joiner} {_pt_digits_to_words(part)}"


def normalize_pt_for_speech(text: str) -> str:
    """Portuguese translated text -> Brazilian Portuguese spoken form."""
    out = _restore_leading_zero(text)
    out = _PT_ET_AL_RE.sub("e outros", out)
    # Currency and percentages claim their digits first, as in every language.
    out = _PT_CURRENCY_SCALE_RE.sub(_pt_currency_scale, out)
    out = _PT_CURRENCY_CENTS_RE.sub(_pt_currency_cents, out)
    out = _PT_CURRENCY_SIGN_RE.sub(lambda m: _pt_money(int(re.sub(r"[.,]", "", m.group(1)))), out)
    out = _PT_CURRENCY_WORD_RE.sub(_pt_currency_cents, out)
    out = _PT_PERCENT_RE.sub(lambda m: _pt_amount(m.group(1)) + " por cento", out)
    out = _PT_GROUPED_DECIMAL_RE.sub(
        lambda m: _pt_fraction(re.sub(r"[.,]", "", m.group(1) or m.group(3)),
                               m.group(2) or m.group(4), "vírgula"), out)
    # Groups before the comma decimal, so "1,250" is never "um vírgula dois...".
    out = _PT_GROUPED_RE.sub(lambda m: _pt_number_phrase(m.group(0)), out)
    out = _PT_COMMA_DECIMAL_RE.sub(
        lambda m: _pt_fraction(m.group(1), m.group(2), "vírgula"), out)
    out = _PT_SECTION_DOT_RE.sub(
        lambda m: _pt_fraction(m.group(1), m.group(2), "ponto"), out)
    out = _PT_INTEGER_RE.sub(lambda m: _pt_number_phrase(m.group(0)), out)
    return _cleanup(out)


# Keyed by the same ISO 639-1 codes as pipeline.languages.TARGETS. A code that is
# absent is not an error: `NORMALIZERS.get(code, lambda t: t)` is how callers
# look one up, so a language without a normaliser yet behaves exactly as it did
# before this module existed.
#
# Since LT-217 Listen mode translates into es, fr, de and pt only, the
# languages Phonon can speak; the other normalisers were removed with their
# tracks. A code missing here gets identity.
NORMALIZERS: dict[str, Callable[[str], str]] = {
    "es": normalize_es_for_speech,
    "fr": normalize_fr_for_speech,
    "de": normalize_de_for_speech,
    "pt": normalize_pt_for_speech,
}
