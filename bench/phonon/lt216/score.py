"""THROWAWAY SPIKE (LT-216). Whisper WER/CER for the audio measure.mjs kept, against the text spoken.

    HF_HUB_OFFLINE=1 bench/phonon/.venv/bin/python bench/phonon/lt216/score.py [DIR] [lang ...]

Same Whisper as bench/phonon/score.py (large-v3-turbo, mlx), told the language.
Both sides go through Whisper's basic normaliser (lower case, punctuation to
spaces, diacritics kept), parentheses made commas first; English uses its
English normaliser, as score.py does. Whisper writes some spoken numbers as numerals, so before normalising,
the hypothesis's numerals become the words sentences.json says were spoken
("83 %" -> "quatre-vingt-trois pour cent"); a numeral it has no entry for is
left alone and counts as an error. CER drops spaces, as score.py does.

The cold run of p00 (the first, with the model load) is scored too but kept out
of the totals, so each item counts once.
"""

import json
import pathlib
import re
import sys

import jiwer
import mlx_whisper
from whisper_normalizer.basic import BasicTextNormalizer
from whisper_normalizer.english import EnglishTextNormalizer

HERE = pathlib.Path(__file__).resolve().parent
WHISPER = "mlx-community/whisper-large-v3-turbo"
SET = json.loads((HERE / "sentences.json").read_text())


def normaliser(lang):
    """Both normalisers delete anything in parentheses, so parentheses become
    commas first, on both sides, as bench/phonon/score.py does."""
    unbracket = lambda text: text.replace("(", ", ").replace(")", ", ")
    if lang == "en":
        english = EnglishTextNormalizer()
        return lambda text: english(unbracket(text))
    basic = BasicTextNormalizer()
    return lambda text: re.sub(r"\s+", " ", basic(unbracket(text))).strip()


def words_for_numerals(text, digits):
    """Numerals (and %) as the words that were spoken, longest numeral first."""
    text = re.sub(r"(\d)[\s.,  ](?=\d{3}\b)", r"\1", text)   # 1 971, 1.971 -> 1971
    if "%" in digits:
        text = text.replace("%", f" {digits['%']} ")
    for numeral in sorted((k for k in digits if k.isdigit()), key=len, reverse=True):
        text = re.sub(rf"(?<!\d){numeral}(?!\d)", f" {digits[numeral]} ", text)
    return text


def score(directory, lang):
    norm = normaliser(lang)
    digits = SET["digits"].get(lang, {})
    texts = {item["id"]: item[lang] for item in SET["items"] if lang in item}
    rows = []
    for wav in sorted((directory / lang).glob("*.wav")):
        item = wav.stem.removesuffix("-cold")
        said = mlx_whisper.transcribe(str(wav), path_or_hf_repo=WHISPER, language=lang, temperature=0.0,
                                      condition_on_previous_text=False)["text"].strip()
        ref, hyp = norm(texts[item]), norm(words_for_numerals(said, digits))
        w = jiwer.process_words(ref, hyp)
        c = jiwer.process_characters(ref.replace(" ", ""), hyp.replace(" ", ""))
        rows.append({"name": wav.stem, "id": item, "said": said, "ref": ref, "hyp": hyp,
                     "words": len(ref.split()), "word_errors": w.substitutions + w.deletions + w.insertions,
                     "chars": len(ref.replace(" ", "")),
                     "char_errors": c.substitutions + c.deletions + c.insertions})
    counted = [r for r in rows if not r["name"].endswith("-cold")]
    total = {
        "lang": lang, "items": len(counted),
        "wer": round(sum(r["word_errors"] for r in counted) / sum(r["words"] for r in counted), 4),
        "cer": round(sum(r["char_errors"] for r in counted) / sum(r["chars"] for r in counted), 4),
        "p00_wer": next(round(r["word_errors"] / r["words"], 4) for r in counted if r["id"] == "p00"),
    }
    (directory / lang / "scores.json").write_text(json.dumps({"total": total, "rows": rows}, ensure_ascii=False, indent=1))
    return total, rows


def main():
    args = sys.argv[1:]
    known = {key for item in SET["items"] for key in item} - {"id", "category"}
    directory = pathlib.Path(args.pop(0) if args and args[0] not in known else "/Users/Shared/LT-216/work/measure")
    if not directory.is_dir():
        raise SystemExit(f"{directory}: no such folder of measured audio")
    langs = args or [p.name for p in sorted(directory.iterdir()) if (p / "timings.json").exists()]
    for lang in langs:
        total, rows = score(directory, lang)
        for r in rows:
            if r["word_errors"]:
                print(f"  {lang} {r['name']}: {r['word_errors']}/{r['words']}\n    ref {r['ref']}\n    hyp {r['hyp']}")
        print(f"{lang}: WER {total['wer']:.3f}  CER {total['cer']:.3f}  (p00 WER {total['p00_wer']:.3f}, {total['items']} items)")


if __name__ == "__main__":
    main()
