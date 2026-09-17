"""Split Display Text into Sentences.

Returns (offset, length) pairs into the *original* string rather than the
substrings themselves. The browser rebuilds a DOM Range from those offsets, so
Display Text is never rewritten -- links, emphasis and MathJax output inside a
sentence survive highlighting untouched.
"""

import re

from pipeline.extract import MATH_TOKEN_RE

# A terminal mark, optional closing quotes/brackets, whitespace, then something
# that starts a new sentence.
BOUNDARY_RE = re.compile(r'([.!?…]["”’)\]]*)\s+(?=[A-Z"“(\[])')

ABBREVIATIONS = {
    "dr", "mr", "mrs", "ms", "prof", "st", "jr", "sr",
    "fig", "eq", "no", "vol", "ch", "pp", "ed", "eds",
    "vs", "cf", "al", "approx", "est", "inc", "ltd", "co",
    "e.g", "i.e", "u.s", "u.k",
}

# A word in ABBREVIATIONS that can also genuinely END a sentence, so its veto is
# conditional rather than absolute. A title cannot -- "Dr." always precedes the
# name it modifies, which is why capitalisation alone can never separate
# "Dr. Milgram ran the study." from a real boundary. "U.S." can sit at a full
# stop, and does in the sentence this rule was written for.
#
# Deliberately tiny: every word here is a chance to put a pause inside a name.
# "al" is excluded on purpose even though "et al." often ends a sentence --
# BOUNDARY_RE accepts "(" as a sentence opener, so "Smith et al. (2020) found"
# proposes a boundary, and a citation-dense book is full of them. tokenize.rs
# excludes it from its own set for the same reason.
SENTENCE_ENDING_ABBREVIATIONS = {"u.s", "u.k"}

# The second question, asked ONLY about the set above: is the next word one that
# only a new sentence would start with?
#
# "Is it capitalised" carries no information here -- BOUNDARY_RE has already
# required a capital, so "U.S. Census Bureau", "U.S. Congress" and "U.S.
# Department of Defense" all look identical to "U.S. Later work agreed." What
# separates them is word CLASS: a continuation is an open-class noun, while a new
# sentence very often opens with a closed-class function word. This set is that
# closed class, written out, because there is no part-of-speech tagger in this
# pipeline and adding one for two abbreviations would be larger than the bug.
#
# A word that is NOT here does not split. That is the safe failure: "in the U.S.
# Milgram replicated it." stays one Sentence and costs a pause, rather than
# "(U.S. Census Bureau, n.d.)" -- real text at fixtures/figures.html:182 --
# gaining one inside a proper noun.
SENTENCE_OPENERS = {
    # Pronouns and demonstratives.
    "i", "it", "he", "she", "they", "we", "you", "this", "that", "these",
    "those", "there", "his", "her", "its", "their", "our", "your",
    # Articles and quantifiers.
    "a", "an", "the", "all", "both", "each", "every", "few", "many",
    "most", "much", "several", "some", "such",
    # Conjunctions and contrastive adverbs.
    "and", "but", "yet", "so", "however", "therefore", "thus", "instead",
    "moreover", "furthermore", "nevertheless", "similarly",
    # Temporal and sequencing adverbs.
    "earlier", "later", "then", "now", "today", "recently", "finally",
    "meanwhile", "subsequently",
    # Subordinators and prepositions that open a clause.
    "after", "although", "as", "at", "because", "before", "by", "despite",
    "during", "for", "from", "if", "in", "on", "since", "though", "until",
    "when", "while", "with",
}

# The next word after a candidate boundary, looking past the whitespace and the
# opening quote or bracket BOUNDARY_RE allows. Matches nothing when a digit
# follows an opener -- "et al. (1963) found" -- which reads as no boundary.
NEXT_WORD_RE = re.compile(r'[\s"“(\[]*([A-Za-z]+)')


def _opens_a_sentence(text: str, end: int) -> bool:
    """True when the word at `end` is one only a new sentence would start with."""
    match = NEXT_WORD_RE.match(text, end)
    return match is not None and match.group(1).lower() in SENTENCE_OPENERS


def _is_false_boundary(text: str, end: int) -> bool:
    """True when the period at `end - 1` ends an abbreviation or a number.

    An abbreviation that can itself end a sentence is decided by what follows it
    rather than vetoed outright -- see SENTENCE_ENDING_ABBREVIATIONS.
    """
    head = text[:end].rstrip('"”’)]')
    if not head.endswith("."):
        return False

    # A decimal: digit, period, digit.
    if end < len(text) and head[:-1][-1:].isdigit() and text[end:end + 1].isdigit():
        return True

    word = re.split(r"[\s(\[]", head[:-1])[-1].lower()
    if word in ABBREVIATIONS:
        # Most abbreviations veto unconditionally: a title always precedes the
        # name it modifies, so "Dr. Milgram ran the study." is one Sentence
        # however the next word looks. The few that can also end a sentence get
        # a second question instead, and an ambiguous answer is still no split.
        if word in SENTENCE_ENDING_ABBREVIATIONS:
            return not _opens_a_sentence(text, end)
        return True
    # A single initial: "J. Smith".
    return len(word) == 1 and word.isalpha()


def _hard_wrap(text: str, offset: int, max_chars: int) -> list[tuple[int, int]]:
    """Break an over-long run into roughly EQUAL pieces on clause boundaries.

    Balanced, not greedy. A greedy wrap fills each piece to max_chars and leaves
    the remainder as the last piece, so a sentence only slightly over the cap
    splits into a full-length head and a stub: 304 chars became a 296-char head
    and the tail "loafing."

    That stub is not an internal fragment, it IS a sentence to everything
    downstream -- Supertonic speaks it as its own utterance, and the translator
    has to translate it with no context (opus-mt-en-it rendered "loafing." as
    "Paffuto.", "chubby"). 312 of the shipped book's 14,418 sentences were cut
    this way, and four of them landed in the QA gate's 472-sentence sample, where
    they scored as translation defects. Aiming for remaining/ceil(remaining/
    max_chars) keeps every piece substantial and still never exceeds max_chars.

    A `[[latex:<base64>]]` token is one atom and can never be cut, however long
    it is: base64 contains none of the boundary characters `_cut` looks for, so
    an uncorrected cut lands on the `target` fallback and slices through the
    token's payload. Nothing downstream is token-aware after that.
    `_push_past_token` moves any candidate cut that would land
    strictly inside a token span out to the token's end, which can make that
    one piece exceed max_chars. That is correct: a split atom is worse than an
    oversized one.
    """
    token_spans = [m.span() for m in MATH_TOKEN_RE.finditer(text)]

    def _push_past_token(pos: int) -> int:
        for tok_start, tok_end in token_spans:
            if tok_start < pos < tok_end:
                return tok_end
        return pos

    out = []
    start = 0
    while len(text) - start > max_chars:
        remaining = len(text) - start
        pieces = -(-remaining // max_chars)      # ceil, no import
        target = -(-remaining // pieces)
        window = text[start:start + target]
        cut = max(window.rfind("; "), window.rfind(", "), window.rfind(" "))
        cut = cut + 1 if cut > 40 else target
        cut = _push_past_token(start + cut) - start
        out.append((offset + start, cut))
        start += cut
    if text[start:].strip():
        out.append((offset + start, len(text) - start))
    return out


# Bump this whenever split_sentences or _hard_wrap changes where a boundary
# falls. It is folded into speech.json's `generatedFrom`
# (pipeline/tts_manifest.build_manifest), which is the staleness key every
# translated track is compared against by pipeline.tracks.needs_translation.
#
# Without it a splitter change is INVISIBLE to that check: generatedFrom hashed
# only the HTML, and re-splitting does not touch the page. Sentence ids are
# POSITIONAL (b10s0, b10s1, ...), so a re-split usually yields the same count and
# therefore the same ids while every boundary moves -- a track keyed by id still
# resolves, to the wrong sentence. Measured when _hard_wrap was fixed: 621
# sentences moved and the deployed Spanish track still answered 614 of them.
#
# Bumping this is EXPENSIVE and meant to be: it invalidates every track of every
# language and forces a full retranslate. That is the correct cost -- the
# alternative is shipping audio that does not match the text on screen.
#
#   1  greedy _hard_wrap; orphaned one-word tails ("loafing.")
#   2  balanced _hard_wrap
#   3  math spans are tokenised, so block text and every offset changed on any
#      page with an equation; _hard_wrap also treats a `[[latex:...]]` token as
#      unbreakable, pushing a cut that would land inside one out to the token's
#      end even when that makes the piece exceed max_chars.
SENTENCE_SPLIT_VERSION = 3


def split_sentences(text: str, max_chars: int = 300) -> list[tuple[int, int]]:
    if not text or not text.strip():
        return []

    spans = []
    start = 0
    for match in BOUNDARY_RE.finditer(text):
        end = match.end(1)
        if _is_false_boundary(text, end):
            continue
        spans.append((start, end - start))
        start = match.end()
    if text[start:].strip():
        spans.append((start, len(text) - start))

    out = []
    for offset, length in spans:
        if length <= max_chars:
            out.append((offset, length))
        else:
            out.extend(_hard_wrap(text[offset:offset + length], offset, max_chars))
    return out
