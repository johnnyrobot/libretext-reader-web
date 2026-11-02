import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { supertonicFiles } from '../scripts/check-no-supertonic.mjs';

// LT-217: Supertonic leaves Listen mode completely. The check runs on the build
// output and on the staged /_assets/tts/ layout, so it is tested on both shapes.
describe('supertonicFiles', () => {
  let root;
  const put = (path, body = '') => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), body);
  };

  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'lt217-check-')); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it('passes the Phonon-only layout', () => {
    put('reader.js', "const w = '/_assets/tts/phonon.worker.js';");
    put('phonon.worker.js');
    put('translate.worker.js');
    put('boot.js');
    put('reader.css');
    put('phonon/manifest.json', '{"files":[]}');
    put('phonon/onnx/flow_lm_main.onnx');
    put('phonon/voices/qIxlZ7Ei8KvWlyQH.bin');
    put('ort-mt/ort-wasm-simd-threaded.wasm');
    put('mt/en-pt/manifest.json', '{"files":[]}');
    put('mt/pairs.json', '{"pairs":[]}');
    expect(supertonicFiles(root)).toEqual([]);
  });

  it('given a whole stage, checks its /_assets/tts/, where the root-only names live', () => {
    // Pointed at the stage rather than its tts folder, the root-only names
    // (manifest.json, onnx/, ort/) would be looked for in the wrong place.
    put('_assets/tts/manifest.json', '{"files":[]}');
    put('_assets/tts/ort/ort-wasm-simd.wasm');
    put('_assets/tts/phonon/manifest.json', '{"files":[]}');
    put('social_psychology/index.html');
    expect(supertonicFiles(root)).toEqual(['manifest.json', 'ort/ort-wasm-simd.wasm']);
  });

  it('names every Supertonic file the old layout carried', () => {
    put('engine.worker.js');
    put('manifest.json', '{"files":[]}');
    put('onnx/vocoder.onnx');
    put('onnx/unicode_indexer.json');
    put('voice_styles/M1.json');
    put('ort/ort-wasm-simd.wasm');
    expect(supertonicFiles(root)).toEqual([
      'engine.worker.js',
      'manifest.json',
      'onnx/unicode_indexer.json',
      'onnx/vocoder.onnx',
      'ort/ort-wasm-simd.wasm',
      'voice_styles/M1.json',
    ]);
  });

  it('names a Supertonic file copied in at any depth', () => {
    put('phonon/onnx/vocoder.onnx');
    put('phonon-fr/onnx/duration_predictor.onnx');
    put('mt/en-fr/voice_styles/F1.json');
    put('phonon-de/engine.worker.js');
    put('phonon-de/manifest.json', '{"files":[]}');
    expect(supertonicFiles(root)).toEqual([
      'mt/en-fr/voice_styles/F1.json',
      'phonon-de/engine.worker.js',
      'phonon-fr/onnx/duration_predictor.onnx',
      'phonon/onnx/vocoder.onnx',
    ]);
  });

  it('names built code that still points at a Supertonic asset', () => {
    put('reader.js', "fetch('/_assets/tts/manifest.json')");
    put('chunk.js', "new Worker('/_assets/tts/engine.worker.js')");
    put('other.js', "fetch(`/_assets/tts/voice_styles/${v}.json`)");
    expect(supertonicFiles(root)).toEqual(['chunk.js', 'other.js', 'reader.js']);
  });
});
