from pipeline.languages import BROKEN_REVERSE, EXCLUDED, HIGHER_RISK, TARGETS


def test_ships_twenty_nine_targets():
    assert len(TARGETS) == 29


def test_english_is_the_source_not_a_target():
    assert "en" not in TARGETS


def test_hindi_is_excluded_with_a_recorded_reason():
    assert "hi" not in TARGETS
    assert "U+090B" in EXCLUDED["hi"]


def test_every_target_has_both_directions():
    for code, lang in TARGETS.items():
        assert lang.forward, f"{code} has no forward model"
        assert lang.reverse, f"{code} has no reverse model"


def test_no_model_name_was_guessed_by_pattern():
    """opus-mt-en-<code> does not exist for these; a pattern-built name silently
    drops them. Regression test for exactly that bug."""
    for code in ("pt", "pl", "ko", "tr", "lt", "lv", "ja", "hr", "sl"):
        assert TARGETS[code].forward != f"Helsinki-NLP/opus-mt-en-{code}"


def test_group_and_multilingual_models_carry_a_target_token():
    for code, lang in TARGETS.items():
        if "-sla" in lang.forward or "-mul" in lang.forward or "-roa" in lang.forward:
            assert lang.forward_token, f"{code} uses a group model but has no target token"
        else:
            assert lang.forward_token is None, f"{code} uses a direct model but sets a token"


def test_every_target_has_a_human_label():
    for code, lang in TARGETS.items():
        assert lang.english and lang.endonym, f"{code} is missing a label"


def test_only_opus_mt_checkpoints_are_used():
    """The single most important property of this file: no NLLB checkpoint may appear
    (every NLLB checkpoint is cc-by-nc-4.0, out of scope on licence grounds). Guards
    both directions so a future edit can't swap one in to "fix" a HIGHER_RISK language."""
    for code, lang in TARGETS.items():
        for direction, name in (("forward", lang.forward), ("reverse", lang.reverse)):
            assert name.startswith("Helsinki-NLP/"), f"{code} {direction} is not a Helsinki-NLP checkpoint: {name}"
            assert "nllb" not in name.lower(), f"{code} {direction} is an NLLB checkpoint: {name}"


def test_reverse_direction_never_carries_a_target_token():
    """Every reverse checkpoint in this table translates into English only (a single
    target language), so none of them take a ">>xxx<<" selector token -- unlike the
    forward group/multilingual models, which do. See R11: opus-mt-roa-en and
    opus-mt-sla-en both declare "target language(s): eng" on their model cards."""
    for code, lang in TARGETS.items():
        assert lang.reverse_token is None, f"{code} reverse direction has a token but targets only English"


def test_higher_risk_matches_the_group_and_multilingual_forward_models():
    """HIGHER_RISK is a derived interface, not an independent one -- it must stay in
    sync with which forward models are group/multilingual (-sla, -mul) rather than
    dedicated pairs, or a later edit to TARGETS could silently desync the two."""
    for code, lang in TARGETS.items():
        is_group_or_multilingual = "-sla" in lang.forward or "-mul" in lang.forward
        if code in HIGHER_RISK:
            assert is_group_or_multilingual, f"{code} is in HIGHER_RISK but its forward model is a direct pair"
        else:
            assert not is_group_or_multilingual, f"{code} uses a group/multilingual forward model but is not in HIGHER_RISK"


def test_no_target_uses_a_reverse_checkpoint_known_to_be_broken():
    """opus-mt-tc-big-it-en and -ar-en are mispackaged on the Hub: the FORWARD
    direction is perfect and only the round trip is garbage, so pipeline/qa.py
    scores a flawless translation as total collapse (Italian screened at a 100.0%
    failure rate, median 0.000). They are bigger and newer than the plain
    checkpoints that replace them, so repointing TARGETS "back" to them looks like
    an upgrade -- this test is what makes that a failure instead of a mystery."""
    for code in BROKEN_REVERSE:
        assert TARGETS[code].reverse == f"Helsinki-NLP/opus-mt-{code}-en", (
            f"{code} must use the plain reverse checkpoint; see BROKEN_REVERSE"
        )
        assert "tc-big" not in TARGETS[code].reverse


def test_every_broken_reverse_entry_names_a_real_target_and_a_reason():
    for code, reason in BROKEN_REVERSE.items():
        assert code in TARGETS, f"BROKEN_REVERSE names {code}, which is not shipped"
        assert len(reason) > 80, f"{code}'s reason is too thin to act on"


def test_french_reverse_was_checked_and_kept():
    """The Italian defect is NOT a tc-big class defect. opus-mt-tc-big-fr-en round
    trips correctly and stays -- asserted so a later sweep of "remove every tc-big
    reverse" cannot quietly invalidate the shipped French pair."""
    assert TARGETS["fr"].reverse == "Helsinki-NLP/opus-mt-tc-big-fr-en"
    assert "fr" not in BROKEN_REVERSE
