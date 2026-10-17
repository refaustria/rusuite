// P9-C4 (cycle 3.141): formulas, names and calculation tools – LET over a range, VSTACK spilling (and
// #SPILL! when blocked), manual calculation with "Calculate" and F9 (saved as calcMode="manual" and
// reopened in manual mode), Error Checking's Convert to Number, and Evaluate Formula stepping through
// =SUM(A1:A2)*B1.
import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { openViaBackstage, saveViaBackstage, trackErrors } from "../support/common";
import { Grid, openCalc } from "../support/calc";
import { zipText } from "../support/zip";

const shot = async (page: Page, name: string) => {
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/P9-C4-${name}.png` });
};

const formulasTab = (page: Page) => page.getByRole("tab", { name: "Formulas", exact: true }).click();

/** Formulas › Calculation Options ▾ (the Calculation group collapses first on a narrow window). */
async function calculationOptions(page: Page) {
  const button = page.getByRole("button", { name: "Calculation Options" });
  if (!(await button.isVisible())) await page.getByRole("button", { name: "Calculation", exact: true }).click();
  await button.click();
}

test.describe("Calc P9-C4 formulas", () => {
  test("LET binds a range and evaluates; a LET array spills", async ({ page }) => {
    const errors = trackErrors(page);
    await openCalc(page);
    const grid = new Grid(page);
    for (const [r, v] of ["1", "2", "3"].entries()) await grid.type(r, 0, v);
    await grid.type(0, 2, "=LET(x,A1:A3,SUM(x*2))");
    expect(await grid.display(0, 2)).toBe("12");
    await grid.type(0, 3, "=LET(x,A1:A3,x*2)");
    expect(await grid.display(2, 3)).toBe("6");
    // A lambda through LET and a lifted function.
    await grid.type(0, 4, "=LET(f,LAMBDA(v,v*10),f(A2))");
    expect(await grid.display(0, 4)).toBe("20");
    await grid.type(0, 5, "=LEN(A1:A3&\"ab\")");
    expect(await grid.display(2, 5)).toBe("3");
    await shot(page, "let");
    errors.expectNone();
  });

  test("VSTACK spills four rows and shows #SPILL! when blocked", async ({ page }) => {
    const errors = trackErrors(page);
    await openCalc(page);
    const grid = new Grid(page);
    await grid.type(0, 0, "1");
    await grid.type(1, 0, "2");
    await grid.type(0, 1, "3");
    await grid.type(1, 1, "4");
    await grid.type(0, 3, "=VSTACK(A1:A2,B1:B2)");
    expect(await grid.display(3, 3)).toBe("4");
    expect(await grid.display(2, 3)).toBe("3");
    // A value in the spill range blocks it.
    await grid.type(2, 3, "x");
    expect(await grid.display(0, 3)).toBe("#SPILL!");
    await shot(page, "spill-blocked");
    await grid.click(2, 3);
    await page.keyboard.press("Delete");
    await expect.poll(() => grid.display(0, 3)).toBe("1");
    errors.expectNone();
  });

  test("manual calculation shows Calculate, F9 recalculates, and it is saved and reopened", async ({ page }) => {
    const errors = trackErrors(page);
    await openCalc(page);
    const grid = new Grid(page);
    await grid.type(0, 0, "1");
    await grid.type(0, 1, "=A1*10");
    await formulasTab(page);
    await calculationOptions(page);
    await page.getByRole("menuitemradio", { name: "Manual" }).click();
    await grid.type(0, 0, "5");
    await expect(page.getByTestId("calc-pending")).toHaveText("Calculate");
    expect(await grid.display(0, 1)).toBe("10");
    await shot(page, "manual-pending");
    await grid.click(3, 3);
    await page.keyboard.press("F9");
    await expect(page.getByTestId("calc-pending")).toHaveCount(0);
    expect(await grid.display(0, 1)).toBe("50");
    const xlsx = await saveViaBackstage(page);
    expect(zipText(xlsx, "xl/workbook.xml")).toContain('calcMode="manual"');
    const file = test.info().outputPath("manual.xlsx");
    fs.writeFileSync(file, xlsx);
    await page.goto("about:blank");
    await openCalc(page);
    await openViaBackstage(page, file);
    await expect.poll(() => grid.input(0, 1)).toBe("=A1*10");
    await formulasTab(page);
    await calculationOptions(page);
    await expect(page.getByRole("menuitemradio", { name: "Manual" })).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");
    errors.expectNone();
  });

  test("Error Checking finds a number stored as text and Convert to Number fixes it", async ({ page }) => {
    const errors = trackErrors(page);
    await openCalc(page);
    const grid = new Grid(page);
    await grid.type(0, 0, "'42");
    await grid.type(0, 1, "=A1+1");
    await formulasTab(page);
    await page.getByRole("button", { name: "Error Checking", exact: true }).click();
    const dlg = page.getByTestId("error-checking");
    await expect(dlg.getByTestId("error-title")).toHaveText("Number Stored as Text");
    await expect(dlg.getByTestId("error-cell")).toHaveText("Error in cell Sheet1!A1");
    await shot(page, "error-checking");
    await dlg.getByRole("button", { name: "Convert to Number" }).click();
    await expect(dlg.getByTestId("error-done")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect.poll(() => grid.input(0, 0)).toBe("42");
    await expect(page.getByTestId("error-tag-button")).toHaveCount(0);
    errors.expectNone();
  });

  test("Evaluate Formula steps through =SUM(A1:A2)*B1", async ({ page }) => {
    const errors = trackErrors(page);
    await openCalc(page);
    const grid = new Grid(page);
    await grid.type(0, 0, "1");
    await grid.type(1, 0, "2");
    await grid.type(0, 1, "10");
    await grid.type(2, 2, "=SUM(A1:A2)*B1");
    await grid.click(2, 2);
    await formulasTab(page);
    await page.getByRole("button", { name: "Evaluate Formula" }).click();
    const dlg = page.getByTestId("evaluate-formula");
    await expect(dlg.getByTestId("eval-ref")).toHaveText("Sheet1!$C$3");
    await expect(dlg.getByTestId("eval-next")).toHaveText("SUM(A1:A2)");
    await dlg.getByRole("button", { name: "Evaluate" }).click();
    await expect(dlg.getByTestId("eval-text")).toHaveText("=3*B1");
    await expect(dlg.getByTestId("eval-next")).toHaveText("B1");
    await dlg.getByRole("button", { name: "Evaluate" }).click();
    await expect(dlg.getByTestId("eval-text")).toHaveText("=3*10");
    await shot(page, "evaluate");
    await dlg.getByRole("button", { name: "Evaluate" }).click();
    await expect(dlg.getByTestId("eval-text")).toHaveText("30");
    await expect(dlg.getByRole("button", { name: "Restart" })).toBeVisible();
    await dlg.getByRole("button", { name: "Close" }).click();
    errors.expectNone();
  });

  test("R1C1 reference style shows and takes formulas in R1C1", async ({ page }) => {
    const errors = trackErrors(page);
    await openCalc(page);
    const grid = new Grid(page);
    await grid.type(0, 0, "4");
    await grid.type(1, 1, "=A1*2");
    await page.getByRole("tab", { name: "File", exact: true }).click();
    await page.getByTestId("backstage").getByRole("button", { name: /^Options/ }).click();
    // With the assistant the shared options dialog comes first: General › the app's options.
    const settings = page.getByTestId("settings-dialog");
    const dlg = page.getByTestId("formula-options");
    await expect(settings.or(dlg)).toBeVisible();
    if (await settings.isVisible()) {
      await settings.getByRole("tab", { name: "General" }).click();
      await settings.getByRole("button", { name: "Open the app's options…" }).click();
    }
    await dlg.getByRole("checkbox", { name: "R1C1 reference style" }).check();
    await dlg.getByRole("button", { name: "OK" }).click();
    await expect.poll(() => grid.input(1, 1)).toBe("=R[-1]C[-1]*2");
    await grid.type(2, 1, "=R[-1]C+1");
    await expect.poll(() => grid.display(2, 1)).toBe("9");
    errors.expectNone();
  });
});
