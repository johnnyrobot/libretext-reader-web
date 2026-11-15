# Exact LT549 source corrections, version 1

This bundle implements LT-555 under LT-549. It is limited to the literal changes approved in `LT549-CHIEF-SOURCE-RULING-2026-11-14.md`, against decision packet SHA256 `9b4f2d7cfd49f96d04db50f62455033db51baafe304189438682d331755a0841`. `bundle.json` contains all 14 original/corrected page hashes, structural coordinates, UTF-8 byte offsets, and 111 exact before/after replacements. The apply helper pins the bundle's own digest.

The replacements comprise: one Q26 empty image removal; one literal embedded-title alt and fourteen redundant navigation-thumbnail alts; three iframe titles; 85 coordinate-specific cell substitutions; five reaction-row groupings retaining exact energy cells; and two single-brace repairs retaining concentration brackets. All cell inner HTML and existing attributes are preserved. No scientific reconciliation, graph, replacement image, new visible label or macro is supplied.

## Apply to a new source-only stage

Use Python with the repository's `beautifulsoup4` dependency. The source must be the preserved public HTML snapshot whose 14 page pins match the bundle; an enriched reader stage has different bytes and is deliberately refused.

```sh
python content-corrections/LT549/apply.py --source /path/to/frozen-public-snapshot --output /path/to/NEW-source-stage
```

Every target and expected output digest is checked before copying. Paths must be disjoint; existing output, linked source entries, drift, ambiguous literals, duplicate/overlapping targets and malformed coordinate preimages are refused. No DOM serialization is used to write pages: only the approved byte ranges change. All other files are copied intact. A repeat is a clear refusal. The completion receipt `.lt549-source-corrections.json` is diagnostic metadata, not a catalog-admission or deployment instruction.

Twenty portable public-seam safety tests live in `pipeline/tests/test_lt549_content_corrections.py`. They cover actual header promotion, drift/preflight, duplicate/ambiguous targets, repeated application, disjoint/linked paths, scientific-text/energy refusal, bracket preservation, reproducibility and bundle integrity. Full-snapshot application to two distinct new destinations produced identical 1,489-file outputs: 1,488 original HTML files plus the receipt. Only the approved 14 pages differ from source.

## Reproduce speech and native evidence

These verifiers write derived evidence to a new directory, never to either source root. Speech uses the owning Reader pipeline and a fresh per-page parser in its normal reusable bridge. Run from the repository with its Python/Node dependencies installed.

```sh
python content-corrections/LT549/verify_speech.py --before /path/to/frozen-public-snapshot --after /path/to/corrected-source --output /path/to/NEW-speech-evidence
node content-corrections/LT549/verify_render.mjs --before /path/to/frozen-public-snapshot --after /path/to/corrected-source --base http://127.0.0.1:8797/ --output /path/to/NEW-native-evidence
```

The loopback server must serve the corrected rendering copy with the recorded production policy and verified existing static assets. The native verifier retains response policy, blocks off-origin requests including ADAPT embeds, and uses actual Chromium/Firefox/WebKit rendering. It checks header roles/references, physical row/column alignment, unchanged scientific table text/order, exact image/frame names, retained images, and narrow geometry. Header presentation changes are reported rather than hidden with an unapproved stylesheet edit. This is native evidence, not a claim of whole-page conformance, embedded-process accessibility or audio.

Speech evidence binds every `generatedFrom` to its exact source and sentence-splitter version, validates block/sentence identities/counts/spans, and reports skips, fallbacks and pre-existing empty speech. The two approved formula fallbacks close; seven other pre-existing math fallbacks and one existing zero-width-BOM empty sentence remain unchanged. No new empty speech is introduced. The existing extractor still skips these tables without its supported `<thead>` structure, including merged reaction rows; source header semantics do not imply full Listen table narration.

## Revisions, historical state and ownership

All 14 corrected pages have new exact revisions under the existing Social Reading contract even though their selectable paragraph IDs/quotes are unchanged. A read-only diagnostic reconciled the original 1,488-page snapshot against its pinned old catalog and compared old/new manifests for affected pages. All 1,474 other pages remain identical. Old anchors do not match the changed revisions; they must remain on their historical source/revision. The diagnostic does not admit a catalog, stamp context, migrate comments, change a database, or authorize guessed reanchoring. Chief assigns catalog/package refresh to Social Reading Dev after source admission.

Preserve original snapshots, current packages, model assets and private state. This stage is not a live document root. Canonical reviewed Reader runtime, speech files and the final admitted catalog are composed separately; do not ship diagnostic receipts as application data or replace production language/model offerings with a local fixture index.

## Current owner release disposition

On 2026-11-14 at 21:05 Pacific the owner explicitly skipped remaining VoiceOver/listener checks and requested completion/deployment of the bounded feature. Remaining speech observations stay unconfirmed; they are never converted to a pass. No further foreground or listener work is requested. Prior real observations remain preserved.

Chief deferred inherited missing Q19/Q69 graphs, uncertain extra Q26 illustration and the R4 pairing defect to known-content follow-up. Preserve their bytes except for the approved literals; do not fabricate a repair or mark missing instructional material decorative. Current PageIndex recovery supplies a MathJax4 template with per-page parameters and an eatSpaces dependency; compatibility with frozen3.2.2, exact parameters for all mirror pages, and separate template licensing are not established by that capture. No compatible bounded payload is supplied here. The inherited PageIndex limitation is recorded for follow-up, without a template migration or a new release-blocking recovery wave.

Introduced behavior, private access, revision integrity, functional keyboard/native checks, source review/CI, package admission and host deployment checks remain genuine gates. Chief alone performs the authorized live deployment; Reader makes no live writes.

Speech output includes all fourteen affected pages. All fourteen produced nonzero sentence counts in this run; their after-manifests are candidate speech payloads subject to owner admission and exact generatedFrom/source agreement. No source-page Reader injection or production catalog was generated by verification.
