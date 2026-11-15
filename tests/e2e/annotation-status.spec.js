import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
const credentialsFile = process.env.SR_CREDENTIALS_FILE;
const URL = '/chem_4b/AGENDA1/Example_Final_Conceptual_Questions/';
test.skip(!credentialsFile, 'Designated synthetic credentials required');
test.setTimeout(30000);
async function signIn(page) {
  const credentials = JSON.parse(readFileSync(credentialsFile, 'utf8'));
  await page.goto(URL);
  await page.locator('#sr-entry').click();
  await page.locator('input[name=username]').fill('alice');
  await page.locator('input[name=password]').fill(credentials.alice);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
}
async function holdSession(page, outcome = 'authenticated') {
  let release, started, first = true;
  const gate = new Promise(resolve => { release = resolve; });
  const requestStarted = new Promise(resolve => { started = resolve; });
  await page.route('**/social-reading/api/session', async route => {
    const response = await route.fetch();
    if (first) {
      first = false;
      started();
      await gate;
    }
    if (outcome === 'authenticated') await route.fulfill({ response });
    else await route.fulfill({ status: outcome === 'anonymous' ? 401 : 503,
      json: { error: outcome === 'anonymous' ? 'Sign in to view private discussion.' : 'Sign-in check unavailable.' } });
  });
  return { release, requestStarted };
}
async function reopenDuringCheck(page, held) {
  await page.getByRole('button', { name: 'Close discussion', exact: true }).click();
  await page.locator('#sr-entry').click();
  await held.requestStarted;
  await page.keyboard.press('Escape');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status')).toHaveText('Checking sign-in…');
}
test('queued sign-in status completes after authenticated reopen', async ({ page }) => {
  await signIn(page);
  const held = await holdSession(page);
  try {
    await reopenDuringCheck(page, held);
    held.release();
    await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
    await expect(page.getByRole('status')).toHaveText('Signed in.', { timeout: 1500 });
    await expect(page.getByRole('button', { name: 'Close discussion', exact: true })).toBeFocused();
  } finally { held.release(); }
});

for (const outcome of ['anonymous', 'error']) {
  test(`queued check completes with the ${outcome} result`, async ({ page }) => {
    await signIn(page);
    const held = await holdSession(page, outcome);
    try {
      await reopenDuringCheck(page, held);
      held.release();
      await expect(page.getByRole('status')).toHaveText(outcome === 'anonymous'
        ? 'Sign in to view private discussion.' : 'Sign-in check unavailable.');
      await expect(page.locator('input[name=username]')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeHidden();
    } finally { held.release(); }
  });
}

test('final close clears only its checking message and late auth cannot reopen', async ({ page }) => {
  await signIn(page);
  const held = await holdSession(page);
  try {
    await reopenDuringCheck(page, held);
    await page.keyboard.press('Escape');
    await expect(page.locator('#sr-panel [role=status]')).toHaveText('');
    held.release();
    await expect(page.getByRole('button', { name: 'Use whole passage', exact: true, includeHidden: true })).toBeEnabled();
    await expect(page.locator('#sr-panel')).toBeHidden();
    await expect(page.locator('#sr-panel [role=status]')).toHaveText('');
    await expect(page.locator('#sr-entry')).toBeFocused();
  } finally { held.release(); }
});

test('revocation during queued check completes anonymously without private content', async ({ page }) => {
  await signIn(page);
  const held = await holdSession(page);
  try {
    await reopenDuringCheck(page, held);
    await page.evaluate(() => fetch('/social-reading/api/logout', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    }));
    held.release();
    await expect(page.locator('input[name=username]')).toBeVisible();
    await expect(page.getByRole('status')).not.toHaveText('Checking sign-in…');
    await expect(page.getByRole('status')).not.toHaveText('Signed in.');
    await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeHidden();
    await expect(page.getByRole('textbox', { name: 'Your question', exact: true })).toBeHidden();
  } finally { held.release(); }
});

for (const outcome of ['saved', 'unknown']) {
  test(`newer ${outcome} status survives the queued authorization replay`, async ({ page }) => {
    await signIn(page);
    let release, started;
    const gate = new Promise(resolve => { release = resolve; });
    const requestStarted = new Promise(resolve => { started = resolve; });
    await page.route('**/social-reading/api/commands', async route => {
      const response = outcome === 'saved' ? await route.fetch() : null;
      started();
      await gate;
      await route.fulfill(response ? { response } : { status: 503, json: { error: 'Outcome unavailable.' } });
    }, { times: 1 });
    try {
      await page.getByRole('textbox', { name: 'Your question', exact: true }).fill(`Status ownership ${outcome} ${Date.now()}`);
      await page.getByRole('button', { name: 'Post question', exact: true }).click();
      await requestStarted;
      await page.getByRole('button', { name: 'Close discussion', exact: true }).click();
      await page.locator('#sr-entry').click();
      await expect(page.getByRole('status')).toHaveText('Checking sign-in…');
      release();
      await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
      await expect(page.getByRole('status')).toContainText(outcome === 'saved'
        ? 'Saved and acknowledged.' : 'Check the pending submission');
    } finally { release(); }
  });
}

test('late login completion cannot replace status after final close', async ({ page }) => {
  await signIn(page);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Signed out. Page drafts were cleared.');
  const previousStatus = await page.getByRole('status').textContent();
  let release, started;
  const gate = new Promise(resolve => { release = resolve; });
  const requestStarted = new Promise(resolve => { started = resolve; });
  await page.route('**/social-reading/api/login', async route => {
    const response = await route.fetch();
    started();
    await gate;
    await route.fulfill({ response });
  }, { times: 1 });
  try {
    const credentials = JSON.parse(readFileSync(credentialsFile, 'utf8'));
    await page.locator('input[name=username]').fill('alice');
    await page.locator('input[name=password]').fill(credentials.alice);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await requestStarted;
    await page.getByRole('button', { name: 'Close discussion', exact: true }).click();
    release();
    await expect(page.getByRole('button', { name: 'Use whole passage', exact: true, includeHidden: true })).toBeEnabled();
    await expect(page.locator('#sr-panel')).toBeHidden();
    await expect(page.locator('#sr-panel [role=status]')).toHaveText(previousStatus);
  } finally { release(); }
});
