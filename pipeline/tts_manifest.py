"""Build speech.json for a page and inject the reader into it.

Follows glossary_demo.py, the established injection recipe on this mirror:
rewrite the page just before </head>, and copy assets into /_assets/.

Only in-scope pages are opened. page.tpl is never edited -- doing so would put
the button on all 1,306 pages and break the byte-identical guarantee for the
1,215 outside scope.
"""

import argparse
import hashlib
import json
import re
import shutil
import sys
from pathlib import Path

from pipeline.extract import MATH_TOKEN_RE, extract_blocks, preamble_definitions
from pipeline.math_speech import MathSpeaker, join_math, speak_tokens, split_math, substitute_math
from pipeline.normalize import normalize_for_speech
from pipeline.tokenize import SENTENCE_SPLIT_VERSION, split_sentences

BOOT_TAG = '<script defer src="/_assets/tts/boot.js"></script>'
AFFORDANCE_RE = re.compile(r'<div class="reader-link">(.*?)</div>', re.S)
WORDS_PER_MINUTE = 150

# Hard invariant. This is deliberately a constant in code and not a
# flag, an env var, or a trusted argument: the pipeline rewrites index.html in
# place, and re-pulling from CXone is the only undo. Adding a book here is a
# human edit, reviewed as a diff, after which the pipeline may freely do the work
# of supporting it.
ALLOWED_BOOKS = frozenset({"social_psychology", "math_elem_teachers", "chem_4b", "human_relations"})

# Books whose every equation is chemistry. math_phrasing's chemistry rules are
# otherwise gated on per-span evidence (\ce, an arrow, a state label), which
# cannot see that a bare `N_2` is a molecule rather than an algebraic subscript
# -- so the same molecule was read two ways on one page, and thermodynamics like
# ΔG_rxn = RT ln(Q/K_eq) got no chemistry phrasing at all. Declaring the book is
# the only place that knowledge exists.
CHEMISTRY_BOOKS = frozenset({"chem_4b"})


class OutOfScopeError(Exception):
    """Raised rather than touching a page outside the allowlisted book."""


def resolve_book_dir(book_dir: Path, site_root: Path) -> Path:
    """Return `book_dir` only if it is an allowlisted book directly under the site root.

    Every rejection here is a page that would otherwise have been rewritten.
    """
    resolved = book_dir.resolve()
    root = site_root.resolve()

    if resolved == root:
        raise OutOfScopeError(
            f"refusing to treat the site root {root} as a book: that is all 1,306 pages")
    if resolved.parent != root:
        raise OutOfScopeError(
            f"{resolved} is not a direct child of the site root {root}")
    if resolved.name not in ALLOWED_BOOKS:
        raise OutOfScopeError(
            f"book {resolved.name!r} is not on the allowlist {sorted(ALLOWED_BOOKS)}; "
            "adding one is a human edit to pipeline/tts_manifest.py")
    return resolved


def _speech_for(display: str, math_speech: dict[str, str]) -> str:
    """Display Text -> Speech Text, with each equation spoken in words.

    Order is load-bearing: the tokens are masked to `[[MATHn]]` BEFORE the
    normaliser runs, so INTEGER_RE and DECIMAL_RE never see the digits inside a
    base64 payload, and restored AFTER it, so the normaliser's number rules never
    rewrite SRE's own "284 J".
    """
    masked, tokens = split_math(display)
    spoken = normalize_for_speech(masked)
    return join_math(spoken, [math_speech[t] for t in tokens])


def build_manifest(html: str, page_id: str, title: str, lang: str = "en",
                    speaker: MathSpeaker | None = None, chem_book: bool = False) -> dict:
    blocks = extract_blocks(html)
    tokens: list[str] = []
    for block in blocks:
        tokens.extend(t for t in MATH_TOKEN_RE.findall(block.text) if t not in tokens)

    math_speech: dict[str, str] = {}
    failed = 0
    if tokens:
        own = speaker is None
        speaker = speaker or MathSpeaker()
        try:
            math_speech, failed = speak_tokens(
                speaker, tokens, title=title, preamble=preamble_definitions(html),
                chem_book=chem_book)
        finally:
            if own:
                speaker.close()

    blocks_out = []
    total_words = 0
    total_sentences = 0

    for block in blocks:
        if block.kind == "notice":
            sentences = [{
                "id": f"{block.id}s0",
                "display": "",
                "speech": substitute_math(block.text, math_speech),
                "offset": 0,
                "length": 0,
            }]
        else:
            sentences = []
            for index, (offset, length) in enumerate(split_sentences(block.text)):
                display = block.text[offset:offset + length]
                sentences.append({
                    "id": f"{block.id}s{index}",
                    "display": display,
                    "speech": _speech_for(display, math_speech),
                    "offset": offset,
                    "length": length,
                })
            total_words += len(block.text.split())

        if not sentences:
            continue

        total_sentences += len(sentences)
        entry = {
            "id": block.id,
            "kind": block.kind,
            "text": block.text,
            "anchor": {"path": block.path},
            "sentences": sentences,
        }
        if block.skipped:
            entry["skipped"] = block.skipped
        blocks_out.append(entry)

    manifest = {
        "version": 1,
        "pageId": page_id,
        "title": title,
        "lang": lang,
        # Which translated tracks exist beside this file. Written here as empty and
        # filled in by pipeline.tracks.announce, so the reader's language menu can
        # never offer a track that is not on disk.
        "languages": [],
        # Keyed on the SPLITTER as well as the page -- see
        # pipeline.tokenize.SENTENCE_SPLIT_VERSION for why a bare HTML hash
        # let a re-split slip past pipeline.tracks.needs_translation.
        "generatedFrom": hashlib.sha256(
            f"v{SENTENCE_SPLIT_VERSION}\0".encode("utf-8") + html.encode("utf-8")
        ).hexdigest(),
        "blocks": blocks_out,
        "stats": {
            "blocks": len(blocks_out),
            "sentences": total_sentences,
            "words": total_words,
            "estimatedSeconds": round(total_words / WORDS_PER_MINUTE * 60),
        },
    }
    if tokens:
        manifest["mathSpeech"] = math_speech
        # `spoken` and `failed` count DISTINCT tokens (`math_speech` is keyed by
        # token, and `tokens` above is already deduplicated), not equation
        # occurrences on the page. A page that writes the same equation twice
        # counts it once here even though a listener hears it twice -- e.g. the
        # regression corpus's "689 spoken" is 689 distinct spans against 862
        # occurrences across math_elem_teachers.
        manifest["math"] = {"spoken": len(math_speech) - failed, "failed": failed}
    return manifest


def rewrite_page(html: str) -> str:
    def to_button(match: re.Match) -> str:
        # NO style ATTRIBUTE. It was here, and it never worked: the mirror's CSP
        # has style-src without 'unsafe-inline', so the browser parsed the
        # attribute and dropped it. The markup was correct in every served page
        # and the button rendered at 13px for every reader.
        #
        # The size now comes from boot.js via CSSOM, which CSP does not intercept.
        # Do not reintroduce it here: a style attribute on this button is
        # guaranteed dead on the live mirror, and the failure is silent.
        return f'<button type="button" id="tts-enter" class="reader-link">{match.group(1)}</button>'

    out, replaced = AFFORDANCE_RE.subn(to_button, html)
    if not replaced:
        return html  # not a page this feature belongs on; leave it byte-identical
    if BOOT_TAG not in out:
        out = out.replace("</head>", f"{BOOT_TAG}\n</head>", 1)
    return out


# `[^>]*` BEFORE THE CLOSING BRACKET IS LOAD-BEARING, AND IT PROTECTS WHAT IS ALREADY
# DEPLOYED. This pattern is the only route back to a plain div, and unrewrite_page is
# not optional: the pipeline rewrites index.html IN PLACE, so every run after the first
# reads its own output. A pattern tightened to the exact attributes of today's button
# would silently fail to match the 91 pages already live with the older, un-styled one
# -- no error, no diff, just a dead button that survives every refresh, with re-pulling
# the book from CXone as the only remedy. That is on the irreversible list.
#
# So it matches the identity of the button (type, id, class) and tolerates whatever
# attributes follow. A style attribute value cannot contain '>', so [^>]* is safe here.
BUTTON_RE = re.compile(
    r'<button type="button" id="tts-enter" class="reader-link"[^>]*>(.*?)</button>', re.S)


def unrewrite_page(html: str) -> str:
    """The exact inverse of `rewrite_page`.

    Needed because the pipeline rewrites index.html in place, so every run after
    the first reads its own output. A page that once had prose and no longer does
    would otherwise keep a button leading to "nothing could be matched", and
    re-pulling the book from CXone would be the only way back.
    """
    out = BUTTON_RE.sub(lambda m: f'<div class="reader-link">{m.group(1)}</div>', html)
    return out.replace(f"{BOOT_TAG}\n", "", 1).replace(BOOT_TAG, "", 1)


def process_page(index_html: Path, page_id: str, speaker: MathSpeaker | None = None,
                 chem_book: bool = False) -> bool:
    """Return True if the page was injected, False if it has nothing to read."""
    html = index_html.read_text(encoding="utf-8", errors="replace")
    title_match = re.search(r"<h1>(.*?)</h1>", html, re.S)
    title = re.sub(r"<[^>]+>", "", title_match.group(1)).strip() if title_match else page_id

    manifest = build_manifest(html, page_id=page_id, title=title, speaker=speaker,
                              chem_book=chem_book)
    speech_json = index_html.parent / "speech.json"

    # Chapter landing pages and front matter hold nothing but a table-of-contents
    # listing, which is chrome. 16 of this book's 91 pages are like that. Offering
    # a Listen button there promises something the page cannot do, so they are
    # left exactly as found -- and un-injected if a previous run got there first.
    if manifest["stats"]["sentences"] == 0:
        speech_json.unlink(missing_ok=True)
        restored = unrewrite_page(html)
        if restored != html:
            index_html.write_text(restored, encoding="utf-8")
        return False

    speech_json.write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")
    if "math" in manifest:
        print(f"  {page_id}: math {manifest['math']['spoken']} spoken, "
              f"{manifest['math']['failed']} failed")
    # UN-INJECT FIRST, ALWAYS. `rewrite_page` only converts `<div class="reader-link">`,
    # and this function rewrites index.html IN PLACE -- so from the second run onward its
    # input is its own output, which has a <button> and no div. It therefore matched
    # nothing and returned the page unchanged.
    #
    # The injection was idempotent BY ACCIDENT and un-updatable BY CONSEQUENCE: every
    # page kept whatever button it was first given, forever. Any later change to the
    # markup -- a resize, an aria-label, a fixed typo -- would deploy, report "91 pages
    # injected", and alter none of them. Reporting success while doing nothing is the
    # failure mode this project keeps finding, and here it would have been invisible:
    # the page still works, the button still works, it is simply the old one.
    #
    # Normalising to the div first makes the write idempotent for real (asserted by
    # test_reprocessing_an_unchanged_page_is_a_no_op) rather than by side effect, and
    # makes the current markup the one that lands regardless of what was there before.
    index_html.write_text(rewrite_page(unrewrite_page(html)), encoding="utf-8")
    return True


def install(book_dir: Path, site_root: Path) -> int:
    """Inject the reader into every page of an allowlisted book. Returns the count."""
    book = resolve_book_dir(book_dir, site_root)
    root = site_root.resolve()
    # One bridge process for the whole book; a fresh TeX parser per page inside it.
    with MathSpeaker() as speaker:
        return sum(process_page(page, page_id=str(page.parent.relative_to(root)), speaker=speaker,
                                chem_book=book.name in CHEMISTRY_BOOKS)
                   for page in sorted(book.rglob("index.html")))


def uninstall(book_dir: Path, site_root: Path) -> int:
    """Return every page of an allowlisted book to what CXone produced.

    Roadmap step 11 item 4: rollback is one command, decided now rather than
    during the incident. This is exact for the content half because rewrite_page
    has an inverse -- the page ends byte-identical to its original, and
    speech.json is removed.

    It does NOT roll back the Caddy headers or the staged assets. Those are on
    the irreversible list and stay a human step. Without the headers the
    reader degrades rather than breaking, and with the pages un-injected the
    assets are simply never requested.
    """
    book = resolve_book_dir(book_dir, site_root)
    removed = 0
    for page in sorted(book.rglob("index.html")):
        html = page.read_text(encoding="utf-8", errors="replace")
        restored = unrewrite_page(html)
        speech = page.parent / "speech.json"
        if restored != html or speech.exists():
            removed += 1
        if restored != html:
            page.write_text(restored, encoding="utf-8")
        speech.unlink(missing_ok=True)
    return removed


def main() -> None:
    parser = argparse.ArgumentParser(description="Inject the TTS reader into a book on the mirror.")
    parser.add_argument("book_dir", type=Path, help="e.g. /srv/mirror/site/social_psychology")
    parser.add_argument("--assets", type=Path, help="dist/_assets/tts to stage")
    parser.add_argument("--site-root", type=Path, required=True,
                        help="the mirror site root that book_dir must sit inside")
    parser.add_argument("--uninstall", action="store_true",
                        help="return every page to what CXone produced and remove speech.json")
    args = parser.parse_args()

    try:
        book_dir = resolve_book_dir(args.book_dir, args.site_root)
    except OutOfScopeError as error:
        print(f"refused: {error}", file=sys.stderr)
        raise SystemExit(2)

    pages = sorted(book_dir.rglob("index.html"))

    if args.uninstall:
        reverted = uninstall(args.book_dir, args.site_root)
        print(f"{book_dir.name}: {len(pages)} pages, {reverted} reverted to their "
              f"original form")
        return

    injected = install(args.book_dir, args.site_root)
    print(f"{book_dir.name}: {len(pages)} pages, {injected} injected, "
          f"{len(pages) - injected} left as found (nothing to read)")

    if args.assets:
        target = args.site_root / "_assets" / "tts"
        target.mkdir(parents=True, exist_ok=True)
        shutil.copytree(args.assets, target, dirs_exist_ok=True)
        print(f"staged assets to {target}")


if __name__ == "__main__":
    main()
