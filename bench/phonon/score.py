"""THROWAWAY SPIKE (LT-213). Score every rendered engine: Whisper WER and UTMOS.

    export SSL_CERT_FILE=$(bench/phonon/.venv/bin/python -m certifi)
    bench/phonon/.venv/bin/python bench/phonon/score.py [engine ...]

For each out/<engine>/ that has timings.json (default: all of them):

  wer      Whisper large-v3-turbo (mlx) transcribes each WAV; word error rate is
           measured against the item's Speech Text, the text the engine was
           given. Both sides go through Whisper's English normaliser, which turns
           spelt-out numbers back into digits on both, so "fifty four percent"
           and "54%" agree. That normaliser deletes anything in parentheses, so
           parentheses become commas first, on both sides; otherwise every
           citation would vanish from the reference and the hypothesis alike.
  cer      character error rate on the same normalised text with spaces removed
           and 0 read as o. Formulas defeat word matching: "N O two" normalises
           to "n 02" while Whisper's "NO2" becomes "no 2", a 2-of-2 word error
           for a correct reading. CER sees both as "no2".
  utmos    UTMOS22 strong (SpeechMOS v1.2.0), predicted MOS on a 1-5 scale, at
           16 kHz. An automatic naturalness proxy, not a listening test.

Writes out/<engine>/scores.json and out/scores.json (summary per engine and
per category) and prints a table.
"""

import json
import pathlib
import sys

import jiwer
import librosa
import mlx_whisper
import torch
from whisper_normalizer.english import EnglishTextNormalizer

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "bench/phonon/out"
WHISPER = "mlx-community/whisper-large-v3-turbo"
norm = EnglishTextNormalizer()


def clean(text):
    return norm(text.replace("(", ", ").replace(")", ", "))


def squash(text):
    return text.replace(" ", "").replace("0", "o")


def main():
    default_items = json.loads((OUT / "sentences.json").read_text())
    engines = sys.argv[1:] or sorted(p.parent.name for p in OUT.glob("*/timings.json"))
    utmos = torch.hub.load("tarepan/SpeechMOS:v1.2.0", "utmos22_strong", trust_repo=True)
    summary = json.loads((OUT / "scores.json").read_text()) if (OUT / "scores.json").exists() else {}
    for engine in engines:
        timings = json.loads((OUT / engine / "timings.json").read_text())
        field = timings.get("field", "speech")
        # The set this engine rendered (render_path_a.mjs writes it); older
        # folders have none and rendered the default set.
        own = OUT / engine / "sentences.json"
        items = json.loads(own.read_text()) if own.exists() else default_items
        rows = []
        for it in items:
            wav = OUT / engine / f"{it['id']}.wav"
            hyp = mlx_whisper.transcribe(str(wav), path_or_hf_repo=WHISPER, language="en",
                                         condition_on_previous_text=False)["text"].strip()
            # Score against the text the engine was actually given.
            ref = (it["display"] or it["speech"]) if field == "display" else it["speech"]
            r, h = clean(ref), clean(hyp)
            m = jiwer.process_words(r, h)
            c = jiwer.process_characters(squash(r), squash(h))
            audio, _ = librosa.load(str(wav), sr=16000, mono=True)
            with torch.no_grad():
                mos = float(utmos(torch.from_numpy(audio).unsqueeze(0), 16000).item())
            rows.append({"id": it["id"], "category": it["category"], "ref": r, "hyp": h,
                         "words": len(r.split()), "errors": m.substitutions + m.deletions + m.insertions,
                         "wer": round(m.wer, 4),
                         "chars": len(squash(r)), "char_errors": c.substitutions + c.deletions + c.insertions,
                         "utmos": round(mos, 3)})
        cats = {}
        for row in rows:
            c = cats.setdefault(row["category"], {"words": 0, "errors": 0, "chars": 0, "char_errors": 0, "utmos": []})
            for k in ("words", "errors", "chars", "char_errors"):
                c[k] += row[k]
            c["utmos"].append(row["utmos"])
        summary[engine] = {
            "wer": round(sum(r["errors"] for r in rows) / sum(r["words"] for r in rows), 4),
            "cer": round(sum(r["char_errors"] for r in rows) / sum(r["chars"] for r in rows), 4),
            "utmos_mean": round(sum(r["utmos"] for r in rows) / len(rows), 3),
            "by_category": {k: {"wer": round(v["errors"] / v["words"], 4),
                                "cer": round(v["char_errors"] / v["chars"], 4),
                                "utmos": round(sum(v["utmos"]) / len(v["utmos"]), 3)} for k, v in cats.items()},
        }
        (OUT / engine / "scores.json").write_text(json.dumps(rows, indent=1, ensure_ascii=False))
        print(f"{engine:28} WER {summary[engine]['wer']:.3f}  CER {summary[engine]['cer']:.3f}  UTMOS {summary[engine]['utmos_mean']:.2f}", flush=True)
    (OUT / "scores.json").write_text(json.dumps(summary, indent=1))


if __name__ == "__main__":
    main()
