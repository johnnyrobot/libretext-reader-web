"""Tests for scripts/stage-phonon-lang.py (LT-216).

The script turns Johnny's Ollama copies of Phonon 40M (phonon:fr, :de, :es,
:pt) into the files src/phonon.worker.mjs loads. The offline tests stand a
tmp_path directory in for ~/.ollama/models. The round-trip tests use the real
Ollama copy of phonon:31m-en and the onnx-community English export as the
independent truth, and skip where either is not on this machine.
"""

import hashlib
import importlib.util
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]


def _load():
    spec = importlib.util.spec_from_file_location(
        "stage_phonon_lang_under_test", ROOT / "scripts" / "stage-phonon-lang.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


stage_lang = _load()


def _blob(models, data: bytes) -> str:
    digest = "sha256:" + hashlib.sha256(data).hexdigest()
    (models / "blobs").mkdir(parents=True, exist_ok=True)
    (models / "blobs" / digest.replace(":", "-")).write_bytes(data)
    return digest


def _safetensor(name: str, values) -> bytes:
    import numpy as np
    raw = np.asarray(values, np.float32).tobytes()
    header = json.dumps({name: {"dtype": "F32", "shape": [len(values)], "data_offsets": [0, len(raw)]}}).encode()
    return len(header).to_bytes(8, "little") + header + raw


def _fake_ollama(tmp_path, tag="fr"):
    """An Ollama models folder holding one tag: a tensor, a JSON file, and the
    inner manifest whose digest `ollama list` shows as the model's ID."""
    models = tmp_path / "ollama"
    tensor = {"mediaType": "application/vnd.ollama.image.tensor",
              "digest": _blob(models, _safetensor("flow_lm.bos_emb", [1.0, 2.0])), "name": "flow_lm.bos_emb"}
    config = {"mediaType": "application/vnd.ollama.image.json",
              "digest": _blob(models, b'{"languages": ["fr"]}'), "name": "config.json"}
    inner = json.dumps({"schemaVersion": 2, "layers": [tensor, config]}).encode()
    pin = _blob(models, inner)
    outer = {"schemaVersion": 2, "layers": [tensor, config, {
        "mediaType": "application/vnd.docker.distribution.manifest.v2+json", "digest": pin, "size": len(inner)}]}
    path = models / "manifests" / "registry.ollama.ai" / "library" / "phonon" / tag
    path.parent.mkdir(parents=True)
    path.write_text(json.dumps(outer))
    return models, pin


def test_reads_the_tensors_and_files_of_a_pinned_copy(tmp_path):
    models, pin = _fake_ollama(tmp_path)
    copy = stage_lang.read_ollama("fr", pin, models)
    assert copy.tensors["flow_lm.bos_emb"].tolist() == [1.0, 2.0]
    assert json.loads(copy.files["config.json"]) == {"languages": ["fr"]}


def test_refuses_a_tag_that_no_longer_points_at_its_pin(tmp_path):
    models, _ = _fake_ollama(tmp_path)
    with pytest.raises(SystemExit, match="phonon:fr"):
        stage_lang.read_ollama("fr", "sha256:" + "0" * 64, models)


def test_refuses_a_blob_whose_bytes_do_not_match_its_digest(tmp_path):
    models, pin = _fake_ollama(tmp_path)
    inner = json.loads((models / "blobs" / pin.replace(":", "-")).read_bytes())
    tensor_digest = inner["layers"][0]["digest"]
    (models / "blobs" / tensor_digest.replace(":", "-")).write_bytes(b"tampered")
    with pytest.raises(SystemExit, match="flow_lm.bos_emb"):
        stage_lang.read_ollama("fr", pin, models)


def test_pins_one_ollama_id_per_language():
    assert set(stage_lang.PINS) == {"fr", "de", "es", "pt"}
    for digest in stage_lang.PINS.values():
        assert digest.startswith("sha256:") and len(digest) == len("sha256:") + 64


def _fake_voices(models, tag, voices):
    """Add `phonon:<tag>` to a fake models folder, holding only voice tensors."""
    layers = [{"mediaType": "application/vnd.ollama.image.tensor",
               "digest": _blob(models, _safetensor(f"voices.{name}", values)), "name": f"voices.{name}"}
              for name, values in voices.items()]
    inner = json.dumps({"schemaVersion": 2, "layers": layers}).encode()
    pin = _blob(models, inner)
    path = models / "manifests" / "registry.ollama.ai" / "library" / "phonon" / tag
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"schemaVersion": 2, "layers": [*layers, {
        "mediaType": "application/vnd.docker.distribution.manifest.v2+json", "digest": pin, "size": len(inner)}]}))
    return pin


def _two_sources(tmp_path, monkeypatch):
    """phonon:fr with its one shipped voice, and phonon:40m-fr with the
    catalogue, whose own default is a different voice (as it is for fr)."""
    models = tmp_path / "ollama"
    monkeypatch.setitem(stage_lang.PINS, "fr", _fake_voices(models, "fr", {"default": [1.0, 1.0]}))
    monkeypatch.setitem(stage_lang.VOICE_PINS, "fr", _fake_voices(
        models, "40m-fr", {"default": [9.0, 9.0], "Hélène": [2.0, 3.0], "Lucien": [4.0, 5.0]}))
    return models


def _floats(data: bytes):
    import numpy as np
    return np.frombuffer(data, np.float32).tolist()


def test_stages_one_file_per_menu_voice_the_shipped_default_from_its_own_model(tmp_path, monkeypatch):
    models = _two_sources(tmp_path, monkeypatch)
    files = stage_lang.voice_files("fr", {"M1": "default", "F1": "Hélène"}, models)
    assert sorted(files) == ["voices/F1.bin", "voices/M1.bin"]
    assert _floats(files["voices/M1.bin"]) == [1.0, 1.0]   # phonon:fr's, not the catalogue's default
    assert _floats(files["voices/F1.bin"]) == [2.0, 3.0]


def test_takes_both_voices_from_the_catalogue_when_asked(tmp_path, monkeypatch):
    models = _two_sources(tmp_path, monkeypatch)
    files = stage_lang.voice_files("fr", {"M1": "Lucien", "F1": "Hélène"}, models)
    assert _floats(files["voices/M1.bin"]) == [4.0, 5.0]


def test_refuses_a_voice_the_catalogue_does_not_have(tmp_path, monkeypatch):
    models = _two_sources(tmp_path, monkeypatch)
    with pytest.raises(SystemExit, match="Ninon"):
        stage_lang.voice_files("fr", {"M1": "default", "F1": "Ninon"}, models)


def test_refuses_a_voice_file_name_that_is_not_a_plain_name(tmp_path, monkeypatch):
    models = _two_sources(tmp_path, monkeypatch)
    with pytest.raises(SystemExit, match="../F1"):
        stage_lang.voice_files("fr", {"../F1": "Hélène"}, models)


def test_every_language_has_a_male_and_a_female_voice_from_a_pinned_catalogue():
    assert set(stage_lang.VOICE_PINS) == set(stage_lang.PINS)
    for lang, digest in stage_lang.VOICE_PINS.items():
        assert digest.startswith("sha256:") and len(digest) == len("sha256:") + 64
        assert set(stage_lang.VOICES[lang]) == {"M1", "F1"}
        assert stage_lang.VOICES[lang]["M1"] != stage_lang.VOICES[lang]["F1"], lang


# The round trip: built from Johnny's Ollama copy of phonon:31m-en, the browser
# graphs must match onnx-community's English export, which was made
# independently from the same release. That proves the weight mapping the
# 40M builds rely on.

EN_PIN = "sha256:6667dd188d2e30e1448b0476ccbd36bdc8802225a848541d5049f450e2a983e0"
TEMPLATE = ROOT / "bench" / "assets" / "phonon-31m-en" / "4f0cda7c60dddb4862d0e68ff9ff60c32ffdc9f4"
OLLAMA = stage_lang.OLLAMA_MODELS
needs_real_copies = pytest.mark.skipif(
    importlib.util.find_spec("onnx") is None or importlib.util.find_spec("onnxruntime") is None
    or not (TEMPLATE / "onnx" / "flow_lm.onnx").is_file()
    or not (OLLAMA / "manifests" / "registry.ollama.ai" / "library" / "phonon" / "31m-en").is_file(),
    reason="needs onnx, onnxruntime, the English export (scripts/fetch-phonon.py) and `ollama pull phonon:31m-en`")


@pytest.fixture(scope="module")
def english():
    return stage_lang.read_ollama("31m-en", EN_PIN, OLLAMA)


def _blanked(path, constants=()):
    """The template with every weight (and the named constants) zeroed, so a
    build only matches by writing the release's values itself."""
    import numpy as np
    import onnx
    from onnx import numpy_helper
    model = onnx.load(path)
    for init in model.graph.initializer:
        init.CopyFrom(numpy_helper.from_array(np.zeros_like(numpy_helper.to_array(init)), init.name))
    for node in model.graph.node:
        if node.op_type == "Constant" and node.output[0] in constants:
            t = node.attribute[0].t
            t.CopyFrom(numpy_helper.from_array(np.zeros_like(numpy_helper.to_array(t))))
    return model


FOLDED = ("/Constant_1_output_0", "/Constant_6_output_0", "/flow_net/Constant_output_0")


def _values(model):
    import onnx
    from onnx import numpy_helper
    values = {i.name: numpy_helper.to_array(i) for i in model.graph.initializer}
    for node in model.graph.node:
        if node.op_type == "Constant" and node.attribute[0].type == onnx.AttributeProto.TENSOR:
            values[node.output[0]] = numpy_helper.to_array(node.attribute[0].t)
    return values


@needs_real_copies
def test_english_rebuilt_from_ollama_matches_the_onnx_community_flow_lm(english):
    import numpy as np
    import onnx
    built = stage_lang.build_flow_lm(_blanked(TEMPLATE / "onnx" / "flow_lm.onnx", FOLDED), english)
    want, got = _values(onnx.load(TEMPLATE / "onnx" / "flow_lm.onnx")), _values(built)
    assert set(got) == set(want)
    for name, value in want.items():
        np.testing.assert_allclose(got[name], value, rtol=0, atol=1e-6, err_msg=name)


@needs_real_copies
def test_english_rebuilt_from_ollama_matches_the_onnx_community_mimi_decoder(english):
    import onnx
    import numpy as np
    from onnx import numpy_helper
    template = onnx.load(TEMPLATE / "onnx" / "mimi_decoder.onnx")
    for init in template.graph.initializer:
        if init.name in ("emb_mean", "emb_std"):
            init.CopyFrom(numpy_helper.from_array(np.zeros(tuple(init.dims), np.float32), init.name))
    built = stage_lang.build_mimi_decoder(template, english, json.loads((TEMPLATE / "config.json").read_bytes()))
    assert built.SerializeToString() == onnx.load(TEMPLATE / "onnx" / "mimi_decoder.onnx").SerializeToString()


def _run_flow(model, layers, steps=3):
    """Prime with text and voice, then take a few autoregressive steps, as the
    worker does; returns every step's latent and EOS logit."""
    import numpy as np
    import onnxruntime as ort
    session = ort.InferenceSession(model.SerializeToString(), providers=["CPUExecutionProvider"])
    rng = np.random.default_rng(216)
    past = {f"past_key_values.{i}.{k}": np.zeros((1, 8, 0, 64), np.float32)
            for i in range(layers) for k in ("key", "value")}
    common = {"num_speakers": np.array([1], np.int64), "duration_delta": np.array([1.0], np.float32)}
    feeds = [
        {"text_ids": rng.integers(0, 4000, (1, 7)), "voice_latents": rng.standard_normal((1, 512, 4), np.float32),
         "latent": np.zeros((1, 0, 32), np.float32)},
        *({"text_ids": np.zeros((1, 0), np.int64), "voice_latents": np.zeros((1, 512, 0), np.float32),
           "latent": rng.standard_normal((1, 1, 32), np.float32)} for _ in range(steps)),
    ]
    results = []
    for feed in feeds:
        out = dict(zip([o.name for o in session.get_outputs()], session.run(None, {
            **feed, **common, **past, "noise": rng.standard_normal((1, 32), np.float32)})))
        past = {k.replace("present.", "past_key_values."): v for k, v in out.items() if k.startswith("present.")}
        results.append((out["latent_out"], out["eos_logit"]))
    return results


@needs_real_copies
def test_grows_the_transformer_to_the_copys_layer_count(english):
    """Layers whose output projections are zero pass their input through, so
    English grown to 9 layers that way must speak exactly as English does."""
    import dataclasses

    import numpy as np
    import onnx
    tensors = dict(english.tensors)
    for k in (6, 7, 8):
        for name, value in english.tensors.items():
            if name.startswith("flow_lm.transformer.layers.5."):
                tensors[name.replace(".layers.5.", f".layers.{k}.")] = value
        for name in ("self_attn.out_proj.weight", "linear2.weight"):
            tensors[f"flow_lm.transformer.layers.{k}.{name}"] = np.zeros_like(
                english.tensors[f"flow_lm.transformer.layers.5.{name}"])
    config = json.loads(english.files["config.json"])
    config["flow_lm"]["num_layers"] = 9
    grown = dataclasses.replace(english, tensors=tensors, files={**english.files, "config.json": json.dumps(config)})

    built = stage_lang.build_flow_lm(onnx.load(TEMPLATE / "onnx" / "flow_lm.onnx"), grown)
    onnx.checker.check_model(built)
    assert [i.name for i in built.graph.input][-2:] == ["past_key_values.8.key", "past_key_values.8.value"]
    assert [o.name for o in built.graph.output][-2:] == ["present.8.key", "present.8.value"]
    want = _run_flow(onnx.load(TEMPLATE / "onnx" / "flow_lm.onnx"), 6)
    for (got_latent, got_eos), (latent, eos) in zip(_run_flow(built, 9), want):
        np.testing.assert_allclose(got_latent, latent, atol=1e-4)
        np.testing.assert_allclose(got_eos, eos, atol=1e-4)


@needs_real_copies
def test_grown_layers_are_on_the_path_and_keep_their_own_cache(english):
    """The pass-through test cannot see a clone the graph routes around, or one
    reading another layer's cache; this one can."""
    import dataclasses

    import numpy as np
    import onnx
    tensors = dict(english.tensors)
    for k in (6, 7, 8):
        for name, value in english.tensors.items():
            if name.startswith("flow_lm.transformer.layers.5."):
                tensors[name.replace(".layers.5.", f".layers.{k}.")] = value
    config = json.loads(english.files["config.json"])
    config["flow_lm"]["num_layers"] = 9
    grown = dataclasses.replace(english, tensors=tensors, files={**english.files, "config.json": json.dumps(config)})
    built = stage_lang.build_flow_lm(onnx.load(TEMPLATE / "onnx" / "flow_lm.onnx"), grown)

    for k in (6, 7, 8):
        nodes = [n for n in built.graph.node if n.name.startswith(f"/layers.{k}/")]
        reads = {x for n in nodes for x in n.input if x.startswith("past_key_values.")}
        writes = {x for n in nodes for x in n.output if x.startswith("present.")}
        assert reads == {f"past_key_values.{k}.key", f"past_key_values.{k}.value"}
        assert writes == {f"present.{k}.key", f"present.{k}.value"}
    got, want = _run_flow(built, 9), _run_flow(onnx.load(TEMPLATE / "onnx" / "flow_lm.onnx"), 6)
    assert not np.allclose(got[-1][0], want[-1][0], atol=1e-3)


@needs_real_copies
def test_english_tokenizer_rebuilt_from_ollama_matches_onnx_community(english):
    built = stage_lang.build_tokenizer(english)
    assert json.loads(built["tokenizer.json"]) == json.loads((TEMPLATE / "tokenizer.json").read_bytes())
    assert json.loads(built["tokenizer_config.json"]) == json.loads((TEMPLATE / "tokenizer_config.json").read_bytes())


@needs_real_copies
def test_english_config_rebuilt_from_ollama_matches_onnx_community_but_its_source(english):
    want = json.loads((TEMPLATE / "config.json").read_bytes())
    got = stage_lang.build_config(english, want)
    assert got["phonon"].pop("source") == {"ollama": "phonon:31m-en", "digest": EN_PIN}
    assert got["phonon"].pop("variants") == {"fp32": {"flow_lm": "flow_lm", "mimi_decoder": "mimi_decoder"}}
    assert got.pop("transformers.js_config") == {"dtype": "fp32"}
    for key in ("source", "variants"):
        want["phonon"].pop(key)
    want.pop("transformers.js_config")
    assert got == want


def test_config_reads_the_layer_count_from_the_copy(tmp_path):
    template = {"languages": ["en"], "model_id": {"mimi_sig": "b77c7ffa"},
                "phonon": {"flow_lm": {"num_layers": 6, "num_heads": 8, "head_dim": 64}, "source": {}, "variants": {}},
                "transformers.js_config": {}}
    release = {"languages": ["fr"], "model_id": {"mimi_sig": "b77c7ffa"}, "flow_lm": {"num_layers": 9},
               "num_hidden_layers": 9, "weights_name": "model.safetensors"}
    copy = stage_lang.OllamaCopy("fr", "sha256:" + "a" * 64, {}, {"config.json": json.dumps(release).encode()})
    got = stage_lang.build_config(copy, template)
    assert got["phonon"]["flow_lm"]["num_layers"] == 9
    assert got["languages"] == ["fr"]
    assert "num_hidden_layers" not in got and "weights_name" not in got


def test_refuses_a_copy_whose_mimi_is_not_the_templates():
    onnx = pytest.importorskip("onnx")
    copy = stage_lang.OllamaCopy("fr", "sha256:" + "a" * 64, {},
                                 {"config.json": json.dumps({"model_id": {"mimi_sig": "0000beef", "mimi_epoch": 150}})})
    template_config = {"model_id": {"mimi_sig": "b77c7ffa", "mimi_epoch": 150}}
    with pytest.raises(SystemExit, match="mimi"):
        stage_lang.build_mimi_decoder(onnx.ModelProto(), copy, template_config)


def _checkout(path, ignores=".stage/"):
    import subprocess
    path.mkdir(parents=True)
    subprocess.run(["git", "init", "-q", str(path)], check=True)
    (path / ".gitignore").write_text(ignores + "\n")
    return path


def test_refuses_to_stage_where_this_repo_would_commit_the_weights():
    with pytest.raises(SystemExit, match="git would commit"):
        stage_lang.stage("fr", ROOT / "src" / "phonon-fr")


def test_refuses_to_stage_where_another_checkout_would_commit_the_weights(tmp_path):
    other = _checkout(tmp_path / "other")
    with pytest.raises(SystemExit, match="git would commit"):
        stage_lang.stage("fr", other / "_assets" / "tts" / "phonon-fr")


def test_refuses_a_checkout_that_ignores_the_manifest_but_not_the_weights(tmp_path):
    other = _checkout(tmp_path / "other", ignores="*.json")
    with pytest.raises(SystemExit, match="git would commit"):
        stage_lang.stage("fr", other / "_assets" / "tts" / "phonon-fr")


def test_lets_a_checkouts_ignored_stage_through(tmp_path):
    """LT-217 stages into scripts/stage-local.sh's .stage/; with no Ollama copy
    here it stops later, for that, and not at the guard."""
    target = _checkout(tmp_path / "checkout") / ".stage" / "_assets" / "tts" / "phonon-fr"
    with pytest.raises(SystemExit, match=r"the English export's|is not in") as stopped:
        stage_lang.stage("fr", target, models=tmp_path / "no-ollama")
    assert "git would commit" not in str(stopped.value)


def test_refuses_a_language_it_has_no_pin_for(tmp_path):
    with pytest.raises(SystemExit, match="no pinned Ollama copy for 'it'"):
        stage_lang.stage("it", tmp_path / "phonon-it")


@needs_real_copies
@pytest.mark.skipif(not (OLLAMA / "manifests" / "registry.ollama.ai" / "library" / "phonon" / "fr").is_file(),
                    reason="needs `ollama pull phonon:fr`")
@pytest.mark.parametrize("where", ["no checkout", "a checkout's ignored stage"])
def test_stages_french_in_the_layout_the_worker_loads(tmp_path, where):
    """Outside any checkout, or in one's git-ignored stage, as scripts/stage-local.sh's .stage/ is."""
    import onnx
    root = tmp_path if where == "no checkout" else _checkout(tmp_path / "checkout") / ".stage"
    target = root / "_assets" / "tts" / "phonon-fr"
    manifest = stage_lang.stage("fr", target)

    assert manifest["source"] == {"repo": "ollama:phonon:fr", "revision": stage_lang.PINS["fr"], "licence": "cc-by-nc-4.0"}
    assert manifest["voices"] == {"repo": "ollama:phonon:40m-fr", "revision": stage_lang.VOICE_PINS["fr"],
                                  "licence": "apache-2.0", "files": stage_lang.VOICES["fr"]}
    assert sorted(f["path"] for f in manifest["files"]) == [
        "config.json", "onnx/flow_lm.onnx", "onnx/mimi_decoder.onnx",
        "tokenizer.json", "tokenizer_config.json", "voices/F1.bin", "voices/M1.bin"]
    for entry in manifest["files"]:
        data = (target / entry["path"]).read_bytes()
        assert entry["name"] == entry["path"]
        assert (len(data), hashlib.sha256(data).hexdigest()) == (entry["bytes"], entry["sha256"])
    assert json.loads((target / "manifest.json").read_bytes()) == manifest

    config = json.loads((target / "config.json").read_bytes())
    assert config["languages"] == ["fr"] and config["phonon"]["flow_lm"]["num_layers"] == 9
    for voice in ("M1", "F1"):
        assert (target / "voices" / f"{voice}.bin").stat().st_size == 512 * 125 * 4
    flow = onnx.load(target / "onnx" / "flow_lm.onnx")
    onnx.checker.check_model(flow)
    assert sum(i.name.startswith("past_key_values.") for i in flow.graph.input) == 18
