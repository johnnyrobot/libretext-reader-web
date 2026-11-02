"""THROWAWAY SPIKE (LT-222). Median F0 and UTMOS of each voice measure.mjs rendered.

    bench/phonon/.venv/bin/python bench/phonon/lt222/voice.py RENDER [lang ...]

RENDER holds one directory per voice, each as measure.mjs --out writes it
(RENDER/<voice>/<lang>/*.wav). For each voice and language it writes
RENDER/<voice>/<lang>/voice.json and prints one line:

  f0     median F0 in Hz over every voiced frame of the clips, librosa pyin
         (60-400 Hz). Below 150 Hz reads as male, above 180 Hz as female; in
         between, the ticket calls the voice ambiguous.
  utmos  mean UTMOS22 strong (SpeechMOS v1.2.0) at 16 kHz, as bench/phonon/score.py.

The cold run of p00 is left out, so each item counts once.
"""

import json
import pathlib
import sys

import librosa
import numpy as np
import torch

utmos = torch.hub.load("tarepan/SpeechMOS:v1.2.0", "utmos22_strong", trust_repo=True)


def measure(directory):
    wavs = [w for w in sorted(directory.glob("*.wav")) if not w.stem.endswith("-cold")]
    voiced, moses = [], []
    for wav in wavs:
        audio, rate = librosa.load(wav, sr=None)
        f0, flag, _ = librosa.pyin(audio, fmin=60, fmax=400, sr=rate, frame_length=2048)
        voiced.append(f0[flag & ~np.isnan(f0)])
        sixteen = librosa.resample(audio, orig_sr=rate, target_sr=16000)
        with torch.no_grad():
            moses.append(float(utmos(torch.from_numpy(sixteen).unsqueeze(0), 16000).item()))
    f0 = float(np.median(np.concatenate(voiced)))
    gender = "male" if f0 < 150 else "female" if f0 > 180 else "ambiguous"
    result = {"items": len(wavs), "f0": round(f0, 1), "gender": gender, "utmos": round(float(np.mean(moses)), 3)}
    (directory / "voice.json").write_text(json.dumps(result, indent=1))
    return result


def main():
    render = pathlib.Path(sys.argv[1])
    langs = sys.argv[2:] or ["fr", "de", "es", "pt"]
    for voice in sorted(p for p in render.iterdir() if p.is_dir()):
        for lang in langs:
            if (voice / lang).is_dir():
                r = measure(voice / lang)
                print(f"{lang} {voice.name:12} F0 {r['f0']:6.1f} Hz {r['gender']:9} UTMOS {r['utmos']:.2f} ({r['items']} clips)", flush=True)


if __name__ == "__main__":
    main()
