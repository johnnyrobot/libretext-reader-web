"""THROWAWAY SPIKE (LT-213). Gather every run into out/summary.json and a table.

    python3 bench/phonon/summary.py

Repeats (out/<engine>-rN/) are grouped under their engine. Timing on this Mac is
noisy (other jobs share it; the 1-minute load average is recorded per run), so
the table gives the median across runs and the range. Quality (WER, CER, UTMOS)
comes from out/scores.json, which score.py writes per run folder.
"""

import json
import pathlib
import re
import statistics

OUT = pathlib.Path(__file__).resolve().parent / "out"
TIMING = ["load_s", "cold_ttfa_s", "warm_ttfa_median_s", "warm_rtf_aggregate",
          "browser_peak_rss_mb", "ollama_peak_rss_mb", "ollama_ps_size_mb", "load_avg_1m"]
QUALITY = ["wer", "cer", "utmos_mean"]


def main():
    scores = json.loads((OUT / "scores.json").read_text())
    groups = {}
    for t in sorted(OUT.glob("*/timings.json")):
        run = t.parent.name
        engine = re.sub(r"-r\d+$", "", run)
        head = {k: v for k, v in json.loads(t.read_text()).items() if k != "rows"}
        head.update({k: scores.get(run, {}).get(k) for k in QUALITY})
        groups.setdefault(engine, {})[run] = head
    summary = {}
    for engine, runs in groups.items():
        stats = {}
        for k in TIMING + QUALITY:
            vals = [r[k] for r in runs.values() if r.get(k) is not None]
            if vals:
                stats[k] = {"median": round(statistics.median(vals), 4), "min": min(vals), "max": max(vals)}
        summary[engine] = {"runs": len(runs), "stats": stats, "per_run": runs}
    (OUT / "summary.json").write_text(json.dumps(summary, indent=1))

    def cell(s, k, fmt):
        if k not in s:
            return "-"
        v = s[k]
        return fmt.format(v["median"]) + ("" if v["min"] == v["max"] else f" ({fmt.format(v['min'])}-{fmt.format(v['max'])})")

    print("| engine | runs | WER | CER | UTMOS | warm RTF | warm TTFA s | cold TTFA s | peak RSS MB |")
    print("|---|---|---|---|---|---|---|---|---|")
    for engine, g in summary.items():
        s = g["stats"]
        rss = "browser_peak_rss_mb" if "browser_peak_rss_mb" in s else "ollama_peak_rss_mb"
        print(f"| {engine} | {g['runs']} | {cell(s, 'wer', '{:.3f}')} | {cell(s, 'cer', '{:.3f}')} | "
              f"{cell(s, 'utmos_mean', '{:.2f}')} | {cell(s, 'warm_rtf_aggregate', '{:.3f}')} | "
              f"{cell(s, 'warm_ttfa_median_s', '{:.3f}')} | {cell(s, 'cold_ttfa_s', '{:.2f}')} | {cell(s, rss, '{:.0f}')} |")


if __name__ == "__main__":
    main()
