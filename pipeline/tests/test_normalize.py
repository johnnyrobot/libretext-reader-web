import pytest

from pipeline.normalize import fold_unrepresentable, normalize_for_speech


@pytest.mark.parametrize(
    "source,expected",
    [
        ("Roughly 68% of participants complied.",
         "Roughly sixty eight percent of participants complied."),
        ("The study cost $1,200 to run.",
         "The study cost one thousand two hundred dollars to run."),
        ("The mean was 3.14 across conditions.",
         "The mean was three point one four across conditions."),
        ("There were 2,415 responses.",
         "There were two thousand four hundred fifteen responses."),
        ("See https://example.org/study for details.",
         "See link for details."),
        ("Write to author@example.org today.",
         "Write to email address today."),
        ("Many factors, e.g., mood, matter.",
         "Many factors, for example, mood, matter."),
        ("Conformity, i.e., matching others, is common.",
         "Conformity, that is, matching others, is common."),
        ("Milgram et al. found compliance.",
         "Milgram and others found compliance."),
    ],
)
def test_expands_notation_into_words(source, expected):
    assert normalize_for_speech(source) == expected


def test_leaves_ordinary_prose_untouched():
    text = "Social cognition is how people process information about others."
    assert normalize_for_speech(text) == text


def test_collapses_repeated_punctuation_and_whitespace():
    assert normalize_for_speech("Really??!!  Yes...") == "Really? Yes."


def test_a_year_is_one_spoken_unit_never_split_or_decimal():
    """The property `test_years_are_read_as_numbers_not_split` was protecting.

    The year rule changes the reading, not the property: the whole token still
    becomes ONE phrase, never digit by digit, never a decimal, and no digit
    survives into Speech Text.
    """
    out = normalize_for_speech("In 1963 Milgram published.")
    assert out == "In nineteen sixty three Milgram published."
    assert "point" not in out
    assert "one nine six three" not in out
    assert not any(character.isdigit() for character in out)


@pytest.mark.parametrize(
    "source,expected",
    [
        ("Dr. Milgram ran the study.", "Doctor Milgram ran the study."),
        ("Prof. Zimbardo disagreed.", "Professor Zimbardo disagreed."),
        ("Mr. and Mrs. Smith took part.", "Mister and Misses Smith took part."),
        ("Ms. Chen replicated it.", "Miss Chen replicated it."),
        ("Mood, arousal, etc. all matter.", "Mood, arousal, et cetera all matter."),
    ],
)
def test_expands_titles_and_etc_from_normalize_rs(source, expected):
    """These live in the desktop reader's normalize.rs and occur in this book.

    Without them the engine reads the abbreviation period as a sentence end.
    """
    assert normalize_for_speech(source) == expected


@pytest.mark.parametrize(
    "source,expected",
    [
        # The citation shapes from the issue.
        ("Obedience was high (Milgram, 1963).",
         "Obedience was high (Milgram, nineteen sixty three)."),
        # Author lists compress three surnames; the property this row is here for
        # -- a year inside a citation reads in year form -- is unchanged.
        ("Later work agreed (Tyler, Degoey, and Smith, 1996).",
         "Later work agreed (Tyler and others, nineteen ninety six)."),
        ("In 1963 Milgram published.", "In nineteen sixty three Milgram published."),
        ("1963 was the year.", "nineteen sixty three was the year."),
        # A century mark, and the 01-09 slot inside a century.
        ("The lab opened in 1900.", "The lab opened in nineteen hundred."),
        ("Binet published in 1905.", "Binet published in nineteen oh five."),
        # 2000-2009 stay cardinal; 2010 and later read in halves.
        ("Kahneman (2000) reviewed it.", "Kahneman (two thousand) reviewed it."),
        ("Ariely (2003) disagreed.", "Ariely (two thousand three) disagreed."),
        ("Haidt (2010) reframed it.", "Haidt (twenty ten) reframed it."),
        ("A 2026 replication followed.", "A twenty twenty six replication followed."),
        # Historical dates are years too.
        ("The revolution began in 1789.",
         "The revolution began in seventeen eighty nine."),
    ],
)
def test_reads_a_four_digit_year_in_year_form(source, expected):
    assert normalize_for_speech(source) == expected


@pytest.mark.parametrize(
    "source,expected",
    [
        # The thousands separator is the signal: a grouped number is a quantity.
        ("There were 1,963 responses.",
         "There were one thousand nine hundred sixty three responses."),
        # Below the floor a four-digit number is a quantity. Reference-list page
        # numbers live here -- fixtures/prose.html:152 cites pages 1196-1210.
        ("The article runs from page 1196 to page 1210.",
         "The article runs from page one thousand one hundred ninety six to page "
         "one thousand two hundred ten."),
        ("A 1499 count is not a year.",
         "A one thousand four hundred ninety nine count is not a year."),
        # ... and 1500 is the first that is.
        ("A charter from 1500 survives.", "A charter from fifteen hundred survives."),
        # Above the ceiling, back to a quantity.
        ("The estimate was 2100 people.",
         "The estimate was two thousand one hundred people."),
        # Currency claims its token before the year pass can see it.
        ("The grant was $1963 that year.",
         "The grant was one thousand nine hundred sixty three dollars that year."),
    ],
)
def test_four_digit_numbers_that_are_not_years_stay_cardinal(source, expected):
    assert normalize_for_speech(source) == expected


def test_a_year_shaped_decimal_is_still_a_decimal():
    """DECIMAL_RE runs before the year pass, so `1963.5` is never a year."""
    assert normalize_for_speech("The mean was 1963.5 across conditions.") == \
        "The mean was one thousand nine hundred sixty three point five across conditions."


@pytest.mark.parametrize(
    "source,expected",
    [
        # The issue's headline sentence, fixtures/prose.html:62. Note the source
        # page never closes the outer parenthesis -- this is the real text.
        ("In his summer camp studies, Muzafer Sherif and his colleagues "
         "(Sherif, Harvey, White, Hood, & Sherif (1961) created intergroup competition.",
         "In his summer camp studies, Muzafer Sherif and his colleagues "
         "(Sherif and others, nineteen sixty one) created intergroup competition."),
        # Three surnames is the threshold. prose.html:84.
        ("Researchers identified two types of morality (Turiel, Killen, & Helwig, 1987).",
         "Researchers identified two types of morality (Turiel and others, "
         "nineteen eighty seven)."),
        # Four. prose.html:113.
        ("People often accept it (Jost, Pelham, Sheldon, & Sullivan, 2003).",
         "People often accept it (Jost and others, two thousand three)."),
        # The spelled conjunction, not the ampersand. Both occur.
        ("Later work agreed (Tyler, Degoey, and Smith, 1996).",
         "Later work agreed (Tyler and others, nineteen ninety six)."),
        # A particle surname in the middle of the list. prose.html:116.
        ("Low-status groups reframe. (Derks, van Laar, & Ellemers, 2007).",
         "Low-status groups reframe. (Derks and others, two thousand seven)."),
        # A two-particle surname leading its own citation, after a one-author
        # citation that must survive intact. prose.html:125.
        ("Poor people may believe it (Jost, 2011; van der Toorn, Tyler, & Jost, 2011).",
         "Poor people may believe it (Jost, twenty eleven; van der Toorn and others, "
         "twenty eleven)."),
        # Two long citations in one parenthetical. prose.html:115.
        ("Leaving is costly (Ellemers, Spears, & Doosje, 1997; "
         "Spears, Doosje, & Ellemers, 1997).",
         "Leaving is costly (Ellemers and others, nineteen ninety seven; "
         "Spears and others, nineteen ninety seven)."),
        # Mixed lengths in one parenthetical: the short one keeps both names.
        # prose.html:118.
        ("It may involve violence (Ellemers & Barreto, 2009; "
         "Leonard, Moons, Mackie, & Smith, 2011; Levine, Taylor, & Best, 2011).",
         "It may involve violence (Ellemers & Barreto, two thousand nine; "
         "Leonard and others, twenty eleven; Levine and others, twenty eleven)."),
    ],
)
def test_compresses_a_citation_of_three_or_more_authors(source, expected):
    """Three or more surnames collapse to the first plus "and others".

    Same words `et al.` already expands to (normalize.py:47), so a citation
    written either way sounds identical. The year keeps its own reading:
    this pass hands the digits back and YEAR_RE reads them.
    """
    assert normalize_for_speech(source) == expected


@pytest.mark.parametrize(
    "source,expected",
    [
        # One and two-author citations already read cleanly, so they are returned
        # verbatim -- byte for byte what this file produced before the citation
        # pass existed. The end-to-end suite asserts one of these shapes too.
        ("Obedience was high (Milgram, 1963).",
         "Obedience was high (Milgram, nineteen sixty three)."),
        ("Fairness is a basic human impulse (Tyler & Blader, 2000).",
         "Fairness is a basic human impulse (Tyler & Blader, two thousand)."),
        # A one-author citation whose surname carries a particle. prose.html:83.
        ("Chimpanzees share food (de Waal, 1996).",
         "Chimpanzees share food (de Waal, nineteen ninety six)."),
        # Several short citations in one parenthetical: nothing compresses, so
        # the parenthetical is returned untouched. prose.html:64.
        ("Groups compete for scarce resources (Brewer & Campbell, 1976; Jackson, 1993).",
         "Groups compete for scarce resources (Brewer & Campbell, nineteen seventy six; "
         "Jackson, nineteen ninety three)."),
    ],
)
def test_a_short_citation_reads_exactly_as_it_did_before(source, expected):
    assert normalize_for_speech(source) == expected


@pytest.mark.parametrize(
    "source",
    [
        # The issue names these four by hand. Each fails the pattern for a
        # different reason: no year, no year, no year, and no capitalised
        # surname after the opening parenthesis.
        "Answer (a) is correct.",
        "The rule is explained (see Chapter 3).",
        "The photograph is free to reuse (Pexels license).",
        "It appears in the handbook (4th ed., Vols. 1 and 2, pp. 595-629).",
        # Ordinary parenthetical asides from the corpus. prose.html:64, 65, 98.
        "It is easy (and accurate) to blame the other group.",
        "The outcomes are integrative (the parties can both gain).",
        "We endorse paying taxes (indeed, almost everyone does).",
        # `et al.` is already handled upstream and must not be touched again.
        "Jost et al. found that poorer people agreed.",
    ],
)
def test_a_parenthesis_that_is_not_a_long_citation_is_untouched(source):
    """The main risk in this issue, and it is silent: a false positive eats prose.

    Asserted as a property rather than an exact string because several of these
    also pass through the number passes, and pinning the whole output here would
    make this test about INTEGER_RE instead of about the citation pattern.
    """
    out = normalize_for_speech(source)
    assert "and others" not in out or "et al" in source


@pytest.mark.parametrize(
    "entry",
    [
        # fixtures/prose.html:173 and :178, the reference list at the foot of the
        # page. These blocks ARE the attribution -- the only place the full author
        # list is spoken -- so the issue puts them out of scope.
        #
        # Nothing detects "this is a bibliography": normalize_for_speech sees one
        # sentence at a time and has no idea which block it came from. What keeps
        # the pass out is the shape. An entry's only parenthesis is `(1961)`,
        # `(Eds.)` or `(pp. 55-243)`, none of which opens on a surname, and its
        # initials are single letters, which the two-letter surname rule rejects.
        "Sherif, M., Harvey, O. J., White, B. J., Hood, W. R., & Sherif, C. (1961). "
        "Intergroup conflict and cooperation: The robbers' cave experiment. "
        "Norman, OK: University of Oklahoma Press.",
        "Turiel, E., Killen, M., & Helwig, C. (1987). Morality: Its structure, "
        "functions and vagaries. In J. Kagan & S. Lamb (Eds.), The emergence of "
        "morality in young children (pp. 55-243). Chicago, IL: University of "
        "Chicago Press.",
        "Tyler, T. R., & Smith, H. J. (1998). Social justice and social movements. "
        "In D. T. Gilbert, S. T. Fiske, & G. Lindzey (Eds.), The handbook of social "
        "psychology (4th ed., Vols. 1 and 2, pp. 595-629). New York, NY: McGraw-Hill.",
    ],
)
def test_a_reference_list_entry_is_left_as_it_reads_today(entry):
    out = normalize_for_speech(entry)
    assert "and others" not in out
    for surname in ("Sherif", "Harvey", "White", "Hood", "Turiel", "Killen",
                    "Helwig", "Gilbert", "Fiske", "Lindzey"):
        if surname in entry:
            assert surname in out


@pytest.mark.parametrize(
    "citation,compresses",
    [
        # Every distinct in-text citation on social_psychology/13.01, verbatim from
        # fixtures/prose.html, each on the side the pattern must put it. This is the
        # readout for this change: it says how much of a real page moved, and a
        # pattern that drifts in either direction moves a row across the column.
        ("(Sherif, Harvey, White, Hood, & Sherif (1961)", True),
        ("(Turiel, Killen, & Helwig, 1987)", True),
        ("(Tabibnia, Satpute, & Lieberman, 2008)", True),
        ("(Schroeder, Steele, Woodell, & Bernbenek, 2003)", True),
        ("(Tyler, Degoey, & Smith, 1996)", True),
        ("(Jost, Pelham, Sheldon, & Sullivan, 2003)", True),
        ("(Ellemers, Spears, & Doosje, 1997; Spears, Doosje, & Ellemers, 1997)", True),
        ("(Derks, van Laar, & Ellemers, 2007)", True),
        ("(Ellemers & Barreto, 2009; Leonard, Moons, Mackie, & Smith, 2011; "
         "Levine, Taylor, & Best, 2011)", True),
        ("(Jost, 2011; van der Toorn, Tyler, & Jost, 2011)", True),
        ("(Staub, 2011)", False),
        ("(Brewer & Campbell, 1976; Jackson, 1993)", False),
        ("(Coser, 1956; Rispens & Jehn, 2011)", False),
        ("(de Waal, 1996)", False),
        ("(Darley & Shultz, 1990; Haidt & Kesebir, 2010)", False),
        ("(Helwig & Turiel, 2002)", False),
        ("(Tyler & Lind, 2001; Tyler & Smith, 1998)", False),
        ("(Tyler & Blader, 2000)", False),
        ("(Lerner, 1980)", False),
        ("(Jost & Banaji, 1994; Major, 1994)", False),
        ("(Bobo, 1983; Sidanius & Pratto, 1999)", False),
        ("(Gurr, 1970)", False),
        # Narrative form: only the year is parenthesised, so it is out of scope
        # and keeps all four surnames.
        ("Data are from Jost, Pelham, Sheldon, and Sullivan (2003).", False),
    ],
)
def test_every_citation_on_13_01_lands_on_the_intended_side(citation, compresses):
    out = normalize_for_speech(citation)
    assert ("and others" in out) is compresses


@pytest.mark.parametrize(
    "source,expected",
    [
        ('Er sagte „Hallo" zum Publikum.', 'Er sagte "Hallo" zum Publikum.'),
        ('Той каза „добре" и си тръгна.', 'Той каза "добре" и си тръгна.'),
        ("Il a dit « bonjour » poliment.", 'Il a dit " bonjour " poliment.'),
        ("Se ‚citation' inside.", "Se 'citation' inside."),
        ("A soft­hyphen splits nothing.", "A softhyphen splits nothing."),
        ("Zero‌width joiners vanish.", "Zerowidth joiners vanish."),
        ("The angle was 30′ exactly.", "The angle was thirty' exactly."),
        ("Wait… then continue.", "Wait. then continue."),
        ("﻿Leading byte order mark.", "Leading byte order mark."),
    ],
)
def test_folds_characters_supertonic_cannot_represent(source, expected):
    assert normalize_for_speech(source) == expected


def test_quote_folding_leaves_ascii_quotes_alone():
    assert normalize_for_speech('He said "no" twice.') == 'He said "no" twice.'


# --- I6 (final-review): fold_unrepresentable is the piece pipeline/translate.py
# applies to TRANSLATED text, which must never see normalize_for_speech's other,
# English-only passes (number spelling, abbreviation expansion). ---


@pytest.mark.parametrize(
    "source,expected",
    [
        ('Er sagte „Hallo" zum Publikum.', 'Er sagte "Hallo" zum Publikum.'),
        ("Il a dit « bonjour » poliment.", 'Il a dit " bonjour " poliment.'),
    ],
)
def test_fold_unrepresentable_handles_the_same_german_and_french_quotes(source, expected):
    assert fold_unrepresentable(source) == expected


def test_fold_unrepresentable_does_not_run_the_english_number_pipeline():
    """The whole reason this is a separate function from normalize_for_speech:
    applying the full English pipeline to translated text would spell out
    numbers in ENGLISH words inside a German or French sentence. This is a
    German sentence containing a raw digit; fold_unrepresentable must fold the
    quote and leave the digit exactly alone."""
    source = 'Er hat „37" Äpfel gekauft.'
    out = fold_unrepresentable(source)
    assert out == 'Er hat "37" Äpfel gekauft.'
    assert "thirty" not in out.lower(), "fold_unrepresentable must not spell numbers in English"


def test_a_bare_domain_url_is_spoken_as_link():
    """normalize.py carried its OWN copy of the URL pattern, and it had the same
    scheme-only blind spot pipeline/protect.py did. The staged social_psychology
    page's image credit reads `Source: commons.wikimedia.org/wiki/File:...`, so
    English listeners were hearing the whole path spelled out with the date read
    as "nineteen ninety three nine thirteen" -- the module's own URL rule exists
    precisely so that never happens. Both copies now share one definition
    (pipeline.protect.URL_RE), so the next gap closes in one place."""
    out = normalize_for_speech(
        "Source: commons.wikimedia.org/wiki/File:Bill_Clinton_1993-09-13.jpg")
    assert out == "Source: link"


def test_a_doi_is_not_mistaken_for_a_bare_domain_url():
    """`10.1177/0956797611398495` is `label.label/path` too. It must still be
    read as a number, not silently replaced by the word "link" -- the reference
    list is content."""
    out = normalize_for_speech("doi: 10.1177/0956797611398495.")
    assert "link" not in out
    assert out.startswith("doi: ten point")


def test_an_equals_sign_is_spoken():
    """Supertonic drops a symbol it cannot pronounce, so "P_i = 1 atm" was read
    as "Pi one atm" -- the relation, the whole point of the sentence, silently
    gone. 626 occurrences over 80 pages. This is prose the author typed inline,
    not MathJax, so math_phrasing.py never sees it."""
    assert normalize_for_speech("Pi = 1 atm") == "Pi equals one atm"
    assert normalize_for_speech("x=y") == "x equals y"


def test_an_equals_sign_inside_a_link_is_not_spoken():
    """URL_RE runs first, so a query string never reaches this rule."""
    assert normalize_for_speech("See https://example.org/a?b=c for more") == (
        "See link for more")


# LT-214: English is spoken by Phonon now. Each case below was rendered raw
# through Phonon 31M (path A, wasm fp32) and transcribed by Whisper on
# 2026-11-01; these are the ones it read wrongly or not at all. What it already
# reads well (& as "and", < as "is less than", + as "plus", °C, @) is left alone.
@pytest.mark.parametrize(
    "source,expected",
    [
        # Heard "five euros" raw, but the integer pass runs first and would have
        # left "€five", so the pipeline has to own every currency it spells.
        ("It cost €5 to enter.", "It cost five euros to enter."),
        ("It cost €1 to enter.", "It cost one euro to enter."),
        ("The fee was £3.50 each.", "The fee was three pounds and fifty pence each."),
        ("A ticket costs ¥1,200 in Tokyo.",
         "A ticket costs one thousand two hundred yen in Tokyo."),
        # Heard "€9,158".
        ("Rent rose to ₹15,000 a month.", "Rent rose to fifteen thousand rupees a month."),
        ("It cost €2.05.", "It cost two euros and five cents."),
    ],
)
def test_speaks_every_currency_symbol(source, expected):
    assert normalize_for_speech(source) == expected


@pytest.mark.parametrize(
    "source,expected",
    [
        # Heard "equals": the opposite of what the sentence says.
        ("Assume that x != y here.", "Assume that x does not equal y here."),
        ("Assume that x ≠ y here.", "Assume that x does not equal y here."),
        # Heard "is less than": the "or equal" was lost.
        ("Assume that x <= y here.", "Assume that x is less than or equal to y here."),
        ("Assume that x ≤ y here.", "Assume that x is less than or equal to y here."),
        ("Assume that x >= y here.", "Assume that x is greater than or equal to y here."),
        ("Assume that x ≥ y here.", "Assume that x is greater than or equal to y here."),
        ("We have pi ≈ 3.14.", "We have pi approximately equals three point one four."),
        ("The result was 5 ± 2 units.", "The result was five plus or minus two units."),
        ("Then 6 ÷ 2 gives 3.", "Then six divided by two gives three."),
        # Heard "by", which is wrong for the scientific notation chemistry is full of.
        ("That is 6.02 × 10 atoms.", "That is six point zero two times ten atoms."),
    ],
)
def test_speaks_relations_and_operators(source, expected):
    assert normalize_for_speech(source) == expected


@pytest.mark.parametrize(
    "source,expected",
    [
        ("© 2024 LibreTexts.", "copyright twenty twenty four LibreTexts."),
        # Heard "Brandy" and "Nae McGree Tee": the marks are not read aloud at all.
        ("The Brand® and Name™ logos.", "The Brand and Name logos."),
        ("See § 4 of the act.", "See section four of the act."),
        ("See §§ 4 of the act.", "See sections four of the act."),
        ("It was the #1 choice.", "It was the number one choice."),
        ("There were ~5 people.", "There were about five people."),
        ("Mix a ½ cup of water.", "Mix a one half cup of water."),
        ("Add ¾ cup.", "Add three quarters cup."),
        ("It rose from 10–20 percent.", "It rose from ten to twenty percent."),
        # Heard "the UK neighbor and the union".
        ("The U.K. and the E.U. agreed.", "The U K and the E U agreed."),
        ("They moved to the U.S.", "They moved to the U S."),
    ],
)
def test_speaks_marks_and_initialisms(source, expected):
    assert normalize_for_speech(source) == expected


def test_a_temperature_degree_sign_is_spoken():
    assert normalize_for_speech("It was 25°C at noon.") == (
        "It was twenty five degrees Celsius at noon.")
    assert normalize_for_speech("It was 98.6 °F.") == (
        "It was ninety eight point six degrees Fahrenheit.")
    assert normalize_for_speech("A 90° angle.") == "A ninety degrees angle."


@pytest.mark.parametrize(
    "source,expected",
    [
        # A currency sign or percent with no number after it is left as it is;
        # the comma used to be taken for an amount, and int("") raised.
        ("Prices are listed in €, £ and ¥.", "Prices are listed in €, £ and ¥."),
        ("Up a,% b.", "Up a,% b."),
        # The comma after an amount is the sentence's, not the number's.
        ("It costs $5, which is cheap.", "It costs five dollars, which is cheap."),
        ("It rose 5%, then fell.", "It rose five percent, then fell."),
        ("It costs $1,250.", "It costs one thousand two hundred fifty dollars."),
    ],
)
def test_a_sign_without_an_amount_is_not_read_as_one(source, expected):
    assert normalize_for_speech(source) == expected


@pytest.mark.parametrize(
    "source,expected",
    [
        # Part of a name, not "number": C# is a language.
        ("Written in C# 7 for speed.", "Written in C# seven for speed."),
        # A fraction after a whole number is added to it.
        ("It took 2½ hours.", "It took two and one half hours."),
        ("It took 2 ¼ hours.", "It took two and one quarter hours."),
        # Only an unspaced en dash between numbers is a range; a spaced one is
        # a dash in the sentence, or a minus.
        ("We get 5 – 3 here.", "We get five – three here."),
        ("It costs $5–$10.", "It costs five dollars to ten dollars."),
    ],
)
def test_marks_read_in_context(source, expected):
    assert normalize_for_speech(source) == expected


@pytest.mark.parametrize(
    "source,expected",
    [
        # The unit agrees with the whole amount, not with the pence.
        ("It costs £1.01 now.", "It costs one pound and one penny now."),
        ("It costs $2.50 now.", "It costs two dollars and fifty cents now."),
        # A strict inequality is one relation, not "does not equal" then "equals".
        ("Check that x !== y here.", "Check that x does not equal y here."),
        # An initialism that ends the text keeps its full stop, even when the
        # source ends with a newline.
        ("They moved to the U.S.\n", "They moved to the U S."),
    ],
)
def test_reads_amounts_relations_and_initialisms_whole(source, expected):
    assert normalize_for_speech(source) == expected
