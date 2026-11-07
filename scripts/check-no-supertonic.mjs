#!/usr/bin/env node
/**
 * Fail if a Supertonic file is in a /_assets/tts/ tree (LT-217).
 *
 *   node scripts/check-no-supertonic.mjs dist/_assets/tts     the build
 *   node scripts/check-no-supertonic.mjs .stage/_assets/tts   the staged layout
 *
 * Given a whole stage instead, it checks that stage's _assets/tts/: the
 * root-only names below mean the root of /_assets/tts/.
 *
 * Listen mode runs Phonon only, with no fallback, so nothing Supertonic used
 * may ship: its worker, its manifest at the root, its onnx/ and voice_styles/,
 * and the ONNX Runtime 1.17 copy in ort/ that only its worker loaded. Phonon's
 * own files live under phonon/, its runtime under ort-mt/, and the translator
 * (Firefox Translations, LT-255) under mt/.
 *
 * Built code is checked too, for a URL that still points at one of those
 * files. The word "Supertonic" itself is not searched for: transformers.js,
 * which the workers bundle, supports Supertonic models by name, and that is
 * code we never call, not a file we ship.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// At the top level, where Supertonic lived. Phonon has its own manifest.json
// and onnx/ one level down, so these names are not searched for below it.
const FILES = new Set(['manifest.json']);
const DIRS = new Set(['onnx', 'ort']);
// Supertonic's alone, so a copy anywhere in the tree is named: its worker,
// its four networks and its voice styles. Phonon's networks are flow_lm and
// mimi_decoder; the translator's are model.en*.bin under mt/.
const ANYWHERE_FILES = new Set([
  'engine.worker.js',
  'duration_predictor.onnx', 'text_encoder.onnx', 'vector_estimator.onnx', 'vocoder.onnx',
]);
const ANYWHERE_DIRS = new Set(['voice_styles']);
const URLS = [
  '/_assets/tts/engine.worker.js',
  '/_assets/tts/manifest.json',
  '/_assets/tts/voice_styles/',
  '/_assets/tts/onnx/',
  '/_assets/tts/ort/',
];

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

/** `dir` itself, or its _assets/tts/ when `dir` is a whole stage or build. */
export function ttsRoot(dir) {
  const tts = join(dir, '_assets', 'tts');
  return existsSync(tts) ? tts : dir;
}

/** Paths under the tts root of `dir`, relative and sorted, that are or point at Supertonic. */
export function supertonicFiles(dir) {
  const root = ttsRoot(dir);
  return walk(root)
    .map((path) => relative(root, path).split(sep).join('/'))
    .filter((path) => {
      const parts = path.split('/');
      const [top] = parts;
      if (FILES.has(path) || (path.includes('/') && DIRS.has(top))) return true;
      if (ANYWHERE_FILES.has(parts.at(-1))) return true;
      if (parts.slice(0, -1).some((dir) => ANYWHERE_DIRS.has(dir))) return true;
      if (!path.endsWith('.js')) return false;
      const code = readFileSync(join(root, path), 'utf8');
      return URLS.some((url) => code.includes(url));
    })
    .sort();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  if (!dir) {
    console.error('usage: check-no-supertonic.mjs <_assets/tts dir>');
    process.exit(2);
  }
  const root = ttsRoot(dir);
  const found = supertonicFiles(root);
  if (found.length) {
    console.error(`Supertonic is still in ${root}:\n${found.map((p) => `  ${p}`).join('\n')}`);
    process.exit(1);
  }
  console.log(`no Supertonic files in ${root}`);
}
