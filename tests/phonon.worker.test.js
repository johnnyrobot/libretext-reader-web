import { describe, it, expect, vi } from 'vitest';
import { createHandler, VOICES, SAMPLE_RATE, voiceBuffer, speechCalls } from '../src/phonon.worker.mjs';
import { expectedSeconds } from '../src/phonon-guard.mjs';

const FRAME = 1920;
const framesFor = (text) => Math.round(expectedSeconds(text) * 12.5 * 0.9);

// A stubbed model: the real one is 161 MB and none of what is asserted here is
// about the model -- it is about the protocol around it. `plan(text)` may return
// { frames, eos } to make a sentence run away.
function fakeModel(plan = () => ({})) {
  const spoken = [];
  const model = {
    spoken,
    voice: null,
    setVoice: vi.fn(async (file) => { model.voice = file; }),
    async* speak(text) {
      spoken.push(text);
      const { frames = framesFor(text), eos = true, gate } = plan(text);
      for (let i = 0; i < frames; i++) {
        if (gate) await gate;
        yield new Float32Array(FRAME).fill(0.01);
      }
      return { eos };
    },
  };
  return model;
}

function handlerWith(model) {
  const posted = [];
  const load = vi.fn(async () => model);
  const handle = createHandler({ post: (message) => posted.push(message), load });
  return { posted, handle, load, of: (type) => posted.filter((m) => m.type === type) };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('phonon.worker.mjs', () => {
  it('loads from the manifest it is given and reports ready on wasm', async () => {
    const { handle, of, load } = handlerWith(fakeModel());
    await handle({ type: 'init', voice: 'M1', lang: 'en', manifestUrl: '/_assets/tts/phonon/manifest.json' });
    expect(load).toHaveBeenCalledWith(expect.objectContaining({ manifestUrl: '/_assets/tts/phonon/manifest.json' }));
    expect(of('ready')).toEqual([{ type: 'ready', provider: 'wasm' }]);
  });

  it('hands the model the menu voice it is asked for, M1 when none is named', async () => {
    const model = fakeModel();
    const { handle, of } = handlerWith(model);
    await handle({ type: 'init', voice: 'F1', lang: 'en', manifestUrl: '/m.json' });
    expect(model.voice).toBe('F1');
    await handle({ type: 'setVoice', voice: 'M1' });
    await flush();
    expect(model.voice).toBe('M1');
    expect(of('voiceSet')).toHaveLength(1);
    await handle({ type: 'init', lang: 'fr', manifestUrl: '/m.json' });
    expect(model.voice).toBe('M1');
  });

  it('speaks the language it was loaded for, and refuses any other (LT-217)', async () => {
    const { handle, of } = handlerWith(fakeModel());
    await handle({ type: 'init', voice: 'M1', lang: 'fr', manifestUrl: '/_assets/tts/phonon-fr/manifest.json' });
    await handle({ type: 'setLang', lang: 'fr' });
    await handle({ type: 'setLang', lang: 'de' });
    await flush();
    expect(of('langSet')).toEqual([{ type: 'langSet', lang: 'fr' }]);
    expect(of('error')).toEqual([expect.objectContaining({ id: 'lang', code: 'UNSUPPORTED_LANG' })]);
  });

  it('refuses a language other than English, against the pending lang request', async () => {
    const { handle, of } = handlerWith(fakeModel());
    await handle({ type: 'init', voice: 'M1', lang: 'en', manifestUrl: '/m.json' });
    await handle({ type: 'setLang', lang: 'es' });
    await flush();
    expect(of('error')).toEqual([expect.objectContaining({ id: 'lang' })]);
    await handle({ type: 'setLang', lang: 'en' });
    await flush();
    expect(of('langSet')).toHaveLength(1);
  });

  it('streams a sentence as chunks, then sends the whole of it at 24 kHz', async () => {
    const { handle, of } = handlerWith(fakeModel());
    await handle({ type: 'init', voice: 'M1', lang: 'en', manifestUrl: '/m.json' });
    await handle({ type: 'synth', id: 'b1s0', text: 'The general idea is cognitive.', stream: true });
    await flush();

    const chunks = of('chunk');
    const [audio] = of('audio');
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.id === 'b1s0')).toBe(true);
    expect(audio).toMatchObject({ id: 'b1s0', sampleRate: SAMPLE_RATE, outcome: 'ok' });
    expect(audio.samples.length).toBe(chunks.reduce((n, c) => n + c.samples.length, 0));
  });

  it('sends no chunks for a sentence not asked to stream', async () => {
    const { handle, of } = handlerWith(fakeModel());
    await handle({ type: 'init', voice: 'M1', lang: 'en', manifestUrl: '/m.json' });
    await handle({ type: 'synth', id: 'b1s0', text: 'Lookahead sentence.' });
    await flush();
    expect(of('chunk')).toHaveLength(0);
    expect(of('audio')).toHaveLength(1);
  });

  it('renders one sentence at a time, in the order asked', async () => {
    const model = fakeModel();
    const { handle, of } = handlerWith(model);
    await handle({ type: 'init', voice: 'M1', lang: 'en', manifestUrl: '/m.json' });
    handle({ type: 'synth', id: 'a', text: 'First sentence here.' });
    handle({ type: 'synth', id: 'b', text: 'Second sentence here.' });
    await flush(); await flush();
    expect(of('audio').map((m) => m.id)).toEqual(['a', 'b']);
    expect(model.spoken).toEqual(['First sentence here.', 'Second sentence here.']);
  });

  it('withdraws streamed audio and reports a skip when a sentence keeps running away', async () => {
    const { handle, of, posted } = handlerWith(fakeModel(() => ({ frames: 5000, eos: false })));
    await handle({ type: 'init', voice: 'M1', lang: 'en', manifestUrl: '/m.json' });
    await handle({ type: 'synth', id: 'b9s9', text: 'K one equals the concentration of N O squared', stream: true });
    await flush();

    const [audio] = of('audio');
    expect(audio).toMatchObject({ id: 'b9s9', outcome: 'skipped' });
    expect(audio.samples.length).toBe(0);
    // The last word on this sentence before its result is a reset: nothing it
    // streamed is left to play.
    const last = posted.filter((m) => m.id === 'b9s9' && m.type !== 'audio').at(-1);
    expect(last.type).toBe('reset');
  });

  it('drops a cancelled sentence that has not started, without rendering it', async () => {
    let open;
    const gate = new Promise((resolve) => { open = resolve; });
    const model = fakeModel((text) => (text.startsWith('Slow') ? { gate } : {}));
    const { handle, of } = handlerWith(model);
    await handle({ type: 'init', voice: 'M1', lang: 'en', manifestUrl: '/m.json' });
    handle({ type: 'synth', id: 'slow', text: 'Slow sentence first.' });
    handle({ type: 'synth', id: 'next', text: 'Queued sentence.' });
    handle({ type: 'cancel', id: 'next' });
    open();
    await flush(); await flush();
    expect(of('audio').map((m) => m.id)).toEqual(['slow']);
    expect(model.spoken).toEqual(['Slow sentence first.']);
  });

  it('stops a sentence mid-render when cancelled, and sends nothing for it', async () => {
    let open;
    const gate = new Promise((resolve) => { open = resolve; });
    const { handle, of } = handlerWith(fakeModel(() => ({ gate })));
    await handle({ type: 'init', voice: 'M1', lang: 'en', manifestUrl: '/m.json' });
    const done = handle({ type: 'synth', id: 'b1s0', text: 'A sentence being spoken now.' });
    handle({ type: 'cancel', id: 'b1s0' });
    open();
    await done; await flush();
    expect(of('audio')).toHaveLength(0);
  });

  it('a cancel that arrives after the sentence finished does not kill its re-request', async () => {
    const { handle, of } = handlerWith(fakeModel());
    await handle({ type: 'init', voice: 'M1', lang: 'en', manifestUrl: '/m.json' });
    await handle({ type: 'synth', id: 'b1s0', text: 'Rendered once.' });
    await handle({ type: 'cancel', id: 'b1s0' });              // late: already sent
    await handle({ type: 'synth', id: 'b1s0', text: 'Rendered once.' });
    await flush();
    expect(of('audio')).toHaveLength(2);
  });

  it('reports a failed load as an init error, not a hang', async () => {
    const posted = [];
    const handle = createHandler({ post: (m) => posted.push(m), load: async () => { throw new Error('integrity check failed'); } });
    await handle({ type: 'init', voice: 'M1', lang: 'en', manifestUrl: '/m.json' });
    expect(posted).toEqual([expect.objectContaining({ type: 'error', message: expect.stringMatching(/integrity/) })]);
    expect(posted[0].id).toBeUndefined();
  });

  it('reads English\'s two menu voices from their Phonon voice files, Preston and Hadley', () => {
    const preston = new ArrayBuffer(4);
    const hadley = new ArrayBuffer(4);
    const english = { 'voices/qIxlZ7Ei8KvWlyQH.bin': preston, 'voices/bXwrkHhURL1VFJdG.bin': hadley };
    expect(voiceBuffer(english, 'M1')).toBe(preston);
    expect(voiceBuffer(english, 'F1')).toBe(hadley);
  });

  it('reads a translation\'s menu voices from the file staged for each (LT-222)', () => {
    const male = new ArrayBuffer(4);
    const female = new ArrayBuffer(4);
    const french = { 'voices/M1.bin': male, 'voices/F1.bin': female };
    expect(voiceBuffer(french, 'M1')).toBe(male);
    expect(voiceBuffer(french, 'F1')).toBe(female);
  });

  it('refuses a voice it has no file for, rather than speak another under its name (LT-222)', () => {
    // A stage from before LT-222 has one voice, default.bin: Female must not quietly say it.
    expect(() => voiceBuffer({ 'voices/default.bin': new ArrayBuffer(4) }, 'F1')).toThrow(/F1/);
    expect(() => voiceBuffer({}, 'M1')).toThrow(/M1/);
  });

  // Measured on Phonon es (LT-216): a call ending "en nuestros pensamientos,"
  // ran on past its end in 8 renders of 8; ending it with a full stop, 0 of 8.
  it('ends every call it cuts mid-sentence with a full stop, so the voice stops there', () => {
    const words = (t) => t.split(' ').length;
    const calls = speechCalls('one two three, four five six; seven eight nine: ten.', words, 3);
    expect(calls).toEqual(['One two three.', 'Four five six.', 'Seven eight nine.', 'Ten.']);
  });

  it('keeps a call\'s own ending, and packs clauses together while they fit', () => {
    const words = (t) => t.split(' ').length;
    expect(speechCalls('one two, three four. five six', words, 4)).toEqual(['One two, three four.', 'Five six.']);
    expect(speechCalls('really? yes!', words, 4)).toEqual(['Really? yes!']);
  });
});
