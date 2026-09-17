"""Turn Display Text into Speech Text.

A Python port of the desktop LibreTexts Reader's
`src-tauri/src/content/normalize.rs`, restricted to what the demo book needs.
The LaTeX and MathML branches are intentionally absent: `social_psychology`
contains one formula across 91 pages, and carrying that complexity into v1
buys nothing. `math_elem_teachers` (737 formulas) is the book that will
exercise them, in phase 4.

Order matters. URLs are replaced before anything else so that a slash or a
digit inside one is never mistaken for a fraction or a number. Years are
claimed before the integer pass for the same reason: once `INTEGER_RE` has
read `1963` as a cardinal there is nothing left to recognise.

Citations are compressed before the year pass rather than after it, so the year
they carry is handed on as digits and read by YEAR_RE exactly as any other year
is. They run after the abbreviation pass so that `et al.` has already become
"and others" and can never be mistaken for a surname in the list.
"""

import re

# Imported, not redefined. This module used to carry its own copy, and both
# copies missed the same thing -- a scheme-less URL like
# `commons.wikimedia.org/wiki/File:...`, which is what the staged book's image
# credits actually contain. One definition, in the module whose whole job is
# recognising spans that must not be touched.
from pipeline.protect import URL_RE
EMAIL_RE = re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b")
CURRENCY_RE = re.compile(r"\$\s?([\d,]+(?:\.\d+)?)")
PERCENT_RE = re.compile(r"\b([\d,]+(?:\.\d+)?)\s?%")
DECIMAL_RE = re.compile(r"\b(\d+)\.(\d+)\b")
# A four-digit year, read in halves. There is no comma group in this pattern on
# purpose: the thousands separator is the signal that a number is a quantity
# (`2,415 responses`) rather than a year, so a grouped number can never match here.
# The floor is 1500 rather than 1000 because reference lists carry page ranges in
# the 1000s -- fixtures/prose.html cites pages 1196-1210 -- and those are
# quantities. The ceiling is 2099, past which English has no settled spoken form
# and the cardinal reading is the safer default.
YEAR_RE = re.compile(r"\b(?:1[5-9]\d{2}|20\d{2})\b")
INTEGER_RE = re.compile(r"\b\d[\d,]*\b")
# Two or more dots: a page index or a cross-reference, never a decimal.
DOTTED_REF_RE = re.compile(r"\b\d+(?:\.\d+){2,}\b")
# An equals sign the author typed in prose rather than in MathJax. Supertonic
# says nothing at all for a symbol it has no pronunciation for, so "P_i = 1 atm"
# came out "Pi one atm" -- the relation, which is the content of the sentence,
# silently dropped. 626 occurrences over 80 pages of chem_4b + math_elem_teachers.
#
# The lookarounds exclude the compound operators (<=, >=, !=, ==), where "equals"
# alone would state the opposite or a weaker claim. Those are left untouched
# rather than named, because they are vanishingly rare in this prose and a wrong
# reading is worse than a silent one.
EQUALS_RE = re.compile(r"\s*(?<![<>!=])=(?!=)\s*")

REPEATED_PUNCT_RE = re.compile(r"([.!?])[.!?]+")
WHITESPACE_RE = re.compile(r"\s+")

# Longest-first within each family: `e.g.,` must be tried before `e.g.`, or the
# trailing comma is left stranded against the replacement.
#
# Titles (Doctor, Mister, Professor) and `etc.` come from normalize.rs and are
# not optional for this book -- `Dr. Milgram` and `etc.` both occur in
# social_psychology, and leaving them unexpanded makes the engine read the
# period as a sentence end mid-clause.
ABBREVIATIONS = [
    (re.compile(r"\be\.g\.,", re.I), "for example,"),
    (re.compile(r"\bi\.e\.,", re.I), "that is,"),
    (re.compile(r"\be\.g\.", re.I), "for example"),
    (re.compile(r"\bi\.e\.", re.I), "that is"),
    (re.compile(r"\bet al\."), "and others"),
    (re.compile(r"\bcf\.", re.I), "compare"),
    (re.compile(r"\bDr\."), "Doctor"),
    (re.compile(r"\bMrs\."), "Misses"),
    (re.compile(r"\bMr\."), "Mister"),
    (re.compile(r"\bMs\."), "Miss"),
    (re.compile(r"\bProf\."), "Professor"),
    (re.compile(r"\betc\.", re.I), "et cetera"),
    (re.compile(r"\bvs\.?", re.I), "versus"),
    (re.compile(r"\bFig\."), "Figure"),
    (re.compile(r"\bEq\."), "Equation"),
    (re.compile(r"\bapprox\.", re.I), "approximately"),
]

# Characters Supertonic's unicode_indexer.json cannot represent, folded to ones
# it can. src/vendor/helper.js has a table like this but misses every entry here;
# it is fixed on our side because src/vendor/README.md's upstream-diff procedure
# depends on that file staying minimally changed.
#
# An unmapped character is not dropped by the engine -- helper.js maps it to -1,
# and ONNX Gather wraps -1 onto the last row of an 8322-row table whose top real
# index is 8320. That spare row is Supertonic's unknown-character embedding, so
# the character is spoken as "unknown" rather than crashing. Audible, not fatal,
# which is why this is a normalisation concern and not an exception.
UNREPRESENTABLE = {
    "„": '"',   # „ German/Bulgarian/Hungarian/Lithuanian/Czech/Polish open quote
    "‟": '"',   # ‟
    "«": '"',   # «  guillemets, French and Russian
    "»": '"',   # »
    "‚": "'",   # ‚
    "‹": "'",   # ‹
    "›": "'",   # ›
    "″": '"',   # ″ double prime
    "′": "'",   # ′ prime
    "…": ".",   # … ellipsis
    "­": "",    # soft hyphen, invisible
    "​": "",    # zero width space
    "‌": "",    # zero width non-joiner
    "‍": "",    # zero width joiner
    "⁠": "",    # word joiner
    "﻿": "",    # BOM appearing mid-document
}

_UNREPRESENTABLE_TABLE = str.maketrans(UNREPRESENTABLE)


def fold_unrepresentable(text: str) -> str:
    """Apply ONLY the §7 character fold above -- no number spelling, no
    abbreviation expansion, none of `normalize_for_speech`'s other English-only
    passes.

    I6 (final-review): this table exists because of the TARGET languages'
    conventions -- „ is the standard opening quote in German, Bulgarian,
    Hungarian, Lithuanian, Czech and Polish; « » in French and Russian -- not
    because of anything about English. `normalize_for_speech` only ever runs
    on English `sentence.speech`; translated track text goes
    `translate_page -> restore -> write_track` with no fold at all, so every
    one of those characters was reaching Supertonic unfolded on exactly the
    path this feature added, and being spoken as the unknown-character
    embedding (see UNREPRESENTABLE's docstring above). Exported separately so
    pipeline/translate.py can apply just this table to translated text without
    running the full English pipeline over it, which would spell numbers in
    English and expand English abbreviations inside Spanish.
    """
    return text.translate(_UNREPRESENTABLE_TABLE)


# A parenthesised citation is COMPRESSED, never dropped: attribution is content,
# and silently deleting it would misrepresent the text. Three or more surnames
# collapse to the first plus "and others" -- the same two words `et al.` expands
# to above, so a citation written either way sounds identical to a listener.
#
# The pattern is anchored on the opening parenthesis and on a trailing year, and
# it is strict about what a surname is, because the failure that matters here is
# silent: a false positive eats real prose and nothing errors. `(a)`,
# `(see Chapter 3)`, `(Pexels license)` and `(4th ed., Vols. 1 and 2,
# pp. 595-629)` each fail it for a different reason -- no year, no year, no year,
# and no capitalised surname after the parenthesis.
#
# Initials are excluded on purpose, by requiring two letters. That is what keeps
# this out of the reference list at the foot of a page, where the full author
# list IS the content -- fixtures/prose.html:173 reads "Sherif, M., Harvey,
# O. J., ... & Sherif, C. (1961)." and every entry's only parenthesis is a bare
# year, `(Eds.)` or a page range. This function is handed one sentence at a time
# and cannot know which block it came from, so the shape has to carry it.
_PARTICLE = r"(?:de|del|della|der|di|da|dos|du|la|le|van|von|ten|ter)"
# `de Waal` (prose.html:83), `van Laar` (:116) and `van der Toorn` (:125) all
# occur, so a surname may carry one particle or two.
_SURNAME = rf"(?:{_PARTICLE}\s+)*[A-Z][A-Za-z'’-]+"
# The final separator is `&` in this book and spelled `and` in APA narrative
# style; both occur, so both are recognised.
_AUTHORS = rf"{_SURNAME}(?:\s*,\s*{_SURNAME})*(?:\s*,?\s*(?:&|and)\s+{_SURNAME})?"
# The corpus carries one malformed citation -- prose.html:62 reads
# `(Sherif, Harvey, White, Hood, & Sherif (1961)` and never closes the outer
# parenthesis -- so the year may arrive after a comma, after a stray opening
# parenthesis, or after both. Requiring one or the other is what stops a bare
# space from joining an unrelated capitalised word to a number.
_YEAR_JOIN = r"(?:\s*,\s*\(?\s*|\s*\(\s*)"
_CITATION_YEAR = r"(?:1[5-9]\d{2}|20\d{2})"
_CITATION = rf"{_AUTHORS}{_YEAR_JOIN}{_CITATION_YEAR}"

# One parenthetical can hold several citations, semicolon-separated and of
# different lengths -- prose.html:118 has a two, a four and a three in one pair
# of parentheses -- so each is counted and compressed on its own.
CITATION_RE = re.compile(rf"\(\s*({_CITATION}(?:\s*;\s*{_CITATION})*)\s*\)")
CITATION_PART_RE = re.compile(rf"({_AUTHORS}){_YEAR_JOIN}({_CITATION_YEAR})")
SURNAME_RE = re.compile(_SURNAME)

# Three rather than four: `(Turiel, Killen, & Helwig, 1987)` is already three
# surnames and a year read out mid-clause, and the one and two-author forms
# read cleanly as they are.
CITATION_MIN_AUTHORS = 3

ONES = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
        "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
        "seventeen", "eighteen", "nineteen"]
TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"]
SCALES = [(1_000_000_000, "billion"), (1_000_000, "million"), (1_000, "thousand"), (100, "hundred")]


def _int_to_words(value: int) -> str:
    if value == 0:
        return "zero"
    if value < 0:
        return "negative " + _int_to_words(-value)
    for size, name in SCALES:
        if value >= size:
            head = _int_to_words(value // size)
            tail = value % size
            return f"{head} {name}" + (f" {_int_to_words(tail)}" if tail else "")
    if value < 20:
        return ONES[value]
    tens, ones = divmod(value, 10)
    return TENS[tens] + (f" {ONES[ones]}" if ones else "")


def _digits_to_words(digits: str) -> str:
    return " ".join("zero" if d == "0" else ONES[int(d)] for d in digits)


def _number_phrase(token: str) -> str:
    token = token.replace(",", "")
    if "." in token:
        whole, frac = token.split(".", 1)
        return f"{_int_to_words(int(whole or 0))} point {_digits_to_words(frac)}"
    return _int_to_words(int(token))


def _year_phrase(token: str) -> str:
    """Speak a year the way a reader does: `1963` -> nineteen sixty three.

    2000-2009 are the exception and stay cardinal -- "two thousand three" is how
    those years are actually said, where "twenty oh three" is not idiomatic and
    "twenty hundred" is not a thing at all.
    """
    value = int(token)
    if 2000 <= value <= 2009:
        return _int_to_words(value)
    century, remainder = divmod(value, 100)
    if remainder == 0:
        return f"{_int_to_words(century)} hundred"
    if remainder < 10:
        return f"{_int_to_words(century)} oh {ONES[remainder]}"
    return f"{_int_to_words(century)} {_int_to_words(remainder)}"


def _compress_citation(part: str) -> str:
    """One citation from inside a parenthetical: `Turiel, Killen, & Helwig, 1987`.

    Returned unchanged below the threshold, so a one or two-author citation is
    byte-identical to what this file produced before this pass existed.
    """
    match = CITATION_PART_RE.fullmatch(part)
    if match is None:
        return part
    authors, year = match.group(1), match.group(2)
    surnames = SURNAME_RE.findall(authors)
    if len(surnames) < CITATION_MIN_AUTHORS:
        return part
    # The year goes back as DIGITS on purpose. YEAR_RE runs after this pass and
    # gives it the reading chosen for years; deriving it here would put that
    # decision in two places, and the second one would drift.
    return f"{surnames[0]} and others, {year}"


def _citation_phrase(match: re.Match) -> str:
    parts = re.split(r"\s*;\s*", match.group(1))
    compressed = [_compress_citation(part) for part in parts]
    if compressed == parts:
        # Nothing to shorten. Returning the original span rather than a rebuilt
        # one is what makes "a short citation reads exactly as it did before"
        # true byte for byte, including its whitespace.
        return match.group(0)
    return "(" + "; ".join(compressed) + ")"


def _currency(match: re.Match) -> str:
    amount = match.group(1).replace(",", "")
    if "." in amount:
        dollars, cents = amount.split(".", 1)
        cents = cents.ljust(2, "0")[:2]
        phrase = f"{_int_to_words(int(dollars or 0))} dollars"
        if int(cents):
            phrase += f" and {_int_to_words(int(cents))} cents"
        return phrase
    value = int(amount)
    return f"{_int_to_words(value)} dollar" + ("" if value == 1 else "s")


def _cleanup_speech_punctuation(text: str) -> str:
    """Port of normalize.rs `cleanup_speech_punctuation`.

    Abbreviation expansion can strand a comma against another comma or a
    terminal mark (`for example,,`), which the engine reads as a stumble.
    """
    out = " ".join(text.split())
    for bad, good in ((" ,", ","), (",,", ","), (",.", "."), (",!", "!"), (",?", "?")):
        out = out.replace(bad, good)
    return out.lstrip(",").strip()


def spell_numbers(text: str) -> str:
    """Decimals and integers to words, and nothing else.

    normalize_for_speech does this for prose, but math speech is joined into a
    sentence AFTER that pass runs, so SRE's digits used to reach the voice raw.
    Measured through the real engine on 2026-09-07: `1000` was spoken as
    "thousand", `0.125` as "0125" and `857142` as "A570142". The voice reads
    digits correctly only when they arrive as words.

    The YEAR pass is deliberately absent. It reads 1024 as "ten twenty four",
    which is right for a date in prose and wrong for arithmetic, where the same
    four digits are a quantity.
    """
    # A dotted run with two or more dots is a REFERENCE, not a quantity --
    # \PageIndex speaks as `1.4.1` and a section cross-reference as `12.4.1`.
    # Spelling those gives "one point four.one", so they are split out and put
    # back untouched. A split rather than a placeholder: any sentinel carrying
    # an index would itself contain a digit, and INTEGER_RE would spell it.
    parts = re.split(f"({DOTTED_REF_RE.pattern})", text)
    for i in range(0, len(parts), 2):
        out = DECIMAL_RE.sub(
            lambda m: f"{_int_to_words(int(m.group(1)))} point {_digits_to_words(m.group(2))}",
            parts[i])
        parts[i] = INTEGER_RE.sub(lambda m: _number_phrase(m.group(0)), out)
    return "".join(parts)


def normalize_for_speech(text: str) -> str:
    out = fold_unrepresentable(text)
    # EMAIL before URL, for the same reason pipeline/protect.py orders its
    # PROTECTED list that way: now that URL_RE recognises a scheme-less domain,
    # an address's own domain (`example.org` in `author@example.org`) matches it,
    # and URL running first turned the address into "author@link". EMAIL requires
    # an '@' and so can never make the opposite mistake.
    out = EMAIL_RE.sub("email address", out)
    out = URL_RE.sub("link", out)
    # After URL_RE, so a query string's "=" is already gone with the URL.
    out = EQUALS_RE.sub(" equals ", out)
    for pattern, replacement in ABBREVIATIONS:
        out = pattern.sub(replacement, out)
    out = CITATION_RE.sub(_citation_phrase, out)
    out = CURRENCY_RE.sub(_currency, out)
    out = PERCENT_RE.sub(lambda m: f"{_number_phrase(m.group(1))} percent", out)
    out = DECIMAL_RE.sub(lambda m: f"{_int_to_words(int(m.group(1)))} point {_digits_to_words(m.group(2))}", out)
    out = YEAR_RE.sub(lambda m: _year_phrase(m.group(0)), out)
    out = INTEGER_RE.sub(lambda m: _number_phrase(m.group(0)), out)
    out = REPEATED_PUNCT_RE.sub(r"\1", out)
    out = WHITESPACE_RE.sub(" ", out).strip()
    return _cleanup_speech_punctuation(out)
