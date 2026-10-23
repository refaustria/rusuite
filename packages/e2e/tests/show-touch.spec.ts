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
