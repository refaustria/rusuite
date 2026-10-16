import { expect, test } from "@playwright/test";
import { downloadBuffer, fileCommand, interceptPrint, openPrint, openViaBackstage, previewPages, previewPdf, printCount, saveViaBackstage, testdata, trackErrors } from "../support/common";
import { Grid, openCalc } from "../support/calc";
import { zipText } from "../support/zip";

/** Name / Qty table in A1:B4: pear 3, apple 1, fig 2. */
async function typeTable(grid: Grid) {
  const rows = [["Name", "Qty"], ["pear", "3"], ["apple", "1"], ["fig", "2"]];
  for (const [r, row] of rows.entries()) for (const [c, v] of row.entries()) await grid.type(r, c, v);
}

/** Clicks the AutoFilter dropdown button of header cell (0, col) (right edge of the cell) and waits for its value list. */
async function openFilterPanel(page: import("@playwright/test").Page, grid: Grid, col: number) {
  const q = await grid.pos(0, col, 64 / 2 - 9, 1);
  await page.mouse.click(q.x, q.y);
  const panel = page.getByTestId("filter-panel");
  await expect(panel.getByTestId("filter-value").first()).toBeVisible();
  return panel;
}

/** Pixels of the cell canvas along the edges of cells (cell-area px): which of them have the colour `rgb` (±40). */
async function edgePixels(page: import("@playwright/test").Page, points: [number, number][], rgb: [number, number, number]) {
  return page.getByTestId("grid-cells").evaluate((el, { points, rgb }) => {
    const canvas = el as HTMLCanvasElement;
    const ctx = canvas.getContext("2d")!;
    const scale = canvas.width / canvas.clientWidth;
    return points.filter(([x, y]) => {
      const d = ctx.getImageData(Math.floor(x * scale), Math.floor(y * scale), 1, 1).data;
      return Math.abs(d[0] - rgb[0]) < 40 && Math.abs(d[1] - rgb[1]) < 40 && Math.abs(d[2] - rgb[2]) < 40;
    }).length;
  }, { points, rgb });
}

/** Points on the left edge of A1:A3 (x 0, rows 1–3, 64×20 px cells). */
const leftEdgeA1A3 = (): [number, number][] => Array.from({ length: 30 }, (_, i) => [0, 2 + i * 2] as [number, number]);
const SPILL_BLUE: [number, number, number] = [0x2a, 0x62, 0xd6];
const SPILL_RED: [number, number, number] = [0xd8, 0x35, 0x2a];

async function previewPagesAfterReopen(page: import("@playwright/test").Page) {
  await openPrint(page);
  return previewPages(page);
}

test.describe("Calc", () => {
  test("typing a formula evaluates it", async ({ page }) => {
    const errors = trackErrors(page);
    await openCalc(page);
    const grid = new Grid(page);
    await grid.type(0, 0, "=SUM(1,2,3)*2");
    expect(await grid.input(0, 0)).toBe("=SUM(1,2,3)*2");
    expect(await grid.display(0, 0)).toBe("12");
    await expect(page.getByTestId("status-bar")).toContainText("Modified");
    errors.expectNone();
  });

  test("point mode: dragging over A1:A3 inserts the range", async ({ page }) => {
    await openCalc(page);
    const grid = new Grid(page);
    for (const [i, v] of ["1", "2", "3"].entries()) await grid.type(i, 0, v);
    await grid.click(0, 2);
    await page.keyboard.type("=SUM(");
    const from = await grid.pos(0, 0);
    const to = await grid.pos(2, 0);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x, (from.y + to.y) / 2, { steps: 3 });
    await page.mouse.move(to.x, to.y, { steps: 3 });
    await page.mouse.up();
    await expect(page.getByTestId("cell-editor")).toHaveValue("=SUM(A1:A3");
    await page.keyboard.type(")");
    await expect(page.getByTestId("cell-editor")).toHaveValue("=SUM(A1:A3)");
    await page.keyboard.press("Enter");
    expect(await grid.input(0, 2)).toBe("=SUM(A1:A3)");
    expect(await grid.display(0, 2)).toBe("6");
  });

  test("an incomplete formula is not committed: text kept, inline error shown", async ({ page }) => {
    await openCalc(page);
    const grid = new Grid(page);
    await grid.click(0, 3);
    await page.keyboard.type("=A1+");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("formula-error")).toBeVisible();
    await expect(page.getByTestId("cell-editor")).toHaveValue("=A1+");
    // Esc discards it.
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("cell-editor")).toHaveCount(0);
    expect(await grid.input(0, 3)).toBe("");
  });

  test("open an xlsx, edit a cell, save, and the download contains the edit", async ({ page }) => {
    const errors = trackErrors(page);
    await openCalc(page);
    await openViaBackstage(page, testdata("xlsx/provisional-basic.xlsx"));
    const sheets = page.getByRole("tablist", { name: "Sheets" });
    await expect(sheets.getByRole("tab", { name: "Data" })).toBeVisible();
    await expect(sheets.getByRole("tab", { name: "Summary" })).toBeVisible();
    const grid = new Grid(page);
    await grid.type(1, 1, "99");
    await expect(page.getByTestId("status-bar")).toContainText("Modified");
    const xlsx = await saveViaBackstage(page);
    const sheet1 = zipText(xlsx, "xl/worksheets/sheet1.xml");
    expect(sheet1).toMatch(/<c r="B2"[^>]*><v>99<\/v>/);
    expect(zipText(xlsx, "xl/workbook.xml")).toContain('name="Summary"');
    await expect(page.getByTestId("status-bar")).toContainText("Saved");
    errors.expectNone();
  });

  test("Ctrl+D fills the selection down from its first row, Ctrl+R right from its first column", async ({ page }) => {
    const errors = trackErrors(page);
    await openCalc(page);
    const grid = new Grid(page);
    await grid.type(0, 0, "5");
    await grid.type(0, 1, "=A1*2");
    await grid.click(0, 0);
    await grid.click(3, 1, { shift: true });
    await expect(page.getByTestId("cell-address")).toHaveValue("A1:B4");
    await page.keyboard.press("Control+d");
    expect(await grid.input(3, 1)).toBe("=A4*2");
    expect(await grid.display(3, 1)).toBe("10");
    expect(await grid.input(3, 0)).toBe("5");
    await grid.click(0, 1);
    await grid.click(0, 2, { shift: true });
    await page.keyboard.press("Control+r");
    expect(await grid.input(0, 2)).toBe("=B1*2");
    expect(await grid.display(0, 2)).toBe("20");
    errors.expectNone();
  });

  test("cut and paste: formulas referring to the moved cells follow them", async ({ page }) => {
    await openCalc(page);
    const grid = new Grid(page);
    await grid.type(0, 0, "7");
    await grid.type(0, 2, "=A1+1");
    await grid.click(0, 0);
    await page.keyboard.press("Control+x");
    await grid.click(4, 4);
    await page.keyboard.press("Control+v");
    expect(await grid.input(4, 4)).toBe("7");
    expect(await grid.input(0, 2)).toBe("=E5+1");
    expect(await grid.display(0, 2)).toBe("8");
  });

  test("switching sheets shows the other sheet's cells", async ({ page }) => {
    await openCalc(page);
    await openViaBackstage(page, testdata("xlsx/provisional-basic.xlsx"));
    const grid = new Grid(page);
    const dataA1 = await grid.input(0, 0);
    await page.getByRole("tablist", { name: "Sheets" }).getByRole("tab", { name: "Summary" }).click();
    await expect(page.getByRole("tab", { name: "Summary" })).toHaveAttribute("aria-selected", "true");
    expect(await grid.input(0, 0)).not.toBe(dataA1);
  });

  test("fill handle continues the series 1, 2", async ({ page }) => {
    await openCalc(page);
    const grid = new Grid(page);
    await grid.type(0, 0, "1");
    await grid.type(1, 0, "2");
    await grid.click(0, 0);
    await grid.click(1, 0, { shift: true });
    const box = (await page.getByTestId("grid").boundingBox())!;
    // Bottom-right corner of A1:A2.
    const hx = box.x + 46 + 64 - 1;
    const hy = box.y + 22 + 20 * 2 - 1;
    await page.mouse.move(hx, hy);
    await page.mouse.down();
    const end = await grid.pos(5, 0);
    await page.mouse.move(hx, hy + 30, { steps: 4 });
    await page.mouse.move(end.x, end.y, { steps: 6 });
    await page.mouse.up();
    await expect.poll(() => grid.display(5, 0)).toBe("6");
    expect(await grid.display(2, 0)).toBe("3");
    expect(await grid.display(4, 0)).toBe("5");
  });

  test("Ctrl+1 opens Format cells and applies the 0.00 number format", async ({ page }) => {
    await openCalc(page);
    const grid = new Grid(page);
    await grid.type(0, 0, "3.14159");
    await grid.click(0, 0);
    await page.keyboard.press("Control+1");
    const dlg = page.getByRole("dialog", { name: "Format cells" });
    await dlg.getByRole("option", { name: "Number" }).click();
    await expect(page.getByTestId("format-preview")).toContainText("3.14");
    await dlg.getByRole("button", { name: "OK" }).click();
    await expect(dlg).toHaveCount(0);
    // The value is untouched, the saved workbook carries the format.
    expect(await grid.input(0, 0)).toBe("3.14159");
    const xlsx = await saveViaBackstage(page);
    expect(zipText(xlsx, "xl/styles.xml")).toMatch(/<xf numFmtId="2"[^>]*applyNumberFormat="1"/);
    expect(zipText(xlsx, "xl/worksheets/sheet1.xml")).toMatch(/<c r="A1" s="[1-9]\d*"[^>]*><v>3\.14159<\/v>/);
  });

  test("find and replace over the sheet", async ({ page }) => {
    await openCalc(page);
    const grid = new Grid(page);
    await grid.type(0, 7, "apple");
    await grid.type(1, 7, "apple pie");
    await grid.type(2, 7, "banana");
    await grid.click(0, 0);
    await page.keyboard.press("Control+f");
    const find = page.getByRole("dialog", { name: "Find" });
    await find.getByLabel("Find what").fill("pie");
    await find.getByLabel("Find what").press("Enter");
    await expect(page.getByTestId("cell-address")).toHaveValue("H2");
    await find.getByRole("button", { name: "Replace…" }).click();
    const rep = page.getByRole("dialog", { name: "Find and replace" });
    await rep.getByLabel("Find what").fill("apple");
    await rep.getByLabel("Replace with").fill("pear");
    await rep.getByRole("button", { name: "Replace all" }).click();
    await expect(rep.getByRole("status")).toContainText("2");
    await rep.getByRole("button", { name: "Close" }).click();
    expect(await grid.input(0, 7)).toBe("pear");
    expect(await grid.input(1, 7)).toBe("pear pie");
    expect(await grid.input(2, 7)).toBe("banana");
  });

  test("ribbon tabs switch by click and by keyboard (Alt, arrows, Enter)", async ({ page }) => {
    await openCalc(page);
    const tabs = page.getByLabel("Ribbon tabs");
    await expect(tabs.getByRole("tab", { name: "Home" })).toHaveAttribute("aria-selected", "true");
    await tabs.getByRole("tab", { name: "View", exact: true }).click();
    await expect(tabs.getByRole("tab", { name: "View", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("combobox", { name: "Zoom" })).toBeVisible();
    await tabs.getByRole("tab", { name: "Home" }).click();
    await page.getByTestId("grid").focus();
    await page.keyboard.press("Alt");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    await expect(tabs.getByRole("tab", { name: "Insert" })).toHaveAttribute("aria-selected", "true");
    // Ctrl+F1 collapses the ribbon to the tab strip and back.
    const panel = page.getByTestId("ribbon");
    const full = (await panel.boundingBox())!.height;
    await page.keyboard.press("Control+F1");
    await expect.poll(async () => (await panel.boundingBox())!.height).toBeLessThan(full - 40);
    await page.keyboard.press("Control+F1");
    await expect.poll(async () => (await panel.boundingBox())!.height).toBeGreaterThan(full - 5);
  });

  test("backstage: keyboard navigation and Esc returns to the sheet", async ({ page }) => {
    await openCalc(page);
    await page.keyboard.press("Alt");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Enter");
    const backstage = page.getByTestId("backstage");
    await expect(backstage).toBeVisible();
    await expect(backstage.getByRole("button", { name: /^Open/ })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(backstage).toHaveCount(0);
    await expect(page.getByTestId("grid")).toBeVisible();
  });

  test("File › Print: 120 rows preview as 3 pages, a page range, Print and Export PDF call window.print", async ({ page }) => {
    await interceptPrint(page);
    await openCalc(page);
    const grid = new Grid(page);
    await grid.click(0, 0);
    for (let i = 1; i <= 120; i++) {
      await page.keyboard.type(`row ${i}`);
      await page.keyboard.press("Enter");
    }
    await expect(page.getByTestId("cell-address")).toHaveValue("A121");
    await page.keyboard.press("Control+p");
    await expect(page.getByTestId("print-panel")).toBeVisible();
    await expect(page.getByTestId("print-page-count")).toHaveText("Page 1 of 3");
    expect(await previewPdf(page, "calc-120-rows")).toBe(3);
    await page.getByLabel("Page range").fill("2-2");
    await expect(page.getByTestId("print-page-count")).toHaveText("Page 1 of 1");
    expect(await previewPdf(page, "calc-page-2")).toBe(1);
    await page.getByRole("radio", { name: "All pages" }).check();
    await page.getByLabel("Scaling").selectOption("fitSheet");
    await expect(page.getByTestId("print-page-count")).toHaveText("Page 1 of 1");
    await page.getByLabel("Scaling").selectOption("actual");
    await expect(page.getByTestId("print-page-count")).toHaveText("Page 1 of 3");
    await page.getByTestId("print-button").click();
    await expect.poll(() => printCount(page)).toBe(1);
    await page.keyboard.press("Escape");
    await fileCommand(page, /^Export PDF/);
    await expect.poll(() => printCount(page)).toBe(2);
    expect(await previewPagesAfterReopen(page)).toBe(3);
  });

  test("deleting a sheet with data asks first; references become #REF! and undo brings it back", async ({ page }) => {
    const errors = trackErrors(page);
    await openCalc(page);
    const grid = new Grid(page);
    const sheets = page.getByRole("tablist", { name: "Sheets" });
    await grid.type(0, 0, "5");
    await page.getByRole("button", { name: "Add sheet" }).click();
    await expect(sheets.getByRole("tab", { name: "Sheet2" })).toHaveAttribute("aria-selected", "true");
    await grid.type(0, 0, "=Sheet1!A1*2");
    await sheets.getByRole("tab", { name: "Sheet1" }).click({ button: "right" });
    await page.getByRole("menu", { name: "Sheet" }).getByRole("menuitem", { name: "Delete sheet" }).click();
    const dialog = page.getByRole("dialog", { name: "Delete sheet" });
    await expect(dialog).toContainText("Sheet1");
    await dialog.getByRole("button", { name: "Delete" }).click();
    await expect(sheets.getByRole("tab")).toHaveCount(1);
    await expect(sheets.getByRole("tab", { name: "Sheet2" })).toHaveAttribute("aria-selected", "true");
    expect(await grid.input(0, 0)).toBe("=#REF!*2");
    await page.keyboard.press("Control+z");
    await expect(sheets.getByRole("tab")).toHaveText(["Sheet1", "Sheet2"]);
    expect(await grid.input(0, 0)).toBe("=Sheet1!A1*2");
    expect(await grid.display(0, 0)).toBe("10");
    errors.expectNone();
  });

  test("duplicating a sheet keeps its formulas", async ({ page }) => {
    const errors = trackErrors(page);
    await openCalc(page);
    const grid = new Grid(page);
    const sheets = page.getByRole("tablist", { name: "Sheets" });
    await grid.type(0, 0, "3");
    await grid.type(1, 0, "=A1*2");
    await sheets.getByRole("tab", { name: "Sheet1" }).click({ button: "right" });
    await page.getByRole("menu", { name: "Sheet" }).getByRole("menuitem", { name: "Duplicate" }).click();
    await expect(sheets.getByRole("tab")).toHaveText(["Sheet1", "Sheet1 (2)"]);
    await expect(sheets.getByRole("tab", { name: "Sheet1 (2)" })).toHaveAttribute("aria-selected", "true");
    expect(await grid.input(1, 0)).toBe("=A1*2");
    await grid.type(0, 0, "10");
    expect(await grid.display(1, 0)).toBe("20");
    await sheets.getByRole("tab", { name: "Sheet1", exact: true }).click();
    expect(await grid.display(1, 0)).toBe("6");
    errors.expectNone();
  });

  test("Freeze Top Row keeps row 1 in place while the rest scrolls", async ({ page }) => {
    const errors = trackErrors(page);
    await openCalc(page);
    const grid = new Grid(page);
    await grid.type(0, 0, "Header");
    await grid.type(0, 1, "Amount");
    await page.getByRole("tab", { name: "View", exact: true }).click();
    await page.getByRole("button", { name: "Freeze Panes" }).click();
    await page.getByRole("menuitem", { name: "Freeze Top Row" }).click();
    await expect(page.getByTestId("grid-cells")).toHaveAttribute("data-frozen", "1,0");
    await page.getByTestId("grid").evaluate((el) => {
      el.scrollTop = 1000;
    });
    // The frozen row is still where it was; just below it the sheet continues at row 52 (1000 px / 20 px + 2).
    await grid.click(0, 0);
    await expect(page.getByTestId("cell-address")).toHaveValue("A1");
    await expect(page.getByRole("textbox", { name: "Formula bar" })).toHaveValue("Header");
    await grid.click(1, 0);
    await expect(page.getByTestId("cell-address")).toHaveValue("A52");
    if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/calc-frozen-scrolled.png` });
    errors.expectNone();
  });

  test("Merge & Center, then typing edits the merged cell; the saved file has the merge", async ({ page }) => {
    const errors = trackErrors(page);
    await openCalc(page);
    const grid = new Grid(page);
    await grid.click(0, 0);
    await grid.click(0, 2, { shift: true });
    await page.getByRole("tab", { name: "Home" }).click();
    await page.getByRole("button", { name: "Merge & Center" }).click();
    await expect(page.getByTestId("cell-address")).toHaveValue("A1");
    await page.keyboard.type("Quarterly report");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("cell-editor")).toHaveCount(0);
    // A covered cell selects the merge, whose content is A1's.
    await grid.click(0, 2);
    await expect(page.getByTestId("cell-address")).toHaveValue("A1");
    await expect(page.getByRole("textbox", { name: "Formula bar" })).toHaveValue("Quarterly report");
    await grid.type(1, 0, "1");
    if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/calc-merged-header.png` });
    const xlsx = await saveViaBackstage(page);
    const sheet1 = zipText(xlsx, "xl/worksheets/sheet1.xml");
    expect(sheet1).toContain('<mergeCell ref="A1:C1"/>');
    expect(sheet1).toMatch(/<c r="A1"[^>]*t="(s|inlineStr|str)"/);
    errors.expectNone();
  });

  test("hiding a sheet removes its tab; Unhide… brings it back", async ({ page }) => {
    const errors = trackErrors(page);
    await openCalc(page);
    const sheets = page.getByRole("tablist", { name: "Sheets" });
    await page.getByRole("button", { name: "Add sheet" }).click();
    await expect(sheets.getByRole("tab", { name: "Sheet2" })).toHaveAttribute("aria-selected", "true");
    await sheets.getByRole("tab", { name: "Sheet2" }).click({ button: "right" });
    await page.getByRole("menu", { name: "Sheet" }).getByRole("menuitem", { name: "Hide", exact: true }).click();
    await expect(sheets.getByRole("tab")).toHaveText(["Sheet1"]);
    await expect(sheets.getByRole("tab", { name: "Sheet1" })).toHaveAttribute("aria-selected", "true");
    const hidden = await saveViaBackstage(page);
    expect(zipText(hidden, "xl/workbook.xml")).toMatch(/<sheet name="Sheet2"[^>]*state="hidden"/);
    await sheets.getByRole("tab", { name: "Sheet1" }).click({ button: "right" });
    await page.getByRole("menu", { name: "Sheet" }).getByRole("menuitem", { name: "Unhide…" }).click();
    const dialog = page.getByRole("dialog", { name: "Unhide" });
    await dialog.getByRole("option", { name: "Sheet2" }).click();
    await dialog.getByRole("button", { name: "OK" }).click();
    await expect(sheets.getByRole("tab")).toHaveText(["Sheet1", "Sheet2"]);
    await expect(sheets.getByRole("tab", { name: "Sheet2" })).toHaveAttribute("aria-selected", "true");
    errors.expectNone();
  });

  test("Data › Sort A to Z reorders the rows under the header; the saved file has sortState", async ({ page }) => {
    const errors = trackErrors(page);
    await openCalc(page);
    const grid = new Grid(page);
    await typeTable(grid);
    await grid.click(2, 0);
    await page.getByRole("tab", { name: "Data" }).click();
    await page.getByRole("button", { name: "Sort A to Z" }).click();
    await expect.poll(() => grid.input(1, 0)).toBe("apple");
    expect(await grid.input(0, 0)).toBe("Name");
    expect(await grid.input(2, 0)).toBe("fig");
    expect(await grid.input(3, 0)).toBe("pear");
    expect(await grid.input(3, 1)).toBe("3");
    const xlsx = await saveViaBackstage(page);
    expect(zipText(xlsx, "xl/worksheets/sheet1.xml")).toMatch(/<sortState [^>]*ref="A2:B4"/);
    errors.expectNone();
  });

  test("AutoFilter: unchecking a value hides its rows; the saved file has autoFilter and hidden rows", async ({ page }) => {
    const errors = trackErrors(page);
    await openCalc(page);
    const grid = new Grid(page);
    await typeTable(grid);
    await grid.click(0, 0);
    await page.keyboard.press("Control+Shift+L");
    const panel = await openFilterPanel(page, grid, 1);
    await expect(panel.getByTestId("filter-value")).toHaveText(["11", "21", "31"]);
    await panel.getByRole("checkbox", { name: "3", exact: true }).uncheck();
    if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/calc-filter-panel.png` });
    await panel.getByRole("button", { name: "OK" }).click();
    await expect(page.getByTestId("filter-records")).toHaveText("2 of 3 records found");
    // Row 2 (pear) is hidden: the second visible row is apple.
    expect(await grid.input(1, 0)).toBe("apple");
    const xlsx = await saveViaBackstage(page);
    const sheet1 = zipText(xlsx, "xl/worksheets/sheet1.xml");
    expect(sheet1).toMatch(/<autoFilter ref="A1:B4"/);
    expect(sheet1).toMatch(/<row r="2"[^>]*hidden="1"/);
    errors.expectNone();
  });

  test("AutoFilter: Number Filters › Greater Than… keeps the larger values", async ({ page }) => {
    const errors = trackErrors(page);
    await openCalc(page);
    const grid = new Grid(page);
    await typeTable(grid);
    await grid.click(1, 1);
    await page.getByRole("tab", { name: "Data" }).click();
    await page.getByRole("button", { name: "Filter", exact: true }).click();
    const panel = await openFilterPanel(page, grid, 1);
    await panel.getByRole("button", { name: "Number Filters" }).click();
    await panel.getByRole("menuitem", { name: "Greater Than…" }).click();
    const dlg = page.getByRole("dialog", { name: "Custom AutoFilter" });
    await dlg.getByLabel("Value 1").fill("1");
    await dlg.getByRole("button", { name: "OK" }).click();
    await expect(page.getByTestId("filter-records")).toHaveText("2 of 3 records found");
    // apple (1) is hidden: rows pear, fig remain.
    expect(await grid.input(1, 0)).toBe("pear");
    expect(await grid.input(2, 0)).toBe("fig");
    errors.expectNone();
  });

  test("AutoFilter: sorted and filtered, then Clear shows every row again", async ({ page }) => {
    const errors = trackErrors(page);
    await openCalc(page);
    const grid = new Grid(page);
    await typeTable(grid);
    await grid.click(0, 0);
    await page.keyboard.press("Control+Shift+L");
    let panel = await openFilterPanel(page, grid, 1);
    await panel.getByRole("button", { name: "Sort Z to A" }).click();
    await expect.poll(() => grid.input(1, 0)).toBe("pear");
    panel = await openFilterPanel(page, grid, 0);
    await panel.getByRole("checkbox", { name: "fig", exact: true }).uncheck();
    await panel.getByRole("button", { name: "OK" }).click();
    await expect(page.getByTestId("filter-records")).toHaveText("2 of 3 records found");
    expect(await grid.input(2, 0)).toBe("apple");
    await grid.click(0, 3);
    if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/calc-sorted-filtered.png` });
    await page.getByRole("tab", { name: "Data" }).click();
    await page.getByRole("button", { name: "Clear", exact: true }).click();
    await expect(page.getByTestId("filter-records")).toHaveCount(0);
    expect(await grid.input(1, 0)).toBe("pear");
    expect(await grid.input(2, 0)).toBe("fig");
    expect(await grid.input(3, 0)).toBe("apple");
    errors.expectNone();
  });

  test("the zoom is the sheet's: it is saved in the file's sheetView", async ({ page }) => {
    const errors = trackErrors(page);
    await openCalc(page);
    const grid = new Grid(page);
    await grid.type(0, 0, "7");
    await page.getByRole("tab", { name: "View", exact: true }).click();
    await page.getByRole("combobox", { name: "Zoom" }).selectOption("1.5");
    await expect(page.getByTestId("zoom")).toHaveText("150 %");
    const xlsx = await saveViaBackstage(page);
    expect(zipText(xlsx, "xl/worksheets/sheet1.xml")).toMatch(/<sheetView [^>]*zoomScale="150"/);
    errors.expectNone();
  });

  test("dynamic arrays: =SEQUENCE(3) spills 1, 2, 3 with a blue outline; the formula bar shows it greyed", async ({ page }) => {
    const errors = trackErrors(page);
    await openCalc(page);
    const grid = new Grid(page);
    await grid.type(0, 0, "=SEQUENCE(3)");
    expect(await grid.display(0, 0)).toBe("1");
    expect(await grid.display(1, 0)).toBe("2");
    expect(await grid.display(2, 0)).toBe("3");
    expect(await grid.input(2, 0)).toBe("=SEQUENCE(3)");
    await expect(page.getByLabel("Formula bar")).toHaveAttribute("readonly", "");
    await grid.click(1, 0);
    await expect.poll(() => edgePixels(page, leftEdgeA1A3(), SPILL_BLUE)).toBeGreaterThan(20);
    // Outside the spill range: no outline.
    await grid.click(5, 3);
    await expect.poll(() => edgePixels(page, leftEdgeA1A3(), SPILL_BLUE)).toBe(0);
    errors.expectNone();
  });

  test("dynamic arrays: a value in the spill range gives #SPILL! (dashed red outline, indicator); clearing it restores the spill", async ({ page }) => {
    const errors = trackErrors(page);
    await openCalc(page);
    const grid = new Grid(page);
    await grid.type(0, 0, "=SEQUENCE(3)");
    await grid.type(1, 0, "x");
    expect(await grid.display(0, 0)).toBe("#SPILL!");
    await grid.click(0, 0);
    const tag = page.getByRole("button", { name: "Spill error" });
    await expect(tag).toBeVisible();
    await expect(tag).toHaveAttribute("title", "Spill range isn't blank");
    await expect.poll(() => edgePixels(page, leftEdgeA1A3(), SPILL_RED)).toBeGreaterThan(5);
    await tag.click();
    await page.getByRole("menuitem", { name: "Select obstructing cells" }).click();
    await expect(page.getByTestId("cell-address")).toHaveValue("A2");
    await page.keyboard.press("Delete");
    expect(await grid.display(0, 0)).toBe("1");
    expect(await grid.display(1, 0)).toBe("2");
    expect(await grid.display(2, 0)).toBe("3");
    await grid.click(0, 0);
    await expect(page.getByRole("button", { name: "Spill error" })).toHaveCount(0);
    errors.expectNone();
  });

  test("conditional formatting: Greater Than… colours the matching cell; the saved file has the cfRule", async ({ page }) => {
    const errors = trackErrors(page);
    await openCalc(page);
    const grid = new Grid(page);
    await grid.type(0, 0, "3");
    await grid.type(1, 0, "8");
    await grid.click(0, 0);
    await grid.click(1, 0, { shift: true });
    await page.getByRole("tab", { name: "Home" }).click();
    await page.getByRole("button", { name: "Conditional Formatting" }).click();
    await page.getByRole("menuitem", { name: "Highlight Cells Rules" }).click();
    await page.getByRole("menuitem", { name: "Greater Than…" }).click();
    const dlg = page.getByRole("dialog", { name: "Greater Than" });
    await dlg.getByLabel("Value").fill("5");
    await dlg.getByRole("button", { name: "OK" }).click();
    // Light red fill (FFC7CE) in A2 only (left part of the cells: the numbers are right-aligned).
    const LIGHT_RED: [number, number, number] = [0xff, 0xc7, 0xce];
    const a2: [number, number][] = [[6, 26], [10, 30], [20, 34]];
    const a1: [number, number][] = [[6, 6], [10, 10], [20, 14]];
    await expect.poll(() => edgePixels(page, a2, LIGHT_RED)).toBe(3);
    expect(await edgePixels(page, a1, LIGHT_RED)).toBe(0);
    if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/calc-cf-greater-than.png` });
    const xlsx = await saveViaBackstage(page);
    const sheet1 = zipText(xlsx, "xl/worksheets/sheet1.xml");
    expect(sheet1).toMatch(/<conditionalFormatting sqref="A1:A2">\s*<cfRule type="cellIs"[^>]*operator="greaterThan"/);
    expect(zipText(xlsx, "xl/styles.xml")).toMatch(/<dxfs count="\d+">/);
    errors.expectNone();
  });

  test("conditional formatting: the Data Bars gallery draws a bar per value (render-op hook)", async ({ page }) => {
    const errors = trackErrors(page);
    await openCalc(page);
    const grid = new Grid(page);
    for (const [i, v] of ["1", "2", "3", "4"].entries()) await grid.type(i, 0, v);
    await grid.click(0, 0);
    await grid.click(3, 0, { shift: true });
    await page.getByRole("tab", { name: "Home" }).click();
    await page.getByRole("button", { name: "Conditional Formatting" }).click();
    await page.getByRole("menuitem", { name: "Data Bars" }).click();
    await page.getByRole("menuitem", { name: "Blue Data Bar", exact: true }).click();
    const bars = () =>
      page.evaluate(() =>
        ((window as unknown as { __calcCfOps?: { op: string; row: number; w: number; negative: boolean }[] }).__calcCfOps ?? [])
          .filter((o) => o.op === "bar")
          .map((o) => ({ row: o.row, w: Math.round(o.w), negative: o.negative })),
      );
    await expect.poll(async () => (await bars()).length).toBe(4);
    const list = await bars();
    expect(list.map((b) => b.row)).toEqual([0, 1, 2, 3]);
    for (let i = 1; i < 4; i++) expect(list[i]!.w).toBeGreaterThan(list[i - 1]!.w);
    expect(list.every((b) => !b.negative)).toBe(true);
    if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/calc-cf-data-bars.png` });
    errors.expectNone();
  });

  test("data validation: a list's in-cell dropdown picks a value", async ({ page }) => {
    const errors = trackErrors(page);
    await openCalc(page);
    const grid = new Grid(page);
    await grid.click(1, 1);
    await page.getByRole("tab", { name: "Data" }).click();
    await page.getByRole("button", { name: "Data Validation" }).click();
    const dlg = page.getByRole("dialog", { name: "Data Validation" });
    await dlg.getByLabel("Allow:").selectOption("list");
    await dlg.getByLabel("Source:").fill("pear,apple,fig");
    await dlg.getByRole("tab", { name: "Input Message" }).click();
    await dlg.getByLabel("Title:").fill("Fruit");
    await dlg.getByLabel("Input message:").fill("Pick one from the list");
    await dlg.getByRole("button", { name: "OK" }).click();
    await expect(page.getByTestId("validation-input-message")).toContainText("Pick one from the list");
    await page.getByRole("button", { name: "Show list" }).click();
    const list = page.getByRole("listbox", { name: "Allowed values" });
    await expect(list.getByRole("option")).toHaveText(["pear", "apple", "fig"]);
    if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/calc-dv-list.png` });
    await list.getByRole("option", { name: "fig" }).click();
    await expect.poll(() => grid.input(1, 1)).toBe("fig");
    const xlsx = await saveViaBackstage(page);
    expect(zipText(xlsx, "xl/worksheets/sheet1.xml")).toMatch(/<dataValidation [^>]*type="list"[^>]*sqref="B2"/);
    errors.expectNone();
  });

  test("data validation: a Stop alert keeps the editor open; Retry returns to it, Cancel restores the cell", async ({ page }) => {
    const errors = trackErrors(page);
    await openCalc(page);
    const grid = new Grid(page);
    await grid.click(0, 0);
    await page.getByRole("tab", { name: "Data" }).click();
    await page.getByRole("button", { name: "Data Validation" }).click();
    const dlg = page.getByRole("dialog", { name: "Data Validation" });
    await dlg.getByLabel("Allow:").selectOption("whole");
    await dlg.getByLabel("Data:").selectOption("lessThan");
    await dlg.getByLabel("Value:").fill("10");
    await dlg.getByRole("button", { name: "OK" }).click();
    await expect(dlg).toHaveCount(0);
    await grid.click(0, 0);
    await page.keyboard.type("42");
    await page.keyboard.press("Enter");
    const alert = page.getByTestId("validation-alert");
    await expect(alert).toBeVisible();
    await expect(alert).toHaveAttribute("data-style", "stop");
    await expect(page.getByTestId("cell-editor")).toHaveCount(1);
    if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/calc-dv-stop.png` });
    await alert.getByRole("button", { name: "Retry" }).click();
    await expect(alert).toHaveCount(0);
    await expect(page.getByTestId("cell-editor")).toHaveValue("42");
    await page.keyboard.press("Enter");
    await page.getByTestId("validation-alert").getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByTestId("cell-editor")).toHaveCount(0);
    expect(await grid.input(0, 0)).toBe("");
    // A valid value goes through.
    await grid.type(0, 0, "7");
    expect(await grid.input(0, 0)).toBe("7");
    errors.expectNone();
  });
});

// --- charts (P8-20) ---------------------------------------------------------------------------

interface SceneRect { t: string; x: number; y: number; w: number; h: number; el?: { type: string; series?: number; point?: number } }
interface ChartHook { id: number; rect: { x: number; y: number; w: number; h: number }; scene: { items: SceneRect[] } | null }

const chartHook = (page: import("@playwright/test").Page) => page.evaluate(() => (window as unknown as { __calcCharts?: ChartHook[] }).__calcCharts ?? []);

/** The bar of series `s`, point `p` of the first chart (cell-area px). */
async function barOf(page: import("@playwright/test").Page, s: number, p: number) {
  const [c] = await chartHook(page);
  const bar = c?.scene?.items.find((it) => it.t === "rect" && it.el?.type === "series" && it.el.series === s && it.el.point === p);
  return bar && c ? { x: c.rect.x + bar.x, y: c.rect.y + bar.y, w: bar.w, h: bar.h } : null;
}

/** Quarter / North / South table in A1:C5, the range selected. */
async function chartTable(page: import("@playwright/test").Page, grid: Grid, cols = 3) {
  const rows = [["", "North", "South"], ["Q1", "10", "20"], ["Q2", "25", "5"], ["Q3", "15", "8"], ["Q4", "30", "12"]];
  for (const [r, row] of rows.entries()) for (const [c, v] of row.entries()) if (v) await grid.type(r, c, v);
  await grid.click(0, 0);
  await grid.click(4, cols - 1, { shift: true });
}

async function insertClusteredColumn(page: import("@playwright/test").Page) {
  await page.getByRole("tab", { name: "Insert", exact: true }).click();
  await page.getByRole("button", { name: "Column or Bar Chart" }).click();
  await page.getByTestId("chart-gallery-columnBar").getByRole("button", { name: "Clustered Column", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Chart Design" })).toHaveAttribute("aria-selected", "true");
  await expect.poll(async () => (await barOf(page, 0, 3))?.h ?? 0).toBeGreaterThan(10);
}

test.describe("Calc charts", () => {
  test("Insert › Clustered Column draws the chart; the saved file has xl/charts/chart1.xml", async ({ page }) => {
    const errors = trackErrors(page);
    await openCalc(page);
    const grid = new Grid(page);
    await chartTable(page, grid);
    await insertClusteredColumn(page);
    const bar = (await barOf(page, 0, 3))!;
    // The canvas shows accent 1 (#4472C4) in the middle of North's Q4 bar.
    const rgb = await page.getByTestId("grid-cells").evaluate((el, { x, y }) => {
      const canvas = el as HTMLCanvasElement;
      const scale = canvas.width / canvas.clientWidth;
      return Array.from(canvas.getContext("2d")!.getImageData(Math.floor(x * scale), Math.floor(y * scale), 1, 1).data.slice(0, 3));
    }, { x: bar.x + bar.w / 2, y: bar.y + bar.h / 2 });
    expect(Math.abs(rgb[0]! - 0x44) + Math.abs(rgb[1]! - 0x72) + Math.abs(rgb[2]! - 0xc4)).toBeLessThan(30);
    const xlsx = await saveViaBackstage(page);
    const chart = zipText(xlsx, "xl/charts/chart1.xml");
    expect(chart).toContain("<c:barChart>");
    expect(chart.match(/<c:ser>/g)).toHaveLength(2);
    expect(zipText(xlsx, "xl/drawings/drawing1.xml")).toContain("xdr:twoCellAnchor");
    errors.expectNone();
  });

  test("Change Chart Type → Pie saves a c:pieChart", async ({ page }) => {
    await openCalc(page);
    const grid = new Grid(page);
    await chartTable(page, grid);
    await insertClusteredColumn(page);
    await page.getByRole("button", { name: "Change Chart Type" }).click();
    const dialog = page.getByTestId("change-chart-type");
    await dialog.getByRole("option", { name: "Pie" }).click();
    await dialog.getByRole("button", { name: "OK" }).click();
    await expect.poll(async () => (await chartHook(page))[0]?.scene?.items.some((it) => it.t === "path" && it.el?.type === "series" && it.el.point === 3) ?? false).toBe(true);
    const xlsx = await saveViaBackstage(page);
    const chart = zipText(xlsx, "xl/charts/chart1.xml");
    expect(chart).toContain("<c:pieChart>");
    expect(chart).not.toContain("<c:barChart>");
  });

  test("editing a source cell updates the bar height", async ({ page }) => {
    await openCalc(page);
    const grid = new Grid(page);
    await chartTable(page, grid);
    await insertClusteredColumn(page);
    const before = (await barOf(page, 0, 0))!.h;
    await grid.type(1, 1, "20");
    await expect.poll(async () => Math.round(((await barOf(page, 0, 0))?.h ?? 0) / before * 10) / 10).toBe(2);
  });

  test("Select Data adds a second series picked on the grid → 2 c:ser", async ({ page }) => {
    await openCalc(page);
    const grid = new Grid(page);
    await chartTable(page, grid, 2);
    await insertClusteredColumn(page);
    expect(await barOf(page, 1, 0)).toBeNull();
    await page.getByRole("button", { name: "Select Data", exact: true }).click();
    const dialog = page.getByTestId("select-data");
    await expect(dialog.getByTestId("series-list").getByRole("option")).toHaveCount(1);
    await dialog.getByRole("button", { name: "Add", exact: true }).click();
    await page.getByTestId("series-name").fill("=Sheet1!$C$1");
    // The values come from the grid: collapse the dialog, drag C2:C5, expand again.
    await page.getByRole("button", { name: "Select the range on the sheet: Series values" }).click();
    await expect(page.getByTestId("range-pick-bar")).toBeVisible();
    const from = await grid.pos(1, 2);
    const to = await grid.pos(4, 2);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 4 });
    await page.mouse.up();
    await expect(page.getByTestId("range-pick-bar").getByRole("textbox")).toHaveValue("=Sheet1!$C$2:$C$5");
    await page.getByRole("button", { name: "Expand dialog" }).click();
    await expect(page.getByTestId("series-values")).toHaveValue("=Sheet1!$C$2:$C$5");
    await page.getByRole("dialog", { name: "Edit Series" }).getByRole("button", { name: "OK" }).click();
    await expect(dialog.getByTestId("series-list").getByRole("option")).toHaveText(["North", "South"]);
    await dialog.getByRole("button", { name: "OK" }).click();
    await expect.poll(async () => (await barOf(page, 1, 0))?.h ?? 0).toBeGreaterThan(10);
    const xlsx = await saveViaBackstage(page);
    expect(zipText(xlsx, "xl/charts/chart1.xml").match(/<c:ser>/g)).toHaveLength(2);
  });

  test("print preview shows the chart", async ({ page }) => {
    await openCalc(page);
    const grid = new Grid(page);
    await chartTable(page, grid);
    await insertClusteredColumn(page);
    await openPrint(page);
    const html = (await page.getByTestId("print-preview").getAttribute("srcdoc")) ?? "";
    expect(html).toContain('class="rs-calc-chart"');
    expect(html).toMatch(/<svg[^>]*viewBox="0 0 480 288"/);
    expect(html).toContain(">North</text>");
    await page.screenshot({ path: "test-results/chart-print-preview.png" });
  });
});

/** Pixels of the cell canvas inside cell-area rectangle (x, y, w, h) whose colour is within ±tol of `rgb`. */
async function colouredPixels(page: import("@playwright/test").Page, rect: [number, number, number, number], rgb: [number, number, number], tol = 60) {
  return page.getByTestId("grid-cells").evaluate((el, { rect, rgb, tol }) => {
    const canvas = el as HTMLCanvasElement;
    const ctx = canvas.getContext("2d")!;
    const s = canvas.width / canvas.clientWidth;
    const d = ctx.getImageData(Math.floor(rect[0] * s), Math.floor(rect[1] * s), Math.floor(rect[2] * s), Math.floor(rect[3] * s)).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i]! - rgb[0]) < tol && Math.abs(d[i + 1]! - rgb[1]) < tol && Math.abs(d[i + 2]! - rgb[2]) < tol) n++;
    return n;
  }, { rect, rgb, tol });
}

test.describe("Calc names and number formats", () => {
  test("a name defined in the Name Box works in a formula and shows for its range", async ({ page }) => {
    const errors = trackErrors(page);
    await openCalc(page);
    const grid = new Grid(page);
    for (const [i, v] of ["10", "20", "30"].entries()) await grid.type(i, 0, v);
    await grid.click(0, 0);
    await grid.click(2, 0, { shift: true });
    const box = page.getByTestId("cell-address");
    await box.fill("Amounts");
    await box.press("Enter");
    await expect(box).toHaveValue("Amounts");
    await grid.type(0, 2, "=SUM(Amounts)*2");
    expect(await grid.input(0, 2)).toBe("=SUM(Amounts)*2");
    expect(await grid.display(0, 2)).toBe("120");
    // The Name Box list navigates back to the range.
    await grid.click(5, 5);
    await page.getByRole("button", { name: "Defined names" }).click();
    await page.getByTestId("name-list").getByRole("option", { name: "Amounts" }).click();
    await expect(box).toHaveValue("Amounts");
    if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/calc-name-box.png` });
    errors.expectNone();
  });

  test("Name Manager: editing refers-to updates the dependent cell", async ({ page }) => {
    await openCalc(page);
    const grid = new Grid(page);
    for (const [i, v] of ["1", "2", "3"].entries()) {
      await grid.type(i, 0, v);
      await grid.type(i, 1, String(Number(v) * 100));
    }
    await grid.click(0, 0);
    await grid.click(2, 0, { shift: true });
    await page.getByRole("tab", { name: "Formulas" }).click();
    await page.getByRole("button", { name: "Define Name", exact: true }).click();
    const nd = page.getByRole("dialog", { name: "New Name" });
    await nd.getByLabel("Name", { exact: true }).fill("Data");
    await expect(nd.getByTestId("name-refers-to")).toHaveValue("=Sheet1!$A$1:$A$3");
    await nd.getByRole("button", { name: "OK" }).click();
    await grid.type(4, 0, "=SUM(Data)");
    expect(await grid.display(4, 0)).toBe("6");
    await page.getByRole("button", { name: "Name Manager" }).click();
    const nm = page.getByRole("dialog", { name: "Name Manager" });
    await nm.getByTestId("name-row").filter({ hasText: "Data" }).click();
    await expect(nm.getByTestId("name-row").filter({ hasText: "Data" })).toContainText("{1;2;3}");
    await nm.getByTestId("manager-refers-to").fill("=Sheet1!$B$1:$B$3");
    await nm.getByRole("button", { name: "Apply the definition" }).click();
    await expect(nm.getByTestId("name-row").filter({ hasText: "Data" })).toContainText("{100;200;300}");
    if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/calc-name-manager.png` });
    await nm.getByRole("button", { name: "Close" }).click();
    expect(await grid.display(4, 0)).toBe("600");
  });

  test("Create from Selection makes three names, saved as definedName", async ({ page }) => {
    await openCalc(page);
    const grid = new Grid(page);
    const rows = [["North", "South", "West"], ["1", "2", "3"], ["4", "5", "6"]];
    for (const [r, row] of rows.entries()) for (const [c, v] of row.entries()) await grid.type(r, c, v);
    await grid.click(0, 0);
    await grid.click(2, 2, { shift: true });
    await page.getByRole("tab", { name: "Formulas" }).click();
    await page.getByRole("button", { name: "Create from Selection" }).click();
    const dlg = page.getByRole("dialog", { name: "Create Names from Selection" });
    await expect(dlg.getByLabel("Top row")).toBeChecked();
    await dlg.getByRole("button", { name: "OK" }).click();
    await grid.type(4, 0, "=SUM(North,South,West)");
    expect(await grid.display(4, 0)).toBe("21");
    const xlsx = await saveViaBackstage(page);
    const book = zipText(xlsx, "xl/workbook.xml");
    expect(book).toContain('<definedName name="North">Sheet1!$A$2:$A$3</definedName>');
    expect(book).toContain('<definedName name="South">Sheet1!$B$2:$B$3</definedName>');
    expect(book).toContain('<definedName name="West">Sheet1!$C$2:$C$3</definedName>');
    expect(zipText(xlsx, "xl/worksheets/sheet1.xml")).toContain("<f>SUM(North,South,West)</f>");
  });

  test("the custom format [Red][<0]-0.0;0.0 shows a negative number in red", async ({ page }) => {
    const errors = trackErrors(page);
    await openCalc(page);
    const grid = new Grid(page);
    await grid.type(0, 0, "-5");
    await grid.type(1, 0, "5");
    await grid.click(0, 0);
    await grid.click(1, 0, { shift: true });
    await page.keyboard.press("Control+1");
    const dlg = page.getByRole("dialog", { name: "Format cells" });
    await dlg.getByRole("option", { name: "Custom" }).click();
    await dlg.getByRole("textbox", { name: "Format code" }).fill("[Red][<0]-0.0;0.0");
    await expect(page.getByTestId("format-preview")).toHaveText("-5.0");
    await dlg.getByRole("button", { name: "OK" }).click();
    await expect(dlg).toHaveCount(0);
    await grid.click(5, 5);
    // A1 (0..64 × 0..20 cell-area px) has red text, A2 none.
    await expect.poll(() => colouredPixels(page, [2, 2, 60, 16], [255, 0, 0])).toBeGreaterThan(5);
    expect(await colouredPixels(page, [2, 22, 60, 16], [255, 0, 0])).toBe(0);
    if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/calc-red-format.png` });
    const xlsx = await saveViaBackstage(page);
    expect(zipText(xlsx, "xl/styles.xml")).toContain('formatCode="[Red][&lt;0]-0.0;0.0"');
    errors.expectNone();
  });

  test("Show Formulas (Ctrl+`) toggles the grid between values and formulas", async ({ page }) => {
    await openCalc(page);
    const grid = new Grid(page);
    await grid.type(0, 0, "=1+2");
    await grid.click(5, 5);
    // The number is right-aligned: nothing dark in the left half of A1.
    const leftHalf: [number, number, number, number] = [2, 2, 22, 16];
    await expect.poll(() => colouredPixels(page, leftHalf, [0, 0, 0], 90)).toBe(0);
    await page.keyboard.press("Control+Backquote");
    await page.getByRole("tab", { name: "Formulas" }).click();
    await expect(page.getByRole("button", { name: "Show Formulas" })).toHaveAttribute("aria-pressed", "true");
    // The formula text starts at the left edge.
    await expect.poll(() => colouredPixels(page, leftHalf, [0, 0, 0], 90)).toBeGreaterThan(5);
    if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/calc-show-formulas.png` });
    await page.getByRole("button", { name: "Show Formulas" }).click();
    await expect.poll(() => colouredPixels(page, leftHalf, [0, 0, 0], 90)).toBe(0);
  });
});

test.describe("Calc notes, comments and links", () => {
  const shot = (page: import("@playwright/test").Page, name: string) => (process.env.SHOT_DIR ? page.screenshot({ path: `${process.env.SHOT_DIR}/${name}.png` }) : Promise.resolve());
  const NOTE_RED: [number, number, number] = [0xd0, 0x02, 0x1b];

  /** Shift+F2 on (row, col), types `text` after the author line, Esc commits. */
  async function addNote(page: import("@playwright/test").Page, grid: Grid, row: number, col: number, text: string) {
    await grid.click(row, col);
    await page.keyboard.press("Shift+F2");
    // The first note asks for the user name (its bold author line).
    const user = page.getByTestId("user-dialog");
    if (await user.isVisible().catch(() => false)) {
      await user.getByLabel("Name").fill("Ann Lee");
      await user.getByRole("button", { name: "OK" }).click();
    }
    const editor = page.getByTestId("note-editor");
    await expect(editor).toBeFocused();
    await page.keyboard.type(text);
    await shot(page, "calc-note-editor");
    await page.keyboard.press("Escape");
    await expect(editor).toHaveCount(0);
  }

  /** Review › New Comment on (row, col); the first time the user name is asked. */
  async function addComment(page: import("@playwright/test").Page, grid: Grid, row: number, col: number, text: string) {
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
  }

  test("a note (Shift+F2) shows its red triangle; the saved file has comments1.xml and the VML drawing", async ({ page }) => {
    const errors = trackErrors(page);
    await openCalc(page);
    const grid = new Grid(page);
    await grid.type(1, 1, "42");
    await addNote(page, grid, 1, 1, "Check the supplier price");
    await grid.click(5, 5);
    await expect.poll(() => colouredPixels(page, [121, 20, 7, 7], NOTE_RED)).toBeGreaterThan(5);
    // Hovering the cell shows the note box.
    const q = await grid.pos(1, 1);
    await page.mouse.move(q.x, q.y);
    await expect(page.getByTestId("note-box")).toContainText("Check the supplier price");
    await shot(page, "calc-note-hover");
    const xlsx = await saveViaBackstage(page);
    const comments = zipText(xlsx, "xl/comments1.xml");
    expect(comments).toContain('ref="B2"');
    expect(comments).toContain("Check the supplier price");
    expect(zipText(xlsx, "xl/drawings/vmlDrawing1.vml")).toContain("<x:Row>1</x:Row>");
    expect(zipText(xlsx, "xl/worksheets/sheet1.xml")).toContain("<legacyDrawing");
    errors.expectNone();
  });

  test("a threaded comment with a reply saves threadedComments with parentId and the person list", async ({ page }) => {
    const errors = trackErrors(page);
    await openCalc(page);
    const grid = new Grid(page);
    await addComment(page, grid, 2, 1, "Is this still current?");
    const card = page.getByTestId("thread-card");
    await card.getByLabel("Reply", { exact: true }).fill("Yes, until May.");
    await card.getByRole("button", { name: "Post" }).click();
    await expect(card.getByTestId("comment-reply")).toContainText("Yes, until May.");
    await page.getByRole("button", { name: "Show Comments" }).click();
    await expect(page.getByTestId("comments-pane").getByTestId("thread")).toHaveCount(1);
    await shot(page, "calc-comment-thread");
    const xlsx = await saveViaBackstage(page);
    const threaded = zipText(xlsx, "xl/threadedComments/threadedComment1.xml");
    expect(threaded.match(/<threadedComment /g)).toHaveLength(2);
    expect(threaded).toMatch(/parentId="\{[0-9A-F-]+\}"/);
    expect(threaded).toContain('ref="B3"');
    expect(zipText(xlsx, "xl/persons/person.xml")).toContain('displayName="Ann Lee"');
    // Older apps get Excel's placeholder.
    expect(zipText(xlsx, "xl/comments1.xml")).toContain("[Threaded comment]");
    errors.expectNone();
  });

  test("resolving a thread saves done=\"1\" and outlines its marker", async ({ page }) => {
    const errors = trackErrors(page);
    await openCalc(page);
    const grid = new Grid(page);
    await addComment(page, grid, 0, 0, "Fix the totals");
    await page.getByTestId("thread-card").getByRole("button", { name: "Resolve" }).click();
    await expect(page.getByTestId("thread-card").getByRole("button", { name: "Reopen" })).toBeVisible();
    const xlsx = await saveViaBackstage(page);
    expect(zipText(xlsx, "xl/threadedComments/threadedComment1.xml")).toContain('done="1"');
    errors.expectNone();
  });

  test("a note stays with its cell when a row is inserted above", async ({ page }) => {
    const errors = trackErrors(page);
    await openCalc(page);
    const grid = new Grid(page);
    await grid.type(2, 0, "keep");
    await addNote(page, grid, 2, 0, "moves along");
    await grid.click(0, 0);
    await page.getByRole("tab", { name: "Home" }).click();
    await page.getByRole("button", { name: "Insert", exact: true }).click();
    await page.getByRole("menuitem", { name: "Insert Sheet Rows" }).click();
    await expect(page.getByTestId("cell-address")).toHaveValue("A1");
    // The triangle is now on A4 (rows 20 px).
    await grid.click(6, 6);
    await expect.poll(() => colouredPixels(page, [57, 60, 7, 7], NOTE_RED)).toBeGreaterThan(5);
    expect(await colouredPixels(page, [57, 40, 7, 7], NOTE_RED)).toBe(0);
    const xlsx = await saveViaBackstage(page);
    expect(zipText(xlsx, "xl/comments1.xml")).toContain('ref="A4"');
    errors.expectNone();
  });

  test("Ctrl+K inserts a web link, saved in hyperlinks; Ctrl+click opens it", async ({ page }) => {
    const errors = trackErrors(page);
    await openCalc(page);
    await page.context().route("https://example.com/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<title>ok</title>" }));
    const grid = new Grid(page);
    await grid.click(1, 0);
    await page.keyboard.press("Control+k");
    const dialog = page.getByTestId("link-dialog");
    await dialog.getByLabel("Text to display").fill("Rusuite site");
    await dialog.getByLabel("Address", { exact: true }).fill("https://example.com/rusuite");
    await dialog.getByLabel("ScreenTip").fill("Our site");
    await dialog.getByRole("button", { name: "OK" }).click();
    await expect(dialog).toHaveCount(0);
    expect(await grid.input(1, 0)).toBe("Rusuite site");
    const q = await grid.pos(1, 0);
    await page.mouse.move(q.x, q.y);
    await expect(page.getByTestId("link-tip")).toContainText("Our site");
    await shot(page, "calc-link-tip");
    const [popup] = await Promise.all([
      page.waitForEvent("popup"),
      (async () => {
        await page.keyboard.down("Control");
        await page.mouse.click(q.x, q.y);
        await page.keyboard.up("Control");
      })(),
    ]);
    await expect.poll(() => popup.url()).toBe("https://example.com/rusuite");
    await popup.close();
    const xlsx = await saveViaBackstage(page);
    expect(zipText(xlsx, "xl/worksheets/sheet1.xml")).toMatch(/<hyperlink ref="A2" r:id="rId\d+" display="Rusuite site" tooltip="Our site"\/>/);
    expect(zipText(xlsx, "xl/worksheets/_rels/sheet1.xml.rels")).toContain('Target="https://example.com/rusuite" TargetMode="External"');
    errors.expectNone();
  });

  test("File › Print with Comments: At end of sheet lists the note after the sheet", async ({ page }) => {
    await openCalc(page);
    const grid = new Grid(page);
    await grid.type(0, 0, "Total");
    await addNote(page, grid, 0, 0, "Printed at the end");
    await openPrint(page);
    const pagesBefore = await previewPages(page);
    await page.getByLabel("Comments and notes").selectOption("atEnd");
    await expect.poll(() => previewPages(page)).toBe(pagesBefore + 1);
    const html = (await page.getByTestId("print-preview").getAttribute("srcdoc")) ?? "";
    expect(html).toContain("Printed at the end");
    expect(html).toContain('data-annotation="A1"');
    await shot(page, "calc-print-notes");
  });
});
