"""THROWAWAY SPIKE (LT-213). Build the blind A/B listening set.

    python3 bench/phonon/listening_set.py [--a supertonic-M1-r4] [--b patha-wasm-fp32-r3]

For every bench item, the two engines' renders are written to
bench/phonon/listening/<id>-A.wav and <id>-B.wav, with which engine is A drawn
at random per item (secrets, so the draw is not reproducible from this script).
Both are converted to the same format (24 kHz mono 16-bit) and loudness
(EBU R128, -20 LUFS) so neither is picked for being louder or brighter.

Then each clip is cut to its speech at an amplitude threshold, given 20 ms
fades, and centred, with a little random jitter, in one common length over a
shared low noise floor. That removes the tells a file alone would give: length,
Phonon's whole 80 ms frames, and the hard on/off of its noise floor against
digital silence. It cannot remove speaking rate: Phonon still speaks faster,
so its speech is shorter inside the same file.
listening/items.txt gives each item's text. The key, the only record of which
engine is which, goes to bench/phonon/listening-key.csv, outside the folder, so
the folder can be handed to a listener on its own. Both paths are git-ignored.
"""

import argparse
import array
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
SAMPLE_BYTES = 2  # 16-bit
THRESHOLD = 1000  # of 32767: the edge of speech, above path A's opening hiss (~500)
NOISE = 4         # shared noise floor, +/- this many steps


def convert(src, dst):
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(src), "-af", "loudnorm=I=-20:TP=-1.5:LRA=11",
                    "-ar", str(RATE), "-ac", "1", "-c:a", "pcm_s16le", str(dst)], check=True)


def read_samples(path):
    with wave.open(str(path)) as w:
        return array.array("h", w.readframes(w.getnframes()))


def write_samples(path, samples):
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(SAMPLE_BYTES)
        w.setframerate(RATE)
        w.writeframes(samples.tobytes())


def ms(n):
    return RATE * n // 1000


def speech_only(x):
    """Cut to the first and last sample above THRESHOLD, keep a random 20-60 ms
    on each side, and fade both ends over 20 ms."""
    loud = [i for i, v in enumerate(x) if abs(v) > THRESHOLD]
    lo = max(0, loud[0] - ms(20) - secrets.randbelow(ms(40)))
    hi = min(len(x), loud[-1] + ms(20) + secrets.randbelow(ms(40)))
    y = x[lo:hi]
    fade = min(ms(20), len(y) // 2)
    for i in range(fade):
        y[i] = y[i] * i // fade
        y[-1 - i] = y[-1 - i] * i // fade
    return y


def place_pair(clips):
    """Centre each clip, +/-100 ms of jitter, in one length: the longer clip
    plus 600-700 ms. Everything sits on the same low noise floor."""
    total = max(len(c) for c in clips) + ms(600) + secrets.randbelow(ms(100))
    out = []
    for c in clips:
        lead = (total - len(c)) // 2 + secrets.randbelow(ms(200)) - ms(100)
        y = array.array("h", (secrets.randbelow(2 * NOISE + 1) - NOISE for _ in range(total)))
        for i, v in enumerate(c):
            y[lead + i] = max(-32768, min(32767, y[lead + i] + v))
        out.append(y)
    return out


def main():
    ap = argparse.ArgumentParser()
    # Each engine's median-WER run: Supertonic as shipped (r1 ties r4, but r1
    # ran headed), and path A as recommended.
    ap.add_argument("--a", default="supertonic-M1-r4")
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
            clips = []
            for engine in pair:
                dst = pathlib.Path(tmp) / f"{engine}.wav"
                convert(OUT / engine / f"{it['id']}.wav", dst)
                clips.append(speech_only(read_samples(dst)))
        for label, samples in zip("AB", place_pair(clips)):
            write_samples(LISTEN / f"{it['id']}-{label}.wav", samples)
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
