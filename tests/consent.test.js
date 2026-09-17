import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  requestConsent, requestTranslationConsent, showProgress, confirmDelete, chooseWhenSlow,
} from '../src/consent.mjs';

afterEach(() => { document.body.innerHTML = ''; });

const dialog = () => document.querySelector('.tts-dialog');
const click = (act) => dialog().querySelector(`[data-act="${act}"]`).click();

describe('the translation consent gate', () => {
  it('is a SECOND gate: it names its own size, language and licence', async () => {
    // A reader who accepted 383 MB for a voice has not accepted another 121 MB
    // for Spanish. Different model, different licence, quite possibly a
    // different day.
    const answer = requestTranslationConsent({
      language: 'español', requiredBytes: 121_097_315, quotaSufficient: true, licence: 'apache-2.0',
    });

    const text = dialog().textContent;
    expect(text).toContain('español');
    expect(text).toContain('115 MB');   // 121,097,315 bytes, the real en-es total
    // The licence is named because the model choice was MADE on licence grounds:
    // NLLB is out because its output is cc-by-nc-4.0 and cannot ship in an MIT
    // product. A reader should be able to see which one they are running.
    expect(text).toContain('apache-2.0');
    expect(text).toMatch(/delete/i);
    // And that machine translation is not a human translation.
    expect(text).toMatch(/not a substitute/i);

    click('accept');
    await expect(answer).resolves.toBe(true);
    expect(dialog()).toBeNull();
  });

  it('resolves false and removes itself when declined', async () => {
    const answer = requestTranslationConsent({
      language: 'español', requiredBytes: 1, quotaSufficient: true, licence: 'apache-2.0',
    });
    click('decline');
    await expect(answer).resolves.toBe(false);
    expect(dialog()).toBeNull();
  });

  it('warns when the browser may not have room, reusing the voice gate\'s wording', async () => {
    const answer = requestTranslationConsent({
      language: 'español', requiredBytes: 121_097_315, quotaSufficient: false, licence: 'apache-2.0',
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

describe('the voice gate still behaves as it did', () => {
  it('names the size and resolves on accept', async () => {
    const answer = requestConsent({ requiredBytes: 401_604_608, quotaSufficient: true });
    expect(dialog().textContent).toContain('383 MB');
    expect(dialog().textContent).toContain('OpenRAIL-M');
    click('accept');
    await expect(answer).resolves.toBe(true);
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
