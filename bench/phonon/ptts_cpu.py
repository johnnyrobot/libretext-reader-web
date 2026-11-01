"""THROWAWAY SPIKE (LT-213). Gradium's own runtime (the `ptts` wheel, no Ollama) on plain CPU.

Run inside an arm64 Linux container, one process per thread count, because
ptts.set_num_threads sizes a global pool and must come before the model loads:

    python3 bench/phonon/ptts_cpu.py --model /models/31m-en-hf --threads 4 --label 31m-f32 [--quant q8_0]

Speaks the same 20 warm items as the Ollama bench (out/sentences.json minus
item one) one after another, after one untimed warm-up. Records, over the 20:

  x_realtime      seconds of audio per second of wall time (1 / RTF)
  cpu_s           process CPU time (all threads), for core-hours
  cpu_x           seconds of audio per CPU-second: what one busy core makes
  per-item wall time and audio length

Writes out/ptts-cpu/<label>-t<threads>.json.
"""

import argparse
import json
import os
import pathlib
import platform
import time

import ptts

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "bench/phonon/out"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True, help="checkpoint folder or hf://owner/name")
    ap.add_argument("--threads", type=int, required=True)
    ap.add_argument("--label", required=True)
    ap.add_argument("--voice", help="defaults to the checkpoint's first voice")
    ap.add_argument("--quant", default="f32", help="f32 (model.safetensors) or q8_0 (model.q8.gguf)")
    a = ap.parse_args()

    ptts.set_num_threads(a.threads)
    tts = ptts.TTS(a.model, device="cpu", quant=a.quant, lang="en")
    voice = a.voice or sorted(tts.voices)[0]
    rate = tts.sample_rate
    items = json.loads((OUT / "sentences.json").read_text())
    tts.synth(items[0]["speech"], voice=voice)

    rows = []
    t0, c0 = time.perf_counter(), time.process_time()
    for it in items[1:]:
        s = time.perf_counter()
        pcm = tts.synth(it["speech"], voice=voice)
        rows.append({"id": it["id"], "wall_s": round(time.perf_counter() - s, 4), "audio_s": round(len(pcm) / rate, 3)})
    wall, cpu = time.perf_counter() - t0, time.process_time() - c0
    audio = sum(r["audio_s"] for r in rows)
    res = {
        "model": a.model, "label": a.label, "quant": a.quant, "voice": voice,
        "threads_requested": a.threads, "threads": ptts.get_num_threads(),
        "ptts_version": getattr(ptts, "__version__", None), "machine": platform.machine(), "nproc": os.cpu_count(),
        "items": len(rows), "wall_s": round(wall, 3), "audio_s": round(audio, 2), "cpu_s": round(cpu, 3),
        "x_realtime": round(audio / wall, 2), "cpu_x": round(audio / cpu, 2),
        "load_avg_1m": round(os.getloadavg()[0], 2), "rows": rows,
    }
    print(json.dumps({k: v for k, v in res.items() if k != "rows"}))
    dest = OUT / "ptts-cpu"
    dest.mkdir(exist_ok=True)
    (dest / f"{a.label}-t{a.threads}.json").write_text(json.dumps(res, indent=1))


if __name__ == "__main__":
    main()
