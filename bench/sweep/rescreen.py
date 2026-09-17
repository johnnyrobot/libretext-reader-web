"""Re-screen named languages against the QA gate's own sample, on ANY corpus.

sweep.py screened all fourteen candidates once, on the corpus as it stood before
the sentence-splitter fix. Two things now need re-measuring rather than reusing:

  * the corpus moved. Spanish went 1.4831% -> 0.6356% purely from the re-split,
    so every pre-splitter screen number is stale in the optimistic direction we
    cannot verify by argument.
  * the checkpoint that ships is not always the checkpoint that was gated. hu and
    fi are registered against opus-mt-tc-big-en-*, but the browser loads the
    Xenova export of the SMALL opus-mt-en-*. Qualifying one and shipping the
    other is the gap that was caught for Italian; this script closes it by name.

A spec is `<code>` (registered checkpoints) or `<code>@<forward-checkpoint>`
(same language, same reverse, a different forward). Results carry the resolved
checkpoint so a row can never be mistaken for the other direction's verdict.
"""
import argparse, gc, json, os, subprocess, sys, time
from dataclasses import replace
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
os.chdir(ROOT)
sys.path.insert(0, str(ROOT))

from pipeline.languages import TARGETS, HIGHER_RISK
from pipeline.opus import make_translator, ct2_dir
from pipeline.qa import (sample_ids, score_language, is_degenerate,
                         is_sentence_failure, _word_count)
from pipeline.translate import translate_sentences, source_sentences

ap = argparse.ArgumentParser()
ap.add_argument("--corpus", default="bench/retranslate",
                help="tree of speech.json files; READ ONLY, nothing is written back")
ap.add_argument("--out", default="bench/sweep/rescreen.jsonl")
ap.add_argument("--specs", nargs="+", required=True,
                help="e.g. nl hu fi hu@Helsinki-NLP/opus-mt-en-hu")
args = ap.parse_args()

CORPUS, OUT = ROOT / args.corpus, ROOT / args.out


def resolve(spec: str):
    code, _, forward = spec.partition("@")
    lang = TARGETS[code]
    return code, (replace(lang, forward=forward) if forward else lang)


pool = {}
for speech in sorted(CORPUS.rglob("speech.json")):
    manifest = json.loads(speech.read_text(encoding="utf-8"))
    for sid, text in source_sentences(manifest).items():
        pool[f"{speech}::{sid}"] = text
keys = sample_ids(list(pool))
print(f"corpus {args.corpus}: pool {len(pool)} sentences, sampling {len(keys)} "
      f"(seed 0, same set for every spec)", flush=True)

done = set()
if OUT.exists():
    for line in OUT.read_text(encoding="utf-8").splitlines():
        if line.strip():
            done.add(json.loads(line)["spec"])
    print(f"resuming; already screened: {sorted(done)}", flush=True)

for spec in args.specs:
    if spec in done:
        continue
    code, lang = resolve(spec)
    started = time.time()
    try:
        for name in (lang.forward, lang.reverse):
            if not (ct2_dir(name) / "model.bin").exists():
                # convert-models.py shells out to ct2-transformers-converter by
                # bare name, so the venv's bin must be on PATH, not just its python.
                env = dict(os.environ, PATH=f"{ROOT}/.venv/bin:{os.environ['PATH']}")
                subprocess.run(
                    [f"{ROOT}/.venv/bin/python", "scripts/convert-models.py",
                     "--models", name,
                     "--attribution", "bench/sweep/_logs/attribution.json"],
                    check=True, env=env)
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

        row = {"spec": spec, "code": code, "name": lang.english,
               "forward": lang.forward, "reverse": lang.reverse,
               "corpus": args.corpus, "ships": score.ships,
               "failure_rate": round(score.failure_rate, 4),
               "median": round(score.median, 4), "sampled": score.sampled,
               "failures": len(fails), "prose_failures": len(prose),
               "prose_rate": round(len(prose) / len(keys), 4),
               "degenerate_forward": len(keys) - len(live),
               "higher_risk": code in HIGHER_RISK,
               "convert_s": round(convert_s), "total_s": round(time.time() - started),
               "examples": [{"en": pool[k][:160], "xx": translated.get(k, "")[:160],
                             "back": back.get(k, "")[:160]}
                            for k in sorted(prose, key=lambda k: -_word_count(pool[k]))[:5]]}
    except Exception as exc:
        row = {"spec": spec, "code": code, "ships": False,
               "error": f"{type(exc).__name__}: {exc}"[:300],
               "total_s": round(time.time() - started)}

    with OUT.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(row, ensure_ascii=False) + "\n")

    if "error" in row:
        print(f"RESCREEN {spec}: ERROR - {row['error']}", flush=True)
    else:
        print(f"RESCREEN {spec:<34} fail {row['failure_rate']:>7.2%}  "
              f"prose {row['prose_rate']:>6.2%}  median {row['median']:.4f}  "
              f"-> {'PASS' if row['ships'] else 'fail'}  ({row['total_s']}s)", flush=True)

print("RESCREEN COMPLETE", flush=True)
