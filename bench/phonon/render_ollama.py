"""THROWAWAY SPIKE (LT-213). Render the bench items with Phonon through Ollama.

    python3 bench/phonon/render_ollama.py --tag en [--voice default] [--field speech|display]

This is path B's renderer (what a build step would call) and path C's timing
(what a reader's own Ollama would do). For each item in out/sentences.json it
POSTs /v1/audio/speech with response_format=pcm and stream=true, and records:

  ttfa_s     seconds until the first audio bytes arrive (time to first audio)
  total_s    seconds until the last byte
  audio_s    seconds of audio returned
  rtf        total_s / audio_s

A cold run is measured first: every model is unloaded (`ollama stop`), then item
one is timed from cold, so its ttfa includes model load. Peak memory is the
largest summed RSS of every `ollama` process, polled every 50 ms during the
run; it includes the server and any other loaded model, so the idle RSS is
reported beside it, and so is the model's own size from /api/ps (what Ollama
says the loaded model occupies, including GPU memory that RSS does not show).

Writes out/<engine>/<id>.wav (24 kHz mono s16) and out/<engine>/timings.json,
where <engine> is phonon-<tag>[-<voice>][-display].
"""

import argparse
import json
import pathlib
import subprocess
import threading
import time
import urllib.request
import wave

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "bench/phonon/out"
API = "http://localhost:11434"
RATE = 24000


def post(path, body):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"})
    return urllib.request.urlopen(req, timeout=600)


def ollama_rss_mb():
    out = subprocess.run(["ps", "-axo", "rss=,comm="], capture_output=True, text=True).stdout
    return sum(int(line.split(None, 1)[0]) for line in out.splitlines()
               if "ollama" in line.split(None, 1)[-1].lower()) / 1024


class PeakRss(threading.Thread):
    def __init__(self):
        super().__init__(daemon=True)
        self.peak, self.stop = 0.0, threading.Event()

    def run(self):
        while not self.stop.is_set():
            self.peak = max(self.peak, ollama_rss_mb())
            time.sleep(0.05)


def speak(model, text, voice):
    body = {"model": model, "input": text, "response_format": "pcm", "stream": True}
    if voice:
        body["voice"] = voice
    t0 = time.perf_counter()
    first, chunks = None, []
    with post("/v1/audio/speech", body) as r:
        while chunk := r.read(4096):
            if first is None:
                first = time.perf_counter() - t0
            chunks.append(chunk)
    total = time.perf_counter() - t0
    pcm = b"".join(chunks)
    return pcm, first, total


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tag", required=True)
    ap.add_argument("--voice")
    ap.add_argument("--field", choices=["speech", "display"], default="speech")
    a = ap.parse_args()
    model = f"phonon:{a.tag}"
    engine = "phonon-" + a.tag + (f"-{a.voice}" if a.voice else "") + ("-display" if a.field == "display" else "")
    dest = OUT / engine
    dest.mkdir(parents=True, exist_ok=True)
    items = json.loads((OUT / "sentences.json").read_text())

    # Unload every model so item one is a cold start and RSS is this model's
    # alone. keep_alive 0 on /api/generate does not unload a speech model;
    # `ollama stop` does.
    for m in json.load(urllib.request.urlopen(API + "/api/ps"))["models"]:
        subprocess.run(["ollama", "stop", m["name"]], check=True)
    time.sleep(2)
    idle = ollama_rss_mb()
    peak = PeakRss()
    peak.start()

    rows = []
    for i, it in enumerate(items):
        text = it[a.field] or it["speech"]  # audit items have no Display Text
        pcm, ttfa, total = speak(model, text, a.voice)
        audio_s = len(pcm) / 2 / RATE
        with wave.open(str(dest / f"{it['id']}.wav"), "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(RATE)
            w.writeframes(pcm)
        rows.append({"id": it["id"], "cold": i == 0, "chars": len(text), "ttfa_s": round(ttfa, 4),
                     "total_s": round(total, 4), "audio_s": round(audio_s, 3),
                     "rtf": round(total / audio_s, 4) if audio_s else None})
        print(f"{it['id']} ttfa {ttfa:.3f}s total {total:.3f}s audio {audio_s:.2f}s{' (cold)' if i == 0 else ''}")
    peak.stop.set()
    peak.join()
    loaded = json.load(urllib.request.urlopen(API + "/api/ps"))["models"]
    resident = next((m for m in loaded if m["name"] == model or m["model"] == model), {})

    warm = [r for r in rows if not r["cold"]]
    summary = {
        "engine": engine, "model": model, "voice": a.voice or "default", "field": a.field,
        "cold_ttfa_s": rows[0]["ttfa_s"],
        "warm_ttfa_median_s": sorted(r["ttfa_s"] for r in warm)[len(warm) // 2],
        "warm_rtf_aggregate": round(sum(r["total_s"] for r in warm) / sum(r["audio_s"] for r in warm), 4),
        "ollama_idle_rss_mb": round(idle, 1), "ollama_peak_rss_mb": round(peak.peak, 1),
        "ollama_ps_size_mb": round(resident.get("size", 0) / 2**20, 1),
        "ollama_ps_vram_mb": round(resident.get("size_vram", 0) / 2**20, 1),
        "rows": rows,
    }
    (dest / "timings.json").write_text(json.dumps(summary, indent=1))
    print(json.dumps({k: v for k, v in summary.items() if k != "rows"}, indent=1))


if __name__ == "__main__":
    main()
