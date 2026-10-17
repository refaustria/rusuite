// P9-W5: Write tables round 2, ruler and special characters – a column inserted inside a merged header widens it
// (saved gridSpan), the Border Painter paints one cell edge (saved tcBorders), dragging the ruler's left-indent box
// indents the paragraph (saved w:ind), two unequal columns are laid out side by side at their widths (saved w:cols with
// w:col widths), Insert › Symbol © and Ctrl+Shift+Space save the characters, Ctrl+Shift+Enter splits a table, a table
// style's bold header row shows in the editor.
import { expect, test, type Page } from "@playwright/test";
import { saveViaBackstage, trackErrors } from "../support/common";
import { zipText } from "../support/zip";

const SHOTS = "../../shots";
const editor = (page: Page) => page.locator(".ProseMirror").first();

async function openWrite(page: Page) {
  await page.goto("write/");
  await editor(page).waitFor();
  await expect(page.getByTestId("status-bar")).toContainText("Saved");
  await editor(page).click();
}

/** Insert › Table › rows × cols at the caret; the caret goes into the first cell. */
async function insertTable(page: Page, rows: number, cols: number) {
  await page.getByRole("tab", { name: "Insert" }).click();
  await page.getByRole("button", { name: "Table", exact: true }).click();
  await page.getByRole("button", { name: `${rows} × ${cols} table` }).click();
}

/** Types `texts` into consecutive cells (Tab between them). */
async function fillCells(page: Page, texts: string[]) {
  for (let i = 0; i < texts.length; i++) {
    await page.keyboard.type(texts[i]!);
    if (i + 1 < texts.length) await page.keyboard.press("Tab");
  }
}

test.describe("Write tables round 2, ruler and symbols (P9-W5)", () => {
  test("a column inserted inside a merged header widens it; the saved header spans three grid columns", async ({ page }) => {
    const errors = trackErrors(page);
    await openWrite(page);
    await insertTable(page, 2, 3);
    await fillCells(page, ["H1", "H2", "H3", "a", "b", "c"]);
    // Select the first two header cells and merge them.
    const cells = editor(page).locator("td");
    await cells.nth(0).click();
    await cells.nth(1).click({ modifiers: ["Shift"] });
    await page.getByRole("tab", { name: "Table Layout" }).click();
    await page.getByRole("button", { name: "Merge Cells" }).click();
    await expect(editor(page).locator("tr").first().locator("td").first()).toHaveAttribute("colspan", "2");
    // Caret in "a" (below the merged header), Insert Right: the new column is inside the header's span.
    await editor(page).locator("td", { hasText: /^a$/ }).click();
    await page.getByRole("button", { name: "Insert right" }).click();
    await expect(editor(page).locator("tr").first().locator("td").first()).toHaveAttribute("colspan", "3");
    await expect(editor(page).locator("tr").nth(1).locator("td")).toHaveCount(4);
    await page.screenshot({ path: `${SHOTS}/P9-W5-merged-header-column.png` });
    const xml = zipText(await saveViaBackstage(page), "word/document.xml");
    expect(xml).toContain('<w:gridSpan w:val="3"/>');
    expect((xml.match(/<w:gridCol /g) ?? []).length).toBe(4);
    errors.expectNone();
  });

  test("a table style's header row is bold in the cell paragraphs (tblStylePr over Normal)", async ({ page }) => {
    const errors = trackErrors(page);
    await openWrite(page);
    await insertTable(page, 2, 2);
    await fillCells(page, ["Head", "Line", "a", "b"]);
    await page.getByRole("tab", { name: "Table Design" }).click();
    await page.getByRole("button", { name: "Grid Table 4 Accent 1" }).first().click();
    const head = editor(page).locator("td").first().locator("p");
    await expect.poll(() => head.evaluate((p) => getComputedStyle(p).fontWeight)).toBe("700");
    expect(await editor(page).locator("td").nth(3).locator("p").evaluate((p) => getComputedStyle(p).fontWeight)).not.toBe("700");
    errors.expectNone();
  });

  test("Border Painter: a click on a cell's bottom edge saves that edge as a cell border", async ({ page }) => {
    const errors = trackErrors(page);
    await openWrite(page);
    await insertTable(page, 2, 2);
    await fillCells(page, ["one", "two", "three", "four"]);
    await page.getByRole("tab", { name: "Table Design" }).click();
    await page.getByLabel("Line Style").selectOption("double");
    await page.getByLabel("Line Weight").selectOption("15");
    await page.getByRole("button", { name: "Border Painter" }).click();
    await expect(editor(page)).toHaveAttribute("data-border-painter", "");
    const first = editor(page).locator("td").first();
    const box = (await first.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height - 1);
    await page.keyboard.press("Escape");
    await expect(editor(page)).not.toHaveAttribute("data-border-painter", "");
    await page.screenshot({ path: `${SHOTS}/P9-W5-border-painter.png` });
    const xml = zipText(await saveViaBackstage(page), "word/document.xml");
    // The painted cell's bottom and the facing top of the cell below.
    expect(xml).toMatch(/<w:tcBorders><w:bottom w:val="double" w:sz="6"/);
    expect(xml).toMatch(/<w:tcBorders><w:top w:val="double" w:sz="6"/);
    errors.expectNone();
  });

  test("dragging the ruler's left-indent box indents the paragraph; the indent is saved", async ({ page }) => {
    const errors = trackErrors(page);
    await openWrite(page);
    await page.keyboard.type("An indented paragraph that is long enough to wrap onto a second line of the page, so the indent is easy to see.");
    const marker = page.locator("[data-indent-marker='left']");
    const m = (await marker.boundingBox())!;
    const para = editor(page).locator("p").first();
    const before = (await para.boundingBox())!;
    await page.mouse.move(m.x + m.width / 2, m.y + m.height / 2);
    await page.mouse.down();
    // About 2 cm to the right (96 px per inch; the ruler snaps to 0.25 cm).
    await page.mouse.move(m.x + m.width / 2 + 40, m.y + m.height / 2, { steps: 4 });
    await page.mouse.move(m.x + m.width / 2 + 76, m.y + m.height / 2, { steps: 4 });
    // While dragging the paragraph already moves (live preview).
    await expect.poll(async () => (await para.boundingBox())!.x).toBeGreaterThan(before.x + 50);
    await page.mouse.up();
    await expect.poll(async () => (await para.boundingBox())!.x).toBeGreaterThan(before.x + 50);
    await page.screenshot({ path: `${SHOTS}/P9-W5-ruler-indent.png` });
    const xml = zipText(await saveViaBackstage(page), "word/document.xml");
    const left = Number(/<w:ind w:left="(\d+)"/.exec(xml)?.[1] ?? "0");
    expect(left).toBeGreaterThan(1000);
    expect(left).toBeLessThan(1300);
    errors.expectNone();
  });

  test("two unequal columns are laid out at their own widths and saved with w:col widths", async ({ page }) => {
    const errors = trackErrors(page);
    await openWrite(page);
    const words = "Unequal columns: a narrow one on the left and a wide one on the right, as Word's Left preset. ";
    for (let i = 0; i < 6; i++) {
      await page.keyboard.type(words.repeat(2).trim());
      if (i < 5) await page.keyboard.press("Enter");
    }
    await page.getByRole("tab", { name: "Layout" }).click();
    await page.getByRole("button", { name: "Columns" }).click();
    await page.getByRole("menuitemradio", { name: "Left" }).click();
    const box = editor(page).locator(".section-columns");
    await expect(box).toHaveAttribute("data-unequal", "");
    const paras = box.locator("p");
    // Every paragraph is laid out for its column; the last one sits in the wide right column.
    await expect.poll(() => paras.last().getAttribute("data-ucol")).toBe("1");
    await expect.poll(() => paras.first().getAttribute("data-ucol")).toBe("0");
    const b = (await box.boundingBox())!;
    const first = (await paras.first().boundingBox())!;
    const last = (await paras.last().boundingBox())!;
    // Narrow left column (about a third of the text width), wide right one starting after it.
    expect(first.width).toBeLessThan(b.width * 0.42);
    expect(last.width).toBeGreaterThan(b.width * 0.5);
    expect(last.x).toBeGreaterThan(first.x + first.width);
    expect(last.x + last.width).toBeLessThanOrEqual(b.x + b.width + 2);
    await page.screenshot({ path: `${SHOTS}/P9-W5-unequal-columns.png` });
    const xml = zipText(await saveViaBackstage(page), "word/document.xml");
    expect(xml).toMatch(/<w:cols w:num="2"[^>]*w:equalWidth="0"[^>]*>(<w:col w:w="\d+"[^>]*\/>){2}<\/w:cols>/);
    errors.expectNone();
  });

  test("Insert › Symbol © and Ctrl+Shift+Space save the characters; Ctrl+Shift+Enter splits a table", async ({ page }) => {
    const errors = trackErrors(page);
    await openWrite(page);
    await page.keyboard.type("Copyright");
    await page.keyboard.press("Control+Shift+Space");
    await page.getByRole("tab", { name: "Insert" }).click();
    await page.getByRole("button", { name: "Symbol" }).click();
    await page.getByRole("button", { name: "More Symbols…" }).click();
    const dialog = page.getByTestId("symbol-dialog");
    await dialog.getByLabel("Search by name").fill("copyright");
    await dialog.getByRole("button", { name: "copyright sign" }).click();
    await expect(dialog.getByTestId("symbol-shortcut")).toContainText("Alt+Ctrl+C");
    await dialog.getByTestId("symbol-insert").click();
    await dialog.getByRole("button", { name: "Close" }).click();
    await editor(page).press("End");
    await page.keyboard.type(" 2026");
    await page.keyboard.press("Control+Alt+t");
    await expect(editor(page).locator("p").first()).toHaveText("Copyright © 2026™");
    // A table split above its second row (the paragraph between the two parts is empty).
    await page.keyboard.press("Enter");
    await insertTable(page, 3, 2);
    await fillCells(page, ["r1", "x", "r2", "y", "r3", "z"]);
    await editor(page).locator("td", { hasText: /^r2$/ }).click();
    await page.keyboard.press("Control+Shift+Enter");
    await expect(editor(page).locator("table")).toHaveCount(2);
    await page.screenshot({ path: `${SHOTS}/P9-W5-symbols-split.png` });
    const xml = zipText(await saveViaBackstage(page), "word/document.xml");
    expect(xml).toContain("Copyright © 2026™");
    expect((xml.match(/<w:tbl>/g) ?? []).length).toBe(2);
    errors.expectNone();
  });
});
