#!/usr/bin/env python3
"""Stage Phonon 40M for a translation language from Johnny's Ollama copy (LT-216).

    python3 scripts/stage-phonon-lang.py fr <STAGE>/_assets/tts/phonon-fr

Reads `phonon:<lang>` from ~/.ollama/models (or OLLAMA_MODELS), checks it against the Ollama ID
pinned below, and writes the files `src/phonon.worker.mjs` loads, in the same
layout and manifest shape as scripts/fetch-phonon.py writes for English. The
weights are CC BY-NC 4.0 and never committed, so the target must be outside
any git checkout or in a git-ignored folder (scripts/stage-local.sh's .stage/).

Ollama's copy is the original release as bf16 safetensors, one blob per
tensor. The browser needs two ONNX graphs, and no 40M export exists, so they
are built from onnx-community's English export of phonon-31m-en, the same
PocketTTS architecture with 6 transformer layers where the 40M has 9:

- `flow_lm.onnx`: the English graph with its last layer cloned three times,
  and every weight replaced by the language's own.
- `voices/M1.bin` and `voices/F1.bin`: the reader's Male and Female voice
  (VOICES), one the release's own default (CC BY-NC, as the model) and the
  other from the voice catalogue Ollama's `phonon:40m-<lang>` carries
  (phonon-voices, Apache 2.0, LT-222). The manifest records each one's source.
- `mimi_decoder.onnx`: the English graph unchanged except the latent
  mean and std, which differ per model. Every Phonon copy shares one Mimi
  (`mimi_sig` in its config); the script refuses a copy trained on another.

The English export is the template, read from fetch-phonon.py's cache and
checked against its pins (fetch-phonon.py downloads it from Hugging Face,
Apache 2.0, no token, when the cache does not have it). Built from Ollama's phonon:31m-en, this script
reproduces that export's weights and tokenizer (pipeline/tests); how it was
worked out is in bench/phonon/FINDINGS.md, "LT-216".

Needs numpy and onnx (`pip install numpy onnx`).
"""

import hashlib
import json
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
# Where Ollama keeps its models: OLLAMA_MODELS when set, as Ollama itself reads it.
OLLAMA_MODELS = Path(os.environ.get("OLLAMA_MODELS") or Path.home() / ".ollama" / "models")
LICENCE = "cc-by-nc-4.0"

# The ID `ollama list` shows for each tag: the sha256 of the inner manifest,
# which names every blob by its own sha256. Pinned 2026-11-01 from Johnny's
# copies (Ollama 0.40.13).
PINS = {
    "fr": "sha256:da29147f2cba54069f8d75f0e3ae0e667e5cc324402cf602672cdf3b915b372b",
    "de": "sha256:6ef2680491eb3f8e8e5cc59ecf9ef5ce44d108acbed2c69fd6313182ed0038a1",
    "es": "sha256:d5df2ae8bc2dd279acd6c049bcd6469626e951d98721c49001432864793b6db3",
    "pt": "sha256:e8fb87dea0cdbfaecfbe1c713d4389a5ab4e35bb273c6f047ae22217e6919839",
}

# Each language's voice catalogue (LT-222): `phonon:40m-<lang>` carries
# gradium/phonon-voices @ da6c9ec0, Apache 2.0, beside the same model weights.
# Only its voice tensors are read. Pinned the same way, 2026-11-01.
VOICE_PINS = {
    "fr": "sha256:eef1ed69574aeab7b98f29b9808bb3a75c9644adfb53533df669ce57c5723756",
    "de": "sha256:024449ea0a54272832611a4c38a16c3b2c8e67752a2e1a2fd0c4350b3561a905",
    "es": "sha256:446893b2a1fdd3409869ad2853bbed8a7d1ba37a756bc2bd0d9d8d71ca3b8d94",
    "pt": "sha256:c640b8b12b6375091b57ef42d6361c7c40c0b0355552a7a0376a24568550edb8",
}
VOICES_LICENCE = "apache-2.0"

# The reader's Male (M1) and Female (F1) voice in each language (LT-222).
# "default" is the one voice `phonon:<lang>` ships, the one Johnny approved in
# LT-217, in its own gender's slot; the other is the catalogue voice that read
# the LT-216 bench set best (bench/phonon/FINDINGS.md, "LT-222").
# Every shipped default measured male (median F0 112-120 Hz), so each keeps M1
# and F1 is the female catalogue voice with the lowest WER.
VOICES = {
    "fr": {"M1": "default", "F1": "Lilou"},
    "de": {"M1": "default", "F1": "Annika"},
    "es": {"M1": "default", "F1": "Ximena"},
    "pt": {"M1": "default", "F1": "Isadora"},
}

INNER_MANIFEST = "application/vnd.docker.distribution.manifest.v2+json"
VOICE_FILE = re.compile(r"^[A-Za-z0-9_-]+$")


@dataclass
class OllamaCopy:
    tag: str
    pin: str
    tensors: dict   # name -> float32 ndarray
    files: dict     # name -> bytes (config.json, tokenizer.json, ...)


def _sha256(data: bytes) -> str:
    return "sha256:" + hashlib.sha256(data).hexdigest()


def _blob(models: Path, digest: str, what: str) -> bytes:
    path = models / "blobs" / digest.replace(":", "-")
    data = path.read_bytes() if path.is_file() else b""
    if _sha256(data) != digest:
        raise SystemExit(f"{what}: blob {digest[:19]} is missing or does not match its digest")
    return data


def _tensor(data: bytes, what: str) -> np.ndarray:
    size = int.from_bytes(data[:8], "little")
    header = json.loads(data[8:8 + size])
    (name, meta), = [(k, v) for k, v in header.items() if k != "__metadata__"]
    start, end = meta["data_offsets"]
    raw = data[8 + size + start:8 + size + end]
    if meta["dtype"] == "BF16":
        values = (np.frombuffer(raw, np.uint16).astype(np.uint32) << 16).view(np.float32)
    elif meta["dtype"] == "F32":
        values = np.frombuffer(raw, np.float32)
    else:
        raise SystemExit(f"{what}: unexpected dtype {meta['dtype']}")
    return values.reshape(meta["shape"]).copy()


def read_ollama(tag: str, pin: str, models: Path = OLLAMA_MODELS, keep=lambda name: True) -> OllamaCopy:
    """Read `phonon:<tag>`, refusing anything that is not exactly the pinned copy.
    Only the tensors whose names `keep` accepts are read."""
    name = f"phonon:{tag}"
    path = models / "manifests" / "registry.ollama.ai" / "library" / "phonon" / tag
    if not path.is_file():
        raise SystemExit(f"{name} is not in {models}; run `ollama pull {name}`")
    outer = json.loads(path.read_text(encoding="utf-8"))
    current = [layer["digest"] for layer in outer["layers"] if layer["mediaType"] == INNER_MANIFEST]
    if current != [pin]:
        raise SystemExit(f"{name} is {current[0][:19] if current else 'unpinned'}, not the pinned {pin[:19]}; "
                         "check the new copy and re-pin it")

    inner = json.loads(_blob(models, pin, f"{name} manifest"))
    tensors, files = {}, {}
    for layer in inner["layers"]:
        kind, label = layer["mediaType"], layer.get("name")
        if kind.endswith(".tensor") and keep(label):
            tensors[label] = _tensor(_blob(models, layer["digest"], f"{name} {label}"), f"{name} {label}")
        elif kind.endswith(".json"):
            files[label] = _blob(models, layer["digest"], f"{name} {label}")
    return OllamaCopy(tag, pin, tensors, files)


# --- flow_lm --------------------------------------------------------------

FLOW = "flow_lm."
NET = FLOW + "flow_net."
SAME = {  # template initializer -> release tensor, used as is
    "text_embed": FLOW + "condition_provider.conditioners.transcript_in_segment.embed.weight",
    "bos_emb": FLOW + "bos_emb",
    "out_norm_w": FLOW + "out_norm.weight",
    "out_norm_b": FLOW + "out_norm.bias",
    "out_eos_b": FLOW + "out_eos.bias",
    "flow_net.cond_b": NET + "cond_embed.bias",
    "flow_net.in_b": NET + "input_proj.bias",
    "flow_net.final_b": NET + "final_layer.linear.bias",
}
MATMULS = {  # template node -> release weight, transposed for x @ W
    "/MatMul": FLOW + "condition_provider.conditioners.speaker_wavs.output_proj.weight",
    "/MatMul_1": FLOW + "input_linear.weight",
    "/MatMul_3": FLOW + "out_eos.weight",
    "/flow_net/MatMul": NET + "input_proj.weight",
    "/flow_net/MatMul_1": NET + "cond_embed.weight",
    "/flow_net/MatMul_15": NET + "final_layer.linear.weight",
    **{f"/flow_net/MatMul_{3 + 2 * k + j}": NET + f"res_blocks.{k}.mlp.{2 * j}.weight"
       for k in range(6) for j in range(2)},
}
LAYER_MATMULS = {"MatMul": "self_attn.in_proj", "MatMul_3": "self_attn.out_proj",
                 "MatMul_4": "linear1", "MatMul_5": "linear2"}
LAYER_NORMS = {"LayerNormalization": "norm1", "LayerNormalization_1": "norm2"}
RES_BLOCK = {0: "in_ln.weight", 1: "in_ln.bias", 3: "mlp.0.bias", 5: "mlp.2.bias"}
ADA = [NET + f"res_blocks.{k}.adaLN_modulation.1" for k in range(6)] + [NET + "final_layer.adaLN_modulation.1"]
LAYER = re.compile(r"^/layers\.(\d+)/(\w+)$")


def _time_embed(t: dict, i: int, at: float) -> np.ndarray:
    """One of the flow net's two time embeddings, which LSD's single step folds
    into a constant: an MLP over [cos, sin] of t times its frequencies, then
    an RMSNorm with a learnt scale."""
    p = NET + f"time_embed.{i}."
    angles = at * t[p + "freqs"]
    x = np.concatenate([np.cos(angles), np.sin(angles)])[None]
    x = x @ t[p + "mlp.0.weight"].T + t[p + "mlp.0.bias"]
    x = x / (1 + np.exp(-x))
    x = x @ t[p + "mlp.2.weight"].T + t[p + "mlp.2.bias"]
    return x / np.sqrt(np.mean(x * x, axis=-1, keepdims=True) + 1e-5) * t[p + "mlp.3.alpha"]


def _constants(t: dict) -> dict:
    """The template's weight-derived constants: the export folded them."""
    speakers = FLOW + "condition_provider.conditioners.num_speakers."
    return {
        "/Constant_1_output_0": t[speakers + "embed.weight"] @ t[speakers + "output_proj.weight"].T,
        "/Constant_6_output_0": t[FLOW + "condition_provider.conditioners.duration_delta.output_proj.weight"].T,
        "/flow_net/Constant_output_0": (_time_embed(t, 0, 0.0) + _time_embed(t, 1, 1.0)) / 2,
    }


def _weight(node, position: int, t: dict):
    """The release's value for input `position` of a template node, or None if
    that input is not a weight."""
    layer = LAYER.match(node.name)
    if layer:
        i, op = layer.groups()
        base = FLOW + f"transformer.layers.{i}."
        if op in LAYER_MATMULS and position == 1:
            return t[base + LAYER_MATMULS[op] + ".weight"].T
        if op in LAYER_NORMS and position in (1, 2):
            return t[base + LAYER_NORMS[op] + (".weight" if position == 1 else ".bias")]
        return None
    if node.name in MATMULS and position == 1:
        return t[MATMULS[node.name]].T
    if node.name == "/flow_net/MatMul_2" and position == 1:
        return np.concatenate([t[a + ".weight"] for a in ADA]).T
    return None


def _named_weight(name: str, t: dict):
    if name in SAME:
        return t[SAME[name]]
    if name == "flow_net.ada_b":
        return np.concatenate([t[a + ".bias"] for a in ADA])
    if name.startswith("flow_net.blocks."):
        k, j = divmod(int(name.rsplit(".", 1)[1]), 8)
        return t[NET + f"res_blocks.{k}.{RES_BLOCK[j]}"]
    return None


def _add_layers(graph, layers: int) -> None:
    """Grow the template's transformer to `layers` by cloning its last layer.

    Each clone reads the previous layer's output and its own cache, and
    whatever read the last layer's output now reads the new last layer's."""
    import copy

    last = max(int(LAYER.match(n.name).group(1)) for n in graph.node if LAYER.match(n.name))
    if layers <= last + 1:
        return
    prefix, prev = f"/layers.{last}/", f"/layers.{last - 1}/Add_4_output_0"
    output = f"/layers.{last}/Add_4_output_0"
    block = [n for n in graph.node if n.name.startswith(prefix)]
    weights = {i.name: i for i in graph.initializer}
    at = max(i for i, n in enumerate(graph.node) if n.name.startswith(prefix)) + 1

    def rename(value: str, k: int) -> str:
        if value == prev:
            return f"/layers.{k - 1}/Add_4_output_0"
        if value.startswith(prefix):
            return f"/layers.{k}/" + value[len(prefix):]
        for cache in ("past_key_values", "present"):
            if value.startswith(f"{cache}.{last}."):
                return f"{cache}.{k}." + value[len(f"{cache}.{last}."):]
        if value in weights:
            return f"{value}@layers.{k}"
        if value.startswith("/layers."):
            raise SystemExit(f"layer {last} reads {value}, which cloning does not handle")
        return value

    clones, extra = [], []
    for k in range(last + 1, layers):
        for node in block:
            clone = copy.deepcopy(node)
            clone.name = rename(node.name, k)
            clone.input[:] = [rename(x, k) for x in node.input]
            clone.output[:] = [rename(x, k) for x in node.output]
            for x, y in zip(node.input, clone.input):
                if x in weights and y not in {w.name for w in extra}:
                    w = copy.deepcopy(weights[x])
                    w.name = y
                    extra.append(w)
            clones.append(clone)
    for node in graph.node:
        if not node.name.startswith(prefix):
            node.input[:] = [f"/layers.{layers - 1}/Add_4_output_0" if x == output else x for x in node.input]
    for i, node in enumerate(clones):
        graph.node.insert(at + i, node)
    graph.initializer.extend(extra)

    def grow(values, cache):
        template = {v.name: v for v in values}
        for k in range(last + 1, layers):
            for part in ("key", "value"):
                v = copy.deepcopy(template[f"{cache}.{last}.{part}"])
                v.name = f"{cache}.{k}.{part}"
                values.append(v)
    grow(graph.input, "past_key_values")
    grow(graph.output, "present")


def build_flow_lm(template, copy: OllamaCopy):
    """The language's flow_lm graph: the template's, grown to the copy's
    layer count, with every weight and folded constant the copy's own."""
    from onnx import numpy_helper

    t = copy.tensors
    layers = json.loads(copy.files["config.json"])["flow_lm"]["num_layers"]
    graph = template.graph
    _add_layers(graph, layers)

    weights = {i.name: i for i in graph.initializer}
    values = {}
    for node in graph.node:
        for position, name in enumerate(node.input):
            if name not in weights or name in values:
                continue
            value = _weight(node, position, t)
            if value is None:
                value = _named_weight(name, t)
            if value is None:
                raise SystemExit(f"flow_lm: no release tensor for {name} in {node.name}")
            values[name] = value
    for name, value in values.items():
        weights[name].CopyFrom(numpy_helper.from_array(np.ascontiguousarray(value, np.float32), name))
    if set(values) != set(weights):
        raise SystemExit(f"flow_lm: weights left as English: {sorted(set(weights) - set(values))[:5]}")

    constants = _constants(t)
    for node in graph.node:
        if node.op_type == "Constant" and node.output[0] in constants:
            node.attribute[0].t.CopyFrom(numpy_helper.from_array(
                np.ascontiguousarray(constants.pop(node.output[0]), np.float32)))
    if constants:
        raise SystemExit(f"flow_lm: template has no {sorted(constants)}")
    return template


# --- mimi_decoder ---------------------------------------------------------

def build_mimi_decoder(template, copy: OllamaCopy, template_config: dict):
    """The template's Mimi decoder with the copy's latent mean and std, which
    are the one part of it that differs between Phonon models. Refuses a copy
    trained on another Mimi, whose decoder weights would differ too."""
    from onnx import numpy_helper

    release = json.loads(copy.files["config.json"])["model_id"]
    want = template_config["model_id"]
    if (release.get("mimi_sig"), release.get("mimi_epoch")) != (want["mimi_sig"], want["mimi_epoch"]):
        raise SystemExit(f"phonon:{copy.tag}: mimi {release.get('mimi_sig')} is not the template's "
                         f"{want['mimi_sig']}, so its decoder cannot be reused")
    replaced = set()
    for init in template.graph.initializer:
        if init.name in ("emb_mean", "emb_std"):
            value = copy.tensors[FLOW + init.name].astype(np.float32)
            init.CopyFrom(numpy_helper.from_array(value.reshape(tuple(init.dims)), init.name))
            replaced.add(init.name)
    if replaced != {"emb_mean", "emb_std"}:
        raise SystemExit(f"the template's mimi decoder has {sorted(replaced)}, not emb_mean and emb_std")
    return template


# --- tokenizer and config -------------------------------------------------

CODEPOINT = re.compile(r"\\x\{([0-9A-Fa-f]+)\}")


def build_tokenizer(copy: OllamaCopy) -> dict:
    """tokenizer.json and tokenizer_config.json as Transformers.js reads them.

    The release's tokenizer.json lacks the text normalizer; its newer
    tokenizer.5.0.0.json has it, with code points written `\\x{1F000}`, which
    Rust's regex reads and JavaScript's does not, so they become the
    characters themselves."""
    def characters(value):
        if isinstance(value, str):
            return CODEPOINT.sub(lambda m: chr(int(m.group(1), 16)), value)
        if isinstance(value, list):
            return [characters(v) for v in value]
        if isinstance(value, dict):
            return {k: characters(v) for k, v in value.items()}
        return value

    tokenizer = json.loads(copy.files["tokenizer.json"])
    tokenizer["normalizer"] = characters(json.loads(copy.files["tokenizer.5.0.0.json"])["normalizer"])
    config = {"tokenizer_class": "PreTrainedTokenizerFast", "add_bos_token": False, "add_eos_token": False,
              "clean_up_tokenization_spaces": False}
    return {"tokenizer.json": json.dumps(tokenizer, ensure_ascii=False).encode(),
            "tokenizer_config.json": json.dumps(config, indent=2).encode()}


def build_config(copy: OllamaCopy, template: dict) -> dict:
    """The template's config with the copy's values: the release's own keys the
    template carries (the rest are Hugging Face's), and the template's
    `phonon` block, which the worker reads, sized to the copy."""
    import copy as copying

    release = json.loads(copy.files["config.json"])
    keys = [k for k in template if k not in ("phonon", "transformers.js_config")]
    missing = [k for k in keys if k not in release]
    if missing:
        raise SystemExit(f"phonon:{copy.tag}: config.json has no {missing}")
    config = {k: release[k] for k in keys}
    phonon = copying.deepcopy(template["phonon"])
    phonon["flow_lm"]["num_layers"] = release["flow_lm"]["num_layers"]
    phonon["source"] = {"ollama": f"phonon:{copy.tag}", "digest": copy.pin}
    phonon["variants"] = {"fp32": {"flow_lm": "flow_lm", "mimi_decoder": "mimi_decoder"}}
    config["phonon"] = phonon
    config["transformers.js_config"] = {"dtype": "fp32"}
    return config


# --- voices ----------------------------------------------------------------

def voice_files(lang: str, voices: dict, models: Path = OLLAMA_MODELS) -> dict:
    """`voices/<file>.bin` for each {file: voice} in `voices`, in the
    [1, voice_dim, frames] float32 layout the worker reads. "default" is
    `phonon:<lang>`'s own voice; any other name is read from the pinned
    catalogue in `phonon:40m-<lang>`."""
    for name in voices:
        if not VOICE_FILE.match(name):
            raise SystemExit(f"voice file name {name!r} is not a plain name")
    is_voice = lambda label: label.startswith("voices.")
    own = read_ollama(lang, PINS[lang], models, keep=lambda label: label == "voices.default").tensors
    catalogue = {}
    if any(voice != "default" for voice in voices.values()):
        catalogue = read_ollama(f"40m-{lang}", VOICE_PINS[lang], models, keep=is_voice).tensors
    files = {}
    for name, voice in voices.items():
        tensor = own.get("voices.default") if voice == "default" else catalogue.get(f"voices.{voice}")
        if tensor is None:
            raise SystemExit(f"phonon:{lang}: no voice {voice!r}"
                             f"{'' if voice == 'default' else f' in phonon:40m-{lang}'}")
        files[f"voices/{name}.bin"] = np.ascontiguousarray(tensor, np.float32).tobytes()
    return files


def voice_sources(lang: str, voices: dict) -> dict:
    """Where each {file: voice} came from, for the manifest. "default" is the
    model's own voice, so it carries the model's licence; a catalogue voice is
    phonon-voices, Apache 2.0."""
    own = {"repo": f"ollama:phonon:{lang}", "revision": PINS[lang], "licence": LICENCE}
    catalogue = {"repo": f"ollama:phonon:40m-{lang}", "revision": VOICE_PINS[lang], "licence": VOICES_LICENCE}
    return {name: {"voice": voice, **(own if voice == "default" else catalogue)} for name, voice in voices.items()}


# --- staging ---------------------------------------------------------------

def _english_export():
    """fetch-phonon.py, for the template's location and pins."""
    import importlib.util

    spec = importlib.util.spec_from_file_location("fetch_phonon", ROOT / "scripts" / "fetch-phonon.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _refuse_a_tracked_target(target: Path) -> None:
    """The weights are CC BY-NC and must never be committed: refuse a target
    any git checkout would track. A git-ignored stage inside one, as
    scripts/stage-local.sh's .stage/ is, is fine."""
    import subprocess

    existing = next(p for p in (target, *target.parents) if p.exists())
    git = lambda *args: subprocess.run(["git", "-C", str(existing), *args], capture_output=True, text=True,
                                       env={**os.environ, "LC_ALL": "C"})
    try:
        probe = git("rev-parse", "--is-inside-work-tree")
        if probe.returncode != 0 and "not a git repository" not in probe.stderr:
            raise SystemExit(f"{target}: git could not tell whether a checkout would commit the CC BY-NC "
                             f"weights there ({probe.stderr.strip()}); refusing")
        inside = probe.stdout.strip() == "true"
        # The folder itself, so every file staged in it is covered, not one name a pattern happens to match.
        ignored = inside and git("check-ignore", "-q", f"{target}/").returncode == 0
    except FileNotFoundError:   # no git: fall back to this repo alone
        inside, ignored = target == ROOT or ROOT in target.parents, False
    if inside and not ignored:
        raise SystemExit(f"{target}: git would commit the CC BY-NC weights there; "
                         "stage outside any checkout or into a git-ignored folder")


def stage(lang: str, target: Path, models: Path = OLLAMA_MODELS, voices: dict = None) -> dict:
    """Build `phonon:<lang>` into `target` for the worker, verify, write manifest.json.
    `voices` is {file: voice} as voice_files takes it: VOICES[lang], the menu's
    M1 and F1, unless a bench asks for others."""
    if lang not in PINS:
        raise SystemExit(f"no pinned Ollama copy for {lang!r}; LT-216 staged {sorted(PINS)}")
    target = Path(target).resolve()
    _refuse_a_tracked_target(target)
    voices = VOICES[lang] if voices is None else voices

    english = _english_export()
    template = english.CACHE
    for relative in ("config.json", "onnx/flow_lm.onnx", "onnx/mimi_decoder.onnx"):
        if not english._matches(template / relative, english.FILES[relative]):
            raise SystemExit(f"the English export's {relative} is missing or unpinned; run scripts/fetch-phonon.py")

    copy = read_ollama(lang, PINS[lang], models)
    import onnx
    template_config = json.loads((template / "config.json").read_bytes())
    files = {
        "config.json": json.dumps(build_config(copy, template_config), indent=2).encode(),
        **build_tokenizer(copy),
        "onnx/flow_lm.onnx": build_flow_lm(onnx.load(template / "onnx" / "flow_lm.onnx"), copy).SerializeToString(),
        "onnx/mimi_decoder.onnx": build_mimi_decoder(
            onnx.load(template / "onnx" / "mimi_decoder.onnx"), copy, template_config).SerializeToString(),
        **voice_files(lang, voices, models),
    }

    # Withdrawn first, as fetch-phonon.py does: until the new one is written the
    # target is plainly unstaged rather than an old manifest over new files.
    (target / "manifest.json").unlink(missing_ok=True)
    entries = []
    for relative, data in files.items():
        dest = target / relative
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
        digest = hashlib.sha256(data).hexdigest()
        if english.sha256_of(dest) != digest:
            raise SystemExit(f"staged {relative} does not read back as written")
        entries.append({"name": relative, "path": relative, "bytes": len(data), "sha256": digest})

    manifest = {
        "version": 1,
        "source": {"repo": f"ollama:phonon:{lang}", "revision": copy.pin, "licence": LICENCE},
        "voices": voice_sources(lang, voices),
        "files": entries,
    }
    (target / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: stage-phonon-lang.py <fr|de|es|pt> <_assets/tts/phonon-<lang> dir>")
    manifest = stage(sys.argv[1], Path(sys.argv[2]))
    total = sum(f["bytes"] for f in manifest["files"])
    print(f"  phonon-{sys.argv[1]}/manifest.json: {len(manifest['files'])} files, {total / 1_048_576:.1f} MB")


if __name__ == "__main__":
    main()
