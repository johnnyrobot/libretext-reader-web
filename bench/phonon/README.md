# bench/phonon: LT-213 Phonon spike

THROWAWAY SPIKE. Scripts that measure Gradium Phonon against Supertonic for
Listen mode. The results and the recommendation are in
[`FINDINGS.md`](FINDINGS.md); licence and model sources are in
[`notes/sources.md`](notes/sources.md). Nothing here is used by `src/` or
`pipeline/`.

Run everything from the repo root. Audio, the stage clone, the model files and
the listening set are git-ignored; only the JSON results in `out/` are kept.

## Setup

- Node deps (`npm ci`) for Playwright and `@huggingface/transformers`; Chrome
  installed (the scripts use `--channel chrome`).
- Ollama 0.40.9 or later with the Phonon tags pulled (`ollama pull phonon:en`,
  and `40m-en`, `multilingual` if wanted).
- ffmpeg on the PATH.
- A Python venv for scoring, Apple Silicon only (mlx):

  ```sh
  python3 -m venv bench/phonon/.venv
  bench/phonon/.venv/bin/pip install mlx-whisper jiwer whisper-normalizer soundfile numpy torch torchaudio librosa certifi
  export SSL_CERT_FILE=$(bench/phonon/.venv/bin/python -m certifi)
  ```

- Path A's model: the files of `onnx-community/phonon-31m-en-ONNX` on Hugging
  Face (config, tokenizer, `onnx/`, `voices/`) in
  `bench/assets/phonon/onnx-community/`.
- The Supertonic baseline needs a local stage: copy `.stage` to
  `bench/phonon/out/stage` and lay a fresh `npx vite build` over it. Do not use
  `scripts/stage-local.sh` for this; it fetches from a live server.

## Steps

`pick_sentences.py` also reads the pipeline's chemistry and math audit pages,
`demo-out/chem-audit/index.html` and `demo-out/math-audit/index.html`. They are
not tracked; produce them first with `scripts/math-audit.mjs` (`--out` each
folder) against a local stage, or the
step stops with `FileNotFoundError`. Optional flags are shown in comments.

```sh
python3 bench/phonon/pick_sentences.py                 # out/sentences.json (21 items)

# Supertonic baseline (shipped engine)
python3 scripts/serve-local.py --root bench/phonon/out/stage --port 8788 &
node bench/phonon/render_supertonic.mjs --voice M1   # repeat: add --run 2

# Path A: Phonon 31m-en in the browser
python3 bench/phonon/serve.py --port 8789 &
node bench/phonon/render_path_a.mjs --device wasm --dtype fp32   # repeat: add --run 2
node bench/phonon/render_path_a.mjs --device webgpu --dtype q4f16

# Paths B and C: Phonon through Ollama
python3 bench/phonon/render_ollama.py --tag en   # Display Text: add --field display

# Score, summarise, estimate storage, build the listening set
bench/phonon/.venv/bin/python bench/phonon/score.py   # or name engines to score
python3 bench/phonon/summary.py                        # out/summary.json + table
python3 bench/phonon/storage.py --engine phonon-en     # out/storage.json
python3 bench/phonon/listening_set.py                  # listening/ + listening-key.csv
```

### Throughput and the corpus estimate

Run these on a quiet machine: the Ollama timings read the whole GPU, so
another app using it shows up in the numbers.

```sh
# Ollama, 1-16 requests at once; one server, then several (extra servers on
# other ports share the models folder: OLLAMA_HOST=127.0.0.1:11435 ollama serve)
python3 bench/phonon/concurrency.py --model phonon:en --ports 11434 --label quiet
python3 bench/phonon/concurrency.py --model phonon:en --ports 11434,11435,11436 --label 3srv

# Gradium's runtime on Linux CPU, in an arm64 container. Weights folders go
# under models/ (git-ignored); the 40m is gated on Hugging Face.
podman run --rm -v "$PWD":/repo -v "$PWD/models":/models:ro python:3.12-slim sh -c \
  "pip install -q ptts==0.6.0 && python /repo/bench/phonon/ptts_cpu.py \
   --model /models/phonon-31m-en --threads 4 --quant q8_0 --label 31m-q8"
# many one-thread processes at once: same command with --threads 1, started
# K times in parallel, labels par-31m-q8-k<K>-p<i>

python3 bench/phonon/throughput.py     # out/throughput.json + corpus estimate
```

Each render writes `out/<engine>/<id>.wav` and `out/<engine>/timings.json`;
`--run N` writes a repeat to `out/<engine>-rN/`. The Mac these ran on was
shared, so each run records its load average; repeat timing runs and read the
ranges in `summary.json`.
