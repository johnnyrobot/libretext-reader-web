"""Offline tests for scripts/fetch-phonon.py (LT-214).

The script stages Phonon 31M for the reader. These tests stand a tmp_path
directory in for the download cache; nothing is fetched.
"""

import hashlib
import importlib.util
import json
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]


def _load():
    spec = importlib.util.spec_from_file_location(
        "fetch_phonon_under_test", ROOT / "scripts" / "fetch-phonon.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


fetch_phonon = _load()


def _fake_cache(tmp_path, files):
    """A cache whose files have the pinned sizes and hashes, by re-pinning them."""
    cache = tmp_path / "cache"
    pins = {}
    for relative in files:
        data = f"bytes of {relative}".encode()
        (cache / relative).parent.mkdir(parents=True, exist_ok=True)
        (cache / relative).write_bytes(data)
        pins[relative] = (len(data), hashlib.sha256(data).hexdigest())
    return cache, pins


def test_pins_every_file_the_worker_reads():
    worker = (ROOT / "src" / "phonon.worker.mjs").read_text(encoding="utf-8")
    voices = re.search(r"VOICES = Object\.freeze\(\{([^}]*)\}", worker).group(1)
    for voice_id in re.findall(r"'([\w-]{16})'", voices):
        assert f"voices/{voice_id}.bin" in fetch_phonon.FILES
    # wasm fp32 is the one build: the graphs are the unsuffixed ones.
    for relative in ("config.json", "tokenizer.json", "tokenizer_config.json",
                     "onnx/flow_lm.onnx", "onnx/mimi_decoder.onnx"):
        assert relative in fetch_phonon.FILES
    assert not any("q4" in relative or "fp16" in relative for relative in fetch_phonon.FILES)


def test_every_pin_is_a_size_and_a_sha256():
    assert re.fullmatch(r"[0-9a-f]{40}", fetch_phonon.REVISION)
    for size, digest in fetch_phonon.FILES.values():
        assert size > 0
        assert re.fullmatch(r"[0-9a-f]{64}", digest)


def test_stage_writes_a_manifest_keyed_by_path(tmp_path):
    cache, pins = _fake_cache(tmp_path, ["config.json", "voices/abc.bin"])
    target = tmp_path / "tts" / "phonon"
    manifest = fetch_phonon.stage(cache, target, pins)

    written = json.loads((target / "manifest.json").read_text(encoding="utf-8"))
    assert written == manifest
    assert written["version"] == 1
    assert written["source"]["repo"] == fetch_phonon.REPO
    assert written["source"]["revision"] == fetch_phonon.REVISION
    assert written["source"]["licence"] == "apache-2.0"
    # The worker looks buffers up as `voices/<id>.bin`, so a file's name is its path.
    assert [(f["name"], f["path"]) for f in written["files"]] == [
        ("config.json", "config.json"), ("voices/abc.bin", "voices/abc.bin")]
    assert (target / "voices" / "abc.bin").read_bytes() == b"bytes of voices/abc.bin"
    for entry in written["files"]:
        assert (entry["bytes"], entry["sha256"]) == pins[entry["path"]]


def test_stage_refuses_a_file_that_does_not_match_its_pin(tmp_path):
    cache, pins = _fake_cache(tmp_path, ["config.json"])
    (cache / "config.json").write_bytes(b"something else entirely")
    target = tmp_path / "tts" / "phonon"
    with pytest.raises(SystemExit, match="config.json"):
        fetch_phonon.stage(cache, target, pins)
    # No manifest means the reader cannot be pointed at bytes nobody checked.
    assert not (target / "manifest.json").exists()


def test_a_cached_file_that_matches_is_not_fetched_again(tmp_path, monkeypatch):
    cache, pins = _fake_cache(tmp_path, ["config.json"])
    monkeypatch.setattr(fetch_phonon, "_download", lambda *a: pytest.fail("fetched"))
    fetch_phonon.fetch(cache, pins)


def test_a_corrupt_cached_file_is_fetched_again(tmp_path, monkeypatch):
    cache, pins = _fake_cache(tmp_path, ["config.json"])
    good = (cache / "config.json").read_bytes()
    (cache / "config.json").write_bytes(b"truncated")
    fetched = []

    def download(relative, dest):
        fetched.append(relative)
        dest.write_bytes(good)

    monkeypatch.setattr(fetch_phonon, "_download", download)
    fetch_phonon.fetch(cache, pins)
    assert fetched == ["config.json"]
    assert (cache / "config.json").read_bytes() == good


def test_a_failed_restage_leaves_no_old_manifest_over_mixed_files(tmp_path):
    cache, pins = _fake_cache(tmp_path, ["config.json", "voices/abc.bin"])
    target = tmp_path / "tts" / "phonon"
    fetch_phonon.stage(cache, target, pins)
    # The second staging copies config.json, then finds the voice corrupt. The
    # old manifest must not stay to vouch for a half-replaced directory.
    (cache / "voices" / "abc.bin").write_bytes(b"corrupt")
    with pytest.raises(SystemExit, match="abc.bin"):
        fetch_phonon.stage(cache, target, pins)
    assert not (target / "manifest.json").exists()
