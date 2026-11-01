"""THROWAWAY SPIKE (LT-213). Serve the repo root, cross-origin isolated, for path A.

    python3 bench/phonon/serve.py [--port 8789]

Path A's page (bench/phonon/path-a/) loads Transformers.js from node_modules and
the Phonon graphs from bench/assets/phonon/, so it needs the repo root, not
.stage. Every response carries COOP/COEP/CORP, so the page and its worker are
both isolated and ONNX Runtime can use threads. Local only: binds 127.0.0.1.
"""

import argparse
import functools
import http.server
import mimetypes
import pathlib
import socketserver

ROOT = pathlib.Path(__file__).resolve().parents[2]
mimetypes.add_type("application/wasm", ".wasm")
mimetypes.add_type("text/javascript", ".mjs")


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        if " 200 " not in (fmt % args):
            super().log_message(fmt, *args)


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8789)
    a = ap.parse_args()
    with Server(("127.0.0.1", a.port), functools.partial(Handler, directory=str(ROOT))) as httpd:
        print(f"serving {ROOT} on http://127.0.0.1:{a.port} (cross-origin isolated)")
        httpd.serve_forever()


if __name__ == "__main__":
    main()
