"""Which placeholder KIND word survives every shipping checkpoint intact?

`pipeline/protect.py` masks a span as `[[KIND0]]` and `restore()` requires that
exact token back. The BRACKET shape was measured to survive (see protect.py's
docstring); the KIND word inside it was not, and it is where the damage is:

    nl  [[FILE0]] -> [[BESTAND0]]   22 sentences   translated outright
    da  [[FILE0]] -> [[FIL0]]       21 sentences   translated outright
    sv  [[URL0]]  -> [[Url0]]       10 sentences   case-folded

`restore()` raises PlaceholderError on every one and the sentence falls back to
English -- 53 sentences of a book read in the wrong language, with nothing
crashing and nothing looking wrong.

The hypothesis is that FILE is damaged because it is an ordinary English noun
that a translator has every reason to translate, while URL mostly survives
because it is an acronym. This probe tests that by running candidate kinds
through the checkpoints the BROWSER runs -- the small Xenova bases, not the
registered tc-big forwards -- and counting verbatim survival.

Kinds must match PLACEHOLDER_RE (`[[A-Z]+\\d+]]`), so candidates are letters only.
"""
import argparse, gc, json, os, sys
from dataclasses import replace
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
os.chdir(ROOT)
sys.path.insert(0, str(ROOT))

from pipeline.languages import TARGETS
from pipeline.opus import make_translator

# What the browser loads, per scripts/convert-mt-models.py PAIRS -- NOT the
# registered forward, which is tc-big for several languages and is not what a
# reader hears.
SHIPPING = {c: f"Helsinki-NLP/opus-mt-en-{c}" for c in
            ("es", "fr", "it", "nl", "hu", "da", "sv", "de")}

# FILE and URL are the two kinds in use today. The rest are candidates chosen to
# be unpronounceable as English words while staying inside PLACEHOLDER_RE.
KINDS = ["FILE", "URL", "X", "XX", "ZZ", "QQ", "XF", "ZQ"]

# The real sentence is the FIRST one: all 22 damaged sentences in the corpus are
# `Image unavailable: [[FILE0]]`, where the placeholder is nearly the whole
# payload and the translator has the least context to leave it alone.
TEMPLATES = [
    "Image unavailable: [[{k}0]]",
    "Source: [[{k}0]] and the figure below shows the same effect again.",
    "See [[{k}0]] and [[{k}1]] for the full list of materials used here.",
]

ap = argparse.ArgumentParser()
ap.add_argument("--out", default="bench/formats/placeholder-probe.json")
args = ap.parse_args()

rows = []
for code, checkpoint in SHIPPING.items():
    lang = replace(TARGETS[code], forward=checkpoint)
    fwd = make_translator(lang)
    for kind in KINDS:
        lines = [t.format(k=kind) for t in TEMPLATES]
        out = fwd(lines)
        for template, src, got in zip(TEMPLATES, lines, out):
            wanted = [f"[[{kind}{n}]]" for n in range(src.count("[["))]
            rows.append({"code": code, "kind": kind, "template": template,
                         "source": src, "translated": got,
                         "survived": all(w in got for w in wanted)})
    del fwd; gc.collect()
    kept = [r for r in rows if r["code"] == code]
    line = "  ".join(
        f"{k}:{sum(1 for r in kept if r['kind'] == k and r['survived'])}/{len(TEMPLATES)}"
        for k in KINDS)
    print(f"{code}  {line}", flush=True)

Path(args.out).write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
print(f"\nwrote {args.out}: {len(rows)} probes")
print("\nsurvival by kind, across all languages and templates:")
for k in KINDS:
    hits = [r for r in rows if r["kind"] == k]
    print(f"  {k:5} {sum(1 for r in hits if r['survived']):>3}/{len(hits)}")
