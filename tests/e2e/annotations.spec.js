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
test("keyboard focus survives login and logout", async ({ page }) => {
  await page.goto(URL);
  await page.locator("#sr-entry").click();
  const credentials = JSON.parse(readFileSync(credentialsFile, "utf8"));
  await page.locator("#sr-panel input[name=username]").fill("alice");
  await page.locator("#sr-panel input[name=password]").fill(credentials.alice);
  await page.getByRole("button", { name: "Sign in", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("textbox", { name: "Your question", exact: true })).toBeFocused({ timeout: 1000 });
  await page.getByRole("button", { name: "Sign out", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#sr-panel input[name=username]")).toBeFocused();
});

test("keyboard exact quote and repeated occurrence are available without page dragging", async ({ page }) => {
  await page.goto(URL);
  await page.locator("#sr-entry").click();
  await page.getByRole("textbox", { name: "Exact quote (optional)", exact: true }).fill("Whether we cooperate");
  await page.getByRole("button", { name: "Use exact quote", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("blockquote", { name: "Selected passage", exact: true })).toHaveText("Whether we cooperate");
  await expect(page.getByRole("status")).toContainText("Exact quote selected");
  await page.getByRole("spinbutton", { name: "Quote occurrence", exact: true }).fill("2");
  await page.getByRole("button", { name: "Use exact quote", exact: true }).click();
  await expect(page.getByRole("spinbutton", { name: "Quote occurrence", exact: true })).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#sr-quote-error")).toContainText("not in this passage");
});

test("session warning allows extension without losing a draft", async ({ page }) => {
  await page.route("**/social-reading/api/session", async route => {
    const response = await route.fetch();
    if (response.status() !== 200) return route.fulfill({ response });
    const body = await response.json();
    body.timing = { serverNow: 1000, expiresAt: 61000, warningSeconds: 300, canExtend: true, extensionSeconds: 28800 };
    await route.fulfill({ response, json: body });
  });
  await page.goto(URL);
  await page.locator("#sr-entry").click();
  await login(page, "alice");
  await page.getByRole("textbox", { name: "Your question", exact: true }).fill("Keep this timed draft");
  await expect(page.locator("#sr-session-notice")).toBeVisible();
  await page.getByRole("button", { name: "Stay signed in", exact: true }).click();
  await expect(page.locator("#sr-session-notice")).toBeHidden();
  await expect(page.getByRole("textbox", { name: "Your question", exact: true })).toHaveValue("Keep this timed draft");
  await expect(page.getByRole("status")).toContainText("Session extended");
});

test("session warning stays operable at 320px with enlarged spaced text", async ({ page }) => {
  await page.clock.install();
  await page.setViewportSize({ width: 320, height: 800 });
  await page.route("**/social-reading/api/session", async route => {
    const response = await route.fetch();
    if (response.status() !== 200) return route.fulfill({ response });
    const body = await response.json();
    body.timing = { serverNow: 1000, expiresAt: 61000, warningSeconds: 300, canExtend: true, extensionSeconds: 28800 };
    await route.fulfill({ response, json: body });
  });
  await page.goto(URL);
  await page.locator("#sr-entry").click();
  await login(page, "alice");
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
    for (const el of document.querySelectorAll("#sr-panel,#sr-panel *")) {
      el.style.setProperty("line-height", "1.5", "important");
      el.style.setProperty("letter-spacing", ".12em", "important");
      el.style.setProperty("word-spacing", ".16em", "important");
      if (el.tagName === "P") el.style.setProperty("margin-bottom", "2em", "important");
    }
  });
  await page.getByRole("button", { name: "Stay signed in", exact: true }).click({ timeout: 1500 });
  await expect(page.locator("#sr-session-notice")).toBeHidden();
  await page.getByRole("button", { name: "Sign out", exact: true }).click({ timeout: 1500 });
  await expect(page.locator("#sr-panel input[name=username]")).toBeFocused();
});

test("failed session extension keeps warning draft and keyboard focus", async ({ page }) => {
  await page.route("**/social-reading/api/session", async route => {
    const response = await route.fetch();
    if (response.status() !== 200) return route.fulfill({ response });
    const body = await response.json();
    body.timing = { serverNow: 1000, expiresAt: 61000, warningSeconds: 300, canExtend: true, extensionSeconds: 28800 };
    await route.fulfill({ response, json: body });
  });
  await page.route("**/social-reading/api/session/extend", route => route.fulfill({ status: 503, json: { error: "Extension unavailable. Try again.", code: "REQUEST_FAILED" } }));
  await page.goto(URL);
  await page.locator("#sr-entry").click();
  await login(page, "alice");
  const input = page.getByRole("textbox", { name: "Your question", exact: true });
  await input.fill("Do not lose this draft");
  await page.getByRole("button", { name: "Close discussion", exact: true }).click();
  const extend = page.getByRole("button", { name: "Stay signed in", exact: true });
  await extend.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#sr-session-notice")).toContainText("Extension unavailable");
  await expect(extend).toBeFocused();
  await expect(page.locator("#sr-session-notice")).toBeVisible();
  await page.locator("#sr-entry").click();
  await expect(input).toHaveValue("Do not lose this draft");
});

for (const closed of [false, true]) {
  test(`expiry restores focus from warning with panel ${closed ? "closed" : "open"}`, async ({ page }) => {
    await page.clock.install();
    await page.route("**/social-reading/api/session", async route => {
      const response = await route.fetch();
      if (response.status() !== 200) return route.fulfill({ response });
      const body = await response.json();
      body.timing = { serverNow: 1000, expiresAt: 3000, warningSeconds: 300, canExtend: true, extensionSeconds: 28800 };
      await route.fulfill({ response, json: body });
    });
    await page.goto(URL);
    await page.locator("#sr-entry").click();
    await login(page, "alice");
    if (closed) await page.getByRole("button", { name: "Close discussion", exact: true }).click();
    await page.getByRole("button", { name: "Stay signed in", exact: true }).focus();
    await page.clock.runFor(2100);
    await expect(closed ? page.locator("#sr-entry") : page.locator("#sr-panel input[name=username]")).toBeFocused({ timeout: 1000 });
    await expect(page.locator("#sr-session-notice")).toContainText("expired");
  });
}

for (const account of ["alice", "bob"]) {
  test(`expiry keeps drafts private until reauthentication as ${account}`, async ({ page }) => {
    await page.clock.install();
    await page.route("**/social-reading/api/session", async route => {
      const response = await route.fetch();
      if (response.status() !== 200) return route.fulfill({ response });
      const body = await response.json();
      body.timing = { serverNow: 1000, expiresAt: 3000, warningSeconds: 300, canExtend: true, extensionSeconds: 28800 };
      await route.fulfill({ response, json: body });
    });
    await page.goto(URL);
    await page.locator("#sr-entry").click();
    await login(page, "alice");
    const input = page.getByRole("textbox", { name: "Your question", exact: true });
    await input.fill("Private expiry draft");
    await page.clock.runFor(2100);
    await expect(input).toBeHidden();
    await expect(page.locator("#sr-panel input[name=username]")).toBeFocused();
    await expect(page.locator(".sr-thread")).toHaveCount(0);
    await page.unroute("**/social-reading/api/session");
    await login(page, account);
    await expect(input).toHaveValue(account === "alice" ? "Private expiry draft" : "");
  });
}

test("expiry during reauthorization cannot restore a member view", async ({ page }) => {
  await page.clock.install();
  await page.route("**/social-reading/api/session", async route => {
    const response = await route.fetch();
    if (response.status() !== 200) return route.fulfill({ response });
    const body = await response.json();
    body.timing = { serverNow: 1000, expiresAt: 3000, warningSeconds: 300, canExtend: true, extensionSeconds: 28800 };
    await route.fulfill({ response, json: body });
  });
  await page.goto(URL);
  await page.locator("#sr-entry").click();
  await login(page, "alice");
  let release, started;
  const gate = new Promise(resolve => { release = resolve; });
  const requestStarted = new Promise(resolve => { started = resolve; });
  await page.route("**/social-reading/api/threads?*", async route => {
    const response = await route.fetch();
    started();
    await gate;
    await route.fulfill({ response });
  }, { times: 1 });
  try {
    await page.getByRole("button", { name: "Close discussion", exact: true }).click();
    await page.locator("#sr-entry").click();
    await requestStarted;
    await page.clock.runFor(2100);
    release();
    await expect(page.getByRole("button", { name: "Use whole passage", exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible({ timeout: 1000 });
    await expect(page.getByRole("textbox", { name: "Your question", exact: true })).toBeHidden();
  } finally { release(); }
});

test("server validation error is associated with the question field", async ({ page }) => {
  await page.goto(URL);
  await page.locator("#sr-entry").click();
  await login(page, "alice");
  const input = page.getByRole("textbox", { name: "Your question", exact: true });
  await input.fill("   ");
  await page.getByRole("button", { name: "Post question", exact: true }).click();
  await expect(input).toHaveAttribute("aria-invalid", "true");
  const described = await input.getAttribute("aria-describedby");
  await expect(page.locator(`#${described}`)).toContainText("4000");
  await input.fill("Corrected question");
  await expect(input).not.toHaveAttribute("aria-invalid", "true");
});

test("failed sign-in retains keyboard focus on the surviving submit control", async ({ page }) => {
  await page.goto(URL);
  await page.locator("#sr-entry").click();
  await page.locator("#sr-panel input[name=username]").fill("alice");
  await page.locator("#sr-panel input[name=password]").fill("intentionally-invalid-test-password");
  const submit = page.getByRole("button", { name: "Sign in", exact: true });
  await submit.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toContainText("Sign-in failed");
  await expect(submit).toBeFocused();
});

test("expiry during an acknowledged submission does not restore the posted draft", async ({ page }) => {
  await page.clock.install();
  await page.route("**/social-reading/api/session", async route => {
    const response = await route.fetch();
    if (response.status() !== 200) return route.fulfill({ response });
    const body = await response.json();
    body.timing = { serverNow: 1000, expiresAt: 3000, warningSeconds: 300, canExtend: true, extensionSeconds: 28800 };
    await route.fulfill({ response, json: body });
  });
  await page.goto(URL);
  await page.locator("#sr-entry").click();
  await login(page, "alice");
  let release, started;
  const gate = new Promise(resolve => { release = resolve; });
  const requestStarted = new Promise(resolve => { started = resolve; });
  await page.route("**/social-reading/api/commands", async route => {
    const response = await route.fetch();
    started();
    await gate;
    await route.fulfill({ response });
  }, { times: 1 });
  try {
    const input = page.getByRole("textbox", { name: "Your question", exact: true });
    await input.fill("Expiry acknowledgment regression " + Date.now());
    await page.getByRole("button", { name: "Post question", exact: true }).click();
    await requestStarted;
    await page.clock.runFor(2100);
    await expect(input).toBeHidden();
    release();
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeEnabled();
    await page.unroute("**/social-reading/api/session");
    await login(page, "alice");
    await expect(input).toHaveValue("");
  } finally { release(); }
});

test("panel remains operable with 320px reflow, enlarged text and spacing", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(URL);
  await page.locator("#sr-entry").click();
  await login(page, "alice");
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  await page.evaluate(() => {
    for (const el of document.querySelectorAll("#sr-panel,#sr-panel *")) {
      el.style.setProperty("line-height", "1.5", "important");
      el.style.setProperty("letter-spacing", ".12em", "important");
      el.style.setProperty("word-spacing", ".16em", "important");
      if (el.tagName === "P") el.style.setProperty("margin-bottom", "2em", "important");
    }
  });
  const quote = page.getByRole("blockquote", { name: "Selected passage" });
  await quote.focus();
  await page.keyboard.press("End");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.locator("#sr-panel input[name=username]")).toBeFocused();
  const width = await page.locator("#sr-panel").evaluate(el => ({ client: el.clientWidth, scroll: el.scrollWidth }));
  expect(width.scroll).toBeLessThanOrEqual(width.client);
  await page.getByRole("button", { name: "Close discussion", exact: true }).click();
  await expect(page.locator("#sr-entry")).toBeFocused();
});

test("delayed authentication honors immediate keyboard reopen and final close", async ({ page }) => {
  await page.goto(URL);
  let release, started;
  const gate = new Promise(resolve => { release = resolve; });
  const requestStarted = new Promise(resolve => { started = resolve; });
  await page.route("**/social-reading/api/session", async route => {
    const response = await route.fetch();
    started();
    await gate;
    await route.fulfill({ response });
  }, { times: 1 });
  try {
    await page.locator("#sr-entry").focus();
    await page.keyboard.press("Enter");
    await requestStarted;
    await page.keyboard.press("Escape");
    await expect(page.locator("#sr-entry")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#sr-panel")).toBeVisible({ timeout: 1000 });
    await expect(page.getByRole("button", { name: "Close discussion", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    release();
    await expect(page.getByRole("button", { name: "Use whole passage", exact: true, includeHidden: true })).toBeEnabled();
    await expect(page.locator("#sr-panel")).toBeHidden();
    await expect(page.locator("#sr-entry")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#sr-panel")).toBeVisible();
  } finally { release(); }
});

test("stale authentication cannot reveal private content after sign-out", async ({ page }) => {
  await page.goto(URL);
  const credentials = JSON.parse(readFileSync(credentialsFile, "utf8"));
  await page.request.post("/social-reading/api/login", {
    headers: { Origin: "http://127.0.0.1:8788" },
    data: { username: "alice", password: credentials.alice },
  });
  let release, started;
  const gate = new Promise(resolve => { release = resolve; });
  const requestStarted = new Promise(resolve => { started = resolve; });
  await page.route("**/social-reading/api/session", async route => {
    const response = await route.fetch();
    started();
    await gate;
    await route.fulfill({ response });
  }, { times: 1 });
  try {
    await page.locator("#sr-entry").click();
    await requestStarted;
    await page.request.post("/social-reading/api/logout", { headers: { Origin: "http://127.0.0.1:8788" }, data: {} });
    await page.keyboard.press("Escape");
    await page.keyboard.press("Enter");
    await expect(page.locator("#sr-panel")).toBeVisible({ timeout: 1000 });
    release();
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeEnabled();
    await expect(page.locator(".sr-thread")).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "Your question", exact: true })).toBeHidden();
    await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeHidden();
  } finally { release(); }
});

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
  await expect(page.locator(".sr-thread").filter({ hasText: question }).getByRole("textbox", { name: "Your reply", exact: true })).toBeFocused();
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
  const layout = await page.evaluate(() => ({
    railRight: document.querySelector(".side-rail").getBoundingClientRect().right,
    mainLeft: document.querySelector("main").getBoundingClientRect().left,
    closeTop: document.querySelector(".sr-header button").getBoundingClientRect().top,
  }));
  expect(layout.mainLeft).toBeGreaterThanOrEqual(layout.railRight);
  expect(layout.closeTop).toBeGreaterThanOrEqual(0);
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
  await expect(page.locator("#sr-panel .sr-content > blockquote")).toContainText(
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
  await page.getByRole("button", { name: "Close discussion", exact: true }).click();
  await page.evaluate(() => {
    const ps = document.querySelectorAll("main p"), range = document.createRange();
    range.setStart(ps[0], 0);
    range.setEnd(ps[1], 1);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  });
  await page.getByRole("button", { name: "Selection unavailable", exact: true }).click();
  const credentials = JSON.parse(readFileSync(credentialsFile, "utf8"));
  await page.request.post("/social-reading/api/login", {
    headers: { Origin: "http://127.0.0.1:8788" },
    data: { username: "bob", password: credentials.bob },
  });
  await page.getByRole("button", { name: "Refresh discussion", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Account changed", { timeout: 1000 });
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

test("missing receipt is HTTP 200 null and safely retries the original command", async ({ page }) => {
  await page.goto(URL);
  await page.locator("#sr-entry").click();
  await login(page, "alice");
  await page.route("**/social-reading/api/commands", route => route.abort(), { times: 1 });
  const question = "Missing receipt regression " + Date.now();
  await page.getByRole("textbox", { name: "Your question", exact: true }).fill(question);
  await page.getByRole("button", { name: "Post question", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("outcome unknown");
  const receipt = page.waitForResponse(response => response.url().includes("/api/receipts/"));
  await page.getByRole("button", { name: "Check pending submission", exact: true }).click();
  const response = await receipt;
  expect(response.status()).toBe(200);
  expect(await response.json()).toBe(null);
  await expect(page.getByRole("status")).toContainText("Saved and acknowledged");
  await expect(page.locator(".sr-thread").filter({ hasText: question })).toHaveCount(1);
});
