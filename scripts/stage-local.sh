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
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAGE="${STAGE:-$ROOT/.stage}"
PAGE_URL="${PAGE_URL:-https://library.libretexts.dev/social_psychology/13%3A_Competition_and_Cooperation_in_Our_Social_Worlds/13.01%3A_Conflict_Cooperation_Morality_and_Fairness/}"
PAGE_DIR="${PAGE_DIR:-13:_Competition_and_Cooperation_in_Our_Social_Worlds/13.01:_Conflict_Cooperation_Morality_and_Fairness}"

TTS="$STAGE/_assets/tts"
BOOK_NAME="${BOOK_NAME:-social_psychology}"
BOOK="$STAGE/$BOOK_NAME"

echo "==> building"
cd "$ROOT"
npx vite build >/dev/null

echo "==> staging assets into $TTS"
rm -rf "$STAGE"
mkdir -p "$TTS/onnx" "$TTS/voice_styles" "$TTS/ort" "$BOOK/$PAGE_DIR"
cp dist/_assets/tts/* "$TTS/"
cp bench/assets/onnx/* "$TTS/onnx/"
cp bench/assets/voice_styles/*.json "$TTS/voice_styles/"
cp bench/assets/ort/* "$TTS/ort/"

# Translation models, staged by scripts/convert-mt-models.py. Optional in the
# same way and for the same reason the translate step below is: it is a ~115 MB
# fetch per pair, and staging must stay runnable on a machine that has never run
# it. Their manifest.json is written by that script, not here -- it records the
# source repo, revision and licence alongside the hashes, which write_model_
# manifest.py has no notion of.
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

echo "==> staging ORT for the translation worker"
# A SECOND ONNX Runtime, deliberately, in its own directory. The TTS engine pins
# onnxruntime-web 1.17.3 and its wasm lives in $TTS/ort; transformers.js bundles
# 1.26.0-dev and will not run against 1.17 binaries. Pointing both workers at one
# directory loads the wrong runtime's wasm into the other's JS -- a version
# mismatch that surfaces as an unreadable abort inside the wasm module, not as
# "wrong file".
#
# Resolved through transformers.js rather than hardcoded, so the staged binaries
# always match the runtime npm actually installed -- npm may hoist that copy to
# the top level or nest it depending on what else is in the tree, and a stale
# hand-copied build is exactly the drift this avoids. bench/assets/ort-1.27 is a
# spike leftover that matches NOTHING currently installed; do not use it.
# Picked by VERSION rather than by location: npm nests this copy today because
# the top-level onnxruntime-web is the TTS engine's 1.17.3, but a future tree
# could hoist it, and silently staging 1.17 binaries for a 1.26 runtime is the
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

echo "==> writing model manifest"
.venv/bin/python scripts/write_model_manifest.py "$TTS"

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
grep -c 'tts-enter' "$BOOK/$PAGE_DIR/index.html" | sed 's/^/  tts-enter occurrences: /'
if [ "$(shasum -a 256 "$STAGE/chem101/$PAGE_DIR/index.html" | cut -d' ' -f1)" = "$(cat "$STAGE/chem101/.sha256-before")" ]; then
  echo "  out-of-scope book: byte-identical (correct)"
else
  echo "  out-of-scope book: MODIFIED -- scope guard failed" >&2
  exit 1
fi
