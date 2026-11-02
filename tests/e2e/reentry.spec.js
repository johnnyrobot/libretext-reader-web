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

  // LT-223. A reader who presses the button again while the page is still loading
  // got a second "Listen to this page" dialog stacked on the first. Accepting the
  // top one opened Reader Mode and left the other on screen, over the page.
  test('pressing Enter Reader Mode again while it loads opens one dialog', async ({ page }) => {
    // Hold the reading list back so both presses land before the first dialog.
    await page.route(/\/speech\.json$/, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      await route.continue();
    });
    await page.goto(IN_SCOPE);

    await page.locator('#tts-enter').click();
    // A fixed wait, not a condition: the bug is a press that lands while nothing
    // visible has happened yet, so there is nothing on the page to wait for.
    await page.waitForTimeout(1_000);
    await page.locator('#tts-enter').click();

    await page.locator('.tts-dialog').first().waitFor({ state: 'visible', timeout: 30_000 });
    // Long enough for a second flow, held back by the same delay, to catch up.
    await page.waitForTimeout(4_000);
    await expect(page.locator('.tts-dialog')).toHaveCount(1);

    await page.locator('[data-act="accept"]').click();
    await page.locator('.tts-bar').waitFor({ state: 'visible' });
    await expect(page.locator('.tts-dialog')).toHaveCount(0);
    await expect(page.locator('.tts-bar')).toHaveCount(1);
  });

  // Sharing the entry in progress must not make the button single-use: a reader
  // who says "Not now" can still change their mind (LT-223).
  test('after "Not now", pressing Enter Reader Mode asks again', async ({ page }) => {
    await page.goto(IN_SCOPE);

    await page.locator('#tts-enter').click();
    await page.locator('[data-act="decline"]').click();
    await expect(page.locator('.tts-dialog')).toHaveCount(0);

    await page.locator('#tts-enter').click();
    await expect(page.getByRole('heading', { name: 'Listen to this page' })).toBeVisible();
  });

  // Cancelling the download used to leave the page's sentences wrapped, and the
  // next press then reported "Nothing on this page could be matched to the
  // reading list" -- the same leftover the exit path already cleans up.
  test('after Cancel, pressing Enter Reader Mode opens Reader Mode', async ({ page }) => {
    // Slow the voice download so there is time to press Cancel during it.
    await page.route(/\/phonon\/onnx\//, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      await route.continue();
    });
    await page.goto(IN_SCOPE);

    await page.locator('#tts-enter').click();
    await page.locator('[data-act="accept"]').click();
    await page.locator('[data-act="cancel"]').click();
    // The load cannot be aborted, so the button comes back once it finishes.
    await page.locator('#tts-enter').waitFor({ state: 'visible' });

    await enterAndWait(page);
    expect(await page.getByRole('heading', { name: 'The voice could not start' }).count())
      .toBe(0);
    expect(await page.locator('.tts-sentence').count()).toBeGreaterThan(0);
  });
});
