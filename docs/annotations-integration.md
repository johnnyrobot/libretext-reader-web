# Integrate social annotations into a textbook reader

The annotation module mounts its controls outside `main#main-content`, preserves textbook content and uses a public page-context stamp for exact source selection. Private data comes only from the authenticated same-origin service. Service source and production instructions: [libretexts-social-annotation](https://github.com/johnnyrobot/libretexts-social-annotation).

## Files to integrate

| Source in this repository | Published path |
| --- | --- |
| `src/annotations.mjs` | `/_assets/reader/annotations.mjs` |
| `src/annotations.css` | `/_assets/reader/annotations.css` |
| `src/annotations/client.mjs` | `/_assets/reader/annotations/client.mjs` |
| `src/annotations/marks.mjs` | `/_assets/reader/annotations/marks.mjs` |
| `src/session-timer.mjs` | `/_assets/reader/session-timer.mjs` |
| `src/social-reading/client.mjs` | `/_assets/reader/social-reading/client.mjs` |
| `src/social-reading/anchor.mjs` | `/_assets/reader/social-reading/anchor.mjs` |

Keep the relative module layout. These seven assets implement annotations; the wider Reader repository also contains separate audio/translation features. Integrating this panel does not require replacing an institution's whole reader or rebuilding its voice models. Preserve existing keyboard, content-security, reading and Listen behavior.

The headless client/anchor helpers are pinned internal LibreTexts copies. The annotation adapter extends the core methods without changing the established same-origin transport or exact-anchor normalization. Match the reviewed service/Reader pair in the release manifest; do not replace a frozen adapter with an arbitrary latest backend file.

## Public page contract

Each supported page has a `script[type="application/json"]#sr-page-context` outside main containing schema `social-reading-page-v1`, normalization `js-whitespace-v1`, book/page/revision and blocks `{block,quote,quoteSha256}`. Escape `<` in embedded JSON. It contains public source metadata, never accounts or private comments.

Revision is the digest of original parsed main content before runtime transformation. `p-N` counts all descendant main paragraphs before eligibility exclusions. Canonical text collapses ECMAScript whitespace, contributes a space for `br`, ignores script/style/nav/footer/button text and preserves Unicode code units. The runtime must match exact eligible text before rendering or accepting a selection. Optional selectors retain start/end UTF-16 offsets and exact selected quote within the whole paragraph.

Changed revisions, transformed text, unsupported selections and invalid surrogate boundaries are refused or shown as stale history. No fuzzy relocation is performed. Translation/Listen wrappers can make a block unsupported; retain a working original-text route rather than changing the anchor rules.

## Stage a publication

Use a fresh local copy of the textbook HTML and the matching backend-imported catalog. Never pass a live root.

```sh
node scripts/stage-annotations.mjs --stage /absolute/fresh-stage \
  --catalog /absolute/catalog-input.json --sha256 VERIFIED_INPUT_DIGEST \
  --output /absolute/catalog-final.json
```

The publisher verifies all source files and asset destinations first, preserves main-content bytes, installs the seven assets, stamps outside main and emits the final published-page hashes. Configure the backend with the final catalog and independently verified digest. Full two-repository commands, service and reverse-proxy setup are in the [backend deployment guide](https://github.com/johnnyrobot/libretexts-social-annotation/blob/main/docs/DEPLOYMENT.md).

Existing mirror integration may call this publisher through `reader_assets.py` in its own repository. Confirm that publisher's interface against the reviewed institution checkout; do not assume it exists in every frontend. A page can alternatively embed the same public stamp, stylesheet and module without using the mirror pipeline, provided it satisfies identical source verification.

## Browser and API behavior

The service namespace is `/social-reading/api`; this is independent of the backend repository rename. Cookies and requests are same-origin. Preserve Origin, bodies, cookies, denial statuses and no-store responses through the proxy. Exact production Origin and integrated READER_ENTRY configuration belong to the service operator; do not relax origin checks for a test tunnel.

Highlight saves an owner-private mark/note. Discuss opens a separate deliberate course contribution; it never silently publishes private note text. Search/export honor the same audience filters. Commands retain actor/key/context/payload/version until acknowledgment or receipt reconciliation. An unknown network outcome is not proof of a failed save. A different account cannot inherit private views, drafts or recovery identity.

Question/reply/note/topic drafts live in page memory. Same-account expiry recovery can restore them; explicit logout/different actor clears them; reloading can lose them. Session warnings remain reachable when the panel is closed. Extension is deliberate and uses server-relative deadlines. Visible focus, field errors, keyboard selection and status announcements are part of the integration contract.

Desktop uses a26rem side panel; at<=760px it uses a bottom panel preserving part of the source. Participation has named continuous-rule sections; account/view/refresh utilities form a separate band. Replies/reply composers retain indentation/connectors at narrow widths. Headings, borders and position provide structure independently of color. Author names remain visible and palette collisions confer no role or identity guarantee.

## Verify the integration

Run the existing focused tests for the actual change rather than treating the whole Reader's unrelated pipelines as annotation acceptance:

- `tests/annotations.test.js`, `tests/annotation-marks.test.js` and `tests/stage-annotations.test.js`: selection, exact ranges, rendering and publisher refusal/preservation.
- `tests/e2e/annotation-author-focus.spec.js`, `annotation-participation.spec.js`: staged-module synthetic layout, authors, keyboard, drafts, empty/disabled/forced-color states.
- `tests/e2e/annotations.spec.js`, `annotation-workspace.spec.js`, `annotation-selection-sync.spec.js`, `annotation-pointer-drag.spec.js`: authenticated service, privacy, persistence, receipt/reselection and actual pointer behavior.
- `tests/e2e/annotations-listen.spec.js`: reading/audio coexistence when the target stage has the required verified runtime/models.

With an explicitly prepared target, set `TTS_BASE_URL` and `SR_CREDENTIALS_FILE` to protected fixture inputs; run Playwright with `--browser=chromium`, `firefox` or `webkit` explicitly. Some authenticated tests skip without credentials, so a green result with skips does not establish authenticated coverage. These tests can create synthetic posts; never target a live course without an agreed data scope. The default local stage may be stale: verify the staged module hashes against the reviewed source before trusting it.

Automated geometry, contrast and browser checks do not establish whole-site WCAG/assistive-technology conformance or educational gains. Production acceptance must verify the institution's actual frontend, identities, enrollment boundaries, proxy, data preservation and supported assistive technology.
