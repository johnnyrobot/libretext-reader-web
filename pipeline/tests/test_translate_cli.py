import json

from pipeline.qa import MAX_FAILURE_RATE, score_language
from pipeline.translate_cli import run
from pipeline.tracks import track_path


def page(tmp_path, name="p"):
    directory = tmp_path / "social_psychology" / name
    directory.mkdir(parents=True)
    speech = directory / "speech.json"
    speech.write_text(json.dumps({
        "version": 1, "pageId": f"social_psychology/{name}", "title": "T",
        "lang": "en", "generatedFrom": "hash1", "languages": [],
        "blocks": [{"id": "b0", "kind": "prose", "text": "x", "anchor": {"path": [0]},
                    "sentences": [
                        {"id": "b0s0", "display": "The cat sat.", "speech": "The cat sat.",
                         "offset": 0, "length": 12},
                        {"id": "b0s1", "display": "The dog ran.", "speech": "The dog ran.",
                         "offset": 13, "length": 12},
                    ]}],
    }), encoding="utf-8")
    return speech


def identity_factory(lang, reverse=False):
    return lambda lines: list(lines)


def sentence_text(index: int) -> str:
    """Fixture sentence text for `index` -- DIGIT-FREE on purpose.

    Task 16 gave `es` a real Spanish spoken-form normaliser that runs inside
    translate_page, so an identity translator is no longer an identity round
    trip for anything containing a numeral: "Sentence 41." reaches the track as
    "Sentence cuarenta y uno." and then scores against "Sentence 41." as a QA
    failure. These tests are about the CLI's gate mechanics, not about Spanish,
    so the fixture gives the normaliser nothing to find. The index is spelled
    with letters a-j (0->a, 1->b, ...) so the text stays unique per id and
    obviously derived from it: 41 -> "Sentence eb.".
    """
    return "Sentence " + "".join("abcdefghij"[int(d)] for d in str(index)) + "."


def many_sentence_page(tmp_path, name, count):
    """A page with `count` sentences, ids zero-padded so lexical sort matches
    numeric order -- several of the tests below need to predict exactly which
    ids pipeline.qa.sample_ids will draw (it is deterministic given a pool's
    size, seed and sort order, not its content -- verified directly against the
    real sample_ids before writing these tests)."""
    width = max(4, len(str(count - 1)))
    directory = tmp_path / "social_psychology" / name
    directory.mkdir(parents=True)
    speech = directory / "speech.json"
    sentences = [
        {"id": f"b0s{i:0{width}d}", "display": sentence_text(i), "speech": sentence_text(i),
         "offset": i * 12, "length": 10}
        for i in range(count)
    ]
    speech.write_text(json.dumps({
        "version": 1, "pageId": f"social_psychology/{name}", "title": "T",
        "lang": "en", "generatedFrom": "hash1", "languages": [],
        "blocks": [{"id": "b0", "kind": "prose", "text": "x", "anchor": {"path": [0]},
                    "sentences": sentences}],
    }), encoding="utf-8")
    return speech


def test_writes_a_track_and_announces_it(tmp_path):
    speech = page(tmp_path)
    qa = tmp_path / "qa.json"
    run(book=tmp_path / "social_psychology", codes=["es"],
        translator_factory=identity_factory, qa_path=qa)

    assert json.loads(track_path(speech, "es").read_text())["text"]["b0s0"] == "The cat sat."
    assert json.loads(speech.read_text())["languages"] == ["es"]


def test_records_a_qa_score_per_language(tmp_path):
    page(tmp_path)
    qa = tmp_path / "qa.json"
    run(book=tmp_path / "social_psychology", codes=["es"],
        translator_factory=identity_factory, qa_path=qa)

    report = json.loads(qa.read_text())
    assert report["es"]["ships"] is True
    assert report["es"]["sampled"] >= 1


def test_a_failing_language_is_removed_rather_than_shipped(tmp_path):
    speech = page(tmp_path)
    qa = tmp_path / "qa.json"

    def collapse_factory(lang, reverse=False):
        return lambda lines: ["zzz" for _ in lines]

    run(book=tmp_path / "social_psychology", codes=["sl"],
        translator_factory=collapse_factory, qa_path=qa)

    assert not track_path(speech, "sl").exists()
    assert json.loads(speech.read_text())["languages"] == []
    assert json.loads(qa.read_text())["sl"]["ships"] is False


def test_second_run_skips_an_unchanged_page(tmp_path):
    speech = page(tmp_path)
    qa = tmp_path / "qa.json"
    calls = []

    def counting_factory(lang, reverse=False):
        def translate(lines):
            calls.append(len(lines))
            return list(lines)
        return translate

    for _ in range(2):
        run(book=tmp_path / "social_psychology", codes=["es"],
            translator_factory=counting_factory, qa_path=qa)

    forward_calls = [n for n in calls if n == 2]
    assert len(forward_calls) == 1, "the second run re-translated an unchanged page"


def test_second_run_over_an_unchanged_page_does_not_drop_the_language(tmp_path):
    """R8 (controller ruling): as the brief originally wrote run(), a second pass
    over a book with nothing left to translate collects zero QA pairs, scores that
    as total collapse via score_language(code, []), and then unlinks every track it
    (and every earlier run) had written -- turning a no-op re-run into data loss.
    This directly contradicts spec Sec8.1 ("re-runs are incremental and
    interruptions are cheap"). test_second_run_skips_an_unchanged_page above does
    NOT catch this: it only counts translator invocations, and the buggy code path
    never calls the translator either, so it passed while the tracks were being
    destroyed underneath it.

    This test instead inspects the actual artifacts a real second run must leave
    alone: the per-language track file must still be on disk, and speech.json's
    `languages` must still list the language, after running() twice back to back.
    """
    speech = page(tmp_path)
    qa = tmp_path / "qa.json"

    for _ in range(2):
        run(book=tmp_path / "social_psychology", codes=["es"],
            translator_factory=identity_factory, qa_path=qa)

    assert track_path(speech, "es").exists()
    assert json.loads(speech.read_text())["languages"] == ["es"]

    report = json.loads(qa.read_text())
    assert report["es"]["ships"] is True


def test_r28_editing_one_small_page_does_not_sink_a_language_with_many_good_pages(tmp_path):
    """R28 (controller ruling): as written, the QA sample for a language was drawn
    only from the pages touched THIS run, yet a failing verdict was applied via the
    unconditional unlink loop to EVERY page of that language -- so editing one small
    page of a many-page book could delete every other page's good translation based
    on a sample that never even looked at them. Spec Sec9 says "a 5% random sample
    per LANGUAGE", not per changed page.

    p1 has 20 sentences that translate perfectly and are committed to disk in a
    first run. A second run adds p2 (2 sentences, from the `page` fixture) whose
    translator collapses BOTH of its sentences to "zzz" -- not degenerate enough
    for is_degenerate to catch (too short), so both ids really do get written and
    this exercises the QA-pool path rather than the sentence-level forward filter.

    Verified directly against pipeline.qa.sample_ids with the real key shapes this
    module uses (sample_ids' selection depends only on a pool's size/order, never
    its content, for a fixed seed): sampling ONLY p2's own 2 ids -- the old,
    page-scoped behaviour -- deterministically draws one of the two collapsed
    sentences, so the old code fails the whole language and unlinks p1's 20 good
    tracks too. Sampling the WHOLE 22-entry pool (p1's 20 + p2's 2) deterministically
    draws a p1 entry instead (index 12 of 22, which is < 20), so the fixed code sees
    a clean sample and correctly keeps shipping -- p1's tracks must not become
    casualties of a page they have nothing to do with.
    """
    p1 = many_sentence_page(tmp_path, "p1", 20)
    qa = tmp_path / "qa.json"

    run(book=tmp_path / "social_psychology", codes=["es"],
        translator_factory=identity_factory, qa_path=qa)
    assert json.loads(qa.read_text())["es"]["ships"] is True
    assert track_path(p1, "es").exists()

    page(tmp_path, name="p2")

    def collapse_factory(lang, reverse=False):
        # Only p2's forward pass collapses; the reverse pass stays identity so
        # this test isolates "does the sample land on a good page" (R28) from
        # "is the reverse translator itself broken" (a different failure mode).
        if reverse:
            return lambda lines: list(lines)
        return lambda lines: ["zzz" for _ in lines]

    run(book=tmp_path / "social_psychology", codes=["es"],
        translator_factory=collapse_factory, qa_path=qa)

    report = json.loads(qa.read_text())
    assert report["es"]["ships"] is True, (
        "a 2-sentence page's collapse must not sink a language whose pool is "
        "actually 22 sentences -- the verdict's evidence must match its scope"
    )
    assert track_path(p1, "es").exists(), "p1's good tracks must survive p2's collapse"
    assert json.loads(p1.read_text())["languages"] == ["es"]


def test_r29_two_pages_new_page_fine_untouched_page_survives(tmp_path):
    """R29 (controller ruling): companion happy-path case for the pool-wide QA
    sample -- adding a second, well-translated page must not disturb a first
    page's already-shipped, untouched track."""
    p1 = page(tmp_path, name="p1")
    qa = tmp_path / "qa.json"

    run(book=tmp_path / "social_psychology", codes=["es"],
        translator_factory=identity_factory, qa_path=qa)

    p2 = page(tmp_path, name="p2")
    run(book=tmp_path / "social_psychology", codes=["es"],
        translator_factory=identity_factory, qa_path=qa)

    report = json.loads(qa.read_text())
    assert report["es"]["ships"] is True
    assert track_path(p1, "es").exists()
    assert track_path(p2, "es").exists()
    assert json.loads(p1.read_text())["languages"] == ["es"]
    assert json.loads(p2.read_text())["languages"] == ["es"]


def test_r30_a_degenerate_forward_translation_is_never_written_to_the_track(tmp_path):
    """R30 (controller ruling), sentence trigger 1: spec Sec9.1 requires a
    degenerate translation to be omitted from speech.<lang>.json so the reader
    falls back to English. This needs no reverse pass -- is_degenerate is applied
    to every forward-translated sentence before the track is written at all.

    Uses the same 1000-sentence pool and the same known-sampled position
    (sentence_text(41) / id b0s0041, always drawn by sample_ids at seed 0 -- see
    test_r30_a_below_floor_sampled_round_trip_is_pruned_from_its_track's
    docstring) as the pruning test below, rather than a 2-sentence page. C2
    made the language-level sample draw from the full SOURCE pool, not just
    the track, so a tiny fixture where the one degenerate sentence has a real
    chance of being the sample would make the language-level gate correctly
    reject the whole language (1 failure out of 1 sample = 100%) and unlink
    the very track this test wants to inspect -- diluting it to 1/50 (2%, at
    but not over MAX_FAILURE_RATE) isolates the sentence-level drop this test
    is actually about.
    """
    speech = many_sentence_page(tmp_path, "p", 1000)
    qa = tmp_path / "qa.json"

    def factory(lang, reverse=False):
        if reverse:
            return lambda lines: list(lines)
        return lambda lines: [
            "the the the the" if line == sentence_text(41) else line for line in lines
        ]

    run(book=tmp_path / "social_psychology", codes=["es"],
        translator_factory=factory, qa_path=qa)

    track = json.loads(track_path(speech, "es").read_text())
    assert "b0s0041" not in track["text"], (
        "the degenerate 'the the the the' translation for b0s0041 must never "
        "reach the track -- the reader falls back to English for that id"
    )
    assert track["text"]["b0s0000"] == sentence_text(0), "untouched sentences are unaffected"


def test_r30_a_below_floor_sampled_round_trip_is_pruned_from_its_track(tmp_path):
    """R30 (controller ruling), sentence trigger 2: the round-trip-below-floor
    trigger can only be checked on the sampled 5%, since nothing else was
    reverse-translated. Verified directly against pipeline.qa.sample_ids that a
    1000-sentence pool draws exactly 50 ids (5%) and that 'b0s0041' is always
    among them (deterministic given the pool's size, independent of content).
    One failure in a sample of 50 is a 2% failure rate, which does NOT exceed
    MAX_FAILURE_RATE (a strict '>' check in score_language), so the language
    still ships -- letting this test observe the pruned file directly rather
    than have the language-level unlink erase the evidence.
    """
    speech = many_sentence_page(tmp_path, "p", 1000)
    qa = tmp_path / "qa.json"

    def factory(lang, reverse=False):
        if reverse:
            return lambda lines: ["zzz" if line == sentence_text(41) else line for line in lines]
        return lambda lines: list(lines)

    run(book=tmp_path / "social_psychology", codes=["es"],
        translator_factory=factory, qa_path=qa)

    report = json.loads(qa.read_text())
    assert report["es"]["ships"] is True
    assert report["es"]["sampled"] == 50

    track = json.loads(track_path(speech, "es").read_text())
    assert "b0s0041" not in track["text"], "the below-floor sampled sentence must be pruned"
    assert track["text"]["b0s0000"] == sentence_text(0)  # untouched sentences are unaffected


def test_c2_collapse_is_visible_to_the_gate_even_though_the_survivors_are_perfect(tmp_path):
    """C2 (final-review Critical): the QA sample must be drawn from the book's
    SOURCE sentence ids, not from the track. Before the fix, the pool was built
    by reading the track and keeping only ids that also appear in the source --
    so a language whose forward pass collapsed 90% of its sentences to
    degenerate output (dropped before the track was ever written, R30 trigger
    1) was scored on a 5%-of-the-SURVIVORS sample of the remaining 10%, which
    round-trips PERFECTLY because those 10 survivors really were translated
    correctly. This reproduces the reviewer's repro almost exactly: 100 source
    sentences, only 10 make it into the track (10% coverage) -- before the fix
    that scored ships=True, median=1.0, failure_rate=0.0, sampled=1; a reader
    selecting this language would hear 90% English and the audit file would
    call it perfect.

    With the fix, the sample is drawn from all 100 source ids, so most of a
    5-sample draw lands on ids the forward pass dropped -- which score as
    failures (effective score 0.0, via is_degenerate("")) with no round trip
    needed -- and the language does not ship. Every SURVIVING sentence still
    round-trips perfectly (isolates "is collapse visible to the sampler at
    all" from "does the gate correctly score a bad round trip", which is
    already covered elsewhere).
    """
    many_sentence_page(tmp_path, "p", 100)
    qa = tmp_path / "qa.json"

    # Digit-free for the same reason sentence_text is (Task 16): this stands in
    # for the FORWARD output, which now passes through the Spanish normaliser
    # before it is written -- "Translated 5." would reach the track as
    # "Translated cinco." and the reverse lookup below would miss it.
    translated_of = {i: sentence_text(i).replace("Sentence", "Translated")
                     for i in range(10)}
    original_of = {v: sentence_text(i) for i, v in translated_of.items()}

    def factory(lang, reverse=False):
        if reverse:
            return lambda lines: [original_of[line] for line in lines]
        # Ignores the actual (masked) input text and returns a real,
        # perfectly-round-trippable translation for the first 10 sentences,
        # and the same degenerate phrase for the other 90 -- modelling a
        # checkpoint that collapses on 90% of a book (e.g. opus-mt-en-mul, the
        # weakest checkpoint in the table, per pipeline/languages.py).
        return lambda lines: [
            translated_of[i] if i < 10 else "the the the the"
            for i in range(len(lines))
        ]

    run(book=tmp_path / "social_psychology", codes=["es"],
        translator_factory=factory, qa_path=qa)

    report = json.loads(qa.read_text())
    assert report["es"]["covered"] == 10, "only the 10 survivors ever reached the track"
    assert report["es"]["total"] == 100, "coverage is measured against the SOURCE pool"
    assert report["es"]["sampled"] == 5, "5% of the 100 source ids, not of the 10 survivors"
    assert report["es"]["ships"] is False, (
        "a language that collapsed 90% of its sentences must not ship just "
        "because the 10% that survived happen to be perfect"
    )
    assert report["es"]["median"] == 0.0
    assert report["es"]["failure_rate"] > MAX_FAILURE_RATE


def test_r31_a_failing_page_is_skipped_and_recorded_while_other_pages_continue(tmp_path):
    """R31 (controller ruling): translate_page is unguarded in the brief's run(),
    so SentenceCountError -- documented as an expected hard error, not a
    hypothetical -- on one page aborts the whole run. A failing page must instead
    be skipped, recorded, and its language's other pages must still be processed.
    """
    p1 = page(tmp_path, name="p1")  # sorts before p2; translated first
    p2 = page(tmp_path, name="p2")
    qa = tmp_path / "qa.json"

    def flaky_factory(lang, reverse=False):
        if reverse:
            return lambda lines: list(lines)
        calls = {"n": 0}

        def translate(lines):
            calls["n"] += 1
            if calls["n"] == 1:
                return list(lines)[:-1]  # wrong count -> SentenceCountError on p1
            return list(lines)
        return translate

    report = run(book=tmp_path / "social_psychology", codes=["es"],
                 translator_factory=flaky_factory, qa_path=qa)

    page_skips = [s for s in report["skipped"] if s["stage"] == "translate"]
    assert len(page_skips) == 1
    assert page_skips[0]["language"] == "es"
    assert str(p1) in page_skips[0]["page"]

    assert not track_path(p1, "es").exists(), "the page that raised must not be written"
    assert track_path(p2, "es").exists(), "the other page must still be translated"


def test_r31_a_failing_language_is_skipped_and_recorded_while_others_continue(tmp_path):
    """R31 (controller ruling): the reverse-translator call is unguarded in the
    brief's run(), and announce()/the QA-report write happen only once after the
    entire language loop -- so one language's crash currently aborts every
    language after it, including ones that already passed cleanly. A failing
    language must instead be skipped and recorded, with every other language and
    the final announce()/report write still completing.

    C1 (final-review Critical): being recorded in report["skipped"] is not
    enough. Before the fix, every track sl's forward pass had already written
    stayed on disk (announce() derives manifest.languages purely from files on
    disk, not from the QA verdict), and no report["sl"] entry existed at all --
    a language that crashed during QA shipped having passed no gate, and its
    failure was invisible to anything reading translation-qa.json. This test
    now asserts on those two artifacts directly, not just on the skip log.
    """
    speech = page(tmp_path)
    qa = tmp_path / "qa.json"

    def factory(lang, reverse=False):
        if reverse and lang.code == "sl":
            raise RuntimeError("simulated reverse checkpoint failure")
        return lambda lines: list(lines)

    report = run(book=tmp_path / "social_psychology", codes=["sl", "es"],
                 translator_factory=factory, qa_path=qa)

    lang_skips = [s for s in report["skipped"] if s["stage"] == "language"]
    assert len(lang_skips) == 1
    assert lang_skips[0]["language"] == "sl"
    assert "simulated reverse checkpoint failure" in lang_skips[0]["error"]

    # C1: the track sl's forward pass wrote this run must not survive the
    # crashed QA gate, and sl must not reach the reader's menu.
    assert not track_path(speech, "sl").exists(), "a crashed language's tracks must not ship"
    assert json.loads(speech.read_text())["languages"] == ["es"]

    # C1: the crash must be visible in translation-qa.json itself, not only in
    # report["skipped"] -- that is the file decisions are actually read from.
    assert "sl" in report
    assert report["sl"]["ships"] is False
    assert "simulated reverse checkpoint failure" in report["sl"]["reason"]

    # es was not affected by sl's crash.
    assert report["es"]["ships"] is True


def test_r32_a_reverse_translator_line_count_mismatch_is_a_language_failure(tmp_path):
    """R32 (controller ruling): the reverse round trip is called raw, bypassing
    translate_sentences -- the only place SentenceCountError is normally checked
    -- so a mismatched line count would otherwise let zip() silently truncate and
    misalign every (source, round_trip) pair fed to the gate. A mismatch here must
    raise the same SentenceCountError and be handled as a language failure (R31),
    not corrupt the gate's input with no error at all.

    C1 (final-review Critical): also asserts on the artifacts the crash-path
    damage actually lands in -- the track written this run must not survive,
    and the language must not reach manifest.languages -- not only on the
    report["skipped"] log entry.
    """
    speech = page(tmp_path)
    qa = tmp_path / "qa.json"

    def bad_count_factory(lang, reverse=False):
        if reverse:
            return lambda lines: list(lines)[:-1]  # always one line short
        return lambda lines: list(lines)

    report = run(book=tmp_path / "social_psychology", codes=["es"],
                 translator_factory=bad_count_factory, qa_path=qa)

    assert "es" not in report or report.get("es", {}).get("reason") != "passed"
    lang_skips = [s for s in report["skipped"] if s["language"] == "es"]
    assert len(lang_skips) == 1
    assert "SentenceCountError" in lang_skips[0]["error"] or "lines" in lang_skips[0]["error"]

    # C1: the track this run's forward pass wrote must not survive the crashed
    # QA gate, and es must not reach the reader's menu.
    assert not track_path(speech, "es").exists(), "a crashed language's tracks must not ship"
    assert json.loads(speech.read_text())["languages"] == []

    # C1: the crash must be visible in translation-qa.json itself.
    assert "es" in report
    assert report["es"]["ships"] is False


def test_r33_forward_translator_is_not_built_when_nothing_needs_translation(tmp_path):
    """R33 (controller ruling): the forward translator was constructed
    unconditionally per language before any needs_translation check -- harmless
    against a test double, but Task 14 wires real CTranslate2 checkpoints, where
    that means loading a full model to translate nothing. Construction must be
    deferred until a page actually needs it."""
    page(tmp_path)
    qa = tmp_path / "qa.json"
    factory_calls = []

    def counting_factory(lang, reverse=False):
        factory_calls.append(reverse)
        return lambda lines: list(lines)

    # First run: the page needs translation, so the forward translator must be
    # constructed (and, since there's a QA sample, the reverse one too).
    run(book=tmp_path / "social_psychology", codes=["es"],
        translator_factory=counting_factory, qa_path=qa)
    assert factory_calls.count(False) == 1

    # Second run over the same, unchanged page: nothing needs translation, so
    # the forward translator must not be built at all this time.
    factory_calls.clear()
    run(book=tmp_path / "social_psychology", codes=["es"],
        translator_factory=counting_factory, qa_path=qa)
    assert factory_calls.count(False) == 0, "forward translator built with nothing to translate"
    assert factory_calls.count(True) == 0, "reverse translator built with nothing to score"


def test_r34_prune_and_the_language_gate_agree_on_what_counts_as_a_failure(tmp_path):
    """R34 (controller ruling): score_language does not compare the raw
    sentence_score to the floor -- it first forces the effective score to 0.0
    when is_degenerate(round_trip) or _is_truncated(source, round_trip, ...),
    and only then compares to SENTENCE_FLOOR. The prune step must use the SAME
    rule (pipeline.qa.is_sentence_failure), or a sentence can count against a
    language's failure rate while still shipping inside its track -- exactly
    the truncated/looping audio TRUNCATION_RATIO exists to keep out.

    Reproduces one of qa.py's own documented collapse shapes (verified
    directly beforehand: sentence_score == 0.375, is_degenerate == False,
    truncated == True -- so the RAW score sits above SENTENCE_FLOOR (0.35) and
    a floor-only prune check would wrongly keep it):

        "the quick brown fox jumps over the lazy dog in the park today"
        -> "the quick brown"

    Part 1 confirms score_language, called directly, treats this pair as a
    failure in isolation (ships is False for a single-pair sample). Part 2
    confirms the SAME pair, sampled inside a real run(), gets pruned from its
    track -- using a 1000-sentence pool (as in the R30 pruning test) so this
    one failure is diluted to a 2% rate, which does not exceed
    MAX_FAILURE_RATE, letting the language still ship and the pruned file
    survive to be inspected."""
    source = "the quick brown fox jumps over the lazy dog in the park today"
    truncated_round_trip = "the quick brown"

    # Part 1: the language gate, called directly, must count this as a failure
    # despite its raw sentence_score (0.375) sitting above SENTENCE_FLOOR.
    from pipeline.qa import sentence_score, SENTENCE_FLOOR
    assert sentence_score(source, truncated_round_trip) > SENTENCE_FLOOR
    assert score_language("es", [(source, truncated_round_trip)]).ships is False

    # Part 2: the same pair, sampled for real, must be pruned from its track.
    speech = many_sentence_page(tmp_path, "p", 1000)
    manifest = json.loads(speech.read_text())
    manifest["blocks"][0]["sentences"][41]["speech"] = source
    manifest["blocks"][0]["sentences"][41]["display"] = source
    speech.write_text(json.dumps(manifest), encoding="utf-8")
    qa = tmp_path / "qa.json"

    def factory(lang, reverse=False):
        if reverse:
            return lambda lines: [
                truncated_round_trip if line == source else line for line in lines
            ]
        return lambda lines: list(lines)

    run(book=tmp_path / "social_psychology", codes=["es"],
        translator_factory=factory, qa_path=qa)

    report = json.loads(qa.read_text())
    assert report["es"]["ships"] is True
    assert report["es"]["sampled"] == 50

    track = json.loads(track_path(speech, "es").read_text())
    assert "b0s0041" not in track["text"], (
        "a sentence score_language counts as a failure must also be pruned "
        "from its track, or it counts against the language while still "
        "shipping inside it"
    )


def test_i7_a_partial_run_merges_onto_the_existing_qa_report_rather_than_overwriting_it(tmp_path):
    """I7 (final-review): translate_cli.py wrote translation-qa.json wholesale,
    containing only the codes touched by THIS invocation -- so `LANGS=es npm
    run stage` erased the recorded verdicts for the other 28 languages.
    scripts/convert-models.py already merges its attribution file for exactly
    this reason (see its own comment). run() must merge onto whatever is
    already on disk the same way: a second, disjoint-language run must not
    erase what an earlier run recorded."""
    page(tmp_path)
    qa = tmp_path / "qa.json"

    run(book=tmp_path / "social_psychology", codes=["es"],
        translator_factory=identity_factory, qa_path=qa)
    first = json.loads(qa.read_text())
    assert "es" in first and first["es"]["ships"] is True

    # A second, later invocation that never mentions es -- e.g. a real
    # `LANGS=fr npm run stage` -- must not erase es's verdict.
    report = run(book=tmp_path / "social_psychology", codes=["fr"],
                 translator_factory=identity_factory, qa_path=qa)

    assert "es" in report, "a partial run must not erase another language's verdict"
    assert report["es"] == first["es"]
    assert report["fr"]["ships"] is True

    on_disk = json.loads(qa.read_text())
    assert "es" in on_disk and "fr" in on_disk


def test_i8_an_unchanged_language_carries_forward_its_prior_median_and_failure_rate(tmp_path):
    """I8 (final-review): translate_cli.py reported an unchanged language
    (nothing needed translation this run) as median 0.0 / failure_rate 0.0 /
    ships true. The reason string ("unchanged; not re-scored") carried the
    truth, but the numbers read as real data -- and a fake 0.0/0.0 in
    particular looks exactly like a perfect score the language never earned
    this run. The prior run's REAL numbers must carry forward instead (I7's
    merge logic already has the prior report loaded to draw them from)."""
    page(tmp_path)
    qa = tmp_path / "qa.json"

    for _ in range(2):
        run(book=tmp_path / "social_psychology", codes=["es"],
            translator_factory=identity_factory, qa_path=qa)

    report = json.loads(qa.read_text())
    assert report["es"]["reason"] == "unchanged; not re-scored"
    assert report["es"]["median"] == 1.0, "the prior run's real median must carry forward, not 0.0"
    assert report["es"]["sampled"] >= 1, "the prior run's real sample count must carry forward, not 0"


def test_c1_crash_handler_survives_a_page_whose_track_is_unreadable(tmp_path):
    """C1 follow-up (re-review): reproduces the reviewer's primary repro --
    pipeline/tracks.py's own documented scenario, "a truncated or otherwise
    corrupt track -- most likely an interrupted translation run", combined
    with that SAME page ALSO failing its retranslation attempt this run (so
    write_track never overwrites the corrupt file). needs_translation fails
    safe and retries the page; the retry fails too (page-level skip, R31);
    the corrupt track file is left on disk untouched. The main QA-gate
    section's _track_texts() then raises reading it -- expected, and caught
    by the per-language except -- but pre-fix, the CRASH HANDLER's own
    _source_pool/_track_texts calls (added to record covered/total, C2) raised
    on the SAME file a second time, uncaught, escaping run() entirely and
    aborting every language after it, including one (fr) that never had any
    problem at all. This is a real operating condition, not a contrived one --
    it is the exact scenario pipeline/tracks.py's needs_translation exists to
    resume."""
    p1 = page(tmp_path, name="p1")  # sorts first; carries the corrupt track
    page(tmp_path, name="p2")       # sorts second; perfectly healthy
    track_path(p1, "es").write_text(
        "{not valid json, left by an interrupted prior run", encoding="utf-8"
    )
    qa = tmp_path / "qa.json"

    def flaky_factory(lang, reverse=False):
        if reverse:
            return lambda lines: list(lines)
        calls = {"n": 0}

        def translate(lines):
            calls["n"] += 1
            if calls["n"] == 1:
                return list(lines)[:-1]  # p1's retranslation attempt also fails
            return list(lines)
        return translate

    report = run(book=tmp_path / "social_psychology", codes=["es", "fr"],
                 translator_factory=flaky_factory, qa_path=qa)

    assert qa.exists(), "translation-qa.json must still be written"
    assert "es" in report, "the crashing language must still get a report entry"
    assert report["es"]["ships"] is False
    assert "fr" in report, "a language processed after the crashing one must still run"


def test_i7_merge_preserves_other_languages_skip_records_too(tmp_path):
    """I7 follow-up (re-review): report["skipped"] is a list, not a
    per-language dict key, so {**existing_report, **report} always overwrote
    it wholesale -- a LANGS=es re-run after a full run erased every OTHER
    language's page-failure records even though it correctly kept their
    verdicts (the exact defect I7 fixed, left in place for this sibling key).
    The "skipped" list must be merged the same way: preserve entries for
    languages NOT touched this run, replace entries for languages this run
    DID touch."""
    page(tmp_path, name="p1")
    page(tmp_path, name="p2")
    qa = tmp_path / "qa.json"

    def flaky_for_fr(lang, reverse=False):
        if reverse:
            return lambda lines: list(lines)
        calls = {"n": 0}

        def translate(lines):
            calls["n"] += 1
            if lang.code == "fr" and calls["n"] == 1:
                return list(lines)[:-1]  # SentenceCountError on fr's first page only
            return list(lines)
        return translate

    run(book=tmp_path / "social_psychology", codes=["es", "fr"],
        translator_factory=flaky_for_fr, qa_path=qa)
    first = json.loads(qa.read_text())
    fr_page_skips = [s for s in first["skipped"] if s["language"] == "fr"]
    assert len(fr_page_skips) == 1, "fr's page-level failure must be recorded"

    # A later, disjoint-language run (e.g. a real LANGS=es re-run) must not
    # erase fr's skip record even though it never touches fr.
    report = run(book=tmp_path / "social_psychology", codes=["es"],
                 translator_factory=identity_factory, qa_path=qa)

    fr_page_skips_after = [s for s in report["skipped"] if s["language"] == "fr"]
    assert fr_page_skips_after == fr_page_skips, "fr's skip record must survive an es-only run"


# --- Task 16: the source-field switch, end to end through run() ---------------


def differing_fields_page(tmp_path, sentences, name="p"):
    """A page whose `display` and `speech` are deliberately DIFFERENT text, so a
    test can tell which field run() actually read. Every other fixture in this
    file sets them identical, which passes either way."""
    directory = tmp_path / "social_psychology" / name
    directory.mkdir(parents=True)
    speech = directory / "speech.json"
    speech.write_text(json.dumps({
        "version": 1, "pageId": f"social_psychology/{name}", "title": "T",
        "lang": "en", "generatedFrom": "hash1", "languages": [],
        "blocks": [{"id": "b0", "kind": "prose", "text": "x", "anchor": {"path": [0]},
                    "sentences": sentences}],
    }), encoding="utf-8")
    return speech


def test_the_run_translates_display_and_scores_the_round_trip_against_it(tmp_path):
    """Task 16: `_source_sentences` feeds BOTH the forward pass and the QA pool.
    Switching one and not the other would score every sentence against text it
    was never translated from -- and the gate would still have printed a
    plausible number, which is the failure mode that matters here."""
    speech = differing_fields_page(tmp_path, [
        {"id": "b0s0", "display": "The cat sat quietly on the warm mat.",
         "speech": "The feline reclined upon the heated rug.", "offset": 0, "length": 36},
        {"id": "b0s1", "display": "The dog ran quickly across the wide field.",
         "speech": "The canine sprinted across the broad meadow.", "offset": 37, "length": 41},
    ])
    qa = tmp_path / "qa.json"

    run(book=tmp_path / "social_psychology", codes=["es"],
        translator_factory=identity_factory, qa_path=qa)

    track = json.loads(track_path(speech, "es").read_text())["text"]
    assert track["b0s0"] == "The cat sat quietly on the warm mat."
    assert track["b0s1"] == "The dog ran quickly across the wide field."

    report = json.loads(qa.read_text())
    assert report["es"]["ships"] is True
    assert report["es"]["median"] == 1.0, (
        "an identity translator round-trips display to itself perfectly; a "
        "median below 1.0 here means the gate scored against `speech` while "
        "the forward pass sent `display`"
    )


def test_the_spanish_normaliser_reaches_the_track_through_run(tmp_path):
    """The whole point of Task 16, asserted at the outermost seam: a year that
    entered as digits leaves as Spanish words in the file the reader loads.

    The sentences are long enough that spelling the year out still round-trips
    above LANGUAGE_FLOOR under an identity translator -- otherwise the gate
    would unlink the very track this test wants to read."""
    speech = differing_fields_page(tmp_path, [
        {"id": "b0s0",
         "display": "En 1961 Sherif y sus colegas crearon el experimento de la cueva.",
         "speech": "En 1961 Sherif y sus colegas crearon el experimento de la cueva.",
         "offset": 0, "length": 63},
        {"id": "b0s1",
         "display": "El 68% de los participantes del estudio cumplió con la solicitud.",
         "speech": "El 68% de los participantes del estudio cumplió con la solicitud.",
         "offset": 64, "length": 64},
    ])
    qa = tmp_path / "qa.json"

    run(book=tmp_path / "social_psychology", codes=["es"],
        translator_factory=identity_factory, qa_path=qa)

    track = json.loads(track_path(speech, "es").read_text())["text"]
    assert track["b0s0"] == (
        "En mil novecientos sesenta y uno Sherif y sus colegas crearon el "
        "experimento de la cueva.")
    assert track["b0s1"] == (
        "El sesenta y ocho por ciento de los participantes del estudio cumplió "
        "con la solicitud.")


def test_the_reference_census_is_recorded_even_when_it_is_zero(tmp_path):
    """The generalisation guard. REFERENCE_HEADING_RE is the one book-specific
    assumption in the pipeline, and a book it does not recognise excludes
    nothing -- which is SAFE but silent, and a silent zero looks exactly like
    "checked, there were none". Recording it turns that into a fact in
    translation-qa.json that somebody can notice."""
    speech = differing_fields_page(tmp_path, [
        {"id": "b0s0", "display": "The cat sat quietly on the warm mat.",
         "speech": "The cat sat quietly on the warm mat.", "offset": 0, "length": 36},
    ])
    qa = tmp_path / "qa.json"
    run(book=tmp_path / "social_psychology", codes=["es"],
        translator_factory=identity_factory, qa_path=qa)

    census = json.loads(qa.read_text())["references"]
    assert census == {"pages": 1, "pages_with_a_reference_section": 0,
                      "sentences_excluded": 0}
    assert speech.exists()


def test_a_reference_section_is_held_back_from_the_track_and_the_qa_pool(tmp_path):
    """Both halves matter. Excluding entries from the TRACK alone would be worse
    than doing nothing: pipeline.qa samples the SOURCE pool by design (C2), and
    a sampled id missing from the track scores 0.0 -- so every held-back citation
    would count as a QA failure and sink the language it was meant to save."""
    directory = tmp_path / "social_psychology" / "p"
    directory.mkdir(parents=True)
    speech = directory / "speech.json"
    speech.write_text(json.dumps({
        "version": 1, "pageId": "social_psychology/p", "title": "T", "lang": "en",
        "generatedFrom": "hash1", "languages": [],
        "blocks": [
            {"id": "b0", "kind": "paragraph", "text": "x", "anchor": {"path": [0]},
             "sentences": [{"id": "b0s0", "display": "Groups compete for scarce resources.",
                            "speech": "Groups compete for scarce resources.",
                            "offset": 0, "length": 36}]},
            {"id": "b1", "kind": "heading", "text": "References", "anchor": {"path": [1]},
             "sentences": [{"id": "b1s0", "display": "References", "speech": "References",
                            "offset": 0, "length": 10}]},
            {"id": "b2", "kind": "paragraph", "text": "y", "anchor": {"path": [2]},
             "sentences": [{"id": "b2s0", "display": "Sidanius, J., & Pratto, F. (1999).",
                            "speech": "Sidanius, J., & Pratto, F. (1999).",
                            "offset": 0, "length": 34}]},
        ],
    }), encoding="utf-8")
    qa = tmp_path / "qa.json"

    run(book=tmp_path / "social_psychology", codes=["es"],
        translator_factory=identity_factory, qa_path=qa)

    track = json.loads(track_path(speech, "es").read_text())["text"]
    assert "b2s0" not in track, "the citation must not be translated"
    assert "b1s0" in track, "the References heading itself is still translated"
    assert "b0s0" in track

    report = json.loads(qa.read_text())
    assert report["references"]["sentences_excluded"] == 1
    assert report["es"]["total"] == 2, (
        "the held-back citation must be out of the QA POOL too -- left in, it "
        "would be sampled, found missing from the track, and scored 0.0"
    )
    assert report["es"]["ships"] is True
