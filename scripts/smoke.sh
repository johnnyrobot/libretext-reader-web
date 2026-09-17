#!/usr/bin/env bash
# Post-deploy smoke test against the LIVE mirror. Roadmap step 11 item 3.
#
#   bash scripts/smoke.sh            check the live site
#   bash scripts/smoke.sh --quiet    markers only
#
# Polled, never push-triggered. A push trigger that breaks fails silently and looks
# exactly like a deploy with nothing to do; a poll that breaks is a poll you can see
# not running.
#
# Prints SMOKE_OK on success and SMOKE_FAILED with a reason otherwise, so it can be
# suitable as a post-deploy health check.
set -uo pipefail

BASE="${SMOKE_BASE:-https://library.libretexts.dev}"
BOOK="${SMOKE_BOOK:-social_psychology}"
PAGE="${SMOKE_PAGE:-/social_psychology/13%3A_Competition_and_Cooperation_in_Our_Social_Worlds/13.01%3A_Conflict_Cooperation_Morality_and_Fairness/}"
OUT_OF_SCOPE="${SMOKE_OUT_OF_SCOPE:-/chem101/}"

fails=0
note() { printf '  %-52s %s\n' "$1" "$2"; }
bad()  { note "$1" "FAIL  $2"; fails=$((fails + 1)); }
good() { note "$1" "ok"; }

# 1. Sample pages carry the reader.
html=$(curl -sS --max-time 30 "$BASE$PAGE" || true)
if grep -q 'id="tts-enter"' <<<"$html" && grep -q '/_assets/tts/boot.js' <<<"$html"; then
  good "the in-scope page carries the reader"
else
  bad "the in-scope page carries the reader" "button or boot script missing"
fi

# 2. speech.json parses and its offsets round-trip.
speech=$(curl -sS --max-time 30 "$BASE${PAGE}speech.json" || true)
if python3 - <<'PY' <<<"$speech"
import json, sys
try:
    m = json.load(sys.stdin)
except Exception as e:
    print(f"unparseable: {e}"); raise SystemExit(1)
bad = [s["id"] for b in m["blocks"] if b["kind"] != "notice" for s in b["sentences"]
       if b["text"][s["offset"]:s["offset"] + s["length"]] != s["display"]]
if bad:
    print(f"{len(bad)} offsets do not round-trip"); raise SystemExit(1)
if m["stats"]["sentences"] < 10:
    print(f"only {m['stats']['sentences']} sentences"); raise SystemExit(1)
PY
then good "speech.json parses and its offsets round-trip"
else bad "speech.json parses and its offsets round-trip" "see above"
fi

# 3. The headers the RTF gate depends on.
headers=$(curl -sSI --max-time 30 "$BASE$PAGE" || true)
grep -qi 'cross-origin-opener-policy: same-origin' <<<"$headers" \
  && grep -qi 'cross-origin-embedder-policy: require-corp' <<<"$headers" \
  && good "the page is cross-origin isolated" \
  || bad "the page is cross-origin isolated" "without it RTF doubles and playback stalls"

worker=$(curl -sSI --max-time 30 "$BASE/_assets/tts/engine.worker.js" || true)
grep -qi 'cross-origin-embedder-policy: require-corp' <<<"$worker" \
  && good "the worker carries its own COEP" \
  || bad "the worker carries its own COEP" "the browser will refuse to instantiate it"

# The cache policy is SPLIT, and both halves are load-bearing. Models are
# content-addressed and immutable, or 380 MB re-downloads per visit. The code is
# NOT: reader.js is imported on click, which a hard refresh does not bypass, so an
# immutable reader.js kept two verified fixes from ever reaching a reporter
# (2026-08-23). This check used to assert immutable on the worker and failed on
# every run after the split -- a red that accused the deploy for doing the right thing.
model=$(curl -sSI --max-time 30 "$BASE/_assets/tts/onnx/tts.json" || true)
grep -qi 'cache-control: public.*immutable' <<<"$model" \
  && good "the models are immutable" \
  || bad "the models are immutable" "380 MB would re-download on every page view"

grep -qi 'cache-control: .*must-revalidate' <<<"$worker" \
  && good "the code revalidates" \
  || bad "the code revalidates" "an immutable bundle keeps returning readers on old code for a year"

grep -qi "script-src 'self' 'wasm-unsafe-eval' blob:" <<<"$headers" \
  && good "the CSP allows wasm and its blob workers" \
  || bad "the CSP allows wasm and its blob workers" "ONNX Runtime cannot start"

# 4. A non-allowlisted book is untouched. The allowlist invariant, in production.
other=$(curl -sS --max-time 30 "$BASE$OUT_OF_SCOPE" || true)
if grep -q 'tts-enter\|/_assets/tts/' <<<"$other"; then
  bad "an out-of-scope book is untouched" "the feature leaked outside the allowlist"
else
  good "an out-of-scope book is untouched"
fi

# 5. The strict CSP survives outside the book's scope.
root=$(curl -sSI --max-time 30 "$BASE/" || true)
grep -qi "script-src 'self';" <<<"$root" \
  && good "the rest of the mirror keeps the strict CSP" \
  || bad "the rest of the mirror keeps the strict CSP" "the loosened policy escaped its scope"

if [ "$fails" -eq 0 ]; then
  echo "SMOKE_OK checks=9"
  exit 0
fi
echo "SMOKE_FAILED failures=$fails"
exit 1
