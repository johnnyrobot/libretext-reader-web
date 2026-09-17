import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { AVAILABLE_LANGS, loadTextToSpeechFromBuffers, loadVoiceStyleFromJson } from '../src/vendor/helper.js';

describe('vendored Supertonic helper', () => {
  it('keeps its MIT provenance header', () => {
    const source = readFileSync('src/vendor/helper.js', 'utf8');
    expect(source).toMatch(/supertone-inc\/supertonic/);
    expect(source).toMatch(/MIT/);
  });

  it('exposes the 31 languages plus the neutral tag', () => {
    expect(AVAILABLE_LANGS).toContain('en');
    expect(AVAILABLE_LANGS).toContain('es');
    expect(AVAILABLE_LANGS).toContain('fr');
    expect(AVAILABLE_LANGS.length).toBe(32);
  });

  it('exports buffer-based loaders so ONNX Runtime never fetches a URL itself', () => {
    expect(typeof loadTextToSpeechFromBuffers).toBe('function');
    expect(typeof loadVoiceStyleFromJson).toBe('function');
  });

  it('does not depend on fft.js', () => {
    const source = readFileSync('src/vendor/helper.js', 'utf8');
    expect(source).not.toMatch(/fft\.js|from ['"]fft/);
  });
});
