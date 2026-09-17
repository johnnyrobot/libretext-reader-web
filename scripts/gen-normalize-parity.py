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
    normalize_es_for_speech, normalize_fr_for_speech, normalize_it_for_speech,
    normalize_nl_for_speech, normalize_hu_for_speech, normalize_da_for_speech,
    normalize_sv_for_speech, normalize_de_for_speech,
    normalize_cs_for_speech,
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

SYNTHETIC_IT = [
    # Italian inverts BOTH marks relative to English, so its cases are not
    # translations of either of the sets above -- they are the shapes the en-it
    # checkpoint was measured emitting, plus the irregular spine.
    "1.200 casi e 1.000.000 di casi",     # DOT-grouped thousands
    "costa $ 1.200 in totale",            # sign LEADING with a space
    "costa $ 15,50 a sessione",
    "ha cancellato $ 8,3 trilioni",       # scale word: NOT dollars and cents
    "il 68% poi il 68 % dei partecipanti",
    "la soglia p 0,05 ovunque",
    # The dot ambiguity, both sides of it in one line: 1.200 is a thousand,
    # 7.5 and 2.0 are not. This is the single most load-bearing case here.
    "Figura 7.5 e Tabella 12.2 e CC BY 2.0 e 1.200 casi",
    "nel 1961 2010",                      # two years, NOT one grouped number
    "20, 21, 22, 23, 28, 31, 33, 38 casi",  # the elision spine
    "68, 80, 91, 99 casi",
    "100, 101, 108, 180, 200, 201 casi",
    "21.000 e 2.000 e 1.000 casi",
    "Jost et al. hanno trovato",          # no rule earned; must pass through
    "pagine 4064412 e 007",
    "nel 1500, 1499, 2099 e 2100",        # the year window's four corners
    "nessun numero in questa frase",
]

SYNTHETIC_NL = [
    # Dutch takes Italian's DOT thousands and keeps English's DOT decimal, so
    # one mark does two jobs and only GROUP SIZE separates them. These are the
    # shapes the en-nl checkpoint was measured emitting, plus the two spines a
    # port gets wrong: the unit-before-ten join (with its trema) and the
    # read-a-year-by-hundreds rule.
    "8.000 en 100.000 en 1.000.000 gevallen",   # DOT-grouped thousands
    "kost $50 en $ 400 en $30.000",             # sign LEADING, tight and spaced
    "kost $15,50 per sessie",
    "wiste $8,3 triljoen aan rijkdom",          # scale word: NOT dollars and cents
    "20% en dan 20 % van de jongeren",
    "de drempel p 0,05 overal",
    # The dot ambiguity, both sides of it in one line.
    "Figuur 7.5 en Tabel 12.2 en CC BY 2.0 en 8.000 gevallen",
    "in 1961 2010",                             # two years, NOT one grouped number
    "21, 22, 23, 24, 33, 68, 99 gevallen",      # the -en- join and its trema
    "100, 101, 156, 200, 512 gevallen",
    "2.000 en 2.500 en 40.320 gevallen",
    "Jost et al. vonden",                       # no rule earned; must pass through
    "pagina 4064412 en 007",
    "in 1500, 1499, 2099 en 2100",              # the year window's four corners
    "geen getallen in deze zin",
]

SYNTHETIC_HU = [
    # Hungarian is the first agglutinative language here, and the hyphenated
    # case suffix is the mechanism nothing else has. These are the shapes the
    # en-hu checkpoint was measured emitting, plus the 2000 rule and the
    # kettő/két choice.
    "a serdülők 20%-a és a rablások 90%-át és csak 1%-ot",   # suffix on a percent
    "várhatóan 2042-ig, 2050-re, 1990-ben, a 2010-es évek",  # suffix on a number
    "20% felett és 100% alatt",                              # bare percent
    "8000 és 20 000 és 40 320 és 100 000 eset",              # solid four, spaced five
    "1999 és 2000 és 2001 és 2500 eset",                     # the 2000 rule
    "2 csoport, 2 és 3 között, 22 résztvevő, 22 és 23",      # kettő/két
    "11, 15, 19, 20, 21, 29, 30, 31 eset",                   # tizen-/huszon-
    "100, 101, 300, 512 eset",
    "8,3 trillió dollárt és a küszöb p 0,05",                # comma decimal
    "az érték 40,320 volt",                                  # leaked English comma
    "kapott $4 kezdeni és egy $30-os díjért",                # currency, bare and suffixed
    "1.3 ábra és CC BY-NC 2.0",                              # dot stays a section number
    "406-412 oldal",                                         # a range is not a suffix
    "Jost et al. megállapította",                            # no rule earned
    "oldal 4064412 és 007",
    "nincs szám ebben a mondatban",
]

SYNTHETIC_DA = [
    # Danish matches Dutch's FORMATS and none of its words. These are the shapes
    # the en-da checkpoint was measured emitting, plus the three spines a port
    # from Dutch gets wrong: the vigesimal tens, where "og" goes, and the plural
    # measure word.
    "8.000 og 100.000 og 1.000.000 sager",      # DOT-grouped thousands
    "koster $50 og $ 400 og $30.000",           # sign LEADING, PLURAL word
    "koster $15,50 og $0,25 per gang",
    "slettet $8,3 billioner i rigdom",          # scale word, LONG scale
    "20% og så 20 % af de unge",
    "tærsklen p 0,05 overalt",
    "figur 7.5 og tabel 12.2 og CC BY 2.0 og 8.000 sager",   # the dot, both sides
    "i 1961 2010",                              # two years, NOT one grouped number
    "50, 55, 60, 68, 70, 80, 90, 99 sager",     # the vigesimal spine
    "20, 21, 22, 31, 42 sager",
    "100, 101, 512 sager og 2.042 og 2.500",    # where "og" goes
    "det 20. århundrede og den 26. marts og hvert 10. sekund",   # ordinals
    "Svaret var 20. Det næste spørgsmål.",      # NOT an ordinal
    "Jost et al. fandt",                        # no rule earned
    "side 4064412 og 007",
    "i 1500, 1499, 2099 og 2100",               # the year window's four corners
    "ingen tal i denne sætning",
]

SYNTHETIC_SV = [
    # Swedish agrees with Danish on almost nothing despite being its neighbour.
    # These are the shapes the en-sv checkpoint was measured emitting, plus the
    # spine a port from Danish gets wrong: the tens come FIRST with no joiner.
    "8.000 och 20 000 och 1.000.000 fall",       # BOTH thousands separators
    "20 % och sedan 35% av ungdomarna",          # BOTH percent spacings
    "99 procent av rånen",                       # already the word
    "för $50 och $ 30.000 och 50 dollar",        # sign LEADING, word INVARIABLE
    "kostar $15,50 och $0,25 styck",
    "8,3 biljoner dollar i förmögenhet",         # scale word, LONG scale
    "tröskeln p 0,05 överallt",
    "figur 7.5 och tabell 12.2 och CC BY 2.0 och 8.000 fall",  # the dot, both sides
    "r = .30 och omkring .7 av",                 # leading-dot decimals
    "år 1961 2010",                              # two years, NOT one grouped number
    "20, 21, 22, 35, 68, 99 fall",               # the tens-first spine
    "100, 101, 512 fall och 2500 och 40 320",
    "under 1900-talet och på 1960-talet och 5-åriga barn",   # hyphen suffixes
    "Schwarz m.fl., 1991 och McGregor et al. (1998)",        # one rule, not the other
    "sida 4064412 och 007",
    "år 1500, 1499, 2099 och 2100",              # the year window's four corners
    "inga siffror i denna mening",
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

SYNTHETIC_CS = [
    # Czech is the sixth convention and the first that needs no dot rule at all:
    # en-cs writes ZERO thousands dots, so every dot between digits is a section
    # number. What it does need is Hungarian's SPACE separator, the English
    # comma that leaked past it three times, and a decimal joiner that INFLECTS.
    "8 000 a 100 000 a 1 000 000 případů",   # SPACE-grouped thousands
    "stálo ($20) a ($1) a $4",               # the three surviving dollar signs
    "50,000 lidí a 1,424 chodců a 1 k 5 000,000",  # the leaked English comma
    "20% a 54% a 1% a 2% a 82% účastníků",   # the counted-noun paradigm
    "vymazal 8,3 bilionu a prahu 1,5 a 2,0", # comma decimal, "celá/celé/celých"
    "42, 9",                                 # a whole-line spaced decimal
    "oblasti 1, 2, 4 a 5",                   # the SAME shape that must NOT be one
    "(28, 5%)",                              # ...and the one that must, guarded by %
    "Obrázek 7.5 a Tabulka 12.2 a CC BY 2.0",   # every dot is a section number
    "r = .30 a asi .7 z",                    # leading-dot decimals
    "v roce 1961 2010",                      # two years, NOT one grouped number
    "20, 21, 22, 35, 68, 99 případů",        # the ten-first spine
    "100, 101, 200, 300, 500, 512 případů",  # sto / dvě stě / tři sta / pět set
    "1000 a 2500 a 40 320 případů",          # tisíc / dva tisíce / genitive plural
    "asi 100 miliard a 7 milionů lidí",      # LONG scale, passed through
    "ve 20. století a 26. března a 21. prosincem",   # ordinals: RECORDED GAP
    "Odpověď byla 20. Další otázka.",        # NOT an ordinal -- same shape
    "Berman et al. (2009) a Huston a kol., 1992",    # no rule earned
    "tři 10sekundové klipy a 12-gauge a 29letý",     # glued vs hyphenated
    "strana 4064412 a 007",
    "v roce 1500, 1499, 2099 a 2100",        # the year window's four corners
    "žádná čísla v této větě",
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
    ("it", normalize_it_for_speech, SYNTHETIC_IT, ("python-it-raw.json",)),
    # nl's raw corpus was generated from bench/retranslate -- the DEPLOYED
    # post-splitter manifests -- not from bench/oracle's own speech.json files,
    # which still hold the pre-splitter text (626 of 9,430 sentences differ under
    # the same positional id). The es/fr/it corpora above predate that fix and
    # were built from bench/oracle as it stood. Regenerate with:
    #   scripts/oracle_reference.py --only nl --corpus bench/retranslate --out bench/oracle
    ("nl", normalize_nl_for_speech, SYNTHETIC_NL, ("python-nl-raw.json",)),
    ("hu", normalize_hu_for_speech, SYNTHETIC_HU, ("python-hu-raw.json",)),
    ("da", normalize_da_for_speech, SYNTHETIC_DA, ("python-da-raw.json",)),
    ("sv", normalize_sv_for_speech, SYNTHETIC_SV, ("python-sv-raw.json",)),
    # de, like nl/hu/da/sv, is generated from bench/retranslate rather than
    # bench/oracle's own pre-splitter manifests:
    #   scripts/oracle_reference.py --only de --corpus bench/retranslate --out bench/oracle
    ("de", normalize_de_for_speech, SYNTHETIC_DE, ("python-de-raw.json",)),
    # cs, like nl/hu/da/sv/de, is generated from bench/retranslate rather than
    # bench/oracle's own pre-splitter manifests:
    #   scripts/oracle_reference.py --only cs --corpus bench/retranslate --out bench/oracle
    ("cs", normalize_cs_for_speech, SYNTHETIC_CS, ("python-cs-raw.json",)),
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
