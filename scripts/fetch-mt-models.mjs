#!/usr/bin/env node
/**
 * Fetch the translation engine and models the reader serves (LT-255).
 *
 *   node scripts/fetch-mt-models.mjs [OUT_DIR] [--langs fr,de,es,pt]
 *
 * OUT_DIR defaults to bench/assets/mt-bergamot. It ends up with this layout,
 * which scripts/stage-local.sh copies to _assets/tts/mt/ unchanged:
 *
 *   pairs.json                 the menu: one entry per pair, with its size and licence
 *   bergamot/manifest.json     the engine, shared by every pair
 *   bergamot/bergamot-translator.wasm
 *   en-fr/manifest.json        one directory per pair: model, lex, vocab
 *   en-fr/model.enfr.intgemm.alphas.bin ...
 *
 * Every file is the one pinned in scripts/mt-models.lock.json. These are Mozilla's
 * Firefox Translations files, published through Firefox's Remote Settings
 * attachment CDN. The models are zstd-compressed upstream. Each one is checked
 * twice against Mozilla's own hashes: once as downloaded, and again after
 * decompression. Only then is it written out. A mismatch stops the run before
 * anything is written for that pair, so a half-fetched pair can never reach
 * pairs.json.
 *
 * The CDN is contacted HERE, at staging time, and never by a reader: the reader
 * downloads these files from our own origin, and models.mjs checks the same
 * sha256 again in the browser.
 *
 * Needs Node 22.15 or newer for zlib's zstd. No other dependencies.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LOCK = JSON.parse(readFileSync(join(ROOT, 'scripts/mt-models.lock.json'), 'utf8'));

const args = process.argv.slice(2);
const langsAt = args.indexOf('--langs');
const langs = langsAt >= 0 ? args.splice(langsAt, 2)[1].split(',') : null;
const OUT = resolve(args[0] ?? join(ROOT, 'bench/assets/mt-bergamot'));

if (typeof zlib.zstdDecompressSync !== 'function') {
  console.error(`Node ${process.version} has no zstd; use Node 22.15 or newer`);
  process.exit(1);
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

async function download(location, bytes, hash) {
  const url = new URL(location, LOCK.attachmentsBase);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength !== bytes || sha256(buf) !== hash) {
    throw new Error(`${url}: got ${buf.byteLength} bytes, sha256 ${sha256(buf)}; pinned ${bytes}, ${hash}`);
  }
  return buf;
}

/** Write a directory's files under a temporary name, then rename it into place,
 * so an interrupted run leaves the previous copy rather than a mixture. */
function writeDir(dir, files) {
  const tmp = `${dir}.partial`;
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  for (const [name, data] of Object.entries(files)) writeFileSync(join(tmp, name), data);
  rmSync(dir, { recursive: true, force: true });
  renameSync(tmp, dir);
}

const manifestFile = (name, path, buf) => ({ name, path, bytes: buf.byteLength, sha256: sha256(buf) });

mkdirSync(OUT, { recursive: true });

// The engine. The wasm is not compressed upstream.
const { engine } = LOCK;
const wasm = await download(engine.location, engine.bytes, engine.sha256);
const engineManifest = {
  version: 1,
  engine: 'bergamot',
  source: {
    name: engine.name, version: engine.version, recordId: engine.recordId,
    licence: engine.licence, glue: engine.glue,
  },
  files: [manifestFile('wasm', 'bergamot-translator.wasm', wasm)],
};
writeDir(join(OUT, 'bergamot'), {
  'bergamot-translator.wasm': wasm,
  'manifest.json': `${JSON.stringify(engineManifest, null, 2)}\n`,
});
console.log(`bergamot ${engine.version}: ${(wasm.byteLength / 1e6).toFixed(1)} MB`);

const pairs = [];
for (const [pair, spec] of Object.entries(LOCK.pairs)) {
  if (langs && !langs.includes(spec.code)) continue;
  const files = {};
  const listed = [];
  for (const file of spec.files) {
    const packed = await download(file.location, file.bytes, file.sha256);
    const data = zlib.zstdDecompressSync(packed);
    if (data.byteLength !== file.decompressedBytes || sha256(data) !== file.decompressedSha256) {
      throw new Error(`${file.name}: decompressed to ${data.byteLength} bytes, sha256 ${sha256(data)}`);
    }
    files[file.name] = data;
    listed.push(manifestFile(file.fileType, file.name, data));
  }
  const manifest = {
    version: 1,
    pair,
    engine: 'bergamot',
    source: {
      project: 'Firefox Translations', version: spec.version, architecture: spec.architecture,
      licence: spec.licence, recordIds: Object.fromEntries(spec.files.map((f) => [f.fileType, f.recordId])),
    },
    files: listed,
  };
  writeDir(join(OUT, pair), { ...files, 'manifest.json': `${JSON.stringify(manifest, null, 2)}\n` });
  const modelBytes = listed.reduce((sum, f) => sum + f.bytes, 0);
  // `bytes` is what the language menu and the consent dialog quote, so it counts
  // the engine too: a reader's first translation downloads both. A reader who
  // already has the engine is told about 5 MB more than they fetch, which the
  // whole-megabyte rounding mostly hides; telling them less is the worse error.
  pairs.push({ code: spec.code, pair, bytes: modelBytes + wasm.byteLength, licence: spec.licence });
  console.log(`${pair}: ${(modelBytes / 1e6).toFixed(1)} MB`);
}

pairs.sort((a, b) => a.code.localeCompare(b.code));
writeFileSync(join(OUT, 'pairs.json'), `${JSON.stringify({ version: 1, pairs }, null, 2)}\n`);
console.log(`wrote ${OUT}`);
