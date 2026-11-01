"""THROWAWAY SPIKE (LT-213). Path B throughput with many requests at once.

    python3 bench/phonon/concurrency.py --model phonon:en --ports 11434 [--conc 1,2,4,8,16] [--label main]

Sends the 20 warm bench items (out/sentences.json minus item one) to
/v1/audio/speech, N requests in flight at a time, spread round-robin over the
given Ollama ports. Each N gets max(40, 4N) requests, cycling the items, after
one untimed warm-up request per port. For each N it records:

  combined_x     seconds of audio made per second of wall time (1 / RTF)
  latency_s      per-request time to the last byte: median and p95
  ttfa_s         per-request time to the first 4,096 bytes: median and p95
  gpu_util       GPU "Device Utilization %" from ioreg, median and max while running
  peak_rss_mb    largest summed RSS of every `ollama` process
  ps_size_mb     what each server's /api/ps says the loaded model occupies, summed

GPU utilisation is the whole GPU: anything else drawing on it shows up too,
so gpu_idle (the median over the 3 s before the first N) is recorded beside it.
Writes out/concurrency/<label>-<model tag>.json.
"""

import argparse
import concurrent.futures
import itertools
import json
import os
import pathlib
import re
import statistics
import subprocess
import threading
import time
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "bench/phonon/out"
RATE = 24000


def gpu_util():
    out = subprocess.run(["ioreg", "-r", "-d", "1", "-c", "IOAccelerator"], capture_output=True, text=True).stdout
    m = re.search(r'"Device Utilization %"=(\d+)', out)
    return int(m.group(1)) if m else None


def ollama_rss_mb():
    out = subprocess.run(["ps", "-axo", "rss=,comm="], capture_output=True, text=True).stdout
    return sum(int(line.split(None, 1)[0]) for line in out.splitlines()
               if "ollama" in line.split(None, 1)[-1].lower()) / 1024


class Sampler(threading.Thread):
    def __init__(self):
        super().__init__(daemon=True)
        self.gpu, self.rss, self.stop = [], [], threading.Event()

    def run(self):
        while not self.stop.is_set():
            self.gpu.append(gpu_util())
            self.rss.append(ollama_rss_mb())
            time.sleep(0.1)


def speak(port, model, text):
    body = json.dumps({"model": model, "input": text, "response_format": "pcm", "stream": True}).encode()
    req = urllib.request.Request(f"http://127.0.0.1:{port}/v1/audio/speech", data=body,
                                 headers={"Content-Type": "application/json"})
    t0 = time.perf_counter()
    first, n = None, 0
    with urllib.request.urlopen(req, timeout=600) as r:
        while chunk := r.read(4096):
            if first is None:
                first = time.perf_counter() - t0
            n += len(chunk)
    return {"ttfa_s": first, "latency_s": time.perf_counter() - t0, "audio_s": n / 2 / RATE}


def ps_size_mb(ports, model):
    total = 0
    for p in ports:
        for m in json.load(urllib.request.urlopen(f"http://127.0.0.1:{p}/api/ps"))["models"]:
            if model in (m["name"], m["model"]):
                total += m["size"]
    return round(total / 2**20, 1)


def p95(xs):
    return sorted(xs)[min(len(xs) - 1, round(0.95 * (len(xs) - 1)))]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--ports", required=True, help="comma-separated Ollama ports")
    ap.add_argument("--conc", default="1,2,4,8,16")
    ap.add_argument("--label", required=True)
    a = ap.parse_args()
    ports = [int(p) for p in a.ports.split(",")]
    texts = [it["speech"] for it in json.loads((OUT / "sentences.json").read_text())[1:]]

    for p in ports:
        speak(p, a.model, texts[0])
    idle = []
    for _ in range(30):
        idle.append(gpu_util())
        time.sleep(0.1)

    results = []
    for n in [int(c) for c in a.conc.split(",")]:
        jobs = [(ports[i % len(ports)], texts[i % len(texts)]) for i in range(max(40, 4 * n))]
        sampler = Sampler()
        sampler.start()
        t0 = time.perf_counter()
        with concurrent.futures.ThreadPoolExecutor(n) as pool:
            rows = list(pool.map(lambda j: speak(j[0], a.model, j[1]), jobs))
        wall = time.perf_counter() - t0
        sampler.stop.set()
        sampler.join()
        audio = sum(r["audio_s"] for r in rows)
        gpu = [g for g in sampler.gpu if g is not None]
        res = {
            "concurrency": n, "requests": len(rows), "wall_s": round(wall, 2), "audio_s": round(audio, 1),
            "combined_x": round(audio / wall, 1),
            "latency_s": {"median": round(statistics.median(r["latency_s"] for r in rows), 3),
                          "p95": round(p95([r["latency_s"] for r in rows]), 3)},
            "ttfa_s": {"median": round(statistics.median(r["ttfa_s"] for r in rows), 3),
                       "p95": round(p95([r["ttfa_s"] for r in rows]), 3)},
            "gpu_util": {"median": statistics.median(gpu) if gpu else None, "max": max(gpu, default=None)},
            "peak_rss_mb": round(max(sampler.rss), 1),
            "ps_size_mb": ps_size_mb(ports, a.model),
            "load_avg_1m": round(os.getloadavg()[0], 2),
        }
        results.append(res)
        print(json.dumps(res))

    dest = OUT / "concurrency"
    dest.mkdir(exist_ok=True)
    out = {"model": a.model, "ports": ports, "label": a.label, "gpu_idle_median": statistics.median(
        g for g in idle if g is not None), "results": results}
    (dest / f"{a.label}-{a.model.split(':')[1]}.json").write_text(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
