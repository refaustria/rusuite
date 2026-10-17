// P9-C5 (cycle 3.141): conditional formatting, validation and sorting round 2 – an "A Date Occurring" rule
// highlights today's row and survives save/reopen; a data bar over negative values draws an axis and saves
// x14:dataBar; copying a cell with a rule extends the rule's range; Circle Invalid Data circles a wrong
// entry and a Stop alert blocks typing; Put Selected Cell Color On Top and a date-group filter.
import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { openViaBackstage, saveViaBackstage, trackErrors } from "../support/common";
import { Grid, openCalc } from "../support/calc";
import { zipText } from "../support/zip";

const shot = async (page: Page, name: string) => {
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/P9-C5-${name}.png` });
};

/** Pixels of the cell canvas (cell-area px) that have the colour `rgb` (±40). */
async function pixels(page: Page, points: [number, number][], rgb: [number, number, number]) {
  return page.getByTestId("grid-cells").evaluate((el, { points, rgb }) => {
    const canvas = el as HTMLCanvasElement;
    const ctx = canvas.getContext("2d")!;
    const scale = canvas.width / canvas.clientWidth;
    return points.filter(([x, y]) => {
      const d = ctx.getImageData(Math.floor(x * scale), Math.floor(y * scale), 1, 1).data;
      return Math.abs(d[0]! - rgb[0]) < 40 && Math.abs(d[1]! - rgb[1]) < 40 && Math.abs(d[2]! - rgb[2]) < 40;
    }).length;
  }, { points, rgb });
}

/** The left part of cell (row, 0) – numbers are right-aligned, so their fill shows there. */
const leftOf = (row: number): [number, number][] => [[6, row * 20 + 6], [10, row * 20 + 10], [20, row * 20 + 14]];
const LIGHT_RED: [number, number, number] = [0xff, 0xc7, 0xce];

async function cfMenu(page: Page) {
  await page.getByRole("tab", { name: "Home" }).click();
  await page.getByRole("button", { name: "Conditional Formatting" }).click();
}

test.describe("Calc P9-C5 conditional formatting, validation and sorting", () => {
  test("A Date Occurring › Today highlights today's row and survives save and reopen", async ({ page }, info) => {
    const errors = trackErrors(page);
    await openCalc(page);
    const grid = new Grid(page);
    await grid.type(0, 0, "=TODAY()-40");
    await grid.type(1, 0, "=TODAY()");
    await grid.type(2, 0, "=TODAY()+40");
    await grid.click(0, 0);
    await grid.click(2, 0, { shift: true });
    await cfMenu(page);
    await page.getByRole("menuitem", { name: "Highlight Cells Rules" }).click();
    await page.getByRole("menuitem", { name: "A Date Occurring…" }).click();
    const dlg = page.getByRole("dialog", { name: "A Date Occurring" });
    await dlg.getByLabel("Period").selectOption("today");
    await dlg.getByRole("button", { name: "OK" }).click();
    // Away from the selection (its tint is close to the light red).
    await grid.click(6, 3);
    await expect.poll(() => pixels(page, leftOf(1), LIGHT_RED)).toBe(3);
    await expect.poll(() => pixels(page, leftOf(0), LIGHT_RED)).toBe(0);
    await expect.poll(() => pixels(page, leftOf(2), LIGHT_RED)).toBe(0);
    await shot(page, "date-occurring");
    const xlsx = await saveViaBackstage(page);
    expect(zipText(xlsx, "xl/worksheets/sheet1.xml")).toMatch(/<cfRule type="timePeriod"[^>]*timePeriod="today"><formula>FLOOR\(A1,1\)=TODAY\(\)<\/formula>/);
    const file = info.outputPath("date-occurring.xlsx");
    fs.writeFileSync(file, xlsx);
    await page.reload();
    await openCalc(page);
    await openViaBackstage(page, file);
    await grid.click(6, 3);
    await expect.poll(() => pixels(page, leftOf(1), LIGHT_RED)).toBe(3);
    expect(await pixels(page, leftOf(0), LIGHT_RED)).toBe(0);
    errors.expectNone();
  });

  test("a data bar over negative values draws the zero axis and saves x14:dataBar", async ({ page }) => {
    const errors = trackErrors(page);
    await openCalc(page);
    const grid = new Grid(page);
    for (const [i, v] of ["-2", "1", "3"].entries()) await grid.type(i, 0, v);
    await grid.click(0, 0);
    await grid.click(2, 0, { shift: true });
    await cfMenu(page);
    await page.getByRole("menuitem", { name: "Data Bars" }).click();
    await page.getByRole("menuitem", { name: "Blue Data Bar", exact: true }).click();
    type Bar = { op: string; row: number; x: number; w: number; negative: boolean; axisX?: number; color: string };
    const bars = () =>
      page.evaluate(() =>
        ((window as unknown as { __calcCfOps?: Bar[] }).__calcCfOps ?? []).filter((o) => o.op === "bar").map((o) => ({ ...o })),
      );
    await expect.poll(async () => (await bars()).length).toBe(3);
    const [neg, one, three] = await bars();
    // Automatic axis at 2/5 of the cell: the negative bar ends there in red, the positive ones start there.
    expect(neg!.negative).toBe(true);
    expect(neg!.color).toBe("#FF0000");
    expect(neg!.axisX).toBeDefined();
    expect(Math.round(neg!.x + neg!.w)).toBe(Math.round(neg!.axisX!));
    expect(Math.round(one!.x)).toBe(Math.round(one!.axisX!));
    expect(three!.w).toBeGreaterThan(one!.w);
    await shot(page, "data-bar-axis");
    const xml = zipText(await saveViaBackstage(page), "xl/worksheets/sheet1.xml");
    expect(xml).toContain("<x14:dataBar");
    expect(xml).toMatch(/<x14:cfvo type="autoMin"\/><x14:cfvo type="autoMax"\/>/);
    expect(xml).toMatch(/<cfRule type="dataBar"[^>]*>.*<x14:id>\{[0-9A-F-]+\}<\/x14:id>/);
    errors.expectNone();
  });

  test("copying a cell with a rule onto the cells below extends the rule's range", async ({ page }) => {
    const errors = trackErrors(page);
    await openCalc(page);
    const grid = new Grid(page);
    for (const [i, v] of ["8", "2", "9"].entries()) await grid.type(i, 0, v);
    await grid.click(0, 0);
    await cfMenu(page);
    await page.getByRole("menuitem", { name: "Highlight Cells Rules" }).click();
    await page.getByRole("menuitem", { name: "Greater Than…" }).click();
    const dlg = page.getByRole("dialog", { name: "Greater Than" });
    await dlg.getByLabel("Value").fill("5");
    await dlg.getByRole("button", { name: "OK" }).click();
    await expect.poll(() => pixels(page, leftOf(0), LIGHT_RED)).toBe(3);
    await page.keyboard.press("Control+c");
    await grid.click(1, 0);
    await grid.click(2, 0, { shift: true });
    await page.keyboard.press("Control+v");
    // A3 = 8 (pasted) is highlighted by the extended rule.
    await expect.poll(() => pixels(page, leftOf(2), LIGHT_RED)).toBe(3);
    await grid.click(0, 0);
    await cfMenu(page);
    await page.getByRole("menuitem", { name: "Manage Rules…" }).click();
    const mgr = page.getByRole("dialog", { name: "Conditional Formatting Rules Manager" });
    await expect(mgr.getByTestId("cf-rule-row")).toHaveCount(1);
    await expect(mgr.getByLabel("Applies to")).toHaveValue("=$A$1:$A$3");
    await shot(page, "rule-extended");
    await mgr.getByRole("button", { name: "Cancel" }).click();
    errors.expectNone();
  });

  test("Circle Invalid Data circles a wrong entry; a Stop alert blocks typing", async ({ page }) => {
    const errors = trackErrors(page);
    await openCalc(page);
    const grid = new Grid(page);
    await grid.type(1, 1, "50");
    await grid.click(1, 1);
    await grid.click(4, 1, { shift: true });
    await page.getByRole("tab", { name: "Data" }).click();
    await page.getByRole("button", { name: "Data Validation", exact: true }).click();
    const dlg = page.getByRole("dialog", { name: "Data Validation" });
    await dlg.getByLabel("Allow:").selectOption("whole");
    await dlg.getByLabel("Minimum:").fill("1");
    await dlg.getByLabel("Maximum:").fill("10");
    await dlg.getByRole("button", { name: "OK" }).click();
    await page.getByRole("button", { name: "Data Validation options" }).click();
    await page.getByRole("menuitem", { name: "Circle Invalid Data" }).click();
    await expect(page.getByTestId("grid-cells")).toHaveAttribute("data-circles", "1,1");
    await shot(page, "circles");
    // A Stop alert: Retry / Cancel; Cancel leaves the cell as it was.
    await grid.click(2, 1);
    await page.keyboard.type("20");
    await page.keyboard.press("Enter");
    const alert = page.getByTestId("validation-alert");
    await expect(alert).toHaveAttribute("data-style", "stop");
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(alert).toHaveCount(0);
    expect(await grid.input(2, 1)).toBe("");
    // Correcting the circled cell removes its circle.
    await grid.type(1, 1, "5");
    await expect(page.getByTestId("grid-cells")).toHaveAttribute("data-circles", "");
    errors.expectNone();
  });

  test("Put Selected Cell Color On Top, and a date-group filter from the date tree", async ({ page }) => {
    const errors = trackErrors(page);
    await openCalc(page);
    const grid = new Grid(page);
    for (const [i, v] of ["1", "4", "2", "3"].entries()) await grid.type(i, 0, v);
    await grid.click(0, 0);
    await grid.click(3, 0, { shift: true });
    await cfMenu(page);
    await page.getByRole("menuitem", { name: "Highlight Cells Rules" }).click();
    await page.getByRole("menuitem", { name: "Greater Than…" }).click();
    const dlg = page.getByRole("dialog", { name: "Greater Than" });
    await dlg.getByLabel("Value").fill("2.5");
    await dlg.getByRole("button", { name: "OK" }).click();
    await expect.poll(() => pixels(page, leftOf(1), LIGHT_RED)).toBe(3);
    // Right-click the red 4 (A2): its colour (from the rule) goes on top.
    await grid.click(1, 0);
    await grid.click(1, 0, { button: "right" });
    await page.getByRole("menu", { name: "Cell" }).getByRole("menuitem", { name: "Put Selected Cell Color On Top" }).click();
    await expect.poll(() => grid.input(0, 0)).toBe("4");
    expect(await grid.input(1, 0)).toBe("3");
    expect(await grid.input(2, 0)).toBe("1");
    expect(await grid.input(3, 0)).toBe("2");

    // Dates in C: the filter dropdown shows a year › month tree.
    for (const [i, v] of ["Day", "2024-01-05", "2024-02-03", "2025-03-01"].entries()) await grid.type(i, 2, v);
    await grid.click(0, 2);
    await page.getByRole("tab", { name: "Data" }).click();
    await page.getByRole("button", { name: "Filter", exact: true }).click();
    const q = await grid.pos(0, 2, 64 / 2 - 9, 1);
    await page.mouse.click(q.x, q.y);
    const panel = page.getByTestId("filter-panel");
    await expect(panel.getByTestId("date-node")).toHaveCount(2);
    await panel.getByLabel("2025", { exact: true }).uncheck();
    await panel.getByRole("button", { name: "Expand 2024" }).click();
    await panel.getByLabel("February", { exact: true }).uncheck();
    await shot(page, "date-tree");
    await panel.getByRole("button", { name: "OK" }).click();
    await expect(page.getByTestId("filter-panel")).toHaveCount(0);
    const xml = zipText(await saveViaBackstage(page), "xl/worksheets/sheet1.xml");
    expect(xml).toContain('<dateGroupItem year="2024" month="1" dateTimeGrouping="month"/>');
    expect(xml).toMatch(/<row r="3"[^>]*hidden="1"/);
    expect(xml).toMatch(/<row r="4"[^>]*hidden="1"/);
    expect(xml).toMatch(/<sortState ref="A1:A4"><sortCondition sortBy="cellColor" ref="A1:A4" dxfId="\d+"\/>/);
    errors.expectNone();
  });
});
