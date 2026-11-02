#!/usr/bin/env bash
# THROWAWAY SPIKE (LT-216). Stage the listening page: the built reader's Phonon
# worker, English Phonon 31M, and fr/de/es/pt Phonon 40M exported from the
# Ollama copies. Save on the page writes an MP3 with the vendored lamejs (LT-219).
# Everything lands in STAGE (default /Users/Shared/LT-216/stage), outside git.
#
#   bench/phonon/listen/stage.sh
#   scripts/serve-local.py --root /Users/Shared/LT-216/stage --port 8820
#   open http://127.0.0.1:8820/social_psychology/listen-lt216/
#
# The page sits under /social_psychology/ because serve-local.py (like the live
# Caddyfile) sends COOP/COEP only on the reader books, and Phonon needs
# cross-origin isolation for threaded wasm.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
STAGE="${STAGE:-/Users/Shared/LT-216/stage}"
PYTHON="${PYTHON:-python3}"
TTS="$STAGE/_assets/tts"
PAGE="$STAGE/social_psychology/listen-lt216"

cd "$ROOT"
# Save's MP3 encoder, lamejs, is LGPL: it is staged unmodified, as its own file,
# with its licence texts. Checked first, before the long model staging.
(cd bench/phonon/listen/vendor/lamejs && shasum -a 256 -c --quiet SHA256SUMS)

echo "==> building"
npx vite build >/dev/null

echo "==> staging the worker into $TTS"
mkdir -p "$TTS" "$PAGE"
cp dist/_assets/tts/* "$TTS/"

# transformers.js's own ORT build, resolved the way scripts/stage-local.sh does.
ORT_MT_SRC="$(node -e '
const path = require("path");
const root = path.resolve(path.dirname(require.resolve("@huggingface/transformers")), "..");
const want = require(path.join(root, "package.json")).dependencies["onnxruntime-web"];
for (const dir of [path.join(root, "node_modules", "onnxruntime-web"),
                   path.join(root, "..", "..", "onnxruntime-web")]) {
  try {
    if (require(path.join(dir, "package.json")).version === want) {
      console.log(path.join(dir, "dist"));
      process.exit(0);
    }
  } catch {}
}
console.error(`no onnxruntime-web@${want} installed beside @huggingface/transformers`);
process.exit(1);
')"
mkdir -p "$TTS/ort-mt"
cp "$ORT_MT_SRC"/ort-wasm-simd-threaded.* "$TTS/ort-mt/"

echo "==> staging Phonon 31M (English)"
"$PYTHON" scripts/fetch-phonon.py "$TTS/phonon"

for lang in ${LANGS:-fr de es pt}; do
  echo "==> staging Phonon 40M ($lang) from Ollama"
  "$PYTHON" scripts/stage-phonon-lang.py "$lang" "$TTS/phonon-$lang"
done

echo "==> staging the page"
mkdir -p "$PAGE/vendor/lamejs"
cp bench/phonon/listen/index.html bench/phonon/listen/listen.js bench/phonon/listen/listen.css \
  bench/phonon/listen/mp3.worker.js "$PAGE/"
cp bench/phonon/listen/vendor/lamejs/* "$PAGE/vendor/lamejs/"
du -sh "$TTS"/phonon*
