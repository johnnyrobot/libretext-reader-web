"""Per-language speech tracks, written beside the page's speech.json.

Kept out of speech.json rather than nested inside it. speech.json is fetched at
reader-mode entry, before the reader hears anything; 29 inline tracks would take a
page from 139 KB to about 1.4 MB and make a reader who wants English pay for
Vietnamese. That is the mistake boot.js exists to avoid, one level down.

A track is SPARSE on purpose. Any id missing from it falls back to the English
speech text, so a sentence the translator mangled is spoken in English rather than
dropped or spoken as garbage.
"""

import json
from pathlib import Path

from pipeline.languages import TARGETS


def track_path(speech_json: Path, code: str) -> Path:
    return Path(speech_json).with_suffix("").with_name(f"speech.{code}.json")


def _read(path: Path) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def write_track(speech_json: Path, code: str, texts: dict[str, str]) -> Path:
    """The source hash rides along so a re-run can tell a stale track from a fresh
    one without re-reading every sentence."""
    manifest = _read(speech_json)
    path = track_path(speech_json, code)
    path.write_text(
        json.dumps({"sourceHash": manifest.get("generatedFrom", ""), "text": texts},
                   ensure_ascii=False),
        encoding="utf-8",
    )
    return path


def needs_translation(speech_json: Path, code: str) -> bool:
    path = track_path(speech_json, code)
    if not path.exists():
        return True
    try:
        track = _read(path)
    except json.JSONDecodeError:
        # A truncated or otherwise corrupt track -- most likely an interrupted
        # translation run, the exact scenario this module exists to resume -- must
        # fail SAFE toward retranslating, the same way a missing sourceHash already
        # does. Only the parse failure is caught; a permissions error or the like
        # must still surface.
        return True
    return track.get("sourceHash") != _read(speech_json).get("generatedFrom")


def announce(speech_json: Path) -> list[str]:
    """Rewrite speech.json's `languages` from what is actually on disk.

    Derived, never accumulated: a track deleted by hand, or dropped by the QA gate,
    disappears from the menu on the next run without anyone remembering to edit a
    list."""
    speech_json = Path(speech_json)
    found = sorted(
        p.name.split(".")[1]
        for p in speech_json.parent.glob("speech.*.json")
        if p.name.count(".") == 2 and p.name.split(".")[1] in TARGETS
    )
    manifest = _read(speech_json)
    manifest["languages"] = found
    speech_json.write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")
    return found
