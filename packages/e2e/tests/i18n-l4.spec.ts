// P9-L4: Danish (da) and Finnish (fi). A browser in the language gets the UI in
// it (Home tab, Save in the backstage, informal address), the language can be
// switched on the portal, and no ribbon label is clipped at 1400 and 1024 px.
// `I18N_SHOTS=<dir>` saves screenshots of the ribbon of each app.

import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { trackErrors } from "../support/common";

const shots = process.env.I18N_SHOTS;
const shot = async (page: Page, name: string) => {
  if (shots) await page.screenshot({ path: path.join(shots, `${name}.png`) });
};

const APPS = [
  { app: "calc", ready: (p: Page) => p.getByTestId("grid") },
  { app: "write", ready: (p: Page) => p.locator(".ProseMirror") },
  { app: "show", ready: (p: Page) => p.getByTestId("editor-stage") },
] as const;

const LANGS = [
  {
    code: "da",
    locale: "da-DK",
    home: "Startside",
    insert: "Indsæt",
    view: "Vis",
    file: "Filer",
    save: /^Gem(?! som)/,
    saveAs: /^Gem som…/,
    recent: "Seneste",
    formal: /(?<![\p{L}])(De|Dem|Deres)(?![\p{L}])/u,
    portalOpen: (app: string) => `Åbn ${app} i browseren`,
    portalText: "En lille office-pakke med en Rust-kerne",
  },
  {
    code: "fi",
    locale: "fi-FI",
    home: "Aloitus",
    insert: "Lisää",
    view: "Näytä",
    file: "Tiedosto",
    save: /^Tallenna(?! nimellä)/,
    saveAs: /^Tallenna nimellä…/,
    recent: "Viimeisimmät",
    formal: /(?<![\p{L}])(Te|Teidän|Teille|Teitä)(?![\p{L}])/u,
    portalOpen: (app: string) => `Avaa ${app} selaimessa`,
    portalText: "Pieni toimisto-ohjelmisto Rust-ytimellä",
  },
] as const;

/** Labels (leaf elements of the ribbon strip and panel) whose text does not fit their box. */
async function clippedLabels(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const bad: string[] = [];
    const roots = [document.querySelector('[data-testid="ribbon"]')].filter(Boolean) as Element[];
    for (const root of roots) {
      for (const el of Array.from(root.querySelectorAll<HTMLElement>("*"))) {
        if (el.children.length > 0 || !el.textContent?.trim()) continue;
        if (el.clientWidth === 0 || el.closest('[aria-hidden="true"]')) continue; // gallery previews are cropped on purpose
        if (el.scrollWidth > el.clientWidth + 1) bad.push(`${el.textContent.trim()} (${el.scrollWidth}>${el.clientWidth})`);
      }
    }
    return bad;
  });
}

for (const L of LANGS) {
  test.describe(`${L.code} UI`, () => {
    test.use({ locale: L.locale });

    for (const { app, ready } of APPS) {
      test(`${app}: the browser language selects ${L.code} – Home tab, Save, informal address`, async ({ page }) => {
        const errors = trackErrors(page);
        await page.goto(`${app}/`);
        await ready(page).first().waitFor();
        await expect(page.locator("html")).toHaveAttribute("lang", L.code);
        await expect(page.getByRole("tab", { name: L.home, exact: true })).toHaveAttribute("aria-selected", "true");
        await expect(page.getByRole("tab", { name: L.insert, exact: true })).toBeVisible();
        await page.getByRole("tab", { name: L.file, exact: true }).click();
        const backstage = page.getByTestId("backstage");
        await expect(backstage.getByRole("button", { name: L.save })).toBeVisible();
        await expect(backstage.getByRole("button", { name: L.saveAs })).toBeVisible();
        await expect(backstage.getByRole("heading", { name: L.recent })).toBeVisible();
        expect(await backstage.innerText()).not.toMatch(L.formal);
        errors.expectNone();
      });

      for (const width of [1400, 1024]) {
        test(`${app}: no clipped ribbon labels at ${width} px`, async ({ page }) => {
          const errors = trackErrors(page);
          await page.setViewportSize({ width, height: 900 });
          await page.goto(`${app}/`);
          await ready(page).first().waitFor();
          const tabs = page.getByTestId("ribbon").getByRole("tab");
          const count = await tabs.count();
          const problems: string[] = [];
          for (let i = 0; i < count; i++) {
            const tab = tabs.nth(i);
            const name = (await tab.innerText()).trim();
            if (name === L.file) continue; // the backstage, not a ribbon tab
            await tab.click();
            for (const c of await clippedLabels(page)) problems.push(`${name}: ${c}`);
            await shot(page, `P9-L4-${app}-${L.code}-${width}-${i}`);
          }
          expect(problems).toEqual([]);
          errors.expectNone();
        });
      }
    }

    test("portal: texts in the language, the list switches it", async ({ page }) => {
      const errors = trackErrors(page);
      await page.goto("./");
      await expect(page.locator("html")).toHaveAttribute("lang", L.code);
      for (const app of ["Calc", "Write", "Show"]) {
        await expect(page.getByRole("link", { name: L.portalOpen(app) })).toHaveAttribute("href", `/${app.toLowerCase()}/`);
      }
      await expect(page.getByText(L.portalText)).toBeVisible();
      const list = page.getByTestId("portal-language");
      await expect(list).toHaveValue(L.code);
      await list.selectOption("de");
      await expect(page.getByRole("link", { name: "Calc im Browser öffnen" })).toBeVisible();
      await list.selectOption(L.code);
      await expect(page.getByRole("link", { name: L.portalOpen("Calc") })).toBeVisible();
      errors.expectNone();
    });

    test("View › Language switches an English app to the language and the choice carries to the other apps", async ({ browser }) => {
      const ctx = await browser.newContext({ locale: "en-US" });
      const page = await ctx.newPage();
      const errors = trackErrors(page);
      await page.goto("write/");
      await page.locator(".ProseMirror").first().waitFor();
      await page.getByRole("tab", { name: "View", exact: true }).click();
      await page.getByRole("combobox", { name: "Language / Sprache" }).selectOption(L.code);
      await expect(page.locator("html")).toHaveAttribute("lang", L.code);
      await expect(page.getByRole("tab", { name: L.view, exact: true })).toBeVisible();
      await page.goto("calc/");
      await page.getByTestId("grid").first().waitFor();
      await expect(page.locator("html")).toHaveAttribute("lang", L.code);
      errors.expectNone();
      await ctx.close();
    });
  });
}
