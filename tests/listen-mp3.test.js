// @vitest-environment node
// LT-219: the LT-216 listening page saves MP3. The seam is the encoder Worker's
// messages (bench/phonon/listen/mp3.worker.js), run here in a vm context that stands
// in for a classic Worker; the page itself is checked in Chrome by
// bench/phonon/lt219/check-save.mjs.
import { describe, it, expect } from 'vitest';
import { Blob } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { mp3Frames, mp3Seconds } from '../bench/phonon/lt219/mp3-frames.mjs';

const LISTEN = new URL('../bench/phonon/listen/', import.meta.url);
const LAME = new URL('vendor/lamejs/lame.min.js', LISTEN);
const RATE = 24000;
const WITHIN = 0.1;   // seconds an MP3 may differ from its render (LT-219)

/** mp3.worker.js in a context like a classic Worker's: replies come back as promises. */
function startWorker() {
  const replies = [];
  const self = {
    postMessage: (data) => replies.shift()(data),
    importScripts: (...urls) => {
      for (const url of urls) vm.runInContext(readFileSync(new URL(url, LISTEN), 'utf8'), context, { filename: url });
    },
    Blob,
  };
  const context = vm.createContext(self);
  self.self = self;
  vm.runInContext(readFileSync(new URL('mp3.worker.js', LISTEN), 'utf8'), context);
  return (message) => new Promise((resolve) => {
    replies.push(resolve);
    self.onmessage({ data: message });
  });
}

const tone = (seconds, amplitude = 0.4) => Float32Array.from(
  { length: Math.round(seconds * RATE) }, (_, i) => amplitude * Math.sin((2 * Math.PI * 220 * i) / RATE));

async function bytesOf(reply) {
  expect(reply.error).toBeUndefined();
  expect(reply.mp3.type).toBe('audio/mpeg');
  return new Uint8Array(await reply.mp3.arrayBuffer());
}

// Encoding is synchronous and slow on a busy machine; a stuck run still fails.
describe('the listening page MP3 encoder', { timeout: 60_000 }, () => {
  it('encodes the 24 kHz mono render as 112 kbps CBR MPEG-2 Layer III, as long as the render', async () => {
    const encode = startWorker();
    const frames = mp3Frames(await bytesOf(await encode({ id: 'a', samples: tone(2.5), sampleRate: RATE })));
    for (const frame of frames) expect(frame).toMatchObject({ version: 2, sampleRate: 24000, kbps: 112, mono: true });
    expect(Math.abs(mp3Seconds(frames) - 2.5)).toBeLessThan(WITHIN);
  });

  it('answers each Save with its own file, under the id it was asked with', async () => {
    const encode = startWorker();
    const long = await encode({ id: 'long', samples: tone(3), sampleRate: RATE });
    const short = await encode({ id: 'short', samples: tone(1), sampleRate: RATE });
    expect([long.id, short.id]).toEqual(['long', 'short']);
    expect(Math.abs(mp3Seconds(mp3Frames(await bytesOf(short))) - 1)).toBeLessThan(WITHIN);
  });

  it('takes samples past full scale without failing', async () => {
    const encode = startWorker();
    const frames = mp3Frames(await bytesOf(await encode({ id: 'loud', samples: tone(1, 1.6), sampleRate: RATE })));
    expect(Math.abs(mp3Seconds(frames) - 1)).toBeLessThan(WITHIN);
  });

  it('weighs about 0.84 MB a minute of speech (112 kbps)', async () => {
    const encode = startWorker();
    const bytes = await bytesOf(await encode({ id: 'ten', samples: tone(10), sampleRate: RATE }));
    expect((bytes.length * 6) / 1e6).toBeCloseTo(0.84, 2);
  });
});

describe('the vendored LAME encoder', () => {
  it('is lamejs 1.2.1 lame.min.js, unmodified', () => {
    // sha256 of package/lame.min.js in https://registry.npmjs.org/lamejs/-/lamejs-1.2.1.tgz
    expect(createHash('sha256').update(readFileSync(LAME)).digest('hex'))
      .toBe('15d285e2587b3bdbfd18a68de6ce07cc074f7480a82c3815da2dc1c348ec6df4');
  });

  it('ships with its licence texts beside it', () => {
    const text = (name) => readFileSync(new URL(`vendor/lamejs/${name}`, LISTEN), 'utf8');
    expect(text('COPYING.LESSER')).toMatch(/GNU LESSER GENERAL PUBLIC LICENSE\s+Version 3, 29 June 2007/);
    expect(text('COPYING')).toMatch(/GNU GENERAL PUBLIC LICENSE\s+Version 3, 29 June 2007/);
    expect(text('LICENSE')).toMatch(/LGPL/);
  });
});
