# LT-555 exact source corrections and release disposition

Current implementation is confined to `content-corrections/LT549/` and its safety tests. The [bundle runbook](../../content-corrections/LT549/README.md) records approved scope, commands, refusal behavior and ownership. Decision packet SHA256 is `9b4f2d7cfd49f96d04db50f62455033db51baafe304189438682d331755a0841`; bundle SHA256 is `642347121d813ebd8ba22bd3e69c1fb6a3deee04af9439d47f06dab5d037cbbf`.

111 exact replacements were applied to a NEW source-only stage `/Users/johnnyrobot/code/lt549-corrected-source-v1`:14pages changed;1,474other HTML files unchanged. A second application from original source to `/Users/johnnyrobot/code/lt549-corrected-source-v2` produced all1,489files byte-identical, including the receipt. The original snapshot was reconciled against the pinned original catalog with zero drift; no original source, old package, model or private state was changed.

## Verification

- 20portable safety tests pass. Full Python:796passed,8skipped; JavaScript1714passed,8skipped.
- 42paired native page/engine cases pass:14pages each in Chromium,Firefox,WebKit. The fourteen corrected tables expose0headers before and79native/AXheaders after in each engine. Explicit vapor-pressure ID/header references resolve uniquely within the same table; row/column geometry and scientific source order remain consistent. Off-origin embed requests were blocked; no hosted pronunciation/media acceptance is inferred.
- Native headers adopt default bold/centred presentation:74individual promoted cells per engine change computed font weight;68also change start alignment to centre. The five grouped reaction headers also use native header presentation. Original attributes/styles are retained, no stylesheet normalization is invented, and source table values remain in their measured rows/columns. Narrow wide-table geometry remains recorded separately; this is not a blanket reflow/conformance pass.
- 28before/after speech manifests bind exact source bytes and splitter version and pass identity/count/span checks. Weak-acid worksheet math changes197spoken/2failed to199spoken/0failed. Corpus fallback total9→7:the seven other failures are inherited and unchanged. One pre-existing zero-width-BOM empty sentence in5.E remains unchanged; no new empty sentence is introduced. Existing unsupported-table skip notices are retained honestly, including the reaction table's structure notice.
- All 14affected revisions change, while selectable paragraph IDs/quotes remain identical. All 1,474 other source/catalog-page projections remain equal; their speech was not regenerated. Reader's existing matchesAnchor rejects all old-vs-new revision comparisons; no historical anchor/comment is moved. Before/after public page manifests and the precise delta are in `.scratch/lt555/anchor-delta.json`, labelled diagnostic/not admitted.

Evidence directories: `.scratch/lt555/`, `/Users/johnnyrobot/code/lt549-correction-native-v3/`, `/Users/johnnyrobot/code/lt549-correction-speech-v2/`. Corrected rendering copy `/Users/johnnyrobot/code/lt549-corrected-render-v1` uses copied, unchanged public assets from the currently merged d3efb5d Reader stage; it is not a production package. Reader runtime integration follows canonical PR19 merge through its existing sole closeout chain; no competing storage patch is introduced here.

## Current owner decision and remaining execution gates

On2026-11-14 at21:05Pacific the owner skipped remaining VoiceOver/listener checks. R1/remaining foreground AT acceptance is **SKIPPED BY OWNER**; actual prior results are preserved and unobserved speech stays UNCONFIRMED, never PASS. No more listener readiness or foreground run is requested.

Chief deferred inherited missing graphs, uncertain extra Q26illustration and R4pairing from this feature release to known-content follow-up. Their source bytes remain intact apart from approved exact literals. Recovered current PageIndex config is MathJax4 and has per-page/dependency/licence limits; no compatible bounded3.2.2payload is established here, so the inherited limitation is recorded without a migration or new recovery blocker. These decisions make no whole-site WCAG/scientific-validity claim.

Still required: close introduced source defects if found; complete applicable source reviews and genuine exact-head CI; admit exact source/speech/catalog/runtime/dependency identities; preserve historical state; perform owner composition and Chief's host/deployment validation. Chief performs live deployment under the owner's authorization. Reader does not edit backend/catalog/composition/live state.

All fourteen affected-page manifests have nonzero sentence counts in the actual run and are candidates for the composition owner's source/lineage admission. No source-page rewrite or Reader injection was performed by speech verification.

## Verifier review corrections

PR-Agent review/improve on e2f1a81 completed with two verifier findings ($0.3973). Both were confirmed and corrected before publication: native evidence destinations now resolve real parents and must be disjoint from both source roots; every recorded local HTTP failure now invalidates the case. A native CLI regression reproduced an output directory created inside a synthetic source root before the fix and proves refusal afterward, including parent aliases. A controlled missing-CSS server demonstrated old false passes and corrected failures; focused original/fixed runs cover all three engines, with fresh process exits0and1respectively. The normal final42paired cases pass with zero missing local resources. No approved page bytes or bundle hashes changed in these verifier fixes.

## Independent review disposition

Standards, Spec and fresh-context Correctness independently reviewed c07a385 against fixed base9f4026b, including verifier corrections from e2f1a81: each reports zero critical, major or concrete minor findings. Reviewers inspected source and pinned artifacts; they did not rerun browser/speech/test suites. Reader rechecked all six summary evidence hashes on return. No duplicate paid review was run.

Canonical storage fix PR19 is merged as82c8fdf979486a4ceca6ef4d90e0d51f1c8d7e7f. Its exactd37af6a head passed hosted Python/JavaScript and its single CodeRabbit full review; both PR-Agent stages completed clean ($0.0625 total). Final composition must use that canonical runtime, with no competing storage patch. Source-only correction publication/final PR-Agent, one new CodeRabbit and hosted CI remain pending.
