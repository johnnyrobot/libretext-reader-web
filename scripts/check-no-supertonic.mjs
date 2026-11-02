#!/usr/bin/env node
/**
 * Fail if a Supertonic file is in a /_assets/tts/ tree (LT-217).
 *
 *   node scripts/check-no-supertonic.mjs dist/_assets/tts     the build
 *   node scripts/check-no-supertonic.mjs .stage/_assets/tts   the staged layout
 *
 * Listen mode runs Phonon only, with no fallback, so nothing Supertonic used
 * may ship: its worker, its manifest at the root, its onnx/ and voice_styles/,
 * and the ONNX Runtime 1.17 copy in ort/ that only its worker loaded. Phonon's
 * own files live under phonon/, and the translator's runtime under ort-mt/.
 *
 * Built code is checked too, for a URL that still points at one of those
 * files. The word "Supertonic" itself is not searched for: transformers.js,
 * which the workers bundle, supports Supertonic models by name, and that is
 * code we never call, not a file we ship.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const FILES = new Set(['engine.worker.js', 'manifest.json']);
const DIRS = new Set(['onnx', 'voice_styles', 'ort']);
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

/** Paths under `root`, relative and sorted, that are or point at Supertonic. */
export function supertonicFiles(root) {
  return walk(root)
    .map((path) => relative(root, path).split(sep).join('/'))
    .filter((path) => {
      const [top] = path.split('/');
      if (FILES.has(path) || (path.includes('/') && DIRS.has(top))) return true;
      if (!path.endsWith('.js')) return false;
      const code = readFileSync(join(root, path), 'utf8');
      return URLS.some((url) => code.includes(url));
    })
    .sort();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = process.argv[2];
  if (!root) {
    console.error('usage: check-no-supertonic.mjs <_assets/tts dir>');
    process.exit(2);
  }
  const found = supertonicFiles(root);
  if (found.length) {
    console.error(`Supertonic is still in ${root}:\n${found.map((p) => `  ${p}`).join('\n')}`);
    process.exit(1);
  }
  console.log(`no Supertonic files in ${root}`);
}
