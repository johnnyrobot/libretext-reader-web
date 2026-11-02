"""Spanish spoken-form normalisation of TRANSLATED text.

Every expectation here is Spanish-as-spoken, not Spanish-as-written: the output
of this module is handed to the voice, so `1999` must arrive as words. The four
cases the plan named come first; the rest exist because a number-to-words
function is exactly the kind of code that is 95% right and wrong on the five
irregular forms nobody remembers (16, 21, 100, 500, 700, 900).
"""

import re

import pytest

from pipeline.lang_normalize import NORMALIZERS, normalize_es_for_speech


@pytest.mark.parametrize(
    "source,expected",
    [
        ("Sidanius, J., & Pratto, F. (1999).",
         "Sidanius, J., & Pratto, F. (mil novecientos noventa y nueve)."),
        ("El estudio costó $1,200.", "El estudio costó mil doscientos dólares."),
        ("El 68% de los participantes cumplió.",
         "El sesenta y ocho por ciento de los participantes cumplió."),
        ("Jost et al. (2003) encontraron que...",
         "Jost y otros (dos mil tres) encontraron que..."),
    ],
)
def test_normalizes_translated_spanish_for_speech(source, expected):
    assert normalize_es_for_speech(source) == expected


def test_registry_exposes_spanish():
    assert NORMALIZERS["es"] is normalize_es_for_speech


def test_a_language_with_no_normaliser_yet_falls_back_to_identity():
    """Rolling out language by language must not block languages that don't have
    one yet -- an unregistered code returns its input unchanged, same as today's
    behaviour before this task existed.

    The example was "fr" until 2026-08-25 and "de" until 2026-08-27, and each
    time it failed loudly the day that language shipped, which is what it is
    for. Polish is the durable choice rather than the next convenient one: no
    `Xenova/opus-mt-en-pl` export exists, and gate 1 of shipping a language is
    an ONNX export, so `pl` cannot quietly acquire a normaliser the way `fr` and
    `de` did. It is also in pipeline.languages.HIGHER_RISK."""
    assert "pl" not in NORMALIZERS
    assert NORMALIZERS.get("pl", lambda t: t)("Witaj 1999.") == "Witaj 1999."


@pytest.mark.parametrize(
    "source,expected",
    [
        # The regular spine.
        ("0 casos", "cero casos"),
        ("2 casos", "dos casos"),
        ("15 casos", "quince casos"),
        # Irregulars that a naive TENS + ONES join gets wrong: 16-19 and 21-29
        # are single words in Spanish, not "diez y seis" / "veinte y uno".
        ("16 casos", "dieciséis casos"),
        ("19 casos", "diecinueve casos"),
        ("21 casos", "veintiuno casos"),
        ("22 casos", "veintidós casos"),
        ("26 casos", "veintiséis casos"),
        # From 31 up the joiner IS "y", and it is a separate word.
        ("31 casos", "treinta y uno casos"),
        ("68 casos", "sesenta y ocho casos"),
        # 100 exactly is "cien"; anything above it is "ciento ...".
        ("100 casos", "cien casos"),
        ("101 casos", "ciento uno casos"),
        ("199 casos", "ciento noventa y nueve casos"),
        # The hundreds are irregular at 5, 7 and 9 -- not "cincocientos".
        ("200 casos", "doscientos casos"),
        ("500 casos", "quinientos casos"),
        ("700 casos", "setecientos casos"),
        ("900 casos", "novecientos casos"),
        # 1000 is bare "mil", never "un mil".
        ("1,000 casos", "mil casos"),
        ("1,200 casos", "mil doscientos casos"),
        ("2,415 casos", "dos mil cuatrocientos quince casos"),
        # "uno" apocopates to "un" directly before mil/millones.
        ("21,000 casos", "veintiún mil casos"),
        ("1,000,000 casos", "un millón casos"),
        ("2,000,000 casos", "dos millones casos"),
    ],
)
def test_spanish_cardinals(source, expected):
    assert normalize_es_for_speech(source) == expected


@pytest.mark.parametrize(
    "source,expected",
    [
        # Task 15 measured the plain cardinal, NOT English's century split:
        # Opus-MT's own correct output for 1961 was "mil novecientos sesenta y
        # uno", never "diecinueve sesenta y uno".
        ("en 1961.", "en mil novecientos sesenta y uno."),
        ("en 1900.", "en mil novecientos."),
        ("en 1993.", "en mil novecientos noventa y tres."),
        ("en 2000.", "en dos mil."),
        ("en 2010.", "en dos mil diez."),
    ],
)
def test_spanish_years_are_plain_cardinals(source, expected):
    assert normalize_es_for_speech(source) == expected


@pytest.mark.parametrize(
    "source,expected",
    [
        # The measured Opus-MT output puts a space after the sign ("$ 1,200"),
        # so the space is optional, not required.
        ("costó $15.50 por sesión.", "costó quince dólares y cincuenta centavos por sesión."),
        ("costó $ 15.50 por sesión.", "costó quince dólares y cincuenta centavos por sesión."),
        ("costó $1 por sesión.", "costó un dólar por sesión."),
        ("costó $21 por sesión.", "costó veintiún dólares por sesión."),
        ("costó $100 por sesión.", "costó cien dólares por sesión."),
        ("costó $15.00 por sesión.", "costó quince dólares por sesión."),
    ],
)
def test_spanish_currency(source, expected):
    assert normalize_es_for_speech(source) == expected


@pytest.mark.parametrize(
    "source,expected",
    [
        ("el 82% de los ensayos", "el ochenta y dos por ciento de los ensayos"),
        ("el 82 % de los ensayos", "el ochenta y dos por ciento de los ensayos"),
        ("el 61,5% de los ensayos", "el sesenta y uno coma cinco por ciento de los ensayos"),
    ],
)
def test_spanish_percentages(source, expected):
    assert normalize_es_for_speech(source) == expected


def test_et_al_is_the_one_abbreviation_with_a_rule():
    """Task 15 measured `e.g.,` and `i.e.,` translating correctly UNAIDED into
    `por ejemplo` / `es decir`, and only `et al.` failing -- twice, reproducibly.
    The rest of normalize.py's English ABBREVIATIONS table is deliberately not
    ported; each entry has to be measured the same way before it earns a rule."""
    assert normalize_es_for_speech("Jost et al. encontraron") == "Jost y otros encontraron"
    assert normalize_es_for_speech("por ejemplo, la equidad") == "por ejemplo, la equidad"
    assert normalize_es_for_speech("es decir, el propio grupo") == "es decir, el propio grupo"


def test_protected_placeholders_survive_normalisation():
    """This runs BEFORE pipeline.protect.restore(), so every URL, email address
    and math token is still a `[[KIND0]]` placeholder here. If a number pass
    ever bit into one, restore() would raise and the sentence would silently
    fall back to English -- the exact failure R42 just finished fixing."""
    out = normalize_es_for_speech("Véase [[URL0]] y [[MATH12]] en 1999.")
    assert out == "Véase [[URL0]] y [[MATH12]] en mil novecientos noventa y nueve."


def test_a_spanish_decimal_comma_is_not_read_as_a_thousands_group():
    """`1,200` is an English thousands group (three digits after the comma);
    `1,25` cannot be, so it is a decimal comma. Getting this backwards turns
    1.25 into 125 -- a wrong VALUE, the worst class of defect in Task 15's
    findings."""
    assert normalize_es_for_speech("un valor de 1,25") == "un valor de uno coma dos cinco"
    assert normalize_es_for_speech("un valor de 1,250") == "un valor de mil doscientos cincuenta"


def test_a_decimal_is_read_digit_by_digit_after_the_separator():
    """Digit-by-digit on BOTH separators, deliberately. Reading the fraction as
    a cardinal ("coma veinticinco") is idiomatic for money but produces a wrong
    value for anything else -- 1,205 would become "coma doscientos cinco". The
    separator word tracks what is actually written: the converted
    opus-mt-tc-big-en-es checkpoint's own Spanish for a dotted DOI was "diez
    punto uno uno" (Task 15, b92s2), so a dot reads "punto"."""
    assert normalize_es_for_speech("p = 0.05") == "p = cero punto cero cinco"


def test_text_with_no_numbers_is_returned_unchanged():
    text = "La cooperación intergrupal reduce el prejuicio."
    assert normalize_es_for_speech(text) == text


@pytest.mark.parametrize(
    "source,expected",
    [
        # The real failure this rule exists for: the checkpoint collapses an
        # en-dash page range into one digit run, and reading that as a cardinal
        # invents a value seven orders of magnitude off.
        ("páginas 4064412.", "páginas cuatro cero seis cuatro cuatro uno dos."),
        ("doi: 10.1177/0956797611398495.",
         "doi: diez punto uno uno siete siete/cero nueve cinco seis siete nueve "
         "siete seis uno uno tres nueve ocho cuatro nueve cinco."),
        # A leading zero is an identifier tell at any length -- and a cardinal
        # reading deletes it outright.
        ("la sala 007.", "la sala cero cero siete."),
        # A thousands separator is the signal that a run IS a quantity, so a
        # grouped number keeps its cardinal reading however long it gets.
        ("2,415 casos", "dos mil cuatrocientos quince casos"),
        ("1,000,000 casos", "un millón casos"),
        # Under the threshold, still a quantity.
        ("406 páginas", "cuatrocientos seis páginas"),
        ("1961 en el texto", "mil novecientos sesenta y uno en el texto"),
    ],
)
def test_long_ungrouped_digit_runs_are_read_as_identifiers(source, expected):
    assert normalize_es_for_speech(source) == expected


# ---------------------------------------------------------------------------
# French (design §12 open decision 1: fr is the second pair to ship, 2026-08-25)
#
# NOT a copy of the Spanish cases with different words. The en-fr checkpoint was
# measured before any of these were written, and it LOCALISES number formats
# where the en-es one preserved English ones:
#
#     $1,200        -> "1 200 $"          thousands separated by U+0020, sign after
#     $15.50        -> "15,50 dollars"    decimal COMMA, unit spelled out
#     68%           -> "68 %"             space before the sign
#     p = 0.05      -> "p = 0,05"         decimal COMMA
#     et al.        -> "et al."           correct French already; no rule earned
#     e.g. / i.e.   -> "par exemple" / "c'est-à-dire"
#
# The space-grouped thousand is the dangerous one: `1 200` read as two numbers is
# "un deux cents", a wrong VALUE. Measured against the 9,430 attempted sentences,
# a "N NNN" adjacency that is NOT a grouped thousand occurs 0 times, while a
# grouped thousand occurs 15 times -- so the rule is worth having here. That is a
# fact about this corpus and French typography, not a universal one.
# ---------------------------------------------------------------------------

from pipeline.lang_normalize import normalize_fr_for_speech  # noqa: E402


def test_registry_exposes_french():
    assert NORMALIZERS["fr"] is normalize_fr_for_speech


@pytest.mark.parametrize("source,expected", [
    ("0 cas", "zéro cas"),
    ("2 cas", "deux cas"),
    ("16 cas", "seize cas"),
    # 17-19 are built, not listed: dix-sept, not a single word.
    ("17 cas", "dix-sept cas"),
    ("19 cas", "dix-neuf cas"),
    # "et" at 21/31/41/51/61 and at 71 -- and NOT at 81 or 91.
    ("21 cas", "vingt et un cas"),
    ("22 cas", "vingt-deux cas"),
    ("31 cas", "trente et un cas"),
    ("68 cas", "soixante-huit cas"),
    # 70-79 is 60 + 10..19, which is why 71 is "soixante et onze".
    ("70 cas", "soixante-dix cas"),
    ("71 cas", "soixante et onze cas"),
    ("72 cas", "soixante-douze cas"),
    ("79 cas", "soixante-dix-neuf cas"),
    # 80 alone takes the plural s; 81-99 do not, and 90-99 is 80 + 10..19.
    ("80 cas", "quatre-vingts cas"),
    ("81 cas", "quatre-vingt-un cas"),
    ("90 cas", "quatre-vingt-dix cas"),
    ("91 cas", "quatre-vingt-onze cas"),
    ("99 cas", "quatre-vingt-dix-neuf cas"),
    # "cent" takes an s only when nothing follows it.
    ("100 cas", "cent cas"),
    ("101 cas", "cent un cas"),
    ("200 cas", "deux cents cas"),
    ("201 cas", "deux cent un cas"),
    ("180 cas", "cent quatre-vingts cas"),
    # "mille" is invariable and never carries "un".
    ("1 000 cas", "mille cas"),
    ("2 000 cas", "deux mille cas"),
    ("1 200 cas", "mille deux cents cas"),
    ("21 000 cas", "vingt et un mille cas"),
    ("1 000 000 cas", "un million cas"),
    ("2 000 000 cas", "deux millions cas"),
])
def test_french_cardinals(source, expected):
    assert normalize_fr_for_speech(source) == expected


@pytest.mark.parametrize("source,expected", [
    ("en 1961.", "en mille neuf cent soixante et un."),
    ("en 1900.", "en mille neuf cents."),
    ("en 2000.", "en deux mille."),
    ("en 2010.", "en deux mille dix."),
])
def test_french_years_are_plain_cardinals(source, expected):
    assert normalize_fr_for_speech(source) == expected


@pytest.mark.parametrize("source,expected", [
    # Both measured output shapes, and only those two.
    ("a coûté 1 200 $ au total.", "a coûté mille deux cents dollars au total."),
    ("a coûté 1 $ au total.", "a coûté un dollar au total."),
    ("Il coûte 15,50 dollars par session.",
     "Il coûte quinze dollars et cinquante cents par session."),
])
def test_french_currency(source, expected):
    assert normalize_fr_for_speech(source) == expected


@pytest.mark.parametrize("source,expected", [
    ("68 % des participants", "soixante-huit pour cent des participants"),
    ("68% des participants", "soixante-huit pour cent des participants"),
])
def test_french_percentages(source, expected):
    assert normalize_fr_for_speech(source) == expected


def test_french_decimals_use_virgule_and_read_digit_by_digit():
    assert normalize_fr_for_speech("le seuil p = 0,05") == "le seuil p = zéro virgule zéro cinq"
    # A DOT between digits is not a French decimal -- it is a DOI or a version.
    assert normalize_fr_for_speech("doi: 10.1177") == "doi: dix point un un sept sept"


def test_french_leaves_et_al_alone():
    """MEASURED, not assumed. The Spanish rule exists because the en-es
    checkpoint failed on `et al.` twice, reproducibly. The en-fr checkpoint
    passes it through unchanged, and `et al.` IS the correct form in French
    academic prose, so no rule is earned here. Same discipline, opposite result."""
    assert normalize_fr_for_speech("Jost et al. ont trouvé") == "Jost et al. ont trouvé"


def test_french_protects_placeholders_and_identifiers():
    assert normalize_fr_for_speech("Voir [[URL0]] en 1999.") == \
        "Voir [[URL0]] en mille neuf cent quatre-vingt-dix-neuf."
    assert normalize_fr_for_speech("pages 4064412.") == \
        "pages quatre zéro six quatre quatre un deux."
    assert normalize_fr_for_speech("la salle 007.") == "la salle zéro zéro sept."


def test_french_text_with_no_numbers_is_unchanged():
    text = "La coopération intergroupe réduit les préjugés."
    assert normalize_fr_for_speech(text) == text


# ---------------------------------------------------------------------------
# A decimal written without its leading zero. NOT per-language: every registered
# normaliser read `.30` as THIRTY before this, a wrong VALUE, in five languages
# that were already live.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("code", sorted(NORMALIZERS))
def test_a_decimal_without_its_leading_zero_reads_as_the_written_out_form(code):
    """The whole specification, as an equivalence rather than a word list:
    `.30` must read exactly as `0.30` does in that language. That is what makes
    this fix incapable of inventing a reading -- it restores the zero and each
    language's own decimal rule does the rest -- and what makes it correct for
    the next language without another constant.

    MEASURED on the deployed corpora: nl 5, hu 4, da 4, it 4, sv 4, fr 3
    occurrences, all of them correlation coefficients (`r = .30`, `omkring .7`).
    """
    normalize = NORMALIZERS[code]
    assert normalize("r = .30 och") == normalize("r = 0.30 och")
    assert normalize("omkring .7 av") == normalize("omkring 0.7 av")
    # ...and it really did change something: a bare digit must not survive.
    assert not re.search(r"\d", normalize("r = .30 och"))


@pytest.mark.parametrize("code", sorted(NORMALIZERS))
def test_restoring_a_leading_zero_does_not_touch_a_dot_after_a_word(code):
    """`Fig.2` must not become `Fig0.2` and `1.3` must not become `10.3`. The
    lookbehind excludes a WORD character, not merely a digit."""
    normalize = NORMALIZERS[code]
    assert "0.2" not in normalize("se Fig.2 nedan")
    assert normalize("figur 1.3 visar") == normalize("figur 1.3 visar")
    assert "10.3" not in normalize("figur 1.3 visar")


# ---------------------------------------------------------------------------
# German. The EIGHTH language, and the fifth distinct number convention. It is
# neither Spanish (English forms preserved) nor French/Italian (comma decimals
# throughout): en-de LOCALISES the thousands group to a dot 20 times while
# leaving 328 short dot forms alone, and emits 5 comma decimals in the measured
# corpus. THOSE NUMBERS WERE 17, 15 AND 1 HERE UNTIL 2026-08-28: they were
# measure.py's 12-examples-per-bucket sample, which the same commit had already
# corrected in pipeline/lang_normalize.py and in the test below without fixing
# this header. bench/formats/de.json holds the counts every rule below is
# drawn from.
# ---------------------------------------------------------------------------

from pipeline.lang_normalize import normalize_de_for_speech  # noqa: E402


def test_registry_exposes_german():
    assert NORMALIZERS["de"] is normalize_de_for_speech


@pytest.mark.parametrize("source,expected", [
    ("0 Fälle", "null Fälle"),
    ("2 Fälle", "zwei Fälle"),
    ("7 Fälle", "sieben Fälle"),
    # The irregular teens, which a TENS + ONES join gets wrong: German drops the
    # "s" of sechs and the "en" of sieben before "zehn".
    ("16 Fälle", "sechzehn Fälle"),
    ("17 Fälle", "siebzehn Fälle"),
    ("19 Fälle", "neunzehn Fälle"),
    ("20 Fälle", "zwanzig Fälle"),
    # THE UNIT GOES FIRST AND THE JOINER IS "und" -- einundzwanzig, not
    # "zwanzigeins". Swedish puts the ten first with no joiner, so this is the
    # one rule a port from the language shipped immediately before this gets
    # wrong on every number between 21 and 99.
    ("21 Fälle", "einundzwanzig Fälle"),
    ("22 Fälle", "zweiundzwanzig Fälle"),
    ("35 Fälle", "fünfunddreißig Fälle"),
    ("68 Fälle", "achtundsechzig Fälle"),
    ("99 Fälle", "neunundneunzig Fälle"),
    # The same two elisions again in the tens, plus dreißig's ß -- the only
    # ten that is not spelled with "zig".
    ("30 Fälle", "dreißig Fälle"),
    ("60 Fälle", "sechzig Fälle"),
    ("70 Fälle", "siebzig Fälle"),
    ("100 Fälle", "hundert Fälle"),
    ("101 Fälle", "hunderteins Fälle"),
    ("200 Fälle", "zweihundert Fälle"),
    ("512 Fälle", "fünfhundertzwölf Fälle"),
    ("1000 Fälle", "tausend Fälle"),
    # German writes a whole number as ONE word, as Swedish does and as Danish
    # does not. Per language, not per family.
    ("2500 Fälle", "zweitausendfünfhundert Fälle"),
    ("8000 Fälle", "achttausend Fälle"),
    ("100.000 Fälle", "hunderttausend Fälle"),
    ("40.320 Fälle", "vierzigtausenddreihundertzwanzig Fälle"),
    ("1.000.000 Fälle", "eine Million Fälle"),
])
def test_german_cardinals(source, expected):
    assert normalize_de_for_speech(source) == expected


def test_german_reads_a_dot_group_of_exactly_three_digits_as_thousands():
    """20 real thousands groups against 328 short dot forms, over all 9,430
    sentences -- Italian's split (20 against 335) almost exactly. An earlier
    revision of this docstring said 17 against 15 and called it near parity;
    that was measure.py's 12-examples-per-bucket sample, not the corpus."""
    assert normalize_de_for_speech("über 8.000 Morde") == "über achttausend Morde"
    assert normalize_de_for_speech("über 20.000 Forscher") == "über zwanzigtausend Forscher"
    assert normalize_de_for_speech("(das sind 40.320)") == \
        "(das sind vierzigtausenddreihundertzwanzig)"


def test_german_reads_a_short_dot_group_as_a_section_number():
    assert normalize_de_for_speech("Abbildung 1.3 Der") == "Abbildung eins Punkt drei Der"
    assert normalize_de_for_speech("CC BY 2.0.") == "CC BY zwei Punkt null."


def test_german_reads_percent_with_and_without_a_space():
    """MEASURED, and neither French's constant nor Italian's would do: en-de
    writes `20 %` 24 times and `35%` 54 times in the same corpus, sometimes in
    the same sentence. A rule taken from either half alone is wrong for at
    least a third of them."""
    assert normalize_de_for_speech("20 % der Jugendlichen") == "zwanzig Prozent der Jugendlichen"
    assert normalize_de_for_speech("54% der LGBT-Jugend") == "vierundfünfzig Prozent der LGBT-Jugend"
    assert normalize_de_for_speech("etwa 99 % der") == "etwa neunundneunzig Prozent der"


def test_german_says_ein_not_eins_before_a_unit_noun():
    """`1 %` is "ein Prozent" in German, never "eins Prozent" -- the numeral
    agrees with the noun. This module inserts that noun itself, so it is the one
    place agreement can be got right without a declension system."""
    assert normalize_de_for_speech("machte nur 1 % aus") == "machte nur ein Prozent aus"
    assert normalize_de_for_speech("für $1") == "für ein Dollar"


@pytest.mark.parametrize("source,expected", [
    ("für $50.", "für fünfzig Dollar."),
    ("hatten eine Rechnung von $5", "hatten eine Rechnung von fünf Dollar"),
    ("bekommt $60", "bekommt sechzig Dollar"),
])
def test_german_currency(source, expected):
    assert normalize_de_for_speech(source) == expected


def test_german_reads_the_one_comma_decimal_the_checkpoint_emits():
    """FIVE comma decimals in 9,430 sentences (8,3 / 14,4 / 28,5 / 40,0 / 51,8)
    against 328 preserved English dot decimals -- which is why German is not
    French. Every one is 1-2 fraction digits and no English thousands comma
    survives anywhere in the corpus, which is what licenses the uncapped rule."""
    assert normalize_de_for_speech("löschte 8,3 Billionen Dollar") == \
        "löschte acht Komma drei Billionen Dollar"


def test_german_does_not_invent_a_long_scale_word():
    """German "Billion" is 10^12 and English "billion" is 10^9, so any mapping
    of the English word onto the German one is wrong by a factor of a thousand.
    The checkpoint already gets this right unaided -- `100 billion neurons` ->
    `100 Milliarden`, `$8.3 trillion` -> `8,3 Billionen` -- so the scale word is
    passed through and only its numeral is read."""
    assert normalize_de_for_speech("etwa 100 Milliarden Neuronen") == \
        "etwa hundert Milliarden Neuronen"


@pytest.mark.parametrize("source,expected", [
    ("Jahr 1961.", "Jahr neunzehnhunderteinundsechzig."),
    ("Jahr 1900.", "Jahr neunzehnhundert."),
    ("März 1997", "März neunzehnhundertsiebenundneunzig"),
    ("Jahr 2010.", "Jahr zweitausendzehn."),
])
def test_german_years_are_read_by_hundreds_below_2000(source, expected):
    assert normalize_de_for_speech(source) == expected


def test_german_leaves_et_al_alone():
    """Preserved 60 times out of 60 in the measured corpus, and read as words --
    the same standard that earned Spanish a rule and denied French one."""
    assert normalize_de_for_speech("Daten stammen von Berman et al. (2009).") == \
        "Daten stammen von Berman et al. (zweitausendneun)."


def test_german_protects_placeholders_and_identifiers():
    assert normalize_de_for_speech("Siehe [[URL0]] im Jahr 1999.") == \
        "Siehe [[URL0]] im Jahr neunzehnhundertneunundneunzig."
    assert normalize_de_for_speech("Seite 4064412.") == \
        "Seite vier null sechs vier vier eins zwei."


def test_german_reads_an_ordinal_as_a_cardinal_and_that_is_a_recorded_gap():
    """RECORDED, NOT FIXED. German marks an ordinal with a trailing dot -- `20.
    Jahrhundert`, `26. März`, `42. Straße` -- and reading it correctly needs
    declension ("zwanzigsten", not "zwanzig"), which is the whole ordinal-stem
    system Hungarian's `42-ik` was also denied. Worse, that dot is
    indistinguishable from a sentence-final period before a capitalised German
    noun, so a rule would have to solve sentence segmentation first.

    This asserts the CURRENT reading so the day someone builds that system, the
    change is visible rather than silent. The numeral is right and its ending is
    missing; the year beside it is still read correctly."""
    assert normalize_de_for_speech("im 20. Jahrhundert") == "im zwanzig. Jahrhundert"
    assert normalize_de_for_speech("Am 26. März 1997 wurden") == \
        "Am sechsundzwanzig. März neunzehnhundertsiebenundneunzig wurden"


def test_german_text_with_no_numbers_is_unchanged():
    text = "Zusammenarbeit zwischen Gruppen verringert Vorurteile."
    assert normalize_de_for_speech(text) == text


def test_german_reads_a_decade_suffix_rather_than_leaving_its_digits():
    """FOUND BY THE WHOLE-TRACK AUDIT, not by the unit tests: 23 occurrences of
    `1970er` / `40er` reached the voice as RAW DIGITS.

    German glues the decade suffix straight onto the numeral where Swedish
    hyphenates it (`1960-talet`), so the check for a hyphen construction --
    which German genuinely lacks -- reported nothing and the phenomenon was
    still there. No `\\b`-anchored rule can see `1970er`: the boundary between
    `0` and `e` does not exist, so neither the year pass nor the integer pass
    matched and the digits survived untouched."""
    assert normalize_de_for_speech("In den 1970er und 1980er Jahren") == \
        "In den neunzehnhundertsiebziger und neunzehnhundertachtziger Jahren"
    assert normalize_de_for_speech("in den 40er Jahren") == "in den vierziger Jahren"
    assert normalize_de_for_speech("die 1950er Jahre") == "die neunzehnhundertfünfziger Jahre"


def test_german_decade_rule_does_not_touch_an_identifier():
    """The same corpus carries `497px`, `DSC01311`, `LindaDee2006`, `8f` and
    `83bf` -- image filenames and credits. The decade rule matches the suffix
    `er` exactly, so a digit run glued to any other letters stays as it is."""
    for text in ("Fenix_21 – DSC01311 – CC BY-NC-ND", "ein 497px breites Bild",
                 "LindaDee2006 und 83bf"):
        assert normalize_de_for_speech(text) == text


def test_german_expands_the_two_abbreviations_that_read_as_letters():
    """MEASURED over all 9,430 sentences: `z.B.` 103 times and `d.h.` 38, both
    in the spaced and unspaced spellings. Same standard as the Spanish `et al.`
    rule and the Swedish `m.fl.` one -- a dot-separated abbreviation is read out
    as letters by the voice. Swedish earned its rule at 29 occurrences; this is
    141."""
    assert normalize_de_for_speech("Wissen (z.B. unser Wissen)") == \
        "Wissen (zum Beispiel unser Wissen)"
    assert normalize_de_for_speech("etwa z. B. wenn") == "etwa zum Beispiel wenn"
    assert normalize_de_for_speech("d.h. über 7 Millionen") == \
        "das heißt über sieben Millionen"


def test_german_leaves_author_initials_alone():
    """The reason the rule above names two literal strings rather than matching
    the dotted-abbreviation SHAPE: the same corpus carries `B. F.`, `R. H.` and
    `R. J.` -- author initials in citations -- which have the identical shape
    and must survive. `et al.` (100 occurrences) is left alone for the measured
    reason that it already reads as words."""
    text = "Skinner, B. F. und Fazio, R. H. et al. (1998)"
    assert normalize_de_for_speech(text) == \
        "Skinner, B. F. und Fazio, R. H. et al. (neunzehnhundertachtundneunzig)"




# ---------------------------------------------------------------------------
# Portuguese (LT-217). Brazilian, because the en-pt export writes Brazilian --
# "colônias", "US$" -- and the voice reads what the translator writes. Shapes
# measured on 146 corpus sentences translated one at a time by
# Douglasrambo/opus-mt-tc-big-en-pt-onnx; there is no deployed pt track.
# ---------------------------------------------------------------------------

from pipeline.lang_normalize import normalize_pt_for_speech  # noqa: E402


def test_portuguese_is_registered():
    assert NORMALIZERS["pt"] is normalize_pt_for_speech


@pytest.mark.parametrize("source,expected", [
    ("0 casos", "zero casos"),
    ("14 casos", "catorze casos"),
    # Brazilian teens: dezesseis, not the European dezasseis.
    ("16 casos", "dezesseis casos"),
    ("19 casos", "dezenove casos"),
    # Tens and units are joined with "e", hundreds and tens too.
    ("21 casos", "vinte e um casos"),
    # Exactly 100 is "cem"; anything above it is "cento e ...".
    ("100 casos", "cem casos"),
    ("101 casos", "cento e um casos"),
    ("500 casos", "quinhentos casos"),
    ("999 casos", "novecentos e noventa e nove casos"),
    # 1000 is "mil", never "um mil".
    ("1000 casos", "mil casos"),
    # "e" after mil only when what follows is under 100 or a round hundred.
    ("1200 casos", "mil e duzentos casos"),
    ("1250 casos", "mil duzentos e cinquenta casos"),
    ("2019 casos", "dois mil e dezenove casos"),
])
def test_portuguese_cardinals(source, expected):
    assert normalize_pt_for_speech(source) == expected


def test_portuguese_years_are_plain_cardinals():
    """`1776` is read as the number, as in Spanish -- "mil setecentos e setenta
    e seis" -- and `década de 1990` is what en-pt writes for "the 1990s"."""
    assert normalize_pt_for_speech("Em 1776, 13 colônias declararam independência.") == \
        "Em mil setecentos e setenta e seis, treze colônias declararam independência."
    assert normalize_pt_for_speech("na década de 1990.") == \
        "na década de mil novecentos e noventa."


@pytest.mark.parametrize("source,expected", [
    # Thousands are a DOT, decimals a COMMA: "1.200 alunos", "0,5 kg".
    ("dos 1.200 alunos", "dos mil e duzentos alunos"),
    ("Pesa 0,5 kg", "Pesa zero vírgula cinco kg"),
    # A leaked English comma group, measured: "$1,250" came back "1,250
    # dólares". Exactly three digits after the comma is a group, not a decimal;
    # every decimal measured had one or two.
    ("custava 1,250 reais", "custava mil duzentos e cinquenta reais"),
    # A short dot is KEPT from English, as in German: "Tabela 1.3", "3.14".
    ("Tabela 1.3 Exemplos", "Tabela um ponto três Exemplos"),
    ("de 3.14 para", "de três ponto um quatro para"),
    # A grouped number is a quantity however long; an ungrouped long run is an
    # identifier and is read digit by digit.
    ("1.000.000 casos", "um milhão casos"),
    ("1246120 e", "um dois quatro seis um dois zero e"),
    ("pesa 1.234,5 kg", "pesa mil duzentos e trinta e quatro vírgula cinco kg"),
    # The English form leaked through: still one amount, its dot the decimal.
    ("pesa 1,250.5 kg", "pesa mil duzentos e cinquenta vírgula cinco kg"),
    ("cresceu 1,250.5%", "cresceu mil duzentos e cinquenta vírgula cinco por cento"),
])
def test_portuguese_separators(source, expected):
    assert normalize_pt_for_speech(source) == expected


@pytest.mark.parametrize("source,expected", [
    # The amount after the number, spelled out, with a decimal comma.
    ("O bilhete custava 12,50 dólares.",
     "O bilhete custava doze dólares e cinquenta centavos."),
    ("o livro custava 1,250 dólares.", "o livro custava mil duzentos e cinquenta dólares."),
    ("custou 1 dólar", "custou um dólar"),
    # The sign before it: "US$", "US $" and a bare "$" were all measured.
    ("custou US$ 12,50.", "custou doze dólares e cinquenta centavos."),
    ("custou US $ 1.200.", "custou mil e duzentos dólares."),
    ("custou $0,50.", "custou cinquenta centavos."),
    ("custou $1.", "custou um dólar."),
    # A scale word takes "de" before the currency: "três milhões de dólares".
    ("45% de US$ 3 milhões", "quarenta e cinco por cento de três milhões de dólares"),
    ("US$ 2,5 bilhões", "dois vírgula cinco bilhões de dólares"),
    ("US$ 1.000.000", "um milhão de dólares"),
    # A grouped amount with cents is one amount, in Brazilian or leaked
    # English form; English-dot cents and scales too.
    ("custou US$ 1.250,50.", "custou mil duzentos e cinquenta dólares e cinquenta centavos."),
    ("custava 1.250,50 dólares", "custava mil duzentos e cinquenta dólares e cinquenta centavos"),
    ("custou $1,250.50.", "custou mil duzentos e cinquenta dólares e cinquenta centavos."),
    ("custou $3.50.", "custou três dólares e cinquenta centavos."),
    ("US$ 1.5 bilhão", "um vírgula cinco bilhão de dólares"),
])
def test_portuguese_currency(source, expected):
    assert normalize_pt_for_speech(source) == expected


@pytest.mark.parametrize("source,expected", [
    ("Cerca de 37,5% dos alunos", "Cerca de trinta e sete vírgula cinco por cento dos alunos"),
    ("apenas 15% a 20%", "apenas quinze por cento a vinte por cento"),
    ("só 1 % deles", "só um por cento deles"),
])
def test_portuguese_percent(source, expected):
    assert normalize_pt_for_speech(source) == expected


def test_portuguese_reads_et_al_as_words():
    """en-pt kept "et al." three times in four and wrote "e outros" once, so
    the voice reads the Latin unless a rule gives it the Portuguese -- the same
    rule Spanish earned."""
    assert normalize_pt_for_speech("(Kirsch et al., 2005)") == \
        "(Kirsch e outros, dois mil e cinco)"
