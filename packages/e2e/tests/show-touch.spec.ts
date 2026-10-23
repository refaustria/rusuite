// P10-M5: Show with fingers. Projects: `mobile` (Pixel 7, 412 × 915, touch) runs the @mobile tests, `tablet`
// (1024 × 768, touch, the desktop ribbon) the @tablet ones (playwright.config.ts). Multi-finger gestures go through
// the DevTools touch events (`Input.dispatchTouchEvent`), as a phone delivers them.

import { expect, test, type CDPSession, type Locator, type Page } from "@playwright/test";
import { testdata, trackErrors } from "../support/common";

const SHOTS = "../../shots";
const DECK = testdata("pptx/provisional-25-pitch-deck.pptx");

const bar = (page: Page) => page.getByTestId("command-bar");
const chips = (page: Page) => page.getByTestId("command-tabs").getByRole("tab");
const chip = (page: Page, name: string) => page.getByTestId("command-tabs").getByRole("tab", { name, exact: true });
const strip = (page: Page) => page.locator("[data-compact-strip]");
const stage = (page: Page) => page.getByTestId("editor-stage");
const thumbs = (page: Page) => page.getByTestId("slide-strip").getByTestId("thumbnail");

/** Opens the pitch deck (6 slides) through File › Open of the compact top bar or the ribbon. */
async function openDeck(page: Page, compact = true) {
  await page.goto("show/");
  await stage(page).waitFor();
  await expect(page.getByTestId("dirty")).toHaveText(/Saved|Gespeichert/);
  if (compact) await page.getByTestId("compact-file").click();
  else await page.getByRole("tab", { name: "File", exact: true }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByTestId("backstage").getByRole("button", { name: /^(Open|Öffnen)/ }).click();
  await (await chooser).setFiles(DECK);
  await expect(page.getByTestId("slide-count")).toHaveText(/(Slide|Folie) 1 (of|von) 6/);
}

/** A touch held still for 800 ms at a viewport point (the app's long press: 500 ms). */
async function longPress(page: Page, x: number, y: number) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  await page.waitForTimeout(800);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
  // the compatibility mouse events of the answered press are swallowed for 400 ms (installLongPress)
  await page.waitForTimeout(450);
}

/** A touch path: start at `points[0]`, move through the others, lift. `hold` ms before moving (a long-press drag). */
async function touchPath(page: Page, points: { x: number; y: number }[], hold = 0) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [points[0]!] });
  if (hold) await page.waitForTimeout(hold);
  for (const p of points.slice(1)) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [p] });
    await page.waitForTimeout(16);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

/** Two fingers from `a0`/`b0` to `a1`/`b1` in `steps` moves. */
async function twoFingers(cdp: CDPSession, page: Page, a0: Pt, b0: Pt, a1: Pt, b1: Pt, steps = 8) {
  const at = (p: Pt, q: Pt, k: number) => ({ x: p.x + ((q.x - p.x) * k) / steps, y: p.y + ((q.y - p.y) * k) / steps });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...a0, id: 1 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...a0, id: 1 }, { ...b0, id: 2 }] });
  for (let k = 1; k <= steps; k++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ ...at(a0, a1, k), id: 1 }, { ...at(b0, b1, k), id: 2 }] });
    await page.waitForTimeout(16);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [{ ...a1, id: 1 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

interface Pt {
  x: number;
  y: number;
}

/** Whether the page itself scrolls sideways (it must not). */
const pageOverflow = (page: Page) =>
  page.evaluate(() => {
    const app = document.querySelector<HTMLElement>("[data-rs-app]")!;
    return Math.max(document.documentElement.scrollWidth, document.body.scrollWidth, app.scrollWidth) - window.innerWidth;
  });

const center = async (l: Locator) => {
  const b = (await l.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};

test.describe("Show touch chrome @mobile", () => {
  test("the slide strip: all slides, the slide fits the width, tap and long press on a thumbnail", async ({ page }) => {
    const errors = trackErrors(page);
    await openDeck(page);
    await expect(page.getByTestId("slide-list")).toHaveCount(0);
    await expect(thumbs(page)).toHaveCount(6);
    const s = (await page.getByTestId("slide-strip").boundingBox())!;
    expect(Math.round(s.height)).toBe(72);
    const top = (await page.getByTestId("compact-topbar").boundingBox())!;
    expect(Math.round(s.y)).toBe(Math.round(top.y + top.height));
    // the slide fits the width (letterboxed), nothing scrolls sideways
    const area = (await page.getByTestId("canvas-area").boundingBox())!;
    const st = (await stage(page).boundingBox())!;
    expect(st.width).toBeGreaterThan(area.width - 24);
    expect(st.width).toBeLessThanOrEqual(area.width);
    expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
    await expect(thumbs(page).first()).toHaveAttribute("aria-current", "true");
    await page.screenshot({ path: `${SHOTS}/P10-M5-strip.png` });

    await thumbs(page).nth(2).tap();
    await expect(page.getByTestId("slide-count")).toHaveText("Slide 3 of 6");
    await expect(thumbs(page).nth(2)).toHaveAttribute("aria-current", "true");
    for (const b of await thumbs(page).all()) {
      const r = (await b.boundingBox())!;
      expect(Math.min(r.width, r.height)).toBeGreaterThanOrEqual(44);
    }

    const c = await center(thumbs(page).nth(2));
    await longPress(page, c.x, c.y);
    const sheet = page.getByTestId("context-sheet");
    await expect(sheet).toBeVisible();
    const items = (await sheet.getByRole("menuitem").allInnerTexts()).map((x) => x.trim());
    expect(items).toEqual(["New slide", "Duplicate slide", "Delete slide", "Hide slide", "Layout…", "Transition…"]);
    for (const b of await sheet.getByRole("menuitem").all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: `${SHOTS}/P10-M5-strip-sheet.png` });
    await sheet.getByRole("menuitem", { name: "Duplicate slide" }).tap();
    await expect(thumbs(page)).toHaveCount(7);
    await expect(page.getByTestId("slide-count")).toHaveText("Slide 4 of 7");

    // Layout… swaps the sheet for the layouts; Transition… shows the Transitions tab
    await longPress(page, c.x, c.y);
    await sheet.getByRole("menuitem", { name: "Layout…" }).tap();
    await expect(sheet.getByRole("menuitem", { name: /^Layout: / }).first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await longPress(page, c.x, c.y);
    await sheet.getByRole("menuitem", { name: "Transition…" }).tap();
    await expect(chip(page, "Transitions")).toHaveAttribute("aria-selected", "true");
    errors.expectNone();
  });

  test("long press and drag on a thumbnail reorders the slides", async ({ page }) => {
    const errors = trackErrors(page);
    await openDeck(page);
    await thumbs(page).nth(1).tap();
    await expect(page.getByTestId("slide-count")).toHaveText("Slide 2 of 6");
    const from = await center(thumbs(page).nth(0));
    const to = (await thumbs(page).nth(2).boundingBox())!;
    const end = { x: to.x + to.width - 4, y: from.y };
    const path = Array.from({ length: 10 }, (_, k) => ({ x: from.x + ((end.x - from.x) * k) / 9, y: from.y }));
    await touchPath(page, path, 800);
    await expect(page.getByTestId("context-sheet")).toHaveCount(0);
    // slide 1 now sits after the old slide 3: the current slide (the old slide 2) is the first
    await expect(page.getByTestId("slide-count")).toHaveText("Slide 1 of 6");
    await expect(page.getByTestId("dirty")).toHaveText("Modified");
    errors.expectNone();
  });

  test("the notes are a sheet from the Notes chip of the status footer", async ({ page }) => {
    const errors = trackErrors(page);
    await openDeck(page);
    await expect(page.getByTestId("notes-pane")).toHaveCount(0);
    const notesChip = page.getByTestId("notes-chip");
    const r = (await notesChip.boundingBox())!;
    expect(Math.min(r.width, r.height)).toBeGreaterThanOrEqual(44);
    await notesChip.tap();
    const sheet = page.getByTestId("notes-sheet");
    await expect(sheet).toBeVisible();
    const notes = sheet.getByRole("textbox", { name: "Speaker notes" });
    await notes.fill("Mention the market size");
    await page.getByTestId("sheet-handle").tap();
    await expect(sheet).toHaveCount(0);
    await expect(page.getByTestId("dirty")).toHaveText("Modified");
    await notesChip.tap();
    await expect(page.getByTestId("notes-sheet").getByRole("textbox", { name: "Speaker notes" })).toHaveValue("Mention the market size");
    errors.expectNone();
  });

  test("Timing… opens a sheet with duration, delay and advance-after; the bar keeps one height on every tab", async ({ page }) => {
    const errors = trackErrors(page);
    await openDeck(page);
    const heights = new Map<string, number>();
    for (const label of (await chips(page).allInnerTexts()).map((x) => x.trim())) {
      await chip(page, label).click();
      await expect(chip(page, label)).toHaveAttribute("aria-selected", "true");
      heights.set(label, Math.round((await bar(page).boundingBox())!.height));
    }
    expect(new Set(heights.values()).size, JSON.stringify([...heights])).toBe(1);

    await chip(page, "Transitions").click();
    await strip(page).getByRole("button", { name: "Timing…" }).tap();
    const sheet = page.getByTestId("popup-sheet");
    await expect(sheet.getByTestId("timing-sheet")).toBeVisible();
    for (const name of ["Duration (s)", "Advance after (mm:ss)"]) await expect(sheet.getByRole("textbox", { name, exact: true })).toBeVisible();
    await expect(sheet.getByRole("checkbox", { name: "After:", exact: true })).toBeVisible();
    await expect(sheet.getByRole("checkbox", { name: "On mouse click" })).toBeVisible();
    await sheet.getByRole("checkbox", { name: "After:", exact: true }).check();
    await expect(page.getByTestId("dirty")).toHaveText("Modified");
    for (const b of await sheet.locator("button:not([data-sheet-handle]), input, select").all()) {
      const r = (await b.boundingBox())!;
      const type = await b.getAttribute("type");
      if (type === "checkbox") continue;
      expect(r.height, (await b.getAttribute("aria-label")) ?? "").toBeGreaterThanOrEqual(44);
    }
    await page.screenshot({ path: `${SHOTS}/P10-M5-timing.png` });
    await page.keyboard.press("Escape");

    await chip(page, "Animations").click();
    await strip(page).getByRole("button", { name: "Timing…" }).tap();
    await expect(sheet.getByRole("textbox", { name: "Delay (s)" })).toBeVisible();
    await expect(sheet.getByRole("combobox", { name: "Start" })).toBeVisible();
    errors.expectNone();
  });
});

/** The selected shape's transform (EMU) from the stage's `data-selection-box`. */
async function selectionBox(page: Page) {
  const v = await stage(page).getAttribute("data-selection-box");
  expect(v, "one shape selected").toBeTruthy();
  const [x, y, w, h, rot] = v!.split(",").map(Number);
  return { x: x!, y: y!, w: w!, h: h!, rot: rot! };
}

/** The screen box (viewport px) of the selected shape and the slide scale, through Konva's stage. */
async function selectedOnScreen(page: Page) {
  return page.evaluate(() => {
    const K = (window as unknown as { Konva: { stages: { container(): HTMLElement; findOne(s: string): unknown; scaleX(): number }[] } }).Konva;
    const st = K.stages.find((s) => s.container().closest('[data-testid="editor-stage"]'))!;
    const tr = st.findOne("Transformer") as { nodes(): { getClientRect(): { x: number; y: number; width: number; height: number } }[] };
    const r = tr.nodes()[0]!.getClientRect();
    const c = st.container().getBoundingClientRect();
    return { x: c.left + r.x, y: c.top + r.y, width: r.width, height: r.height, scale: st.scaleX() };
  });
}

/**
 * For every visible anchor of the transformer: its centre and whether the stage's hit test still finds it 20 px
 * away from it (outwards and, for big boxes, along the edges) – i.e. its hit area is at least 40 + px wide.
 */
async function anchorHits(page: Page) {
  return page.evaluate(() => {
    type N = { name(): string; visible(): boolean; getClientRect(): { x: number; y: number; width: number; height: number } };
    const K = (window as unknown as { Konva: { stages: { container(): HTMLElement; findOne(s: string): unknown; getIntersection(p: { x: number; y: number }): N | null }[] } }).Konva;
    const st = K.stages.find((s) => s.container().closest('[data-testid="editor-stage"]'))!;
    const tr = st.findOne("Transformer") as { find(s: string): N[]; getClientRect(): { x: number; y: number; width: number; height: number } };
    const out: { name: string; ok: boolean }[] = [];
    for (const a of tr.find("._anchor")) {
      if (!a.visible()) continue;
      const r = a.getClientRect();
      const c = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      const name = a.name().split(" ")[0]!;
      const offsets = [[-21, 0], [21, 0], [0, -21], [0, 21]];
      const ok = offsets.every(([dx, dy]) => st.getIntersection({ x: c.x + dx!, y: c.y + dy! })?.name().split(" ")[0] === name);
      out.push({ name, ok });
    }
    return out;
  });
}

async function insertRectangle(page: Page) {
  await chip(page, "Insert").click();
  await strip(page).getByRole("button", { name: "Shapes", exact: true }).tap();
  await page.getByRole("dialog", { name: "Shapes" }).getByRole("group", { name: "Rectangles" }).getByRole("button", { name: "Rectangle", exact: true }).press("Enter");
  await expect(chip(page, "Shape Format")).toBeVisible();
  await expect(stage(page)).toHaveAttribute("data-selection-count", "1");
}

test.describe("Show touch transforms @mobile", () => {
  test("tap selects, drag moves, pinch scales, twist turns (snapped), the handles have 44 px hit areas", async ({ page }) => {
    const errors = trackErrors(page);
    await openDeck(page);
    await insertRectangle(page);
    const b0 = await selectionBox(page);
    // a tap on the empty slide deselects, a tap on the shape selects it again
    const st = (await stage(page).boundingBox())!;
    await page.touchscreen.tap(st.x + 6, st.y + st.height - 6);
    await expect(stage(page)).toHaveAttribute("data-selection-count", "0");
    const k = await page.evaluate(() => (window as unknown as { Konva: { stages: { container(): HTMLElement; scaleX(): number }[] } }).Konva.stages.find((s) => s.container().closest('[data-testid="editor-stage"]'))!.scaleX());
    await page.touchscreen.tap(st.x + ((b0.x + b0.w / 2) / 9525) * k, st.y + ((b0.y + b0.h / 2) / 9525) * k);
    await expect(stage(page)).toHaveAttribute("data-selection-count", "1");

    // one finger drags it 60 px to the right
    const scr = await selectedOnScreen(page);
    const c = { x: scr.x + scr.width / 2, y: scr.y + scr.height / 2 };
    await touchPath(page, Array.from({ length: 8 }, (_, k) => ({ x: c.x + (60 * k) / 7, y: c.y })));
    await expect.poll(async () => (await selectionBox(page)).x).toBeGreaterThan(b0.x);
    const b1 = await selectionBox(page);
    const emuPerScreenPx = 9525 / scr.scale;
    expect(Math.abs(b1.x - b0.x - 60 * emuPerScreenPx)).toBeLessThan(6 * emuPerScreenPx);
    expect(b1.y).toBe(b0.y);
    expect(b1.w).toBe(b0.w);

    // two fingers apart: three times the size
    const cdp = await page.context().newCDPSession(page);
    const c1 = { x: c.x + 60, y: c.y };
    await twoFingers(cdp, page, { x: c1.x - 20, y: c1.y }, { x: c1.x + 20, y: c1.y }, { x: c1.x - 60, y: c1.y }, { x: c1.x + 60, y: c1.y });
    await expect.poll(async () => (await selectionBox(page)).w).toBeGreaterThan(b1.w * 1.5);
    const b2 = await selectionBox(page);
    expect(b2.w / b1.w).toBeGreaterThan(2.8);
    expect(b2.w / b1.w).toBeLessThan(3.2);
    expect(b2.h / b1.h).toBeCloseTo(b2.w / b1.w, 1);
    expect(b2.rot).toBe(0);
    await expect(page.getByTestId("dirty")).toHaveText("Modified");

    // a twist by 88°: 90° (snapped)
    const r = 40;
    const a = (88 * Math.PI) / 180;
    await twoFingers(cdp, page, { x: c1.x - r, y: c1.y }, { x: c1.x + r, y: c1.y }, { x: c1.x - r * Math.cos(a), y: c1.y - r * Math.sin(a) }, { x: c1.x + r * Math.cos(a), y: c1.y + r * Math.sin(a) }, 12);
    await expect.poll(async () => (await selectionBox(page)).rot).toBe(90);
    // 30° further: not snapped
    const a2 = (60 * Math.PI) / 180;
    await twoFingers(cdp, page, { x: c1.x, y: c1.y - r }, { x: c1.x, y: c1.y + r }, { x: c1.x + r * Math.cos(a2), y: c1.y - r * Math.sin(a2) }, { x: c1.x - r * Math.cos(a2), y: c1.y + r * Math.sin(a2) }, 12);
    await expect.poll(async () => (await selectionBox(page)).rot).toBe(120);
    await cdp.detach();

    // the handles: hit 20 px off their centre (44 px areas), the rotate handle too
    const hits = await anchorHits(page);
    expect(hits.map((h) => h.name)).toContain("rotater");
    expect(hits.length).toBeGreaterThanOrEqual(5);
    expect(hits.filter((h) => !h.ok)).toEqual([]);
    await page.screenshot({ path: `${SHOTS}/P10-M5-transformer.png` });
    errors.expectNone();
  });

  test("long press on a shape: the context sheet; a tap on the selected text shape edits its text", async ({ page }) => {
    const errors = trackErrors(page);
    await openDeck(page);
    // the title of slide 1 (its centre is the slide's upper middle)
    const st = (await stage(page).boundingBox())!;
    const title = { x: st.x + st.width / 2, y: st.y + st.height * 0.38 };
    await longPress(page, title.x, title.y);
    const sheet = page.getByTestId("context-sheet");
    await expect(sheet).toBeVisible();
    await expect(stage(page)).toHaveAttribute("data-selection-count", "1");
    const items = (await sheet.getByRole("menuitem").allInnerTexts()).map((x) => x.replace(/\s+/g, " ").trim());
    for (const want of ["Cut", "Copy", "Paste"]) expect(items.some((i) => i.startsWith(want)), want).toBe(true);
    expect(items.some((i) => i.startsWith("Format shape"))).toBe(true);
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    // the shape is selected: a tap edits it (not after the long press)
    await expect(page.getByTestId("text-overlay")).toHaveCount(0);
    await page.touchscreen.tap(title.x, title.y);
    const editor = page.getByTestId("text-overlay");
    await expect(editor).toBeVisible();
    await expect(editor).toBeFocused();
    // the editor lies over the shape
    const box = (await page.getByTestId("text-overlay-box").boundingBox())!;
    expect(box.x).toBeLessThan(title.x);
    expect(box.x + box.width).toBeGreaterThan(title.x);
    await page.keyboard.press("End");
    await page.keyboard.type(" touch");
    await expect(editor).toContainText("touch");
    await page.touchscreen.tap(st.x + 6, st.y + st.height - 6);
    await expect(editor).toHaveCount(0);
    await expect(stage(page)).toHaveAttribute("data-selection-count", "0");
    await expect(page.getByTestId("dirty")).toHaveText("Modified");
    errors.expectNone();
  });

  test("two fingers on the empty slide zoom the canvas (50–300 %), one finger pans it; Multi-select taps add shapes", async ({ page }) => {
    const errors = trackErrors(page);
    await openDeck(page);
    const st0 = (await stage(page).boundingBox())!;
    const cdp = await page.context().newCDPSession(page);
    const m = { x: st0.x + 20, y: st0.y + st0.height - 20 };
    await twoFingers(cdp, page, { x: m.x, y: m.y - 10 }, { x: m.x + 30, y: m.y - 10 }, { x: m.x - 20, y: m.y - 10 }, { x: m.x + 100, y: m.y - 10 });
    await expect(page.getByTestId("canvas-area")).toHaveAttribute("data-touch-zoom", /.+/);
    const z = Number(await page.getByTestId("canvas-area").getAttribute("data-touch-zoom"));
    expect(z).toBeGreaterThan(3.5 * 0.7);
    expect(z).toBeLessThanOrEqual(3);
    const st1 = (await stage(page).boundingBox())!;
    expect(st1.width / st0.width).toBeCloseTo(z, 1);
    expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
    // one finger on the empty slide pans the area
    const area = page.getByTestId("canvas-area");
    const left = await area.evaluate((el) => el.scrollLeft);
    const ab = (await area.boundingBox())!;
    const p0 = { x: ab.x + ab.width / 2, y: ab.y + ab.height - 30 };
    await touchPath(page, Array.from({ length: 8 }, (_, k) => ({ x: p0.x - (100 * k) / 7, y: p0.y })));
    await expect.poll(() => area.evaluate((el) => el.scrollLeft)).toBeGreaterThan(left + 60);
    // pinch in: down to 50 %
    const c = { x: ab.x + ab.width / 2, y: ab.y + ab.height / 2 };
    for (let i = 0; i < 3; i++) await twoFingers(cdp, page, { x: c.x - 150, y: c.y + 200 }, { x: c.x + 150, y: c.y + 200 }, { x: c.x - 20, y: c.y + 200 }, { x: c.x + 20, y: c.y + 200 });
    await expect(area).toHaveAttribute("data-touch-zoom", "0.5");
    await cdp.detach();

    // Multi-select (Home): taps add to the selection
    await chip(page, "Home").click();
    const multi = strip(page).getByRole("button", { name: "Multi-select" });
    await multi.tap();
    await expect(multi).toHaveAttribute("aria-pressed", "true");
    const st = (await stage(page).boundingBox())!;
    await page.touchscreen.tap(st.x + st.width / 2, st.y + st.height * 0.38);
    await page.touchscreen.tap(st.x + st.width / 2, st.y + st.height * 0.6);
    await expect(stage(page)).toHaveAttribute("data-selection-count", "2");
    await page.touchscreen.tap(st.x + st.width / 2, st.y + st.height * 0.6);
    await expect(stage(page)).toHaveAttribute("data-selection-count", "1");
    await multi.tap();
    await expect(multi).toHaveAttribute("aria-pressed", "false");
    errors.expectNone();
  });
});
