import { expect, test, type Page } from "@playwright/test";
import { interceptPrint, openPrint, previewPdf, openViaBackstage, printCount, saveViaBackstage, testdata, trackErrors, fileCommand } from "../support/common";
import { zipText, unzip } from "../support/zip";

const REPORT = testdata("docx/provisional-47-report.docx");
/** Screenshots of the P8-21 checks (outside the repository). */
const SHOTS = process.env.SHOTS_DIR ?? "test-results/shots";
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

  // ----- P8-17: merged cells, table styles, floating images, paragraph borders, tab stops -----

  async function newTable(page: Page, rows: number, cols: number) {
    await openWrite(page);
    await editor(page).click();
    await page.keyboard.type("Before the table");
    await page.getByRole("tab", { name: "Insert" }).click();
    await page.getByRole("button", { name: "Table", exact: true }).click();
    await page.getByRole("button", { name: `${rows} × ${cols} table` }).click();
    await expect(editor(page).locator("table tr")).toHaveCount(rows);
  }

  test("Merge Cells on two cells of a row → the saved docx has gridSpan", async ({ page }) => {
    await newTable(page, 2, 3);
    const cells = editor(page).locator("table td");
    await cells.nth(0).click();
    await page.keyboard.type("A");
    await cells.nth(1).click({ modifiers: ["Shift"] });
    await page.getByRole("tab", { name: "Table Layout" }).click();
    await page.getByRole("button", { name: "Merge Cells" }).click();
    await expect(editor(page).locator("table tr").first().locator("td")).toHaveCount(2);
    await expect(editor(page).locator("table td[colspan='2']")).toHaveCount(1);
    const xml = zipText(await saveViaBackstage(page), "word/document.xml");
    expect(xml).toMatch(/<w:gridSpan w:val="2"\/>/);
  });

  test("Table Design › Grid Table 4 Accent 1: the header row is filled with the accent", async ({ page }) => {
    await newTable(page, 3, 3);
    await editor(page).locator("table td").nth(4).click();
    await page.getByRole("tab", { name: "Table Design" }).click();
    await page.getByRole("button", { name: "Grid Table 4 Accent 1" }).first().click();
    const header = editor(page).locator("table tr").first().locator("td").first();
    await expect(header).toHaveCSS("background-color", "rgb(68, 114, 196)");
    // Banded rows: the first data row is tinted, the second is not.
    await expect(editor(page).locator("table tr").nth(1).locator("td").nth(1)).toHaveCSS("background-color", "rgb(218, 227, 243)");
    await expect(editor(page).locator("table tr").nth(2).locator("td").nth(1)).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    const xml = zipText(await saveViaBackstage(page), "word/document.xml");
    expect(xml).toContain('w:tblStyle w:val="GridTable4-Accent1"');
  });

  test("Picture Format › Wrap Text › Square → the saved docx has wp:anchor with wrapSquare", async ({ page }) => {
    await openReport(page);
    const img = editor(page).locator("img.inline-image").first();
    await img.click();
    await page.getByRole("tab", { name: "Picture Format" }).click();
    await page.getByRole("button", { name: "Wrap Text" }).click();
    await page.getByRole("menuitemradio", { name: "Square" }).click();
    await expect(editor(page).locator(".inline-image-wrap.floating")).toHaveCount(1);
    await expect(page.getByTestId("layout-options")).toBeVisible();
    const xml = zipText(await saveViaBackstage(page), "word/document.xml");
    expect(xml).toContain("<wp:anchor");
    expect(xml).toContain("<wp:wrapSquare");
  });

  test("Home › Borders › Bottom border on a paragraph → w:pBdr", async ({ page }) => {
    await openWrite(page);
    await editor(page).click();
    await page.keyboard.type("A ruled paragraph");
    await page.getByRole("button", { name: "Borders", exact: true }).click();
    await page.getByRole("menuitemradio", { name: "Bottom border" }).click();
    await expect(editor(page).locator("p").first()).toHaveCSS("border-bottom-style", "solid");
    const xml = zipText(await saveViaBackstage(page), "word/document.xml");
    expect(xml).toMatch(/<w:pBdr><w:bottom w:val="single"/);
  });

  test("a tab stop added on the ruler → w:tabs; the tab character moves to it", async ({ page }) => {
    await openWrite(page);
    await editor(page).click();
    await page.keyboard.type("Name");
    await page.keyboard.press("Tab");
    await page.keyboard.type("Value");
    const column = page.getByTestId("ruler-column");
    const box = (await column.boundingBox())!;
    await page.mouse.click(box.x + (8 * 96) / 2.54, box.y + box.height / 2);
    await expect(page.getByRole("button", { name: /Left tab at 8\.00 cm/ })).toBeVisible();
    // "Value" starts at the stop (8 cm from the column's left edge).
    const value = await editor(page).locator("p").first().evaluate((p) => {
      const r = document.createRange();
      const text = [...p.querySelectorAll("*")].map((e) => e.lastChild).find((n) => n?.textContent?.includes("Value")) ?? p.lastChild!;
      r.selectNodeContents(text);
      return r.getBoundingClientRect().left - p.getBoundingClientRect().left;
    });
    expect(Math.abs(value - (8 * 96) / 2.54)).toBeLessThan(4);
    const xml = zipText(await saveViaBackstage(page), "word/document.xml");
    expect(xml).toMatch(/<w:tabs><w:tab w:val="left" w:pos="4535"/);
  });

  // ----- styles (P8-21) -----------------------------------------------------------

  test("Modify Heading 1 from the gallery: its colour reaches every heading and styles.xml", async ({ page }) => {
    const errors = trackErrors(page);
    await openWrite(page);
    await editor(page).click();
    await page.keyboard.type("Chapter one");
    await page.keyboard.press("Control+Alt+1");
    await expect(editor(page).locator("h1")).toHaveText("Chapter one");
    const gallery = page.getByRole("group", { name: "Paragraph styles" });
    await gallery.getByRole("button", { name: "Heading 1" }).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Modify…" }).click();
    const dlg = page.getByRole("dialog", { name: "Modify Style" });
    await expect(dlg.getByLabel("Name")).toHaveValue("heading 1");
    await dlg.getByRole("button", { name: "Font color" }).click();
    await page.getByRole("button", { name: "Standard color C00000" }).click();
    await expect(dlg.getByTestId("style-description")).toContainText("#C00000");
    await page.screenshot({ path: SHOTS + "/modify-style.png" });
    await dlg.getByRole("button", { name: "OK" }).click();
    await expect(editor(page).locator("h1")).toHaveCSS("color", "rgb(192, 0, 0)");
    const styles = zipText(await saveViaBackstage(page), "word/styles.xml");
    expect(styles).toMatch(/<w:style w:type="paragraph" w:styleId="Heading1">(?:(?!<\/w:style>)[^])*<w:color w:val="C00000"\/>/);
    errors.expectNone();
  });

  test("Create a Style from the selection, then apply it to another paragraph from the gallery", async ({ page }) => {
    await openWrite(page);
    await editor(page).click();
    await page.keyboard.type("Callout text");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Plain text");
    await editor(page).locator("p", { hasText: "Callout text" }).click();
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+End");
    // ProseMirror takes over the DOM selection asynchronously: bold from the ribbon once it has it.
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe("Callout text");
    await page.getByRole("button", { name: "Bold" }).click();
    await expect(editor(page).locator("strong")).toHaveText("Callout text");
    await page.keyboard.press("Control+e");
    await page.getByRole("button", { name: "More styles" }).click();
    await page.getByRole("button", { name: "Create a Style…" }).click();
    const dlg = page.getByRole("dialog", { name: "Create New Style from Formatting" });
    await dlg.getByLabel("Name").fill("Callout");
    await dlg.getByRole("button", { name: "OK" }).click();
    const first = editor(page).locator('p[data-style="Callout"]');
    await expect(first).toHaveText("Callout text");
    const gallery = page.getByRole("group", { name: "Paragraph styles" });
    await expect(gallery.getByRole("button", { name: "Callout" })).toBeVisible();
    await editor(page).locator("p", { hasText: "Plain text" }).click();
    await gallery.getByRole("button", { name: "Callout" }).click();
    const second = editor(page).locator('p[data-style="Callout"]', { hasText: "Plain text" });
    await expect(second).toHaveCSS("text-align", "center");
    await expect(second).toHaveCSS("font-weight", "700");
    await page.screenshot({ path: SHOTS + "/create-style.png" });
    const docx = await saveViaBackstage(page);
    expect(zipText(docx, "word/document.xml").match(/<w:pStyle w:val="Callout"\/>/g)).toHaveLength(2);
    const styles = zipText(docx, "word/styles.xml");
    expect(styles).toMatch(/<w:style w:type="paragraph" w:customStyle="1" w:styleId="Callout"><w:name w:val="Callout"\/>(?:(?!<\/w:style>)[^])*<w:jc w:val="center"\/>(?:(?!<\/w:style>)[^])*<w:b\/>/);
  });

  test("the Apply Styles box (Ctrl+Shift+S) applies Quote", async ({ page }) => {
    await openWrite(page);
    await editor(page).click();
    await page.keyboard.type("To be or not to be");
    await page.keyboard.press("Control+Shift+S");
    const box = page.getByTestId("apply-styles");
    await expect(box).toBeVisible();
    await box.getByLabel("Style Name").fill("Quote");
    await page.screenshot({ path: SHOTS + "/apply-styles.png" });
    await box.getByLabel("Style Name").press("Enter");
    await expect(box).toBeHidden();
    const quote = editor(page).locator('p[data-style="Quote"]');
    await expect(quote).toHaveText("To be or not to be");
    await expect(quote).toHaveCSS("font-style", "italic");
    await expect(quote).toHaveCSS("text-align", "center");
    expect(zipText(await saveViaBackstage(page), "word/document.xml")).toContain('<w:pStyle w:val="Quote"/>');
  });

  test("Find and Replace with formatting: bold fox → cat, the plain fox stays", async ({ page }) => {
    await openWrite(page);
    await editor(page).click();
    await page.keyboard.type("The fox and the ");
    await page.keyboard.press("Control+b");
    await page.keyboard.type("fox");
    await page.keyboard.press("Control+b");
    await page.keyboard.type(". Another fox.");
    await expect(editor(page).locator("strong")).toHaveText("fox");
    await page.keyboard.press("Control+h");
    const bar = page.getByTestId("find-bar");
    await bar.getByLabel("Find", { exact: true }).fill("fox");
    await expect(page.locator(".find-match")).toHaveCount(3);
    await bar.getByRole("button", { name: "More" }).click();
    await bar.getByRole("button", { name: "Find format" }).click();
    await bar.getByRole("menuitem", { name: "Font…" }).click();
    const font = page.getByRole("dialog", { name: "Font" });
    await font.getByLabel("Bold").selectOption("on");
    await font.getByRole("button", { name: "OK" }).click();
    await expect(bar.getByTestId("find-format")).toContainText("Bold");
    await expect(page.locator(".find-match")).toHaveCount(1);
    await bar.getByLabel("Replace with").fill("cat");
    await page.screenshot({ path: SHOTS + "/find-format.png" });
    await bar.getByRole("button", { name: "Replace all" }).click();
    await expect(bar.getByRole("status")).toHaveText("1 replacement");
    await expect(editor(page).locator("p").first()).toHaveText("The fox and the cat. Another fox.");
    await expect(editor(page).locator("strong")).toHaveText("cat");
    // One undo step brings the bold fox back.
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(editor(page).locator("strong")).toHaveText("fox");
  });

  test("deleting a custom style in the Styles pane re-points its paragraphs to Normal", async ({ page }) => {
    await openWrite(page);
    await editor(page).click();
    await page.keyboard.type("Memo paragraph");
    await page.keyboard.press("Control+Alt+Shift+S");
    const pane = page.getByTestId("styles-pane");
    await expect(pane).toBeVisible();
    await pane.getByRole("button", { name: "New Style" }).click();
    const dlg = page.getByRole("dialog", { name: "Create New Style from Formatting" });
    await dlg.getByLabel("Name").fill("Memo");
    await dlg.getByRole("button", { name: "Italic" }).click();
    await dlg.getByRole("button", { name: "OK" }).click();
    await pane.getByRole("option", { name: "Memo" }).click();
    await expect(editor(page).locator('p[data-style="Memo"]')).toHaveCSS("font-style", "italic");
    await pane.getByRole("button", { name: "Style Memo" }).click();
    await page.screenshot({ path: SHOTS + "/styles-pane.png" });
    await page.getByRole("menuitem", { name: 'Delete "Memo"…' }).click();
    await page.getByRole("dialog", { name: "Delete style" }).getByRole("button", { name: "Yes" }).click();
    await expect(pane.getByRole("option", { name: "Memo" })).toHaveCount(0);
    const p = editor(page).locator("p", { hasText: "Memo paragraph" });
    await expect(p).not.toHaveAttribute("data-style", /.*/);
    await expect(p).toHaveCSS("font-style", "normal");
    const docx = await saveViaBackstage(page);
    expect(zipText(docx, "word/styles.xml")).not.toContain('w:styleId="Memo"');
    expect(zipText(docx, "word/document.xml")).not.toContain("Memo\"");
  });
});
