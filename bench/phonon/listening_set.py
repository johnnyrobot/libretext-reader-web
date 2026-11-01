"""THROWAWAY SPIKE (LT-213). Build the blind A/B listening set.

    python3 bench/phonon/listening_set.py [--a supertonic-M1] [--b phonon-en]

For every bench item, the two engines' renders are copied to
bench/phonon/listening/<id>-A.wav and <id>-B.wav, with which engine is A drawn
at random per item (secrets, so the draw is not reproducible from this script).
Both are converted to the same format (24 kHz mono 16-bit) and loudness
(EBU R128, -20 LUFS) so neither is picked for being louder or brighter.
listening/items.txt gives each item's text. The key, the only record of which
engine is which, goes to bench/phonon/listening-key.csv, outside the folder, so
the folder can be handed to a listener on its own. Both paths are git-ignored.
"""

import argparse
import csv
import json
import pathlib
import secrets
import shutil
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "bench/phonon/out"
LISTEN = ROOT / "bench/phonon/listening"
KEY = ROOT / "bench/phonon/listening-key.csv"


def convert(src, dst):
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(src), "-af", "loudnorm=I=-20:TP=-1.5:LRA=11",
                    "-ar", "24000", "-ac", "1", "-c:a", "pcm_s16le", str(dst)], check=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--a", default="supertonic-M1")
    ap.add_argument("--b", default="phonon-en")
    a = ap.parse_args()
    items = json.loads((OUT / "sentences.json").read_text())
    shutil.rmtree(LISTEN, ignore_errors=True)
    LISTEN.mkdir(parents=True)
    key, lines = [], []
    for it in items:
        pair = [a.a, a.b]
        if secrets.randbelow(2):
            pair.reverse()
        for label, engine in zip("AB", pair):
            convert(OUT / engine / f"{it['id']}.wav", LISTEN / f"{it['id']}-{label}.wav")
        key.append({"id": it["id"], "category": it["category"], "A": pair[0], "B": pair[1]})
        lines.append(f"{it['id']} [{it['category']}] {it['speech']}")
    (LISTEN / "items.txt").write_text(
        "Each item has an A and a B file: the same text from two text-to-speech engines.\n"
        "For each item, note which you prefer and why. Which engine is which is not here.\n\n"
        + "\n".join(lines) + "\n")
    with KEY.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["id", "category", "A", "B"])
        w.writeheader()
        w.writerows(key)
    print(f"{len(items)} pairs -> {LISTEN}\nkey -> {KEY}")


if __name__ == "__main__":
    main()
