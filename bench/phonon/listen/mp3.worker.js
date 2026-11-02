// THROWAWAY SPIKE (LT-219). The listening page's Save: encode one render as MP3.
//
// A classic Worker, not a module, so it can load lamejs with importScripts:
// vendor/lamejs/lame.min.js is LGPL-3.0 and stays an unmodified file of its own,
// never bundled into this MIT code (see vendor/lamejs/README.md). The page starts
// this Worker on the first Save, so nothing downloads the encoder before then.
//
// Chrome cannot encode MP3 itself: WebCodecs' AudioEncoder.isConfigSupported says no
// to 'mp3', and MediaRecorder offers no audio/mpeg (Chrome 156, 2026-11-01).
//
//   in:  { id, samples: Float32Array, sampleRate }
//   out: { id, mp3: Blob } or { id, error }
//
// The samples are encoded as rendered: at their own rate (24 kHz for Phonon, which
// LAME writes as MPEG-2 Layer III), mono, constant 112 kbps, with no resampling.
importScripts('vendor/lamejs/lame.min.js');

const KBPS = 112;   // lamejs at 64 kbps lost 0.04-0.06 WER in fr/de/es/pt; 112 keeps every language within 0.01 (LT-219)
const BLOCK = 1152;   // samples handed to LAME at a time, as lamejs's own examples do

self.onmessage = ({ data: { id, samples, sampleRate } }) => {
  try {
    const encoder = new lamejs.Mp3Encoder(1, sampleRate, KBPS);
    const pcm = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i++) pcm[i] = Math.max(-1, Math.min(1, samples[i])) * 0x7fff;
    const parts = [];
    for (let at = 0; at < pcm.length; at += BLOCK) parts.push(encoder.encodeBuffer(pcm.subarray(at, at + BLOCK)));
    parts.push(encoder.flush());
    self.postMessage({ id, mp3: new Blob(parts, { type: 'audio/mpeg' }) });
  } catch (error) {
    self.postMessage({ id, error: String(error?.message ?? error) });
  }
};
