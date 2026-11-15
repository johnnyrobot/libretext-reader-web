# LT-549 runtime handoff to Social Reading

## Authoritative release disposition — 2026-11-14

Current findings and finite owner/action rows are consolidated in [final bounded release closeout](LT-549-FINAL-RELEASE-CLOSEOUT.md). Published Reader source24d83a8 is executable-equivalent to d3efb5d; LT-552/LT-553 and the Space major are corrected. R2 is closed as a source defect. R13 is a hosted-CI/source-merge/composition gate: the correct pull_request run exists, observed in progress once; no hosted pass, merge or deployment claimed. Earlier local/publication/CI-pending statements below are historical checkpoints.

R9 now separates a proven inline-config fixture mismatch from PageIndex's still-missing verified definition. R11 selected demo targets are desktop Chromium, Firefox and Safari/WebKit plus320CSSpx keyboard coverage; Firefox selection/panel checks pass, but Listen is blocked before mounting by its unresolved persistent-storage request. New actual VoiceOver captions confirm only final-stage discussion Open/Close and focus restoration. R1 automatic login/save/loading speech remains UNCONFIRMED under the existing finite protocol. Source-content R3–R8 and final-process acceptance remain held; no physical-touch or1,488-page conformance claim.

## Historical source/evidence checkpoints


## Current keyboard integration correction

**Release HOLD.** Executable `d3efb5d69da4cb6252c7013c466da0f8ef945de0`, stage `/Users/johnnyrobot/code/lt553-at-space-fix`. First-round Standards and Spec found no major/critical issues at `5ae3b4d`; fresh Correctness found one major: Listen intercepted Space on discussion buttons. Native regression reproduced the closed panel after Space. The fix respects already-handled events and native interactive Space/arrow activation while retaining Escape behavior. Second, fix-only Standards/Spec/fresh Correctness reviews of `cbc770a448d2474750502b405e7f9d8d1014d6dc` returned no major/critical findings; Correctness confirmed the original major resolved. Final publication and the single exact-head hosted-CI disposition are recorded in PR18/LT-553; source review does not lift the release hold.

Final reruns: 11 layout cases, 36 distinct discussion/status cases, 3 Listen regressions including Space on Open/Sign in/Post/Close without starting audio, and 1,712 JavaScript tests pass (8 skipped); build/diff checks pass. Evidence: `.scratch/lt553/space-fix/`. Both prior stages/packages are preserved; their affected executable/runtime evidence is superseded by this candidate. All 94 sampled catalog revisions/passages remain unchanged. R1 audible status, R3–R9 source/context decisions, final-artifact AT/target coverage and production admission remain held. No new moderation/edit/delete UI per Chief's R12 disposition.


## Prior pre-shortcut candidate — 2026-11-14

**Release HOLD.** Executable source `e2feddd7af7a1d97539ec6a0226e3a3f152f9d11`; independent Standards/Spec/fresh Correctness review and final publication/hosted CI are pending. LT-552 source/docs are published through `3528413`; no merge or deployment. The new candidate supersedes the affected Listen/control/layout executable and package evidence from `67b6dc2` and `185cbfe/ef34231`; historical artifacts remain intact. Annotation status JavaScript/API/anchor semantics and all 94 catalog revisions/passages are unchanged.

Current local stage: `/Users/johnnyrobot/code/lt553-at-toolbar-fix`; 665 files; inventory SHA256 `ca695b675723bed248acb1c149a1b86499bbc99f4774a9c5b0dedafc0e7ec3c8`. Runtime archive: `/Users/johnnyrobot/code/libretexts-dev/libretext-reader-web-lt549/.scratch/lt553/reader-runtime-e2feddd-HOLD.tar.gz`; SHA256 `4361d82bbf6a9e96595b5d6c64a25fce2a54f7edf90e551ab2d9c8161ecaa423`; manifest SHA256 `07c8a01219ff3c3d11a01c0653ef72465055a3bab78b02822b8ca191e2dacd18`; dependency inventory SHA256 `1c470b440837dc0499254ac6e1bdb5907dadfcfdf8499d7f2d2b8ec722a66e8b`. All 15 archive members are verified against the runtime manifest. Full stage/non-runtime asset inventory is `.scratch/lt553/stage-sha256.json` and `.scratch/lt553/staging-dependencies.json`. The production bootstrap is retained from the pinned mirror package and hash-checked; the local AT stage directly loads annotation modules. Production composition must reconcile that bootstrap/stamp path, policy/configuration and admitted assets, rather than copying the AT stage as a release. Local English/Spanish offerings must not replace production language offerings.

Validation: 11 initialized Chromium/WebKit layout/keyboard/wheel/resize cases pass; 36 distinct discussion/status cases pass; 2 Listen/private-exclusion regressions pass; 1,711 JavaScript tests pass, 8 skip; fresh build and diff checks pass. Detailed red-to-green evidence and native limits are in [LT-553](LT-553-LISTEN-LAYOUT.md). This does not establish actual zoom, physical touch, complete readability, audible AT or 1,488-page conformance.

R2 (narrow Listen overflow) is corrected in this candidate, pending source gates. R12 is disposed by Chief: no new moderation/edit/delete UI in this bounded release; existing authorization/privacy/data-loss protections remain required. R1 automatic credential-login/save/loading speech remains UNCONFIRMED; use the finite three-step operator check on the admitted final artifact. R3–R9 source/context owner decisions, R10 final-artifact AT, R11 required browser/device targets and R13 source/composition admission remain gates. No duplicate CodeRabbit, paid TestSprite or PR-Agent retry.

## Prior checkpoint (historical scope and pins)


**HOLD — composition input, not deployment approval.** Reader source/build185cbfe28ab0763767590a0a78b22dbb51e38dec, executable-equivalent ef34231. Mirror bootstrap source297976ca5518f9a786867bde9a557fe063342fd7. Subsequent changes are evidence documents only. Social Reading owns production1,488-page composition and backend/source packaging; Reader made no changes in that owner's workspace.

Artifacts under `/Users/johnnyrobot/code/libretexts-dev/libretext-reader-web-lt549/.scratch/lt549/closeout-185cbfe/`:

| Artifact | SHA-256 | Scope |
|---|---|---|
| `reader-runtime-185cbfe-HOLD.tar.gz` | `9a966b6b2bc8af5b1cf5485d93d58646e5b6960f97483a7de4404fcbbee20efb` |199,024bytes;14runtime code/style files plus manifest; all15tar members verified |
| `runtime/runtime-manifest.json` | `13508e3c21e4af3fbfc12dafd6b648eb1f9202458dfbc3b6bd446f93d3917b92` |exact paths/bytes/hashes and reader/mirror pins |
| `staging-dependencies.json` | `233a8bb83b74f533edab754571f176c224622396ee531cbd34f9d7f17bfaa2ae` |18manifest-verified English/Spanish/translation files plus9staged engine/index files |
| `runtime-receipt.json` |receipt contains archive/manifest paths, hashes and tar-member result |local verified packaging receipt |

Fresh npm build completed. Archive member names are relative, contain no traversal, and each extracted file hash equals its manifest entry; archived manifest equals the standalone manifest. Includes reader annotation module/CSS/timer/client/anchor, mirror annotations.js bootstrap from the pinned commit, and8built TTS code/style files. No models, pages, speech manifests, catalog stamps, private records, credentials, cookies or secrets are included. No old evidence/source-evidence status was reset by packaging.

## Dependency and composition boundary

- Required English Phonon manifest/files and optional tested Spanish Phonon, Bergamot engine/en-es model files are individually listed/hashed in the dependency inventory. Model source/revision/license metadata stays with each manifest. ORT variants must match the built transformers/runtime; do not mix versions or use nested leftovers.
- Local offered-language index contains Spanish only. It is evidence for the tested profile, not authority to remove production French/German/Portuguese offerings. Retain and independently validate the owner's published language/model assets; do not blindly overwrite production pairs.json with this sample.
- Legacy `_assets/tts/onnx` and nested ort-mt leftovers in the old local stage are not required by this current Phonon runtime and are not composition inputs.
- Preserve actual published textbook HTML, CSS, images/fonts, MathJax, navigation and existing headers/cache scope. Reader archive alone cannot complete those assets. Verify referenced dependencies across the actual1,488pages; the94-page sample is not a replacement site.
- Preserve/build matching per-page speech.json for readable allowlisted pages and retain explicit unsupported fallbacks. Stamp the exact catalog book/page/revision/passages before runtime transforms; compare every composed page's immutable revision/passages and private selector contract afterward.
- Keep same-origin API authority, existing CSP/COOP/COEP scope and model cache policy. Back up/preserve acknowledged/private state in the owner's packaging; this runtime archive contains none.
- The corrected local complete stage remains `/Users/johnnyrobot/code/lt549-at-status-fix` (635-file inventory a43f640ce62437b027b62116b5b1414d87d6463b94293580cf1c40f1589c2066). This is94-page AT evidence only; only annotations.mjs differs from the preserved5e554b8complete stage.

## Source/release gates

Hosted Python and JavaScript checks succeeded on185cbfe; CodeRabbit automatic check skipped. Existing consumed CodeRabbit disposition, full Standards/Spec/fresh Correctness and final fix-only review remain recorded in LT-549-STATUS-FIX.md. PR-Agent's prior two-attempt failure exception remains; no third attempt, new paid run or review was started. Failed TestSprite14/15record remains unchanged.

Credential-login/save/loading speech has source/native evidence but remains unconfirmed as automatic AT output; a finite audible-operator protocol is prepared. Baseline omissions/contextual decisions, embedded media/table/math semantics, incomplete contrast/cross-browser and complete-process/final-artifact AT plus Chief acceptance remain gates. Queued reauthorization Signed in has scoped actual VoiceOver evidence. No whole-site conformance claim, merge or deployment.
