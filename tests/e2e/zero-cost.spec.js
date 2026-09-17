import { test, expect } from '@playwright/test';

const IN_SCOPE = '/social_psychology/13:_Competition_and_Cooperation_in_Our_Social_Worlds/13.01:_Conflict_Cooperation_Morality_and_Fairness/';
const OUT_OF_SCOPE = '/chem101/13:_Competition_and_Cooperation_in_Our_Social_Worlds/13.01:_Conflict_Cooperation_Morality_and_Fairness/';

test.describe('zero-cost-until-invoked (PRD NF1-NF6)', () => {
  test('an in-scope page makes at most one tts request and stores nothing', async ({ page }) => {
    const ttsRequests = [];
    page.on('request', (request) => {
      if (request.url().includes('/_assets/tts/')) ttsRequests.push(request.url());
    });

    await page.goto(IN_SCOPE);
    await page.waitForLoadState('networkidle');

    expect(ttsRequests.length).toBeLessThanOrEqual(1);
    expect(ttsRequests.every((url) => url.endsWith('/boot.js'))).toBe(true);

    // No worker, no model byte, no cache entry, no stored position.
    expect(await page.evaluate(() => caches.keys())).not.toContain('libretexts-tts-v1');
    expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('tts:'))))
      .toEqual([]);
    expect(await page.evaluate(() => !!document.documentElement.dataset.ttsReader)).toBe(false);
    expect(await page.locator('link[data-tts-style]').count()).toBe(0);
  });

  test('an out-of-scope page requests nothing and has no button', async ({ page }) => {
    const ttsRequests = [];
    page.on('request', (request) => {
      if (request.url().includes('/_assets/tts/')) ttsRequests.push(request.url());
    });

    await page.goto(OUT_OF_SCOPE);
    await page.waitForLoadState('networkidle');

    expect(ttsRequests).toEqual([]);
    await expect(page.locator('#tts-enter')).toHaveCount(0);
    // The pipeline refuses books off the allowlist, so the affordance is still
    // the original inert <div>.
    await expect(page.locator('div.reader-link')).toHaveCount(1);
  });

  test('the boot script is under 1 KB and served immutable', async ({ request }) => {
    const response = await request.get('/_assets/tts/boot.js');
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toContain('immutable');
    expect((await response.body()).length).toBeLessThan(1024);
  });

  test('the reader button is a real button and keyboard reachable', async ({ page }) => {
    await page.goto(IN_SCOPE);
    const button = page.locator('#tts-enter');
    await expect(button).toBeVisible();
    expect(await button.evaluate((el) => el.tagName)).toBe('BUTTON');
    await button.focus();
    expect(await page.evaluate(() => document.activeElement.id)).toBe('tts-enter');
  });

  test('the page is cross-origin isolated, which the RTF gate requires', async ({ page }) => {
    await page.goto(IN_SCOPE);
    expect(await page.evaluate(() => self.crossOriginIsolated)).toBe(true);
  });
});
