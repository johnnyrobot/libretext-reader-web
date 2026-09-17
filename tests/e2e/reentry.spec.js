import { test, expect } from '@playwright/test';

const IN_SCOPE = '/social_psychology/13:_Competition_and_Cooperation_in_Our_Social_Worlds/13.01:_Conflict_Cooperation_Morality_and_Fairness/';

async function enterAndWait(page) {
  await page.locator('#tts-enter').click();
  const dialog = page.locator('.tts-dialog');
  // Warm cache skips consent entirely, so do not assume the dialog appears.
  const outcome = await Promise.race([
    dialog.waitFor({ state: 'visible', timeout: 30_000 }).then(() => 'consent'),
    page.locator('.tts-bar').waitFor({ state: 'visible', timeout: 30_000 }).then(() => 'warm'),
  ]);
  if (outcome === 'consent') {
    const accept = page.locator('[data-act="accept"]');
    if (await accept.count()) await accept.click();
  }
  await page.locator('.tts-bar').waitFor({ state: 'visible' });
}

test.describe('leaving and re-entering Reader Mode', () => {
  test('re-entering still finds the sentences', async ({ page }) => {
    await page.goto(IN_SCOPE);

    await enterAndWait(page);
    const firstCount = await page.locator('.tts-sentence').count();
    expect(firstCount).toBeGreaterThan(0);

    await page.locator('[data-act="exit"]').click();
    await expect(page.locator('.tts-bar')).toHaveCount(0);

    // The reported bug: this second entry showed "The voice could not start --
    // Nothing on this page could be matched to the reading list."
    await enterAndWait(page);

    // COUNT, not .not.toHaveText(). A negative text assertion still requires the
    // element to resolve, so when the dialog is correctly absent Playwright waits
    // the full timeout and then fails -- reporting a passing fix as a failure.
    expect(await page.getByRole('heading', { name: 'The voice could not start' }).count())
      .toBe(0);

    const secondCount = await page.locator('.tts-sentence').count();
    expect(secondCount).toBe(firstCount);
  });
});
