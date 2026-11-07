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
 * decompression.
 *
 * Nothing is written until EVERYTHING has been fetched and checked, so a failed
 * run leaves OUT_DIR exactly as it was. OUT_DIR then holds the pairs this run
 * fetched and no others: with --langs, a pair left over from an earlier run is
 * removed, so pairs.json and the directories always agree and staging cannot
 * ship a model the menu does not offer.
 *
 * The CDN is contacted HERE, at staging time, and never by a reader: the reader
 * downloads these files from our own origin, and models.mjs checks the same
 * sha256 again in the browser.
 *
 * Needs Node 22.15 or newer for zlib's zstd. No other dependencies.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LOCK = JSON.parse(readFileSync(join(ROOT, 'scripts/mt-models.lock.json'), 'utf8'));

const KNOWN = Object.values(LOCK.pairs).map((spec) => spec.code);

function usage(message) {
  console.error(`${message}\nusage: node scripts/fetch-mt-models.mjs [OUT_DIR] [--langs ${KNOWN.join(',')}]`);
  process.exit(2);
}

const args = process.argv.slice(2);
let langs = null;
const positional = [];
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === '--langs' || arg.startsWith('--langs=')) {
    const value = arg === '--langs' ? args[(i += 1)] : arg.slice('--langs='.length);
    langs = (value ?? '').split(',').filter(Boolean);
    const unknown = langs.filter((code) => !KNOWN.includes(code));
    if (!langs.length || unknown.length) usage(`--langs needs codes from the lock file; got "${value ?? ''}"`);
  } else if (arg.startsWith('-')) {
    usage(`unknown option ${arg}`);
  } else {
    positional.push(arg);
  }
}
if (positional.length > 1) usage(`one OUT_DIR at most; got ${positional.join(' ')}`);
const OUT = resolve(positional[0] ?? join(ROOT, 'bench/assets/mt-bergamot'));

if (typeof zlib.zstdDecompressSync !== 'function') {
  console.error(`Node ${process.version} has no zstd; use Node 22.15 or newer`);
  process.exit(1);
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** Stop unless `buf` is exactly the pinned file. */
function verify(buf, bytes, hash, label) {
  if (buf.byteLength !== bytes || sha256(buf) !== hash) {
    throw new Error(`${label}: got ${buf.byteLength} bytes, sha256 ${sha256(buf)}; pinned ${bytes}, ${hash}`);
  }
  return buf;
}

async function download(location, bytes, hash) {
  const url = new URL(location, LOCK.attachmentsBase);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return verify(Buffer.from(await res.arrayBuffer()), bytes, hash, String(url));
}

const asJson = (value) => `${JSON.stringify(value, null, 2)}\n`;

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

// Directory name -> { file name: contents }, written only once all of it is in.
const dirs = {};

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
dirs.bergamot = { 'bergamot-translator.wasm': wasm, 'manifest.json': asJson(engineManifest) };
console.log(`bergamot ${engine.version}: ${(wasm.byteLength / 1e6).toFixed(1)} MB`);

const pairs = [];
for (const [pair, spec] of Object.entries(LOCK.pairs)) {
  if (langs && !langs.includes(spec.code)) continue;
  const files = {};
  const listed = [];
  for (const file of spec.files) {
    const packed = await download(file.location, file.bytes, file.sha256);
    const data = verify(zlib.zstdDecompressSync(packed), file.decompressedBytes, file.decompressedSha256,
      `${file.name}, decompressed`);
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
  dirs[pair] = { ...files, 'manifest.json': asJson(manifest) };
  const modelBytes = listed.reduce((sum, f) => sum + f.bytes, 0);
  // `bytes` is what the language menu and the consent dialog quote, so it counts
  // the engine too: a reader's first translation downloads both. A reader who
  // already has the engine is told about 5 MB more than they fetch, which the
  // whole-megabyte rounding mostly hides; telling them less is the worse error.
  pairs.push({ code: spec.code, pair, bytes: modelBytes + wasm.byteLength, licence: spec.licence });
  console.log(`${pair}: ${(modelBytes / 1e6).toFixed(1)} MB`);
}

pairs.sort((a, b) => a.code.localeCompare(b.code));

// Everything is fetched and checked; now, and only now, write.
mkdirSync(OUT, { recursive: true });
for (const [name, files] of Object.entries(dirs)) writeDir(join(OUT, name), files);
for (const entry of readdirSync(OUT, { withFileTypes: true })) {
  if (entry.isDirectory() && /^en-[a-z]+$/.test(entry.name) && !dirs[entry.name]) {
    rmSync(join(OUT, entry.name), { recursive: true, force: true });
    console.log(`removed ${entry.name}, which this run did not fetch`);
  }
}
writeFileSync(join(OUT, 'pairs.json'), asJson({ version: 1, pairs }));
console.log(`wrote ${OUT}`);
