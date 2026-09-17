"""Every shipped language must be representable by the Supertonic weights in
bench/assets/. This is the check that removed Hindi; it runs so that replacing the
weights re-runs it rather than silently invalidating spec section 3."""

import json
import unicodedata
from pathlib import Path

import pytest

from pipeline.alphabets import ALPHABETS
from pipeline.languages import TARGETS
from pipeline.normalize import normalize_for_speech

INDEXER = Path(__file__).resolve().parents[2] / "bench/assets/onnx/unicode_indexer.json"

pytestmark = pytest.mark.skipif(
    not INDEXER.exists(),
    reason="Supertonic weights are not in the repo; fetch them into bench/assets/",
)


@pytest.fixture(scope="module")
def indexer():
    return json.loads(INDEXER.read_text())


def unmapped(text: str, indexer) -> set[str]:
    """Characters the model cannot represent, after the exact preprocessing
    src/vendor/helper.js applies -- NFKD included, since it decomposes accents
    before indexing and is what lets Vietnamese tone stacks through."""
    prepared = unicodedata.normalize("NFKD", normalize_for_speech(text))
    return {
        ch for ch in prepared
        if ord(ch) >= len(indexer) or indexer[ord(ch)] == -1
    }


@pytest.mark.parametrize("code", sorted(TARGETS))
def test_every_shipped_language_is_representable(code, indexer):
    missing = unmapped(ALPHABETS[code], indexer)
    letters = {c for c in missing if unicodedata.category(c)[0] in ("L", "M")}
    assert not letters, (
        f"{code} needs characters Supertonic cannot represent: "
        + ", ".join(f"U+{ord(c):04X}" for c in sorted(letters))
    )


def test_hindi_would_fail_if_it_were_shipped(indexer):
    """The exclusion is load-bearing. If a future indexer covers Devanagari this
    test fails, which is the signal to reconsider -- not a bug."""
    missing = unmapped(ALPHABETS["hi"], indexer)
    assert "ऋ" in missing, "Devanagari vocalic R is now mapped; revisit EXCLUDED['hi']"


def test_every_target_has_an_alphabet_to_check():
    assert set(TARGETS) <= set(ALPHABETS)
