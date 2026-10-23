// P10-M3: Calc with fingers – selection handles, pan, long press, pinch zoom, double tap on a border, the touch fill
// handle, the formula keys, the compact chrome (formula bar, sheet strip, Sum chip) and a touch tablet.
// Projects: `mobile` (Pixel 7, 412 × 915) runs the @mobile tests, `tablet` (1024 × 768, touch) the @tablet ones.
// Single-finger taps and the long press go through the DevTools touch input (real touch events, native panning);
// drags of the handles and the pinch use synthetic `PointerEvent`s with `pointerType: "touch"`.

import { expect, test, type Page } from "@playwright/test";
import { trackErrors } from "../support/common";
import { Grid, openCalc } from "../support/calc";
import { msg } from "../support/i18n";

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

/** The centre of a selection handle once it stands on the corner `at` (the grid redraws on the next frame). */
async function handleOn(page: Page, testId: string, at: { x: number; y: number }) {
  await expect.poll(async () => {
    const c = await centre(page, testId).catch(() => null);
    return !!c && Math.abs(c.x - at.x) <= 2 && Math.abs(c.y - at.y) <= 2;
  }).toBe(true);
  return centre(page, testId);
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

/** The text the last frame drew in a cell (phones: the scratch cell of `Grid.display` is off screen). */
const shown = (page: Page, row: number, col: number) =>
  page.evaluate(([r, c]) => ((window as unknown as { __calcTexts?: { row: number; col: number; text: string }[] }).__calcTexts ?? []).find((t) => t.row === r && t.col === c)?.text ?? "", [row, col]);

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
    await drag(page, await handleOn(page, "selection-handle-end", await grid.pos(1, 1, 32, 10)), await grid.pos(2, 1, 32, 10));
    await expect(address(page)).toHaveValue("B2:B3");
    const fill = page.getByTestId("fill-handle-touch");
    await expect(fill).toBeVisible();
    const fb = (await fill.boundingBox())!;
    expect(fb.width).toBeGreaterThanOrEqual(44);
    const from = await centre(page, "fill-handle-touch");
    await drag(page, from, { x: from.x, y: from.y + 2 * 20 });
    await expect(address(page)).toHaveValue("B2:B5");
    await expect.poll(() => shown(page, 4, 1)).toBe("4");
    expect(await shown(page, 3, 1)).toBe("3");
    // C2 = 1, C2:C5 selected; a tap on the fill handle → Fill series.
    await grid.type(1, 2, "1");
    const c2 = await grid.pos(1, 2);
    await page.touchscreen.tap(c2.x, c2.y);
    await drag(page, await handleOn(page, "selection-handle-end", await grid.pos(1, 2, 32, 10)), await grid.pos(4, 2, 32, 10));
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
    await expect.poll(() => shown(page, 4, 2)).toBe("4");
    expect(await shown(page, 2, 2)).toBe("2");
    errors.expectNone();
  });

  test("the formula keys: =SUM( with Ref mode taps and the handle, ↵ commits, ✕ cancels, pinned above the keyboard", async ({ page }) => {
    const errors = trackErrors(page);
    await openCalc(page);
    const grid = new Grid(page);
    for (let r = 1; r <= 4; r++) await grid.type(r, 1, String(r));
    await expect(page.getByTestId("formula-keys")).toHaveCount(0);
    // Locator taps scroll the key into view in the row's strip first.
    const tapKey = (id: string) => page.getByTestId(id).tap();
    // A double tap on B6 starts editing.
    const b6 = await grid.pos(5, 1);
    await page.touchscreen.tap(b6.x, b6.y);
    await page.touchscreen.tap(b6.x, b6.y);
    const editor = page.getByTestId("cell-editor");
    await expect(editor).toBeVisible();
    const keys = page.getByTestId("formula-keys");
    await expect(keys).toBeVisible();
    for (const b of await keys.getByRole("button").all()) {
      if (!(await b.isVisible())) continue;
      const box = (await b.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
    }
    // The key row sits right above the command bar.
    const kb = (await keys.boundingBox())!;
    const cb = (await page.getByTestId("command-bar").boundingBox())!;
    expect(Math.abs(kb.y + kb.height - cb.y)).toBeLessThanOrEqual(1);
    await tapKey("key-=");
    await expect(editor).toBeFocused();
    await page.keyboard.type("SUM");
    await tapKey("key-(");
    await expect(editor).toHaveValue("=SUM(");
    await tapKey("key-ref");
    await expect(page.getByTestId("key-ref")).toHaveAttribute("aria-pressed", "true");
    const b2 = await grid.pos(1, 1);
    await page.touchscreen.tap(b2.x, b2.y);
    await expect(editor).toHaveValue("=SUM(B2");
    await expect(page.getByTestId("selection-handle-end")).toBeVisible();
    await drag(page, await handleOn(page, "selection-handle-end", await grid.pos(1, 1, 32, 10)), await grid.pos(4, 1, 32, 10));
    await expect(editor).toHaveValue("=SUM(B2:B5");
    // ⇤ ⇥ step over the tokens.
    await tapKey("key-prev");
    await tapKey("key-prev");
    await tapKey("key-)");
    await expect(editor).toHaveValue("=SUM(B2):B5");
    await page.keyboard.press("Backspace");
    await tapKey("key-next");
    await tapKey("key-next");
    await expect(editor).toHaveValue("=SUM(B2:B5");
    await tapKey("key-)");
    await expect(editor).toHaveValue("=SUM(B2:B5)");
    // The on-screen keyboard (simulated): the key row on the visual viewport's bottom, the command bar hidden.
    await page.evaluate(() => {
      (window as unknown as { __RUSUITE_VISUAL_VIEWPORT__: unknown }).__RUSUITE_VISUAL_VIEWPORT__ = { height: 500, offsetTop: 0 };
      window.dispatchEvent(new Event("rusuite:visualviewport"));
    });
    await expect.poll(async () => Math.round(((await keys.boundingBox())!.y + (await keys.boundingBox())!.height))).toBe(500);
    await expect(page.getByTestId("command-bar")).toBeHidden();
    await page.screenshot({ path: `${SHOTS}/P10-M3-keys.png` });
    await tapKey("key-commit");
    await expect(editor).toHaveCount(0);
    await expect(keys).toHaveCount(0);
    await page.evaluate(() => {
      (window as unknown as { __RUSUITE_VISUAL_VIEWPORT__?: unknown }).__RUSUITE_VISUAL_VIEWPORT__ = undefined;
      window.dispatchEvent(new Event("rusuite:visualviewport"));
    });
    await expect(page.getByTestId("command-bar")).toBeVisible();
    await expect.poll(() => shown(page, 5, 1)).toBe("10");
    // ✕ cancels an edit without changing the cell.
    await page.touchscreen.tap(b2.x, b2.y);
    await page.touchscreen.tap(b2.x, b2.y);
    await expect(editor).toBeVisible();
    await page.keyboard.type("9");
    await expect(editor).toHaveValue("19");
    await tapKey("key-cancel");
    await expect(editor).toHaveCount(0);
    expect(await grid.input(1, 1)).toBe("1");
    errors.expectNone();
  });

  for (const locale of ["en-US", "de-DE"]) {
    test(`${locale}: compact chrome – formula bar chip and expand, sheet strip, Sum chip, colour grid; no sideways scroll`, async ({ browser }) => {
      const lang = locale.slice(0, 2);
      const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2.625, locale });
      const page = await ctx.newPage();
      const errors = trackErrors(page);
      await openCalc(page);
      const grid = new Grid(page);
      const overflow = () => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth, document.querySelector<HTMLElement>("[data-rs-app]")!.scrollWidth) - window.innerWidth);
      expect(await overflow()).toBeLessThanOrEqual(0);
      // The formula bar: one line; name box chip, ▾ and expand are 44 px targets.
      const bar = page.getByTestId("formula-bar");
      for (const el of [page.getByTestId("cell-address"), page.getByTestId("formula-bar-expand"), page.getByLabel(msg(lang, "calc.formulaBar"), { exact: true })]) {
        const b = (await el.boundingBox())!;
        expect(b.height).toBeGreaterThanOrEqual(44);
        expect(b.width).toBeGreaterThanOrEqual(44);
      }
      const oneLine = (await bar.boundingBox())!.height;
      expect(oneLine).toBeLessThan(60);
      await page.getByTestId("formula-bar-expand").tap();
      await expect(bar).toHaveAttribute("data-expanded", "");
      expect((await bar.boundingBox())!.height).toBeGreaterThan(oneLine + 40);
      await page.getByTestId("formula-bar-expand").tap();
      await expect(bar).not.toHaveAttribute("data-expanded", "");
      // A tap on the name box chip edits it: B4 + Enter goes there.
      await page.getByTestId("cell-address").tap();
      await expect(page.getByTestId("cell-address")).toBeFocused();
      await page.keyboard.press("Control+a");
      await page.keyboard.type("B4");
      await page.keyboard.press("Enter");
      await expect(page.getByTestId("cell-address")).toHaveValue("B4");

      // The sheet strip: "+" adds a sheet, a long press on a tab opens the sheet menu, Rename works from it.
      const tabs = page.getByRole("tablist", { name: msg(lang, "calc.sheets") });
      const add = page.getByTestId("add-sheet");
      expect((await add.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await add.tap();
      await expect(tabs.getByRole("tab")).toHaveCount(2);
      for (const tab of await tabs.getByRole("tab").all()) expect((await tab.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      const first = (await tabs.getByRole("tab").first().boundingBox())!;
      await longPress(page, first.x + first.width / 2, first.y + first.height / 2);
      const menu = page.getByTestId("context-sheet");
      await expect(menu).toBeVisible();
      // (A tap right after the long press would be taken for its tail: installLongPress' quiet time.)
      await page.waitForTimeout(500);
      await menu.getByRole("menuitem", { name: msg(lang, "calc.rename.confirm"), exact: true }).tap();
      const dialog = page.getByRole("dialog", { name: msg(lang, "calc.rename.title") });
      await expect(dialog).toBeVisible();
      await dialog.getByLabel(msg(lang, "calc.sheetName")).fill("Data");
      await dialog.getByRole("button", { name: msg(lang, "calc.rename.confirm"), exact: true }).tap();
      await expect(dialog).toHaveCount(0);
      await expect(tabs.getByRole("tab", { name: "Data" })).toBeVisible();
      for (let i = 0; i < 6; i++) await add.tap();
      await expect(tabs.getByRole("tab")).toHaveCount(8);
      // The strip scrolls; the page does not.
      expect(await tabs.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
      expect(await overflow()).toBeLessThanOrEqual(0);
      await tabs.getByRole("tab", { name: "Data" }).tap();

      // The Sum chip: B2:B4 = 1, 2, 4 → Sum 7, a tap → Average, a tap → Count.
      for (const [r, v] of [[1, "1"], [2, "2"], [3, "4"]] as const) await grid.type(r, 1, v);
      await expect(page.getByTestId("stat-chip")).toHaveCount(0);
      const b2 = await grid.pos(1, 1);
      await page.touchscreen.tap(b2.x, b2.y);
      await drag(page, await handleOn(page, "selection-handle-end", await grid.pos(1, 1, 32, 10)), await grid.pos(3, 1, 32, 10));
      const chip = page.getByTestId("stat-chip");
      await expect(chip).toHaveText(msg(lang, "calc.stats.sum").replace("{value}", "7"));
      expect((await chip.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await chip.tap();
      await expect(chip).toHaveText(msg(lang, "calc.stats.average").replace("{value}", lang === "de" ? "2,333333333" : "2.333333333"));
      await chip.tap();
      await expect(chip).toHaveText(msg(lang, "calc.stats.count").replace("{value}", "3"));
      await chip.tap();
      await expect(chip).toHaveAttribute("data-stat", "sum");
      if (lang === "de") await page.screenshot({ path: `${SHOTS}/P10-M3-chrome-de.png` });

      // Fill colour from the command bar: a sheet with 40 px colour cells.
      await page.getByTestId("command-tabs").getByRole("tab", { name: msg(lang, "tab.home"), exact: true }).click();
      await page.locator("[data-compact-strip]").getByRole("button", { name: msg(lang, "fmt.fillColor"), exact: true }).tap();
      const cells = page.locator("[data-bottom-sheet] button[data-cell]");
      await expect(cells.first()).toBeVisible();
      for (const c of [cells.first(), cells.last()]) {
        const b = (await c.boundingBox())!;
        expect(b.height).toBeGreaterThanOrEqual(40);
        expect(b.width).toBeGreaterThanOrEqual(34);
      }
      expect(await overflow()).toBeLessThanOrEqual(0);
      await cells.first().tap();
      await expect(page.locator("[data-bottom-sheet]")).toHaveCount(0);
      errors.expectNone();
      await ctx.close();
    });
  }
});
