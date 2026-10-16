// P8-39 Calc quality pass: regression tests for the defects fixed (ids from docs/qa/calc-2026-10.md).
import { expect, test, type Page } from "@playwright/test";
import { ribbonCommand, saveViaBackstage, trackErrors } from "../support/common";
import { Grid, openCalc } from "../support/calc";
import { zipText } from "../support/zip";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

/** The system clipboard's text after Ctrl+C of the selection. */
async function copiedText(page: Page) {
  await page.keyboard.press("Control+c");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).not.toBe("");
  return page.evaluate(() => navigator.clipboard.readText());
}

/** Pixel position of the fill handle of a selection ending at (row, col). */
async function dragFillHandle(page: Page, grid: Grid, row: number, col: number, toRow: number) {
  const box = (await page.getByTestId("grid").boundingBox())!;
  const hx = box.x + 46 + 64 * (col + 1) - 1;
  const hy = box.y + 22 + 20 * (row + 1) - 1;
  await page.mouse.move(hx, hy);
  await page.mouse.down();
  const end = await grid.pos(toRow, col);
  await page.mouse.move(hx, hy + 30, { steps: 4 });
  await page.mouse.move(end.x, end.y, { steps: 6 });
  await page.mouse.up();
}

test.describe("Calc quality pass (P8-39)", () => {
  test("C-02 typed percentages, currencies, dates and times get Excel's formats; C-01 the clipboard has the displayed values", async ({ page }) => {
    const errors = trackErrors(page);
    await openCalc(page);
    const grid = new Grid(page);
    const typed = ["12%", "$1,234.50", "3/4/2024", "13:45", "1 1/2"];
    for (const [r, v] of typed.entries()) await grid.type(r, 0, v);
    await grid.type(0, 1, "=A1*2");
    // The formula bar shows the edit form (Excel): the percentage, the date, the time.
    expect(await grid.input(0, 0)).toBe("12%");
    expect(await grid.input(2, 0)).toBe("3/4/2024");
    expect(await grid.input(3, 0)).toBe("1:45:00 PM");
    // Ctrl+C puts what the cells show on the clipboard, formulas as their values.
    await grid.click(0, 0);
    await grid.click(4, 1, { shift: true });
    expect((await copiedText(page)).split("\n")).toEqual(["12%\t0.24", "$1,234.50\t", "3/4/2024\t", "13:45\t", "1 1/2\t"]);
    await page.keyboard.press("Escape");
    const xlsx = await saveViaBackstage(page);
    const sheet = zipText(xlsx, "xl/worksheets/sheet1.xml");
    expect(sheet).toMatch(/<c r="A1"[^>]*><v>0.12<\/v>/);
    expect(sheet).toMatch(/<c r="A3"[^>]*><v>45355<\/v>/);
    const styles = zipText(xlsx, "xl/styles.xml");
    // m/d/yyyy as a custom code; h:mm and # ?/? are Excel's built-in ids 20 and 12.
    expect(styles).toContain('formatCode="m/d/yyyy"');
    for (const id of [20, 12, 9]) expect(styles).toContain(`numFmtId="${id}"`);
    errors.expectNone();
  });

  test("C-17 a Text-formatted cell keeps a typed 0123 as text", async ({ page }) => {
    await openCalc(page);
    const grid = new Grid(page);
    await grid.click(0, 0);
    await page.getByTestId("ribbon").getByRole("group", { name: "Number" }).getByRole("button").first().click();
    await page.getByTestId("number-format-menu").getByRole("menuitem", { name: /^Text/ }).click();
    await grid.type(0, 0, "0123");
    expect(await grid.input(0, 0)).toBe("'0123");
    await grid.click(0, 0);
    expect(await copiedText(page)).toBe("0123");
  });

  test("C-10 a line break survives an edit in the formula bar", async ({ page }) => {
    await openCalc(page);
    const grid = new Grid(page);
    await grid.click(0, 0);
    await page.keyboard.type("line1");
    await page.keyboard.press("Alt+Enter");
    await page.keyboard.type("line2");
    await page.keyboard.press("Enter");
    await grid.click(0, 0);
    const bar = page.getByLabel("Formula bar");
    await expect(bar).toHaveValue("line1\nline2");
    await bar.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type("!");
    await page.keyboard.press("Enter");
    expect(await grid.input(0, 0)).toBe("line1\nline2!");
  });

  test("C-15 Ctrl+Enter keeps the active cell and fills the selection", async ({ page }) => {
    await openCalc(page);
    const grid = new Grid(page);
    await grid.click(0, 0);
    await grid.click(2, 1, { shift: true });
    await page.keyboard.type("=ROW()*10");
    await page.keyboard.press("Control+Enter");
    await expect(page.getByTestId("cell-address")).toHaveValue("A1:B3");
    await expect.poll(() => grid.input(2, 1)).toBe("=ROW()*10");
    expect(await grid.display(2, 1)).toBe("30");
    // A single cell: Ctrl+Enter commits without moving.
    await grid.click(5, 0);
    await page.keyboard.type("7");
    await page.keyboard.press("Control+Enter");
    await expect(page.getByTestId("cell-address")).toHaveValue("A6");
  });

  test("C-18 renaming a sheet rewrites the formulas that name it, in the formula bar and the saved file", async ({ page }) => {
    const errors = trackErrors(page);
    await openCalc(page);
    const grid = new Grid(page);
    const tabs = page.getByRole("tablist", { name: "Sheets" });
    await page.getByRole("button", { name: "Add sheet" }).click();
    await grid.type(0, 0, "42");
    await tabs.getByRole("tab", { name: "Sheet1" }).click();
    await grid.type(0, 0, "=Sheet2!A1+1");
    await tabs.getByRole("tab", { name: "Sheet2" }).dblclick();
    await page.keyboard.press("Control+a");
    await page.keyboard.type("Data 2");
    await page.keyboard.press("Enter");
    await expect(tabs.getByRole("tab", { name: "Data 2" })).toBeVisible();
    await tabs.getByRole("tab", { name: "Sheet1" }).click();
    expect(await grid.input(0, 0)).toBe("='Data 2'!A1+1");
    expect(await grid.display(0, 0)).toBe("43");
    const xlsx = await saveViaBackstage(page);
    expect(zipText(xlsx, "xl/worksheets/sheet1.xml")).toContain("<f>'Data 2'!A1+1</f>");
    errors.expectNone();
  });

  test("C-09 the fill handle continues weekdays and months", async ({ page }) => {
    await openCalc(page);
    const grid = new Grid(page);
    await grid.type(0, 0, "Mon");
    await grid.type(0, 1, "January");
    await grid.click(0, 0);
    await grid.click(0, 1, { shift: true });
    await dragFillHandle(page, grid, 0, 1, 2);
    await expect.poll(() => grid.input(2, 0)).toBe("Wed");
    expect(await grid.input(1, 0)).toBe("Tue");
    expect(await grid.input(2, 1)).toBe("March");
  });

  test("C-14 Ctrl+Shift+5 applies the percent format; C-06 Increase Decimal starts from the shown decimals", async ({ page }) => {
    await openCalc(page);
    const grid = new Grid(page);
    await grid.type(0, 0, "0.25");
    await grid.type(1, 0, "3.14159");
    await grid.click(0, 0);
    await page.keyboard.press("Control+Shift+Digit5");
    const numberBox = page.getByTestId("ribbon").getByRole("group", { name: "Number" }).getByRole("button").first();
    await expect(numberBox).toHaveText(/Percentage/);
    await grid.click(1, 0);
    await page.getByTestId("ribbon").getByRole("button", { name: "Increase decimal" }).click();
    const xlsx = await saveViaBackstage(page);
    const styles = zipText(xlsx, "xl/styles.xml");
    expect(styles).toContain('formatCode="0.000000"');
  });

  test("C-07 Format Cells › Custom lists Excel's built-in codes", async ({ page }) => {
    await openCalc(page);
    const grid = new Grid(page);
    await grid.type(0, 0, "5");
    await grid.click(0, 0);
    await page.keyboard.press("Control+1");
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("option", { name: "Custom", exact: true }).click();
    const list = dialog.getByRole("listbox", { name: "Format codes" });
    const option = list.getByRole("option", { name: "#,##0.00", exact: true });
    await expect(option).toBeVisible();
    expect((await option.boundingBox())!.height).toBeGreaterThan(10);
  });
});

for (const [locale, width, editing, sortLabel, sortItem] of [
  ["en-US", 1024, "Editing", /^Sort & Filter/, /Sort A to Z/],
  ["de-DE", 1024, "Bearbeiten", /^Sortieren und Filtern/, /Von A bis Z sortieren/],
  ["de-DE", 1400, "Bearbeiten", /^Sortieren und Filtern/, /Von A bis Z sortieren/],
  ["en-US", 1400, "Editing", /^Sort & Filter/, /Sort A to Z/],
] as const) {
  test.describe(`Calc ribbon at ${width} px, ${locale} (P8-39 C-03)`, () => {
    test.use({ locale, viewport: { width, height: 700 } });

    test("every group is reachable (collapsed groups open their commands); the sort menu stays in the window", async ({ page }) => {
      await page.goto("calc/");
      await page.getByTestId("grid").waitFor();
      // No group sticks out of the window: the ones that do not fit collapse into a button.
      const groups = page.getByTestId("ribbon-panel").getByRole("group");
      await expect.poll(async () => Math.max(...(await groups.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().right))))).toBeLessThanOrEqual(width);
      await ribbonCommand(page, editing, sortLabel, false);
      const item = page.getByRole("menuitem", { name: sortItem });
      await expect(item).toBeVisible();
      const box = (await item.boundingBox())!;
      expect(box.x + box.width).toBeLessThanOrEqual(width);
    });
  });
}
