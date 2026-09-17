"""python -m pipeline.translate_cli <book> --langs all

Separate from pipeline.tts_manifest on purpose. Building manifests takes seconds;
translating 29 languages takes hours. Coupling them would mean nobody could re-run
the pipeline without re-translating, so the two are invoked independently and this
one is resumable: a page whose generatedFrom hash is unchanged and whose track
already exists is skipped.
"""

import argparse
import json
from dataclasses import asdict
from pathlib import Path

from pipeline.languages import TARGETS
from pipeline.qa import (
    LANGUAGE_FLOOR, MAX_FAILURE_RATE, SENTENCE_FLOOR, TRUNCATION_RATIO,
    LanguageScore, is_degenerate, is_sentence_failure, sample_ids, score_language,
)
from pipeline.tracks import announce, needs_translation, track_path, write_track
from pipeline.translate import (
    SentenceCountError, reference_sentence_ids, source_sentences, translate_page,
)


def _default_factory(lang, reverse=False):
    from pipeline.opus import make_translator
    return make_translator(lang, reverse=reverse)


def _source_sentences(speech_json: Path) -> dict[str, str]:
    """Task 16: delegates to pipeline.translate.source_sentences rather than
    repeating its field choice, so the QA pool below is drawn from exactly the
    text the forward pass was handed (`display`, not `speech`). When these were
    two copies of the same dict comprehension, switching one and not the other
    would have scored every sentence against text it was never translated
    from -- and the gate would still have reported a number."""
    manifest = json.loads(Path(speech_json).read_text(encoding="utf-8"))
    return source_sentences(manifest)


def _reference_census(pages: list[Path]) -> dict:
    """How much of this book was held back as bibliography, recorded in
    translation-qa.json.

    The reference-heading match (pipeline/translate.REFERENCE_HEADING_RE) is the
    one book-specific assumption in this pipeline: `social_psychology` says
    "References", and another book may say something else or have no such
    heading. That case is safe -- nothing is excluded, the page translates as it
    always did -- but it is SILENT, and a silent zero is indistinguishable from
    "checked and there were none". Writing the count down makes it a fact
    somebody can look at instead of an assumption nobody tested.
    """
    excluded = pages_with = 0
    for speech in pages:
        try:
            manifest = json.loads(Path(speech).read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        ids = reference_sentence_ids(manifest)
        if ids:
            pages_with += 1
        excluded += len(ids)
    return {"pages": len(pages), "pages_with_a_reference_section": pages_with,
            "sentences_excluded": excluded}


def _prune_sentences(speech_json: Path, code: str, sentence_ids: list[str]) -> None:
    """Rewrite one page's track with the given ids removed. Called only for
    sampled ids whose round trip scored below SENTENCE_FLOOR (R30, sentence
    trigger 2) -- the reader falls back to English for a missing id, same as any
    other sparse gap tracks.py already documents."""
    track = json.loads(track_path(speech_json, code).read_text(encoding="utf-8"))
    text = track.get("text", {})
    for sentence_id in sentence_ids:
        text.pop(sentence_id, None)
    write_track(speech_json, code, text)


def _track_texts(pages: list[Path], code: str) -> dict[Path, dict[str, str]]:
    """Every page's on-disk track text for `code`, keyed by page path. A page
    with no track file yet (or none at all) maps to `{}` rather than being
    absent, so a lookup never has to special-case "no track" from "no id"."""
    texts: dict[Path, dict[str, str]] = {}
    for speech in pages:
        tpath = track_path(speech, code)
        texts[speech] = (
            json.loads(tpath.read_text(encoding="utf-8")).get("text", {})
            if tpath.exists() else {}
        )
    return texts


def _source_pool(pages: list[Path]) -> dict[str, tuple[Path, str, str]]:
    """C2: every sentence id in the book's speech.json files, keyed the same
    way the old track-derived pool was (`f"{speech}::{sentence_id}"`) -- but
    drawn from the SOURCE, not from whatever a language's track happened to
    survive with. An id a language's forward pass dropped as degenerate, or
    that a failed page never wrote at all, must still be a candidate the
    sampler can draw, or the gate only ever looks at a language's own
    survivors and collapse becomes invisible to it."""
    pool: dict[str, tuple[Path, str, str]] = {}
    for speech in pages:
        for sentence_id, text in _source_sentences(speech).items():
            pool[f"{speech}::{sentence_id}"] = (speech, sentence_id, text)
    return pool


def _coverage(pool: dict[str, tuple[Path, str, str]],
              track_texts: dict[Path, dict[str, str]]) -> tuple[int, int]:
    """C2: how many of the book's source sentences this language's track
    actually contains, against how many exist -- recorded in
    translation-qa.json so a language that only ever translated a fraction of
    its sentences shows that fraction rather than reporting silently on the
    survivors as if they were the whole book."""
    total = len(pool)
    covered = sum(
        1 for speech, sentence_id, _ in pool.values()
        if sentence_id in track_texts.get(speech, {})
    )
    return covered, total


def run(book: Path, codes: list[str], translator_factory=_default_factory,
        qa_path: Path = Path(".stage/_assets/tts/translation-qa.json")) -> dict:
    book = Path(book)
    pages = sorted(book.rglob("speech.json"))
    qa_path = Path(qa_path)

    # I7: a run over a subset of languages (LANGS=es npm run stage) must not
    # erase the verdicts already recorded for the other 28 -- merge onto
    # whatever is on disk rather than overwriting it, mirroring
    # scripts/convert-models.py's attribution-file merge for the same reason.
    # A corrupt or half-written qa.json fails safe toward "nothing recorded
    # yet" rather than crashing the run.
    existing_report: dict = {}
    if qa_path.exists():
        try:
            existing_report = json.loads(qa_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            existing_report = {}

    report: dict[str, dict] = {}
    skipped: list[dict] = []

    for code in codes:
        lang = TARGETS[code]
        written: list[Path] = []
        forward = None  # R33: built lazily -- only once a page actually needs it

        try:
            for speech in pages:
                if not needs_translation(speech, code):
                    continue
                if forward is None:
                    forward = translator_factory(lang)
                try:
                    texts = translate_page(speech, code, forward)
                    # R30, sentence trigger 1: a degenerate forward translation
                    # needs no reverse pass to disqualify -- drop it before the
                    # track is ever written, so the reader falls back to English
                    # for that id instead of hearing garbage.
                    texts = {sid: t for sid, t in texts.items() if not is_degenerate(t)}
                    if not texts:
                        continue
                    written.append(write_track(speech, code, texts))
                except Exception as exc:
                    # R31: translate_page/write_track failing for ONE page (a
                    # SentenceCountError is the documented, expected case, not a
                    # hypothetical) must not cost every other page of this
                    # language its translation -- skip just this page.
                    skipped.append({"language": code, "page": str(speech),
                                     "stage": "translate", "error": str(exc)})
                    print(f"  {code}: SKIPPED page {speech} — {exc}")
                    continue

            if not written:
                # R8: nothing changed for this language this run -- every page
                # was skipped by needs_translation above. Leave its tracks
                # exactly as they are and do not call the language gate at all:
                # an empty sample reads as total collapse and would otherwise
                # unlink a language a prior run had already shipped, turning a
                # no-op re-run into data loss (spec Sec8.1: "re-runs are
                # incremental and interruptions are cheap").
                tracks_exist = any(track_path(speech, code).exists() for speech in pages)
                pool = _source_pool(pages)
                covered, total = _coverage(pool, _track_texts(pages, code))
                if tracks_exist:
                    # I8: an unchanged language is not re-scored this run, so
                    # reporting median 0.0 / failure_rate 0.0 here would read as
                    # a perfect score it never earned -- the reason string
                    # carries the truth but the numbers would look like data.
                    # Carry the prior run's numbers forward instead (I7's merge
                    # logic already loaded them into existing_report); None
                    # when there is nothing to carry.
                    prior = existing_report.get(code)
                    prior = prior if isinstance(prior, dict) else {}
                    score = LanguageScore(
                        code, prior.get("median"), prior.get("failure_rate"),
                        prior.get("sampled", 0), True, "unchanged; not re-scored",
                        SENTENCE_FLOOR, MAX_FAILURE_RATE, LANGUAGE_FLOOR,
                        TRUNCATION_RATIO, covered, total,
                    )
                else:
                    score = LanguageScore(code, None, 1.0, 0, False, "no sample was scored",
                                          SENTENCE_FLOOR, MAX_FAILURE_RATE, LANGUAGE_FLOOR,
                                          TRUNCATION_RATIO, covered, total)
                report[code] = asdict(score)
                print(f"  {code}: unchanged — tracks already on disk, not re-scored"
                      if tracks_exist else f"  {code}: DROPPED — {score.reason}")
                continue

            # C2: the sample is drawn from every SOURCE sentence id in the book
            # (via _source_sentences/_source_pool), not from the track. The old
            # pool was built by reading the track and keeping only ids that also
            # appear in the source -- which means an id the forward pass above
            # dropped as degenerate, or a page that failed outright and never
            # wrote a track at all, could never be drawn: the gate only ever
            # saw its own survivors, and a 5% sample "of the survivors" shrinks
            # exactly as a language collapses. Sampling the source pool instead
            # makes every source sentence a candidate regardless of what
            # happened to it.
            track_texts = _track_texts(pages, code)
            pool = _source_pool(pages)
            sample_keys = sample_ids(list(pool))

            round_trip_by_key: dict[str, str] = {}
            need_round_trip: list[str] = []
            for key in sample_keys:
                speech, sentence_id, _ = pool[key]
                translated = track_texts.get(speech, {}).get(sentence_id)
                if translated is None:
                    # C2: sampled but absent from the track -- it was dropped
                    # precisely because it was degenerate (or its page failed
                    # outright). That is a FAILURE on its face; scoring it as
                    # an empty round trip gets effective score 0.0 via
                    # is_degenerate("") without spending a reverse-translation
                    # call on a sentence that was never translated at all.
                    round_trip_by_key[key] = ""
                else:
                    need_round_trip.append(key)

            if need_round_trip:
                reverse = translator_factory(lang, reverse=True)
                lines = [track_texts[pool[key][0]][pool[key][1]] for key in need_round_trip]
                round_trips = reverse(lines)
                if len(round_trips) != len(need_round_trip):
                    # R32: translate_sentences is the only place SentenceCountError
                    # is normally checked, and this reverse pass bypasses it
                    # entirely -- a mismatched count would otherwise let zip()
                    # silently truncate and misalign every (source, round_trip)
                    # pair fed to the gate below, corrupting its input with no
                    # error at all.
                    raise SentenceCountError(
                        f"reverse translator for {code!r} returned {len(round_trips)} "
                        f"lines for {len(need_round_trip)} sampled sentences"
                    )
                for key, round_trip in zip(need_round_trip, round_trips):
                    round_trip_by_key[key] = round_trip

            scored = [(pool[key][2], round_trip_by_key[key]) for key in sample_keys]

            # R30, sentence trigger 2: a sampled sentence whose round trip falls
            # below the sentence floor is pruned from its own page's track. Only
            # the sampled 5% can be judged this way -- nothing else was
            # reverse-translated to score. is_sentence_failure (pipeline.qa) is
            # the SAME rule score_language uses below to compute the failure
            # rate (R34) -- it forces degenerate/truncated round trips to a 0.0
            # effective score before comparing to the floor, not just the raw
            # token-F1 sentence_score, so a sentence can never simultaneously
            # count against the language's failure rate and still ship here. A
            # sampled id already missing from the track has nothing to prune --
            # it never made it into the track in the first place.
            prune_by_page: dict[Path, list[str]] = {}
            for key in need_round_trip:
                speech, sentence_id, source_text = pool[key]
                round_trip = round_trip_by_key[key]
                if is_sentence_failure(source_text, round_trip):
                    prune_by_page.setdefault(speech, []).append(sentence_id)
            for page_path, sentence_ids in prune_by_page.items():
                _prune_sentences(page_path, code, sentence_ids)

            # C2: coverage is recorded against the SOURCE pool, so a language
            # that only ever translated a fraction of its sentences shows that
            # fraction in translation-qa.json instead of reporting on its
            # survivors as though they were the whole book.
            final_track_texts = _track_texts(pages, code) if prune_by_page else track_texts
            covered, total = _coverage(pool, final_track_texts)

            score = score_language(code, scored, covered=covered, total=total)
            report[code] = asdict(score)

            if not score.ships:
                for speech in pages:
                    track_path(speech, code).unlink(missing_ok=True)
                print(f"  {code}: DROPPED — {score.reason}")
            else:
                print(f"  {code}: ships (median {score.median:.2f}, "
                      f"{len(written)} pages, {score.failure_rate:.1%} failures)")

        except Exception as exc:
            # C1: a language that CRASHES during QA (e.g. a broken reverse
            # checkpoint, or R32's line-count guard above) must not leave
            # sitting on disk whatever tracks the forward pass already wrote --
            # announce() derives manifest.languages purely from files on disk,
            # so an unlinked-nothing language would reach the reader's menu
            # having passed no gate at all. Unlink exactly the tracks THIS RUN
            # wrote, so the language reverts to whatever it looked like before
            # this run started (untouched pages keep their previously-vetted
            # tracks; a language with no prior tracks simply vanishes again),
            # and record a LanguageScore with ships=False so the failure is
            # visible in translation-qa.json -- the file decisions are actually
            # read from -- and not only inside report["skipped"].
            # Re-review follow-up: this handler's OWN diagnostics must not be
            # able to raise. _source_pool/_track_texts do a raw json.loads per
            # page, so an unrelated page's corrupt track (left by an
            # interrupted PRIOR run -- pipeline/tracks.py's own documented
            # "needs_translation must fail safe toward retranslating" scenario)
            # or malformed speech.json can make THIS handler throw the very
            # exception class it exists to catch, escaping run() entirely and
            # aborting every language after it -- inverting R31's whole point.
            # Degrade gracefully: unlink what can be unlinked, and record
            # covered=total=0 rather than trusting a computation that just
            # proved it cannot read every page.
            for p in written:
                try:
                    p.unlink(missing_ok=True)
                except OSError:
                    pass
            try:
                crash_pool = _source_pool(pages)
                covered, total = _coverage(crash_pool, _track_texts(pages, code))
            except Exception:
                covered, total = 0, 0
            score = LanguageScore(code, None, None, 0, False, f"crashed: {exc}",
                                  SENTENCE_FLOOR, MAX_FAILURE_RATE, LANGUAGE_FLOOR,
                                  TRUNCATION_RATIO, covered, total)
            report[code] = asdict(score)
            # R31: one language's failure must not abort announce()/the report
            # for every other language -- skip just this language.
            skipped.append({"language": code, "page": None, "stage": "language",
                             "error": str(exc)})
            print(f"  {code}: SKIPPED — {exc}")
            continue

    for speech in pages:
        announce(speech)

    # I7 follow-up (re-review): "skipped" is a list, not a per-language dict
    # key, so the {**existing_report, **report} merge below always overwrote
    # it wholesale -- a LANGS=es re-run erased every OTHER language's
    # page-failure records even though it correctly kept their verdicts. Merge
    # it the same way score entries are merged: keep every existing skip
    # record for a language NOT touched this run, and replace records for the
    # languages this run DID touch with what actually happened this run (a
    # stale prior skip for a now-successful code must not linger forever).
    report["references"] = _reference_census(pages)
    census = report["references"]
    print(f"  references: {census['sentences_excluded']} sentences held back as "
          f"bibliography, across {census['pages_with_a_reference_section']} of "
          f"{census['pages']} pages")

    existing_skipped = existing_report.get("skipped", [])
    if not isinstance(existing_skipped, list):
        existing_skipped = []
    touched = set(codes)
    preserved_skipped = [s for s in existing_skipped if s.get("language") not in touched]
    report["skipped"] = preserved_skipped + skipped
    # I7: merge onto whatever verdicts are already on disk, so a run over a
    # subset of languages does not erase the other languages' recorded
    # decisions -- same pattern, and the same reason, as
    # scripts/convert-models.py's attribution-file merge.
    merged_report = {**existing_report, **report}
    qa_path.parent.mkdir(parents=True, exist_ok=True)
    qa_path.write_text(json.dumps(merged_report, indent=1, sort_keys=True), encoding="utf-8")
    return merged_report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Translate a book's speech tracks.")
    parser.add_argument("book", type=Path)
    parser.add_argument("--langs", default="all",
                        help="comma-separated ISO 639-1 codes, or 'all'")
    parser.add_argument("--qa", type=Path,
                        default=Path(".stage/_assets/tts/translation-qa.json"))
    args = parser.parse_args(argv)

    codes = sorted(TARGETS) if args.langs == "all" else args.langs.split(",")
    unknown = [c for c in codes if c not in TARGETS]
    if unknown:
        parser.error(f"not shipped languages: {', '.join(unknown)}")

    run(args.book, codes, qa_path=args.qa)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
