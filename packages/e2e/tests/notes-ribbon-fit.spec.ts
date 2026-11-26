// P11-X1: the Notes ribbon in the languages with the longest labels (fr, de, fi, hu, el) – no clipped label on any
// tab at 1024 px (and 1400 px), the same clipping rule as the Calc/Write/Show scan in i18n.spec.ts
// (support/i18n.ts `clippedRibbonLabels`). The language comes from the shared choice (`rusuite.locale`).

import { expect, test, type Page } from "@playwright/test";
import { trackErrors } from "../support/common";
import { clippedRibbonLabels, msg } from "../support/i18n";

const LANGS = ["fr", "de", "fi", "hu", "el"] as const;

const ribbonTabs = (page: Page) => page.getByRole("tablist").first().getByRole("tab");

for (const lang of LANGS) {
  const m = (key: string) => msg(lang, key);
  test(`notes: ${lang} – every ribbon tab fits at 1024 px and 1400 px`, async ({ page }) => {
    test.setTimeout(90_000);
    const errors = trackErrors(page);
    await page.addInitScript((l) => {
      try {
        localStorage.setItem("rusuite.locale", l);
      } catch {
        // no storage: the test fails on the language check below
      }
    }, lang);
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.goto("notes/");
    await expect(page.getByTestId("page-editor")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", lang);
    await expect(page.getByRole("tab", { name: m("tab.home"), exact: true })).toBeVisible();
    for (const width of [1024, 1400]) {
      await page.setViewportSize({ width, height: 800 });
      const names = (await ribbonTabs(page).allInnerTexts()).map((s) => s.trim()).filter((s) => s && s !== m("ribbon.file"));
      expect(names.length).toBeGreaterThanOrEqual(4);
      for (const name of names) {
        await ribbonTabs(page).getByText(name, { exact: true }).click();
        await expect.poll(() => clippedRibbonLabels(page), { message: `notes ${lang} ${width}px tab ${name}` }).toEqual([]);
      }
    }
    errors.expectNone();
  });
}
