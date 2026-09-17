import json
import re
from pathlib import Path

import pytest

from pipeline.tts_manifest import (
    ALLOWED_BOOKS,
    OutOfScopeError,
    build_manifest,
    process_page,
    resolve_book_dir,
    rewrite_page,
    unrewrite_page,
)

FIXTURES = Path(__file__).parent / "fixtures"


def load(name):
    return (FIXTURES / name).read_text(encoding="utf-8", errors="replace")


@pytest.fixture(scope="module")
def manifest():
    return build_manifest(load("prose.html"), page_id="social_psychology/x", title="X", lang="en")


@pytest.fixture(scope="module")
def tables_manifest():
    return build_manifest(load("tables.html"), page_id="social_psychology/1.03", title="1.03")


def test_manifest_is_serialisable_and_versioned(manifest):
    assert manifest["version"] == 1
    json.dumps(manifest)


def test_every_sentence_has_display_and_speech(manifest):
    sentences = [s for b in manifest["blocks"] for s in b["sentences"]]
    assert sentences
    for sentence in sentences:
        assert "display" in sentence and "speech" in sentence
        assert sentence["id"].startswith("b")


def test_sentence_ids_are_unique(manifest):
    ids = [s["id"] for b in manifest["blocks"] for s in b["sentences"]]
    assert len(ids) == len(set(ids))


def test_offsets_round_trip_against_the_block_text(manifest):
    for block in manifest["blocks"]:
        if block["kind"] == "notice":
            continue
        text = block["text"]
        for sentence in block["sentences"]:
            start = sentence["offset"]
            assert text[start:start + sentence["length"]] == sentence["display"]


def test_speech_text_differs_from_display_where_numbers_appear(manifest):
    pairs = [(s["display"], s["speech"]) for b in manifest["blocks"] for s in b["sentences"]]
    assert any(display != speech for display, speech in pairs)


def test_generated_from_changes_when_the_page_changes():
    a = build_manifest(load("prose.html"), "p", "t")
    b = build_manifest(load("prose.html").replace("</main>", "<p>New.</p></main>"), "p", "t")
    assert a["generatedFrom"] != b["generatedFrom"]


def test_stats_are_present_and_plausible(manifest):
    stats = manifest["stats"]
    assert stats["blocks"] == len(manifest["blocks"])
    assert stats["sentences"] > stats["blocks"] / 2
    assert stats["estimatedSeconds"] > 0


def test_a_read_table_is_visible_in_the_manifest_as_cells(tables_manifest):
    cells = [b for b in tables_manifest["blocks"] if b["kind"] == "tablecell"]
    assert cells
    for cell in cells:
        assert cell["anchor"]["path"]
        assert any(s["display"] for s in cell["sentences"])


def test_a_skipped_table_says_why_in_the_manifest(tables_manifest):
    skipped = [b for b in tables_manifest["blocks"] if b.get("skipped")]
    assert skipped
    whys = set()
    for block in skipped:
        assert block["skipped"]["reason"] == "table"
        assert block["skipped"]["why"] in {"no-header", "too-long", "structure"}
        whys.add(block["skipped"]["why"])
    assert "no-header" in whys


def test_the_two_table_outcomes_are_distinguishable(tables_manifest):
    whys = {b["skipped"]["why"] for b in tables_manifest["blocks"] if b.get("skipped")}
    cell_count = sum(1 for b in tables_manifest["blocks"] if b["kind"] == "tablecell")
    assert whys
    assert cell_count > 0


def test_every_table_cell_sentence_round_trips_through_the_manifest(tables_manifest):
    for block in tables_manifest["blocks"]:
        if block["kind"] == "notice":
            continue
        text = block["text"]
        for sentence in block["sentences"]:
            start = sentence["offset"]
            assert text[start:start + sentence["length"]] == sentence["display"]


def test_a_header_restatement_is_never_highlightable(tables_manifest):
    notice_blocks = [b for b in tables_manifest["blocks"] if b["kind"] == "notice"]
    assert notice_blocks
    for block in notice_blocks:
        for sentence in block["sentences"]:
            assert sentence["display"] == ""
            assert sentence["length"] == 0


def test_rewrite_turns_the_affordance_into_a_button():
    html = rewrite_page(load("prose.html"))
    # Asserts the button's IDENTITY, not one exact serialisation. The previous form
    # pinned the attribute order and broke the moment a style attribute was added --
    # a true failure about nothing, on a change that altered no behaviour it tested.
    assert '<button type="button" id="tts-enter" class="reader-link"' in html
    assert '</button>' in html
    assert '<div class="reader-link">' not in html


def test_rewrite_adds_the_boot_script_once_before_head_close():
    html = rewrite_page(rewrite_page(load("prose.html")))
    assert html.count('/_assets/tts/boot.js') == 1
    assert html.index('/_assets/tts/boot.js') < html.index('</head>')


def test_rewrite_leaves_a_page_without_the_affordance_untouched():
    source = "<html><head></head><body><main id='main-content'></main></body></html>"
    assert rewrite_page(source) == source


# --- Scope guard -------------------------------------------------------------
#
# Invariant: no page outside the allowlisted book is ever modified.
# A trusted directory argument is not that guarantee -- one typo rewrites a book
# whose only undo is re-pulling it from CXone. The allowlist is in code.


def test_the_allowlist_holds_exactly_the_books_in_scope():
    assert ALLOWED_BOOKS == frozenset(
        {"social_psychology", "math_elem_teachers", "chem_4b", "human_relations"})


def test_an_allowlisted_book_resolves(tmp_path):
    site = tmp_path / "site"
    (site / "social_psychology").mkdir(parents=True)
    assert resolve_book_dir(site / "social_psychology", site).name == "social_psychology"


def test_a_book_not_on_the_allowlist_is_refused(tmp_path):
    site = tmp_path / "site"
    (site / "chem101").mkdir(parents=True)
    with pytest.raises(OutOfScopeError, match="not on the allowlist"):
        resolve_book_dir(site / "chem101", site)


def test_the_site_root_itself_is_refused(tmp_path):
    """Pointing at the root would rewrite all 1,306 pages."""
    site = tmp_path / "site"
    site.mkdir(parents=True)
    with pytest.raises(OutOfScopeError):
        resolve_book_dir(site, site)


def test_a_path_escaping_the_site_root_is_refused(tmp_path):
    site = tmp_path / "site"
    (site / "social_psychology").mkdir(parents=True)
    (tmp_path / "elsewhere" / "social_psychology").mkdir(parents=True)
    with pytest.raises(OutOfScopeError):
        resolve_book_dir(site / ".." / "elsewhere" / "social_psychology", site)


def test_a_nested_directory_inside_an_allowlisted_book_is_refused(tmp_path):
    """`social_psychology/01:_Introducing/` has the right name nowhere in it,
    but a sibling book could; only a direct child of the site root is valid."""
    site = tmp_path / "site"
    (site / "chem101" / "social_psychology").mkdir(parents=True)
    with pytest.raises(OutOfScopeError):
        resolve_book_dir(site / "chem101" / "social_psychology", site)


# --- Pages with nothing to read ----------------------------------------------
#
# 16 of the book's 91 pages are chapter landing pages and front matter whose
# only content is a table-of-contents listing, correctly skipped as chrome.
# Injecting the button there offers a reader something the page cannot do.

EMPTY_PAGE = (
    "<html><head></head><body>"
    '<div class="reader-link">▣ Enter Reader Mode</div>'
    '<main id="main-content"><p class="x"></p>'
    '<div class="mt-guide-content"><ul class="mt-topic-hierarchy-listings">'
    '<li class="mt-list-topics">3.1: Prelude</li></ul></div>'
    "</main></body></html>"
)


def test_a_page_with_nothing_to_read_is_left_byte_identical(tmp_path):
    page = tmp_path / "index.html"
    page.write_text(EMPTY_PAGE, encoding="utf-8")
    process_page(page, page_id="social_psychology/03")

    assert page.read_text(encoding="utf-8") == EMPTY_PAGE
    assert not (tmp_path / "speech.json").exists()


def test_a_page_that_became_empty_has_its_injection_removed(tmp_path):
    """The pipeline rewrites in place, so a second run sees its own output.

    Without this, a page that once had prose keeps a button that now leads to
    'nothing could be matched' -- and re-pulling from CXone is the only undo.
    """
    page = tmp_path / "index.html"
    page.write_text(rewrite_page(EMPTY_PAGE), encoding="utf-8")
    (tmp_path / "speech.json").write_text("{}", encoding="utf-8")
    assert "tts-enter" in page.read_text(encoding="utf-8")

    process_page(page, page_id="social_psychology/03")

    after = page.read_text(encoding="utf-8")
    assert "tts-enter" not in after
    assert "boot.js" not in after
    assert '<div class="reader-link">▣ Enter Reader Mode</div>' in after
    assert not (tmp_path / "speech.json").exists()


def test_unrewrite_is_the_exact_inverse_of_rewrite():
    source = load("prose.html")
    assert unrewrite_page(rewrite_page(source)) == source


def test_a_page_with_prose_is_still_injected(tmp_path):
    page = tmp_path / "index.html"
    page.write_text(load("prose.html"), encoding="utf-8")
    process_page(page, page_id="social_psychology/13.01")

    assert "tts-enter" in page.read_text(encoding="utf-8")
    assert (tmp_path / "speech.json").exists()


# --- Uninstall ---------------------------------------------------------------
#
# Roadmap step 11 item 4 wants rollback to be one command decided in advance
# rather than during an incident. For the content half that is exact: rewrite_page
# has an inverse, so every page can be returned to what CXone produced.


def test_uninstall_returns_every_page_to_its_original_form(tmp_path):
    site = tmp_path / "site"
    book = site / "social_psychology" / "01:_Chapter" / "1.01:_Page"
    book.mkdir(parents=True)
    original = load("prose.html")
    (book / "index.html").write_text(original, encoding="utf-8")

    from pipeline.tts_manifest import install, uninstall

    assert install(site / "social_psychology", site) == 1
    assert "tts-enter" in (book / "index.html").read_text(encoding="utf-8")
    assert (book / "speech.json").exists()

    assert uninstall(site / "social_psychology", site) == 1
    assert (book / "index.html").read_text(encoding="utf-8") == original
    assert not (book / "speech.json").exists()


def test_uninstall_obeys_the_same_allowlist(tmp_path):
    site = tmp_path / "site"
    (site / "chem101").mkdir(parents=True)
    from pipeline.tts_manifest import OutOfScopeError, uninstall
    with pytest.raises(OutOfScopeError):
        uninstall(site / "chem101", site)


# --- the Enter Reader Mode button's size -------------------------------------
#
# The button reuses the mirror's own `.reader-link` class, which sets
# `font-size:13px; gap:6px`. That stylesheet is content-hash-named and shared by
# every page on the mirror, so it is not ours to edit -- and a stylesheet of our
# own would be a network request for every visitor who never presses the button,
# which is exactly what PRD NF1 forbids. So the size rides on the injected markup.

def test_the_button_carries_no_inline_style():
    """A style attribute on this button is guaranteed dead on the live mirror.

    The CSP is `style-src 'self'` plus four sha256 hashes and no 'unsafe-inline',
    so the browser parses the attribute and drops the declaration. It shipped that
    way: `style="font-size:16.25px"` was present in all 75 served pages and the
    live page computed 13px for every reader. Nothing local caught it because the
    staged server sent no CSP at all.

    The size lives in src/boot.js now, set through CSSOM, which CSP does not
    intercept. This test exists so it does not come back here -- the failure mode
    is silent, and "the markup is correct" is exactly what made it invisible.
    """
    html = rewrite_page(load("prose.html"))
    button = re.search(r'<button[^>]*id="tts-enter"[^>]*>', html).group(0)
    assert "style=" not in button, f"inline style is dropped by the mirror's CSP: {button}"
    assert "font-size" not in button


def test_the_button_still_carries_the_mirrors_class_and_id():
    """The size is additive. Dropping `reader-link` would strip the colour,
    inline-flex and alignment the mirror gives it, which is most of its look."""
    html = rewrite_page(load("prose.html"))
    assert 'id="tts-enter"' in html
    assert 'class="reader-link"' in html


def test_unrewrite_still_reverses_the_resized_button():
    """BUTTON_RE is the only way back. If it stops matching, unrewrite_page
    silently does nothing -- and the pipeline rewrites index.html IN PLACE, so a
    page that no longer has prose keeps a dead button forever and re-pulling the
    book from CXone is the only remedy. That is on the irreversible list."""
    source = load("prose.html")
    assert unrewrite_page(rewrite_page(source)) == source


def test_unrewrite_still_reverses_a_button_injected_BEFORE_the_resize():
    """THE ONE THAT PROTECTS WHAT IS ALREADY DEPLOYED. 91 live pages carry the
    old, un-styled button. A BUTTON_RE tightened to only match the new markup
    would fail to un-inject every one of them, silently, on the next refresh."""
    old_form = ('<html><head></head><body><main id="main-content">'
                '<button type="button" id="tts-enter" class="reader-link">'
                '▣ Enter Reader Mode</button></main></body></html>')
    out = unrewrite_page(old_form)
    assert '<div class="reader-link">▣ Enter Reader Mode</div>' in out
    assert "<button" not in out


def test_an_already_injected_page_picks_up_a_changed_button(tmp_path):
    """THE PIPELINE MUST BE ABLE TO CHANGE ITS OWN INJECTED MARKUP.

    `process_page` rewrites index.html IN PLACE, so from the second run onward its
    input is its own output. `rewrite_page` only converts `<div class="reader-link">`
    -- an already-injected page has a <button> and no div, so it matched nothing and
    the page came back unchanged.

    That made the injection idempotent BY ACCIDENT and un-updatable BY CONSEQUENCE:
    every one of the 91 live pages would keep whatever button it was first given,
    forever, and any change to the markup -- this resize, an aria-label, a fixed
    typo -- would appear to deploy and silently do nothing. The pipeline would report
    "91 pages injected" while changing none of them, which is the quiet kind of wrong.
    """
    page = tmp_path / "index.html"
    source = load("prose.html")
    # first run: a normal injection
    page.write_text(source, encoding="utf-8")
    assert process_page(page, page_id="p") is True
    first = page.read_text(encoding="utf-8")
    assert 'id="tts-enter"' in first

    # Simulate a page injected by an OLDER build -- exactly what the live mirror
    # has right now, since the CSP-dead style attribute was deployed to all 75.
    page.write_text(first.replace(
        '<button type="button" id="tts-enter" class="reader-link">',
        '<button type="button" id="tts-enter" class="reader-link" '
        'style="font-size:16.25px;gap:7.5px">'), encoding="utf-8")
    assert "font-size:16.25px" in page.read_text(encoding="utf-8")

    # second run: must bring the old page up to the current markup, which means
    # REMOVING the dead attribute. Same requirement as adding one, in reverse.
    assert process_page(page, page_id="p") is True
    after = page.read_text(encoding="utf-8")
    assert "font-size:16.25px" not in after, "an already-injected page kept the dead style"
    assert after.count('id="tts-enter"') == 1, "re-injection must not duplicate the button"
    assert after.count("/_assets/tts/boot.js") == 1, "nor duplicate the boot script"


def test_reprocessing_an_unchanged_page_is_a_no_op(tmp_path):
    """The other half: normalising before injecting must not make every run a diff.
    refresh.sh re-runs this after each pull, and a page that churns on every run
    would rewrite 91 files daily for nothing."""
    page = tmp_path / "index.html"
    page.write_text(load("prose.html"), encoding="utf-8")
    process_page(page, page_id="p")
    once = page.read_text(encoding="utf-8")
    process_page(page, page_id="p")
    assert page.read_text(encoding="utf-8") == once


def test_manifest_advertises_no_languages_before_translation(manifest):
    assert manifest["languages"] == []


def test_generated_from_is_not_a_bare_hash_of_the_html():
    """generatedFrom is the staleness key every translated track is compared
    against (pipeline.tracks.needs_translation). If it hashes only the HTML, then
    a change to the SENTENCE SPLITTER -- which rewrites what every sentence
    contains without touching the page -- leaves every track looking current.

    Measured when _hard_wrap was fixed: 621 sentences moved and the deployed
    Spanish track still answered 614 of them, under ids that are POSITIONAL and
    so survived the re-split unchanged. The track resolves, to the wrong
    sentence."""
    import hashlib
    html = load("prose.html")
    assert build_manifest(html, "p", "t")["generatedFrom"] != \
        hashlib.sha256(html.encode("utf-8")).hexdigest()


def test_generated_from_changes_when_the_sentence_splitter_changes(monkeypatch):
    import pipeline.tts_manifest as tm
    html = load("prose.html")
    before = build_manifest(html, "p", "t")["generatedFrom"]
    monkeypatch.setattr(tm, "SENTENCE_SPLIT_VERSION", tm.SENTENCE_SPLIT_VERSION + 1)
    assert build_manifest(html, "p", "t")["generatedFrom"] != before


import shutil

from pipeline.extract import MATH_TOKEN_RE, math_token
from pipeline.math_speech import FALLBACK_SPEECH, MathSpeaker

needs_node = pytest.mark.skipif(shutil.which("node") is None, reason="node is a build dependency")


@pytest.fixture(scope="module")
def math_manifest():
    if shutil.which("node") is None:
        pytest.skip("node is a build dependency")
    with MathSpeaker() as speaker:
        return build_manifest(load("math.html"), page_id="chem/1.04",
                              title="1.04: The First Law of Thermodynamics", speaker=speaker)


def _sentences(manifest):
    return [s for b in manifest["blocks"] for s in b["sentences"]]


def test_pages_without_math_carry_no_math_keys(manifest, tables_manifest):
    assert "mathSpeech" not in manifest and "math" not in manifest
    assert "mathSpeech" not in tables_manifest and "math" not in tables_manifest


@needs_node
def test_display_keeps_tokens_and_speech_has_words(math_manifest):
    first = next(s for s in _sentences(math_manifest) if "internal energy" in s["display"])
    assert MATH_TOKEN_RE.search(first["display"])
    assert first["speech"] == (
        "The change in internal energy is Delta U of the system equals q plus w for the system."
    )


@needs_node
def test_normaliser_still_runs_on_the_prose_around_a_token(math_manifest):
    year = next(s for s in _sentences(math_manifest) if "1963" in s["display"])
    assert "nineteen sixty three" in year["speech"]


@needs_node
def test_display_equation_is_its_own_sentence_with_pauses(math_manifest):
    eq = next(s for s in _sentences(math_manifest) if s["display"] == math_token(
        r"\[ \Delta U_{univ} = \Delta U_{sys} + \Delta U_{surr} = 0 \label{12.4.1a} \]"))
    assert eq["speech"] == (
        ", Delta U of the universe equals Delta U of the system"
        " plus Delta U of the surroundings equals zero,")


@needs_node
def test_site_quirks_are_spoken(math_manifest):
    ex = next(s for s in _sentences(math_manifest) if "Example" in s["display"])
    assert "1.4.1" in ex["speech"]
    # SRE reads the \ref target "12.4.1a" as \text{Equation 12.4.1a}, and its own
    # mtext-splitting rule puts a space before a letter that trails a digit run
    # (already observed for \PageIndex above, where the digit-dot-digit form is
    # cleaned by pipeline.math_phrasing.SPLIT_DOTTED_RE; the trailing bare letter
    # is not). This is SRE's wording, not a dropped token or a missing feature --
    # pinned to what the bridge actually emits.
    assert "Equation 12.4.1 a" in ex["speech"]
    assert "question mark" not in ex["speech"]
    assert "Delta U equals q minus w" in ex["speech"]      # \dU from the preamble


@needs_node
def test_mhchem_is_spoken(math_manifest):
    ch = next(s for s in _sentences(math_manifest) if "Burning" in s["display"])
    # "CH four", not "CH sub 4": numerals are spelled so the voice can pronounce
    # them, and a chemical subscript is not announced as "sub".
    assert "C H four" in ch["speech"] or "CH four" in ch["speech"]


@needs_node
def test_unconvertible_span_falls_back_and_is_counted(math_manifest):
    bad = next(s for s in _sentences(math_manifest) if "Nothing to speak" in s["display"])
    assert FALLBACK_SPEECH in bad["speech"]
    assert math_manifest["math"]["failed"] == 1
    assert math_manifest["math"]["spoken"] == len(math_manifest["mathSpeech"]) - 1


@needs_node
def test_math_speech_map_covers_every_token_in_the_page(math_manifest):
    tokens = {t for s in _sentences(math_manifest) for t in MATH_TOKEN_RE.findall(s["display"])}
    assert tokens == set(math_manifest["mathSpeech"])


@needs_node
def test_no_sentence_speech_ever_carries_a_raw_token(math_manifest):
    """Finding 3: the acceptance criterion `tests/e2e/equations.spec.js` checks
    on the staged Chem 4B page (`speech` never contains `latex:`) needs a real
    page on the mirror to run and has never run. This is the same assertion,
    browser-independent, over the fixture every other math test here already
    builds -- so it runs on every CI pass regardless of what is staged.
    """
    for sentence in _sentences(math_manifest):
        assert "latex:" not in sentence["speech"]


@needs_node
def test_preamble_paragraph_is_not_a_block(math_manifest):
    assert not any("newcommand" in b["text"] for b in math_manifest["blocks"])


def test_build_without_a_speaker_spawns_one_only_when_needed():
    # No math on this page: no node process is required or started.
    out = build_manifest(load("prose.html"), page_id="social_psychology/x", title="X")
    assert "mathSpeech" not in out


class _FakeSpeaker:
    """Speaks any TeX as a fixed phrase. No node process, so this test does not
    depend on it -- it is exercising the sentence splitter, not the bridge."""

    def reset(self, macros):
        pass

    def define(self, tex):
        pass

    def speak(self, tex, display):
        return "a long equation"


def test_a_page_with_an_oversized_token_has_no_raw_base64_in_any_speech():
    """Finding 1, end to end. Before the _hard_wrap fix, a token this long (the
    corpus's longest was 546 chars) was cut in half by the sentence splitter:
    split_math then found no complete token in either half, so
    normalize_for_speech ran over raw base64 and the sentence's `speech` WAS
    base64. No sentence built through build_manifest may ever contain a
    `latex:` substring in its speech.
    """
    long_tex = "x_{0} " + " ".join(f"+ x_{{{i}}}" for i in range(1, 45))
    html = (
        '<html><head><title>T</title></head><body><main id="main-content">'
        "<h1>T</h1>"
        "<p>This introductory clause runs on for quite a while before the "
        f"equation shows up here, \\( {long_tex} \\), and then the sentence "
        "keeps going for a good while afterward to add even more length so "
        "the whole thing must wrap.</p>"
        "</main></body></html>"
    )
    manifest = build_manifest(html, page_id="p", title="T", speaker=_FakeSpeaker())
    sentences = _sentences(manifest)
    assert len(sentences) > 1  # the block did wrap
    for sentence in sentences:
        assert "latex:" not in sentence["speech"]


def test_chemistry_books_are_declared_and_are_a_subset_of_the_allowlist():
    from pipeline.tts_manifest import ALLOWED_BOOKS, CHEMISTRY_BOOKS
    assert "chem_4b" in CHEMISTRY_BOOKS
    assert "math_elem_teachers" not in CHEMISTRY_BOOKS
    assert CHEMISTRY_BOOKS <= ALLOWED_BOOKS
