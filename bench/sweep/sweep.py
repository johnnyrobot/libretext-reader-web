"""Screen every remaining reachable language against the QA gate's OWN sample.

Validated harness: run on `vi` it reproduced the full gated run's failure rate
exactly (62/472 = 13.14%), so a 472-sentence screen is the gate's verdict at
1/20th the cost. It skips coverage, pruning and per-page batching only -- the
winner still gets a full gated run before anything ships.

Per language: convert both checkpoints (skipped if already on disk), forward
translate the sampled sentences through the pipeline's own path
(mask -> translate -> lang_normalize -> restore), round trip them through the
reverse checkpoint, and score with pipeline.qa.score_language.
"""
import gc, json, os, subprocess, sys, time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
os.chdir(ROOT)
sys.path.insert(0, str(ROOT))

from pipeline.languages import TARGETS, HIGHER_RISK
from pipeline.opus import make_translator, ct2_dir
from pipeline.qa import (sample_ids, score_language, is_degenerate,
                         is_sentence_failure, _word_count, _effective_score)
from pipeline.translate import translate_sentences, source_sentences

CODES = "it de nl da sv cs ro ru uk id ar fi hu ja".split()   # best-prior first
CORPUS = ROOT / "bench/sweep/corpus"
OUT = ROOT / "bench/sweep/results.jsonl"

pool = {}
for speech in sorted(CORPUS.rglob("speech.json")):
    manifest = json.loads(speech.read_text(encoding="utf-8"))
    for sid, text in source_sentences(manifest).items():
        pool[f"{speech}::{sid}"] = text
keys = sample_ids(list(pool))
print(f"pool {len(pool)} sentences, sampling {len(keys)} (seed 0, same set for every language)", flush=True)

done = set()
if OUT.exists():
    for line in OUT.read_text(encoding="utf-8").splitlines():
        if line.strip():
            done.add(json.loads(line)["code"])
    print(f"resuming; already screened: {sorted(done)}", flush=True)

for code in CODES:
    if code in done:
        continue
    lang = TARGETS[code]
    started = time.time()
    try:
        for name in (lang.forward, lang.reverse):
            if not (ct2_dir(name) / "model.bin").exists():
                env = dict(os.environ, PATH=f"{ROOT}/.venv/bin:{os.environ['PATH']}")
                subprocess.run(
                    [f"{ROOT}/.venv/bin/python", "scripts/convert-models.py", "--langs", code,
                     "--attribution", "bench/sweep/_logs/attribution.json"],
                    check=True, env=env, capture_output=True)
                break
        convert_s = time.time() - started

        fwd = make_translator(lang)
        translated = translate_sentences({k: pool[k] for k in keys}, fwd, code=code)
        del fwd; gc.collect()

        live = [k for k in keys if k in translated and not is_degenerate(translated[k])]
        rev = make_translator(lang, reverse=True)
        back = dict(zip(live, rev([translated[k] for k in live])))
        del rev; gc.collect()

        pairs = [(pool[k], back.get(k, "")) for k in keys]
        score = score_language(code, pairs)
        fails = [k for k in keys if is_sentence_failure(pool[k], back.get(k, ""))]
        prose = [k for k in fails if _word_count(pool[k]) > 4]

        row = {"code": code, "name": lang.english, "ships": score.ships,
               "failure_rate": round(score.failure_rate, 4),
               "median": round(score.median, 4), "sampled": score.sampled,
               "failures": len(fails), "prose_failures": len(prose),
               "prose_rate": round(len(prose) / len(keys), 4),
               "degenerate_forward": len(keys) - len(live),
               "group_model": lang.forward.endswith("-mul") or "-roa-" in lang.reverse,
               "higher_risk": code in HIGHER_RISK,
               "convert_s": round(convert_s), "total_s": round(time.time() - started),
               "examples": [{"en": pool[k][:120], "xx": translated.get(k, "")[:120],
                             "back": back.get(k, "")[:120]}
                            for k in sorted(prose, key=lambda k: -_word_count(pool[k]))[:3]]}
    except Exception as exc:
        row = {"code": code, "name": TARGETS[code].english, "ships": False,
               "error": f"{type(exc).__name__}: {exc}"[:300],
               "total_s": round(time.time() - started)}

    with OUT.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(row, ensure_ascii=False) + "\n")

    if "error" in row:
        print(f"SCREEN {code}: ERROR — {row['error']}", flush=True)
    else:
        print(f"SCREEN {code:<3} {row['name']:<12} "
              f"fail {row['failure_rate']:>7.2%}  prose {row['prose_rate']:>6.2%}  "
              f"median {row['median']:.3f}  -> {'PASS' if row['ships'] else 'fail'}"
              f"  ({row['total_s']}s)", flush=True)

print("SWEEP COMPLETE", flush=True)
