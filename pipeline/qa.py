"""Back-translation quality gate.

This cannot certify correctness -- a fluent mistranslation round-trips fine. It
detects COLLAPSE: truncation, repetition loops, wrong-language output, empty results.
With 29 tracks nobody on the project can read, disqualifying is the job.

Both thresholds act rather than report. A sentence below the floor is dropped from
its track and the reader hears English; a language above the failure rate does not
ship at all. hr, sl, pl and ja are served by group or multilingual models and are
the likeliest to trip the language gate -- that is the gate working.
"""

import random
import statistics
from dataclasses import dataclass

from pipeline.protect import strip_placeholders

# PROVISIONAL (R26): these four values match spec Sec9.1 verbatim but have never
# been measured against real Opus-MT round-trip output -- there is no corpus of
# scored translations yet to calibrate against. Task 14 is where that happens.
# Do not treat them as validated, and do not loosen them to make a borderline
# case pass; if a real language sits right on one of these lines, that is a
# finding for Task 14, not a reason to move the line now.
SENTENCE_FLOOR = 0.35
LANGUAGE_FLOOR = 0.50
MAX_FAILURE_RATE = 0.02

# PROVISIONAL (R26), chosen rather than measured: below this fraction of the
# source's word count, the round trip is presumed truncated regardless of how
# well its remaining words overlap the source. Token F1 alone misses gross
# truncation -- a short fragment that exactly matches its portion of the source
# scores high on precision even though most of the sentence is gone (e.g. 3 of
# 12 source words, verbatim, scores 0.40 on sentence_score, above
# SENTENCE_FLOOR). 0.40 is picked to catch that kind of collapse with margin
# (it triggers well above the reviewer's reported 75%-truncated repro at a 0.25
# ratio) while leaving room for a round trip that legitimately paraphrases into
# fewer English words than the original, without that being mistaken for
# collapse. (I8, final-review: corrected from an earlier version of this
# comment that reasoned about "languages that are legitimately more terse than
# English" -- but _is_truncated compares the English SOURCE against the
# English ROUND TRIP, both produced by translating back to English, so a
# target language's own terseness conventions can never reach this
# comparison at all; the margin here is only about round-trip paraphrase
# length.) Never measured against real output; Task 14 calibrates it too.
TRUNCATION_RATIO = 0.40


def _tokens(text: str) -> list[str]:
    return strip_placeholders(text).lower().split()


def _word_count(text: str) -> int:
    return len(strip_placeholders(text).split())


def sentence_score(source: str, round_trip: str) -> float:
    """Token-level F1 between the original English and its round trip.

    chrF++ would be the standard choice; token F1 is used because it needs no
    dependency, is order-insensitive (translation legitimately reorders), and the
    decision here is coarse -- collapsed or not, never a fine ranking. (R26: chrF
    was measured against this reviewer's repro set and does not separate healthy
    paraphrase from collapse any better -- both metrics miss the same truncation
    and repetition cases, which is why those are now caught by dedicated checks
    below instead of by tuning the similarity metric.)
    """
    a, b = _tokens(source), _tokens(round_trip)
    if not a and not b:
        return 1.0
    if not a or not b:
        return 0.0
    overlap = 0
    remaining = list(b)
    for token in a:
        if token in remaining:
            remaining.remove(token)
            overlap += 1
    if not overlap:
        return 0.0
    precision, recall = overlap / len(b), overlap / len(a)
    return 2 * precision * recall / (precision + recall)


def _is_repeating_phrase(words: list[str], min_repeats: int = 3) -> bool:
    """A short (2-10 word) phrase repeated back-to-back at least `min_repeats`
    times, covering all but a partial trailing repeat.

    The single-word check in `is_degenerate` only catches one token looping
    (e.g. "the the the the"); a model that loops a short multi-word fragment
    instead (e.g. "over the lazy dog" x3) has a set of unique words > 1 and
    slips through, while also scoring above SENTENCE_FLOOR on token F1 because
    every token it emits does appear in the source.
    """
    n = len(words)
    max_phrase_len = min(10, n // min_repeats)
    for phrase_len in range(2, max_phrase_len + 1):
        phrase = words[:phrase_len]
        i = 0
        repeats = 0
        while i + phrase_len <= n and words[i:i + phrase_len] == phrase:
            repeats += 1
            i += phrase_len
        if repeats >= min_repeats and i >= n - phrase_len:
            return True
    return False


def is_degenerate(text: str) -> bool:
    stripped = strip_placeholders(text).strip()
    if not stripped:
        return True
    words = stripped.lower().split()
    if len(words) >= 4 and len(set(words)) == 1:
        return True
    if _is_repeating_phrase(words):
        return True
    letters = [c for c in stripped if c.isalpha()]
    return bool(letters) and len(set(letters)) == 1 and len(letters) >= 8


def _is_truncated(source: str, round_trip: str, ratio: float) -> bool:
    """True when the round trip is drastically shorter than its source by word
    count -- gross truncation, which token overlap alone can miss (see
    TRUNCATION_RATIO above). Needs both sides of the pair, so this lives here
    rather than in `is_degenerate`, which only ever sees one side."""
    src_len = _word_count(source)
    if src_len == 0:
        return False
    return _word_count(round_trip) / src_len < ratio


def _effective_score(source: str, round_trip: str, truncation_ratio: float = TRUNCATION_RATIO) -> float:
    """The score a pair actually counts as, once collapse is accounted for: a
    degenerate or grossly truncated round trip is forced to 0.0 regardless of
    its raw token-F1 overlap, which alone can be fooled by a short, verbatim
    fragment (see TRUNCATION_RATIO above). This is the ONE place that
    combination is computed -- score_language's median/failure-rate math and
    pipeline.translate_cli's sentence-level prune (R34) both have to agree on
    what a pair actually scored, not just whether it happens to fail."""
    if is_degenerate(round_trip) or _is_truncated(source, round_trip, truncation_ratio):
        return 0.0
    return sentence_score(source, round_trip)


def is_sentence_failure(
    source: str,
    round_trip: str,
    sentence_floor: float = SENTENCE_FLOOR,
    truncation_ratio: float = TRUNCATION_RATIO,
) -> bool:
    """The single definition of "this sampled sentence failed QA" (R34) -- used
    by score_language to compute a language's failure rate AND by
    pipeline.translate_cli to decide whether to prune a sentence from its
    track. Kept as one function, calling _effective_score rather than
    sentence_score directly, so the two call sites can never independently
    drift: a sentence must not simultaneously count against a language's
    failure rate and still ship inside its track."""
    return _effective_score(source, round_trip, truncation_ratio) < sentence_floor


def sample_ids(ids: list[str], fraction: float = 0.05, seed: int = 0) -> list[str]:
    """Deterministic so a re-run scores the same sentences and two runs are
    comparable. Sorts the input before sampling: `Random.sample` draws by
    position, so without sorting first, the same ids handed in a different
    order (e.g. an unordered directory listing) would draw a different sample
    at the same seed, breaking the comparability this function exists for."""
    if not ids:
        return []
    ordered = sorted(ids)
    count = max(1, round(len(ordered) * fraction))
    return sorted(random.Random(seed).sample(ordered, min(count, len(ordered))))


@dataclass
class LanguageScore:
    code: str
    median: float
    failure_rate: float
    sampled: int
    ships: bool
    reason: str
    # Recorded (R22) so a decision to ship a marginal language is a visible
    # edit rather than a silent default (spec Sec9.1) -- on every path,
    # including a pass, not only in the failure-reason string.
    sentence_floor: float
    max_failure_rate: float
    language_floor: float
    truncation_ratio: float
    # C2: how many of the language's SOURCE sentences (the book's, not the
    # track's) the track actually covers -- computed against the source pool
    # so a language that collapsed to 10% coverage cannot hide that fact
    # behind a gate that only ever looked at its own survivors. Defaulted so
    # every existing positional construction of this dataclass keeps working.
    covered: int = 0
    total: int = 0


def score_language(
    code: str,
    pairs: list[tuple[str, str]],
    sentence_floor: float = SENTENCE_FLOOR,
    max_failure_rate: float = MAX_FAILURE_RATE,
    language_floor: float = LANGUAGE_FLOOR,
    truncation_ratio: float = TRUNCATION_RATIO,
    covered: int = 0,
    total: int = 0,
) -> LanguageScore:
    if not pairs:
        return LanguageScore(code, 0.0, 1.0, 0, False, "no sample was scored",
                             sentence_floor, max_failure_rate, language_floor,
                             truncation_ratio, covered, total)

    scores = [_effective_score(source, round_trip, truncation_ratio) for source, round_trip in pairs]
    failures = sum(
        1 for source, round_trip in pairs
        if is_sentence_failure(source, round_trip, sentence_floor, truncation_ratio)
    )
    rate = failures / len(scores)
    median = statistics.median(scores)

    if rate > max_failure_rate:
        return LanguageScore(code, median, rate, len(scores), False,
                             f"failure rate {rate:.1%} exceeds {max_failure_rate:.1%}",
                             sentence_floor, max_failure_rate, language_floor,
                             truncation_ratio, covered, total)
    if median < language_floor:
        return LanguageScore(code, median, rate, len(scores), False,
                             f"median {median:.2f} below floor {language_floor:.2f}",
                             sentence_floor, max_failure_rate, language_floor,
                             truncation_ratio, covered, total)
    return LanguageScore(code, median, rate, len(scores), True, "passed",
                         sentence_floor, max_failure_rate, language_floor,
                         truncation_ratio, covered, total)
