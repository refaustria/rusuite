// P9-C1 (cycle 3.141): sheet protection, pattern fills and accounting underlines through save → reopen, Insert Cells
// inside a conditional formatting range, Move or Copy and Unhide of several sheets.
import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { openViaBackstage, saveViaBackstage, trackErrors } from "../support/common";
import { Grid, openCalc } from "../support/calc";
import { zipText } from "../support/zip";

const shot = async (page: Page, name: string) => {
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/P9-C1-${name}.png` });
};

async function sheetMenu(page: Page, sheet: string, item: string | RegExp) {
  await page.getByRole("tablist", { name: "Sheets" }).getByRole("tab", { name: sheet }).click({ button: "right" });
  await page.getByRole("menu", { name: "Sheet" }).getByRole("menuitem", { name: item, exact: typeof item === "string" }).click();
}

test.describe("Calc P9-C1", () => {
  test("Protect Sheet with a password: a locked cell refuses typing; a wrong password fails, the right one unprotects", async ({ page }) => {
    const errors = trackErrors(page);
    await openCalc(page);
    const grid = new Grid(page);
    await grid.type(0, 0, "fixed");
    await page.getByRole("tab", { name: "Review" }).click();
    await page.getByRole("button", { name: "Protect Sheet…" }).click();
    let dlg = page.getByRole("dialog", { name: "Protect Sheet" });
    await dlg.getByLabel("Password to unprotect sheet:").fill("geheim");
    await dlg.getByRole("button", { name: "OK" }).click();
    dlg = page.getByRole("dialog", { name: "Confirm Password" });
    await dlg.getByLabel("Reenter password to proceed.").fill("geheim");
    await dlg.getByRole("button", { name: "OK" }).click();
    await expect(page.getByTestId("sheet-protected")).toBeVisible();
    await grid.click(0, 0);
    await page.keyboard.type("x");
    await expect(page.getByRole("alert").first()).toContainText("The cell or chart you're trying to change is on a protected sheet.");
    await expect(page.getByTestId("cell-editor")).toHaveCount(0);
    expect(await grid.input(0, 0)).toBe("fixed");
    await shot(page, "protected");
    // The saved file carries Excel's SHA-512 form.
    const xlsx = await saveViaBackstage(page);
    expect(zipText(xlsx, "xl/worksheets/sheet1.xml")).toMatch(/<sheetProtection algorithmName="SHA-512" hashValue="[^"]+" saltValue="[^"]+" spinCount="100000"[^>]* sheet="1"/);
    await page.getByRole("tab", { name: "Review" }).click();
    await page.getByRole("button", { name: "Unprotect Sheet" }).click();
    dlg = page.getByRole("dialog", { name: "Unprotect Sheet" });
    await dlg.getByLabel("Password:").fill("Geheim");
    await dlg.getByRole("button", { name: "OK" }).click();
    await expect(dlg.getByRole("alert")).toContainText("The password you supplied is not correct.");
    await dlg.getByLabel("Password:").fill("geheim");
    await dlg.getByRole("button", { name: "OK" }).click();
    await expect(page.getByTestId("sheet-protected")).toHaveCount(0);
    await grid.type(0, 0, "free");
    expect(await grid.input(0, 0)).toBe("free");
    errors.expectNone();
  });

  test("a pattern fill and an accounting underline survive save → reopen", async ({ page }) => {
    const errors = trackErrors(page);
    await openCalc(page);
    const grid = new Grid(page);
    await grid.type(0, 0, "Total");
    await grid.click(0, 0);
    await page.keyboard.press("Control+1");
    let dlg = page.getByRole("dialog", { name: "Format cells" });
    await dlg.getByRole("tab", { name: "Font" }).click();
    await dlg.getByLabel("Underline").selectOption({ label: "Double Accounting" });
    await dlg.getByRole("tab", { name: "Fill" }).click();
    await dlg.getByLabel("Pattern Style:").selectOption({ label: "Thin Diagonal Crosshatch" });
    await dlg.getByRole("button", { name: "OK" }).click();
    await expect(dlg).toHaveCount(0);
    await shot(page, "pattern-accounting");
    const xlsx = await saveViaBackstage(page);
    const styles = zipText(xlsx, "xl/styles.xml");
    expect(styles).toContain('<u val="doubleAccounting"/>');
    expect(styles).toContain('patternType="lightTrellis"');
    const file = test.info().outputPath("pattern.xlsx");
    fs.writeFileSync(file, xlsx);
    await openViaBackstage(page, file);
    await expect(page.getByTestId("cell-address")).toHaveValue("A1");
    await grid.click(0, 0);
    await page.keyboard.press("Control+1");
    dlg = page.getByRole("dialog", { name: "Format cells" });
    await dlg.getByRole("tab", { name: "Font" }).click();
    await expect(dlg.getByLabel("Underline")).toHaveValue("doubleAccounting");
    await dlg.getByRole("tab", { name: "Fill" }).click();
    await expect(dlg.getByLabel("Pattern Style:")).toHaveValue("lightTrellis");
    errors.expectNone();
  });

  test("Insert Cells inside a conditional formatting range keeps the rule on the moved cells", async ({ page }) => {
    const errors = trackErrors(page);
    await openCalc(page);
    const grid = new Grid(page);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) await grid.type(r, c, String(r * 3 + c + 1));
    await grid.click(0, 0);
    await grid.click(2, 2, { shift: true });
    await page.getByRole("tab", { name: "Home" }).click();
    await page.getByRole("button", { name: "Conditional Formatting" }).click();
    await page.getByRole("menuitem", { name: "Highlight Cells Rules" }).click();
    await page.getByRole("menuitem", { name: "Greater Than…" }).click();
    const cf = page.getByRole("dialog", { name: "Greater Than" });
    await cf.getByLabel("Value").fill("4");
    await cf.getByRole("button", { name: "OK" }).click();
    // Insert Cells at B2, shift down: B2 (5) moves to B3.
    await grid.click(1, 1);
    await page.getByTestId("ribbon-panel").getByRole("button", { name: "Insert", exact: true }).click();
    await page.getByRole("menuitem", { name: "Insert Cells…" }).click();
    const ins = page.getByRole("dialog", { name: "Insert" });
    await ins.getByRole("radio", { name: "Shift cells down" }).check();
    await ins.getByRole("button", { name: "OK" }).click();
    expect(await grid.input(2, 1)).toBe("5");
    await shot(page, "cf-insert-cells");
    const xlsx = await saveViaBackstage(page);
    const sheet = zipText(xlsx, "xl/worksheets/sheet1.xml");
    const sqref = /<conditionalFormatting sqref="([^"]+)"/.exec(sheet)?.[1] ?? "";
    expect(sqref.split(" ").sort()).toEqual(["A1:A3", "B1:B4", "C1:C3"]);
    errors.expectNone();
  });

  test("Move or Copy with Create a copy makes Sheet1 (2)", async ({ page }) => {
    const errors = trackErrors(page);
    await openCalc(page);
    const grid = new Grid(page);
    await grid.type(0, 0, "=Sheet1!B1+1");
    const sheets = page.getByRole("tablist", { name: "Sheets" });
    await page.getByRole("button", { name: "Add sheet" }).click();
    await expect(sheets.getByRole("tab", { name: "Sheet2" })).toHaveAttribute("aria-selected", "true");
    await sheetMenu(page, "Sheet1", "Move or Copy…");
    const dlg = page.getByRole("dialog", { name: "Move or Copy" });
    await dlg.getByRole("option", { name: "(move to end)" }).click();
    await dlg.getByRole("checkbox", { name: "Create a copy" }).check();
    await dlg.getByRole("button", { name: "OK" }).click();
    await expect(sheets.getByRole("tab")).toHaveText(["Sheet1", "Sheet2", "Sheet1 (2)"]);
    await expect(sheets.getByRole("tab", { name: "Sheet1 (2)" })).toHaveAttribute("aria-selected", "true");
    expect(await grid.input(0, 0)).toBe("='Sheet1 (2)'!B1+1");
    await page.keyboard.press("Control+z");
    await expect(sheets.getByRole("tab")).toHaveText(["Sheet1", "Sheet2"]);
    errors.expectNone();
  });

  test("Unhide shows several picked sheets at once", async ({ page }) => {
    const errors = trackErrors(page);
    await openCalc(page);
    const sheets = page.getByRole("tablist", { name: "Sheets" });
    for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "Add sheet" }).click();
    await expect(sheets.getByRole("tab")).toHaveCount(4);
    await sheetMenu(page, "Sheet2", "Hide");
    await sheetMenu(page, "Sheet3", "Hide");
    await expect(sheets.getByRole("tab")).toHaveText(["Sheet1", "Sheet4"]);
    await sheetMenu(page, "Sheet1", "Unhide…");
    const dlg = page.getByRole("dialog", { name: "Unhide" });
    await dlg.getByRole("option", { name: "Sheet2" }).click();
    await dlg.getByRole("option", { name: "Sheet3" }).click({ modifiers: ["Control"] });
    await expect(dlg.getByRole("option", { selected: true })).toHaveCount(2);
    await shot(page, "unhide-several");
    await dlg.getByRole("button", { name: "OK" }).click();
    await expect(sheets.getByRole("tab")).toHaveText(["Sheet1", "Sheet2", "Sheet3", "Sheet4"]);
    // One undo step hides both again.
    await page.keyboard.press("Control+z");
    await expect(sheets.getByRole("tab")).toHaveText(["Sheet1", "Sheet4"]);
    errors.expectNone();
  });
});
