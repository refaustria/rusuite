// P8-44 Calc pre-release fixes: regression tests for the deferred QA items (ids from docs/qa/calc-2026-10.md).
import { expect, test } from "@playwright/test";
import { ribbonCommand, saveViaBackstage, trackErrors } from "../support/common";
import { zipText } from "../support/zip";
import { Grid, openCalc } from "../support/calc";

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
});
