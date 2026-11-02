"""THROWAWAY SPIKE (LT-219). Whisper WER of each saved MP3 against the raw render it came from.

    HF_HUB_OFFLINE=1 bench/phonon/.venv/bin/python bench/phonon/lt219/score.py [DIR] [lang ...]

DIR is what check-save.mjs wrote (default /Users/Shared/LT-216/work/lt219-112): per
language, <id>.wav (the raw 16-bit render), <id>.mp3 (what Save downloaded) and
texts.json (what was spoken). Both files of a sentence are transcribed and scored
the way bench/phonon/lt216/score.py scores, so the only difference between the
two WERs is the MP3 encoding. The bar (LT-219): MP3 WER within 0.01 of raw.
"""

import importlib.util
import json
import pathlib
import sys
import time

import jiwer
import mlx_whisper

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("lt216_score", HERE.parent / "lt216" / "score.py")
lt216 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lt216)
BAR = 0.01


def transcribe(path, lang, tries=3):
    # On a busy Mac, Metal can drop a command buffer ("Impacting Interactivity"); try again.
    for attempt in range(tries):
        try:
            return mlx_whisper.transcribe(str(path), path_or_hf_repo=lt216.WHISPER, language=lang, temperature=0.0,
                                          condition_on_previous_text=False)["text"].strip()
        except RuntimeError as error:
            if "METAL" not in str(error) or attempt == tries - 1:
                raise
            time.sleep(10)


def errors(path, text, lang, norm, digits):
    said = transcribe(path, lang)
    ref, hyp = norm(text), norm(lt216.words_for_numerals(said, digits))
    w = jiwer.process_words(ref, hyp)
    return {"said": said, "hyp": hyp, "words": len(ref.split()), "errors": w.substitutions + w.deletions + w.insertions}


def score(directory, lang):
    norm = lt216.normaliser(lang)
    digits = lt216.SET["digits"].get(lang, {})
    texts = json.loads((directory / lang / "texts.json").read_text())
    rows = []
    for item, text in texts.items():
        raw = errors(directory / lang / f"{item}.wav", text, lang, norm, digits)
        mp3 = errors(directory / lang / f"{item}.mp3", text, lang, norm, digits)
        rows.append({"id": item, "ref": norm(text), "raw": raw, "mp3": mp3})
    words = sum(r["raw"]["words"] for r in rows)
    total = {"lang": lang, "items": len(rows), "words": words,
             "raw_wer": round(sum(r["raw"]["errors"] for r in rows) / words, 4),
             "mp3_wer": round(sum(r["mp3"]["errors"] for r in rows) / words, 4)}
    total["delta"] = round(total["mp3_wer"] - total["raw_wer"], 4)
    total["pass"] = abs(total["delta"]) <= BAR
    (directory / lang / "scores.json").write_text(json.dumps({"total": total, "rows": rows}, ensure_ascii=False, indent=1))
    return total, rows


def main():
    args = sys.argv[1:]
    # DIR holds a folder per language; a language folder (with texts.json) is not one.
    first = pathlib.Path(args[0]) if args else None
    is_dir = first is not None and first.is_dir() and not (first / "texts.json").exists()
    directory = pathlib.Path(args.pop(0) if is_dir else "/Users/Shared/LT-216/work/lt219-112")
    langs = args or [p.name for p in sorted(directory.iterdir()) if (p / "texts.json").exists()]
    totals = []
    for lang in langs:
        total, rows = score(directory, lang)
        for r in rows:
            if r["raw"]["hyp"] != r["mp3"]["hyp"]:
                print(f"  {lang} {r['id']}: raw {r['raw']['errors']} vs mp3 {r['mp3']['errors']} errors\n"
                      f"    raw {r['raw']['hyp']}\n    mp3 {r['mp3']['hyp']}")
        print(f"{lang}: WER raw {total['raw_wer']:.4f}  mp3 {total['mp3_wer']:.4f}  delta {total['delta']:+.4f}  "
              f"({total['items']} items, {total['words']} words) {'PASS' if total['pass'] else 'FAIL'}")
        totals.append(total)
    (directory / "scores.json").write_text(json.dumps(totals, indent=1))
    if not all(t["pass"] for t in totals):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
