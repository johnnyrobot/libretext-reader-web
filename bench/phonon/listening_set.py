"""THROWAWAY SPIKE (LT-213). Build the blind A/B listening set.

    python3 bench/phonon/listening_set.py [--a supertonic-M1] [--b phonon-en]

For every bench item, the two engines' renders are copied to
bench/phonon/listening/<id>-A.wav and <id>-B.wav, with which engine is A drawn
at random per item (secrets, so the draw is not reproducible from this script).
Both are converted to the same format (24 kHz mono 16-bit) and loudness
(EBU R128, -20 LUFS) so neither is picked for being louder or brighter. Then
both files of a pair are padded with silence to one common length, with a
random lead-in, because length gives the engine away: Phonon speaks faster, and
its audio is always a whole number of 80 ms frames.
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
import tempfile
import wave

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "bench/phonon/out"
LISTEN = ROOT / "bench/phonon/listening"
KEY = ROOT / "bench/phonon/listening-key.csv"


RATE = 24000


def convert(src, dst):
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(src), "-af", "loudnorm=I=-20:TP=-1.5:LRA=11",
                    "-ar", str(RATE), "-ac", "1", "-c:a", "pcm_s16le", str(dst)], check=True)


def read_pcm(path):
    with wave.open(str(path)) as w:
        return w.readframes(w.getnframes())


def write_pcm(path, pcm):
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(pcm)


def pad_pair(pcms):
    """Pad each clip to one length: a random 100-400 ms lead-in, silence after.
    The common length is the longest clip plus a random 300-400 ms, so it says
    nothing about either engine."""
    leads = [2 * (RATE // 10 + secrets.randbelow(RATE * 3 // 10)) for _ in pcms]
    total = max(lead + len(p) for lead, p in zip(leads, pcms)) + 2 * (RATE * 3 // 10 + secrets.randbelow(RATE // 10))
    return [b"\0" * lead + p + b"\0" * (total - lead - len(p)) for lead, p in zip(leads, pcms)]


def main():
    ap = argparse.ArgumentParser()
    # The median-WER run of each: Supertonic as shipped, and path A as recommended.
    ap.add_argument("--a", default="supertonic-M1-r3")
    ap.add_argument("--b", default="patha-wasm-fp32-r3")
    a = ap.parse_args()
    items = json.loads((OUT / "sentences.json").read_text())
    shutil.rmtree(LISTEN, ignore_errors=True)
    LISTEN.mkdir(parents=True)
    key, lines = [], []
    for it in items:
        pair = [a.a, a.b]
        if secrets.randbelow(2):
            pair.reverse()
        with tempfile.TemporaryDirectory() as tmp:
            pcms = []
            for engine in pair:
                dst = pathlib.Path(tmp) / f"{engine}.wav"
                convert(OUT / engine / f"{it['id']}.wav", dst)
                pcms.append(read_pcm(dst))
        for label, pcm in zip("AB", pad_pair(pcms)):
            write_pcm(LISTEN / f"{it['id']}-{label}.wav", pcm)
        key.append({"id": it["id"], "category": it["category"], "A": pair[0], "B": pair[1]})
        lines.append(f"{it['id']} [{it['category']}] {it['speech']}")
    (LISTEN / "items.txt").write_text(
        "Each item has an A and a B file: the same text from two text-to-speech engines.\n"
        "For each item, note which you prefer and why. Which engine is which is not here.\n"
        "Both files of an item are padded to the same length, so ignore the silence.\n\n"
        + "\n".join(lines) + "\n")
    with KEY.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["id", "category", "A", "B"])
        w.writeheader()
        w.writerows(key)
    print(f"{len(items)} pairs -> {LISTEN}\nkey -> {KEY}")


if __name__ == "__main__":
    main()
