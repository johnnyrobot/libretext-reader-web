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

Independent final UI Standards/Spec/fresh Correctness; backend fix-only re-review; PR-Agent outcomes; exactly one CodeRabbit per PR at final readiness; source/postmerge CI; bounded TestSprite verdict with explicit coverage limits; complete final restart/source-hash/release validation. Actual VoiceOver is SKIPPED BY OWNER, not passed. Existing textbook source limitations and Reader LT-555 corrections remain excluded. No live deployment is authorized by this redesign assignment.
