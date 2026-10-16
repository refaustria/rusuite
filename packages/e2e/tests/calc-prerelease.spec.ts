// P8-44 Calc pre-release fixes: regression tests for the deferred QA items (ids from docs/qa/calc-2026-10.md).
import { expect, test } from "@playwright/test";
import { ribbonCommand, trackErrors } from "../support/common";
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
});
