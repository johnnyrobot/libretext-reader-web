from pipeline.math_phrasing import phrase


def test_spelled_subscript_becomes_a_word():
    # A subscript NOT in SUBSCRIPT_WORDS, so this covers the join on its own.
    # Both of this test's original cases (sys, surr) are now table entries and
    # are asserted in full below; the join still has to happen first for the
    # table to see them.
    assert phrase("v sub m a x equals q plus w", False) == "v sub max equals q plus w"


def test_longer_spelled_subscript_becomes_a_word():
    assert phrase("c sub n e t", False) == "c sub net"


def test_single_letter_and_digit_subscripts_are_left_alone():
    assert phrase("x sub i plus O sub 2", False) == "x sub i plus O sub two"


def test_display_equation_is_set_off_with_commas():
    assert phrase("x equals 1", True) == ", x equals one,"


def test_inline_equation_gets_no_commas():
    assert phrase("x equals 1", False) == "x equals one"


def test_page_index_digits_are_joined():
    assert phrase("1.4 .1", False) == "1.4.1"


def test_align_lines_are_flattened_into_one_spoken_clause():
    """This test used to assert the opposite -- that "2 lines Line 1: ... Line 2:
    blank ..." was passed through verbatim -- and that is what shipped first.
    Heard aloud on a real page it was wrong: the scaffolding is Clearspeak
    describing a layout to someone NAVIGATING a matrix, and a reader listening to
    a chapter is not navigating. "blank" is the empty left side of an aligned
    continuation, which no one says out loud. The maths itself is unchanged;
    only the announcements go."""
    text = "2 lines Line 1: w equals negative P Delta V Line 2: blank equals 284 J"
    assert phrase(text, True) == ", w equals negative P Delta V, equals two hundred eighty four J,"


def test_mathvariant_normal_is_not_spoken():
    assert phrase("normal Delta U equals q plus w", False) == "Delta U equals q plus w"


def test_normal_before_a_capitalised_name_is_still_dropped():
    assert phrase("normal Delta H equals q", False) == "Delta H equals q"


def test_the_word_normal_inside_text_survives():
    """Regression: the unanchored rule matched ANY "normal ", so
    \\text{normal boiling point} lost the word entirely -- "boiling point".
    The rule exists only for SRE's mathvariant announcement, which always
    precedes a capitalised name; "normal boiling point" does not."""
    assert phrase("normal boiling point is high", False) == "normal boiling point is high"


def test_normal_before_a_roman_differential_letter_is_dropped():
    """A capital-only anchor missed this shape entirely: \\mathrm{d}x -- the
    standard differential in this material's thermodynamics (dU, dq, dw) --
    is announced by SRE as "normal d x", and "normal" survived in speech.
    \\mathrm{e}, \\mathrm{i} and \\mathrm{p}H are the same shape: a single
    roman letter set with \\mathrm rather than a capitalised Greek name."""
    assert phrase("normal d x", False) == "d x"


def test_no_op_on_plain_text():
    assert phrase("q", False) == "q"


def test_single_line_scaffolding_is_removed():
    assert phrase("1 lines Line 1: x equals 1", False) == "x equals one"


def test_a_multi_line_derivation_reads_as_continuous_prose():
    said = phrase(
        "2 lines Line 1: six sevenths equals 0.857142 and so on "
        "Line 2: blank equals the repeating decimal", False
    )
    assert said == ("six sevenths equals zero point eight five seven one four two and so on, "
                    "equals the repeating decimal")
    assert "Line 1" not in said and "blank" not in said


def test_a_multi_line_equation_with_two_real_sides_keeps_both():
    said = phrase("2 lines Line 1: a equals b Line 2: c equals d", False)
    assert said == "a equals b, c equals d"


def test_ordinary_speech_is_untouched_by_the_line_rules():
    assert phrase("x equals 1", False) == "x equals one"


def test_a_spoken_comma_becomes_the_mark_the_voice_pauses_on():
    assert phrase("341 R 1 comma meaning 1024", False) == (
        "three hundred forty one R one, meaning one thousand twenty four")


def test_the_word_comma_in_prose_survives():
    assert phrase("insert a comma here", False) == "insert a comma here"


def test_a_narrated_fraction_becomes_the_terse_form():
    said = phrase("0.125 equals the fraction with numerator 5 times 25 and denominator 5 times 200", False)
    assert said == "zero point one two five equals five times twenty five over five times two hundred"


def test_a_simple_fraction_keeps_its_natural_ordinal():
    assert phrase("one half plus six sevenths", False) == "one half plus six sevenths"


def test_a_repeating_decimal_is_read_the_way_a_person_says_it():
    assert phrase("the repeating decimal 0 point followed by repeating digit 3", False) == "zero point three repeating"
    # The comma is load-bearing: without it the fixed digits and the repeating
    # ones abut and the listener cannot tell them apart.
    assert phrase(
        "the repeating decimal 0 point 2 9 6 followed by repeating digits 4 1 2 equals 0.296", False
    ) == "zero point two nine six, four one two repeating equals zero point two nine six"


def test_the_whole_number_before_a_repeating_point_is_said_as_a_quantity():
    said = phrase("the repeating decimal 3 4 1 point followed by repeating digit 3", False)
    assert said == "three hundred forty one point three repeating"


def test_an_ellipsis_before_equals_is_a_pause_not_a_range():
    said = phrase("341.3333333 and so on up to equals 341 point 3 repeating", False)
    assert said == ("three hundred forty one point three three three three three three three "
                    "and so on, equals three hundred forty one point three repeating")


# The voice cannot pronounce a bare numeral reliably: measured 2026-09-07
# through the real engine, `1000` came back as "thousand", `0.125` as "0125",
# and `857142` as "A570142". Prose never hits this because normalize_for_speech
# spells its numbers, but math speech is joined into the sentence AFTER that
# pass runs, so SRE's digits reached the voice raw. These pin that phrase()
# closes that gap.
def test_a_long_integer_is_spelled_out():
    assert phrase("857142", False) == "eight hundred fifty seven thousand one hundred forty two"


def test_a_round_thousand_keeps_its_one():
    assert phrase("1000", False) == "one thousand"


def test_a_decimal_is_spelled_out():
    assert phrase("0.125", False) == "zero point one two five"


def test_a_four_digit_quantity_is_not_read_as_a_year():
    # normalize_for_speech reads 1024 as a year ("ten twenty four"), which is
    # right for prose and wrong for arithmetic. Math speech must not inherit it.
    assert phrase("1024", False) == "one thousand twenty four"


def test_spelling_numbers_leaves_the_rest_of_the_phrasing_alone():
    assert phrase("1024 divided by 3 equals 341 R 1", False) == (
        "one thousand twenty four divided by three equals three hundred forty one R one")


# ---- chemistry -------------------------------------------------------------
# Clearspeak narrates mhchem as if it were algebra. Measured across chem_4b's
# 5166 spans: 334 read the equilibrium arrow as "right harpoon over left
# harpoon", 559 said "of sub", and 640 turned a state label into "times g".
# Rules that are unambiguous anywhere are unguarded; the ones that would misfire
# on real algebra ("times s" is a multiplication) run only for a chemistry span.

def test_the_equilibrium_arrow_is_read_as_words():
    assert phrase("a A plus b B right harpoon over left harpoon c C plus d D", False) == (
        "a A plus b B in equilibrium with c C plus d D")


def test_of_sub_is_just_sub():
    assert phrase("H of sub two", False) == "H sub two"


def test_a_formula_does_not_apply_one_element_to_the_next():
    # \ce{MgO} narrated as function application. There is no "of" in MgO.
    assert phrase("M g of O", False) == "M g O"
    assert phrase("H sub three of O", False) == "H sub three O"


def test_an_english_of_is_left_alone():
    said = "the absolute value of T Delta S is less than the absolute value of D"
    assert phrase(said, False) == said


def test_a_charge_is_read_as_plus_or_minus():
    assert phrase("H sub three O raised to the plus power", False) == "H sub three O plus"
    assert phrase("C sub two H sub three O sub two raised to the minus power", False) == (
        "C sub two H sub three O sub two minus")


def test_a_concentration_bracket_is_named():
    assert phrase("open bracket NO sub two close bracket", False) == (
        "the concentration of NO sub two")


def test_state_labels_are_spoken_only_for_chemistry():
    assert phrase("N sub two times g", False, chem=True) == "N two gas"
    assert phrase("Zn of s", False, chem=True) == "Zn solid"
    assert phrase("H sub two O sub open paren l close paren", False, chem=True) == (
        "H two O liquid")
    assert phrase("Cl raised to the minus power of aq", False, chem=True) == (
        "Cl minus aqueous")
    # ... and never for algebra, where "times s" is a multiplication.
    assert phrase("v times s", False) == "v times s"


def test_molar_is_spoken_only_for_chemistry():
    assert phrase("one hundred eighty eight M", False, chem=True) == (
        "one hundred eighty eight molar")
    assert phrase("one hundred eighty eight M", False) == "one hundred eighty eight M"


def test_the_other_equilibrium_arrow_wording_is_also_words():
    # SRE narrates \rightleftharpoons two ways depending on the source symbol.
    # This is the second, and on its own it is unintelligible.
    said = "a A plus b B left harpoon with barb down minus under minus right harpoon with barb up c C"
    assert phrase(said, False) == "a A plus b B in equilibrium with c C"


def test_a_coefficient_does_not_multiply_its_formula():
    # "2 NH3" is two molecules of ammonia, not two times ammonia.
    assert phrase("two times NH sub three gas", False, chem=True) == "two NH three gas"
    # ... but real multiplication in algebra is untouched.
    assert phrase("two times x", False) == "two times x"


def test_no_stray_times_before_the_equilibrium_arrow():
    # SRE puts a multiplication between the last reactant and the arrow symbol.
    assert phrase("two NO gas times right harpoon over left harpoon two NO sub two gas", False) == (
        "two NO gas in equilibrium with two NO sub two gas")


def test_a_chemical_subscript_is_not_announced():
    # Nobody says "O sub two" for O2. They say "O two".
    assert phrase("two NO gas plus O sub two gas", False, chem=True) == "two NO gas plus O two gas"
    assert phrase("H sub two O liquid", False, chem=True) == "H two O liquid"


def test_a_named_subscript_keeps_its_sub():
    # K_c is read "K sub c" -- dropping it there gives "K c", which is worse.
    assert phrase("K sub c equals", False, chem=True) == "K sub c equals"


def test_algebra_keeps_its_subscripts():
    assert phrase("x sub two plus x sub three", False) == "x sub two plus x sub three"


def test_chemistry_parentheses_are_not_announced():
    # P_{CO} -> "P of open paren C O close paren" is unreadable aloud.
    assert phrase("P of open paren C O close paren squared", False, chem=True) == "P C O squared"
    # K(RT)^{...}: the parens carry no meaning a listener needs.
    assert phrase("K times open paren R T close paren raised to the Delta n power",
                  False, chem=True) == "K times R T raised to the Delta n power"
    # K_{(700 K)} = 54
    assert phrase("K sub open paren seven hundred K close paren equals fifty four",
                  False, chem=True) == "K at seven hundred kelvin equals fifty four"


def test_algebra_keeps_its_parentheses():
    said = "open paren x plus one close paren times open paren x minus one close paren"
    assert phrase(said, False) == said


def test_delta_and_natural_log_are_named():
    # Clearspeak calls the increment operator "increment" and spells ln as
    # letters. Chemists say "delta" and "natural log".
    assert phrase("increment G sub rxn equals R T l n Q divided by K sub eq", False) == (
        "delta G of reaction equals R T natural log Q divided by K equilibrium")


def test_an_en_dash_is_a_minus_sign():
    # The worst of the residue: a listener hears the OPPOSITE of the maths.
    assert phrase("equals en dash R T natural log K sub eq", False) == (
        "equals minus R T natural log K equilibrium")
    assert phrase("ten raised to the en dash fourteen power", False) == (
        "ten raised to the minus fourteen power")


def test_units_are_words_not_letters():
    assert phrase("one point zero zero m o l divided by two L", False, chem=True) == (
        "one point zero zero moles divided by two L")
    assert phrase("five k J", False, chem=True) == "five kilojoules"
    assert phrase("one a t m", False, chem=True) == "one atmosphere"
    assert phrase("fifty m L", False, chem=True) == "fifty millilitres"


def test_aq_is_aqueous_however_it_is_spelled():
    assert phrase("Cl minus a q", False, chem=True) == "Cl minus aqueous"


def test_a_chemical_formula_keeps_its_letters():
    # C O is carbon monoxide read as letters, which is correct. Not a unit.
    assert phrase("two C O gas", False, chem=True) == "two C O gas"
    assert phrase("N H three", False, chem=True) == "N H three"


def test_abbreviation_subscripts_are_read_as_the_word_they_abbreviate():
    """Joining "sub s y s" into "sub sys" was only half the fix. Supertonic has
    no entry for "sys", so it guesses from spelling and says "subsidiz"; "univ"
    comes out "subunit". Both were audible on chem_4b 5.7. These are the eight
    commonest subscripts in the book, 959 occurrences over 61 pages."""
    assert phrase("Delta S sub univ is greater than 0", False) == (
        "Delta S of the universe is greater than zero")
    assert phrase("Delta G sub sys is less than 0", False) == (
        "Delta G of the system is less than zero")
    assert phrase("Delta H sub rxn", False) == "Delta H of reaction"
    assert phrase("Delta H sub vap", False) == "Delta H of vaporisation"
    assert phrase("q sub surr", False) == "q of the surroundings"
    assert phrase("K sub sp", False) == "K solubility product"


def test_an_abbreviation_subscript_is_recognised_before_it_is_joined():
    """SRE spells it out; the join runs first, so the table has to see the
    joined form. Asserting the spelled input proves the two run in that order."""
    assert phrase("Delta U sub s y s", False) == "Delta U of the system"


def test_a_subscript_that_is_not_a_known_abbreviation_is_left_spelled():
    """An arbitrary multi-letter subscript is a variable name, and a listener
    needs it read as one. Only the listed chemistry abbreviations expand."""
    assert phrase("x sub abc", False) == "x sub abc"
    assert phrase("K sub c", False) == "K sub c"


def test_an_abbreviation_subscript_is_expanded_after_the_of_sub_rule():
    """SRE writes a subscripted subscript as "of sub". Expanding the table first
    would turn "H of sub rxn" into "H of of reaction"; running OF_SUB_RE first
    leaves one preposition."""
    assert phrase("Delta H of sub rxn", False) == "Delta H of reaction"
