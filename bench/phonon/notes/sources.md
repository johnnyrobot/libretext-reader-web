# Phonon (Gradium) vs Supertonic: primary-source notes

Gathered 2026-11-01. Local Ollama 0.40.13. Every claim has a source next to it. "HF API" means `curl https://huggingface.co/api/models/<repo>` (metadata) or `.../tree/main?recursive=true` (file list). Anything not verified is marked **UNCONFIRMED**.

---

## Q1. Phonon checkpoints Gradium publishes on Hugging Face

All repos under the `gradium` author. Source: `curl "https://huggingface.co/api/models?author=gradium&limit=100"`. There are 11 repos.

| Repo | Params (card) | HF safetensors total | Languages | `license:` YAML | Gated | HF `main` sha |
|---|---|---|---|---|---|---|
| gradium/phonon-31m-en | 31M "excluding the audio tokenizer" | 41,096,035 | en | apache-2.0 | no | 92741c5b… |
| gradium/phonon-40m-en | 40M | 50,539,363 | en | cc-by-nc-4.0 | yes (`auto`) | bc7e8ae7… |
| gradium/phonon-40m-fr | 40M | 50,539,363 | fr | cc-by-nc-4.0 | auto | d9108697… |
| gradium/phonon-40m-de | 40M | 50,539,363 | de | cc-by-nc-4.0 | auto | 79cfc7b4… |
| gradium/phonon-40m-es | 40M | 50,539,363 | es | cc-by-nc-4.0 | auto | e5e052b2… |
| gradium/phonon-40m-pt | 40M | 50,539,363 | pt | cc-by-nc-4.0 | auto | 4cbfd742… |
| gradium/phonon-40m-multilingual | 40M | 50,539,363 | en, fr, de, es, pt | cc-by-nc-4.0 | auto | 1537ce46… |
| gradium/phonon-voices | n/a (voice embeddings + samples) | n/a | en, fr, de, es, pt | apache-2.0 | no | 0ee17205… |
| gradium/phonon-mimi | Mimi codec ("audio tokenizer") | 10,305,313 | n/a | apache-2.0 | no | 33519be1… |
| gradium/phonon-31m-en-llamacpp | same model as 31m-en, GGUF for llama.cpp | n/a | en | apache-2.0 | no | 2f823a95… |
| gradium/phonon-31m-en-audiocpp | same model as 31m-en, GGUF for audio.cpp | n/a | en | apache-2.0 | no | 2431a078… |

Sources: HF API `cardData.license`, `gated`, `sha`, `safetensors.total` for each repo. The params column comes from the "Model details" section of each model card: https://huggingface.co/gradium/phonon-31m-en/raw/main/README.md and https://huggingface.co/gradium/phonon-40m-en/resolve/main/README.md. The `raw/` URL of a gated 40m card returns "Access to model … is restricted"; the `resolve/` URL returned the full card without a login.

- **Licences:**
  - **31m-en** is Apache 2.0. Its card says: "The weights, tokenizer and voices in this repository are released under Apache 2.0, which allows commercial use. The runtime is a separate project, licensed MIT OR Apache-2.0." (31m-en README, section "License")
  - **All 40m repos** are CC BY-NC 4.0. Their cards say: "…released under CC BY-NC 4.0, which does not allow commercial use." (`diff` of 31m-en vs 40m-en README: the only differences are the name, the param count, the q8 size and the licence)
  - **No repo has a separate `LICENSE` file.** None appears in any repo's file tree (HF API tree). The licence comes only from the YAML `license:` field and the card text. Ollama ships the licence text itself (see Q2).
- **Gating on the 40m repos:** "You need to agree to share your Hugging Face information to access this model … accept the conditions to access its files". Source: HTML of https://huggingface.co/gradium/phonon-40m-en. The xn-ptts README says "approval is automatic" (https://github.com/gradium-ai/xn-ptts README, "Model setup"). The text of the gating conditions is only shown after sign-in. **UNCONFIRMED** (not signed in).
- **Files and sizes** (HF API tree, bytes):
  - **phonon-31m-en:** model.safetensors 102,823,920; model.q8.gguf 64,512,352; model.q4k.gguf 55,075,168; default-voice.safetensors 256,136; tokenizer.model 65,045 (SentencePiece); tokenizer.json 277,967; tokenizer.5.0.0.json 302,879; config.json 4,634; generation_config.json 220; processor_config.json 747; tokenizer_config.json 575; chat_template.jinja 1,513.
  - **Each 40m-\* repo:** model.safetensors 121,713,400; model.q8.gguf 74,553,568; model.q4k.gguf 60,397,792; default-voice.safetensors 256,136; plus a per-language tokenizer (tokenizer.json is about 278–279 KB, varying by language).
  - **phonon-mimi:** model.safetensors 41,227,148; config.json 1,153.
  - **phonon-31m-en-llamacpp:** phonon-31m-en-Q8_0.gguf 22,448,928 (transformer, tokenizer, default voice); mmproj-phonon-31m-en-F32.gguf 71,308,256 (flow head and Mimi decoder). The card says it "need[s] a llama.cpp build with Phonon support, which is not merged yet". (https://huggingface.co/gradium/phonon-31m-en-llamacpp README)
  - **phonon-31m-en-audiocpp:** phonon-31m-en-q8_0.gguf 85,204,768 and default-voice.safetensors. Its card also says the support is "not merged yet". (that repo's README)
- **Formats:** safetensors (bf16, per config `"dtype": "bfloat16"`) and GGUF (q8, q4k). **There is no ONNX in any gradium repo** (HF API tree for all 11 repos). Library tag `transformers`, class `GradiumPhononTTSForConditionalGeneration`; the card says to "Install 🤗 Transformers from source" (31m-en README).
- **Voices / speaker conditioning:**
  - Voices are precomputed embeddings: "`.safetensors` embedding … format `ba7a5a45@300`: one tensor `speaker_wavs`, 1×512×125, float32" (https://huggingface.co/gradium/phonon-voices README).
  - The catalogue has 102 voices: en 37 (including 12 "character" voices), fr 15, de 13, es 25, pt 12 (same README).
  - The embeddings are prepended to the prompt. `config.json` has `"fuser": {"prepend": ["transcript_in_segment","speaker_wavs"]}`, plus `num_speakers` (lut) and `duration_delta` (continuous) conditioners (https://huggingface.co/gradium/phonon-31m-en/resolve/main/config.json).
  - No local voice cloning: "Instant voice cloning and voice design are available through the Gradium studio" (31m-en README), and "No voice cloning: the Mimi encoder is not in the browser build" (xn-ptts `ptts-wasm/README.md`, "Known limits").
- **Unreleased sizes:** the phonon-voices README mentions sample folders for model sizes `31m`, `40m`, `56m` and `98m`. No 56m or 98m checkpoint is published (author listing above). Their existence and licence are **UNCONFIRMED**.
- **Name collision:** `FermionResearch/Phonon-2` and similar repos (MLX) are a different "Phonon", not by Gradium. Source: `curl "https://huggingface.co/api/models?search=phonon"`.

---

## Q2. Local Ollama tags → HF checkpoint and licence

Method:
- `ollama list`, `ollama show phonon:<tag>` / `-v` / `--license` / `--modelfile`.
- Registry manifests: `curl -H "Accept: application/vnd.docker.distribution.manifest.v2+json" https://registry.ollama.ai/v2/library/phonon/manifests/<tag>`.
- Each manifest layer has a per-tensor `name` and `digest`, so tags can be compared tensor by tensor.
- Every local digest matches the one listed at https://ollama.com/library/phonon/tags.

| Tag | Digest | Size | `ollama show` params | Layers | HF source (licence layer `Source:` line) | Licence |
|---|---|---|---|---|---|---|
| en | 6667dd188d2e | 103 MB | 41.12M | 6 | not named in the licence layer; config/tokenizer JSONs are byte-identical to `gradium/phonon-31m-en` main (sha256 compared) | **Apache 2.0** |
| 31m-en | 6667dd188d2e | 103 MB | 41.12M | 6 | same manifest as `en` | **Apache 2.0** |
| latest | 58f58601e4e8 | 112 MB | 43.49M | 6 | 31m-en tensors + 37 voices; 2nd licence layer: `gradium/phonon-voices@da6c9ec0…` | **Apache 2.0** (model + voices) |
| 40m-en | b74a4edf2fe2 | 131 MB | 52.93M | 9 | `gradium/phonon-40m-en@cc738b7e…` + phonon-voices | **CC BY-NC 4.0** (voices Apache) |
| es | d5df2ae8bc2d | 122 MB | 50.57M | 9 | `gradium/phonon-40m-es@516e9c7e…` | **CC BY-NC 4.0** |
| fr | da29147f2cba | 122 MB | 50.57M | 9 | `gradium/phonon-40m-fr@87f56c5c…` | **CC BY-NC 4.0** |
| de | 6ef2680491eb | 122 MB | 50.57M | 9 | `gradium/phonon-40m-de@5c413775…` | **CC BY-NC 4.0** |
| pt | e8fb87dea0cd | 122 MB | 50.57M | 9 | `gradium/phonon-40m-pt@7e7c4f7b…` | **CC BY-NC 4.0** |
| multilingual | eda44c0f4703 | 122 MB | 50.57M | 9 | `gradium/phonon-40m-multilingual@1537ce46…` | **CC BY-NC 4.0** |

Sources for the table:
- Licence text and `Source:` lines: `ollama show phonon:<tag> --license` (local) and the registry licence blobs `https://registry.ollama.ai/v2/library/phonon/blobs/<digest>`.
- Layer counts: `ollama show -v` field `gradium_phonon_tts.block_count` (6 for en, 31m-en, latest; 9 for the others).
- Params: the `parameters` line of `ollama show`.

**The discrepancy is resolved: `phonon:en` is the Apache 31M model.** The reasons:
1. **Same model as 31m-en.** `phonon:en` and `phonon:31m-en` have the same manifest digest, 6667dd188d2e. Sources: `ollama list`, the tags page, and the registry manifest sha256.
2. **The 41.12M count is the 31M backbone plus the codec decoder plus one voice.** Summing `ollama show phonon:en -v` tensor shapes by prefix gives:
   - `flow_lm.*` 30.76M (transformer 18.88M, flow_net 9.47M, condition_provider 2.39M, rest about 0.02M);
   - `mimi.*` 10.30M (decoder_transformer 6.29M, decoder 3.97M, quantizer/upsample 0.03M);
   - `voices.default` 0.064M (1×512×125);
   - total 41,124,992, which equals `general.parameter_count` 4.1124992e+07.
   - The ~31M flow LM matches the card's "31M (excluding the audio tokenizer)". The 10.30M Mimi decoder matches the HF `phonon-mimi` safetensors total of 10,305,313.
3. **The 40m tags follow the same pattern:** 50.57M = about 40.2M flow LM (transformer 28.32M with 9 layers) + 10.30M Mimi + one voice. `40m-en` (52.93M) and `latest` (43.49M) each add 37 voices × 64,000 = 2.37M.
4. **Licence text matches.** `ollama show phonon:en --license` is the plain Apache 2.0 text with no `Source:` header. Every 40m tag's licence starts with "Gradium gradium/phonon-40m-xx / Source: https://huggingface.co/… / Creative Commons Attribution-NonCommercial 4.0".
5. **The library page agrees.** It lists "`phonon` (`phonon:31m-en`, `phonon:en`) — English, 31M" and says "The 31M English checkpoint is released under Apache 2.0. The 40M … checkpoints are released under CC BY-NC 4.0" (https://ollama.com/library/phonon).

Other findings from comparing tensors (registry manifests, by tensor name):
- **`latest` is not byte-identical to `en`.** It contains all 186 of en's tensors unchanged plus 37 extra voice tensors (the 37 English catalogue voices; `ollama show phonon:latest` lists 38 voices including `default`). Same weights, so same Apache licence.
- **`en` vs `40m-en`:** the Mimi tensors and most of flow_net are identical. 48 transformer tensors and a few conditioner/head tensors differ, and 40m-en has 3 extra layers. These are different models.
- **The short language tags are not the same manifests as the `40m-xx` tags the library page calls their aliases.**
  - `es`/`fr`/`de` contain the same 210 tensors as `40m-es`/`40m-fr`/`40m-de`, except that `voices.default` differs. They also omit the per-language catalogue voices (25 / 15 / 13).
  - Their licence layers pin older HF revisions: es@516e9c7e vs 40m-es@f0d2f39c; fr@87f56c5c vs 40m-fr@d9108697; de@5c413775 vs 40m-de@79cfc7b4.
  - `pt` ⊂ `40m-pt` (+12 voices) and `multilingual` ⊂ `40m-multilingual` (+102 voices), on the same HF revisions.
  - The model weights are identical in every case; only the voices differ.
- **Ollama's runtime:** the packages "require Apple Silicon and Ollama 0.40.9 or later" (library page), and the manifest config is `"model_format":"safetensors","requires":"0.40.9","capabilities":["speech"]` (registry config blob). Weights are stored as one blob per tensor: flow LM BF16, Mimi F32 (`ollama show -v`).

---

## Q3. Architecture, text handling, runtimes, ONNX / browser feasibility

**What the model is**
- Phonon builds on Kyutai's Pocket TTS and the Mimi codec: "Phonon builds on Pocket TTS and the Mimi codec, developed by Kyutai" (31m-en README). The xn-ptts README credits Kyutai's "Continuous Audio Language Models" (https://github.com/gradium-ai/xn-ptts README, "Acknowledgements").
- It is **an autoregressive transformer over continuous Mimi latents with a flow-matching head. It does not use discrete codec tokens.**
  - Card: "A flow-matching transformer predicts audio latents from the text one 80 ms frame at a time, and the Mimi codec's decoder turns them into audio" (31m-en README).
  - config.json: `flow_lm.ldim: 32` (32-dim latent per frame), `flow_head_config.flow_type: "lsd"`, `lsd_decode_steps: 1`; generation_config `num_flow_steps: 1`, `temperature: 0.3`, `eos_threshold: 4.0`.
  - Ollama tensor names `flow_lm.flow_net.*` and `flow_lm.out_eos` (`ollama show -v`) match this.
- **Backbone:** d_model 512, 8 heads, ffn 2048, RoPE, 6 layers (31m) or 9 layers (40m); `max_position_embeddings` 8192 (config.json; `ollama show -v`).
- **Codec:** Mimi decoder at 24 kHz, `frame_rate: 12.5` (80 ms, 1920 samples per frame). It has a 2-layer transformer (context 250) and causal convs with ratios [6,5,4] (config.json `mimi`; https://huggingface.co/gradium/phonon-mimi/resolve/main/config.json: `sampling_rate 24000`, `use_causal_conv true`).
- **Output:** mono, 24 kHz (31m-en README; Ollama library page).
- **Streaming:** yes, frame by frame: "It streams audio while it is still generating" (31m-en README). The browser package yields "80 ms chunks of mono Float32Array" (https://github.com/gradium-ai/xn-ptts/blob/main/ptts-wasm/js/README.md).

**Text handling**
- **Tokenizer:** SentencePiece Unigram, 4000 pieces (+1 → `vocab_size` 4001), Metaspace pre-tokenizer, with byte fallback. Sources: HF `tokenizer.json` (`model.type: Unigram`, vocab 4000) and the onnx-community README ("Unigram with byte fallback"). Each 40m language has its own tokenizer (different tokenizer.json sizes, HF tree).
- **Normalisation lives in Gradium's runtime, not in the model or tokenizer.**
  - Card: "takes `lang`, which selects how text is normalized (numbers, symbols, dates)". The Transformers path does not do it: "Unlike the runtime, the tokenizer does not spell out numbers, amounts, symbols or addresses" (31m-en README).
  - The runtime source has rewrite modules for numbers, currency, dates, times, phones, emails, urls, tlds, abbreviations, dashed_digits and elongations (xn-ptts tree `ptts/src/preprocess/rewrite/*.rs`, `ptts/src/preprocess.rs` 73 KB).
  - The npm `rewrites` option defaults to "numbers, currency, dashed-digits, emails, urls, abbreviations, elongations". `'all'` adds phones, times and dates. "The rules only read 'en', 'fr', 'de', 'es' and 'pt'" (ptts-wasm/js README, API table).
  - Long text is split into sentence-aligned chunks of about 50 tokens (max 200), so "prosody does not carry across the whole text" (js README; 31m-en README "Limitations").
  - llama.cpp and audio.cpp builds pass text as written: "Write numbers, symbols and abbreviations out in words" (llamacpp and audiocpp READMEs).

**Official reference inference code (Gradium)**
- Source repo: https://github.com/gradium-ai/xn-ptts, licence MIT OR Apache-2.0 (GitHub API `license`; README "License"). Built on the `xn` Rust tensor runtime (README).
- **Rust** crate `ptts`; **Python** `ptts` (pyo3); **C/C++** `ptts.h` FFI; **Swift/Core ML**; **Android** (incl. Snapdragon QNN preview and a system TTS engine); OpenAI-compatible server; WebSocket server (31m-en README "Other platforms" table; repo tree).
- **Browser:** npm `phonon-tts`, version 0.6.0, licence `MIT OR Apache-2.0`, unpacked 18.2 MB (`curl https://registry.npmjs.org/phonon-tts/latest`). It is Rust compiled to WebAssembly (wasm-bindgen) and runs in a Web Worker.
  - CPU backend: WASM SIMD (Relaxed SIMD where available), optional threads on cross-origin-isolated pages (default 3 threads).
  - **WebGPU backend:** `device: 'webgpu'|'auto'`, needs q8 GGUF weights.
  - Caches files in the Cache API (ptts-wasm/README.md; ptts-wasm/js/README.md).
  - It is **not ONNX Runtime.**
- **PyTorch:** 🤗 Transformers `GradiumPhononTTSForConditionalGeneration` (from source, transformers 5.21.0.dev0 per config) (31m-en README).
- **Official browser demo:** HF Space https://huggingface.co/spaces/gradium/phonon. It is a static SDK app bundling the `phonon-tts` wasm build, with COOP/COEP headers set and `hf_oauth_scopes: ['gated-repos']` so it can load the 40m models after login (`curl https://huggingface.co/api/spaces/gradium/phonon`).
- **MLX:** none by Gradium. Searching HF for "phonon" found only unrelated FermionResearch Phonon MLX repos. **UNCONFIRMED** that no Gradium MLX port exists elsewhere.
- **Gated models in the browser:** "Private and gated repos cannot be loaded this way … That includes the Phonon 40m models. To use one, accept its terms …, download its files, and serve them with your app … under the model's license" (js README "The model").

**ONNX / transformers.js / WebGPU (community)**
- **onnx-community/phonon-31m-en-ONNX** (Apache-2.0, created 2026-10-21; HF API).
  - Two graphs, `flow_lm` and `mimi_decoder`. "Both graphs expose all their state (key/value caches, convolution context) as `past*` inputs and `present*` outputs."
  - dtypes: fp32 161 MB, q4 67 MB, q4f16 41 MB.
  - Has 102 voices as `.bin` files.
  - Claimed browser speed (M3 Max, Chrome), seconds of compute per second of audio: WebGPU q4f16 0.05–0.09, WASM fp32 0.08–0.10.
  - Claimed: "fp32 output matches the reference Rust runtime (`ptts`) sample for sample".
  - The `pipeline("text-to-speech")` route needs transformers.js PR #1811. A manual streaming loop works on transformers.js 4.2.0.
  - It **does not do the runtime's currency/email/symbol normalisation** ("`€5.50` comes out in dollars and the `@` of an address is skipped").
  - Source: https://huggingface.co/onnx-community/phonon-31m-en-ONNX/resolve/main/README.md.
- **transformers.js PR #1811** "Add Gradium Phonon text-to-speech pipeline support": state **open**, not merged as of 2026-11-01 (`curl https://api.github.com/repos/huggingface/transformers.js/pulls/1811`).
- **danyalmalik/Phonon-31M-EN-ONNX-WebGPU** (Apache-2.0).
  - Built "for running in a web browser with ONNX Runtime Web's WebGPU backend".
  - Three graphs: text_embed, flow_lm with `past_key_i`/`past_value_i` `[1,8,P,64]` for i = 0…5, and mimi_decoder with explicit streaming state. 27 MB total at 4-bit.
  - Whisper WER 6.8% vs 5.7% for the original.
  - Documents the full generation loop: voice prefill → text prefill → per-frame noise √0.3 → EOS logit > 4.0.
  - Source: that repo's README.
- **ai-ecoverse/phonon-31m-en-ONNX** (Apache-2.0, opset 17). Four graphs: text_conditioner, flow_lm_main, flow_lm_flow, mimi_decoder with 13 state tensors. Variants fp32 164 MB / q8 82 MB / q4 68 MB / fp16 82 MB. Includes the export recipe (`export/export.py`, parity scripts against ptts 0.4.1). Source: that repo's README and tree.
- **Also:** litert-community/phonon-31m-en (LiteRT/MediaPipe, int8, 84 MB) and many Pocket TTS ONNX exports (e.g. KevinAHM/pocket-tts-onnx, sherpa-onnx). Source: HF search API.
- **All community ONNX exports found are of the Apache 31m-en model. No ONNX export of any 40m (CC BY-NC) model was found** (HF search "phonon onnx"). Not exhaustive: **UNCONFIRMED** beyond that search.

**How hard is an ONNX export?** This is an assessment, not a sourced fact.
- It has already been done three times for 31m-en, with documented parity, so the open problems are solved:
  - the dynamic KV-cache loop (external past/present tensors per layer);
  - the 1-step LSD flow head (separate graph or folded in, noise as input);
  - the streaming Mimi decoder (conv and attention state exposed as I/O).
- The 40m checkpoints share the same architecture and Mimi weights (identical Mimi tensor digests across all Ollama tags), with 9 instead of 6 layers. Re-running one of those recipes on 40m weights should be mechanical. The licence, not the engineering, is the blocker there (Q4).
- The remaining gap for an ORT-Web integration is **text normalisation**: we would have to port or replicate `ptts/src/preprocess` in JS. The alternative is the official `phonon-tts` wasm package, which already includes normalisation, streaming and WebGPU, but brings its own runtime instead of ORT.

---

## Q4. Licences: CC BY-NC 4.0 terms, commercial licence, outputs

- **Legal code:** https://creativecommons.org/licenses/by-nc/4.0/legalcode (plain text: https://creativecommons.org/licenses/by-nc/4.0/legalcode.txt). Ollama ships the full text in each 40m tag's licence layer (`ollama show phonon:40m-en --license`).
- **Key clauses** (quoted from legalcode.txt):
  - §1(i) "**NonCommercial** means not primarily intended for or directed towards commercial advantage or monetary compensation."
  - §2(a)(1) licence to "a. reproduce and Share the Licensed Material, in whole or in part, for NonCommercial purposes only; and b. produce, reproduce, and Share Adapted Material for NonCommercial purposes only."
  - §1(a) "Adapted Material means material … derived from or based upon the Licensed Material and in which the Licensed Material is translated, altered, arranged, transformed, or otherwise modified…"
  - §3(a) requires attribution, a licence link and an indication of modifications when Sharing.
- **What it covers:** "The weights, tokenizer and voices in this repository" of each 40m repo (40m README "License"). Gradium's Ollama packages of 40m models also attach the phonon-voices **Apache 2.0** licence for the catalogue voices (second licence layer).
- **Commercial licence:** Gradium's Phonon page shows "CC BY-NC — For commercial use, talk to sales" for both 40m variants, and "Apache 2.0" for 31m (https://gradium.ai/phonon). Terms and pricing of that commercial licence are **UNCONFIRMED** (not public; requires contacting sales).
- **Generated audio outputs:**
  - **Apache 2.0 (31m-en, voices, mimi):** no clause restricting outputs (Apache 2.0 text, `ollama show phonon:en --license`).
  - **CC BY-NC 4.0:** has no explicit output clause. Whether audio synthesised by the model is "Adapted Material" or otherwise restricted is not addressed by the licence or by Gradium's cards. **UNCONFIRMED / legal question.** The safe reading for a commercial deployment is that running the 40m weights at all for a commercial purpose falls outside the licence grant, whatever the status of the outputs.
  - The gating-conditions text for the 40m repos (visible only after login) could add terms. **UNCONFIRMED.**
  - Gradium's cards add a "Responsible use" request (no impersonation, no cloning without consent, disclose synthetic speech where relevant) (31m-en README). This is not phrased as a licence term.
- **Upstream:** Pocket TTS (Kyutai) weights are licensed `cc-by-4.0` on HF (`curl https://huggingface.co/api/models/kyutai/pocket-tts` → `cardData.license`); the code is MIT (GitHub API kyutai-labs/pocket-tts). Gradium relicensed its own trained weights, so the 31m Apache grant is from Gradium (31m-en README).
- **For our use case** (reader web app, likely commercial or institutional): only **phonon-31m-en (English, Apache 2.0)** and the **phonon-voices (Apache 2.0)** are clearly usable without a deal. All non-English Phonon models are 40m CC BY-NC.

---

## Q5. Supertonic (for comparison)

- **Repo status:** https://github.com/supertone-inc/supertonic 301-redirects to https://github.com/supertone-oss-archive/supertonic (`curl -sI`). The repo is **archived** (GitHub API `archived: true`). The README says: "This repository is archived. Development and support have ended … No updates, bug fixes, security patches, or support will be provided."
- **Code licence:** MIT ("Copyright (c) 2025 Supertone Inc."; GitHub API `license: mit`; raw LICENSE).
- **Weights licence:** BigScience **OpenRAIL-M** ("The accompanying model is released under the OpenRAIL-M License", README "License"; HF `license: openrail`).
  - The same LICENSE file (15,007 bytes, byte-identical between v1 and v3 per `cmp`) is in `Supertone/supertonic` (HF), `supertone-oss-archive/supertonic`, `-2` and `-3`.
  - OpenRAIL-M permits commercial use but carries use-based restrictions (Attachment A) that must flow down to derivatives.
  - On outputs it says: "§III.6 … Licensor claims no rights in the Output You generate using the Model … No use of the output can contravene any provision" (HF supertonic-3 LICENSE).
- **HF repos:** `Supertone/supertonic` (v1, en; same file list as `supertone-oss-archive/supertonic`), `supertone-oss-archive/supertonic-2`, `supertone-oss-archive/supertonic-3` (HF API).
- **Versions** (README "Models & Versions" table):

  | | Supertonic 3 | Supertonic 2 | Supertonic 1 |
  |---|---|---|---|
  | Params | ~99M | ~66M | ~66M |
  | Languages | 31 | 5 (en, ko, es, pt, fr per HF `language`) | 1 (en) |

  Supertonic 3's 31 languages are ar, bg, hr, cs, da, nl, en, et, fi, fr, de, el, hi, hu, id, it, ja, ko, lv, lt, pl, pt, ro, ru, sk, sl, es, sv, tr, uk, vi, plus `lang="na"` for language-agnostic input (README "Supported Languages").
- **Format / runtime:** ONNX only. v1 files: text_encoder.onnx 27.3 MB, duration_predictor.onnx 1.5 MB, vector_estimator.onnx 132.5 MB, vocoder.onnx 101.4 MB, plus 10 voice-style JSONs (F1–F5, M1–M5) (HF tree `Supertone/supertonic`). "Browser Support: onnxruntime-web for client-side inference" (README).
- **Voice cloning:** none in the open weights. Voice Builder was a hosted service, and "This archive does not include hosted demos or Voice Builder services" (README).
