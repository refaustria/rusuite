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

/** File › Options… › AI: enable, key, the mock as base URL, Test, Save (`effort`: Reasoning, P9-A1). */
async function enableAi(page: Page, opts: { test?: boolean; effort?: string } = {}) {
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
    await expect(dlg.getByTestId("ai-test-result")).toHaveText("Connected. The provider lists 3 models. claude-sonnet-5-5 answered.");
  }
  if (opts.effort) await dlg.getByTestId("ai-effort").selectOption({ label: opts.effort });
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
    // Test listed the models with the key in the header (never in the URL), then made a 1-token request to the
    // chosen model (P9-A1).
    expect(mock.calls.map((c) => `${c.method} ${c.path}`)).toEqual(["GET /v1/models", "POST /v1/messages"]);
    expect(mock.calls[1]!.body).toMatchObject({ model: "claude-sonnet-5-5", max_tokens: 1 });
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
    // The whole document is its own system block, marked for the prompt cache (P9-A1), not part of the message.
    const sent = mock.calls.at(-1)!.body!;
    const user = (sent.messages as { content: string }[])[0]!.content;
    expect(user).not.toContain("<full_document>");
    const system = sent.system as { type: string; text: string; cache_control?: unknown }[];
    expect(system[0]!.text).toContain("<full_document>");
    expect(system[0]!.text).toContain("Second paragraph about the plan.");
    expect(system[0]!.cache_control).toEqual({ type: "ephemeral" });
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

// P9-A1: AI round 2 – prompt caching, reasoning effort, pictures, reply language.
const shot2 = async (page: Page, name: string) => {
  if (shots) await page.screenshot({ path: path.join(shots, `P9-A1-${name}.png`) });
};
const LOGO = new URL("../../../apps/write/src-tauri/icons/Square310x310Logo.png", import.meta.url).pathname;

type Block = { type: string; text?: string; source?: { type: string; media_type: string; data: string } };
/** The content blocks of the last user message of a request. */
const lastUser = (body: Record<string, unknown>): Block[] => {
  const content = (body.messages as { content: unknown }[]).at(-1)!.content;
  return typeof content === "string" ? [{ type: "text", text: content }] : (content as Block[]);
};
/** Width × height of a base64 PNG (IHDR). */
const pngSize = (b64: string) => {
  const b = Buffer.from(b64, "base64");
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
};
interface ChartHook { scene: { items: { el?: { type: string } }[] } | null }
const chartItems = async (page: Page) => (await page.evaluate(() => (window as unknown as { __calcCharts?: ChartHook[] }).__calcCharts ?? []))[0]?.scene?.items ?? [];

test.describe("AI assistant round 2 (P9-A1)", () => {
  test("write: the whole document is cached – the second question reads it from the cache", async ({ page, baseURL }) => {
    await preparedCsp(page, baseURL!);
    const errors = trackErrors(page);
    mock.texts.push({ match: /budget/, text: "It is about the budget." }, { match: /risks/, text: "No risks are named." });
    await openWrite(page);
    await enableAi(page, { test: false });
    await editor(page).click();
    for (let i = 1; i <= 12; i++) {
      await page.keyboard.type(`Paragraph ${i} of the annual report: the budget grows by ${i} percent and the plan stays the same.`);
      await page.keyboard.press("Enter");
    }
    await page.keyboard.press("Control+Shift+a");
    const pane = page.getByTestId("ai-pane");
    await pane.getByTestId("ai-include-document").check();
    await pane.getByLabel("Ask the assistant").fill("What is the budget?");
    await pane.getByLabel("Ask the assistant").press("Enter");
    await expect(lastTurn(page)).toHaveAttribute("data-status", "done");
    await expect(lastTurn(page).getByTestId("ai-turn-document")).toHaveAttribute("data-document", "sent");
    await expect(lastTurn(page).getByTestId("ai-turn-cache")).toHaveText(/^ · 0 from cache · [1-9][\d,]* written to cache$/);
    await pane.getByLabel("Ask the assistant").fill("Which risks are named?");
    await pane.getByLabel("Ask the assistant").press("Enter");
    await expect(page.getByTestId("ai-turn")).toHaveCount(2);
    await expect(lastTurn(page)).toHaveAttribute("data-status", "done");
    await expect(lastTurn(page).getByTestId("ai-turn-document")).toHaveAttribute("data-document", "same");
    await expect(lastTurn(page).getByTestId("ai-turn-cache")).toHaveText(/^ · [1-9][\d,]* from cache · 0 written to cache$/);
    await expect(pane.getByTestId("ai-usage")).toContainText("from cache");
    await shot2(page, "cache");
    const [first, second] = mock.calls.filter((c) => c.path === "/v1/messages").map((c) => c.body!);
    const sys = (b: Record<string, unknown>) => b.system as { text: string; cache_control?: unknown }[];
    expect(sys(first!)[0]!.cache_control).toEqual({ type: "ephemeral" });
    expect(sys(second!)[0]).toEqual(sys(first!)[0]);
    // The follow-up carries the conversation, the document only in the cached block.
    expect((second!.messages as unknown[]).length).toBe(3);
    expect(JSON.stringify(second!.messages)).not.toContain("<full_document>");
    errors.expectNone();
  });

  test("reasoning: the effort setting is in the request; the thinking summary is collapsed and never inserted", async ({ page, baseURL }) => {
    await preparedCsp(page, baseURL!);
    const errors = trackErrors(page);
    mock.texts.push({ match: /Correct the grammar/, text: "The report is late." });
    await openWrite(page);
    await enableAi(page, { test: false, effort: "High" });
    await editor(page).click();
    await page.keyboard.type("Teh report are late.");
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Control+Shift+a");
    const pane = page.getByTestId("ai-pane");
    await pane.getByRole("button", { name: "Fix grammar & spelling" }).click();
    await expect(lastTurn(page)).toHaveAttribute("data-status", "done");
    const body = mock.calls.find((c) => c.path === "/v1/messages")!.body!;
    expect(body.thinking).toEqual({ type: "adaptive", display: "summarized" });
    expect(body.output_config).toEqual({ effort: "high" });
    expect(body.temperature).toBeUndefined();
    const thinking = lastTurn(page).getByTestId("ai-thinking");
    await expect(thinking).toBeVisible();
    await expect(thinking).not.toHaveAttribute("open", /.*/);
    await expect(thinking.locator("summary")).toHaveText("Thinking…");
    await expect(lastTurn(page).getByTestId("ai-thinking-text")).toBeHidden();
    await expect(lastTurn(page).getByTestId("ai-turn-effort")).toHaveText(" · reasoning: High");
    await thinking.locator("summary").click();
    await expect(lastTurn(page).getByTestId("ai-thinking-text")).toHaveText(mock.thinkingText);
    await shot2(page, "thinking");
    await expect(lastTurn(page).getByTestId("ai-answer")).toHaveText("The report is late.");
    await lastTurn(page).getByRole("button", { name: "Replace selection" }).click();
    await expect(editor(page)).toHaveText("The report is late.");
    errors.expectNone();
  });

  test("write: a selected picture is sent as an image block; Describe picture writes the alt text", async ({ page, baseURL }) => {
    await preparedCsp(page, baseURL!);
    const errors = trackErrors(page);
    mock.texts.push({ match: /alternative text/, text: "Alt text: A blue square app logo." }, { match: /colour/, text: "Blue." });
    await openWrite(page);
    await enableAi(page, { test: false });
    await editor(page).click();
    await page.getByRole("tab", { name: "Insert" }).click();
    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "Picture" }).click()]);
    await chooser.setFiles(LOGO);
    const img = editor(page).locator(".inline-image-wrap img").first();
    await img.click();
    await page.keyboard.press("Control+Shift+a");
    const pane = page.getByTestId("ai-pane");
    await expect(pane.getByTestId("ai-context")).toHaveText("Context: selected picture");
    // Attach selected picture → the next question carries it.
    await pane.getByRole("button", { name: "Attach selected picture" }).click();
    await expect(pane.getByTestId("ai-pending-pictures").locator("li")).toHaveCount(1);
    await expect(pane.getByTestId("ai-pending-pictures")).toContainText("310×310");
    await pane.getByLabel("Ask the assistant").fill("Which colour is it?");
    await pane.getByLabel("Ask the assistant").press("Enter");
    await expect(lastTurn(page).getByTestId("ai-answer")).toHaveText("Blue.");
    await expect(lastTurn(page).getByTestId("ai-turn-images")).toHaveText("Pictures sent: Picture");
    await expect(pane.getByTestId("ai-pending-pictures")).toHaveCount(0);
    let blocks = lastUser(mock.calls.at(-1)!.body!);
    expect(blocks.map((b) => b.type)).toEqual(["image", "text"]);
    expect(blocks[0]!.source).toMatchObject({ type: "base64", media_type: "image/png" });
    expect(pngSize(blocks[0]!.source!.data)).toEqual({ width: 310, height: 310 });
    // Describe picture → alt text.
    await img.click();
    await pane.getByRole("button", { name: "Describe picture → alt text" }).click();
    await expect(lastTurn(page)).toHaveAttribute("data-status", "done");
    blocks = lastUser(mock.calls.at(-1)!.body!);
    expect(blocks.map((b) => b.type)).toEqual(["image", "text"]);
    expect(blocks[1]!.text).toContain("Write alternative text for the attached picture");
    await shot2(page, "write-alt");
    await lastTurn(page).getByRole("button", { name: "Set as alt text" }).click();
    await expect(lastTurn(page).getByTestId("ai-applied")).toHaveText("Alt text set.");
    await expect(img).toHaveAttribute("alt", "A blue square app logo.");
    errors.expectNone();
  });

  test("calc: Explain this chart sends the chart as a picture plus its data table; Insert as note", async ({ page, baseURL }) => {
    await preparedCsp(page, baseURL!);
    const errors = trackErrors(page);
    mock.texts.push({ match: /Explain the attached chart/, text: "North peaks in Q4 with 30." });
    await openCalc(page);
    await enableAi(page, { test: false });
    const grid = new Grid(page);
    const rows = [["", "North", "South"], ["Q1", "10", "20"], ["Q2", "25", "5"], ["Q3", "15", "8"], ["Q4", "30", "12"]];
    for (const [r, row] of rows.entries()) for (const [c, v] of row.entries()) if (v) await grid.type(r, c, v);
    await grid.click(0, 0);
    await grid.click(4, 2, { shift: true });
    await page.getByRole("tab", { name: "Insert", exact: true }).click();
    await page.getByRole("button", { name: "Column or Bar Chart" }).click();
    await page.getByTestId("chart-gallery-columnBar").getByRole("button", { name: "Clustered Column", exact: true }).click();
    await expect.poll(async () => (await chartItems(page)).filter((i) => i.el?.type === "series").length).toBeGreaterThan(3);
    await page.keyboard.press("Control+Shift+a");
    const pane = page.getByTestId("ai-pane");
    await pane.getByRole("button", { name: "Explain this chart" }).click();
    await expect(lastTurn(page).getByTestId("ai-answer")).toHaveText("North peaks in Q4 with 30.");
    const blocks = lastUser(mock.calls.at(-1)!.body!);
    expect(blocks.map((b) => b.type)).toEqual(["image", "text"]);
    const size = pngSize(blocks[0]!.source!.data);
    expect(size.width).toBeGreaterThan(200);
    expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(1568);
    expect(blocks[1]!.text).toMatch(/^<chart_data>\n/);
    expect(blocks[1]!.text).toContain("Category\tNorth\tSouth\nQ1\t10\t20\nQ2\t25\t5\nQ3\t15\t8\nQ4\t30\t12\n</chart_data>");
    await shot2(page, "calc-chart");
    await lastTurn(page).getByRole("button", { name: "Insert as note" }).click();
    await expect(lastTurn(page).getByTestId("ai-applied")).toHaveText(/^Note added to [A-Z]+\d+\.$/);
    const xlsx = await saveViaBackstage(page);
    const comments = [...unzip(xlsx)].filter(([n]) => /comments\d*\.xml$/.test(n)).map(([, b]) => b.toString("utf8")).join("\n");
    expect(comments).toContain("North peaks in Q4 with 30.");
    errors.expectNone();
  });

  test("show: Attach current slide as image – a PNG at most 1568 px wide goes with the question", async ({ page, baseURL }) => {
    await preparedCsp(page, baseURL!);
    const errors = trackErrors(page);
    mock.texts.push({ match: /slide/, text: "An empty title slide." });
    await page.goto("show/");
    await page.getByTestId("editor-stage").waitFor();
    await enableAi(page, { test: false });
    await page.keyboard.press("Control+Shift+a");
    const pane = page.getByTestId("ai-pane");
    await pane.getByRole("button", { name: "Attach current slide as image" }).click();
    await expect(pane.getByTestId("ai-pending-pictures")).toContainText("Slide 1");
    await pane.getByLabel("Ask the assistant").fill("What is on this slide?");
    await pane.getByLabel("Ask the assistant").press("Enter");
    await expect(lastTurn(page).getByTestId("ai-answer")).toHaveText("An empty title slide.");
    const blocks = lastUser(mock.calls.at(-1)!.body!);
    expect(blocks[0]!.type).toBe("image");
    const size = pngSize(blocks[0]!.source!.data);
    expect(size.width).toBe(1568);
    expect(size.height).toBeLessThan(1568);
    errors.expectNone();
  });

  test("the reply language follows a UI language switch", async ({ page, baseURL }) => {
    await preparedCsp(page, baseURL!);
    const errors = trackErrors(page);
    await openWrite(page);
    await enableAi(page, { test: false });
    await editor(page).click();
    await page.keyboard.type("Teh report are late.");
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Control+Shift+a");
    const pane = page.getByTestId("ai-pane");
    await pane.getByRole("button", { name: "Fix grammar & spelling" }).click();
    await expect(lastTurn(page)).toHaveAttribute("data-status", "done");
    expect(JSON.stringify(mock.calls.at(-1)!.body!.system)).toContain("The user's interface language is English");
    await page.getByRole("tab", { name: "View", exact: true }).click();
    await page.getByRole("combobox", { name: "Language / Sprache" }).selectOption("de");
    await expect(page.getByRole("tab", { name: "Start", exact: true })).toBeVisible();
    // The panel is in German (chips, prompt, usage), and so is the instruction to the model.
    await expect(pane.getByRole("button", { name: "Grammatik & Rechtschreibung" })).toBeVisible();
    await editor(page).click();
    await page.keyboard.press("Control+a");
    await pane.getByRole("button", { name: "Grammatik & Rechtschreibung" }).click();
    await expect(page.getByTestId("ai-turn")).toHaveCount(2);
    await expect(lastTurn(page)).toHaveAttribute("data-status", "done");
    const system = JSON.stringify(mock.calls.at(-1)!.body!.system);
    expect(system).toContain("The user's interface language is German");
    expect(system).toContain("stays in the language of the document");
    await expect(pane.getByLabel("Den Assistenten fragen")).toBeVisible();
    await shot2(page, "german");
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
