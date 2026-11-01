"""THROWAWAY SPIKE (LT-213). Throughput tables and the whole-corpus estimate.

    python3 bench/phonon/throughput.py

Reads what concurrency.py, ptts_cpu.py and storage.py left in out/ and writes
out/throughput.json, the tracked summary FINDINGS.md cites:

  ollama     out/concurrency/*.json: combined speed, latency, memory per N
  ptts_cpu   out/ptts-cpu/*.json: one process at 1/4/8 threads, and K
             single-thread processes at once (labels par-<model>-k<K>-p<i>)
  corpus     audio hours, render time and storage for every LibreTexts page

The corpus inputs are estimates, not measurements: the page count is the
Download Center census (libretexts-research, marked unverified there), and
spoken characters per page come from the four books staged here (the three
in .rebuild/site-new and social_psychology in bench/oracle).
"""

import collections
import glob
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "bench/phonon/out"

PAGES = 1_304_882  # ~3,630 books; 2026-07-20-rebuild-spec/research/public-corpus-url-census
CHARS_PER_PAGE = {  # Speech Text characters per page
    "low": 11_136,      # chem_4b, human_relations, math_elem_teachers: 255 pages
    "central": 13_668,  # those three plus social_psychology: 330 pages
    "high": 22_275,     # social_psychology alone: 75 pages
}
# Indicative public prices, USD per vCPU-hour, checked 2026-11-01 on third-party
# trackers (not the providers' own pages): AWS c8g.4xlarge (Graviton4, 16 vCPU)
# $0.638/h on demand and ~$0.28-0.32/h spot, us-east-1.
QUIET_GPU_PCT = 20  # GPU utilisation before an Ollama run above which it is "contended"
VCPU_HOUR_USD = {"aws_graviton4_on_demand": 0.638 / 16, "aws_graviton4_spot": 0.30 / 16}


def load(pattern):
    return [json.loads(pathlib.Path(f).read_text()) for f in sorted(glob.glob(str(OUT / pattern)))]


def ptts_tables():
    single, par = [], collections.defaultdict(list)
    for r in load("ptts-cpu/*.json"):
        m = re.fullmatch(r"par-(.+)-k(\d+)-p\d+", r["label"])
        if m:
            par[(m.group(1), int(m.group(2)))].append(r)
        else:
            single.append({k: r[k] for k in ("label", "threads", "x_realtime", "cpu_x")}
                          | {"cores_busy": round(r["cpu_s"] / r["wall_s"], 2)})
    parallel = []
    for (label, k), rs in sorted(par.items()):
        audio, wall, cpu = sum(r["audio_s"] for r in rs), max(r["wall_s"] for r in rs), sum(r["cpu_s"] for r in rs)
        parallel.append({"label": label, "processes": k, "combined_x": round(audio / wall, 2),
                         "per_process_x": round(min(r["x_realtime"] for r in rs), 2),
                         "cpu_x": round(audio / cpu, 2), "cores_busy": round(cpu / wall, 2)})
    return sorted(single, key=lambda r: (r["label"], r["threads"])), parallel


def main():
    storage = json.loads((OUT / "storage.json").read_text())
    chars_per_s = storage["chars_per_audio_s"]
    single, parallel = ptts_tables()
    ollama = load("concurrency/*.json")
    # Another app on the GPU only slows a run down, so every run is a lower bound
    # and the best one stands. One warm request at a time (the bench RTF) is the floor.
    candidates = [(round(1 / storage["rebuild"]["warm_rtf"], 1), "bench, one stream")]
    candidates += [(r["combined_x"], f'{o["label"]}, {len(o["ports"])} servers, {r["concurrency"]} at once')
                   for o in ollama if o["model"] == "phonon:en" for r in o["results"]]
    ollama_best, ollama_best_from = max(candidates)
    cpu_best = max((p for p in parallel if p["label"].startswith("31m")), key=lambda p: p["combined_x"])

    corpus = {}
    for case, cpp in CHARS_PER_PAGE.items():
        audio_s = PAGES * cpp / chars_per_s
        vcpu_h = audio_s / cpu_best["cpu_x"] / 3600
        corpus[case] = {
            "chars_per_page": cpp, "audio_hours": round(audio_s / 3600),
            "storage_tb": {n: round(audio_s * c["kbps_measured"] * 125 / 1e12, 2) for n, c in storage["codecs"].items()},
            "this_mac_gpu_days": round(audio_s / ollama_best / 86400, 1),
            "this_mac_cpu_days": round(audio_s / cpu_best["combined_x"] / 86400, 1),
            "cpu_vcpu_hours": round(vcpu_h),
            "cpu_usd": {n: round(vcpu_h * p) for n, p in VCPU_HOUR_USD.items()},
        }
    result = {
        "ollama": [{"model": o["model"], "label": o["label"], "ports": o["ports"],
                    "gpu_idle_median": o["gpu_idle_median"],
                    "contended": o["gpu_idle_median"] > QUIET_GPU_PCT, "results": o["results"]} for o in ollama],
        "ptts_cpu": {"single_process": single, "parallel_single_thread": parallel},
        "corpus": {"pages": PAGES, "chars_per_audio_s": chars_per_s, "ollama_best_x": ollama_best,
                   "ollama_best_from": ollama_best_from,
                   "cpu_basis": cpu_best, "vcpu_hour_usd": VCPU_HOUR_USD, "cases": corpus},
    }
    (OUT / "throughput.json").write_text(json.dumps(result, indent=1))
    print(json.dumps(result["corpus"], indent=1))


if __name__ == "__main__":
    main()
