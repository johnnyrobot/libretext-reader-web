"""Offline tests for scripts/convert-models.py.

The script is loaded via importlib (its filename has a hyphen, so it cannot be a
plain `import` target) and exercised with fakes: a tmp_path directory standing in
for a converted checkpoint, and a fake `huggingface_hub` module injected into
sys.modules standing in for the real Hub call. No network access, no model
download, no pip install -- see pipeline/opus.py and this repo's task briefs for
why that boundary matters here.
"""

import importlib.util
import json
import sys
import types
from pathlib import Path

import pytest

_SCRIPT_PATH = Path(__file__).resolve().parents[2] / "scripts" / "convert-models.py"


def _load_convert_models():
    spec = importlib.util.spec_from_file_location("convert_models_under_test", _SCRIPT_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


convert_models = _load_convert_models()


class _FakeModelInfo:
    def __init__(self, tags: list[str], sha: str) -> None:
        self.tags = tags
        self.sha = sha


def _fake_huggingface_hub(model_info_fn):
    module = types.ModuleType("huggingface_hub")
    module.model_info = model_info_fn
    return module


# --- R17: a directory that exists is not automatically a finished conversion ---


def test_missing_directory_is_not_treated_as_converted(tmp_path):
    target = tmp_path / "opus-mt-en-es"
    assert not convert_models._is_converted(target)


def test_directory_missing_both_marker_files_is_not_treated_as_converted(tmp_path):
    target = tmp_path / "opus-mt-en-es"
    target.mkdir()
    (target / "some_partial_temp_file").write_bytes(b"leftover from a killed run")
    assert not convert_models._is_converted(target)


def test_directory_with_only_one_marker_file_is_not_treated_as_converted(tmp_path):
    target = tmp_path / "opus-mt-en-es"
    target.mkdir()
    (target / "model.bin").write_bytes(b"partial weights")
    assert not convert_models._is_converted(target)


def test_directory_with_both_marker_files_is_treated_as_converted(tmp_path):
    target = tmp_path / "opus-mt-en-es"
    target.mkdir()
    (target / "model.bin").write_bytes(b"weights")
    (target / "config.json").write_text("{}")
    assert convert_models._is_converted(target)


# --- R18: a missing license: tag must raise, never silently write "unknown" ---


def test_licence_and_revision_raises_when_no_license_tag_present(monkeypatch):
    fake_hub = _fake_huggingface_hub(
        lambda name: _FakeModelInfo(tags=["dataset:opus", "region:us"], sha="deadbeef")
    )
    monkeypatch.setitem(sys.modules, "huggingface_hub", fake_hub)

    with pytest.raises(RuntimeError, match="opus-mt-en-es"):
        convert_models.licence_and_revision("Helsinki-NLP/opus-mt-en-es")


def test_licence_and_revision_never_returns_the_string_unknown(monkeypatch):
    fake_hub = _fake_huggingface_hub(lambda name: _FakeModelInfo(tags=[], sha="deadbeef"))
    monkeypatch.setitem(sys.modules, "huggingface_hub", fake_hub)

    with pytest.raises(RuntimeError):
        convert_models.licence_and_revision("Helsinki-NLP/opus-mt-en-de")


# --- R19: the revision hash is recorded too, from the same Hub call ---


def test_licence_and_revision_returns_licence_and_sha(monkeypatch):
    fake_hub = _fake_huggingface_hub(
        lambda name: _FakeModelInfo(tags=["license:apache-2.0"], sha="cafef00d")
    )
    monkeypatch.setitem(sys.modules, "huggingface_hub", fake_hub)

    licence, revision = convert_models.licence_and_revision("Helsinki-NLP/opus-mt-en-es")
    assert licence == "apache-2.0"
    assert revision == "cafef00d"


# --- I4 (final-review): a licence tag being present is not the same as it
# being one this project can ship. ---


def test_licence_and_revision_raises_on_a_non_acceptable_licence(monkeypatch):
    """The whole point: this project chose Opus-MT over NLLB specifically
    because NLLB's output is cc-by-nc-4.0 (memory
    `translation-model-licence-constraint`). A checkpoint retagged cc-by-nc-4.0
    must raise exactly the way a missing tag does, not be recorded and
    shipped."""
    fake_hub = _fake_huggingface_hub(
        lambda name: _FakeModelInfo(tags=["license:cc-by-nc-4.0"], sha="deadbeef")
    )
    monkeypatch.setitem(sys.modules, "huggingface_hub", fake_hub)

    with pytest.raises(RuntimeError, match="cc-by-nc-4.0"):
        convert_models.licence_and_revision("Helsinki-NLP/opus-mt-en-es")


def test_licence_and_revision_raises_on_an_unknown_permissive_sounding_licence(monkeypatch):
    """Not just the known-bad case -- anything outside ACCEPTABLE_LICENCES
    raises, even a licence that sounds fine, so a human decides rather than
    the run assuming it is safe."""
    fake_hub = _fake_huggingface_hub(
        lambda name: _FakeModelInfo(tags=["license:bsd-3-clause"], sha="deadbeef")
    )
    monkeypatch.setitem(sys.modules, "huggingface_hub", fake_hub)

    with pytest.raises(RuntimeError, match="bsd-3-clause"):
        convert_models.licence_and_revision("Helsinki-NLP/opus-mt-en-es")


@pytest.mark.parametrize("licence", sorted(convert_models.ACCEPTABLE_LICENCES))
def test_licence_and_revision_accepts_every_acceptable_licence(monkeypatch, licence):
    fake_hub = _fake_huggingface_hub(
        lambda name: _FakeModelInfo(tags=[f"license:{licence}"], sha="deadbeef")
    )
    monkeypatch.setitem(sys.modules, "huggingface_hub", fake_hub)

    got_licence, _ = convert_models.licence_and_revision("Helsinki-NLP/opus-mt-en-es")
    assert got_licence == licence


def test_licence_and_revision_makes_a_single_hub_call(monkeypatch):
    calls: list[str] = []

    def fake_model_info(name):
        calls.append(name)
        return _FakeModelInfo(tags=["license:cc-by-4.0"], sha="abc123")

    monkeypatch.setitem(sys.modules, "huggingface_hub", _fake_huggingface_hub(fake_model_info))

    convert_models.licence_and_revision("Helsinki-NLP/opus-mt-en-de")
    assert calls == ["Helsinki-NLP/opus-mt-en-de"]


# --- Task 14 (R39): --langs converts only the checkpoints a subset of languages
# actually needs, so staging one language does not require every checkpoint. ---


def test_checkpoints_with_no_filter_returns_every_shipped_checkpoint():
    unfiltered = convert_models.checkpoints()
    assert unfiltered == convert_models.checkpoints(None)
    all_names = {lang.forward for lang in convert_models.TARGETS.values()} | {
        lang.reverse for lang in convert_models.TARGETS.values()
    }
    assert set(unfiltered) == all_names


def test_checkpoints_filtered_by_langs_returns_only_that_languages_checkpoints():
    es = convert_models.TARGETS["es"]
    filtered = convert_models.checkpoints({"es"})
    assert set(filtered) == {es.forward, es.reverse}
    assert filtered[es.forward] == {"es:forward"}
    assert filtered[es.reverse] == {"es:reverse"}


def test_checkpoints_filtered_by_langs_dedupes_shared_group_models():
    """hr, sl and pl all forward-translate through opus-mt-en-sla (R39 exercises
    the same sharing test_shared_group_models_resolve_to_one_directory covers for
    ct2_dir, but for the filtered checkpoints() map)."""
    filtered = convert_models.checkpoints({"hr", "sl", "pl"})
    sla_forward = convert_models.TARGETS["hr"].forward
    assert sla_forward == convert_models.TARGETS["sl"].forward == convert_models.TARGETS["pl"].forward
    assert filtered[sla_forward] == {"hr:forward", "sl:forward", "pl:forward"}


def test_main_rejects_unknown_lang_code_before_touching_the_network_or_disk(monkeypatch, tmp_path, capsys):
    def _boom(*args, **kwargs):
        raise AssertionError("must not be called for an unknown --langs code")

    monkeypatch.setattr(convert_models.subprocess, "run", _boom)
    monkeypatch.setitem(sys.modules, "huggingface_hub", _fake_huggingface_hub(_boom))
    monkeypatch.setattr(sys, "argv", [
        "convert-models.py", "--langs", "xx",
        "--root", str(tmp_path / "root"),
        "--attribution", str(tmp_path / "attribution.json"),
    ])

    with pytest.raises(SystemExit):
        convert_models.main()
    assert "xx" in capsys.readouterr().err


def test_main_with_langs_merges_onto_existing_attribution_instead_of_overwriting(monkeypatch, tmp_path):
    root = tmp_path / "root"
    attribution_path = tmp_path / "attribution.json"
    attribution_path.write_text(json.dumps({
        "Helsinki-NLP/opus-mt-en-de": {
            "licence": "cc-by-4.0", "revision": "preexisting", "used_by": ["de:forward"],
        },
    }))

    def fake_run(cmd, check):
        target = Path(cmd[cmd.index("--output_dir") + 1])
        target.mkdir(parents=True, exist_ok=True)
        (target / "model.bin").write_bytes(b"weights")
        (target / "config.json").write_text("{}")

    monkeypatch.setattr(convert_models.subprocess, "run", fake_run)
    monkeypatch.setitem(sys.modules, "huggingface_hub", _fake_huggingface_hub(
        lambda name: _FakeModelInfo(tags=["license:apache-2.0"], sha="es-sha")
    ))
    monkeypatch.setattr(sys, "argv", [
        "convert-models.py", "--langs", "es",
        "--root", str(root),
        "--attribution", str(attribution_path),
    ])

    assert convert_models.main() == 0

    written = json.loads(attribution_path.read_text())
    # The pre-existing de entry survives even though this run never touched it.
    assert written["Helsinki-NLP/opus-mt-en-de"]["revision"] == "preexisting"
    # Both es checkpoints were added.
    es = convert_models.TARGETS["es"]
    assert written[es.forward]["used_by"] == ["es:forward"]
    assert written[es.reverse]["used_by"] == ["es:reverse"]
    assert set(written) == {"Helsinki-NLP/opus-mt-en-de", es.forward, es.reverse}


# --- --models: convert a checkpoint the language registry does NOT point at ---
#
# hu and fi are registered against opus-mt-tc-big-en-*, but the browser ships the
# Xenova export of the SMALL opus-mt-en-*. Screening the checkpoint that ships,
# rather than the one that is registered, needs a way to name a checkpoint
# directly -- and it must still go through the same licence gate, because a
# screened checkpoint is a shipping candidate.


def _fake_converter(monkeypatch, seen):
    def fake_run(cmd, check):
        seen.append(cmd[cmd.index("--model") + 1])
        target = Path(cmd[cmd.index("--output_dir") + 1])
        target.mkdir(parents=True, exist_ok=True)
        (target / "model.bin").write_bytes(b"weights")
        (target / "config.json").write_text("{}")

    monkeypatch.setattr(convert_models.subprocess, "run", fake_run)
    monkeypatch.setitem(sys.modules, "huggingface_hub", _fake_huggingface_hub(
        lambda name: _FakeModelInfo(tags=["license:apache-2.0"], sha=f"sha-{name[-5:]}")
    ))


def test_main_with_models_converts_exactly_the_named_checkpoint(monkeypatch, tmp_path):
    seen: list[str] = []
    _fake_converter(monkeypatch, seen)
    monkeypatch.setattr(sys, "argv", [
        "convert-models.py", "--models", "Helsinki-NLP/opus-mt-en-hu",
        "--root", str(tmp_path / "root"),
        "--attribution", str(tmp_path / "attribution.json"),
    ])

    assert convert_models.main() == 0
    assert seen == ["Helsinki-NLP/opus-mt-en-hu"]
    # NOT the checkpoint hu is registered against.
    assert convert_models.TARGETS["hu"].forward != "Helsinki-NLP/opus-mt-en-hu"


def test_main_with_models_records_an_unregistered_checkpoint_as_such(monkeypatch, tmp_path):
    attribution_path = tmp_path / "attribution.json"
    _fake_converter(monkeypatch, [])
    monkeypatch.setattr(sys, "argv", [
        "convert-models.py", "--models", "Helsinki-NLP/opus-mt-en-hu",
        "--root", str(tmp_path / "root"), "--attribution", str(attribution_path),
    ])

    assert convert_models.main() == 0
    entry = json.loads(attribution_path.read_text())["Helsinki-NLP/opus-mt-en-hu"]
    assert entry["licence"] == "apache-2.0"
    # An honest used_by: nothing in TARGETS points at this checkpoint, so it must
    # not be recorded as if some language shipped from it.
    assert entry["used_by"] == ["(not registered in pipeline/languages.py)"]


def test_main_with_models_keeps_the_real_used_by_for_a_registered_checkpoint(monkeypatch, tmp_path):
    attribution_path = tmp_path / "attribution.json"
    _fake_converter(monkeypatch, [])
    nl_forward = convert_models.TARGETS["nl"].forward
    monkeypatch.setattr(sys, "argv", [
        "convert-models.py", "--models", nl_forward,
        "--root", str(tmp_path / "root"), "--attribution", str(attribution_path),
    ])

    assert convert_models.main() == 0
    entry = json.loads(attribution_path.read_text())[nl_forward]
    assert entry["used_by"] == ["nl:forward"]


def test_main_rejects_models_and_langs_together(monkeypatch, tmp_path, capsys):
    def _boom(*args, **kwargs):
        raise AssertionError("must not convert anything when the flags conflict")

    monkeypatch.setattr(convert_models.subprocess, "run", _boom)
    monkeypatch.setitem(sys.modules, "huggingface_hub", _fake_huggingface_hub(_boom))
    monkeypatch.setattr(sys, "argv", [
        "convert-models.py", "--langs", "nl", "--models", "Helsinki-NLP/opus-mt-en-nl",
        "--root", str(tmp_path / "root"), "--attribution", str(tmp_path / "a.json"),
    ])

    with pytest.raises(SystemExit):
        convert_models.main()
    assert "--models" in capsys.readouterr().err


def test_main_with_models_still_refuses_a_non_permissive_licence(monkeypatch, tmp_path):
    monkeypatch.setattr(convert_models.subprocess, "run",
                        lambda cmd, check: Path(cmd[cmd.index("--output_dir") + 1]).mkdir(parents=True))
    monkeypatch.setitem(sys.modules, "huggingface_hub", _fake_huggingface_hub(
        lambda name: _FakeModelInfo(tags=["license:cc-by-nc-4.0"], sha="nc")
    ))
    monkeypatch.setattr(sys, "argv", [
        "convert-models.py", "--models", "Helsinki-NLP/opus-mt-en-hu",
        "--root", str(tmp_path / "root"), "--attribution", str(tmp_path / "a.json"),
    ])

    with pytest.raises(RuntimeError, match="cc-by-nc-4.0"):
        convert_models.main()
