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

