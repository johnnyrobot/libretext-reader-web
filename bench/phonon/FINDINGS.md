# LT-213: Gradium Phonon as Listen mode's voice

THROWAWAY SPIKE. Nothing here changes `src/` or `pipeline/`; the scripts beside
this file exist to produce the numbers below and can be deleted once a decision
is made. Sources for every licence and model fact are in
[`notes/sources.md`](notes/sources.md). The LT-216 section is the exception:
the worker fix and the stage script it describes (`scripts/`, with its tests
in `pipeline/tests/`) are kept.

## Recommendation

**Partly.** Replace Supertonic for **English only**, with the Apache-licensed
`phonon-31m-en` run **in the reader's browser (path A)** on the Transformers.js
and ONNX Runtime Web 1.26 the reader already ships for translation. Here it was
about 2.3x faster than Supertonic back to back on a quiet CPU (2.5–4x when
the Mac was busy), produced its first audio frame in about 25 ms instead of
4.7 s quiet or 7–14 s busy (LT-214 now plays
frames as they arrive: see [LT-214 calibration](#lt-214-calibration)), downloads 41–161 MB of model instead
of about 409 MB (plus a ~15–26 MB runtime for a listener who has not used
translation), and has a similar word error rate; naturalness (UTMOS) is a
hair lower, and it can derail on very long formulas. The nine translation
tracks stay on Supertonic: Phonon has no voice for six of them, and the models
that cover fr/de/es are CC BY-NC (allowed while Listen mode stays free, under
the conditions in [Licences](#licences); a later ticket).

Path B (pre-render through Ollama at build time) works and is the fastest to
make, but costs about 310 MB of Opus per book per language and a rebuild on
every text change. Path C (the reader's own Ollama) is feasible only as an
opt-in for people who already run Ollama. Pre-rendering every LibreTexts page
in English would be about 306,000 hours of audio and 2.3–3.3 TB of Opus:
about five months on this Mac's GPU, or about 179,000 vCPU-hours on rented
servers (see
[Throughput and the whole corpus](#throughput-and-the-whole-corpus)).

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
(~860 MB) or idle Ollama (~127 MB). These runs shared a busy Mac; the two
quiet LT-215 runs (Supertonic r6, path A r5) are kept apart in
[Quiet re-timing](#quiet-re-timing-lt-215).

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
   the same conditions, and 4.4x on the medians of those loaded runs. On a quiet CPU
   (LT-215, below) the gap is smaller: Supertonic r6 at 0.41 and path A r5 at
   0.18, back to back, so about 2.3x, with first audio in 0.02 s against 4.7 s.
2. **Supertonic ran slower here than its README says, because the Mac was
   busy: RTF 0.68–1.21 under load, 0.41 claimed, and 0.41 on a quiet CPU**
   (r6, LT-215, see [Quiet re-timing](#quiet-re-timing-lt-215)). It is not a
   regression. The bundled ORT 1.17.3 worker has no
   WebGPU backend ("[webgpu] backend not found"), and threads gave only ~10%
   over one thread. Ruled out: a stale stage build (a fresh build is
   byte-identical) and missing cross-origin isolation (isolated, 12 cores,
   SharedArrayBuffer present). No ticket is needed.
3. **Phonon can derail on long formulas.** s18 is a 57-word run of repeated
   equilibrium-constant expressions. A clean reading of it scores about 8–17
   word errors with few character errors (Whisper writes the formulas its own
   way), which is what Supertonic and Ollama's 31m runs get. Path A wasm fp32
   drifted into nonsense on it in 2 of its 4 loaded runs (56 and 83
   character errors; the second is that run's 0.111 WER; quiet r5 read it
   cleanly), and so did wasm q4, WebGPU q4f16 in 2
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
5. **The 40m English model is not better than 31m.** In one run each through
   Ollama, `40m-en` scored worse on WER (0.107 vs 0.086) and CER (0.031 vs
   0.013), the same on UTMOS (4.42 both), and once repeated a phrase ("those
   are men"). It is also slower (RTF 0.017 vs 0.014 through Ollama, and about 15% more CPU
   per second of audio under Gradium's runtime (13–16% across the runs), see
   [below](#gradiums-runtime-on-plain-cpu-linux)). Nothing argues for it, so
   English stays on the Apache 31M.
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

**The rule that applies** (the Chief, 2026-11-01 10:35 PT, after Johnny said
books, Listen mode and voices are public with no sign-in or paywall): the
CC BY-NC 40m checkpoints may ship while Listen mode stays free, on these
conditions:

1. Listen mode and the voice download stay free: no paywall, ads or
   member-only access, and never sold.
2. English defaults to the Apache 31M unless a 40m is clearly better, and the
   notes say by how much. Here it is not: Finding 5.
3. Credit "Phonon by Gradium, CC BY-NC 4.0" wherever an NC voice is offered.
   The README must then say those weights are not under the repo's MIT
   licence (it does not yet, as no NC voice ships); they are fetched at stage
   time and never committed.
4. Path B audio made by an NC model is labelled CC BY-NC 4.0.
5. Before an NC voice first goes live, Johnny asks Gradium to confirm the use
   is noncommercial.

So the recommendation (English on the Apache 31M) needs none of 3–5. They
apply to the later fr/de/es ticket, and to any pre-rendered audio made with a
40m model.

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

## Throughput and the whole corpus

Added 2026-11-01 for two follow-up questions: how long would voicing every
LibreTexts page in English take (on a Mac Studio, in parallel), and what would
Colab or a GPU cloud such as RunPod or Brev cost. Nothing was rented. The
summary is `out/throughput.json` (`throughput.py`).

### Ollama, many requests at once

`concurrency.py` sends the 20 warm items N at a time to Ollama's
`/v1/audio/speech`. Ollama here runs `OLLAMA_NUM_PARALLEL=1` (its server
log), so one server makes one stream and queues the rest.

Every run had another app holding the GPU at 87–100% before it started
(another bot's browser kept it at 92–94% for over an hour), so these are
lower bounds. One-server runs swing a lot from run to run. In the bench
itself, one request at a time ran at 72x (RTF 0.0139). GPU utilisation
was 98–100% in every row. One-server rows at 1–8 in flight are the range
over three runs; the rest ran once. One-server RSS is from the run with no
other servers up (the other two had idle extra servers running):

| `phonon:en` | In flight | Combined | Latency, median / p95 | First audio, median | Ollama RSS | Loaded (`/api/ps`) |
|---|---|---|---|---|---|---|
| 1 server | 1 | 42–55x | 0.16–0.21 / 0.27–0.44 s | 0.02 s | 255 MB | 114 MB |
| 1 server | 2 | 31–49x | 0.38–0.44 / 0.53–1.9 s | 0.21–0.24 s | | |
| 1 server | 4 | 28–31x | 0.83–0.86 / 2.9–5.1 s | 0.64–0.66 s | | |
| 1 server | 8 | 27–51x | 1.4–1.7 / 1.7–6.2 s | 1.2–1.6 s | | |
| 1 server | 16 | 50x | 2.9 / 3.4 s | 2.8 s | 257 MB | 114 MB |
| 3 servers | 3 | 63x | 0.42 / 0.65 s | 0.05 s | 595 MB | 342 MB |
| 3 servers | 6 | 66x | 0.82 / 1.14 s | 0.49 s | | |
| 3 servers | 12 | 68x | 1.5 / 2.0 s | 1.2 s | | |
| **5 servers** | **5** | **81x** | 0.52 / 0.85 s | 0.07 s | 935 MB | 570 MB |
| 5 servers | 10 | 77x | 1.2 / 1.6 s | 0.67 s | | |
| 5 servers | 20 | 60x | 2.7 / 5.3 s | 2.1 s | | |

`phonon:40m-en`, one server, one run: 31x alone and 21–39x at 2–16 in flight,
latency 0.23 s rising to 3.7 s, about 410 MB RSS, 216 MB loaded.

- **One server does not get faster with more requests in flight.** It queues
  them: first audio goes from 0.02 s alone to 2.8 s with 16 waiting.
- **More servers do help.** Three servers made 63–68x and five made 81x,
  against 42–55x for one server under the same load. Sending more requests
  than there are servers only adds waiting. Each server loads its own copy of
  the model (114 MB on `/api/ps`, about 170 MB more RSS).
- Where this levels off on a quiet GPU was not measured. RSS is the sum over
  every `ollama` process and leaves out Metal buffers.
- The 81x is the best single row, one burst of 40 requests (4.6 s); the
  corpus estimate rests on it.
- The extra servers ran on ports 11435–11438 and were stopped afterwards.
  The usual server on 11434 was one of the three and five, used as it was
  and never restarted.

### Gradium's runtime on plain CPU (Linux)

`ptts_cpu.py` runs Gradium's own runtime (the `ptts` 0.6.0 PyPI wheel,
manylinux aarch64, no Ollama) in a `python:3.12-slim` arm64 container under
podman on this Mac. The VM had 10 vCPUs and 12 GB; its load average
was 1.3–11.4 during the runs, from the runs themselves and a busy host, and the VM
cannot choose performance over efficiency cores, so treat these as a floor for
this machine. Same 20 warm items, one warm-up first. The 31M is
`gradium/phonon-31m-en`. The 40M English repo is gated, so its checkpoint was
rebuilt from Ollama's `phonon:40m-en` blobs; the same rebuild of `phonon:en`
is byte-identical to `gradium/phonon-31m-en` (all 185 tensors), so the method
holds. The 40M ran with its first catalogue voice (Alfie). Weights stayed out
of the repo.

One process, set to 1, 4 or 8 threads. Times real time, with seconds of audio
per CPU-second in brackets:

| Model | 1 thread | 4 threads | 8 threads |
|---|---|---|---|
| 31M f32 | 6.6x (3.9) | 10.5x (2.5) | 9.2x (1.4) |
| 31M q8 | 6.5x (4.7) | 11.5x (2.9) | 11.0x (1.7) |
| 40M f32 | 6.4x (3.4) | 8.2x (2.0) | 9.2x (1.3) |
| 40M q8 | 6.2x (4.1) | 10.3x (2.5) | 9.8x (1.4) |

A one-thread process keeps 1.4–1.9 cores busy (the decoder runs on its own
worker), and more threads mostly stop helping at about 4 (only the 40M f32
gained a little more at 8). For bulk rendering the
better shape is many one-thread processes side by side:

| q8, one thread each | 4 processes | 8 processes |
|---|---|---|
| 31M | 14.4x combined, 5.5 cores busy | 17.1x, 9.4 cores busy (VM full) |
| 40M | 13.3x, 5.9 cores busy | 15.0x, 9.5 cores busy |

So with all 10 vCPUs in use, each makes about 1.7 seconds of audio per
second for the 31M (1.5 for the 40M, which needs about 15% more CPU per
second of audio). Per CPU-second actually used it is 1.8, but a rented vCPU
is billed busy or idle, so the cost lines use 1.7.
Gradium's README claims 26x on one MacBook Air M5 core and 41x on four,
"CPU + KleidiAI": about four times the 6.2–6.6x a one-thread process made
here. The wheel's
`ptts.build_info()` lists NEON only. Whether the gap is the M5's SME2
(KleidiAI), the VM or the busy host was not tested.

### GPU and batching on Linux

From Gradium's README, CLI guide and server guide (xn-ptts `main`, read
2026-11-01; `notes/sources.md`, Q6):

- **GPU.** The prebuilt Linux downloads, the Docker image
  (`ghcr.io/gradium-ai/ptts-openai-server`, amd64 and arm64) and the PyPI
  wheels run on the CPU only; `ptts.available_devices()` returned `['cpu']`
  here. Only the Apple Silicon download includes Metal (f32 weights with
  `--device auto`). CUDA or Vulkan needs a source build with that Cargo
  feature, which was not tried. Quantised weights such as q8 always run on
  the CPU. Ollama's Phonon needs Apple Silicon.
- **Batching.** None across requests: each generation runs at batch size 1.
  The decoder only groups the queued latents of one stream. The
  OpenAI-compatible server runs one generation at a time by default;
  `--max-concurrent-requests N` runs N side by side and answers HTTP 429
  beyond that.

So a rented GPU runs Phonon only after a CUDA build of our own, one stream
per generation, and how fast that is was not measured.

### The whole corpus

Inputs, all estimates:

- **Pages:** 1,304,882 in about 3,630 books, from the Download Center census
  (`libretexts-research/2026-07-20-rebuild-spec/research/public-corpus-url-census`,
  marked unverified there).
- **Speech Text per page:** the four books staged here (the ticket's
  `.rebuild/site-new` figure is the low case's mean; its median is 7,407, so a
  few long pages pull the mean up). chem_4b,
  human_relations and math_elem_teachers average 11,136 characters over 255
  pages; adding social_psychology gives 13,668 over 330 pages;
  social_psychology alone is 22,275.
- **Speaking rate:** 16.17 characters a second (31M, `storage.json`).

| | Low | Central | High |
|---|---|---|---|
| Characters per page | 11,136 | 13,668 | 22,275 |
| Audio | 250,000 h | 306,000 h | 499,000 h |
| WAV, 24 kHz 16-bit | 43 TB | 53 TB | 86 TB |
| Opus 16 kbit/s | 1.9 TB | 2.3 TB | 3.7 TB |
| Opus 24 kbit/s | 2.7 TB | 3.3 TB | 5.4 TB |
| This Mac, Ollama GPU, 5 servers (81x, GPU shared) | 128 days | 158 days | 257 days |
| This Mac, CPU in the Linux VM (17x) | 608 days | 746 days | 1,216 days |
| CPU server: vCPU-hours at 1.7x per vCPU | 146,000 | 179,000 | 292,000 |
| … at AWS Graviton4 spot / on-demand prices | $2,700 / $5,800 | $3,400 / $7,100 | $5,500 / $11,600 |

Storage sizes use the bitrates measured on the bench audio (`storage.json`;
Opus 16 kbit/s came out at 16.6, and is 214 MB for social_psychology against
310 MB at 24). Nobody has listened to the 16 kbit/s files. The estimate is the
31M in English, rendering only. Not included: encoding, storage, transfer,
and re-rendering when Speech Text changes. Prices are for c8g.4xlarge
(16 vCPU) in us-east-1, $0.638 an hour on demand and about $0.30 spot. They
come from third-party price trackers checked 2026-11-01, not from AWS. The
speed per vCPU assumes a Graviton4 vCPU matches one here; that was not
measured. The parallel runs' speed uses the longest process's timed window;
they did not record when each window started. The eight-process 31M batch,
model loads included, took 3.7% longer than its longest window, so 1.7x per
vCPU is at most about 4% high (1.65–1.71x, about 186,000 vCPU-hours in the
central case at the low end).
`ptts_cpu.py` now records each window's start and end for any rerun.

What that means for the options asked about:

- **Mac Studio M1 Ultra, in parallel.** Not measured. On this Mac, five
  Ollama servers sharing a busy GPU made 81x, so the central case is about
  five months. The M1 Ultra's GPU has 64 cores to this one's 38, but it is
  an older generation and Phonon runs one small stream per server, so how far
  more servers would scale there is unknown. Its 20 CPU cores, at the 1.7x
  per core measured here, would add about 34x. A guess, not a measurement:
  if its GPU matched this one's 81x and the CPUs added 34x at the same time,
  about 115x is roughly 110 days (3.6 months) for the central case. The
  native macOS `ptts` build with Metal is another route that was not tried.
- **Google Colab.** A session gets a few vCPUs and one GPU, with time limits.
  Phonon runs there on the CPU unless built for CUDA. At 1.7x per vCPU the
  central case is about 90,000 two-vCPU session-hours, so it is not a fit
  at any price; no cost is given.
- **RunPod or Brev GPUs.** Both rent NVIDIA GPUs, so both need the untested
  CUDA build, which runs one stream per generation. No speed was measured,
  so no time or cost is given for either. It is
  worth one short paid test only if a CPU fleet is too slow.
- **A CPU fleet** (RunPod CPU pods, AWS or similar). This is the
  best-understood option: about 179,000 vCPU-hours in the central case. That
  is about 4.7 days on 100 machines of 16 vCPUs, and about $3,400–7,100 at
  Graviton4 prices. RunPod does not publish a CPU rate. A comparison site
  implies about $0.03 per vCPU-hour (about $5,400), not verified.

### Quiet re-timing (LT-215)

LT-215 asked for one Supertonic timing with no other benchmark or browser
model running. Question Studio Dev held its LT-207 queue so the GPU would
go idle at 13:21:44 PT. Load average was 1.6 when Supertonic r6 started
at 13:22. Path A wasm fp32 r5 ran straight after, at a load average of
3.3. Both run in wasm on the CPU. At 13:22:52 another LT-207 queue
started a GPU stage, so the GPU was busy again, but neither engine uses
the GPU.

| Run | Load avg at start | Warm RTF | First audio, median | Cold first audio | WER | CER | UTMOS |
|---|---|---|---|---|---|---|---|
| Supertonic M1 r6 | 1.6 | 0.405 | 4.65 s | 4.86 s | 0.072 | 0.009 | 4.39 |
| Path A wasm fp32 r5 | 3.3 | 0.178 | 0.024 s | 0.96 s | 0.070 | 0.015 | 4.44 |

So Supertonic matches its README's 0.41 on a quiet CPU, and the earlier
0.68–1.21 was the shared machine; no diagnosing ticket. Path A is still
about 2.3x faster in real time and starts speaking about 195 times sooner.
s18 ran 21.8 s for its 329 characters in r5 (15 a second), a normal length. The Ollama concurrency rows above were meant to
be re-run in the same window, but the GPU was back at 86–100% within a
minute, so a fourth one-server run (43–56x) changes nothing and is not
kept.

## LT-214 calibration

LT-214 ships path A for English: `phonon-31m-en` wasm fp32 in
`src/phonon.worker.mjs`, streamed, with a length guard. These are the numbers
behind its constants. Every render here ran in Chrome 156 headless on this M2
Max, with other teams' work running (load average 6–9), so the timings are
busy-machine timings.

### Temperature and speaking rate

`duration_delta` slows Phonon's speech. At 1.0 it reads 14.27 characters a
second, against Supertonic's 14.12 at its default rate, so the reader's speeds
mean the same thing on both voices; at 0 it was about 15% faster. It also helped
accuracy: CER fell from 0.036 at d=0 to 0.011–0.021, and s18 (the 329-character
formula that looped in 2 of 4 LT-213 runs) read cleanly in all 8 runs at d=1.

Then the temperature, two runs each at d=1, default voice:

| Temperature | WER r1 | WER r2 | Mean WER | CER r1 / r2 | UTMOS r1 / r2 |
|---|---|---|---|---|---|
| 0.3 | 0.064 | 0.081 | 0.072 | 0.011 / 0.016 | 4.48 / 4.50 |
| 0.2 | 0.066 | 0.081 | 0.073 | 0.013 / 0.020 | 4.46 / 4.50 |
| **0.1** | 0.074 | 0.064 | **0.069** | 0.013 / 0.015 | 4.47 / 4.47 |
| 0.05 | 0.072 | 0.093 | 0.083 | 0.015 / 0.021 | 4.41 / 4.40 |

0.3, 0.2 and 0.1 are the same within run-to-run noise (about ±0.01). 0.1 has the
lowest mean and the smallest spread, so it ships; 0.05 is worse on every
measure. Warm RTF was 0.237–0.259.

### The shipped voices

The reader offers Preston (M1) and Hadley (F1), not the default voice above.
One run each at the shipped settings (temperature 0.1, d=1):

| Voice | WER | CER | UTMOS | Warm RTF | First audio, median |
|---|---|---|---|---|---|
| Preston (M1) | 0.076 | 0.013 | 4.40 | 0.233 | 29 ms |
| Hadley (F1) | 0.085 | 0.017 | 4.48 | 0.242 | 26 ms |
| Supertonic M1, 6 runs (LT-213, LT-215) | 0.072–0.085 | 0.009–0.017 | 4.39–4.50 | 0.405 quiet | 4.65 s quiet |

Both are inside Supertonic's own range. Every item above 0.12 WER in these
runs has zero character errors: it is Whisper writing a formula differently
("NO2" as "no 2"), not Phonon misreading it. s18 read cleanly with both voices.

### The length guard

`src/phonon-guard.mjs`. A sentence's expected length is

    expected = 1.1 s + spokenLength / 11.5
    spokenLength = characters + 4 per digit + 3 per lone capital letter

because Phonon says "1024" as four words and "N O two" as names with pauses.
Fitted on the 168 renders above (21 items × 4 temperatures × 2 runs), the
longest clean render was 1.148× its expected length, so a cap at 1.5× clears
every clean render by about 30%. The shipped voices, which the fit did not
include, stay inside it: Preston's longest render was 1.145× expected (s21) and
Hadley's 1.147× (s18), over 21 items each.

The ticket suggested about 16 characters a second. Phonon does speak plain
prose at 14.3 a second, but counting digits and lone capitals as longer is what
lets one rate fit both prose and formulas, and against that weighted length the
fitted rate is 11.5. Past the cap the attempt is stopped and, in
order, retried once, rendered split at punctuation, then skipped with a visible
mark. It never falls back to Supertonic for English. The guard limits
overruns; it does not guarantee that nonsense is never heard, for the two
reasons below.

Frames are streamed only while an attempt is within its expected length;
anything past that is held until the model ends the sentence itself. A runaway
is therefore heard for at most its expected length before it is withdrawn.

What the guard cannot catch: a derail that stays inside the predicted length.
The worst LT-213 s18 runs came out at 1.02–1.10× expected, nonsense of the
right duration. At d=1 none happened in 8 + 2 runs, but that is d=1 doing the
work, not the guard.

### Symbols in Speech Text

Raw symbols were rendered through path A at the shipped settings and
transcribed by Whisper. Phonon got these wrong, so `pipeline/normalize.py` now
spells them out:

| Text | What Phonon said |
|---|---|
| `!=` | "equals", the opposite |
| `<=` | lost "or equal" |
| `₹` | "€9,158" |
| `±`, `÷` | "and" |
| `≈`, `≤`, `≥` | garbled |
| `©` | nothing |
| `®`, `™` | "Brandy", "Nae McGree Tee" |
| `§` | "cheek" |
| `½` | "and half" |
| `U.K.`, `E.U.` | "UK neighbor", "union" |
| `×` | "by", wrong in scientific notation |

It read these correctly as they were: `&`, `<`, `>`, `+`, `°C`/`°F`, `#1`,
`@`, `€`, `£`, `¥`, `U.S.` (`€`, `£`, `¥` and `°` are spelt out anyway, so a
price or temperature reads the same on both voices). After the change every
probe item was heard correctly.

`#` before a number and `~` are still spoken by the normalizer although
Phonon read `#1` correctly: the number pass that follows turns the digits into
words, which would leave "#one" or "~five", a mark Phonon was never heard
reading. They are spelt out for the same reason as `€`.

### In the reader

`tests/e2e/playback.spec.js`, Chrome 156 against the local stage (not
library.libretexts.dev):

| What | Measured |
|---|---|
| English download | 162,177,677 bytes (154.7 MB), 7 files, equal to `phonon/manifest.json` |
| Supertonic requests for an English-only reader | 0 |
| Time to first sound (`tts:first-sound`, play → first frame scheduled) | 35 ms, heard about 50 ms later (the player's lead-in), so about 85 ms |
| Translations | all nine still play, on Supertonic, loaded only when one is picked |

## LT-216: French, German, Spanish and Portuguese in the browser

Phonon 40M fr, de, es and pt now run in the reader's browser through the same
worker as English (`src/phonon.worker.mjs`, wasm fp32). All four pass the bar
set for them: WER within 1.5× of English, RTF ≤ 0.5, first sound ≤ 1 s once
loaded. They are CC BY-NC 4.0 and are staged only for the demo, credited
"Phonon by Gradium, CC BY-NC 4.0"; the weights are never committed.

### The route: built from Johnny's Ollama copies

No 40M ONNX export exists. The browser files are built by
`scripts/stage-phonon-lang.py` from Johnny's Ollama copies (`~/.ollama/models`,
or `OLLAMA_MODELS`; Ollama 0.40.13), each pinned by the ID `ollama list` shows,
the sha256 of its inner manifest. Every blob is checked against its own digest
before it is read. No 40M weight comes from Hugging Face and no token is
needed; the only Hub files the build uses are the English template below
(its config.json, flow_lm.onnx and mimi_decoder.onnx), the Apache 2.0 export
`scripts/fetch-phonon.py` already fetches for English, at a pinned revision.
The script refuses a target that any git checkout would track (or where git
cannot tell); a git-ignored stage inside one, such as `scripts/stage-local.sh`'s
`.stage/`, is allowed, so LT-217 can stage into its usual layout.

| Tag | Pinned ID |
|---|---|
| `phonon:fr` | `sha256:da29147f…` |
| `phonon:de` | `sha256:6ef26804…` |
| `phonon:es` | `sha256:d5df2ae8…` |
| `phonon:pt` | `sha256:e8fb87de…` |

The copies are the original release, bf16 safetensors with one blob per tensor.
onnx-community's English export of `phonon-31m-en` is the template: it is the
same PocketTTS architecture with 6 transformer layers where the 40M has 9.

- `flow_lm.onnx` is the English graph with its last layer cloned three times
  (layers 6–8 from layer 5, each with its own KV cache input and output), and
  every weight replaced by the language's own.
- `mimi_decoder.onnx` is the English graph with the language's latent mean and
  std. Every copy shares one Mimi codec (`mimi_sig` in its config); the script
  refuses a copy trained on another.
- The tokenizer and config come from the copy. The copy's one voice is written
  as `voices/default.bin`, which the worker uses whichever menu voice is
  picked (`voiceBuffer`).

How it was checked: built from Ollama's `phonon:31m-en`, the script reproduces
onnx-community's English export tensor for tensor (flow_lm and mimi weights,
tokenizer and config apart from its source), which shows the weight mapping is
right. The grown graph was run in ORT twice: with the cloned layers' output
projections zeroed it must speak exactly as the 6-layer English graph does, and
with them left in it must not, and each clone must read and write only its own
cache. `pipeline/tests/test_stage_phonon_lang.py` holds all
of this (19 tests). Each language's files come to 199.6 MB (190.3 MiB), against
English's 162.2 MB (154.7 MiB).

Route (b), the `phonon-tts` npm package, was not tried. The ticket says to
prefer the route that reuses the runtime already shipped, unless the other is
clearly better; route (a) runs on the shipped worker and runtime unchanged and
clears every bar with room to spare, so there was nothing for (b) to be clearly
better at. The per-language copies were the default, and none failed, so the
multilingual model was not needed either.

### Results

Chrome 156 (Playwright's `channel: 'chrome'`, the installed desktop Chrome, run
headless) on this M2 Max, through the listening page
(`bench/phonon/listen/`) and `bench/phonon/lt216/measure.mjs`. Each language
ran in a fresh browser with cross-origin isolation on, speaking one item cold
and then all 12 warm. Scored by `bench/phonon/lt216/score.py`: Whisper
large-v3-turbo with the language set, Whisper's basic normaliser, and numerals
mapped to words on both sides.

| Language | WER | CER | Warm RTF | First sound, median (max) | Cold load | Download | Peak Chrome RSS | Load avg |
|---|---|---|---|---|---|---|---|---|
| fr | 0.013 | 0.004 | 0.183 | 39 ms (49 ms) | 1.10 s | 199.6 MB | 2797 MiB | 7.2 |
| de | 0.006 | 0.000 | 0.198 | 47 ms (54 ms) | 1.31 s | 199.6 MB | 2786 MiB | 7.9 |
| es | 0.011 | 0.004 | 0.260 | 57 ms (69 ms) | 1.24 s | 199.6 MB | 2902 MiB | 10.2 |
| pt | 0.006 | 0.004 | 0.383 | 73 ms (129 ms) | 1.23 s | 199.6 MB | 2851 MiB | 20.7 |
| en (paragraph only) | 0.000 | 0.000 | 0.353 | 90 ms | 2.55 s | 162.2 MB | 2401 MiB | 22.9 |

- The length guard passed every render ('ok'); it retried, split or skipped
  none.
- RTF follows the machine's load more than the language: pt and en ran while
  other teams' work pushed the load average to 21–46, and in the first pass, at
  45, they measured 0.77 and 1.80. Those runs are kept in
  `/Users/Shared/LT-216/work/measure/{pt,en}-contended/` and were discarded.
- Cold load is from the local server's disk, not a network.
- Peak RSS is Chrome's whole process tree, shared pages included, so it
  overstates what the tab costs. The 40M voices cost about 400 MiB more than
  English.

The WER bar was 1.5× English's 0.072, i.e. 0.108. That 0.072 includes
chemistry, math and citations, which this set has none of. On the categories
it does have, English through the same worker scores prose 0.022, numbers
0.009 and dates 0. The translations, at 0.006–0.013, are at English's level
either way.

What Whisper still heard wrong were mostly English names, and homophones:

- "Camp David" was heard as "comte david" (fr) and "kent david" (pt).
- "Spectrum Human Rights Alliance" became "hammond rights" (es).
- "Israel" became "eis arreel" (es).
- Homophones: "solo" heard as "sólo", "münzwurf zahl" as "münzwurfzahl".
- Portuguese once said "matematimatamente".

The first pass (before the fix below) added fr "apprenne/apprennent", "lancer/
lancé" and "Abou/Abu", also homophones.

### The test set

`bench/phonon/lt216/sentences.json`, 12 items per language:

- p00 is the sample paragraph the Chief's Ollama clips read. The clips folder
  had no text files, so the paragraph was recovered from the clips by
  Whisper.
- s01–s11 are the prose, numbers and dates items of the LT-213 English set,
  translated for this ticket (by the agent, not a native speaker), with numbers
  spelt out the way the reader's normaliser would.

There are no chemistry or math items, because the normaliser that spells out
symbols (`pipeline/normalize.py`) is English-only. Before formulas are read in
these languages, that needs its own work and its own test.

### A bug found: a call cut at a comma ran past its end

The worker splits text longer than 50 tokens into several calls at clause
punctuation. A call that ended on a comma ran on past its end. Spanish p00
(58 tokens) split into "…influyen en nuestros pensamientos," and
"sentimientos y comportamiento.":

| First call ends | Renders | Overran | Length |
|---|---|---|---|
| "pensamientos," | 8 | 8 (babble or repeated words) | 16.0–18.6 s |
| "pensamientos." | 8 | 0 | 13.6–14.7 s |

Ollama's own Phonon read the same paragraph cleanly in 8 of 8 at about 13 s,
which is what pointed at the split.

The fix, `speechCalls` in the worker, ends every call it cuts mid-sentence with
a full stop: a trailing `,`, `;` or `:` becomes `.`. A call that already ends
on `.`, `!` or `?` keeps its own ending. Clauses are packed together while they
fit, as before. The unit tests in `tests/phonon.worker.test.js` pin this.
After the fix, every language's p00 read word-perfect.

The cost: where a sentence is cut, the voice now ends a sentence there, with a
sentence-final fall and pause. Whisper's raw transcripts show it ("nous
ressentons. Pensons…"); the scorer strips punctuation, so WER does not.
Ollama's runtime read the same paragraph with no break, so at that point the
browser does not yet sound the same. A pause at a comma is the better failure
than babble, but splitting less often, or not at all for a sentence only a
little over 50 tokens, may remove it; that is for LT-217 to try, measured the
same way (8 renders, look for overruns).

The bug is in English too, for a sentence over 50 tokens with a comma near the
cut. To show the fix costs English nothing, the 21-item LT-213 set was rendered
through the fixed worker (Preston, temperature 0.1, d=1): WER 0.078 and CER
0.014, inside LT-214's wasm fp32 range (WER 0.064–0.085). By category: prose
0.022, numbers 0.009, dates 0, citations 0.083, chemistry 0.269, math 0.08.
None of the 21 sentences is cut there, so this shows the fix does no harm, not
that it helps English.

### Listening

`/Users/Shared/LT-216/HOW-TO-LISTEN.md` says how to open the page in Chrome. It
runs at <http://127.0.0.1:8820/social_psychology/listen-lt216/>, on the stage
built by `bench/phonon/listen/stage.sh` (port 8820, because 8812–8814 were taken
by LT-217's servers). The page picks a language, plays the text in the box,
shows first sound, RTF and download size, and saves a WAV.

### Not verified (LT-216)

- Any listener who speaks these languages. WER says the words are right, not
  that the accent or prosody is.
- The voices in the reader itself. LT-217 wires them in; this ticket stops at
  the worker and the listening page. The worker's `setLang` still accepts only
  English.
- Chemistry, math or citations in these languages.
- Desktop Chrome with a window: the measurements ran headless. The listening
  page is for hearing it in a real window.
- Memory for the tab or worker alone; only Chrome's whole process tree was
  measured.
- Which voice each copy carries. Each Ollama copy has one voice, its default,
  written as `voices/default.bin`; it plays for both menu voices (Preston and
  Hadley), so a translation has one voice. It has not been described or
  compared with phonon-voices, which the ticket dropped.
- Gradium's confirmation that the demo use is noncommercial, which Johnny is
  asking for himself.

## LT-222: a Male and a Female voice in every language

Each translation now has the reader's two menu voices, staged by
`scripts/stage-phonon-lang.py` as `voices/M1.bin` and `voices/F1.bin`. Every
shipped default (the one voice `phonon:<lang>` carries, approved in LT-217)
measured male, so it keeps the Male slot, and Female is a voice from the
language's catalogue:

| Language | Male (M1) | Female (F1) |
|---|---|---|
| fr | shipped default, 117 Hz, WER 0.013, UTMOS 4.00 | Lilou, 213 Hz, WER 0.013, UTMOS 3.72 |
| de | shipped default, 118 Hz, WER 0.006, UTMOS 4.20 | Annika, 214 Hz, WER 0.006, UTMOS 4.06 |
| es | shipped default, 112 Hz, WER 0.003, UTMOS 3.94 | Ximena, 215 Hz, WER 0.000, UTMOS 4.00 |
| pt | shipped default, 120 Hz, WER 0.000, UTMOS 4.09 | Isadora, 221 Hz, WER 0.003, UTMOS 3.98 |

The catalogue is Gradium's phonon-voices (da6c9ec0, Apache 2.0), as carried by
the `phonon:40m-<lang>` Ollama copy of each language, pinned by its ID the same
way as the model. Only its voice tensors are read; no Hugging Face. The Female
voices are credited "Voices: Phonon by Gradium, phonon-voices, Apache 2.0" next
to the model's CC BY-NC credit. The Male voice is the model's own default, so it
stays under that CC BY-NC licence; the staged manifest records each file's source
and licence. None of them is committed.

### How they were chosen

Everything ran through the real worker on the listening page:
`bench/phonon/lt222/stage.py` stages a bench copy with every catalogue voice
under a plain file name (Hélène → Helene), and `measure.mjs --voice` asks for
one. Chrome 156 headless on this M2 Max, as in LT-216.

1. **Gender, by pitch.** `bench/phonon/lt222/voice.py` takes the median F0
   over every voiced frame (librosa pyin, 60–400 Hz). Below 150 Hz reads as
   male, above 180 Hz as female, 150–180 Hz as ambiguous. The four defaults,
   over the whole set, are 112–120 Hz, so no language needed both slots from
   the catalogue.
2. **Pre-screen.** Every catalogue voice spoke p00, the long paragraph. Of the
   voices named and measured female, the three with the highest UTMOS went on.
   Every female name measured above 180 Hz. Some male names did not measure
   male: de Leon, Mika and Mirko (156–159 Hz); es Aldo, Izan, Lalo and Yael
   (157–170 Hz); pt Davi and Igor (160–169 Hz), and pt Kauã and Vitor (185–189
   Hz) read as female. None of them was needed.
3. **The full set.** The three candidates spoke all 12 items, scored by
   `bench/phonon/lt216/score.py` (Whisper large-v3-turbo) and UTMOS22. Lowest
   WER ships; a tie goes to the higher UTMOS.

| Language | Candidate | F0 | WER | UTMOS |
|---|---|---|---|---|
| fr | **Lilou** | 212.6 Hz | 0.013 | 3.72 |
| fr | Coralie | 231.8 Hz | 0.013 | 3.67 |
| fr | Tiphaine | 200.7 Hz | 0.015 | 3.65 |
| de | **Annika** | 213.8 Hz | 0.006 | 4.06 |
| de | Nele | 200.7 Hz | 0.006 | 3.99 |
| de | Josefine | 197.2 Hz | 0.006 | 3.78 |
| es | **Ximena** | 215.1 Hz | 0.000 | 4.00 |
| es | Regina | 207.7 Hz | 0.003 | 3.94 |
| es | Alicia | 201.8 Hz | 0.003 | 3.75 |
| pt | **Isadora** | 221.4 Hz | 0.003 | 3.98 |
| pt | Débora | 218.8 Hz | 0.003 | 3.68 |
| pt | Rafaela | 247.0 Hz | 0.006 | 3.64 |

Each pick is within 0.02 WER of its language's default, rendered the same
night: fr 0.013, de 0.006, es 0.003, pt 0.000. The defaults' es and pt WER
are lower than LT-216's 0.011 and 0.006: Phonon samples, so the same text can
come out differently, and these are 12 items. The WER errors are almost all
the names LT-216 lists, so every voice in a language scores about the same.

- RTF was 0.13–0.15 warm for every candidate, first sound 27–37 ms.
- The Whisper GPU job was dropped once by macOS ("Impacting Interactivity")
  while other work used the GPU; those scores ran on the CPU instead
  (`mlx.core.set_default_device(mx.cpu)`), with the same model.
- Renders, scores and `voice.json` per voice are in
  `/Users/Shared/LT-222/work/render/`, outside git.

### In the reader

The real reader, built by `scripts/stage-local.sh` from this branch, read the
social_psychology 1.2 page in Chrome headless. It played each language in both
voices: English, then fr, de, es and pt, with the voice menu switched once in
each. The voice menu stayed enabled throughout, and the voice carried across
every language switch. The pitch of the first four sentences the worker
rendered in each voice, measured by `voice.py`:

| Language | Male (M1) | Female (F1) |
|---|---|---|
| en | 108 Hz | 179.8 Hz (Hadley, unchanged since LT-214) |
| fr | 120 Hz | 216 Hz |
| de | 124 Hz | 229 Hz |
| es | 113 Hz | 210 Hz |
| pt | 122 Hz | 237 Hz |

The first sentence in a newly picked voice came back 0.9–1.3 s after play.
Any lookahead the worker had already rendered in the old voice was discarded,
because the player flushes on a voice change.

Two notes from that check:

- Under heavy CPU load (the Whisper jobs running), one run stopped on the
  "pt is slow on this device" question. That is LT-217's falling-behind prompt
  doing its job, not a voice fault, and the next run was clean.
- English Female (Hadley) measures 179.8 Hz on this page: just under the
  180 Hz line, so "ambiguous" by this measure, and lower than the four new
  voices. It was not pitch-checked in LT-214, and LT-222 does not change English.

### Not verified (LT-222)

- A listening test. Pitch says each voice is the gender it is labelled;
  nobody has yet judged whether Lilou, Annika, Ximena and Isadora sound like
  good readers next to the defaults.
- UTMOS is an English-trained predictor; it is used here only to rank voices
  within one language.

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

- Download time over a real network. The Listen-mode integration (LT-214) is
  verified only on the local stage, in Chrome on this Mac.
- Any browser other than Chrome 156, and any device other than this M2 Max
  (no phones, no low-end laptops, no Windows).
- A quiet-GPU Ollama run: the one window (LT-215) closed after a minute.
- The human listening test.
- Commercial terms for the 40m models, and whether CC BY-NC reaches audio.
- Opus playback in Safari for path B.
- Path C on Windows or Linux, and from a deployed origin.
- The corpus page count (an unverified census) and characters per page beyond
  the four staged books.
- Any machine other than this M2 Max for the throughput numbers: no M1 Ultra,
  no Graviton or x86 server, no GPU other than Apple's. Phonon on CUDA.
- The cloud prices, which come from third-party trackers.
- How 16 kbit/s Opus sounds.

## Note on the prototype skill

The prototype skill says to keep prototypes off `main`. These scripts are
merged anyway, at the Chief's request, so the numbers stay reproducible; they
are marked THROWAWAY SPIKE and live only under `bench/phonon/`.
