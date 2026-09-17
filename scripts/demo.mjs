/**
 * Demo driver for the LibreTexts TTS Reader.
 *
 * Two modes, because a demo has one problem this feature creates for itself:
 * the first run downloads 380 MB, and nobody wants to watch that.
 *
 *   node scripts/demo.mjs warm    populate Cache Storage in a persistent
 *                                 profile, so the recorded run starts instantly
 *   node scripts/demo.mjs record  drive the choreography with video capture
 *   node scripts/demo.mjs open    open the warmed profile in a headed browser
 *                                 and leave it for you to screen-record
 *
 * Use `open` for the real demo. Playwright's video capture has NO AUDIO, and
 * for a text-to-speech reader the audio is the entire point -- record the screen
 * yourself (QuickTime, OBS) so the voice is on the recording.
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const MODE = process.argv[2] ?? 'open';
const URL = process.env.DEMO_URL
  ?? 'https://library.libretexts.dev/social_psychology/13%3A_Competition_and_Cooperation_in_Our_Social_Worlds/13.01%3A_Conflict_Cooperation_Morality_and_Fairness/';
const PROFILE = process.env.DEMO_PROFILE ?? '.demo-profile';
const OUT = process.env.DEMO_OUT ?? 'demo-out';

mkdirSync(PROFILE, { recursive: true });
mkdirSync(OUT, { recursive: true });

const context = await chromium.launchPersistentContext(PROFILE, {
  headless: MODE === 'warm' || MODE === 'record',
  viewport: { width: 1280, height: 820 },
  args: ['--autoplay-policy=no-user-gesture-required'],
  ...(MODE === 'record' ? { recordVideo: { dir: OUT, size: { width: 1280, height: 820 } } } : {}),
});

const page = context.pages()[0] ?? await context.newPage();
const beat = (ms) => page.waitForTimeout(ms);

await page.goto(URL, { waitUntil: 'load' });

/**
 * Press the button and get to a playable state.
 *
 * A warm profile skips the consent dialog entirely, so this cannot just wait
 * for the dialog with a short timeout and assume "not there yet" means "warm" --
 * that is how the first version hung: it missed a slow-arriving dialog, never
 * clicked Accept, and then waited 15 minutes for a transport bar that was never
 * coming. Race the two outcomes instead, and say which one won.
 */
async function enter(page, { onProgress = true } = {}) {
  await page.locator('#tts-enter').click();

  const dialog = page.locator('.tts-dialog-card').first();
  const bar = page.locator('.tts-bar');
  const outcome = await Promise.race([
    dialog.waitFor({ state: 'visible', timeout: 60_000 }).then(() => 'consent'),
    bar.waitFor({ state: 'visible', timeout: 60_000 }).then(() => 'warm'),
  ]);

  if (outcome === 'consent') {
    const accept = page.locator('[data-act="accept"]');
    if (await accept.count()) {
      console.log('consent shown — accepting; the 380 MB download starts now');
      await beat(2500);                   // let the privacy text be readable
      await accept.click();
    }
    if (onProgress) {
      const label = page.locator('.tts-progress-file');
      const tick = setInterval(async () => {
        const text = await label.textContent().catch(() => null);
        if (text) process.stdout.write(`\r  ${text.padEnd(60)}`);
      }, 1000);
      await bar.waitFor({ timeout: 900_000 }).finally(() => { clearInterval(tick); });
      process.stdout.write('\n');
    } else {
      await bar.waitFor({ timeout: 900_000 });
    }
  } else {
    console.log('profile already warm — straight to the transport bar');
  }

  console.log('ready — provider:', await page.locator('[data-act="provider"]').textContent());
}

if (MODE === 'warm') {
  console.log('warming the model cache');
  await enter(page);
  await context.close();
  process.exit(0);
}

if (MODE === 'open') {
  console.log(`Opened ${URL}`);
  console.log('Profile is warm, so Enter Reader Mode goes straight to the transport bar.');
  console.log('Start your screen recorder, then drive it by hand. Ctrl-C here when done.');
  await new Promise(() => {}); // hold the browser open
}

// --- record -----------------------------------------------------------------
await beat(1200);
await enter(page);
await beat(900);

await page.locator('[data-act="toggle"]').click();
await page.locator('.tts-current').waitFor({ timeout: 180_000 });

// Let it read several sentences so the highlight visibly tracks the voice.
let id = await page.locator('.tts-current').getAttribute('data-tts-id');
for (let i = 0; i < 4; i += 1) {
  await page.waitForFunction(
    (prev) => document.querySelector('.tts-current')?.dataset.ttsId !== prev, id,
    { timeout: 180_000 });
  id = await page.locator('.tts-current').getAttribute('data-tts-id');
}

// Seek by clicking a sentence further down the page.
const target = page.locator('.tts-sentence').nth(24);
await target.scrollIntoViewIfNeeded();
await beat(700);
await target.click();
await beat(4000);

// Change speed, then exit.
await page.locator('[data-act="rate"]').selectOption('1.25');
await beat(4000);
await page.keyboard.press('Escape');
await beat(1500);

await context.close();
console.log(`video written under ${OUT}/ (silent — Playwright does not capture audio)`);
