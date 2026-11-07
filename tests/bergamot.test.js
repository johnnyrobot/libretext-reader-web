// @vitest-environment node
/**
 * The real engine on the real files (LT-255). Everything else in the worker's
 * tests stubs the model out; this is the one place the glue, the wasm and a
 * Firefox Translations model are run together, so a vendoring mistake (a glue
 * the build no longer rewrites, a wrong alignment, a config Bergamot rejects)
 * fails here rather than only in a browser.
 *
 * It needs the files `node scripts/fetch-mt-models.mjs` writes, which are not in
 * git (~42 MB a pair). Without them it is skipped, and says so.
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll } from 'vitest';
import { createBergamotSession, engineError, startEngine } from '../src/translate.worker.mjs';

const ROOT = new URL('../bench/assets/mt-bergamot/', import.meta.url);
const present = existsSync(new URL('bergamot/manifest.json', ROOT)) && existsSync(new URL('en-fr/manifest.json', ROOT));

/** The same `{name: ArrayBuffer}` shape ensureModels hands the worker. */
function buffers(dir) {
  const manifest = JSON.parse(readFileSync(new URL(`${dir}/manifest.json`, ROOT), 'utf8'));
  return Object.fromEntries(manifest.files.map(({ name, path }) => {
    const bytes = readFileSync(new URL(`${dir}/${path}`, ROOT));
    return [name, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)];
  }));
}

describe.skipIf(!present)('Bergamot, en-fr', () => {
  let translate;

  beforeAll(async () => {
    const bergamot = await startEngine(buffers('bergamot').wasm);
    translate = createBergamotSession(bergamot, buffers('en-fr'), 'en', 'fr');
  }, 60_000);

  it('translates one line for every line, in order', async () => {
    const out = await translate(['The cell is the basic unit of life.', 'Water boils at sea level.']);

    expect(out).toHaveLength(2);
    expect(out[0]).toMatch(/cellule/i);
    expect(out[1]).toMatch(/eau/i);
  });

  it('keeps a masked link as it is', async () => {
    // protect.mjs swaps a link for [[URL0]] before translation and restores it
    // after; a placeholder the model rewrites is a link the reader loses.
    const [out] = await translate(['See [[URL0]] for the full table.']);

    expect(out).toContain('[[URL0]]');
  });

  it('joins a line Bergamot would split at a newline back into one', async () => {
    const out = await translate(['The first part\nand the second part.']);

    expect(out).toHaveLength(1);
    expect(out[0]).not.toContain('\n');
  });

  it('can be called again after a call, with its own vectors freed', async () => {
    // Each call deletes its wasm vectors; a double free or a freed model would
    // abort the engine on the next call rather than here.
    for (let i = 0; i < 3; i += 1) {
      expect(await translate(['Hello.'])).toHaveLength(1);
    }
  });
});

const CELL = 'The cell is the basic unit of life.';

describe.skipIf(!present || !existsSync(new URL('en-de/manifest.json', ROOT)))('Bergamot, a second pair', () => {
  it('loads German into the engine French is already in, and both still translate', async () => {
    // The worker keeps one engine and a session per pair, so a reader who goes
    // French -> German -> French loads each model once. That needs the engine to
    // hold two models at once.
    const bergamot = await startEngine(buffers('bergamot').wasm);
    const fr = createBergamotSession(bergamot, buffers('en-fr'), 'en', 'fr');
    expect((await fr([CELL]))[0]).toMatch(/cellule/i);

    const de = createBergamotSession(bergamot, buffers('en-de'), 'en', 'de');
    expect((await de([CELL]))[0]).toMatch(/Zelle/i);
    expect((await fr([CELL]))[0]).toMatch(/cellule/i);
  }, 60_000);
});

describe.skipIf(!present)('Bergamot, when the engine fails', () => {
  it('reads a C++ exception as its message, not as a number', async () => {
    // A C++ throw reaches JS as the address of the exception object. The worker
    // used to pass that on, and the reader saw "The voice could not start:
    // 38307768". A second BlockingService in one engine is a real throw that
    // leaves the engine usable, which makes it a safe one to provoke.
    const bergamot = await startEngine(buffers('bergamot').wasm);
    let thrown;
    try {
      new bergamot.BlockingService({ cacheSize: 0 });
      new bergamot.BlockingService({ cacheSize: 0 });
    } catch (error) {
      thrown = error;
    }
    expect(typeof thrown).toBe('number');
    const error = engineError(bergamot, thrown);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toMatch(/logger with name 'general' already exists/);
  }, 60_000);

  it('passes an ordinary Error through unchanged', async () => {
    const bergamot = await startEngine(buffers('bergamot').wasm);
    const original = new Error('already words');
    expect(engineError(bergamot, original)).toBe(original);
  }, 60_000);

  it('reports an abort, so the worker can start a fresh engine', async () => {
    // A model that does not parse ABORTS the engine rather than throwing: every
    // later call into that module fails too. The hashes make a corrupt file
    // unlikely, but running out of heap aborts the same way.
    let died = null;
    const bergamot = await startEngine(buffers('bergamot').wasm, (reason) => { died = reason; });
    const broken = { ...buffers('en-fr'), lex: new Uint8Array(4096).fill(7).buffer };
    expect(() => createBergamotSession(bergamot, broken, 'en', 'fr')).toThrow(/Aborted/);
    expect(died).not.toBeNull();
  }, 60_000);
});

it.runIf(!present)('Bergamot assets are absent: run node scripts/fetch-mt-models.mjs', () => {});
