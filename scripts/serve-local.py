#!/usr/bin/env python3
"""Serve the staged mirror copy with the headers the live mirror will send.

Three of these matter and none is cosmetic:

* **COOP/COEP** give cross-origin isolation, which gives SharedArrayBuffer,
  which gives multi-threaded wasm. Measured: RTF 0.410 isolated against 0.912
  without, against a 0.500 gate. Without these headers playback stalls.
* **`application/wasm`** -- Python's http.server does not know the type, and
  ONNX Runtime refuses to stream-compile anything else.
* **immutable on /_assets/tts/** mirrors the Caddy exemption, so a reload does
  not re-fetch 380 MB.

Usage: scripts/serve-local.py [--root DIR] [--port 8788]
"""

import argparse
import functools
import http.server
import mimetypes
import socketserver

mimetypes.add_type("application/wasm", ".wasm")
mimetypes.add_type("text/javascript", ".mjs")
mimetypes.add_type("application/json", ".json")


# THE PRODUCTION CSP, COPIED VERBATIM FROM THE LIVE RESPONSE.
#
# Its absence cost a shipped feature. The Enter Reader Mode button was resized with
# an inline `style="font-size:16.25px"` attribute; it deployed, the attribute was
# present in the served HTML, and every check passed -- while the live browser
# computed 13px and dropped the declaration, because style-src has no
# 'unsafe-inline'. Verified on the live page: attribute present, computed 13px.
#
# Nothing local could have caught it: the staged server sent no CSP at all, so a
# CSP violation was not merely unasserted, it was impossible to observe. That is the same trap the COOP/COEP note
# above describes, one header over. An inline script blocked by CSP executes
# nothing and errors nowhere, and an inline style is silently dropped.
#
# Site-wide on live, assets included, so it goes on every response here too.
# Update it by re-reading the live header, never by editing it to suit a change:
#   curl -sI <a live page> | grep -i '^content-security-policy:'
CSP = (
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' blob:; worker-src 'self' blob:; style-src 'self' 'sha256-JLEjeN9e5dGsz5475WyRaoA4eQOdNPxDIeUhclnJDCE=' 'sha256-mQyxHEuwZJqpxCw3SLmc4YOySNKXunyu2Oiz1r3/wAE=' 'sha256-OCf+kv5Asiwp++8PIevKBYSgnNLNUZvxAp4a7wMLuKA=' 'sha256-F45W+FYhxQi15MwvhXo/6rIZCahnsqBMUKQ/XGr1fwk='; img-src 'self'; font-src 'self'; media-src 'self'; connect-src 'self'; frame-src https://adapt.libretexts.dev; object-src 'none'; base-uri 'self'; form-action 'self'"
)


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Header scoping matches the live Caddyfile exactly. This used to send
        # COOP/COEP on every path, which is MORE uniform than production and hid
        # a real deploy failure: a dedicated worker created from an isolated
        # document must itself carry COEP, and in production the isolation
        # headers are scoped to the book while the worker lives under
        # /_assets/tts/. A local harness more permissive than the real server is
        # worse than no harness for exactly this class of bug.
        if self.path.startswith("/_assets/tts/"):
            self.send_header("Cache-Control", "public, max-age=31536000, immutable")
            self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
            self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        else:
            self.send_header("Cache-Control", "no-store")
            # Same scope as live (2026-09-13): the three reader books, minus the one
            # page that embeds ADAPT iframes -- COEP blocks any cross-origin frame
            # that does not itself send COEP, so that page stays un-isolated.
            if (self.path.startswith(("/social_psychology/", "/math_elem_teachers/", "/chem_4b/", "/human_relations/"))
                    and not self.path.startswith("/chem_4b/AGENDA1/")):
                self.send_header("Cross-Origin-Opener-Policy", "same-origin")
                self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Content-Security-Policy", CSP)
        super().end_headers()

    def log_message(self, fmt, *args):  # quieter than the default
        if "GET" in (fmt % args) and " 200 " not in (fmt % args):
            super().log_message(fmt, *args)


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default=".stage")
    parser.add_argument("--port", type=int, default=8788)
    args = parser.parse_args()

    handler = functools.partial(Handler, directory=args.root)
    with Server(("127.0.0.1", args.port), handler) as httpd:
        print(f"serving {args.root} on http://127.0.0.1:{args.port} (cross-origin isolated)")
        httpd.serve_forever()


if __name__ == "__main__":
    main()
