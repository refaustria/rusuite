import { expect, test, type Page } from "@playwright/test";
import { interceptPrint, openPrint, previewPdf, openViaBackstage, printCount, saveViaBackstage, testdata, trackErrors, fileCommand } from "../support/common";
import { zipText, unzip } from "../support/zip";

const REPORT = testdata("docx/provisional-47-report.docx");
const editor = (page: Page) => page.locator(".ProseMirror");

async function openWrite(page: Page) {
  await page.goto("write/");
  await editor(page).waitFor();
  await expect(page.getByTestId("status-bar")).toContainText("Saved");
}

async function openReport(page: Page) {
  await openWrite(page);
  await openViaBackstage(page, REPORT);
  await expect(page.getByTestId("doc-name")).toHaveText("provisional-47-report.docx");
  await expect(editor(page).getByRole("heading", { name: "Summary" })).toBeVisible();
}

test.describe("Write", () => {
  test("opening a docx shows headings, table and image", async ({ page }) => {
    const errors = trackErrors(page);
    await openReport(page);
    await expect(editor(page).locator("h1")).not.toHaveCount(0);
    await expect(editor(page).locator("table")).toHaveCount(1);
    await expect(editor(page).locator("table tr")).toHaveCount(4);
    await expect(editor(page).locator("table td").first()).toContainText("Quarter");
    await expect(editor(page).locator("img")).not.toHaveCount(0);
    await expect(page.getByTestId("words")).not.toHaveText("0 words");
    errors.expectNone();
  });

  test("type, bold from the ribbon, undo, save: the download has the text", async ({ page }) => {
    await openReport(page);
    const para = editor(page).locator("p", { hasText: "The quick brown fox" });
    await para.click();
    await page.keyboard.press("End");
    await page.keyboard.type(" Edited in e2e.");
    await expect(para).toContainText("Edited in e2e.");
    // Bold: select the typed text and use the ribbon button.
    for (let i = 0; i < "Edited in e2e.".length; i++) await page.keyboard.press("Shift+ArrowLeft");
    await page.getByRole("button", { name: "Bold" }).click();
    await expect(para.locator("strong")).toContainText("Edited in e2e.");
    // Undo reverts the bold only.
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(para.locator("strong")).toHaveCount(0);
    await expect(para).toContainText("Edited in e2e.");
    await page.getByRole("button", { name: "Bold" }).click();
    const docx = await saveViaBackstage(page);
    const xml = zipText(docx, "word/document.xml");
    expect(xml).toContain("Edited in e2e.");
    // The bold property sits in the same run as the text.
    expect(xml).toMatch(/<w:r>(?:(?!<\/w:r>)[^])*<w:b\/>(?:(?!<\/w:r>)[^])*Edited in e2e\./);
    await expect(page.getByTestId("dirty")).toHaveText("Saved");
  });

  test("table context menu inserts a row", async ({ page }) => {
    await openReport(page);
    const rows = editor(page).locator("table tr");
    await expect(rows).toHaveCount(4);
    await editor(page).locator("table td", { hasText: "Q2" }).first().click({ button: "right" });
    const menu = page.getByRole("menu", { name: "Editor" });
    await expect(menu).toBeVisible();
    await menu.getByRole("menuitem", { name: /Insert row below|Insert below/ }).click();
    await expect(rows).toHaveCount(5);
    const docx = await saveViaBackstage(page);
    expect(zipText(docx, "word/document.xml").match(/<w:tr[ >]/g)).toHaveLength(5);
  });

  test("find bar highlights matches and closes cleanly", async ({ page }) => {
    await openReport(page);
    await editor(page).click();
    await page.keyboard.press("Control+f");
    const bar = page.getByTestId("find-bar");
    await expect(bar).toBeVisible();
    await bar.getByLabel("Find", { exact: true }).fill("the");
    await expect(page.locator(".find-match").first()).toBeVisible();
    const n = await page.locator(".find-match").count();
    expect(n).toBeGreaterThan(1);
    await expect(page.getByTestId("match-count")).toContainText(String(n));
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    await expect(page.locator(".find-match")).toHaveCount(0);
  });

  test("print layout shows page gaps for a long document", async ({ page }) => {
    await openWrite(page);
    await editor(page).click();
    await editor(page).evaluate((el) => el.focus());
    for (let i = 0; i < 60; i++) {
      await page.keyboard.insertText(`Paragraph ${i + 1}: the quick brown fox jumps over the lazy dog, again and again.`);
      await page.keyboard.press("Enter");
    }
    await expect(page.locator(".page-gap").first()).toBeVisible();
    expect(await page.locator(".page-gap").count()).toBeGreaterThanOrEqual(1);
    await expect(page.getByTestId("write-page")).toBeVisible();
  });

  test("header dialog sets the header text, shown in the page and saved", async ({ page }) => {
    await openWrite(page);
    await editor(page).click();
    await page.keyboard.type("Body text");
    await page.getByRole("tab", { name: "Insert" }).click();
    await page.getByRole("button", { name: "Header", exact: true }).click();
    await page.getByRole("textbox", { name: "Header" }).fill("Rusuite e2e header");
    await page.getByRole("button", { name: "OK" }).click();
    await expect(page.getByTestId("page-header")).toContainText("Rusuite e2e header");
    const docx = await saveViaBackstage(page);
    const files = unzip(docx);
    const header = [...files].find(([n]) => /^word\/header\d*\.xml$/.test(n));
    expect(header?.[1].toString()).toContain("Rusuite e2e header");
  });

  test("a new document: type, heading shortcut, word count", async ({ page }) => {
    await openWrite(page);
    await editor(page).click();
    await page.keyboard.type("Hello world");
    await expect(page.getByTestId("words")).toHaveText("2 words");
    await expect(page.getByTestId("dirty")).toHaveText("Modified");
    await page.keyboard.press("Control+Alt+1");
    await expect(editor(page).locator("h1")).toHaveText("Hello world");
  });

  test("File › Print: preview pages match the print layout; a page range; Print calls window.print", async ({ page }) => {
    await interceptPrint(page);
    await openWrite(page);
    await editor(page).click();
    await editor(page).evaluate((el) => el.focus());
    for (let i = 0; i < 60; i++) {
      await page.keyboard.insertText(`Paragraph ${i + 1}: the quick brown fox jumps over the lazy dog, again and again.`);
      await page.keyboard.press("Enter");
    }
    await expect(page.locator(".page-gap").first()).toBeVisible();
    const editorPages = (await page.locator(".page-gap").count()) + 1;
    await page.keyboard.press("Control+p");
    await expect(page.getByTestId("print-panel")).toBeVisible();
    await expect(page.getByTestId("print-page-count")).toHaveText(`Page 1 of ${editorPages}`);
    expect(await previewPdf(page, "write-all")).toBe(editorPages);
    await page.getByLabel("Page range").fill("2");
    await expect(page.getByTestId("print-page-count")).toHaveText("Page 1 of 1");
    expect(await previewPdf(page, "write-page-2")).toBe(1);
    expect(await page.getByTestId("print-preview").getAttribute("srcdoc")).toContain("Paragraph ");
    await page.getByTestId("print-button").click();
    await expect.poll(() => printCount(page)).toBe(1);
  });

  test("Export PDF goes through window.print", async ({ page }) => {
    await interceptPrint(page);
    await openWrite(page);
    await editor(page).click();
    await page.keyboard.type("Print me");
    await fileCommand(page, /^Export PDF/);
    await expect.poll(() => printCount(page)).toBeGreaterThan(0);
  });

  test("a footnote: Ctrl+Alt+F, type the note, save → footnotes.xml has it", async ({ page }) => {
    const errors = trackErrors(page);
    await openWrite(page);
    await editor(page).click();
    await page.keyboard.type("Body with a note");
    await page.keyboard.press("Control+Alt+f");
    await expect(editor(page).locator("sup.note-ref")).toHaveAttribute("data-n", "1");
    const note = editor(page).locator(".notes-area .note").first();
    await expect(note).toBeVisible();
    // The caret is in the note now.
    await page.keyboard.type("Footnote from e2e");
    await expect(note).toContainText("Footnote from e2e");
    const docx = await saveViaBackstage(page);
    // The note's text (runs may be split).
    expect(zipText(docx, "word/footnotes.xml").replace(/<[^>]+>/g, "")).toContain("Footnote from e2e");
    expect(zipText(docx, "word/document.xml")).toContain("w:footnoteReference");
    errors.expectNone();
  });

  test("References › Table of contents after two headings lists both entries", async ({ page }) => {
    await openWrite(page);
    await editor(page).click();
    await page.keyboard.type("Alpha chapter");
    await page.keyboard.press("Control+Alt+1");
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Some text.");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Beta section");
    await page.keyboard.press("Control+Alt+2");
    await expect(editor(page).locator("h2")).toHaveText("Beta section");
    await page.keyboard.press("Control+Home");
    await page.getByRole("tab", { name: "References" }).click();
    await page.getByRole("button", { name: "Table of contents" }).click();
    await page.getByRole("menuitem", { name: "Automatic table (3 levels)" }).click();
    const entries = editor(page).locator(".toc .toc-entry .toc-text");
    await expect(entries).toHaveText(["Alpha chapter", "Beta section"]);
    await page.getByRole("button", { name: "Update table" }).click();
    await expect(editor(page).locator(".toc .toc-page").first()).toHaveText("1");
    // Clicking an entry goes to its heading.
    await entries.nth(1).click();
    const docx = await saveViaBackstage(page);
    expect(zipText(docx, "word/document.xml")).toMatch(/TOC \\o/);
  });

  test("a next-page section break with a landscape second section → two sectPr", async ({ page }) => {
    await openWrite(page);
    await editor(page).click();
    await page.keyboard.type("Portrait part");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Landscape part");
    await editor(page).locator("p", { hasText: "Portrait part" }).click();
    await page.keyboard.press("End");
    await page.getByRole("tab", { name: "Layout" }).click();
    await page.getByRole("button", { name: "Breaks" }).click();
    await page.getByRole("menuitem", { name: "Next page" }).click();
    await expect(editor(page).locator("[data-section-label]")).toHaveAttribute("data-section-label", "Section break (Next page)");
    await editor(page).locator("p", { hasText: "Landscape part" }).click();
    await page.getByRole("button", { name: "Orientation" }).click();
    await page.getByRole("menuitemradio", { name: "Landscape" }).click();
    // The second section starts on its own page.
    await expect(page.locator(".page-gap").first()).toBeVisible();
    const docx = await saveViaBackstage(page);
    const xml = zipText(docx, "word/document.xml");
    expect(xml.match(/<w:sectPr[ >]/g)).toHaveLength(2);
    expect(xml).toContain('w:orient="landscape"');
  });

  test("Multilevel list: 1. then Tab → 1.1", async ({ page }) => {
    await openWrite(page);
    await editor(page).click();
    await page.keyboard.type("First item");
    await page.getByRole("button", { name: "Multilevel list" }).click();
    await page.getByRole("menuitem", { name: /Numbered outline/ }).click();
    await expect(editor(page).locator("li p").first()).toHaveAttribute("data-label", "1.");
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Sub item");
    await page.keyboard.press("Tab");
    await expect(editor(page).locator("li p", { hasText: "Sub item" })).toHaveAttribute("data-label", "1.1");
  });
});
