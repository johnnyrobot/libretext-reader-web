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

```sh
python3 bench/phonon/pick_sentences.py                 # out/sentences.json (21 items)

# Supertonic baseline (shipped engine)
python3 scripts/serve-local.py --root bench/phonon/out/stage --port 8788 &
node bench/phonon/render_supertonic.mjs --voice M1 [--run 2]

# Path A: Phonon 31m-en in the browser
python3 bench/phonon/serve.py --port 8789 &
node bench/phonon/render_path_a.mjs --device wasm --dtype fp32 [--run 2]
node bench/phonon/render_path_a.mjs --device webgpu --dtype q4f16

# Paths B and C: Phonon through Ollama
python3 bench/phonon/render_ollama.py --tag en [--field display]

# Score, summarise, estimate storage, build the listening set
bench/phonon/.venv/bin/python bench/phonon/score.py [engine ...]
python3 bench/phonon/summary.py                        # out/summary.json + table
python3 bench/phonon/storage.py --engine phonon-en     # out/storage.json
python3 bench/phonon/listening_set.py                  # listening/ + listening-key.csv
```

Each render writes `out/<engine>/<id>.wav` and `out/<engine>/timings.json`;
`--run N` writes a repeat to `out/<engine>-rN/`. The Mac these ran on was
shared, so each run records its load average; repeat timing runs and read the
ranges in `summary.json`.
