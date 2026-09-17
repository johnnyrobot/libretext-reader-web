#!/usr/bin/env python3
"""The Python half of the oracle diff (build plan step 9).

The question step 9 asks is "does the browser produce the Spanish the pipeline
produced?", and a raw browser-vs-deployed diff cannot answer it, because four
things differ at once:

  1. the CHECKPOINT (deployed used opus-mt-tc-big-en-es; the only ONNX export
     that exists is of the smaller, older opus-mt-en-es),
  2. the TOKENIZER implementation (transformers.js warns MarianTokenizer has no
     fast implementation and results may be "slightly inaccurate" -- unquantified),
  3. the RUNTIME and quantisation (ORT-web q8 against CTranslate2 int8),
  4. the POST-PASSES the browser does not have (pipeline/lang_normalize.py's
     Spanish spoken-form pass and normalize.fold_unrepresentable).

So this script produces the controls that let those four be told apart:

  py-mask.json        masking by pipeline/protect.py, for parity against protect.mjs
  py-tokens.json      token ids from Python's MarianTokenizer, for parity against JS
  python-small.json   opus-mt-en-es via CTranslate2 -- the browser's OWN checkpoint,
                      so browser-vs-this isolates tokenizer + runtime from model
  python-tcbig.json   opus-mt-tc-big-en-es, no normaliser and no fold -- the
                      deployed checkpoint with the post-passes removed, so
                      this-vs-python-small is the pure model gap and
                      this-vs-deployed is the pure post-pass effect
  refs.json           the reference-section holdback per page, which is why 4,988
                      of the book's sentences have no Spanish at all

Run after scripts/oracle-fetch.sh, and after converting both checkpoints:
    .venv/bin/ct2-transformers-converter --model Helsinki-NLP/opus-mt-en-es \\
        --quantization int8 --output_dir models/ct2/opus-mt-en-es
    .venv/bin/python scripts/convert-models.py --langs es
"""

import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pipeline.protect import PlaceholderError, mask, restore  # noqa: E402
from pipeline.translate import reference_sentence_ids  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
# Where the book's speech.json manifests are read from, and where outputs land.
# Both are module-level so the existing Spanish oracle diff keeps its paths, and
# both are overridable (--corpus/--out) because bench/oracle WENT STALE on
# 2026-08-26: the sentence-splitter fix shipped, and 626 of its 9,430 sentences
# now hold different text under the SAME positional id. A language whose rules
# were measured against it would be measured against sentences the reader no
# longer hears -- and the mismatch is invisible, because the ids all still match.
# bench/retranslate holds the deployed post-splitter manifests.
CORPUS = ROOT / "bench" / "oracle"
OUT = CORPUS
PAGES = ROOT / "scripts" / "oracle-pages.txt"

# Both sides of the model comparison. `small` is what the browser runs; `tcbig` is
# what produced the deployed tracks. Named here rather than resolved through
# pipeline/languages.py because that module knows only the shipped checkpoint --
# the smaller one exists in this comparison precisely because it is NOT the
# shipped choice.
# "small" and "tcbig" are the two SPANISH checkpoints the oracle diff compares
# against each other. The per-language entries below exist for a different job:
# producing the pre-restore raw corpus that scripts/gen-normalize-parity.py needs
# to build a parity fixture for that language. Same machinery, so it lives here
# rather than in a near-copy of this file.
#
# The per-language entries name THE CHECKPOINT THE BROWSER SHIPS, which for nl
# and hu is NOT the one pipeline/languages.py registers. hu is registered
# against opus-mt-tc-big-en-hu, but no ONNX export of any tc-big checkpoint
# exists, so the browser runs the Xenova export of the small opus-mt-en-hu
# (verified 2026-08-27: the export's config is vocab=62522 d_model=512 enc=6x8,
# identical to the small checkpoint and nothing like tc-big's 56973/1024/16).
# Writing a language's spoken-form rules against tc-big's output would mean
# writing them against text no reader ever hears -- and the two DO differ: on
# the gate's own 472-sentence sample hu scores 1.06% on tc-big and 1.91% on the
# small one.
CHECKPOINTS = {
    "small": ("Helsinki-NLP/opus-mt-en-es", ROOT / "models/ct2/opus-mt-en-es"),
    "tcbig": ("Helsinki-NLP/opus-mt-tc-big-en-es", ROOT / "models/ct2/opus-mt-tc-big-en-es"),
    "fr": ("Helsinki-NLP/opus-mt-en-fr", ROOT / "models/ct2/opus-mt-en-fr"),
    "it": ("Helsinki-NLP/opus-mt-tc-big-en-it", ROOT / "models/ct2/opus-mt-tc-big-en-it"),
    "nl": ("Helsinki-NLP/opus-mt-en-nl", ROOT / "models/ct2/opus-mt-en-nl"),
    "hu": ("Helsinki-NLP/opus-mt-en-hu", ROOT / "models/ct2/opus-mt-en-hu"),
    "da": ("Helsinki-NLP/opus-mt-en-da", ROOT / "models/ct2/opus-mt-en-da"),
    "sv": ("Helsinki-NLP/opus-mt-en-sv", ROOT / "models/ct2/opus-mt-en-sv"),
    "de": ("Helsinki-NLP/opus-mt-en-de", ROOT / "models/ct2/opus-mt-en-de"),
    "cs": ("Helsinki-NLP/opus-mt-en-cs", ROOT / "models/ct2/opus-mt-en-cs"),
}


def pages() -> list[str]:
    return [line for line in PAGES.read_text().split("\n") if line]


def corpus() -> list[dict]:
    """Every English sentence, in the same order scripts/oracle-browser.mjs walks.

    `display or speech`, matching pipeline/translate.source_sentences AND
    src/reader.mjs -- a `notice` block has no display, and there are 146 of them.
    """
    out = []
    for page in pages():
        manifest = json.loads((CORPUS / page / "speech.json").read_text())
        refs = reference_sentence_ids(manifest)
        for block in manifest["blocks"]:
            for sentence in block["sentences"]:
                out.append({
                    "page": page,
                    "id": sentence["id"],
                    "kind": block.get("kind"),
                    "english": sentence.get("display") or sentence["speech"],
                    "reference": sentence["id"] in refs,
                })
    return out


def write(name: str, data) -> None:
    path = OUT / name
    path.write_text(json.dumps(data, ensure_ascii=False))
    print(f"  wrote {name} ({path.stat().st_size / 1e6:.1f} MB)")


def key(row: dict) -> str:
    return f"{row['page']}\t{row['id']}"


def do_mask(rows: list[dict]) -> dict[str, list]:
    """Mask every sentence, and record the spans as well as the text.

    The spans matter as much as the masked text: identical masked text with a
    different span map still restores differently, and restore() is where a
    mangled URL would actually reach a reader.
    """
    out = {}
    for row in rows:
        text, spans = mask(row["english"])
        out[key(row)] = [text, spans]
    return out


def do_tokens(rows: list[dict], masked: dict[str, list]) -> dict[str, list[int]]:
    from transformers import AutoTokenizer
    tokenizer = AutoTokenizer.from_pretrained(CHECKPOINTS["small"][0])
    return {key(row): tokenizer.encode(masked[key(row)][0]) for row in rows}


def do_translate(rows: list[dict], masked: dict[str, list], which: str) -> tuple[dict, dict]:
    """Translate the masked lines. Returns (restored, raw).

    `restored` has NO normaliser and NO fold -- deliberately not
    pipeline/translate.translate_sentences, which also runs the Spanish
    spoken-form pass and fold_unrepresentable, two of the four variables this
    script exists to hold still. A sentence whose spans do not survive restore
    falls back to its English source, matching what the browser worker puts in
    the slot.

    `raw` is the model's output BEFORE restore -- the masked line as the
    checkpoint emitted it. It is kept because the deployed pipeline runs its
    normaliser on the MASKED line, before restore, and that ordering is
    load-bearing (after restore the sentence holds real URLs and LaTeX full of
    digits the number passes would spell out). Without the pre-restore line,
    replaying the deployed post-passes offline is impossible and the only way to
    compare against the deployed track is another 25-minute model run.
    """
    import ctranslate2
    from transformers import AutoTokenizer

    name, directory = CHECKPOINTS[which]
    if not (directory / "model.bin").exists():
        raise SystemExit(f"{directory} not converted; see this script's docstring")
    tokenizer = AutoTokenizer.from_pretrained(name)
    # Thread-capped so this can run alongside scripts/oracle-browser.mjs, which
    # holds 8 wasm threads for an hour. Left at 0 (all cores) it starves the
    # run whose numbers are the point.
    engine = ctranslate2.Translator(str(directory), device="cpu", compute_type="int8",
                                    intra_threads=int(os.environ.get("CT2_THREADS", "0")))

    out: dict[str, str] = {}
    raw: dict[str, str] = {}
    batch: list[dict] = []
    done = 0

    def flush() -> None:
        nonlocal done
        if not batch:
            return
        lines = [masked[key(r)][0] for r in batch]
        tokens = [tokenizer.convert_ids_to_tokens(tokenizer.encode(line)) for line in lines]
        # beam_size=4 to match the browser: Xenova's generation_config.json for
        # this export carries num_beams=4, and pipeline/opus.py uses the same.
        # Beam width is not a detail here -- a greedy reference would show up as a
        # tokenizer or quantisation difference in the diff, which is the exact
        # misattribution this whole script is built to avoid.
        results = engine.translate_batch(tokens, beam_size=4, max_batch_size=0,
                                         replace_unknowns=True)
        for row, result in zip(batch, results):
            ids = tokenizer.convert_tokens_to_ids(result.hypotheses[0])
            line = tokenizer.decode(ids, skip_special_tokens=True)
            raw[key(row)] = line
            try:
                out[key(row)] = restore(line, masked[key(row)][1])
            except PlaceholderError:
                out[key(row)] = row["english"]
        done += len(batch)
        print(f"\r  {which}: {done}/{len(rows)}", end="", flush=True)
        batch.clear()

    # Character-budgeted batching, as pipeline/opus.batched does and for the same
    # reason: sentences here run from three words to a long citation, and a fixed
    # sentence count either wastes padding or blows memory.
    size = 0
    for row in rows:
        line = masked[key(row)][0]
        if batch and size + len(line) > 6000:
            flush()
            size = 0
        batch.append(row)
        size += len(line)
    flush()
    print()
    return out, raw


def main() -> None:
    global CORPUS, OUT
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--only", nargs="*",
                        choices=["mask", "tokens", "small", "tcbig", "fr", "it",
                                 "nl", "hu", "da", "sv", "de", "cs", "refs"],
                        help="run a subset; default is all of them")
    parser.add_argument("--corpus", type=Path, default=CORPUS,
                        help="tree of speech.json manifests to read (default "
                             "bench/oracle, which is PRE-splitter; pass "
                             "bench/retranslate for the deployed text)")
    parser.add_argument("--out", type=Path, default=None,
                        help="where to write the json outputs (default: --corpus)")
    args = parser.parse_args()

    CORPUS = args.corpus
    OUT = args.out or args.corpus
    OUT.mkdir(parents=True, exist_ok=True)
    want = set(args.only or ["mask", "tokens", "small", "tcbig", "refs"])
    # fr, it, nl, hu, da, sv, de and cs are opt-in: they are only needed when regenerating that
    # language's parity fixture, and each costs a full model run.

    rows = corpus()
    print(f"{len(rows)} sentences across {len(pages())} pages")

    masked = do_mask(rows)
    if "mask" in want:
        write("py-mask.json", masked)
    if "refs" in want:
        write("refs.json", {key(r): r["kind"] for r in rows if r["reference"]})
    if "tokens" in want:
        write("py-tokens.json", do_tokens(rows, masked))
    # Translation runs over the ATTEMPTED sentences only -- the 9,430 the pipeline
    # itself tried, excluding the 4,988 inside a bibliography. Not a shortcut: the
    # deployed track has no entry for a reference sentence, so there is nothing on
    # the other side of the comparison to diff against, and since step 10 the
    # browser does not translate them either. Masking and tokenizer parity above
    # still cover all 14,418, because those need no reference to be meaningful.
    attempted = [r for r in rows if not r["reference"]]
    for which in ("small", "tcbig", "fr", "it", "nl", "hu", "da", "sv", "de", "cs"):
        if which in want:
            restored, raw = do_translate(attempted, masked, which)
            write(f"python-{which}.json", restored)
            write(f"python-{which}-raw.json", raw)


if __name__ == "__main__":
    main()
