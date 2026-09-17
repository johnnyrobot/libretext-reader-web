from pathlib import Path

import pytest

from pipeline.extract import TABLE_MAX_ROWS, extract_blocks

FIXTURES = Path(__file__).parent / "fixtures"


def load(name):
    return (FIXTURES / name).read_text(encoding="utf-8", errors="replace")


@pytest.fixture(scope="module")
def prose():
    return extract_blocks(load("prose.html"))


@pytest.fixture(scope="module")
def tables():
    return extract_blocks(load("tables.html"))


def test_finds_paragraphs_in_document_order(prose):
    paragraphs = [b for b in prose if b.kind == "paragraph"]
    assert len(paragraphs) > 20
    assert all(b.text.strip() for b in paragraphs)


def test_block_ids_are_unique_and_stable(prose):
    ids = [b.id for b in prose]
    assert len(ids) == len(set(ids))
    assert ids == [b.id for b in extract_blocks(load("prose.html"))]


def test_skips_chrome_and_blocked_assets(prose):
    text = " ".join(b.text for b in prose)
    assert "Skip to main content" not in text
    assert "Powered by MindTouch" not in text
    assert not any("mirror-blocked-asset" in (b.text or "") for b in prose)


def test_drops_the_navigation_placeholders(prose):
    assert not any(b.text in {"No headers", "Table of Contents"} for b in prose)


def test_a_table_with_no_header_row_becomes_one_notice_and_no_cells():
    blocks = extract_blocks(load("tables.html"))
    notices = [b for b in blocks if b.kind == "notice" and b.skipped]
    assert notices, "expected at least one table notice"
    assert notices[0].skipped["reason"] == "table"
    assert notices[0].skipped["why"] == "no-header"
    assert notices[0].skipped["rows"] > 0
    assert "Table with" in notices[0].text and "Skipped" in notices[0].text


def test_a_table_with_a_header_row_emits_its_cells(tables):
    cells = [b for b in tables if b.kind == "tablecell"]
    assert cells
    # Table 1.1 (8 data rows + 1 header), Table 1.3 (20 data cells minus 5
    # &nbsp;-only cells, + 2 header), Table 1.4 (12 data cells + 4 header).
    # Table 1.2 has no header and contributes none.
    assert len(cells) == (8 + 1) + (20 - 5 + 2) + (12 + 4)


def test_every_table_cell_block_text_is_exactly_its_elements_textcontent():
    html = (
        '<main id="main-content"><table><caption>T</caption>'
        "<thead><tr><th>Col A</th><th>Col B</th></tr></thead>"
        "<tbody><tr>"
        "<td>Define <em>social psychology</em>. See <a href=\"#x\">the study</a>.</td>"
        "<td>Plain</td>"
        "</tr></tbody></table></main>"
    )
    cells = [b for b in extract_blocks(html) if b.kind == "tablecell"]
    texts = [c.text for c in cells]
    assert "Define social psychology. See the study." in texts
    assert "Plain" in texts


def test_a_multi_column_table_restates_the_header_before_each_cell(tables):
    idx = next(i for i, b in enumerate(tables) if b.kind == "tablecell" and b.text == "Observational")
    preceding = tables[idx - 1]
    assert preceding.kind == "notice"
    assert "Research Design," in preceding.text
    assert "Row one" in preceding.text


def test_a_single_column_table_does_not_restate_its_header(tables):
    header_text = "Answer each of the following questions"
    assert not any(b.kind == "notice" and header_text in b.text for b in tables)


def test_a_caption_is_read_before_the_rows(tables):
    caption_text = "Table 1.4 Three Major Research Designs Used by Social Psychologists"
    cap_idx = next(i for i, b in enumerate(tables) if b.kind == "caption" and b.text == caption_text)
    cell_idx = next(i for i, b in enumerate(tables) if b.kind == "tablecell" and b.text == "Observational")
    assert cap_idx < cell_idx


def test_an_empty_cell_is_not_read_and_gets_no_header_restatement(tables):
    assert not any(b.kind == "tablecell" and b.text.strip("\xa0") == "" for b in tables)
    conceptual_notices = [b for b in tables if b.kind == "notice" and "Conceptual variable," in b.text]
    assert len(conceptual_notices) == 5


def test_a_table_with_merged_cells_keeps_the_notice():
    html = (
        '<main id="main-content"><table><caption>C</caption>'
        "<thead><tr><th>A</th><th>B</th></tr></thead>"
        '<tbody><tr><td colspan="2">merged</td></tr></tbody></table></main>'
    )
    blocks = extract_blocks(html)
    notices = [b for b in blocks if b.kind == "notice" and b.skipped]
    assert notices and notices[0].skipped["why"] == "structure"
    assert not any(b.kind == "tablecell" for b in blocks)


def test_a_table_over_the_size_cap_keeps_the_notice():
    rows_html = "".join(f"<tr><td>r{i}</td></tr>" for i in range(TABLE_MAX_ROWS + 1))
    html = (
        '<main id="main-content"><table><caption>Big</caption>'
        "<thead><tr><th>Col</th></tr></thead>"
        f"<tbody>{rows_html}</tbody></table></main>"
    )
    blocks = extract_blocks(html)
    notices = [b for b in blocks if b.kind == "notice" and b.skipped]
    assert notices and notices[0].skipped["why"] == "too-long"
    # "rows" is every <tr> in the table, header included (one <thead> row here).
    assert notices[0].skipped["rows"] == TABLE_MAX_ROWS + 1 + 1
    assert notices[0].skipped["cells"] > 0


def test_a_row_that_is_directly_under_the_table_keeps_the_notice():
    html = (
        '<main id="main-content"><table><caption>C</caption>'
        "<thead><tr><th>A</th></tr></thead>"
        "<tr><td>direct child</td></tr></table></main>"
    )
    blocks = extract_blocks(html)
    notices = [b for b in blocks if b.kind == "notice" and b.skipped]
    assert notices and notices[0].skipped["why"] == "structure"


def test_notice_text_is_speech_ready_and_carries_no_digits(tables):
    assert not any(b.kind == "notice" and any(ch.isdigit() for ch in b.text) for b in tables)


def test_figure_captions_are_captured():
    blocks = extract_blocks(load("figures.html"))
    captions = [b for b in blocks if b.kind == "caption"]
    assert captions
    assert all(c.text.strip() for c in captions)


def test_headings_are_captured_but_not_the_page_title(prose):
    headings = [b for b in prose if b.kind == "heading"]
    assert headings
    # The template's <h1> lives outside <main>; nothing inside should duplicate it.
    assert all(len(b.text) < 200 for b in headings)


def test_path_locates_the_block_from_main():
    blocks = extract_blocks(load("prose.html"))
    for block in blocks:
        if block.kind == "notice":
            continue
        assert isinstance(block.path, list)
        assert all(isinstance(i, int) and i >= 0 for i in block.path)


def test_block_text_is_exactly_dom_textcontent():
    """The offset contract with src/highlight.mjs.

    highlight.mjs rebuilds a Range by walking the block's text nodes and
    counting characters. If this string differs from the browser's
    `textContent` by even one space, every sentence after the difference
    highlights the wrong words.
    """
    html = (
        '<main id="main-content">'
        '<p>Define <em>social psychology</em>. See <a href="#x">the study</a>.</p>'
        "</main>"
    )
    (block,) = extract_blocks(html)
    assert block.text == "Define social psychology. See the study."


def test_nbsp_is_preserved_not_folded_to_a_space():
    """U+00A0 is one character in the DOM too; folding it would not shift
    offsets, but replacing it with a different character breaks an exact
    string comparison the runtime uses to detect a stale manifest."""
    html = '<main id="main-content"><p>Milgram (1963) agreed.</p></main>'
    (block,) = extract_blocks(html)
    assert " " in block.text


import base64

from pipeline.extract import (
    MATH_TOKEN_RE, decode_math_token, math_token, preamble_definitions, tokenize_math,
)


def _b64(s: str) -> str:
    return base64.b64encode(s.encode("utf-8")).decode("ascii")


def test_math_token_encodes_the_whole_span_with_delimiters():
    assert math_token(r"\(E\)") == "[[latex:XChFXCk=]]"
    assert MATH_TOKEN_RE.fullmatch(math_token(r"\[E = mc^2\]"))


def test_decode_math_token_strips_delimiters_and_reports_display():
    assert decode_math_token(math_token(r"\(E\)")) == ("E", False)
    assert decode_math_token(math_token(r"\[ E = mc^2 \]")) == ("E = mc^2", True)


def test_tokenize_math_replaces_inline_and_display_spans_in_place():
    text = r"Energy \(E\) obeys \[E = mc^2\] here."
    out = tokenize_math(text)
    assert out == "Energy [[latex:XChFXCk=]] obeys [[latex:XFtFID0gbWNeMlxd]] here."


def test_tokenize_math_keeps_decoded_entities_inside_the_span():
    # BeautifulSoup has already turned &Delta; into Δ by the time text reaches here.
    out = tokenize_math("Change \\(ΔU = q + w\\) holds.")
    tex, display = decode_math_token(MATH_TOKEN_RE.search(out).group(0))
    assert tex == "ΔU = q + w" and display is False


def test_tokenize_math_removes_a_newcommand_span():
    text = r"\( \newcommand{\R}{\mathbb{R}} \)"
    assert tokenize_math(text).strip() == ""


def test_tokenize_math_leaves_text_without_math_untouched():
    text = "No maths here, just a [bracket] and a \\ backslash."
    assert tokenize_math(text) == text


def test_preamble_definitions_finds_newcommand_spans_anywhere():
    html = (
        "<html><head><p>\\( \\newcommand{\\R}{\\mathbb{R}} \\)</p></head>"
        "<body><main id=\"main-content\"><p>\\(\\newcommand{\\dU}{\\Delta U}\\)</p>"
        "<p>Real \\(x\\) here.</p></main></body></html>"
    )
    assert preamble_definitions(html) == ["\\newcommand{\\R}{\\mathbb{R}}", "\\newcommand{\\dU}{\\Delta U}"]


def test_a_preamble_only_paragraph_is_not_a_block():
    html = (
        "<html><body><main id=\"main-content\">"
        "<p>\\( \\newcommand{\\R}{\\mathbb{R}} \\)</p><p>Then \\(x\\) follows.</p>"
        "</main></body></html>"
    )
    blocks = extract_blocks(html)
    assert [b.text for b in blocks] == ["Then [[latex:XCh4XCk=]] follows."]


def test_existing_fixtures_are_unchanged_by_tokenisation(prose, tables):
    # No fixture carries a math span, so the contract for every existing page holds.
    assert not any(MATH_TOKEN_RE.search(b.text) for b in prose + tables)


def test_preamble_definitions_decodes_html_entities():
    # The scan runs on raw markup, before BeautifulSoup decodes entities, so a
    # definition body written with an entity must still reach the bridge decoded.
    html = (
        "<main id=\"main-content\"><p>\\(\\newcommand{\\dU}{&Delta; U}\\)</p></main>"
    )
    assert preamble_definitions(html) == ["\\newcommand{\\dU}{Δ U}"]


def test_tokenize_math_tokenises_a_span_that_mixes_newcommand_with_content():
    text = r"Consider \(\newcommand{\R}{\mathbb{R}} x \in \R\) here."
    out = tokenize_math(text)
    match = MATH_TOKEN_RE.search(out)
    assert match is not None
    assert out == f"Consider {match.group(0)} here."
    tex, display = decode_math_token(match.group(0))
    assert tex == r"\newcommand{\R}{\mathbb{R}} x \in \R"
    assert display is False


def test_tokenize_math_removes_a_span_with_two_newcommands_and_whitespace():
    text = r"\( \newcommand{\R}{\mathbb{R}} \newcommand{\N}{\mathbb{N}} \)"
    assert tokenize_math(text).strip() == ""


def test_tokenize_math_removes_a_newcommand_with_a_nested_brace_body():
    text = r"\(\newcommand{\vec}[1]{\mathbf{#1}}\)"
    assert tokenize_math(text).strip() == ""


def test_tokenize_math_tokenises_a_span_with_an_unterminated_newcommand_group():
    # The \newcommand body's brace never closes -- fail open rather than guess
    # where it would have, so the whole span (with its real content) survives.
    text = r"Consider \(\newcommand{\R}{\mathbb{R} x \in \R\) here."
    out = tokenize_math(text)
    match = MATH_TOKEN_RE.search(out)
    assert match is not None
    assert out == f"Consider {match.group(0)} here."
    tex, display = decode_math_token(match.group(0))
    assert tex == r"\newcommand{\R}{\mathbb{R} x \in \R"
    assert display is False


def test_tokenize_math_tokenises_a_span_with_an_escaped_brace_body_and_content():
    text = r"\(\newcommand{\lb}{\{} y = 1\)"
    out = tokenize_math(text)
    match = MATH_TOKEN_RE.search(out)
    assert match is not None
    assert out == match.group(0)
    tex, display = decode_math_token(match.group(0))
    assert tex == r"\newcommand{\lb}{\{} y = 1"
    assert display is False


def test_tokenize_math_removes_a_newcommand_with_an_escaped_brace_body():
    text = r"\(\newcommand{\lb}{\{}\)"
    assert tokenize_math(text).strip() == ""


def test_tokenize_math_does_not_treat_newcommandx_as_a_definition():
    text = r"\(\newcommandx{\foo}[2]{bar #1 #2}\)"
    out = tokenize_math(text)
    match = MATH_TOKEN_RE.fullmatch(out)
    assert match is not None
    tex, display = decode_math_token(match.group(0))
    assert tex == r"\newcommandx{\foo}[2]{bar #1 #2}"
    assert display is False


def test_skip_notice_text_masks_a_token_before_normalising():
    """Finding 4: caption_text reaches `_skip_notice_text` already
    math-tokenised (`_text_of` tokenises every block, captions included), and
    INTEGER_RE rewrites a digit run bounded by "+" or "/" -- both legal base64
    characters. An unmasked token can come out mangled and never match
    MATH_TOKEN_RE again, so build_manifest's later `substitute_math` pass can
    never restore it. This payload starts "3/..." so INTEGER_RE's `\\b3\\b`
    fires immediately if the mask is missing.
    """
    from pipeline.extract import _skip_notice_text
    token = "[[latex:3/CP9EBlwRKMR+FvT8fiH7FzT5L6qU4hySUlAA8mLEM=]]"
    out = _skip_notice_text(token, "Skipped.")
    assert token in out
    assert MATH_TOKEN_RE.findall(out) == [token]


def test_a_skipped_tables_caption_math_token_survives_end_to_end():
    """The same guarantee, through the real path: a caption with inline math
    on a table that gets skipped (merged cells) still carries an intact token
    in the resulting notice block's text.
    """
    tex = r"\(x_{0} + x_{1} + x_{2} + x_{3} + x_{4} + x_{5} + x_{6} + x_{7}\)"
    token = math_token(tex)
    html = (
        f'<main id="main-content"><table><caption>See {tex}</caption>'
        "<thead><tr><th>A</th><th>B</th></tr></thead>"
        '<tbody><tr><td colspan="2">merged</td></tr></tbody></table></main>'
    )
    blocks = extract_blocks(html)
    notices = [b for b in blocks if b.kind == "notice" and b.skipped]
    assert notices and notices[0].skipped["why"] == "structure"
    assert MATH_TOKEN_RE.findall(notices[0].text) == [token]
