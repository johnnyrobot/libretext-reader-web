import { test, expect } from '@playwright/test';

const IN_SCOPE = '/social_psychology/13:_Competition_and_Cooperation_in_Our_Social_Worlds/13.01:_Conflict_Cooperation_Morality_and_Fairness/';

/** Enter Reader Mode from a cold cache and wait for the engine. */
async function enterAndWait(page) {
  await page.goto(IN_SCOPE);
  await page.locator('#tts-enter').click();
  await page.locator('.tts-dialog').waitFor();
  await page.locator('[data-act="accept"]').click();
  await page.locator('.tts-bar').waitFor();
}

test.describe('Reader Mode end to end', () => {
  test('consent names the size and the licence before a byte is fetched', async ({ page }) => {
    const modelRequests = [];
    page.on('request', (r) => {
      if (r.url().includes('/_assets/tts/onnx/')) modelRequests.push(r.url());
    });

    await page.goto(IN_SCOPE);
    await page.locator('#tts-enter').click();
    await page.locator('.tts-dialog').waitFor();

    const card = page.locator('.tts-dialog-card');
    await expect(card.locator('h2')).toHaveText('Listen to this page');
    await expect(card).toContainText('MB');
    await expect(card).toContainText('Nothing you read or hear is sent anywhere');
    await expect(card.locator('a[href*="LICENSE"]')).toContainText('OpenRAIL-M');

    // Invariant 3: nothing downloads before an explicit click.
    expect(modelRequests).toEqual([]);

    // And declining leaves nothing behind.
    await page.locator('[data-act="decline"]').click();
    expect(await page.evaluate(() => !!document.documentElement.dataset.ttsReader)).toBe(false);
    expect(await page.evaluate(() => caches.keys())).not.toContain('libretexts-tts-v1');
  });

  test('synthesises real audio and advances the highlight in order', async ({ page }) => {
    await enterAndWait(page);

    // Gate 2: audio came out, with real length. A worker that starts, hangs and
    // returns zeros looks identical to a healthy one without the peak check.
    const audio = await page.evaluate(async () => {
      const worker = new Worker('/_assets/tts/engine.worker.js', { type: 'module' });
      return await new Promise((resolve, reject) => {
        worker.onmessage = ({ data }) => {
          if (data.type === 'ready') {
            worker.postMessage({ type: 'synth', id: 's0', text: 'Conflict between groups is common.' });
          } else if (data.type === 'audio') {
            let peak = 0;
            for (let i = 0; i < data.samples.length; i += 13) peak = Math.max(peak, Math.abs(data.samples[i]));
            resolve({ samples: data.samples.length, rate: data.sampleRate, peak });
          } else if (data.type === 'error') reject(new Error(data.message));
        };
        worker.onerror = (e) => reject(new Error(e.message));
        worker.postMessage({ type: 'init', voice: 'M1', lang: 'en', manifestUrl: '/_assets/tts/manifest.json' });
      });
    });
    expect(audio.rate).toBe(44100);
    expect(audio.samples).toBeGreaterThan(44100);   // over a second of speech
    expect(audio.peak).toBeGreaterThan(0.01);       // not silence

    await expect(page.locator('[data-act="provider"]')).not.toBeEmpty();
    expect(await page.locator('.tts-sentence').count()).toBeGreaterThan(50);

    await page.locator('[data-act="toggle"]').click();
    await page.locator('.tts-current').waitFor();
    const first = await page.locator('.tts-current').getAttribute('data-tts-id');

    await page.waitForFunction(
      (prev) => document.querySelector('.tts-current')?.dataset.ttsId !== prev, first);
    const second = await page.locator('.tts-current').getAttribute('data-tts-id');

    expect(second).not.toBe(first);
    expect(await page.locator('.tts-current').count()).toBe(1);

    // The manifest's own order decides what "next" means.
    const order = await page.evaluate(() =>
      [...document.querySelectorAll('.tts-sentence')].map((el) => el.dataset.ttsId));
    expect(order.indexOf(second)).toBe(order.indexOf(first) + 1);
  });

  test('clicking a sentence seeks to it', async ({ page }) => {
    await enterAndWait(page);
    await page.locator('[data-act="toggle"]').click();
    await page.locator('.tts-current').waitFor();

    const target = page.locator('.tts-sentence').nth(20);
    const targetId = await target.getAttribute('data-tts-id');
    await target.click();

    await expect(page.locator(`.tts-current[data-tts-id="${targetId}"]`)).toHaveCount(1);
  });

  test('Display Text is wrapped, never rewritten', async ({ page }) => {
    await page.goto(IN_SCOPE);
    const before = await page.locator('#main-content').evaluate((el) => el.textContent);
    const links = await page.locator('#main-content a').count();

    await enterAndWait(page);

    const after = await page.locator('#main-content').evaluate((el) => el.textContent);
    expect(after).toBe(before);
    expect(await page.locator('#main-content a').count()).toBe(links);
  });

  test('never puts aria-live on the highlight', async ({ page }) => {
    await enterAndWait(page);
    await page.locator('[data-act="toggle"]').click();
    await page.locator('.tts-current').waitFor();
    expect(await page.locator('#main-content [aria-live]').count()).toBe(0);
  });

  test('inference stays off the main thread during playback', async ({ page }) => {
    await enterAndWait(page);

    await page.evaluate(() => {
      window.__longTasks = [];
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) window.__longTasks.push(entry.duration);
      }).observe({ entryTypes: ['longtask'] });
    });

    await page.locator('[data-act="toggle"]').click();
    await page.locator('.tts-current').waitFor();
    const first = await page.locator('.tts-current').getAttribute('data-tts-id');
    await page.waitForFunction(
      (prev) => document.querySelector('.tts-current')?.dataset.ttsId !== prev, first);

    // Inference is multi-second. If it ever ran on the main thread this would
    // be in the thousands, and the page would freeze mid-scroll.
    const worst = await page.evaluate(() => Math.max(0, ...window.__longTasks));
    expect(worst).toBeLessThan(100);
  });

  test('Esc exits and leaves the page as it was found', async ({ page }) => {
    await enterAndWait(page);
    await page.keyboard.press('Escape');

    await expect(page.locator('.tts-bar')).toHaveCount(0);
    expect(await page.evaluate(() => !!document.documentElement.dataset.ttsReader)).toBe(false);
    expect(await page.locator('#main-content .tts-current').count()).toBe(0);
    await expect(page.locator('#tts-enter')).toBeVisible();
  });
});
