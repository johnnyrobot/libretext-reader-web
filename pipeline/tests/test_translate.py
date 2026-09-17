import json

import pytest

from pipeline.tests.test_protect import marian_like
from pipeline.translate import (
    SentenceCountError, source_sentences, translate_page, translate_sentences,
)


def upper(lines):
    """Stand-in translator: deterministic, order-preserving, placeholder-safe."""
    return [line.upper() for line in lines]


def test_translates_every_sentence_keyed_by_id():
    out = translate_sentences({"b0s0": "hello", "b0s1": "world"}, upper)
    assert out == {"b0s0": "HELLO", "b0s1": "WORLD"}


def test_preserves_order_when_the_translator_batches():
    texts = {f"b0s{i}": f"line {i}" for i in range(50)}
    out = translate_sentences(texts, upper)
    assert out["b0s7"] == "LINE 7"
    assert out["b0s49"] == "LINE 49"


def test_protected_spans_survive_translation():
    """Test-blindness fix (final-review): `upper` preserves every character it
    is given, so it can never catch a placeholder shape a real tokenizer
    mangles -- which is exactly how the U+2E24/U+2E25 defect (R42) shipped
    undetected: this test passed against `upper` the whole time. marian_like
    (pipeline/tests/test_protect.py) models a real tokenizer dropping
    codepoints outside its vocabulary, so this test can actually fail again if
    the placeholder shape regresses."""
    out = translate_sentences({"b0s0": "See https://example.org/x now."}, marian_like)
    assert "https://example.org/x" in out["b0s0"]


def test_a_sentence_whose_placeholder_is_destroyed_is_omitted_not_raised():
    """The reader falls back to English for a missing id, so dropping one sentence
    is graceful. Raising would lose the other 302 sentences on the page."""
    def destroys(lines):
        return ["totally rewritten" for _ in lines]

    out = translate_sentences({"b0s0": "See https://example.org now.", "b0s1": "fine"}, destroys)
    assert "b0s0" not in out
    assert out["b0s1"] == "totally rewritten"


def test_a_translator_that_changes_line_count_is_a_hard_error():
    """Silent desynchronisation would misalign every later sentence with its audio."""
    def drops(lines):
        return [line.upper() for line in lines][:-1]

    with pytest.raises(SentenceCountError):
        translate_sentences({"b0s0": "a", "b0s1": "b"}, drops)


def test_empty_input_produces_empty_output():
    assert translate_sentences({}, upper) == {}


def test_the_section_7_character_fold_reaches_translated_text():
    """I6 (final-review): pipeline/normalize.py's _UNREPRESENTABLE_TABLE was
    only ever applied inside normalize_for_speech, i.e. to ENGLISH text.
    Translated track text went translate_page -> restore -> write_track with
    no fold at all, even though spec Sec7 justified that table by the TARGET
    languages' own conventions -- „ as the standard opening quote in German,
    Bulgarian, Hungarian, Lithuanian, Czech and Polish; « » for French and
    Russian. A translator stand-in that emits German- and French-style guillemets
    models exactly what a real Opus-MT checkpoint outputs; translate_sentences
    must fold them the same way normalize_for_speech folds English source text."""
    def german_and_french_quotes(lines):
        return ['Er sagte „Hallo" zum Publikum.', "Il a dit « bonjour » poliment."]

    out = translate_sentences({"b0s0": "He said hello.", "b0s1": "He said hello politely."},
                              german_and_french_quotes)
    assert out["b0s0"] == 'Er sagte "Hallo" zum Publikum.'
    assert out["b0s1"] == 'Il a dit " bonjour " poliment.'


def test_translate_page_reads_speech_json_and_keys_by_id(tmp_path):
    speech = tmp_path / "speech.json"
    speech.write_text(json.dumps({
        "version": 1, "pageId": "b/p", "title": "T", "lang": "en",
        "blocks": [{"id": "b0", "kind": "prose", "text": "x", "anchor": {"path": [0]},
                    "sentences": [
                        {"id": "b0s0", "display": "One.", "speech": "One.", "offset": 0, "length": 4},
                        {"id": "b0s1", "display": "Two.", "speech": "Two.", "offset": 5, "length": 4},
                    ]}],
    }), encoding="utf-8")

    out = translate_page(speech, "es", upper)
    assert out == {"b0s0": "ONE.", "b0s1": "TWO."}


def test_translate_page_rejects_an_unknown_language(tmp_path):
    speech = tmp_path / "speech.json"
    speech.write_text(json.dumps({"version": 1, "blocks": []}), encoding="utf-8")
    with pytest.raises(KeyError):
        translate_page(speech, "hi", upper)


# --- Task 16: the source-field switch, and the per-language normaliser ---------


def _manifest(sentences: list[dict]) -> dict:
    return {"version": 1, "pageId": "b/p", "title": "T", "lang": "en",
            "blocks": [{"id": "b0", "kind": "prose", "text": "x",
                        "anchor": {"path": [0]}, "sentences": sentences}]}


def test_the_translator_is_handed_display_not_speech(tmp_path):
    """Task 15/16, the whole point of spec Sec11's resolution: an Opus-MT
    checkpoint handed English that already reads "nineteen ninety three" emits
    three separate Spanish numbers, silently reverts to the digits, or
    hallucinates a different value -- 9 of 20 stress sentences failed that way
    against 3 for raw text. So the RAW `display` field is what gets sent.

    The two fields are deliberately different text here, which they never are in
    the other fixtures, so this asserts which one was read rather than passing
    either way."""
    speech = tmp_path / "speech.json"
    speech.write_text(json.dumps(_manifest([
        {"id": "b0s0", "display": "The cat sat.", "speech": "The feline sat.",
         "offset": 0, "length": 12},
    ])), encoding="utf-8")

    assert translate_page(speech, "es", upper) == {"b0s0": "THE CAT SAT."}


def test_a_notice_block_with_no_display_text_falls_back_to_speech(tmp_path):
    """pipeline/tts_manifest.py gives a `notice` block -- the generated "three
    rows and four columns." table announcement -- `display: ""` and a real
    `speech`. There is no raw form of that text anywhere, so `speech` is the
    only source it has ever had. Filtering on `display` alone would have dropped
    every table announcement out of every one of the 29 tracks, silently, and
    the reader would have spoken them in English."""
    speech = tmp_path / "speech.json"
    speech.write_text(json.dumps(_manifest([
        {"id": "b0s0", "display": "", "speech": "three rows and four columns.",
         "offset": 0, "length": 0},
    ])), encoding="utf-8")

    assert translate_page(speech, "es", upper) == {"b0s0": "THREE ROWS AND FOUR COLUMNS."}


def test_the_target_languages_normaliser_runs_on_the_translated_output(tmp_path):
    """The other half of the "before" decision: translating raw text does not
    make normalisation go away, it moves it to the far side of the translator.
    A year that arrives as digits must leave as Spanish words, or Supertonic
    reads the numeral in English."""
    speech = tmp_path / "speech.json"
    speech.write_text(json.dumps(_manifest([
        {"id": "b0s0", "display": "en 1961.", "speech": "en nineteen sixty one.",
         "offset": 0, "length": 8},
    ])), encoding="utf-8")

    assert translate_page(speech, "es", lambda lines: list(lines)) == {
        "b0s0": "en mil novecientos sesenta y uno."}


def test_a_language_with_no_normaliser_yet_is_left_exactly_as_translated(tmp_path):
    """A language with no NORMALIZERS entry keeps the raw digits -- the known,
    bounded gap, not a silent corruption. Rolling out one language at a time must
    not change what the others do.

    The example was "fr" until 2026-08-25 and "de" until 2026-08-27; both times
    the assert below fired the day that language shipped, rather than quietly
    asserting nothing. Polish replaces it because no `Xenova/opus-mt-en-pl`
    export exists, so it cannot ship at all -- the example stays true instead of
    needing a third repointing."""
    from pipeline.lang_normalize import NORMALIZERS
    assert "pl" not in NORMALIZERS

    speech = tmp_path / "speech.json"
    speech.write_text(json.dumps(_manifest([
        {"id": "b0s0", "display": "en 1961.", "speech": "en nineteen sixty one.",
         "offset": 0, "length": 8},
    ])), encoding="utf-8")

    assert translate_page(speech, "pl", lambda lines: list(lines)) == {"b0s0": "en 1961."}


def test_translate_sentences_without_a_code_normalises_nothing():
    assert translate_sentences({"b0s0": "en 1961."}, upper) == {"b0s0": "EN 1961."}


def test_the_normaliser_cannot_reach_inside_a_protected_span():
    """Ordering, and it is load-bearing: the normaliser runs on the MASKED line,
    before pipeline.protect.restore(). Run it after restore instead and the
    digits inside this DOI -- and inside any `[[latex:...]]` payload -- get
    spelled out in Spanish, corrupting a token the reader has to parse. Uses
    marian_like rather than upper so the placeholder really has to survive a
    tokenizer that drops what it does not know."""
    out = translate_sentences(
        {"b0s0": "Ver https://doi.org/10.1111/j.2008 en 1961."}, marian_like, "es")
    assert out["b0s0"].startswith("Ver https://doi.org/10.1111/j.2008 en ")
    assert out["b0s0"].endswith("mil novecientos sesenta y uno.")


# --- Option A: the reference list is not translated ---------------------------


def _page(blocks: list[dict]) -> dict:
    return {"version": 1, "pageId": "b/p", "title": "T", "lang": "en", "blocks": blocks}


def _block(bid: str, kind: str, *texts: str) -> dict:
    return {"id": bid, "kind": kind, "text": texts[0] if texts else "",
            "anchor": {"path": [0]},
            "sentences": [{"id": f"{bid}s{i}", "display": t, "speech": t,
                           "offset": 0, "length": len(t)}
                          for i, t in enumerate(texts)]}


def test_reference_list_entries_are_not_translated():
    """A bibliography is language-neutral -- surnames, years and journal titles
    are proper nouns. Translating them is not a style choice, it introduces
    factual errors: the real checkpoint rendered `Psychological Science` as
    `Ciencia Psicologica` (renaming a journal) and `Sidanius` as `Sidanio`
    (corrupting an author). Every QA failure measured on the staged page was a
    reference entry; none was prose. Left out of the track, they fall back to
    English, which pipeline/tracks.py already does for any missing id."""
    manifest = _page([
        _block("b0", "paragraph", "Groups compete for resources."),
        _block("b1", "heading", "References"),
        _block("b2", "paragraph", "Sidanius, J., & Pratto, F. (1999)."),
        _block("b3", "paragraph", "de Waal, F. (1996)."),
    ])
    assert set(source_sentences(manifest)) == {"b0s0", "b1s0"}


def test_the_references_heading_itself_is_still_translated():
    """"Referencias" is a correct and useful heading, and hearing it before the
    English citations start is what tells a listener the switch was deliberate."""
    manifest = _page([
        _block("b0", "heading", "References"),
        _block("b1", "paragraph", "Bobo, L. (1983)."),
    ])
    assert source_sentences(manifest) == {"b0s0": "References"}


def test_exclusion_stops_at_the_next_heading():
    """Fails safe. The manifest carries no heading LEVEL, so "everything to the
    end of the page" would mute a real section that happens to follow the
    bibliography. Stopping at the next heading degrades to today's behaviour
    instead -- it under-excludes rather than silently dropping prose."""
    manifest = _page([
        _block("b0", "heading", "References"),
        _block("b1", "paragraph", "Bobo, L. (1983)."),
        _block("b2", "heading", "Additional Resources"),
        _block("b3", "paragraph", "The library offers further support."),
    ])
    assert set(source_sentences(manifest)) == {"b0s0", "b2s0", "b3s0"}


@pytest.mark.parametrize("heading", ["References", "REFERENCES", "Bibliography",
                                     "Works Cited", "Reference List", " references ",
                                     # Singular. One page of social_psychology uses
                                     # it, and the plural-only first version of this
                                     # pattern silently translated that whole
                                     # bibliography -- found by the per-run census.
                                     "Reference"])
def test_the_headings_that_open_a_reference_section(heading):
    manifest = _page([_block("b0", "heading", heading),
                      _block("b1", "paragraph", "Bobo, L. (1983).")])
    assert "b1s0" not in source_sentences(manifest)


@pytest.mark.parametrize("heading", ["References to Prior Work", "Cross-Cultural References",
                                     "Key Takeaways", "Morality",
                                     # Real content sections in social_psychology
                                     # that a substring search would have eaten.
                                     "Referent Power", "Sources of Stress",
                                     "Resource Dilemma Games"])
def test_a_heading_that_merely_mentions_references_is_not_one(heading):
    """Anchored, not a substring search. A false positive here mutes real prose
    into English with nothing to signal it happened."""
    manifest = _page([_block("b0", "heading", heading),
                      _block("b1", "paragraph", "Groups compete for resources.")])
    assert "b1s0" in source_sentences(manifest)


def test_a_page_with_no_reference_section_is_unaffected():
    """The generalisation risk, asserted directly: a book that titles its
    bibliography something this does not recognise -- or has none -- must lose
    nothing. It translates exactly what it did before, and translate_cli reports
    the excluded count so a silent zero is visible rather than assumed."""
    manifest = _page([
        _block("b0", "heading", "Morality"),
        _block("b1", "paragraph", "Groups compete.", "Norms guide behavior."),
    ])
    assert set(source_sentences(manifest)) == {"b0s0", "b1s0", "b1s1"}


from pipeline.extract import math_token
from pipeline.math_speech import FALLBACK_SPEECH

TOKEN = math_token(r"\(\Delta U = q + w\)")


def test_translated_line_speaks_the_equation_in_english():
    texts = {"b0s0": f"Energy obeys {TOKEN} always."}
    out = translate_sentences(texts, lambda lines: [l.upper() for l in lines],
                              math_speech={TOKEN: "Delta U equals q plus w"})
    assert out["b0s0"] == "ENERGY OBEYS Delta U equals q plus w ALWAYS."


def test_translated_line_never_voices_base64():
    texts = {"b0s0": f"See {TOKEN}."}
    out = translate_sentences(texts, lambda lines: [l.upper() for l in lines], math_speech={})
    assert out["b0s0"] == f"SEE {FALLBACK_SPEECH}."
    assert "latex:" not in out["b0s0"]
