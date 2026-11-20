# LT-554: optional storage persistence must not block Listen

Base is merged PR18,9f4026b05de3d0575e1b4f90079062860fc27b3c. Its exact premerge head1aa7230 passed required Python and JavaScript checks; accepted source reviews and consumed PR18 paid-review dispositions remain unchanged. One postmerge check found main push workflow43676910579 in progress; it was not polled. Source merge does not lift the integrated release HOLD.

## Contract and reproduction

Chief's bounded decision makes persistent storage an optional retention enhancement after explicit download consent. Existing `src/consent.mjs` requires affirmative size/licence consent before model bytes. README describes browser cache as potentially evictable. No governing requirement makes persistent storage a prerequisite for listening.

The browser seam controls StorageManager.persist only. On merged source, accepted English download consent followed by a never-settling promise leaves the toolbar absent: `.scratch/lt554/red-ready.log`. An earlier connection-refused setup attempt is not red evidence. The existing real Firefox153 trace independently showed persistStarted with an unresolved promise before Reader overlay mounting. Translation consent had the same awaited call.

## Correction

Both accepted-consent paths now request persistence through one best-effort helper and proceed without awaiting permission. Pending requests are coalesced; success, false, rejection and synchronous failure affect only that request's pending flag. Late outcomes cannot reopen a reader, alter a current language or change consent. No timeout, forced browser permission, permission-pass claim, host preference, CSP change or cache seeding is used. Quota checks, model hashes, cancellation and affirmative download/size/licence consent remain in their original order.

## Validation and limits

Twelve native persistence cases pass: pending English entry with late resolution/rejection and repeated entry; false/rejected/throwing/missing API; pending/false/rejected translation persistence; coalesced outstanding English/translation request; and English/translation decline with no persistence call or model bytes. The two late-outcome cases were rerun after strengthening unhandled-error assertions. Existing cancellation/quota/cache tests remain in the JavaScript suite.

Actual cold Firefox153 native checks now pass source selection/panel/Escape and initialized Listen controls, Space discussion activation, panel placement, reverse focus, ordinary wheel/exit at1440x1000,320x800 and320x256 with doubled root/bar text. Temporary contexts have no permission override, pregrant or seeded cache. This is initialized runtime/UI evidence, not actual audio, browser zoom, touch or audible AT acceptance. Evidence: `.scratch/lt554/firefox.json` and screenshots.

JavaScript1712 passed,8skipped; fresh build/diff checks pass. Eleven existing Chromium/WebKit layout/keyboard/wheel/resize cases pass. All36distinct discussion/status and3Listen/private-exclusion/Space checks also pass on this source. These are source checks, not a whole-site conformance claim.

## Review and release boundaries

Separate LT554 branch/new PR from current merged base. Full Standards/Spec/fresh Correctness and PR-Agent are required before publication/merge; exactly one new CodeRabbit request is authorized for the new code PR only. No additional CodeRabbit/PR-Agent/TestSprite on PR18 and no paid TestSprite run. Final review, hosted CI and artifact pins are recorded below when complete.

R1 credential-login/save/loading automatic speech remains UNCONFIRMED. No foreground VoiceOver attempt is authorized until listener-ready coordination. Source/content decisions, PageIndex/policy admission, final-process AT and production composition remain separate gates. No textbook/backend/composition/live changes or deployment.

## Current candidate receipt

Executable source `d5d5ea2f035485d0e0496af2f030143a056aeeb5`. Complete stage `/Users/johnnyrobot/code/lt554-at-storage-fix` has665files, all94catalog revisions/passages unchanged, inventory SHA256 `d99ab4548a8455b7a3faa593eb0971645bb05c51f75ce0422b9d30e71790dd1e`. Only built `_assets/tts/reader.js` changes from the prior d3efb5d stage; its new SHA256 is `848f55b47ec24cb59f6f8c0c41760a36ad2b93394cb584dc344b0c6b9aa5f153`. Prior stages/packages remain intact.

Runtime archive `/Users/johnnyrobot/code/libretexts-dev/libretext-reader-web/.worktrees/storage/.scratch/lt554/reader-runtime-d5d5ea2-HOLD.tar.gz`, SHA256 `e877e7497ff995d752561e88415f0e1122698d7a58c6075d3b1653acfabde7eb`;15members verified against the manifest. Runtime manifest SHA256 `be3ea7a3e388a29f7040f2e172ebeef8144d931117478e0263c8600c1e5b0749`. Full staging dependency inventory `.scratch/lt554/staging-dependencies.json`, SHA256 `7b0ab9d226501146012bd81b3072b89a93e30a3c77bda5b3e55ff4aab96d8daa`. Dependency member bytes are unchanged; metadata is repinned to this source. Production language offerings and composition remain separately owned and must not be replaced by the local English/Spanish fixture index.

Pre-open PR-Agent: initial setup failed before review because its local provider requires a branch name rather than a SHA; terminal wrapper exit0 was not accepted as proof. Allowed retry used local `lt554-review-base` pinned to9f4026b. Actual review/improve artifacts both completed with terminal0, no major issues and no suggestions, cost$0.0272, Sol. Receipts: `/tmp/pr-agent-libretext-reader-web-storage-1794717342/`. Full independent Standards, Spec and fresh Correctness reviewed04cd32e against9f4026b: no critical, major or concrete minor findings. Reviewers inspected source/tests and records, not independent runtime reruns. Final premerge PR-Agent, single new-PR CodeRabbit and hosted checks remain separate gates. PR18 review counts are unchanged.
