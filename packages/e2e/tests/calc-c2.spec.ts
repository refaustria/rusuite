// P9-C2 (cycle 3.141): structured references follow a deleted table column, a custom table style through save →
// reopen, a table slicer filtering rows and surviving save → reopen, Flash Fill and Auto Outline.
import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { openViaBackstage, saveViaBackstage, trackErrors } from "../support/common";
import { Grid, openCalc } from "../support/calc";
import { zipText } from "../support/zip";

const shot = async (page: Page, name: string) => {
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/P9-C2-${name}.png` });
};

/** Region / Qty / Price in A1:C5 as Table1 (Ctrl+T on A1). */
async function regionTable(page: Page, grid: Grid) {
  const rows = [["Region", "Qty", "Price"], ["East", "3", "2"], ["West", "5", "4"], ["East", "1", "10"], ["North", "2", "1"]];
  for (const [r, row] of rows.entries()) for (const [c, v] of row.entries()) await grid.type(r, c, v);
  await grid.click(1, 0);
  await page.keyboard.press("Control+t");
  const dlg = page.getByRole("dialog", { name: "Create Table" });
  await expect(dlg.getByTestId("table-range")).toHaveValue("=$A$1:$C$5");
  await dlg.getByRole("button", { name: "OK" }).click();
  await expect(page.getByRole("tab", { name: "Table Design" })).toBeVisible();
}

test.describe("Calc P9-C2", () => {
  test("deleting a table column rewrites the formulas that refer to it", async ({ page }) => {
    const errors = trackErrors(page);
    await openCalc(page);
    const grid = new Grid(page);
    await regionTable(page, grid);
    await grid.type(0, 5, "=SUM(Table1[Qty])");
    await grid.type(1, 5, "=SUM(Table1[Price])");
    expect(await grid.display(0, 5)).toBe("11");
    // Right-click in the Qty column › Delete Table Columns.
    await grid.click(2, 1, { button: "right" });
    await page.getByRole("menu").getByRole("menuitem", { name: "Delete Table Columns" }).click();
    // The formulas moved one column left with the sheet.
    await expect.poll(() => grid.input(0, 4)).toBe("=SUM(#REF!)");
    expect(await grid.input(1, 4)).toBe("=SUM(Table1[Price])");
    await shot(page, "ref-rewrite");
    // Undo brings the column and the formula back; redo deletes again.
    await page.keyboard.press("Control+z");
    await expect.poll(() => grid.input(0, 5)).toBe("=SUM(Table1[Qty])");
    await page.keyboard.press("Control+y");
    await expect.poll(() => grid.input(0, 4)).toBe("=SUM(#REF!)");
    expect(await grid.display(1, 4)).toBe("17");
    errors.expectNone();
  });

  test("a custom table style is applied, listed under Custom and kept through save → reopen", async ({ page }) => {
    const errors = trackErrors(page);
    await openCalc(page);
    const grid = new Grid(page);
    await regionTable(page, grid);
    await page.getByRole("tab", { name: "Table Design" }).click();
    await page.getByRole("button", { name: "Quick Styles" }).click();
    await page.getByTestId("table-style-gallery").getByRole("button", { name: "New Table Style…" }).click();
    const dlg = page.getByRole("dialog", { name: "New Table Style" });
    await dlg.getByLabel("Name:").fill("Firma");
    await dlg.getByRole("option", { name: "Header Row" }).click();
    await dlg.getByLabel("Fill:").fill("#1f4e79");
    await dlg.getByLabel("Font color:").fill("#ffffff");
    await dlg.getByLabel("Bold").check();
    await dlg.getByRole("option", { name: "First Row Stripe" }).click();
    await dlg.getByLabel("Fill:").fill("#ddebf7");
    await dlg.getByLabel("Stripe Size:").selectOption("2");
    await shot(page, "new-table-style");
    await dlg.getByRole("button", { name: "OK" }).click();
    await expect(dlg).toHaveCount(0);
    const xlsx = await saveViaBackstage(page);
    const styles = zipText(xlsx, "xl/styles.xml");
    expect(styles).toMatch(/<tableStyles count="1" defaultTableStyle="TableStyleMedium2"[^>]*><tableStyle name="Firma" pivot="0" count="2">/);
    expect(styles).toMatch(/<tableStyleElement type="firstRowStripe" size="2" dxfId="\d+"\/>/);
    expect(zipText(xlsx, "xl/tables/table1.xml")).toContain('<tableStyleInfo name="Firma"');
    const file = test.info().outputPath("custom-style.xlsx");
    fs.writeFileSync(file, xlsx);
    await openViaBackstage(page, file);
    await grid.click(1, 0);
    await page.getByRole("tab", { name: "Table Design" }).click();
    await page.getByRole("button", { name: "Quick Styles" }).click();
    const custom = page.getByTestId("table-style-gallery").getByRole("group", { name: "Custom" });
    await expect(custom.getByRole("button", { name: "Firma" })).toHaveAttribute("aria-pressed", "true");
    await shot(page, "custom-gallery");
    errors.expectNone();
  });

  test("a table slicer filters the rows and comes back with the saved file", async ({ page }) => {
    const errors = trackErrors(page);
    await openCalc(page);
    const grid = new Grid(page);
    await regionTable(page, grid);
    await page.getByRole("tab", { name: "Table Design" }).click();
    await page.getByRole("button", { name: "Insert Slicer" }).click();
    const dlg = page.getByRole("dialog", { name: "Insert Slicers" });
    await dlg.getByLabel("Region").check();
    await dlg.getByRole("button", { name: "OK" }).click();
    const slicer = page.getByRole("group", { name: "Slicer Region" });
    await expect(slicer).toBeVisible();
    await expect(slicer.getByRole("button", { name: "East" })).toHaveAttribute("aria-pressed", "true");
    await slicer.getByRole("button", { name: "West" }).click();
    await expect(slicer.getByRole("button", { name: "East" })).toHaveAttribute("aria-pressed", "false");
    await expect(slicer.getByRole("button", { name: "West" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("tab", { name: "Slicer", exact: true })).toBeVisible();
    await shot(page, "slicer");
    const xlsx = await saveViaBackstage(page);
    const sheet = zipText(xlsx, "xl/worksheets/sheet1.xml");
    // East (rows 2, 4) and North (row 5) are filtered out.
    for (const r of [2, 4, 5]) expect(sheet).toMatch(new RegExp(`<row r="${r}"[^>]*hidden="1"`));
    expect(sheet).not.toMatch(/<row r="3"[^>]*hidden="1"/);
    expect(sheet).toContain("<x15:slicerList");
    expect(zipText(xlsx, "xl/slicerCaches/slicerCache1.xml")).toContain('<x15:tableSlicerCache tableId="1" column="1"/>');
    expect(zipText(xlsx, "xl/slicers/slicer1.xml")).toContain('<slicer name="Region" cache="Slicer_Region" caption="Region"');
    expect(zipText(xlsx, "xl/workbook.xml")).toContain('<definedName name="Slicer_Region">#N/A</definedName>');
    const file = test.info().outputPath("slicer.xlsx");
    fs.writeFileSync(file, xlsx);
    await openViaBackstage(page, file);
    const back = page.getByRole("group", { name: "Slicer Region" });
    await expect(back).toBeVisible();
    await expect(back.getByRole("button", { name: "West" })).toHaveAttribute("aria-pressed", "true");
    await expect(back.getByRole("button", { name: "North" })).toHaveAttribute("aria-pressed", "false");
    // Clear Filter shows every row again.
    await back.getByRole("button", { name: "Clear Filter" }).click();
    await expect(back.getByRole("button", { name: "East" })).toHaveAttribute("aria-pressed", "true");
    errors.expectNone();
  });

  test("Flash Fill splits 'First Last' into first names (Ctrl+E)", async ({ page }) => {
    const errors = trackErrors(page);
    await openCalc(page);
    const grid = new Grid(page);
    const names = ["Ada Lovelace", "Alan Turing", "Grace Hopper", "Linus Torvalds"];
    for (const [r, v] of names.entries()) await grid.type(r, 0, v);
    await grid.type(0, 1, "Ada");
    await grid.click(1, 1);
    await page.keyboard.press("Control+e");
    await expect(page.getByRole("status").filter({ hasText: "Flash Fill changed 3 cells" })).toBeVisible();
    expect(await grid.input(1, 1)).toBe("Alan");
    expect(await grid.input(2, 1)).toBe("Grace");
    expect(await grid.input(3, 1)).toBe("Linus");
    await shot(page, "flash-fill");
    // A second example in the next column shows the suggestions; Enter accepts them.
    await grid.type(0, 2, "Lovelace");
    await grid.type(1, 2, "Turing");
    await expect(page.getByTestId("flash-suggestion")).toHaveCount(2);
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("flash-suggestion")).toHaveCount(0);
    expect(await grid.input(3, 2)).toBe("Torvalds");
    errors.expectNone();
  });

  test("Auto Outline groups the rows under their SUM rows", async ({ page }) => {
    const errors = trackErrors(page);
    await openCalc(page);
    const grid = new Grid(page);
    const col = ["10", "20", "30", "=SUM(A1:A3)", "5", "6", "=SUM(A5:A6)", "=A4+A7"];
    for (const [r, v] of col.entries()) await grid.type(r, 0, v);
    await grid.click(0, 0);
    await page.getByRole("tab", { name: "Data" }).click();
    await page.getByRole("button", { name: "Group", exact: true }).click();
    await page.getByRole("menuitem", { name: "Auto Outline" }).click();
    await shot(page, "auto-outline");
    const xlsx = await saveViaBackstage(page);
    const sheet = zipText(xlsx, "xl/worksheets/sheet1.xml");
    const level = (r: number) => new RegExp(`<row r="${r}"[^>]*outlineLevel="(\\d)"`).exec(sheet)?.[1] ?? "0";
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(level)).toEqual(["2", "2", "2", "1", "2", "2", "1", "0"]);
    expect(sheet).toMatch(/<sheetFormatPr[^>]*outlineLevelRow="2"/);
    errors.expectNone();
  });
});
