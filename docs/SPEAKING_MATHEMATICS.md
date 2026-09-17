# Speaking mathematics and chemistry aloud

**Audience: developers implementing equation speech in the LibreTexts reader.**

This describes how the reader turns an equation into words a listener can follow,
and why each rule exists. The reference implementation is
`pipeline/math_phrasing.py` (Python), but nothing here depends on Python — the
rules are string transformations over the output of an off-the-shelf engine, and
port directly to JavaScript.

---

## 1. The pipeline

```
LaTeX in the page
      │
      ▼
MathJax (tex input)  ──►  MathML
      │
      ▼
Speech Rule Engine (SRE), Clearspeak domain, en locale
      │
      ▼
phrase()  ── the rules in this document ──►  words
      │
      ▼
text-to-speech
```

SRE is Apache-2.0 and is the engine behind MathJax's own *Accessibility →
Speech* menu. **Do not write your own narrator.** SRE handles the structural
work — fractions, radicals, matrices, sub/superscripts, tables — correctly and
in a way that has been tested by the accessibility community for years.

What SRE does *not* do is speak like a subject-matter teacher. It narrates
**structure**, faithfully and verbosely. Everything in this document is a thin
correction layer on top of it. Expect to keep about this much correction and no
more; if you find yourself rewriting SRE's output wholesale, something upstream
is wrong.

### A hard rule: the model advises, it never writes

We use a language model to *review* how equations are read, never to generate
the words. A model turns `0.125` into `0.25` fluently and nothing downstream
catches it, which in a chemistry textbook means the audio confidently
contradicts the equation on screen. SRE cannot do that: it is a deterministic
walk over MathML.

Determinism also matters for builds. Speech text is hashed to decide what needs
re-translating; non-deterministic output re-triggers translation across every
language on every build.

---

## 2. Why a correction layer is needed at all

Clearspeak narrates chemistry as if it were algebra. Measured over 5,166
equations in one General Chemistry textbook, **before** any correction:

| SRE said | for | count |
|---|---|---|
| `right harpoon over left harpoon` | ⇌ | 334 |
| `H of sub two` | H₂ | 559 |
| `N sub two times g` | N₂(g) | 640 |
| `raised to the plus power` | ⁺ | 491 |
| `open bracket N O two close bracket` | [NO₂] | 546 |
| `en dash` | − (minus) | 246 |
| `m o l`, `k J`, `a t m` | mol, kJ, atm | 563 |

The `en dash` case is the one to take seriously: it is not merely ugly. "Delta G
equals **en dash** R T natural log K" drops the negation, so a listener hears the
opposite of the mathematics.

---

## 3. The rules

Applied in this order. Order matters — see §5.

### 3.1 Unguarded — apply to every equation

These correct wording that is wrong in **any** subject, so they need no context.

| # | From | To | Why |
|---|---|---|---|
| 1 | `right harpoon over left harpoon`, and `left harpoon with barb down … right harpoon with barb up` | `in equilibrium with` | Only ever the ⇌ arrow. SRE has two wordings depending on the source symbol; handle both. Also consume a preceding `times`, which SRE inserts between the last reactant and the arrow. |
| 2 | `increment` | `delta` | Clearspeak's name for the Δ operator. |
| 3 | `en dash` | `minus` | **Correctness, not style.** See above. |
| 4 | `l n`, `l n of` | `natural log` | SRE spells `ln` as letters. |
| 5 | `of sub` | `sub` | Ungrammatical in any domain. |
| 6 | `<lone letter> of <Capital>`, `sub <number> of <Capital>` | drop the `of` | Clearspeak reads juxtaposition as function application, so `MgO` becomes "M g **of** O". **Anchor on a lone letter or a subscript**, never a general `of`, or you destroy English: *"the absolute value **of** D"* must survive. |
| 7 | `raised to the plus power` / `minus power` | `plus` / `minus` | Ionic charge. |
| 8 | `open bracket X close bracket` → `the concentration of X` | but only when `X` is formula-shaped | `[X]` is also a closed interval and a floor function. Check the shape of the contents. |

### 3.2 Guarded — chemistry equations only

These would corrupt ordinary algebra, where `times s` is a multiplication and
`M` is a matrix. **They must not run unconditionally.**

| # | From | To |
|---|---|---|
| 9 | `times g` / `of g` / `open paren g close paren` / `a q` | `gas`, `liquid`, `solid`, `aqueous` |
| 10 | `sub open paren <number> K close paren` | `at <number> kelvin` |
| 11 | `open paren X close paren` | `X` — parens carry nothing a listener needs in a formula |
| 12 | `sub <number>` | drop `sub` — nobody says "O **sub** two" |
| 13 | `<number> times <Capital>` | drop `times` — a coefficient, not a product |
| 14 | `m o l`→`moles`, `k J`→`kilojoules`, `a t m`→`atmospheres`, `m L`→`millilitres`, `k g`→`kilograms`, `c m`→`centimetres`, `k P a`→`kilopascals` | an **explicit list** |
| 15 | `<lowercase> M` | `molar` |

> **Rule 12 keeps `sub` before a NAME.** `K_c` really is "K sub c"; dropping it
> gives "K c". Only `sub` before a *number* is removed.

> **Rule 14 must be an explicit list, never a pattern over spaced letters.**
> Chemical formulas are also spelled letter-by-letter and are *correct* that way
> — `C O` is carbon monoxide, `N H` begins ammonia. A general rule would wreck
> every formula in the book.

---

## 4. Deciding whether an equation is chemistry

Rules 9–15 need to know the subject. Two sources of evidence, in this order:

1. **The book.** If the textbook is a chemistry text, every equation is
   chemistry. This is the important one, and it is not optional.
2. **The equation.** Otherwise look at the LaTeX for `\ce{…}` (mhchem), an
   equilibrium arrow, or a literal `(g)`/`(l)`/`(s)`/`(aq)`.

**Per-equation evidence alone is not sufficient, and this is the single
subtlest thing in this document.** `N_2` on its own is indistinguishable from an
algebraic subscript. With only per-equation evidence, one page read the same
molecule as "N sub two" in a bare formula and "N two" three rows later inside a
reaction — a reader that switches dialect mid-page is worse than either choice
consistently. Worse, thermodynamics (`ΔG_rxn = RT ln(Q/K_eq)`) carries no `\ce`
and no state label, so **none** of the chemistry rules reached the equations a
chemistry textbook is mostly made of. Roughly 30% of affected equations were
missed this way.

Declare the book.

---

## 5. Ordering traps

Two ordering bugs cost real time here. Both passed their unit tests and did
nothing whatsoever on real input.

1. **Spell numbers *before* the chemistry rules.** SRE emits digits (`2 times NH
   sub 3`), so a coefficient rule written against number-*words* never matches,
   and a "lowercase letter before M" rule never sees `188 M`.
2. **Any rule anchored on a digit must run before number-spelling.** The rule
   that turns SRE's spoken word `comma` into a mark anchors on a preceding
   digit, and stops matching once digits have become words.

Numbers must be spelled at all: the voice cannot reliably pronounce a bare
numeral. Measured through the engine — `1000` came out "thousand", `0.125` as
"0125", `857142` as noise. Spelled as words, all are correct.

**Do not spell a dotted reference.** `1.4.1` is a page index or a
cross-reference, not a quantity; spelling it gives "one point four.one". Hold
out anything with two or more dots.

---

## 6. Regex hazard

The concentration rule was first written as:

```
open bracket ((?:[A-Za-z]+|sub \w+|\s)+?) close bracket
```

Those nested quantifiers backtrack catastrophically on any `open bracket` with
no `close bracket` after it. It does not run slowly — **it hangs the build**.
Use a flat character class with a bounded length and move the shape test into
code.

---

## 7. How to tell whether it worked

Counting successes proves nothing. Two examples from this work:

- The build reported `41 spoken, 0 failed` for a page that mispronounced its
  arithmetic. `failed` counts equations the *engine* could not convert; it is
  blind to equations it converted into the wrong words.
- MathJax reported 50 rendered equations on a page where all 50 had **zero
  width** and were invisible.

Measure one layer closer to the user:

- **Render the audio and transcribe it back.** Whisper reassembling
  `"N2 gas plus O2 gas in equilibrium with 2 NO gas"` from the audio is strong
  evidence it sounds like chemistry.
- **Run the rules over the whole corpus, not your examples.** Both ordering bugs
  and the regex hang were found this way and could not have been found any other.
- **Have a person listen.** Every remaining defect in this document was found by
  a human saying "that doesn't sound right", after automated checks passed.

`scripts/math-audit.mjs` builds a page showing, per equation: the LaTeX, the
typeset mathematics, the exact spoken words, and a play button in the real
voice. That is the artefact to review.

---

## 8. Known limits

- `K(RT)^{Δn}` still reads "raised to the Delta n power".
- `BH⁺` narrates as "B the plus power of H" — SRE orders it oddly.
- `mol/L` reads "moles divided by L" rather than "moles per litre".
- ~42 equations retain a parenthesis (nested cases).
- Speech Rule Engine has no locale for Czech, Dutch or Hungarian; it falls back
  to **English silently**. A translated track must handle that explicitly.
- Complex thermodynamics read as one linear sentence may be inherently hard to
  follow. This is a design question, not a phrasing bug: consider whether the
  listener should be following the equation visually.
