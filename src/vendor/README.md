# Vendored from supertone-inc/supertonic

`helper.js` is copied from https://github.com/supertone-inc/supertonic (`web/helper.js`),
licensed **MIT**. It is the reference implementation of Supertonic's inference path —
the same algorithm the desktop LibreTexts Reader implements in Rust.

Local modifications, each marked with a `LIBRETEXTS:` comment in the source:

1. `loadTextToSpeechFromBuffers` / `loadVoiceStyleFromJson` added. Upstream's
   `loadTextToSpeech` passes a **URL** to `ort.InferenceSession.create`, which makes ONNX
   Runtime fetch the file itself and bypass our Cache Storage entirely. The added functions
   take `ArrayBuffer`s supplied by `src/models.mjs` instead. Upstream's originals are left
   in place, unused, so diffing against a future upstream version stays easy.

`fft.js` is listed in upstream's `package.json` and referenced nowhere in `helper.js` or
`main.js`. It is deliberately not installed here.

Update procedure: re-download the file, re-apply the two additions, re-run
`npx vitest run tests/vendor.test.js`.
