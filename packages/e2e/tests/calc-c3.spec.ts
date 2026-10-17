// P9-C3 (cycle 3.141): pivot tables round 2 – a date field grouped by Months and Years (surviving save →
// reopen), a Top 10 value filter, Show Values As % of Grand Total, Show Details on a new sheet and a
// PivotChart whose series follow the table's filter.
import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { openViaBackstage, saveViaBackstage, trackErrors } from "../support/common";
import { Grid, openCalc } from "../support/calc";
import { zipText } from "../support/zip";

const shot = async (page: Page, name: string) => {
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/P9-C3-${name}.png` });
};

/** Date / Region / Product / Sales in A1:D7. */
async function salesTable(grid: Grid) {
  const rows = [
    ["Date", "Region", "Product", "Sales"],
    ["2024-01-15", "East", "Apple", "10"],
    ["2024-02-03", "East", "Pear", "20"],
    ["2024-02-20", "West", "Apple", "30"],
    ["2025-01-05", "North", "Apple", "50"],
    ["2025-03-09", "East", "Apple", "60"],
    ["2025-03-30", "North", "Pear", "70"],
  ];
  for (const [r, row] of rows.entries()) for (const [c, v] of row.entries()) await grid.type(r, c, v);
}

/** Insert › PivotTable from A1 onto a new sheet; resolves with the field pane. */
async function insertPivot(page: Page, grid: Grid) {
  await grid.click(0, 0);
  await page.getByRole("tab", { name: "Insert" }).click();
  await page.getByRole("button", { name: "PivotTable", exact: true }).click();
  const dlg = page.getByRole("dialog", { name: "Create PivotTable" });
  await expect(dlg.getByTestId("pivot-source")).toHaveValue("Sheet1!$A$1:$D$7");
  await dlg.getByRole("button", { name: "OK" }).click();
  await expect(page.getByRole("tab", { name: "Sheet2" })).toHaveAttribute("aria-selected", "true");
  const pane = page.getByTestId("pivot-pane");
  await expect(pane.getByRole("checkbox", { name: "Region" })).toBeVisible();
  return pane;
}

/** A cell's input through the Name Box (the table widens its columns, so positions move). */
async function cell(grid: Grid, row: number, col: number) {
  const box = grid.page.getByTestId("cell-address");
  await box.fill(`${String.fromCharCode(65 + col)}${row + 1}`);
  await box.press("Enter");
  return grid.page.getByLabel("Formula bar").inputValue();
}

interface Button { kind: string; row: number; col: number; x: number; y: number; size: number }
const buttons = (page: Page) => page.evaluate(() => (window as unknown as { __calcPivotButtons?: Button[] }).__calcPivotButtons ?? []);

/** Clicks the dropdown button of the header cell at (row, col). */
async function openDropdown(page: Page, row: number, col: number) {
  await expect.poll(async () => (await buttons(page)).some((b) => b.kind === "drop" && b.row === row && b.col === col)).toBe(true);
  const b = (await buttons(page)).find((x) => x.kind === "drop" && x.row === row && x.col === col)!;
  const box = (await page.getByTestId("grid-cells").boundingBox())!;
  await page.mouse.click(box.x + b.x + b.size / 2, box.y + b.y + b.size / 2);
  return page.getByTestId("pivot-filter-panel");
}

interface SceneItem { t: string; el?: { type: string; series?: number } }
const chartSeries = (page: Page) =>
  page.evaluate(() => {
    const charts = (window as unknown as { __calcCharts?: { scene: { items: SceneItem[] } | null }[] }).__calcCharts ?? [];
    const items = charts[0]?.scene?.items ?? [];
    return new Set(items.filter((i) => i.t === "rect" && i.el?.type === "series").map((i) => i.el!.series)).size;
  });

test.describe("Calc P9-C3 pivot tables", () => {
  test("a date field grouped by Months and Years shows both levels and survives save → reopen", async ({ page }) => {
    const errors = trackErrors(page);
    await openCalc(page);
    const grid = new Grid(page);
    await salesTable(grid);
    const pane = await insertPivot(page, grid);
    await pane.getByRole("checkbox", { name: "Date", exact: true }).check();
    await pane.getByRole("checkbox", { name: "Sales" }).check();
    await expect.poll(() => cell(grid, 9, 0)).toBe("Grand Total");
    // A date label is the active field: Analyze › Group Field.
    await cell(grid, 3, 0);
    await page.getByRole("tab", { name: "PivotTable Analyze" }).click();
    await page.getByRole("button", { name: "Group Field" }).click();
    const dlg = page.getByTestId("pivot-group-dialog");
    await expect(dlg.getByRole("option", { name: "Months" })).toHaveAttribute("aria-selected", "true");
    await dlg.getByRole("option", { name: "Years" }).click();
    await shot(page, "grouping-dialog");
    await dlg.getByRole("button", { name: "OK" }).click();
    // 2024 / Jan / Feb / 2025 / Jan / Mar / Grand Total.
    await expect.poll(() => cell(grid, 3, 0)).toMatch(/^'?2024$/);
    expect(await cell(grid, 4, 0)).toBe("Jan");
    expect(await cell(grid, 5, 0)).toBe("Feb");
    expect(await cell(grid, 6, 0)).toMatch(/^'?2025$/);
    expect(await cell(grid, 8, 0)).toBe("Mar");
    expect(await cell(grid, 3, 1)).toBe("60");
    expect(await cell(grid, 8, 1)).toBe("130");
    expect(await cell(grid, 9, 1)).toBe("240");
    await expect(pane.getByTestId("pivot-area-rows")).toContainText("Years");
    await shot(page, "grouped");
    const xlsx = await saveViaBackstage(page);
    const def = zipText(xlsx, "xl/pivotCache/pivotCacheDefinition1.xml");
    expect(def).toContain('groupBy="months"');
    expect(def).toContain('<cacheField name="Years" numFmtId="0" databaseField="0">');
    const file = test.info().outputPath("grouped.xlsx");
    fs.writeFileSync(file, xlsx);
    await page.goto("about:blank");
    await openCalc(page);
    await openViaBackstage(page, file);
    await page.getByRole("tab", { name: "Sheet2" }).click();
    await expect.poll(() => cell(grid, 3, 0)).toMatch(/^'?2024$/);
    expect(await cell(grid, 6, 0)).toMatch(/^'?2025$/);
    expect(await cell(grid, 9, 1)).toBe("240");
    await expect(page.getByTestId("pivot-pane").getByTestId("pivot-area-rows")).toContainText("Years");
    errors.expectNone();
  });

  test("a Top 10 value filter keeps the two largest regions", async ({ page }) => {
    const errors = trackErrors(page);
    await openCalc(page);
    const grid = new Grid(page);
    await salesTable(grid);
    const pane = await insertPivot(page, grid);
    await pane.getByRole("checkbox", { name: "Region" }).check();
    await pane.getByRole("checkbox", { name: "Sales" }).check();
    await expect.poll(() => cell(grid, 6, 0)).toBe("Grand Total");
    const panel = await openDropdown(page, 2, 0);
    await panel.getByTestId("pivot-value-filters").getByRole("button", { name: /Value Filters/ }).click();
    await panel.getByRole("menuitem", { name: "Top 10…" }).click();
    const dlg = page.getByTestId("pivot-filter-rule");
    await expect(page.getByRole("dialog", { name: "Top 10 Filter (Region)" })).toBeVisible();
    await dlg.getByLabel("Count").fill("2");
    await dlg.getByRole("button", { name: "OK" }).click();
    // East 90, North 120; West (30) is filtered out with its total.
    await expect.poll(() => cell(grid, 5, 0)).toBe("Grand Total");
    expect(await cell(grid, 3, 0)).toBe("East");
    expect(await cell(grid, 4, 0)).toBe("North");
    expect(await cell(grid, 5, 1)).toBe("210");
    await shot(page, "top10");
    errors.expectNone();
  });

  test("Show Values As % of Grand Total", async ({ page }) => {
    const errors = trackErrors(page);
    await openCalc(page);
    const grid = new Grid(page);
    await salesTable(grid);
    const pane = await insertPivot(page, grid);
    await pane.getByRole("checkbox", { name: "Region" }).check();
    await pane.getByRole("checkbox", { name: "Sales" }).check();
    await expect.poll(() => cell(grid, 3, 1)).toBe("90");
    await page.getByRole("tab", { name: "PivotTable Analyze" }).click();
    await page.getByRole("button", { name: "Field Settings" }).click();
    const dlg = page.getByRole("dialog", { name: "Value Field Settings" });
    await dlg.getByRole("tab", { name: "Show Values As" }).click();
    await dlg.getByLabel("Show Values As", { exact: true }).selectOption({ label: "% of Grand Total" });
    await dlg.getByRole("button", { name: "OK" }).click();
    // East 90 / 240.
    await expect.poll(() => cell(grid, 3, 1)).toMatch(/^37[.,]5\s?%$/);
    expect(await cell(grid, 6, 1)).toMatch(/^100\s?%$/);
    await shot(page, "percent-of-total");
    errors.expectNone();
  });

  test("Show Details: double-clicking a value puts its records on a new sheet", async ({ page }) => {
    const errors = trackErrors(page);
    await openCalc(page);
    const grid = new Grid(page);
    await salesTable(grid);
    const pane = await insertPivot(page, grid);
    await pane.getByRole("checkbox", { name: "Region" }).check();
    await pane.getByRole("checkbox", { name: "Sales" }).check();
    await expect.poll(() => cell(grid, 3, 1)).toBe("90");
    // B4 (East, 90): right of the Row Labels dropdown (A3), one row down.
    await expect.poll(async () => (await buttons(page)).some((b) => b.kind === "drop" && b.row === 2 && b.col === 0)).toBe(true);
    const b = (await buttons(page)).find((x) => x.kind === "drop" && x.row === 2 && x.col === 0)!;
    const box = (await page.getByTestId("grid-cells").boundingBox())!;
    await page.mouse.dblclick(box.x + b.x + b.size + 20, box.y + b.y + b.size / 2 + 20);
    await expect(page.getByRole("tab", { name: "Sheet3" })).toHaveAttribute("aria-selected", "true");
    expect(await cell(grid, 0, 0)).toBe("Date");
    expect(await cell(grid, 0, 3)).toBe("Sales");
    for (const r of [1, 2, 3]) expect(await cell(grid, r, 1)).toBe("East");
    expect(await cell(grid, 4, 1)).toBe("");
    expect(await cell(grid, 3, 3)).toBe("60");
    await shot(page, "details");
    errors.expectNone();
  });

  test("Insert › PivotChart draws the table's series, which follow its filter", async ({ page }) => {
    const errors = trackErrors(page);
    await openCalc(page);
    const grid = new Grid(page);
    await salesTable(grid);
    const pane = await insertPivot(page, grid);
    await pane.getByRole("checkbox", { name: "Region" }).check();
    await pane.getByRole("checkbox", { name: "Sales" }).check();
    await expect.poll(() => cell(grid, 3, 1)).toBe("90");
    // Product on Columns: two series (Apple, Pear).
    await pane.getByRole("button", { name: "Options for Region" }).waitFor();
    await page.getByRole("tab", { name: "Insert" }).click();
    await page.getByRole("button", { name: "PivotChart" }).click();
    await expect(page.getByRole("tab", { name: "Chart Design" })).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => chartSeries(page)).toBe(1);
    await cell(grid, 3, 0);
    await page.getByTestId("pivot-pane").getByRole("checkbox", { name: "Product" }).check();
    // Product goes to Rows by default: move it to Columns through its menu.
    await page.getByTestId("pivot-pane").getByRole("button", { name: "Options for Product" }).click();
    await page.getByRole("menuitem", { name: "Move to Column Labels" }).click();
    await expect.poll(() => chartSeries(page)).toBe(2);
    await shot(page, "pivot-chart");
    // Untick Pear in the Column Labels dropdown: one series is left.
    const panel = await openDropdown(page, 2, 1);
    await panel.getByRole("checkbox", { name: "Pear" }).uncheck();
    await panel.getByRole("button", { name: "OK" }).click();
    await expect.poll(() => chartSeries(page)).toBe(1);
    const xlsx = await saveViaBackstage(page);
    expect(zipText(xlsx, "xl/charts/chart1.xml")).toContain("<c:pivotSource><c:name>Sheet2!PivotTable1</c:name>");
    errors.expectNone();
  });
});
