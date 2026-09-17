#!/usr/bin/env python3
"""Stage a pre-converted Opus-MT ONNX pair so the browser loads it from the
mirror instead of the Hugging Face CDN.

Named "convert" to match its sibling scripts/convert-models.py, but nothing is
converted here: Xenova publishes the ONNX exports transformers.js expects, and
re-exporting them locally would only risk producing something subtly different
from what the runtime is tested against. This script fetches, licence-checks,
pins, verifies and stages them.

Two reasons the browser must not fetch these from the CDN directly:
  * the mirror's pages set a CSP that blocks the cross-origin request outright;
  * a CDN fetch tells a third party which book a reader just opened.

Output is `<out>/<pair>/manifest.json` in exactly the shape
scripts/write_model_manifest.py writes -- `{version, files:[{name,path,bytes,
sha256}]}` -- because src/models.mjs already reads that shape, verifies sha256
before use, streams progress, and re-downloads a truncated file. The extra
provenance keys alongside it are ignored by that reader.
"""

import argparse
import hashlib
import json
import shutil
from dataclasses import dataclass
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


PAIRS = {
    "en-es": Pair(repo="Xenova/opus-mt-en-es", base="Helsinki-NLP/opus-mt-en-es"),
    # Second pair, 2026-08-25 (design §12 open decision 1). French rather than
    # any of the other 27 because it is the other language with a demo book
    # behind it, and because it shares the Romance plain-cardinal year reading
    # that pipeline/lang_normalize.py's Spanish pass already established.
    #
    # Note what is NOT here: opus-mt-tc-big-en-fr exists and is the better
    # checkpoint, but there is no ONNX export of it, exactly as with Spanish.
    # The browser gets the smaller model or nothing.
    "en-fr": Pair(repo="Xenova/opus-mt-en-fr", base="Helsinki-NLP/opus-mt-en-fr"),
    # Third pair, 2026-08-26. Italian was chosen by MEASUREMENT rather than
    # argument: all 14 remaining reachable languages were screened on the QA
    # gate's own 472-sentence sample (bench/sweep/sweep.py), and Italian gates
    # at 1.4831% -- deployed Spanish's rate to six decimals -- with the best
    # median of the fourteen.
    #
    # The same "smaller model or nothing" caveat as es and fr applies, and it was
    # CHECKED here rather than assumed. The gate ran opus-mt-tc-big-en-it; the
    # browser runs this export, quantized from the SMALL checkpoint. Qualifying
    # one checkpoint and shipping another is a real gap, so the small one was
    # screened on the identical sample before this line was added:
    #
    #     tc-big  1.4831%  prose 0.42%  median 0.8317  ships
    #     small   1.4831%  prose 0.42%  median 0.8095  ships   <- what ships
    #
    # Same seven failures, same count. The smaller model costs 0.022 of median
    # and nothing at the gate.
    "en-it": Pair(repo="Xenova/opus-mt-en-it", base="Helsinki-NLP/opus-mt-en-it"),
    # Fourth and fifth pairs, 2026-08-27. Both were re-screened on the DEPLOYED
    # post-splitter corpus rather than reusing the 2026-08-25 sweep numbers,
    # which were measured before the splitter fix moved 626 sentences.
    #
    # Dutch is the strongest language this project has measured: 0.42% (2 of
    # 472), median 0.8333, against deployed Spanish's 0.6356%. It has no
    # checkpoint gap at all -- pipeline/languages.py registers opus-mt-en-nl,
    # which IS the checkpoint this export was quantized from, so the gate ran
    # the model the browser runs.
    "en-nl": Pair(repo="Xenova/opus-mt-en-nl", base="Helsinki-NLP/opus-mt-en-nl"),
    # Hungarian DOES have that gap, and unlike Italian's the two models differ.
    # hu is registered against opus-mt-tc-big-en-hu and no ONNX export of any
    # tc-big checkpoint exists, so the browser runs the SMALL one. Screened on
    # the identical 472-sentence sample:
    #
    #     tc-big  1.06%  prose 0.42%  median 0.7568  ships
    #     small   1.91%  prose 0.85%  median 0.7500  ships   <- what ships
    #
    # 9 failures against the cap's 9.44, so it passes on the model that ships
    # and the margin is one sentence. Recorded because a later reader comparing
    # 1.91% to Dutch's 0.42% should see that the gap is the checkpoint, not the
    # language: on tc-big Hungarian is a 1.06% language.
    #
    # FINNISH WAS IN THIS BATCH AND IS NOT HERE. Same gap, other side of the
    # line: fi gates at 1.27% on tc-big and 2.12% (10 of 472) on the small
    # export the browser would load, over the 2.00% cap. No threshold was
    # changed and no export of the better checkpoint exists to reach for.
    "en-hu": Pair(repo="Xenova/opus-mt-en-hu", base="Helsinki-NLP/opus-mt-en-hu"),
    # Sixth pair, 2026-08-27, chosen by the owner as Finnish's replacement.
    # Danish has NO checkpoint gap: pipeline/languages.py registers
    # opus-mt-en-da, which is the checkpoint this export was quantized from
    # (config verified identical: vocab 58930, d_model 512, 6x8), so its
    # 1.27% (6 of 472, median 0.8333) is the number for the model that ships.
    "en-da": Pair(repo="Xenova/opus-mt-en-da", base="Helsinki-NLP/opus-mt-en-da"),
    # Seventh pair, 2026-08-27. Swedish gates at 1.27% (6 of 472), median
    # 0.8108, on the post-splitter corpus, and it cannot have a checkpoint gap
    # at all: opus-mt-tc-big-en-sv DOES NOT EXIST, so the registered forward and
    # this export's base are necessarily the same model (config verified:
    # vocab 56434, d_model 512, 6x8).
    "en-sv": Pair(repo="Xenova/opus-mt-en-sv", base="Helsinki-NLP/opus-mt-en-sv"),
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
    # Ninth pair, 2026-08-28, and the LAST language that clears the gate: after
    # this the well is dry until a better ONNX export appears. Czech gates at
    # 1.48% (7 of 472), median 0.7500, on the post-splitter corpus.
    #
    # No checkpoint gap: pipeline/languages.py registers opus-mt-en-cs, which IS
    # the checkpoint this export was quantized from -- verified rather than
    # assumed, since that gap is exactly what put Finnish and Romanian out. The
    # export's config declares `_name_or_path: Helsinki-NLP/opus-mt-en-cs` and
    # matches it on vocab 62509, d_model 512 and 6x8 layers.
    #
    # Every other reachable language has now been screened on this corpus and
    # failed on the model that would ship: fi 2.12%, ro 2.54%, id 2.75%,
    # ru 3.39%, ar 5.72%, uk 7.63%, vi 13.14%, ja 51.27%. Recorded so nobody
    # re-runs them without a new export to justify it.
    "en-cs": Pair(repo="Xenova/opus-mt-en-cs", base="Helsinki-NLP/opus-mt-en-cs"),
}

# name -> path within the repo, kept as the path inside the staged pair too.
#
# The `name` keys are the contract with whatever loads the buffers back out of
# src/models.mjs, exactly as write_model_manifest.py's names are the contract
# with src/vendor/helper.js. The repo-relative layout is preserved rather than
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


def licence_and_revision(pair: Pair) -> tuple[str, str, str]:
    """Return (licence, licence_source, revision) for `pair`, or raise.

    The ONNX repos carry no `license:` tag of their own -- they are quantized
    re-exports and declare `base_model:` instead. Resolving the licence through
    that declaration is correct, but writing the result as though the ONNX repo
    had claimed it is not, so the source repo is returned alongside and recorded
    in the manifest. If Xenova ever adds a tag, it wins over the inherited one.

    Raises rather than defaulting: see ACCEPTABLE_LICENCES above.
    """
    from huggingface_hub import model_info

    info = model_info(pair.repo)
    licence = next((t.split(":", 1)[1] for t in info.tags if t.startswith("license:")), None)
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
        base = model_info(pair.base)
        licence = next((t.split(":", 1)[1] for t in base.tags if t.startswith("license:")), None)
        source = pair.base
        if licence is None:
            raise RuntimeError(
                f"neither {pair.repo!r} nor its base {pair.base!r} carries a license: "
                'tag; refusing to write "unknown" -- fix the tag lookup or the '
                "checkpoint before staging it"
            )

    if licence not in ACCEPTABLE_LICENCES:
        raise RuntimeError(
            f"{pair.repo!r} resolves to licence {licence!r} (via {source}), which is "
            f"not in ACCEPTABLE_LICENCES ({sorted(ACCEPTABLE_LICENCES)}) -- this "
            "project's model choice was made on licence grounds; a human needs to "
            "decide whether this checkpoint's output may ship inside an MIT product"
        )
    return licence, source, info.sha


def stage(name: str, pair: Pair, out_root: Path) -> Path:
    from huggingface_hub import hf_hub_download

    licence, licence_source, revision = licence_and_revision(pair)
    print(f"==> {name}: {pair.repo}@{revision[:12]} ({licence}, via {licence_source})")

    target = out_root / name
    target.mkdir(parents=True, exist_ok=True)

    files = []
    for key, relative in FILES:
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
        files.append({"name": key, "path": relative, "bytes": size, "sha256": digest})

    manifest = {
        "version": 1,
        "pair": name,
        "source": {
            "repo": pair.repo,
            "revision": revision,
            "licence": licence,
            "licence_source": licence_source,
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
