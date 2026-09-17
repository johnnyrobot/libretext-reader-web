"""Measure what a forward checkpoint DOES to numbers, before writing any rules.

Three languages have now produced three different conventions and none of them
was predictable from the language's own typographic norms:

    es  $1,200 -> "$1,200"    English forms PRESERVED
    fr  $1,200 -> "1 200 $"   space thousands, sign TRAILING, "15,50", "68 %"
    it  $1,200 -> "$ 1.200"   dot thousands, sign LEADING, "15,50", "68%"

Italian is the reason this script exists rather than a transcript. Its rule that
mattered -- a dot means thousands only when the group is exactly 3 digits -- came
from a COUNT (335 short-dot forms against 20 real thousands groups), not from
knowing that Italian writes 1.200. A port of the French constants would have read
`68 %` with a space Italian never emits, and a port of the Spanish ones would have
left every comma decimal unspoken.

So: run the real corpus's number-bearing sentences through the real forward path
with NO normaliser (`code=None`), then count target-side forms and print verbatim
pairs. Output is a JSON file per spec plus a table; the counts are the evidence a
later reader can check the rules against.

Spec syntax matches bench/sweep/rescreen.py: `nl` uses the registered forward,
`hu@Helsinki-NLP/opus-mt-en-hu` overrides it -- which is what hu and fi need,
because they are GATED on tc-big and would SHIP the small export.
"""
import argparse, gc, json, os, re, sys
from collections import Counter
from dataclasses import replace
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
os.chdir(ROOT)
sys.path.insert(0, str(ROOT))

from pipeline.languages import TARGETS
from pipeline.opus import make_translator
from pipeline.translate import translate_sentences, source_sentences

# What we look for in the ENGLISH source. One sentence can land in several
# buckets; that is wanted, since `$1.2 million` is both currency and decimal.
SOURCE = {
    "thousands": re.compile(r"\d{1,3},\d{3}\b"),
    "decimal":   re.compile(r"\b\d+\.\d+\b"),
    "currency":  re.compile(r"\$\s?\d"),
    "percent":   re.compile(r"\d\s?%"),
    "et_al":     re.compile(r"\bet\s+al\."),
    "ordinal":   re.compile(r"\b\d+(?:st|nd|rd|th)\b"),
    "year":      re.compile(r"\b(?:1[5-9]\d{2}|20\d{2})\b"),
    "scale":     re.compile(r"\b\d[\d,.]*\s+(?:million|billion|trillion|thousand)\b", re.I),
}

# What we count in the TARGET. Deliberately language-neutral shapes, because the
# question being asked is "which convention did this checkpoint pick", and a
# language-specific pattern would only find the convention it already assumed.
SP = "[    ]"
TARGET = {
    "group_dot":        re.compile(r"\d{1,3}(?:\.\d{3})+(?!\d)"),
    "group_space":      re.compile(rf"\d{{1,3}}(?:{SP}\d{{3}})+(?!\d)"),
    "group_comma":      re.compile(r"\d{1,3}(?:,\d{3})+(?!\d)"),
    "decimal_comma":    re.compile(r"\d+,\d+(?!\d)"),
    "decimal_dot":      re.compile(r"\d+\.\d+(?!\d)"),
    "pct_attached":     re.compile(r"\d%"),
    "pct_spaced":       re.compile(rf"\d{SP}%"),
    "sign_lead_tight":  re.compile(r"\$\d"),
    "sign_lead_spaced": re.compile(rf"\${SP}\d"),
    "sign_trailing":    re.compile(rf"\d{SP}?\$"),
    "suffixed_digit":   re.compile(r"\d-\w"),          # Hungarian 1990-ben
    "et_al_kept":       re.compile(r"\bet\s+al\."),
    "bare_digits":      re.compile(r"\d"),
}

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--specs", nargs="+", required=True)
    ap.add_argument("--corpus", default="bench/retranslate")
    ap.add_argument("--out", default="bench/formats")
    ap.add_argument("--per-bucket", type=int, default=60,
                    help="sentences sampled per source bucket (deterministic: first N by id)")
    ap.add_argument("--examples", type=int, default=12)
    args = ap.parse_args()

    pool = {}
    for speech in sorted((ROOT / args.corpus).rglob("speech.json")):
        manifest = json.loads(speech.read_text(encoding="utf-8"))
        for sid, text in source_sentences(manifest).items():
            pool[f"{speech.parent.name}::{sid}"] = text

    buckets = {name: [k for k in sorted(pool) if rx.search(pool[k])][: args.per_bucket]
               for name, rx in SOURCE.items()}
    wanted = sorted({k for ids in buckets.values() for k in ids})
    print(f"corpus {args.corpus}: {len(pool)} sentences; "
          + "  ".join(f"{n}={len(ids)}" for n, ids in buckets.items())
          + f"  -> {len(wanted)} unique to translate", flush=True)

    for spec in args.specs:
        code, _, forward = spec.partition("@")
        lang = TARGETS[code]
        if forward:
            lang = replace(lang, forward=forward)

        fwd = make_translator(lang)
        # code=None on purpose: this measures the checkpoint, not the normaliser.
        out = translate_sentences({k: pool[k] for k in wanted}, fwd, code=None)
        del fwd; gc.collect()

        report = {"spec": spec, "code": code, "forward": lang.forward,
                  "corpus": args.corpus, "buckets": {}}
        for name, ids in buckets.items():
            counts = Counter()
            for k in ids:
                line = out.get(k, "")
                for shape, rx in TARGET.items():
                    if rx.search(line):
                        counts[shape] += 1
            report["buckets"][name] = {
                "sampled": len(ids),
                "translated": sum(1 for k in ids if k in out),
                "shapes": dict(counts.most_common()),
                "examples": [{"en": pool[k], "xx": out.get(k, "")}
                             for k in ids[: args.examples]],
            }

        path = Path(args.out) / f"{code}{'-small' if forward else ''}.json"
        path.write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"\n=== {spec}  ({lang.forward}) -> {path}")
        for name, b in report["buckets"].items():
            shapes = " ".join(f"{s}={c}" for s, c in b["shapes"].items()
                              if s not in ("bare_digits",))
            print(f"  {name:<10} n={b['sampled']:<3} {shapes}")


if __name__ == "__main__":
    main()
