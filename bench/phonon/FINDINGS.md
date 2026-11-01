# LT-213: Gradium Phonon as Listen mode's voice

THROWAWAY SPIKE. Nothing here changes `src/` or `pipeline/`; the scripts beside
this file exist to produce the numbers below and can be deleted once a decision
is made. Sources for every licence and model fact are in
[`notes/sources.md`](notes/sources.md).

## Recommendation

**Partly.** Replace Supertonic for **English only**, with the Apache-licensed
`phonon-31m-en` run **in the reader's browser (path A)** on the Transformers.js
and ONNX Runtime Web 1.26 the reader already ships for translation. Here it was
2.5–4x faster than Supertonic in back-to-back runs (4.4x on the medians),
produced its first audio frame in about 30 ms instead of 7–14 s (playing
frames as they arrive is not built yet), downloads 41–161 MB of model instead
of about 409 MB (plus a ~15–26 MB runtime for a listener who has not used
translation), and has a similar word error rate; naturalness (UTMOS) is a
hair lower, and it can derail on very long formulas. The nine translation
tracks stay on Supertonic: Phonon has no voice for six of them, and the models
that cover fr/de/es are CC BY-NC, which is the Chief's call.

Path B (pre-render through Ollama at build time) works and is the fastest to
make, but costs about 310 MB of Opus per book per language and a rebuild on
every text change. Path C (the reader's own Ollama) is feasible only as an
opt-in for people who already run Ollama.

## What was measured

21 Speech Text items (`out/sentences.json`, picked by `pick_sentences.py`):
4 prose, 4 numbers, 3 dates, 3 citations from the staged book
(social_psychology, its deployed speech.json), and 4 chemistry and 3 spoken-math
items from the pipeline's audit pages for two other books (chem_4b 5.4 and
math_elem_teachers 6.04, in `demo-out/`), because social_psychology has no
chemistry or math and only it is staged locally. Each engine read the same
Speech Text. Scores:

- **WER**: Whisper large-v3-turbo (mlx) transcript against the Speech Text,
  both through Whisper's English normaliser.
- **CER**: characters with spaces removed and 0 read as o, because the
  normaliser mangles chemistry ("N O two" becomes "n 02").
- **UTMOS**: UTMOS22 strong, 1–5 predicted naturalness.
- **RTF**: synth seconds / audio seconds, warm items only (item one is cold).
- **TTFA**: seconds from request to first audio: the first 80 ms frame for
  path A, the first 4,096 bytes (~85 ms) for Ollama, and the whole sentence
  for Supertonic, whose worker does not stream. Warm TTFA is the upper median
  of the 20 warm items.
- **Peak memory**: peak RSS of the browser's (or Ollama's) whole process tree.
  For Ollama this leaves out Metal buffers; `/api/ps` reports the loaded model
  at 114 MB (`en`), 216 MB (`40m-en`) and 133 MB (`multilingual`), all on the
  GPU, which may come on top. Summing RSS over Chrome's processes counts
  shared pages more than once, so compare browser rows with each other, not
  with Ollama.

Machine: M2 Max, Chrome 156 headless, Ollama 0.40.13. The Mac was shared
(another Chrome and a VM were busy throughout). Each run records `load_avg_1m`
at its end, but that includes the run's own eight threads, so it is a weak
guide. Phonon samples at temperature 0.3, so the key engines were run three to
five times; ranges are shown. To compare speed under the same conditions,
Supertonic, path A wasm fp32 and Supertonic again were run back to back (runs
r4, r4, r5).

## Comparison

Median (range over runs). Memory is the increase over an idle browser
(~860 MB) or idle Ollama (~127 MB).

| Engine | Runs | WER | CER | UTMOS | Warm RTF | Warm TTFA | Cold TTFA | Download | Memory over idle | Languages | Licence |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Supertonic M1 (shipped) | 5 | 0.083 (0.076–0.085) | 0.013 (0.009–0.017) | 4.47 (4.41–4.50) | 1.06 (0.68–1.21) | 11.3 s (7.3–14.0) | 13.4 s | 398 MB + 11 MB ORT wasm | 2201 MB | 10 tracks today (Supertonic 3: 31) | MIT code, OpenRAIL-M weights |
| **A: 31m-en, wasm fp32** | 4 | 0.076 (0.070–0.111) | 0.024 (0.009–0.049) | 4.42 (4.40–4.45) | 0.24 (0.20–0.27) | 0.029 s | 1.5 s | 161 MB | 1548 MB | en | Apache 2.0 |
| A: 31m-en, WebGPU fp32 | 1 | 0.072 | 0.009 | 4.43 | 0.22 | 0.028 s | 2.3 s | 161 MB | 1456 MB | en | Apache 2.0 |
| A: 31m-en, WebGPU q4 | 3 | 0.070 (0.068–0.070) | 0.014 (0.014–0.016) | 4.31 | 0.28 (0.21–0.47) | 0.033 s | 1.4 s | 67 MB | 1038 MB | en | Apache 2.0 |
| A: 31m-en, WebGPU q4f16 | 3 | 0.081 (0.070–0.290) | 0.026 (0.014–0.155) | 4.26 | 0.20 (0.13–0.49) | 0.025 s | 1.8 s | 41 MB | 903 MB | en | Apache 2.0 |
| A: 31m-en, wasm q4 | 1 | 0.139 | 0.067 | 4.32 | 0.19 | 0.033 s | 0.7 s | 67 MB | 1218 MB | en | Apache 2.0 |
| B/C: Ollama `phonon:en` | 1 | 0.086 | 0.013 | 4.42 | 0.014 | 0.017 s | 0.13 s | 103 MB | 129 MB | en | Apache 2.0 |
| B/C: Ollama `phonon:40m-en` | 1 | 0.107 | 0.031 | 4.42 | 0.017 | 0.019 s | 0.34 s | 131 MB | 173 MB | en | CC BY-NC 4.0 |
| B/C: Ollama `phonon:multilingual` | 1 | 0.095 | 0.015 | 4.39 | 0.018 | 0.019 s | 0.25 s | 122 MB | 161 MB | en fr de es pt | CC BY-NC 4.0 |

Download sizes are measured from the files: Supertonic's from the staged
`_assets/tts/onnx/` (398 MB, which is the README's ~380 MiB) plus the one ORT
1.17 threaded wasm it loads; path A's from `onnx-community/phonon-31m-en-ONNX`
(q4 is 26 MB flow LM plus the unquantised 41 MB decoder). Path A also loads a
0.3 MB tokenizer and 0.26 MB per voice; its
runtime is the `/_assets/tts/ort-mt/` ORT 1.26 build already deployed for
translation. A listener who has used translation has it cached; one who has
not downloads it too: about 0.4 MB of Transformers.js plus one ORT wasm of
14.6–26.1 MB (jspi, asyncify or jsep build). The bench loaded these from
`node_modules`, so they are not in its `load_s`. Path A `load_s` was 0.65–2.6 s from a local server;
real network time comes on top for all browser rows.

WER/CER by category, from each engine's median-WER run (Supertonic r4, wasm
fp32 r3, q4f16 r3; Ollama ran once):

| Engine | prose | numbers | dates | citations | chemistry | math |
|---|---|---|---|---|---|---|
| Supertonic M1 | 0.022 / 0.002 | 0.009 / 0.002 | 0 / 0 | 0.083 / 0.027 | 0.288 / 0.031 | 0.080 / 0.042 |
| A wasm fp32 | 0.022 / 0.002 | 0.009 / 0.002 | 0 / 0 | 0.083 / 0.024 | 0.250 / 0.013 | 0.040 / 0.032 |
| A WebGPU q4f16 | 0.022 / 0.002 | 0.009 / 0.002 | 0 / 0 | 0.097 / 0.039 | 0.279 / 0.098 | 0.040 / 0.032 |
| Ollama `phonon:en` | 0.022 / 0.002 | 0.036 / 0.023 | 0 / 0 | 0.056 / 0.024 | 0.269 / 0.013 | 0.200 / 0.032 |

Chemistry WER is high for every engine because Whisper writes formulas its own
way; CER is the better guide there.

## Findings

1. **Phonon in the browser is much faster than Supertonic here, and can stream.**
   Path A follows the model card's loop (flow LM, then the Mimi decoder, at
   most 50 tokens a call), so the first audio frame is ready in ~30 ms. The
   bench only times that frame; it plays nothing until the sentence is done,
   so ~30 ms is what streaming playback could reach, not a measured start.
   Supertonic's worker returns whole sentences, so its TTFA is the whole
   sentence's synth time. Back to back, Supertonic r4 ran at RTF 1.05, path A
   wasm fp32 r4 at 0.27 and Supertonic r5 at 0.68: path A was 2.5–4x faster in
   the same conditions, and 4.4x on the medians over all runs.
2. **Supertonic ran slower here than its README says: RTF 0.68–1.21 measured,
   0.41 claimed.** It varied with whatever else the shared Mac was doing, so
   this is not shown to be a regression. The bundled ORT 1.17.3 worker has no
   WebGPU backend ("[webgpu] backend not found"), and threads gave only ~10%
   over one thread. Ruled out: a stale stage build (a fresh build is
   byte-identical) and missing cross-origin isolation (isolated, 12 cores,
   SharedArrayBuffer present). Worth one timing on a quiet machine before
   anyone opens a ticket; it is outside LT-213.
3. **Phonon can derail on long formulas.** s18 is a 57-word run of repeated
   equilibrium-constant expressions. A clean reading of it scores about 8–17
   word errors with few character errors (Whisper writes the formulas its own
   way), which is what Supertonic and Ollama's 31m runs get. Path A wasm fp32
   drifted into nonsense on it in 2 of 4 runs (56 and 83 character errors;
   the second is that run's 0.111 WER), and so did wasm q4, WebGPU q4f16 in 2
   of 3 runs (one looped: 120 word errors, the 0.290 WER outlier) and 40m-en.
   WebGPU q4 read it cleanly in all 3 runs, and WebGPU fp32 in its one run. Shipping path A needs a
   guard (stop and retry, or fall back, when audio runs far past the length
   the text predicts) and probably a lower sampling temperature.
4. **Double normalisation.** Ollama's Phonon runtime normalises text itself.
   It reads "1024" as "ten twenty-four" (year style), which breaks spoken math
   where Speech Text keeps digits (s21, so Ollama's math WER is 0.20, against
   0–0.12 across Supertonic's runs and 0.04 for path A). It read "U.S. Senate" so that Whisper heard "United
   Sessonet". Path A has no runtime normaliser and read 1024 correctly.
   Feeding Display Text instead of Speech Text did not help (WER 0.093 vs
   0.086, each scored against the text it was given, so not strictly like for
   like), so keep feeding Speech Text; for Ollama, Speech Text would need to
   spell out every number.
5. **The 40m English model is not better than 31m.** `40m-en` scored worse on
   WER (0.107) and once repeated a phrase ("those are men"), and it is
   CC BY-NC. Nothing argues for it.
6. **Quantisation.** On WebGPU, q4 cuts memory by about 30% (1038 vs 1456 MB
   over idle) and the download to 67 MB, at a small UTMOS cost (4.31 vs 4.43)
   and no WER cost; wasm q4 was worse (0.139). fp32 on wasm is the safe default; q4 on WebGPU is the small
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
reader would ship two TTS engines.

What the CC BY-NC decision changes:

- **Apache only (31m-en):** English switches; nine tracks keep Supertonic;
  two engines in the reader. No licence question.
- **Accept CC BY-NC for fr/de/es:** three more tracks could switch, but only
  through Ollama (path B) today, since no 40m model has an ONNX export, and
  path B publishes the generated audio, which is where an NC term would bite
  if it reaches outputs. Six tracks still keep Supertonic.
- **Ask Gradium for terms:** the cards say "for commercial use, talk to
  sales"; a written answer on non-profit OER use and on generated audio would
  settle both open questions. Voices: `phonon-voices` has 102 voices
(en 37, fr 15, de 13, es 25, pt 12), Apache 2.0, against the two
Supertonic voices the reader ships (M1, F1).

## Licences

- `phonon-31m-en`: Apache 2.0. Fine for LibreTexts. `ollama show phonon:en`
  says 41.12M parameters because it counts the 31M flow LM plus the 10.3M
  Mimi decoder and one voice; its config and tokenizer are byte-identical to
  `gradium/phonon-31m-en`, so `phonon:en` is the 31M model and Apache
  (`notes/sources.md`, Q2).
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
`onnx-community/phonon-31m-en` and produces 80 ms frames that could be played
as they arrive (not built here). Work to ship it: a real
worker in `src/` behind the existing engine interface, a length guard for
loops, caching of model files, and Phonon-aware Speech Text for currency and
symbols. `path-a/worker.mjs` is the spike's version of that worker.

**B, pre-rendered through Ollama.** Measured on social_psychology (75 pages,
14,418 sentences, 1.67 M characters; Phonon speaks 16.2 characters a second,
so 28.7 h of audio; Supertonic, at 13.8 characters a second over the same
items, would be 33.6 h):

| Codec | Page median | Largest page | Book |
|---|---|---|---|
| Opus 24 kbit/s | 3.2 MB | 16.7 MB | 310 MB |
| Opus 32 kbit/s | 4.2 MB | 22.2 MB | 411 MB |
| AAC 48 kbit/s | 6.7 MB | 35.4 MB | 657 MB |
| MP3 64 kbit/s | 8.6 MB | 45.0 MB | 834 MB |

Speaking rate comes from all 21 bench items; on the 14 items drawn from the
book itself Phonon speaks a little faster (17.2 characters a second), so the
sizes above are about 6% high. Median page is 17.6 min of audio, the largest
92.9 min. A full book render is
about 24 minutes on this Mac (RTF 0.014, plus encoding), and each translated track adds about
as much again (only fr/de/es could have one, under CC BY-NC). Every Speech
Text change means re-rendering the changed sentences and redeploying audio.
Opus in Safari was not checked.

**C, the reader's own Ollama.** Works: Ollama (0.40.9 or later; 0.40.13 here) on Apple Silicon serves
`/v1/audio/speech` with streaming PCM, TTFA ~17 ms warm, ~130 MB over idle.
It needs the reader to install Ollama and pull a model, and the page to reach
`localhost:11434` (CORS / Private Network Access). An opt-in for enthusiasts,
not a default.

## Listening test

A blind A/B set of all 21 items: Supertonic M1 (r4) against the recommended
path A, 31m-en wasm fp32 (r3), each engine's median-WER run (Supertonic's r1
ties r4 but ran headed). Both clips are loudness-matched (-20 LUFS, 24 kHz),
cut to their speech, faded, and centred with random jitter in one common
length over the same low noise floor, so file length, Phonon's whole 80 ms
frames and its noise-floor edges give nothing away. Speaking rate still does:
Phonon is about 15% faster, so its speech is shorter inside the file. A/B is
drawn at random per item (Phonon is A in 9). Made by `listening_set.py`; both
are git-ignored and not committed:

- folder: `bench/phonon/listening/` (`items.txt` lists the texts)
- key: `bench/phonon/listening-key.csv`

The listening test itself has not been done.

## Not verified

- Download time over a real network, and a real Listen-mode integration.
- Any browser other than Chrome 156, and any device other than this M2 Max
  (no phones, no low-end laptops, no Windows).
- Whether the Supertonic RTF gap is a regression or this machine: no run was
  on a quiet machine.
- The human listening test.
- Commercial terms for the 40m models, and whether CC BY-NC reaches audio.
- Opus playback in Safari for path B.
- Path C on Windows or Linux, and from a deployed origin.

## Note on the prototype skill

The prototype skill says to keep prototypes off `main`. These scripts are
merged anyway, at the Chief's request, so the numbers stay reproducible; they
are marked THROWAWAY SPIKE and live only under `bench/phonon/`.
