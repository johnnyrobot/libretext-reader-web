"""THROWAWAY SPIKE (LT-213). Pick the ~20 Speech Text items both engines read.

    python3 bench/phonon/pick_sentences.py            # -> bench/phonon/out/sentences.json

Prose, numbers, dates and citations come from the oracle corpus (bench/oracle/,
the deployed social_psychology tracks; fetch with scripts/oracle-fetch.sh).
Categories are matched on Display Text, because Speech Text has already spelt
the numbers out. Chemistry and spoken math come from the pipeline's math-audit
pages (demo-out/chem-audit for chem_4b 5.4, demo-out/math-audit for
math_elem_teachers 6.04): only social_psychology is staged locally, and those
pages hold the pipeline's own spoken form of each equation.

Selection is deterministic: within a category, candidates sort by the sha1 of
their Speech Text and the first N are taken. Re-running gives the same set.
"""

import glob
import hashlib
import html
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "bench/phonon/out/sentences.json"

# category -> (Display Text pattern, how many)
ORACLE = {
    "prose": (r"^[^\d()$%]+$", 4),
    "numbers": (r"\d+(\.\d+)?%|\b\d{1,3}(,\d{3})+\b|\$\d", 4),
    "dates": (r"\b(in|In|by|By|since|Since) (1[89]\d\d|20[0-2]\d)\b", 3),
    "citations": (r"et al\.,? \d{4}|\([A-Z][a-z]+ (&|and) [A-Z][a-z]+, \d{4}\)", 3),
}
# category -> (audit page, row numbers to take); rows are fixed so the set covers
# formulas, equilibria, powers of ten, fractions and a remainder.
AUDIT = {
    "chemistry": ("demo-out/chem-audit/index.html", [3, 5, 6, 8]),
    "math": ("demo-out/math-audit/index.html", [1, 3, 13]),
}
SKIP_PAGES = ("00:_Front_Matter", "zz:_Back_Matter")


def key(text):
    return hashlib.sha1(text.encode()).hexdigest()


def oracle_items():
    pool, seen = [], set()
    for f in sorted(glob.glob(str(ROOT / "bench/oracle/**/speech.json"), recursive=True)):
        if any(s in f for s in SKIP_PAGES):
            continue
        for block in json.load(open(f))["blocks"]:
            for s in block["sentences"]:
                speech = s.get("speech") or ""
                if 60 <= len(speech) <= 280 and speech not in seen:
                    seen.add(speech)
                    pool.append({"page": str(pathlib.Path(f).relative_to(ROOT)), "sid": s["id"],
                                 "display": s["display"], "speech": speech})
    taken = set()
    for cat, (pattern, n) in ORACLE.items():
        hits = sorted((p for p in pool if re.search(pattern, p["display"]) and p["speech"] not in taken),
                      key=lambda p: key(p["speech"]))
        for p in hits[:n]:
            taken.add(p["speech"])
            yield {"category": cat, **p}


def audit_items():
    row = re.compile(r'<td class="n">(\d+).*?<td class="said">(.*?)</td>', re.S)
    for cat, (page, wanted) in AUDIT.items():
        rows = {int(n): html.unescape(said).strip() for n, said in row.findall((ROOT / page).read_text())}
        for n in wanted:
            said = rows[n].strip(", ")
            yield {"category": cat, "page": page, "sid": f"eq-{n}", "display": None, "speech": said}


def main():
    items = list(oracle_items()) + list(audit_items())
    for i, it in enumerate(items, 1):
        it["id"] = f"s{i:02d}"
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(items, indent=1, ensure_ascii=False))
    for it in items:
        print(f"{it['id']} {it['category']:9} {it['speech'][:90]}")
    print(f"{len(items)} items -> {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
