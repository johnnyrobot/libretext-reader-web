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
stubborn Latin abbreviation, and Supertonic will read every one of them wrong.

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
# Italian. The THIRD language, and the first to invert BOTH marks relative to
# English. The en-it checkpoint was measured before any rule below was written:
#
#     $1,200    -> "$ 1.200"      DOT thousands, sign LEADING with a space
#     $15.50    -> "$ 15,50"      decimal COMMA
#     $2.5 mil  -> "2,5 milioni di dollari"
#     68%       -> "68%"          NO space before the sign (French has one)
#     p = 0.05  -> "p  0,05"      decimal COMMA (and the `=` is dropped)
#     25,000    -> "25.000"       DOT thousands
#     1970s     -> "anni '70"
#     et al.    -> "et al."       preserved
#     406-412   -> "406-412"      preserved, no collapse
#     1st/2nd   -> "il primo"/"il secondo"   already spelled out
#
# So in Italian a DOT is a thousands group and a COMMA is a decimal -- the exact
# inverse of English on both marks, where Spanish preserved the English forms and
# French inverted only one. Reading either mark the English way gives a wrong
# VALUE, the worst defect class this pipeline tracks.
#
# THE HARD PART is that the dot is ambiguous WITHIN Italian, which neither
# previous language had to face. "1.200" is twelve hundred; "7.5" in "Figura 7.5"
# is a section number; "2.0" in "CC BY 2.0" is a version. Only GROUP SIZE tells
# them apart -- a thousands group is ALWAYS exactly three digits -- which is the
# same guard the Spanish pass applies to commas, pointed at the other mark.
#
# That guard is not a refinement, it is the main event, and the priority is the
# opposite of what a port would assume. Measured across the 9,423 shipped Italian
# sentences: the 1-2 digit dot form occurs 335 times (61 of them CC licence
# codes, the rest Figure/Table numbers) against 20 real thousands groups. Reading
# a dot as thousands unconditionally corrupts 335 readings to fix 20.
#
# `et al.` gets NO rule, measured rather than omitted: it survives intact 100
# times out of 100, and it is the correct form in Italian academic prose. The
# Spanish rule exists because the en-es checkpoint was measured mangling it.
#
# Italian writes a whole number as ONE word ("millenovecentonovantatré"), which is
# standard orthography and what an Italian-trained G2P will have seen. French and
# Spanish space theirs because those languages do.
# ---------------------------------------------------------------------------

_IT_ONES = [
    "zero", "uno", "due", "tre", "quattro", "cinque", "sei", "sette", "otto",
    "nove", "dieci", "undici", "dodici", "tredici", "quattordici", "quindici",
    "sedici", "diciassette", "diciotto", "diciannove",
]
_IT_TENS = {2: "venti", 3: "trenta", 4: "quaranta", 5: "cinquanta",
            6: "sessanta", 7: "settanta", 8: "ottanta", 9: "novanta"}


def _it_under_hundred(value: int) -> str:
    if value < 20:
        return _IT_ONES[value]
    tens, ones = divmod(value, 10)
    head = _IT_TENS[tens]
    if ones == 0:
        return head
    # The tens ELIDE their final vowel before the two vowel-initial ones:
    # ventuno and ventotto, never "ventiuno"/"ventiotto". Nothing in Spanish or
    # French does this, so it is the first thing a port gets wrong.
    if ones in (1, 8):
        head = head[:-1]
    # "tre" takes an accent as the final element of a compound: ventitre\u0301.
    return head + ("tré" if ones == 3 else _IT_ONES[ones])


def _it_under_thousand(value: int) -> str:
    if value < 100:
        return _it_under_hundred(value)
    hundreds, rest = divmod(value, 100)
    # "cento" is INVARIABLE -- duecento, never "duecenti" -- and one hundred is
    # bare "cento", never "unocento".
    head = "cento" if hundreds == 1 else _IT_ONES[hundreds] + "cento"
    if rest == 0:
        return head
    tail = _it_under_hundred(rest)
    # cento drops its own final o before a tail that starts with one:
    # centottanta, not "centoottanta".
    if tail.startswith("o"):
        head = head[:-1]
    return head + tail


def _it_int_to_words(value: int) -> str:
    if value < 0:
        return "meno " + _it_int_to_words(-value)
    if value >= 1_000_000:
        millions, rest = divmod(value, 1_000_000)
        head = "un milione" if millions == 1 else f"{_it_int_to_words(millions)} milioni"
        return head + (f" {_it_int_to_words(rest)}" if rest else "")
    if value >= 1_000:
        thousands, rest = divmod(value, 1_000)
        # Singular "mille", plural "-mila", and the plural fuses onto whatever
        # precedes it: ventunomila, quarantamila.
        head = "mille" if thousands == 1 else _it_under_thousand(thousands) + "mila"
        return head + (_it_under_thousand(rest) if rest else "")
    return _it_under_thousand(value)


def _it_digits_to_words(digits: str) -> str:
    return " ".join(_IT_ONES[int(d)] for d in digits)


def _it_int(token: str) -> int:
    """An Italian integer token, with its DOT thousands separators removed."""
    return int(token.replace(".", ""))


def _it_apocopate(phrase: str) -> str:
    """"uno" loses its final vowel before a noun: un dollaro, ventun dollari."""
    if phrase == "uno":
        return "un"
    return phrase[:-1] if phrase.endswith("uno") else phrase


def _it_number_phrase(token: str) -> str:
    digits = token.replace(".", "")
    # Same two identifier tells as the Spanish and French passes: an ungrouped
    # run this long is a DOI tail or a collapsed page range, and a leading zero
    # is deleted outright by a cardinal reading.
    if "." not in token and (len(digits) >= _IDENTIFIER_DIGITS
                             or (len(digits) > 1 and digits[0] == "0")):
        return _it_digits_to_words(digits)
    return _it_int_to_words(int(digits))


# A grouped thousand: 1-3 digits, then one or more DOT-separated groups of
# EXACTLY three. The exactness is the entire guard that keeps "Figura 7.5" and
# "CC BY 2.0" out -- see the measurement block above.
_IT_GROUPED = r"\d{1,3}(?:\.\d{3})+(?!\d)"
_IT_AMOUNT = rf"(?:{_IT_GROUPED}|\d+)(?:,\d+)?"

# A scale word after a currency amount means the comma is a DECIMAL inside a
# scaled quantity, not a cents separator. "$ 8,3 trilioni" read as dollars and
# cents gives "otto dollari e trenta centesimi trilioni" -- $8.30, not $8.3
# trillion, which is a wrong VALUE. One occurrence in 9,423 sentences; the rule
# is earned by the severity of the failure, not its frequency.
_IT_SCALE = (r"(?:mila|milione|milioni|miliardo|miliardi|"
             r"bilione|bilioni|trilione|trilioni)")
_IT_CURRENCY_SCALE_RE = re.compile(rf"\$\s?(\d+(?:,\d+)?)\s+({_IT_SCALE})\b")
# The cents form, refused when a scale word follows -- see above.
_IT_CURRENCY_CENTS_RE = re.compile(rf"\$\s?(\d+),(\d{{1,2}})(?!\d)(?!\s+{_IT_SCALE}\b)")
_IT_CURRENCY_SIGN_RE = re.compile(rf"\$\s?({_IT_GROUPED}|\d+)")
_IT_PERCENT_RE = re.compile(rf"\b({_IT_AMOUNT})\s?%")
_IT_COMMA_DECIMAL_RE = re.compile(r"\b(\d+),(\d+)\b")
# A dot group of ONE OR TWO digits: a section number, a figure number or a
# version, never a thousand. 335 occurrences against 20 real thousands groups.
_IT_SECTION_DOT_RE = re.compile(r"\b(\d+)\.(\d{1,2})(?!\d)")
_IT_YEAR_RE = re.compile(r"\b(?:1[5-9]\d{2}|20\d{2})\b")
_IT_INTEGER_RE = re.compile(rf"\b(?:{_IT_GROUPED}|\d+)\b")


def _it_money(value: int) -> str:
    return _it_apocopate(_it_int_to_words(value)) + (
        " dollaro" if value == 1 else " dollari")


def _it_currency_scale(match: re.Match) -> str:
    """`$ 8,3 trilioni` -> "otto virgola tre trilioni di dollari". The shape
    mirrors what the checkpoint itself writes for the unsigned form, which it
    renders as "2,5 milioni di dollari"."""
    amount, scale = match.group(1), match.group(2)
    if "," in amount:
        whole, part = amount.split(",", 1)
        phrase = _it_fraction(whole, part, "virgola")
    else:
        phrase = _it_int_to_words(int(amount))
    return f"{phrase} {scale} di dollari"


def _it_currency_cents(match: re.Match) -> str:
    """`$ 15,50` -- dollars-and-cents structure, not a decimal read, for the same
    reason the Spanish and French passes do it: "quindici virgola cinque zero
    dollari" is not how anyone says a price."""
    cents = int(match.group(2).ljust(2, "0")[:2])
    phrase = _it_money(int(match.group(1)))
    if cents:
        phrase += " e " + _it_apocopate(_it_int_to_words(cents)) + (
            " centesimo" if cents == 1 else " centesimi")
    return phrase


def _it_fraction(whole: str, part: str, joiner: str) -> str:
    return f"{_it_int_to_words(int(whole))} {joiner} {_it_digits_to_words(part)}"


def normalize_it_for_speech(text: str) -> str:
    """Italian translated text -> Italian spoken form.

    Pass order is load-bearing, and one ordering is specific to Italian: the
    SECTION-DOT pass must run before the integer pass but can run in any order
    relative to the grouped-thousand pass, because the two regexes are made
    mutually exclusive by group size rather than by sequence. Relying on order
    there would be a latent bug the day someone reorders these lines.

    Currency is claimed first, as in the other two languages, or `$ 15,50`
    becomes a decimal that happens to sit beside a dollar sign.
    """
    out = _IT_CURRENCY_SCALE_RE.sub(_it_currency_scale, _restore_leading_zero(text))
    out = _IT_CURRENCY_CENTS_RE.sub(_it_currency_cents, out)
    out = _IT_CURRENCY_SIGN_RE.sub(lambda m: _it_money(_it_int(m.group(1))), out)
    out = _IT_PERCENT_RE.sub(
        lambda m: f"{_it_number_phrase(m.group(1))} per cento"
        if "," not in m.group(1) else
        _it_fraction(*m.group(1).split(","), "virgola") + " per cento", out)
    out = _IT_COMMA_DECIMAL_RE.sub(
        lambda m: _it_fraction(m.group(1), m.group(2), "virgola"), out)
    out = _IT_SECTION_DOT_RE.sub(
        lambda m: _it_fraction(m.group(1), m.group(2), "punto"), out)
    out = _IT_YEAR_RE.sub(lambda m: _it_int_to_words(int(m.group(0))), out)
    out = _IT_INTEGER_RE.sub(lambda m: _it_number_phrase(m.group(0)), out)
    return _cleanup(out)


# ---------------------------------------------------------------------------
# Dutch. The FOURTH language, and the fourth distinct convention in four tries.
# The en-nl checkpoint was measured on the deployed corpus before any rule below
# was written (bench/formats/measure.py, 2026-08-27):
#
#     8,000     -> "8.000"        DOT thousands, 14 of 15
#     100,000   -> "100.000"
#     $50       -> "$50"          sign LEADING, tight
#     $400 bil  -> "$ 400 miljard"  sign LEADING, spaced -- both forms occur
#     $8.3 tril -> "$8,3 triljoen"  decimal COMMA inside a scaled amount
#     $1.00     -> "$1,00"        decimal COMMA in cents
#     Figure 1.3-> "Figuur 1.3"   decimal DOT preserved
#     CC BY 2.0 -> "CC BY 2.0"    decimal DOT preserved
#     20%       -> "20%"          NO space before the sign, 58 of 58
#     et al.    -> "et al."       preserved 59 of 60, so NO rule
#
# So Dutch takes ITALIAN's dot thousands and keeps ENGLISH's dot decimal at the
# same time. No previous language had one mark doing two jobs:
#
#     es  dot = decimal            comma = thousands   (English forms kept)
#     fr  comma = decimal          space = thousands
#     it  comma = decimal          dot   = thousands
#     nl  dot = decimal AND dot = thousands            <- both, same mark
#
# GROUP SIZE is therefore not a refinement here, it is the only thing that tells
# a thousand from a section number: a thousands group is ALWAYS exactly three
# digits. MEASURED on the 9,430-sentence deployed corpus translated by this
# checkpoint: the 1-2 digit dot form occurs 281 times (55 of them CC licence
# codes, the rest Figure/Table numbers) against 19 real thousands groups.
# Reading a dot as thousands unconditionally corrupts 281 readings to fix 19 --
# the same ratio Italian measured (335 against 20), arrived at independently.
#
# Two things a port from any earlier language gets wrong:
#
#   * Dutch puts the UNIT BEFORE THE TEN and joins with "en" -- eenentwintig,
#     not "twintig een" -- and a unit ending in -e takes a trema on that joint
#     (tweeentwintig would read as one long vowel, so it is tweeentwintig with
#     a diaeresis: tweeëntwintig).
#   * Dutch reads a YEAR BY HUNDREDS, like English: 1961 is
#     "negentienhonderdeenenzestig". es, fr and it all read a year as a plain
#     cardinal, and porting that rule gives "duizend negenhonderdeenenzestig",
#     which is a date nobody says. From 2000 the plain cardinal takes over.
# ---------------------------------------------------------------------------

_NL_ONES = [
    "nul", "een", "twee", "drie", "vier", "vijf", "zes", "zeven", "acht",
    "negen", "tien", "elf", "twaalf", "dertien", "veertien", "vijftien",
    "zestien", "zeventien", "achttien", "negentien",
]
_NL_TENS = {2: "twintig", 3: "dertig", 4: "veertig", 5: "vijftig",
            6: "zestig", 7: "zeventig", 8: "tachtig", 9: "negentig"}


def _nl_under_hundred(value: int) -> str:
    if value < 20:
        return _NL_ONES[value]
    tens, ones = divmod(value, 10)
    if ones == 0:
        return _NL_TENS[tens]
    unit = _NL_ONES[ones]
    # "twee" + "en" would spell "tweeen", where the three vowels read as one
    # long sound. Dutch marks the boundary with a diaeresis instead.
    joint = "ën" if unit.endswith("e") else "en"
    return unit + joint + _NL_TENS[tens]


def _nl_under_thousand(value: int) -> str:
    if value < 100:
        return _nl_under_hundred(value)
    hundreds, rest = divmod(value, 100)
    # One hundred is bare "honderd", never "eenhonderd", and the whole
    # sub-thousand number is written as ONE word.
    head = "honderd" if hundreds == 1 else _NL_ONES[hundreds] + "honderd"
    return head + (_nl_under_hundred(rest) if rest else "")


def _nl_int_to_words(value: int) -> str:
    if value < 0:
        return "min " + _nl_int_to_words(-value)
    # Standalone, the numeral one is "een" -- which is also the indefinite
    # article. Dutch disambiguates it with accents, and this module only ever
    # emits numerals, so the accented form is the correct one here. Compounds
    # (eenentwintig, honderdeen) are built from the bare table entry and are
    # deliberately not touched.
    if value == 1:
        return "één"
    if value >= 1_000_000_000:
        billions, rest = divmod(value, 1_000_000_000)
        head = f"{_nl_int_to_words(billions)} miljard"
        return head + (f" {_nl_int_to_words(rest)}" if rest else "")
    if value >= 1_000_000:
        millions, rest = divmod(value, 1_000_000)
        head = f"{_nl_int_to_words(millions)} miljoen"
        return head + (f" {_nl_int_to_words(rest)}" if rest else "")
    if value >= 1_000:
        thousands, rest = divmod(value, 1_000)
        # The multiplier FUSES onto "duizend" (tweeduizend, twintigduizend) but
        # the remainder is a separate word: "tweeduizend vijfhonderd".
        head = "duizend" if thousands == 1 else _nl_under_thousand(thousands) + "duizend"
        return head + (f" {_nl_under_thousand(rest)}" if rest else "")
    return _nl_under_thousand(value)


def _nl_digits_to_words(digits: str) -> str:
    return " ".join(_NL_ONES[int(d)] for d in digits)


def _nl_year_phrase(value: int) -> str:
    """A year below 2000 is read BY HUNDREDS, as in English and unlike es/fr/it.

    1961 -> negentienhonderdeenenzestig, 1900 -> negentienhonderd. From 2000 the
    hundreds reading stops being how anyone says it ("twintig tien" is not a
    year in Dutch), so the plain cardinal takes over.
    """
    if value >= 2000:
        return _nl_int_to_words(value)
    hundreds, rest = divmod(value, 100)
    return (_nl_under_hundred(hundreds) + "honderd"
            + (_nl_under_hundred(rest) if rest else ""))


def _nl_int(token: str) -> int:
    """A Dutch integer token, with its DOT thousands separators removed."""
    return int(token.replace(".", ""))


def _nl_number_phrase(token: str) -> str:
    digits = token.replace(".", "")
    # The same two identifier tells as every other language here: an ungrouped
    # run this long is a DOI tail or a collapsed page range, and a leading zero
    # is deleted outright by a cardinal reading.
    if "." not in token and (len(digits) >= _IDENTIFIER_DIGITS
                             or (len(digits) > 1 and digits[0] == "0")):
        return _nl_digits_to_words(digits)
    return _nl_int_to_words(int(digits))


# A grouped thousand: 1-3 digits then one or more DOT-separated groups of
# EXACTLY three. That exactness is the whole guard separating "8.000" from
# "Figuur 7.5" and "CC BY 2.0" -- see the measurement block above.
_NL_GROUPED = r"\d{1,3}(?:\.\d{3})+(?!\d)"
_NL_AMOUNT = rf"(?:{_NL_GROUPED}|\d+)(?:,\d+)?"

# A scale word after a currency amount means the comma is a DECIMAL inside a
# scaled quantity, not a cents separator. Italian shipped this bug and it was
# caught only by running the finished pass over the whole track: "$8,3 triljoen"
# read as dollars-and-cents gives $8.30 for $8.3 trillion, a wrong VALUE.
_NL_SCALE = r"(?:duizend|miljoen|miljard|biljoen|triljoen)"
_NL_CURRENCY_SCALE_RE = re.compile(rf"\$\s?(\d+(?:,\d+)?)\s+({_NL_SCALE})\b")
_NL_CURRENCY_CENTS_RE = re.compile(rf"\$\s?(\d+),(\d{{1,2}})(?!\d)(?!\s+{_NL_SCALE}\b)")
_NL_CURRENCY_SIGN_RE = re.compile(rf"\$\s?({_NL_GROUPED}|\d+)")
_NL_PERCENT_RE = re.compile(rf"\b({_NL_AMOUNT})\s?%")
_NL_COMMA_DECIMAL_RE = re.compile(r"\b(\d+),(\d+)\b")
# A dot group of ONE OR TWO digits: a section number, a figure number or a
# version, never a thousand.
_NL_SECTION_DOT_RE = re.compile(r"\b(\d+)\.(\d{1,2})(?!\d)")
_NL_YEAR_RE = re.compile(r"\b(?:1[5-9]\d{2}|20\d{2})\b")
_NL_INTEGER_RE = re.compile(rf"\b(?:{_NL_GROUPED}|\d+)\b")


def _nl_money(value: int) -> str:
    """Dutch keeps a measure word SINGULAR after a numeral -- "vijftig dollar",
    never "vijftig dollars". Every Romance language shipped here pluralises, so
    this is the line a port gets wrong without ever looking wrong."""
    return f"{_nl_int_to_words(value)} dollar"


def _nl_currency_scale(match: re.Match) -> str:
    amount, scale = match.group(1), match.group(2)
    if "," in amount:
        whole, part = amount.split(",", 1)
        phrase = _nl_fraction(whole, part, "komma")
    else:
        phrase = _nl_int_to_words(int(amount))
    return f"{phrase} {scale} dollar"


def _nl_currency_cents(match: re.Match) -> str:
    """`$15,50` is dollars-and-cents, not a decimal that happens to sit beside a
    dollar sign -- "vijftien komma vijf nul dollar" is not how a price is said.
    A zero cents part is dropped rather than read as "en nul cent".

    A zero DOLLARS part is dropped too, and that half was found by running the
    finished pass over the whole 9,430-sentence track rather than by any of the
    unit tests above: `$0,25` came out as "nul dollar en vijfentwintig cent".
    Not a wrong value, but nobody says it -- the price is "vijfentwintig cent".
    One occurrence in the book; the same whole-track check is what caught
    Italian's `$8,3 trilioni` wrong-VALUE bug, which is why it is a step and not
    an afterthought."""
    cents = int(match.group(2).ljust(2, "0")[:2])
    dollars = int(match.group(1))
    if dollars == 0 and cents:
        return f"{_nl_int_to_words(cents)} cent"
    phrase = _nl_money(dollars)
    if cents:
        phrase += f" en {_nl_int_to_words(cents)} cent"
    return phrase


def _nl_fraction(whole: str, part: str, joiner: str) -> str:
    return f"{_nl_int_to_words(int(whole))} {joiner} {_nl_digits_to_words(part)}"


def normalize_nl_for_speech(text: str) -> str:
    """Dutch translated text -> Dutch spoken form.

    Pass order is the same shape as the other three: currency claims its digits
    first or `$15,50` becomes a decimal beside a dollar sign, and the year pass
    runs before the integer pass because in Dutch the two genuinely DISAGREE --
    1961 is "negentienhonderdeenenzestig" as a year and "duizend
    negenhonderdeenenzestig" as a quantity. In es/fr/it the two agree and the
    ordering only decides which rule gets the credit; here it decides the words.
    """
    out = _NL_CURRENCY_SCALE_RE.sub(_nl_currency_scale, _restore_leading_zero(text))
    out = _NL_CURRENCY_CENTS_RE.sub(_nl_currency_cents, out)
    out = _NL_CURRENCY_SIGN_RE.sub(lambda m: _nl_money(_nl_int(m.group(1))), out)
    out = _NL_PERCENT_RE.sub(
        lambda m: f"{_nl_number_phrase(m.group(1))} procent"
        if "," not in m.group(1) else
        _nl_fraction(*m.group(1).split(","), "komma") + " procent", out)
    out = _NL_COMMA_DECIMAL_RE.sub(
        lambda m: _nl_fraction(m.group(1), m.group(2), "komma"), out)
    out = _NL_SECTION_DOT_RE.sub(
        lambda m: _nl_fraction(m.group(1), m.group(2), "punt"), out)
    out = _NL_YEAR_RE.sub(lambda m: _nl_year_phrase(int(m.group(0))), out)
    out = _NL_INTEGER_RE.sub(lambda m: _nl_number_phrase(m.group(0)), out)
    return _cleanup(out)


# ---------------------------------------------------------------------------
# Hungarian. The FIFTH language, and the first AGGLUTINATIVE one -- which is a
# different KIND of problem, not a harder version of the previous four. The
# en-hu checkpoint (the SMALL opus-mt-en-hu, which is what the browser ships;
# the gate is registered against tc-big, and the two are not the same model) was
# measured on the deployed corpus before any rule below was written:
#
#     8,000     -> "8000"          NO separator at four digits
#     20,000    -> "20 000"        SPACE separator from five
#     100,000   -> "100 000"
#     $50       -> "50 dollarert"  the sign is already gone, WORD + case suffix
#     $8.3 tril -> "8,3 trillio dollart"   decimal COMMA
#     Figure 1.3-> "1.3 abra"      decimal DOT preserved
#     20%       -> "20%-a"         percent sign carrying a HYPHENATED SUFFIX
#     99%       -> "99%-at"
#     2042      -> "2042-ig"       year carrying a HYPHENATED SUFFIX
#     et al.    -> "et al."        preserved 59 of 60, so NO rule
#
# The separator rules are correct Hungarian orthography and the checkpoint got
# them right on its own: no separator up to four digits, a space from five.
#
# THE NEW PROBLEM is the hyphen. Hungarian attaches case endings directly to a
# numeral written in digits, joined by a hyphen -- `20%-a`, `2042-ig`,
# `1990-ben`. Spelling the number out DELETES that hyphen and fuses the ending
# onto the word: "husz szazaleka", "ketezer-negyvenkettoig". Every earlier
# language could substitute a number in place; here the substitution has to
# carry a suffix across, and a pass that ignores the hyphen leaves "husz
# szazalek -a" -- a dangling morpheme read aloud as a word.
#
# The suffix is NOT generated, only re-attached. The checkpoint already chose its
# form (vowel harmony picked `-ben` over `-ban`, `-ot` over `-et`) for the
# digit's own reading, and every Hungarian numeral ends in a consonant or in
# `-o"`/`-o'`, so plain concatenation reproduces the correct written form.
# Two known imperfections, recorded rather than papered over: `1000-et` fuses to
# "ezeret" where Hungarian elides to "ezret", and "nulla" would need its final
# vowel lengthened. Neither is a wrong VALUE and neither occurs in this book.
#
# THE 2000 RULE decides where hyphens go INSIDE a number, and no other language
# here has anything like it: Hungarian writes a number as ONE word up to 2000,
# and from 2001 up separates the thousands group with a hyphen.
#
#     1999  ezerkilencszazkilencvenkilenc     one word
#     2000  ketezer                           one word
#     2042  ketezer-negyvenketto              hyphenated
#     40320 negyvenezer-haromszazhusz
#
# kettő/két is the one form choice this module makes rather than reads: "ketto"
# stands alone, "ket" goes before the noun it counts. Prose is almost always
# attributive, so the default is "ket" whenever a word follows, with the
# coordinating conjunctions excepted -- "2 es 3 kozott" is "ketto es harom",
# never "ket es harom".
# ---------------------------------------------------------------------------

_HU_ONES = ["nulla", "egy", "kettő", "három", "négy", "öt", "hat", "hét",
            "nyolc", "kilenc"]
_HU_TENS = {1: "tíz", 2: "húsz", 3: "harminc", 4: "negyven", 5: "ötven",
            6: "hatvan", 7: "hetven", 8: "nyolcvan", 9: "kilencven"}
# 11-19 and 21-29 do NOT reuse the bare tens word: it changes shape before a
# unit (tíz -> tizen-, húsz -> huszon-). 30 up is regular.
_HU_TEEN_STEMS = {1: "tizen", 2: "huszon"}
# The form a numeral takes as a MULTIPLIER of száz/ezer/millió. Only 2 differs.
_HU_MULTIPLIER = {2: "két"}
# A numeral standing before the noun it counts uses the attributive form.
_HU_ATTRIBUTIVE = {2: "két"}
# A numeral followed by one of these is in a LIST, not counting a noun, so the
# standalone form is right: "kettő és három", never "két és három".
_HU_CONJUNCTIONS = frozenset({"és", "vagy", "illetve", "meg", "valamint"})


def _hu_ones(value: int, attributive: bool) -> str:
    return _HU_ATTRIBUTIVE[value] if attributive and value in _HU_ATTRIBUTIVE \
        else _HU_ONES[value]


def _hu_under_hundred(value: int, attributive: bool = False) -> str:
    if value < 10:
        return _hu_ones(value, attributive)
    tens, ones = divmod(value, 10)
    if ones == 0:
        return _HU_TENS[tens]
    head = _HU_TEEN_STEMS.get(tens, _HU_TENS[tens])
    return head + _hu_ones(ones, attributive)


def _hu_under_thousand(value: int, attributive: bool = False) -> str:
    if value < 100:
        return _hu_under_hundred(value, attributive)
    hundreds, rest = divmod(value, 100)
    head = "száz" if hundreds == 1 else _hu_under_hundred(
        hundreds, attributive=True) + "száz"
    return head + (_hu_under_hundred(rest, attributive) if rest else "")


def _hu_int_to_words(value: int, attributive: bool = False) -> str:
    """The 2000 rule lives here: one word up to 2000, hyphenated above it.

    Written as `ezerkilencszázkilencvenkilenc` but `kétezer-negyvenkettő`. The
    threshold is the VALUE, not the number of digits, so 1999 and 2001 are
    spelled differently despite both being four digits.
    """
    if value < 0:
        return "mínusz " + _hu_int_to_words(-value, attributive)
    if value >= 1_000_000_000:
        head, rest = divmod(value, 1_000_000_000)
        word = _hu_under_thousand(head, attributive=True) + "milliárd"
        return word + (f"-{_hu_int_to_words(rest, attributive)}" if rest else "")
    if value >= 1_000_000:
        head, rest = divmod(value, 1_000_000)
        word = _hu_under_thousand(head, attributive=True) + "millió"
        return word + (f"-{_hu_int_to_words(rest, attributive)}" if rest else "")
    if value >= 1_000:
        thousands, rest = divmod(value, 1_000)
        head = "ezer" if thousands == 1 else _hu_under_thousand(
            thousands, attributive=True) + "ezer"
        if not rest:
            return head
        joiner = "-" if value > 2000 else ""
        return head + joiner + _hu_under_thousand(rest, attributive)
    return _hu_under_thousand(value, attributive)


def _hu_digits_to_words(digits: str) -> str:
    return " ".join(_HU_ONES[int(d)] for d in digits)


def _hu_int(token: str) -> int:
    """A Hungarian integer token, with its SPACE thousands separators removed."""
    return int(token.replace(" ", "").replace(" ", ""))


# A grouped thousand: 1-3 digits then one or more SPACE-separated groups of
# exactly three, as French does. Four-digit numbers are written solid in
# Hungarian and are matched by the plain integer pattern instead.
_HU_GROUPED = r"\d{1,3}(?:[  ]\d{3})+(?!\d)"
_HU_AMOUNT = rf"(?:{_HU_GROUPED}|\d+)(?:,\d+)?"
# A Hungarian word character, for the suffix captures below. The accented
# letters are LISTED rather than given as a range: `á-ű` spans most of Latin
# Extended-A and would match letters no Hungarian ending contains, and `\w`
# would drag in every script Python considers a word character.
_HU_WORD = r"[a-zA-ZáéíóöőúüűÁÉÍÓÖŐÚÜŰ]"

# The hyphenated-suffix forms, which must both run BEFORE their bare
# counterparts or the bare rule consumes the number and strands the ending.
_HU_PERCENT_SUFFIX_RE = re.compile(rf"({_HU_AMOUNT})\s?%-({_HU_WORD}+)")
_HU_PERCENT_RE = re.compile(rf"({_HU_AMOUNT})\s?%")
# The currency form CARRYING a suffix, which must be claimed before the bare
# one. `$30-os` reached by the bare rule becomes "harminc dollár" with "-os"
# stranded beside it -- this module's own two passes orphaning a morpheme
# between them, which is the exact defect the hyphen machinery exists to
# prevent. "harminc dolláros" is the reading, and the suffix lands on the NOUN
# rather than on the number, as Hungarian puts it.
_HU_CURRENCY_SUFFIX_RE = re.compile(rf"\$\s?({_HU_GROUPED}|\d+)-({_HU_WORD}+)")
_HU_CURRENCY_RE = re.compile(rf"\$\s?({_HU_GROUPED}|\d+)")
# A comma before EXACTLY three digits is an English thousands separator the
# checkpoint failed to localise, not a Hungarian decimal. MEASURED on the 9,430
# translated sentences: five commas between digits, four of them genuine 1-2
# digit decimals (0,25 / 8,3 / 14,4 / 28,5) and one leak -- `40,320`, which read
# as a decimal gives "negyven egész három kettő nulla", forty-point-three-two
# for forty thousand three hundred twenty. A wrong VALUE, the severity bar this
# module uses to earn a rule from a single occurrence.
_HU_COMMA_THOUSANDS_RE = re.compile(r"\b(\d{1,3}),(\d{3})(?!\d)")
# ...so the decimal rule is capped at two fractional digits, as the Spanish pass
# caps its own comma rule, and the two are mutually exclusive by group size.
_HU_COMMA_DECIMAL_RE = re.compile(r"\b(\d+),(\d{1,2})(?!\d)")
_HU_SECTION_DOT_RE = re.compile(r"\b(\d+)\.(\d{1,2})(?!\d)")
_HU_NUMBER_SUFFIX_RE = re.compile(rf"\b({_HU_GROUPED}|\d+)-({_HU_WORD}+)")
_HU_INTEGER_RE = re.compile(rf"\b(?:{_HU_GROUPED}|\d+)\b")


def _hu_fraction(whole: str, part: str, joiner: str) -> str:
    return f"{_hu_int_to_words(int(whole))} {joiner} {_hu_digits_to_words(part)}"


def _hu_number_phrase(token: str, attributive: bool = False) -> str:
    digits = token.replace(" ", "").replace(" ", "")
    # The same two identifier tells as every other language here.
    if " " not in token and (len(digits) >= _IDENTIFIER_DIGITS
                             or (len(digits) > 1 and digits[0] == "0")):
        return _hu_digits_to_words(digits)
    return _hu_int_to_words(int(digits), attributive)


def _hu_is_attributive(text: str, end: int) -> bool:
    """True when a word follows the number, so it is counting that word.

    The exception is a coordinating conjunction: a numeral before "és" is an
    item in a list, not a quantity, and takes the standalone form.
    """
    tail = text[end:]
    match = re.match(rf"[  ]+({_HU_WORD}+)", tail)
    return bool(match) and match.group(1).lower() not in _HU_CONJUNCTIONS


def _hu_integer(match: re.Match) -> str:
    return _hu_number_phrase(
        match.group(0), _hu_is_attributive(match.string, match.end()))


def normalize_hu_for_speech(text: str) -> str:
    """Hungarian translated text -> Hungarian spoken form.

    Pass order carries one requirement no earlier language had: BOTH suffixed
    forms must run before their bare counterparts. `20%-a` reached by the bare
    percent rule becomes "húsz százalék -a", leaving the case ending as a
    separate token the voice reads as a word.

    The section-dot pass runs before the number-suffix pass so that `1.3` is
    claimed as a section number first; a dot group and a hyphen suffix never
    overlap, but relying on that would be a latent bug the day someone reorders
    these lines.

    The comma-thousands pass rewrites the separator to the SPACE Hungarian
    actually uses, rather than deleting it or spelling the number itself, so a
    leaked `40,320` and a written `40 320` reach the speller by exactly the same
    path. Deleting it instead pushes `40320` past _IDENTIFIER_DIGITS and the
    number comes out read digit by digit -- "négy nulla három kettő nulla" --
    which is how the first version of this rule failed.

    NOT FIXED, and measured rather than missed: the checkpoint sometimes spaces
    the hyphen it should tighten -- `100% - ban`, `(1974) -ben` -- leaving the
    ending as a separate token. Two occurrences in 9,430 sentences, both inside
    sentences the checkpoint had already mangled, and the reading is a stray
    syllable rather than a wrong value. Catching them needs an allowlist of case
    endings, because a spaced hyphen is also how Hungarian writes a dash before
    an ordinary word ("80% - de ez..."), and gluing that word onto the numeral
    would be a worse defect than the one being fixed.
    """
    out = _HU_PERCENT_SUFFIX_RE.sub(
        lambda m: f"{_hu_number_phrase(m.group(1))} százalék{m.group(2)}"
        if "," not in m.group(1) else
        _hu_fraction(*m.group(1).split(","), "egész") + f" százalék{m.group(2)}",
        _restore_leading_zero(text))
    out = _HU_PERCENT_RE.sub(
        lambda m: f"{_hu_number_phrase(m.group(1))} százalék"
        if "," not in m.group(1) else
        _hu_fraction(*m.group(1).split(","), "egész") + " százalék", out)
    out = _HU_CURRENCY_SUFFIX_RE.sub(
        lambda m: f"{_hu_int_to_words(_hu_int(m.group(1)), attributive=True)} "
                  f"dollár{m.group(2)}", out)
    out = _HU_CURRENCY_RE.sub(
        lambda m: f"{_hu_int_to_words(_hu_int(m.group(1)), attributive=True)} dollár", out)
    out = _HU_COMMA_THOUSANDS_RE.sub(rf"\1 \2", out)
    out = _HU_COMMA_DECIMAL_RE.sub(
        lambda m: _hu_fraction(m.group(1), m.group(2), "egész"), out)
    out = _HU_SECTION_DOT_RE.sub(
        lambda m: _hu_fraction(m.group(1), m.group(2), "pont"), out)
    out = _HU_NUMBER_SUFFIX_RE.sub(
        lambda m: _hu_number_phrase(m.group(1)) + m.group(2), out)
    out = _HU_INTEGER_RE.sub(_hu_integer, out)
    return _cleanup(out)


# ---------------------------------------------------------------------------
# Danish. The SIXTH language. Its number FORMATS look exactly like Dutch's --
# dot thousands, dot decimal preserved, percent tight, `et al.` untouched --
# which is precisely the trap this file keeps re-learning, because the WORDS
# behind those formats are not portable at all. The en-da checkpoint was
# measured on the deployed corpus before any rule below was written:
#
#     8,000     -> "8.000"          DOT thousands, 14 of 15
#     $50       -> "50 dollars"     the sign is often already gone, WORD PLURAL
#     $30,000   -> "$ 30.000"       and when it survives, LEADING, tight or spaced
#     $8.3 tril -> "$8,3 billioner" decimal COMMA inside a scaled amount
#     Figure 1.3-> "figur 1.3"      decimal DOT preserved
#     20%       -> "20%"            NO space before the sign, 58 of 58
#     et al.    -> "et al."         preserved 60 of 60, so NO rule
#     20th c.   -> "det 20. arhundrede"   ORDINAL as digits plus a PERIOD
#
# THREE THINGS A PORT FROM DUTCH GETS WRONG, all measured rather than reasoned:
#
#   * The measure word is PLURAL. The checkpoint itself writes "50 dollars",
#     where Dutch writes "vijftig dollar". Dutch keeps a measure word singular
#     after a numeral and Danish does not, so the one language whose formats
#     match Dutch exactly is also the one whose currency rule inverts it.
#   * The TENS ARE VIGESIMAL from fifty up -- halvtreds, tres, halvfjerds, firs,
#     halvfems are "half-third", "third", "half-fourth", "fourth", "half-fifth"
#     SCORE. There is no derivation from the unit words; they are a table, and a
#     speller that composes tens from units is wrong for half the range.
#   * "og" joins a SUB-HUNDRED TAIL to whatever precedes it -- "fem hundrede og
#     tolv", "to tusind og toogfyrre" -- but not a hundreds tail: "to tusind fem
#     hundrede". One rule, and Dutch has no equivalent (it fuses everything).
#
# Shared with Dutch, and the reason both were worth checking: the unit comes
# BEFORE the ten (enogtyve, as tweeentwintig does) and a year below 2000 is read
# BY HUNDREDS ("nitten hundrede og enogtres"), with the plain cardinal taking
# over from 2000.
#
# The dot ambiguity is Dutch's, in the same shape: a dot is a thousands group
# when its group is EXACTLY three digits and a section or version number when it
# is one or two.
# ---------------------------------------------------------------------------

_DA_ONES = [
    "nul", "en", "to", "tre", "fire", "fem", "seks", "syv", "otte", "ni",
    "ti", "elleve", "tolv", "tretten", "fjorten", "femten", "seksten",
    "sytten", "atten", "nitten",
]
# Vigesimal from fifty: halvtreds/tres/halvfjerds/firs/halvfems are scores, not
# anything derivable from the unit words above.
_DA_TENS = {2: "tyve", 3: "tredive", 4: "fyrre", 5: "halvtreds",
            6: "tres", 7: "halvfjerds", 8: "firs", 9: "halvfems"}


def _da_under_hundred(value: int) -> str:
    if value < 20:
        return _DA_ONES[value]
    tens, ones = divmod(value, 10)
    if ones == 0:
        return _DA_TENS[tens]
    # Unit BEFORE the ten, joined by "og" -- enogtyve, never "tyveen". No vowel
    # change on the joint, unlike Dutch's trema.
    return f"{_DA_ONES[ones]}og{_DA_TENS[tens]}"


def _da_under_thousand(value: int) -> str:
    if value < 100:
        return _da_under_hundred(value)
    hundreds, rest = divmod(value, 100)
    # One hundred is bare "hundrede", never "en hundrede". The parts stay
    # separate words rather than fusing as Dutch's do.
    head = "hundrede" if hundreds == 1 else f"{_DA_ONES[hundreds]} hundrede"
    return head + (f" og {_da_under_hundred(rest)}" if rest else "")


def _da_int_to_words(value: int) -> str:
    """"og" joins a SUB-HUNDRED tail to whatever precedes it, and only that.

    "to tusind og toogfyrre" but "to tusind fem hundrede"; the hundreds level
    applies the same rule one step down, in _da_under_thousand.
    """
    if value < 0:
        return "minus " + _da_int_to_words(-value)
    for limit, singular, plural in ((1_000_000_000, "milliard", "milliarder"),
                                    (1_000_000, "million", "millioner")):
        if value >= limit:
            head, rest = divmod(value, limit)
            word = f"{_da_int_to_words(head)} {singular if head == 1 else plural}"
            if not rest:
                return word
            return word + (f" og {_da_under_hundred(rest)}" if rest < 100
                           else f" {_da_int_to_words(rest)}")
    if value >= 1_000:
        thousands, rest = divmod(value, 1_000)
        head = "tusind" if thousands == 1 else f"{_da_under_thousand(thousands)} tusind"
        if not rest:
            return head
        return head + (f" og {_da_under_hundred(rest)}" if rest < 100
                       else f" {_da_under_thousand(rest)}")
    return _da_under_thousand(value)


def _da_digits_to_words(digits: str) -> str:
    return " ".join(_DA_ONES[int(d)] for d in digits)


def _da_year_phrase(value: int) -> str:
    """A year below 2000 is read BY HUNDREDS, as in English and Dutch. From 2000
    the plain cardinal takes over -- "tyve ti" is not a year in Danish."""
    if value >= 2000:
        return _da_int_to_words(value)
    hundreds, rest = divmod(value, 100)
    return (f"{_da_under_hundred(hundreds)} hundrede"
            + (f" og {_da_under_hundred(rest)}" if rest else ""))


def _da_int(token: str) -> int:
    return int(token.replace(".", ""))


def _da_number_phrase(token: str) -> str:
    digits = token.replace(".", "")
    if "." not in token and (len(digits) >= _IDENTIFIER_DIGITS
                             or (len(digits) > 1 and digits[0] == "0")):
        return _da_digits_to_words(digits)
    return _da_int_to_words(int(digits))


_DA_GROUPED = r"\d{1,3}(?:\.\d{3})+(?!\d)"
_DA_AMOUNT = rf"(?:{_DA_GROUPED}|\d+)(?:,\d+)?"

# Danish uses the LONG scale, so "billion" is 10^12 and the checkpoint writes
# "billioner" for the English trillion. The rule reads whatever word is there
# rather than converting, so the scale system never has to be modelled.
_DA_SCALE = r"(?:tusind|million|millioner|milliard|milliarder|billion|billioner)"
_DA_CURRENCY_SCALE_RE = re.compile(rf"\$\s?(\d+(?:,\d+)?)\s+({_DA_SCALE})\b")
_DA_CURRENCY_CENTS_RE = re.compile(rf"\$\s?(\d+),(\d{{1,2}})(?!\d)(?!\s+{_DA_SCALE}\b)")
_DA_CURRENCY_SIGN_RE = re.compile(rf"\$\s?({_DA_GROUPED}|\d+)")
_DA_PERCENT_RE = re.compile(rf"\b({_DA_AMOUNT})\s?%")
_DA_COMMA_DECIMAL_RE = re.compile(r"\b(\d+),(\d+)\b")
_DA_SECTION_DOT_RE = re.compile(r"\b(\d+)\.(\d{1,2})(?!\d)")
# THE ORDINAL, which is a form no earlier language here had to read. Danish
# writes an ordinal as digits plus a PERIOD -- `det 20. arhundrede`, `Den 26.
# marts`, `hvert 10. sekund` -- so the cardinal pass reads it as "det tyve.
# arhundrede", a number and a stray full stop.
#
# 13 occurrences in the 9,430 translated sentences, which earns the rule on
# FREQUENCY rather than on severity: more than any single-occurrence rule in
# this module, and every one of them reads wrong today.
#
# THE GUARD IS THE FOLLOWING WORD'S CASE, and it was measured rather than
# reasoned. `26.` at the end of a sentence looks identical to an ordinal, so the
# pattern requires a LOWERCASE word after it. Measured on this corpus: 13 such
# forms followed by a lowercase word, every one a real ordinal (month names,
# arhundrede, gade, sekund), and ZERO followed by an uppercase one. A sentence
# that really did end in a number would start the next with a capital and this
# rule would decline to fire.
#
# Capped at two digits: the table covers 1-99, which is every date and every
# century. A longer run falls through to the cardinal pass, as it does today.
_DA_ORDINAL_RE = re.compile(r"(?<!\d)(\d{1,2})\.(?=\s+[a-zæøå])")
_DA_YEAR_RE = re.compile(r"\b(?:1[5-9]\d{2}|20\d{2})\b")
_DA_INTEGER_RE = re.compile(rf"\b(?:{_DA_GROUPED}|\d+)\b")


_DA_ORDINAL_ONES = [
    None, "første", "anden", "tredje", "fjerde", "femte", "sjette", "syvende",
    "ottende", "niende", "tiende", "ellevte", "tolvte", "trettende",
    "fjortende", "femtende", "sekstende", "syttende", "attende", "nittende",
]
# The tens ordinals restore the LONG vigesimal forms the cardinals abbreviate:
# the cardinal is "fyrre" but the ordinal is "fyrretyvende", "tres" but
# "tresindstyvende". Deriving one from the other is not possible; it is a table.
_DA_ORDINAL_TENS = {2: "tyvende", 3: "tredivte", 4: "fyrretyvende",
                    5: "halvtredsindstyvende", 6: "tresindstyvende",
                    7: "halvfjerdsindstyvende", 8: "firsindstyvende",
                    9: "halvfemsindstyvende"}


def _da_ordinal(value: int) -> str:
    """1-99 only -- every date and every century. A compound takes the unit's
    CARDINAL and the ten's ORDINAL: enogtyvende, toogfyrretyvende."""
    if value < 20:
        return _DA_ORDINAL_ONES[value]
    tens, ones = divmod(value, 10)
    if ones == 0:
        return _DA_ORDINAL_TENS[tens]
    return f"{_DA_ONES[ones]}og{_DA_ORDINAL_TENS[tens]}"


def _da_money(value: int) -> str:
    """PLURAL after a numeral -- "halvtreds dollars" -- which the checkpoint
    itself writes and which inverts Dutch, the language whose number FORMATS
    Danish otherwise matches exactly."""
    return f"{_da_int_to_words(value)} {'dollar' if value == 1 else 'dollars'}"


def _da_fraction(whole: str, part: str, joiner: str) -> str:
    return f"{_da_int_to_words(int(whole))} {joiner} {_da_digits_to_words(part)}"


def _da_currency_scale(match: re.Match) -> str:
    amount, scale = match.group(1), match.group(2)
    if "," in amount:
        phrase = _da_fraction(*amount.split(",", 1), "komma")
    else:
        phrase = _da_int_to_words(int(amount))
    return f"{phrase} {scale} dollars"


def _da_currency_cents(match: re.Match) -> str:
    cents = int(match.group(2).ljust(2, "0")[:2])
    dollars = int(match.group(1))
    if dollars == 0 and cents:
        return f"{_da_int_to_words(cents)} cent"
    phrase = _da_money(dollars)
    if cents:
        phrase += f" og {_da_int_to_words(cents)} cent"
    return phrase


def normalize_da_for_speech(text: str) -> str:
    """Danish translated text -> Danish spoken form.

    Same pass order as Dutch, and for the same reasons: currency claims its
    digits before anything reads `$15,50` as a decimal beside a dollar sign, and
    the year pass runs before the integer pass because the two DISAGREE -- 1961
    is "nitten hundrede og enogtres" as a year and "et tusind ni hundrede og
    enogtres" as a quantity.

    The ORDINAL pass is Danish's own, and runs before both: `Den 26. marts` has
    to be claimed as an ordinal before the integer pass reads it as a cardinal
    and leaves the period behind as a sentence end.
    """
    out = _DA_CURRENCY_SCALE_RE.sub(_da_currency_scale, _restore_leading_zero(text))
    out = _DA_CURRENCY_CENTS_RE.sub(_da_currency_cents, out)
    out = _DA_CURRENCY_SIGN_RE.sub(lambda m: _da_money(_da_int(m.group(1))), out)
    out = _DA_PERCENT_RE.sub(
        lambda m: f"{_da_number_phrase(m.group(1))} procent"
        if "," not in m.group(1) else
        _da_fraction(*m.group(1).split(","), "komma") + " procent", out)
    out = _DA_COMMA_DECIMAL_RE.sub(
        lambda m: _da_fraction(m.group(1), m.group(2), "komma"), out)
    out = _DA_SECTION_DOT_RE.sub(
        lambda m: _da_fraction(m.group(1), m.group(2), "punktum"), out)
    out = _DA_ORDINAL_RE.sub(lambda m: _da_ordinal(int(m.group(1))), out)
    out = _DA_YEAR_RE.sub(lambda m: _da_year_phrase(int(m.group(0))), out)
    out = _DA_INTEGER_RE.sub(lambda m: _da_number_phrase(m.group(0)), out)
    return _cleanup(out)


# ---------------------------------------------------------------------------
# Swedish. The SEVENTH language, and the one that broke the "Scandinavian, so
# it will be Danish" prediction hardest. The en-sv checkpoint was measured on
# the deployed corpus before any rule below was written, and it agrees with
# Danish on almost nothing:
#
#     8,000     -> "8.000" AND "20 000"   BOTH separators, in the same book
#     $50       -> "50 dollar"            INVARIABLE, where Danish pluralises
#     $8.3 tril -> "8,3 biljoner dollar"  decimal COMMA, LONG scale
#     Figure 1.3-> "1.3"                  decimal DOT preserved
#     20%       -> "20 %" AND "35%"       BOTH spacings, 37 against 31
#     et al.    -> "et al." (71) AND "m.fl." (29)
#     1900s     -> "1900-talet"           HYPHEN suffix, as Hungarian does
#     42nd      -> "42:a"                 COLON ordinal
#     r = .30   -> "r = .30"              LEADING-DOT decimal, no zero
#
# **The checkpoint is INCONSISTENT about two things at once**, which no earlier
# one was: it writes a thousands group with a dot 12 times and with a space 7
# times, and it writes the percent sign spaced 37 times and tight 31. Both forms
# of both have to be read, and a rule written from either half alone is wrong
# about a third of the time.
#
# THE TENS GO FIRST AND THERE IS NO JOINER: tjugoett, trettiofem, nittionio.
# Dutch, Danish and German all put the UNIT first (eenentwintig, enogtyve), so
# the one structural habit those three share is exactly the one Swedish drops.
# This is the single rule a port from Danish would get wrong on every number
# between 21 and 99.
#
# `dollar` is INVARIABLE after a numeral, as in Dutch and unlike Danish -- the
# checkpoint writes "50 dollar" 13 times and "dollars" never.
#
# A HYPHEN SUFFIX, 35 occurrences, which is Hungarian's mechanism reappearing in
# a Germanic language: `1960-talet`, `5-ariga`, `40-arsaldern`. The number is
# spelled and the word fuses onto it. Inside a decade the number is read as a
# YEAR ("nittonhundrasextiotalet"), so the year rule has to be reachable from
# inside the suffix rule rather than running after it.
#
# `m.fl.` EARNS A RULE where `et al.` does not, and the difference is measured
# rather than assumed: `et al.` survives 71 times and is correct Swedish
# academic usage, but the checkpoint also produces `m.fl.` 29 times, which is a
# dot-separated abbreviation a voice reads as letters. It is the same standard
# the Spanish `et al.` -> `y otros` rule was held to.
#
# NOT FIXED, and recorded: `42:a` (the colon ordinal) occurs ONCE, written by
# the checkpoint as `42: a` with a space. One occurrence, and the reading is a
# stray letter rather than a wrong value -- the same call made against
# Hungarian's spaced hyphen at two occurrences.
# ---------------------------------------------------------------------------

_SV_ONES = [
    "noll", "ett", "två", "tre", "fyra", "fem", "sex", "sju", "åtta", "nio",
    "tio", "elva", "tolv", "tretton", "fjorton", "femton", "sexton",
    "sjutton", "arton", "nitton",
]
_SV_TENS = {2: "tjugo", 3: "trettio", 4: "fyrtio", 5: "femtio",
            6: "sextio", 7: "sjuttio", 8: "åttio", 9: "nittio"}


def _sv_under_hundred(value: int) -> str:
    if value < 20:
        return _SV_ONES[value]
    tens, ones = divmod(value, 10)
    # TEN FIRST, no joiner -- tjugoett, not "ettochtjugo". Dutch, Danish and
    # German all do the opposite, so this is where a port from Danish breaks.
    return _SV_TENS[tens] + (_SV_ONES[ones] if ones else "")


def _sv_under_thousand(value: int) -> str:
    if value < 100:
        return _sv_under_hundred(value)
    hundreds, rest = divmod(value, 100)
    head = "hundra" if hundreds == 1 else _SV_ONES[hundreds] + "hundra"
    return head + (_sv_under_hundred(rest) if rest else "")


def _sv_int_to_words(value: int) -> str:
    if value < 0:
        return "minus " + _sv_int_to_words(-value)
    for limit, singular, plural in ((1_000_000_000_000, "biljon", "biljoner"),
                                    (1_000_000_000, "miljard", "miljarder"),
                                    (1_000_000, "miljon", "miljoner")):
        if value >= limit:
            head, rest = divmod(value, limit)
            word = f"en {singular}" if head == 1 else f"{_sv_int_to_words(head)} {plural}"
            return word + (f" {_sv_int_to_words(rest)}" if rest else "")
    if value >= 1_000:
        thousands, rest = divmod(value, 1_000)
        # The multiplier fuses onto "tusen"; the remainder is a separate word.
        # Swedish writes a whole number as ONE word -- "tvatusenfemhundra",
        # "fyrtiotusentrehundratjugo" -- which is standard orthography and what
        # a Swedish-trained G2P will have seen. Danish spaces its parts because
        # Danish does; this is the same decision made the other way, per
        # language rather than per family.
        head = "tusen" if thousands == 1 else _sv_under_thousand(thousands) + "tusen"
        return head + (_sv_under_thousand(rest) if rest else "")
    return _sv_under_thousand(value)


def _sv_digits_to_words(digits: str) -> str:
    return " ".join(_SV_ONES[int(d)] for d in digits)


def _sv_year_phrase(value: int) -> str:
    """Read BY HUNDREDS below 2000, as in Dutch and Danish; the plain cardinal
    takes over from 2000 ("tvåtusentio")."""
    if value >= 2000:
        return _sv_int_to_words(value)
    hundreds, rest = divmod(value, 100)
    return (_sv_under_hundred(hundreds) + "hundra"
            + (_sv_under_hundred(rest) if rest else ""))


def _sv_int(token: str) -> int:
    return int(token.replace(".", "").replace(" ", "").replace(" ", ""))


def _sv_number_phrase(token: str) -> str:
    digits = token.replace(".", "").replace(" ", "").replace(" ", "")
    grouped = "." in token or " " in token or " " in token
    if not grouped and (len(digits) >= _IDENTIFIER_DIGITS
                        or (len(digits) > 1 and digits[0] == "0")):
        return _sv_digits_to_words(digits)
    return _sv_int_to_words(int(digits))


# BOTH separators, because the checkpoint writes both: a dot group 12 times and
# a space group 7 in the same book. Either way the group must be EXACTLY three
# digits, which is what keeps "1.3" and "2.0" out -- 311 short dot forms against
# those 12 real thousands groups.
_SV_GROUPED = r"\d{1,3}(?:(?:\.|[  ])\d{3})+(?!\d)"
_SV_AMOUNT = rf"(?:{_SV_GROUPED}|\d+)(?:,\d+)?"

_SV_SCALE = r"(?:tusen|miljon|miljoner|miljard|miljarder|biljon|biljoner)"
_SV_CURRENCY_SCALE_RE = re.compile(rf"\$\s?(\d+(?:,\d+)?)\s+({_SV_SCALE})\b")
_SV_CURRENCY_CENTS_RE = re.compile(rf"\$\s?(\d+),(\d{{1,2}})(?!\d)(?!\s+{_SV_SCALE}\b)")
_SV_CURRENCY_SIGN_RE = re.compile(rf"\$\s?({_SV_GROUPED}|\d+)")
_SV_PERCENT_RE = re.compile(rf"\b({_SV_AMOUNT})\s?%")
_SV_COMMA_DECIMAL_RE = re.compile(r"\b(\d+),(\d+)\b")
_SV_SECTION_DOT_RE = re.compile(r"\b(\d+)\.(\d{1,2})(?!\d)")
# The hyphen suffix, 35 occurrences, run BEFORE the year and integer passes or
# they consume the number and strand the word.
_SV_WORD = r"[a-zA-ZåäöÅÄÖ]"
_SV_SUFFIX_RE = re.compile(rf"\b(\d+)-({_SV_WORD}+)")
_SV_YEAR_RE = re.compile(r"\b(?:1[5-9]\d{2}|20\d{2})\b")
_SV_INTEGER_RE = re.compile(rf"\b(?:{_SV_GROUPED}|\d+)\b")
# `m.fl.` is correct Swedish and still unreadable aloud -- a voice says the
# letters. `et al.` survives 71 times and stays, because it IS read as words.
_SV_M_FL_RE = re.compile(r"\bm\.\s?fl\.")


def _sv_money(value: int) -> str:
    """INVARIABLE after a numeral -- "femtio dollar", as in Dutch. Danish, the
    other Scandinavian language here, pluralises; the checkpoint writes
    "dollar" 13 times and "dollars" never."""
    return f"{_sv_int_to_words(value)} dollar"


def _sv_fraction(whole: str, part: str, joiner: str) -> str:
    return f"{_sv_int_to_words(int(whole))} {joiner} {_sv_digits_to_words(part)}"


def _sv_currency_scale(match: re.Match) -> str:
    amount, scale = match.group(1), match.group(2)
    if "," in amount:
        phrase = _sv_fraction(*amount.split(",", 1), "komma")
    else:
        phrase = _sv_int_to_words(int(amount))
    return f"{phrase} {scale} dollar"


def _sv_currency_cents(match: re.Match) -> str:
    cents = int(match.group(2).ljust(2, "0")[:2])
    dollars = int(match.group(1))
    if dollars == 0 and cents:
        return f"{_sv_int_to_words(cents)} cent"
    phrase = _sv_money(dollars)
    if cents:
        phrase += f" och {_sv_int_to_words(cents)} cent"
    return phrase


def _sv_suffixed(match: re.Match) -> str:
    """`1960-talet` -> "nittonhundrasextiotalet", `5-åriga` -> "femåriga".

    A decade reads its number as a YEAR, which is why this cannot simply run
    after the year pass: by then the hyphen has already been orphaned.
    """
    digits, word = match.group(1), match.group(2)
    value = int(digits)
    phrase = (_sv_year_phrase(value) if _SV_YEAR_RE.fullmatch(digits)
              else _sv_number_phrase(digits))
    return phrase + word


def normalize_sv_for_speech(text: str) -> str:
    """Swedish translated text -> Swedish spoken form.

    Two orderings are Swedish's own. The HYPHEN-SUFFIX pass runs before the year
    and integer passes, or `1960-talet` loses its word. And `m.fl.` is expanded
    first, before any dot rule can look at its two full stops.
    """
    out = _SV_M_FL_RE.sub("med flera", _restore_leading_zero(text))
    out = _SV_CURRENCY_SCALE_RE.sub(_sv_currency_scale, out)
    out = _SV_CURRENCY_CENTS_RE.sub(_sv_currency_cents, out)
    out = _SV_CURRENCY_SIGN_RE.sub(lambda m: _sv_money(_sv_int(m.group(1))), out)
    out = _SV_PERCENT_RE.sub(
        lambda m: f"{_sv_number_phrase(m.group(1))} procent"
        if "," not in m.group(1) else
        _sv_fraction(*m.group(1).split(","), "komma") + " procent", out)
    out = _SV_COMMA_DECIMAL_RE.sub(
        lambda m: _sv_fraction(m.group(1), m.group(2), "komma"), out)
    out = _SV_SECTION_DOT_RE.sub(
        lambda m: _sv_fraction(m.group(1), m.group(2), "punkt"), out)
    out = _SV_SUFFIX_RE.sub(_sv_suffixed, out)
    out = _SV_YEAR_RE.sub(lambda m: _sv_year_phrase(int(m.group(0))), out)
    out = _SV_INTEGER_RE.sub(lambda m: _sv_number_phrase(m.group(0)), out)
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
# Czech. The NINTH language, the SIXTH distinct convention, and the first
# non-Germanic, non-Romance one here. Measured with bench/formats/measure.py and
# then COUNTED over all 9,430 translated sentences with bench/formats/count.py;
# shapes in bench/formats/cs.json.
#
#     thousands -> SPACE     17 occurrences  8,000 -> 8 000, 40,320 -> 40 320
#     dot groups              0 occurrences  <- see below; this is the finding
#     short dot KEPT        301 occurrences  obr. 1.3, CC BY 2.0
#     percent attached       80 occurrences  3%, 54%
#     percent spaced          0 occurrences
#     comma decimal           7 occurrences  8,3 bilionu / 14,4% / 2,0
#     leaked English comma    3 occurrences  50,000 / 1,424 / 5 000,000
#     $ surviving             3 occurrences  ($20), ($1)
#     et al. preserved       95 occurrences  no rule earned
#
# THE DOT AMBIGUITY IS GONE, and that is a measurement rather than an oversight.
# Italian, Dutch, Danish and German all had to separate a thousands dot from a
# section number by GROUP SIZE, on ratios of 20-against-335, 19-against-281,
# 19-against-316 and 20-against-328. en-cs writes ZERO dot groups, so every one
# of its 301 dots is a section number or a version and the exactly-three-digits
# test is load-bearing for nothing. The pattern below still carries the cap,
# for the different reason given at _CS_SECTION_DOT_RE.
#
# What replaces it is Hungarian's problem: the separator is a SPACE, and three
# English commas survived unlocalised. Both are handled the way Hungarian
# handles them, and for the reason recorded there -- see _CS_COMMA_THOUSANDS_RE.
# ---------------------------------------------------------------------------

# The citation forms, which is what a Czech speaker counts aloud with:
# "jedna, dva, tři". 1 and 2 also have gendered forms, and those are NOT
# alternatives to these -- they are required wherever the numeral stands before
# a noun. See _CS_GENDERED.
_CS_ONES = [
    "nula", "jedna", "dva", "tři", "čtyři", "pět", "šest", "sedm", "osm",
    "devět", "deset", "jedenáct", "dvanáct", "třináct", "čtrnáct", "patnáct",
    "šestnáct", "sedmnáct", "osmnáct", "devatenáct",
]
_CS_TENS = {2: "dvacet", 3: "třicet", 4: "čtyřicet", 5: "padesát",
            6: "šedesát", 7: "sedmdesát", 8: "osmdesát", 9: "devadesát"}
# 200 is the odd one: "dvě stě" is a surviving DUAL, not the plural "sta" that
# 300 and 400 take, and 500 upward switch again to the genitive "set". Three
# forms of one word across nine entries, which is why this is a table.
_CS_HUNDREDS = {1: "sto", 2: "dvě stě", 3: "tři sta", 4: "čtyři sta",
                5: "pět set", 6: "šest set", 7: "sedm set", 8: "osm set",
                9: "devět set"}
# ONLY 1 and 2 inflect for gender; 3 upward are the same word for every noun.
# Neuter and feminine share a form for 2 and differ for 1, so this is a table
# rather than a pair of suffix rules.
_CS_GENDERED = {1: {"m": "jeden", "f": "jedna", "n": "jedno"},
                2: {"m": "dva", "f": "dvě", "n": "dvě"}}


def _cs_ones(value: int, gender: str | None) -> str:
    if gender and value in _CS_GENDERED:
        return _CS_GENDERED[value][gender]
    return _CS_ONES[value]


def _cs_under_hundred(value: int, gender: str | None = None) -> str:
    if value < 20:
        return _cs_ones(value, gender)
    tens, ones = divmod(value, 10)
    if not ones:
        return _CS_TENS[tens]
    # Separate words, ten first -- "dvacet jedna". Czech does have a fused
    # unit-first form ("jedenadvacet"), and it is archaic; the checkpoint's own
    # output uses neither, because it leaves the digits.
    return f"{_CS_TENS[tens]} {_cs_ones(ones, gender)}"


def _cs_under_thousand(value: int, gender: str | None = None) -> str:
    if value < 100:
        return _cs_under_hundred(value, gender)
    hundreds, rest = divmod(value, 100)
    head = _CS_HUNDREDS[hundreds]
    return head + (f" {_cs_under_hundred(rest, gender)}" if rest else "")


# LONG SCALE, and it is the checkpoint's scale as well as the language's: a
# Czech "bilion" is 10^12 where an English "billion" is 10^9. en-cs already
# emits the right word unaided -- `100 billion neurons` -> `100 miliard`,
# `$8.3 trillion` -> `8,3 bilionu dolarů` -- so nothing here translates a scale
# word. This table only fires on a numeral large enough to need one of its own,
# which in this corpus means a grouped `1 000 000`.
#
# Each entry carries the scale noun's GENDER, because the numeral in front of it
# agrees: "dva miliony" but "dvě miliardy". Three forms per noun, selected by
# the counted-noun paradigm in _cs_counted.
_CS_SCALES = ((10 ** 12, "m", ("bilion", "biliony", "bilionů")),
              (10 ** 9, "f", ("miliarda", "miliardy", "miliard")),
              (10 ** 6, "m", ("milion", "miliony", "milionů")))


def _cs_int_to_words(value: int, gender: str | None = None) -> str:
    if value < 0:
        return "minus " + _cs_int_to_words(-value, gender)
    for limit, scale_gender, forms in _CS_SCALES:
        if value >= limit:
            head, rest = divmod(value, limit)
            # Bare "milion", not "jeden milion" -- as with "tisíc" below, and
            # unlike German's "eine Million".
            word = forms[0] if head == 1 else _cs_counted(head, forms, scale_gender)
            return word + (f" {_cs_int_to_words(rest, gender)}" if rest else "")
    if value >= 1_000:
        thousands, rest = divmod(value, 1_000)
        head = ("tisíc" if thousands == 1
                else _cs_counted(thousands, ("tisíc", "tisíce", "tisíc"), "m"))
        return head + (f" {_cs_under_thousand(rest, gender)}" if rest else "")
    return _cs_under_thousand(value, gender)


def _cs_counted(value: int, forms: tuple[str, str, str], gender: str) -> str:
    """A numeral and the noun it counts, in the form that numeral governs.

    THE ONE PIECE OF CZECH MORPHOLOGY THAT NO EARLIER LANGUAGE NEEDED, and the
    checkpoint's own output is the evidence for it: en-cs writes `$4` as
    "4 dolary" and `$50` as "50 dolarů", two different words for one noun.

        1        nominative singular   jeden dolar     jedno procento
        2, 3, 4  nominative plural     dva dolary      dvě procenta
        anything genitive plural       padesát dolarů  dvacet procent

    `forms` is that triple. Above 20 a compound is read as genitive plural --
    "dvacet dva dolarů" -- which is the recommended standard form; the competing
    "dvacet dva dolary" is also heard and is not what the checkpoint wrote.

    Gender reaches only 1 and 2 (see _CS_GENDERED) and belongs to the noun, not
    to this function, so the caller names it: procento is neuter and dolar
    masculine, which is why 2% and $2 do not read the numeral the same way.
    """
    if value == 1:
        return f"{_cs_int_to_words(1, gender)} {forms[0]}"
    if value in (2, 3, 4):
        return f"{_cs_int_to_words(value, gender)} {forms[1]}"
    # NO GENDER on this branch, and that is the correction the whole-track run
    # forced: a numeral agrees with its noun only where the noun is nominative,
    # which is the two branches above. Once the noun drops to the genitive
    # plural the numeral takes its base form -- "osmdesát dva procent", not
    # "osmdesát dvě procent". Passing gender down here produced the second of
    # those on 82% and on every compound ending in 2 in the corpus.
    return f"{_cs_int_to_words(value)} {forms[2]}"


def _cs_digits_to_words(digits: str) -> str:
    return " ".join(_CS_ONES[int(d)] for d in digits)


def _cs_year_phrase(value: int) -> str:
    """Czech reads a year as the PLAIN CARDINAL -- 1997 is "tisíc devět set
    devadesát sedm", not the by-hundreds reading Dutch, Danish, Swedish and
    German all take. So this coincides with the cardinal, as it does in Spanish,
    French and Italian, and it keeps its own named pass for the reason recorded
    on `_year_phrase`: the next language's author has to answer this question
    and finding it already asked is the point."""
    return _cs_int_to_words(value)


def _cs_strip(token: str) -> str:
    return token.replace(" ", "").replace(" ", "").replace(" ", "")


def _cs_int(token: str) -> int:
    return int(_cs_strip(token))


def _cs_number_phrase(token: str) -> str:
    digits = _cs_strip(token)
    if digits == token and (len(digits) >= _IDENTIFIER_DIGITS
                            or (len(digits) > 1 and digits[0] == "0")):
        return _cs_digits_to_words(digits)
    return _cs_int_to_words(int(digits))


# A SPACE and nothing else: 17 space groups against zero dot groups and zero
# surviving comma groups (the three commas that did survive are handled as the
# leak they are, below). The alternation Swedish carries is not ported, and
# neither is the dot Italian, Dutch, Danish and German all needed.
#
# The separator is a plain U+0020 in all 17, checked rather than assumed; the
# no-break and narrow no-break spaces are accepted anyway because the same
# checkpoint could reach for either and the cost of allowing them is nothing.
_CS_GROUPED = r"\d{1,3}(?:[   ]\d{3})+(?!\d)"
_CS_AMOUNT = rf"(?:{_CS_GROUPED}|\d+)(?:,\s?\d+)?"

# THREE `$` survive translation in the whole corpus -- `($20)`, `($1)` and one
# bare `$20` -- because en-cs otherwise writes the word: `$50` comes back as
# "50 dolarů", already inflected. So this is the only currency rule, and the
# absence of the other two is MEASURED rather than an omission:
#
#   * no `$N,NN` cents form occurs, so there is no cents rule. Were one to
#     appear, `$15,50` would be claimed here as "patnáct dolarů" with ",50"
#     stranded -- this is the line it would land on.
#   * no `$N scale-word` form occurs either. `$8.3 trillion` arrives as
#     "8,3 bilionu dolarů" with no sign at all, so the comma-decimal pass reads
#     it and the nouns the checkpoint already inflected are left alone.
_CS_CURRENCY_RE = re.compile(rf"\$\s?({_CS_GROUPED}|\d+)")
_CS_PERCENT_RE = re.compile(rf"({_CS_AMOUNT})\s?%")
# A comma before EXACTLY three digits is an English thousands separator the
# checkpoint failed to localise, not a Czech decimal -- the same leak Hungarian
# measured, and the same fix. Three occurrences: `50,000`, `1,424`, and
# `5 000,000`, that last one a 5,000,000 whose FIRST group was localised and
# whose second was not. Read as decimals they give "padesát celých nula nula
# nula" and "jedna celá čtyři dva čtyři" -- wrong VALUES, which is the severity
# bar this module earns a rule from at a single occurrence.
#
# Rewritten to the SPACE Czech actually uses rather than deleted, for the reason
# Hungarian records: deleting it pushes `1424` under the same roof as an
# identifier and it comes out read digit by digit.
_CS_COMMA_THOUSANDS_RE = re.compile(r"\b(\d{1,3}),(\d{3})(?!\d)")
# ...which leaves the comma decimal capped at two fraction digits, so the two
# rules are mutually exclusive by group size.
#
# TIGHT COMMA ONLY, and the spaced form is deliberately NOT accepted here.
# Allowing `,\s?` was the first version of this rule and the corpus caught it
# immediately: `oblasti 1, 2, 4 a 5` came out as "oblasti jedna celá dva, čtyři
# a pět", a list of brain regions read as a decimal -- the same defect the JS
# port's word-boundary bug produced on the same shape in Spanish.
#
# The checkpoint really does write `28, 5%` and ten whole table cells as
# `57, 1`, so the spaced form is not imaginary. Both are claimed by a rule
# carrying its own guard instead: the `%` in _CS_PERCENT_RE via _CS_AMOUNT, and
# the whole-line anchor in _CS_CELL_DECIMAL_RE.
_CS_COMMA_DECIMAL_RE = re.compile(r"\b(\d+),(\d{1,2})(?!\d)")
# Capped at two fraction digits like every other language here, and for a
# DIFFERENT reason than any of them: Czech needs no group-size test, since the
# corpus holds no dot thousands at all. What the cap does here is keep
# `doi: 10.1177` out, which would otherwise be read as a fraction digit by digit.
_CS_SECTION_DOT_RE = re.compile(r"\b(\d+)\.(\d{1,2})(?!\d)")
# TEN table cells whose entire text is a decimal the checkpoint both localised
# and spaced: `57.1` -> `57, 1`, `40.0` -> `40, 0`. Read as written they are two
# numbers with a pause between them.
#
# THE WHOLE-LINE ANCHOR IS THE GUARD, and it has to be: `oblasti 1, 2, 4 a 5`
# and `Tickle-Degnen & Rosenthal, 1990, 1992` are the same shape inside a
# sentence, and reading either as a decimal would corrupt a list. Anchored this
# way there are zero false positives in the corpus -- all ten matches came from
# an English `NN.N`, checked one by one rather than sampled.
_CS_CELL_DECIMAL_RE = re.compile(r"^\s*(\d+), (\d{1,2})\s*$")
_CS_YEAR_RE = re.compile(r"\b(?:1[5-9]\d{2}|20\d{2})\b")
_CS_INTEGER_RE = re.compile(rf"\b(?:{_CS_GROUPED}|\d+)\b")

# "dolar" is masculine, "procento" neuter, and both inflect after a numeral --
# see _cs_counted. These are the only nouns this module inserts, so they are the
# only places the agreement can be got right at all.
_CS_DOLLAR = ("dolar", "dolary", "dolarů")
_CS_PERCENT = ("procento", "procenta", "procent")


def _cs_whole_word(value: int) -> str:
    """The word between a decimal's two halves, which in Czech is not the name
    of the mark but a COUNTED ADJECTIVE that agrees with the number in front of
    it: "jedna celá pět", "dvě celé pět", "pět celých pět".

    So Czech's two decimal joiners behave differently from each other, and only
    one of them inflects. The dot is read "tečka" -- the name of the character,
    invariable -- because in Czech a dot between digits is a section number or a
    version, never a decimal. The comma is the decimal, and it takes this."""
    if value <= 1:
        return "celá"
    if value in (2, 3, 4):
        return "celé"
    return "celých"


def _cs_fraction(whole: str, part: str) -> str:
    """A comma decimal: "dvě celé pět", "osm celých tři".

    The whole part is FEMININE where it is 1-4, agreeing with "celá" rather
    than with anything in the sentence -- 2,5 is "dvě celé pět", never "dva celé
    pět". Above 4 the noun is genitive plural and the numeral reverts to its
    base form, so 42,9 is "čtyřicet dva celých devět"; the same rule as
    _cs_counted, and it was got wrong there first."""
    value = int(whole)
    gender = "f" if value in (1, 2, 3, 4) else None
    return (f"{_cs_int_to_words(value, gender)} {_cs_whole_word(value)} "
            f"{_cs_digits_to_words(part)}")


def _cs_section(whole: str, part: str) -> str:
    return f"{_cs_int_to_words(int(whole))} tečka {_cs_digits_to_words(part)}"


def _cs_percent(match: re.Match) -> str:
    amount = match.group(1)
    if "," in amount:
        # Genitive singular after a decimal -- "čtrnáct celých čtyři procenta",
        # which is spelled the same as the nominative plural above and reached
        # by a different rule.
        return f"{_cs_fraction(*(p.strip() for p in amount.split(',', 1)))} procenta"
    return _cs_counted(_cs_int(amount), _CS_PERCENT, "n")


def normalize_cs_for_speech(text: str) -> str:
    """Czech translated text -> Czech spoken form.

    Pass order is the shared one with a single Czech addition: the comma
    THOUSANDS rewrite runs before anything that reads a comma, so a leaked
    `1,424` reaches the speller by exactly the same path a written `1 424` does.
    It runs before the currency rule too -- Hungarian puts its own after -- so
    that a leaked `$50,000` would be read as fifty thousand rather than as fifty.

    **ORDINALS ARE NOT HANDLED, deliberately, and Czech is the strongest case
    yet for that call.** The checkpoint marks one with a trailing dot in 29
    lines -- `20. století`, `26. března`, `21. prosincem` -- and reading it
    needs the ordinal declined to agree with the noun it modifies, in whatever
    case that noun is standing in: "dvacátého století" (genitive),
    "dvacátým prvním prosincem" (instrumental). Danish could take this rule
    because a Danish ordinal has ONE form; German was denied it because the dot
    is ambiguous; Czech has both problems at once. The numeral is read correctly
    and its ending is missing, which is a stray syllable rather than a wrong
    value -- the standard applied to German's `20. Jahrhundert` and Hungarian's
    `42-ik`.

    RECORDED, NOT FIXED, all measured over the same 9,430 sentences:

      * a numeral GLUED to a Czech adjective -- `10sekundové`, `20minutovou`,
        `29letý`, `20letého` -- reaches the voice as raw digits, 4 occurrences
        (the fourth found by the whole-track run, not by the shape count). German fixed
        its glued suffix at 23 and Swedish its hyphenated one at 35. Beyond the
        frequency, the fix is not the same shape: German appends "er" to the
        cardinal and gets a real word, while Czech needs the numeral's
        COMBINING stem ("desetisekundové", "osmadvacetiletá"), which is a
        second numeral system rather than a suffix. The six HYPHENATED forms
        (`5-leté`, `12-gauge`) are already read, because a hyphen is a word
        boundary and the integer pass reaches them.
      * `1970s`, one occurrence, in an image credit -- English that survived
        translation. German's decade rule was earned at 23.
      * `0,25 dolarů` reads "nula celých dva pět dolarů" rather than naming
        cents. Dutch and Danish rewrite that shape because they INSERT the noun;
        here the checkpoint already wrote it, inflected, and rewriting it would
        mean editing the translation rather than reading it.
      * a bare `1` before a noun the CHECKPOINT wrote -- `1 dolar` reads
        "jedna dolar" where Czech wants "jeden". The three genders of 1 are
        reachable only where this module inserts the noun itself (see
        `_cs_counted`); when the noun is already in the translation its gender
        is not derivable from here. The same limit Spanish records on
        `_apocopate`, made visible by a language with three forms instead of two.
      * `n.d.`, `B. F.` and `R. H.` -- six dotted abbreviations, all but one of
        them author initials. Swedish earned `m.fl.` at 29 and German `z.B.` at
        141. `et al.` survives 95 times and is left alone for the measured
        reason it is left alone in French, Italian and German: it already reads
        as words.
    """
    out = _restore_leading_zero(text)
    out = _CS_COMMA_THOUSANDS_RE.sub(r"\1 \2", out)
    out = _CS_CELL_DECIMAL_RE.sub(lambda m: _cs_fraction(m.group(1), m.group(2)), out)
    out = _CS_CURRENCY_RE.sub(
        lambda m: _cs_counted(_cs_int(m.group(1)), _CS_DOLLAR, "m"), out)
    out = _CS_PERCENT_RE.sub(_cs_percent, out)
    out = _CS_COMMA_DECIMAL_RE.sub(lambda m: _cs_fraction(m.group(1), m.group(2)), out)
    out = _CS_SECTION_DOT_RE.sub(lambda m: _cs_section(m.group(1), m.group(2)), out)
    out = _CS_YEAR_RE.sub(lambda m: _cs_year_phrase(int(m.group(0))), out)
    out = _CS_INTEGER_RE.sub(lambda m: _cs_number_phrase(m.group(0)), out)
    return _cleanup(out)


# Keyed by the same ISO 639-1 codes as pipeline.languages.TARGETS. A code that is
# absent is not an error: `NORMALIZERS.get(code, lambda t: t)` is how callers
# look one up, so a language without a normaliser yet behaves exactly as it did
# before this module existed. Spanish is first because it is the only language
# with converted checkpoints on disk, the only one Task 14's QA gate exercises
# end to end, and the only one this decision has measured evidence for at all.
#
# Next cheapest, once Spanish is proven: the other Romance languages that share
# the plain-cardinal year reading (fr, it, pt, ro). Last, and held to extra QA
# scrutiny: pipeline.languages.HIGHER_RISK (hr, sl, pl, ja), where a normaliser
# bug stacked on an already-weaker group-model translation is the hardest
# combination to debug back apart.
NORMALIZERS: dict[str, Callable[[str], str]] = {
    "es": normalize_es_for_speech,
    "fr": normalize_fr_for_speech,
    "it": normalize_it_for_speech,
    "nl": normalize_nl_for_speech,
    "hu": normalize_hu_for_speech,
    "da": normalize_da_for_speech,
    "sv": normalize_sv_for_speech,
    "de": normalize_de_for_speech,
    "cs": normalize_cs_for_speech,
}
