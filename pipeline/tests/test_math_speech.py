import shutil

import pytest

from pipeline.extract import math_token
from pipeline.math_speech import (
    FALLBACK_SPEECH, MathSpeaker, chemistry_span, is_chemistry, join_math, page_index_prefix,
    speak_tokens,
    split_math, substitute_math,
)

needs_node = pytest.mark.skipif(shutil.which("node") is None, reason="node is a build dependency")

T_INLINE = math_token(r"\(\Delta U_{sys} = q + w\)")
T_DISPLAY = math_token(r"\[x = 1\]")


def test_page_index_prefix_drops_leading_zeros():
    assert page_index_prefix("1.04: The First Law of Thermodynamics") == "1.4"
    assert page_index_prefix("12.10: Something") == "12.10"


def test_page_index_prefix_keeps_a_letter_suffix():
    # Real chem_4b worksheet titles. The site takes whatever precedes the first
    # colon verbatim, so a letter suffix is a page number like any other.
    assert page_index_prefix("5C: (Extra) Intermolecular Forces (Worksheet)") == "5C"
    assert page_index_prefix("1.E: Fundamentals of Thermochemistry (Exercises)") == "1.E"


def test_page_index_prefix_keeps_a_roman_numeral():
    assert page_index_prefix("I: Fundamentals of Thermochemistry") == "I"
    assert page_index_prefix("Unit I: Chemical Thermodynamics") == "Unit I"


def test_page_index_prefix_only_strips_zeros_across_a_dot():
    # The site maps components through parseInt only when the prefix contains a
    # dot, so an undotted prefix keeps its leading zero.
    assert page_index_prefix("05A1: Something") == "05A1"


def test_page_index_prefix_stops_at_the_first_colon():
    assert page_index_prefix("1.2: Ratios: A Review") == "1.2"


def test_page_index_prefix_is_none_without_a_colon():
    assert page_index_prefix("Introduction") is None
    assert page_index_prefix("") is None


def test_split_and_join_round_trip():
    text = f"Energy {T_INLINE} and then {T_DISPLAY}."
    masked, tokens = split_math(text)
    assert masked == "Energy [[MATH0]] and then [[MATH1]]."
    assert tokens == [T_INLINE, T_DISPLAY]
    assert join_math(masked, ["one", "two"]) == "Energy one and then two."


def test_substitute_math_uses_the_map_and_falls_back():
    text = f"See {T_INLINE} and {T_DISPLAY}."
    out = substitute_math(text, {T_INLINE: "Delta U sub sys equals q plus w"})
    assert out == f"See Delta U sub sys equals q plus w and {FALLBACK_SPEECH}."


def test_substitute_math_is_a_no_op_without_tokens():
    assert substitute_math("plain", {}) == "plain"


@needs_node
def test_speaker_speaks_and_reports_errors():
    with MathSpeaker() as speaker:
        speaker.reset({"PageIndex": "1.4"})
        assert speaker.speak(r"\Delta U = q + w", False).endswith("Delta U equals q plus w")
        assert speaker.speak(r"\nosuchmacro", False) is None
        # The process survives an error and answers the next request.
        assert speaker.speak("q", False) == "q"


@needs_node
def test_speaker_honours_the_preamble_per_page():
    with MathSpeaker() as speaker:
        speaker.reset({})
        speaker.define(r"\newcommand{\dU}{\Delta U}")
        assert speaker.speak(r"\dU", False).endswith("Delta U")
        speaker.reset({})
        assert speaker.speak(r"\dU", False) is None  # a reset forgets the macro


@needs_node
def test_speak_tokens_builds_the_map_with_phrasing_and_counts_failures():
    bad = math_token(r"\(\nosuchmacro\)")
    with MathSpeaker() as speaker:
        speech, failed = speak_tokens(
            speaker, [T_INLINE, T_DISPLAY, bad],
            title="1.04: The First Law", preamble=[])
    assert speech[T_INLINE] == "Delta U of the system equals q plus w"
    assert speech[T_DISPLAY] == ", x equals one,"
    assert speech[bad] == FALLBACK_SPEECH
    assert failed == 1


# The state-label rules must know a chemistry span from an algebraic one, and
# the only reliable evidence is the LaTeX: \ce, an equilibrium arrow, or a
# literal state label. Measured over chem_4b, this catches 92-100% of the spans
# carrying a state label while wrongly flagging 1 of math_elem_teachers' 689.
def test_is_chemistry_recognises_mhchem_and_state_labels():
    assert is_chemistry(r"\ce{Zn(s) + 2H^{+}(aq)}")
    assert is_chemistry(r"N_2(g) + 3H_2(g)")
    assert is_chemistry(r"A \rightleftharpoons B")


def test_is_chemistry_leaves_algebra_alone():
    assert not is_chemistry(r"\frac{10}{2} = 5")
    assert not is_chemistry(r"v \times s")
    assert not is_chemistry(r"f(x) = x^2")


def test_a_chemistry_book_reads_every_span_as_chemistry():
    # `N_2` in isolation is indistinguishable from an algebraic subscript, so the
    # per-span guard cannot see it. In a chemistry book it is always a molecule,
    # and the book is the only place that knowledge exists.
    assert chemistry_span(r"N_2", chem_book=True)
    assert not chemistry_span(r"N_2", chem_book=False)
    # ... and the per-span evidence still wins on its own, for a book that is
    # mostly not chemistry but has the occasional reaction.
    assert chemistry_span(r"\ce{H2O(l)}", chem_book=False)
