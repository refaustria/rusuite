// P8-44 Calc pre-release fixes: regression tests for the deferred QA items (ids from docs/qa/calc-2026-10.md).
import { expect, test, type Page } from "@playwright/test";
import { ribbonCommand, saveViaBackstage, trackErrors } from "../support/common";
import { zipText } from "../support/zip";
import { Grid, openCalc } from "../support/calc";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

/** The displayed text of a cell (Ctrl+C puts the displayed values on the system clipboard). */
async function shown(page: Page, grid: Grid, row: number, col: number) {
  await grid.click(row, col);
  await page.evaluate(() => navigator.clipboard.writeText(""));
  await page.keyboard.press("Control+c");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).not.toBe("");
  return (await page.evaluate(() => navigator.clipboard.readText())).trim();
}

test.describe("Calc pre-release fixes (P8-44)", () => {
  test("C-13 Insert Cells shifting right moves a formula and its references; undo restores", async ({ page }) => {
    const errors = trackErrors(page);
    await openCalc(page);
    const grid = new Grid(page);
    await grid.type(0, 0, "5");
    await grid.type(0, 1, "=A1*2");
    await grid.type(1, 0, "7");
    await grid.type(3, 0, "=SUM(A1:C1)");
    // Home › Insert ▾ › Insert Cells… on A1, Shift cells right.
    await grid.click(0, 0);
    await ribbonCommand(page, "Cells", "Insert");
    await page.getByRole("menuitem", { name: "Insert Cells…" }).click();
    const dlg = page.getByRole("dialog", { name: "Insert" });
    await dlg.getByLabel("Shift cells right").check();
    await dlg.getByRole("button", { name: "OK" }).click();
    expect(await grid.input(0, 0)).toBe("");
    expect(await grid.input(0, 1)).toBe("5");
    expect(await grid.input(0, 2)).toBe("=B1*2");
    expect(await grid.display(0, 2)).toBe("10");
    // Row 2 stays; the range in the shifted row moves along (Excel).
    expect(await grid.input(1, 0)).toBe("7");
    expect(await grid.input(3, 0)).toBe("=SUM(B1:D1)");
    // Ctrl+- on B1: Delete, Shift cells left brings it back.
    await grid.click(0, 0);
    await page.keyboard.press("Control+-");
    const del = page.getByRole("dialog", { name: "Delete" });
    await del.getByLabel("Shift cells left").check();
    await del.getByRole("button", { name: "OK" }).click();
    expect(await grid.input(0, 1)).toBe("=A1*2");
    expect(await grid.input(3, 0)).toBe("=SUM(A1:C1)");
    await page.keyboard.press("Control+z");
    expect(await grid.input(0, 2)).toBe("=B1*2");
    errors.expectNone();
  });

  test("C-08 Format Cells: Border Outline and a Fill are applied as one step and saved to the xlsx", async ({ page }) => {
    const errors = trackErrors(page);
    await openCalc(page);
    const grid = new Grid(page);
    await grid.type(1, 1, "boxed");
    await grid.click(1, 1);
    await page.keyboard.press("Control+1");
    const dlg = page.getByRole("dialog", { name: "Format cells" });
    await expect(dlg.getByRole("tab", { name: "Number" })).toHaveAttribute("aria-selected", "true");
    await dlg.getByRole("tab", { name: "Border" }).click();
    await dlg.getByRole("option", { name: "Medium" }).click();
    await dlg.getByRole("button", { name: "Outline" }).click();
    await expect(dlg.getByTestId("border-preview").locator("line[data-edge]")).toHaveCount(4);
    await dlg.getByRole("tab", { name: "Fill" }).click();
    await dlg.getByRole("button", { name: "#FFFF00" }).click();
    await dlg.getByRole("tab", { name: "Alignment" }).click();
    await dlg.getByLabel("Degrees").fill("45");
    await page.screenshot({ path: "../../shots/P8-44-format-cells.png" });
    await dlg.getByRole("button", { name: "OK" }).click();
    await expect(dlg).toHaveCount(0);
    const buf = await saveViaBackstage(page);
    const styles = zipText(buf, "xl/styles.xml");
    expect(styles).toMatch(/<border><left style="medium">[^]*<right style="medium">[^]*<top style="medium">[^]*<bottom style="medium">/);
    expect(styles).toMatch(/<fgColor rgb="FFFFFF00"\/>/);
    expect(styles).toContain('textRotation="45"');
    expect(zipText(buf, "xl/worksheets/sheet1.xml")).toMatch(/<c r="B2"[^>]*\ss="[1-9]/);
    // One undo step removes all of it.
    await page.getByRole("tab", { name: "Home", exact: true }).click();
    await grid.click(1, 1);
    await page.keyboard.press("Control+z");
    const again = zipText(await saveViaBackstage(page), "xl/worksheets/sheet1.xml");
    expect(again).toMatch(/<c r="B2"(?![^>]*\ss="[1-9])/);
    errors.expectNone();
  });

  test("C-05 a circular reference shows 0 and keeps Excel's status bar warning until it is fixed", async ({ page }) => {
    const errors = trackErrors(page);
    await openCalc(page);
    const grid = new Grid(page);
    await grid.type(6, 1, "5");
    await grid.type(7, 1, "=B8+1");
    const status = page.getByTestId("cycle-status");
    await expect(status).toHaveText("Circular reference: B8");
    expect(await grid.display(7, 1)).toBe("0");
    await grid.type(0, 0, "other");
    await expect(status).toHaveText("Circular reference: B8");
    await grid.type(7, 1, "=B7+1");
    await expect(status).toHaveCount(0);
    expect(await grid.display(7, 1)).toBe("6");
    errors.expectNone();
  });

  test("C-19 a formula on a formatted cell takes its number format (=A1*2 on 12% shows 24%)", async ({ page }) => {
    const errors = trackErrors(page);
    await openCalc(page);
    const grid = new Grid(page);
    await grid.type(0, 0, "12%");
    await grid.type(0, 1, "=A1*2");
    await grid.type(1, 0, "$1,234.50");
    await grid.type(1, 1, "=A2");
    expect(await shown(page, grid, 0, 1)).toBe("24%");
    expect(await shown(page, grid, 1, 1)).toBe("$1,234.50");
    errors.expectNone();
  });

  test("C-21 Backspace edits the active cell starting empty; C-23 a typed amount widens a default-width column", async ({ page }) => {
    const errors = trackErrors(page);
    await openCalc(page);
    const grid = new Grid(page);
    await grid.type(0, 0, "old");
    await grid.click(0, 0);
    await page.keyboard.press("Backspace");
    const editor = page.getByTestId("cell-editor");
    await expect(editor).toHaveValue("");
    await page.keyboard.press("Escape");
    expect(await grid.input(0, 0)).toBe("old");
    await page.keyboard.press("Backspace");
    await page.keyboard.type("new");
    await page.keyboard.press("Enter");
    expect(await grid.input(0, 0)).toBe("new");
    // C-23: column C (default width 8.43) grows for a long amount instead of showing ####.
    const width = async (col: number) => {
      await grid.click(0, col, { button: "right" });
      await page.getByRole("menuitem", { name: "Column width…" }).click();
      const dlg = page.getByRole("dialog", { name: "Column width" });
      const v = Number(await dlg.getByRole("textbox").inputValue());
      await page.keyboard.press("Escape");
      return v;
    };
    expect(await width(2)).toBeCloseTo(8.43, 1);
    await grid.type(0, 2, "$1,234,567.50");
    await page.screenshot({ path: "../../shots/P8-44-widened-column.png" });
    expect(await width(2)).toBeGreaterThan(9);
    // Text does not widen.
    await grid.type(0, 4, "a long piece of text");
    expect(await width(4)).toBeCloseTo(8.43, 1);
    errors.expectNone();
  });
});
