# Annotation redesign verification

Scope is LT-556 (private highlights/explicit course discussion), LT-557 (visibility, overlap, jump, tags and scoped search), LT-558 (authorized JSON), on existing Reader base82c8fdf and backend base85c229b. This record is evidence collected during implementation, not release acceptance.

## Fresh completed checks

- Backend `npm test && npm run typecheck`: exit0,47/47 tests. Includes migration/reopen, private-owner/instructor/outsider denial, Origin/revocation, receipt identity, exact selectors/orphans, hidden-content exclusion and export mapping. Optional undefined-filter regression first failed, then passed after correction.
- Reader `npm test -- --reporter=dot`: exit0,1734passed/8existing skips across33files; includes22new exact-mark cases and4publisher tests.
- `annotation-workspace.spec.js`:9/9 in Chromium,9/9 Firefox,9/9 WebKit. Covers private save/reload, explicit course post, Bob denial, topic/author search, JSON structure/audience, keyboard/panel widths1440/360/320, actual marked-text overlap disambiguation, focus-preserving jump/show-hide, lost-highlight receipt recovery without a duplicate command, two-account reply/reload, editing/deletion and screenshots at1440/768/360/320.
- Six incumbent auth/expiry/validation/receipt cases passed, including delayed reopen and queued authorization.
- Spanish Listen playback passed; the selection/playback test then reproduced selection-toolbar interception of the entry button. Moving the toolbar above the entry fixed the regression; the two affected Listen selection/Space tests passed12.4seconds. The failed original run remains failed rather than being relabeled.
- Impeccable source detector over the annotation module/CSS/helpers returned[] and exited0. Rendered desktop/mobile inspection prompted a compact header/account/toolbar layout; screenshots and observed interaction remain necessary evidence beyond the detector.

## Reproduce

Start the isolated API with the exact final catalog/digest, database and cookie at port 4210, Origin http://127.0.0.1:8802. Serve a hash-verified isolated stage using `python3 scripts/serve-local.py --root /path/to/stage --port 8802 --api-port 4210` (separate flag/value arguments). Use `TTS_BASE_URL=http://127.0.0.1:8802 SR_CREDENTIALS_FILE=/path/to/designated/private/credentials.json npx playwright test tests/e2e/annotation-workspace.spec.js --timeout=20000 --reporter=line`; add `--browser=firefox` or `--browser=webkit` for those engines. The same environment runs `tests/e2e/annotations-listen.spec.js`; its speech/model dependencies must match their manifests. These tests add synthetic records and do not reset data.

The current local stage is `/Users/johnnyrobot/code/annotation-redesign-stage`. Evidence lives in the UI checkout `.scratch/annotation-redesign/evidence`; credentials/state are in the separate backend scratch directory and must remain excluded from source and public packages. Final command logs, file hashes and source pins are assembled in the release packet.

## Open gates

Independent final UI Standards/Spec/fresh Correctness; backend fix-only re-review; PR-Agent outcomes; exactly one CodeRabbit per PR at final readiness; source/postmerge CI; bounded TestSprite verdict with explicit coverage limits; complete release packaging and final source-hash validation. Actual VoiceOver is SKIPPED BY OWNER, not passed. Existing textbook source limitations and Reader LT-555 corrections remain excluded. No live deployment is authorized by this redesign assignment.


## Additional recovery evidence

The full36-case incumbent run passed the first20 cases, then hit the real15-account-sign-ins/minute protection; it was stopped with failures retained. Eleven expiry/privacy/validation/focus cases subsequently passed in an isolated bounded group. Five of the final six recovery/cross-book cases passed; the refresh-revocation test expected the toolbar before its asynchronous open had completed. It now waits for the authorized open before switching accounts, preserving the intended explicit-refresh seam. A separate unsaved-personal-note/topic sign-out-to-Bob regression passed.

The isolated API was restarted through its separately named local lifecycle. Exact saved personal and course marker IDs and content digest matched before/after, while preserving the existing synthetic database. Seven staged annotation assets were individually checked against source with zero mismatches.

TestSprite run b98717b8-8d74-4a29-b096-f77183e8fdd2 is BLOCKED, not passed. It observed the anonymous panel/keyboard return path, then reported that its browser could not select paragraph text with the mouse. Native Chromium/Firefox/WebKit tests cover the missing selection actions. The failure-artifact request was refused by the service with environment_changed; the scrubbed run summary remains in local evidence. Exactly one new run used0.5credit (680.9before→680.4after, actual plan Standard). No upgrade or automatic rerun occurred; authenticated feature coverage is native evidence, not TestSprite evidence.


## PR-Agent correction disposition

UI pre-open PR-Agent at ca5721e completed, recorded$0.2953 (review$0.1049; improve$0.1171+$0.0733). It identified two confirmed defects: unsent course-topic disclosure after account change, and editing a personal search result without showing the editor. Both were reproduced as failing browser cases, corrected, then passed. Topics now share the existing actor-quarantined question-draft map; expiry restores them only for the original actor, as separately verified for Alice and Bob. An additional suggestion to delete orphan personal marks is rebutted by the accepted backend spec and `src/highlights.ts` orphan-read-only check (all update/delete mutations reject409); no deletion affordance is added for an operation the server deliberately refuses. Independent final UI axes and premerge review remain required.


## Independent UI correction round

The first independent UI review at c97436e found one major expiry-recovery defect, plus smaller draft/navigation issues. Returning to a tab after local expiry triggered a second unauthorized background refresh that discarded suspended drafts. The regression failed with an empty personal note after same-actor login; preserving draft quarantine for401and clearing it for403fixed the case. Question/topic/personal-note recovery is asserted through the real UI.

Separate failing→passing cases cover deletion of another mark erasing the active note;409IDENTITY_CHANGED leaving prior-owner private UI visible; missing Mine/Course audience selection for search/export; and a dead download link left after its blob URL expired. The busy-visibility paint check also passes after moving renderer clearing behind the restore busy guard. Search audience follows the backend's existing all|mine|course contract; no access rights change.

The reviewer observed no tests or runtime. Its source-only browser-support caveat does not negate our explicit CLI-driven Firefox/WebKit runs recorded above; the default config alone does not select those engines. Backend null-filter input remains outside the documented optional-string adapter contract; the literal string null may be a legitimate search value and is not silently dropped. This is a nonblocking adapter-consistency nit, not a privacy defect.


## Final-head authorization correction

Final premerge PR-Agent at4643b69 completed297seconds,$0.3377. It identified three confirmed async-state defects: post-save refresh401/403left private UI visible; obsolete mark loads could revoke a newer account; unknown highlight acknowledgments left fields editable and later discarded those edits. Each was reproduced with a failing browser test, then corrected and passed. The stale-background red test first needed its own explicit Discuss navigation before it reached the actual revocation symptom; both receipts are retained.

Mark/search/export loads now check current actor, request generation and panel generation before authorization side effects, and discard stale errors. Highlight completion does not clear another account's editor. Authorization loss after acknowledgment revokes protected views while retaining the saved result. Personal note/topic fields remain disabled during unresolved immutable commands; course-topic fields follow the existing question-command lock. These corrections add no new product scope or endpoint.

The expanded18-case suite runs in two shards per browser with `--fully-parallel --workers=1 --shard=1/2` or2/2, restarting only the managed isolated API between shards. This keeps each group below the real15-account-login/minute guard; it does not weaken the service limiter or reset any SQLite data.


## Background-restoration final guard

The e35e037full PR-Agent pass cost$0.3706 and raised two related background-restoration ordering cases. A foreground action now invalidates outstanding background session checks, and a resumed background check verifies foreground activity before continuing. The startup-account regression failed against the prior source and passed after correction. The search-race test initially had gated-route teardown errors; replacing its timing control with a browser-fetch wrapper produced a clean missing-results failure against the exact e35e037module fixture, then passed against the corrected module. This fixture affects only the explicitly selected local reproduction (`SR_REVIEW_BASELINE`); default tests load the real prepared stage.

The two production-code guard lines are reviewed against e35e037rather than buying another full identical-diff review. Installed Playwright used for the browser evidence is1.62.1; explicit three-engine local runs remain separate from hosted unit/build CI. Existing source, private-state and owner-only deployment boundaries are unchanged.


Keyboard finishing check reproduced a lost-focus case introduced by the selection toolbar: its originating Highlight button is hidden when the panel opens, so restoring focus to it on Escape fails. Close now falls back to the visible annotation entry when the original focus target is hidden, disconnected or the body; visible reading-context targets and the original scroll position remain preserved. The new keyboard regression failed first and passed after correction.


WebKit finishing run initially passed20cases and failed the new keyboard selection-action case before reaching the panel. Focusing the action collapses the DOM selection there. The annotation controls now retain the already validated capture while they own keyboard focus, and clear a collapsed capture when focus leaves. The same WebKit keyboard case passes after this scoped correction; the failed full-shard receipt remains retained. No Reader/Listen code changes were needed; its existing hotkey guard already excludes buttons.
