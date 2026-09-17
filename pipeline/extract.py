"""Turn a mirror page into an ordered list of Blocks, with math spans tokenised.

The skip list is not invented here -- it is the one already catalogued in the
desktop LibreTexts Reader's `src-tauri/src/content/libretexts.rs`, against the
same content, plus `mirror-blocked-asset` which is this mirror's own marker for
assets it did not copy.
"""

import base64
import re
from dataclasses import dataclass, field
from html import unescape

from bs4 import BeautifulSoup, Tag

from pipeline.normalize import normalize_for_speech

# A MathJax span as LibreTexts writes it: `\( ... \)` inline, `\[ ... \]` display.
# Non-greedy and DOTALL: display equations span lines, and `\\[4pt]` inside an
# align environment has a `[` with no preceding delimiter, so it cannot close one.
MATH_SPAN_RE = re.compile(r"\\\((.*?)\\\)|\\\[(.*?)\\\]", re.S)

# The desktop reader's token shape, and the one pipeline/protect.py masks as MATH.
MATH_TOKEN_RE = re.compile(r"\[\[latex:[A-Za-z0-9+/=]+\]\]")


def math_token(span: str) -> str:
    """`\\(E\\)` -> `[[latex:XChFXCk=]]`. The payload keeps the delimiters so
    `decode_math_token` can tell display from inline without a second field."""
    return "[[latex:" + base64.b64encode(span.encode("utf-8")).decode("ascii") + "]]"


def decode_math_token(token: str) -> tuple[str, bool]:
    span = base64.b64decode(token[len("[[latex:"):-2]).decode("utf-8")
    display = span.startswith("\\[")
    return span[2:-2].strip(), display


def _is_escaped(tex: str, j: int) -> bool:
    """True if `tex[j]` is a literal `\\{` / `\\}`, not a structural delimiter.

    Counts the run of backslashes immediately before `j`: an odd count means
    `tex[j]` is escaped (`\\{`); an even count means the last backslash is
    itself escaped (`\\\\{`), so `tex[j]` is still a real delimiter.
    """
    count = 0
    k = j - 1
    while k >= 0 and tex[k] == "\\":
        count += 1
        k -= 1
    return count % 2 == 1


def _skip_balanced_group(tex: str, i: int) -> int | None:
    """`tex[i]` must be `{`. Return the index just past its matching `}`,
    counting nested braces so a body like `\\mathbf{#1}` isn't cut short, and
    ignoring an escaped `\\{` / `\\}` so a literal brace in the body (e.g.
    `\\newcommand{\\lb}{\\{}`) doesn't desync the count. Returns None if the
    group never closes -- the caller fails open rather than guess where it
    would have ended.
    """
    depth = 0
    j = i
    while j < len(tex):
        ch = tex[j]
        if (ch == "{" or ch == "}") and not _is_escaped(tex, j):
            if ch == "{":
                depth += 1
            else:
                depth -= 1
                if depth == 0:
                    return j + 1
        j += 1
    return None


def _matches_newcommand_marker(tex: str, i: int) -> bool:
    """True if `\\newcommand` starts at `i` and is not itself a prefix of a
    longer command name (`\\newcommandx` is a different, unhandled macro, not
    a `\\newcommand` invocation with a stray `x` after it)."""
    marker = "\\newcommand"
    if not tex.startswith(marker, i):
        return False
    after = i + len(marker)
    return not (after < len(tex) and tex[after].isalpha())


def _strip_newcommands(tex: str) -> str:
    """Remove every `\\newcommand` definition from `tex`, leaving the rest.

    A definition is `\\newcommand{\\name}` then an optional `[argcount]` then a
    `{body}`, and the body may itself contain braces (`\\newcommand{\\vec}[1]
    {\\mathbf{#1}}`), which a regex cannot count the nesting of -- hence the
    balanced-brace scan in `_skip_balanced_group`. Used to tell a span that is
    only preamble (nothing left once every definition is removed) from one that
    opens with a definition but also carries real content to speak.

    Fails open: if any brace or bracket group belonging to a definition never
    closes, the whole of `tex` is returned unchanged rather than guessed at,
    the same way an unbalanced `\\(` is left as ordinary text elsewhere in this
    module -- the caller then judges the span non-empty and tokenises it whole
    instead of silently swallowing content past the break.
    """
    marker = "\\newcommand"
    out = []
    i = 0
    n = len(tex)
    while i < n:
        if not _matches_newcommand_marker(tex, i):
            out.append(tex[i])
            i += 1
            continue
        j = i + len(marker)
        while j < n and tex[j] in " \t":
            j += 1
        if j < n and tex[j] == "{":
            end = _skip_balanced_group(tex, j)  # the {\name} group
            if end is None:
                return tex
            j = end
        while j < n and tex[j] in " \t":
            j += 1
        if j < n and tex[j] == "[":
            close = tex.find("]", j)
            if close == -1:
                return tex
            j = close + 1
        while j < n and tex[j] in " \t":
            j += 1
        if j < n and tex[j] == "{":
            end = _skip_balanced_group(tex, j)  # the {body} group
            if end is None:
                return tex
            j = end
        i = j
    return "".join(out)


def tokenize_math(text: str) -> str:
    """Replace every math span with its token.

    This is the other half of the contract in src/highlight.mjs: the browser
    treats each <mjx-container> as one atom whose text is the token at that
    offset. A `\\newcommand` span is the page's macro preamble -- MathJax renders
    it to nothing, and the browser walker contributes nothing for an atom with no
    token at its offset, so removing it here keeps both sides equal. A span that
    mixes a definition with real content (`\\(\\newcommand{\\R}{\\mathbb{R}} x \\in
    \\R\\)`) is tokenised whole, definition and all -- the bridge resolves the
    macro fine inline -- so only a span that is *nothing but* definitions and
    whitespace is dropped.
    """
    def swap(match: re.Match) -> str:
        span = match.group(0)
        if "\\newcommand" not in span:
            return math_token(span)
        inner = match.group(1) if match.group(1) is not None else match.group(2)
        if _strip_newcommands(inner).strip() == "":
            return ""
        return math_token(span)

    return MATH_SPAN_RE.sub(swap, text)


def preamble_definitions(html: str) -> list[str]:
    """Every `\\newcommand` span in the document, in order, without delimiters.

    Fed to the speech bridge before the page's equations so `\\dU` resolves. The
    whole document is searched because LibreTexts puts the block in the body's
    first paragraph on some pages and in <head> on others. `html.unescape` runs
    on each definition because this scans the raw markup, before BeautifulSoup
    has decoded entities -- without it, a body written `&Delta; U` would reach
    the bridge as the literal text `&Delta; U` while `tokenize_math` (which runs
    on BeautifulSoup's already-decoded `get_text()`) speaks the equations
    against the decoded `Δ U`, so the macro and its uses would disagree.
    """
    out = []
    for match in MATH_SPAN_RE.finditer(html):
        tex = (match.group(1) if match.group(1) is not None else match.group(2)).strip()
        if "\\newcommand" in tex:
            out.append(unescape(tex))
    return out


READABLE_TAGS = ("h2", "h3", "h4", "p", "li", "figcaption")

KIND_BY_TAG = {
    "h1": "heading", "h2": "heading", "h3": "heading", "h4": "heading",
    "p": "paragraph", "li": "listitem", "figcaption": "caption",
    "td": "tablecell", "th": "tablecell", "caption": "caption",
}

# Product values, chosen rather than derived: past this size a table read row by
# row stops being easier to follow than the notice it replaced.
TABLE_MAX_ROWS = 12
TABLE_MAX_CELLS = 48

SKIP_TAGS = {"script", "style", "nav", "header", "footer", "aside", "form", "noscript"}

SKIP_CLASSES = {
    "mirror-blocked-asset",
    # From content/libretexts.rs in the desktop reader:
    "mt-script-comment", "Headertext", "autoattribution", "mt-category-container",
    "noinclude", "noindex", "noprint", "printfooter", "mt-content-footer",
    "mt-learningpathway", "mt-feedback", "mt-social", "lt-social",
    "mt-guide-content", "mt-guide-listings", "mt-list-topics", "mt-listing-detailed",
    "mt-subpage-listings-container", "mt-topic-hierarchy-listings",
    "mt-sortable-listings-container", "toc",
}

UNREADABLE_TEXT = {"", "No headers", "Table of Contents"}


@dataclass
class Block:
    id: str
    kind: str
    text: str
    path: list = field(default_factory=list)
    skipped: dict | None = None


def _element_path(element: Tag, root: Tag) -> list:
    """Child-index path from `root` down to `element`.

    Deliberately not a CSS selector: the mirror's own class names carry page ids
    (`lt-socialsci-38970`) that change when a page is regenerated. A child-index
    path is stable for a given page revision, and the manifest's `generatedFrom`
    hash is what tells the runtime when it no longer is.
    """
    path = []
    node = element
    while node is not root and node.parent is not None:
        siblings = [c for c in node.parent.children if isinstance(c, Tag)]
        path.append(siblings.index(node))
        node = node.parent
    return list(reversed(path))


def _is_skipped(element: Tag, root: Tag) -> bool:
    node = element
    while node is not None and node is not root.parent:
        if isinstance(node, Tag):
            if node.name in SKIP_TAGS:
                return True
            if SKIP_CLASSES.intersection(node.get("class") or []):
                return True
        node = node.parent
    return False


def _text_of(element: Tag) -> str:
    """Exactly what the browser's `element.textContent` returns.

    This is a contract, not a formatting choice. `src/highlight.mjs` rebuilds a
    DOM Range by walking the block's text nodes and counting characters, so the
    (offset, length) pairs this module produces are only meaningful if the
    string they index is byte-identical to the one the browser walks.

    That rules out a separator, `strip=True`, whitespace collapsing, and
    replacing U+00A0 with a space -- each shifts every later offset in the block
    and silently mis-highlights any paragraph containing a link or an <em>.
    Tidying belongs in `normalize_for_speech`, whose output nobody indexes into.

    Math spans are the one exception, by contract rather than by accident: MathJax
    rewrites them at typeset time, so the browser can never see the raw `\\(`
    text. Both sides replace the span with the same token -- see tokenize_math.
    """
    return tokenize_math(element.get_text())


def readable_form(text: str) -> str:
    """The collapsed form used only for the is-this-worth-reading decision."""
    return " ".join(text.replace("\xa0", " ").split())


def _has_bad_span(table: Tag) -> bool:
    for cell in table.find_all(["td", "th"]):
        if cell.get("colspan", "1") != "1" or cell.get("rowspan", "1") != "1":
            return True
    return False


def _skip_notice_text(caption_text: str | None, body: str) -> str:
    text = f"{caption_text}. {body}" if caption_text else body

    # `caption_text` comes from `_text_of`, so it is already math-tokenised --
    # a caption CAN carry a `[[latex:...]]` token here, same as any other
    # block. normalize_for_speech must never run over that token unmasked:
    # INTEGER_RE rewrites a digit run bounded by "+" or "/", both of which
    # appear in base64, and a rewritten token no longer matches MATH_TOKEN_RE
    # -- build_manifest's later `substitute_math` pass can then never find it,
    # so the mangled fragment reaches speech verbatim. Mask before
    # normalising and restore after, unconditionally, the same rule
    # pipeline.tts_manifest._speech_for follows for ordinary sentence text.
    # A local mask/restore is used here rather than
    # pipeline.math_speech.split_math/join_math to avoid an import cycle:
    # math_speech imports MATH_TOKEN_RE from this module.
    tokens: list[str] = []

    def _mask(match: re.Match) -> str:
        tokens.append(match.group(0))
        return f"[[MATH{len(tokens) - 1}]]"

    masked = MATH_TOKEN_RE.sub(_mask, text)
    spoken = normalize_for_speech(masked)
    for index, token in enumerate(tokens):
        spoken = spoken.replace(f"[[MATH{index}]]", token)
    return spoken


def _table_blocks(table: Tag, main: Tag) -> list:
    caption_el = table.find("caption", recursive=False)
    caption_text = None
    if caption_el is not None:
        text = _text_of(caption_el)
        if readable_form(text) not in UNREADABLE_TEXT:
            caption_text = text

    all_trs = table.find_all("tr")
    all_cells = table.find_all(["td", "th"])
    rows = len(all_trs)
    cells = len(all_cells)

    def skip(why: str) -> list:
        return [Block(
            id="",
            kind="notice",
            text=_skip_notice_text(caption_text, {
                "structure": f"Table with {rows} rows and merged or nested cells. Skipped.",
                "no-header": f"Table with {rows} rows and no header row. Skipped.",
                "too-long": f"Table with {rows} rows and {cells} cells. Too long to read aloud. Skipped.",
            }[why]),
            path=_element_path(table, main),
            skipped={"reason": "table", "why": why, "rows": rows, "cells": cells},
        )]

    # Structure guard: merged cells, a nested table, or a <tr> whose direct
    # parent is the <table> (the implicit-<tbody> DOM divergence -- see
    # ASSUMPTIONS "The structural refusal").
    if _has_bad_span(table):
        return skip("structure")
    if table.find("table") is not None:
        return skip("structure")
    if any(tr.parent is table for tr in all_trs):
        return skip("structure")

    # Header detection: a <thead> direct child, its first <tr>, every
    # direct-child cell of that <tr> is a <th>, and at least one is readable.
    thead = table.find("thead", recursive=False)
    headers: list = []
    if thead is not None:
        first_tr = thead.find("tr", recursive=False)
        if first_tr is not None:
            header_cells = first_tr.find_all(["td", "th"], recursive=False)
            if header_cells and all(c.name == "th" for c in header_cells):
                header_texts = [_text_of(c) for c in header_cells]
                if any(readable_form(t) not in UNREADABLE_TEXT for t in header_texts):
                    headers = header_texts
    if not headers:
        return skip("no-header")
    columns = len(headers)

    data_trs = [tr for tr in all_trs if tr.find_parent("thead") is None]
    if len(data_trs) > TABLE_MAX_ROWS or cells > TABLE_MAX_CELLS:
        return skip("too-long")

    blocks: list = []
    if caption_text is not None:
        blocks.append(Block(id="", kind="caption", text=caption_text, path=_element_path(caption_el, main)))

    dims = f"{len(data_trs)} rows and {columns} columns." if columns > 1 else f"{len(data_trs)} rows."
    blocks.append(Block(id="", kind="notice", text=normalize_for_speech(dims), path=_element_path(table, main)))

    header_tr = thead.find("tr", recursive=False)
    for cell in header_tr.find_all(["td", "th"], recursive=False):
        blocks.append(Block(id="", kind="tablecell", text=_text_of(cell), path=_element_path(cell, main)))

    for i, tr in enumerate(data_trs):
        row_cells = tr.find_all(["td", "th"], recursive=False)
        row_has_emitted = False
        for j, cell in enumerate(row_cells):
            cell_text = _text_of(cell)
            if readable_form(cell_text) in UNREADABLE_TEXT:
                continue
            lead = ""
            if columns > 1 and not row_has_emitted:
                lead = f"Row {i + 1}."
            if columns > 1 and len(row_cells) == len(headers) and readable_form(headers[j]) not in UNREADABLE_TEXT:
                header_part = f"{headers[j]},"
                lead = f"{lead} {header_part}" if lead else header_part
            if lead:
                blocks.append(Block(
                    id="", kind="notice", text=normalize_for_speech(lead), path=_element_path(cell, main),
                ))
            blocks.append(Block(id="", kind="tablecell", text=cell_text, path=_element_path(cell, main)))
            row_has_emitted = True

    return blocks


def extract_blocks(html: str) -> list[Block]:
    soup = BeautifulSoup(html, "lxml")
    main = soup.find("main", id="main-content")
    if main is None:
        return []

    blocks: list[Block] = []
    counter = 0
    seen_tables: set[int] = set()

    for element in main.find_all(list(READABLE_TAGS) + ["table"]):
        if _is_skipped(element, main):
            continue

        # build_manifest (tts_manifest.py) is protected: a block's speech is a
        # fixed function of its display text, never chosen independently. So a
        # restated column header cannot live on the cell's own block -- it is
        # a separate `notice` block (spoken, never highlighted) immediately
        # before the cell's own block.
        if element.name == "table":
            if id(element) in seen_tables:
                continue
            seen_tables.add(id(element))
            seen_tables.update(id(t) for t in element.find_all("table"))
            for block in _table_blocks(element, main):
                block.id = f"b{counter}"
                counter += 1
                blocks.append(block)
            continue

        # A readable element inside a table is part of that table, not prose.
        if element.find_parent("table") is not None:
            continue

        text = _text_of(element)
        if readable_form(text) in UNREADABLE_TEXT:
            continue

        blocks.append(Block(
            id=f"b{counter}",
            kind=KIND_BY_TAG.get(element.name, "paragraph"),
            text=text,
            path=_element_path(element, main),
        ))
        counter += 1

    return blocks
