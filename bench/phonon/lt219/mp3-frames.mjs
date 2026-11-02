// THROWAWAY SPIKE (LT-219). Read the frame headers of an MPEG audio file, so a test
// can say what a saved MP3 is without decoding it.
//
// Written from the MPEG-1/2 Layer III header layout (ISO/IEC 11172-3 and 13818-3),
// not from the encoder, so it can disagree with what lamejs writes.

const VERSIONS = { 0b00: 2.5, 0b10: 2, 0b11: 1 };
const RATES = {
  1: [44100, 48000, 32000],
  2: [22050, 24000, 16000],
  2.5: [11025, 12000, 8000],
};
// Layer III bitrates in kbps, by bitrate index 1-14.
const KBPS = {
  1: [32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  2: [8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};

/**
 * Every frame of `bytes` (a Uint8Array) in order, as
 * { version, sampleRate, kbps, mono, samples, length }. Throws on anything that is not
 * a run of Layer III frames from the first byte to the last: no ID3 tag, no garbage.
 */
export function mp3Frames(bytes) {
  const frames = [];
  for (let at = 0; at < bytes.length;) {
    if (at + 4 > bytes.length) throw new Error(`truncated header at byte ${at}`);
    const [a, b, c, d] = bytes.subarray(at, at + 4);
    if (a !== 0xff || (b & 0xe0) !== 0xe0) throw new Error(`no frame sync at byte ${at}`);
    const version = VERSIONS[(b >> 3) & 0b11];
    if (!version) throw new Error(`reserved MPEG version at byte ${at}`);
    if (((b >> 1) & 0b11) !== 0b01) throw new Error(`not Layer III at byte ${at}`);
    const index = c >> 4;
    const sampleRate = RATES[version][(c >> 2) & 0b11];
    const kbps = KBPS[version === 1 ? 1 : 2][index - 1];
    if (!kbps || !sampleRate) throw new Error(`bad bitrate or sample rate at byte ${at}`);
    const padding = (c >> 1) & 1;
    const samples = version === 1 ? 1152 : 576;
    const length = Math.floor((samples / 8) * kbps * 1000 / sampleRate) + padding;
    frames.push({ version, sampleRate, kbps, mono: d >> 6 === 0b11, samples, length });
    at += length;
  }
  if (!frames.length) throw new Error('no frames');
  return frames;
}

/** Seconds of audio the frames carry. */
export const mp3Seconds = (frames) => frames.reduce((total, f) => total + f.samples / f.sampleRate, 0);
