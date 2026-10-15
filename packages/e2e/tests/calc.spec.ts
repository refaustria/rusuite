import { expect, test } from "@playwright/test";
import { downloadBuffer, fileCommand, interceptPrint, openViaBackstage, printCount, saveViaBackstage, testdata, trackErrors } from "../support/common";
import { Grid, openCalc } from "../support/calc";
import { zipText } from "../support/zip";

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
    await expect(page.getByTestId("cell-address")).toHaveText("A1:B4");
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
    await expect(page.getByTestId("cell-address")).toHaveText("H2");
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
    await tabs.getByRole("tab", { name: "View" }).click();
    await expect(tabs.getByRole("tab", { name: "View" })).toHaveAttribute("aria-selected", "true");
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

  test("Export PDF opens the print view and calls window.print", async ({ page }) => {
    await interceptPrint(page);
    await openCalc(page);
    const grid = new Grid(page);
    await grid.type(0, 0, "hello");
    await fileCommand(page, /^Export PDF/);
    const setup = page.getByRole("dialog").first();
    await expect(setup).toBeVisible();
    await setup.getByRole("button", { name: /Export|Print|OK/ }).last().click();
    await expect(page.getByTestId("print-view")).toBeVisible();
    await expect.poll(() => printCount(page)).toBeGreaterThan(0);
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
});
