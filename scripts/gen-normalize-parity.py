#!/usr/bin/env python3
"""Regenerate tests/fixtures/normalize-parity.json -- the Python side of the
`lang_normalize.py` <-> `lang-normalize.mjs` parity contract.

Two implementations spell numbers for the same voice, and only the Python side
ever had a gate downstream to notice when one of them is wrong. A divergence is
therefore silent in the browser: a number read as a different number, out loud,
with nothing to catch it. `tests/lang-normalize.test.js` asserts the JS
reproduces this file exactly.

UNLIKE `gen-protect-parity.py`, the real book IS the corpus here, and that is not
a shortcut -- it is where the evidence is. Only 50 of 14,418 sentences carry a
protected span, so protect's parity had to be built from hand-made shapes; but
21% of them carry a number, so the book exercises every pass in this module
hundreds of times over. Running the port against the full 23,848 real lines is
what caught the word-boundary bug (`aereas 1, 2, 4 y 5` losing its commas) that
every hand-written case had missed.

The sample below is deterministic -- sorted keys, fixed stride -- so regenerating
without a code change produces a byte-identical file and the diff stays readable.

Run after ANY change to pipeline/lang_normalize.py, and read the diff: a changed
fixture is either the fix you intended or the drift this file exists to catch.
Needs bench/oracle (scripts/oracle-fetch.sh + oracle_reference.py + oracle-browser).
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pipeline.lang_normalize import (  # noqa: E402
    normalize_es_for_speech, normalize_fr_for_speech, normalize_de_for_speech,
    normalize_pt_for_speech,
)

ROOT = Path(__file__).resolve().parents[1]
CORPUS = ROOT / "bench" / "oracle"
OUT = ROOT / "tests" / "fixtures" / "normalize-parity.json"
SAMPLE = 300

# Shapes the corpus does not happen to contain, kept because absence from ONE
# book is not evidence they cannot occur. Every one of these is a form the module
# has an explicit rule for.
SYNTHETIC_FR = [
    # French localises where Spanish preserved English forms, so its synthetic
    # cases are NOT translations of the Spanish ones -- they are the shapes the
    # en-fr checkpoint was measured emitting, plus the irregular spine.
    "1 200 cas et 1 000 000 de cas",      # space-grouped thousands
    "a coûté 1 200 $ au total",           # sign trailing
    "Il coûte 15,50 dollars par session",
    "68 % puis 68% des participants",
    "le seuil p = 0,05 partout",
    "en 1961 2010",                       # two years, NOT one grouped number
    "70, 71, 79, 80, 81, 90, 91, 99 cas",  # the whole irregular spine
    "100, 101, 200, 201, 180 cas",
    "21 000 et 2 000 et 1 000 cas",
    "Jost et al. ont trouvé",             # no rule earned; must pass through
    "doi: 10.1177 et la salle 007",
    "aucun nombre dans cette phrase",
]

SYNTHETIC_DE = [
    # German is the first checkpoint that both PRESERVES and LOCALISES: it moves
    # every thousands group to a dot and leaves nearly every decimal dot alone.
    # These are the shapes the en-de checkpoint was measured emitting, plus the
    # spine a port from Swedish -- the language shipped immediately before it --
    # gets wrong, because Swedish puts the ten first and German the unit.
    "8.000 und 100.000 und 1.000.000 Fälle",     # DOT-grouped thousands, only
    "kostet $50 und $ 400 und $30.000",          # sign LEADING, word INVARIABLE
    "kostet $15,50 und $0,25 pro Sitzung",
    "löschte 8,3 Billionen Dollar aus",          # 1 of the 5 comma decimals, LONG scale
    "etwa 100 Milliarden Neuronen im Gehirn",    # Milliarde is 10^9, Billion 10^12
    "20 % und dann 35% der Jugendlichen",        # BOTH percent spacings
    "machte nur 1 % aus und kostete $1",         # ein Prozent, ein Dollar -- not eins
    "die Schwelle p 0,05 überall",
    "Abbildung 7.5 und Tabelle 12.2 und CC BY 2.0 und 8.000 Fälle",  # the dot, both sides
    "r = .30 und etwa .7 der",                   # leading-dot decimals
    "im Jahr 1961 2010",                         # two years, NOT one grouped number
    "20, 21, 22, 35, 68, 99 Fälle",              # the unit-FIRST spine
    "16, 17, 30, 60, 70 Fälle",                  # the four elisions
    "100, 101, 512 Fälle und 2500 und 40.320",
    "im 20. Jahrhundert und am 26. März und jede 10. Sekunde",  # ordinals: RECORDED GAP
    "Die Antwort war 20. Die nächste Frage.",    # NOT an ordinal -- same shape
    "Jost et al. stellten fest",                 # no rule earned; must pass through
    "Seite 4064412 und 007",
    "im Jahr 1500, 1499, 2099 und 2100",         # the year window's four corners
    "in den 1970er und 40er Jahren",             # the DECADE suffix, glued not hyphenated
    "z.B. und z. B. und d.h. gegenüber B. F. Skinner",  # two rules, and the initials that are not
    "keine Zahlen in diesem Satz",
]

SYNTHETIC_PT = [
    # Brazilian Portuguese (LT-217): the shapes the en-pt export was measured
    # emitting one sentence at a time, plus the cardinal spine ("cem" against
    # "cento e", "mil" never "um mil", and where "e" joins a scale word).
    "Em 1776, 13 colônias declararam independência.",
    "Cerca de 37,5% dos 1.200 alunos concordaram em 2019.",
    "O bilhete custava 12,50 dólares e o livro custava 1,250 dólares.",
    "Pesa 0,5 kg e 45% de US$ 3 milhões foram gastos.",
    "custou US $ 1.200, depois $0,50 e por fim US$ 2,5 bilhões.",
    "A Tabela 1.3 e a seção 4.2 mostram 100, 101, 999 e 1250 casos.",
    "(Kirsch et al., 2005) e 1246120 na década de 1990.",
]

SYNTHETIC = [
    "la 3ª edición",                      # Unicode word char: Python leaves it alone
    "el 1º puesto",
    "N.º 5 de la serie",
    "costó $1,250.75 en total",
    "el 0,5% frente al 99,5%",
    "menos de 1,000,000 de personas",
    "areas 1, 2, 4 y 5",                  # the boundary case, kept as a rule
    "p < 0.001 y p = 0.05",
    "doi: 10.1177/0956797611398495",
    "páginas 4064412 y 007",
    "Jost et al. (2003) y Smith et al. (1999)",
    "1,25 frente a 1,250 frente a 1.250",
    "21,000 y 21 y 1 y 100 y 101",
    "en 1500, 1499, 2099 y 2100",         # the year window's four corners
    "sin números en esta frase",
]


def corpus_lines(names, normalize) -> list[str]:
    """Real translated lines that the normaliser actually changes.

    Filtered to lines it CHANGES: a fixture full of unchanged prose asserts that
    the module does nothing, which the JS would pass by being empty.
    """
    out = []
    for name in names:
        path = CORPUS / name
        if not path.exists():
            continue
        rows = json.loads(path.read_text())
        for key in sorted(rows):
            line = rows[key]
            if line and normalize(line) != line:
                out.append(line)
    return out


LANGUAGES = [
    ("es", normalize_es_for_speech, SYNTHETIC,
     ("python-tcbig-raw.json", "python-small-raw.json")),
    ("fr", normalize_fr_for_speech, SYNTHETIC_FR, ("python-fr-raw.json",)),
    # de is generated from bench/retranslate -- the DEPLOYED post-splitter
    # manifests -- not from bench/oracle's own speech.json files, which still
    # hold the pre-splitter text (626 of 9,430 sentences differ under the same
    # positional id). The es/fr corpora above predate that fix and were built
    # from bench/oracle as it stood. Regenerate with:
    #   scripts/oracle_reference.py --only de --corpus bench/retranslate --out bench/oracle
    ("de", normalize_de_for_speech, SYNTHETIC_DE, ("python-de-raw.json",)),
    # pt has no deployed track and no ct2 checkpoint run (LT-217). Its corpus is
    # 146 social_psychology sentences translated in Node by the export the
    # browser loads, Douglasrambo/opus-mt-tc-big-en-pt-onnx@738ee4c, ONE AT A
    # TIME as src/translate.worker.mjs does, written as {id: line} to
    # bench/oracle/transformersjs-pt-raw.json on 2026-11-01.
    ("pt", normalize_pt_for_speech, SYNTHETIC_PT, ("transformersjs-pt-raw.json",)),
]


def main() -> None:
    cases = []
    for code, normalize, synthetic, sources in LANGUAGES:
        lines = corpus_lines(sources, normalize)
        if not lines:
            raise SystemExit(f"no {code} corpus under {CORPUS}; see this script's docstring")
        stride = max(1, len(lines) // SAMPLE)
        sample = lines[::stride][:SAMPLE]
        for s in synthetic + sample:
            cases.append({"lang": code, "source": s, "expected": normalize(s)})
        print(f"  {code}: {len(synthetic)} synthetic + {len(sample)} of {len(lines)} corpus lines")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(cases, ensure_ascii=False, indent=1) + "\n")
    print(f"wrote {OUT.relative_to(ROOT)}: {len(cases)} cases")


if __name__ == "__main__":
    main()
