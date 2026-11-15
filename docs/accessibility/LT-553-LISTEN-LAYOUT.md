# LT-553 responsive Listen controls — release HOLD

The initialized Reader Mode toolbar on `chem_4b/AGENDA1/Example_Final_Conceptual_Questions/` at 320x800 exposed scrollWidth839/clientWidth320. Language, Speed and Exit were offscreen. The permanent native test failed with exactly839 versus320 before the fix; evidence `.scratch/lt553/red.log`. The original source/runtime remains preserved.

The correction wraps controls and constrains label/select widths without removing any actions or changing language/voice/rate handlers. The toolbar scrolls vertically within40dvh when space is short. ResizeObserver measures its occupied height and shares `--tts-bar-height` with source padding/scroll padding, discussion panel height/offset/reservation and the closed discussion entry. Exit disconnects the observer and restores its previous inline property. Native resize/reentry checks exercise the measurement lifecycle.

Coexistence testing caught Listen's root scroll-padding overriding the larger discussion reservation; selector precedence now preserves the open-panel reservation. A short-screen test also reproduced a clipped consent action before initialization. The existing consent card now has viewport-bounded ordinary scrolling, preserving consent text and actions. No programmatic focus workaround, live-region change or authored page change is included.

Regression seam: actual initialized local Reader Mode through native Playwright UI. Checks cover horizontal bounds, every named control by sequential keyboard navigation, normal wheel access to consent and Exit, rate/voice selection, panel/toolbar separation, reverse source focus, close restoration, exit/reentry and resize after mounting. Native geometry permits1CSS pixel fractional rounding. Profiles:1440x1000,320x800,800x320,320x256 and320x256 with doubled root/bar text and prescribed spacing. Chromium uses Tab; installed macOS WebKit defaults to skipping buttons with Tab and uses its standard Option-Tab/Option-Shift-Tab all-control path. No host preference was changed. Engine/root-text emulation is not physical touch, actual browser zoom, Safari/VoiceOver or audible speech evidence.

Exact source/stage/archive/dependency pins and final test/review dispositions are recorded below when finalized. Original status-only runtime185cbfe/ef34231 and LT-55267b6dc2runtime are historical; they do not contain this toolbar correction. Source merge, production composition and accessibility acceptance are separate gates.

Chief R12 disposition: no new moderation/edit/delete UI belongs to this bounded release. Existing authorization/privacy/data-loss protections remain required and tested in their existing scopes. R1automatic credential-login/save/loading speech remains UNCONFIRMED; use the finite three-step operator check on the admitted artifact. R3–R9source/context decisions and R10/R11final-artifact AT/target coverage remain open. The94-page sample cannot establish1,488-page conformance.

Existing CodeRabbit request is consumed and PR-Agent's documented failure exception stands. No duplicate paid review/TestSprite, new PR-Agent retry, merge, deployment or live write.

## Candidate validation

Final source: 11 native Chromium/WebKit layout/keyboard/wheel/resize cases pass (40.6s); 36 distinct discussion/status cases pass in bounded groups (28 discussion cases, 8 queued-status cases); both English/Spanish Listen/private-exclusion regressions pass (15.1s); 1,711 JavaScript tests pass, 8 skip. Fresh build and diff whitespace checks pass. Evidence is under `.scratch/lt553/`; the deduplicated discussion case list avoids counting repeated overlap checks twice. No test passes are inferred from interrupted diagnostic runs.

WebKit pointer opening preserved a previously focused Voice control, so the test now explicitly starts keyboard opening from the discussion entry. That aligns the expected restoration with the existing saved-focus contract; no product focus forcing was added. Full independent Standards/Spec/fresh Correctness review is pending before this candidate is published.
