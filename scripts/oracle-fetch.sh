#!/usr/bin/env bash
# Fetch the validation corpus for the oracle diff (build plan step 9): every
# page's English `speech.json` and its deployed Spanish `speech.es.json`, from
# the mirror that is actually serving them.
#
# The pairs in speech.es.json are the ONLY reference that exists for browser
# translation quality -- the browser has no QA gate (design Sec 9) and nothing
# re-checks its output at run time. Design Sec 11a: the build-time tracks are
# obsolete as a delivery mechanism and load-bearing as an oracle.
#
# The page list is committed rather than crawled: the book's own index links out
# to dev.libretexts.org, not to mirror-relative pages, so there is nothing on the
# mirror to crawl from. Regenerate it from a mirror checkout with
#   find . -name speech.json | sed 's|^\./||; s|speech.json$||; s|/$||' | sort
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIRROR="${MIRROR:-https://library.libretexts.dev}"
BOOK="${BOOK:-social_psychology}"
OUT="${OUT:-$ROOT/bench/oracle}"

# `%3A` rather than a literal colon: the mirror's paths contain colons, and curl
# leaves them alone in a path segment while some proxies do not.
encode() { printf '%s' "$1" | sed 's|:|%3A|g'; }

n=0
while IFS= read -r page; do
  dir="$OUT/$page"
  mkdir -p "$dir"
  # "." is the book's own landing page, which has a track like any other.
  [ "$page" = "." ] && url="$MIRROR/$BOOK" || url="$MIRROR/$BOOK/$(encode "$page")"
  for file in speech.json speech.es.json; do
    curl -sSL --fail -o "$dir/$file" "${url%/}/$file"
  done
  n=$((n + 1))
done < "$ROOT/scripts/oracle-pages.txt"

echo "fetched $n pages into $OUT"
