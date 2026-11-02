#!/usr/bin/env bash
# Build a local copy of what the mirror will serve, so the reader can be run
# and demoed without deploying.
#
# Produces STAGE/ with the same shape as the live mirror:
#   STAGE/_assets/tts/...            the built reader plus models
#   STAGE/$BOOK_NAME/<page>/         a real page, rewritten by the pipeline
#                                    (BOOK_NAME defaults to social_psychology below,
#                                    but is a variable -- e.g. chem_4b for the
#                                    spoken-equations demo)
#
# Serve it with scripts/serve-local.py, which sets the COOP/COEP that the RTF
# gate depends on. Without those headers wasm runs single-threaded and measured
# RTF goes from 0.410 to 0.912, past the 0.500 budget.
#
# PAGES_FROM=<an earlier stage> builds it offline: that stage's books and page
# assets are copied in, and nothing is fetched from the mirror. Only the reader,
# its models and the pipeline's injection are new.
#
# ASSETS_ONLY=1 stages STAGE/_assets/tts and stops: no books, nothing fetched
# from the mirror. The mirror's deploy script (outside this repo) uses it, so
# what it uploads is this layout.
#
# French, German, Spanish and Portuguese are spoken by Phonon 40M, CC BY-NC 4.0,
# staged from Johnny's Ollama copies (LT-216). Those weights must stay out of the
# repo, so they are staged only when STAGE is outside it.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAGE="${STAGE:-$ROOT/.stage}"
PAGE_URL="${PAGE_URL:-https://library.libretexts.dev/social_psychology/13%3A_Competition_and_Cooperation_in_Our_Social_Worlds/13.01%3A_Conflict_Cooperation_Morality_and_Fairness/}"
PAGE_DIR="${PAGE_DIR:-13:_Competition_and_Cooperation_in_Our_Social_Worlds/13.01:_Conflict_Cooperation_Morality_and_Fairness}"

TTS="$STAGE/_assets/tts"
BOOK_NAME="${BOOK_NAME:-social_psychology}"
BOOK="$STAGE/$BOOK_NAME"
PAGES_FROM="${PAGES_FROM:-}"
PHONON_LANGS="${PHONON_LANGS-fr de es pt}"
ASSETS_ONLY="${ASSETS_ONLY:-}"

if [ -n "$PAGES_FROM" ]; then
  [ -d "$PAGES_FROM/_assets" ] || { echo "PAGES_FROM=$PAGES_FROM is not a stage (no _assets/)" >&2; exit 1; }
  # STAGE is deleted below and then filled from PAGES_FROM, so neither may hold
  # the other: the same directory, or one inside the other, would delete the
  # source or copy the stage into itself. The trailing slash keeps a sibling
  # such as stage2 from passing for stage.
  [ -d "$STAGE" ] || created_stage=1
  mkdir -p "$STAGE"
  from="$(cd "$PAGES_FROM" && pwd -P)/"
  to="$(cd "$STAGE" && pwd -P)/"
  case "$from" in "$to"*) overlap=1;; esac
  case "$to" in "$from"*) overlap=1;; esac
  if [ -n "${overlap:-}" ]; then
    [ -z "${created_stage:-}" ] || rmdir "$STAGE"
    echo "PAGES_FROM ($from) and STAGE ($to) overlap; staging would delete or copy into its own source" >&2
    exit 1
  fi
fi

echo "==> building"
cd "$ROOT"
npx vite build >/dev/null

echo "==> staging assets into $TTS"
rm -rf "$STAGE"
mkdir -p "$TTS"
[ -n "$ASSETS_ONLY" ] || mkdir -p "$BOOK/$PAGE_DIR"
cp dist/_assets/tts/* "$TTS/"

# Phonon 31M, the English voice (LT-214), and since LT-217 the only engine:
# Supertonic is gone, with no fallback. Fetched from the Hub at a pinned
# revision and checked against pinned hashes; the weights are never committed.
# Required, unlike the translation models below: English is the default track.
echo "==> staging Phonon (English voice)"
python3 "$ROOT/scripts/fetch-phonon.py" "$TTS/phonon"

# Translation models, staged by scripts/convert-mt-models.py. Optional in the
# same way and for the same reason the translate step below is: it is a ~115 MB
# fetch per pair, and staging must stay runnable on a machine that has never run
# it. Their manifest.json is written by that script, not here -- it records the
# source repo, revision and licence alongside the hashes.
if [ -d "$ROOT/bench/assets/mt" ]; then
  echo "==> staging translation models"
  mkdir -p "$TTS/mt"
  cp -R "$ROOT/bench/assets/mt/." "$TTS/mt/"
  for pair in "$TTS"/mt/*/; do
    echo "  $(basename "$pair"): $(du -sh "$pair" | cut -f1)"
  done
else
  echo "==> no translation models to stage (run scripts/convert-mt-models.py)"
fi

# Each translation's voice, Phonon 40M, built from Johnny's Ollama copy by
# scripts/stage-phonon-lang.py (LT-216, needs numpy and onnx). A language whose
# voice cannot be staged here is left out: its translation model goes too, since
# pairs.json is what the reader offers and a translation it cannot speak must
# not be on the menu.
echo "==> staging Phonon 40M for translations ($PHONON_LANGS)"
case "$(mkdir -p "$TTS" && cd "$TTS" && pwd -P)/" in
  "$ROOT"/*) echo "  (skipped: STAGE is inside the repo; the CC BY-NC weights are staged only outside it)"; PHONON_LANGS="";;
esac
for lang in $PHONON_LANGS; do
  if ! .venv/bin/python "$ROOT/scripts/stage-phonon-lang.py" "$lang" "$TTS/phonon-$lang"; then
    echo "  phonon-$lang: could not be staged; $lang is left out"
    rm -rf "$TTS/phonon-$lang"
  fi
done
if [ -f "$TTS/mt/pairs.json" ]; then
  node - "$TTS" <<'JS'
const { readFileSync, writeFileSync, existsSync, rmSync } = require('node:fs');
const tts = process.argv[2];
const index = JSON.parse(readFileSync(`${tts}/mt/pairs.json`, 'utf8'));
const spoken = (p) => existsSync(`${tts}/phonon-${p.code}/manifest.json`);
for (const p of index.pairs.filter((p) => !spoken(p))) {
  rmSync(`${tts}/mt/${p.pair}`, { recursive: true, force: true });
  console.log(`  ${p.pair}: no voice staged, left out`);
}
index.pairs = index.pairs.filter(spoken);
writeFileSync(`${tts}/mt/pairs.json`, JSON.stringify(index, null, 2));
console.log(`  offered: ${index.pairs.map((p) => p.code).join(', ') || '(English only)'}`);
JS
fi

echo "==> staging ORT for Phonon and the translation worker"
# The ONNX Runtime wasm transformers.js bundles (1.26.0-dev), which both workers
# load from $TTS/ort-mt. Another version's binaries in that directory load the
# wrong runtime's wasm into this one's JS -- a version mismatch that surfaces as
# an unreadable abort inside the wasm module, not as "wrong file".
#
# Resolved through transformers.js rather than hardcoded, so the staged binaries
# always match the runtime npm actually installed -- npm may hoist that copy to
# the top level or nest it depending on what else is in the tree, and a stale
# hand-copied build is exactly the drift this avoids. bench/assets/ort-1.27 is a
# spike leftover that matches NOTHING currently installed; do not use it.
# Picked by VERSION rather than by location: npm may nest or hoist this copy,
# and silently staging another version's binaries for this runtime is the
# failure this whole block exists to prevent. No match is a hard stop.
ORT_MT_SRC="$(node -e '
const path = require("path");
const root = path.resolve(path.dirname(require.resolve("@huggingface/transformers")), "..");
const want = require(path.join(root, "package.json")).dependencies["onnxruntime-web"];
for (const dir of [path.join(root, "node_modules", "onnxruntime-web"),
                   path.join(root, "..", "..", "onnxruntime-web")]) {
  try {
    if (require(path.join(dir, "package.json")).version === want) {
      console.log(`${path.join(dir, "dist")} ${want}`);
      process.exit(0);
    }
  } catch {}
}
console.error(`no onnxruntime-web@${want} installed beside @huggingface/transformers`);
process.exit(1);
')"
mkdir -p "$TTS/ort-mt"
cp "${ORT_MT_SRC%% *}"/ort-wasm-simd-threaded.* "$TTS/ort-mt/"
echo "  onnxruntime-web ${ORT_MT_SRC##* } -> $TTS/ort-mt ($(du -sh "$TTS/ort-mt" | cut -f1))"

echo "==> checking no Supertonic file was staged (LT-217)"
node "$ROOT/scripts/check-no-supertonic.mjs" "$TTS"

if [ -n "$ASSETS_ONLY" ]; then
  echo
  echo "staged (assets only):"
  du -sh "$TTS"
  exit 0
fi

if [ -n "$PAGES_FROM" ]; then
  echo "==> copying books and page assets from $PAGES_FROM (nothing fetched)"
  rmdir "$BOOK/$PAGE_DIR" 2>/dev/null || true
  for entry in "$PAGES_FROM"/*; do
    [ "$(basename "$entry")" = "_assets" ] || cp -R "$entry" "$STAGE/"
  done
  for entry in "$PAGES_FROM"/_assets/*; do
    [ "$(basename "$entry")" = "tts" ] || cp -R "$entry" "$STAGE/_assets/"
  done
  echo "==> running the pipeline over every book but chem101 (out of scope)"
  for book in "$STAGE"/*/; do
    case "$(basename "$book")" in _assets|chem101) continue;; esac
    .venv/bin/python -m pipeline.tts_manifest "${book%/}" --site-root "$STAGE"
  done
else

echo "==> fetching a real page"
curl -sSL --fail -o "$BOOK/$PAGE_DIR/index.html" "$PAGE_URL"

echo "==> un-injecting it, so staging starts from a pre-reader page"
# The mirror already serves this book WITH the reader injected, so what curl just
# fetched carries boot.js and a <button id="tts-enter">. That is fine for the
# in-scope copy -- the pipeline un-injects its own input anyway -- but the
# out-of-scope copy below is taken from this same file, and chem101 would inherit
# a reader it must never have. 'an out-of-scope page requests nothing and has no
# button' then failed for a fixture reason while the scope guard it tests was
# working perfectly, which is the most expensive kind of red: it accuses the
# feature instead of the fixture.
#
# unrewrite_page is the pipeline's own exact inverse of the injection, so this is
# the same normalisation process_page performs on every re-run, done one step
# earlier. Fetching chem101's real page instead is NOT the fix: copying the same
# content into a different book is what proves scope is decided by the book, not
# by what the page says.
.venv/bin/python - "$BOOK/$PAGE_DIR/index.html" <<'PY'
import sys
from pathlib import Path
from pipeline.tts_manifest import unrewrite_page
page = Path(sys.argv[1])
page.write_text(unrewrite_page(page.read_text(encoding="utf-8")), encoding="utf-8")
PY

echo "==> fetching the page's own assets (css, mathjax, the mirror's reader.js)"
# Without these the staged page renders unstyled, which makes a demo recording
# look broken for reasons that have nothing to do with this feature.
MIRROR="https://library.libretexts.dev"
grep -oE '(src|href)="/_assets/[^"]+"' "$BOOK/$PAGE_DIR/index.html" \
  | sed -E 's/^(src|href)="//; s/"$//' | sort -u | while read -r rel; do
    case "$rel" in /_assets/tts/*) continue;; esac
    mkdir -p "$STAGE$(dirname "$rel")"
    curl -sSL --fail -o "$STAGE$rel" "$MIRROR$rel" || echo "  (skipped $rel)"
  done

echo "==> staging an out-of-scope book"
# chem101 is not on the allowlist in pipeline/tts_manifest.py, so the pipeline
# refuses to open it. Its page must stay byte-identical, and the e2e suite
# asserts exactly that -- the scope guard is the quiet break that would hurt
# most, so it is tested rather than trusted.
mkdir -p "$STAGE/chem101/$PAGE_DIR"
cp "$BOOK/$PAGE_DIR/index.html" "$STAGE/chem101/$PAGE_DIR/index.html"
shasum -a 256 "$STAGE/chem101/$PAGE_DIR/index.html" | cut -d" " -f1 > "$STAGE/chem101/.sha256-before"

echo "==> running the pipeline over it"
.venv/bin/python -m pipeline.tts_manifest "$BOOK" --site-root "$STAGE"
fi

echo "==> translating (set LANGS= to skip, LANGS=all for every shipped language)"
# Skipped by default: converting the Opus-MT checkpoints is a one-time multi-GB
# download, and staging must stay runnable on a machine that has never done it.
#   .venv/bin/python scripts/convert-models.py
#   LANGS=es npm run stage
if [ -n "${LANGS:-}" ]; then
  .venv/bin/python -m pipeline.translate_cli "$BOOK" \
    --langs "$LANGS" --qa "$TTS/translation-qa.json"
else
  echo "  (skipped; LANGS is unset)"
fi

echo
echo "staged:"
du -sh "$TTS" "$BOOK"
[ -f "$BOOK/$PAGE_DIR/index.html" ] && grep -c 'tts-enter' "$BOOK/$PAGE_DIR/index.html" | sed 's/^/  tts-enter occurrences: /'
# A stage copied with PAGES_FROM carries its own out-of-scope book, or none.
if [ ! -f "$STAGE/chem101/.sha256-before" ]; then
  echo "  out-of-scope book: none in this stage (not checked)"
elif [ "$(shasum -a 256 "$STAGE/chem101/$PAGE_DIR/index.html" | cut -d' ' -f1)" = "$(cat "$STAGE/chem101/.sha256-before")" ]; then
  echo "  out-of-scope book: byte-identical (correct)"
else
  echo "  out-of-scope book: MODIFIED -- scope guard failed" >&2
  exit 1
fi
