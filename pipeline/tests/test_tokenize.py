from pipeline.extract import MATH_TOKEN_RE, math_token
from pipeline.tokenize import split_sentences


def slices(text):
    return [text[o:o + n] for o, n in split_sentences(text)]


# A single token whose base64 payload alone is well over max_chars=300 -- the
# corpus's longest observed token was 546 chars; this one lands nearby without
# depending on the corpus itself.
LONG_TOKEN = math_token(r"\( " + " + ".join(f"x_{{{i}}}" for i in range(45)) + r" \)")


def test_a_lone_token_longer_than_max_chars_is_not_split():
    """Finding 1: base64 has no "; ", ", " or " " for _hard_wrap's rfind to
    find, so an unfixed wrap falls back to the `target` cut and slices straight
    through the token, leaving raw base64 in one half and nothing in the other.
    """
    assert len(LONG_TOKEN) > 300
    pieces = slices(LONG_TOKEN)
    assert pieces == [LONG_TOKEN]


def test_prose_and_a_long_token_split_outside_the_token():
    """Prose on both sides of an oversized token, all inside one BOUNDARY_RE
    sentence so _hard_wrap has to run. Every piece must contain either a whole
    token or none -- never a fragment of one.
    """
    lead = "This introductory clause runs on for quite a while before the equation shows up here, "
    tail = ", and then the sentence keeps going for a good while afterward to add even more length."
    text = lead + LONG_TOKEN + tail
    assert len(text) > 300

    pieces = slices(text)
    assert "".join(pieces) == text
    for piece in pieces:
        # A split token leaves a bare "[[latex:" substring with no matching
        # close -- this count only agrees when every token in the piece is whole.
        assert piece.count("[[latex:") == len(MATH_TOKEN_RE.findall(piece))
    assert any(piece == LONG_TOKEN for piece in pieces)


def test_splits_on_terminal_punctuation():
    text = "People conform. Others resist! Why? Nobody knows."
    assert slices(text) == ["People conform.", "Others resist!", "Why?", "Nobody knows."]


def test_offsets_index_into_the_original_string():
    text = "First one. Second one."
    pairs = split_sentences(text)
    assert pairs[0] == (0, 10)
    assert text[pairs[1][0]:pairs[1][0] + pairs[1][1]] == "Second one."


def test_does_not_split_on_titles_and_abbreviations():
    text = "Dr. Milgram ran the study. It shocked people."
    assert slices(text) == ["Dr. Milgram ran the study.", "It shocked people."]


def test_does_not_split_inside_a_decimal():
    assert slices("The mean was 3.14 overall. That is high.") == \
        ["The mean was 3.14 overall.", "That is high."]


def test_does_not_split_inside_a_citation():
    assert slices("Obedience was high (Milgram, 1963). Later work agreed.") == \
        ["Obedience was high (Milgram, 1963).", "Later work agreed."]


def test_a_heading_without_punctuation_is_one_sentence():
    assert slices("Social Cognition") == ["Social Cognition"]


def test_keeps_a_closing_quote_with_its_sentence():
    assert slices('She said "no." Then she left.') == ['She said "no."', "Then she left."]


def test_caps_a_runaway_sentence_at_max_chars():
    text = "word " * 200  # 1000 chars, no terminal punctuation
    pairs = split_sentences(text.strip(), max_chars=300)
    assert len(pairs) > 1
    assert all(n <= 300 for _, n in pairs)


def test_returns_nothing_for_blank_input():
    assert split_sentences("   ") == []


def test_splits_when_an_abbreviation_ends_the_sentence():
    """The issue's example: "U.S." at a full stop, modifying nothing after it.

    Under-split today -- the listener gets no pause where the author put one, and
    the highlight covers both sentences for the whole duration.
    """
    text = ("Obedience research was concentrated in the U.S. "
            "Later work replicated it in Europe.")
    assert slices(text) == [
        "Obedience research was concentrated in the U.S.",
        "Later work replicated it in Europe.",
    ]


def test_every_u_s_in_the_fixtures_lands_on_the_intended_side():
    """The readout for this change: how much of a real page it actually moves.

    Every "U.S." in pipeline/tests/fixtures/, verbatim, with the number of
    Sentences its surrounding text must produce. Four are followed by a lowercase
    word and never reach the abbreviation rule at all -- BOUNDARY_RE filters them.
    The fifth, "(U.S. Census Bureau, n.d.)", does reach it and must be vetoed.

    NONE of the five moves, so this change alters no manifest that exists today.
    The sixth row is the issue's own example and is the only one that must move.
    A rule that loosens moves a row here before it reaches a reader.
    """
    corpus = [
        # figures.html:69 -- lowercase continuation.
        ("that helped end racial segregation in U.S. public schools, and more.", 1),
        # figures.html:182, twice.
        ("Minorities will account for more of the U.S. workforce over the next "
         "decades.", 1),
        ("Minorities, now roughly one third of the U.S. population, are expected "
         "to become the majority by 2042.", 1),
        # figures.html:182 -- the ONE real occurrence that reaches the rule.
        ("By 2023, more than half of all children will be minorities "
         "(U.S. Census Bureau, n.d.).", 1),
        # prose.html:126.
        ("John Jost and his colleagues asked over 2,500 U.S. citizens the "
         "following question:", 1),
        # The issue's example -- the only row that must move.
        ("Obedience research was concentrated in the U.S. Later work replicated "
         "it in Europe.", 2),
    ]
    assert [len(split_sentences(text)) for text, _ in corpus] == \
        [expected for _, expected in corpus]


def test_the_sentence_ending_set_is_a_subset_of_the_abbreviations():
    """This change is a second question about a word already on the list, not a
    widening of it -- the issue says so, and a word that is only in the smaller
    set would be dead code, because _is_false_boundary consults it exclusively
    inside the `word in ABBREVIATIONS` branch.

    Imported inside the function on purpose: before Task 5 these names do not
    exist, and a module-level import would turn the whole file into a collection
    error and make every other red/green reading in this suite unreadable.
    """
    from pipeline.tokenize import ABBREVIATIONS, SENTENCE_ENDING_ABBREVIATIONS
    assert SENTENCE_ENDING_ABBREVIATIONS <= ABBREVIATIONS


def test_does_not_split_when_an_abbreviation_modifies_a_proper_noun():
    """The must-not-regress case, and it is real text.

    fixtures/figures.html:182 reads "(U.S. Census Bureau, n.d.)". "U.S." is
    followed by a CAPITAL there, exactly like the issue's example -- but it
    modifies "Census Bureau" and a split would put a pause inside a proper noun,
    which a listener hears as a mistake. The other three are the same shape and
    are what any real book of American history is full of.
    """
    assert slices("By 2023, more than half of all children will be minorities "
                  "(U.S. Census Bureau, n.d.). These changes continue.") == [
        "By 2023, more than half of all children will be minorities "
        "(U.S. Census Bureau, n.d.).",
        "These changes continue.",
    ]
    for text in (
        "The law was passed by the U.S. Congress in 1964.",
        "It was argued before the U.S. Supreme Court that year.",
        "Funding came from the U.S. Department of Defense.",
    ):
        assert slices(text) == [text]


def test_a_title_never_splits_even_before_a_word_that_opens_a_sentence():
    """The two-tier rule, stated as a test.

    "cf." is in ABBREVIATIONS and NOT in SENTENCE_ENDING_ABBREVIATIONS, so the
    lookahead is never consulted for it. This is what separates a title -- which
    always precedes the thing it modifies -- from "U.S.", which can sit at a full
    stop. Without the two tiers, "Dr. The..." and every abbreviation followed by
    a function word would gain a pause inside a name.
    """
    text = "Compare the two accounts, cf. The Authoritarian Personality, chapter 3."
    assert slices(text) == [text]


def test_et_al_before_a_parenthesised_year_never_splits():
    """"et al." commonly DOES end a sentence, and it is still an unconditional
    veto, on purpose.

    BOUNDARY_RE accepts "(" as a sentence opener, so "Smith et al. (2020) found"
    proposes a boundary. tokenize.rs excludes "al" from its own sentence-ending
    set for exactly this reason (tokenize.rs:158-161). Cheap to lose, expensive
    to get wrong in a citation-dense book.
    """
    text = "The finding was replicated by Smith et al. (2020) in a larger sample."
    assert slices(text) == [text]


def test_an_ambiguous_abbreviation_under_splits_rather_than_guessing():
    """The safe failure, asserted so a later change cannot quietly reverse it.

    "Milgram" is a capitalised content word, indistinguishable from "Census" in
    "U.S. Census Bureau" without knowing what the words mean. So this stays one
    Sentence and the listener loses a beat. The other direction -- a pause
    inserted inside a proper noun -- is heard as a mistake, and that asymmetry is
    why this file resolves ambiguity downward.
    """
    text = "The work was concentrated in the U.S. Milgram replicated it in Munich."
    assert slices(text) == [text]


# Verbatim from social_psychology 11.03 "Improving Group Performance". The middle
# sentence is 304 chars, so the 300-char cap wraps it -- and the last clause
# boundary inside the window falls back at "(Bond & Keys, 1993; ", far enough that
# rfind(" ") won and produced the one-word tail "loafing." Kept verbatim rather
# than synthesised: a hand-written approximation does NOT reproduce this (the
# first attempt at this test passed immediately).
LOAFING_BLOCK = (
    "It turns out that the size of the group matters in this regard. Although "
    "larger groups are more able than smaller ones to diversify into specialized "
    "roles and activities, and this is likely to make them efficient in some ways "
    "(Bond & Keys, 1993; Miller & Davidson-Podgorny, 1987), larger groups are also "
    "more likely to suffer from coordination problems and social loafing. The "
    "problem is that individuals in larger groups are less likely to feel that "
    "their effort is going to make a difference to the output of the group as a "
    "whole or that their contribution will be noticed and appreciated by the other "
    "group members (Kerr & Bruun, 1981)."
)


def test_a_wrapped_sentence_never_ends_in_a_one_word_orphan():
    """The tail of a hard wrap is a real sentence: the reader SPEAKS it and the
    translator has to translate it. "loafing." alone is neither. Supertonic reads
    it as its own utterance, and opus-mt-en-it rendered it "Paffuto." ("chubby"),
    which the QA gate then scored as an Italian defect -- one of four such
    non-sentences among the 10 failures that dropped Italian by 0.12pp. 312 of
    14,418 sentences in the shipped book are cut this way."""
    pieces = [LOAFING_BLOCK[o:o + n].strip()
              for o, n in split_sentences(LOAFING_BLOCK, max_chars=300)]
    orphans = [p for p in pieces if len(p.split()) < 3]
    assert not orphans, f"one-word tails: {orphans}"


def test_a_wrapped_head_does_not_end_mid_clause():
    """The same defect seen from the other side: the head used to end
    "...and social" with the tail carrying the noun it belonged to."""
    pieces = [LOAFING_BLOCK[o:o + n].strip()
              for o, n in split_sentences(LOAFING_BLOCK, max_chars=300)]
    assert not any(p.endswith(" social") for p in pieces), pieces


def test_wrapping_still_respects_the_cap():
    """The minimum-tail rule must not be satisfiable by simply not wrapping."""
    pieces = split_sentences(LOAFING_BLOCK, max_chars=300)
    assert all(n <= 300 for _, n in pieces)
