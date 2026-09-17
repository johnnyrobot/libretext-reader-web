import { test, expect } from '@playwright/test';

// Acceptance pages for spoken equations, one row per book.
//
// The spec named Chem 4B's First Law page (design doc S8.3), and that row is
// still the one that proves the thermodynamics wording. It is not the only row,
// because for the whole of this feature's development Chem 4B was not on the
// mirror and this file therefore never ran -- the single defect the final review
// caught (base64 reaching the voice) was exactly what an unrunnable acceptance
// test hides. math_elem_teachers is the regression corpus and is always present,
// so at least one row always executes.
//
// A row whose speech.json 404s is SKIPPED, not failed: a book absent from this
// origin is a staging fact, not a defect. A row that is present must pass.
// Run against the staged copy (scripts/stage-local.sh) or any origin:
//   TTS_BASE_URL=https://library.libretexts.dev npx playwright test tests/e2e/equations.spec.js
const PAGES = [
  {
    book: 'math_elem_teachers',
    path: '/math_elem_teachers/06:_Place_Value_and_Decimals/6.04:_Division_and_Decimals/',
    minSpoken: 20,
    // Fractions are this book's own notation; "six thirds" is Clearspeak reading
    // \frac{6}{3}, which is the whole point of the feature on this page.
    mustSay: 'six thirds',
  },
  {
    book: 'chem_4b',
    path: '/chem_4b/Chem_4B_Textbook/Unit_I:_Chemical_Thermodynamics/I:_Fundamentals_of_Thermochemistry_(Heat_and_Enthalpy)/1.04:_The_First_Law_of_Thermodynamics/',
    // The plan guessed >20 for this page before it could be built. Measured, it
    // carries 30 token OCCURRENCES but only 13 DISTINCT spans, and math.spoken
    // counts distinct ones (pipeline/tts_manifest.py). 10 is the honest floor.
    minSpoken: 10,
    mustSay: 'Delta U sub sys equals q plus w',
  },
];

for (const { book, path, minSpoken, mustSay } of PAGES) {
  test.describe(`Spoken equations: ${book}`, () => {
    test('the manifest spoke every equation on the page', async ({ request }) => {
      const res = await request.get(`${path}speech.json`);
      test.skip(res.status() === 404, `${book} is not on this origin`);
      expect(res.ok()).toBeTruthy();
      const manifest = await res.json();

      expect(manifest.math.failed).toBe(0);
      expect(manifest.math.spoken).toBeGreaterThan(minSpoken);

      const speech = manifest.blocks
        .flatMap((b) => b.sentences.map((s) => s.speech))
        .join(' ');
      expect(speech).toContain(mustSay);
      // The load-bearing negative: a token that reached the voice as base64 is
      // the failure this feature exists to prevent, and a split token is how it
      // happened once already (pipeline/tokenize.py keeps a token unbreakable).
      expect(speech).not.toContain('latex:');
    });

    test('a paragraph with a typeset equation mounts instead of being dropped', async ({ page, request }) => {
      const res = await request.get(`${path}speech.json`);
      test.skip(res.status() === 404, `${book} is not on this origin`);

      await page.goto(path);
      // MathJax must have typeset before Reader Mode is entered, as it has for a
      // real reader. Either renderer produces <mjx-container>.
      await page.waitForFunction(() => document.querySelectorAll('mjx-container').length > 10);

      await page.locator('#tts-enter').click();
      await page.locator('.tts-dialog').waitFor();
      await page.locator('[data-act="accept"]').click();
      await page.locator('.tts-bar').waitFor();

      const wrapped = await page.evaluate(() => [...document.querySelectorAll('.tts-sentence')]
        .filter((s) => s.querySelector('mjx-container')).length);
      expect(wrapped).toBeGreaterThan(5);
    });
  });
}
