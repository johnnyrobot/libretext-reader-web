"""Spans that must survive translation byte-identical.

Neural MT reorders, translates, truncates and hallucinates inside anything it does
not recognise as opaque. A base64 math token is the worst case: it looks like text,
so the model rewrites it, and the corruption is silent.

The placeholder shape matters. It must survive tokenisation without being split,
must not look like a word the model wants to translate, and must be findable after
the model has moved it to a different position in the sentence. Bracketed uppercase
ASCII with a digit satisfies all three across the Marian models in use.

R42: the shape actually used is `[[KIND0]]` -- double square ASCII brackets, matching
the existing `[[latex:...]]` / `[[mathml:...]]` token shape. This was measured, not
assumed. The original scheme used U+2E24/U+2E25 (bottom half brackets) on the theory
that ASCII-only exotic characters would be "left alone by Marian's tokeniser" -- that
theory was wrong. Round-tripped through the real, converted
`Helsinki-NLP/opus-mt-tc-big-en-es` checkpoint, Marian's tokeniser does not preserve
U+2E24/U+2E25 in either direction: it drops them from its vocabulary and emits the
bare kind+digit, e.g. "See ⸤URL0⸥ for details." came back as "Consulte URL0 para...".
`restore()` then finds no `⸤URL0⸥` in the output and raises -- which is why every
sentence containing a URL, email address or math token was silently dropped to
English in every shipped language. `[[KIND0]]`, by contrast, was measured to survive
both directions intact. Do not "improve" this back to an exotic Unicode bracket --
that is exactly the choice that shipped broken. The repro is the measured limit
below.

Measured limit on that claim (2026-08-24, real opus-mt-tc-big-en-es): `[[KIND0]]`
survives a WELL-FORMED sentence reliably -- 5/5, including all three real
scheme-less URLs from the staged social_psychology page. It does NOT survive
unconditionally. The staged page's image credit carries a spurious space inside
its URL (`..._at_the_White_ House_1993-09-13.jpg`), so masking leaves
`Source: [[URL0]] House_1993-09-13.jpg` -- a sentence that is mostly
non-linguistic debris -- and the checkpoint rewrote the whole thing as
"Fuente: House House1993-09-13.jpg", deleting the placeholder. `restore()` then
raises and pipeline/translate.py drops the sentence to English, which is the
designed graceful path, not a crash. Worth knowing before anyone reads "measured
to survive" as "always survives": the failure mode is a lost sentence, and it
correlates with how little real prose surrounds the placeholder.

2026-08-25, measured against all 23 sentences the first shipped Spanish run
dropped: that "5/5" was true and still misleading, because it counted a sentence
as lost when the placeholder had in fact SURVIVED. Two distinct things were being
scored as one:

  - The token is gone -- deleted or rewritten past recognition. Genuine loss, and
    English is the right answer. 2 of the 23 (`b12s2`, the spurious-space debris
    above, and `b88s0`, where the checkpoint simply dropped a trailing URL).
  - The token is intact and only its BRACKETS were damaged -- `([[URL0]] ...`
    came back as `([URL0]) ...`, and a URL-only sentence masked to `[[URL0]]`
    came back as `[[URL0]`. Nothing about the translation is wrong. 21 of the 23.

`restore()` now recovers the second kind (one or two brackets on each side,
independently), and `mask()` no longer creates the condition that provokes it by
swallowing the punctuation around a URL. Both are measured, both are below; the
recovery deliberately stops short of a bracket-less `URL0`.
"""

import re

PLACEHOLDER_RE = re.compile(r"\[\[[A-Z]+\d+\]\]")

# The TLDs a bare-domain URL is allowed to end in. An explicit list, not
# `[a-z]{2,}`, because the whole risk of matching a scheme-less URL is a FALSE
# POSITIVE: the span is replaced by a placeholder, restored verbatim, and any
# real prose it swallowed is never spoken in the target language -- silently.
# `[a-z]{2,}` would swallow "cooperation.Social" from a page whose extraction
# dropped a space, which is a shape this corpus really does produce.
#
# Every bare-domain URL measured in the staged social_psychology page ends in
# .org (commons.wikimedia.org, creativecommons.org, academy.libretexts.org); the
# rest are here because they are the TLDs academic OER prose actually uses.
_TLD = r"(?:org|com|edu|net|gov|int|mil|info|io)"

# A scheme-less, www-less URL: `commons.wikimedia.org/wiki/File:...`. Real, and
# previously unprotected -- the checkpoint rewrote `File:` to `Archivo:`, dropped
# the underscores and doubled a letter, and then lang_normalize.py read the `09`
# in the trailing date as "cero nueve", because anything still visible to a
# normaliser is prose as far as it knows.
#
# Two guards make this safe against the shape it is easiest to confuse with, a
# DOI (`10.1177/0956797611398495` is also `label.label/path`):
#
#   1. The TLD must come from _TLD above, so it is ALPHABETIC. A DOI's is always
#      numeric -- `1177`, `1002`, `1111` -- and there is no numeric TLD to
#      collide with. This is the load-bearing guard.
#   2. Labels are 2+ characters, so a single initial cannot start a match --
#      "U.S.Gov" from a de-spaced extraction yields no match rather than
#      swallowing "S.Gov".
#
# The path is optional: "donations go to libretexts.org" is ordinary book prose,
# and with an explicit TLD list plus the trailing \b there is nothing for a bare
# `word.org` to false-positive on ("Organization" fails the \b).
_BARE_DOMAIN = rf"\b(?:[a-z0-9-]{{2,}}\.)+{_TLD}\b(?:/[^\s\[\]]*)?"

# The one definition of "this is a URL" in the pipeline. pipeline/normalize.py
# imports it rather than keeping a second copy: it had one, and the two drifted
# in exactly the way two copies do -- BOTH missed scheme-less URLs, so the same
# `commons.wikimedia.org/wiki/File:...` credit line was mangled by the
# translator on one path and read aloud digit by digit on the other.
URL_RE = re.compile(
    rf"\bhttps?://[^\s\[\]]+|\bwww\.[^\s\[\]]+|{_BARE_DOMAIN}", re.I)


# Order matters, twice over.
#
# MATH is claimed before URLs, because a base64 payload can contain a '/' run
# that the URL pattern below would otherwise bite into.
#
# EMAIL is claimed before URLs, which it did NOT used to be. Once _BARE_DOMAIN
# exists, an address's own domain (`example.org` inside `john@example.org`)
# matches the URL rule on its own -- so with URL running first, the domain was
# masked out from under EMAIL and the address shipped as a naked `john@`. EMAIL
# requires an '@', so it can never make the opposite mistake and eat a plain URL.
#
# The URL pattern's greedy classes exclude the placeholder delimiters ('[' and ']')
# rather than using plain \S+, so a URL processed after MATH cannot swallow an
# already-placed MATH placeholder when the two spans sit adjacent with no separating
# whitespace. EMAIL's \w-based classes never match the delimiters, so it needs no such
# exclusion.
# A bare media filename: `1.1-collage-0-1024x1024.jpg`, `House_1993-09-13.jpg`.
# Not prose, and leaving it visible corrupts it twice over -- the checkpoint
# rewrites the stem, and then anything still visible to lang_normalize.py is
# prose as far as it knows, so `1.1-collage-0-...` was read aloud as
# "uno punto uno-collage-zero-..." and the year in `House_1993-09-13.jpg` as
# "millenovecentonovantatré". MEASURED on the deployed book: 29 file-like tokens,
# 22 of them NOT inside a URL and so unprotected until this existed. Spanish and
# French shipped with that defect.
#
# The extension list is EXPLICIT for the same reason _TLD above is, and it is the
# same risk: a false positive is replaced by a placeholder, restored verbatim,
# and the prose it swallowed is never spoken in the target language -- silently.
# So this lists what an OER book actually embeds rather than `\w+`. Audio and
# video extensions are deliberately absent: none occur in this corpus, and a
# guess costs a silent swallow.
#
# The character class excludes whitespace and the placeholder delimiters, so a
# filename cannot reach backwards across a space into prose ("Figura 1.1. Il
# grafico.jpg" yields one match, not one spanning both), nor swallow an
# already-placed placeholder.
FILE_RE = re.compile(r"\b\w[\w.%-]*\.(?:jpe?g|png|gif|svg|webp|pdf)\b", re.IGNORECASE)

PROTECTED = [
    ("MATH", re.compile(r"\[\[(?:mathml|latex):[A-Za-z0-9+/=]+\]\]")),
    ("EMAIL", re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b")),
    ("URL", URL_RE),
    # AFTER url on purpose: 7 of the book's 29 file-like tokens sit inside a
    # wikimedia URL, and those must stay ONE span rather than splitting into a
    # URL placeholder plus a FILE placeholder.
    ("FILE", FILE_RE),
]


class PlaceholderError(ValueError):
    """A protected span did not survive translation intact."""


def _placeholder(kind: str, n: int) -> str:
    # [[ ]] -- double square ASCII brackets -- MUST agree with PLACEHOLDER_RE above.
    # Measured (R42) to survive the real opus-mt-tc-big-en-es checkpoint in both
    # directions; the exotic U+2E24/U+2E25 pair this replaced did not (see module
    # docstring). This shape also matches the existing `[[latex:...]]` /
    # `[[mathml:...]]` MATH token convention, and cannot collide with it: MATH
    # requires a literal `mathml:` or `latex:` prefix inside the brackets, which
    # `[A-Z]+\d+` (uppercase kind + digit, no colon) never matches.
    return f"[[{kind}{n}]]"


# Punctuation that ends a sentence or clause, never a URL. Peeled off the end of
# a matched URL span so it stays visible to the translator as ordinary text.
_TRAILING_PUNCT = ".,;:!?"


def _split_trailing_punctuation(span: str) -> tuple[str, str]:
    """Split a matched URL into the URL and the punctuation sitting after it.

    The URL classes exclude only whitespace and the placeholder delimiters, so
    they happily eat the punctuation that follows a URL in prose.
    `(https://LibreTexts.org)` matched WITH its closing paren, which masked to
    `Project ([[URL0]] and like...` -- an opening bracket with nothing to close
    it. The real opus-mt-tc-big-en-es checkpoint repaired the sentence by
    rewriting the placeholder, restore() raised, and the whole sentence fell back
    to English. Measured on `b0s0` of the deployed book, one of the seven
    failures behind Spanish's 1.48% margin.

    Two rules, applied until the span stops shrinking, because they feed each
    other -- `...org),` needs the comma peeled before the paren underneath it can
    be seen at all (measured on `b7s0`, where trimming only ')' left the span
    ending in ',' and the sentence went out unbalanced anyway):

      1. A trailing '.', ',', ';', ':', '!' or '?' is sentence punctuation.
      2. A trailing ')' with no opener inside the span is punctuation around the
         URL. COUNTING rather than just stripping is what keeps
         `en.wikipedia.org/wiki/Mercury_(planet)` intact -- there the paren is
         part of the path and its opener is inside the span.

    Peeling is safe by construction: the tail is re-emitted immediately after the
    placeholder, so the sentence the translator sees is unchanged apart from the
    punctuation no longer hiding inside an opaque token.
    """
    tail = ""
    while span:
        if span[-1] in _TRAILING_PUNCT:
            span, tail = span[:-1], span[-1] + tail
        elif span.endswith(")") and span.count(")") > span.count("("):
            span, tail = span[:-1], ")" + tail
        else:
            break
    return span, tail


def mask(text: str) -> tuple[str, dict[str, str]]:
    spans: dict[str, str] = {}
    out = text
    counter = 0
    for kind, pattern in PROTECTED:
        def swap(match: re.Match) -> str:
            nonlocal counter
            span = match.group(0)
            # URL only: MATH's own brackets are balanced by construction, and an
            # address cannot end in ')' and still match EMAIL's \b-anchored class.
            tail = ""
            if kind == "URL":
                span, tail = _split_trailing_punctuation(span)
            token = _placeholder(kind, counter)
            counter += 1
            spans[token] = span
            return token + tail

        out = pattern.sub(swap, out)
    return out, spans


def kind_of(token: str) -> str:
    """`[[FILE0]]` -> `FILE`. The kind and its index are stored fused in the
    token, and both halves are needed separately once a checkpoint can damage
    one without the other."""
    return re.match(r"[A-Za-z]+", token.strip("[]")).group(0)


def restore(text: str, spans: dict[str, str]) -> str:
    out = text
    for token, original in spans.items():
        # R42 follow-up, measured on the real opus-mt-tc-big-en-es checkpoint:
        # `Project ([[URL0]] and like...` came back as `Project ([URL0]) y al
        # igual...`. The token survived -- kind, digit and position all intact --
        # and only ONE LAYER OF BRACKETS was lost. The module docstring above
        # records `[[KIND0]]` as measured to survive a well-formed sentence 5/5;
        # this is the counter-example, and what it shows is that the failure mode
        # is PARTIAL rather than total. Raising on it discards a translation that
        # is sitting there, correct, one bracket short -- and the cost of that is
        # a whole sentence read in English.
        #
        # The match must CONSUME the brackets it finds, one or two on each side
        # INDEPENDENTLY, rather than looking for the degraded token as a
        # substring. Substring matching is what makes this dangerous instead of
        # merely incomplete: the checkpoint's actual output for a URL-only
        # sentence was `[[URL0]` -- both opening brackets kept, one closing
        # bracket lost -- and `"[[URL0]".count("[URL0]")` is 1, so a substring
        # fallback substitutes the URL and leaves the orphan `[` in the track,
        # shipping `[http://www.bbc.com/...` to be read aloud. Falling back to
        # English beats that. Measured on b15s0, b18s0, b19s0, b20s0 and b30s1-3.
        #
        # A bare `URL0` with NO brackets is deliberately not accepted: that is the
        # shape the old U+2E24/U+2E25 scheme failed with, and matching a short run
        # of ordinary uppercase text is an unmeasured risk taken to save a
        # sentence that already has a correct fallback.
        #
        # The duplicate check covers the degraded forms too -- a model that
        # emitted the token twice made two URLs out of one.
        pattern = re.compile(rf"\[{{1,2}}{re.escape(token.strip('[]'))}\]{{1,2}}")
        found = pattern.findall(out)
        if not found:
            # The token is intact and only its KIND WORD was damaged. Measured on
            # the deployed corpora, and it is 53 sentences across three LIVE
            # languages -- more than twice the bracket damage above:
            #
            #     nl  [[FILE0]] -> [[BESTAND0]]   22   translated outright
            #     da  [[FILE0]] -> [[FIL0]]       21   translated outright
            #     sv  [[URL0]]  -> [[Url0]]       10   case-folded
            #
            # `FILE` is an ordinary English noun and a translator has every
            # reason to translate it; `URL` mostly survives because it is an
            # acronym. Every one of the 53 raised below and fell back to English,
            # and none of it looked like a failure from anywhere.
            #
            # Renaming the kind to something opaque was measured first and does
            # NOT solve this: across the eight shipping checkpoints the best
            # candidate survived 22 of 24 probes and nothing reached 24
            # (bench/formats/probe_placeholder.py). The residual failure is a
            # DROPPED placeholder, which no naming choice can fix and which this
            # branch deliberately does not either -- see below.
            #
            # THE INDEX is what makes this safe rather than merely lenient.
            # `mask()` numbers placeholders with ONE counter across all kinds, so
            # an index identifies a span on its own and a translated kind word
            # cannot pull the wrong span back. The closing bracket anchors it, so
            # index 0 cannot match `[[BESTAND10]]`.
            index = token.strip("[]")[len(kind_of(token)):]
            pattern = re.compile(rf"\[{{1,2}}[A-Za-z]+{index}\]{{1,2}}")
            found = pattern.findall(out)
        if not found:
            # Still nothing: the placeholder was DROPPED, not damaged. There is
            # no way to say what was there, so English is the right answer --
            # which is also why the probe's two-placeholder failures stay unfixed.
            raise PlaceholderError(f"placeholder {token} missing from translated text")
        if len(found) > 1:
            raise PlaceholderError(f"placeholder {token} appears twice in translated text")
        out = pattern.sub(lambda _: original, out, count=1)
    return out


def strip_placeholders(text: str) -> str:
    """Drop placeholders entirely. Used for QA scoring, where a placeholder on both
    sides of a round trip would otherwise be counted as a matching token and inflate
    the score, and a placeholder on only one side would deflate it."""
    return PLACEHOLDER_RE.sub("", text)
