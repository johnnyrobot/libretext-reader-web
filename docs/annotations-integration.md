# Social annotation integration adapter

Canonical annotation source, publisher, tests and engineering/user documentation are now in [libretexts-social-annotation](https://github.com/johnnyrobot/libretexts-social-annotation). Hand that one repository to engineers implementing the complete annotation feature. This Reader retains only integration/coexistence responsibilities.

For an existing mirror caller that invokes this repository’s `scripts/stage-annotations.mjs`, set `LIBRETEXTS_SOCIAL_ANNOTATION_ROOT` to the reviewed annotation checkout. The compatibility entry delegates to that checkout’s canonical publisher with the original arguments. Pin that checkout before publishing; absent configuration fails with a setup message rather than silently using stale UI assets.

Prefer running `node scripts/stage-annotations.mjs --stage ... --catalog ... --sha256 ... --output ...` directly from the annotation repository. It emits the same seven browser paths and exact public page-context stamp outside main. The browser loads the emitted local modules, not GitHub or a sibling source checkout. No runtime data/schema/API migration is part of this move.

Listen highlight suppression while composing and `tests/e2e/annotations-listen.spec.js` remain Reader-owned integration checks. Pure annotation unit/publisher and browser tests moved to the annotation repo. Preserve the host’s reading/navigation/audio/translation behavior and independently verify its production integration; do not reintroduce a divergent annotation UI copy here.
