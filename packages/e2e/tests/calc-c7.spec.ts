// P9-C7 (cycle 3.141): cells, panes, comments and pictures round 2 – text overflow stops at a non-empty cell and a
// date that does not fit shows ####; Freeze Panes while scrolled keeps the position after save and reopen
// (topLeftCell); the Comments pane lists the comments of two sheets and resolves one (saved done="1"); dragging a
// page break in Page Break Preview saves rowBreaks and the print preview follows; a picture set to "Don't move or
// size with cells" stays where it is when rows are inserted above it.
import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { openPrint, openViaBackstage, saveViaBackstage, trackErrors } from "../support/common";
import { Grid, openCalc } from "../support/calc";
import { zipText } from "../support/zip";

/**
 * Fills a block of cells from (row, col) with one paste of tab-separated text (much faster than typing each cell;
 * entries are taken as typed text, without Excel's typed-format recognition), then waits for the grid (P9-C7).
 */
async function pasteRows(grid: Grid, row: number, col: number, rows: string[][]) {
  await grid.click(row, col);
  const tsv = rows.map((r) => r.join("\t")).join("\n");
  await grid.page.getByTestId("grid").evaluate((el, text) => {
    const data = new DataTransfer();
    data.setData("text/plain", text);
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, tsv);
  await grid.waitIdle();
}

const shot = async (page: Page, name: string) => {
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/P9-C7-${name}.png` });
};

interface TextHook { row: number; col: number; text: string; clipX: number; clipW: number; rotation: number }
interface PictureHook { id: number; rect: { x: number; y: number; w: number; h: number }; editAs: string | null }
const texts = (page: Page) => page.evaluate(() => (window as unknown as { __calcTexts?: TextHook[] }).__calcTexts ?? []);
const textAt = async (page: Page, row: number, col: number) => (await texts(page)).find((t) => t.row === row && t.col === col);
const pictures = (page: Page) => page.evaluate(() => (window as unknown as { __calcPictures?: PictureHook[] }).__calcPictures ?? []);

/** A 2 × 2 red PNG. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==",
  "base64",
);

test.describe("Calc cells, panes, comments and pictures round 2 (P9-C7)", () => {
  test("text overflows into empty cells up to a filled one; a date that does not fit shows ####", async ({ page }) => {
    const errors = trackErrors(page);
    await openCalc(page);
    const grid = new Grid(page);
    await grid.type(0, 0, "A rather long piece of text that overflows");
    await grid.type(0, 2, "stop");
    await grid.type(2, 1, "12/31/2024");
    // B narrower than the date (Home › Format › Column Width…).
    await grid.click(2, 1);
    await page.getByRole("tab", { name: "Home" }).click();
    await page.getByRole("button", { name: "Format", exact: true }).click();
    await page.getByRole("menuitem", { name: /^Column width/i }).click();
    const dlg = page.getByRole("dialog", { name: /^Column width/i });
    await dlg.getByRole("textbox").fill("4");
    await dlg.getByRole("button", { name: "OK" }).click();
    await grid.waitIdle();
    // A1 runs over the empty B1 and stops at C1 (two columns, the second narrower now).
    await expect.poll(async () => (await textAt(page, 0, 0))?.clipW ?? 0).toBeGreaterThan(64);
    const a1 = (await textAt(page, 0, 0))!;
    const c1x = (await textAt(page, 0, 2))!.clipX;
    expect(a1.clipX + a1.clipW).toBe(c1x);
    await expect.poll(async () => (await textAt(page, 2, 1))?.text ?? "").toMatch(/^#+$/);
    await shot(page, "overflow-hashes");
    errors.expectNone();
  });

  test("Freeze Panes while scrolled keeps the scroll position after save and reopen (topLeftCell)", async ({ page }, info) => {
    const errors = trackErrors(page);
    await openCalc(page);
    const grid = new Grid(page);
    await pasteRows(grid, 0, 0, Array.from({ length: 60 }, (_, i) => [`row ${i + 1}`, String(i + 1)]));
    // Scrolled to row 20; the active cell five rows further down (A25).
    await page.getByTestId("grid").evaluate((el) => {
      el.scrollTop = 19 * 20;
    });
    await grid.click(5, 0);
    await expect(page.getByTestId("cell-address")).toHaveValue("A25");
    await page.getByRole("tab", { name: "View", exact: true }).click();
    await page.getByRole("button", { name: "Freeze Panes" }).click();
    await page.getByRole("menuitem", { name: "Freeze Panes" }).click();
    const cells = page.getByTestId("grid-cells");
    await expect(cells).toHaveAttribute("data-frozen", "5,0");
    await expect(cells).toHaveAttribute("data-top-left", "19,0");
    // The frozen band starts at row 20.
    await grid.click(0, 0);
    await expect(page.getByTestId("cell-address")).toHaveValue("A20");
    await shot(page, "frozen-scrolled");
    const xlsx = await saveViaBackstage(page);
    const sheet = zipText(xlsx, "xl/worksheets/sheet1.xml");
    expect(sheet).toMatch(/<sheetView [^>]*topLeftCell="A20"/);
    expect(sheet).toContain('<pane ySplit="5" topLeftCell="A25" activePane="bottomLeft" state="frozen"/>');
    const file = info.outputPath("frozen.xlsx");
    fs.writeFileSync(file, xlsx);
    await page.reload();
    await openCalc(page);
    await openViaBackstage(page, file);
    await expect(cells).toHaveAttribute("data-frozen", "5,0");
    await expect(cells).toHaveAttribute("data-top-left", "19,0");
    await grid.click(0, 0);
    await expect(page.getByTestId("cell-address")).toHaveValue("A20");
    await grid.click(5, 0);
    await expect(page.getByTestId("cell-address")).toHaveValue("A25");
    errors.expectNone();
  });

  test("the Comments pane lists the comments of two sheets and resolves one (saved done=\"1\")", async ({ page }) => {
    const errors = trackErrors(page);
    await openCalc(page);
    const grid = new Grid(page);
    const comment = async (row: number, col: number, text: string) => {
      await grid.click(row, col);
      await page.getByRole("tab", { name: "Review" }).click();
      await page.getByRole("button", { name: "New Comment" }).click();
      const user = page.getByTestId("user-dialog");
      if (await user.isVisible().catch(() => false)) {
        await user.getByLabel("Name").fill("Ann Lee");
        await user.getByRole("button", { name: "OK" }).click();
      }
      const composer = page.getByTestId("comment-composer");
      await composer.getByLabel("Comment").fill(text);
      await composer.getByRole("button", { name: "Post" }).click();
      await expect(page.getByTestId("thread-card")).toContainText(text);
      await page.keyboard.press("Escape");
    };
    await comment(0, 0, "Check the first sheet");
    await page.getByRole("button", { name: "Add sheet" }).click();
    await expect(page.getByRole("tab", { name: "Sheet2", exact: true })).toHaveAttribute("aria-selected", "true");
    await comment(1, 1, "And the second one");
    await page.getByRole("tab", { name: "Review" }).click();
    await page.getByRole("button", { name: "Show Comments" }).click();
    const pane = page.getByTestId("comments-pane");
    await expect(pane.getByTestId("comments-sheet")).toHaveCount(2);
    await expect(pane.getByTestId("comments-sheet").nth(0)).toHaveAttribute("data-sheet", "Sheet1");
    // A card goes to its cell on its sheet; Resolve from the pane.
    const first = pane.getByTestId("comments-sheet").nth(0);
    await first.getByTestId("thread").click({ position: { x: 5, y: 5 } });
    await expect(page.getByRole("tab", { name: "Sheet1", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("cell-address")).toHaveValue("A1");
    await first.getByRole("button", { name: "Resolve" }).click();
    await expect(first.getByRole("button", { name: "Reopen" })).toBeVisible();
    await shot(page, "comments-pane");
    const xlsx = await saveViaBackstage(page);
    expect(zipText(xlsx, "xl/threadedComments/threadedComment1.xml")).toContain('done="1"');
    expect(zipText(xlsx, "xl/threadedComments/threadedComment2.xml")).not.toContain('done="1"');
    errors.expectNone();
  });

  test("dragging a page break in Page Break Preview saves rowBreaks and the print preview follows", async ({ page }) => {
    const errors = trackErrors(page);
    await openCalc(page);
    const grid = new Grid(page);
    await pasteRows(grid, 0, 0, Array.from({ length: 30 }, (_, i) => [`line ${i + 1}`]));
    // A manual break above row 11 (Page Layout › Breaks › Insert Page Break).
    await grid.click(10, 0);
    await page.getByRole("tab", { name: "Page Layout" }).click();
    await page.getByRole("button", { name: "Breaks" }).click();
    await page.getByRole("menuitem", { name: "Insert Page Break" }).click();
    await grid.waitIdle();
    await page.getByRole("tab", { name: "View", exact: true }).click();
    await page.getByRole("button", { name: "Page Break Preview" }).click();
    // Drag the solid line at the top of row 11 down to the top of row 21.
    const box = (await page.getByTestId("grid").boundingBox())!;
    const lineY = box.y + 22 + 10 * 20;
    await page.mouse.move(box.x + 46 + 30, lineY);
    await page.mouse.down();
    await page.mouse.move(box.x + 46 + 30, lineY + 100, { steps: 5 });
    await page.mouse.move(box.x + 46 + 30, box.y + 22 + 20 * 20 + 5, { steps: 5 });
    await page.mouse.up();
    await grid.waitIdle();
    await shot(page, "break-preview");
    const xlsx = await saveViaBackstage(page);
    expect(zipText(xlsx, "xl/worksheets/sheet1.xml")).toContain('<rowBreaks count="1" manualBreakCount="1"><brk id="20" max="16383" man="1"/></rowBreaks>');
    // (The print preview's sandboxed frame logs a blocked-script message of its own.)
    errors.expectNone();
    await page.keyboard.press("Escape");
    await openPrint(page);
    // 30 lines with a break above line 21: two pages.
    await expect(page.getByTestId("print-page-count")).toHaveText("Page 1 of 2");
  });

  test("a picture set to \"Don't move or size with cells\" stays where it is when rows are inserted above it", async ({ page }) => {
    const errors = trackErrors(page);
    await openCalc(page);
    const grid = new Grid(page);
    await grid.click(4, 2);
    await page.getByRole("tab", { name: "Insert" }).click();
    await page.getByTestId("picture-input").setInputFiles({ name: "red.png", mimeType: "image/png", buffer: PNG });
    await expect.poll(async () => (await pictures(page)).length).toBe(1);
    const before = (await pictures(page))[0]!.rect;
    // Inserting a picture shows Picture Format.
    await expect(page.getByRole("tab", { name: "Picture Format" })).toHaveAttribute("aria-selected", "true");
    await page.getByRole("button", { name: "Properties" }).click();
    await page.getByRole("menuitemradio", { name: "Don't move or size with cells" }).click();
    await expect.poll(async () => (await pictures(page))[0]?.editAs).toBe("fixed");
    // Insert two rows above it.
    await page.keyboard.press("Escape");
    await grid.click(0, 0);
    await grid.click(1, 0, { shift: true });
    await page.getByRole("tab", { name: "Home" }).click();
    await page.getByRole("button", { name: "Insert", exact: true }).click();
    await page.getByRole("menuitem", { name: "Insert Sheet Rows" }).click();
    await grid.waitIdle();
    await expect.poll(async () => (await pictures(page))[0]?.rect.y).toBe(before.y);
    expect((await pictures(page))[0]!.rect.x).toBe(before.x);
    await shot(page, "picture-fixed");
    const xlsx = await saveViaBackstage(page);
    const drawing = zipText(xlsx, "xl/drawings/drawing1.xml");
    expect(drawing).toContain('<xdr:twoCellAnchor editAs="absolute">');
    // Still at row 5 (index 4) after two rows were inserted above.
    expect(drawing).toMatch(/<xdr:from><xdr:col>2<\/xdr:col><xdr:colOff>0<\/xdr:colOff><xdr:row>4<\/xdr:row>/);
    // Ctrl+V with an image on the clipboard inserts it as a picture at the active cell.
    await page.keyboard.press("Escape");
    await grid.click(12, 0);
    await page.getByTestId("grid").evaluate((el, b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const data = new DataTransfer();
      data.items.add(new File([bytes], "shot.png", { type: "image/png" }));
      el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    }, PNG.toString("base64"));
    await expect.poll(async () => (await pictures(page)).length).toBe(2);
    errors.expectNone();
  });
});
