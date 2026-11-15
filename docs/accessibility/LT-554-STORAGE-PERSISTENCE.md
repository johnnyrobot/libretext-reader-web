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

JavaScript1712 passed,8skipped; fresh build/diff checks pass. Eleven existing Chromium/WebKit layout/keyboard/wheel/resize cases pass. Existing36distinct discussion/status and3Listen/private-exclusion/Space checks are recorded separately when complete. These are source checks, not a whole-site conformance claim.

## Review and release boundaries

Separate LT554 branch/new PR from current merged base. Full Standards/Spec/fresh Correctness and PR-Agent are required before publication/merge; exactly one new CodeRabbit request is authorized for the new code PR only. No additional CodeRabbit/PR-Agent/TestSprite on PR18 and no paid TestSprite run. Final review, hosted CI and artifact pins are recorded below when complete.

R1 credential-login/save/loading automatic speech remains UNCONFIRMED. No foreground VoiceOver attempt is authorized until listener-ready coordination. Source/content decisions, PageIndex/policy admission, final-process AT and production composition remain separate gates. No textbook/backend/composition/live changes or deployment.
