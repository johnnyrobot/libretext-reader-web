"""Offline tests for scripts/convert-mt-models.py, with a fake `huggingface_hub`
in sys.modules standing in for the Hub, as in test_convert_models.py."""

import dataclasses
import hashlib
import importlib.util
import json
import sys
import types
from pathlib import Path

import pytest

_SCRIPT_PATH = Path(__file__).resolve().parents[2] / "scripts" / "convert-mt-models.py"


def _load():
    spec = importlib.util.spec_from_file_location("convert_mt_models_under_test", _SCRIPT_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


convert_mt = _load()


class FakeHub:
    """A Hub whose repos hold every staged file except the ones listed as missing.

    Each file's bytes are its own repo-relative path, so `pinned_to_fake` can
    give a pair the hashes this Hub will actually serve.
    """

    def __init__(self, root):
        self.root = root
        self.missing = {}
        self.licences = {}
        self.head = "abc123"
        self.downloads = []

    def model_info(self, repo, revision=None):
        licence = self.licences.get(repo, "cc-by-4.0")
        return types.SimpleNamespace(tags=[f"license:{licence}"] if licence else [],
                                     sha=revision or self.head)

    def hf_hub_download(self, repo, relative, revision):
        self.downloads.append((repo, relative, revision))
        if relative in self.missing.get(repo, ()):
            raise FileNotFoundError(f"{repo} has no {relative}")
        path = self.root / "hub" / repo / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(relative.encode())
        return str(path)


@pytest.fixture
def fake_hub(tmp_path, monkeypatch):
    hub = FakeHub(tmp_path)
    module = types.ModuleType("huggingface_hub")
    module.model_info = hub.model_info
    module.hf_hub_download = hub.hf_hub_download
    monkeypatch.setitem(sys.modules, "huggingface_hub", module)
    return hub


def pinned_to_fake(pair):
    """`pair` with its pinned hashes swapped for the bytes FakeHub serves."""
    paths = dict(convert_mt.FILES)
    return dataclasses.replace(pair, sha256={
        key: hashlib.sha256(paths[key].encode()).hexdigest() for key in pair.sha256})


def test_portuguese_stages_without_a_vocab_json(fake_hub, tmp_path):
    # The en-pt export ships no vocab.json; transformers.js reads tokenizer.json.
    fake_hub.missing["Douglasrambo/opus-mt-tc-big-en-pt-onnx"] = {"vocab.json"}
    target = convert_mt.stage("en-pt", pinned_to_fake(convert_mt.PAIRS["en-pt"]), tmp_path / "mt")
    names = [f["name"] for f in json.loads((target / "manifest.json").read_text())["files"]]
    assert "vocab" not in names
    assert {"encoder", "decoder", "tokenizer", "config"} <= set(names)


def test_a_missing_file_still_stops_every_other_pair(fake_hub, tmp_path):
    fake_hub.missing["Xenova/opus-mt-en-es"] = {"vocab.json"}
    with pytest.raises(FileNotFoundError):
        convert_mt.stage("en-es", convert_mt.PAIRS["en-es"], tmp_path / "mt")


def test_listen_mode_translates_into_exactly_four_languages():
    assert sorted(convert_mt.PAIRS) == ["en-de", "en-es", "en-fr", "en-pt"]


PT_REVISION = "738ee4cce801ce7c519954e4b78d02d5057b6740"


def test_portuguese_is_staged_from_its_pinned_revision_even_after_the_repo_moves(fake_hub, tmp_path):
    fake_hub.head = "a-newer-commit"
    target = convert_mt.stage("en-pt", pinned_to_fake(convert_mt.PAIRS["en-pt"]), tmp_path / "mt")
    assert json.loads((target / "manifest.json").read_text())["source"]["revision"] == PT_REVISION
    assert {revision for _, _, revision in fake_hub.downloads} == {PT_REVISION}


def test_a_portuguese_file_whose_bytes_differ_from_its_pinned_hash_stops_the_run(fake_hub, tmp_path):
    # FakeHub's bytes are not the real export's, so the real pins must reject them.
    with pytest.raises(RuntimeError, match="sha256"):
        convert_mt.stage("en-pt", convert_mt.PAIRS["en-pt"], tmp_path / "mt")


def test_portuguese_pins_a_hash_for_every_file_it_stages():
    pair = convert_mt.PAIRS["en-pt"]
    assert set(pair.sha256) == {key for key, _ in convert_mt.FILES} - pair.absent


def test_an_export_with_its_own_licence_still_stops_on_a_noncommercial_base(fake_hub, tmp_path):
    fake_hub.licences["Helsinki-NLP/opus-mt-tc-big-en-pt"] = "cc-by-nc-4.0"
    with pytest.raises(RuntimeError, match="cc-by-nc-4.0"):
        convert_mt.stage("en-pt", pinned_to_fake(convert_mt.PAIRS["en-pt"]), tmp_path / "mt")


def test_portuguese_records_both_licences_it_checked(fake_hub, tmp_path):
    target = convert_mt.stage("en-pt", pinned_to_fake(convert_mt.PAIRS["en-pt"]), tmp_path / "mt")
    source = json.loads((target / "manifest.json").read_text())["source"]
    assert (source["licence"], source["base"], source["base_licence"]) == (
        "cc-by-4.0", "Helsinki-NLP/opus-mt-tc-big-en-pt", "cc-by-4.0")
