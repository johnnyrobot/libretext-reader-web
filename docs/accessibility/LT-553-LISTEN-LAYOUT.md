# LT-553 responsive Listen controls — release HOLD

## Current keyboard integration correction

**Release HOLD.** Executable `d3efb5d69da4cb6252c7013c466da0f8ef945de0`, stage `/Users/johnnyrobot/code/lt553-at-space-fix`. First-round Standards and Spec found no major/critical issues at `5ae3b4d`; fresh Correctness found one major: Listen intercepted Space on discussion buttons. Native regression reproduced the closed panel after Space. The fix respects already-handled events and native interactive Space/arrow activation while retaining Escape behavior. Second, fix-only review is pending before publication and the one final hosted-CI observation.

Final reruns: 11 layout cases, 36 distinct discussion/status cases, 3 Listen regressions including Space on Open/Sign in/Post/Close without starting audio, and 1,712 JavaScript tests pass (8 skipped); build/diff checks pass. Evidence: `.scratch/lt553/space-fix/`. Both prior stages/packages are preserved; their affected executable/runtime evidence is superseded by this candidate. All 94 sampled catalog revisions/passages remain unchanged. R1 audible status, R3–R9 source/context decisions, final-artifact AT/target coverage and production admission remain held. No new moderation/edit/delete UI per Chief's R12 disposition.


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

## Prior pre-shortcut candidate — 2026-11-14

**Release HOLD.** Executable source `e2feddd7af7a1d97539ec6a0226e3a3f152f9d11`; independent Standards/Spec/fresh Correctness review and final publication/hosted CI are pending. LT-552 source/docs are published through `3528413`; no merge or deployment. The new candidate supersedes the affected Listen/control/layout executable and package evidence from `67b6dc2` and `185cbfe/ef34231`; historical artifacts remain intact. Annotation status JavaScript/API/anchor semantics and all 94 catalog revisions/passages are unchanged.

Current local stage: `/Users/johnnyrobot/code/lt553-at-toolbar-fix`; 665 files; inventory SHA256 `ca695b675723bed248acb1c149a1b86499bbc99f4774a9c5b0dedafc0e7ec3c8`. Runtime archive: `/Users/johnnyrobot/code/libretexts-dev/libretext-reader-web-lt549/.scratch/lt553/reader-runtime-e2feddd-HOLD.tar.gz`; SHA256 `4361d82bbf6a9e96595b5d6c64a25fce2a54f7edf90e551ab2d9c8161ecaa423`; manifest SHA256 `07c8a01219ff3c3d11a01c0653ef72465055a3bab78b02822b8ca191e2dacd18`; dependency inventory SHA256 `1c470b440837dc0499254ac6e1bdb5907dadfcfdf8499d7f2d2b8ec722a66e8b`. All 15 archive members are verified against the runtime manifest. Full stage/non-runtime asset inventory is `.scratch/lt553/stage-sha256.json` and `.scratch/lt553/staging-dependencies.json`. The production bootstrap is retained from the pinned mirror package and hash-checked; the local AT stage directly loads annotation modules. Production composition must reconcile that bootstrap/stamp path, policy/configuration and admitted assets, rather than copying the AT stage as a release. Local English/Spanish offerings must not replace production language offerings.

Validation: 11 initialized Chromium/WebKit layout/keyboard/wheel/resize cases pass; 36 distinct discussion/status cases pass; 2 Listen/private-exclusion regressions pass; 1,711 JavaScript tests pass, 8 skip; fresh build and diff checks pass. Detailed red-to-green evidence and native limits are in [LT-553](LT-553-LISTEN-LAYOUT.md). This does not establish actual zoom, physical touch, complete readability, audible AT or 1,488-page conformance.

R2 (narrow Listen overflow) is corrected in this candidate, pending source gates. R12 is disposed by Chief: no new moderation/edit/delete UI in this bounded release; existing authorization/privacy/data-loss protections remain required. R1 automatic credential-login/save/loading speech remains UNCONFIRMED; use the finite three-step operator check on the admitted final artifact. R3–R9 source/context owner decisions, R10 final-artifact AT, R11 required browser/device targets and R13 source/composition admission remain gates. No duplicate CodeRabbit, paid TestSprite or PR-Agent retry.

## Current runtime receipt

- Archive: `/Users/johnnyrobot/code/libretexts-dev/libretext-reader-web-lt549/.scratch/lt553/space-fix/reader-runtime-d3efb5d-HOLD.tar.gz`; SHA256 `6c1290bcfc4fcfc1692e1498a634a4d29c47b3d33188820e17bac7dc3d975431`. All 15 members verified.
- Runtime manifest SHA256: `6e1182a686e70369de558595512d3339dfcd1a0ee9115e659b06c9af4c2a36b4`.
- Full dependency inventory: `.scratch/lt553/space-fix/staging-dependencies.json`; SHA256 `73d3a8cc9e49a542bbde64be69018b90c26a7209f4cce2a5ccbcf1f2bb7a26ea`.
- Complete stage: 665 files; inventory `.scratch/lt553/space-fix/stage-sha256.json`; SHA256 `099ad7350b1e85a4bd3c1f068b83bb3593738a183436f71b59351cc3bf3cc858`. Built assets match fresh dist output; annotation/timer/client bytes match source.

The new stage differs from the prior LT-553 stage only in built reader.js. Runtime includes the hash-verified bootstrap from the pinned mirror package; the AT stage directly loads modules. Keep production language/model offerings, bootstrap/stamp paths and policy/configuration reconciled by the composition owner. This local package does not establish production admission.
