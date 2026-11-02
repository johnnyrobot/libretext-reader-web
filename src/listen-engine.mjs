/**
 * The one engine the reader talks to: English on Phonon 31M, each translation
 * on that language's own Phonon 40M (LT-216, LT-217).
 *
 * A translation voice is a separate download, so it is not created until a
 * reader picks that language -- `prepare(lang)` -- and a reader who only ever
 * listens in English never fetches a byte of one. Each 40M speaks one
 * language, so picking another replaces it: only one is ever held, since each
 * is ~200 MB of wasm memory on top of English.
 *
 * Same interface as createEngine, plus `prepare` and `prepared`. `setLang`
 * switches which engine `synthesize` reaches SYNCHRONOUSLY, before its promise
 * settles: changeLanguage flushes, swaps the text and returns, and the player's
 * next request must already go to the engine that speaks that language.
 */
export function createListenEngine({ english, createOther }) {
  let active = english;
  let voice = 'M1';
  let other = null;        // the translation voice, once created
  let otherLang = null;    // the language it speaks
  let otherReady = null;   // its init promise, shared by concurrent prepares
  let otherLoaded = false;

  function dropOther() {
    if (active === other) active = english;
    other?.terminate();
    other = null;
    otherLang = null;
    otherReady = null;
    otherLoaded = false;
  }

  return {
    init({ voice: initial, onProgress }) {
      voice = initial;
      return english.init({ voice, lang: 'en', onProgress });
    },

    /** Load the voice for `lang`. Resolves once it can speak it. */
    prepare(lang, { onProgress } = {}) {
      if (otherLang !== lang) dropOther();
      if (!otherReady) {
        other = createOther(lang);
        otherLang = lang;
        const mine = other;
        const loadedWith = voice;
        otherReady = mine.init({ voice, lang, onProgress }).then(
          async (result) => {
            if (other !== mine) return result;
            otherLoaded = true;
            // The reader changed voice while it loaded; setVoice reached only Phonon.
            if (voice !== loadedWith) await mine.setVoice(voice);
            return result;
          },
          (error) => { if (other === mine) dropOther(); throw error; },
        );
      }
      return otherReady;
    },

    /** Whether the voice for `lang` is loaded. */
    prepared(lang) {
      return otherLoaded && otherLang === lang;
    },

    setLang(lang) {
      if (lang === 'en') {
        active = english;
        return english.setLang('en');
      }
      if (!otherLoaded || otherLang !== lang) return Promise.reject(new Error('The translation voice is not loaded.'));
      active = other;
      return other.setLang(lang);
    },

    synthesize(id, text, options) {
      return active.synthesize(id, text, options);
    },

    // A sentence may be in flight on either engine across a switch; cancelling
    // an id an engine does not hold is a no-op there.
    cancel(id) {
      english.cancel(id);
      if (otherLoaded) other.cancel(id);
    },

    setVoice(next) {
      voice = next;
      const engines = otherLoaded ? [english, other] : [english];
      return Promise.all(engines.map((engine) => engine.setVoice(next))).then(() => undefined);
    },

    terminate() {
      english.terminate();
      dropOther();
    },
  };
}
