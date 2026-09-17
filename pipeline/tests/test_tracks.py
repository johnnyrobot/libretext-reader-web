import json

from pipeline.tracks import announce, needs_translation, track_path, write_track


def manifest(tmp_path, generated_from="abc123"):
    speech = tmp_path / "speech.json"
    speech.write_text(json.dumps({
        "version": 1, "pageId": "b/p", "title": "T", "lang": "en",
        "generatedFrom": generated_from, "languages": [],
        "blocks": [{"id": "b0", "kind": "prose", "text": "x", "anchor": {"path": [0]},
                    "sentences": [{"id": "b0s0", "display": "One.", "speech": "One.",
                                   "offset": 0, "length": 4}]}],
    }), encoding="utf-8")
    return speech


def test_track_sits_beside_speech_json(tmp_path):
    speech = manifest(tmp_path)
    assert track_path(speech, "es") == tmp_path / "speech.es.json"


def test_written_track_is_a_flat_id_to_text_map(tmp_path):
    speech = manifest(tmp_path)
    write_track(speech, "es", {"b0s0": "Uno."})
    assert json.loads(track_path(speech, "es").read_text()) == {
        "sourceHash": "abc123", "text": {"b0s0": "Uno."},
    }


def test_announce_lists_only_tracks_actually_on_disk(tmp_path):
    speech = manifest(tmp_path)
    write_track(speech, "es", {"b0s0": "Uno."})
    write_track(speech, "fr", {"b0s0": "Un."})
    assert announce(speech) == ["es", "fr"]
    assert json.loads(speech.read_text())["languages"] == ["es", "fr"]


def test_announce_drops_a_language_whose_track_was_deleted(tmp_path):
    speech = manifest(tmp_path)
    write_track(speech, "es", {"b0s0": "Uno."})
    announce(speech)
    track_path(speech, "es").unlink()
    assert announce(speech) == []


def test_unchanged_page_with_an_existing_track_is_skipped(tmp_path):
    speech = manifest(tmp_path)
    assert needs_translation(speech, "es") is True
    write_track(speech, "es", {"b0s0": "Uno."})
    assert needs_translation(speech, "es") is False


def test_edited_page_is_retranslated(tmp_path):
    speech = manifest(tmp_path)
    write_track(speech, "es", {"b0s0": "Uno."})
    speech.write_text(json.dumps({**json.loads(speech.read_text()),
                                  "generatedFrom": "different"}), encoding="utf-8")
    assert needs_translation(speech, "es") is True


def test_announce_ignores_a_stray_file_that_is_not_a_known_language(tmp_path):
    speech = manifest(tmp_path)
    write_track(speech, "es", {"b0s0": "Uno."})
    (tmp_path / "speech.orig.json").write_text("not a translation track", encoding="utf-8")
    assert announce(speech) == ["es"]
    assert json.loads(speech.read_text())["languages"] == ["es"]


def test_needs_translation_treats_a_corrupt_track_as_needing_retranslation(tmp_path):
    speech = manifest(tmp_path)
    track_path(speech, "es").write_text("{not valid json", encoding="utf-8")
    assert needs_translation(speech, "es") is True


def test_a_split_version_bump_marks_existing_tracks_stale(tmp_path):
    """The end-to-end reason the version is folded into generatedFrom at all: a
    track written before a splitter change must be retranslated, not silently
    reused against sentences whose text has moved underneath its positional ids."""
    import pipeline.tts_manifest as tm
    html = "<main><p>One sentence here. And a second one follows.</p></main>"
    speech = tmp_path / "speech.json"
    speech.write_text(json.dumps(tm.build_manifest(html, "b/p", "T")), encoding="utf-8")
    write_track(speech, "es", {"b0s0": "Uno."})
    assert not needs_translation(speech, "es"), "a fresh track must start current"

    tm.SENTENCE_SPLIT_VERSION += 1
    try:
        speech.write_text(json.dumps(tm.build_manifest(html, "b/p", "T")), encoding="utf-8")
        assert needs_translation(speech, "es"), "a split-version bump must invalidate"
    finally:
        tm.SENTENCE_SPLIT_VERSION -= 1
