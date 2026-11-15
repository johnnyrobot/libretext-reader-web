import { test, expect as baseExpect } from '@playwright/test';
const expect = baseExpect.configure({ timeout: 4000 });
test.setTimeout(60000);
const URL = '/chem_4b/AGENDA1/Example_Final_Conceptual_Questions/';

async function persistence(page, modes) {
  await page.addInitScript(modes => {
    window.persistenceCalls = 0;
    const configured = [...modes];
    Object.defineProperty(navigator.storage, 'persist', { configurable: true, value: modes[0] === 'missing' ? undefined : () => {
      window.persistenceCalls++;
      const mode = configured.shift() || 'denied';
      if (mode === 'throw') throw new Error('LT554 persistence unavailable');
      if (mode === 'rejected') return Promise.reject(new Error('LT554 persistence rejected'));
      if (mode === 'pending') return new Promise((resolve, reject) => {
        window.resolvePersistence = resolve;
        window.rejectPersistence = reject;
      });
      return Promise.resolve(false);
    }});
    window.audioStarts = 0;
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      window.audioStarts++;
      return start.apply(this, args);
    };
  }, modes);
}
async function enter(page) {
  await page.goto(URL);
  await page.locator('#tts-enter').click();
  await page.locator('[data-act=accept]').click();
  await expect(page.locator('.tts-bar')).toBeVisible({ timeout: 15000 });
}

for (const late of ['resolve', 'reject']) {
  test(`English entry proceeds with pending persistence and ignores late ${late}`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => { if (e.message.includes('LT554')) errors.push(e.message); });
    await persistence(page, ['pending']);
    await enter(page);
    await page.locator('[data-act=exit]').click();
    await page.locator('#tts-enter').click();
    await expect(page.locator('.tts-bar')).toBeVisible({ timeout: 15000 });
    expect(await page.evaluate(() => window.persistenceCalls)).toBe(1);
    await page.locator('[data-act=exit]').click();
    await page.evaluate(late => {
      if (late === 'resolve') window.resolvePersistence(true);
      else window.rejectPersistence(new Error('LT554 late rejection'));
    }, late);
    await expect(page.locator('.tts-bar')).toHaveCount(0);
    await expect(page.locator('html')).not.toHaveAttribute('data-tts-reader', 'on');
    await page.locator('#tts-enter').click();
    await expect(page.locator('.tts-bar')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-act=lang]')).toHaveValue('en');
    expect(errors).toEqual([]);
  });
}
for (const mode of ['denied', 'rejected', 'throw', 'missing']) {
  test(`English entry works when persistence is ${mode}`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => { if (e.message.includes('LT554')) errors.push(e.message); });
    await persistence(page, [mode]);
    await enter(page);
    await page.locator('[data-act=toggle]').click();
    await expect.poll(() => page.evaluate(() => window.audioStarts)).toBeGreaterThan(0);
    await page.locator('[data-act=toggle]').click();
    expect(errors).toEqual([]);
  });
}
for (const mode of ['pending', 'denied', 'rejected']) {
  test(`translation proceeds after consent when persistence is ${mode}`, async ({ page }) => {
    await persistence(page, ['denied', mode]);
    await enter(page);
    await page.locator('[data-act=lang]').selectOption('es');
    await expect(page.locator('.tts-dialog h2')).toHaveText('Listen in español');
    await page.locator('[data-act=accept]').click();
    await expect.poll(() => page.evaluate(() => window.persistenceCalls)).toBe(2);
    await expect(page.locator('.tts-status')).toContainText('Translating', { timeout: 30000 });
    await expect(page.locator('.tts-status')).toHaveText('', { timeout: 30000 });
    await page.locator('[data-act=toggle]').click();
    await expect.poll(() => page.evaluate(() => window.audioStarts)).toBeGreaterThan(0);
    await page.locator('[data-act=toggle]').click();
    await expect(page.locator('[data-act=lang]')).toHaveValue('es');
    if (mode === 'pending') {
      await page.locator('[data-act=lang]').selectOption('en');
      await page.evaluate(() => window.rejectPersistence(new Error('LT554 late translation rejection')));
      await expect(page.locator('[data-act=lang]')).toHaveValue('en');
    }
  });
}
test('translation does not duplicate an outstanding English persistence request', async ({ page }) => {
  await persistence(page, ['pending']);
  await enter(page);
  await page.locator('[data-act=lang]').selectOption('es');
  await page.locator('[data-act=accept]').click();
  await expect(page.locator('.tts-status')).toContainText('Translating', { timeout: 30000 });
  await expect(page.locator('.tts-status')).toHaveText('', { timeout: 30000 });
  expect(await page.evaluate(() => window.persistenceCalls)).toBe(1);
});
for (const translation of [false, true]) {
  test(`${translation ? 'translation' : 'English'} decline requests no persistence or model bytes`, async ({ page }) => {
    await persistence(page, ['denied']);
    if (translation) await enter(page);
    else await page.goto(URL);
    const before = await page.evaluate(() => window.persistenceCalls);
    const downloads = [];
    page.on('request', r => { if (/\.(onnx|bin)(?:\?|$)/.test(r.url())) downloads.push(r.url()); });
    if (translation) await page.locator('[data-act=lang]').selectOption('es');
    else await page.locator('#tts-enter').click();
    await page.locator('[data-act=decline]').click();
    expect(await page.evaluate(() => window.persistenceCalls)).toBe(before);
    expect(downloads).toEqual([]);
    if (translation) await expect(page.locator('[data-act=lang]')).toHaveValue('en');
    else await expect(page.locator('.tts-bar')).toHaveCount(0);
  });
}
