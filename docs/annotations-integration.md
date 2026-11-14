# Existing textbook discussion integration (LT-549)

The annotation module mounts its controls and discussion panel outside `main#main-content`. It consumes a public `social-reading-page-v1` stamp; private text is fetched only after server authorization. It never replaces textbook content or injects discussion text into the speech manifest.

`src/social-reading/client.mjs` is copied from social-reading commit `73ee211a41891c5bab6ce550cfc5edc30b52c358`, SHA256 `0f3e65a2be6e28b5bb40df49bdc9b4fc17c0ccf22d98fd20c66949de85ba1cdb`. It includes server-relative timing, deliberate session extension and field-error passthrough. `anchor.mjs` remains the exact `5578aec6b0a25423600bdcf04c79445e4b881bca` copy, SHA256 `39d3a5307e54abc223359bf12d524f69326cbff284e3b97bfc4e4855dcb03c67`.

Session warnings remain available when the panel is closed. Extension is deliberate, preserves drafts, and reconciles uncertain transport failures through a session read. Expiry hides private content and keeps unsent drafts only in page memory, restoring them only to the same authenticated actor. Deliberate logout and a different actor discard them. Pending commands retain their original immutable identity/context/key. The keyboard exact-quote input and occurrence chooser create the same validated selector as native range selection.

## Local staging

Use a fresh isolated stage, never a live root. Obtain the backend-owned catalog and its independently confirmed SHA-256. Every staged page must match its catalog source-file digest. Build the reader with `npm run build` and copy the resulting `dist/_assets/tts/` files into that stage's `/_assets/tts/`, retaining verified existing voice/runtime assets. No model regeneration is needed.

```sh
node scripts/stage-annotations.mjs --stage /path/to/stage --catalog /path/to/catalog.json --sha256 CONFIRMED_SHA256 --output /path/to/composed-catalog.json
python3 scripts/serve-local.py --root /path/to/stage --port 8788 --api-port 4204
```

Staging validates all input page hashes before writing, rejects linked asset destinations, preserves the main-content bytes, installs the scoped modules/styles, stamps context outside main, and emits a catalog with final published-file hashes. Give that catalog/digest back to the backend owner for admission; do not restart or alter their service. The same-origin proxy preserves Origin and session cookies and forwards only `/social-reading/api/*` to the configured loopback port. Production proxy/session configuration remains the backend owner's responsibility.

The backend must bind the exact browser origin (`http://127.0.0.1:8788` locally). Do not relax Origin checks for a test tunnel. Private discussion text and credentials must never be added to public stage assets.

## Verification

`tests/annotations.test.js` exercises exact selection, altered-text refusal and scroll suppression. `tests/stage-annotations.test.js` covers immutable main bytes, final hashes, stale-source refusal and linked asset refusal. Python server tests cover forwarding Origin/cookies/body and preserving denial responses.

For the real two-account browser test, set `SR_CREDENTIALS_FILE` to the designated local demo-credential JSON file. The harness reads credentials without printing them. Run `tests/e2e/annotations.spec.js` against `TTS_BASE_URL=http://127.0.0.1:8788`. These tests add new synthetic questions/replies; they do not erase existing records. The separate `annotations-listen.spec.js` exercises actual speech, selection versus seek, composing coexistence, Escape and reentry; run it under the project's GPU lock.

Unknown commands retain their original actor, key, context, selector and version until reconciled. Switching accounts clears visible private data and drafts while retaining the unresolved command for the original actor. Closing retains page-memory drafts; reloading loses local drafts/pending state. Failed refresh after acknowledgment remains a saved result.

## Remaining release gates

Local staging is not deployment. The bounded mirror publisher integration, PR-Agent, one CodeRabbit per code PR, and source/postmerge CI remain required. TestSprite results must identify their precise scope; anonymous panel checks do not establish authenticated or translation coverage. Actual translated-language playback requires its own verified staged voice/model assets. Existing missing source-image placeholders and MathJax CSP errors are not repaired by this change.

## Mirror publication

After rendering and Listen injection into a fresh local stage, generate a catalog with the backend importer. From the reviewed mirror checkout run:

```sh
python3 reader_assets.py --stage /path/to/fresh-stage --reader /path/to/reviewed-reader-checkout --catalog /path/to/input-catalog.json --sha256 CONFIRMED_SHA256 --output /path/to/new-final-catalog.json
```

The mirror delegates stamping and scoped asset installation to this reader publisher so normalization and panel sources stay in one place. Its template includes a conditional boot hook outside main; unstamped pages do not import the client. Return the final catalog to the backend owner for admission. No live root or active catalog is changed by this workflow.

Translation coexistence was verified with pinned Bergamot3.0/en-es and cached Phonon40M Spanish, checking every voice file against its manifest and model/voice revisions against the staging script. The anonymous panel regression observes actual audio starts, preserved original main text, panel exclusion from translation/speech, close-focus restoration and return to English. This does not replace authenticated private-comment coverage.
