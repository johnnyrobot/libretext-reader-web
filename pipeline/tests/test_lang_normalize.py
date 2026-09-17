"""Spanish spoken-form normalisation of TRANSLATED text.

Every expectation here is Spanish-as-spoken, not Spanish-as-written: the output
of this module is handed to Supertonic, so `1999` must arrive as words. The four
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
# Italian. The THIRD language, and the one that inverts BOTH marks relative to
# English -- see the measurement block above normalize_it_for_speech.
# ---------------------------------------------------------------------------

from pipeline.lang_normalize import normalize_it_for_speech  # noqa: E402


def test_registry_exposes_italian():
    assert NORMALIZERS["it"] is normalize_it_for_speech


@pytest.mark.parametrize("source,expected", [
    ("0 casi", "zero casi"),
    ("2 casi", "due casi"),
    ("16 casi", "sedici casi"),
    ("19 casi", "diciannove casi"),
    ("20 casi", "venti casi"),
    # Italian ELIDES the tens vowel before uno and otto: ventuno, never
    # "ventiuno"; ventotto, never "ventiotto". This is the rule a port from
    # Spanish (which fuses 16-29 differently) or French (which does not elide
    # at all) gets wrong.
    ("21 casi", "ventuno casi"),
    ("22 casi", "ventidue casi"),
    # tre takes an ACCENT as the final element of a compound.
    ("23 casi", "ventitré casi"),
    ("28 casi", "ventotto casi"),
    ("31 casi", "trentuno casi"),
    ("33 casi", "trentatré casi"),
    ("38 casi", "trentotto casi"),
    ("41 casi", "quarantuno casi"),
    ("68 casi", "sessantotto casi"),
    ("80 casi", "ottanta casi"),
    ("91 casi", "novantuno casi"),
    ("99 casi", "novantanove casi"),
    # cento is invariable -- duecento, never "duecenti" -- and elides before
    # otto/ottanta: centottanta, not "centoottanta".
    ("100 casi", "cento casi"),
    ("101 casi", "centouno casi"),
    ("108 casi", "centotto casi"),
    ("180 casi", "centottanta casi"),
    ("200 casi", "duecento casi"),
    ("201 casi", "duecentouno casi"),
    # mille in the singular, -mila in the plural. Italian writes the whole
    # number as ONE word.
    ("1.000 casi", "mille casi"),
    ("2.000 casi", "duemila casi"),
    ("1.200 casi", "milleduecento casi"),
    ("21.000 casi", "ventunomila casi"),
    ("40.000 casi", "quarantamila casi"),
    ("100.000 casi", "centomila casi"),
    ("1.000.000 casi", "un milione casi"),
    ("2.000.000 casi", "due milioni casi"),
])
def test_italian_cardinals(source, expected):
    assert normalize_it_for_speech(source) == expected


@pytest.mark.parametrize("source,expected", [
    ("nel 1961.", "nel millenovecentosessantuno."),
    ("nel 1900.", "nel millenovecento."),
    ("nel 1993.", "nel millenovecentonovantatré."),
    ("nel 2000.", "nel duemila."),
    ("nel 2010.", "nel duemiladieci."),
])
def test_italian_years_are_plain_cardinals(source, expected):
    assert normalize_it_for_speech(source) == expected


def test_a_dot_group_of_exactly_three_digits_is_a_thousands_separator():
    """The central Italian rule, and the one with the most room to go wrong.
    A dot is a THOUSANDS separator here -- the inverse of English."""
    assert normalize_it_for_speech("40.000 partecipanti") == "quarantamila partecipanti"


def test_a_dot_group_of_one_or_two_digits_is_a_section_number_not_thousands():
    """MEASURED: across the 9,423 shipped Italian sentences the 1-2 digit dot
    form occurs 335 times against 20 real thousands groups -- 17x more often.
    Reading a dot as thousands unconditionally turns "Figura 7.5" into
    "figura settemilacinque", a wrong VALUE, 335 times over to fix 20."""
    assert normalize_it_for_speech("Figura 7.5 mostra") == "Figura sette punto cinque mostra"
    assert normalize_it_for_speech("Tabella 12.2 elenca") == "Tabella dodici punto due elenca"
    assert normalize_it_for_speech("CC BY 2.0.") == "CC BY due punto zero."


@pytest.mark.parametrize("source,expected", [
    # Both measured output shapes: the sign LEADS with a space, unlike French.
    ("costa $ 1.200 in totale.", "costa milleduecento dollari in totale."),
    ("costa $ 1 in totale.", "costa un dollaro in totale."),
    ("costa $ 15,50.", "costa quindici dollari e cinquanta centesimi."),
])
def test_italian_currency(source, expected):
    assert normalize_it_for_speech(source) == expected


@pytest.mark.parametrize("source,expected", [
    # MEASURED: the en-it checkpoint emits NO space before the sign, 82 times
    # out of 82. The spaced form is accepted anyway, because costing nothing.
    ("il 68% dei partecipanti", "il sessantotto per cento dei partecipanti"),
    ("il 68 % dei partecipanti", "il sessantotto per cento dei partecipanti"),
    ("lo 0,5% dei casi", "lo zero virgola cinque per cento dei casi"),
])
def test_italian_percentages(source, expected):
    assert normalize_it_for_speech(source) == expected


def test_a_comma_between_digits_is_a_decimal_read_with_virgola():
    assert normalize_it_for_speech("la soglia p 0,05") == "la soglia p zero virgola zero cinque"


def test_italian_leaves_et_al_alone():
    """MEASURED, like French and unlike Spanish. `et al.` survives the en-it
    checkpoint intact 100 times out of 100 in the shipped track, and it IS the
    correct form in Italian academic prose. Porting the Spanish rule here would
    be cargo-culting a fix for a defect this checkpoint does not have."""
    assert normalize_it_for_speech("Jost et al. hanno trovato") == "Jost et al. hanno trovato"


def test_italian_protects_placeholders_and_identifiers():
    assert normalize_it_for_speech("Vedi [[URL0]] nel 1999.") == \
        "Vedi [[URL0]] nel millenovecentonovantanove."
    assert normalize_it_for_speech("pagine 4064412.") == \
        "pagine quattro zero sei quattro quattro uno due."


def test_italian_text_with_no_numbers_is_unchanged():
    text = "La cooperazione tra gruppi riduce il pregiudizio."
    assert normalize_it_for_speech(text) == text


def test_a_scaled_currency_amount_is_not_read_as_dollars_and_cents():
    """MEASURED on the shipped track: "$ 8,3 trilioni" ($8.3 trillion) was read
    as "otto dollari e trenta centesimi trilioni" -- eight dollars thirty cents,
    a WRONG VALUE, the worst defect class this module tracks. The comma there is
    a decimal inside a scaled amount, not a cents separator.

    Only one occurrence in 9,423 sentences, and the rule is earned anyway: the
    failure is a wrong value rather than an awkward reading, and the guard costs
    one regex. The output shape mirrors the checkpoint's OWN unsigned form,
    which it writes as "2,5 milioni di dollari"."""
    assert normalize_it_for_speech("ha cancellato $ 8,3 trilioni di ricchezza.") == \
        "ha cancellato otto virgola tre trilioni di dollari di ricchezza."
    assert normalize_it_for_speech("oltre $ 2,5 milioni raccolti.") == \
        "oltre due virgola cinque milioni di dollari raccolti."
    # A whole-number scaled amount takes the same shape.
    assert normalize_it_for_speech("circa $ 3 miliardi persi.") == \
        "circa tre miliardi di dollari persi."
    # And the ordinary cents form must still work -- the guard must not swallow it.
    assert normalize_it_for_speech("costa $ 15,50.") == \
        "costa quindici dollari e cinquanta centesimi."


# ---------------------------------------------------------------------------
# Dutch. The FOURTH language, and a fourth convention: it takes Italian's DOT
# thousands but keeps English's DOT decimal, so the same mark means two things
# in the same sentence -- see the measurement block above normalize_nl_for_speech.
# ---------------------------------------------------------------------------

from pipeline.lang_normalize import normalize_nl_for_speech  # noqa: E402


def test_registry_exposes_dutch():
    assert NORMALIZERS["nl"] is normalize_nl_for_speech


@pytest.mark.parametrize("source,expected", [
    ("0 gevallen", "nul gevallen"),
    # A standalone 1 is the NUMERAL, and Dutch spells that "één". Bare "een" is
    # the indefinite article, so "1 geval" -> "een geval" would say "a case"
    # where the source said "one case". Inside a compound the accents are not
    # written, which is why the table below still holds "een".
    ("1 geval", "één geval"),
    ("2 gevallen", "twee gevallen"),
    ("12 gevallen", "twaalf gevallen"),
    ("19 gevallen", "negentien gevallen"),
    ("20 gevallen", "twintig gevallen"),
    # Dutch puts the UNIT FIRST and joins with "en": eenentwintig, not
    # "twintigeen". Nothing in es/fr/it does this, so it is the first thing a
    # port gets wrong.
    ("21 gevallen", "eenentwintig gevallen"),
    # A unit ending in -e takes a TREMA on the joining "en", because "tweeen"
    # would read as a single long vowel: tweeëntwintig, drieëndertig.
    ("22 gevallen", "tweeëntwintig gevallen"),
    ("23 gevallen", "drieëntwintig gevallen"),
    ("33 gevallen", "drieëndertig gevallen"),
    ("24 gevallen", "vierentwintig gevallen"),
    ("68 gevallen", "achtenzestig gevallen"),
    ("80 gevallen", "tachtig gevallen"),
    ("99 gevallen", "negenennegentig gevallen"),
    # 100 is bare "honderd", never "eenhonderd", and the whole sub-thousand
    # number is ONE word.
    ("100 gevallen", "honderd gevallen"),
    ("101 gevallen", "honderdeen gevallen"),
    ("156 gevallen", "honderdzesenvijftig gevallen"),
    ("200 gevallen", "tweehonderd gevallen"),
    ("512 gevallen", "vijfhonderdtwaalf gevallen"),
    # 1000 is bare "duizend"; the multiplier fuses onto it; the remainder is a
    # separate word.
    ("1.000 gevallen", "duizend gevallen"),
    ("2.000 gevallen", "tweeduizend gevallen"),
    ("2.500 gevallen", "tweeduizend vijfhonderd gevallen"),
    ("8.000 gevallen", "achtduizend gevallen"),
    ("20.000 gevallen", "twintigduizend gevallen"),
    ("40.320 gevallen", "veertigduizend driehonderdtwintig gevallen"),
    ("100.000 gevallen", "honderdduizend gevallen"),
    ("1.000.000 gevallen", "één miljoen gevallen"),
    ("2.000.000 gevallen", "twee miljoen gevallen"),
])
def test_dutch_cardinals(source, expected):
    assert normalize_nl_for_speech(source) == expected


@pytest.mark.parametrize("source,expected", [
    # Dutch reads a year by HUNDREDS, like English and unlike every language
    # shipped so far: es/fr/it all read 1961 as a plain cardinal. Porting their
    # rule here gives "duizend negenhonderdeenenzestig", which no Dutch speaker
    # says for a year.
    ("in 1961.", "in negentienhonderdeenenzestig."),
    ("in 1900.", "in negentienhonderd."),
    ("in 1993.", "in negentienhonderddrieënnegentig."),
    ("in 1520.", "in vijftienhonderdtwintig."),
    # From 2000 the hundreds reading stops and the plain cardinal takes over,
    # again as in English: "twenty ten" is not Dutch, "tweeduizend tien" is.
    ("in 2000.", "in tweeduizend."),
    ("in 2010.", "in tweeduizend tien."),
    ("in 2042.", "in tweeduizend tweeënveertig."),
])
def test_dutch_years_are_read_by_hundreds_below_2000(source, expected):
    assert normalize_nl_for_speech(source) == expected


def test_dutch_reads_a_three_digit_dot_group_as_thousands():
    """MEASURED on the en-nl checkpoint: `8,000` comes back as `8.000` and
    `100,000` as `100.000`, 14 times out of 15."""
    assert normalize_nl_for_speech("40.000 deelnemers") == "veertigduizend deelnemers"


def test_dutch_reads_a_short_dot_group_as_a_section_number():
    """The Italian trap, and Dutch has it WORSE: Italian marks its decimals with
    a comma, so a dot there is only ever a thousand or a section number. The
    en-nl checkpoint keeps the ENGLISH dot decimal as well, so one mark carries
    three jobs. Group size is still what separates them -- a thousands group is
    always exactly three digits."""
    assert normalize_nl_for_speech("Figuur 7.5 toont") == "Figuur zeven punt vijf toont"
    assert normalize_nl_for_speech("Tabel 12.2 somt") == "Tabel twaalf punt twee somt"
    assert normalize_nl_for_speech("CC BY 2.0.") == "CC BY twee punt nul."


@pytest.mark.parametrize("source,expected", [
    # MEASURED: the sign LEADS, tight or spaced, and the checkpoint emits both.
    # Dutch keeps a measure word SINGULAR after a numeral -- "vijftig dollar",
    # never "vijftig dollars" -- which no Romance port would produce.
    ("kost $50 in totaal.", "kost vijftig dollar in totaal."),
    ("kost $ 400 in totaal.", "kost vierhonderd dollar in totaal."),
    ("kost $30.000 per jaar.", "kost dertigduizend dollar per jaar."),
    ("kost $1,00.", "kost één dollar."),
    ("kost $15,50.", "kost vijftien dollar en vijftig cent."),
])
def test_dutch_currency(source, expected):
    assert normalize_nl_for_speech(source) == expected


def test_dutch_scaled_currency_is_not_read_as_dollars_and_cents():
    """The Italian defect, checked for here rather than assumed absent: the en-nl
    checkpoint writes `$8.3 trillion` as `$8,3 triljoen`, and reading that comma
    as cents gives "acht dollar en dertig cent triljoen" -- $8.30 for $8.3
    trillion, a wrong VALUE."""
    assert normalize_nl_for_speech("wiste $8,3 triljoen aan rijkdom.") == \
        "wiste acht komma drie triljoen dollar aan rijkdom."
    assert normalize_nl_for_speech("meer dan $ 400 miljard.") == \
        "meer dan vierhonderd miljard dollar."
    # The ordinary cents form must still survive the guard.
    assert normalize_nl_for_speech("kost $15,50.") == "kost vijftien dollar en vijftig cent."


@pytest.mark.parametrize("source,expected", [
    # MEASURED: the en-nl checkpoint emits NO space before the sign, 58 of 58.
    ("20% van de jongeren", "twintig procent van de jongeren"),
    ("20 % van de jongeren", "twintig procent van de jongeren"),
    ("0,5% van de gevallen", "nul komma vijf procent van de gevallen"),
])
def test_dutch_percentages(source, expected):
    assert normalize_nl_for_speech(source) == expected


def test_a_comma_between_digits_is_a_decimal_read_with_komma():
    assert normalize_nl_for_speech("de drempel p 0,05") == "de drempel p nul komma nul vijf"


def test_dutch_leaves_et_al_alone():
    """MEASURED, like French and Italian and unlike Spanish: `et al.` survives
    the en-nl checkpoint intact 59 times out of 60, and it is the correct form
    in Dutch academic prose."""
    assert normalize_nl_for_speech("Jost et al. vonden") == "Jost et al. vonden"


def test_dutch_protects_placeholders_and_identifiers():
    assert normalize_nl_for_speech("Zie [[URL0]] in 1999.") == \
        "Zie [[URL0]] in negentienhonderdnegenennegentig."
    assert normalize_nl_for_speech("pagina 4064412.") == \
        "pagina vier nul zes vier vier een twee."


def test_dutch_drops_a_zero_dollars_part_and_reads_only_the_cents():
    """FOUND BY RUNNING THE FINISHED PASS OVER THE WHOLE TRACK, not by the 50
    unit cases above -- the same step that caught Italian's `$8,3 trilioni`.
    `$0,25` came out as "nul dollar en vijfentwintig cent"; the price is
    "vijfentwintig cent"."""
    assert normalize_nl_for_speech("vermeld als $0,25 elk") == \
        "vermeld als vijfentwintig cent elk"
    # A zero-cents part is still dropped from the other end.
    assert normalize_nl_for_speech("kost $1,00.") == "kost één dollar."


def test_dutch_text_with_no_numbers_is_unchanged():
    text = "Samenwerking tussen groepen vermindert vooroordelen."
    assert normalize_nl_for_speech(text) == text


# ---------------------------------------------------------------------------
# Hungarian. The FIFTH language and the first AGGLUTINATIVE one -- a different
# KIND of problem, not a harder version of the previous four. See the
# measurement block above normalize_hu_for_speech.
# ---------------------------------------------------------------------------

from pipeline.lang_normalize import normalize_hu_for_speech  # noqa: E402


def test_registry_exposes_hungarian():
    assert NORMALIZERS["hu"] is normalize_hu_for_speech


@pytest.mark.parametrize("source,expected", [
    ("0 eset", "nulla eset"),
    ("1 eset", "egy eset"),
    ("3 eset", "három eset"),
    ("7 eset", "hét eset"),
    ("10 eset", "tíz eset"),
    # 11-19 and 21-29 do NOT reuse the bare tens word: tíz becomes tizen-, húsz
    # becomes huszon-. From 30 up the tens word is regular.
    ("11 eset", "tizenegy eset"),
    ("15 eset", "tizenöt eset"),
    ("19 eset", "tizenkilenc eset"),
    ("20 eset", "húsz eset"),
    ("21 eset", "huszonegy eset"),
    ("29 eset", "huszonkilenc eset"),
    ("30 eset", "harminc eset"),
    ("31 eset", "harmincegy eset"),
    ("68 eset", "hatvannyolc eset"),
    ("99 eset", "kilencvenkilenc eset"),
    ("100 eset", "száz eset"),
    ("101 eset", "százegy eset"),
    ("300 eset", "háromszáz eset"),
    # Attributive, because "eset" is the noun being counted -- see
    # test_hungarian_uses_the_attributive_form_before_a_counted_noun. Standing
    # alone this is "ötszáztizenkettő".
    ("512 eset", "ötszáztizenkét eset"),
])
def test_hungarian_cardinals(source, expected):
    assert normalize_hu_for_speech(source) == expected


@pytest.mark.parametrize("value,expected", [
    # THE 2000 RULE, which no other language here has anything like: Hungarian
    # writes a number as ONE word up to 2000 and hyphenates the thousands group
    # from 2001 up. The threshold is the VALUE, not the digit count, so 1999 and
    # 2001 are spelled differently despite both being four digits.
    ("1000 eset", "ezer eset"),
    ("1424 eset", "ezernégyszázhuszonnégy eset"),
    ("1999 eset", "ezerkilencszázkilencvenkilenc eset"),
    ("2000 eset", "kétezer eset"),
    ("2001 eset", "kétezer-egy eset"),
    ("2500 eset", "kétezer-ötszáz eset"),
    # MEASURED: the checkpoint writes four digits solid and groups from five
    # with a SPACE, which is correct Hungarian. Both shapes must read the same.
    ("8000 eset", "nyolcezer eset"),
    ("20 000 eset", "húszezer eset"),
    ("40 320 eset", "negyvenezer-háromszázhúsz eset"),
    ("100 000 eset", "százezer eset"),
    ("1 000 000 eset", "egymillió eset"),
    ("2 000 000 eset", "kétmillió eset"),
])
def test_hungarian_hyphenates_a_number_only_above_two_thousand(value, expected):
    assert normalize_hu_for_speech(value) == expected


@pytest.mark.parametrize("source,expected", [
    # THE NEW MECHANISM. Hungarian attaches a case ending to a numeral written
    # in digits with a HYPHEN. Spelling the number out deletes the hyphen and
    # fuses the ending onto the word. A pass that ignores it leaves
    # "húsz százalék -a", a dangling morpheme the voice reads as a word.
    ("a serdülők 20%-a", "a serdülők húsz százaléka"),
    ("a rablások 90%-át", "a rablások kilencven százalékát"),
    ("csak 1%-ot tett ki", "csak egy százalékot tett ki"),
    # The same mechanism on a bare number rather than a percentage.
    ("várhatóan 2042-ig", "várhatóan kétezer-negyvenkettőig"),
    ("2050-re az USA", "kétezer-ötvenre az USA"),
    ("1990-ben történt", "ezerkilencszázkilencvenben történt"),
    ("a 2010-es évek", "a kétezer-tízes évek"),
])
def test_hungarian_carries_a_hyphenated_case_suffix_onto_the_spelled_number(source, expected):
    assert normalize_hu_for_speech(source) == expected


def test_a_hyphen_between_two_numbers_is_not_a_suffix():
    """A page range must not be read as a number carrying a case ending. The
    suffix rule requires a LETTER after the hyphen, which is what separates
    `2042-ig` from `406-412`."""
    assert normalize_hu_for_speech("406-412 oldal") == \
        "négyszázhat-négyszáztizenkét oldal"


@pytest.mark.parametrize("source,expected", [
    # kettő stands alone; két goes before the noun it counts. Prose is almost
    # always attributive, so a following word selects "két" -- except after a
    # coordinating conjunction, where the numeral is an item in a list.
    ("2 csoport vizsgálata", "két csoport vizsgálata"),
    ("2 és 3 között", "kettő és három között"),
    ("22 résztvevő", "huszonkét résztvevő"),
    ("22 és 23", "huszonkettő és huszonhárom"),
])
def test_hungarian_uses_the_attributive_form_before_a_counted_noun(source, expected):
    assert normalize_hu_for_speech(source) == expected


@pytest.mark.parametrize("source,expected", [
    # MEASURED: the checkpoint has usually already turned `$50` into
    # "50 dollárért" -- word, trailing, inflected -- so the sign survives rarely.
    # When it does, the multiplier form is the attributive one.
    ("kapott $4 kezdeni", "kapott négy dollár kezdeni"),
    ("$2 volt", "két dollár volt"),
    # A comma between digits is a DECIMAL, read with "egész".
    ("8,3 trillió dollárt", "nyolc egész három trillió dollárt"),
    ("a küszöb p 0,05", "a küszöb p nulla egész nulla öt"),
    # A dot between digits is preserved by this checkpoint and stays a section
    # number or a version -- "pont", never a thousands group.
    ("1.3 ábra", "egy pont három ábra"),
    ("CC BY-NC 2.0.", "CC BY-NC kettő pont nulla."),
])
def test_hungarian_currency_decimals_and_section_numbers(source, expected):
    assert normalize_hu_for_speech(source) == expected


def test_hungarian_reads_a_leaked_english_thousands_comma_as_a_thousand():
    """FOUND BY RUNNING THE FINISHED PASS OVER THE WHOLE TRACK. The checkpoint
    localises its separators correctly 9,429 times and leaks one English comma:
    `40,320`. Read as a Hungarian decimal that is "negyven egész három kettő
    nulla" -- forty-point-three-two for forty thousand three hundred twenty, a
    wrong VALUE, which is what earns a rule from a single occurrence.

    Deleting the comma is NOT the fix: `40320` is five digits and trips the
    identifier guard, so the number comes out read digit by digit. It is
    rewritten to the space Hungarian actually uses instead."""
    assert normalize_hu_for_speech("(ami 40,320), de") == \
        "(ami negyvenezer-háromszázhúsz), de"
    # A genuine 1-2 digit decimal must still be a decimal -- the two rules are
    # mutually exclusive by group size, not by ordering.
    assert normalize_hu_for_speech("a küszöb p 0,05") == "a küszöb p nulla egész nulla öt"
    assert normalize_hu_for_speech("14,4%-ot loptak") == \
        "tizennégy egész négy százalékot loptak"


def test_hungarian_currency_carries_its_own_suffix():
    """Also found on the whole track, and this one was MY bug rather than the
    checkpoint's: `$30-os` was claimed by the currency pass, which spelled the
    number and left "-os" stranded beside it. Two of this module's own passes
    orphaning a morpheme between them is exactly the defect the hyphen machinery
    exists to prevent. The suffix lands on the NOUN, as Hungarian puts it."""
    assert normalize_hu_for_speech("egy $30-os díjért") == "egy harminc dolláros díjért"


def test_hungarian_percent_without_a_suffix_still_reads():
    assert normalize_hu_for_speech("20% felett") == "húsz százalék felett"


def test_hungarian_leaves_et_al_alone():
    """MEASURED, as in fr, it and nl: intact 59 times out of 60."""
    assert normalize_hu_for_speech("Jost et al. megállapította") == \
        "Jost et al. megállapította"


def test_hungarian_protects_placeholders_and_identifiers():
    assert normalize_hu_for_speech("Lásd [[URL0]] 1999-ben.") == \
        "Lásd [[URL0]] ezerkilencszázkilencvenkilencben."
    assert normalize_hu_for_speech("oldal 4064412.") == \
        "oldal négy nulla hat négy négy egy kettő."


def test_hungarian_text_with_no_numbers_is_unchanged():
    text = "A csoportok közötti együttműködés csökkenti az előítéletet."
    assert normalize_hu_for_speech(text) == text


# ---------------------------------------------------------------------------
# Danish. The SIXTH language, and the one whose number FORMATS match Dutch's
# exactly while its WORDS do not -- see the measurement block above
# normalize_da_for_speech.
# ---------------------------------------------------------------------------

from pipeline.lang_normalize import normalize_da_for_speech  # noqa: E402


def test_registry_exposes_danish():
    assert NORMALIZERS["da"] is normalize_da_for_speech


@pytest.mark.parametrize("source,expected", [
    ("0 sager", "nul sager"),
    ("1 sag", "en sag"),
    ("12 sager", "tolv sager"),
    ("19 sager", "nitten sager"),
    ("20 sager", "tyve sager"),
    # The unit comes BEFORE the ten and joins with "og" -- as Dutch does, but
    # with no vowel change on the joint.
    ("21 sager", "enogtyve sager"),
    ("22 sager", "toogtyve sager"),
    ("31 sager", "enogtredive sager"),
    # THE VIGESIMAL TENS. halvtreds/tres/halvfjerds/firs/halvfems are scores --
    # "half-third", "third", "half-fourth", "fourth", "half-fifth" -- and are
    # not derivable from the unit words at all. A speller that composes tens
    # from units is wrong for half the range.
    ("50 sager", "halvtreds sager"),
    ("55 sager", "femoghalvtreds sager"),
    ("60 sager", "tres sager"),
    ("68 sager", "otteogtres sager"),
    ("70 sager", "halvfjerds sager"),
    ("80 sager", "firs sager"),
    ("90 sager", "halvfems sager"),
    ("99 sager", "nioghalvfems sager"),
    # "og" joins a SUB-HUNDRED tail to whatever precedes it, and only that.
    ("100 sager", "hundrede sager"),
    ("101 sager", "hundrede og en sager"),
    ("200 sager", "to hundrede sager"),
    ("512 sager", "fem hundrede og tolv sager"),
    ("1.000 sager", "tusind sager"),
    # rest >= 100, so no "og": "to tusind fem hundrede".
    ("2.500 sager", "to tusind fem hundrede sager"),
    # rest < 100, so "og": "to tusind og toogfyrre".
    ("2.042 sager", "to tusind og toogfyrre sager"),
    ("8.000 sager", "otte tusind sager"),
    ("40.320 sager", "fyrre tusind tre hundrede og tyve sager"),
    ("100.000 sager", "hundrede tusind sager"),
    ("1.000.000 sager", "en million sager"),
])
def test_danish_cardinals(source, expected):
    assert normalize_da_for_speech(source) == expected


@pytest.mark.parametrize("source,expected", [
    # Read BY HUNDREDS below 2000, as in English and Dutch and unlike es/fr/it.
    ("i 1961.", "i nitten hundrede og enogtres."),
    ("i 1900.", "i nitten hundrede."),
    ("i 1520.", "i femten hundrede og tyve."),
    ("i 2000.", "i to tusind."),
    ("i 2010.", "i to tusind og ti."),
])
def test_danish_years_are_read_by_hundreds_below_2000(source, expected):
    assert normalize_da_for_speech(source) == expected


@pytest.mark.parametrize("source,expected", [
    # DANISH WRITES AN ORDINAL AS DIGITS PLUS A PERIOD, which no earlier
    # language here had to read. Without a rule the cardinal pass says "det
    # tyve. arhundrede" -- a number and a stray full stop. 13 occurrences in
    # the 9,430 translated sentences, which earns this on frequency.
    ("det 20. århundrede oplevede", "det tyvende århundrede oplevede"),
    ("I det 21. århundrede er", "I det enogtyvende århundrede er"),
    ("hvert 10. sekund.", "hvert tiende sekund."),
    ("på 42. gade i New York", "på toogfyrretyvende gade i New York"),
    # A compound takes the unit's CARDINAL and the ten's ORDINAL, and the tens
    # ordinals restore the long vigesimal forms the cardinals abbreviate:
    # "fyrre" but "fyrretyvende", "tres" but "tresindstyvende".
    ("Den 26. marts 1997 blev", "Den seksogtyvende marts nitten hundrede og syvoghalvfems blev"),
    ("Den 12. juli 1982 blev", "Den tolvte juli nitten hundrede og toogfirs blev"),
])
def test_danish_reads_a_digit_plus_period_as_an_ordinal(source, expected):
    assert normalize_da_for_speech(source) == expected


def test_a_sentence_final_number_is_not_read_as_a_danish_ordinal():
    """THE GUARD, and it was measured rather than reasoned. `20.` ending a
    sentence is character-for-character an ordinal, so the rule requires a
    LOWERCASE word after it. Measured on the corpus: 13 such forms followed by
    a lowercase word, every one a real ordinal, and ZERO followed by an
    uppercase one -- a sentence that really did end in a number starts the next
    with a capital."""
    assert normalize_da_for_speech("Svaret var 20. Det næste spørgsmål.") == \
        "Svaret var tyve. Det næste spørgsmål."


def test_danish_reads_a_three_digit_dot_group_as_thousands():
    """MEASURED on the corpus: 19 real thousands groups against 316 one- or
    two-digit dot forms -- the same ratio Dutch (19 vs 281) and Italian (20 vs
    335) measured independently."""
    assert normalize_da_for_speech("40.000 deltagere") == "fyrre tusind deltagere"


def test_danish_reads_a_short_dot_group_as_a_section_number():
    assert normalize_da_for_speech("figur 7.5 viser") == "figur syv punktum fem viser"
    assert normalize_da_for_speech("CC BY 2.0.") == "CC BY to punktum nul."


@pytest.mark.parametrize("source,expected", [
    # THE MEASURE WORD IS PLURAL, which the checkpoint itself writes ("50
    # dollars") and which inverts Dutch -- the one language whose number formats
    # Danish matches exactly.
    ("koster $50 i alt.", "koster halvtreds dollars i alt."),
    ("koster $ 400 i alt.", "koster fire hundrede dollars i alt."),
    ("koster $30.000 om året.", "koster tredive tusind dollars om året."),
    ("koster $1,00.", "koster en dollar."),
    ("koster $15,50.", "koster femten dollars og halvtreds cent."),
    ("koster $0,25 hver.", "koster femogtyve cent hver."),
    # Danish uses the LONG scale, so the checkpoint writes "billioner" for the
    # English trillion. The rule reads whatever word is there rather than
    # converting, so the scale system never has to be modelled.
    ("slettet $8,3 billioner i rigdom.", "slettet otte komma tre billioner dollars i rigdom."),
    ("over $ 400 milliarder.", "over fire hundrede milliarder dollars."),
])
def test_danish_currency(source, expected):
    assert normalize_da_for_speech(source) == expected


@pytest.mark.parametrize("source,expected", [
    # MEASURED: no space before the sign, 58 of 58.
    ("20% af de unge", "tyve procent af de unge"),
    ("20 % af de unge", "tyve procent af de unge"),
    ("0,5% af sagerne", "nul komma fem procent af sagerne"),
])
def test_danish_percentages(source, expected):
    assert normalize_da_for_speech(source) == expected


def test_danish_leaves_et_al_alone():
    """MEASURED: intact 100 times out of 100, the cleanest of any language here."""
    assert normalize_da_for_speech("Jost et al. fandt") == "Jost et al. fandt"


def test_danish_protects_placeholders_and_identifiers():
    assert normalize_da_for_speech("Se [[URL0]] i 1999.") == \
        "Se [[URL0]] i nitten hundrede og nioghalvfems."
    assert normalize_da_for_speech("side 4064412.") == \
        "side fire nul seks fire fire en to."


def test_danish_text_with_no_numbers_is_unchanged():
    text = "Samarbejde mellem grupper mindsker fordomme."
    assert normalize_da_for_speech(text) == text


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
# Swedish. The SEVENTH language, and the one that broke "Scandinavian, so it
# will be Danish" -- see the measurement block above normalize_sv_for_speech.
# ---------------------------------------------------------------------------

from pipeline.lang_normalize import normalize_sv_for_speech  # noqa: E402


def test_registry_exposes_swedish():
    assert NORMALIZERS["sv"] is normalize_sv_for_speech


@pytest.mark.parametrize("source,expected", [
    ("0 fall", "noll fall"),
    ("1 fall", "ett fall"),
    ("19 fall", "nitton fall"),
    ("20 fall", "tjugo fall"),
    # THE TENS GO FIRST AND THERE IS NO JOINER. Dutch, Danish and German all put
    # the unit first (eenentwintig, enogtyve), so this is the one rule a port
    # from Danish gets wrong on every number between 21 and 99.
    ("21 fall", "tjugoett fall"),
    ("22 fall", "tjugotvå fall"),
    ("35 fall", "trettiofem fall"),
    ("68 fall", "sextioåtta fall"),
    ("99 fall", "nittionio fall"),
    ("100 fall", "hundra fall"),
    ("101 fall", "hundraett fall"),
    ("200 fall", "tvåhundra fall"),
    ("512 fall", "femhundratolv fall"),
    ("1000 fall", "tusen fall"),
    ("2500 fall", "tvåtusenfemhundra fall"),
    ("8000 fall", "åttatusen fall"),
    # Grouped, because an UNGROUPED run of five or more digits is an identifier
    # by the same rule every language here applies -- and the checkpoint writes
    # these grouped anyway. Measured: the only bare 5+ digit runs in the Swedish
    # corpus are image filenames (DSC01311, sweng95765).
    ("100 000 fall", "hundratusen fall"),
    ("40 320 fall", "fyrtiotusentrehundratjugo fall"),
    ("1.000.000 fall", "en miljon fall"),
])
def test_swedish_cardinals(source, expected):
    assert normalize_sv_for_speech(source) == expected


def test_swedish_reads_both_thousands_separators():
    """MEASURED, and no earlier checkpoint was inconsistent like this: en-sv
    writes a thousands group with a DOT 12 times and with a SPACE 7 times in the
    same book. A rule written from either half alone is wrong a third of the
    time."""
    assert normalize_sv_for_speech("över 8.000 mord") == "över åttatusen mord"
    assert normalize_sv_for_speech("över 20 000 deltagare") == "över tjugotusen deltagare"
    assert normalize_sv_for_speech("(40 320) men") == "(fyrtiotusentrehundratjugo) men"


def test_swedish_reads_a_short_dot_group_as_a_section_number():
    """311 short dot forms against those 12 real thousands groups."""
    assert normalize_sv_for_speech("figur 1.3 visar") == "figur ett punkt tre visar"
    assert normalize_sv_for_speech("CC BY 2.0.") == "CC BY två punkt noll."


@pytest.mark.parametrize("source,expected", [
    # MEASURED: BOTH spacings, 37 spaced against 31 tight.
    ("20 % av ungdomarna", "tjugo procent av ungdomarna"),
    ("35% av lagets", "trettiofem procent av lagets"),
    # ...and 12 times the checkpoint has already written the word, which needs
    # no rule at all and must not be double-read.
    ("99 procent av rånen", "nittionio procent av rånen"),
])
def test_swedish_percentages(source, expected):
    assert normalize_sv_for_speech(source) == expected


@pytest.mark.parametrize("source,expected", [
    # INVARIABLE after a numeral, as in Dutch and unlike Danish -- the other
    # Scandinavian language here. The checkpoint writes "dollar" 13 times and
    # "dollars" never.
    ("för $50.", "för femtio dollar."),
    ("för 50 dollar.", "för femtio dollar."),
    ("$ 30.000 per år", "trettiotusen dollar per år"),
    ("8,3 biljoner dollar i", "åtta komma tre biljoner dollar i"),
    ("kostar $15,50.", "kostar femton dollar och femtio cent."),
    ("kostar $0,25 styck.", "kostar tjugofem cent styck."),
])
def test_swedish_currency(source, expected):
    assert normalize_sv_for_speech(source) == expected


@pytest.mark.parametrize("source,expected", [
    # 35 occurrences, which is Hungarian's mechanism reappearing in a Germanic
    # language. Inside a decade the number is read as a YEAR, so the year rule
    # has to be reachable from inside the suffix rule rather than running after.
    ("under 1900-talet utvidgades", "under nittonhundratalet utvidgades"),
    ("Under 2000-talet har", "Under tvåtusentalet har"),
    ("på 1960-talet", "på nittonhundrasextiotalet"),
    ("5-åriga barn", "femåriga barn"),
    ("i 40-årsåldern", "i fyrtioårsåldern"),
    ("en 10-sekunders paus", "en tiosekunders paus"),
])
def test_swedish_carries_a_hyphenated_word_onto_the_spelled_number(source, expected):
    assert normalize_sv_for_speech(source) == expected


def test_swedish_expands_m_fl_but_leaves_et_al_alone():
    """MEASURED, and the difference is the point: `et al.` survives 71 times and
    is correct Swedish academic usage that a voice reads as words. The same
    checkpoint also produces `m.fl.` 29 times, which is a dot-separated
    abbreviation a voice reads as letters -- the same standard the Spanish
    `et al.` -> `y otros` rule was held to."""
    assert normalize_sv_for_speech("Schwarz m.fl., 1991") == \
        "Schwarz med flera, nittonhundranittioett"
    assert normalize_sv_for_speech("McGregor et al. visade") == "McGregor et al. visade"


@pytest.mark.parametrize("source,expected", [
    ("år 1961.", "år nittonhundrasextioett."),
    ("år 1900.", "år nittonhundra."),
    ("år 2010.", "år tvåtusentio."),
])
def test_swedish_years_are_read_by_hundreds_below_2000(source, expected):
    assert normalize_sv_for_speech(source) == expected


def test_swedish_protects_placeholders_and_identifiers():
    assert normalize_sv_for_speech("Se [[URL0]] år 1999.") == \
        "Se [[URL0]] år nittonhundranittionio."
    assert normalize_sv_for_speech("sida 4064412.") == \
        "sida fyra noll sex fyra fyra ett två."


def test_swedish_text_with_no_numbers_is_unchanged():
    text = "Samarbete mellan grupper minskar fördomar."
    assert normalize_sv_for_speech(text) == text


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
# Czech. The NINTH language, the SIXTH distinct number convention, and the first
# that is neither Germanic nor Romance. en-cs moves every thousands group to a
# SPACE and leaves all 301 of its dot forms alone -- so it is Hungarian's
# separator with German's decimals, a combination none of the eight before it
# produced. Counts below are over all 9,430 translated sentences via
# bench/formats/count.py, not over measure.py's per-bucket examples; see
# bench/formats/cs.json for the shapes.
# ---------------------------------------------------------------------------

from pipeline.lang_normalize import normalize_cs_for_speech  # noqa: E402


def test_registry_exposes_czech():
    assert NORMALIZERS["cs"] is normalize_cs_for_speech


@pytest.mark.parametrize("source,expected", [
    ("0 případů", "nula případů"),
    ("3 případy", "tři případy"),
    ("7 případů", "sedm případů"),
    ("11 případů", "jedenáct případů"),
    ("15 případů", "patnáct případů"),
    ("19 případů", "devatenáct případů"),
    ("20 případů", "dvacet případů"),
    # SEPARATE WORDS, ten first. Czech does have a fused unit-first form
    # ("jedenadvacet") and it is archaic, so this is neither German's
    # "einundzwanzig" nor Swedish's solid "tjugoett".
    ("21 případů", "dvacet jedna případů"),
    ("22 případů", "dvacet dva případů"),
    ("35 případů", "třicet pět případů"),
    ("99 případů", "devadesát devět případů"),
    ("100 případů", "sto případů"),
    ("101 případů", "sto jedna případů"),
    # 200 is a surviving DUAL -- "dvě stě", not the "sta" that 300 and 400 take,
    # and not the genitive "set" that 500 upward take. Three forms of one word
    # inside nine entries, which no suffix rule produces.
    ("200 případů", "dvě stě případů"),
    ("300 případů", "tři sta případů"),
    ("500 případů", "pět set případů"),
    ("512 případů", "pět set dvanáct případů"),
    ("900 případů", "devět set případů"),
    # And "tisíc" runs the same paradigm: bare at 1, "tisíce" at 2-4, back to
    # "tisíc" (genitive plural, spelled like the singular) from 5.
    ("1000 případů", "tisíc případů"),
    ("2 500 členů", "dva tisíce pět set členů"),
    ("8 000 vražd", "osm tisíc vražd"),
    ("40 320", "čtyřicet tisíc tři sta dvacet"),
    ("100 000 činů", "sto tisíc činů"),
    ("1 000 000 lidí", "milion lidí"),
])
def test_czech_cardinals(source, expected):
    assert normalize_cs_for_speech(source) == expected


def test_czech_reads_a_space_group_as_thousands():
    """17 space groups over 9,430 sentences, and ZERO dot groups -- so the
    exactly-three-digits test that Italian, Dutch, Danish and German all needed
    to tell a thousand from a section number is load-bearing for nothing here.
    The separator is a plain U+0020 in all 17, checked rather than assumed."""
    assert normalize_cs_for_speech("přes 8 000 vražd") == "přes osm tisíc vražd"
    assert normalize_cs_for_speech("s více než 20 000 účastníky") == \
        "s více než dvacet tisíc účastníky"
    assert normalize_cs_for_speech("(což je 40 320)") == \
        "(což je čtyřicet tisíc tři sta dvacet)"


def test_czech_reads_every_dot_between_digits_as_a_section_number():
    """301 dot forms and not one of them a thousands group. The dot is also read
    with the NAME OF THE MARK -- "tečka" -- and stays invariable, unlike the
    comma below, because in Czech a dot between digits is a version or a figure
    number and never a decimal."""
    assert normalize_cs_for_speech("Obrázek 1.3 Mozková kůra") == \
        "Obrázek jedna tečka tři Mozková kůra"
    assert normalize_cs_for_speech("CC BY-NC 2.0.") == "CC BY-NC dva tečka nula."


def test_czech_reads_a_comma_decimal_with_an_inflected_measure_word():
    """THE JOINER IS NOT THE NAME OF THE MARK. Czech reads a comma decimal with
    "celá" -- a feminine adjective that agrees with the number in front of it,
    so the word itself changes three ways where every earlier language had one
    invariable joiner ("Komma", "punto", "virgule").

    Seven real comma decimals in the corpus; the other three commas between
    digits are English leaks and are handled as such."""
    assert normalize_cs_for_speech("vymazal 8,3 bilionu") == \
        "vymazal osm celých tři bilionu"
    assert normalize_cs_for_speech("mrhayata 2,0") == "mrhayata dvě celé nula"
    assert normalize_cs_for_speech("prahu 1,5") == "prahu jedna celá pět"


def test_czech_drops_gender_once_the_noun_is_genitive_plural():
    """FOUND BY THE WHOLE-TRACK RUN, not by a unit test written from the
    measured shapes: `82%` read as "osmdesát dvě procent".

    A Czech numeral agrees with its noun only where that noun is nominative --
    which is 1 and 2-4. From 5 up, and for every compound, the noun drops to the
    genitive plural and the numeral reverts to its base form. Gendering it there
    produces a feminine numeral against a genitive noun, which is the shape this
    asserts is gone."""
    assert normalize_cs_for_speech("82% dostalo") == "osmdesát dva procent dostalo"
    assert normalize_cs_for_speech("22% lidí") == "dvacet dva procent lidí"
    assert normalize_cs_for_speech("42, 9") == "čtyřicet dva celých devět"


def test_czech_inflects_the_noun_it_inserts_itself():
    """The counted-noun paradigm, and the checkpoint's own output is the
    evidence for it: en-cs writes `$4` as "4 dolary" and `$50` as "50 dolarů",
    two different words for one noun. "procento" is neuter and "dolar"
    masculine, so 2 is not the same word in front of each."""
    assert normalize_cs_for_speech("1% skupiny") == "jedno procento skupiny"
    assert normalize_cs_for_speech("2% případů") == "dvě procenta případů"
    assert normalize_cs_for_speech("3% vzorků") == "tři procenta vzorků"
    assert normalize_cs_for_speech("20% dospívajících") == "dvacet procent dospívajících"
    assert normalize_cs_for_speech("100% jisté") == "sto procent jisté"


def test_czech_percent_is_never_spaced():
    """80 attached against ZERO spaced, over the whole corpus. Swedish and
    German both write their percent two ways in the same book; this checkpoint
    does not, so there is no alternation to hedge against."""
    assert normalize_cs_for_speech("asi 12% pomaleji") == "asi dvanáct procent pomaleji"
    assert normalize_cs_for_speech("(14,4%)") == "(čtrnáct celých čtyři procenta)"


@pytest.mark.parametrize("source,expected", [
    ("platba ($20) za lež", "platba (dvacet dolarů) za lež"),
    ("platbu ($1) za lež", "platbu (jeden dolar) za lež"),
    ("dostala $4 na začátek", "dostala čtyři dolary na začátek"),
])
def test_czech_currency(source, expected):
    """THREE `$` survive translation in the whole corpus, because en-cs
    otherwise writes the word already inflected -- `$50` comes back as
    "50 dolarů". So this rule exists for the residue, and the cents and
    scale-word rules every earlier language carries are absent by MEASUREMENT:
    no `$N,NN` and no `$N bilionu` form occurs. `$8.3 trillion` arrives as
    "8,3 bilionu dolarů" with no sign at all."""
    assert normalize_cs_for_speech(source) == expected


def test_czech_rewrites_a_leaked_english_thousands_comma():
    """Three commas the checkpoint failed to localise, and all three are wrong
    VALUES if read as decimals -- the severity bar that earns a rule from one
    occurrence. `1,424` read as a decimal is one-point-four-two-four for one
    thousand four hundred twenty-four.

    The third is the interesting one: `5 000,000` is a 5,000,000 whose FIRST
    group the checkpoint localised and whose second it did not. Rewriting the
    comma to a space rather than deleting it makes the two halves agree and the
    grouped rule then reads the whole number correctly."""
    assert normalize_cs_for_speech("více než 50,000 lidí") == \
        "více než padesát tisíc lidí"
    assert normalize_cs_for_speech("chování 1,424 chodců") == \
        "chování tisíc čtyři sta dvacet čtyři chodců"
    assert normalize_cs_for_speech("je 1 k 5 000,000, více") == \
        "je jedna k pět milionů, více"


def test_czech_reads_a_whole_line_decimal_the_checkpoint_spaced():
    """Ten table cells whose entire text is a decimal en-cs both localised and
    SPACED: `57.1` -> `57, 1`. Read as written they are two numbers with a pause
    between them."""
    assert normalize_cs_for_speech("57, 1") == "padesát sedm celých jedna"
    assert normalize_cs_for_speech("40, 0") == "čtyřicet celých nula"
    assert normalize_cs_for_speech("(28, 5%)") == "(dvacet osm celých pět procenta)"


def test_czech_does_not_read_a_list_of_numbers_as_a_decimal():
    """THE GUARD ON THE RULE ABOVE, and the reason it is anchored to a whole
    line rather than matching `\\d+, \\d+` anywhere. The first version of the
    comma rule accepted an optional space and the corpus caught it at once:
    `oblasti 1, 2, 4 a 5` -- a list of brain regions -- came out as "oblasti
    jedna celá dva, čtyři a pět". A citation year list has the same shape."""
    assert normalize_cs_for_speech("oblasti 1, 2, 4 a 5") == \
        "oblasti jedna, dva, čtyři a pět"
    assert normalize_cs_for_speech("Rosenthal, 1990, 1992).") == \
        "Rosenthal, tisíc devět set devadesát, tisíc devět set devadesát dva)."


@pytest.mark.parametrize("source,expected", [
    ("v roce 1961.", "v roce tisíc devět set šedesát jedna."),
    ("v roce 1900.", "v roce tisíc devět set."),
    ("března 1997", "března tisíc devět set devadesát sedm"),
    ("v roce 2010.", "v roce dva tisíce deset."),
])
def test_czech_years_are_the_plain_cardinal(source, expected):
    """Czech does NOT read a year by hundreds. Dutch, Danish, Swedish and German
    all do; Spanish, French and Italian do not, and Czech joins them. Family did
    not predict this, as it has not predicted anything else here."""
    assert normalize_cs_for_speech(source) == expected


def test_czech_does_not_invent_a_long_scale_word():
    """A Czech "bilion" is 10^12 and an English "billion" is 10^9, the same trap
    German has. The checkpoint already gets it right unaided -- `100 billion
    neurons` -> `100 miliard`, `$8.3 trillion` -> `8,3 bilionu dolarů` -- so
    scale words are passed through and only their numerals are read."""
    assert normalize_cs_for_speech("asi 100 miliard neuronů") == \
        "asi sto miliard neuronů"
    assert normalize_cs_for_speech("více než 7 milionů lidí") == \
        "více než sedm milionů lidí"


def test_czech_leaves_et_al_alone():
    """Preserved 95 times over the corpus and read as words -- the standard that
    earned Spanish a rule and denied French, Italian and German one. The
    checkpoint does sometimes write "a kol." itself, which needs nothing."""
    assert normalize_cs_for_speech("Údaje jsou z Berman et al. (2009).") == \
        "Údaje jsou z Berman et al. (dva tisíce devět)."
    assert normalize_cs_for_speech("(Huston a kol., 1992)") == \
        "(Huston a kol., tisíc devět set devadesát dva)"


def test_czech_protects_placeholders_and_identifiers():
    assert normalize_cs_for_speech("Viz [[URL0]] v roce 1999.") == \
        "Viz [[URL0]] v roce tisíc devět set devadesát devět."
    assert normalize_cs_for_speech("Strana 4064412.") == \
        "Strana čtyři nula šest čtyři čtyři jedna dva."


def test_czech_restores_a_decimal_that_lost_its_leading_zero():
    """`.38-kalibr` and `r = .30` -- the English convention every checkpoint
    passes through, and the defect that was live in six languages until the
    Swedish measurement found it. Handled by the shared restore, so this asserts
    the equivalence rather than a word list."""
    assert normalize_cs_for_speech("r = .30 a asi .7") == \
        normalize_cs_for_speech("r = 0.30 a asi 0.7")
    assert normalize_cs_for_speech("a .38-kalibr revolver") == \
        "a nula tečka tři osm-kalibr revolver"


def test_czech_reads_an_ordinal_as_a_cardinal_and_that_is_a_recorded_gap():
    """RECORDED, NOT FIXED, and Czech is the strongest case for that call yet.
    The checkpoint marks an ordinal with a trailing dot in 29 lines -- `20.
    století`, `26. března`, `21. prosincem` -- and reading it needs the ordinal
    declined to agree with its noun in whatever case that noun stands in:
    "dvacátého století" is genitive, "dvacátým prvním prosincem" instrumental.

    Danish could take this rule because a Danish ordinal has one form; German
    was denied it because the dot is ambiguous before a capitalised noun. Czech
    has both problems at once. This asserts the CURRENT reading so that building
    the declension system would be a visible change rather than a silent one."""
    assert normalize_cs_for_speech("V druhé části 20. století") == \
        "V druhé části dvacet. století"
    assert normalize_cs_for_speech("26. března 1997 byli") == \
        "dvacet šest. března tisíc devět set devadesát sedm byli"


def test_czech_leaves_a_numeral_glued_to_an_adjective_alone():
    """RECORDED, NOT FIXED: `10sekundové`, `20minutovou`, `29letý`, `20letého`
    reach the voice as raw digits, 4 occurrences. Below German's 23 glued
    decades and Swedish's 35 hyphenated ones, and a different shape besides --
    German appends "er" to the cardinal and gets a real word, while Czech needs
    the numeral's COMBINING stem ("desetisekundové"), which is a second numeral
    system rather than a suffix.

    The HYPHENATED forms are already read, because a hyphen is a word boundary
    and the integer pass reaches through it."""
    assert normalize_cs_for_speech("tři 10sekundové videoklipy") == \
        "tři 10sekundové videoklipy"
    assert normalize_cs_for_speech("12-gauge brokovnice") == "dvanáct-gauge brokovnice"
    assert normalize_cs_for_speech("chování 11-letých chlapců") == \
        "chování jedenáct-letých chlapců"


def test_czech_leaves_an_identifier_glued_to_letters_alone():
    """The same corpus carries `497px`, `DSC01314`, `6SN7`, `3D`, `LindaDee2006`
    and a 32-character image hash. Nothing here matches a digit run followed by
    letters, which is what keeps all of them intact."""
    for text in ("videohry (Wolfenstein 3D)", "šířka: 497px", "6SN7 Reflexní",
                 "Fenix_21 DSC01314", "LindaDee2006"):
        assert normalize_cs_for_speech(text) == text


def test_czech_text_with_no_numbers_is_unchanged():
    text = "Spolupráce mezi skupinami snižuje předsudky."
    assert normalize_cs_for_speech(text) == text
