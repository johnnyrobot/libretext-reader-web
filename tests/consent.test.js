import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  requestConsent, requestTranslationConsent, showProgress, confirmDelete, chooseWhenSlow,
} from '../src/consent.mjs';

afterEach(() => { document.body.innerHTML = ''; });

const dialog = () => document.querySelector('.tts-dialog');
const VOICE_CREDIT = "Voice model: Phonon 40M by Gradium, CC BY-NC 4.0. Male voice: the model's own. "
  + "Female voice: from Gradium's phonon-voices, Apache 2.0.";
const click = (act) => dialog().querySelector(`[data-act="${act}"]`).click();

describe('the translation consent gate', () => {
  it('is a SECOND gate: it names its own size, language and licence', async () => {
    // A reader who accepted 383 MB for a voice has not accepted another 40 MB
    // for Spanish. Different model, different licence, quite possibly a
    // different day.
    const answer = requestTranslationConsent({
      language: 'español', requiredBytes: 41_536_783, quotaSufficient: true, licence: 'mpl-2.0',
    });

    const text = dialog().textContent;
    expect(text).toContain('español');
    expect(text).toContain('40 MB');   // 41,536,783 bytes, the real en-es total with the engine
    // The licence is named because the model choice was MADE on licence grounds:
    // NLLB is out because its output is cc-by-nc-4.0 and cannot ship in an MIT
    // product. A reader should be able to see which one they are running.
    expect(text).toContain('mpl-2.0');
    expect(text).toMatch(/delete/i);
    // And that machine translation is not a human translation.
    expect(text).toMatch(/not a substitute/i);

    click('accept');
    await expect(answer).resolves.toBe(true);
    expect(dialog()).toBeNull();
  });

  it('credits the translator it runs: Firefox Translations, by Mozilla', async () => {
    // LT-255 swapped Opus-MT for Mozilla's models and engine. A credit that still
    // named Helsinki-NLP would tell the reader they were running something else.
    const answer = requestTranslationConsent({
      language: 'español', requiredBytes: 1, quotaSufficient: true, licence: 'mpl-2.0',
    });

    const text = dialog().textContent.replace(/\s+/g, ' ');
    expect(text).toContain('Translation model: Firefox Translations (English to español) by Mozilla, '
      + 'licensed under mpl-2.0.');
    expect(text).not.toMatch(/Opus-MT|Helsinki/);
    const link = [...dialog().querySelectorAll('a')].find((a) => a.textContent.includes('Firefox Translations'));
    expect(link.href).toBe('https://github.com/mozilla/firefox-translations-models');
    expect(link.rel).toBe('noopener');

    click('decline');
    await answer;
  });

  it('resolves false and removes itself when declined', async () => {
    const answer = requestTranslationConsent({
      language: 'español', requiredBytes: 1, quotaSufficient: true, licence: 'mpl-2.0',
    });
    click('decline');
    await expect(answer).resolves.toBe(false);
    expect(dialog()).toBeNull();
  });

  it('warns when the browser may not have room, reusing the voice gate\'s wording', async () => {
    const answer = requestTranslationConsent({
      language: 'español', requiredBytes: 121_097_315, quotaSufficient: false, licence: 'mpl-2.0',
    });
    expect(dialog().textContent).toMatch(/may not have room/i);
    click('decline');
    await answer;
  });

  it('escapes the language and licence rather than trusting them', async () => {
    // Both come from data -- LANGUAGE_LABELS and pairs.json. pairs.json is
    // written by our own script TODAY, which is exactly the kind of assumption
    // that stops being true quietly, and this string reaches innerHTML.
    const answer = requestTranslationConsent({
      language: '<img src=x onerror=1>',
      requiredBytes: 1,
      quotaSufficient: true,
      licence: '<script>window.OWNED = 1</script>',
    });

    expect(dialog().querySelector('img')).toBeNull();
    expect(dialog().querySelector('script')).toBeNull();
    expect(dialog().textContent).toContain('<script>window.OWNED = 1</script>');

    click('decline');
    await answer;
  });
});

describe('progress and deletion name what they are about', () => {
  it('titles the progress dialog for the thing being downloaded', () => {
    // A 383 MB voice and a 121 MB language are different waits. A bar that does
    // not say which one it is describing is a lie about what is happening.
    const voice = showProgress();
    expect(dialog().textContent).toContain('Preparing the voice');
    voice.close();

    const language = showProgress({ title: 'Preparing español' });
    expect(dialog().textContent).toContain('Preparing español');
    language.close();
  });

  it('escapes the progress title too', () => {
    const progress = showProgress({ title: '<img src=x onerror=1>' });
    expect(dialog().querySelector('img')).toBeNull();
    progress.close();
  });

  it('reports cancellation without pretending the load stopped', () => {
    const progress = showProgress({ title: 'Preparing español' });
    expect(progress.cancelled()).toBe(false);
    click('cancel');
    expect(progress.cancelled()).toBe(true);
    // The dialog goes; ONNX Runtime cannot abort a load in flight, so the
    // CALLER finishes the load and then tears down. Nothing here pretends
    // otherwise.
    expect(dialog()).toBeNull();
  });

  it('asks about the right model when deleting', async () => {
    const voice = confirmDelete();
    expect(dialog().textContent).toContain('voice');
    click('no');
    await expect(voice).resolves.toBe(false);

    const language = confirmDelete({ what: 'español translation' });
    expect(dialog().textContent).toContain('español translation');
    click('yes');
    await expect(language).resolves.toBe(true);
  });
});

describe('the voice gate (English on Phonon, LT-214)', () => {
  it('names the size and resolves on accept', async () => {
    const answer = requestConsent({ requiredBytes: 162_381_572, quotaSufficient: true });
    expect(dialog().textContent).toContain('155 MB');
    click('accept');
    await expect(answer).resolves.toBe(true);
  });

  it('credits Phonon by Gradium under Apache 2.0, and no longer Supertonic', async () => {
    const answer = requestConsent({ requiredBytes: 1, quotaSufficient: true });
    const text = dialog().textContent.replace(/\s+/g, ' ');
    expect(text).toContain('Phonon by Gradium, Apache 2.0');
    expect(text).not.toContain('Supertonic');
    expect(text).not.toContain('OpenRAIL-M');
    click('decline');
    await answer;
  });
});

describe('the translation gate when the translation voice is not downloaded yet (LT-217)', () => {
  it('adds the voice to the size and credits Phonon under CC BY-NC 4.0', async () => {
    // Each translation is spoken by its own Phonon 40M, which an English-only
    // reader has never downloaded. Its size and its noncommercial licence are
    // part of what they are agreeing to here. Supertonic is gone (LT-217).
    const answer = requestTranslationConsent({
      language: 'español', requiredBytes: 121_097_315, quotaSufficient: true, licence: 'mpl-2.0',
      voiceBytes: 199_570_458,               // phonon-es, as staged
    });
    const text = dialog().textContent.replace(/\s+/g, ' ');
    expect(text).toContain('306 MB');     // 115 MB + 190 MB, rounded once
    expect(text).toContain('190 MB voice that reads español aloud');
    // Both voices are spoken by the CC BY-NC model; only the Female voice file is
    // Apache 2.0, so the credit names the model's licence first (LT-234).
    expect(text).toContain(VOICE_CREDIT);
    expect(text).not.toContain('Female voice: Phonon by Gradium');
    expect(text).not.toContain('Supertonic');
    expect(text).not.toContain('OpenRAIL-M');
    // The model's licence is linked from the model, the Apache one from the Female voice.
    const credit = [...dialog().querySelectorAll('small')].find((s) => s.textContent.includes('Voice model:'));
    expect(credit).toBeDefined();
    expect(credit.querySelector('a[href="https://creativecommons.org/licenses/by-nc/4.0/"]').textContent)
      .toBe('CC BY-NC 4.0');
    expect(credit.querySelector('a[href="https://www.apache.org/licenses/LICENSE-2.0"]').textContent)
      .toBe('Apache 2.0');
    click('decline');
    await answer;
  });

  it('says nothing about the voice once it is downloaded', async () => {
    const answer = requestTranslationConsent({
      language: 'español', requiredBytes: 121_097_315, quotaSufficient: true, licence: 'mpl-2.0',
    });
    expect(dialog().textContent).not.toContain('CC BY-NC');
    expect(dialog().textContent).not.toContain('phonon-voices');
    expect(dialog().textContent).not.toContain('Supertonic');
    click('decline');
    await answer;
  });
});

describe('the slow-device choice (step 11)', () => {
  it('quotes the measured rate in sentences a minute, not per second', async () => {
    // "0.4 sentences a second" is a number nobody can picture. The reader is
    // being asked to judge whether waiting is worth it, so the units have to be
    // ones they can feel.
    const answer = chooseWhenSlow({ language: 'español', rate: 0.4 });
    expect(dialog().textContent).toContain('24 sentences a minute');
    click('wait');
    await expect(answer).resolves.toBe('wait');
  });

  it('offers exactly two answers, and neither is "carry on"', async () => {
    // The third option -- play on and stall mid-sentence -- is the outcome this
    // dialog exists to prevent, so it is not on offer.
    chooseWhenSlow({ language: 'español', rate: 0.4 });
    expect([...dialog().querySelectorAll('[data-act]')].map((b) => b.dataset.act).sort())
      .toEqual(['english', 'wait']);
  });

  it('says nothing about a rate it has not measured', async () => {
    // Null before the first batch is timed. "null sentences a minute" is worse
    // than saying nothing, and the choice does not depend on the number.
    const answer = chooseWhenSlow({ language: 'español', rate: null });
    expect(dialog().textContent).not.toMatch(/null|NaN|undefined/);
    expect(dialog().textContent).toMatch(/more slowly/);
    click('english');
    await expect(answer).resolves.toBe('english');
  });

  it('is not an error dialog: it says the model is kept either way', async () => {
    // Nothing failed. The machine is slow, both answers are reasonable, and a
    // reader who picks English should not be left wondering whether they just
    // threw away the 115 MB they downloaded a minute ago.
    chooseWhenSlow({ language: 'español', rate: 0.2 });
    expect(dialog().textContent).toMatch(/stays downloaded/);
  });
});
