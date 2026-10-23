// P10-M3: Calc with fingers – selection handles, pan, long press, pinch zoom, double tap on a border, the touch fill
// handle, the formula keys, the compact chrome (formula bar, sheet strip, Sum chip) and a touch tablet.
// Projects: `mobile` (Pixel 7, 412 × 915) runs the @mobile tests, `tablet` (1024 × 768, touch) the @tablet ones.
// Single-finger taps and the long press go through the DevTools touch input (real touch events, native panning);
// drags of the handles and the pinch use synthetic `PointerEvent`s with `pointerType: "touch"`.

import { expect, test, type Page } from "@playwright/test";
import { trackErrors } from "../support/common";
import { Grid, openCalc } from "../support/calc";

const SHOTS = "../../shots";

/** Dispatches a synthetic touch pointer event at a viewport point (on the element there; it bubbles to `window`). */
async function ptr(page: Page, type: "pointerdown" | "pointermove" | "pointerup", x: number, y: number, id = 1) {
  await page.evaluate(
    ({ type, x, y, id }) => {
      const el = document.elementFromPoint(x, y) ?? document.body;
      el.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true, cancelable: true, composed: true, pointerId: id, pointerType: "touch", isPrimary: id === 1,
          clientX: x, clientY: y, button: type === "pointermove" ? -1 : 0, buttons: type === "pointerup" ? 0 : 1,
        }),
      );
    },
    { type, x, y, id },
  );
}

/** A one-finger synthetic drag from `a` to `b`. */
async function drag(page: Page, a: { x: number; y: number }, b: { x: number; y: number }, steps = 8) {
  await ptr(page, "pointerdown", a.x, a.y);
  for (let i = 1; i <= steps; i++) await ptr(page, "pointermove", a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps);
  await ptr(page, "pointerup", b.x, b.y);
}

/** Centre of an element. */
async function centre(page: Page, testId: string) {
  const b = (await page.getByTestId(testId).boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** Long press (touch held 800 ms) through the DevTools touch events. */
async function longPress(page: Page, x: number, y: number) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  await page.waitForTimeout(800);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

/** A real one-finger swipe (native panning). */
async function swipe(page: Page, a: { x: number; y: number }, b: { x: number; y: number }) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: a.x, y: a.y }] });
  for (let i = 1; i <= 10; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: a.x + ((b.x - a.x) * i) / 10, y: a.y + ((b.y - a.y) * i) / 10 }] });
  }
  // Held still before lifting: no fling.
  await page.waitForTimeout(300);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

const address = (page: Page) => page.getByTestId("cell-address");
const scrollTop = (page: Page) => page.getByTestId("grid").evaluate((el) => el.scrollTop);
/** Sheet px start of the text drawn for column `col` (the last frame's text ops). */
const textX = (page: Page, col: number) =>
  page.evaluate((c) => ((window as unknown as { __calcTexts?: { col: number; clipX: number }[] }).__calcTexts ?? []).find((t) => t.col === c)?.clipX ?? -1, col);

/** The context menu items the desktop shows at a cell (1400 × 900, right click). */
async function desktopCellMenu(page: Page): Promise<string[]> {
  const ctx = await page.context().browser()!.newContext({ viewport: { width: 1400, height: 900 } });
  const desk = await ctx.newPage();
  await openCalc(desk);
  const q = await new Grid(desk).pos(2, 2);
  await desk.mouse.click(q.x, q.y, { button: "right" });
  const items = (await desk.getByRole("menu").last().getByRole("menuitem").allInnerTexts()).map((s) => s.replace(/\s+/g, " ").trim());
  await ctx.close();
  return items;
}

test.describe("calc touch @mobile", () => {
  test("tap selects, the end handle extends the range, a drag inside pans, a long press opens the menu", async ({ page }) => {
    const errors = trackErrors(page);
    await openCalc(page);
    const grid = new Grid(page);
    const b2 = await grid.pos(1, 1);
    await page.touchscreen.tap(b2.x, b2.y);
    await expect(address(page)).toHaveValue("B2");
    await expect(page.getByTestId("selection-handle-start")).toBeVisible();
    await expect(page.getByTestId("selection-handle-end")).toBeVisible();
    for (const id of ["selection-handle-start", "selection-handle-end"]) {
      const box = (await page.getByTestId(id).boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    // The end handle sits on B2's bottom-right corner; dragged onto D5's bottom-right corner.
    const h = await centre(page, "selection-handle-end");
    const corner = await grid.pos(1, 1, 32, 10);
    expect(Math.abs(h.x - corner.x)).toBeLessThanOrEqual(2);
    expect(Math.abs(h.y - corner.y)).toBeLessThanOrEqual(2);
    await drag(page, h, await grid.pos(4, 3, 32, 10));
    await expect(address(page)).toHaveValue("B2:D5");
    await page.screenshot({ path: `${SHOTS}/P10-M3-handles.png` });
    // A drag inside the selection scrolls the grid; the selection stays.
    expect(await scrollTop(page)).toBe(0);
    const c3 = await grid.pos(2, 2);
    await swipe(page, { x: c3.x, y: c3.y + 200 }, { x: c3.x, y: c3.y });
    await expect.poll(() => scrollTop(page)).toBeGreaterThan(50);
    await expect(address(page)).toHaveValue("B2:D5");
    await page.getByTestId("grid").evaluate((el) => (el.scrollTop = 0));
    await expect.poll(() => scrollTop(page)).toBe(0);
    // Long press on C3 (inside the range): the desktop's cell menu as a sheet; the range is kept.
    const want = await desktopCellMenu(page);
    const c3b = await grid.pos(2, 2);
    await longPress(page, c3b.x, c3b.y);
    const sheet = page.getByTestId("context-sheet");
    await expect(sheet).toBeVisible();
    expect((await sheet.getByRole("menuitem").allInnerTexts()).map((s) => s.replace(/\s+/g, " ").trim())).toEqual(want);
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect(address(page)).toHaveValue("B2:D5");
    // The start handle moves the top-left corner.
    await drag(page, await centre(page, "selection-handle-start"), await grid.pos(2, 2, -32, -10));
    await expect(address(page)).toHaveValue("C3:D5");
    // A header tap selects the column; a drag on the headers extends it.
    const colB = await grid.pos(-1, 1);
    await drag(page, colB, { x: colB.x + 2 * 64, y: colB.y }, 4);
    await expect(address(page)).toHaveValue("B1:D1048576");
    errors.expectNone();
  });

  test("pinch zooms between 50 % and 200 %; a double tap on a column border autofits", async ({ page }) => {
    const errors = trackErrors(page);
    await openCalc(page);
    const grid = new Grid(page);
    const root = page.getByTestId("grid-root");
    await expect(root).toHaveAttribute("data-zoom", "100");
    const c = await grid.pos(8, 2);
    const pinch = async (from: number, to: number) => {
      await ptr(page, "pointerdown", c.x - from, c.y, 1);
      await ptr(page, "pointerdown", c.x + from, c.y, 2);
      for (let i = 1; i <= 6; i++) {
        const d = from + ((to - from) * i) / 6;
        await ptr(page, "pointermove", c.x - d, c.y, 1);
        await ptr(page, "pointermove", c.x + d, c.y, 2);
      }
      await ptr(page, "pointerup", c.x - to, c.y, 2);
      await ptr(page, "pointerup", c.x - to, c.y, 1);
    };
    await pinch(40, 60);
    await expect(root).toHaveAttribute("data-zoom", "150");
    await expect(page.getByTestId("zoom")).toHaveText(/150/);
    await pinch(30, 150);
    await expect(root).toHaveAttribute("data-zoom", "200");
    await pinch(150, 5);
    await expect(root).toHaveAttribute("data-zoom", "50");
    await expect(page.getByTestId("zoom")).toHaveText(/50/);
    await pinch(20, 40);
    await expect(root).toHaveAttribute("data-zoom", "100");
    // The pinch did not select anything.
    await expect(address(page)).toHaveValue("A1");
    await page.getByTestId("grid").evaluate((el) => {
      el.scrollTop = 0;
      el.scrollLeft = 0;
    });
    await expect.poll(() => page.getByTestId("grid").evaluate((el) => el.scrollTop + el.scrollLeft)).toBe(0);

    await grid.type(0, 1, "a rather long text that needs room");
    await grid.type(0, 2, "x");
    await expect.poll(() => textX(page, 2)).toBeGreaterThan(0);
    const before = await textX(page, 2);
    // The border between the B and C headers, tapped twice.
    const box = (await page.getByTestId("grid").boundingBox())!;
    const bx = box.x + 46 + 2 * 64, by = box.y + 11;
    await page.touchscreen.tap(bx, by);
    await page.touchscreen.tap(bx, by);
    await expect.poll(() => textX(page, 2)).toBeGreaterThan(before + 60);
    errors.expectNone();
  });

  test("the touch fill handle: a drag fills like the mouse, a tap offers the fill commands", async ({ page }) => {
    const errors = trackErrors(page);
    await openCalc(page);
    const grid = new Grid(page);
    // B2 = 1, B3 = 2 dragged to B5: the series 1..4 (one number alone is copied, as with the mouse and in Excel).
    await grid.type(1, 1, "1");
    await grid.type(2, 1, "2");
    const b2 = await grid.pos(1, 1);
    await page.touchscreen.tap(b2.x, b2.y);
    await drag(page, await centre(page, "selection-handle-end"), await grid.pos(2, 1, 32, 10));
    await expect(address(page)).toHaveValue("B2:B3");
    const fill = page.getByTestId("fill-handle-touch");
    await expect(fill).toBeVisible();
    const fb = (await fill.boundingBox())!;
    expect(fb.width).toBeGreaterThanOrEqual(44);
    const from = await centre(page, "fill-handle-touch");
    await drag(page, from, { x: from.x, y: from.y + 2 * 20 });
    await expect(address(page)).toHaveValue("B2:B5");
    await expect.poll(() => grid.display(4, 1)).toBe("4");
    expect(await grid.display(3, 1)).toBe("3");
    // C2 = 1, C2:C5 selected; a tap on the fill handle → Fill series.
    await grid.type(1, 2, "1");
    const c2 = await grid.pos(1, 2);
    await page.touchscreen.tap(c2.x, c2.y);
    await drag(page, await centre(page, "selection-handle-end"), await grid.pos(4, 2, 32, 10));
    await expect(address(page)).toHaveValue("C2:C5");
    const at = await centre(page, "fill-handle-touch");
    await ptr(page, "pointerdown", at.x, at.y);
    await ptr(page, "pointerup", at.x, at.y);
    const sheet = page.getByTestId("context-sheet");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("menuitem")).toHaveText(["Fill down", "Fill right", "Fill series", "Copy cells"]);
    for (const b of await sheet.getByRole("menuitem").all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: `${SHOTS}/P10-M3-fill-sheet.png` });
    await sheet.getByRole("menuitem", { name: "Fill series" }).click();
    await expect(sheet).toHaveCount(0);
    await expect.poll(() => grid.display(4, 2)).toBe("4");
    expect(await grid.display(2, 2)).toBe("2");
    errors.expectNone();
  });
});
