"""LT-537: an image with a real description is read aloud as its own block.

The page HTML here is made up for the test; the shapes of the junk alt text are
the ones measured on the staged books (filenames, the word "alt", MindTouch's
thumbnail placeholder).
"""
from pipeline.extract import IMAGE_LEAD, MATH_TOKEN_RE, extract_blocks, image_alt, math_token
from pipeline.tts_manifest import build_manifest


def page(inner: str) -> str:
    return f'<html><body><main id="main-content">{inner}</main></body></html>'


def kinds(blocks):
    return [(b.kind, b.text) for b in blocks]


def test_an_image_with_a_description_is_read_before_its_caption():
    blocks = extract_blocks(page(
        "<p>Before.</p>"
        '<figure><img src="/a.png" alt="A Venn diagram of three circles."/>'
        "<figcaption>Figure 1: Personality</figcaption></figure>"
    ))
    assert kinds(blocks) == [
        ("paragraph", "Before."),
        ("image", "Image: A Venn diagram of three circles."),
        ("caption", "Figure 1: Personality"),
    ]


def test_the_image_block_is_anchored_on_the_img_itself():
    blocks = extract_blocks(page('<figure><img alt="A cat on a mat"/></figure>'))
    assert blocks[0].path == [0, 0]


def test_an_image_inside_a_paragraph_follows_that_paragraph():
    blocks = extract_blocks(page('<p>Look at this <img alt="A red flask"/> closely.</p>'))
    assert kinds(blocks) == [
        ("paragraph", "Look at this  closely."),
        ("image", "Image: A red flask"),
    ]


def test_whitespace_in_the_alt_collapses_the_way_the_reader_collapses_it():
    blocks = extract_blocks(page('<img alt="  A   red\n\tflask  "/>'))
    assert blocks[0].text == IMAGE_LEAD + "A red flask"


def test_a_no_break_space_is_kept_because_html_does_not_count_it_as_whitespace():
    assert image_alt("A\xa0flask") == "A\xa0flask"


def test_decorative_and_junk_alt_text_stays_silent():
    junk = [
        "",                                   # decorative
        "   ",
        "\xa0\xa0",
        "ddfd5dc289640638921ad7e80db57152.jpg",
        "001 (1).svg",
        "=LAB-H2O.png",
        "imageedit_4_8699029754.PNG",
        "alt", "Image", "photo.",
        "mindtouch.page#thumbnail",
        "Figure \\(\\PageIndex{2}\\).jpg",   # a filename, formula or not
        "A charge \\(q",                    # an unclosed formula
        "Cost $$5$$",
        "d71acaa48cd342f37bce4740c48239b6",
    ]
    for alt in junk:
        assert image_alt(alt) is None, alt
    html = page("".join(f'<img alt="{a}"/>' for a in junk) + "<img/>")
    assert extract_blocks(html) == []


def test_presentational_or_hidden_images_stay_silent():
    blocks = extract_blocks(page(
        '<img role="presentation" alt="A flask"/>'
        '<img aria-hidden="true" alt="A flask"/>'
        '<img role="none" alt="A flask"/>'
        '<div aria-hidden="true"><figure><img alt="A flask"/></figure></div>'
    ))
    assert blocks == []


def test_images_in_chrome_blocked_assets_and_tables_stay_silent():
    blocks = extract_blocks(page(
        '<header><img alt="Library homepage"/></header>'
        '<nav><img alt="A nav picture"/></nav>'
        '<div class="mirror-blocked-asset"><img alt="A blocked picture"/></div>'
        "<table><thead><tr><th>H</th></tr></thead>"
        '<tbody><tr><td><img alt="A cell picture"/>x</td></tr></tbody></table>'
    ))
    assert not [b for b in blocks if b.kind == "image"]


def test_the_manifest_speaks_the_image_and_its_offsets_round_trip():
    manifest = build_manifest(
        page('<img alt="A beaker of blue liquid. It sits on a bench."/>'),
        page_id="p", title="t",
    )
    (block,) = manifest["blocks"]
    assert block["kind"] == "image"
    assert block["anchor"] == {"path": [0]}
    displays = [s["display"] for s in block["sentences"]]
    assert displays == ["Image: A beaker of blue liquid.", "It sits on a bench."]
    for s in block["sentences"]:
        assert block["text"][s["offset"]:s["offset"] + s["length"]] == s["display"]
        assert s["speech"]


def test_images_number_separately_so_every_other_block_keeps_its_id():
    """A reader's saved place is a sentence id (src/position.mjs). Numbering
    images in the same series would shift every later paragraph's id on the
    first rebuild, and resume a few sentences off."""
    without = extract_blocks(page("<p>One.</p><p>Two.</p><p>Three.</p>"))
    with_images = extract_blocks(page(
        '<p>One.</p><img alt="A flask"/><p>Two.</p><img alt="A cat"/><p>Three.</p>'
    ))
    assert [b.id for b in with_images if b.kind != "image"] == [b.id for b in without]
    assert [b.id for b in with_images if b.kind == "image"] == ["i0", "i1"]


class _WordSpeaker:
    """Speaks any TeX as "the letter F", so this needs no node process."""

    def reset(self, macros):
        pass

    def define(self, tex):
        pass

    def speak(self, tex, display):
        return "the letter " + tex


def test_a_formula_in_the_alt_is_spoken_in_words_like_any_other_equation():
    """The one real case on the staged books (Chem 4B, 3.2). The display text
    keeps the formula as a token, as a paragraph's does; the speech has words."""
    alt = "The absolute value of the force \\(F\\) between two point charges"
    blocks = extract_blocks(page(f'<img alt="{alt}"/>'))
    assert kinds(blocks) == [
        ("image", "Image: The absolute value of the force " + math_token("\\(F\\)")
         + " between two point charges"),
    ]
    manifest = build_manifest(page(f'<img alt="{alt}"/>'), page_id="p", title="t",
                              speaker=_WordSpeaker())
    (sentence,) = manifest["blocks"][0]["sentences"]
    assert sentence["speech"] == "Image: The absolute value of the force the letter F between two point charges"
    assert manifest["math"] == {"spoken": 1, "failed": 0}


def test_an_alt_with_only_a_macro_definition_stays_silent_rather_than_mismatch():
    """tokenize_math drops a definition-only span, so the text would no longer
    match the alt the browser reads back; better silent than dropped later."""
    assert image_alt("A circle \\(\\newcommand{\\R}{x}\\)") is None


def test_an_alt_with_a_formula_holds_a_math_token():
    assert MATH_TOKEN_RE.search(image_alt("A circle \\(r\\)"))


def test_an_alt_that_already_looks_like_a_math_token_stays_silent():
    """Not a formula the page wrote, so it cannot be decoded or spoken; it
    must not stop the rest of the page being built either."""
    for alt in ("A [[latex:/w==]] mark", "A [[latex:" + math_token("\\(r\\)")[8:]):
        assert image_alt(alt) is None, alt
    blocks = extract_blocks(page('<img alt="A [[latex:/w==]] mark"/><p>Still here.</p>'))
    assert kinds(blocks) == [("paragraph", "Still here.")]
