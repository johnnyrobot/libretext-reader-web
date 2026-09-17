"""The languages listen mode ships, and the checkpoints that produce them.

Model names are recorded, never constructed. `opus-mt-en-<code>` does not exist for
pt, pl, ko, tr, lt, lv, ja, hr or sl -- those live under `opus-mt-tc-big-en-<code>`
or a language-group model. A resolver that builds names by pattern reports nine of
these twenty-nine as unavailable and silently ships twenty.

`forward_token` is the `>>xxx<<` prefix that group and multilingual models need to
pick a target. Omitting it on a group model yields fluent output in the wrong
language -- which back-translation catches, but which should never be reached.
"""

from dataclasses import dataclass

H = "Helsinki-NLP/"


@dataclass(frozen=True)
class Language:
    code: str
    english: str
    endonym: str
    forward: str
    reverse: str
    forward_token: str | None = None
    reverse_token: str | None = None


def _l(code, english, endonym, fwd, rev, ftok=None, rtok=None) -> Language:
    return Language(code, english, endonym, H + fwd, H + rev, ftok, rtok)


TARGETS: dict[str, Language] = {lang.code: lang for lang in [
    # REVERSE is the plain checkpoint, NOT opus-mt-tc-big-ar-en -- see BROKEN_REVERSE below.
    _l("ar", "Arabic", "العربية", "opus-mt-tc-big-en-ar", "opus-mt-ar-en"),
    _l("bg", "Bulgarian", "български", "opus-mt-tc-big-en-bg", "opus-mt-tc-big-bg-en"),
    _l("cs", "Czech", "čeština", "opus-mt-en-cs", "opus-mt-cs-en"),
    _l("da", "Danish", "dansk", "opus-mt-en-da", "opus-mt-da-en"),
    _l("de", "German", "Deutsch", "opus-mt-en-de", "opus-mt-de-en"),
    _l("el", "Greek", "Ελληνικά", "opus-mt-tc-big-en-el", "opus-mt-tc-big-el-en"),
    _l("es", "Spanish", "español", "opus-mt-tc-big-en-es", "opus-mt-es-en"),
    _l("et", "Estonian", "eesti", "opus-mt-tc-big-en-et", "opus-mt-tc-big-et-en"),
    _l("fi", "Finnish", "suomi", "opus-mt-tc-big-en-fi", "opus-mt-tc-big-fi-en"),
    _l("fr", "French", "français", "opus-mt-tc-big-en-fr", "opus-mt-tc-big-fr-en"),
    _l("hr", "Croatian", "hrvatski", "opus-mt-en-sla", "opus-mt-sla-en", ">>hrv<<"),
    _l("hu", "Hungarian", "magyar", "opus-mt-tc-big-en-hu", "opus-mt-tc-big-hu-en"),
    _l("id", "Indonesian", "Bahasa Indonesia", "opus-mt-en-id", "opus-mt-id-en"),
    # REVERSE is the plain checkpoint, NOT opus-mt-tc-big-it-en -- see BROKEN_REVERSE below.
    _l("it", "Italian", "italiano", "opus-mt-tc-big-en-it", "opus-mt-it-en"),
    _l("ja", "Japanese", "日本語", "opus-mt-en-mul", "opus-mt-ja-en", ">>jpn<<"),
    _l("ko", "Korean", "한국어", "opus-mt-tc-big-en-ko", "opus-mt-tc-big-ko-en"),
    _l("lt", "Lithuanian", "lietuvių", "opus-mt-tc-big-en-lt", "opus-mt-tc-big-lt-en"),
    _l("lv", "Latvian", "latviešu", "opus-mt-tc-big-en-lv", "opus-mt-tc-big-lv-en"),
    _l("nl", "Dutch", "Nederlands", "opus-mt-en-nl", "opus-mt-nl-en"),
    _l("pl", "Polish", "polski", "opus-mt-en-sla", "opus-mt-pl-en", ">>pol<<"),
    # opus-mt-roa-en (Romance-languages group -> English) targets a single language
    # ("target language(s): eng" per the model card), so unlike the *-sla and *-mul
    # forward group models it takes no ">>xxx<<" selector token in either direction.
    _l("pt", "Portuguese", "português", "opus-mt-tc-big-en-pt", "opus-mt-roa-en"),
    _l("ro", "Romanian", "română", "opus-mt-tc-big-en-ro", "opus-mt-roa-en"),
    _l("ru", "Russian", "русский", "opus-mt-en-ru", "opus-mt-ru-en"),
    _l("sk", "Slovak", "slovenčina", "opus-mt-en-sk", "opus-mt-sk-en"),
    _l("sl", "Slovenian", "slovenščina", "opus-mt-en-sla", "opus-mt-sla-en", ">>slv<<"),
    _l("sv", "Swedish", "svenska", "opus-mt-en-sv", "opus-mt-sv-en"),
    _l("tr", "Turkish", "Türkçe", "opus-mt-tc-big-en-tr", "opus-mt-tc-big-tr-en"),
    _l("uk", "Ukrainian", "українська", "opus-mt-en-uk", "opus-mt-uk-en"),
    _l("vi", "Vietnamese", "Tiếng Việt", "opus-mt-en-vi", "opus-mt-vi-en"),
]}

# Recorded rather than merely absent, so a later reader does not "fix" the omission.
EXCLUDED: dict[str, str] = {
    "hi": (
        "Supertonic's unicode_indexer.json maps 62 of 128 Devanagari codepoints. "
        "U+090B DEVANAGARI LETTER VOCALIC R is a core vowel of ordinary academic "
        "Hindi and has no canonical decomposition, so NFKD cannot rescue it. Also "
        "unmapped: U+090C, U+0960, U+0961, the candra vowels, and all ten "
        "Devanagari digits. A hole in the core alphabet means systematic "
        "mispronunciation, which for a reading aid is worse than not offering it."
    ),
}

# Reverse checkpoints that are MISPACKAGED ON THE HUB and must never be used, with
# the plain `opus-mt-<code>-en` substituted in TARGETS above. Recorded, not merely
# avoided: `opus-mt-tc-big-<code>-en` looks like a strict upgrade over the plain
# checkpoint -- it is bigger and newer -- so a later reader repointing these "back"
# is the obvious mistake, and it fails in a way that is easy to misread.
#
# The failure is silent and expensive. The FORWARD direction is perfect; only the
# round trip is garbage, so pipeline/qa.py scores a flawless translation as total
# collapse. Measured 2026-08-25: Italian screened at a 100.0% failure rate with
# median 0.000, which reads exactly like "this language is unshippable" rather than
# "this checkpoint is broken". Verified through plain transformers as well as
# CTranslate2, so it is not a conversion artifact.
#
# NOT a tc-big class defect -- that was checked, not assumed. opus-mt-tc-big-fr-en,
# -fi-en and -hu-en all round trip correctly and stay in TARGETS, so every French
# QA number this gate has produced stands.
BROKEN_REVERSE: dict[str, str] = {
    "it": (
        "opus-mt-tc-big-it-en carries its FORWARD twin's vocabulary (54422 entries) "
        "and eos id (43017), so generated tokens decode in the wrong embedding "
        "space: 'Anche se il confronto verso l'alto...' returns 'hoax "
        "Passwordfivefivefive...'. opus-mt-it-en (80379, eos 0) is correct."
    ),
    "ar": (
        "opus-mt-tc-big-ar-en returns word salad for ordinary Modern Standard "
        "Arabic ('eri Ottomir TrayBack Fri vitamin...'). opus-mt-ar-en is correct."
    ),
}

# Languages whose forward direction is served by a group or multilingual model
# rather than a dedicated pair. Their output is materially weaker, and nobody on
# the project can check them by ear -- treat their QA scores as gating, not advisory.
HIGHER_RISK = frozenset({"hr", "sl", "pl", "ja"})
