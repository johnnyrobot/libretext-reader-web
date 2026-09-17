"""Turn a page's English Speech Text into one target language.

The translator is a parameter rather than an import so this module is testable
without 2 GB of checkpoints, and so the Marian/CTranslate2 details live in exactly
one place (pipeline/opus.py).

Two failure modes are handled differently on purpose:

  - A translator that returns the wrong NUMBER of lines is a hard error. Position is
    the only thing tying a translation back to its sentence id, so an off-by-one
    would misalign every later sentence with its audio, silently.
  - A single sentence whose protected spans did not survive is DROPPED. The reader
    falls back to the English text for any id missing from the track, so one English
    sentence is a far better outcome than losing the other 302 on the page.
"""

import json
import re
from collections.abc import Callable
from pathlib import Path

from pipeline.lang_normalize import NORMALIZERS
from pipeline.languages import TARGETS
from pipeline.math_speech import substitute_math
from pipeline.normalize import fold_unrepresentable
from pipeline.protect import PlaceholderError, mask, restore

Translator = Callable[[list[str]], list[str]]


def _identity(text: str) -> str:
    return text


class SentenceCountError(ValueError):
    """The translator returned a different number of lines than it was given."""


def translate_sentences(texts: dict[str, str], translate: Translator,
                        code: str | None = None,
                        math_speech: dict[str, str] | None = None) -> dict[str, str]:
    # Task 16: the target language's spoken-form pass. Sentences arrive here as
    # RAW English (sentence.display, not sentence.speech -- see _sentences_of),
    # so the translated line comes back carrying raw digits, `$` and `%`, and
    # Supertonic will read every one of them wrong. A code with no normaliser
    # yet, or no code at all, gets identity and behaves exactly as this function
    # did before Task 16 existed.
    normalize = NORMALIZERS.get(code, _identity) if code else _identity

    if not texts:
        return {}

    ids = list(texts)
    masked_pairs = [mask(texts[i]) for i in ids]
    translated = translate([m for m, _ in masked_pairs])

    if len(translated) != len(ids):
        raise SentenceCountError(
            f"translator returned {len(translated)} lines for {len(ids)} sentences"
        )

    out: dict[str, str] = {}
    for sentence_id, (_, spans), line in zip(ids, masked_pairs, translated):
        try:
            # The normaliser runs on the MASKED line, before restore(), not
            # after it. After restore() the sentence holds real URLs, email
            # addresses and `[[latex:...]]` payloads, every one of them full of
            # digits and dots that the number passes would spell out in Spanish
            # -- corrupting a math token the reader later has to parse. On the
            # masked line those spans are `[[KIND0]]` placeholders whose digit
            # is glued to a letter, so no \b-anchored number pattern can reach
            # inside one. (If a normaliser ever did damage a placeholder,
            # restore() raises below and the sentence falls back to English --
            # graceful, but it would be a silent quality loss, which is why the
            # ordering is load-bearing rather than incidental.)
            restored = restore(normalize(line), spans)
        except PlaceholderError:
            continue  # reader falls back to English for this id
        # I6 (final-review): spec Sec7's character fold was added for the
        # TARGET languages' own quoting conventions (e.g. „ as the standard
        # opening quote in German/Bulgarian/Hungarian/Lithuanian/Czech/Polish,
        # « » in French/Russian) -- it must run on translated text, not just
        # on English sentence.speech via normalize_for_speech. Only the fold
        # runs here, never the full English pipeline, which would spell
        # numbers in English and expand English abbreviations inside a
        # translated sentence.
        # The equation is spoken in ENGLISH in every track (spec §6): the token
        # survived translation as an opaque MATH placeholder, and its words come
        # from the manifest, never from the target language.
        out[sentence_id] = substitute_math(fold_unrepresentable(restored), math_speech or {})
    return out


# A heading that opens a bibliography. Anchored on the WHOLE heading, never a
# substring: "References to Prior Work" and "Cross-Cultural References" are
# ordinary sections, and a false positive here mutes real prose to English with
# nothing to signal it happened.
#
# Generalisation risk, named because it is the one assumption in this module
# that outlives the book it was written for: `social_psychology` titles its
# bibliography "References". Another book may say something not in this list, or
# have no such heading at all. That case is SAFE -- nothing is excluded and the
# page translates exactly as it did before -- but it is also silent, which is why
# pipeline/translate_cli.py records the excluded count per run. A new book
# reporting zero exclusions is then a visible fact in translation-qa.json rather
# than an assumption nobody checked. That census earned its keep immediately:
# audited across all 91 pages of social_psychology, 41 say "References" and
# exactly one says "Reference", singular -- which the plural-only first version
# of this pattern missed. The three other reference-shaped headings in the book
# ("Sources of Stress", "Referent Power", "Resource Dilemma Games") are real
# content sections and are correctly not matched.
REFERENCE_HEADING_RE = re.compile(
    r"\s*(?:references?|reference\s+list|bibliography|works\s+cited)\s*\Z", re.I)


def reference_sentence_ids(manifest: dict) -> set[str]:
    """Sentence ids inside a reference section, which is not translated.

    A bibliography is language-neutral: author surnames, years and journal
    titles are proper nouns. Translating them is not a style choice, it
    introduces factual errors -- the real `opus-mt-tc-big-en-es` checkpoint
    rendered `Psychological Science` as `Ciencia Psicológica`, renaming a real
    journal, and `Sidanius` as `Sidanio`, corrupting an author. Measured on the
    staged page, every QA failure was a reference entry and none was prose
    (2/7 sampled reference sentences failed, 0/8 prose).

    The section runs from its heading to the NEXT heading, not to the end of the
    page. The manifest carries no heading LEVEL, so end-of-page would mute a
    real section that happens to follow the bibliography; stopping at the next
    heading under-excludes instead, which is the same behaviour as before this
    existed rather than a new silent loss.

    The heading itself is NOT excluded. "Referencias" is a correct, useful
    heading, and hearing it just before the English citations start is what
    tells a listener the switch was deliberate.
    """
    ids: set[str] = set()
    in_references = False
    for block in manifest.get("blocks", []):
        if block.get("kind") == "heading":
            in_references = bool(REFERENCE_HEADING_RE.fullmatch(block.get("text", "")))
            continue
        if in_references:
            ids.update(s["id"] for s in block.get("sentences", []))
    return ids


def source_sentences(manifest: dict) -> dict[str, str]:
    """What is actually sent to the translator, for one page.

    Task 16: `display` -- the RAW text -- not `speech`. Task 15 measured that a
    checkpoint handed English that already reads "nineteen ninety three" emits
    three separate Spanish numbers, silently un-normalises back to "1993", or
    hallucinates a different value; 9 of 20 stress sentences failed that way
    against 3 for raw text. The spoken-form job moves to the far side of the
    translator (pipeline/lang_normalize.py).

    `display or speech` rather than `display` alone, because a `notice` block --
    tts_manifest.py's generated "three rows and four columns." announcement --
    has NO display text at all: its only text is already-normalised English, so
    for those there is no "before" to choose and `speech` is the only source
    there has ever been.

    Public, and shared with pipeline/translate_cli.py's `_source_sentences`, so
    the set of sentences that gets translated and the pool the QA gate samples
    from cannot drift apart. Two copies of this rule that must agree is exactly
    how a gate ends up scoring sentences the forward pass never saw.
    """
    skip = reference_sentence_ids(manifest)
    return {
        sentence["id"]: sentence.get("display") or sentence["speech"]
        for block in manifest.get("blocks", [])
        for sentence in block.get("sentences", [])
        if (sentence.get("display") or sentence.get("speech"))
        and sentence["id"] not in skip
    }


def translate_page(speech_json: Path, code: str, translate: Translator) -> dict[str, str]:
    if code not in TARGETS:
        raise KeyError(f"{code!r} is not a shipped language; see pipeline/languages.py")
    manifest = json.loads(Path(speech_json).read_text(encoding="utf-8"))
    return translate_sentences(source_sentences(manifest), translate, code,
                               math_speech=manifest.get("mathSpeech", {}))
