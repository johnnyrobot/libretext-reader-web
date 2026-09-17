#!/usr/bin/env python3
"""The oracle diff itself (build plan step 9): what does the browser change?

    scripts/oracle-fetch.sh
    node scripts/oracle-js.mjs
    .venv/bin/python scripts/oracle_reference.py
    node scripts/oracle-browser.mjs
    .venv/bin/python scripts/oracle-diff.py > docs/.../report.md

Four things differ at once between what the browser produces and what
library.libretexts.dev serves today, and a single browser-vs-deployed diff
attributes all of them to whichever one the reader happens to think of first. So
this compares a CHAIN, where each link changes exactly one thing:

    protect.mjs   vs protect.py        masking                (model-free)
    JS tokenizer  vs Python tokenizer  tokenizer implementation (model-free)
    browser       vs python-small      runtime + quantisation   (same checkpoint)
    python-small  vs python-tcbig      the checkpoint itself
    python-tcbig  vs deployed          the post-passes the browser does not run
    browser       vs deployed          all four at once -- the headline

The last link is also the harness's own honesty check: replaying the deployed
post-passes over python-tcbig should reproduce the deployed track almost exactly.
If it does not, the chain above is measuring something other than what it claims,
and every number in the report is suspect.
"""

import json
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pipeline.lang_normalize import NORMALIZERS  # noqa: E402
from pipeline.normalize import fold_unrepresentable  # noqa: E402
from pipeline.protect import PlaceholderError, restore  # noqa: E402
from pipeline.qa import sentence_score  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
CORPUS = ROOT / "bench" / "oracle"


def load(name):
    return json.loads((CORPUS / name).read_text())


def pages():
    return [line for line in (ROOT / "scripts/oracle-pages.txt").read_text().split("\n") if line]


def corpus():
    """key -> {english, deployed}. `deployed` is None where the track has no entry."""
    out = {}
    for page in pages():
        manifest = json.loads((CORPUS / page / "speech.json").read_text())
        track = json.loads((CORPUS / page / "speech.es.json").read_text())["text"]
        for block in manifest["blocks"]:
            for sentence in block["sentences"]:
                out[f"{page}\t{sentence['id']}"] = {
                    "english": sentence.get("display") or sentence["speech"],
                    "deployed": track.get(sentence["id"]),
                }
    return out


def browser():
    rows = {}
    for line in (CORPUS / "browser.jsonl").read_text().split("\n"):
        if not line:
            continue
        row = json.loads(line)
        rows[f"{row['page']}\t{row['id']}"] = row["spanish"]
    return rows


def deployed_equivalent(raw, masked):
    """Replay the deployed pipeline's post-passes over the tc-big model output.

    Order matters and is not a style choice: the normaliser runs on the MASKED
    line and restore() comes after, because after restore the sentence holds real
    URLs and `[[latex:...]]` payloads whose digits the Spanish number passes would
    happily spell out. pipeline/translate.translate_sentences does exactly this;
    reproducing it here is what lets the harness be checked against reality.
    """
    normalize = NORMALIZERS["es"]
    out = {}
    for key, line in raw.items():
        try:
            out[key] = fold_unrepresentable(restore(normalize(line), masked[key][1]))
        except PlaceholderError:
            continue           # dropped, exactly as the pipeline drops it
    return out


def compare(label, left, right, keys):
    """Exact-match rate plus a graded similarity, because "differs" alone is not
    a finding: a comma and a different sentence both count as different."""
    both = [k for k in keys if left.get(k) is not None and right.get(k) is not None]
    same = [k for k in both if left[k] == right[k]]
    scores = [sentence_score(left[k], right[k]) for k in both]
    return {
        "label": label,
        "compared": len(both),
        "identical": len(same),
        "differ": len(both) - len(same),
        "median_similarity": round(statistics.median(scores), 3) if scores else None,
        "mean_similarity": round(statistics.mean(scores), 3) if scores else None,
        "examples": [k for k in both if left[k] != right[k]][:400],
    }


def row(result, total=None):
    pct = 100 * result["differ"] / result["compared"] if result["compared"] else 0
    denom = f"/{result['compared']}"
    return (f"| {result['label']} | {result['compared']:,} | {result['differ']:,}{denom.replace('/', ' of ')}"
            f" ({pct:.1f}%) | {result['median_similarity']} | {result['mean_similarity']} |")


def main() -> None:
    data = corpus()
    b = browser()
    small = load("python-small.json")
    tcbig = load("python-tcbig.json")
    tcbig_raw = load("python-tcbig-raw.json")
    py_mask, js_mask = load("py-mask.json"), load("js-mask.json")
    py_tok, js_tok = load("py-tokens.json"), load("js-tokens.json")
    refs = set(load("refs.json"))

    all_keys = list(data)
    attempted = [k for k in all_keys if k not in refs]
    delivered = [k for k in attempted if data[k]["deployed"] is not None]
    missing = [k for k in attempted if data[k]["deployed"] is None]

    replay = deployed_equivalent(tcbig_raw, py_mask)
    deployed = {k: data[k]["deployed"] for k in all_keys}

    mask_text = [k for k in all_keys if py_mask[k][0] != js_mask[k][0]]
    mask_spans = [k for k in all_keys if py_mask[k][1] != js_mask[k][1]]
    tok_diff = [k for k in all_keys if py_tok[k] != js_tok[k]]

    print(f"corpus: {len(all_keys):,} sentences, {len(pages())} pages")
    print(f"  reference-held by the pipeline : {len(refs):,}")
    print(f"  attempted                      : {len(attempted):,}")
    print(f"  delivered in the track         : {len(delivered):,}")
    print(f"  attempted but absent           : {len(missing):,}")
    print(f"     of those, carrying a masked span: "
          f"{sum(1 for k in missing if py_mask[k][1])}")
    print(f"  browser translated             : {len(b):,}")
    print()
    print(f"masking parity   : text differs {len(mask_text)}, spans differ {len(mask_spans)}"
          f" (of {len(all_keys):,})")
    print(f"tokenizer parity : {len(tok_diff):,} of {len(all_keys):,} "
          f"({100*len(tok_diff)/len(all_keys):.1f}%) differ; "
          f"{sum(1 for k in tok_diff if k not in refs):,} of {len(attempted):,} "
          f"({100*sum(1 for k in tok_diff if k not in refs)/len(attempted):.1f}%) on the "
          f"sentences that are actually translated")
    print()

    results = [
        compare("harness check: replayed tc-big vs deployed", replay, deployed, delivered),
        compare("browser vs python, SAME checkpoint", b, small, attempted),
        compare("python small vs python tc-big (model gap)", small, tcbig, attempted),
        compare("python tc-big vs deployed (post-passes)", tcbig, deployed, delivered),
        compare("browser vs deployed (headline)", b, deployed, delivered),
    ]
    print("| comparison | compared | differ | median sim | mean sim |")
    print("|---|---|---|---|---|")
    for result in results:
        print(row(result))
    print()

    # What the tokenizer discrepancy actually costs, isolated: among sentences the
    # two tokenizers agree on, how often does the browser still differ from Python
    # on the same checkpoint? That residue is runtime and quantisation.
    agree = [k for k in attempted if py_tok[k] == js_tok[k]]
    disagree = [k for k in attempted if py_tok[k] != js_tok[k]]
    same_tok = compare("same checkpoint, tokenizers AGREE", b, small, agree)
    diff_tok = compare("same checkpoint, tokenizers DIFFER", b, small, disagree)
    print(row(same_tok))
    print(row(diff_tok))
    print()

    # Step 10's gate, applied to what the browser actually produced.
    sys.path.insert(0, str(ROOT))
    print("step 10 gate over the browser's own output:")
    print(json.dumps(gate_stats(data, b, attempted), indent=2))

    (CORPUS / "diff-examples.json").write_text(json.dumps(
        {r["label"]: [{"key": k, "english": data[k]["english"], "browser": b.get(k),
                       "python_small": small.get(k), "python_tcbig": tcbig.get(k),
                       "deployed": deployed.get(k)} for k in r["examples"][:60]]
         for r in results}, ensure_ascii=False, indent=2))
    print("\nwrote bench/oracle/diff-examples.json")


def gate_stats(data, b, attempted):
    """How many of the browser's own sentences the salvaged QA gate would drop.

    Run over the RAW browser output on purpose: the run that produced it predates
    the gate, so this measures what the gate finds rather than what survived it.
    """
    import subprocess
    keys = [k for k in attempted if b.get(k) is not None]
    payload = json.dumps([[data[k]["english"], b[k]] for k in keys])
    script = """
      const { isDegenerate, isImplausiblyShort } = await import('./src/qa.mjs');
      let data = ''; for await (const c of process.stdin) data += c;
      const rows = JSON.parse(data);
      let degenerate = 0, short = 0;
      for (const [en, es] of rows) {
        if (isDegenerate(es)) degenerate += 1;
        else if (isImplausiblyShort(en, es)) short += 1;
      }
      console.log(JSON.stringify({ checked: rows.length, degenerate, short }));
    """
    out = subprocess.run(["node", "--input-type=module", "-e", script],
                         input=payload, capture_output=True, text=True, cwd=ROOT)
    return json.loads(out.stdout or '{"error": "node failed"}')


if __name__ == "__main__":
    main()
