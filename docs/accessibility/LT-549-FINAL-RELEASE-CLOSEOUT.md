# LT-549 final bounded release closeout — 2026-11-14

## Owner deployment disposition — 2026-11-14, 21:05 Pacific

Remaining VoiceOver/listener/foreground acceptance checks are **SKIPPED BY OWNER**. Preserve prior actual observations and all unconfirmed speech states; no speech or whole-site conformance pass is inferred. No further listener readiness or foreground run is required. Chief performs the authorized deployment after introduced-defect, private-access/revision-safety, functional/native, review/CI, composition and host gates pass. Reader makes no live writes.

Inherited Q19/Q69 graphs, uncertain extra Q26 illustration and R4 pairing are deferred known-content follow-up, not blockers for the added-interaction release. Current PageIndex recovery is actual MathJax4 source evidence, but no verified compatible3.2.2/per-page/licensed payload is supplied; retain the inherited limitation without a template migration or a new recovery wave. The approved exact source corrections are implemented under [LT-555](LT-555-CONTENT-CORRECTIONS.md); its new source/revision/speech/native evidence remains subject to source admission. PR19's existing single review/checkback chain is preserved.

Earlier VoiceOver/source-content HOLD statements below are historical and superseded as release gates only by this owner disposition; their factual evidence remains unchanged.


Release HOLD. Source/runtime executable is `d3efb5d69da4cb6252c7013c466da0f8ef945de0`, published through PR18 head `24d83a8d2e5b8397ef27cc16a959bb575cb35420` before this documentation-only closeout. LT-552 and LT-553 corrections, including the major Space-interception fix, are accepted by the completed source reviews. No new product source, textbook, backend or production asset changes were made in this continuation.

## Hosted CI and PR records

The first exact-head observation here found the `tests` workflow actually running on `pull_request`: [run43675584766](https://github.com/johnnyrobot/libretext-reader-web/actions/runs/43675584766), created2026-11-15T04:10:24Z, head24d83a8. Its creation postdates the earlier empty checks. This supports delayed run creation; it does not establish a configuration defect. No workflow edit, retrigger or empty commit was justified or made. That run was not polled. Source merge requires genuinely successful Python and JavaScript checks on the admitted final head; in-progress evidence does not meet that gate. No merge occurred.

PR18's description now records the final implementation,1712JS/36discussion-status/11layout/3Listen evidence, consumed single CodeRabbit review, failed14/15TestSprite disposition and PR-Agent's documented two-attempt exception. No duplicate paid review/run. Published description is separate from any subsequent final documentation head/CI receipt.

## R9: actual pinned publisher configuration versus fixture

Exact page: `chem_4b/Chem_4B_Textbook/Unit_I:_Chemical_Thermodynamics/I:_Fundamentals_of_Thermochemistry_(Heat_and_Enthalpy)/1.05:_Heat_Capacity_and_Calorimetry/index.html`, first table caption.

The local final stage has an inline `window.MathJax` delimiter configuration followed by `/_assets/mathjax/tex-mml-svg.js`. Its captured production CSP, retained in `scripts/serve-local.py`, permits same-origin scripts but no inline script hash/nonce. The pinned mirror source297976ca5518f9a786867bde9a557fe063342fd7 supplies the same delimiter configuration through `mirror_sanitizer/static/reader.js`; its `page.tpl` loads `/_assets/reader/reader.js` before MathJax. The sanitizer likewise externalizes this configuration. This is a pinned publisher/source comparison under the recorded production policy, not a fresh live-header or deployed-page observation.

A route-only native Chromium comparison retained the response CSP with no bypass: current fixture blocked one inline configuration script; substituting the pinned external configuration blocked zero. **Both still expose the caption as `Table \PageIndex 1 : Specific Heats…`; neither config defines PageIndex.** Thus inline configuration is a fixture mismatch, but externalization alone does not repair the missing macro. Source page contains no newcommand definition. Reader speech preprocessing already handles PageIndex from the title prefix in its own separate parser; that is not a verified browser macro or permission to invent one.

Exact bounded proposal, not applied: align the local fixture generator with the already-authored publisher sequence `<script src="/_assets/reader/reader.js"></script>` before the existing MathJax script, staging the pinned script verbatim (SHA256 `2e94754658b87430fc437c5d4b273516b912ccd00333da2ba1292be2d5e07f1a`). For PageIndex, recover/approve the original library's per-page definition, then externalize that verified configuration without rewriting authored references. Do not use a guessed macro or substitute the literal caption as an accepted math alternative. Composition must confirm admitted policy/assets/configuration before final AT.

Evidence: `.scratch/lt549/final-closeout/mathjax-policy.json`, `local-mathjax-scripts.json`, `published-reader.js`. Policy SHA256 `12146e8477096ca79b839366615ab1b6cbac3cbaf04b2f4c781ab2577dec60ea`. Experiment changed no persistent page, catalog, runtime or policy bytes.

## R11: selected Firefox target

Installed the public Firefox153.0 / Playwright firefox1538 engine pinned by the existing installed Playwright package. No unrelated download or host preference change. Source selection/panel/Escape passed. Two further anonymous panel cases passed at320x800 and320x256 with doubled root text: Space opening, reverse source focus, Escape restoration and closed-entry bounds. These checks are native behavior, not speech or physical-touch acceptance.

Listen toolbar initialization could not complete: before Reader overlay/control mounting, `navigator.storage.persist()` remained pending with permission `prompt`. This was observed both with temporary context permission setup and an explicit-origin grant for `http://127.0.0.1:8796`; the permission still read `prompt`, with `persistStarted=true`, unresolved result and no reader-on attribute. No worker/toolbar behavior can be accepted from that state. A grant that did not take effect is not reported as successful. No browser-pref bypass or product workaround was applied.

Smallest next check: a bounded Firefox operator/test-context permission resolution on the admitted origin, then the already-prepared initialized Listen/Space/layout journey. Until it resolves, Firefox Listen coverage is an exact observation blocker; no broad reruns. Evidence: `firefox.json`, `firefox-panel.json`, `firefox-storage-diagnosis.json`, `firefox-storage-granted.json`, `firefox-storage-origin.json` under the evidence directory. Initial failed cases are preserved separately; no failures were reclassified as passes. Chromium151/WebKit26.5 and responsive native evidence remain scoped to their recorded cases. Physical touch conformance is outside Chief's selected demo target claim.

## Final-stage VoiceOver observation and limits

On `/Users/johnnyrobot/code/lt553-at-space-fix`, Safari1324px desktop with actual VoiceOver active: native Space on the discussion entry opened the panel and focused Close. The actual caption showed **Close discussion, button**. Native Escape closed the panel, restored entry focus, and the actual caption showed **Discuss this page collapsed, button**. These are bounded changed-control/focus observations. Additional Option-Tab sequence acceptance was not established.

Mounted tools expose screenshots, accessibility state and caption snapshots; no system-audio capture or independent listener is available through them. Captions are not complete utterance history or independent audible assessment. Therefore R1 credential-login success, save acknowledgment and initial queued-loading automatic speech remain **UNCONFIRMED**. Those states were not retried in this continuation. The existing three-step STATUS-OPERATOR-CHECK remains the finite one-attempt-per-state protocol; DOM/AX/application TTS and forced focus cannot pass it.

Restoration verified: caption preference0, VoiceOver switch0; Safari, VoiceOver/Utility and Settings windows absent; OpenMausBot41022/window7479 foreground verified. No zoom, host permission or persistent browser preference changes. Evidence observation record: `final-stage-at.json`; actual caption screenshots were observed through the mounted computer in this conversation, not independently heard.

## Authoritative finite remaining gates

| ID | Exact state/journey | Current disposition | Owner / smallest next action |
|---|---|---|---|
| R1 /4.1.3 | Final stage chemistry page; credential login, save acknowledgment, queued loading | UNCONFIRMED automatic audible speech; no new retry | Authorized audible operator + Chief: prepared3step check, one attempt/state |
| R2 |320px Listen toolbar, enlarged warnings, source focus, Space on discussion controls | Corrected and published; no remaining known major source finding | Reader: retain regression evidence; final-process acceptance remains R10 |
| R3–R8 | Exact image/frame/table/formula pages and locators in BASELINE-TRIAGE and contextual table | Existing source omissions/mismatch and owner decisions retained; no authored alternative/formula edit | Source owners + Chief: approved exact content/semantic correction, repin and rebuild before AT |
| R9 |1.05Calorimetry table1 caption under recorded production CSP | External-config fixture mismatch proven; PageIndex unresolved even with pinned publisher config | Assigned publisher/source owner: align existing script loading; recover/approve original macro; composition-policy check |
| R10 | Changed final-stage control/process journeys | Scoped actual VO caption/focus observation; complete process and audible R1 incomplete | AT operator + Chief: remaining final-artifact process acceptance |
| R11 | Firefox153 initialized Listen; desktop/narrow selected targets | Selection/panel checks pass; persistent-storage request remains pending before Listen | Reader/operator: resolve ephemeral origin permission, run prepared bounded Listen journey; no compatibility pass yet |
| R12 | Moderation/edit/delete applicability | Chief decision: no new UI in this bounded release | Preserve existing authorization/privacy/data-loss protections; no backend moderation acceptance inferred |
| R13 | PR18 exact-head CI, source merge and production admission | CI run exists; genuine final-head success not established here; no merge/deployment | Reader/Chief: required hosted success before source merge; composition owner admits exact artifact/policy/assets; integrated HOLD remains |

## Unchanged runtime and handoff pins

Current complete stage remains665 files;94sampled revisions/passages unchanged. Runtime archive `/Users/johnnyrobot/code/libretexts-dev/libretext-reader-web/.worktrees/lt549/.scratch/lt553/space-fix/reader-runtime-d3efb5d-HOLD.tar.gz` SHA256 `6c1290bcfc4fcfc1692e1498a634a4d29c47b3d33188820e17bac7dc3d975431`;15members verified. Manifest SHA256 `6e1182a686e70369de558595512d3339dfcd1a0ee9115e659b06c9af4c2a36b4`. Full dependency inventory `.scratch/lt553/space-fix/staging-dependencies.json` SHA256 `73d3a8cc9e49a542bbde64be69018b90c26a7209f4cce2a5ccbcf1f2bb7a26ea`. Stage inventory SHA256 `099ad7350b1e85a4bd3c1f068b83bb3593738a183436f71b59351cc3bf3cc858`. No new runtime build or replacement archive is needed for these evidence-only changes. Prior packages and failed evidence remain preserved. A94-page sample is not1,488-page conformance, composition admission or deployment approval.
