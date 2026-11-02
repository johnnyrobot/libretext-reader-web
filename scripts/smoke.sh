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

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

fails=0 checks=0
note() { printf '  %-60s %s\n' "$1" "$2"; checks=$((checks + 1)); }
bad()  { note "$1" "FAIL  $2"; fails=$((fails + 1)); }
good() { note "$1" "ok"; }
# status HEADERS: the HTTP status in a curl -I response, or "none" when there was none.
status() { awk 'NR == 1 { s = $2 } END { print (s == "" ? "none" : s) }' <<<"$1"; }

# 1. Sample pages carry the reader.
html=$(curl -sS --max-time 30 "$BASE$PAGE" || true)
if grep -q 'id="tts-enter"' <<<"$html" && grep -q '/_assets/tts/boot.js' <<<"$html"; then
  good "the in-scope page carries the reader"
else
  bad "the in-scope page carries the reader" "button or boot script missing"
fi

# 2. speech.json parses and its offsets round-trip. The JSON goes to Python as a
# file, read as UTF-8: given as a here-string beside the heredoc, it replaced the
# program on stdin, so Python ran the JSON as code and tested nothing (LT-231).
curl -sS --max-time 30 -o "$tmp/speech.json" "$BASE${PAGE}speech.json" || : >"$tmp/speech.json"
if python3 - "$tmp/speech.json" <<'PY'
import json, sys
try:
    with open(sys.argv[1], encoding="utf-8") as f:
        m = json.load(f)
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

# Caddy sets these headers on any path, a 404 included, so every asset check also
# requires a 200: against the retired Supertonic paths they were green on nothing.
# served PATH HEADER-PATTERN WHY-NOT: prints nothing when PATH answers 200 with a
# header matching the pattern, and otherwise why not.
served() {
  local h s
  h=$(curl -sSI --max-time 30 "$BASE/_assets/tts/$1" || true)
  s=$(status "$h")
  if [ "$s" != 200 ]; then echo "$1: HTTP $s"
  elif ! grep -qi "$2" <<<"$h"; then echo "$1 $3"
  fi
}

why=$(served phonon.worker.js 'cross-origin-embedder-policy: require-corp' "lacks COEP, so the browser will refuse to instantiate it")
if [ -z "$why" ]; then good "the worker carries its own COEP"; else bad "the worker carries its own COEP" "$why"; fi

# The cache policy is SPLIT, and both halves are load-bearing. Every model and voice
# file each Phonon manifest names must be there and cached for a year, or ~200 MB
# per language re-downloads on every page view. The code is NOT immutable: reader.js
# is imported on click, which a hard refresh does not bypass, so an immutable
# reader.js kept two verified fixes from ever reaching a reporter (2026-08-23).
# HEAD only, so this costs nothing to run.
#
# SMOKE_VOICES names the language folders the host serves: English and the four
# translations by default, as on the mirror. The translations stay off a public
# host until Gradium confirms the use (README), so such a host sets SMOKE_VOICES=phonon.
VOICES="${SMOKE_VOICES:-phonon phonon-fr phonon-de phonon-es phonon-pt}"
for lang_dir in $VOICES; do
  check="$lang_dir: its models and voices are served, immutable"
  code=$(curl -sS --max-time 30 -o "$tmp/$lang_dir.json" -w '%{http_code}' "$BASE/_assets/tts/$lang_dir/manifest.json" || true)
  if [ "$code" != 200 ]; then bad "$check" "$lang_dir/manifest.json: HTTP ${code:-none}"; continue; fi
  if ! files=$(python3 - "$tmp/$lang_dir.json" <<'PY'
import json, sys
try:
    with open(sys.argv[1], encoding="utf-8") as f:
        paths = [e["path"] for e in json.load(f)["files"] if e["path"].startswith(("onnx/", "voices/"))]
except Exception as e:
    print(f"manifest.json is not a manifest ({type(e).__name__}: {e})"); raise SystemExit(1)
if not any(p.startswith("onnx/") for p in paths) or not any(p.startswith("voices/") for p in paths):
    print("manifest.json names no model or no voice"); raise SystemExit(1)
print("\n".join(paths))
PY
  ); then
    bad "$check" "$files"; continue
  fi
  why=""
  while IFS= read -r path; do
    why=$(served "$lang_dir/$path" 'cache-control: public.*immutable' "is not immutable")
    [ -z "$why" ] || break
  done <<<"$files"
  if [ -z "$why" ]; then good "$check"; else bad "$check" "$why"; fi
done

# The code, and each manifest: one cached for a year outlives a restage, and a
# browser holding a manifest from before LT-222 could not find the voices it names.
# Every path that fails is named, so one run shows them all.
stale=""
for path in reader.js phonon.worker.js; do
  why=$(served "$path" 'cache-control: .*must-revalidate' "does not revalidate")
  [ -z "$why" ] || stale="${stale:+$stale; }$why"
done
for lang_dir in $VOICES; do
  why=$(served "$lang_dir/manifest.json" 'cache-control: .*must-revalidate' "does not revalidate")
  [ -z "$why" ] || stale="${stale:+$stale; }$why"
done
if [ -z "$stale" ]; then good "the code and the manifests revalidate"
else bad "the code and the manifests revalidate" "$stale: returning readers stay on old code for a year"
fi

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
  echo "SMOKE_OK checks=$checks"
  exit 0
fi
echo "SMOKE_FAILED failures=$fails"
exit 1
