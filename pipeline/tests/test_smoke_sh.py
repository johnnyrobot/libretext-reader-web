"""scripts/smoke.sh goes red on what it claims to check (LT-231).

It runs against a copy of the mirror served with the live site's headers
(scripts/serve-local.py's), which Caddy sends on a 404 as well: so a check that
looks only at a header passes on a file that is not there. Each test breaks one
thing and expects smoke.sh to name it.
"""

import functools
import importlib.util
import json
import os
import re
import shutil
import subprocess
import threading
from pathlib import Path
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("serve_local_for_smoke", ROOT / "scripts" / "serve-local.py")
serve_local = importlib.util.module_from_spec(spec)
spec.loader.exec_module(serve_local)

PAGE = "/social_psychology/1%3A_Introducing_Social_Psychology/1.01%3A_Defining_Social_Psychology/"
PAGE_DIR = "social_psychology/1:_Introducing_Social_Psychology/1.01:_Defining_Social_Psychology"
BOOKS = ("/social_psychology/", "/math_elem_teachers/", "/chem_4b/", "/human_relations/")
# The live site's CSP outside the books (checked 2026-11-02): no wasm, no blob.
STRICT_CSP = serve_local.CSP.replace("script-src 'self' 'wasm-unsafe-eval' blob:; worker-src 'self' blob:;",
                                     "script-src 'self';")
VOICES = ("phonon", "phonon-fr", "phonon-de", "phonon-es", "phonon-pt")


def speech_json(break_offsets=False):
    """A page's speech.json, in raw UTF-8 as the rebuilt ones are (dashes, accents)."""
    text = "Social psychology — la psychologie sociale — is the study of how we think. " * 12
    sentences, offset = [], 0
    for i in range(12):
        display = "Social psychology — la psychologie sociale — is the study of how we think."
        sentences.append({"id": f"b0s{i}", "offset": offset + (1 if break_offsets and i == 3 else 0),
                          "length": len(display), "display": display})
        offset += len(display) + 1
    # Indented, as the pipeline writes it: Python 3.9 rejects raw UTF-8 past line 1
    # of a program it reads from stdin, which is how the old check 2 failed live.
    return json.dumps({"version": 1, "lang": "en", "blocks": [{"id": "b0", "kind": "p", "text": text,
                                                             "sentences": sentences}],
                       "stats": {"sentences": 12}}, ensure_ascii=False, indent=2)


def manifest(name):
    voices = ["voices/qIxlZ7Ei8KvWlyQH.bin", "voices/bXwrkHhURL1VFJdG.bin"] if name == "phonon" \
        else ["voices/M1.bin", "voices/F1.bin"]
    paths = ["config.json", "tokenizer.json", "onnx/flow_lm.onnx", "onnx/mimi_decoder.onnx", *voices]
    return {"version": 1, "files": [{"name": p, "path": p, "bytes": 1, "sha256": "0" * 64} for p in paths]}


@pytest.fixture
def mirror(tmp_path):
    """A mirror copy that passes every check, and a server for it. Tests break it."""
    files = {
        "index.html": "<html><body>LibreTexts mirror</body></html>",
        "chem101/index.html": "<html><body>General Chemistry</body></html>",
        f"{PAGE_DIR}/index.html": '<button id="tts-enter">Enter Reader Mode</button>'
                                  '<script type="module" src="/_assets/tts/boot.js"></script>',
        f"{PAGE_DIR}/speech.json": speech_json(),
        "_assets/tts/boot.js": "x", "_assets/tts/reader.js": "x", "_assets/tts/phonon.worker.js": "x",
    }
    for name in VOICES:
        files[f"_assets/tts/{name}/manifest.json"] = json.dumps(manifest(name))
        for f in manifest(name)["files"]:
            files[f"_assets/tts/{name}/{f['path']}"] = "x"
    for path, body in files.items():
        (tmp_path / path).parent.mkdir(parents=True, exist_ok=True)
        (tmp_path / path).write_text(body, encoding="utf-8")

    immutable = set()   # paths a test wants cached for a year, wrongly

    class Live(serve_local.Handler):
        def send_header(self, keyword, value):
            if keyword == "Content-Security-Policy" and not self.path.startswith(("/_assets/tts/", *BOOKS)):
                value = STRICT_CSP
            if keyword == "Cache-Control" and self.path in immutable:
                value = "public, max-age=31536000, immutable"
            super().send_header(keyword, value)

        def log_message(self, fmt, *args):
            pass

    server = serve_local.Server(("127.0.0.1", 0), functools.partial(Live, directory=str(tmp_path)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield SimpleNamespace(root=tmp_path, immutable=immutable, base=f"http://127.0.0.1:{server.server_address[1]}")
    server.shutdown()
    server.server_close()


def smoke(mirror, **extra):
    env = {**os.environ, "SMOKE_BASE": mirror.base, "SMOKE_PAGE": PAGE, "SMOKE_OUT_OF_SCOPE": "/chem101/", **extra}
    run = subprocess.run(["bash", str(ROOT / "scripts" / "smoke.sh")], env=env, capture_output=True,
                         text=True, timeout=120)
    return run.returncode, run.stdout + run.stderr


def failed(output):
    """The checks smoke.sh reports as FAIL, by name."""
    return [m.group(1) for m in re.finditer(r"^  (.+?)\s+FAIL  ", output, re.M)]


def test_a_good_mirror_passes(mirror):
    code, out = smoke(mirror)
    assert code == 0, out
    assert "SMOKE_OK" in out
    assert failed(out) == []


# The translations stay off a public host until Gradium confirms the use (README),
# so a host that serves English only says so, and stays green.
def test_a_host_that_serves_english_only_passes_when_it_says_so(mirror):
    for name in VOICES[1:]:
        shutil.rmtree(mirror.root / "_assets/tts" / name)
    code, out = smoke(mirror, SMOKE_VOICES="phonon")
    assert code == 0, out
    assert failed(out) == []
    code, out = smoke(mirror)
    assert code == 1, out
    assert "phonon-fr: its models and voices are served, immutable" in failed(out)


def test_a_speech_json_whose_offsets_do_not_round_trip_fails(mirror):
    (mirror.root / PAGE_DIR / "speech.json").write_text(speech_json(break_offsets=True), encoding="utf-8")
    code, out = smoke(mirror)
    assert code == 1, out
    assert failed(out) == ["speech.json parses and its offsets round-trip"]
    assert "1 offsets do not round-trip" in out


# Caddy sends COEP and the cache header on a 404 too, so a header alone proves
# nothing: the old checks stayed green on the retired Supertonic worker.
def test_a_404_worker_fails(mirror):
    (mirror.root / "_assets/tts/phonon.worker.js").unlink()
    code, out = smoke(mirror)
    assert code == 1, out
    assert "the worker carries its own COEP" in failed(out)


@pytest.mark.parametrize("missing", ["phonon/onnx/mimi_decoder.onnx", "phonon-de/onnx/flow_lm.onnx",
                                     "phonon-pt/voices/F1.bin", "phonon-fr/manifest.json"])
def test_a_404_model_voice_or_manifest_fails(mirror, missing):
    (mirror.root / "_assets/tts" / missing).unlink()
    code, out = smoke(mirror)
    assert code == 1, out
    lang_dir = missing.split("/")[0]
    expected = [f"{lang_dir}: its models and voices are served, immutable"]
    if missing.endswith("manifest.json"):   # nor can it be shown to revalidate
        expected.append("the code and the manifests revalidate")
    assert failed(out) == expected


def test_a_manifest_that_is_not_json_says_so(mirror):
    (mirror.root / "_assets/tts/phonon-es/manifest.json").write_text("<html>Not found</html>", encoding="utf-8")
    code, out = smoke(mirror)
    assert code == 1, out
    assert failed(out) == ["phonon-es: its models and voices are served, immutable"]
    assert "manifest.json is not a manifest (JSONDecodeError" in out
    assert "Traceback" not in out


# A manifest cached for a year outlives a restage (LT-222); an immutable reader.js
# kept two fixes from reaching a reader (2026-08-23).
@pytest.mark.parametrize("path", ["/_assets/tts/reader.js", "/_assets/tts/phonon.worker.js",
                                  "/_assets/tts/phonon/manifest.json", "/_assets/tts/phonon-es/manifest.json"])
def test_code_or_a_manifest_cached_for_a_year_fails(mirror, path):
    mirror.immutable.add(path)
    code, out = smoke(mirror)
    assert code == 1, out
    assert failed(out) == ["the code and the manifests revalidate"]
