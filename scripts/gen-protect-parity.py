#!/usr/bin/env python3
"""Regenerate tests/fixtures/protect-parity.json — the Python side of the
protect.py <-> protect.mjs parity contract.

Two implementations mask the same corpus for the same Marian checkpoints, and only
the Python side has a back-translation gate downstream to notice when masking goes
wrong. A divergence is therefore silent in the browser: a mangled URL read aloud,
with nothing to catch it. tests/protect.test.js asserts protect.mjs reproduces this
file byte for byte.

The real book is NOT the corpus for this. Only 36 of its 9,430 sentences carry a
protected span at all, so agreement there is weak evidence. These cases are built
from the shapes that have actually gone wrong -- trailing punctuation, unbalanced
parens, adjacency with no whitespace, DOI lookalikes -- plus the non-ASCII wrappers
where Python's Unicode-aware \\w and \\b differ from JavaScript's ASCII-only ones,
which is the divergence a hand-ported regex is most likely to introduce.

Run after ANY change to pipeline/protect.py, and read the diff: a changed fixture is
either the fix you intended or the drift this file exists to catch.
"""
import itertools
import json
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pipeline.protect import PlaceholderError, mask, restore

URLS = [
    "https://LibreTexts.org", "http://www.bbc.com/news/world-europe-25778272",
    "www.paulekman.com", "commons.wikimedia.org/wiki/File:A_B_1993-09-13.jpg",
    "libretexts.org", "en.wikipedia.org/wiki/Mercury_(planet)",
    "HTTP://EXAMPLE.COM", "creativecommons.org/licenses/by-nc-sa/3.0/",
    "bio.libretexts.org/", "io.io/a", "doi.org/10.1177/0956797611398495",
]
# Lookalikes that must NOT be masked sit here on purpose: a false positive is
# silent and expensive, so parity on the negative cases matters as much as on
# the positive ones.
OTHER = [
    "john@example.org", "a.b+c@sub.example.co", "[[latex:eDpeMg==]]",
    "[[mathml:PG1hdGg+]]", "10.1177/0956797611398495", "U.S. Government",
    "Figure 13.1", "d67b022f5b1e28272a5d29f61be9d6fb.jpg", "e.g.", "i.e.",
]
WRAP = ["{}", "({})", "({}),", "({}).", "[{}]", "“{}”", "{}.", "{},", "{};", "{}:",
        "{}!", "{}?", "{})", "((({})))", "{}))", "{}...", "«{}»"]
LEAD = ["", "See ", "Véase ", "参照 ", "Ver — ", "naïve prose ", "Zimbardo’s book, "]
TAIL = ["", " for details.", " y más.", " — fin.", "。", " ok"]


def cases() -> list[str]:
    rows = []
    rng = random.Random(11)  # Seeded: the fixture must be reproducible.
    for item, wrap in itertools.product(URLS + OTHER, WRAP):
        rows.append(rng.choice(LEAD) + wrap.format(item) + rng.choice(TAIL))
    for a, b in itertools.product(URLS[:6], OTHER[:5]):
        rows.append(f"See {a}{b} end.")
        rows.append(f"See {b}{a} end.")
    for a, b, c in zip(URLS, URLS[1:], OTHER):
        rows.append(f"{a} then ({b}), and {c} finally.")
    return sorted(set(rows))


def main() -> int:
    rows = []
    for text in cases():
        masked, spans = mask(text)
        try:
            round_trip = restore(masked, spans)
        except PlaceholderError as exc:
            round_trip = f"<ERR {exc}>"
        rows.append({"text": text, "masked": masked, "spans": spans,
                     "roundTrip": round_trip})
    out = Path(__file__).resolve().parents[1] / "tests/fixtures/protect-parity.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(rows, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    spanned = sum(1 for r in rows if r["spans"])
    print(f"{out}: {len(rows)} cases, {spanned} carrying at least one span")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
