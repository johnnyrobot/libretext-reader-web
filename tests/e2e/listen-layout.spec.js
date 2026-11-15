import { test, expect as baseExpect, chromium, webkit } from '@playwright/test';

const expect = baseExpect.configure({ timeout: 3000 });
test.setTimeout(30000);
const URL = '/chem_4b/AGENDA1/Example_Final_Conceptual_Questions/';
test('initialized narrow Listen controls fit without horizontal scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(URL);
  await page.locator('#tts-enter').click();
  await page.locator('[data-act=accept]').click();
  await expect(page.locator('.tts-bar')).toBeVisible();
  const widths = await page.locator('.tts-bar').evaluate(e => ({ client: e.clientWidth, scroll: e.scrollWidth }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client);
  for (const control of await page.locator('.tts-bar button,.tts-bar select').all()) {
    const box = await control.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(320);
  }
});

for (const [engine, type] of [['Chromium', chromium], ['WebKit', webkit]]) {
  for (const [width, height, enlarged] of [[1440, 1000, false], [320, 800, false], [800, 320, false], [320, 256, false], [320, 256, true]]) {
    test(`${engine} Listen and discussion remain reachable at ${width}x${height} enlarged ${enlarged}`, async ({ baseURL }) => {
      const browser = await type.launch();
      try {
        const page = await browser.newPage({ baseURL, viewport: { width, height } });
        page.setDefaultTimeout(8000);
        await page.goto(URL);
        await page.locator('#tts-enter').click();
        const card = await page.locator('.tts-dialog-card').boundingBox();
        await page.mouse.move(card.x + card.width / 2, card.y + card.height / 2);
        await page.mouse.wheel(0, 2000);
        await expect.poll(() => page.locator('[data-act=accept]').evaluate(e => {
          const r = e.getBoundingClientRect(), hit = document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
          return hit === e || e.contains(hit);
        }), { timeout: 3000 }).toBe(true);
        await page.locator('[data-act=accept]').click();
        await expect(page.locator('.tts-bar')).toBeVisible();
        if (enlarged) await page.evaluate(() => {
          document.documentElement.style.fontSize = '200%';
          document.querySelector('.tts-bar').style.fontSize = '28px';
          for (const e of document.querySelectorAll('.tts-bar *')) {
            e.style.lineHeight = '1.5';
            e.style.letterSpacing = '.12em';
            e.style.wordSpacing = '.16em';
          }
        });
        await expect.poll(() => page.locator('.tts-bar').evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
        // Start at the first control; subsequent movement is ordinary Tab scrolling.
        await page.locator('[data-act=prev]').focus();
        const controls = ['prev', 'toggle', 'next', 'voice', 'lang', 'rate', 'exit'];
        for (const act of controls) {
          await expect(page.locator(`[data-act=${act}]`)).toBeFocused();
          await expect.poll(() => page.evaluate(() => {
            const e = document.activeElement, r = e.getBoundingClientRect();
            const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
            return r.left >= -1 && r.right <= innerWidth + 1 && r.top >= 0 && r.bottom <= innerHeight + 1 && (hit === e || e.contains(hit));
          })).toBe(true);
          if (act !== 'exit') await page.keyboard.press(engine === 'WebKit' ? 'Alt+Tab' : 'Tab');
        }
        await page.locator('[data-act=rate]').selectOption('1.25');
        await expect(page.locator('[data-act=rate]')).toHaveValue('1.25');
        await page.locator('[data-act=voice]').selectOption('F1');
        await expect(page.locator('[data-act=voice]')).toHaveValue('F1');
        await page.locator('#sr-entry').focus();
        await page.keyboard.press('Enter');
        await expect(page.locator('#sr-panel')).toBeVisible();
        await expect.poll(() => page.evaluate(() => {
          const bar = document.querySelector('.tts-bar').getBoundingClientRect();
          const panel = document.querySelector('#sr-panel').getBoundingClientRect();
          return panel.top >= 0 && panel.height > 0 && panel.bottom <= bar.top + 1;
        })).toBe(true);
        await page.keyboard.press(engine === 'WebKit' ? 'Alt+Shift+Tab' : 'Shift+Tab');
        await expect.poll(() => page.evaluate(() => {
          const e = document.activeElement, r = e.getBoundingClientRect();
          const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return e !== document.body && r.top >= 0 && r.bottom <= innerHeight + 1 && (hit === e || e.contains(hit));
        })).toBe(true);
        await page.getByRole('button', { name: 'Close discussion', exact: true }).click();
        await expect(page.locator('#sr-entry')).toBeFocused();
        const bar = await page.locator('.tts-bar').boundingBox();
        await page.mouse.move(bar.x + bar.width / 2, bar.y + bar.height / 2);
        await page.mouse.wheel(0, 2000);
        await expect.poll(() => page.locator('[data-act=exit]').evaluate(e => {
          const r = e.getBoundingClientRect(), hit = document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
          return hit === e || e.contains(hit);
        })).toBe(true);
        await page.screenshot({ path: `.scratch/lt553/${engine}-${width}-${height}-${enlarged}.png` });
        await page.locator('[data-act=exit]').click();
        await expect(page.locator('.tts-bar')).toHaveCount(0);
        expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--tts-bar-height'))).toBe('');
        await page.locator('#tts-enter').click();
        await expect(page.locator('.tts-bar')).toBeVisible();
        await page.setViewportSize({ width: width === 320 ? 800 : 320, height: 800 });
        await page.locator('#sr-entry').focus();
        await page.keyboard.press('Enter');
        await expect.poll(() => page.evaluate(() => {
          const bar = document.querySelector('.tts-bar').getBoundingClientRect();
          const panel = document.querySelector('#sr-panel').getBoundingClientRect();
          return panel.height > 0 && panel.bottom <= bar.top + 1;
        }), { timeout: 3000 }).toBe(true);
      } finally { await browser.close(); }
    });
  }
}
