import { expect, test, type Page } from "@playwright/test";
import { interceptPrint, openPrint, previewPdf, openViaBackstage, printCount, saveViaBackstage, testdata, trackErrors, fileCommand, downloadBuffer } from "../support/common";
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
    await page.getByRole("button", { name: "OK", exact: true }).click();
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
    const editorPages = Number(await page.getByTestId("page-chrome").getAttribute("data-pages"));
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

  test("Multilevel list: 1. then Tab → 1.1.", async ({ page }) => {
    await openWrite(page);
    await editor(page).click();
    await page.keyboard.type("First item");
    await page.getByRole("button", { name: "Multilevel list" }).click();
    await page.getByTestId("multilevel-gallery").getByRole("button", { name: "1. 1.1. 1.1.1." }).click();
    await expect(editor(page).locator("li p").first()).toHaveAttribute("data-label", "1.");
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Sub item");
    await page.keyboard.press("Tab");
    await expect(editor(page).locator("li p", { hasText: "Sub item" })).toHaveAttribute("data-label", "1.1.");
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

// P8-25: comments (Review tab, balloons, docx parts).
test.describe("Write comments", () => {
  const COMMENTS = testdata("docx/provisional-59-comments.docx");

  /** A new document with one paragraph, the caret inside "brave". */
  async function typed(page: Page) {
    await openWrite(page);
    await editor(page).click();
    await page.keyboard.type("Hello brave world");
    await page.keyboard.press("Home");
    for (let i = 0; i < 8; i++) await page.keyboard.press("ArrowRight");
  }

  /** Ctrl+Alt+M, the user name on the first comment, the text, Ctrl+Enter. */
  async function comment(page: Page, text: string) {
    await page.keyboard.press("Control+Alt+m");
    const dialog = page.getByRole("dialog", { name: "User Name" });
    if (await dialog.isVisible().catch(() => false)) {
      await dialog.getByTestId("user-name").fill("Anna Berg");
      await dialog.getByTestId("user-ok").click();
    }
    const box = page.getByTestId("comment-draft-text");
    await box.fill(text);
    await box.press("Control+Enter");
    await expect(page.getByTestId("comment-count")).toBeVisible();
  }

  test("a new comment → comments.xml and commentRangeStart in the saved file", async ({ page }) => {
    const errors = trackErrors(page);
    await typed(page);
    await page.keyboard.press("Control+Alt+m");
    await page.getByRole("dialog", { name: "User Name" }).getByTestId("user-name").fill("Anna Berg");
    await page.getByTestId("user-ok").click();
    await page.getByTestId("comment-draft-text").fill("Too bold?");
    await page.getByTestId("comment-draft-text").press("Control+Enter");
    const balloon = page.getByTestId("comments-margin").getByTestId("comment-thread");
    await expect(balloon).toHaveCount(1);
    await expect(balloon.getByTestId("comment-text")).toHaveText("Too bold?");
    await expect(balloon.getByTestId("comment-author")).toHaveText("Anna Berg");
    await expect(page.getByTestId("comment-count")).toHaveText("1 comment");
    await expect(editor(page).locator(".comment-range")).toHaveText("brave");
    await page.screenshot({ path: `${SHOTS}/comments-new.png` });
    const docx = await saveViaBackstage(page);
    const comments = zipText(docx, "word/comments.xml");
    expect(comments).toContain('w:author="Anna Berg"');
    expect(comments).toContain('w:initials="AB"');
    expect(comments).toContain("Too bold?");
    const xml = zipText(docx, "word/document.xml");
    expect(xml).toContain('<w:commentRangeStart w:id="1"/>');
    expect(xml).toMatch(/<w:commentRangeStart w:id="1"\/>(?:(?!<\/w:p>)[^])*brave(?:(?!<\/w:p>)[^])*<w:commentRangeEnd w:id="1"\/>/);
    expect(xml).toContain('<w:commentReference w:id="1"/>');
    errors.expectNone();
  });

  test("a reply → commentsExtended.xml links it with paraIdParent", async ({ page }) => {
    await typed(page);
    await comment(page, "Root comment");
    const thread = page.getByTestId("comment-thread").first();
    await thread.click();
    const reply = thread.getByTestId("comment-reply-box");
    await reply.fill("A reply");
    await reply.press("Control+Enter");
    await expect(thread.getByTestId("comment-reply")).toHaveCount(1);
    await expect(page.getByTestId("comment-count")).toHaveText("2 comments");
    await page.screenshot({ path: `${SHOTS}/comments-reply.png` });
    const docx = await saveViaBackstage(page);
    const ext = zipText(docx, "word/commentsExtended.xml");
    expect(ext).toMatch(/<w15:commentEx w15:paraId="10000001" w15:paraIdParent="10000000" w15:done="0"\/>/);
    expect(zipText(docx, "word/comments.xml")).toContain("A reply");
  });

  test("resolve → w15:done=\"1\"", async ({ page }) => {
    await typed(page);
    await comment(page, "Please fix");
    const thread = page.getByTestId("comment-thread").first();
    await thread.getByTestId("comment-resolve").click();
    await expect(thread).toHaveAttribute("data-resolved", "true");
    const docx = await saveViaBackstage(page);
    expect(zipText(docx, "word/commentsExtended.xml")).toContain('w15:done="1"');
  });

  test("deleting the commented text deletes the comment", async ({ page }) => {
    await typed(page);
    await comment(page, "Soon gone");
    await editor(page).locator("p").first().click();
    await page.keyboard.press("End");
    await page.keyboard.press("Shift+Home");
    await page.keyboard.press("Delete");
    await expect(page.getByTestId("comment-count")).toHaveCount(0);
    await expect(page.getByTestId("comment-thread")).toHaveCount(0);
    await page.keyboard.type("Fresh text");
    const docx = await saveViaBackstage(page);
    expect(zipText(docx, "word/document.xml")).not.toContain("commentRange");
    expect(() => zipText(docx, "word/comments.xml")).toThrow();
  });

  test("the reference document shows one balloon per thread", async ({ page }) => {
    const errors = trackErrors(page);
    await openWrite(page);
    await openViaBackstage(page, COMMENTS);
    const margin = page.getByTestId("comments-margin");
    await expect(margin.getByTestId("comment-thread")).toHaveCount(4);
    await expect(margin.getByTestId("comment-reply")).toHaveCount(1);
    await expect(margin.locator('[data-resolved="true"]')).toHaveCount(1);
    await expect(page.getByTestId("comment-count")).toHaveText("5 comments");
    // Balloons do not overlap.
    const boxes = await margin.locator("[data-balloon-id]").evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => [r.top, r.bottom]));
    const sorted = boxes.sort((a, b) => a[0]! - b[0]!);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i]![0]!).toBeGreaterThanOrEqual(sorted[i - 1]![1]! - 0.5);
    await margin.getByTestId("comment-thread").first().click();
    await expect(page.getByTestId("comment-connector")).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/comments-reference.png` });
    // Narrow window: the Comments pane replaces the balloons.
    await page.setViewportSize({ width: 1100, height: 900 });
    await expect(page.getByTestId("comments-pane").getByTestId("comment-thread")).toHaveCount(4);
    await page.screenshot({ path: `${SHOTS}/comments-pane.png` });
    errors.expectNone();
  });
});

test.describe("Write links, fields and columns (P8-27)", () => {
  test("Ctrl+K: an external link is saved as w:hyperlink with an external relationship", async ({ page }) => {
    const errors = trackErrors(page);
    await openWrite(page);
    await editor(page).click();
    await page.keyboard.type("Visit Rusuite");
    for (let i = 0; i < "Rusuite".length; i++) await page.keyboard.press("Shift+ArrowLeft");
    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog", { name: "Insert Hyperlink" });
    await expect(dialog.getByLabel("Text to display")).toHaveValue("Rusuite");
    await dialog.getByRole("textbox", { name: "Address", exact: true }).fill("https://rusuite.example/");
    await dialog.getByLabel("ScreenTip").fill("Home page");
    await dialog.getByTestId("link-ok").click();
    const link = editor(page).locator("a.doc-link");
    await expect(link).toHaveText("Rusuite");
    await expect(link).toHaveAttribute("title", /Home page[\s\S]*Ctrl\+Click to follow link/);
    await page.screenshot({ path: `${SHOTS}/p8-27-link.png` });
    const docx = await saveViaBackstage(page);
    const xml = zipText(docx, "word/document.xml");
    const rid = /<w:hyperlink r:id="(rId\d+)"[^>]*w:tooltip="Home page"/.exec(xml)?.[1];
    expect(rid).toBeTruthy();
    expect(xml).toMatch(/<w:hyperlink[^>]*>(?:(?!<\/w:hyperlink>)[^])*Rusuite/);
    expect(zipText(docx, "word/_rels/document.xml.rels")).toMatch(new RegExp(`Id="${rid}"[^>]*Target="https://rusuite.example/" TargetMode="External"`));
    errors.expectNone();
  });

  test("a bookmark and a cross-reference to its page: PAGEREF, updated after a page break", async ({ page }) => {
    await openWrite(page);
    await editor(page).click();
    await page.keyboard.type("Intro");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Results here");
    await page.keyboard.press("Enter");
    await page.keyboard.type("See page ");
    // Bookmark "results" on the second paragraph.
    await editor(page).locator("p", { hasText: "Results here" }).click();
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+End");
    await page.getByRole("tab", { name: "Insert" }).click();
    await page.getByRole("button", { name: "Bookmark" }).click();
    const bm = page.getByRole("dialog", { name: "Bookmark" });
    await bm.getByLabel("Bookmark name").fill("results");
    await bm.getByRole("button", { name: "Add" }).click();
    await expect(bm).toBeHidden();
    await expect(editor(page).locator('[data-bookmark="results"]')).toHaveCount(1);
    // The cross-reference at the end of "See page ".
    await editor(page).locator("p", { hasText: "See page" }).click();
    await page.keyboard.press("End");
    await page.getByRole("button", { name: "Cross-reference" }).click();
    const xr = page.getByRole("dialog", { name: "Cross-reference" });
    await xr.getByLabel("Reference type").selectOption("bookmark");
    await xr.getByLabel("Insert reference to").selectOption("page");
    await xr.getByRole("option", { name: "results" }).click();
    await xr.getByTestId("xref-insert").click();
    const ref = editor(page).locator('.field[data-field="pageRef"]');
    await expect(ref).toHaveText("1");
    await xr.getByRole("button", { name: "Close" }).click();
    await expect(xr).toBeHidden();
    // A page break at the end of "Intro" moves the bookmarked paragraph to page 2.
    await editor(page).locator("p", { hasText: "Intro" }).click();
    await page.keyboard.press("End");
    await page.getByRole("button", { name: "Page break" }).first().click();
    await expect(editor(page).locator("p", { hasText: "Intro" }).locator(".page-break")).toHaveCount(1);
    await expect(page.locator(".page-gap").first()).toBeVisible();
    await expect(ref).toHaveAttribute("data-live", "2");
    const docx = await saveViaBackstage(page);
    const xml = zipText(docx, "word/document.xml");
    expect(xml).toContain('<w:bookmarkStart w:id="1" w:name="results"/>');
    expect(xml).toMatch(/<w:fldSimple w:instr=" PAGEREF results \\h ">(?:(?!<\/w:fldSimple>)[^])*<w:t>2<\/w:t>/);
  });

  test("captions: Figure 1 and Figure 2 numbered by SEQ, renumbered when one is inserted before", async ({ page }) => {
    await openWrite(page);
    await editor(page).click();
    await page.keyboard.type("Picture one");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Picture two");
    await page.getByRole("tab", { name: "References" }).click();
    await page.getByRole("button", { name: "Insert Caption" }).click();
    let dialog = page.getByRole("dialog", { name: "Caption" });
    await expect(dialog.getByTestId("caption-prefix")).toHaveText("Figure 1");
    await dialog.getByLabel("Caption").fill(": the second");
    await dialog.getByTestId("caption-ok").click();
    await expect(editor(page).locator("p", { hasText: "Figure 1: the second" })).toBeVisible();
    await editor(page).locator("p", { hasText: "Picture one" }).click();
    await page.getByRole("button", { name: "Insert Caption" }).click();
    dialog = page.getByRole("dialog", { name: "Caption" });
    await dialog.getByLabel("Caption").fill(": the first");
    await dialog.getByTestId("caption-ok").click();
    const captions = editor(page).locator('p[data-style="Caption"]');
    await expect(captions).toHaveText(["Figure 1: the first", "Figure 2: the second"]);
    const docx = await saveViaBackstage(page);
    const xml = zipText(docx, "word/document.xml");
    const seqs = [...xml.matchAll(/<w:fldSimple w:instr=" SEQ Figure \\\* ARABIC ">(?:(?!<\/w:fldSimple>)[^])*<w:t>(\d+)<\/w:t>/g)].map((m) => m[1]);
    expect(seqs).toEqual(["1", "2"]);
    expect(xml.match(/<w:pStyle w:val="Caption"\/>/g)).toHaveLength(2);
  });

  test("Layout › Columns › Two: w:cols w:num=\"2\" and the text laid out in two columns", async ({ page }) => {
    await openWrite(page);
    await editor(page).click();
    const words = "Columns flow from the bottom of the first column to the top of the next one. ";
    for (let i = 0; i < 4; i++) {
      await page.keyboard.type(words.repeat(3).trim());
      if (i < 3) await page.keyboard.press("Enter");
    }
    await page.getByRole("tab", { name: "Layout" }).click();
    await page.getByRole("button", { name: "Columns" }).click();
    await page.getByRole("menuitemradio", { name: "Two" }).click();
    const box = editor(page).locator(".section-columns");
    await expect(box).toHaveAttribute("data-columns", "2");
    const paras = box.locator("p");
    await expect(paras).toHaveCount(4);
    const first = (await paras.first().boundingBox())!;
    const last = (await paras.last().boundingBox())!;
    const boxRect = (await box.boundingBox())!;
    // The first paragraph is in the left column, the last in the right one, side by side.
    expect(first.x + first.width).toBeLessThan(boxRect.x + boxRect.width / 2 + 2);
    expect(last.x).toBeGreaterThan(boxRect.x + boxRect.width / 2 - 2);
    expect(last.y).toBeLessThan(first.y + first.height + boxRect.height / 2);
    await page.screenshot({ path: `${SHOTS}/p8-27-columns.png` });
    const docx = await saveViaBackstage(page);
    expect(zipText(docx, "word/document.xml")).toMatch(/<w:cols[^>]*w:num="2"/);
  });

  test("File › Info: the title is saved in docProps/core.xml", async ({ page }) => {
    await openWrite(page);
    await editor(page).click();
    await page.keyboard.type("Some text");
    await page.getByRole("tab", { name: "File", exact: true }).click();
    const backstage = page.getByTestId("backstage");
    await backstage.getByRole("button", { name: "Info" }).click();
    const panel = page.getByTestId("info-panel");
    await panel.getByLabel("Title").fill("E2E Report");
    await panel.getByLabel("Subject").click();
    await expect(page.getByTestId("dirty")).toHaveText("Modified");
    await page.screenshot({ path: `${SHOTS}/p8-27-info.png` });
    const [dl] = await Promise.all([page.waitForEvent("download"), backstage.getByRole("button", { name: /^Save$/ }).click()]);
    const docx = await downloadBuffer(dl);
    const core = zipText(docx, "docProps/core.xml");
    expect(core).toContain("<dc:title>E2E Report</dc:title>");
    expect(core).toMatch(/<dcterms:modified xsi:type="dcterms:W3CDTF">\d{4}-\d\d-\d\dT/);
    expect(zipText(docx, "docProps/app.xml")).toContain("<Application>Rusuite Write</Application>");
  });

  test("the font box shows the resolved style font and size in Heading 1", async ({ page }) => {
    await openWrite(page);
    await editor(page).click();
    await page.keyboard.type("Chapter one");
    const font = page.getByLabel("Font family");
    const size = page.getByLabel("Font size");
    await expect(font).toHaveValue("Calibri");
    await expect(size).toHaveValue("11");
    await page.keyboard.press("Control+Alt+1");
    await expect(editor(page).locator("h1")).toHaveText("Chapter one");
    await expect(font).toHaveValue("Calibri Light");
    await expect(size).toHaveValue("16");
  });
});

// ----- P8-31: pagination ------------------------------------------------------------------

test.describe("Write pagination (P8-31)", () => {
  const LOREM =
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. ";

  /** The body box of every sheet (page frame px). */
  async function bodies(page: Page): Promise<[number, number][]> {
    const raw = (await page.getByTestId("page-chrome").getAttribute("data-bodies")) ?? "";
    return raw.split(";").map((s) => s.split(",").map(Number) as [number, number]);
  }

  /** Lines (text rects merged by row) of the elements matching `selector`, counted per page. */
  async function linesPerPage(page: Page, selector: string, nth = 0): Promise<number[]> {
    const b = await bodies(page);
    return page.evaluate(
      ({ selector, nth, b }) => {
        const frame = document.querySelector("[data-testid=write-page]") as HTMLElement;
        const fr = frame.getBoundingClientRect();
        const z = fr.width / frame.offsetWidth;
        const el = document.querySelectorAll(selector)[nth]!;
        const tops = new Set<number>();
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        const r = document.createRange();
        for (let t = walker.nextNode(); t; t = walker.nextNode()) {
          r.selectNodeContents(t);
          for (const rc of Array.from(r.getClientRects())) tops.add(Math.round((rc.top + rc.bottom) / 2 / z - fr.top / z));
        }
        const out = b.map(() => 0);
        for (const y of tops) {
          const k = b.findIndex(([top, bottom]) => y >= top && y <= bottom);
          if (k >= 0) out[k]!++;
        }
        return out;
      },
      { selector, nth, b },
    );
  }

  async function typeLorem(page: Page, paragraphs: number, repeat = 3) {
    await editor(page).click();
    await editor(page).evaluate((el) => el.focus());
    for (let i = 0; i < paragraphs; i++) {
      await page.keyboard.insertText(`${i + 1}. ${LOREM.repeat(repeat)}`.trim());
      if (i < paragraphs - 1) await page.keyboard.press("Enter");
    }
  }

  const pages = async (page: Page) => Number(await page.getByTestId("page-chrome").getAttribute("data-pages"));

  test("a 3-page document breaks inside paragraphs: one paragraph straddles pages 1 and 2", async ({ page }) => {
    const errors = trackErrors(page);
    await openWrite(page);
    await typeLorem(page, 14);
    await expect.poll(() => pages(page)).toBe(3);
    await expect(page.getByTestId("page-status")).toHaveText("Page 3 of 3");
    // Some paragraph has lines on page 1 and on page 2.
    const count = await editor(page).locator("p").count();
    let straddle: number[] | null = null;
    for (let i = 0; i < count && !straddle; i++) {
      const per = await linesPerPage(page, ".ProseMirror > p", i);
      if (per[0]! > 0 && per[1]! > 0) straddle = per;
    }
    expect(straddle).not.toBeNull();
    expect(straddle![0]).toBeGreaterThanOrEqual(2);
    expect(straddle![1]).toBeGreaterThanOrEqual(2);
    // Every line of the document lies inside a page body.
    const b = await bodies(page);
    const outside = await page.evaluate((b) => {
      const frame = document.querySelector("[data-testid=write-page]") as HTMLElement;
      const fr = frame.getBoundingClientRect();
      const r = document.createRange();
      const walker = document.createTreeWalker(document.querySelector(".ProseMirror")!, NodeFilter.SHOW_TEXT);
      let n = 0;
      for (let t = walker.nextNode(); t; t = walker.nextNode()) {
        r.selectNodeContents(t);
        for (const rc of Array.from(r.getClientRects())) {
          const y = (rc.top + rc.bottom) / 2 - fr.top;
          if (!b.some(([top, bottom]) => y >= top && y <= bottom)) n++;
        }
      }
      return n;
    }, b);
    expect(outside).toBe(0);
    await page.getByTestId("write-scroll").evaluate((el) => (el.scrollTop = 800));
    await page.screenshot({ path: `${SHOTS}/p8-31-lines-across-pages.png` });
    errors.expectNone();
  });

  test("widow control moves the last line: a 4-line paragraph splits 2/2, without widow control 3/1", async ({ page }) => {
    await openWrite(page);
    await editor(page).click();
    // Paragraph A: one-line rows (Shift+Enter), paragraph B: 4 lines.
    for (let i = 0; i < 40; i++) {
      await page.keyboard.insertText(`a${i}`);
      await page.keyboard.press("Shift+Enter");
    }
    await page.keyboard.insertText("a-last");
    await page.keyboard.press("Enter");
    for (let i = 0; i < 3; i++) {
      await page.keyboard.insertText(`b${i}`);
      await page.keyboard.press("Shift+Enter");
    }
    await page.keyboard.insertText("b-last");
    const B = ".ProseMirror > p";
    // Lines added to A push B down until it no longer fits on page 1.
    let per = await linesPerPage(page, B, 1);
    for (let k = 0; k < 40 && (per[1] ?? 0) === 0; k++) {
      await editor(page).locator("p").first().evaluate((el) => el.scrollIntoView({ block: "end" }));
      await page.keyboard.press("Control+Home");
      await page.keyboard.insertText("a+");
      await page.keyboard.press("Shift+Enter");
      await page.waitForTimeout(250);
      per = await linesPerPage(page, B, 1);
    }
    // Without widow control it would be 3 + 1; Word keeps two lines together.
    expect(per.slice(0, 2)).toEqual([2, 2]);
    await page.keyboard.press("Control+End");
    await page.getByRole("tab", { name: "Home" }).click();
    await page.getByRole("button", { name: "Paragraph settings" }).click();
    const dialog = page.getByRole("dialog", { name: "Paragraph" });
    await dialog.getByRole("tab", { name: "Line and Page Breaks" }).click();
    await dialog.getByRole("checkbox", { name: "Widow/Orphan control" }).uncheck();
    await dialog.getByRole("button", { name: "OK" }).click();
    await expect.poll(async () => (await linesPerPage(page, B, 1)).slice(0, 2)).toEqual([3, 1]);
  });

  test("a long table repeats its header row on page 2 (saved w:tblHeader)", async ({ page }) => {
    const errors = trackErrors(page);
    await openWrite(page);
    await editor(page).click();
    await page.keyboard.type("Before the table");
    await page.getByRole("tab", { name: "Insert" }).click();
    await page.getByRole("button", { name: "Table", exact: true }).click();
    await page.getByRole("button", { name: "2 × 2 table" }).click();
    await editor(page).locator("table td").first().click();
    await page.keyboard.type("Head A");
    await page.keyboard.press("Tab");
    await page.keyboard.type("Head B");
    await page.getByRole("tab", { name: "Table Layout" }).click();
    await page.getByRole("button", { name: "Header row", exact: true }).click();
    await expect(editor(page).locator("tr[data-header]")).toHaveCount(1);
    for (let i = 1; i < 45; i++) {
      await page.keyboard.press("Tab");
      await page.keyboard.type(`Row ${i}`);
      await page.keyboard.press("Tab");
      await page.keyboard.type(`Value ${i}`);
    }
    await expect.poll(() => pages(page)).toBe(2);
    const repeat = page.getByTestId("page-repeat-header");
    await expect(repeat).toHaveCount(1);
    await expect(repeat).toContainText("Head A");
    // The repeated header sits at the top of page 2's body, right above the first row there.
    const [, second] = await bodies(page);
    const top = await repeat.evaluate((el) => parseFloat((el as HTMLElement).style.top));
    expect(Math.abs(top - second![0])).toBeLessThan(1);
    await repeat.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/p8-31-table-header.png` });
    const docx = await saveViaBackstage(page);
    expect(zipText(docx, "word/document.xml")).toContain("<w:tblHeader");
    errors.expectNone();
  });

  test("a footnote is at the bottom of its page in print layout and in the print preview", async ({ page }) => {
    // (Opening the preview of a document with notes logs Chromium's sandbox notice for the preview frame – also before P8-31.)
    await openWrite(page);
    await typeLorem(page, 10);
    await expect.poll(() => pages(page)).toBe(2);
    const p5 = editor(page).locator("p", { hasText: "5. Lorem" });
    // The caret into paragraph 5 (retried: the pages may still be settling after typing).
    await expect
      .poll(async () => {
        await p5.evaluate((el) => el.scrollIntoView({ block: "center" }));
        await page.waitForTimeout(200);
        await p5.click({ position: { x: 30, y: 5 } });
        return page.evaluate(() => window.getSelection()?.anchorNode?.textContent?.startsWith("5. Lorem") ?? false);
      })
      .toBe(true);
    await page.keyboard.press("End");
    await page.keyboard.press("Control+Alt+f");
    await page.keyboard.type("Footnote at the foot of page one.");
    const note = editor(page).locator(".note[data-note-kind='foot']");
    await expect(note).toHaveClass(/note-paged/);
    const [first] = await bodies(page);
    // The note's bottom is at the bottom of page 1's body (one editable copy, no notes area duplicate).
    await expect
      .poll(async () => {
        const box = await note.evaluate((el) => {
          const fr = document.querySelector("[data-testid=write-page]")!.getBoundingClientRect();
          const r = el.getBoundingClientRect();
          return [r.top - fr.top, r.bottom - fr.top];
        });
        return box[1]! <= first![1] + 1 && box[1]! > first![1] - 30 && box[0]! > first![0] + 400;
      })
      .toBe(true);
    await expect(page.getByTestId("page-note-separator")).toHaveAttribute("data-page", "1");
    await note.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/p8-31-footnote.png` });
    await page.keyboard.press("Control+p");
    await expect(page.getByTestId("print-panel")).toBeVisible();
    await expect(page.getByTestId("print-page-count")).toHaveText("Page 1 of 2");
    const html = (await page.getByTestId("print-preview").getAttribute("srcdoc"))!;
    const pageOne = html.split('data-page="2"')[0]!;
    expect(pageOne).toContain("Footnote at the foot of page one.");
    expect(pageOne).toContain("rs-write-note-sep");
  });

  test("a two-column section flows across pages: both columns filled on page 1, the rest on page 2", async ({ page }) => {
    await openWrite(page);
    await typeLorem(page, 16, 2);
    await page.getByRole("tab", { name: "Layout" }).click();
    await page.getByRole("button", { name: "Columns" }).click();
    await page.getByRole("menuitemradio", { name: "Two" }).click();
    await expect(editor(page).locator(".section-columns")).toHaveAttribute("data-columns", "2");
    await expect.poll(() => pages(page)).toBe(2);
    const b = await bodies(page);
    // Lines per page and column (left / right half of the body).
    const cols = await page.evaluate((b) => {
      const frame = document.querySelector("[data-testid=write-page]") as HTMLElement;
      const fr = frame.getBoundingClientRect();
      const mid = fr.width / 2;
      const out = b.map(() => [0, 0]);
      const r = document.createRange();
      const walker = document.createTreeWalker(document.querySelector(".section-columns")!, NodeFilter.SHOW_TEXT);
      for (let t = walker.nextNode(); t; t = walker.nextNode()) {
        r.selectNodeContents(t);
        for (const rc of Array.from(r.getClientRects())) {
          const y = (rc.top + rc.bottom) / 2 - fr.top;
          const k = b.findIndex(([top, bottom]) => y >= top && y <= bottom);
          if (k >= 0) out[k]![rc.left - fr.left < mid ? 0 : 1]!++;
        }
      }
      return out;
    }, b);
    expect(cols[0]![0]).toBeGreaterThan(40);
    // Page 1's columns are full (within a line or two of each other), page 2 continues in both columns (balanced).
    expect(Math.abs(cols[0]![0]! - cols[0]![1]!)).toBeLessThanOrEqual(3);
    expect(cols[1]![0]).toBeGreaterThan(0);
    expect(cols[1]![1]).toBeGreaterThan(0);
    expect(Math.abs(cols[1]![0]! - cols[1]![1]!)).toBeLessThanOrEqual(3);
    await page.getByTestId("write-scroll").evaluate((el) => (el.scrollTop = 700));
    await page.screenshot({ path: `${SHOTS}/p8-31-columns.png` });
  });

  test("Export PDF: the printed PDF has as many pages as the editor", async ({ page }) => {
    // Keep the print root mounted while the PDF is made.
    await page.addInitScript(() => {
      (window as unknown as { __printed: number }).__printed = -1;
      window.print = () => {
        (window as unknown as { __printed: number }).__printed = document.querySelectorAll("#rusuite-print-root .rs-print-page").length;
      };
    });
    await openWrite(page);
    await typeLorem(page, 16);
    await page.keyboard.press("Control+Alt+f");
    await page.keyboard.type("A note.");
    await expect.poll(() => pages(page)).toBeGreaterThanOrEqual(3);
    await page.waitForTimeout(500);
    const editorPages = await pages(page);
    await fileCommand(page, /^Export PDF/);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __printed: number }).__printed)).toBe(editorPages);
    await page.emulateMedia({ media: "print" });
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    expect((pdf.toString("latin1").match(/\/Type\s*\/Page(?!s)/g) ?? []).length).toBe(editorPages);
  });

});

test.describe("Write drawings and character formatting (P8-34)", () => {

  const main = (page: Page) => page.getByTestId("editor");
  const P834 = process.env.SHOTS_DIR ?? "../../shots";

  test("P8-34: a rounded rectangle with text saves as wps:wsp + txbxContent and stays editable after reopening", async ({ page }) => {
    const errors = trackErrors(page);
    await openWrite(page);
    await main(page).click();
    await page.keyboard.type("Shape: ");
    await page.getByRole("tab", { name: "Insert" }).click();
    await page.getByRole("button", { name: "Shapes" }).click();
    await page.getByRole("button", { name: "Rounded rectangle" }).first().click();
    // P9-W4: picking a shape arms the drawing tool (Word); Enter inserts it at the caret.
    await expect(main(page)).toHaveAttribute("data-draw-tool", "roundRect");
    await page.keyboard.press("Enter");
    const shape = page.locator(".drawing-wrap[data-preset='roundRect']");
    await expect(shape).toHaveCount(1);
    await expect(page.getByRole("tab", { name: "Shape Format" })).toBeVisible();
    await shape.dblclick();
    await page.keyboard.type("Inside the shape");
    await expect(shape.locator(".drawing-text")).toContainText("Inside the shape");
    await page.screenshot({ path: `${P834}/P8-34-shape-text.png` });
    const docx = await saveViaBackstage(page);
    const xml = zipText(docx, "word/document.xml");
    expect(xml).toContain("<wps:wsp>");
    expect(xml).toContain('<a:prstGeom prst="roundRect">');
    expect(xml).toMatch(/<w:txbxContent>(?:(?!<\/w:txbxContent>)[^])*Inside the shape/);
    expect(xml).toContain("<mc:Fallback><w:pict><v:roundrect");
    // Reopen the saved file: the text inside the shape can be edited again.
    const file = `${test.info().outputPath("shape.docx")}`;
    (await import("node:fs")).writeFileSync(file, docx);
    await openViaBackstage(page, file);
    const again = page.locator(".drawing-wrap[data-preset='roundRect']");
    await expect(again.locator(".drawing-text")).toContainText("Inside the shape");
    await again.locator(".drawing-text .ProseMirror").click();
    await page.keyboard.press("End");
    await page.keyboard.type(" again");
    await expect(again.locator(".drawing-text")).toContainText("Inside the shape again");
    const xml2 = zipText(await saveViaBackstage(page), "word/document.xml");
    expect(xml2).toMatch(/<w:txbxContent>(?:(?!<\/w:txbxContent>)[^])*Inside the shape again/);
    errors.expectNone();
  });

  test("P8-34: a text box floats right with square wrapping", async ({ page }) => {
    await openWrite(page);
    await main(page).click();
    await page.keyboard.type("Text flows around the box. ".repeat(12));
    await page.keyboard.press("Control+Home");
    await page.getByRole("tab", { name: "Insert" }).click();
    await page.getByRole("button", { name: "Text Box" }).click();
    await page.getByRole("menuitem", { name: "Simple Text Box" }).click();
    const box = page.locator(".drawing-wrap[data-kind='textBox']");
    await expect(box).toHaveCount(1);
    await page.getByRole("tab", { name: "Shape Format" }).click();
    await page.getByRole("button", { name: "Wrap Text" }).click();
    await page.getByRole("menuitemradio", { name: "Square" }).click();
    await page.getByRole("button", { name: "Position" }).click();
    await page.getByRole("menuitemradio", { name: /Top Right/ }).click();
    await expect(box).toHaveClass(/float-right/);
    await box.locator(".drawing-text .ProseMirror").click();
    await page.keyboard.type("Boxed");
    await page.screenshot({ path: `${P834}/P8-34-text-box-right.png` });
    // Print / PDF show the box as in the editor (no handles).
    await openPrint(page);
    const srcdoc = (await page.getByTestId("print-preview").getAttribute("srcdoc")) ?? "";
    expect(srcdoc).toContain("drawing-wrap");
    expect(srcdoc).toContain("Boxed");
    expect(await previewPdf(page, "P8-34-text-box")).toBe(1);
    await page.screenshot({ path: `${P834}/P8-34-print-preview.png` });
    await page.keyboard.press("Escape");
    const xml = zipText(await saveViaBackstage(page), "word/document.xml");
    expect(xml).toContain('<wps:cNvSpPr txBox="1"/>');
    expect(xml).toMatch(/<wp:anchor [^>]*>(?:(?!<\/wp:anchor>)[^])*<wp:align>right<\/wp:align>/);
    expect(xml).toContain('<wp:wrapSquare wrapText="bothSides"/>');
    expect(xml).toMatch(/<w:txbxContent>(?:(?!<\/w:txbxContent>)[^])*Boxed/);
  });

  test("P8-34: cropping a picture writes a:srcRect", async ({ page }) => {
    await openWrite(page);
    await openViaBackstage(page, testdata("docx/provisional-30-image-inline.docx"));
    const img = main(page).locator(".inline-image-wrap").first();
    await img.click();
    await page.getByRole("tab", { name: "Picture Format" }).click();
    await page.getByRole("button", { name: "Crop", exact: true }).click();
    await expect(img).toHaveClass(/cropping/);
    const handle = img.locator(".crop-handle-e");
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x - 20, box.y + box.height / 2, { steps: 5 });
    await page.mouse.up();
    await page.screenshot({ path: `${P834}/P8-34-crop.png` });
    await page.keyboard.press("Enter");
    await expect(img).not.toHaveClass(/cropping/);
    const xml = zipText(await saveViaBackstage(page), "word/document.xml");
    expect(xml).toMatch(/<a:srcRect r="\d+"\/>/);
  });

  test("P8-34: small caps and 2 pt spacing from the Font dialog → w:smallCaps / w:spacing", async ({ page }) => {
    await openWrite(page);
    await main(page).click();
    await page.keyboard.type("Small caps here");
    await page.keyboard.press("Shift+Home");
    await page.keyboard.press("Control+d");
    const dialog = page.getByRole("dialog", { name: "Font" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("checkbox", { name: "Small caps" }).check();
    await dialog.getByRole("tab", { name: "Advanced" }).click();
    // P9-W3: Word's Spacing ▾ Expanded + By.
    await dialog.getByRole("combobox", { name: "Spacing" }).selectOption("plus");
    await dialog.getByRole("textbox", { name: "Spacing by (pt)" }).fill("2");
    await dialog.getByRole("button", { name: "OK" }).click();
    const span = main(page).locator("span.text-style", { hasText: "Small caps here" });
    await expect(span).toHaveCSS("font-variant-caps", "small-caps");
    await page.screenshot({ path: `${P834}/P8-34-small-caps.png` });
    const xml = zipText(await saveViaBackstage(page), "word/document.xml");
    expect(xml).toMatch(/<w:smallCaps\/>(?:(?!<\/w:rPr>)[^])*<w:spacing w:val="40"\/>/);
  });

  test("P8-34: Change Case › UPPERCASE changes the letters and keeps the formatting", async ({ page }) => {
    await openWrite(page);
    await main(page).click();
    await page.keyboard.type("make this loud");
    await page.keyboard.press("Shift+Home");
    await page.getByRole("button", { name: "Bold" }).click();
    await page.getByRole("tab", { name: "Home" }).click();
    await page.getByRole("button", { name: "Change Case" }).click();
    await page.getByRole("menuitem", { name: "UPPERCASE" }).click();
    await expect(main(page).locator("strong")).toHaveText("MAKE THIS LOUD");
    const xml = zipText(await saveViaBackstage(page), "word/document.xml");
    expect(xml).toMatch(/<w:b\/>(?:(?!<\/w:r>)[^])*MAKE THIS LOUD/);
  });

  test("P8-34: inserting a column into a merged table keeps the merge", async ({ page }) => {
    await openWrite(page);
    await openViaBackstage(page, testdata("docx/provisional-55-table-merged-cells.docx"));
    const table = main(page).locator("table").first();
    const header = table.locator("td[colspan='4']").first();
    await expect(header).toBeVisible();
    // A cell of the row below the header spanning four columns.
    await table.locator("tr").nth(1).locator("td").first().click();
    await page.getByRole("tab", { name: "Table Layout" }).click();
    await page.getByRole("button", { name: "Insert right" }).click();
    await expect(table.locator("td[colspan='5']")).toHaveCount(1);
    const xml = zipText(await saveViaBackstage(page), "word/document.xml");
    expect(xml).toContain('<w:gridSpan w:val="5"/>');
  });
});
