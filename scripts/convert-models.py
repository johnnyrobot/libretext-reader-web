#!/usr/bin/env python3
"""Convert every Opus-MT checkpoint listed in pipeline/languages.py to CTranslate2
int8, and record each one's licence and revision.

Licences vary per checkpoint -- most are apache-2.0, but several are cc-by-4.0,
which requires attribution. Known so far (do not treat this list as exhaustive --
it is exactly what has been converted and checked; see licence_and_revision()
below, which raises rather than lets an unchecked checkpoint ship unattributed):
opus-mt-en-de, opus-mt-ru-en, and opus-mt-tc-big-en-es (the Spanish FORWARD
checkpoint -- found wrong here during Task 14, where this comment previously
named only the first two and undercounted). Generating the attribution file here
means the shipped credits cannot drift from what was actually used.
"""

import argparse
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pipeline.languages import TARGETS  # noqa: E402
from pipeline.opus import DEFAULT_MODEL_ROOT, ct2_dir  # noqa: E402

# The two files a completed CTranslate2 conversion always writes: model.bin (the
# converted weights) and config.json (the runtime config CTranslate2 needs to load
# them). Both must be present for the artifact to be usable.
_MARKER_FILES = ("model.bin", "config.json")


def checkpoints(codes: set[str] | None = None) -> dict[str, set[str]]:
    """Checkpoint name -> the language codes that use it. Group models are shared,
    so this deduplicates ~58 references down to ~50 conversions.

    `codes`, when given, restricts this to just those languages (see --langs on
    main()) -- used to stage a single language's checkpoints without converting
    every one of the ~50 shipped languages."""
    used: dict[str, set[str]] = {}
    for code, lang in TARGETS.items():
        if codes is not None and code not in codes:
            continue
        used.setdefault(lang.forward, set()).add(f"{code}:forward")
        used.setdefault(lang.reverse, set()).add(f"{code}:reverse")
    return used


def _is_converted(target: Path) -> bool:
    """True only if `target` holds a FINISHED CTranslate2 model, not merely a
    directory that exists.

    ct2-transformers-converter writes its output directory incrementally. A kill,
    an OOM, or a full disk part-way through this ~50-checkpoint unattended run
    leaves a directory that exists but holds an incomplete model. Checking
    existence alone would accept that directory as done forever -- every future
    run would skip it permanently and ship a broken model with no error anywhere
    downstream. Requiring both marker files catches that: a real conversion always
    writes both.
    """
    return all((target / name).exists() for name in _MARKER_FILES)


# I4 (final-review): recording a licence string is not the same as CHECKING
# it. This project chose Opus-MT over NLLB specifically on licence grounds --
# NLLB's output is cc-by-nc-4.0, incompatible with an MIT product (see
# pipeline/opus.py and memory `translation-model-licence-constraint`) -- so a
# checkpoint retagged cc-by-nc-4.0, or anything else non-permissive, must stop
# the run, not merely be written to the attribution file next to the ones that
# are fine. apache-2.0 and cc-by-4.0 are the two licences this module's own
# docstring already names as actually present among these ~50 checkpoints;
# mit is included as a third unsurprising permissive licence. No
# translation-attribution.json exists yet to check against a wider observed
# set (no real checkpoint has been converted for this yet), so this stays
# conservative rather than guessing at others -- an unexpected-but-permissive
# licence should raise and be added here by a human, not be assumed safe.
ACCEPTABLE_LICENCES = {"apache-2.0", "cc-by-4.0", "mit"}


def licence_and_revision(name: str) -> tuple[str, str]:
    """Fetch a checkpoint's licence and revision hash in one Hub call.

    Raises rather than silently defaulting to "unknown": two of these ~50
    checkpoints (opus-mt-en-de, opus-mt-ru-en) are cc-by-4.0, which REQUIRES
    attribution, and this project chose Opus-MT over NLLB on licence grounds in
    the first place (see pipeline/opus.py). A renamed or missing `license:` tag
    must stop the run loudly, not silently ship unattributed CC-BY content. The
    run is resumable and already-converted models stay on disk, so aborting here
    costs one restart, never re-done work.

    Also raises when the tag IS present but names a licence outside
    ACCEPTABLE_LICENCES (I4, final-review): a tag lookup succeeding is not the
    same as the result being one this project can ship. Without this check, a
    checkpoint retagged cc-by-nc-4.0 would convert, record its licence
    accurately, and ship its output inside an MIT product with no signal
    anywhere that the choice had changed underneath the project.
    """
    from huggingface_hub import model_info

    info = model_info(name)
    licence = next(
        (t.split(":", 1)[1] for t in info.tags if t.startswith("license:")), None
    )
    if licence is None:
        raise RuntimeError(
            f"no license: tag found on the Hub for checkpoint {name!r}; refusing "
            'to write "unknown" into the attribution file -- fix the tag lookup '
            "or the checkpoint before re-running"
        )
    if licence not in ACCEPTABLE_LICENCES:
        raise RuntimeError(
            f"checkpoint {name!r} is licensed {licence!r}, which is not in "
            f"ACCEPTABLE_LICENCES ({sorted(ACCEPTABLE_LICENCES)}) -- this "
            "project's model choice was made on licence grounds; a human needs "
            "to decide whether this checkpoint's output may ship inside an MIT "
            "product and add it to ACCEPTABLE_LICENCES before converting it"
        )
    return licence, info.sha


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=DEFAULT_MODEL_ROOT)
    parser.add_argument("--attribution", type=Path,
                        default=Path(".stage/_assets/tts/translation-attribution.json"))
    parser.add_argument("--langs", default=None,
                        help="comma-separated ISO 639-1 codes to convert (e.g. "
                             "es or es,fr); omit to convert every shipped language")
    parser.add_argument("--models", default=None,
                        help="comma-separated checkpoint names to convert exactly "
                             "(e.g. Helsinki-NLP/opus-mt-en-hu); for screening a "
                             "checkpoint pipeline/languages.py does NOT point at, "
                             "such as the small export the browser ships when the "
                             "gate runs tc-big. Mutually exclusive with --langs.")
    args = parser.parse_args()

    if args.langs and args.models:
        parser.error("--models names checkpoints directly and --langs resolves them "
                     "from pipeline/languages.py; pass one or the other, not both")

    codes = None
    if args.langs:
        codes = {c.strip() for c in args.langs.split(",") if c.strip()}
        unknown = sorted(codes - set(TARGETS))
        if unknown:
            parser.error(f"not shipped languages: {', '.join(unknown)}")

    # A partial (--langs) run must not blow away attribution already recorded for
    # checkpoints outside this run's subset -- merge onto whatever is already on
    # disk rather than overwriting it.
    existing = {}
    if args.attribution.exists():
        existing = json.loads(args.attribution.read_text())

    # --models names checkpoints the registry may not mention at all, so its
    # used_by is looked up rather than assumed. Recording a screened checkpoint as
    # if some language shipped from it would make the attribution file lie about
    # what the product actually uses.
    if args.models:
        registered = checkpoints()
        work = {
            name: registered.get(name, {"(not registered in pipeline/languages.py)"})
            for name in (n.strip() for n in args.models.split(",")) if name
        }
    else:
        work = checkpoints(codes)

    attribution = {}
    for name, users in sorted(work.items()):
        target = ct2_dir(name, args.root)
        if _is_converted(target):
            print(f"  already converted: {target}")
        else:
            print(f"==> converting {name} -> {target}")
            subprocess.run([
                "ct2-transformers-converter", "--model", name,
                "--quantization", "int8", "--output_dir", str(target),
                # A directory left behind by a killed/OOM'd run is non-empty but
                # incomplete (see _is_converted); --force lets the converter
                # overwrite it instead of refusing to touch an existing directory.
                "--force",
            ], check=True)
        licence, revision = licence_and_revision(name)
        attribution[name] = {
            "licence": licence,
            "revision": revision,
            "used_by": sorted(users),
        }

    merged = {**existing, **attribution}
    args.attribution.parent.mkdir(parents=True, exist_ok=True)
    args.attribution.write_text(json.dumps(merged, indent=1, sort_keys=True))
    print(f"\nwrote {args.attribution} ({len(attribution)} checkpoints converted this run, "
          f"{len(merged)} total on record)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
