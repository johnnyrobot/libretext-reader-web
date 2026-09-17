import { describe, it, expect, vi } from 'vitest';
import { createHandler, translateBatch, SentenceCountError } from '../src/translate.worker.mjs';

// A stubbed session: takes masked lines, returns "translated" ones. The real one
// is 115 MB and 0.3 s a sentence, and none of what is asserted here is about the
// model -- it is about the contract around it.
function session(fn) {
  return vi.fn(async (lines) => fn(lines));
}

function handlerWith(load) {
  const posted = [];
  const handle = createHandler({ post: (message) => posted.push(message), load });
  return { posted, handle, of: (type) => posted.filter((m) => m.type === type) };
}

const SPANISH = 'ES: ';
const echoUpper = session((lines) => lines.map((line) => SPANISH + line));

describe('translateBatch', () => {
  it('raises when the line count changes, rather than zipping what came back', async () => {
    // The failure this prevents is not "one sentence is missing" -- it is every
    // sentence after the gap being captioned with its neighbour's text.
    const dropped = session((lines) => lines.slice(1));

    await expect(translateBatch(dropped, ['one.', 'two.', 'three.']))
      .rejects.toThrow(SentenceCountError);
    await expect(translateBatch(dropped, ['one.', 'two.', 'three.']))
      .rejects.toThrow(/returned 2 lines for 3 sentences/);
  });

  it('masks before translating, so a URL never reaches the model', async () => {
    const seen = [];
    const spy = session((lines) => { seen.push(...lines); return lines.map((l) => SPANISH + l); });

    await translateBatch(spy, ['See www.bbc.com/news for details.']);

    expect(seen[0]).toBe('See [[URL0]] for details.');
    expect(seen[0]).not.toContain('bbc');
  });

  it('restores the span afterwards, byte for byte', async () => {
    const out = await translateBatch(echoUpper, ['See www.bbc.com/news for details.']);
    expect(out).toEqual(['ES: See www.bbc.com/news for details.']);
  });

  it('falls back to English for ONE damaged line, not for the batch', async () => {
    // `[[URL0]]` coming back as `[URL0` is measured behaviour, not invented: the
    // token survives and the brackets do not. restore() refuses it rather than
    // substring-matching, which would ship a URL with an orphan bracket into
    // something that gets read aloud.
    const damaging = session((lines) => lines.map((line) =>
      line.includes('[[URL0]]') ? line.replace('[[URL0]]', '[URL0') : SPANISH + line));

    const out = await translateBatch(damaging, [
      'Ordinary prose.',
      'See www.bbc.com/news for details.',
      'More ordinary prose.',
    ]);

    expect(out[0]).toBe('ES: Ordinary prose.');
    expect(out[1]).toBe('See www.bbc.com/news for details.'); // the English source, intact
    expect(out[2]).toBe('ES: More ordinary prose.');
  });

  it('falls back to English for ONE collapsed line, not for the batch', async () => {
    // The other half of step 10's salvaged gate. A repetition loop is what
    // collapse actually looks like coming out of a Marian checkpoint, and
    // nothing downstream re-checks it -- the build-time pipeline had a
    // back-translation gate to catch this and the browser does not.
    const collapsing = session((lines) => lines.map((line) =>
      (line.startsWith('Loop') ? 'la la la la la la la la' : SPANISH + line)));

    const out = await translateBatch(collapsing, [
      'Ordinary prose.',
      'Loop this one please, at some length.',
      'More ordinary prose.',
    ]);

    expect(out[0]).toBe('ES: Ordinary prose.');
    expect(out[1]).toBe('Loop this one please, at some length.');   // English source
    expect(out[2]).toBe('ES: More ordinary prose.');
  });

  it('falls back when the translation is a fragment of its source', async () => {
    // Gross truncation. The ratio is calibrated in src/qa.mjs against 9,407
    // deployed pairs, so this fires on collapse without firing on Spanish being
    // terser than English, which it legitimately is about a quarter of the time.
    const truncating = session((lines) => lines.map(() => 'La.'));
    const source = 'The guide was commissioned by the Attorney General and listed '
      + 'recommendations for collecting eyewitness evidence.';
    expect(await translateBatch(truncating, [source])).toEqual([source]);
  });

  it('speaks the numbers, and does it BEFORE restore', async () => {
    // Open decision 3, closed. Without this the Spanish voice is handed
    // `Había 21 mujeres` -- the oracle diff measured raw digits reaching 21.0%
    // of the book's sentences.
    //
    // The ordering is the load-bearing half. The normaliser runs on the MASKED
    // line: after restore() the sentence holds a real URL whose digits and dots
    // the number passes would happily spell out, corrupting a span that
    // restore() has already put back. Asserting both halves in one test because
    // one without the other is not the behaviour.
    // The URL carries a long digit run ON PURPOSE. With a digit-free URL this
    // test passes whichever side of restore() the normaliser runs on, and proves
    // only half of what it claims.
    const url = 'www.bbc.com/news/world-europe-25778272';
    const out = await translateBatch(
      session((lines) => lines.map((l) => l.replace('SRC', 'Había 21 mujeres en 1997, y'))),
      [`SRC ${url}`],
      () => {},
      'es',
    );

    expect(out[0]).toBe(
      `Había veintiuno mujeres en mil novecientos noventa y siete, y ${url}`);
    // Said explicitly, because it is the half the ordering exists for: run after
    // restore, that digit run is read out one digit at a time and the address is
    // no longer an address.
    expect(out[0]).not.toContain('dos cinco siete');
  });

  it('leaves the text alone for a language with no normaliser', async () => {
    // Rolling out language by language must not block the ones without a
    // normaliser yet -- they behave exactly as they did before this existed.
    //
    // The example was 'fr' until French shipped, then 'de' until German did,
    // and both times this test failed loudly rather than quietly passing --
    // which is what it is for. Polish is the durable name: no ONNX export of
    // opus-mt-en-pl exists, so it cannot ship and cannot need a third edit.
    const out = await translateBatch(
      session((lines) => lines.map(() => 'Było 21 kobiet')), ['x'], () => {}, 'pl');
    expect(out[0]).toBe('Było 21 kobiet');
  });

  it('chunks a whole page rather than handing the model one huge batch', async () => {
    // transformers.js pads a batch to its longest sequence, so one run over a
    // whole page dies with std::bad_alloc -- measured on this page's 303
    // sentences. Order and length must survive the chunking, since highlighting
    // is keyed by position.
    const runs = [];
    const spy = session((batch) => { runs.push(batch.length); return batch.map((l) => SPANISH + l); });
    const lines = Array.from({ length: 20 }, (_, i) => `Sentence ${i}.`);

    const out = await translateBatch(spy, lines);

    expect(out).toEqual(lines.map((l) => SPANISH + l));
    expect(runs.length).toBeGreaterThan(1);
    expect(Math.max(...runs)).toBeLessThanOrEqual(8);
    expect(runs.reduce((a, b) => a + b, 0)).toBe(20);
  });

  it('reports how far through the page it is, chunk by chunk', async () => {
    const seen = [];
    const lines = Array.from({ length: 20 }, (_, i) => `Sentence ${i}.`);

    await translateBatch(echoUpper, lines, (p) => seen.push(p));

    expect(seen.every((p) => p.phase === 'translate' && p.total === 20)).toBe(true);
    expect(seen.map((p) => p.loaded)).toEqual([8, 16, 20]);
  });

  it('returns an empty batch without calling the model', async () => {
    const spy = session((lines) => lines);
    expect(await translateBatch(spy, [])).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it('lets a non-placeholder failure through instead of silently returning English', async () => {
    // A fallback that swallows every error cannot be told apart from one that
    // never fires, and the second is how a whole page stays English in silence.
    const broken = session(() => { throw new Error('session died'); });
    await expect(translateBatch(broken, ['one.'])).rejects.toThrow(/session died/);
  });
});

describe('the worker protocol', () => {
  it('reports ready after init, and forwards download progress', async () => {
    const { handle, of } = handlerWith(async ({ onProgress }) => {
      onProgress({ file: 'onnx/encoder_model_quantized.onnx', loaded: 5, total: 10, phase: 'download' });
      return echoUpper;
    });

    await handle({ type: 'init', manifestUrl: '/_assets/tts/mt/en-es/manifest.json', pair: 'en-es' });

    expect(of('ready')).toHaveLength(1);
    expect(of('progress')[0]).toEqual({
      type: 'progress', file: 'onnx/encoder_model_quantized.onnx', loaded: 5, total: 10, phase: 'download',
    });
  });

  it('round-trips the id, and the lines in order', async () => {
    const { handle, of } = handlerWith(async () => echoUpper);
    await handle({ type: 'init', manifestUrl: '/m.json', pair: 'en-es' });

    await handle({ type: 'translate', id: 42, lines: ['one.', 'two.'] });
    await handle({ type: 'translate', id: 'batch-7', lines: ['three.'] });

    expect(of('translated')).toEqual([
      { type: 'translated', id: 42, lines: ['ES: one.', 'ES: two.'] },
      { type: 'translated', id: 'batch-7', lines: ['ES: three.'] },
    ]);
  });

  it('reports a length mismatch as an error against the batch that caused it', async () => {
    const { handle, of } = handlerWith(async () => session((lines) => lines.slice(1)));
    await handle({ type: 'init', manifestUrl: '/m.json', pair: 'en-es' });

    await handle({ type: 'translate', id: 9, lines: ['one.', 'two.'] });

    expect(of('translated')).toHaveLength(0);
    expect(of('error')[0].id).toBe(9);
    expect(of('error')[0].message).toMatch(/returned 1 lines for 2 sentences/);
  });

  it('reports a failed init as an error rather than a silent absence of ready', async () => {
    const { handle, of } = handlerWith(async () => { throw new Error('model unavailable (404)'); });

    await handle({ type: 'init', manifestUrl: '/m.json', pair: 'en-es' });

    expect(of('ready')).toHaveLength(0);
    expect(of('error')[0].message).toMatch(/model unavailable/);
  });

  it('waits for an in-flight init instead of failing the first batch', async () => {
    // The host would otherwise have to serialise init against its first batch,
    // and getting that wrong is a race that only shows up on a slow machine.
    let release;
    const started = new Promise((resolve) => { release = resolve; });
    const { handle, of } = handlerWith(async () => { await started; return echoUpper; });

    const init = handle({ type: 'init', manifestUrl: '/m.json', pair: 'en-es' });
    const batch = handle({ type: 'translate', id: 1, lines: ['one.'] });
    release();
    await Promise.all([init, batch]);

    expect(of('error')).toHaveLength(0);
    expect(of('translated')[0]).toEqual({ type: 'translated', id: 1, lines: ['ES: one.'] });
  });

  it('says so when a batch arrives before any init', async () => {
    const { handle, of } = handlerWith(async () => echoUpper);
    await handle({ type: 'translate', id: 1, lines: ['one.'] });
    expect(of('error')[0]).toEqual({ type: 'error', id: 1, message: 'translator not initialised' });
  });
});
