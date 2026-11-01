"""THROWAWAY SPIKE (LT-213). Path B storage and rebuild-cost estimate.

    python3 bench/phonon/storage.py [--engine phonon-en]

Path B renders every sentence at build time and serves the audio beside
speech.json. This estimates what that costs for the social_psychology book:

1. Encode the engine's bench WAVs with ffmpeg in each candidate codec and
   measure bytes per second of audio (real encoder output, not a nominal
   bitrate: containers and short files add overhead).
2. Measure speaking rate as Speech Text characters per second of audio, from
   the same renders.
3. Apply both to the oracle corpus (bench/oracle/, the deployed book's
   speech.json files: every page, every sentence), per page and per book.
4. Rebuild cost: book audio seconds x the engine's warm RTF from
   out/<engine>/timings.json, i.e. wall time on this Mac through Ollama.

Writes out/storage.json and prints the table. Encoded files go to a temporary
folder and are deleted.
"""

import argparse
import glob
import json
import pathlib
import statistics
import subprocess
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "bench/phonon/out"
# name -> (extension, ffmpeg codec arguments)
CODECS = {
    "opus-24k": ("ogg", ["-c:a", "libopus", "-b:a", "24k", "-application", "voip"]),
    "opus-32k": ("ogg", ["-c:a", "libopus", "-b:a", "32k"]),
    "aac-48k": ("m4a", ["-c:a", "aac", "-b:a", "48k"]),
    "mp3-64k": ("mp3", ["-c:a", "libmp3lame", "-b:a", "64k"]),
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--engine", default="phonon-en")
    a = ap.parse_args()
    timings = json.loads((OUT / a.engine / "timings.json").read_text())
    rows = timings["rows"]
    audio_s = sum(r["audio_s"] for r in rows)
    chars_per_s = sum(r["chars"] for r in rows) / audio_s

    bytes_per_s = {}
    with tempfile.TemporaryDirectory() as tmp:
        for name, (ext, codec) in CODECS.items():
            total = 0
            for r in rows:
                dst = pathlib.Path(tmp) / f"{r['id']}.{name}.{ext}"
                subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(OUT / a.engine / f"{r['id']}.wav"),
                                "-ac", "1", *codec, str(dst)], check=True)
                total += dst.stat().st_size
            bytes_per_s[name] = total / audio_s

    pages = []
    for f in sorted(glob.glob(str(ROOT / "bench/oracle/**/speech.json"), recursive=True)):
        sentences = [s for b in json.load(open(f))["blocks"] for s in b["sentences"]]
        pages.append({"chars": sum(len(s.get("speech") or "") for s in sentences), "sentences": len(sentences)})
    book_chars = sum(p["chars"] for p in pages)
    book_s = book_chars / chars_per_s
    page_s = [p["chars"] / chars_per_s for p in pages]

    result = {
        "engine": a.engine, "bench_audio_s": round(audio_s, 1), "chars_per_audio_s": round(chars_per_s, 2),
        "book": "social_psychology", "pages": len(pages), "sentences": sum(p["sentences"] for p in pages),
        "book_chars": book_chars, "book_audio_h": round(book_s / 3600, 2),
        "page_audio_min_median": round(statistics.median(page_s) / 60, 2),
        "page_audio_min_max": round(max(page_s) / 60, 2),
        "codecs": {n: {"kbps_measured": round(b * 8 / 1000, 1),
                       "page_mb_median": round(statistics.median(page_s) * b / 1e6, 2),
                       "page_mb_max": round(max(page_s) * b / 1e6, 2),
                       "book_mb": round(book_s * b / 1e6, 1)} for n, b in bytes_per_s.items()},
        "rebuild": {"warm_rtf": timings["warm_rtf_aggregate"],
                    "book_minutes_this_mac": round(book_s * timings["warm_rtf_aggregate"] / 60, 1)},
    }
    (OUT / "storage.json").write_text(json.dumps(result, indent=1))
    print(json.dumps(result, indent=1))


if __name__ == "__main__":
    main()
