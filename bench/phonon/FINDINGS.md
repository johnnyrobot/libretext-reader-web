# LT-213: Gradium Phonon as Listen mode's voice

THROWAWAY SPIKE. Nothing here changes `src/` or `pipeline/`; the scripts beside
this file exist to produce the numbers below and can be deleted once a decision
is made. Sources for every licence and model fact are in
[`notes/sources.md`](notes/sources.md).

## Recommendation

**Partly.** Replace Supertonic for **English only**, with the Apache-licensed
`phonon-31m-en` run **in the reader's browser (path A)** on the Transformers.js
and ONNX Runtime Web 1.26 the reader already ships for translation. Here it was
about 5x faster than Supertonic, starts speaking in about 30 ms instead of
about 14 s, downloads 41–161 MB instead of about 389 MB, and has the same word
error rate; naturalness (UTMOS) is a hair lower. The nine translation tracks
stay on Supertonic: Phonon has no voice for six of them, and the models that
cover fr/de/es are CC BY-NC, which is the Chief's call.

Path B (pre-render through Ollama at build time) works and is the fastest to
make, but costs about 310 MB of Opus per book per language and a rebuild on
every text change. Path C (the reader's own Ollama) is feasible only as an
opt-in for people who already run Ollama.

## What was measured

21 Speech Text items (`out/sentences.json`, picked by `pick_sentences.py`):
4 prose, 4 numbers, 3 dates, 3 citations (deployed social_psychology tracks),
4 chemistry and 3 spoken-math items (the pipeline's own audits). Each engine
read the same Speech Text. Scores:

- **WER**: Whisper large-v3-turbo (mlx) transcript against the Speech Text,
  both through Whisper's English normaliser.
- **CER**: characters with spaces removed and 0 read as o, because the
  normaliser mangles chemistry ("N O two" becomes "n 02").
- **UTMOS**: UTMOS22 strong, 1–5 predicted naturalness.
- **RTF**: synth seconds / audio seconds, warm items only (item one is cold).
- **TTFA**: seconds from request to first audio.
- **Peak memory**: peak RSS of the browser's (or Ollama's) whole process tree.

Machine: M2 Max, Chrome 156 headless, Ollama 0.40.13. The Mac was shared (load
average 3–11 during runs; each run records `load_avg_1m`). Phonon samples at
temperature 0.3, so the key engines were run three times; ranges are shown.

## Comparison

Median (range over runs). Memory is the increase over an idle browser
(~860 MB) or idle Ollama (~127 MB).

| Engine | Runs | WER | CER | UTMOS | Warm RTF | Warm TTFA | Cold TTFA | Download | Memory over idle | Languages | Licence |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Supertonic M1 (shipped) | 3 | 0.079 (0.076–0.083) | 0.010 | 4.47 (4.41–4.50) | 1.20 (1.06–1.21) | 13.8 s | 13.8 s | 389 MB + 88 MB ORT | 2214 MB | 10 tracks today (Supertonic 3: 31) | MIT code, OpenRAIL-M weights |
| **A: 31m-en, wasm fp32** | 3 | 0.072 (0.070–0.081) | 0.012 | 4.44 (4.40–4.45) | 0.21 (0.20–0.26) | 0.027 s | 1.2 s | 161 MB | 1548 MB | en | Apache 2.0 |
| A: 31m-en, WebGPU fp32 | 1 | 0.072 | 0.009 | 4.43 | 0.22 | 0.028 s | 2.3 s | 161 MB | 1456 MB | en | Apache 2.0 |
| A: 31m-en, WebGPU q4 | 3 | 0.070 (0.068–0.070) | 0.014 | 4.31 | 0.28 (0.21–0.47) | 0.033 s | 1.4 s | 67 MB | 1038 MB | en | Apache 2.0 |
| A: 31m-en, WebGPU q4f16 | 3 | 0.081 (0.070–0.290) | 0.026 | 4.26 | 0.20 (0.13–0.49) | 0.025 s | 1.8 s | 41 MB | 903 MB | en | Apache 2.0 |
| A: 31m-en, wasm q4 | 1 | 0.139 | 0.067 | 4.32 | 0.19 | 0.033 s | 0.7 s | 67 MB | 1218 MB | en | Apache 2.0 |
| B/C: Ollama `phonon:en` | 1 | 0.086 | 0.013 | 4.42 | 0.014 | 0.017 s | 0.13 s | 103 MB | 129 MB | en | Apache 2.0 |
| B/C: Ollama `phonon:40m-en` | 1 | 0.107 | 0.031 | 4.42 | 0.017 | 0.019 s | 0.34 s | 131 MB | 173 MB | en | CC BY-NC 4.0 |
| B/C: Ollama `phonon:multilingual` | 1 | 0.095 | 0.015 | 4.39 | 0.018 | 0.019 s | 0.25 s | 122 MB | 161 MB | en fr de es pt | CC BY-NC 4.0 |

Path A download sizes add 0.3 MB tokenizer and 0.26 MB per voice; its
runtime is the `/_assets/tts/ort-mt/` ORT 1.26 build already deployed, so it
adds no runtime download. Path A `load_s` was 0.65–2.6 s from a local server;
real network time comes on top for all browser rows.

WER/CER by category (one representative run):

| Engine | prose | numbers | dates | citations | chemistry | math |
|---|---|---|---|---|---|---|
| Supertonic M1 | 0.022 / 0.002 | 0.009 / 0.002 | 0 / 0 | 0.097 / 0.032 | 0.298 / 0.054 | 0 / 0 |
| A wasm fp32 | 0.022 / 0.002 | 0.009 / 0.002 | 0 / 0 | 0.083 / 0.034 | 0.289 / 0.158 | 0.040 / 0.042 |
| A WebGPU q4f16 | 0.022 / 0.002 | 0.009 / 0.002 | 0 / 0 | 0.069 / 0.029 | 1.279 / 0.839 | 0.120 / 0.116 |
| Ollama `phonon:en` | 0.022 / 0.002 | 0.036 / 0.023 | 0 / 0 | 0.056 / 0.024 | 0.269 / 0.013 | 0.200 / 0.032 |

Chemistry WER is high for every engine because Whisper writes formulas its own
way; CER is the better guide there.

## Findings

1. **Phonon in the browser is much faster than Supertonic here, and streams.**
   Path A follows the model card's loop (flow LM, then the Mimi decoder, at
   most 50 tokens a call), so the first audio frame arrives in ~30 ms.
   Supertonic's worker returns whole sentences, so its TTFA is the whole
   sentence's synth time.
2. **Supertonic is slower than its README says: RTF 1.06–1.21 measured, 0.41
   claimed.** It stayed above 1.1 at low load. The bundled ORT 1.17.3 worker
   has no WebGPU backend ("[webgpu] backend not found"), and threads gave only
   ~10% over one thread. Ruled out: a stale stage build (a fresh build is
   byte-identical) and missing cross-origin isolation (isolated, 12 cores,
   SharedArrayBuffer present). This is a possible regression in the shipped
   engine and is outside LT-213; it deserves its own ticket.
3. **Every Phonon variant garbles s18**, the long repeated equilibrium-constant
   expression. WebGPU q4f16 once looped on it (120 errors on 57 words), which
   is the 0.290 WER outlier above. q4f16 is not safe to ship without a guard
   (stop when audio runs far past the expected length).
4. **Double normalisation.** Ollama's Phonon runtime normalises text itself.
   It reads "1024" as "ten twenty-four" (year style), which breaks spoken math
   where Speech Text keeps digits (s21: math WER 0.20 against 0.0 for
   Supertonic). It turned "U.S. Senate" into "United Sessonet". Path A has no
   runtime normaliser and read 1024 correctly. Feeding Display Text instead of
   Speech Text was slightly worse (WER 0.093 vs 0.086), so keep feeding Speech
   Text; for Ollama, Speech Text would need to spell out every number.
5. **The 40m English model is not better than 31m.** `40m-en` scored worse on
   WER (0.107) and once repeated a phrase ("those are men"), and it is
   CC BY-NC. Nothing argues for it.
6. **Quantisation.** q4 roughly halves memory and cuts the download to 67 MB
   at a small UTMOS cost (4.31 vs 4.44) and no WER cost on WebGPU; wasm q4 was
   worse (0.139). fp32 on wasm is the safe default; q4 on WebGPU is the small
   option.

## Languages and voices

Listen mode has English plus nine translation tracks: cs, da, de, es, fr, hu,
it, nl, sv. Phonon covers en, fr, de, es, pt.

| Track | Phonon model | Licence | Outcome |
|---|---|---|---|
| en | 31m-en | Apache 2.0 | switch |
| fr, de, es | 40m-fr/de/es or 40m multilingual | CC BY-NC 4.0, gated | only if the Chief accepts NC; otherwise keep Supertonic |
| cs, da, hu, it, nl, sv | none | — | lose a voice; keep Supertonic |

Under an Apache-only rule every non-English track keeps Supertonic, so the
reader would ship two TTS engines. Voices: `phonon-voices` has 102 voices
(en 37, fr 15, de 13, es 25, pt 12), Apache 2.0, against the two
Supertonic voices the reader ships (M1, F1).

## Licences

- `phonon-31m-en`: Apache 2.0. Fine for LibreTexts.
- All 40m models (en, fr, de, es, pt, multilingual): CC BY-NC 4.0, gated on
  Hugging Face, "for commercial use, talk to sales". Whether LibreTexts'
  use counts as non-commercial, and whether NC attaches to the generated
  audio, are **not confirmed**: the model cards say nothing explicit about
  outputs. Path B would publish generated audio as files, so it carries the
  most exposure if NC does reach outputs.
- Supertonic: MIT code, OpenRAIL-M weights; its repository is archived.
- The `phonon-tts` npm package (0.6.0, MIT/Apache) brings its own runtime,
  normaliser and WebGPU path; it was not tested here, since path A reuses
  the runtime already shipped. Transformers.js PR #1811 (native Phonon
  support) is still open.
- No ONNX export of any 40m model exists, so path A is English-only today
  regardless of licence.

## The three paths

**A, in the browser.** Recommended for English. A module worker imports
`transformers.min.js` (which bundles ORT 1.26), loads
`onnx-community/phonon-31m-en` and streams frames. Work to ship it: a real
worker in `src/` behind the existing engine interface, a length guard for
loops, caching of model files, and Phonon-aware Speech Text for currency and
symbols. `path-a/worker.mjs` is the spike's version of that worker.

**B, pre-rendered through Ollama.** Measured on social_psychology (75 pages,
14,418 sentences, 1.67 M characters; Phonon speaks 16.2 characters a second,
so 28.7 h of audio; Supertonic is slower at 13.8, 33.6 h):

| Codec | Page median | Largest page | Book |
|---|---|---|---|
| Opus 24 kbit/s | 3.2 MB | 16.7 MB | 310 MB |
| Opus 32 kbit/s | 4.2 MB | 22.2 MB | 411 MB |
| AAC 48 kbit/s | 6.7 MB | 35.4 MB | 657 MB |
| MP3 64 kbit/s | 8.6 MB | 45.0 MB | 834 MB |

Median page is 17.6 min of audio, the largest 92.9 min. A full book render is
about 24 minutes on this Mac (RTF 0.014), and each translated track adds about
as much again (only fr/de/es could have one, under CC BY-NC). Every Speech
Text change means re-rendering the changed sentences and redeploying audio.
Opus in Safari was not checked.

**C, the reader's own Ollama.** Works: Ollama (0.40.9 or later; 0.40.13 here) on Apple Silicon serves
`/v1/audio/speech` with streaming PCM, TTFA ~17 ms warm, ~130 MB over idle.
It needs the reader to install Ollama and pull a model, and the page to reach
`localhost:11434` (CORS / Private Network Access). An opt-in for enthusiasts,
not a default.

## Listening test

A blind A/B set of all 21 items, Supertonic M1 against Ollama `phonon:en`,
loudness-matched (-20 LUFS, 24 kHz), with A/B assignment randomised per item.
Made by `listening_set.py`; both are git-ignored and not committed:

- folder: `bench/phonon/listening/` (`items.txt` lists the texts)
- key: `bench/phonon/listening-key.csv`

The listening test itself has not been done.

## Not verified

- Download time over a real network, and a real Listen-mode integration.
- Any browser other than Chrome 156, and any device other than this M2 Max
  (no phones, no low-end laptops, no Windows).
- Whether the Supertonic RTF gap is a regression or this machine.
- The human listening test.
- Commercial terms for the 40m models, and whether CC BY-NC reaches audio.
- Opus playback in Safari for path B.
- Path C on Windows or Linux, and from a deployed origin.

## Note on the prototype skill

The prototype skill says to keep prototypes off `main`. These scripts are
merged anyway, at the Chief's request, so the numbers stay reproducible; they
are marked THROWAWAY SPIKE and live only under `bench/phonon/`.
