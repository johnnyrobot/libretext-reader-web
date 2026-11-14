import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
test("Spanish playback preserves discussion and excludes panel text", async ({ page }) => {
  test.skip(!process.env.SR_CREDENTIALS_FILE, "Designated synthetic credentials required");
  await page.addInitScript(() => {
    window.srAudioStarts = 0;
    window.srWorkerText = [];
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      window.srAudioStarts++;
      return start.apply(this, args);
    };
    const WorkerClass = window.Worker;
    window.Worker = class extends WorkerClass {
      postMessage(message, transfer) {
        if (message?.type === "translate") window.srWorkerText.push(...message.lines);
        if (message?.type === "synth") window.srWorkerText.push(message.text);
        return super.postMessage(message, transfer);
      }
    };
  });
  await page.goto(URL);
  await page.locator("#tts-enter").click();
  await page.locator("[data-act=accept]").click();
  await expect(page.locator(".tts-bar")).toBeVisible();
  const original = await page.locator("main#main-content").textContent();
  await page.locator("#sr-entry").click();
  await expect(page.locator("#sr-panel")).toBeVisible();
  const credentials = JSON.parse(readFileSync(process.env.SR_CREDENTIALS_FILE, "utf8"));
  await page.locator("#sr-panel input[name=username]").fill("alice");
  await page.locator("#sr-panel input[name=password]").fill(credentials.alice);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
  const privateText = "PRIVATE_PANEL_SENTINEL_549_" + Date.now();
  await page.getByRole("textbox", { name: "Your question", exact: true }).fill(privateText);
  await page.getByRole("button", { name: "Post question", exact: true }).click();
  await expect(page.locator(".sr-thread").filter({ hasText: privateText })).toHaveCount(1);
  await page.locator("[data-act=lang]").selectOption("es");
  await expect(page.locator(".tts-dialog h2")).toHaveText("Listen in español");
  await page.locator("[data-act=accept]").click();
  await expect(page.locator(".tts-status")).toContainText("Translating");
  await expect(page.locator(".tts-status")).toHaveText("");
  await expect(page.locator("[data-act=lang]")).toHaveValue("es");
  await page.locator("[data-act=toggle]").click();
  await expect.poll(() => page.evaluate(() => window.srAudioStarts)).toBeGreaterThan(0);
  await page.locator("[data-act=toggle]").click();
  await expect(page.locator("#sr-panel")).toBeVisible();
  expect(await page.locator("main#main-content").textContent()).toBe(original);
  expect(await page.evaluate(() => JSON.stringify(window.srWorkerText))).not.toContain("PRIVATE_PANEL_SENTINEL_549");
  await expect(page.locator("#sr-panel .tts-sentence")).toHaveCount(0);
  await page.getByRole("button", { name: "Close discussion", exact: true }).click();
  await expect(page.locator("#sr-entry")).toBeFocused();
  await page.locator("[data-act=lang]").selectOption("en");
  await expect(page.locator("[data-act=lang]")).toHaveValue("en");
  await expect(page.locator(".tts-bar")).toBeVisible();
});
const URL =
  "/social_psychology/13%3A_Competition_and_Cooperation_in_Our_Social_Worlds/13.01%3A_Conflict_Cooperation_Morality_and_Fairness/";
test("Listen selection does not seek; discussion preserves playback and Escape only closes discussion", async ({
  page,
}) => {
  await page.goto(URL);
  await page.locator("#tts-enter").click();
  await page.locator("[data-act=accept]").click();
  await page.locator(".tts-bar").waitFor({ timeout: 60000 });
  await page.locator("[data-act=toggle]").click();
  await page.locator(".tts-current").waitFor({ timeout: 60000 });
  await page.locator("[data-act=toggle]").click();
  const before = await page.locator(".tts-current").getAttribute("data-tts-id");
  await page.evaluate(() => {
    const span = document.querySelectorAll(".tts-sentence")[20],
      r = document.createRange();
    r.selectNodeContents(span);
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(r);
    span.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  expect(await page.locator(".tts-current").getAttribute("data-tts-id")).toBe(
    before,
  );
  await page
    .getByRole("button", { name: "Discuss selected text", exact: true })
    .click();
  expect(await page.locator("#sr-panel .tts-sentence").count()).toBe(0);
  await page.locator("[data-act=toggle]").click();
  await page.waitForFunction(
    (previous) =>
      [...document.querySelectorAll(".tts-current")].some(current => current.dataset.ttsId && current.dataset.ttsId !== previous),
    before,
    { timeout: 60000 },
  );
  await page.locator("#sr-panel button").first().focus();
  await page.keyboard.press("Escape");
  await expect(page.locator("#sr-panel")).toBeHidden();
  await expect(page.locator(".tts-bar")).toBeVisible();
  await page.locator("[data-act=toggle]").click();
  await page.locator("[data-act=exit]").click();
  await expect(page.locator(".tts-sentence")).toHaveCount(0);
  await page.locator("#tts-enter").click();
  await expect(page.locator(".tts-bar")).toBeVisible({ timeout: 60000 });
});
