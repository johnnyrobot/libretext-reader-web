"""scripts/serve-local.py caches what the live Caddyfile caches (README, step 4)."""

import functools
import importlib.util
import threading
import urllib.request
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("serve_local", ROOT / "scripts" / "serve-local.py")
serve_local = importlib.util.module_from_spec(spec)
spec.loader.exec_module(serve_local)


@pytest.fixture
def base(tmp_path):
    for path in ["_assets/tts/reader.js", "_assets/tts/phonon/manifest.json", "_assets/tts/phonon/onnx/flow_lm.onnx",
                 "_assets/tts/phonon/voices/qIxlZ7Ei8KvWlyQH.bin", "_assets/tts/phonon-fr/manifest.json",
                 "_assets/tts/phonon-fr/tokenizer.json", "_assets/tts/phonon-fr/onnx/flow_lm.onnx",
                 "_assets/tts/phonon-fr/voices/F1.bin", "_assets/tts/mt/pairs.json"]:
        (tmp_path / path).parent.mkdir(parents=True, exist_ok=True)
        (tmp_path / path).write_text("x")
    handler = functools.partial(serve_local.Handler, directory=str(tmp_path))
    server = serve_local.Server(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_address[1]}"
    server.shutdown()
    server.server_close()


def cache_control(url):
    with urllib.request.urlopen(url) as res:
        return res.headers["Cache-Control"]


@pytest.mark.parametrize("path", ["phonon/onnx/flow_lm.onnx", "phonon/voices/qIxlZ7Ei8KvWlyQH.bin",
                                  "phonon-fr/onnx/flow_lm.onnx", "phonon-fr/voices/F1.bin"])
def test_weights_and_voices_are_immutable(base, path):
    assert cache_control(f"{base}/_assets/tts/{path}") == "public, max-age=31536000, immutable"


# A manifest cached as immutable outlives a restage: a browser that opened a
# stage from before LT-222 kept its default-only manifest and could not find M1.
@pytest.mark.parametrize("path", ["reader.js", "phonon/manifest.json", "phonon-fr/manifest.json",
                                  "phonon-fr/tokenizer.json", "mt/pairs.json"])
def test_code_and_manifests_revalidate(base, path):
    assert cache_control(f"{base}/_assets/tts/{path}") == "public, max-age=0, must-revalidate"
