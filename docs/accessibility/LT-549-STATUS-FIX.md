# LT-549 queued sign-in status correction

**Release HOLD. Product defect fixed; complete-process AT/conformance not established.**

Executable source: `ef34231dc174b875b286529e59458eb73fb93602` (source fix `a928295`; ef34231 adds the sign-out test acknowledgment wait). Subsequent changes in this correction are test/evidence only, with identical executable source. Old5e554b8AT evidence remains historical and applicable only to its stated unchanged behaviors. Its stale Checking sign-in result is superseded by this correction.

## Behavior and live-region semantics

Queued reopen previously left Checking sign-in… after successful authentication. The status now owns a revision: only its current checking operation can finish it. Any newer save/error/pending message invalidates that ownership. Final close clears only its owned checking text and invalidates old view work. Login completion additionally checks view generation, visibility, authorization success and status revision; expiry/revocation cannot become a stale Signed in message.

The same `p role="status" aria-atomic="true"` persists while the panel is open and is hidden with the closed panel. It retains implicit polite semantics. No assertive escalation, extra live-region copy, focus forcing or timing delay was added to manufacture a speech result. Showing a previously hidden region and moving focus can compete with polite output; native DOM updates alone are not automatic-speech evidence.

## Validation

The original native regression failed with Expected Signed in / Received Checking sign-in. It passed after the source fix. Final bounded synthetic runs:

| Check | Actual terminal result |
|---|---|
| JavaScript |32files;1,711passed,8skipped |
| New status regressions |8passed4.9s: authenticated/anonymous/error, final close, revocation, newer save/pending message, stale login completion |
| Existing timing/focus/error group |12passed7.0s, including expiry error preserved after delayed successful thread response |
| Acknowledgment/layout/close/account group |6passed4.9s |
| Cross-account/retry/receipt group |4passed3.8s |
| English/Spanish Listen/private exclusion |2passed15.2s under required GPU lock |
| Build / diff |fresh npm build succeeded; git diff--check clean |

Thus30discussion/status checks passed across the four bounded groups. Earlier combined runs hit the synthetic backend's15sign-ins/account/minute limit; incomplete/interrupted logs are not green evidence. Batches restarted only the isolated backend process to reset its in-memory limiter, retaining its synthetic database. No production security setting was weakened. Older cross-account tests used a hard-coded8788Origin; these test requests now derive the actual served origin and assert200, so a rejected setup request cannot silently count as an account switch. Test-only follow-up review covers that delta.

Logs: `.scratch/lt549/status-fix/{vitest,status-final,native-a,native-b,native-c,listen-final,build}.log`. Initial failing test artifacts retained. Product-source changes stop at ef34231; no Python source changed.

## Independent reviews

Full fixed point `main=d9d3c3d368fc9df7ccd802f4bfb796ed1f616736`; final source reviewed at ef34231, including delta from a618f50.

- **Standards — Accessibility Chief:** no major/critical, no confirmed documented-standard violation or actionable smell. Retained polite/atomic semantics and separation of source/private discussion accepted at source-inspection level.
- **Spec — Social Reading Dev:** no major/higher. Revision/view ownership, anonymous/error/revocation paths and source/Listen/API boundaries accepted at source level. Noted absence of direct newer-error regression; addressed by the expiry-during-reauthorization status assertion, which passes after the delayed success response.
- **Fresh Correctness — Social Reading Dev, separate fresh thread:** no major/critical or actionable finding; moderate confidence from static source/dependency inspection. git diff--check main...HEAD passed. No runtime/AT claim from this review.

Final fix-only Spec review of ef34231...35daa24 by Social Reading Dev found no major/higher findings, independently confirmed unchanged src/scripts/pipeline, accepted newer-error coverage and served-origin/HTTP200 account setup assertions. Two minor documentation inconsistencies (stale open-finding wording and a historical supplement labeled Current) were corrected. The subsequent documentation-only commit preserves that reviewed executable/test behavior. Existing single CodeRabbit review remains consumed with earlier dispositions unchanged. PR-Agent's documented two-attempt failure exception remains; no third paid attempt or new review requested. Failed TestSprite14/15record preserved (raw SHA2562b7f9b1795ad77a502af308beeceadb4d58b59bcef90621081c21d9b16cb78b7). No deployment/merge acceptance.

## Current complete local stage

Path: `/Users/johnnyrobot/code/lt549-at-status-fix`.635files; inventory `.scratch/lt549/status-fix/stage-sha256.json`, SHA256 `a43f640ce62437b027b62116b5b1414d87d6463b94293580cf1c40f1589c2066`. Four annotation assets match source; annotations.mjs SHA256 `60e4077aaae4b73d2d2b49a3e44fc4e8be00c807ef43b45f063eeaad6e289a14`. All94catalog revisions/passages unchanged; catalog SHA25683c5d04eaa8c43af302bfcd5e35d62fd9642ad2f96d2aba2d7c9caab28514c8e. Compared with the old complete-stage inventory, only `_assets/reader/annotations.mjs` changes. Previously verified static references/models are byte-identical. Old complete stage5e554b8and provisional archive preserved; do not deploy the old archive as this fix.

Start each in a separate foreground terminal (all currently stopped):

```sh
cd /Users/johnnyrobot/code/libretexts-dev/records/LT-549/lt549-at-fixture-6980064
node --experimental-strip-types launch.mjs
```

```sh
cd /Users/johnnyrobot/code/libretexts-dev/libretext-reader-web/.worktrees/lt549
python3 scripts/serve-local.py --root /Users/johnnyrobot/code/lt549-at-status-fix --port 8796 --api-port 4206
```

The optional targeted synthetic fault seam is `.scratch/lt549/status-fix/at/proxy.mjs`, fixed to127.0.0.1:4207→4206; use--api-port4207only with that owned fixture running. No private/live database. Public test account file stays in the isolated fixture; do not print/save passwords.

## Bounded actual VoiceOver observation and limits

macOS26.6.2/build25G83, freshly checked Safari26.6.2and VoiceOver10/build993. Mounted computer controls, foreground permission already authorized. Started with VOoff, test apps absent, OpenMausBot foreground. Existing synthetic Safari session used; no new credential entry. Before foreground, current-stage native fixture proved Checking sign-in…→Signed in with Close discussion focus using one2.5second session-response delay.

Single corrected AT journey: open→Escape→Return during that delay. Actual VoiceOver70126caption window10481first read Close discussion, button, then **Signed in.** automatically; no further navigation/read-status command triggered that caption. PNG `at/transition-5.png` and adjacent raw frames retained with24-frame timing index. Safari's page status independently read Signed in. This proves only queued-reauthorization completion speech in this Safari/VO configuration. It does not establish credential-login success speech, save acknowledgment speech, automatic Checking sign-in loading speech or independent audible quality. Those observations remain UNCONFIRMED; no identical caption loop repeated and no compliance inference.

Source/native guards are now proven for anonymous/error/revoked/closed/newer-message cases; the earlier actual-AT warning/expiry/closed-extension observations retain their original5e554b8pins and were not blanket-rerun. Complete-process/final-artifact AT, baseline images/frames/tables/math, remaining contrast-incomplete/cross-browser context and Chief final acceptance remain release gates.

Restoration: VO switch visually off, caption checkbox visibly unchecked; Safari/Settings/Utility processes absent; owned8796/4206/4207ports free; OpenMausBot7479foreground verified. No zoom/permission changes or new prompt; prior Python local-network denial preserved. Backend/proxy exit0,frontend130afterCtrl-C. No active LT549automation listed. Actual caption PNGs, environment/restoration images and fixture proof are under `.scratch/lt549/status-fix/at/`.


## Release-evidence closeout after185cbfe

Hosted Python and JavaScript checks succeeded on185cbfe(run43663442358); automatic CodeRabbit check skipped, no new review requested. Current source/native status diagnosis and finite audible-operator check are in LT-549-STATUS-OPERATOR-CHECK.md. Exact baseline content triage is in LT-549-BASELINE-TRIAGE.md. Runtime archive/manifest and staging dependencies are in LT-549-RUNTIME-HANDOFF.md. Product executable remains unchanged; documentation-only follow-up does not establish missing speech or whole-site acceptance.
