"""Spoken forms for the math tokens on a page.

The words come from Speech Rule Engine, the engine behind MathJax's own
Accessibility > Speech menu, running in `scripts/math-speech.mjs` under Node.
This module owns the process, the per-page macro context, the failure policy
and the token plumbing; the JavaScript owns nothing but conversion.

Failure policy has two tiers, and only the first is per-span:

- A single span the bridge REPORTS as unconvertible (an `{"error": ...}`
  reply) is spoken as FALLBACK_SPEECH and counted in `failed`. A dropped
  sentence is the silent failure this feature exists to end, so nothing here
  ever removes one for a bad equation.
- A DEAD bridge -- the subprocess exited, so `_ask`'s `readline()` returns ""
  -- aborts the whole run with a bare `RuntimeError`. This is deliberate, not
  an oversight: a dead process cannot be trusted to keep matching reply to
  request for whatever pages are left, and guessing would risk speaking one
  page's equations under another page's macro context with no error at all.
  Whatever pages were already written stand as they are; the caller re-runs
  once the environment is fixed. `_ask` also blocks forever on `readline()`
  if the bridge hangs without exiting (neither replies nor dies) -- there is
  no timeout, so a hang here hangs the whole pipeline run rather than
  silently skipping pages.
"""

import json
import re
import shutil
import subprocess
from pathlib import Path

from pipeline.extract import MATH_TOKEN_RE, decode_math_token
from pipeline.math_phrasing import phrase

SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "math-speech.mjs"
FALLBACK_SPEECH = "an equation"

_PLACEHOLDER_RE = re.compile(r"\[\[MATH(\d+)\]\]")


class MathSpeechUnavailable(RuntimeError):
    """`node` is not on PATH. Node is a build dependency (vite), so this is a
    broken environment, not a page problem."""


def _drop_leading_zeros(part: str) -> str:
    """One dotted component, the way the site's `parseInt(part, 10)` treats it.

    The site only calls parseInt on a component containing a "0", so `12` is
    left alone and `04` becomes `4`. On a component that is not a number at all
    parseInt yields NaN and the site renders the literal string "NaN"; that is a
    bug in the site, not a page number, so the component is kept verbatim here.
    """
    return str(int(part)) if "0" in part and part.isdigit() else part


def page_index_prefix(title: str) -> str | None:
    """`1.04: The First Law` -> `1.4`, the way the site's own config computes it.

    The site (`front`, in the inline MathJax config on every LibreTexts page)
    takes everything before the FIRST colon verbatim, and only when that
    contains a dot does it map each component through parseInt. So a page number
    need not be decimal at all: `5C`, `1.E`, `Unit I` and `05A1` are all real
    chem_4b prefixes and all pass through unchanged. A title with no colon has
    no page number and yields None.
    """
    front = (title or "").strip()
    if ":" not in front:
        return None
    front = front.split(":")[0].strip()
    if "." in front:
        front = ".".join(_drop_leading_zeros(part) for part in front.split("."))
    return front or None


# Evidence in the LaTeX that a span is chemistry rather than algebra. The
# state-label and molarity rules in math_phrasing need this, because "times s"
# is a multiplication in algebra and M is far more often a matrix than a
# molarity. Measured over chem_4b: catches 92-100% of the spans carrying a
# state label, and wrongly flags 1 of math_elem_teachers' 689 spans.
_CHEM_RE = re.compile(
    r"\\ce\b|\\rightleftharpoons|\\rightleftarrows"
    r"|\(\s*(?:g|l|s|aq)\s*\)|\\mathrm\{\s*(?:g|l|s|aq)\s*\}")


def is_chemistry(tex: str) -> bool:
    return bool(_CHEM_RE.search(tex or ""))


def chemistry_span(tex: str, *, chem_book: bool = False) -> bool:
    """Should this span get chemistry phrasing?

    The per-span evidence cannot see everything: `N_2` alone is indistinguishable
    from an algebraic subscript, so on one chem_4b page the same molecule was
    read "N sub two" in a bare formula and "N two" inside a reaction. The book is
    the only place that knowledge exists, so a chemistry book overrides.
    """
    return chem_book or is_chemistry(tex)


def split_math(text: str) -> tuple[str, list[str]]:
    """Tokens -> numbered placeholders, so normalize_for_speech never sees base64.

    Not pipeline.protect.mask: that masks URLs and emails too, and the normaliser
    must still turn those into "link" and "email address" here.
    """
    tokens: list[str] = []

    def swap(match: re.Match) -> str:
        tokens.append(match.group(0))
        return f"[[MATH{len(tokens) - 1}]]"

    return MATH_TOKEN_RE.sub(swap, text), tokens


def join_math(masked: str, replacements: list[str]) -> str:
    return _PLACEHOLDER_RE.sub(lambda m: replacements[int(m.group(1))], masked)


def substitute_math(text: str, math_speech: dict[str, str]) -> str:
    return MATH_TOKEN_RE.sub(lambda m: math_speech.get(m.group(0), FALLBACK_SPEECH), text)


class MathSpeaker:
    def __init__(self, script: Path = SCRIPT):
        self._script = script
        self._proc: subprocess.Popen | None = None

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()

    def _ensure(self) -> subprocess.Popen:
        if self._proc is None:
            if shutil.which("node") is None:
                raise MathSpeechUnavailable("node not found; it is required to speak equations")
            self._proc = subprocess.Popen(
                ["node", str(self._script)],
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, encoding="utf-8",
            )
        return self._proc

    def _ask(self, message: dict) -> dict:
        proc = self._ensure()
        proc.stdin.write(json.dumps(message, ensure_ascii=False) + "\n")
        proc.stdin.flush()
        # No timeout: a bridge that hangs without exiting blocks here forever,
        # which blocks the whole pipeline run. That is intentional -- see the
        # module docstring's failure policy -- rather than a missing feature.
        line = proc.stdout.readline()
        if not line:
            # The bridge process has exited. Abort the whole run rather than
            # restart it and guess whether the reply that comes back still
            # belongs to this request: pages already written are left alone,
            # and the caller re-runs once the environment is fixed. See the
            # module docstring's failure policy.
            raise RuntimeError("math-speech bridge exited")
        return json.loads(line)

    def reset(self, macros: dict[str, str]) -> None:
        self._ask({"reset": True, "macros": {k: v for k, v in macros.items() if v}})

    def define(self, tex: str) -> None:
        self._ask({"define": tex})

    def speak(self, tex: str, display: bool) -> str | None:
        reply = self._ask({"id": "s", "tex": tex, "display": display})
        return reply.get("speech")

    def close(self) -> None:
        if self._proc is not None:
            self._proc.stdin.close()
            self._proc.wait(timeout=10)
            self._proc.stdout.close()
            self._proc = None


def speak_tokens(speaker: MathSpeaker, tokens: list[str], *, title: str,
                 preamble: list[str], chem_book: bool = False) -> tuple[dict[str, str], int]:
    """One page's tokens -> {token: phrased speech}, plus how many fell back."""
    speaker.reset({"PageIndex": page_index_prefix(title)})
    for definition in preamble:
        speaker.define(definition)

    out: dict[str, str] = {}
    failed = 0
    for token in tokens:
        if token in out:
            continue
        tex, display = decode_math_token(token)
        spoken = speaker.speak(tex, display)
        if spoken is None or not spoken.strip():
            failed += 1
            spoken = FALLBACK_SPEECH
        out[token] = phrase(spoken, display, chem=chemistry_span(tex, chem_book=chem_book))
    return out, failed
