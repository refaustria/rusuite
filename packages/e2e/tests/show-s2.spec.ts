import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { openViaBackstage, saveViaBackstage, trackErrors } from "../support/common";
import { unzip, zipText } from "../support/zip";

// P9-S2: table styles and editing round 2, Freeform: Shape, adjust handles, connector routing.

const stage = (page: Page) => page.getByTestId("editor-stage");
const cell = (page: Page, r: number, c: number) => page.locator(`[data-testid="table-cell"][data-cell="${r},${c}"]`);
/** The default slide (16:9) in EMU. */
const SLIDE_W = 12192000;

async function openShow(page: Page) {
  await page.goto("show/");
  await stage(page).waitFor();
  await expect(page.getByTestId("dirty")).toHaveText("Saved");
}

/** Stage px per EMU and the stage's corner on the page. */
async function stageScale(page: Page) {
  const b = (await stage(page).boundingBox())!;
  return { x: b.x, y: b.y, k: b.width / SLIDE_W };
}

async function insertTable(page: Page, rows: number, cols: number) {
  await page.getByRole("tab", { name: "Insert" }).click();
  await page.getByRole("button", { name: "Table", exact: true }).click();
  await page.getByRole("button", { name: `${rows} × ${cols} table` }).click();
  await expect(page.getByTestId("table-overlay")).toBeVisible();
}

/** The canvas pixel (RGB) at a page point. */
async function pixelAt(page: Page, x: number, y: number): Promise<[number, number, number]> {
  return page.evaluate(({ x, y }) => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="editor-stage"] canvas')!;
    const r = canvas.getBoundingClientRect();
    const k = canvas.width / r.width;
    const d = canvas.getContext("2d")!.getImageData(Math.round((x - r.left) * k), Math.round((y - r.top) * k), 1, 1).data;
    return [d[0]!, d[1]!, d[2]!] as [number, number, number];
  }, { x, y });
}

/** Saves, writes the file next to the test's output and opens it again. */
async function saveAndReopen(page: Page, file: string): Promise<Buffer> {
  const pptx = await saveViaBackstage(page);
  fs.writeFileSync(file, pptx);
  await openViaBackstage(page, file);
  await expect(page.getByTestId("dirty")).toHaveText("Saved");
  return pptx;
}

/** Drags the selected cells from `a` to `b` (cell coordinates). */
async function dragCells(page: Page, a: [number, number], b: [number, number]) {
  const p = (await cell(page, ...a).boundingBox())!;
  const q = (await cell(page, ...b).boundingBox())!;
  await page.mouse.move(p.x + p.width / 2, p.y + p.height / 2);
  await page.mouse.down();
  await page.mouse.move(q.x + q.width / 2, q.y + q.height / 2, { steps: 5 });
  await page.mouse.up();
}

test.describe("Show tables and shapes (P9-S2)", () => {
  test("Dark Style 1 – Accent 1 with banded columns: saved with tableStyleId and the tblPr flags, drawn the same after reopening", async ({ page }, info) => {
    const errors = trackErrors(page);
    await openShow(page);
    await insertTable(page, 4, 4);
    await page.getByRole("tab", { name: "Table Design" }).click();
    await page.getByRole("button", { name: "Dark Style 1 – Accent 1" }).click();
    await page.getByRole("checkbox", { name: "Banded columns" }).check();
    await expect(page.getByRole("button", { name: "Dark Style 1 – Accent 1" })).toHaveAttribute("aria-pressed", "true");
    // a body cell of the second column band and the header
    const probe = async () => {
      const head = (await cell(page, 0, 1).boundingBox())!;
      const body = (await cell(page, 2, 2).boundingBox())!;
      return [await pixelAt(page, head.x + 6, head.y + head.height - 6), await pixelAt(page, body.x + 6, body.y + body.height - 6)];
    };
    const before = await probe();
    // header: Dark 1 (black), body: the accent, all dark
    expect(before[0]!.every((v) => v < 60)).toBe(true);
    expect(before[1]![2]).toBeGreaterThan(before[1]![0]);
    const pptx = await saveAndReopen(page, info.outputPath("dark-style.pptx"));
    const files = unzip(pptx);
    const slide = files.get("ppt/slides/slide1.xml")!.toString();
    expect(slide).toContain("<a:tableStyleId>{125E5076-3810-47DD-B79F-674D7AD40C01}</a:tableStyleId>");
    expect(slide).toMatch(/<a:tblPr firstRow="1" bandRow="1" bandCol="1">/);
    // the style cells carry no fills of their own
    expect(slide).not.toMatch(/<a:tcPr[^>]*><a:solidFill>/);
    const styles = files.get("ppt/tableStyles.xml")!.toString();
    expect(styles).toContain('styleName="Dark Style 1 - Accent 1"');
    expect(styles).toContain("<a:seCell>");
    // reopened: the same table, the same colours
    await page.getByTestId("editor-stage").click({ position: { x: 5, y: 5 } });
    const t = (await stageScale(page));
    const off = slide.match(/<p:graphicFrame>[\s\S]*?<a:off x="(\d+)" y="(\d+)"\/>/)!;
    await page.mouse.click(t.x + (Number(off[1]) + 20000) * t.k, t.y + (Number(off[2]) + 20000) * t.k);
    await expect(page.getByTestId("table-overlay")).toBeVisible();
    await page.screenshot({ path: "../../shots/P9-S2-dark-reopen.png" });
    await expect.poll(async () => JSON.stringify(await probe())).toBe(JSON.stringify(before));
    errors.expectNone();
  });

  test("Split Cells 2 × 2 on a merged 2 × 2 cell gives four single cells again", async ({ page }) => {
    const errors = trackErrors(page);
    await openShow(page);
    await insertTable(page, 3, 3);
    await dragCells(page, [1, 0], [2, 1]);
    await page.getByRole("tab", { name: "Layout" }).click();
    await page.getByRole("button", { name: "Merge cells" }).click();
    await expect(cell(page, 2, 1)).toHaveCount(0);
    let slide = zipText(await saveViaBackstage(page), "ppt/slides/slide1.xml");
    expect(slide).toContain('rowSpan="2" gridSpan="2"');
    await cell(page, 1, 0).click({ force: true });
    await page.keyboard.press("Escape");
    await page.getByRole("tab", { name: "Layout" }).click();
    await page.getByRole("button", { name: "Split Cells…" }).click();
    const dlg = page.getByRole("dialog", { name: "Split cells" });
    await dlg.getByLabel("Number of columns").fill("2");
    await dlg.getByLabel("Number of rows").fill("2");
    await dlg.getByRole("button", { name: "OK" }).click();
    await expect(cell(page, 2, 1)).toHaveCount(1);
    slide = zipText(await saveViaBackstage(page), "ppt/slides/slide1.xml");
    const tbl = slide.match(/<a:tbl>[\s\S]*<\/a:tbl>/)![0];
    expect(tbl).not.toContain("rowSpan");
    expect(tbl).not.toContain("gridSpan");
    expect(tbl.match(/<a:tr /g)).toHaveLength(3);
    expect(tbl.match(/<a:gridCol /g)).toHaveLength(3);
    errors.expectNone();
  });

  test("Freeform: Shape with four clicks closed on its start: saved as a:custGeom and drawn after reopening", async ({ page }, info) => {
    const errors = trackErrors(page);
    await openShow(page);
    await page.getByRole("tab", { name: "Insert" }).click();
    await page.getByRole("button", { name: "Shapes" }).click();
    await page.getByRole("dialog", { name: "Shapes" }).getByRole("group", { name: "Lines" }).getByRole("button", { name: "Freeform: shape" }).click();
    await expect(stage(page)).toHaveAttribute("data-draw-mode", "freeform");
    const b = (await stage(page).boundingBox())!;
    const pts: [number, number][] = [[200, 120], [420, 110], [460, 300], [220, 320]];
    for (const [x, y] of pts) await page.mouse.click(b.x + x, b.y + y);
    await page.mouse.click(b.x + pts[0]![0] + 2, b.y + pts[0]![1] + 1); // on the start point: closes
    await expect(stage(page)).not.toHaveAttribute("data-draw-mode", /.+/);
    await page.screenshot({ path: "../../shots/P9-S2-freeform.png" });
    await expect(page.getByRole("tab", { name: "Shape Format" })).toBeVisible();
    const inside = [b.x + 330, b.y + 215] as const;
    const filled = await pixelAt(page, ...inside);
    expect(filled[2]).toBeGreaterThan(filled[0]); // the accent fill
    const pptx = await saveAndReopen(page, info.outputPath("freeform.pptx"));
    const slide = zipText(pptx, "ppt/slides/slide1.xml");
    const geom = slide.match(/<a:custGeom>[\s\S]*?<\/a:custGeom>/)?.[0] ?? "";
    expect(geom).toContain("<a:moveTo>");
    expect(geom.match(/<a:lnTo>/g)).toHaveLength(3);
    expect(geom).toContain("<a:close/>");
    expect(slide).not.toContain('prst="rect"><a:avLst/></a:prstGeom><a:solidFill');
    // drawn after reopening
    await expect.poll(async () => (await pixelAt(page, ...inside))[2] > (await pixelAt(page, ...inside))[0]).toBe(true);
    errors.expectNone();
  });

  test("dragging the adjust handle of a rounded rectangle changes its avLst", async ({ page }) => {
    const errors = trackErrors(page);
    await openShow(page);
    await page.getByRole("tab", { name: "Insert" }).click();
    await page.getByRole("button", { name: "Shapes" }).click();
    await page.getByRole("dialog", { name: "Shapes" }).getByRole("group", { name: "Rectangles" }).getByRole("button", { name: "Rounded rectangle", exact: true }).press("Enter");
    await expect(stage(page)).toHaveAttribute("data-adjust-handles", "1");
    // the inserted shape is centred, 1" square; its handle sits on the top edge at 16.667 % of the side
    const s = await stageScale(page);
    const x0 = (SLIDE_W - 914400) / 2;
    const y0 = (6858000 - 914400) / 2;
    const hx = s.x + (x0 + 0.16667 * 914400) * s.k;
    const hy = s.y + y0 * s.k;
    await page.mouse.move(hx, hy);
    await page.mouse.down();
    await page.mouse.move(hx + 15, hy, { steps: 4 });
    await page.mouse.move(hx + 30, hy, { steps: 4 });
    await page.mouse.up();
    const slide = zipText(await saveViaBackstage(page), "ppt/slides/slide1.xml");
    const m = slide.match(/prst="roundRect"><a:avLst><a:gd name="adj" fmla="val (\d+)"\/>/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThan(20000);
    // the keyboard moves the handle too: Tab focuses it, → nudges
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+ArrowLeft");
    const slide2 = zipText(await saveViaBackstage(page), "ppt/slides/slide1.xml");
    const m2 = slide2.match(/prst="roundRect"><a:avLst><a:gd name="adj" fmla="val (\d+)"\/>/);
    expect(Number(m2![1])).toBeLessThan(Number(m![1]));
    errors.expectNone();
  });

  test("moving a connected shape with the keyboard: the connector's ends follow its sites", async ({ page }) => {
    const errors = trackErrors(page);
    await openShow(page);
    const draw = async (group: string, name: string, a: [number, number], c: [number, number]) => {
      await page.getByRole("tab", { name: "Insert" }).click();
      await page.getByRole("button", { name: "Shapes" }).click();
      await page.getByRole("dialog", { name: "Shapes" }).getByRole("group", { name: group }).getByRole("button", { name, exact: true }).click();
      const box = (await stage(page).boundingBox())!;
      await page.mouse.move(box.x + a[0], box.y + a[1]);
      await page.mouse.down();
      await page.mouse.move(box.x + (a[0] + c[0]) / 2, box.y + (a[1] + c[1]) / 2, { steps: 4 });
      await page.mouse.move(box.x + c[0], box.y + c[1], { steps: 4 });
      await page.mouse.up();
      await expect(stage(page)).not.toHaveAttribute("data-draw-mode", /.+/);
    };
    await draw("Rectangles", "Rectangle", [80, 80], [200, 160]);
    await draw("Rectangles", "Rectangle", [480, 320], [600, 400]);
    await draw("Lines", "Connector: elbow", [200, 120], [480, 360]);
    const ends = (xml: string) => {
      const c = xml.match(/<p:cxnSp>[\s\S]*?<\/p:cxnSp>/)![0];
      const off = c.match(/<a:off x="(-?\d+)" y="(-?\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"\/>/)!.slice(1).map(Number);
      return { c, off };
    };
    // the drawn rectangles (not the title / subtitle placeholders)
    const rects = (xml: string) =>
      [...xml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)]
        .map((m) => m[0])
        .filter((sp) => !sp.includes("<p:ph"))
        .map((sp) => sp.match(/<a:off x="(\d+)" y="(\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"\/>/)!.slice(1, 5).map(Number));
    const before = zipText(await saveViaBackstage(page), "ppt/slides/slide1.xml");
    expect(ends(before).c).toContain("<a:endCxn");
    // select the second rectangle and nudge it 10 px up, three times
    const box = (await stage(page).boundingBox())!;
    await page.keyboard.press("Escape");
    await page.mouse.click(box.x + 540, box.y + 360);
    for (let i = 0; i < 3; i++) await page.keyboard.press("Shift+ArrowUp");
    await expect(page.getByTestId("dirty")).toHaveText("Modified");
    await page.screenshot({ path: "../../shots/P9-S2-connector-moved.png" });
    const after = zipText(await saveViaBackstage(page), "ppt/slides/slide1.xml");
    const r = rects(after);
    expect(r[1]![1]).toBeLessThan(rects(before)[1]![1]!);
    const e = ends(after);
    expect(e.c).toContain("<a:stCxn");
    expect(e.c).toContain("<a:endCxn");
    expect(e.off).not.toEqual(ends(before).off);
    // the end lies on the moved rectangle's left site (its middle-left point)
    const [x, y, w, h] = e.off as [number, number, number, number];
    const flipH = /<a:xfrm[^>]*flipH="1"/.test(e.c);
    const flipV = /<a:xfrm[^>]*flipV="1"/.test(e.c);
    const end = [flipH ? x : x + w, flipV ? y : y + h];
    const [rx, ry, , rh] = r[1] as [number, number, number, number];
    expect(Math.abs(end[0]! - rx)).toBeLessThan(2000);
    expect(Math.abs(end[1]! - (ry + rh / 2))).toBeLessThan(2000);
    errors.expectNone();
  });
});
