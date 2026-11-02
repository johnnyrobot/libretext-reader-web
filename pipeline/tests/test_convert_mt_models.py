"""Offline tests for scripts/convert-mt-models.py, with a fake `huggingface_hub`
in sys.modules standing in for the Hub, as in test_convert_models.py."""

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


@pytest.fixture
def fake_hub(tmp_path, monkeypatch):
    """A Hub whose repos hold every staged file except the ones listed as missing."""
    missing = {}

    def model_info(repo):
        return types.SimpleNamespace(tags=["license:cc-by-4.0"], sha="abc123")

    def hf_hub_download(repo, relative, revision):
        if relative in missing.get(repo, ()):
            raise FileNotFoundError(f"{repo} has no {relative}")
        path = tmp_path / "hub" / repo / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(relative.encode())
        return str(path)

    hub = types.ModuleType("huggingface_hub")
    hub.model_info = model_info
    hub.hf_hub_download = hf_hub_download
    monkeypatch.setitem(sys.modules, "huggingface_hub", hub)
    return missing


def test_portuguese_stages_without_a_vocab_json(fake_hub, tmp_path):
    # The en-pt export ships no vocab.json; transformers.js reads tokenizer.json.
    fake_hub["Douglasrambo/opus-mt-tc-big-en-pt-onnx"] = {"vocab.json"}
    target = convert_mt.stage("en-pt", convert_mt.PAIRS["en-pt"], tmp_path / "mt")
    names = [f["name"] for f in json.loads((target / "manifest.json").read_text())["files"]]
    assert "vocab" not in names
    assert {"encoder", "decoder", "tokenizer", "config"} <= set(names)


def test_a_missing_file_still_stops_every_other_pair(fake_hub, tmp_path):
    fake_hub["Xenova/opus-mt-en-es"] = {"vocab.json"}
    with pytest.raises(FileNotFoundError):
        convert_mt.stage("en-es", convert_mt.PAIRS["en-es"], tmp_path / "mt")


def test_listen_mode_translates_into_exactly_four_languages():
    assert sorted(convert_mt.PAIRS) == ["en-de", "en-es", "en-fr", "en-pt"]
