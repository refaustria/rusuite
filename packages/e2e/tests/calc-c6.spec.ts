// P9-C6 (cycle 3.141): charts round 2 and sparklines – a gradient chart area and rotated category labels
// survive save and reopen; error bars and a data table on a column chart; Move Chart to a new chart
// sheet (tab, full-size chart, its own print page); line sparklines with high/low points saved as
// x14:sparklineGroups and drawn after reopening; deleting the source sheet leaves #REF! series and a
// chart that still saves.
import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { openPrint, openViaBackstage, saveViaBackstage, trackErrors } from "../support/common";
import { Grid, openCalc } from "../support/calc";
import { zipText } from "../support/zip";

const shot = async (page: Page, name: string) => {
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/P9-C6-${name}.png` });
};

interface SceneItem { t: string; x: number; y: number; w: number; h: number; text?: string; rotate?: number; gradient?: unknown; el?: { type: string; axis?: string; series?: number } }
interface ChartHook { id: number; rect: { x: number; y: number; w: number; h: number }; scene: { items: SceneItem[] } | null }
const charts = (page: Page) => page.evaluate(() => (window as unknown as { __calcCharts?: ChartHook[] }).__calcCharts ?? []);
const items = async (page: Page) => (await charts(page))[0]?.scene?.items ?? [];
const sparklines = (page: Page) =>
  page.evaluate(() => (window as unknown as { __calcSparklines?: { group: { high?: boolean; low?: boolean; sparklines: unknown[] }; data: { values: (number | null)[] }[] }[] }).__calcSparklines ?? []);

/** Quarter / North / South in A1:C5 (long quarter names, so the labels need rotating), the range selected. */
async function table(grid: Grid, long = false) {
  const q = long ? ["First quarter", "Second quarter", "Third quarter", "Fourth quarter"] : ["Q1", "Q2", "Q3", "Q4"];
  const rows = [["", "North", "South"], [q[0]!, "10", "20"], [q[1]!, "25", "5"], [q[2]!, "15", "8"], [q[3]!, "30", "12"]];
  for (const [r, row] of rows.entries()) for (const [c, v] of row.entries()) if (v) await grid.type(r, c, v);
  await grid.click(0, 0);
  await grid.click(4, 2, { shift: true });
}

async function insertColumn(page: Page) {
  await page.getByRole("tab", { name: "Insert", exact: true }).click();
  await page.getByRole("button", { name: "Column or Bar Chart" }).click();
  await page.getByTestId("chart-gallery-columnBar").getByRole("button", { name: "Clustered Column", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Chart Design" })).toHaveAttribute("aria-selected", "true");
  await expect.poll(async () => (await items(page)).filter((i) => i.el?.type === "series").length).toBeGreaterThan(3);
}

/** Format › Current Selection: pick an element and open the Format pane on it. */
async function formatElement(page: Page, label: string) {
  await page.getByRole("tab", { name: "Format", exact: true }).click();
  await page.getByLabel("Chart Elements", { exact: true }).selectOption({ label });
  await page.getByRole("button", { name: "Format Selection" }).click();
  await expect(page.getByTestId("chart-format-pane")).toBeVisible();
}

/** Chart Design › Add Chart Element › `menu` › `item`. */
async function addElement(page: Page, menu: string, item: string) {
  await page.getByRole("tab", { name: "Chart Design" }).click();
  await page.getByRole("button", { name: "Add Chart Element" }).click();
  const root = page.getByTestId("chart-element-menu");
  await root.getByRole("menuitem", { name: menu }).click();
  await page.getByRole("menu", { name: menu }).getByRole("menuitemradio", { name: item }).click();
}

test.describe("Calc P9-C6 charts round 2 and sparklines", () => {
  test("a gradient chart area and rotated category labels are saved and drawn after reopening", async ({ page }, info) => {
    const errors = trackErrors(page);
    await openCalc(page);
    const grid = new Grid(page);
    await table(grid);
    await insertColumn(page);
    await formatElement(page, "Chart Area");
    const pane = page.getByTestId("chart-format-pane");
    await pane.getByTestId("chart-fill").getByRole("radio", { name: "Gradient fill" }).click();
    await expect.poll(async () => !!(await items(page))[0]?.gradient).toBe(true);
    await formatElement(page, "Horizontal (Category) Axis");
    await pane.getByTestId("text-angle").fill("-45");
    await pane.getByTestId("text-angle").press("Enter");
    const rotated = async () => (await items(page)).filter((i) => i.t === "text" && i.el?.type === "axis" && i.el.axis === "cat" && i.rotate === -45).length;
    await expect.poll(rotated).toBe(4);
    await shot(page, "gradient-rotated");
    const xlsx = await saveViaBackstage(page);
    const chart = zipText(xlsx, "xl/charts/chart1.xml");
    expect(chart).toMatch(/<\/c:chart><c:spPr><a:gradFill rotWithShape="1"><a:gsLst>/);
    expect(chart).toContain('<a:lin ang="5400000" scaled="1"/>');
    expect(chart).toMatch(/<c:catAx>.*<c:txPr><a:bodyPr rot="-2700000" vert="horz"\/>.*<\/c:catAx>/s);
    const file = info.outputPath("gradient.xlsx");
    fs.writeFileSync(file, xlsx);
    await page.reload();
    await openCalc(page);
    await openViaBackstage(page, file);
    await expect.poll(async () => !!(await items(page))[0]?.gradient).toBe(true);
    await expect.poll(rotated).toBe(4);
    errors.expectNone();
  });

  test("error bars and a data table on a column chart", async ({ page }) => {
    const errors = trackErrors(page);
    await openCalc(page);
    const grid = new Grid(page);
    await table(grid);
    await insertColumn(page);
    await addElement(page, "Error Bars", "Standard Error");
    await expect.poll(async () => (await items(page)).filter((i) => i.el?.type === "errorBars").length).toBe(8);
    await addElement(page, "Data Table", "With Legend Keys");
    await expect.poll(async () => (await items(page)).filter((i) => i.el?.type === "dataTable" && i.t === "text").map((i) => i.text)).toEqual(
      expect.arrayContaining(["Q1", "Q4", "North", "South", "25", "12"]),
    );
    await shot(page, "error-bars-table");
    const xlsx = await saveViaBackstage(page);
    const chart = zipText(xlsx, "xl/charts/chart1.xml");
    expect(chart.match(/<c:errBars><c:errBarType val="both"\/><c:errValType val="stdErr"\/>/g)).toHaveLength(2);
    expect(chart).toContain("<c:dTable><c:showHorzBorder val=\"1\"/><c:showVertBorder val=\"1\"/><c:showOutline val=\"1\"/><c:showKeys val=\"1\"/></c:dTable>");
    errors.expectNone();
  });

  test("Move Chart › New sheet: a chart sheet tab with the chart full-size, printed as its own page", async ({ page }) => {
    const errors = trackErrors(page);
    await openCalc(page);
    const grid = new Grid(page);
    await table(grid);
    await insertColumn(page);
    await page.getByRole("button", { name: "Move Chart" }).click();
    await page.getByRole("radio", { name: /New sheet/ }).click();
    await page.getByRole("dialog", { name: "Move Chart" }).getByRole("button", { name: "OK" }).click();
    const sheets = page.getByRole("tablist", { name: "Sheets" });
    await expect(sheets.getByRole("tab", { name: "Chart1" })).toHaveAttribute("aria-selected", "true");
    // The chart fills the grid area (no headings) and stays selected (Chart Design shows).
    const box = (await page.getByTestId("grid").boundingBox())!;
    await expect.poll(async () => (await charts(page))[0]?.rect.w ?? 0).toBeGreaterThan(box.width - 30);
    await expect(page.getByRole("tab", { name: "Chart Design" })).toBeVisible();
    await shot(page, "chart-sheet");
    const xlsx = await saveViaBackstage(page);
    expect(zipText(xlsx, "xl/workbook.xml")).toContain('<sheet name="Chart1" sheetId="1" r:id="rId1"/>');
    expect(zipText(xlsx, "xl/chartsheets/sheet1.xml")).toContain("<drawing r:id=");
    expect(zipText(xlsx, "xl/drawings/drawing1.xml")).toContain("xdr:absoluteAnchor");
    // (The print preview's sandboxed frame logs a blocked-script message of its own.)
    errors.expectNone();
    // The chart sheet prints as one page with the chart.
    await openPrint(page);
    await expect(page.getByTestId("print-page-count")).toHaveText("Page 1 of 1");
    const html = (await page.getByTestId("print-preview").getAttribute("srcdoc")) ?? "";
    expect(html).toContain('class="rs-calc-chartsheet"');
    expect(html).toContain(">North</text>");
  });

  test("line sparklines with high and low points are saved as x14:sparklineGroups and drawn after reopening", async ({ page }, info) => {
    const errors = trackErrors(page);
    await openCalc(page);
    const grid = new Grid(page);
    await table(grid);
    await grid.click(1, 1);
    await grid.click(4, 2, { shift: true });
    await page.getByRole("tab", { name: "Insert", exact: true }).click();
    await page.getByRole("button", { name: "Line", exact: true }).click();
    const dlg = page.getByTestId("sparkline-dialog");
    await expect(dlg.getByTestId("spark-data")).toHaveValue("B2:C5");
    await dlg.getByTestId("spark-location").fill("B7:C7");
    await dlg.getByRole("button", { name: "OK" }).click();
    await expect.poll(async () => (await sparklines(page))[0]?.group.sparklines.length ?? 0).toBe(2);
    await grid.click(6, 1);
    await page.getByRole("tab", { name: "Sparkline", exact: true }).click();
    await page.getByTestId("spark-high").click();
    await expect.poll(async () => (await sparklines(page))[0]?.group.high ?? false).toBe(true);
    await page.getByTestId("spark-low").click();
    await expect.poll(async () => (await sparklines(page))[0]?.group.low ?? false).toBe(true);
    // The line is drawn in B7 (dark blue of style 1 over white).
    const cell = await grid.pos(6, 1);
    const gridBox = (await page.getByTestId("grid-cells").boundingBox())!;
    const dark = await page.getByTestId("grid-cells").evaluate((el, { x, y }) => {
      const canvas = el as HTMLCanvasElement;
      const s = canvas.width / canvas.clientWidth;
      const d = canvas.getContext("2d")!.getImageData(Math.floor((x - 30) * s), Math.floor((y - 9) * s), Math.floor(60 * s), Math.floor(18 * s)).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i]! < 140 && d[i + 2]! > 60 && d[i]! + d[i + 1]! + d[i + 2]! < 450) n++;
      return n;
    }, { x: cell.x - gridBox.x, y: cell.y - gridBox.y });
    expect(dark).toBeGreaterThan(10);
    await shot(page, "sparklines");
    const xlsx = await saveViaBackstage(page);
    const sheet = zipText(xlsx, "xl/worksheets/sheet1.xml");
    expect(sheet).toMatch(/<ext uri="\{05C60535-1F16-4fd2-B633-F4F36F0B64E0\}"[^>]*><x14:sparklineGroups[^>]*><x14:sparklineGroup [^>]*high="1" low="1"/);
    expect(sheet).toContain("<x14:sparkline><xm:f>Sheet1!B2:B5</xm:f><xm:sqref>B7</xm:sqref></x14:sparkline>");
    const file = info.outputPath("sparklines.xlsx");
    fs.writeFileSync(file, xlsx);
    await page.reload();
    await openCalc(page);
    await openViaBackstage(page, file);
    await expect.poll(async () => (await sparklines(page))[0]?.data[0]?.values ?? []).toEqual([10, 25, 15, 30]);
    expect((await sparklines(page))[0]!.group.high).toBe(true);
    errors.expectNone();
  });

  test("deleting the source sheet: the series show #REF! and the chart survives a save", async ({ page }) => {
    const errors = trackErrors(page);
    await openCalc(page);
    const grid = new Grid(page);
    const sheets = page.getByRole("tablist", { name: "Sheets" });
    await page.getByRole("button", { name: "Add sheet" }).click();
    await sheets.getByRole("tab", { name: "Sheet1" }).click();
    await table(grid);
    await insertColumn(page);
    await page.getByRole("button", { name: "Move Chart" }).click();
    await page.getByRole("dialog", { name: "Move Chart" }).getByRole("button", { name: "OK" }).click();
    await expect(sheets.getByRole("tab", { name: "Sheet2" })).toHaveAttribute("aria-selected", "true");
    await sheets.getByRole("tab", { name: "Sheet1" }).click({ button: "right" });
    await page.getByRole("menu", { name: "Sheet" }).getByRole("menuitem", { name: "Delete sheet" }).click();
    await page.getByRole("dialog", { name: "Delete sheet" }).getByRole("button", { name: "Delete" }).click();
    await expect(sheets.getByRole("tab")).toHaveCount(1);
    // The bars stay (cached values); a series shows =SERIES(#REF!,#REF!,#REF!,1) in the formula bar.
    await expect.poll(async () => (await items(page)).filter((i) => i.t === "rect" && i.el?.type === "series").length).toBe(8);
    // Select the chart (a click on its chart area: 46 × 22 px headings).
    const r = (await charts(page))[0]!.rect;
    await page.getByTestId("grid").click({ position: { x: 46 + r.x + 6, y: 22 + r.y + 6 } });
    await page.getByRole("tab", { name: "Format", exact: true }).click();
    await page.getByLabel("Chart Elements").selectOption({ index: 0 });
    const options = await page.getByLabel("Chart Elements").locator("option").allTextContents();
    await page.getByLabel("Chart Elements").selectOption({ label: options.find((o) => o.startsWith('Series "North"'))! });
    await expect(page.getByTestId("series-formula")).toHaveValue("=SERIES(#REF!,#REF!,#REF!,1)");
    await shot(page, "ref-series");
    const xlsx = await saveViaBackstage(page);
    const chart = zipText(xlsx, "xl/charts/chart1.xml");
    expect(chart.match(/<c:f>#REF!<\/c:f>/g)?.length).toBeGreaterThanOrEqual(4);
    expect(chart).toContain("<c:v>30</c:v>");
    errors.expectNone();
  });
});
