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


def test_discussion_proxy_preserves_origin_cookie_body_and_denials(tmp_path):
    import http.server
    import json
    import urllib.error
    seen = []
    class Backend(http.server.BaseHTTPRequestHandler):
        def do_POST(self):
            seen.append((self.path, self.headers.get('Origin'), self.headers.get('Cookie'),
                         self.rfile.read(int(self.headers.get('Content-Length', 0))).decode()))
            self.send_response(403)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Set-Cookie', 'sr_reader_session=; Max-Age=0; HttpOnly; SameSite=Strict')
            self.end_headers()
            self.wfile.write(b'{"error":"denied"}')
        def log_message(self, *args):
            pass
    backend = serve_local.Server(('127.0.0.1', 0), Backend)
    proxy = serve_local.Server(('127.0.0.1', 0), functools.partial(
        serve_local.Handler, directory=str(tmp_path), api_port=backend.server_address[1]))
    for server in (backend, proxy):
        threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        req = urllib.request.Request(f'http://127.0.0.1:{proxy.server_address[1]}/social-reading/api/commands',
            data=b'{"key":"original"}', headers={'Origin':'http://127.0.0.1:8788',
            'Cookie':'sr_reader_session=test', 'Content-Type':'application/json'})
        with pytest.raises(urllib.error.HTTPError) as error:
            urllib.request.urlopen(req)
        response = error.value
        assert response.code == 403
        assert json.loads(response.read()) == {'error':'denied'}
        assert response.headers['Cache-Control'] == 'no-store'
        assert 'HttpOnly' in response.headers['Set-Cookie']
        assert seen == [('/social-reading/api/commands', 'http://127.0.0.1:8788',
                         'sr_reader_session=test', '{"key":"original"}')]
    finally:
        for server in (proxy, backend):
            server.shutdown()
            server.server_close()
