# libretext-reader-web

A listen mode for LibreTexts textbook pages. Speech is synthesised **entirely in the
reader's browser** — no audio is generated on a server, and nothing about what is read or
heard leaves the device.

Not to be confused with the desktop LibreTexts Reader, a separate Tauri + React + Rust
application. This project borrows its domain vocabulary and several algorithms; it shares
no code.

## How it works

A build step walks a book's pages and, for each one, writes a `speech.json` beside the
page: every sentence in two forms.

- **Display Text** — what the reader sees. Never modified. Highlighting wraps existing DOM
  nodes in a span; it never replaces, re-renders, or rewrites the text on the page.
- **Speech Text** — what the voice says. Computed once, in the pipeline, not derived at read
  time. Years read as years, `et al.` expands, long citations compress, tables are announced
  rather than read cell by cell.
- **Equations** — a `\( … \)` or `\[ … \]` span is recorded as a `[[latex:<base64>]]` token in
  Display Text and spoken in words (Speech Rule Engine, Clearspeak) in Speech Text. MathJax
  rewrites the span at typeset time, so the reader treats each `<mjx-container>` as one atom
  whose text is that token. Every translated track speaks the equation in English.

At read time a ~1 KB boot script is all that loads. Pressing *Enter Reader Mode* is the
first moment anything else is fetched: the reader consents to the model download, the page
strips to a reading view, and each sentence highlights as it is spoken.

Inference never runs on the main thread. It is multi-second work; on the main thread the
page would freeze mid-scroll. A long task over 100 ms during playback is treated as a bug.

## Workflow

Two halves, joined only by files on disk. The left half runs once per book on a
build machine and needs Python and Node. The right half runs in the visitor's browser
and needs a static file server with the right headers.

```mermaid
flowchart LR
  subgraph build["Build time — once per book (pipeline/, Python + Node)"]
    direction TB
    A[page index.html] --> B["extract.py<br/>blocks, sentences, equation tokens"]
    B --> C["normalize.py<br/>prose → Speech Text"]
    B --> D["math-speech.mjs<br/>MathJax + Speech Rule Engine"]
    D --> E["math_phrasing.py<br/>chemistry, units, subscripts"]
    C --> F[speech.json beside the page]
    E --> F
    F --> G["index.html rewritten in place:<br/>boot tag + Listen button"]
  end
  subgraph read["Read time — in the visitor's browser (src/)"]
    direction TB
    H["boot.js  ~1 KB<br/>the only code a non-listener loads"] -- click --> I[reader.js]
    I --> J["consent → model download<br/>~155 MB, once, into Cache Storage"]
    I --> K[fetch speech.json]
    J --> P["phonon.worker.js<br/>English: Phonon 31M on ONNX Runtime wasm, streamed"]
    K --> P
    P --> M["player.mjs<br/>audio + sentence highlight"]
    I -. language chosen .-> N["translate.worker.js<br/>Opus-MT, per sentence"]
    N --> L["phonon.worker.js, phonon-&lt;lang&gt;/<br/>that language's Phonon 40M, CC BY-NC 4.0,<br/>~190 MB, loaded only then"]
    L --> M
  end
  G --> H
```

What each edge carries:

| from → to | what crosses | where it is defined |
|---|---|---|
| page → `speech.json` | every sentence as Display Text + Speech Text, with character offsets into the page's own text so highlighting can find it | `pipeline/tts_manifest.py` `build_manifest()` |
| `speech.json` → reader | fetched relative to the page URL, so it is always `<page>/speech.json` | `src/reader.mjs` `loadSpeechManifest()` |
| reader → speech worker | one sentence of Speech Text at a time, four to eight ahead of playback | `src/player.mjs` |
| `phonon/manifest.json` → English voice download | name, path, size and sha256 of each model file, plus the pinned Hub revision; the download is verified against it | `scripts/fetch-phonon.py` |
| `phonon-<lang>/manifest.json` → translation voice download | the same shape, for fr, de, es or pt, plus the pinned Ollama ID it was built from; its size is what the language menu and the consent box add to the model's | `scripts/stage-phonon-lang.py` |

The pipeline never runs in the browser and the browser never runs the pipeline. If a
sentence sounds wrong, the fix is in `pipeline/` and the page is rebuilt; nothing in
`src/` decides what words are said.

## Putting it on a library

This is the handoff checklist. Everything below is what the staging mirror does today,
generalised. Budget about a day for a first deployment, most of it waiting on model
conversion and the first book build.

The asset root `/_assets/tts/` is **an absolute path, hard-coded** — in files
under `src/` and `pipeline/`, in `vite.config.js` and in several scripts
(`grep -rl _assets/tts src pipeline scripts vite.config.js` lists them). Serve it at
that path, or change every one of them in a single commit.

### 1. Build the reader and stage the models

```bash
npm install                      # devDependencies are needed: the math bridge runs at build time
python -m venv .venv && .venv/bin/pip install -r pipeline/requirements.txt
npm run build                    # → dist/_assets/tts/
```

Stage the English voice with `python3 scripts/fetch-phonon.py <dir>/phonon`: it fetches
[Phonon 31M](https://huggingface.co/onnx-community/phonon-31m-en-ONNX) at a pinned revision,
checks every file against a pinned size and sha256, and writes `phonon/manifest.json`.
Stage each translation voice with
`python3 scripts/stage-phonon-lang.py <lang> <dir>/phonon-<lang>` (fr, de, es, pt): it
builds that language's Phonon 40M from the Ollama copy `phonon:<lang>` (pinned by its
Ollama ID) into the two ONNX graphs the browser runs, with the Male and Female voices,
`voices/M1.bin` and `voices/F1.bin` (LT-222): one is the copy's own default voice, the
other comes from the voice catalogue in `phonon:40m-<lang>` (also pinned), so both
`ollama pull phonon:<lang>` and `ollama pull phonon:40m-<lang>` must have run first. It
needs numpy and onnx, and refuses a target inside this repository, because those weights
are CC BY-NC 4.0. The weights are not in this repository (see *Model weights* below).
Then lay out the served directory:

```
/_assets/tts/
├── boot.js  reader.js  models.js  qa.js  reader.css  preload-helper.js  from dist/
├── phonon.worker.js  translate.worker.js  transformers.web.js           from dist/
├── phonon/                  English voice (~155 MB): scripts/fetch-phonon.py <this dir>/phonon
├── phonon-fr/ phonon-de/    one Phonon 40M per translation language (~190 MB each):
├── phonon-es/ phonon-pt/      scripts/stage-phonon-lang.py <lang> <this dir>/phonon-<lang>
├── ort-mt/                  onnxruntime-web wasm, for Phonon and the translator
└── mt/                      optional: one directory per language pair + pairs.json
```

`scripts/stage-local.sh` does exactly this into `.stage/` (or `STAGE=<dir>`) and is the
reference for the copy order, including how it picks the right `ort-mt/` binaries out of `node_modules`:
they must be the version transformers.js bundles, because another version's wasm
aborts inside its JS with no readable error. It ends by running
`node scripts/check-no-supertonic.mjs` on the staged directory, which fails if any file
Supertonic used (its root `manifest.json`, `onnx/` and `ort/`; its worker, its four
networks and `voice_styles/` at any depth) or any code pointing at one is still there;
CI runs the same check on the build. Listen mode
runs Phonon only (LT-217), so a mirror that served Supertonic should delete those paths
when it deploys this.

Translation is optional. To ship it, run `scripts/convert-mt-models.py` once (multi-GB
download; ~110 MB served per pair, ~495 MB for Portuguese, the full-size checkpoint) and copy its output to `mt/`, then stage each
language's voice. Serve a pair only with its `phonon-<lang>/`: no other engine speaks
a translation, and the reader offers every language in `mt/pairs.json` that it has a
voice entry for. It reads each voice's manifest only to size the download, and still
offers a language whose manifest does not load. `stage-local.sh`
stages the four voices when `STAGE` is outside the repository (it skips them for the
default `.stage/`, which is inside it), leaves out a language whose voice fails to
build, and prunes `mt/pairs.json` to the languages that have one. Without `mt/` the
language menu does not appear.

`PAGES_FROM=<dir>` makes `stage-local.sh` copy the books from an existing stage instead
of fetching them from the mirror, and rebuild only `_assets/tts/`.

`ASSETS_ONLY=1` stages only `_assets/tts/` and stops: no books, nothing fetched from the
mirror (it still builds, and fetches English Phonon from the Hub). Like every run, it
deletes `STAGE` first, books included, so point it at a directory of its own. The
mirror's deploy script, kept outside this repo, uses it, so what it uploads is this layout.

`PHONON_LANGS` picks which translation voices to stage (default `fr de es pt`; an
empty value stages none). A language left out is pruned from `mt/pairs.json` too.

### 2. Give each page the hook

The pipeline converts `<div class="reader-link">…</div>` — an affordance the mirror's
page template already emits — into the Listen button, and adds one tag before `</head>`:

```html
<button type="button" id="tts-enter" class="reader-link">Enter Reader Mode</button>
<script defer src="/_assets/tts/boot.js"></script>
```

That is the entire contract with the page. On a static mirror, the pipeline writes it.
On a CMS that renders pages dynamically, put the button and the tag in the skin
yourself and call `build_manifest(html, page_id, title)` from `pipeline/tts_manifest.py`
to produce the `speech.json` that must be served at `<page>/speech.json`. `install()`
and `uninstall()` are mirror-specific (they walk `index.html` files on disk);
`build_manifest()` is not.

### 3. Build the book

A book is opted in by name — `ALLOWED_BOOKS` in `pipeline/tts_manifest.py`. That list is
a constant in code, not a flag or an argument, because the pipeline rewrites `index.html`
in place and re-pulling from the source is the only undo. Adding a book is a human edit,
reviewed as a diff.

```bash
.venv/bin/python -m pipeline.tts_manifest <site-root>/<book> --site-root <site-root>
.venv/bin/python -m pipeline.tts_manifest <site-root>/<book> --site-root <site-root> --uninstall
```

`install` writes a `speech.json` beside every page and injects the boot script; `--uninstall`
returns every page to what the source produced. A page with nothing readable — a chapter
landing page, front matter — is left exactly as found, and un-injected if a previous run
got there. Re-running over an already-built book is safe and idempotent.

`CHEMISTRY_BOOKS`, in the same file, marks a book whose every equation is chemistry. That
is not a nicety: the per-equation heuristics cannot tell `N_2` from an algebraic subscript,
so without it one page reads the same molecule two different ways. See
`docs/SPEAKING_MATHEMATICS.md` §4.

The Speech Rule Engine bridge is one Node process for the whole book, so a build is
minutes, not hours. Translation (`pipeline.translate_cli`) is a separate, slower pass
per language and is only needed if you ship `mt/`.

### 4. Send the headers

Four header rules, and each one has been the cause of a silent failure. Copy them from
the mirror's Caddyfile rather than re-deriving them:

```caddyfile
@tts      path /_assets/tts/*
@ttsscope path /<book>/* /_assets/tts/*
@book {
    path /<book>/*                            # every book that carries the reader
    not path /<book>/<page with an iframe>/*  # see below
}

# 1. Cross-origin isolation on the PAGE → SharedArrayBuffer → multi-threaded wasm.
#    Without it the engine still boots, single-threaded, and RTF goes 0.41 → 0.91.
header @book Cross-Origin-Opener-Policy   "same-origin"
header @book Cross-Origin-Embedder-Policy "require-corp"

# 2. A worker spawned from an isolated document must itself carry COEP,
#    or the browser refuses to instantiate it (ERR_BLOCKED_BY_RESPONSE).
header @tts  Cross-Origin-Embedder-Policy "require-corp"
header @tts  Cross-Origin-Resource-Policy "same-origin"

# 3. CSP additions, scoped to the book and the assets. Nothing else changes.
#    'wasm-unsafe-eval'  WebAssembly may compile
#    worker-src blob:    ONNX Runtime spawns its worker from a blob URL
#    script-src blob:    and its wasm threads importScripts() from blob URLs
header @ttsscope Content-Security-Policy "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' blob:; worker-src 'self' blob:; style-src 'self'; img-src 'self'; font-src 'self'; media-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'"

# 4. Models are content-addressed → immutable. The CODE is not: reader.js is
#    imported on click, which a hard refresh does not bypass, so an immutable
#    reader.js keeps a returning visitor on the old bundle for a year.
#    Phonon's weights and voices are immutable; its manifest, config and
#    tokenizer are small and revalidate with the code.
#    Each voice directory is named, not globbed: Caddy reads a path ending in *
#    as a plain prefix, so phonon-*/onnx/* would match nothing. One line each,
#    since a Caddyfile has no line continuation.
@ttsmodels path /_assets/tts/phonon/onnx/* /_assets/tts/phonon/voices/* /_assets/tts/phonon-fr/onnx/* /_assets/tts/phonon-fr/voices/* /_assets/tts/phonon-de/onnx/* /_assets/tts/phonon-de/voices/* /_assets/tts/phonon-es/onnx/* /_assets/tts/phonon-es/voices/* /_assets/tts/phonon-pt/onnx/* /_assets/tts/phonon-pt/voices/*
@ttscode {
    path /_assets/tts/*
    not path /_assets/tts/phonon/onnx/* /_assets/tts/phonon/voices/* /_assets/tts/phonon-fr/onnx/* /_assets/tts/phonon-fr/voices/* /_assets/tts/phonon-de/onnx/* /_assets/tts/phonon-de/voices/* /_assets/tts/phonon-es/onnx/* /_assets/tts/phonon-es/voices/* /_assets/tts/phonon-pt/onnx/* /_assets/tts/phonon-pt/voices/*
}
header @ttsmodels Cache-Control "public, max-age=31536000, immutable"
header @ttscode   Cache-Control "public, max-age=0, must-revalidate"
```

Two things to check against your own site before pasting. **A page with a cross-origin
`<iframe>` cannot be isolated**: COEP blocks any frame whose own response does not send
COEP, and a YouTube or ADAPT embed does not. Find them (`grep -rl '<iframe' <book>`) and
exclude those paths from `@book`; the reader still works there, single-threaded. Images and
other subresources are only a concern if your CSP currently lets them load cross-origin —
if `img-src 'self'` already blocks them, isolation costs nothing more. And `.wasm` must be
served as `application/wasm` or ONNX Runtime refuses to stream-compile it.

### 5. Verify, then listen

```bash
SMOKE_BASE=https://<host> SMOKE_BOOK=<book> SMOKE_PAGE=/<book>/<a page>/ bash scripts/smoke.sh
node scripts/math-audit.mjs --url https://<host>/<book>/<a page with equations>/
```

`smoke.sh` checks the things above (button, `speech.json` offsets, the page's isolation
headers and CSP, scope), that the worker answers 200 with its own COEP and CORP, that each
language's manifest names both models and both voices and answers 200 with every file it
names, that the models and voices are cached for a year and the code and the manifests
revalidate (a header alone proves nothing: Caddy sends it on a 404 too). It checks English and the four translations; a host that serves English only
sets `SMOKE_VOICES=phonon`. It prints `SMOKE_OK`, or one line per check that failed. Then open a page, press
*Enter Reader Mode*, accept the download, press ▶, and listen — see *Checking that it
sounds right* for why that last step is not optional.

### Rolling back

`--uninstall` on the book is exact and takes seconds: every page returns byte-identical to
its source and `speech.json` is removed. The headers and the staged assets are left in
place on purpose — with no page carrying the boot tag they are never requested, and
removing them is a separate, human decision.

The voices roll back by directory. Each language's `phonon-<lang>/` and its `mt/en-<lang>/`
pair are self-contained, so removing one and its entry in `mt/pairs.json` takes that
language off the menu without touching the others. A reader who already downloaded it
keeps its files in Cache Storage until the site clears them; they are never fetched again.
Restoring a previous stage of `/_assets/tts/` as a whole is the full rollback; the
reader's code and its voices are versioned together, so restore them together.

## Porting the equation speech to another stack

**[`docs/SPEAKING_MATHEMATICS.md`](docs/SPEAKING_MATHEMATICS.md)** is the reference for
speaking equations and chemistry aloud, written for anyone porting this to another stack.
It states each rule as a string transformation over Speech Rule Engine's output, with the
reason it exists and the measured number of equations it fixes, and it is explicit about
the parts that are easy to get wrong: which rules are safe to run unconditionally and
which are not, why the subject has to come from the book rather than the equation, why
units must be an explicit list, and the two orderings that silently do nothing if you get
them backwards.

`pipeline/math_phrasing.py` is the reference implementation of those rules;
`scripts/math-audit.mjs` renders a page of equations with their spoken form and audio so
the result can be checked by ear.

[`docs/`](docs/) indexes everything else.

## Requirements

**Cross-origin isolation is mandatory, not an optimisation.** Without `SharedArrayBuffer`
the wasm backend runs single-threaded and measured real-time factor goes from 0.410 to
0.912 — past the 0.500 budget, which means playback cannot keep pace with itself. The
serving origin must send `Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp` — step 4 under *Putting it on a library*
has the full set, and the failure is silent: the engine boots and simply cannot keep up.

**It needs a reasonably quick machine.** Measured under a CPU quota on four cores, the
budget is cleared only within roughly 10% of an Apple M1 Ultra-class core; at half that
per-core speed the median RTF is 0.970, which technically produces audio while never
building a buffer. Peak memory during synthesis is about 1.7 GB.

## Model weights are not included

English is spoken by **Phonon by Gradium, Apache 2.0**:
[`onnx-community/phonon-31m-en-ONNX`](https://huggingface.co/onnx-community/phonon-31m-en-ONNX),
an export of `gradium/phonon-31m-en`, with the Preston and Hadley voices. Its weights
(about 155 MB) are **not** in this repository; `scripts/fetch-phonon.py` fetches them at a
pinned revision into `bench/assets/` (gitignored) when `npm run stage` runs.

French, German, Spanish and Portuguese are spoken by **Phonon by Gradium, CC BY-NC 4.0**:
each language's own 40M checkpoint (`phonon:fr`, `phonon:de`, `phonon:es`, `phonon:pt` in
Ollama), run in the browser. Each language's Male voice is its checkpoint's own default
voice, under the same CC BY-NC licence. Its Female voice is an Apache 2.0 voice from
[`gradium/phonon-voices`](https://huggingface.co/gradium/phonon-voices), read from the language's
`phonon:40m-<lang>` Ollama copy; `bench/phonon/FINDINGS.md` "LT-222" says which. The reader
credits them as "Male voice: Phonon by Gradium, CC BY-NC 4.0. Female voice: Phonon by Gradium,
phonon-voices, Apache 2.0." `scripts/stage-phonon-lang.py`
builds the browser files from a pinned Ollama copy at stage time, outside this
repository; they are never committed. A reader who only ever listens in English never
downloads them, and one who picks a language downloads only that language's. They may
run on the staging mirror, a demo on its own domain; they go public only once Gradium
has confirmed in writing that this use is noncommercial. Listen mode stays free, with no
paywall, ads or member-only access.

This project's own code is **MIT**, see `LICENSE`. That covers everything in `src/`,
`pipeline/`, `scripts/` and `tests/`.

It does **not** cover the voices. The CC BY-NC 4.0 weights are **not MIT**: the
noncommercial terms travel with them to anyone who receives them, and they are not
distributed here — staging fetches them. Whether those terms suit a given distribution is
a legal question, not a code one, and it is not settled by this repository being MIT.

The text is translated in the browser by Opus-MT from
[Helsinki-NLP](https://huggingface.co/Helsinki-NLP) (the OPUS-MT project, University of
Helsinki): `opus-mt-en-fr` and `opus-mt-en-es` (Apache 2.0) and `opus-mt-en-de`
(CC BY 4.0) through Xenova's ONNX exports, and `opus-mt-tc-big-en-pt` (**CC BY 4.0**)
through a third-party ONNX export,
[`Douglasrambo/opus-mt-tc-big-en-pt-onnx`](https://huggingface.co/Douglasrambo/opus-mt-tc-big-en-pt-onnx).
That export is pinned to revision `738ee4cc` with every file's sha256 in
`scripts/convert-mt-models.py`, and staging stops if the repo or its base stops carrying
a permissive licence. Like the voices, none of these weights is committed.

Supertonic, which spoke the translations until LT-217, is gone from Listen mode entirely,
with no fallback in any language.

Nor does the MIT licence cover `bench/phonon/listen/vendor/lamejs/`: lamejs 1.2.1, the MP3 encoder
behind the local listening page's Save button, is **LGPL-3.0**. It is kept as an
unmodified file of its own with its licence texts beside it, pinned by sha256, and never
bundled into this project's code; see the README in that folder.

Equation speech is produced at build time by [Speech Rule Engine](https://github.com/Speech-Rule-Engine/speech-rule-engine)
and [MathJax](https://github.com/mathjax/MathJax-src) (`mathjax-full`), both **Apache-2.0**.
They run under Node in the pipeline only; nothing from either ships to the browser.

## Layout

```
src/        browser code — ES modules, no framework
pipeline/   the build step — Python
scripts/    staging, local serving, measurement, auditing
tests/      vitest unit tests and Playwright end-to-end
docs/       the implementation reference and the decision record
bench/      measurement harnesses (their outputs are gitignored)
```

## Running it

`npm install --omit=dev` is not enough to build: `mathjax-full` and `speech-rule-engine`
are devDependencies (nothing from either ships to the browser) but the pipeline's math
bridge (`scripts/math-speech.mjs`) requires both at build time, and an `--omit=dev`
install gives it a `node` that dies on module resolution the moment a page has an
equation.

```bash
npm install
npm run build

npm run stage      # build a local copy of a real page + assets into .stage/
npm run serve      # serve it with the COOP/COEP headers production sends
```

Then open the staged page and press *Enter Reader Mode*.

## Tests

```bash
npx vitest run                       # browser modules
python -m pytest pipeline/tests -q   # the build step
npx playwright test                  # end to end, needs a staged copy
```

The 100 ms long-task limit, the 0.500 RTF budget and the boot-script size cap are chosen
values, not tuning knobs. Changing one is a deliberate decision.

## Measuring on your own hardware

`scripts/measure-rtf-console.js` measures synthesis speed on any machine with nothing
installed — paste it into the browser console on a page carrying the reader and run
`await rtf()`. Note that DevTools CPU throttling will *not* give a meaningful answer here:
it throttles the main thread only, and all synthesis happens in workers.

## Checking that it sounds right

The build's own numbers do not tell you this, and it is worth being blunt about why. A page
reporting `41 spoken, 0 failed` was mispronouncing its arithmetic: `failed` counts equations
the *engine* could not convert, and is blind to equations converted into the wrong words.

```bash
node scripts/math-audit.mjs --url <page url>     # every equation: LaTeX, typeset, words, audio
bash scripts/smoke.sh                            # post-deploy check against the live site
```

`math-audit.mjs` writes a page you open and listen to. It is the only tool here that
answers "is this right?", and a human ear is still the last check — every remaining defect
found in this project was found by someone saying "that doesn't sound right" after the
automated checks passed.

`scripts/math-review.mjs` adds an advisory second opinion from a language model. It writes
a verdict column and **never** the spoken words: a model turns `0.125` into `0.25`
fluently, which in a chemistry textbook means audio that confidently contradicts the page.

## Status

Working and deployed, not finished.

- **Four books** are live on a staging mirror: `social_psychology`, `math_elem_teachers`,
  `chem_4b` and `human_relations`.
- **English** is spoken by Phonon 31M. **French, German, Spanish and Portuguese** are
  machine-translated in the browser and spoken by their own Phonon 40M (LT-216, LT-217).
  Czech, Danish, Hungarian, Italian, Dutch and Swedish were dropped with Supertonic.
- **Equations and chemistry are spoken**, not skipped.
- Both test suites run in CI on every push and pull request.

Known limits, all documented rather than hidden:

- Not validated on low-end hardware. The RTF budget assumes roughly an M1-class core.
- The translation models, and the Male voice each carries, are CC BY-NC 4.0 (the Female
  voices are Apache 2.0);
  they run on the staging mirror, a demo, and are not served publicly until Gradium
  confirms the use is noncommercial.
- The translation quality gate (472 sentences, at most 2% failing) passed for all four:
  Portuguese 6, German 9, French 10 and Spanish 10 failures.
- `docs/SPEAKING_MATHEMATICS.md` §8 lists the remaining phrasing defects.
