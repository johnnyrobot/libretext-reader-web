"""Count number shapes over the WHOLE translated corpus, not over a sample.

`measure.py` answers "which convention did this checkpoint pick" from a
60-sentence-per-bucket sample and PRINTS 12 examples per bucket. Counting those
printed examples is how German's dot split was first written down as 17 against
15, when the real figure over all 9,430 translated sentences was 20 against 328.
Both are "measured"; only one is the corpus, and the sample-sized figure reads as
near parity -- which makes an easy rule look like a risky one.

So this script exists to be the second half of that measurement, and to be a
FILE rather than a transcript: point it at the raw corpus a full model run
produced and it counts every shape over every line.

    scripts/oracle_reference.py --only cs --corpus bench/retranslate --out bench/oracle
    bench/formats/count.py --lang cs

Reads `bench/oracle/python-<code>-raw.json` -- the PRE-restore lines, which is
what `lang_normalize.py` actually sees (it runs on the masked line, before
`protect.restore`). Counting the restored text instead would count digits inside
URLs and LaTeX payloads that no number pass can reach.
"""
import argparse
import json
import re
from pathlib import Path

from measure import ROOT, TARGET

# measure.TARGET asks "which convention", so its shapes are the ones that
# distinguish conventions. These ask the follow-up questions every language so
# far has had to answer before writing a rule, and they are deliberately
# language-NEUTRAL for the same reason measure.TARGET is: a pattern written in
# the target language only finds the convention it already assumed.
EXTRA = {
    # The dot ambiguity, both sides of it. Italian, Dutch, Danish and German all
    # turned on this ratio: a thousands group is always EXACTLY three digits, so
    # a 1-2 digit tail is a section number or a version, never a thousand.
    "dot_group_3":   re.compile(r"\d{1,3}(?:\.\d{3})+(?!\d)"),
    "dot_short_12":  re.compile(r"(?<!\d)\d+\.\d{1,2}(?!\d)"),
    # An ordinal written as digits and a period -- Danish earned a rule for this
    # at 13 occurrences, German was denied one because the same shape is a
    # sentence-final period before a capitalised noun. The following word's CASE
    # is the only guard, so both are counted separately.
    "ordinal_lower": re.compile(r"(?<!\d)\d{1,3}\.(?!\d)(?=\s+\p{Ll})".replace("\\p{Ll}", "[a-zà-öø-ÿčďěňřšťůž]")),
    "ordinal_upper": re.compile(r"(?<!\d)\d{1,3}\.(?!\d)(?=\s+[A-ZÀ-ÖØ-ÝČĎĚŇŘŠŤŮŽ])"),
    # A case ending glued or hyphenated onto a numeral: Hungarian's `2042-ig`,
    # Swedish's `1960-talet`, German's `1970er`. Glued needs its own pattern
    # because nothing \b-anchored can see it -- there is no boundary between a
    # digit and a letter.
    "suffix_hyphen": re.compile(r"\d-[^\W\d_]+"),
    "suffix_glued":  re.compile(r"\d[^\W\d_]+"),
    # Dot-separated abbreviations a voice reads out as letters. Spanish's
    # `et al.` and Swedish's `m.fl.` earned rules; German's `B. F.` author
    # initials share the shape exactly and must not.
    "abbrev_dotted": re.compile(r"\b[^\W\d_]{1,3}\.\s?[^\W\d_]{1,3}\."),
    "et_al":         re.compile(r"\bet\s+al\."),
}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--lang", required=True)
    ap.add_argument("--raw", default=None,
                    help="default bench/oracle/python-<lang>-raw.json")
    ap.add_argument("--examples", type=int, default=6)
    ap.add_argument("--only", nargs="*", help="report just these shapes")
    args = ap.parse_args()

    path = Path(args.raw or ROOT / "bench" / "oracle" / f"python-{args.lang}-raw.json")
    rows = json.loads(path.read_text(encoding="utf-8"))
    print(f"{path.name}: {len(rows)} translated sentences\n")

    shapes = {**TARGET, **EXTRA}
    if args.only:
        shapes = {k: v for k, v in shapes.items() if k in args.only}
    for name, rx in shapes.items():
        hits = [(k, m.group(0)) for k in sorted(rows) for m in rx.finditer(rows[k])]
        lines = len({k for k, _ in hits})
        print(f"{name:<16} {len(hits):>5} occurrences in {lines:>4} lines")
        for k, text in hits[: args.examples]:
            print(f"    {text!r:<24} {rows[k][:110]}")


if __name__ == "__main__":
    main()
