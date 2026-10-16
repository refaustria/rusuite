// P8-37: the AI assistant (opt-in, the user's own key, client-side) in the web apps, against a scripted provider
// (support/aiMock.ts, Anthropic Messages API with SSE and tool use) on port 4847. The live CSP is
// `connect-src 'self'`; the action tests serve the pages with the prepared narrow policy
// (`connect-src 'self' https://api.anthropic.com https://api.openai.com` – plus this plain-http mock), the privacy
// tests keep the live one. `AI_SHOTS=<dir>` saves screenshots (P8-37-*.png).

import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { simulateDesktop, trackErrors, saveViaBackstage } from "../support/common";
import { Grid, openCalc } from "../support/calc";
import { unzip, zipText } from "../support/zip";
import { AiMockServer } from "../support/aiMock";

const AI_PORT = Number(process.env.AI_PORT ?? 4847);
const AI_ORIGIN = `http://127.0.0.1:${AI_PORT}`;
const KEY = "sk-ant-test-key";
const shots = process.env.AI_SHOTS;
const shot = async (page: Page, name: string) => {
  if (shots) await page.screenshot({ path: path.join(shots, `P8-37-${name}.png`) });
};

let mock: AiMockServer;

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ baseURL }) => {
  mock = new AiMockServer(AI_PORT, new URL(baseURL!).origin);
  await mock.start();
});
test.afterAll(async () => mock?.stop());
test.beforeEach(async ({ page }) => {
  await simulateDesktop(page);
  mock.reset();
});

/** The prepared narrow policy (provider origins), here plus the plain-http mock. */
async function preparedCsp(page: Page, baseURL: string) {
  await page.context().grantPermissions(["local-network-access"]);
  await page.route(`${new URL(baseURL).origin}/**`, async (route) => {
    const res = await route.fetch();
    const headers = { ...res.headers() };
    const csp = headers["content-security-policy"];
    if (csp) headers["content-security-policy"] = csp.replace("connect-src 'self'", `connect-src 'self' https://api.anthropic.com https://api.openai.com ${AI_ORIGIN}`);
    await route.fulfill({ response: res, headers });
  });
}

function recordRequests(page: Page) {
  const urls: string[] = [];
  page.on("request", (r) => urls.push(r.url()));
  return urls;
}

/** File › Options… › AI: enable, key, the mock as base URL, Test, Save. */
async function enableAi(page: Page, opts: { test?: boolean } = {}) {
  await page.getByRole("tab", { name: "File", exact: true }).click();
  await page.getByTestId("backstage").getByRole("button", { name: "Options…" }).click();
  const dlg = page.getByRole("dialog", { name: "Options" });
  await expect(dlg.getByTestId("ai-settings")).toBeVisible();
  await expect(dlg.getByTestId("ai-enabled")).not.toBeChecked();
  await dlg.getByTestId("ai-enabled").check();
  await dlg.getByLabel("API key").fill(KEY);
  await dlg.getByLabel("Base URL (advanced)").fill(AI_ORIGIN);
  await expect(dlg.getByTestId("ai-data-notice")).toContainText("Text you select is sent to Anthropic only when you use an AI action.");
  if (opts.test !== false) {
    await dlg.getByRole("button", { name: "Test" }).click();
    await expect(dlg.getByTestId("ai-test-result")).toHaveText("Connected. The provider lists 3 models.");
  }
  await shot(page, "settings");
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(dlg).toHaveCount(0);
  await expect(page.getByTestId("ai-status")).toHaveText("AI: Anthropic");
}

/** The last answer's turn in the panel. */
const lastTurn = (page: Page) => page.getByTestId("ai-turn").last();

const editor = (page: Page) => page.locator(".ProseMirror");

async function openWrite(page: Page) {
  await page.goto("write/");
  await editor(page).waitFor();
  await expect(page.getByTestId("status-bar")).toContainText("Saved");
}

test.describe("AI assistant", () => {
  test("enable AI and enter a key: stored on this device only; nothing is contacted before Test", async ({ page, baseURL }) => {
    await preparedCsp(page, baseURL!);
    const errors = trackErrors(page);
    await openWrite(page);
    expect(mock.calls).toHaveLength(0);
    await enableAi(page);
    // Test listed the models with the key in the header (never in the URL).
    expect(mock.calls.map((c) => `${c.method} ${c.path}`)).toEqual(["GET /v1/models"]);
    expect(mock.calls[0]!.headers["x-api-key"]).toBe(KEY);
    expect(mock.calls[0]!.headers["anthropic-dangerous-direct-browser-access"]).toBe("true");
    expect(mock.calls[0]!.origin).toBe(new URL(baseURL!).origin);
    const stored = await page.evaluate(() => ({ settings: localStorage.getItem("rusuite.ai.settings"), key: localStorage.getItem("rusuite.ai.key.anthropic") }));
    expect(stored.key).toBe(KEY);
    expect(stored.settings).toContain('"enabled":true');
    expect(stored.settings).not.toContain(KEY);
    // Forget key removes it.
    await page.getByRole("tab", { name: "File", exact: true }).click();
    await page.getByTestId("backstage").getByRole("button", { name: "Options…" }).click();
    const dlg = page.getByRole("dialog", { name: "Options" });
    await dlg.getByRole("button", { name: "Forget key" }).click();
    await expect(dlg.getByTestId("ai-test-result")).toHaveText("The key was removed from this device.");
    expect(await page.evaluate(() => localStorage.getItem("rusuite.ai.key.anthropic"))).toBeNull();
    errors.expectNone();
  });

  test("write: Fix grammar & spelling replaces the selection (one undo step)", async ({ page, baseURL }) => {
    await preparedCsp(page, baseURL!);
    const errors = trackErrors(page);
    mock.texts.push({ match: /Correct the grammar/, text: "The report is late." });
    await openWrite(page);
    await enableAi(page, { test: false });
    await editor(page).click();
    await page.keyboard.type("Teh report are late.");
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Control+Shift+a");
    const pane = page.getByTestId("ai-pane");
    await expect(pane).toBeVisible();
    await expect(pane.getByTestId("ai-context")).toHaveText("Context: selection, 20 characters");
    await pane.getByRole("button", { name: "Fix grammar & spelling" }).click();
    await expect(lastTurn(page)).toHaveAttribute("data-status", "done");
    await expect(lastTurn(page).getByTestId("ai-answer")).toHaveText("The report is late.");
    await expect(pane.getByTestId("ai-usage")).toContainText("This document: 321 input · 42 output tokens");
    await shot(page, "write-fix");
    // Only the selection and the description were sent – no full document.
    const sent = mock.calls.find((c) => c.path === "/v1/messages")!.body!;
    const user = (sent.messages as { content: string }[])[0]!.content;
    expect(user).toContain("<selection>\nTeh report are late.\n</selection>");
    expect(user).not.toContain("<full_document>");
    expect(sent.model).toBe("claude-sonnet-5-5");
    expect(sent.stream).toBe(true);
    await lastTurn(page).getByRole("button", { name: "Replace selection" }).click();
    await expect(lastTurn(page).getByTestId("ai-applied")).toHaveText("Replaced.");
    await expect(editor(page)).toHaveText("The report is late.");
    await expect(page.getByTestId("dirty")).toHaveText("Modified");
    await page.keyboard.press("Control+z");
    await expect(editor(page)).toHaveText("Teh report are late.");
    errors.expectNone();
  });

  test("write: whole-document toggle shows the size warning and sends the document; Summarize asks first", async ({ page, baseURL }) => {
    await preparedCsp(page, baseURL!);
    const errors = trackErrors(page);
    mock.texts.push({ match: /Summarize the full document/, text: "A short summary." });
    await openWrite(page);
    await enableAi(page, { test: false });
    await editor(page).click();
    await page.keyboard.type("First paragraph about the budget.");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Second paragraph about the plan.");
    await page.keyboard.press("Control+Shift+a");
    const pane = page.getByTestId("ai-pane");
    await pane.getByRole("button", { name: "Summarize document" }).click();
    await expect(pane.getByTestId("ai-needs-document")).toContainText("This action needs the whole document");
    expect(mock.calls).toHaveLength(0);
    await pane.getByTestId("ai-include-document").check();
    await expect(pane.getByTestId("ai-doc-warning")).toHaveText(/^The whole document \(about \d+ characters, ~\d+ tokens\) is sent to Anthropic with each action\.$/);
    await shot(page, "write-whole-document");
    await pane.getByTestId("ai-include-document").uncheck();
    await expect(pane.getByTestId("ai-doc-warning")).toHaveCount(0);
    await pane.getByRole("button", { name: "Summarize document" }).click();
    await pane.getByRole("button", { name: "Include the document and run" }).click();
    await expect(lastTurn(page).getByTestId("ai-answer")).toHaveText("A short summary.");
    const user = (mock.calls.at(-1)!.body!.messages as { content: string }[])[0]!.content;
    expect(user).toContain("<full_document>");
    expect(user).toContain("Second paragraph about the plan.");
    await expect(pane.getByTestId("ai-include-document")).toBeChecked();
    errors.expectNone();
  });

  test("calc: formula from description inserts a validated formula into the active cell", async ({ page, baseURL }) => {
    await preparedCsp(page, baseURL!);
    const errors = trackErrors(page);
    await openCalc(page);
    await enableAi(page, { test: false });
    const grid = new Grid(page);
    await grid.type(0, 0, "2");
    await grid.type(1, 0, "3");
    await grid.type(2, 0, "5");
    await grid.click(3, 0);
    // An invalid answer first: shown, but not insertable.
    mock.tools.set("insert_formula", { formula: "=SUM(A1:A3", explanation: "Adds A1 to A3." });
    await page.getByRole("tab", { name: "Home" }).click();
    await page.getByRole("button", { name: "Assistant" }).click();
    const pane = page.getByTestId("ai-pane");
    await pane.getByRole("button", { name: "Formula from description" }).click();
    await pane.getByLabel("Ask the assistant").fill("the total of A1 to A3");
    await pane.getByLabel("Ask the assistant").press("Enter");
    await expect(lastTurn(page).getByTestId("ai-formula")).toHaveText("=SUM(A1:A3");
    await expect(lastTurn(page).getByRole("button", { name: "Insert formula" })).toBeDisabled();
    // A valid one.
    mock.tools.set("insert_formula", { formula: "=SUM(A1:A3)", explanation: "Adds the values in A1 to A3." });
    await pane.getByRole("button", { name: "Formula from description" }).click();
    await pane.getByLabel("Ask the assistant").fill("the total of A1 to A3");
    await pane.getByRole("button", { name: "Send" }).click();
    await expect(lastTurn(page).getByTestId("ai-explanation")).toHaveText("Adds the values in A1 to A3.");
    await shot(page, "calc-formula");
    const body = mock.calls.at(-1)!.body!;
    expect((body.tools as { name: string; strict: boolean }[])[0]).toMatchObject({ name: "insert_formula", strict: true });
    expect((body.messages as { content: string }[])[0]!.content).toContain("Active cell: Sheet1!A4");
    await lastTurn(page).getByRole("button", { name: "Insert formula" }).click();
    await expect(lastTurn(page).getByTestId("ai-applied")).toHaveText("Inserted into A4.");
    await page.getByTestId("ai-pane").getByRole("button", { name: "Close" }).click();
    await expect(page.getByTestId("ai-pane")).toHaveCount(0);
    expect(await grid.input(3, 0)).toBe("=SUM(A1:A3)");
    expect(await grid.display(3, 0)).toBe("10");
    errors.expectNone();
  });

  test("show: outline to slides adds 3 slides with titles, bullets and notes", async ({ page, baseURL }) => {
    await preparedCsp(page, baseURL!);
    const errors = trackErrors(page);
    mock.tools.set("create_slides", {
      slides: [
        { title: "Why Rust", bullets: ["Memory safety", "Speed"], notes: "Open with the why." },
        { title: "How we use it", bullets: ["Core in Rust", "UI in React", "WASM on the web"], notes: "" },
        { title: "Next steps", bullets: ["Hire", "Ship"], notes: "Close." },
      ],
    });
    await page.goto("show/");
    await page.getByTestId("editor-stage").waitFor();
    await expect(page.getByTestId("slide-count")).toHaveText("Slide 1 of 1");
    await enableAi(page, { test: false });
    await page.keyboard.press("Control+Shift+a");
    const pane = page.getByTestId("ai-pane");
    await pane.getByRole("button", { name: "Outline to slides" }).click();
    await pane.getByLabel("Ask the assistant").fill("Rust at our company, 3 slides");
    await pane.getByLabel("Ask the assistant").press("Enter");
    await expect(lastTurn(page).getByTestId("ai-slides").locator("li")).toHaveCount(3);
    await shot(page, "show-outline");
    await lastTurn(page).getByRole("button", { name: "Insert slides" }).click();
    await expect(lastTurn(page).getByTestId("ai-applied")).toHaveText("Inserted 3 slides.");
    await expect(page.getByTestId("slide-count")).toHaveText("Slide 2 of 4");
    // One undo step removes all three.
    await page.getByTestId("editor-stage").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Control+z");
    await expect(page.getByTestId("slide-count")).toHaveText(/of 1$/);
    await page.keyboard.press("Control+y");
    await expect(page.getByTestId("slide-count")).toHaveText(/of 4$/);
    const pptx = await saveViaBackstage(page);
    const s2 = zipText(pptx, "ppt/slides/slide2.xml");
    expect(s2).toContain("Why Rust");
    expect(s2).toContain("Memory safety");
    expect(zipText(pptx, "ppt/slides/slide4.xml")).toContain("Next steps");
    const notes = [...unzip(pptx)].filter(([n]) => /notesSlide\d+\.xml$/.test(n)).map(([, b]) => b.toString("utf8"));
    expect(notes.join("\n")).toContain("Open with the why.");
    errors.expectNone();
  });
});

test.describe("AI privacy (ADR 0009)", () => {
  /** Requests outside this page's origin. */
  const foreign = (urls: string[], baseURL: string) => urls.filter((u) => !u.startsWith("data:") && !u.startsWith("blob:") && new URL(u).origin !== new URL(baseURL).origin);

  for (const app of ["write", "calc", "show"] as const) {
    test(`${app}: with AI disabled no request leaves; enabled but no action used, still none`, async ({ page, baseURL }) => {
      const urls = recordRequests(page);
      const errors = trackErrors(page);
      await page.goto(`${app}/`);
      await page.getByTestId("status-bar").waitFor();
      // Disabled: the panel opens and only says so.
      await page.keyboard.press("Control+Shift+a");
      await expect(page.getByTestId("ai-off")).toBeVisible();
      if (app === "write") await shot(page, "pane-off");
      await page.keyboard.press("Control+Shift+a");
      expect(foreign(urls, baseURL!)).toEqual([]);
      // Enabled with a key (live CSP), the panel open, typing – but no action: nothing is contacted.
      await page.evaluate((key) => {
        localStorage.setItem("rusuite.ai.settings", JSON.stringify({ enabled: true, baseUrls: { anthropic: "https://api.anthropic.com" } }));
        localStorage.setItem("rusuite.ai.key.anthropic", key);
      }, KEY);
      await page.reload();
      await page.getByTestId("status-bar").waitFor();
      await expect(page.getByTestId("ai-status")).toHaveText("AI: Anthropic");
      await page.getByTestId("ai-status").click();
      const pane = page.getByTestId("ai-pane");
      await expect(pane.getByTestId("ai-actions")).toBeVisible();
      await pane.getByLabel("Ask the assistant").fill("draft something");
      await page.waitForTimeout(500);
      expect(foreign(urls, baseURL!)).toEqual([]);
      expect(mock.calls).toHaveLength(0);
      errors.expectNone();
    });
  }

  test("live CSP: an action is blocked before any traffic and the panel explains it", async ({ page, baseURL }) => {
    const urls = recordRequests(page);
    await page.goto("write/");
    await editor(page).waitFor();
    await page.evaluate(
      ([key, origin]) => {
        localStorage.setItem("rusuite.ai.settings", JSON.stringify({ enabled: true, baseUrls: { anthropic: origin } }));
        localStorage.setItem("rusuite.ai.key.anthropic", key!);
      },
      [KEY, AI_ORIGIN],
    );
    await page.reload();
    await editor(page).click();
    await page.keyboard.type("Some text.");
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Control+Shift+a");
    await page.getByTestId("ai-pane").getByRole("button", { name: "Shorten" }).click();
    await expect(lastTurn(page).getByTestId("ai-error")).toContainText("This site's security policy does not allow connections to the AI provider");
    await shot(page, "csp-blocked");
    expect(mock.log).toHaveLength(0);
    expect(urls.filter((u) => u.startsWith(AI_ORIGIN) && !u.endsWith("/v1/messages"))).toEqual([]);
  });
});
