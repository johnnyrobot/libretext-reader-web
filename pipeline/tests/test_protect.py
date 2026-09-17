import pytest

from pipeline.protect import PlaceholderError, mask, restore, strip_placeholders

# A restricted ASCII-ish vocabulary standing in for what a real Marian checkpoint
# passes through. This is not upper()/identity: those preserve ANY input, which is
# exactly why the old ⸤URL0⸥ scheme's failure against the real
# opus-mt-tc-big-en-es checkpoint went undetected by the test suite. A real tokenizer
# drops codepoints outside its vocabulary rather than passing them through, and the
# measured, real-model behaviour was that U+2E24/U+2E25 (bottom half brackets) are
# exactly the kind of codepoint that gets dropped, while plain ASCII brackets,
# letters, digits and ordinary punctuation are not.
_MARIAN_LIKE_VOCAB = set(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
    " .,!?:;'\"()[]/_-=+@"
)


def marian_like(lines: list[str]) -> list[str]:
    """Stand-in translator that MODELS real tokenizer behaviour rather than
    preserving any input: it strips every character outside a restricted
    ASCII-ish vocabulary, the way Marian drops codepoints its vocabulary does not
    cover. Written to fail against the old U+2E24/U+2E25 placeholder scheme and
    pass against the current [[KIND0]] scheme (ruling R42) -- verified both ways."""
    return ["".join(c for c in line if c in _MARIAN_LIKE_VOCAB) for line in lines]


def test_placeholder_survives_a_tokenizer_that_drops_unknown_characters():
    """The regression test for the defect this module shipped with. A translator
    stand-in that merely preserves any input (e.g. the upper() stand-in
    pipeline/tests/test_translate.py uses) can never catch a placeholder shape
    that a real tokenizer mangles, because it never mangles anything -- which is
    exactly how this shipped undetected. This one does, and confirms the
    placeholder itself -- not just ordinary prose -- survives the trip intact."""
    masked, spans = mask("See https://example.org/a_b for details.")
    (survived,) = marian_like([masked])
    assert restore(survived, spans) == "See https://example.org/a_b for details."


def test_masks_and_restores_a_url():
    masked, spans = mask("See https://example.org/a_b for details.")
    assert "https://example.org/a_b" not in masked
    assert len(spans) == 1
    assert restore(masked, spans) == "See https://example.org/a_b for details."


def test_masks_math_tokens():
    source = "The result [[latex:eDpeMg==]] follows."
    masked, spans = mask(source)
    assert "eDpeMg==" not in masked
    assert restore(masked, spans) == source


def test_placeholders_survive_word_reordering():
    """A translator reorders words; restore must still work."""
    masked, spans = mask("Visit https://example.org now.")
    placeholder = next(iter(spans))
    reordered = f"Ahora visite {placeholder}."
    assert restore(reordered, spans) == "Ahora visite https://example.org."


def test_dropped_placeholder_is_an_error_not_a_warning():
    _, spans = mask("Visit https://example.org now.")
    with pytest.raises(PlaceholderError, match="missing"):
        restore("Ahora visite el sitio.", spans)


def test_duplicated_placeholder_is_an_error():
    masked, spans = mask("Visit https://example.org now.")
    placeholder = next(iter(spans))
    with pytest.raises(PlaceholderError, match="twice"):
        restore(f"{placeholder} y {placeholder}", spans)


def test_text_with_no_protected_spans_round_trips_unchanged():
    source = "Ordinary prose with nothing to protect."
    masked, spans = mask(source)
    assert masked == source
    assert spans == {}
    assert restore(masked, spans) == source


def test_strip_placeholders_removes_them_for_scoring():
    masked, _ = mask("Visit https://example.org now.")
    assert strip_placeholders(masked).split() == ["Visit", "now."]


def test_masks_adjacent_spans_of_different_kinds_with_no_whitespace():
    """A MATH span directly abutting a URL span, with no separating whitespace,
    must not let the URL pattern's greedy match swallow the MATH placeholder
    that was already substituted in during the earlier pass."""
    source = "See http://example.com[[latex:eDpeMg==]] end."
    masked, spans = mask(source)
    assert len(spans) == 2
    assert restore(masked, spans) == source


def test_masks_uppercase_scheme_url():
    source = "See HTTP://EXAMPLE.COM for details."
    masked, spans = mask(source)
    assert "HTTP://EXAMPLE.COM" not in masked
    assert len(spans) == 1
    assert restore(masked, spans) == source


# --- Bare-domain URLs (no scheme, no www.) ------------------------------------


def test_a_bare_domain_url_is_protected():
    """Measured on the real staged page: `commons.wikimedia.org/wiki/File:...`
    carries neither `https://` nor `www.`, so it was never masked, and the real
    opus-mt-tc-big-en-es checkpoint rewrote it -- `File:` became `Archivo:`,
    the underscores were stripped and `Yitzhak` came back as `YYitzhak`. Then
    pipeline/lang_normalize.py read the `09` in the date as "cero nueve",
    because a normaliser is entitled to assume anything still visible to it is
    prose."""
    text = ("Source: commons.wikimedia.org/wiki/File:Bill_Clinton,_Yitzhak_Rabin"
            "_at_the_White_House_1993-09-13.jpg")
    masked, spans = mask(text)
    assert "wikimedia" not in masked
    assert len(spans) == 1
    assert restore(masked, spans) == text


def test_a_bare_domain_url_survives_a_real_tokenizer():
    text = "Ver creativecommons.org/licenses/by-nc-sa/3.0/ para la licencia."
    masked, spans = mask(text)
    (survived,) = marian_like([masked])
    assert restore(survived, spans) == text


def test_a_bare_domain_with_no_path_is_still_protected():
    text = "Donations go to libretexts.org today."
    masked, spans = mask(text)
    assert len(spans) == 1
    assert restore(masked, spans) == text


@pytest.mark.parametrize("text", [
    # A DOI is the dangerous lookalike: `10.1177/0956797611398495` has exactly
    # the `label.label/path` shape a bare domain does. It is told apart by its
    # TLD being NUMERIC -- every real TLD is alphabetic -- and every DOI in the
    # staged book's reference list has this shape.
    "doi: 10.1177/0956797611398495.",
    "doi: 10.1002/ejsp.375.",
    "See Figure 13.1 for the layout.",
    "Many norms, e.g., fairness, guide behavior.",
    "That is, i.e., the ingroup.",
    "(4th ed., Vols. 1 and 2, pp. 595-629).",
    "Attitudes in the U.S. Government are mixed.",
])
def test_things_that_look_like_a_bare_domain_but_are_not(text):
    """A false positive here is silent and expensive: the span is replaced by a
    placeholder, restored verbatim, and whatever real prose it swallowed is
    never spoken in the target language. Everything in this list is real
    content from the staged book or its fixtures."""
    masked, spans = mask(text)
    assert spans == {}, f"{text!r} must not be treated as a URL"
    assert masked == text


def test_a_hash_filename_is_claimed_as_a_FILE_and_never_as_a_url():
    """Moved out of the bare-domain list above when FILE_RE was added, and kept
    rather than deleted: its point was that `d67b...fb.jpg` has the
    `label.label` shape a bare domain has and must NOT be claimed as a URL. That
    is still true and still worth asserting -- what changed is that a different
    pattern now claims it legitimately, which is a repoint, not a weakening."""
    text = "Image unavailable: d67b022f5b1e28272a5d29f61be9d6fb.jpg"
    masked, spans = mask(text)
    assert list(spans) == ["[[FILE0]]"], "must be a FILE span, not a URL span"
    assert restore(masked, spans) == text


def test_an_email_is_still_claimed_as_an_email_not_as_a_url():
    """Regression for the ordering this change requires. An address's domain
    (`example.org`) matches the bare-domain URL rule on its own, so with URL
    running first the domain was masked out from under EMAIL, leaving a bare
    `john@` behind and the address itself unprotected."""
    masked, spans = mask("Write to john@example.org today.")
    assert len(spans) == 1
    assert list(spans.values()) == ["john@example.org"]
    assert restore(masked, spans) == "Write to john@example.org today."


# --- Measured failures from the first shipped Spanish run ----------------------


def test_a_parenthesised_url_leaves_its_closing_paren_behind():
    """Measured on `b0s0` of the deployed book. The URL class allows ')' -- it
    excludes only whitespace and the placeholder delimiters -- so
    `(https://LibreTexts.org)` masked as span `https://LibreTexts.org)`, closing
    paren included, and the model was handed `Project ([[URL0]] and like...`: an
    opening bracket with nothing to close it. It repaired the sentence by
    rewriting the placeholder, `restore()` raised, and the sentence fell back to
    English.

    A ')' with no matching '(' inside the span is punctuation around the URL,
    not part of it."""
    source = 'the LibreTexts Project (https://LibreTexts.org) and like the others'
    masked, spans = mask(source)
    assert list(spans.values()) == ["https://LibreTexts.org"]
    assert masked == "the LibreTexts Project ([[URL0]]) and like the others"
    assert restore(masked, spans) == source


def test_a_url_that_really_contains_balanced_parens_keeps_them():
    """The counter-case, and the reason the rule counts rather than just
    stripping a trailing ')': Wikipedia-style paths carry a genuine pair."""
    source = "See en.wikipedia.org/wiki/Mercury_(planet) for more."
    masked, spans = mask(source)
    assert list(spans.values()) == ["en.wikipedia.org/wiki/Mercury_(planet)"]
    assert restore(masked, spans) == source


def test_restore_accepts_a_placeholder_the_model_stripped_one_bracket_layer_from():
    """Measured against the real opus-mt-tc-big-en-es checkpoint on `b0s0`:
    `Project ([[URL0]] and like...` came back as `Project ([URL0]) y al igual...`.
    The token itself survived -- kind, digit, ordering, all intact -- and only
    one layer of brackets was lost.

    Sec4 of the normalise-order finding records `[[KIND0]]` as measured to
    survive a well-formed sentence 5/5; this is the counter-example, and it
    shows the failure mode is PARTIAL. Raising on it throws away a translation
    that is sitting right there, correct, one bracket short."""
    masked, spans = mask("Visit https://libretexts.org for details.")
    degraded = masked.replace("[[URL0]]", "[URL0]")
    assert degraded != masked
    assert restore(degraded, spans) == "Visit https://libretexts.org for details."


def test_a_single_bracket_placeholder_seen_twice_is_still_an_error():
    """The relaxed match must not relax the duplicate check with it: a model that
    emitted the token twice produced two URLs where the source had one, and
    falling back to English is the correct outcome."""
    masked, spans = mask("Visit https://libretexts.org for details.")
    degraded = masked.replace("[[URL0]]", "[URL0] and [URL0]")
    with pytest.raises(PlaceholderError):
        restore(degraded, spans)


def test_a_parenthesised_url_followed_by_a_comma_leaves_both_behind():
    """Measured on `b7s0`. Trimming only a trailing ')' is not enough: the URL
    class also allows ',', so `(http://www.innocenceproject.org), "The human...`
    matched the span `http://www.innocenceproject.org),` -- ending in a comma, so
    the paren rule never fired, and the sentence went out unbalanced anyway. The
    model repaired it, and restoring the span put BOTH characters back after the
    paren the model had added: `...org),):`.

    Trailing sentence punctuation is not part of a URL either. Peel it, then
    re-test the paren."""
    source = 'in the Innocence Project (http://www.innocenceproject.org), the mind'
    masked, spans = mask(source)
    assert list(spans.values()) == ["http://www.innocenceproject.org"]
    assert masked == "in the Innocence Project ([[URL0]]), the mind"
    assert restore(masked, spans) == source


def test_a_url_ending_a_sentence_does_not_swallow_the_full_stop():
    source = "Donations go to libretexts.org."
    masked, spans = mask(source)
    assert list(spans.values()) == ["libretexts.org"]
    assert restore(masked, spans) == source


def test_restore_accepts_an_asymmetrically_stripped_placeholder():
    """Measured on `b18s0`, `b19s0`, `b20s0`, `b15s0` and `b30s1..3` -- every
    sentence whose entire content is a URL. Masked to a bare `[[URL0]]`, the
    checkpoint returned `[[URL0]`: it dropped one CLOSING bracket and kept both
    opening ones.

    Matching the degraded form as a plain substring is what makes this dangerous
    rather than merely unhandled: `[[URL0]`.count(`[URL0]`) is 1, so a substring
    fallback substitutes the URL and leaves the orphan `[` behind, shipping
    `[http://www.bbc.com/...` into the track. Falling back to English is better
    than that. Consuming one-or-two brackets on EACH side independently is what
    makes the recovery safe."""
    masked, spans = mask("http://www.bbc.com/news/world-europe-25778272")
    assert masked == "[[URL0]]"
    assert restore("[[URL0]", spans) == "http://www.bbc.com/news/world-europe-25778272"
    assert restore("[URL0]]", spans) == "http://www.bbc.com/news/world-europe-25778272"


def test_restore_still_refuses_a_placeholder_with_no_brackets_at_all():
    """The recovery is for a LOST BRACKET LAYER, not for a bare token. `URL0`
    with no brackets is the shape the old U+2E24/U+2E25 scheme failed with, and
    accepting it would mean matching a two-to-five character run of ordinary
    uppercase text -- an unmeasured risk taken to save a sentence that already
    has a correct fallback."""
    masked, spans = mask("http://www.bbc.com/news/world-europe-25778272")
    with pytest.raises(PlaceholderError):
        restore("Consulte URL0 para detalles.", spans)


def test_masks_a_bare_image_filename():
    """A filename is not prose, and leaving it visible corrupts it twice over.

    MEASURED on the deployed book: 29 file-like tokens, 22 of them NOT inside a
    URL and so unprotected. `1.1-collage-0-1024x1024.jpg` reached
    pipeline/lang_normalize.py as ordinary text and came out
    `uno punto uno-collage-zero-1024x1024.jpg`, which is what the voice says out
    loud. `House_1993-09-13.jpg` has a YEAR in it and was read as
    "millenovecentonovantatré". Spanish and French are live with this today."""
    masked, spans = mask("Vedi 1.1-collage-0-1024x1024.jpg per i dettagli.")
    assert masked == "Vedi [[FILE0]] per i dettagli."
    assert restore(masked, spans) == "Vedi 1.1-collage-0-1024x1024.jpg per i dettagli."


@pytest.mark.parametrize("name", [
    "0992d48b1d50f5184c38ed87192a346e.jpg",   # hash filename
    "4.1-collage.jpg",
    "2.2-collage-2-1024x341.jpg",
    "1.3.0.jpg",                               # dotted, version-like
    "House_1993-09-13.jpg",                    # carries a year
])
def test_masks_every_filename_shape_the_book_actually_contains(name):
    masked, spans = mask(f"Credito: {name}")
    assert masked == "Credito: [[FILE0]]"
    assert restore(masked, spans) == f"Credito: {name}"


def test_a_filename_inside_a_url_stays_one_url_span():
    """URL runs before FILE, so a filename inside a URL is claimed whole rather
    than split into two placeholders -- 7 of the book's 29 file-like tokens are
    this shape."""
    masked, spans = mask("Fonte: http://commons.wikimedia.org/wiki/File:Copernicus.jpg qui")
    assert masked == "Fonte: [[URL0]] qui"
    assert "FILE" not in masked


def test_prose_that_merely_ends_in_a_word_is_not_a_filename():
    """The false-positive risk is the same one the TLD list exists for: a masked
    span is restored verbatim and NEVER spoken in the target language. The
    extension list is explicit for that reason."""
    for text in ("costa 4.50 in totale", "vedi la figura 1.1 qui", "il file era grande"):
        masked, _ = mask(text)
        assert masked == text


def test_restore_accepts_a_placeholder_whose_KIND_WORD_was_translated():
    """MEASURED on the deployed corpora, and it is 53 sentences across three
    LIVE languages -- more than twice the bracket damage this module already
    tolerates:

        nl  [[FILE0]] -> [[BESTAND0]]   22    translated outright
        da  [[FILE0]] -> [[FIL0]]       21    translated outright
        sv  [[URL0]]  -> [[Url0]]       10    case-folded

    `FILE` is an ordinary English noun, so a translator has every reason to
    translate it; `URL` mostly survives because it is an acronym. Each of these
    raised PlaceholderError and the sentence fell back to English -- nothing
    crashed and nothing looked wrong, which is why counting found it and 3,098
    passing tests did not.

    The token is intact in every one: same brackets, same INDEX, different word.
    Recovering it costs nothing that the bracket tolerance above does not
    already cost, because `mask()` numbers placeholders with ONE counter across
    all kinds, so an index identifies a span on its own."""
    masked, spans = mask("Image unavailable: cat.jpg")
    assert masked == "Image unavailable: [[FILE0]]"
    assert restore("Afbeelding niet beschikbaar: [[BESTAND0]]", spans) == \
        "Afbeelding niet beschikbaar: cat.jpg"
    assert restore("Billede er ikke tilgængeligt: [[FIL0]]", spans) == \
        "Billede er ikke tilgængeligt: cat.jpg"
    assert restore("Bild otillgänglig: [[Url0]]", spans) == "Bild otillgänglig: cat.jpg"


def test_restore_keeps_two_translated_placeholders_apart_by_their_index():
    """The index is what makes this safe rather than merely lenient. A sentence
    with two spans gets 0 and 1 from the same counter, so a translated kind word
    can never pull the wrong span back."""
    masked, spans = mask("Source: http://example.com/a and cat.jpg")
    assert masked == "Source: [[URL0]] and [[FILE1]]"
    assert restore("Forrás: [[Url0]] és [[FIL1]]", spans) == \
        "Forrás: http://example.com/a és cat.jpg"


def test_restore_still_falls_back_when_a_placeholder_is_DROPPED():
    """The tolerance recovers a DAMAGED token, never an absent one. A model that
    dropped the placeholder has produced a sentence with no way to say what was
    there, and English is the right answer -- which is also why the probe's
    two-placeholder failures are not fixed by any of this."""
    _, spans = mask("Image unavailable: cat.jpg")
    with pytest.raises(PlaceholderError):
        restore("Afbeelding niet beschikbaar.", spans)


def test_restore_still_refuses_a_translated_placeholder_with_no_brackets():
    """Same discipline the bracketless `URL0` case is held to: matching a short
    run of ordinary letters and a digit in running text is an unmeasured risk
    taken to save a sentence that already has a correct fallback."""
    _, spans = mask("Image unavailable: cat.jpg")
    with pytest.raises(PlaceholderError):
        restore("Afbeelding niet beschikbaar: BESTAND0", spans)


def test_restore_still_refuses_a_translated_placeholder_that_appears_twice():
    _, spans = mask("Image unavailable: cat.jpg")
    with pytest.raises(PlaceholderError):
        restore("Beschikbaar: [[BESTAND0]] en [[BESTAND0]]", spans)
