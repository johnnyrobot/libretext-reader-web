"""Make Speech Rule Engine output sound like a person reading, not a screen reader.

Clearspeak spells a multi-letter subscript letter by letter ("sub s y s"),
which is right for a blind mathematician checking a variable name and wrong
for a listener following a chemistry chapter. This pass is deliberately small
and listed rule by rule; it is English-only by construction and is the seam
where locale work would diverge.

Runs on SRE text only. It never sees prose, so it cannot damage it.
"""

import re

from pipeline.normalize import spell_numbers

# Two or more single letters after "sub", each separated by one space.
SPELLED_SUB_RE = re.compile(r"\bsub ((?:[A-Za-z] )+[A-Za-z])\b")

# "normal Delta": SRE names the mathvariant of \Delta, which a listener never
# needs. Two alternatives follow "normal ", both real mathvariant shapes:
#   [A-Z]        a capitalised Greek name, e.g. "normal Delta".
#   [A-Za-z]\b   a single roman letter set with \mathrm, e.g. \mathrm{d}x ->
#                "normal d x", the standard differential in this material
#                (dU, dq, dw) -- \mathrm{e}, \mathrm{i} and \mathrm{p}H are
#                the same shape. A capital-only anchor missed every one of
#                these; the word survived as "normal d x" in speech.
# Unanchored entirely, this matched the ordinary word "normal" inside any
# \text{}, e.g. \text{normal boiling point} -> "boiling point", silently
# deleting content that was never SRE's mathvariant wording at all -- so the
# alternation stops at a single letter rather than dropping every "normal ".
NORMAL_RE = re.compile(r"\bnormal (?=[A-Z]|[A-Za-z]\b)")

# "1.4 .1": SRE splits a dotted page number at the second dot.
SPLIT_DOTTED_RE = re.compile(r"(\d) \.(\d)")

# A multi-line equation (align, split) is announced by Clearspeak the way a
# screen-reader user navigating a matrix wants to hear it: "2 lines Line 1: ...
# Line 2: ...". A reader listening to a chapter is not navigating; they want the
# derivation read as continuous prose. The three rules below strip the
# scaffolding and leave the maths, joined by the comma-pauses the voice already
# uses between clauses.
#
# The bridge removes \nonumber, which is what put SINGLE-line equations into
# this shape in the first place; these rules are for equations that genuinely
# have several lines.
LINE_COUNT_RE = re.compile(r"^\s*\d+ lines\s*")

# "Line 2: blank equals x" -- a continuation line whose left side is empty,
# which is how every aligned derivation after the first line is written. The
# word "blank" is Clearspeak naming the empty cell; spoken aloud it is noise.
BLANK_LINE_RE = re.compile(r"\s*Line \d+:\s*blank\s*")

LINE_LABEL_RE = re.compile(r"\s*Line \d+:\s*")

# "the fraction with numerator 5 times 25 and denominator 5 times 200".
# Clearspeak falls back to this narration whenever a fraction's parts are
# themselves expressions, and it is how a screen reader spells out structure --
# not how a teacher reads it. "5 times 25 over 5 times 200" says the same thing.
#
# Simple fractions are left alone deliberately: Clearspeak already reads those
# as "one half" and "six sevenths", which is exactly right. The engine cannot be
# configured to do both -- Fraction_Over fixes this narration but degrades
# "one half" into "1 over 2" -- so the terse form is applied here, to the one
# shape that needs it.
GENERAL_FRACTION_RE = re.compile(r"the fraction with numerator (.+?) and denominator ")

# "the repeating decimal 0 point followed by repeating digit 3" is accurate and
# nobody says it. A person reads 0.3 with a vinculum as "0 point 3 repeating".
REPEATING_RE = re.compile(r"the repeating decimal (.+?) followed by repeating digits? ([\d ]+)")

# A literal comma inside an equation is punctuation, and Clearspeak names it:
# "341 R 1 COMMA meaning ...". The voice already pauses at a comma, so give it
# the mark instead of the word.
#
# Anchored on a preceding DIGIT or closing bracket, which is what a maths term
# ends with. A space-only anchor was tried first and was wrong: it rewrote the
# ordinary sentence "insert a comma here" to "insert a, here", eating a real
# word out of any \text{} that discussed punctuation. The narrow anchor cannot,
# because prose does not put a bare digit before the word.
SPOKEN_COMMA_RE = re.compile(r"(?<=[0-9)\]]) comma(?= |$)")


# "0.333 ... = 0.3-bar" makes Clearspeak read the ellipsis as a RANGE: "and so
# on up to equals ...". There is no range here -- the next term is the same
# value written differently -- so the range wording becomes a plain pause.
ELLIPSIS_RANGE_RE = re.compile(r"\band so on up to (?=equals\b)")


def _repeating(match: re.Match) -> str:
    """0.3 with a vinculum -> "0 point 3 repeating"; 0.296 with 412 barred ->
    "0 point 2 9 6, 4 1 2 repeating".

    The comma matters. Without it the two digit runs abut -- "0 point 2 9 6 4 1
    2 repeating" -- and a listener cannot tell where the fixed part ends and the
    repeating part starts, which is the one thing this notation exists to say.
    It is only needed when digits precede the bar; "0 point" alone runs straight
    into the repeating digits with no ambiguity.
    """
    base, digits = match.group(1).rstrip(), match.group(2).strip()
    # SRE spells the INTEGER part of a repeating decimal digit by digit --
    # "3 4 1 point 3 repeating" for 341.3 with a bar. The repeating digits after
    # the point are right to spell out (that is how the notation is read aloud),
    # but the whole number before it is a quantity: "341 point 3 repeating".
    base = re.sub(r"^(\d(?: \d)+) (?=point\b)", lambda m: m.group(1).replace(" ", "") + " ", base)
    joiner = " " if base.endswith("point") else ", "
    return f"{base}{joiner}{digits} repeating "


# ---- chemistry -------------------------------------------------------------
# Clearspeak narrates mhchem as algebra, which is how a reaction ends up read as
# "N sub two times g right harpoon over left harpoon". Measured over chem_4b's
# 5166 spans before any of this: 334 harpoons, 559 "of sub", 640 state labels.
#
# The first three rules below are unguarded because they are wrong in every
# domain: "right harpoon over left harpoon" is only ever the equilibrium arrow,
# "of sub" is not grammatical, and no formula applies one element to the next.
# The rest run only for a chemistry span, because "times s" IS a multiplication
# in algebra and "M" is far more often a matrix than a molarity.
# SRE narrates \rightleftharpoons two ways depending on the source symbol, and
# the second ("left harpoon with barb down ... right harpoon with barb up") is
# unintelligible read aloud. Both become the words a chemist uses.
# The leading "times " is SRE putting a multiplication between the last reactant
# and the arrow symbol; without it the sentence reads "... gas times in
# equilibrium with ...".
# Clearspeak names \Delta the "increment operator" and spells ln letter by
# letter. Both are unambiguous in any domain, so neither is guarded.
INCREMENT_RE = re.compile(r"\bincrement\b")

# Clearspeak names the minus sign "en dash". This is the worst of the residue:
# "equals en dash R T natural log K" drops the negation, so the listener hears
# the opposite of the maths. Unguarded -- a dash in an equation is always minus.
EN_DASH_RE = re.compile(r"\ben dash\b")

# Units come out spelled letter by letter. Chemical FORMULAS do too ("C O" is
# carbon monoxide) and those are correct, so this is an explicit list of units
# rather than a rule about spaced letters.
UNITS = {
    "m o l": "moles", "k J": "kilojoules", "a t m": "atmospheres",
    "m L": "millilitres", "k g": "kilograms", "c m": "centimetres",
    "a q": "aqueous", "k P a": "kilopascals",
}
UNIT_RE = re.compile(r"\b(" + "|".join(sorted(UNITS, key=len, reverse=True)) + r")\b")

# "one atmospheres" reads wrong; Clearspeak has no singular.
_SINGULAR = {"one atmospheres": "one atmosphere", "one moles": "one mole",
             "one kilojoules": "one kilojoule", "one millilitres": "one millilitre",
             "one kilograms": "one kilogram", "one centimetres": "one centimetre"}
SINGULAR_RE = re.compile(r"\b(" + "|".join(_SINGULAR) + r")\b")
NATURAL_LOG_RE = re.compile(r"\bl n\b(?: of)?")

EQUILIBRIUM_RE = re.compile(
    r"(?:\btimes )?(?:"
    r"\bright harpoon over left harpoon\b"
    r"|\bleft harpoon with barb down[a-z ]*?right harpoon with barb up\b)")
OF_SUB_RE = re.compile(r"\bof sub\b")

# `\ce{MgO}` -> "M g of O": Clearspeak reads the juxtaposition as function
# application. Anchored on a LONE letter or a subscript so English survives --
# "the absolute value of D" has a whole word before "of" and cannot match.
FORMULA_OF_RE = re.compile(r"(?<![A-Za-z])([A-Za-z]) of (?=[A-Z])")
SUBSCRIPT_OF_RE = re.compile(r"\b(sub \w+) of (?=[A-Z])")

CHARGE_RE = re.compile(r"\braised to the (plus|minus) power\b")

# A bracket around something formula-shaped is a concentration. Requiring the
# shape is what keeps this off a closed interval or a floor function.
#
# A flat character class, NOT an alternation of repeated groups. The first
# attempt was `((?:[A-Za-z]+|sub \w+|\s)+?)`, whose nested quantifiers backtrack
# catastrophically on any "open bracket" with no "close bracket" after it -- it
# hung the pipeline outright rather than merely being slow.
CONCENTRATION_RE = re.compile(r"\bopen bracket ([A-Za-z0-9 ]{1,60}?) close bracket")
_FORMULA_WORD_RE = re.compile(r"^(?:[A-Za-z]+|sub|raised|to|the|plus|minus|power|\d+| )+$")

STATES = {"g": "gas", "l": "liquid", "s": "solid", "aq": "aqueous"}
STATE_RE = re.compile(
    r"\b(?:times |of )?(?:sub )?open paren (g|l|s|aq) close paren|\b(?:times|of) (g|l|s|aq)\b")
MOLAR_RE = re.compile(r"(?<=[a-z]) M\b")

# "2 NH3" is two molecules of ammonia, not two times ammonia. Chemistry only:
# in algebra "two times x" is exactly what is meant.
# "O sub two" is not how O2 is read aloud; a chemist says "O two". Only before a
# NUMBER: K_c really is "K sub c", and dropping it there would give "K c".
NUMBER_WORD = (r"zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|"
               r"thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|"
               r"thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred")
CHEM_SUBSCRIPT_RE = re.compile(rf"\bsub (?=(?:{NUMBER_WORD})\b|\d)")

# A subscripted condition: K_{(700 K)} is "K at 700 kelvin", not "K sub open
# paren seven hundred K close paren". Runs before the general paren strip.
CONDITION_RE = re.compile(r"\bsub open paren ([a-z ]+?) K close paren")

# Parentheses in a formula carry no meaning a listener needs -- P_{CO} became
# "P of open paren C O close paren". Algebra keeps them, where they are the
# whole point of "(x + 1)(x - 1)".
# Once "sub s y s" is joined to "sub sys", the listener is no better off:
# Supertonic has no entry for "sys" and guesses from spelling, so it says
# "subsidiz"; "univ" comes out "subunit". Both were audible on chem_4b 5.7.
#
# An EXPLICIT LIST, for the same reason UNITS is one: an arbitrary multi-letter
# subscript is a variable name and must stay read as one. These are the standard
# thermodynamic and equilibrium subscripts, 959 occurrences over 61 pages of
# chem_4b. Unguarded -- none of these spellings means anything else in any
# domain, and math_elem_teachers contains none of them.
#
# The preposition is part of the value, not bolted on afterwards, because it is
# not uniform: a chemist says "delta H OF reaction" but "K solubility product".
SUBSCRIPT_WORDS = {
    "rxn": "of reaction",
    "sys": "of the system",
    "univ": "of the universe",
    "surr": "of the surroundings",
    "vap": "of vaporisation",
    "fus": "of fusion",
    "comb": "of combustion",
    "soln": "of solution",
    "sp": "solubility product",
    "eq": "equilibrium",
    "rev": "reversible",
    "total": "total",
    "aq": "aqueous",
}
SUBSCRIPT_WORD_RE = re.compile(
    r"\bsub (" + "|".join(sorted(SUBSCRIPT_WORDS, key=len, reverse=True)) + r")\b")

PAREN_RE = re.compile(r"\b(?:of )?open paren (.+?) close paren")

COEFFICIENT_RE = re.compile(
    r"\b(one|two|three|four|five|six|seven|eight|nine|ten) times (?=[A-Z])")


def _state(match: re.Match) -> str:
    return STATES[match.group(1) or match.group(2)]


def chemistry(speech: str, chem: bool) -> str:
    """The rules above, in the order the narration builds them up."""
    out = EQUILIBRIUM_RE.sub("in equilibrium with", speech)
    out = INCREMENT_RE.sub("delta", out)
    out = EN_DASH_RE.sub("minus", out)
    out = NATURAL_LOG_RE.sub("natural log", out)
    out = OF_SUB_RE.sub("sub", out)
    out = SUBSCRIPT_OF_RE.sub(r"\1 ", out)
    out = FORMULA_OF_RE.sub(r"\1 ", out)
    # After OF_SUB_RE: "H of sub rxn" must lose its first preposition before the
    # table adds one, or it reads "H of of reaction".
    out = SUBSCRIPT_WORD_RE.sub(lambda m: SUBSCRIPT_WORDS[m.group(1)], out)
    out = CHARGE_RE.sub(r"\1", out)
    out = CONCENTRATION_RE.sub(
        lambda m: f"the concentration of {m.group(1).strip()}"
        if _FORMULA_WORD_RE.match(m.group(1)) else m.group(0), out)
    if chem:
        out = STATE_RE.sub(_state, out)
        out = CONDITION_RE.sub(r"at \1 kelvin", out)
        out = PAREN_RE.sub(r"\1", out)
        out = CHEM_SUBSCRIPT_RE.sub("", out)
        out = COEFFICIENT_RE.sub(r"\1 ", out)
        out = UNIT_RE.sub(lambda m: UNITS[m.group(1)], out)
        out = SINGULAR_RE.sub(lambda m: _SINGULAR[m.group(1)], out)
        out = MOLAR_RE.sub(" molar", out)
    return out


def phrase(speech: str, display: bool, chem: bool = False) -> str:
    out = SPELLED_SUB_RE.sub(lambda m: "sub " + m.group(1).replace(" ", ""), speech)
    out = SPLIT_DOTTED_RE.sub(r"\1.\2", out)
    out = NORMAL_RE.sub("", out)
    out = LINE_COUNT_RE.sub("", out)
    out = BLANK_LINE_RE.sub(", ", out)
    out = LINE_LABEL_RE.sub(", ", out)
    out = GENERAL_FRACTION_RE.sub(r"\1 over ", out)
    out = REPEATING_RE.sub(_repeating, out)
    out = ELLIPSIS_RANGE_RE.sub("and so on, ", out)
    out = SPOKEN_COMMA_RE.sub(",", out)
    out = re.sub(r"\s+,", ",", out)
    out = re.sub(r",\s*,", ",", out)
    # Last, because SPOKEN_COMMA_RE above anchors on a literal digit and would
    # stop matching once the digits are words.
    out = spell_numbers(out)
    # AFTER spell_numbers, not before. SRE hands us "2 times NH sub 3", so a
    # coefficient rule written against word-numbers sees a digit and never
    # fires, and MOLAR_RE's "lowercase letter before M" never matches "188 M".
    # Both looked correct in isolation and did nothing on real input.
    out = chemistry(out, chem)
    out = out.strip().strip(",").strip()
    # A display equation stands on its own line; the commas are the pause a
    # reader takes before and after it.
    if display and out:
        out = f", {out},"
    return out
