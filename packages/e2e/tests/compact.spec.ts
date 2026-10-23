// P10-M2: the compact (phone) layout below 900 px and the tablet guard at 1024 px.
// Projects: `mobile` (Pixel 7 emulation at 412 × 915, touch) runs the @mobile tests, `tablet` (1024 × 768, touch)
// the @tablet ones (playwright.config.ts). The ribbon definitions are the source of truth: the desktop ribbon of the
// same build is walked tab by tab (in a desktop context of the same browser) and every control it shows must be in
// the command bar's strip of that tab.

import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { testdata, trackErrors } from "../support/common";
import { Grid } from "../support/calc";
import { msg } from "../support/i18n";

const SHOTS = "../../shots";

const APPS = [
  {
    app: "calc",
    ready: (p: Page) => p.getByTestId("grid"),
    fixture: testdata("xlsx", "provisional-basic.xlsx"),
    name: "provisional-basic.xlsx",
  },
  {
    app: "write",
    ready: (p: Page) => p.locator(".ProseMirror"),
    fixture: testdata("docx", "provisional-01-heading-1.docx"),
    name: "provisional-01-heading-1.docx",
  },
  {
    app: "show",
    ready: (p: Page) => p.getByTestId("editor-stage"),
    fixture: testdata("pptx", "provisional-01-single-title-slide.pptx"),
    name: "provisional-01-single-title-slide.pptx",
  },
] as const;

const bar = (page: Page) => page.getByTestId("command-bar");
const chips = (page: Page) => page.getByTestId("command-tabs").getByRole("tab");
const chip = (page: Page, name: string) => page.getByTestId("command-tabs").getByRole("tab", { name, exact: true });
const strip = (page: Page) => page.locator("[data-compact-strip]");

async function openApp(page: Page, app: string, ready: (p: Page) => Locator) {
  await page.goto(`${app}/`);
  await ready(page).first().waitFor();
  await expect(page.getByTestId("status-bar")).toContainText(/Saved|Gespeichert|Revision/);
}

/**
 * The names of the controls in `root` as both layouts compute them: buttons, selects and inputs (their aria-label,
 * else label, title or text), inline galleries (their group name; compact: a button of that name) and the menus of
 * split buttons (desktop: the arrow's name; compact: `data-split-menu`). Gallery items are choices, not controls.
 */
function controlNames(root: Locator): Promise<string[]> {
  return root.evaluate((el) => {
    const names = new Set<string>();
    const name = (c: HTMLElement) =>
      (c.getAttribute("aria-label") ?? (c as HTMLInputElement).labels?.[0]?.textContent ?? c.getAttribute("title") ?? c.textContent ?? "").trim();
    for (const c of Array.from(el.querySelectorAll<HTMLElement>("button, select, input"))) {
      if (c.closest("[data-gallery-item]") || c.matches("[data-gallery-item]") || c.closest("[data-collapsed-group] > button") === c) continue;
      if ((c as HTMLInputElement).type === "file" || c.getClientRects().length === 0) continue;
      const n = name(c);
      if (n) names.add(n);
      const split = c.getAttribute("data-split-menu");
      if (split) names.add(split);
    }
    for (const g of Array.from(el.querySelectorAll<HTMLElement>('[role="group"]'))) {
      if (g.querySelector(":scope > button[data-gallery-item]")) names.add(g.getAttribute("aria-label") ?? "");
    }
    names.delete("");
    return [...names];
  });
}

/** Desktop ribbon of `app` (1920 px): tab label → control names (collapsed groups opened). */
async function desktopRibbon(browser: Browser, app: string, ready: (p: Page) => Locator, locale = "en-US"): Promise<Map<string, string[]>> {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, locale });
  const page = await ctx.newPage();
  try {
    await openApp(page, app, ready);
    await expect(page.getByTestId("ribbon")).toBeVisible();
    const tabs = page.getByTestId("ribbon").getByRole("tablist").getByRole("tab");
    const labels = (await tabs.allInnerTexts()).map((s) => s.trim()).filter((s) => s && s !== msg(locale.slice(0, 2), "ribbon.file"));
    const out = new Map<string, string[]>();
    for (const label of labels) {
      await tabs.getByText(label, { exact: true }).click();
      const panel = page.getByTestId("ribbon-panel");
      const names = new Set(await controlNames(panel));
      const collapsed = panel.locator("[data-collapsed-group] > button");
      for (let i = 0; i < (await collapsed.count()); i++) {
        await collapsed.nth(i).click();
        for (const n of await controlNames(page.getByTestId("ribbon-group-popup"))) names.add(n);
        await page.keyboard.press("Escape");
      }
      out.set(label, [...names]);
    }
    return out;
  } finally {
    await ctx.close();
  }
}

/** Long press (touch held 800 ms) at a viewport point, through the DevTools touch events. */
async function longPress(page: Page, x: number, y: number) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  await page.waitForTimeout(800);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

/** Clipped texts in the bars (the clipping scan of i18n.spec.ts; the title's ellipsis is by design). */
function clippedBarLabels(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const root of Array.from(document.querySelectorAll<HTMLElement>('[data-testid="command-bar"], [data-testid="compact-topbar"]'))) {
      for (const el of Array.from(root.querySelectorAll<HTMLElement>("*"))) {
        const text = el.textContent?.trim();
        if (!text || el.children.length > 0 || el.getClientRects().length === 0 || el.closest('[data-gallery-item], [data-testid="compact-title"], [data-compact-strip] [data-testid]')) continue;
        if (el.closest("[data-compact-strip]") && el.closest("[data-compact-strip]") === el) continue;
        const cs = getComputedStyle(el);
        const clamp = cs.getPropertyValue("-webkit-line-clamp");
        const clips = cs.overflowX !== "visible" || cs.overflowY !== "visible" || cs.textOverflow === "ellipsis" || (clamp !== "" && clamp !== "none");
        if (clips && !el.matches("[data-compact-strip], [role=tablist]") && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)) out.push(text);
      }
    }
    return out;
  });
}

/** Controls in the bars smaller than 44 × 44 px (checkboxes and radios count with their label). */
function smallTargets(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const els = document.querySelectorAll<HTMLElement>('[data-testid="command-bar"] :is(button, select, input), [data-testid="compact-topbar"] :is(button, select, input)');
    for (const el of Array.from(els)) {
      if (el.getClientRects().length === 0 || (el as HTMLInputElement).type === "file") continue;
      const target = (el as HTMLInputElement).type === "checkbox" || (el as HTMLInputElement).type === "radio" ? (el.closest("label") ?? el) : el;
      const r = target.getBoundingClientRect();
      if (r.width < 44 - 0.5 || r.height < 44 - 0.5) out.push(`${el.getAttribute("aria-label") ?? el.textContent?.trim()} ${Math.round(r.width)}×${Math.round(r.height)}`);
    }
    return out;
  });
}

/** Whether the page itself scrolls sideways (it must not). */
const pageOverflow = (page: Page) =>
  page.evaluate(() => {
    const app = document.querySelector<HTMLElement>("[data-rs-app]")!;
    return Math.max(document.documentElement.scrollWidth, document.body.scrollWidth, app.scrollWidth) - window.innerWidth;
  });

test.describe("compact layout @mobile", () => {
  for (const { app, ready, fixture, name } of APPS) {
    test(`${app}: top bar and command bar replace the ribbon; every ribbon tab is a chip and every control is in its strip`, async ({ page, browser }) => {
      test.setTimeout(180_000);
      const errors = trackErrors(page);
      const desktop = await desktopRibbon(browser, app, ready);
      await openApp(page, app, ready);
      await expect(page.getByTestId("ribbon")).toHaveCount(0);
      await expect(page.getByTestId("compact-topbar")).toBeVisible();
      await expect(bar(page)).toBeVisible();
      expect((await chips(page).allInnerTexts()).map((s) => s.trim())).toEqual([...desktop.keys()]);
      for (const [label, controls] of desktop) {
        await chip(page, label).click();
        await expect(chip(page, label)).toHaveAttribute("aria-selected", "true");
        await expect(strip(page)).toHaveAttribute("aria-label", /.+/);
        const compact = new Set(await controlNames(strip(page)));
        expect(controls.length, `${app} › ${label}: desktop controls found`).toBeGreaterThan(0);
        const missing = controls.filter((c) => !compact.has(c));
        expect(missing, `${app} › ${label}: controls missing in the command bar`).toEqual([]);
      }
      // The strip remembers its scroll position per tab.
      const first = (await chips(page).first().innerText()).trim();
      await chip(page, first).click();
      await strip(page).evaluate((el) => (el.scrollLeft = 120));
      await chip(page, (await chips(page).nth(1).innerText()).trim()).click();
      await expect.poll(() => strip(page).evaluate((el) => el.scrollLeft)).toBe(0);
      await chip(page, first).click();
      await expect.poll(() => strip(page).evaluate((el) => el.scrollLeft)).toBe(120);
      await page.screenshot({ path: `${SHOTS}/P10-M2-${app}-home.png` });
      errors.expectNone();
    });

    test(`${app}: open a document, edit through the command bar, save; the title shows the name`, async ({ page }) => {
      test.setTimeout(90_000);
      const errors = trackErrors(page);
      await openApp(page, app, ready);
      await page.getByTestId("compact-file").click();
      const backstage = page.getByTestId("backstage");
      await expect(backstage).toBeVisible();
      await page.screenshot({ path: `${SHOTS}/P10-M2-${app}-backstage.png` });
      const chooser = page.waitForEvent("filechooser");
      await backstage.getByRole("button", { name: /^Open/ }).click();
      await (await chooser).setFiles(fixture);
      await expect(page.getByTestId("compact-title")).toHaveText(new RegExp(`^${name.replace(/\./g, "\\.")}`));
      if (app === "calc") {
        const grid = new Grid(page);
        await grid.waitIdle();
        const p = await grid.pos(1, 1);
        await page.touchscreen.tap(p.x, p.y);
        await expect(page.getByTestId("cell-address")).toHaveValue("B2");
        await chip(page, "Home").click();
        const bold = strip(page).getByRole("button", { name: "Bold", exact: true });
        await expect(bold).toHaveAttribute("aria-pressed", "false");
        await bold.tap();
        await grid.waitIdle();
        await expect(bold).toHaveAttribute("aria-pressed", "true");
      } else if (app === "write") {
        const ed = page.locator(".ProseMirror");
        await ed.click();
        await page.keyboard.press("Control+Home");
        await page.keyboard.press("Control+Shift+ArrowRight");
        await chip(page, "Home").click();
        const bold = strip(page).getByRole("button", { name: "Bold", exact: true });
        const before = await bold.getAttribute("aria-pressed");
        await bold.tap();
        await expect(bold).toHaveAttribute("aria-pressed", before === "true" ? "false" : "true");
      } else {
        await chip(page, "Insert").click();
        await strip(page).getByRole("button", { name: "Shapes", exact: true }).tap();
        const shapes = page.getByRole("dialog", { name: "Shapes" });
        await expect(page.getByTestId("popup-sheet")).toBeVisible();
        await page.screenshot({ path: `${SHOTS}/P10-M2-${app}-sheet.png` });
        await shapes.getByRole("group", { name: "Rectangles" }).getByRole("button", { name: "Rectangle", exact: true }).press("Enter");
        await expect(chip(page, "Shape Format")).toBeVisible();
      }
      await expect(page.getByTestId("compact-title")).toHaveText(/•$/);
      await page.getByTestId("compact-file").click();
      const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("backstage").getByRole("button", { name: /^Save$/ }).click()]);
      expect(dl.suggestedFilename()).toBe(name);
      await expect(page.getByTestId("compact-title")).toHaveText(name);
      errors.expectNone();
    });

    test(`${app}: a dialog opens as a bottom sheet, works, closes with Escape and the handle and returns the focus`, async ({ page }) => {
      const errors = trackErrors(page);
      await openApp(page, app, ready);
      let opener: Locator;
      let dialogName: string;
      const open = async () => {
        if (app === "calc") {
          await chip(page, "Home").click();
          opener = strip(page).getByRole("button", { name: "Format", exact: true });
          await opener.tap();
          await page.getByTestId("popup-sheet").getByRole("menuitem", { name: "Format cells…" }).tap();
          dialogName = "Format cells";
        } else if (app === "write") {
          await chip(page, "Home").click();
          opener = strip(page).getByRole("button", { name: "Paragraph settings", exact: true });
          await opener.tap();
          dialogName = "Paragraph";
        } else {
          await chip(page, "Design").click();
          opener = strip(page).getByRole("button", { name: "Slide Size", exact: true });
          await opener.tap();
          await page.getByTestId("popup-sheet").getByRole("menuitem", { name: "Custom Slide Size…" }).tap();
          dialogName = "Slide Size";
        }
        const dialog = page.getByRole("dialog", { name: dialogName });
        await expect(dialog).toBeVisible();
        await expect(page.getByTestId("dialog-sheet")).toBeVisible();
        return dialog;
      };
      const dialog = await open();
      // A full-width sheet at the bottom, above the command bar's layer.
      const sheet = (await page.getByTestId("dialog-sheet").boundingBox())!;
      expect(Math.round(sheet.width)).toBe(412);
      expect(Math.round(sheet.y + sheet.height)).toBe(915);
      // Operable: the first control has the focus and takes input; Tab stays inside.
      await expect.poll(() => dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
      await page.keyboard.press("Tab");
      await expect.poll(() => dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
      if (app === "calc") {
        await dialog.getByRole("tab", { name: "Border" }).tap();
        await expect(dialog.getByRole("tab", { name: "Border" })).toHaveAttribute("aria-selected", "true");
      }
      await page.screenshot({ path: `${SHOTS}/P10-M2-${app}-dialog.png` });
      // The focus goes back to the opener, or where the app's close handler put it (Calc: the grid, Write: the editor), as on the desktop.
      const focusBack = () =>
        page.evaluate(() => {
          const a = document.activeElement;
          return !!a && a !== document.body && a.isConnected && !a.closest("[data-bottom-sheet]");
        });
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect.poll(focusBack).toBe(true);
      if (app === "show") await expect(opener!).toBeFocused();
      await open();
      await page.getByTestId("sheet-handle").tap();
      await expect(page.getByRole("dialog", { name: dialogName! })).toHaveCount(0);
      await expect.poll(focusBack).toBe(true);
      if (app === "show") await expect(opener!).toBeFocused();
      errors.expectNone();
    });

    test(`${app}: a long press opens the context menu as a sheet with the desktop's items`, async ({ page, browser }) => {
      const errors = trackErrors(page);
      const target = async (p: Page) => {
        if (app === "calc") return new Grid(p).pos(2, 1);
        if (app === "write") {
          const b = (await p.locator(".ProseMirror").boundingBox())!;
          return { x: b.x + 40, y: b.y + 20 };
        }
        const b = (await p.getByTestId("editor-stage").boundingBox())!;
        return { x: b.x + 6, y: b.y + b.height - 6 };
      };
      // The desktop menu at the same spot.
      const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
      const desk = await ctx.newPage();
      await openApp(desk, app, ready);
      const d = await target(desk);
      await desk.mouse.click(d.x, d.y, { button: "right" });
      const deskMenu = desk.getByRole("menu").last();
      await expect(deskMenu).toBeVisible();
      const want = (await deskMenu.getByRole("menuitem").allInnerTexts()).map((s) => s.replace(/\s+/g, " ").trim());
      await ctx.close();

      await openApp(page, app, ready);
      const m = await target(page);
      await longPress(page, m.x, m.y);
      const sheet = page.getByTestId("context-sheet");
      await expect(sheet).toBeVisible();
      await expect(page.getByRole("menu")).toHaveCount(1);
      const got = (await sheet.getByRole("menuitem").allInnerTexts()).map((s) => s.replace(/\s+/g, " ").trim());
      expect(got).toEqual(want);
      for (const b of await sheet.getByRole("menuitem").all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await page.screenshot({ path: `${SHOTS}/P10-M2-${app}-context.png` });
      await page.keyboard.press("Escape");
      await expect(sheet).toHaveCount(0);
      errors.expectNone();
    });

    for (const locale of ["en-US", "de-DE"]) {
      test(`${app}: ${locale} – no sideways page scroll, no clipped label and 44 px targets in the bars on every tab`, async ({ browser }) => {
        test.setTimeout(120_000);
        const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2.625, locale });
        const page = await ctx.newPage();
        const errors = trackErrors(page);
        await openApp(page, app, ready);
        await expect(page.locator("html")).toHaveAttribute("lang", locale.slice(0, 2));
        for (const label of (await chips(page).allInnerTexts()).map((s) => s.trim())) {
          await chip(page, label).click();
          expect(await pageOverflow(page), `${app} ${locale} ${label}: page scrolls sideways`).toBeLessThanOrEqual(0);
          await expect.poll(() => clippedBarLabels(page), { message: `${app} ${locale} ${label}: clipped` }).toEqual([]);
          expect(await smallTargets(page), `${app} ${locale} ${label}: targets under 44 px`).toEqual([]);
        }
        await page.getByTestId("compact-more").click();
        await expect(page.getByTestId("compact-more-sheet")).toBeVisible();
        for (const b of await page.getByTestId("compact-more-sheet").getByRole("menuitem").all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        if (locale === "de-DE") await page.screenshot({ path: `${SHOTS}/P10-M2-${app}-more-de.png` });
        await page.keyboard.press("Escape");
        if (locale === "de-DE") {
          await chip(page, msg("de", "tab.home")).click();
          await page.screenshot({ path: `${SHOTS}/P10-M2-${app}-home-de.png` });
        }
        errors.expectNone();
        await ctx.close();
      });
    }

    test(`${app}: the on-screen keyboard – the command bar sits on the visual viewport's bottom, the document stays visible`, async ({ page }) => {
      const errors = trackErrors(page);
      await openApp(page, app, ready);
      const focusTarget =
        app === "calc" ? page.getByLabel("Formula bar") : app === "write" ? page.locator(".ProseMirror") : page.getByTestId("editor-stage");
      await focusTarget.click();
      const visible = 500;
      await page.evaluate((h) => {
        (window as unknown as { __RUSUITE_VISUAL_VIEWPORT__: unknown }).__RUSUITE_VISUAL_VIEWPORT__ = { height: h, offsetTop: 0 };
        window.dispatchEvent(new Event("rusuite:visualviewport"));
      }, visible);
      await expect(page.locator("html")).toHaveAttribute("data-keyboard", "");
      await expect.poll(async () => Math.round(((await bar(page).boundingBox())!.y + (await bar(page).boundingBox())!.height))).toBe(visible);
      const barTop = (await bar(page).boundingBox())!.y;
      const doc = (await focusTarget.boundingBox())!;
      expect(doc.y).toBeGreaterThanOrEqual(0);
      // The formula bar entirely, the editor and the slide at least partly, above the command bar.
      if (app === "calc") expect(doc.y + doc.height).toBeLessThanOrEqual(barTop);
      else expect(doc.y).toBeLessThan(barTop - 40);
      await page.evaluate(() => {
        (window as unknown as { __RUSUITE_VISUAL_VIEWPORT__?: unknown }).__RUSUITE_VISUAL_VIEWPORT__ = undefined;
        window.dispatchEvent(new Event("rusuite:visualviewport"));
      });
      await expect.poll(async () => Math.round(((await bar(page).boundingBox())!.y + (await bar(page).boundingBox())!.height))).toBe(915);
      errors.expectNone();
    });
  }
});

test.describe("tablet @tablet", () => {
  for (const { app, ready } of APPS) {
    test(`${app}: at 1024 × 768 the desktop ribbon renders, no compact bars`, async ({ page }) => {
      const errors = trackErrors(page);
      await openApp(page, app, ready);
      await expect(page.getByTestId("ribbon")).toBeVisible();
      await expect(page.getByTestId("ribbon-panel")).toBeVisible();
      await expect(page.getByTestId("command-bar")).toHaveCount(0);
      await expect(page.getByTestId("compact-topbar")).toHaveCount(0);
      await expect(page.locator("html")).not.toHaveAttribute("data-compact", "");
      errors.expectNone();
    });
  }
});
