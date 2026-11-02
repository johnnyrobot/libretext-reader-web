import { describe, it, expect } from 'vitest';
import { LANGS } from '../bench/phonon/listen/listen.js';

// The listening page credits what it plays. Both translation voices are spoken by
// the CC BY-NC 40M model; only the Female voice file is Apache 2.0 (LT-234). The
// NC model is demo-only, so the page says so.
describe('the listening page credit', () => {
  it.each(['fr', 'de', 'es', 'pt'])('names the NC model for both %s voices', (lang) => {
    expect(LANGS[lang].credit).toBe(
      "Voice model: Phonon 40M by Gradium, CC BY-NC 4.0. Male voice: the model's own. "
      + "Female voice: from Gradium's phonon-voices, Apache 2.0. Demo use only.");
  });

  it('credits English to the Apache 31M model', () => {
    expect(LANGS.en.credit).toBe('Phonon 31M by Gradium, Apache 2.0.');
  });
});
