// P10-M4: Write with fingers – the fit-width page on a phone (pinch, double tap, Draft remembered, 8 px page gaps),
// long-press word selection with the floating bar and the selection handles, tables (context sheet, column border
// drag, gutters, the Table chip) and pictures (44 px handles, corner drag, Layout Options) by touch, the caret above
// the on-screen keyboard. Projects: `mobile` (Pixel 7, 412 × 915) runs the @mobile tests, `tablet` (1024 × 768,
// touch, the desktop ribbon) the @tablet ones.
import { expect, test, type Page } from "@playwright/test";
import { testdata, trackErrors } from "../support/common";
import { msg } from "../support/i18n";

const SHOTS = "../../shots";
const editor = (page: Page) => page.locator(".ProseMirror").first();
const zoomOf = (page: Page) => page.getByTestId("write-zoom").evaluate((el) => Number((el as HTMLElement).dataset.zoom));

async function openWrite(page: Page) {
  await page.goto("write/");
  await editor(page).waitFor();
  await expect(page.getByTestId("status-bar")).toContainText(/Saved|Gespeichert/);
}

/** Opens a docx fixture through the compact File button or the desktop backstage. */
async function openFixture(page: Page, name: string) {
  await openWrite(page);
  const compact = (await page.getByTestId("compact-file").count()) > 0;
  await (compact ? page.getByTestId("compact-file") : page.getByRole("tab", { name: "File" })).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByTestId("backstage").getByRole("button", { name: /^Open/ }).click();
  await (await chooser).setFiles(testdata("docx", name));
  await expect(page.getByTestId("doc-name")).toHaveText(name);
  // The print layout has laid the pages out.
  await expect(page.getByTestId("write-page")).toHaveAttribute("data-pages", /\d+/);
}

/** DevTools touch input: `points` per step (each a list of fingers). */
async function touch(page: Page, steps: { x: number; y: number }[][], gap = 30) {
  const cdp = await page.context().newCDPSession(page);
  for (let i = 0; i < steps.length; i++) {
    const type = i === 0 ? "touchStart" : i === steps.length - 1 && steps[i]!.length === 0 ? "touchEnd" : "touchMove";
    await cdp.send("Input.dispatchTouchEvent", { type, touchPoints: steps[i]! });
    await page.waitForTimeout(gap);
  }
  await cdp.detach();
}

async function pinch(page: Page, cx: number, cy: number, from: number, to: number) {
  const steps: { x: number; y: number }[][] = [];
  for (let i = 0; i <= 8; i++) {
    const d = from + ((to - from) * i) / 8;
    steps.push([
      { x: cx - d / 2, y: cy },
      { x: cx + d / 2, y: cy },
    ]);
  }
  steps.push([]);
  await touch(page, steps);
}

async function longPress(page: Page, x: number, y: number) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  await page.waitForTimeout(800);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

async function doubleTap(page: Page, x: number, y: number) {
  await page.touchscreen.tap(x, y);
  await page.waitForTimeout(80);
  await page.touchscreen.tap(x, y);
}

/** Viewport box of the text of the first match of `text` in the editor. */
async function textBox(page: Page, text: string, nth = 0): Promise<{ x: number; y: number; width: number; height: number }> {
  return page.evaluate(
    ([text, nth]) => {
      const root = document.querySelector(".ProseMirror")!;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let n = 0;
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const i = node.textContent!.indexOf(text as string);
        if (i < 0) continue;
        if (n++ < (nth as number)) continue;
        const r = document.createRange();
        r.setStart(node, i);
        r.setEnd(node, i + (text as string).length);
        const b = r.getBoundingClientRect();
        return { x: b.left, y: b.top, width: b.width, height: b.height };
      }
      throw new Error(`no text ${text}`);
    },
    [text, nth] as const,
  );
}

const pageOverflow = (page: Page) =>
  page.evaluate(() => {
    const app = document.querySelector<HTMLElement>("[data-rs-app]")!;
    return Math.max(document.documentElement.scrollWidth, document.body.scrollWidth, app.scrollWidth) - window.innerWidth;
  });
/** How far the page area scrolls sideways (0 at fit-width). */
const areaOverflow = (page: Page) => page.getByTestId("write-scroll").evaluate((el) => el.scrollWidth - el.clientWidth);

test.describe("Write touch @mobile", () => {
  test("the page fits the phone: fit-width, pinch, double tap, 8 px gaps, Draft remembered", async ({ page }) => {
    const errors = trackErrors(page);
    await openFixture(page, "provisional-41-long-document.docx");
    const sheet = (await page.getByTestId("write-page").boundingBox())!;
    expect(sheet.x).toBeGreaterThanOrEqual(0);
    expect(sheet.x + sheet.width).toBeLessThanOrEqual(412);
    expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
    expect(await areaOverflow(page)).toBeLessThanOrEqual(0);
    const fit = await zoomOf(page);
    expect(fit).toBeLessThan(1);
    expect(fit).toBeGreaterThan(0.4);
    // Readable: the headings render at ≥ 10 px (the body's 11 pt at fit-width: ~7 px CSS, ~19 device px).
    const heading = await page.locator(".ProseMirror h1").first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize) * Number(el.closest<HTMLElement>(".write-zoom")!.dataset.zoom));
    expect(heading).toBeGreaterThanOrEqual(10);
    // 8 px between the pages on the screen.
    const gap = (await page.locator(".page-gap").first().boundingBox())!;
    expect(Math.abs(gap.height - 8)).toBeLessThanOrEqual(1.5);
    await page.screenshot({ path: `${SHOTS}/P10-M4-fit-width.png` });

    // Pinch out: the zoom grows (up to 200 %), the point between the fingers stays.
    const scroll = (await page.getByTestId("write-scroll").boundingBox())!;
    const cx = scroll.x + scroll.width / 2;
    const cy = scroll.y + 300;
    await pinch(page, cx, cy, 100, 220);
    await expect.poll(() => zoomOf(page)).toBeGreaterThan(fit + 0.2);
    const pinched = await zoomOf(page);
    expect(pinched).toBeLessThanOrEqual(2);
    // Pinch in below fit-width: back to fit-width.
    await pinch(page, cx, cy, 300, 40);
    await expect.poll(() => zoomOf(page)).toBeCloseTo(fit, 2);

    // Double tap: 100 %, again: fit-width.
    await doubleTap(page, cx, cy);
    await expect.poll(() => zoomOf(page)).toBe(1);
    expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
    await doubleTap(page, cx, cy);
    await expect.poll(() => zoomOf(page)).toBeCloseTo(fit, 2);
    await expect(page.getByTestId("write-zoom")).toHaveAttribute("data-fit", "");

    // Rotation (a wider viewport, still compact): fit-width follows.
    await page.setViewportSize({ width: 800, height: 412 });
    await expect.poll(() => zoomOf(page)).toBeGreaterThan(fit + 0.3);
    await page.setViewportSize({ width: 412, height: 915 });
    await expect.poll(() => zoomOf(page)).toBeCloseTo(fit, 2);

    // Draft view from View is remembered on the phone.
    await page.getByTestId("command-tabs").getByRole("tab", { name: "View", exact: true }).click();
    await page.locator("[data-compact-strip]").getByRole("button", { name: "Draft", exact: true }).tap();
    await expect(page.getByTestId("write-page")).toHaveAttribute("data-view", "draft");
    expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
    expect(await areaOverflow(page)).toBeLessThanOrEqual(0);
    await page.reload();
    await editor(page).waitFor();
    await expect(page.getByTestId("write-page")).toHaveAttribute("data-view", "draft");
    await page.getByTestId("command-tabs").getByRole("tab", { name: "View", exact: true }).click();
    await page.locator("[data-compact-strip]").getByRole("button", { name: "Print layout", exact: true }).tap();
    await expect(page.getByTestId("write-page")).toHaveAttribute("data-view", "print");
    errors.expectNone();
  });

  test("a double tap on a header opens the header editor", async ({ page }) => {
    const errors = trackErrors(page);
    await openFixture(page, "provisional-52-sections-headers-fields.docx");
    const hf = page.getByTestId("page-header").first();
    const b = (await hf.boundingBox())!;
    await doubleTap(page, b.x + Math.min(30, b.width / 2), b.y + b.height / 2);
    await expect(page.getByRole("dialog", { name: /Header/ })).toBeVisible();
    errors.expectNone();
  });

  test("long press selects a word; the floating bar formats it; the end handle extends the selection; ⋯ opens the menu", async ({ page }) => {
    await selectionFlow(page, "mobile");
  });

  test("tables by touch: long press → the table items, a column border drag, the gutters, the Table chips", async ({ page }) => {
    await tableFlow(page, "mobile");
  });

  test("pictures by touch: 8 handles with 44 px hit areas, a corner drag resizes, Layout Options is 44 px", async ({ page }) => {
    await pictureFlow(page, "mobile");
  });

  test("the keyboard: the caret at the last paragraph stays 60 px above the command bar; sheets and the find bar keep clear of it", async ({ page }) => {
    const errors = trackErrors(page);
    await openFixture(page, "provisional-41-long-document.docx");
    const last = page.locator(".ProseMirror > p").last();
    await last.scrollIntoViewIfNeeded();
    const lb = (await last.boundingBox())!;
    await page.touchscreen.tap(lb.x + 20, lb.y + 4);
    await page.keyboard.press("End");
    const caret = () =>
      page.evaluate(() => {
        const ed = (document.querySelector(".ProseMirror") as unknown as { editor: { view: { coordsAtPos: (p: number) => { top: number; bottom: number } }; state: { selection: { head: number } } } }).editor;
        return ed.view.coordsAtPos(ed.state.selection.head);
      });
    const barTop = async () => (await page.getByTestId("command-bar").boundingBox())!.y;
    // The keyboard opens: 400 px of the 915 are left.
    await page.evaluate(() => {
      (window as unknown as { __RUSUITE_VISUAL_VIEWPORT__: unknown }).__RUSUITE_VISUAL_VIEWPORT__ = { height: 400, offsetTop: 0 };
      window.dispatchEvent(new Event("rusuite:visualviewport"));
    });
    await expect(page.locator("html")).toHaveAttribute("data-keyboard", "");
    await expect.poll(async () => Math.round((await barTop()) + (await page.getByTestId("command-bar").boundingBox())!.height)).toBe(400);
    await expect.poll(async () => (await barTop()) - (await caret()).bottom).toBeGreaterThanOrEqual(60);
    expect((await caret()).top).toBeGreaterThan(0);
    // Typing at the end keeps it there.
    await page.keyboard.type(" More words at the end.");
    await expect.poll(async () => (await barTop()) - (await caret()).bottom).toBeGreaterThanOrEqual(60);
    await page.screenshot({ path: `${SHOTS}/P10-M4-keyboard.png` });
    // The find bar sits above the command bar, below the caret line.
    await page.keyboard.press("Control+f");
    const find = page.getByTestId("find-bar");
    await expect(find).toBeVisible();
    await expect.poll(async () => (await find.boundingBox())!.y - (await caret()).bottom).toBeGreaterThanOrEqual(0);
    expect((await find.boundingBox())!.y + (await find.boundingBox())!.height).toBeLessThanOrEqual(await barTop());
    await page.keyboard.press("Escape");
    await expect(find).toHaveCount(0);
    await editor(page).focus();
    // The keyboard closes again.
    await page.evaluate(() => {
      (window as unknown as { __RUSUITE_VISUAL_VIEWPORT__?: unknown }).__RUSUITE_VISUAL_VIEWPORT__ = undefined;
      window.dispatchEvent(new Event("rusuite:visualviewport"));
    });
    // The Paragraph sheet does not cover the caret line.
    await page.getByTestId("command-tabs").getByRole("tab", { name: "Home", exact: true }).click();
    await page.locator("[data-compact-strip]").getByRole("button", { name: "Paragraph settings", exact: true }).tap();
    const sheet = page.getByTestId("dialog-sheet");
    await expect(sheet).toBeVisible();
    await editor(page).evaluate(() => undefined);
    await expect.poll(async () => (await sheet.boundingBox())!.y - (await caret()).bottom).toBeGreaterThanOrEqual(0);
    await page.keyboard.press("Escape");
    errors.expectNone();
  });

  test("the Styles gallery and the font size list in sheets have 44 px rows", async ({ page }) => {
    const errors = trackErrors(page);
    await openWrite(page);
    await page.getByTestId("command-tabs").getByRole("tab", { name: "Home", exact: true }).click();
    const strip = page.locator("[data-compact-strip]");
    await strip.getByRole("button", { name: "Paragraph styles", exact: true }).tap();
    const gallery = page.getByTestId("popup-sheet");
    await expect(gallery).toBeVisible();
    const items = gallery.locator("[data-gallery-item]");
    expect(await items.count()).toBeGreaterThan(3);
    for (const it of await items.all()) expect((await it.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: `${SHOTS}/P10-M4-styles-sheet.png` });
    await page.keyboard.press("Escape");
    await expect(gallery).toHaveCount(0);
    // Font sizes are inputs with the sizes as the browser's own list (the OS picker on phones): 44 px in the strip and
    // in the Font sheet.
    expect((await strip.getByRole("combobox", { name: "Font size" }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await strip.getByRole("button", { name: "Font…", exact: true }).tap();
    const font = page.getByTestId("dialog-sheet");
    await expect(font).toBeVisible();
    expect((await font.getByLabel("Size (pt)").boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: `${SHOTS}/P10-M4-font-size.png` });
    await page.keyboard.press("Escape");
    errors.expectNone();
  });
});

test.describe("Write touch in German @mobile", () => {
  test("de: the bar's labels, 44 px targets, no sideways scroll", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2.625, locale: "de-DE" });
    const page = await ctx.newPage();
    const errors = trackErrors(page);
    await openWrite(page);
    await expect(page.locator("html")).toHaveAttribute("lang", "de");
    await editor(page).click();
    await page.keyboard.type("Hallo schöne Welt");
    const w = await textBox(page, "schöne");
    await longPress(page, w.x + w.width / 2, w.y + w.height / 2);
    await expect.poll(() => selectedText(page)).toBe("schöne");
    const bar = page.getByTestId("selection-bar");
    await expect(bar).toHaveAttribute("aria-label", msg("de", "write.touch.selectionBar"));
    for (const k of BAR_KEYS) {
      const b = bar.getByRole("button", { name: msg("de", k), exact: true });
      await expect(b).toBeVisible();
      const box = (await b.boundingBox())!;
      expect(Math.min(box.width, box.height), k).toBeGreaterThanOrEqual(44);
    }
    await expect(page.getByTestId("selection-handle-end")).toHaveAttribute("aria-label", msg("de", "write.touch.handleEnd"));
    expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
    expect(await areaOverflow(page)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `${SHOTS}/P10-M4-selection-de.png` });
    errors.expectNone();
    await ctx.close();
  });
});

test.describe("Write touch on a tablet @tablet", () => {
  test("ribbon + touch: long press, the bar and the handles", async ({ page }) => {
    await selectionFlow(page, "tablet");
  });
  test("ribbon + touch: tables", async ({ page }) => {
    await tableFlow(page, "tablet");
  });
  test("ribbon + touch: pictures", async ({ page }) => {
    await pictureFlow(page, "tablet");
  });
  test("ribbon + touch: pinch zooms between 50 and 200 %", async ({ page }) => {
    const errors = trackErrors(page);
    await openFixture(page, "provisional-41-long-document.docx");
    expect(await zoomOf(page)).toBe(1);
    const s = (await page.getByTestId("write-scroll").boundingBox())!;
    await pinch(page, s.x + s.width / 2, s.y + 200, 300, 150);
    await expect.poll(() => zoomOf(page)).toBeLessThan(0.75);
    await pinch(page, s.x + s.width / 2, s.y + 200, 100, 400);
    await expect.poll(() => zoomOf(page)).toBeGreaterThan(1.2);
    expect(await zoomOf(page)).toBeLessThanOrEqual(2);
    await page.screenshot({ path: `${SHOTS}/P10-M4-tablet.png` });
    errors.expectNone();
  });
});

/** Items 3 (and 5): the table fixture by touch. */
async function tableFlow(page: Page, project: string) {
  const errors = trackErrors(page);
  await openFixture(page, "provisional-24-table-4x3-header.docx");
  const cells = page.locator(".ProseMirror table td, .ProseMirror table th");
  const c = (await cells.nth(4).boundingBox())!;
  // A long press in a cell: the context menu (a sheet on the phone) with the table items.
  await longPress(page, c.x + 8, c.y + c.height / 2);
  const menu = project === "mobile" ? page.getByTestId("context-sheet") : page.getByRole("menu", { name: "Editor" });
  await expect(menu).toBeVisible();
  const items = (await menu.getByRole("menuitem").allInnerTexts()).map((s) => s.replace(/\s+/g, " ").trim());
  for (const want of ["Insert row above", "Insert row below", "Delete table", "Table Properties…"]) expect(items.some((i) => i.startsWith(want)), `${want} in ${items.join(", ")}`).toBe(true);
  if (project === "mobile") await page.keyboard.press("Escape");
  else {
    // The desktop menu closes on a tap outside it (after the long press's quiet time, see below).
    await page.waitForTimeout(500);
    await page.touchscreen.tap(page.viewportSize()!.width - 40, page.viewportSize()!.height - 80);
  }
  await expect(menu).toHaveCount(0);
  // A tap puts the caret into the cell (the word's selection bar goes away); the contextual Table tabs.
  const c2 = (await cells.nth(5).boundingBox())!;
  // The long press's own mouse events are swallowed for 400 ms after it (installLongPress): a later tap.
  await page.waitForTimeout(500);
  await page.touchscreen.tap(c2.x + c2.width / 2, c2.y + c2.height / 2);
  await expect(page.getByTestId("selection-bar")).toHaveCount(0);
  if (project === "mobile") {
    await expect(page.getByTestId("command-tabs").getByRole("tab", { name: "Table Design", exact: true })).toBeVisible();
    await expect(page.getByTestId("command-tabs").getByRole("tab", { name: "Table Layout", exact: true })).toBeVisible();
  } else {
    await expect(page.getByTestId("ribbon").getByRole("tab", { name: "Table Layout", exact: true })).toBeVisible();
  }
  // The gutters (44 px): a tap on the second column's selects that column.
  const col = page.getByTestId("table-gutter-col-1");
  await expect(col).toBeVisible();
  const g = (await col.boundingBox())!;
  expect(g.height).toBeGreaterThanOrEqual(44);
  await page.touchscreen.tap(g.x + g.width / 2, g.y + g.height / 2);
  await expect(page.locator(".ProseMirror .selectedCell")).toHaveCount(4);
  const row = page.getByTestId("table-gutter-row-0");
  const r = (await row.boundingBox())!;
  expect(r.width).toBeGreaterThanOrEqual(44);
  await page.touchscreen.tap(r.x + r.width / 2, r.y + r.height / 2);
  await expect(page.locator(".ProseMirror .selectedCell")).toHaveCount(3);
  await page.screenshot({ path: `${SHOTS}/P10-M4-table-${project}.png` });
  // Drag the border after the first column 30 px to the right (the finger 15 px beside it: inside the 44 px strip).
  const first = (await cells.nth(0).boundingBox())!;
  const before = first.width;
  const bx = first.x + first.width + 15;
  const by = first.y + first.height / 2;
  const steps: { x: number; y: number }[][] = [];
  for (let i = 0; i <= 6; i++) steps.push([{ x: bx + i * 5, y: by }]);
  steps.push([]);
  await touch(page, steps);
  await expect.poll(async () => (await cells.nth(0).boundingBox())!.width).toBeGreaterThan(before + 10);
  errors.expectNone();
}

/** Items 3 (and 5): the picture fixture by touch. */
async function pictureFlow(page: Page, project: string) {
  const errors = trackErrors(page);
  await openFixture(page, "provisional-30-image-inline.docx");
  const img = page.locator(".ProseMirror img.inline-image").first();
  const b0 = (await img.boundingBox())!;
  await page.touchscreen.tap(b0.x + b0.width / 2, b0.y + b0.height / 2);
  const handles = page.locator(".inline-image-wrap.selected .image-handle");
  await expect(handles).toHaveCount(8);
  for (const h of await handles.all()) {
    const hb = (await h.boundingBox())!;
    expect(hb.width).toBeGreaterThanOrEqual(43.5);
    expect(hb.height).toBeGreaterThanOrEqual(43.5);
  }
  const lo = page.getByTestId("layout-options").getByRole("button").first();
  const lb = (await lo.boundingBox())!;
  expect(lb.width).toBeGreaterThanOrEqual(44);
  expect(lb.height).toBeGreaterThanOrEqual(44);
  expect(lb.x + lb.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.screenshot({ path: `${SHOTS}/P10-M4-picture-${project}.png` });
  // Drag the bottom-right corner 40 px left and up: smaller.
  const se = (await page.locator(".inline-image-wrap.selected .image-handle-se").boundingBox())!;
  const sx = se.x + se.width / 2;
  const sy = se.y + se.height / 2;
  const steps: { x: number; y: number }[][] = [];
  for (let i = 0; i <= 8; i++) steps.push([{ x: sx - i * 5, y: sy - i * 5 }]);
  steps.push([]);
  await touch(page, steps);
  await expect.poll(async () => (await img.boundingBox())!.width).toBeLessThan(b0.width - 20);
  errors.expectNone();
}

const selectedText = (page: Page) => page.evaluate(() => window.getSelection()?.toString() ?? "");
const BAR_KEYS = ["fmt.bold", "fmt.italic", "fmt.underline", "write.highlight", "write.link.insertDots", "cmd.copy", "cmd.cut", "cmd.paste", "write.comments.new", "write.touch.more"];
const BAR_BUTTONS = BAR_KEYS.map((k) => msg("en", k));

/** Items 2 (and 5 on the tablet): long press, the bar, Bold, the end handle, "⋯". */
async function selectionFlow(page: Page, project: string) {
  const errors = trackErrors(page);
  await openFixture(page, "provisional-41-long-document.docx");
  const w = await textBox(page, "Reference", 0);
  await longPress(page, w.x + w.width / 2, w.y + w.height / 2);
  await expect.poll(() => selectedText(page)).toBe("Reference");
  const bar = page.getByTestId("selection-bar");
  await expect(bar).toBeVisible();
  for (const name of BAR_BUTTONS) {
    const b = bar.getByRole("button", { name, exact: true });
    await expect(b).toBeVisible();
    const box = (await b.boundingBox())!;
    expect(box.height, name).toBeGreaterThanOrEqual(44);
    expect(box.width, name).toBeGreaterThanOrEqual(44);
  }
  // The bar sits above the word, inside the viewport.
  const bb = (await bar.boundingBox())!;
  expect(bb.y + bb.height).toBeLessThanOrEqual(w.y + 1);
  expect(bb.x).toBeGreaterThanOrEqual(0);
  expect(bb.x + bb.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  // Two handles, 44 px to hit.
  for (const which of ["start", "end"]) {
    const h = (await page.getByTestId(`selection-handle-${which}`).boundingBox())!;
    expect(h.width).toBeGreaterThanOrEqual(44);
    expect(h.height).toBeGreaterThanOrEqual(44);
  }
  // Bold toggles bold on the word.
  const bold = bar.getByRole("button", { name: "Bold", exact: true });
  await expect(bold).toHaveAttribute("aria-pressed", "false");
  await bold.tap();
  await expect(bold).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".ProseMirror strong").first()).toHaveText("Reference");
  await page.screenshot({ path: `${SHOTS}/P10-M4-selection-${project}.png` });

  // Drag the end handle two words further ("documents should").
  const end = (await page.getByTestId("selection-handle-end").boundingBox())!;
  const target = await textBox(page, "should", 0);
  const sx = end.x + end.width / 2;
  const sy = end.y + end.height / 2;
  const tx = target.x + target.width - 1;
  const steps: { x: number; y: number }[][] = [];
  for (let i = 0; i <= 6; i++) steps.push([{ x: sx + ((tx - sx) * i) / 6, y: sy + ((target.y + target.height / 2 - (w.y + w.height / 2)) * i) / 6 }]);
  steps.push([]);
  await touch(page, steps);
  await expect.poll(() => selectedText(page)).toBe("Reference documents should");
  await expect(bar).toBeVisible();

  // "⋯": the editor's context menu (a sheet on the phone) with the desktop's items.
  await bar.getByRole("button", { name: "More", exact: true }).tap();
  const menu = project === "mobile" ? page.getByTestId("context-sheet") : page.getByRole("menu", { name: "Editor" });
  await expect(menu).toBeVisible();
  const items = (await menu.getByRole("menuitem").allInnerTexts()).map((s) => s.replace(/\s+/g, " ").trim());
  for (const want of ["Cut", "Copy", "Paste", "New Comment", "Paragraph…"]) expect(items.some((i) => i.startsWith(want)), want).toBe(true);
  await expect(page.getByTestId("selection-bar")).toHaveCount(0);
  await page.keyboard.press("Escape");
  errors.expectNone();
}

