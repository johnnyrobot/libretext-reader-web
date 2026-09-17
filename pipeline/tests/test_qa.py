import pytest

from pipeline.qa import (
    LanguageScore, is_degenerate, sample_ids, score_language, sentence_score,
)


def test_identical_round_trip_scores_high():
    assert sentence_score("The cat sat on the mat.", "The cat sat on the mat.") > 0.9


def test_unrelated_round_trip_scores_low():
    assert sentence_score("The cat sat on the mat.", "Bananas quantum yesterday.") < 0.35


def test_paraphrase_scores_in_between():
    score = sentence_score("The cat sat on the mat.", "A cat was sitting on the mat.")
    assert 0.35 < score < 0.95


def test_masked_spans_are_excluded_from_scoring():
    """Without this every equation round-trips as a placeholder and scores as a
    mismatch, so the metric becomes noise on any page with maths."""
    a = "The value [[MATH0]] is fixed."
    b = "El valor [[MATH0]] es fijo."
    assert sentence_score(a, b) == sentence_score("The value is fixed.", "El valor es fijo.")


@pytest.mark.parametrize("text", [
    "", "   ",
    "the the the the the the the the",
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
])
def test_degenerate_output_is_detected(text):
    assert is_degenerate(text) is True


def test_ordinary_text_is_not_degenerate():
    assert is_degenerate("A perfectly normal sentence about cats.") is False


def test_a_healthy_language_ships():
    pairs = [("The cat sat.", "The cat sat.")] * 20
    score = score_language("es", pairs)
    assert score.ships is True
    assert score.failure_rate == 0.0


def test_a_collapsed_language_does_not_ship():
    pairs = [("The cat sat on the mat.", "zzz zzz zzz")] * 20
    score = score_language("sl", pairs)
    assert score.ships is False
    assert "failure rate" in score.reason or "median" in score.reason


def test_one_bad_sentence_in_a_hundred_still_ships():
    # R6 (controller ruling): the brief's original version of this test used a
    # 20-sentence sample with 1 failure, i.e. a 5% failure rate -- which exceeds
    # the module's own MAX_FAILURE_RATE of 2% (spec Sec9.1: "More than 2% of sampled
    # sentences fail -> the language does not ship"). That test could not pass
    # against a correct implementation. This version preserves the original intent
    # -- one bad sentence should not sink a language -- at a sample size where a
    # single failure sits under the 2% threshold.
    pairs = [("The cat sat.", "The cat sat.")] * 99 + [("The cat sat.", "zzz")]
    score = score_language("es", pairs)
    assert score.ships is True
    assert score.failure_rate == pytest.approx(0.01, abs=0.001)


def test_one_bad_sentence_in_twenty_does_not_ship():
    # Complement to the test above, pinning the failure-rate boundary from the
    # other side: 1/20 is a 5% failure rate, which exceeds the 2% cap, so the
    # language must not ship.
    pairs = [("The cat sat.", "The cat sat.")] * 19 + [("The cat sat.", "zzz")]
    score = score_language("es", pairs)
    assert score.ships is False
    assert score.failure_rate == pytest.approx(0.05, abs=0.001)


def test_scoring_an_empty_sample_does_not_ship():
    score = score_language("es", [])
    assert score.ships is False
    assert "no sample" in score.reason


def test_sampling_is_deterministic_and_about_five_percent():
    ids = [f"b0s{i}" for i in range(200)]
    first = sample_ids(ids)
    assert first == sample_ids(ids)
    assert len(first) == 10


def test_sampling_never_returns_nothing_for_a_short_page():
    assert len(sample_ids([f"b0s{i}" for i in range(3)])) >= 1


def test_language_score_is_serialisable():
    score = score_language("es", [("a b c", "a b c")] * 5)
    assert isinstance(LanguageScore(**vars(score)).code, str)


def test_thresholds_are_recorded_on_both_passing_and_failing_results():
    # R22: spec Sec9.1 says the thresholds are "recorded in translation-qa.json
    # alongside the scores... a visible edit rather than a silent default."
    # Before this fix they only appeared inside the failure-reason string, so a
    # PASSING language ("reason='passed'") carried no thresholds at all -- the
    # audit trail existed on every path except the one that matters most.
    import pipeline.qa as qa

    passing = score_language("es", [("The cat sat.", "The cat sat.")] * 20)
    failing = score_language("sl", [("The cat sat on the mat.", "zzz zzz zzz")] * 20)
    for score in (passing, failing):
        assert score.sentence_floor == qa.SENTENCE_FLOOR
        assert score.max_failure_rate == qa.MAX_FAILURE_RATE
        assert score.language_floor == qa.LANGUAGE_FLOOR
        assert score.truncation_ratio == qa.TRUNCATION_RATIO


def test_coverage_defaults_to_zero_when_the_caller_does_not_pass_it():
    # C2 (final-review Critical): covered/total are new fields on LanguageScore,
    # added at the end with defaults so every existing positional construction
    # of the dataclass -- including score_language's own callers that predate
    # this fix -- keeps working unchanged.
    score = score_language("es", [("The cat sat.", "The cat sat.")])
    assert score.covered == 0
    assert score.total == 0


def test_coverage_is_recorded_on_every_branch_score_language_can_return():
    # C2: recorded so a language's track coverage against the SOURCE pool
    # reaches translation-qa.json, on a pass, a failure, and the empty-sample
    # case alike -- not only on the happy path.
    empty = score_language("es", [], covered=3, total=100)
    passing = score_language("es", [("The cat sat.", "The cat sat.")] * 20, covered=90, total=100)
    failing = score_language("sl", [("The cat sat on the mat.", "zzz zzz zzz")] * 20, covered=10, total=100)
    assert (empty.covered, empty.total) == (3, 100)
    assert (passing.covered, passing.total) == (90, 100)
    assert (failing.covered, failing.total) == (10, 100)


def test_phrase_repetition_is_detected_as_degenerate():
    # R23: spec Sec9 names repetition loops as one of the four collapse modes
    # this gate exists to detect. The reviewer's repro was a short MULTI-WORD
    # phrase repeated back-to-back (scoring 0.455 on token F1, above the
    # sentence floor) -- distinct from the single-word-repeated-4+-times case
    # the original is_degenerate already caught.
    text = "over the lazy dog over the lazy dog over the lazy dog"
    assert is_degenerate(text) is True


def test_gross_truncation_is_treated_as_a_failure():
    # R23: spec Sec9 names truncation as another of the four collapse modes.
    # The reviewer's repro was a round trip truncated to ~25% of its source's
    # length that still scored 0.444 on token F1 -- above the sentence floor
    # -- because token F1 rewards the surviving fragment's precision and never
    # looks at how much of the source is simply missing. This needs the
    # source, so the check lives in score_language rather than in
    # is_degenerate (whose signature Task 9 depends on and must not change).
    #
    # Chosen so the miss is unambiguous: a naive length ratio just above the
    # sentence floor could also fail via the pre-existing median-floor check,
    # which would pass this test for the wrong reason. Here the truncated
    # fragment is verbatim (precision 1.0), so token F1 alone scores it 0.545
    # -- comfortably above LANGUAGE_FLOOR (0.50) too, so pre-fix this
    # language ships clean with reason="passed". Only the new truncation
    # check (round trip is 3 of 8 source words = 0.375, below
    # TRUNCATION_RATIO's 0.40) catches it.
    source = "The quick brown fox jumps over lazy dog."
    round_trip = "The quick brown"  # 3 of 8 source words: verbatim but gutted
    assert sentence_score(source, round_trip) > 0.50  # token F1 alone would ship it
    score = score_language("es", [(source, round_trip)] * 20)
    assert score.ships is False


def test_sampling_is_order_independent():
    # R24: the docstring promises determinism "so a re-run scores the same
    # sentences and two runs are comparable," but the original implementation
    # sorted only its OUTPUT and sampled positionally from whatever order it
    # was handed -- the same ids in a different order produced a different
    # sample at the same seed, which the pre-existing
    # test_sampling_is_deterministic_and_about_five_percent could not catch
    # because it compares sample_ids(ids) against itself on one list object.
    ids = [f"b0s{i}" for i in range(200)]
    shuffled = list(reversed(ids))
    assert sample_ids(ids) == sample_ids(shuffled)


def test_a_below_floor_median_does_not_ship_via_the_median_branch():
    # R25: test_a_collapsed_language_does_not_ship reaches the FAILURE-RATE
    # branch (its "zzz zzz zzz" trips is_degenerate, forcing every score to
    # 0.0), and its assertion is an OR over both possible reasons, so the
    # median-floor branch was never actually exercised by name. This pair
    # scores consistently in (0.35, 0.50): above the sentence floor, so no
    # individual sentence is counted as a failure, but below the language
    # floor, so only the median check can catch it.
    source = "The quick brown fox jumps over lazy dog."
    round_trip = "A slow grey fox jumps over tall wall."
    score = score_language("es", [(source, round_trip)] * 20)
    assert score.failure_rate == 0.0
    assert score.ships is False
    assert "median" in score.reason
