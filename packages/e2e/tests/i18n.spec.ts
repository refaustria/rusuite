// UI languages (P7-11, P9-L0): English is the default; a German browser gets
// the German UI; the choice (View › Language, the backstage, Options ›
// Language, the portal's language list) is persisted and shared by the
// portal and the apps. A language whose catalogs have not landed yet
// shows English without errors (Maltese, translated last).
// P9-LR1: every translated language (TRANSLATED) is checked with the labels of its catalogs.
// `I18N_SHOTS=<dir>` also saves screenshots of the German UI there.

import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { trackErrors } from "../support/common";
import { clippedRibbonLabels, escapeRe, formalForms, msg } from "../support/i18n";

const shots = process.env.I18N_SHOTS;
const shot = async (page: Page, name: string) => {
  if (shots) await page.screenshot({ path: path.join(shots, `${name}.png`) });
};

const APPS = [
  { app: "calc", ready: (p: Page) => p.getByTestId("grid") },
  { app: "write", ready: (p: Page) => p.locator(".ProseMirror") },
  { app: "show", ready: (p: Page) => p.getByTestId("editor-stage") },
] as const;

test.describe("German UI", () => {
  test.use({ locale: "de-DE" });

  for (const { app, ready } of APPS) {
    test(`${app}: the browser language selects German – "Start" tab, "Speichern" in the backstage`, async ({ page }) => {
      const errors = trackErrors(page);
      await page.goto(`${app}/`);
      await ready(page).first().waitFor();
      await expect(page.locator("html")).toHaveAttribute("lang", "de");
      await expect(page.getByRole("tab", { name: "Start", exact: true })).toHaveAttribute("aria-selected", "true");
      await expect(page.getByRole("tab", { name: "Einfügen", exact: true })).toBeVisible();
      await shot(page, `${app}-home-de`);
      await page.getByRole("tab", { name: "Datei", exact: true }).click();
      const backstage = page.getByTestId("backstage");
      await expect(backstage.getByRole("button", { name: /^Speichern(?! unter)/ })).toBeVisible();
      await expect(backstage.getByRole("button", { name: /^Speichern unter…/ })).toBeVisible();
      await expect(backstage.getByRole("heading", { name: "Zuletzt verwendet" })).toBeVisible();
      // Informal German (P8-48): "du", never the formal "Sie"/"Ihre".
      await expect(backstage.getByTestId("privacy-text")).toHaveText(/^Deine Dokumente bleiben auf diesem Gerät\..*bis du sie entfernst\.$/);
      await expect(backstage).not.toContainText("Ihre Dokumente");
      expect(await backstage.innerText()).not.toMatch(/\b(Sie|Ihnen|Ihre?[mnrs]?)\b/);
      await shot(page, `${app}-backstage-de`);
      // Shortcuts keep their keys; German shows Strg.
      await expect(backstage.getByRole("button", { name: /^Speichern(?! unter)/ })).toHaveAttribute("title", "Speichern (Strg+S)");
      errors.expectNone();
    });
  }

  test("portal: German texts, links unchanged", async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto("./");
    await expect(page.locator("html")).toHaveAttribute("lang", "de");
    await expect(page.getByRole("heading", { level: 1, name: "Rusuite" })).toBeVisible();
    for (const app of ["Calc", "Write", "Show"]) {
      await expect(page.getByRole("link", { name: `${app} im Browser öffnen` })).toHaveAttribute("href", `/${app.toLowerCase()}/`);
      await expect(page.getByRole("img", { name: `Rusuite-${app}-Logo` })).toBeVisible();
    }
    await expect(page.getByText("Eine kleine Office-Suite mit Rust-Kern")).toBeVisible();
    // Informal German (P8-48).
    await expect(page.getByText(/deine Dateien bleiben auf deinem Rechner/)).toBeVisible();
    expect(await page.locator("body").innerText()).not.toMatch(/\b(Sie|Ihnen|Ihre?[mnrs]?)\b/);
    await expect(page.getByTestId("version")).toHaveText(/^Build \S+ · \d{4}-\d{2}-\d{2}$/);
    await shot(page, "portal-de");
    errors.expectNone();
  });
});

// P9-LR1: one spec for every translated language. Expected labels come from the catalogs
// (support/i18n.ts), so a reworded catalog value does not break the test. A translation task adds its
// language here once its catalogs have landed (P9-L3 … L11).
const TRANSLATED = ["de", "fr", "es", "it", "pt", "nl", "sv", "da", "fi", "pl", "cs"] as const;

/** Ribbon tabs of the app that are always there (File opens the backstage; contextual tabs need a selection). */
const ribbonTabs = (page: Page) => page.getByRole("tablist").first().getByRole("tab");

for (const lang of TRANSLATED) {
  const m = (key: string) => msg(lang, key);

  test.describe(`UI in ${lang}`, () => {
    for (const { app, ready } of APPS) {
      test(`${app}: View › Language switches to ${lang} – Home and Save labels, no clipped ribbon labels, informal`, async ({ page }) => {
        test.setTimeout(120_000);
        const errors = trackErrors(page);
        await page.goto(`${app}/`);
        await ready(page).first().waitFor();
        await page.getByRole("tab", { name: "View", exact: true }).click();
        await page.getByRole("combobox", { name: "Language / Sprache" }).selectOption(lang);
        await expect(page.locator("html")).toHaveAttribute("lang", lang);
        await expect(page.getByRole("tab", { name: m("tab.view"), exact: true })).toHaveAttribute("aria-selected", "true");
        await expect(page.getByRole("tab", { name: m("tab.home"), exact: true })).toBeVisible();
        await expect(page.getByTestId("status-bar")).toContainText(m("status.saved"));

        // Every label of every ribbon tab fits, at 1400 px and at 1024 px.
        for (const width of [1400, 1024]) {
          await page.setViewportSize({ width, height: 900 });
          const names = (await ribbonTabs(page).allInnerTexts()).map((s) => s.trim()).filter((s) => s && s !== m("ribbon.file"));
          for (const name of names) {
            await ribbonTabs(page).getByText(name, { exact: true }).click();
            await expect.poll(() => clippedRibbonLabels(page), { message: `${app} ${lang} ${width}px tab ${name}` }).toEqual([]);
            if (shots && width === 1024) await shot(page, `${app}-${lang}-${width}-${name.replace(/[^\p{L}\p{N}]+/gu, "_")}`);
          }
        }
        await page.setViewportSize({ width: 1400, height: 900 });
        await ribbonTabs(page).getByText(m("tab.home"), { exact: true }).click();
        await shot(page, `${app}-home-${lang}`);

        await page.getByRole("tab", { name: m("ribbon.file"), exact: true }).click();
        const backstage = page.getByTestId("backstage");
        const save = m("backstage.save");
        const saveAs = m("backstage.saveAs");
        const rest = saveAs.startsWith(save) ? saveAs.slice(save.length) : "";
        const saveButton = backstage.getByRole("button", { name: new RegExp(`^${escapeRe(save)}${rest ? `(?!${escapeRe(rest)})` : ""}`) });
        await expect(saveButton).toBeVisible();
        await expect(saveButton).toHaveAttribute("title", new RegExp(`^${escapeRe(save)} \\(`));
        await expect(backstage.getByRole("button", { name: new RegExp(`^${escapeRe(saveAs)}`) })).toBeVisible();
        await expect(backstage.getByTestId("privacy-text")).toHaveText(m("privacy.web"));
        const formal = await formalForms(lang);
        if (formal) expect(await backstage.innerText()).not.toMatch(formal);
        await shot(page, `${app}-backstage-${lang}`);
        errors.expectNone();
      });
    }

    test(`portal: the language list switches to ${lang} – texts, links unchanged, informal`, async ({ page }) => {
      const errors = trackErrors(page);
      await page.goto("./");
      await page.getByTestId("portal-language").selectOption(lang);
      await expect(page.locator("html")).toHaveAttribute("lang", lang);
      for (const app of ["calc", "write", "show"]) {
        await expect(page.getByRole("link", { name: m(`portal.${app}.open`), exact: true })).toHaveAttribute("href", `/${app}/`);
        await expect(page.getByRole("img", { name: m(`portal.${app}.logo`), exact: true })).toBeVisible();
      }
      await expect(page.getByText(m("portal.lead"), { exact: true })).toBeVisible();
      const formal = await formalForms(lang);
      if (formal) expect(await page.locator("body").innerText()).not.toMatch(formal);
      await shot(page, `portal-${lang}`);
      errors.expectNone();
    });
  });
}

test.describe("Language switch", () => {
  test("calc: View › Language switches without a reload and persists after one", async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto("calc/");
    await page.getByTestId("grid").waitFor();
    await expect(page.getByRole("tab", { name: "Home", exact: true })).toBeVisible();
    await page.getByRole("tab", { name: "View", exact: true }).click();
    await page.getByRole("combobox", { name: "Language / Sprache" }).selectOption("de");
    // Re-rendered in place: the ribbon, the status bar and <html lang>.
    await expect(page.getByRole("tab", { name: "Ansicht", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tab", { name: "Start", exact: true })).toBeVisible();
    await expect(page.getByTestId("status-bar")).toContainText("Gespeichert");
    await expect(page.locator("html")).toHaveAttribute("lang", "de");
    await page.reload();
    await page.getByTestId("grid").waitFor();
    await expect(page.getByRole("tab", { name: "Start", exact: true })).toBeVisible();
    // Back to English from the backstage.
    await page.getByRole("tab", { name: "Datei", exact: true }).click();
    await page.getByTestId("backstage").getByRole("combobox", { name: "Language / Sprache" }).selectOption("en");
    await expect(page.getByTestId("backstage").getByRole("button", { name: /^Save As…/ })).toBeVisible();
    await page.reload();
    await page.getByTestId("grid").waitFor();
    await expect(page.getByRole("tab", { name: "Home", exact: true })).toBeVisible();
    errors.expectNone();
  });

  test("portal: the language list persists and carries over to the apps", async ({ page }) => {
    await page.goto("./");
    await expect(page.getByRole("link", { name: "Open Calc in browser" })).toBeVisible();
    await page.getByTestId("portal-language").selectOption("de");
    await expect(page.getByRole("link", { name: "Calc im Browser öffnen" })).toBeVisible();
    await expect(page.getByTestId("portal-language")).toHaveValue("de");
    await page.reload();
    await expect(page.getByRole("link", { name: "Calc im Browser öffnen" })).toBeVisible();
    await page.getByRole("link", { name: "Calc im Browser öffnen" }).click();
    await page.getByTestId("grid").waitFor();
    await expect(page.getByRole("tab", { name: "Start", exact: true })).toBeVisible();
  });

  test("calc: File › Options › Language searches the languages and switches", async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto("calc/");
    await page.getByTestId("grid").waitFor();
    await page.getByRole("tab", { name: "File", exact: true }).click();
    await page.getByTestId("backstage").getByRole("button", { name: /^Options…/ }).click();
    const settings = page.getByTestId("settings-dialog");
    await settings.getByRole("tab", { name: "Language" }).click();
    const list = settings.getByRole("listbox", { name: "Language / Sprache" });
    await expect(list.getByRole("option")).toHaveCount(24);
    await expect(list.getByRole("option").first()).toHaveAttribute("aria-selected", "true");
    await settings.getByRole("searchbox", { name: "Search languages" }).fill("german");
    await expect(list.getByRole("option")).toHaveCount(1);
    await settings.getByRole("searchbox", { name: "Search languages" }).press("Enter");
    await expect(settings.getByRole("tab", { name: "Sprache" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "de");
    errors.expectNone();
  });
});

test.describe("Languages without catalogs yet", () => {
  // Maltese is translated last (P9-L11). L11: switch this block to a language that still has no catalogs, or
  // drop it once all 24 have landed.
  test.use({ locale: "mt-MT" });

  for (const { app, ready } of APPS) {
    test(`${app}: a Maltese browser gets English until the Maltese catalogs land`, async ({ page }) => {
      const errors = trackErrors(page);
      const notes: string[] = [];
      page.on("console", (m) => {
        if (m.type() === "info") notes.push(m.text());
      });
      await page.goto(`${app}/`);
      await ready(page).first().waitFor();
      await expect(page.locator("html")).toHaveAttribute("lang", "en");
      await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
      await expect(page.getByRole("tab", { name: "Home", exact: true })).toHaveAttribute("aria-selected", "true");
      expect(notes.some((n) => /Maltese \(mt\)/.test(n))).toBe(true);
      // The picker lists all 24 languages by their own names; choosing one without catalogs keeps English.
      await page.getByRole("tab", { name: "View", exact: true }).click();
      const picker = page.getByRole("combobox", { name: "Language / Sprache" });
      await expect(picker.locator("option")).toHaveCount(24);
      await expect(picker.locator("option").first()).toHaveText("English");
      await expect(picker.locator('option[value="mt"]')).toHaveText("Malti (not translated yet)");
      await picker.selectOption("mt");
      await expect(picker).toHaveValue("en");
      await expect(page.getByRole("tab", { name: "View", exact: true })).toHaveAttribute("aria-selected", "true");
      await picker.selectOption("de");
      await expect(page.getByRole("tab", { name: "Ansicht", exact: true })).toBeVisible();
      errors.expectNone();
    });
  }

  test("portal: the list offers all 24 languages; Maltese shows English", async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto("./");
    await expect(page.getByRole("link", { name: "Open Calc in browser" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    const list = page.getByTestId("portal-language");
    await expect(list.locator("option")).toHaveCount(24);
    await expect(list).toHaveValue("en");
    for (const name of ["Deutsch", "Български", "Ελληνικά", "Gaeilge", "Malti", "Slovenščina"]) {
      await expect(list.locator("option", { hasText: name })).toHaveCount(1);
    }
    await list.selectOption("mt");
    await expect(page.getByRole("link", { name: "Open Calc in browser" })).toBeVisible();
    await expect(list).toHaveValue("en");
    await list.selectOption("de");
    await expect(page.getByRole("link", { name: "Calc im Browser öffnen" })).toBeVisible();
    errors.expectNone();
  });
});
