#!/usr/bin/env python3
"""Fetch Phonon 31M and stage it for the reader's English voice (LT-214).

    python3 scripts/fetch-phonon.py <STAGE>/_assets/tts/phonon

Downloads the files `src/phonon.worker.mjs` loads from
onnx-community/phonon-31m-en-ONNX at one pinned revision, into a cache under
bench/assets/ (gitignored: the weights are never committed), checks each
against the size and sha256 pinned below, copies them to the target and writes
its `manifest.json` in the `{version, files:[{name,path,bytes,sha256}]}` shape
src/models.mjs reads, plus
the source block scripts/convert-mt-models.py adds.

Every pin is checked twice: on the cached copy, so a truncated or tampered
download is fetched again, and on the staged copy, because the manifest is a
claim about the bytes the mirror serves. A mismatch stops before any manifest
is written, so the reader is never pointed at bytes nobody checked.

The model (gradium/phonon-31m-en, exported by onnx-community) and both voices
are Apache 2.0. The voices are Preston (M1) and Hadley (F1), the same files as
gradium/phonon-voices at 0ee17205.

Standard library only, so staging needs nothing installed.
"""

import hashlib
import json
import shutil
import sys
import tempfile
import urllib.request
from pathlib import Path

REPO = "onnx-community/phonon-31m-en-ONNX"
REVISION = "4f0cda7c60dddb4862d0e68ff9ff60c32ffdc9f4"
LICENCE = "apache-2.0"

# path -> (bytes, sha256), read from the Hub's file list at REVISION.
# wasm fp32 is the one build, so the q4 and fp16 graphs are not here.
FILES = {
    "config.json": (4952, "1c942e652a16d0ff56fb492a248d14d1b603e66427525f085ccb0def71187852"),
    "tokenizer.json": (303009, "401de2690406fccc33f139921ba2d4fc22784b5c32f52c7b6db33ff0f635bf4a"),
    "tokenizer_config.json": (144, "11797d02983710748a33d848ad0af623843969dcb005670093f43fec0717cfd4"),
    "onnx/flow_lm.onnx": (120089751, "27f933db151b81d30606b27f9a490dc9d73d93a4ee302c4f5ac29401fa858974"),
    "onnx/mimi_decoder.onnx": (41267821, "842ba85dc849f9ed19d2a34dfaed2985fde729de75c7647f6033707454ec1d3d"),
    # M1, Preston
    "voices/qIxlZ7Ei8KvWlyQH.bin": (256000, "1b81d1228569972a7abeb81a854d34f18f37c1f6f7243a02b31c184308ebbae7"),
    # F1, Hadley
    "voices/bXwrkHhURL1VFJdG.bin": (256000, "6c0812d2a2da1659202b46b8e08c68708a6ba30cf684ffc05737a1e7eda01383"),
}

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "bench" / "assets" / "phonon-31m-en" / REVISION


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _matches(path: Path, pin) -> bool:
    size, digest = pin
    return path.is_file() and path.stat().st_size == size and sha256_of(path) == digest


def _download(relative: str, dest: Path) -> None:
    url = f"https://huggingface.co/{REPO}/resolve/{REVISION}/{relative}"
    with urllib.request.urlopen(url) as response, dest.open("wb") as out:
        shutil.copyfileobj(response, out, 1024 * 1024)


def fetch(cache: Path = CACHE, files=FILES) -> None:
    """Make `cache` hold every pinned file, downloading only what is missing or wrong."""
    for relative, pin in files.items():
        dest = cache / relative
        if _matches(dest, pin):
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        # Into a temporary file first, so an interrupted download never sits in
        # the cache under the real name.
        with tempfile.NamedTemporaryFile(dir=dest.parent, delete=False) as handle:
            partial = Path(handle.name)
        try:
            print(f"  fetching {relative} ({pin[0] / 1_048_576:.1f} MB)")
            _download(relative, partial)
            if not _matches(partial, pin):
                raise SystemExit(f"{relative} from {REPO}@{REVISION[:8]} does not match its pin")
            partial.replace(dest)
        finally:
            partial.unlink(missing_ok=True)


def stage(cache: Path, target: Path, files=FILES) -> dict:
    """Copy the pinned files from `cache` to `target`, verify, write manifest.json."""
    # Withdrawn first: from here until the new one is written, the target is
    # plainly unstaged rather than an old manifest over half-replaced files.
    (target / "manifest.json").unlink(missing_ok=True)
    entries = []
    for relative, pin in files.items():
        dest = target / relative
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(cache / relative, dest)
        if not _matches(dest, pin):
            raise SystemExit(f"staged {relative} does not match its pin")
        # name == path: the worker reads buffers as `voices/<id>.bin`.
        entries.append({"name": relative, "path": relative, "bytes": pin[0], "sha256": pin[1]})

    manifest = {
        "version": 1,
        "source": {"repo": REPO, "revision": REVISION, "licence": LICENCE},
        "files": entries,
    }
    (target / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: fetch-phonon.py <_assets/tts/phonon dir>")
    target = Path(sys.argv[1])
    fetch()
    manifest = stage(CACHE, target)
    total = sum(f["bytes"] for f in manifest["files"])
    print(f"  manifest.json: {len(manifest['files'])} files, {total / 1_048_576:.1f} MB")


if __name__ == "__main__":
    main()
