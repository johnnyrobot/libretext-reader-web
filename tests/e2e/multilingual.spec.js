import { test, expect } from '@playwright/test';

// REWRITTEN 2026-08-25, M1 step 4 of client-side translation.
//
// The four assertions this file used to hold were correct and are now obsolete,
// which is a different thing from wrong. They asserted on-disk `speech.es.json`
// tracks and `speech.json`'s `languages` array -- the build-time pipeline's
// output. Translation now happens in the reader's browser, so there is no track
// on disk to assert about and `manifest.languages` describes something that no
// longer exists. Leaving them passing against a superseded mechanism would have
// been the worst outcome: a green suite measuring the wrong thing.
//
// What was learned building those tracks is NOT obsolete and is kept, because it
// is about the corpus rather than about the delivery mechanism:
//
//   * Every QA failure ever measured on this book was a BIBLIOGRAPHY entry, none
//     was prose. `pipeline/translate.reference_sentence_ids` is what took Spanish
//     from ships=false to ships=true, and step 10 ports that rule client-side.
//   * The named-sentence fix (translate `display`, not `speech`) was right and
//     survives here: src/reader.mjs feeds the translator `display`.
//   * Spanish shipped at 1.48% failures against a 2.00% cap -- thin. Client-side
//     there is no cap and no gate at all (design Sec9), which is why the
//     build-time tracks are kept as an ORACLE (step 9) rather than deleted.
//
// Standing instruction, unchanged: do not weaken or delete an assertion here to
// make a run pass.
//
// STREAMING since step 6. Translation runs from the CURSOR outward, a window at
// a time, and playback starts as soon as that window is ready rather than after
// the whole page. So this suite asserts two things M1 could not: that starting is
// fast, and that a seek into untranslated ground is served in the target
// language rather than in English.

const PAGE = '/social_psychology/13:_Competition_and_Cooperation_in_Our_Social_Worlds/'
  + '13.01:_Conflict_Cooperation_Morality_and_Fairness/';
const PAIRS = '/_assets/tts/mt/pairs.json';

/** Enter Reader Mode from a cold cache and wait for the engine (see reentry.spec.js
 * and playback.spec.js). The real entry point is #tts-enter ("Enter Reader Mode"),
 * with consent accepted via [data-act="accept"]. */
async function enterAndWait(page) {
  await page.locator('#tts-enter').click();
  await page.locator('.tts-dialog').waitFor();
  await page.locator('[data-act="accept"]').click();
  await page.locator('.tts-bar').waitFor();
}

/** Accept the SECOND gate -- the one for the translation model. By the time it
 * appears the entry dialog is long gone, so [data-act="accept"] is unambiguous. */
async function acceptTranslation(page, language = 'español') {
  await expect(page.locator('.tts-dialog h2')).toHaveText(`Listen in ${language}`);
  await page.locator('[data-act="accept"]').click();
}

test.describe('client-side translation', () => {
  test('the deployment advertises the pairs it hosts models for', async ({ request }) => {
    // pairs.json replaced speech.json's `languages` as the menu's source: a track
    // was per-page, a model is per-site.
    const { pairs } = await (await request.get(PAIRS)).json();
    const spanish = pairs.find((p) => p.code === 'es');

    expect(spanish).toBeTruthy();
    expect(spanish.pair).toBe('en-es');
    expect(spanish.bytes).toBeGreaterThan(0);
    // The licence is the reason this checkpoint was chosen over NLLB, whose
    // cc-by-nc-4.0 output cannot ship inside an MIT product. It is recorded where
    // the consent gate can show it, so it is asserted where it is recorded.
    expect(spanish.licence).toBe('apache-2.0');
  });

  test('every file a pair advertises is actually served, at the advertised size',
    async ({ request }) => {
      // The old suite checked a track covered the page's ids. The equivalent
      // integrity question for a model is whether the manifest describes what the
      // mirror will really hand a reader -- a truncated 57 MB decoder fails
      // sha256 in the browser, silently, after the download has already happened.
      const { pairs } = await (await request.get(PAIRS)).json();
      const { files } = await (await request.get(`/_assets/tts/mt/en-es/manifest.json`)).json();
      expect(pairs.find((p) => p.pair === 'en-es').bytes)
        .toBe(files.reduce((sum, f) => sum + f.bytes, 0));

      for (const file of files) {
        const res = await request.head(`/_assets/tts/mt/en-es/${file.path}`);
        expect(res.status(), file.path).toBe(200);
        expect(Number(res.headers()['content-length']), file.path).toBe(file.bytes);
      }
    });

  test('the menu offers English plus the hosted languages, and says what each costs',
    async ({ page }) => {
      await page.goto(PAGE);
      await enterAndWait(page);

      const select = page.locator('[data-act="lang"]');
      await expect(select).toBeVisible({ timeout: 120_000 });
      await expect(select).toHaveValue('en');

      // DERIVED from pairs.json, not hardcoded. This asserted `toHaveCount(2)`
      // until French shipped as the second pair, at which point it failed for a
      // deployment change rather than a defect. The claim in the test's name is
      // "English plus the hosted languages", so that is what it should read.
      const hosted = await page.evaluate(async (url) => (await (await fetch(url)).json()).pairs,
        PAIRS);
      expect(hosted.length).toBeGreaterThan(0);
      await expect(select.locator('option')).toHaveCount(hosted.length + 1);

      // On a cold cache, before the reader commits to anything: the menu already
      // says what picking each language will cost. That is the whole difference
      // between an informed choice and a surprise.
      await expect(select.locator('option[value="es"]'))
        .toHaveText('español — machine translation (115 MB download)');
      await expect(select.locator('option[value="fr"]'))
        .toHaveText('français — machine translation (109 MB download)');
    });

  // EVERY OTHER HOSTED LANGUAGE, one test each. The Spanish test below is the
  // deep one -- streaming, seeking, the reference holdback, the two caches --
  // and repeating all of it per language would cost minutes per pair to
  // re-prove plumbing that is not per-language. What IS per-language, and what
  // nothing else can prove, is two things:
  //
  //   1. this pair's model actually loads and produces THAT language. A wrong
  //      or missing `forward_token`, a mispackaged export, or a tokenizer that
  //      silently falls back all produce fluent output in some language.
  //   2. `pipeline/lang_normalize.py`'s port is WIRED for that code. The pair is
  //      "en-nl" and the normaliser is keyed on "nl", and a mistake there is
  //      silent: untouched text is still perfectly good Dutch. It just says
  //      "twee punt nul" as "2.0".
  //
  // Markers are function words that cannot appear in the English source, so
  // "different from English" (which a mangled sentence also satisfies) is not
  // what is being asserted.
  const SPOKEN = {
    // es is covered in depth by the test below.
    // "point", not "virgule": `2.0` is a DOT, and every one of these languages
    // reads a dot with its own dot-word even where a comma would be "virgule" /
    // "komma" / "egész". Getting that backwards was this table's first bug.
    fr: { markers: /\b(les|des|que|pour|dans|une)\b/, decimal: 'point' },
    it: { markers: /\b(che|della|per|non|sono|dei)\b/, decimal: 'punto' },
    nl: { markers: /\b(van|het|een|dat|niet|worden)\b/, decimal: 'punt' },
    hu: { markers: /\b(hogy|nem|egy|volt|meg|azt)\b/, decimal: 'pont' },
    // "og"/"af"/"ikke" cannot appear in the English source; "for" and "der"
    // would have been the obvious picks and are both English words too.
    da: { markers: /\b(og|det|af|ikke|blev|som)\b/, decimal: 'punktum' },
    // "och"/"att"/"och" are Swedish-only; "av" and "som" would also match
    // Danish, which does not matter here but is why they are not the picks.
    sv: { markers: /\b(och|att|för|inte|är|från)\b/, decimal: 'punkt' },
    // Every marker here is German-only. "der" and "die" would have been the
    // obvious picks and are both readable as English words, which is the trap
    // this table's comments keep warning about. "Punkt" is CAPITALISED because
    // it is a German noun and the normaliser emits it that way -- the assertion
    // below is case-sensitive.
    de: { markers: /\b(und|nicht|sich|auch|eine|werden)\b/, decimal: 'Punkt' },
    // EVERY MARKER HERE IS ASCII, and that is not an aesthetic choice: `\b` in
    // JavaScript is defined over `[A-Za-z0-9_]` only, so `\bže\b` can never
    // match — there is no boundary between a space and `ž`. The first version
    // of this row was `že|které|není|při` and failed against perfectly good
    // Czech. src/lang-normalize.mjs documents the same trap and spells `\b`
    // out as a Unicode lookaround for exactly this reason; this table cannot,
    // because every other row depends on the ASCII one.
    //
    // These six are also Czech-only. "pro", "a", "na" and "ale" are all Czech
    // words and all readable as English, which is the trap this table's
    // comments keep warning about.
    cs: { markers: /\b(jsou|nebo|jako|bylo|tedy|velmi)\b/, decimal: 'tečka' },
  };

  test('every hosted language has an expectation here', async ({ request }) => {
    // A pair added to scripts/convert-mt-models.py without a row above would
    // otherwise ship with nobody ever having checked that it speaks its own
    // language -- the table would still be green because it never ran.
    const { pairs } = await (await request.get(PAIRS)).json();
    for (const { code } of pairs) {
      expect(code === 'es' || code in SPOKEN, `no SPOKEN row for ${code}`).toBe(true);
    }
  });

  for (const [code, { markers, decimal }] of Object.entries(SPOKEN)) {
    test(`picking ${code} speaks ${code}, with its numbers read as words`,
      async ({ page }) => {
        test.setTimeout(300_000);

        await page.addInitScript(() => {
          window.__synth = [];
          const RealWorker = window.Worker;
          window.Worker = class extends RealWorker {
            postMessage(message, transfer) {
              if (message?.type === 'synth') window.__synth.push(message.text);
              return super.postMessage(message, transfer);
            }
          };
        });

        await page.goto(PAGE);
        await enterAndWait(page);
        const select = page.locator('[data-act="lang"]');
        await expect(select).toBeVisible({ timeout: 120_000 });

        // The endonym comes from the OPTION the reader renders, not from a table
        // here: LANGUAGE_LABELS already owns that string and a second copy of it
        // would only ever disagree.
        const label = (await select.locator(`option[value="${code}"]`).textContent())
          .split(' — ')[0];
        await select.selectOption(code);
        await acceptTranslation(page, label);

        await expect(page.locator('.tts-dialog')).toHaveCount(0, { timeout: 180_000 });
        await expect(page.locator('.tts-status')).toHaveText('', { timeout: 180_000 });
        await expect(select).toHaveValue(code);

        // Seek to the sentence that carries a number, rather than trusting the
        // opening burst to contain one: an assertion over whatever happened to
        // be spoken passes when nothing spoken had a digit in it.
        const numeric = page.locator('.tts-sentence[data-tts-id="b6s1"]');
        await expect(numeric).toContainText('CC BY 2.0');
        await numeric.click();
        await expect(page.locator('.tts-status')).toHaveText('', { timeout: 180_000 });

        await page.evaluate(() => { window.__synth.length = 0; });
        await page.locator('[data-act="toggle"]').click();
        await expect.poll(() => page.evaluate(() => window.__synth.length),
          { timeout: 180_000 }).toBeGreaterThan(0);
        await page.locator('[data-act="toggle"]').click();  // pause

        const spoken = await page.evaluate(() => window.__synth.slice());
        expect(spoken[0], 'the number reached the voice as words').toContain(decimal);
        expect(spoken[0], 'a bare digit reached the voice').not.toMatch(/\d/);
        expect(spoken.some((t) => markers.test(t)),
          `spoken: ${JSON.stringify(spoken.slice(0, 2))}`).toBe(true);
      });
  }

  test('picking Spanish starts speaking Spanish within seconds, page unchanged',
    async ({ page }) => {
      test.setTimeout(300_000);

      // Watch what actually reaches the SPEECH engine. Everything else in this
      // test proves the plumbing ran; only this proves Spanish came out the far
      // end. The reader never rewrites the page, so there is nothing in the DOM
      // to look at, and a test that stops at "no error appeared" would pass just
      // as happily if every sentence were still English.
      await page.addInitScript(() => {
        window.__synth = [];
        window.__asked = [];
        const RealWorker = window.Worker;
        window.Worker = class extends RealWorker {
          postMessage(message, transfer) {
            if (message?.type === 'synth') window.__synth.push(message.text);
            // Everything the TRANSLATOR was asked for, which is the only place
            // step 10's reference holdback is observable: a bibliography entry
            // is proper nouns and years, so a translated one and an untranslated
            // one read the same and the audio cannot tell them apart.
            if (message?.type === 'translate') window.__asked.push(...message.lines);
            return super.postMessage(message, transfer);
          }
        };
      });

      await page.goto(PAGE);
      await enterAndWait(page);
      await expect(page.locator('[data-act="lang"]')).toBeVisible({ timeout: 120_000 });

      const firstSentence = page.locator('.tts-sentence').first();
      const englishBefore = await firstSentence.textContent();

      await page.locator('[data-act="lang"]').selectOption('es');
      await acceptTranslation(page);

      // Timed from the ACCEPT, not from the menu: how long a human spends reading
      // a consent dialog is not something this measurement is about.
      const startedAt = Date.now();

      // The download gets a modal with a bar; translation gets the status line.
      // Waiting for the dialog to go is waiting for the download to finish.
      await expect(page.locator('.tts-dialog')).toHaveCount(0, { timeout: 120_000 });
      await expect(page.locator('.tts-status')).toContainText('Translating', { timeout: 60_000 });
      await expect(page.locator('.tts-status')).toHaveText('', { timeout: 120_000 });

      // THE POINT OF STEP 6. Translating this 303-sentence page took ~60 s before
      // streaming; only a 16-sentence window has to be ready now. The bound is
      // loose because it includes a 115 MB model load and runs in headless
      // Chromium -- it is here to catch a regression to whole-page blocking, not
      // to police a second either way.
      const readyIn = (Date.now() - startedAt) / 1000;
      // Printed, not just asserted: the number is the whole point of step 6 and
      // a run that passes at 29 s is telling you something a green tick does not.
      console.log(`  ready to speak Spanish in ${readyIn.toFixed(1)}s`);
      expect(readyIn, `took ${readyIn.toFixed(1)}s to be ready`).toBeLessThan(30);

      // Nothing failed on the way.
      await expect(page.locator('.tts-dialog')).toHaveCount(0);
      await expect(page.locator('[data-act="lang"]')).toHaveValue('es');

      // The page is never rewritten. Only the audio changes -- highlighting runs
      // off the English manifest and must keep matching the visible text.
      expect(await firstSentence.textContent()).toBe(englishBefore);

      // TWO caches, which is why deleting a language cannot cost a reader the
      // voice. This is step 2's invariant observed end to end rather than mocked.
      expect(await page.evaluate(() => Promise.all([
        caches.has('libretexts-mt-v1'), caches.has('libretexts-tts-v1'),
      ]))).toEqual([true, true]);

      // Now play, and read what the speech engine was asked to say.
      const before = await page.evaluate(() => window.__synth.length);
      await page.locator('[data-act="toggle"]').click();
      await expect.poll(() => page.evaluate((n) => window.__synth.length > n, before),
        { timeout: 60_000 }).toBe(true);

      const spoken = await page.evaluate((n) => window.__synth.slice(n), before);
      // An ARRAY, not a Set: page.evaluate serialises structurally and a Set
      // arrives as {}, whose .includes is undefined -- a failure that reads like
      // the assertion rather than the plumbing.
      const english = await page.evaluate(async () => {
        const speech = await (await fetch('speech.json')).json();
        return speech.blocks.flatMap((b) => b.sentences).map((s) => s.speech);
      });
      // Not merely "different from English" -- a mangled sentence is different
      // too. Spanish function words that cannot appear in the English source.
      expect(spoken.some((t) => /\b(de la|que|los|para|una)\b/.test(t))).toBe(true);
      expect(spoken.every((t) => !english.includes(t))).toBe(true);
      // A MID-BOOK SEEK, which is what cursor-order scheduling is for. Sentence
      // 140 is far outside any window translated so far, so if priority were
      // document order this would be English -- the queue has to notice the
      // cursor moved and translate THERE.
      //
      // 140 and not 200: this page's last 103 sentences are its BIBLIOGRAPHY, and
      // since step 10 the translator is never asked for them at all -- so a seek
      // in there would find English by design, not by failure.
      //
      // A page that is a third bibliography is not unusual in this book, which
      // is why the holdback is the largest single saving the feature has.
      await page.locator('[data-act="toggle"]').click();  // pause
      // THE SPOKEN-FORM NORMALISER, end to end. Everything else about it is
      // proven in unit tests against 23,848 real lines; the one thing only the
      // real page can prove is that the target code reaches the worker at all --
      // `pair` is "en-es" and the normaliser is keyed on "es", and a wiring
      // mistake there is silent, because untouched text is still perfectly good
      // Spanish. It just says "dos punto cero" as "2.0".
      //
      // Seeks to the sentence rather than trusting the opening burst to reach
      // it: an assertion over whatever happened to be spoken passes when nothing
      // spoken had a number in it.
      const numeric = page.locator('.tts-sentence[data-tts-id="b6s1"]');
      await expect(numeric).toContainText('CC BY 2.0');
      await numeric.click();
      await expect(page.locator('.tts-status')).toHaveText('', { timeout: 120_000 });

      await page.evaluate(() => { window.__synth.length = 0; });
      await page.locator('[data-act="toggle"]').click();
      await expect
        .poll(() => page.evaluate(() => window.__synth.length), { timeout: 120_000 })
        .toBeGreaterThan(0);
      await page.locator('[data-act="toggle"]').click();  // pause

      const numericSpoken = (await page.evaluate(() => window.__synth.slice()))[0];
      expect(numericSpoken, 'the number reached the voice as words').toContain('punto');
      expect(numericSpoken, 'a bare digit reached the voice').not.toMatch(/\d/);

      const far = page.locator('.tts-sentence').nth(140);
      await far.click();

      // Wait the way a reader waits: the status line says it is translating
      // there, then clears. Pressing play before that is a race the reader can
      // also lose, which is why onPlay waits on the same gate.
      await expect(page.locator('.tts-status')).toContainText('Translating', { timeout: 60_000 });
      await expect(page.locator('.tts-status')).toHaveText('', { timeout: 120_000 });

      await page.evaluate(() => { window.__synth.length = 0; });
      await page.locator('[data-act="toggle"]').click();  // play from there
      await expect
        .poll(() => page.evaluate(() => window.__synth.length), { timeout: 120_000 })
        .toBeGreaterThan(0);

      const afterSeek = await page.evaluate(() => window.__synth.slice());
      expect(afterSeek.some((t) => /\b(de la|que|los|para|una)\b/.test(t)),
        `spoken after seek: ${JSON.stringify(afterSeek.slice(0, 2))}`).toBe(true);
      await page.locator('[data-act="toggle"]').click();  // pause

      // STEP 10: seek INTO the bibliography, which starts at sentence 200 of 303
      // on this page. The cursor has to actually get there -- asserting the
      // holdback from a cursor 60 sentences away passes whether the rule exists
      // or not, which is how this assertion was wrong the first time.
      const citation = page.locator('.tts-sentence[data-tts-id="b67s0"]');
      await expect(citation).toHaveText('Bobo, L. (1983).');
      await citation.click();

      // No wait for a status line here, and that is the observable difference:
      // there is nothing to translate at this cursor, so `ready()` resolves at
      // once and the reader is not made to wait for work that will not happen.
      await page.evaluate(() => { window.__synth.length = 0; });
      await page.locator('[data-act="toggle"]').click();
      await expect
        .poll(() => page.evaluate(() => window.__synth.length), { timeout: 120_000 })
        .toBeGreaterThan(0);
      await page.locator('[data-act="toggle"]').click();  // pause

      // Asserted on what was ASKED as well as on what was spoken, because a
      // citation is proper nouns and years: a translated one and an untranslated
      // one read almost the same, so the audio alone cannot tell them apart.
      // That is exactly why translating one is a SILENT error -- the real
      // checkpoint renamed a journal (`Psychological Science` ->
      // `Ciencia Psicologica`) and an author (`Sidanius` -> `Sidanio`) when it
      // was allowed to try.
      // The ENGLISH SPOKEN form, not the display text: a withheld sentence keeps
      // whatever the player already had, and that is `sentence.speech`, which has
      // been through the English spoken-form pass. Asserting on the display text
      // here fails on `(1983)` vs `(nineteen eighty three)` and reads like the
      // holdback is broken when it is working exactly as designed.
      expect(await page.evaluate(() => window.__synth.slice()))
        .toContain('Bobo, L. (nineteen eighty three).');
      const asked = await page.evaluate(() => window.__asked.slice());
      expect(asked.length).toBeGreaterThan(0);
      expect(asked, 'the translator was asked for a bibliography entry')
        .not.toContain('Bobo, L. (1983).');

      // Back to English costs nothing: the player kept the source text, so there
      // is no fetch, no model load and no progress line at all.
      await page.locator('[data-act="lang"]').selectOption('en');
      await expect(page.locator('[data-act="lang"]')).toHaveValue('en');
      await expect(page.locator('.tts-status')).toHaveText('');
      await expect(page.locator('.tts-dialog')).toHaveCount(0);

      // The menu said "115 MB download" before, and it is no longer true. It is
      // repainted rather than rebuilt, so the reader's selection survives.
      await expect(page.locator('option[value="es"]'))
        .toHaveText('español — machine translation (downloaded)');

      // And back to Spanish asks NOTHING: the model is already stored, so the
      // gate is about downloading, not about translating. Being asked to consent
      // to a download that is not going to happen trains people to click through.
      await page.locator('[data-act="lang"]').selectOption('es');
      await expect(page.locator('[data-act="lang"]')).toHaveValue('es');
      await expect(page.locator('.tts-dialog')).toHaveCount(0);

      // A RELOAD, because everything above would pass with no cache lookup at
      // all: setLanguageStored repaints the option after the download, in the
      // same session. This is the reader who downloaded Spanish yesterday, and
      // the only thing that can tell them is the lookup when the menu is built.
      await page.reload();
      await page.locator('#tts-enter').click();
      // No consent this time -- both models are stored -- so the bar is what to
      // wait for, not a dialog.
      await page.locator('.tts-bar').waitFor({ timeout: 120_000 });
      await expect(page.locator('option[value="es"]'))
        .toHaveText('español — machine translation (downloaded)', { timeout: 120_000 });
    });

  test('declining the download leaves nothing behind and says nothing more',
    async ({ page }) => {
      await page.goto(PAGE);
      await enterAndWait(page);
      await expect(page.locator('[data-act="lang"]')).toBeVisible({ timeout: 120_000 });

      await page.locator('[data-act="lang"]').selectOption('es');

      // What the reader is told before they decide: the size, the language, the
      // licence, and that it is kept and deletable. The licence is named because
      // this project's model choice was MADE on licence grounds -- NLLB is out
      // because its output is cc-by-nc-4.0 and cannot ship inside an MIT product.
      const dialog = page.locator('.tts-dialog');
      await expect(dialog.locator('h2')).toHaveText('Listen in español');
      await expect(dialog).toContainText(/\b1\d\d MB\b/);
      await expect(dialog).toContainText('apache-2.0');
      await expect(dialog).toContainText(/delete/i);

      await page.locator('[data-act="decline"]').click();

      // Still marked as a download, because it still is one.
      await expect(page.locator('option[value="es"]'))
        .toHaveText('español — machine translation (115 MB download)');

      // Nothing downloaded, and no cache entry -- not even an empty one. Asking
      // whether the models are present must not create the cache, which is why
      // modelsPresent checks caches.has() before caches.open().
      expect(await page.evaluate(() => caches.has('libretexts-mt-v1'))).toBe(false);

      // Silent: they answered the question, so there is nothing to report. And
      // the menu says what is actually playing.
      await expect(page.locator('.tts-dialog')).toHaveCount(0);
      await expect(page.locator('[data-act="lang"]')).toHaveValue('en');
      await expect(page.locator('.tts-status')).toHaveText('');
    });

  test('a translation that cannot load puts the reader back in English, once',
    async ({ page }) => {
      // Advertise a pair whose models are not there. `es` still passes the
      // LANGUAGE_LABELS allowlist, so it reaches the menu exactly as a real pair
      // would, and fails where a real one would fail: loading the model.
      await page.route(`**${PAIRS}`, (route) => route.fulfill({
        json: { version: 1, pairs: [{ code: 'es', pair: 'en-nonexistent', bytes: 1 }] },
      }));

      await page.goto(PAGE);
      await enterAndWait(page);
      await expect(page.locator('[data-act="lang"]')).toBeVisible({ timeout: 120_000 });

      const firstSentence = page.locator('.tts-sentence').first();
      const englishBefore = await firstSentence.textContent();

      await page.locator('[data-act="lang"]').selectOption('es');
      await acceptTranslation(page);

      // Reported once, and the menu says what is actually playing. A menu showing
      // Spanish while English plays is worse than the error.
      const error = page.locator('.tts-dialog [data-act="ok"]');
      await expect(error).toBeVisible({ timeout: 120_000 });
      await expect(page.locator('.tts-dialog')).toHaveCount(1);
      await expect(page.locator('[data-act="lang"]')).toHaveValue('en');

      // And the progress line is cleared: leaving "Translating into español…" up
      // next to an error says the opposite of what the error says.
      await expect(page.locator('.tts-status')).toHaveText('');
      expect(await firstSentence.textContent()).toBe(englishBefore);
    });
});
