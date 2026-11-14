import { test, expect as baseExpect } from "@playwright/test";
import { readFileSync } from "node:fs";
const URL =
  "/social_psychology/13%3A_Competition_and_Cooperation_in_Our_Social_Worlds/13.01%3A_Conflict_Cooperation_Morality_and_Fairness/";
const credentialsFile = process.env.SR_CREDENTIALS_FILE;
test.use({ screenshot: "only-on-failure" });
test.setTimeout(60000);
const expect = baseExpect.configure({ timeout: 10000 });
test.skip(
  !credentialsFile,
  "Set SR_CREDENTIALS_FILE to designated local demo credentials.",
);
async function login(page, who) {
  const credentials = JSON.parse(readFileSync(credentialsFile, "utf8"));
  await page.locator("#sr-panel input[name=username]").fill(who);
  await page.locator("#sr-panel input[name=password]").fill(credentials[who]);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Sign out", exact: true }),
  ).toBeVisible();
}
async function selection(page) {
  await page.evaluate(() => {
    const m = JSON.parse(
      document.querySelector("#sr-page-context").textContent,
    );
    const p =
      document.querySelectorAll("main p")[Number(m.blocks[0].block.slice(2))];
    p.scrollIntoView({ block: "center" });
    const n = document.createTreeWalker(p, NodeFilter.SHOW_TEXT).nextNode(),
      r = document.createRange();
    r.setStart(n, 0);
    r.setEnd(n, 20);
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(r);
  });
  await page
    .getByRole("button", { name: "Discuss selected text", exact: true })
    .click();
}
test("existing textbook selection, two accounts, reload, restore and cross-book denial", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(URL);
  const original = await page.locator("main#main-content").innerHTML();
  await selection(page);
  await login(page, "alice");
  const question = "Reader UI verification " + Date.now();
  await page
    .getByRole("textbox", { name: "Your question", exact: true })
    .fill(question);
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith("/social-reading/api/commands") &&
      r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Post question", exact: true })
    .click();
  const accepted = await (await response).json();
  await expect(page.getByRole("status")).toContainText(
    "Saved and acknowledged",
  );
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await login(page, "bob");
  const row = page.locator(".sr-thread").filter({ hasText: question });
  await row
    .getByRole("textbox", { name: "Your reply", exact: true })
    .fill("The selected passage connects cooperation with social context.");
  await row.getByRole("button", { name: "Post reply", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(
    "Saved and acknowledged",
  );
  await page.reload();
  await page
    .getByRole("button", { name: "Discuss this page", exact: true })
    .click();
  await expect(
    page.locator(".sr-thread").filter({ hasText: question }),
  ).toContainText("The selected passage connects cooperation");
  await expect(
    page
      .locator(".sr-thread")
      .filter({ hasText: question })
      .locator("blockquote"),
  ).toHaveText("Whether we cooperate");
  expect(await page.locator("main#main-content").innerHTML()).toBe(original);
  await page
    .locator(".sr-thread")
    .filter({ hasText: question })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("desktop-panel.png") });
  const cross = await page.evaluate(
    async ({ thread }) => {
      const api = "/social-reading/api/";
      const manifest = await (
        await fetch(api + "manifest?book=chem_4b&page=index.html")
      ).json();
      const actor = await (await fetch(api + "session")).json();
      const r = await fetch(api + "commands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actor: actor.id,
          key: crypto.randomUUID(),
          kind: "reply",
          thread,
          version: 1,
          text: "Must be denied",
          context: {
            book: "chem_4b",
            page: "index.html",
            block: manifest.blocks[0].block,
          },
        }),
      });
      return r.status;
    },
    { thread: accepted.thread },
  );
  expect([403, 404, 409]).toContain(cross);
  await page
    .getByRole("textbox", { name: "Your question", exact: true })
    .fill("Preserve this draft");
  await page
    .getByRole("button", { name: "Close discussion", exact: true })
    .click();
  const position = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
  await page.locator("#sr-entry").focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("textbox", { name: "Your question", exact: true }),
  ).toHaveValue("Preserve this draft");
  await page.keyboard.press("Escape");
  await expect(page.locator("#sr-entry")).toBeFocused();
  expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual(
    position,
  );
  await page.setViewportSize({ width: 360, height: 800 });
  await page
    .getByRole("button", { name: "Discuss this page", exact: true })
    .click();
  await page
    .locator(".sr-thread")
    .filter({ hasText: question })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("mobile-panel.png") });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Close discussion", exact: true })
    .click();
  await page.screenshot({ path: info.outputPath("mobile-restored.png") });
  await page.goto("/chem_4b/");
  await page
    .getByRole("button", { name: "Discuss this page", exact: true })
    .click();
  await expect(page.locator("#sr-threads")).not.toContainText(question);
  await page
    .getByRole("button", { name: "Close discussion", exact: true })
    .click();
  await page.goto(URL);
  await page.locator("#tts-enter").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(await page.locator("main#main-content").innerHTML()).toBe(original);
});

test("retains a draft through unsupported selection", async ({ page }) => {
  await page.goto(URL);
  await page.locator("#sr-entry").click();
  await login(page, "alice");
  const input = page.getByRole("textbox", { name: "Your question", exact: true });
  await input.fill("Keep this unsent draft");
  await page.getByRole("button", { name: "Close discussion", exact: true }).click();
  await page.evaluate(() => {
    const ps = document.querySelectorAll("main p");
    const range = document.createRange();
    range.setStart(ps[0], 0);
    range.setEnd(ps[1], 1);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  });
  await page.getByRole("button", { name: "Selection unavailable", exact: true }).click();
  await page.getByRole("button", { name: "Use whole passage", exact: true }).click();
  await expect(input).toHaveValue("Keep this unsent draft");
});

test("rejects unsupported selections and clears drafts when another tab changes account", async ({
  page,
}) => {
  await page.goto(URL);
  await page
    .getByRole("button", { name: "Discuss this page", exact: true })
    .click();
  await login(page, "alice");
  await page
    .getByRole("textbox", { name: "Your question", exact: true })
    .fill("Private Alice draft");
  await page
    .getByRole("button", { name: "Close discussion", exact: true })
    .click();
  const credentials = JSON.parse(readFileSync(credentialsFile, "utf8"));
  await page.request.post("/social-reading/api/login", {
    headers: { Origin: "http://127.0.0.1:8788" },
    data: { username: "bob", password: credentials.bob },
  });
  await page
    .getByRole("button", { name: "Discuss this page", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Your question", exact: true }),
  ).toHaveValue("");
  await page
    .getByRole("button", { name: "Close discussion", exact: true })
    .click();
  await page.evaluate(() => {
    const ps = document.querySelectorAll("main p"),
      r = document.createRange();
    r.setStart(ps[0], 0);
    r.setEnd(ps[1], 1);
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(r);
  });
  await page
    .getByRole("button", { name: "Selection unavailable", exact: true })
    .click();
  await expect(page.locator("#sr-panel > blockquote")).toContainText(
    "one supported paragraph",
  );
  await expect(
    page.getByRole("button", { name: "Post question", exact: true }),
  ).toBeDisabled();
});

test("refresh revokes drafts when another tab changes accounts", async ({ page }) => {
  await page.goto(URL);
  await page.locator("#sr-entry").click();
  await login(page, "alice");
  const input = page.getByRole("textbox", { name: "Your question", exact: true });
  await input.fill("Alice private draft must not survive account switch");
  const credentials = JSON.parse(readFileSync(credentialsFile, "utf8"));
  await page.request.post("/social-reading/api/login", {
    headers: { Origin: "http://127.0.0.1:8788" },
    data: { username: "bob", password: credentials.bob },
  });
  await page.getByRole("button", { name: "Refresh discussion", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Account changed");
  await expect(page.locator(".sr-thread")).toHaveCount(0);
  await login(page, "bob");
  await expect(input).toHaveValue("");
});

test("reconciles a lost acknowledgment and distinguishes saved data from failed refresh", async ({
  page,
}) => {
  await page.goto(URL);
  await page
    .getByRole("button", { name: "Discuss this page", exact: true })
    .click();
  await login(page, "alice");
  const question = "Lost acknowledgment " + Date.now();
  await page.route(
    "**/social-reading/api/commands",
    async (route) => {
      await route.fetch();
      await route.abort();
    },
    { times: 1 },
  );
  await page
    .getByRole("textbox", { name: "Your question", exact: true })
    .fill(question);
  await page
    .getByRole("button", { name: "Post question", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("outcome unknown");
  await expect(page.getByRole("textbox", { name: "Your question", exact: true })).toBeDisabled();
  await page
    .getByRole("button", { name: "Close discussion", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Discuss this page", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-sr-composing",
    "true",
  );
  const credentials = JSON.parse(readFileSync(credentialsFile, "utf8"));
  await page
    .getByRole("button", { name: "Close discussion", exact: true })
    .click();
  await page.request.post("/social-reading/api/login", {
    headers: { Origin: "http://127.0.0.1:8788" },
    data: { username: "bob", password: credentials.bob },
  });
  await page
    .getByRole("button", { name: "Discuss this page", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Check pending submission", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await login(page, "alice");
  await page
    .getByRole("button", { name: "Check pending submission", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Saved and acknowledged",
  );
  await expect(
    page.locator(".sr-thread").filter({ hasText: question }),
  ).toHaveCount(1);
  await page.route(
    "**/social-reading/api/threads?*",
    (route) => route.abort(),
    { times: 1 },
  );
  await page
    .getByRole("textbox", { name: "Your question", exact: true })
    .fill("Refresh failure " + Date.now());
  await page
    .getByRole("button", { name: "Post question", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Saved and acknowledged. Refresh discussion",
  );
  await expect(
    page.getByRole("button", { name: "Check pending submission", exact: true }),
  ).toBeHidden();
});
