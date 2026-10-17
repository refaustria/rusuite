// P9-W1: Write lists like Word (Backspace in two steps, level indents, galleries, heading numbering in the TOC,
// Restart / Set Numbering Value with w:startOverride, outline levels) and the Word shortcuts (Ctrl+Shift+K survives
// save → reopen).
import fs from "node:fs";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { openViaBackstage, saveViaBackstage, trackErrors } from "../support/common";
import { zipText } from "../support/zip";

const editor = (page: Page) => page.locator(".ProseMirror").first();

async function openWrite(page: Page) {
  await page.goto("write/");
  await editor(page).waitFor();
  await expect(page.getByTestId("status-bar")).toContainText("Saved");
  await editor(page).click();
}

/** A numbered list with `items` (Home › Numbered list). */
async function numberedList(page: Page, items: string[]) {
  const k = page.keyboard;
  await page.getByRole("button", { name: "Numbered list" }).click();
  for (const [i, t] of items.entries()) {
    if (i) await k.press("Enter");
    await k.type(t);
  }
  await expect(editor(page).locator("li")).toHaveCount(items.length);
}

const labels = (page: Page) => editor(page).locator("[data-label]").evaluateAll((els) => els.map((e) => e.getAttribute("data-label")));

/** Saves, then opens the saved file again; returns the saved bytes. */
async function saveAndReopen(page: Page, info: TestInfo, name: string): Promise<Buffer> {
  const docx = await saveViaBackstage(page);
  const file = info.outputPath(name);
  fs.writeFileSync(file, docx);
  await openViaBackstage(page, file);
  await expect(page.getByTestId("status-bar")).toContainText("Saved");
  return docx;
}

test.describe("Write lists and Word shortcuts (P9-W1)", () => {
  test("Backspace at item 2's start: the number goes (indent kept), then the indent, then it joins", async ({ page }) => {
    const errors = trackErrors(page);
    await openWrite(page);
    await numberedList(page, ["one", "two"]);
    const two = editor(page).locator("p", { hasText: "two" });
    const left = async () => (await two.boundingBox())!.x - (await editor(page).boundingBox())!.x;
    // The item sits at its level's indent (w:ind left 720 = 48 px).
    await expect.poll(left).toBeGreaterThan(46);
    await page.keyboard.press("Home");
    await page.keyboard.press("Backspace");
    await expect(editor(page).locator("li")).toHaveCount(1);
    await expect.poll(left).toBeGreaterThan(46);
    expect(await left()).toBeLessThan(50);
    await page.screenshot({ path: "../../shots/P9-W1-backspace-1.png" });
    // Second press (Word): back to the margin.
    await page.keyboard.press("Backspace");
    await expect.poll(left).toBeLessThan(2);
    await expect(editor(page).locator("p", { hasText: /^two$/ })).toHaveCount(1);
    // Third press joins.
    await page.keyboard.press("Backspace");
    await expect(editor(page).locator("li")).toHaveText(["onetwo"]);
    errors.expectNone();
  });

  test("levels use the numbering's real indents; the label hangs in front of the text", async ({ page }) => {
    await openWrite(page);
    await numberedList(page, ["one", "sub"]);
    await page.keyboard.press("Home");
    await page.keyboard.press("Tab");
    await expect.poll(() => labels(page)).toEqual(["1.", "a."]);
    const x0 = (await editor(page).boundingBox())!.x;
    const sub = editor(page).locator("p", { hasText: "sub" });
    // Level 2: w:ind left 1440 (96 px), hanging 360 (24 px): the label starts at 72 px, the text at 96 px.
    await expect.poll(async () => Math.round((await sub.boundingBox())!.x - x0)).toBe(96);
    const textX = await sub.evaluate((p) => {
      const r = document.createRange();
      r.setStart(p.firstChild!, 0);
      r.setEnd(p.firstChild!, 1);
      return r.getBoundingClientRect().x;
    });
    expect(Math.round(textX - x0)).toBe(96);
    await page.screenshot({ path: "../../shots/P9-W1-levels.png" });
  });

  test("galleries: Numbering ▾ I. II. III., Bullets ▾ ➢", async ({ page }) => {
    await openWrite(page);
    await numberedList(page, ["alpha", "beta"]);
    await page.getByRole("button", { name: "Numbering library" }).click();
    await page.getByTestId("numbering-gallery").getByRole("button", { name: "Numbering I. II. III.", exact: true }).click();
    await expect.poll(() => labels(page)).toEqual(["I.", "II."]);
    await page.getByRole("button", { name: "Bullet library" }).click();
    await page.getByTestId("bullet-gallery").getByRole("button", { name: "Bullet ➢", exact: true }).click();
    await expect.poll(() => labels(page)).toEqual(["➢", "➢"]);
    await page.screenshot({ path: "../../shots/P9-W1-galleries.png" });
  });

  test("multilevel heading numbering: the headings and the TOC show 1 / 1.1; saved with the style links", async ({ page }) => {
    const errors = trackErrors(page);
    await openWrite(page);
    const k = page.keyboard;
    await k.press("Control+Alt+1");
    await k.type("Intro");
    await k.press("Enter");
    await k.press("Control+Alt+2");
    await k.type("Scope");
    await k.press("Enter");
    await k.press("Control+Alt+2");
    await k.type("Terms");
    await expect(editor(page).locator("h2")).toHaveCount(2);
    await page.getByRole("button", { name: "Multilevel list" }).click();
    await page.getByTestId("multilevel-gallery").getByRole("button", { name: "1 / 1.1 / 1.1.1 (headings)" }).click();
    await expect.poll(() => labels(page)).toEqual(["1", "1.1", "1.2"]);
    await expect(editor(page).locator("li")).toHaveCount(0);
    await k.press("Control+Home");
    await page.getByRole("tab", { name: "References" }).click();
    await page.getByRole("button", { name: "Table of contents" }).click();
    await page.getByRole("menuitem", { name: "Automatic table (3 levels)" }).click();
    await expect(editor(page).locator(".toc-entry .toc-text")).toHaveText(["1 Intro", "1.1 Scope", "1.2 Terms"]);
    await page.screenshot({ path: "../../shots/P9-W1-heading-numbers.png" });
    const docx = await saveViaBackstage(page);
    const numbering = zipText(docx, "word/numbering.xml");
    expect(numbering).toContain('<w:pStyle w:val="Heading1"/>');
    expect(numbering).toContain('<w:pStyle w:val="Heading2"/>');
    const styles = zipText(docx, "word/styles.xml");
    const h2 = /<w:style [^>]*w:styleId="Heading2"[^>]*>(?:(?!<\/w:style>)[^])*<\/w:style>/.exec(styles)?.[0] ?? "";
    expect(h2).toMatch(/<w:numPr><w:ilvl w:val="1"\/><w:numId w:val="\d+"\/><\/w:numPr>/);
    expect(h2).toContain('<w:outlineLvl w:val="1"/>');
    errors.expectNone();
  });

  test("Restart at 1 restarts the list; Set Numbering Value 5 is kept as w:startOverride after reopening", async ({ page }, info) => {
    const errors = trackErrors(page);
    await openWrite(page);
    await numberedList(page, ["a", "b", "c", "d"]);
    await editor(page).locator("li p", { hasText: /^c$/ }).click({ button: "right" });
    await page.getByRole("menu", { name: "Editor" }).getByRole("menuitem", { name: "Restart at 1" }).click();
    await expect.poll(() => labels(page)).toEqual(["1.", "2.", "1.", "2."]);
    await editor(page).locator("li p", { hasText: /^c$/ }).click();
    await editor(page).locator("li p", { hasText: /^c$/ }).click({ button: "right" });
    await page.getByRole("menu", { name: "Editor" }).getByRole("menuitem", { name: "Set Numbering Value…" }).click();
    const dialog = page.getByRole("dialog", { name: "Set Numbering Value…" });
    await dialog.getByLabel("Set value to").fill("5");
    await dialog.getByRole("button", { name: "OK" }).click();
    await expect.poll(() => labels(page)).toEqual(["1.", "2.", "5.", "6."]);
    const docx = await saveAndReopen(page, info, "restart.docx");
    expect(zipText(docx, "word/numbering.xml")).toMatch(/<w:lvlOverride w:ilvl="0"><w:startOverride w:val="5"\/><\/w:lvlOverride>/);
    await expect(editor(page).locator("li p", { hasText: /^d$/ })).toBeVisible();
    await expect.poll(() => labels(page)).toEqual(["1.", "2.", "5.", "6."]);
    errors.expectNone();
  });

  test("Paragraph › Outline level is saved as w:outlineLvl and puts the paragraph into the Navigation pane", async ({ page }, info) => {
    await openWrite(page);
    await page.keyboard.type("Summary paragraph");
    await page.getByRole("button", { name: "Paragraph settings" }).click();
    const dialog = page.getByRole("dialog", { name: "Paragraph" });
    await dialog.getByLabel("Outline level").selectOption({ label: "Level 2" });
    await dialog.getByRole("button", { name: "OK" }).click();
    const docx = await saveAndReopen(page, info, "outline.docx");
    expect(zipText(docx, "word/document.xml")).toContain('<w:outlineLvl w:val="1"/>');
    await page.getByRole("tab", { name: "View", exact: true }).click();
    await page.getByLabel("Navigation Pane").check();
    await expect(page.getByTestId("navigation-pane").getByText("Summary paragraph")).toBeVisible();
  });

  test("Ctrl+Shift+K small caps survives save → reopen", async ({ page }, info) => {
    await openWrite(page);
    await page.keyboard.type("Hello");
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Control+Shift+k");
    await expect(editor(page).locator("[style*='small-caps']")).toHaveCount(1);
    const docx = await saveAndReopen(page, info, "caps.docx");
    expect(zipText(docx, "word/document.xml")).toContain("<w:smallCaps/>");
    await expect(editor(page).locator("[style*='small-caps']")).toHaveText("Hello");
    const again = await saveViaBackstage(page);
    expect(zipText(again, "word/document.xml")).toContain("<w:smallCaps/>");
  });
});
