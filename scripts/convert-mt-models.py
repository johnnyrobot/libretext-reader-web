#!/usr/bin/env python3
"""Stage a pre-converted Opus-MT ONNX pair so the browser loads it from the
mirror instead of the Hugging Face CDN.

Named "convert" to match its sibling scripts/convert-models.py, but nothing is
converted here: Xenova (and, for Portuguese, one pinned third-party export)
publishes the ONNX exports transformers.js expects, and
re-exporting them locally would only risk producing something subtly different
from what the runtime is tested against. This script fetches, licence-checks,
pins, verifies and stages them.

Two reasons the browser must not fetch these from the CDN directly:
  * the mirror's pages set a CSP that blocks the cross-origin request outright;
  * a CDN fetch tells a third party which book a reader just opened.

Output is `<out>/<pair>/manifest.json` in exactly the shape the Phonon manifest
uses -- `{version, files:[{name,path,bytes,sha256}]}` -- because src/models.mjs already reads that shape, verifies sha256
before use, streams progress, and re-downloads a truncated file. The extra
provenance keys alongside it are ignored by that reader.
"""

import argparse
import hashlib
import json
import shutil
from dataclasses import dataclass, field
from pathlib import Path

# Same list, same reasoning, as scripts/convert-models.py: this project picked
# Opus-MT over NLLB because NLLB's output is cc-by-nc-4.0 and cannot ship inside
# an MIT product. A checkpoint retagged non-permissive must stop the run, not be
# recorded accurately and shipped anyway.
ACCEPTABLE_LICENCES = {"apache-2.0", "cc-by-4.0", "mit"}


@dataclass(frozen=True)
class Pair:
    repo: str  # the ONNX export transformers.js loads
    base: str  # the PyTorch checkpoint it was quantized from
    # FILES keys this export does not publish. Named per pair, never skipped on a
    # failed download, so a file missing from any other export still stops the run.
    absent: frozenset[str] = frozenset()
    # A commit to stage from, and the sha256 of every file staged from it. Set for
    # an export nobody on this project vouches for: a third party can rewrite its
    # repo, and the mirror serves whatever bytes this run copies. Left unset, the
    # run takes the repo's current commit and records it.
    revision: str | None = None
    sha256: dict[str, str] = field(default_factory=dict)


PAIRS = {
    "en-es": Pair(repo="Xenova/opus-mt-en-es", base="Helsinki-NLP/opus-mt-en-es"),
    # Second pair, 2026-08-25 (design §12 open decision 1). French rather than
    # any of the other 27 because it is the other language with a demo book
    # behind it, and because it shares the Romance plain-cardinal year reading
    # that pipeline/lang_normalize.py's Spanish pass already established.
    #
    # Note what is NOT here: opus-mt-tc-big-en-fr exists and is the better
    # checkpoint, but Xenova has no ONNX export of it, exactly as with Spanish.
    # The browser gets the smaller model or nothing.
    "en-fr": Pair(repo="Xenova/opus-mt-en-fr", base="Helsinki-NLP/opus-mt-en-fr"),
    # Eighth pair, 2026-08-27, and the best numbers of any language screened for
    # this project: 1.27% (6 of 472), prose 0.21%, median 0.8090 on the
    # post-splitter corpus. The prose rate ties Swedish's for the lowest ever
    # measured here, and German is the largest audience among everything that
    # remains reachable.
    #
    # No checkpoint gap: pipeline/languages.py registers opus-mt-en-de, which IS
    # the checkpoint this export was quantized from -- so the gate ran the model
    # the browser runs. That gap is what put Finnish (2.12% on the small export)
    # and Romanian (2.54%) out, and it was checked here rather than assumed.
    #
    # The four candidates screened alongside it all failed decisively and are
    # recorded so nobody re-runs them: id 2.75%, ru 3.39%, ar 5.72%, uk 7.63%.
    "en-de": Pair(repo="Xenova/opus-mt-en-de", base="Helsinki-NLP/opus-mt-en-de"),
    # Fourth pair, LT-217 (2026-11-01). Portuguese is the one language here not
    # exported by Xenova: Douglasrambo/opus-mt-tc-big-en-pt-onnx is a third-party
    # export, pinned by revision and hash like the rest, of the cc-by-4.0
    # Helsinki-NLP checkpoint. No checkpoint gap: pipeline/languages.py registers
    # opus-mt-tc-big-en-pt, which IS this export's base. Xenova/opus-mt-en-ROMANCE
    # was measured first and returned garbage.
    #
    # Measured on 146 corpus sentences: batched with padding it generates past the
    # sentence (21 lines ended in "))))))" or "......"); one sentence at a time it
    # produced none, so src/translate.worker.mjs never batches pt. No ">>pob<<" or
    # ">>por<<" target prefix, matching the pipeline: all three runs read as
    # Brazilian Portuguese, and the Speech Text corpus was built from this one.
    #
    # It publishes no vocab.json. Nothing reads one: transformers.js builds the
    # Marian tokenizer from tokenizer.json, and the Node runs above loaded it so.
    #
    # Pinned 2026-11-01. The ONNX hashes are the Hub's LFS oids at that commit; the
    # four JSON files were downloaded from it and hashed.
    "en-pt": Pair(repo="Douglasrambo/opus-mt-tc-big-en-pt-onnx",
                  base="Helsinki-NLP/opus-mt-tc-big-en-pt",
                  absent=frozenset({"vocab"}),
                  revision="738ee4cce801ce7c519954e4b78d02d5057b6740",
                  sha256={
                      "encoder": "66329e9fdb0f8a112ebfd4e0eee4304296d5e7891dd34438c312452dcb14a8e9",
                      "decoder": "8bf7b7a36556e60ef53ed17b11573f63235e04a80cb36a8ca6c7312925185ca9",
                      "tokenizer": "47fbbc561252cfa491200d63c91bdda8a1ceeb653da63d8845ef827bf24acdfb",
                      "config": "7a133252d86d032f8ecea9b74a0145cecf0d13374db5e4bc602ba52c92153d37",
                      "generationConfig": "f743934c15ef22a0971f88abd75d2471fadc1888b89837be5adc5f71d86d0d5b",
                      "tokenizerConfig": "5a5b40b768575d7c8b13e6f45413b248a22a5d7669d2feec7b9a6d6921ef1871",
                  }),
}

# name -> path within the repo, kept as the path inside the staged pair too.
#
# The `name` keys are the contract with whatever loads the buffers back out of
# src/models.mjs, exactly as scripts/fetch-phonon.py's names are the contract
# with src/phonon.worker.mjs. The repo-relative layout is preserved rather than
# flattened so a transformers.js-style path loader can be pointed at the staged
# directory later without restaging anything.
FILES = [
    ("encoder", "onnx/encoder_model_quantized.onnx"),
    ("decoder", "onnx/decoder_model_merged_quantized.onnx"),
    ("tokenizer", "tokenizer.json"),
    ("vocab", "vocab.json"),
    # ~2 KB between them, and transformers.js reads all three before it will
    # build the pipeline: config.json decides the architecture, generation_config
    # the decoding defaults (num_beams, max_length, the forced BOS/EOS ids), and
    # tokenizer_config which tokenizer class to instantiate. Staging them is what
    # keeps env.allowRemoteModels = false honest -- without them the worker falls
    # through to the CDN for files the CSP will block anyway.
    ("config", "config.json"),
    ("generationConfig", "generation_config.json"),
    ("tokenizerConfig", "tokenizer_config.json"),
]


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _licence_tag(info) -> str | None:
    return next((t.split(":", 1)[1] for t in info.tags if t.startswith("license:")), None)


def _require_acceptable(repo: str, licence: str, source: str) -> None:
    if licence not in ACCEPTABLE_LICENCES:
        raise RuntimeError(
            f"{repo!r} resolves to licence {licence!r} (via {source}), which is "
            f"not in ACCEPTABLE_LICENCES ({sorted(ACCEPTABLE_LICENCES)}) -- this "
            "project's model choice was made on licence grounds; a human needs to "
            "decide whether this checkpoint's output may ship inside an MIT product"
        )


def licence_and_revision(pair: Pair) -> tuple[str, str, str, str]:
    """Return (licence, licence_source, base_licence, revision) for `pair`, or raise.

    The Xenova repos carry no `license:` tag of their own -- they are quantized
    re-exports and declare `base_model:` instead. Resolving the licence through
    that declaration is correct, but writing the result as though the ONNX repo
    had claimed it is not, so the source repo is returned alongside and recorded
    in the manifest. An export that does tag itself is checked on that tag, and
    its base is checked as well: a re-export's own tag cannot relicense weights
    it was quantized from.

    Raises rather than defaulting: see ACCEPTABLE_LICENCES above.
    """
    from huggingface_hub import model_info

    info = model_info(pair.repo, revision=pair.revision)
    if pair.revision is not None and info.sha != pair.revision:
        raise RuntimeError(
            f"{pair.repo!r} resolved revision {pair.revision} to {info.sha} -- "
            "refusing to stage from a commit other than the pinned one"
        )
    base_licence = _licence_tag(model_info(pair.base))
    licence = _licence_tag(info)
    source = pair.repo

    if licence is None:
        declared = {t.split(":", 1)[1] for t in info.tags if t.startswith("base_model:")}
        if pair.base not in declared:
            raise RuntimeError(
                f"{pair.repo!r} has no license: tag and does not declare "
                f"base_model:{pair.base} (declares {sorted(declared) or 'nothing'}) -- "
                "refusing to inherit a licence from a checkpoint the repo does not "
                "claim to derive from"
            )
        licence = base_licence
        source = pair.base
    if base_licence is None:
        raise RuntimeError(
            f"{pair.base!r}, the base of {pair.repo!r}, carries no license: tag; "
            'refusing to write "unknown" -- fix the tag lookup or the checkpoint '
            "before staging it"
        )

    _require_acceptable(pair.repo, licence, source)
    _require_acceptable(pair.repo, base_licence, pair.base)
    return licence, source, base_licence, info.sha


def stage(name: str, pair: Pair, out_root: Path) -> Path:
    from huggingface_hub import hf_hub_download

    licence, licence_source, base_licence, revision = licence_and_revision(pair)
    print(f"==> {name}: {pair.repo}@{revision[:12]} ({licence}, via {licence_source})")

    target = out_root / name
    target.mkdir(parents=True, exist_ok=True)

    files = []
    for key, relative in FILES:
        if key in pair.absent:
            continue
        # Pinned to the revision the licence was checked against, so a repo that
        # moves under us produces a different manifest rather than files whose
        # provenance line no longer describes them.
        cached = Path(hf_hub_download(pair.repo, relative, revision=revision))
        dest = target / relative
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(cached, dest)

        # Hash the STAGED copy, not the Hub cache entry: the manifest is a claim
        # about the bytes the mirror will serve, and a short copy must fail here
        # rather than in a reader's browser.
        digest = sha256_of(dest)
        size = dest.stat().st_size
        print(f"    {key:<16} {relative:<42} {size / 1_048_576:6.1f} MB  {digest[:12]}")
        pinned = pair.sha256.get(key)
        if pair.sha256 and digest != pinned:
            dest.unlink()
            raise RuntimeError(
                f"{pair.repo}@{revision[:12]} {relative}: sha256 {digest} does not "
                f"match the pinned {pinned} -- the export changed under its pin, or "
                "the pin is wrong; staging nothing the mirror would serve unchecked"
            )
        files.append({"name": key, "path": relative, "bytes": size, "sha256": digest})

    manifest = {
        "version": 1,
        "pair": name,
        "source": {
            "repo": pair.repo,
            "revision": revision,
            "licence": licence,
            "licence_source": licence_source,
            "base": pair.base,
            "base_licence": base_licence,
        },
        "files": files,
    }
    (target / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    total = sum(f["bytes"] for f in files)
    print(f"    manifest.json: {len(files)} files, {total / 1_048_576:.1f} MB")
    return target


def write_pairs_index(out_root: Path) -> Path:
    """List every staged pair, for the reader's language menu.

    Built by SCANNING the output directory rather than from the pairs this run
    happened to stage, so a run that adds `en-fr` cannot drop `en-es` from the
    menu -- the same merge-don't-overwrite hazard scripts/convert-models.py
    handles for its attribution file.

    `bytes` is here because the consent gate needs a size before it downloads
    anything, and the alternative is fetching every pair's manifest just to add
    up numbers the reader may never accept.
    """
    pairs = []
    for manifest_path in sorted(out_root.glob("*/manifest.json")):
        manifest = json.loads(manifest_path.read_text())
        name = manifest_path.parent.name
        pairs.append({
            "code": name.split("-", 1)[1],   # en-es -> es, the reader's language code
            "pair": name,
            "bytes": sum(f["bytes"] for f in manifest["files"]),
            "licence": manifest["source"]["licence"],
        })

    index = out_root / "pairs.json"
    index.write_text(json.dumps({"version": 1, "pairs": pairs}, indent=2), encoding="utf-8")
    print(f"\npairs.json: {', '.join(p['pair'] for p in pairs) or '(none)'}")
    return index


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    # Defaults to EVERY registered pair, so PAIRS above is the single answer to
    # "which pairs ship" (design §12 open decision 1). It used to default to
    # en-es, which meant registering a pair and running the script staged
    # nothing new and said nothing about it -- the failure mode where the deploy
    # looks done and the menu never changes.
    parser.add_argument("--pairs", default=",".join(sorted(PAIRS)),
                        help="comma-separated pairs to stage (default: every "
                             f"registered pair -- {', '.join(sorted(PAIRS))})")
    parser.add_argument("--out", type=Path, default=Path("bench/assets/mt"),
                        help="directory to stage into (default: bench/assets/mt)")
    args = parser.parse_args()

    names = [p.strip() for p in args.pairs.split(",") if p.strip()]
    unknown = sorted(set(names) - set(PAIRS))
    if unknown:
        parser.error(f"unknown pairs: {', '.join(unknown)}")

    for name in names:
        stage(name, PAIRS[name], args.out)
    write_pairs_index(args.out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
