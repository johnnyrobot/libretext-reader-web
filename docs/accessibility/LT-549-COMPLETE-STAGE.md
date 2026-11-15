# LT-549 complete local AT stages — 2026-11-14

**Current stage: `/Users/johnnyrobot/code/lt549-at-status-fix`, executableef34231.** [Current start instructions, hashes and review/AT result](LT-549-STATUS-FIX.md). The5e554b8stage below is preserved historical evidence; do not use its old annotation module as the status correction.

## Historical complete5e554b8stage

Status: prepared and verified for scoped local testing; **release HOLD**. This replaces the stale stage instructions for further AT, preserving every previous artifact.

Stage: `/Users/johnnyrobot/code/lt549-at-complete-5e554b8`
Reader repository: `/Users/johnnyrobot/code/libretexts-dev/libretext-reader-web-lt549`, HEADa618f504e08b68bde1905fb8419207732911b7d7 before these uncommitted evidence changes. Executable source5e554b86e13cf67f345423580352c0f8d9d36ae3; subsequent committed changes touch only three accessibility documents. Fresh `npm run build` completed successfully.

Backend snapshot6980064df22fd2a65efaf3aec172b8c1a7da977e; isolated fixture `/Users/johnnyrobot/code/lt549-at-fixture-6980064`, catalog SHA25683c5d04eaa8c43af302bfcd5e35d62fd9642ad2f96d2aba2d7c9caab28514c8e. Only designated synthetic accounts/database. Never substitute a shared or live database.

## Start

Run each service in its own foreground terminal. Both are currently stopped.

```sh
cd /Users/johnnyrobot/code/lt549-at-fixture-6980064
node --experimental-strip-types launch.mjs
```

```sh
cd /Users/johnnyrobot/code/libretexts-dev/libretext-reader-web-lt549
python3 scripts/serve-local.py --root /Users/johnnyrobot/code/lt549-at-complete-5e554b8 --port 8796 --api-port 4206
```

Chemistry entry: `http://127.0.0.1:8796/chem_4b/AGENDA1/Example_Final_Conceptual_Questions/`. Social psychology entry uses the same origin with `/social_psychology/13%3A_Competition_and_Cooperation_in_Our_Social_Worlds/13.01%3A_Conflict_Cooperation_Morality_and_Fairness/`. Browser origin must remain exactly127.0.0.1:8796. Passwords stay in the designated fixture accounts.json; do not print or save them in browser password storage.

Use the fixture's confined `timing.py` as documented in its README: arm60seconds, reopen and allow authorization to finish before closing again; capture the warning with at least20seconds remaining. Compose recovery drafts only after refresh. A control tree entry is not independent proof that a control activated. Expired sessions need sign-in; do not revive them. Stop services with Ctrl-C.

## Construction and verification

- Cloned the earlier translation stage into this new directory; original incomplete stages remain unchanged.
- Tight reproduction `.scratch/lt549/at-complete/reader-entry.mjs` initially failed: speech.json404 and page error `This page has no reading list.` CSS, MathJax and SVG also404.
- Copied fresh Vite output into `_assets/tts` following the layout in scripts/stage-local.sh. Existing English/Spanish model files were reused and24manifest file hashes verified.
- Used supported `pipeline.tts_manifest` CLI on chem_4b with `PYTHONPATH=.` and `/Users/johnnyrobot/.cache/lt537-venv/bin/python` (the main repo's old .venv interpreter symlink is broken).92chemistry pages:90injected;2without readable content left as found. Pipeline diagnostics include2unspoken expressions on Worksheets/10; no blanket math-AT acceptance.
- Restored34cached page assets from `/Users/Shared/LT-255/stage/_assets`. Restored338additional assets from public library.libretexts.dev GETs, checking imported content-address filenames against SHA256. No live write.
- Final check:1,038static stylesheet/script/image references across94catalog pages,0missing; CSS url dependency scan0local dependencies. Four annotation hashes match source-evidence.json. Reimport verifies all94catalog revisions/passages unchanged.
- Reader-entry reproduction now opens the consent dialog. Actual Safari also opened Reader Mode, English/Spanish controls and translation consent.
- Existing annotations-listen.spec.js:2passed16.0seconds against8796 and synthetic backend. Ran through required GPU lock; includes real AudioBufferSourceNode starts and worker-message private-text exclusion. This is native regression evidence, not VoiceOver speech evidence.

Evidence directory: `.scratch/lt549/at-complete/`. `restored-assets.json`, `public-asset-receipts.json`, `static-reference-final.json`, `model-checks.json`, `verified-stage.json` and `final-stage-sha256.json` retain provenance. Final inventory pins635files; inventory SHA256 `5dc6d68435ed77fa637598e89e441dd4de2fd0cca30a23144b211673f353855d`. Changes to this stage require a new inventory and relevant revalidation. The old provisional runtime archive is preserved and is not this completed stage.

## Limits

“Complete” here covers the checked asset references, catalog content and built runtime of the94-page local sample. It does not establish production1488-page completeness, every navigation destination, remote iframe availability, semantic/math correctness, full AT or conformance. Complete current AT disposition is in LT-549-VOICEOVER-2026-11-14.md. Baseline contextual and Chief release gates remain.
