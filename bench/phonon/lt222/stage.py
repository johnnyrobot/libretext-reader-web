"""THROWAWAY SPIKE (LT-222). Stage every voice of each language's catalogue for the bench.

    PYTHON=... bench/phonon/lt222/stage.py STAGE [fr de es pt]

Builds STAGE as bench/phonon/listen/stage.sh does (it runs it with LANGS=""
for the worker, English and the page), then stages each language with
scripts/stage-phonon-lang.py's stage(), asking for its shipped default and
every voice in `phonon:40m-<lang>`, each under a plain file name
(Hélène -> Helene), so measure.mjs --voice can ask the worker for any of them.
"""

import importlib.util
import json
import os
import subprocess
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location("stage_phonon_lang", ROOT / "scripts" / "stage-phonon-lang.py")
lang_stage = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lang_stage)


def plain(name: str) -> str:
    return unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()


def catalogue(lang: str) -> list:
    copy = lang_stage.read_ollama(f"40m-{lang}", lang_stage.VOICE_PINS[lang], keep=lambda n: n.startswith("voices."))
    return sorted(n.removeprefix("voices.") for n in copy.tensors if n != "voices.default")


def main():
    stage_dir = Path(sys.argv[1]).resolve()
    langs = sys.argv[2:] or ["fr", "de", "es", "pt"]
    subprocess.run([str(ROOT / "bench/phonon/listen/stage.sh")], check=True,
                   env={**os.environ, "STAGE": str(stage_dir), "LANGS": ""})
    names = {}
    for lang in langs:
        voices = {"default": "default", **{plain(v): v for v in catalogue(lang)}}
        manifest = lang_stage.stage(lang, stage_dir / "_assets" / "tts" / f"phonon-{lang}", voices=voices)
        names[lang] = voices
        print(f"  phonon-{lang}: {len(voices)} voices, {len(manifest['files'])} files")
    (stage_dir / "voices.json").write_text(json.dumps(names, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
