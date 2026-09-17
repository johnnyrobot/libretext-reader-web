#!/usr/bin/env python3
"""Write `manifest.json` describing every model file the engine loads.

Shape is deliberately the same as the desktop LibreTexts Reader's
`SupertonicModelFile` in `src-tauri/src/tts/supertonic/model.rs`, so both
readers describe model integrity identically.

The `name` keys are a contract with `loadTextToSpeechFromBuffers` in
`src/vendor/helper.js`: it looks the buffers up by these exact names.
"""

import hashlib
import json
import sys
from pathlib import Path

# name -> path relative to the /_assets/tts/ root.
FILES = [
    ("ttsJson", "onnx/tts.json"),
    ("unicodeIndexer", "onnx/unicode_indexer.json"),
    ("durationPredictor", "onnx/duration_predictor.onnx"),
    ("textEncoder", "onnx/text_encoder.onnx"),
    ("vectorEstimator", "onnx/vector_estimator.onnx"),
    ("vocoder", "onnx/vocoder.onnx"),
]


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def build(root: Path) -> dict:
    files = []
    for name, relative in FILES:
        path = root / relative
        if not path.is_file():
            raise SystemExit(f"missing model file: {path}")
        files.append({
            "name": name,
            "path": relative,
            "bytes": path.stat().st_size,
            "sha256": sha256_of(path),
        })
    return {"version": 1, "files": files}


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: write_model_manifest.py <_assets/tts dir>")
    root = Path(sys.argv[1])
    manifest = build(root)
    (root / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    total = sum(f["bytes"] for f in manifest["files"])
    print(f"manifest.json: {len(manifest['files'])} files, {total / 1_048_576:.1f} MB")


if __name__ == "__main__":
    main()
