// UI languages (P7-11, P9-L0): English is the default; a German browser gets
// the German UI; the choice (View › Language, the backstage, Options ›
// Language, the portal's language list) is persisted and shared by the
// portal and the apps. A language whose catalogs have not landed yet
// shows English without errors.
// `I18N_SHOTS=<dir>` also saves screenshots of the German UI there.

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

// P9-L1: French and Spanish (informal "tu" / "tú", Microsoft Office terms).
const TRANSLATED = [
  {
    lang: "fr",
    locale: "fr-FR",
    home: "Accueil",
    insert: "Insertion",
    file: "Fichier",
    save: /^Enregistrer(?! sous)/,
    saveAs: /^Enregistrer sous…/,
    saveTip: "Enregistrer (Ctrl+S)",
    recent: "Récent",
    privacy: /^Tes documents restent sur cet appareil\..*jusqu’à ce que tu les supprimes\.$/,
    formal: /\b(vous|votre|vos)\b/i,
    saved: "Enregistré",
    viewTab: "Affichage",
    portalOpen: (app: string) => `Ouvrir ${app} dans le navigateur`,
    portalLogo: (app: string) => `Logo de Rusuite ${app}`,
    portalLead: "Une petite suite bureautique avec un cœur en Rust",
    portalPrivacy: /tes fichiers restent sur ta machine/,
    version: /^Build \S+/,
    pending: "Français",
  },
  {
    lang: "es",
    locale: "es-ES",
    home: "Inicio",
    insert: "Insertar",
    file: "Archivo",
    save: /^Guardar(?! como)/,
    saveAs: /^Guardar como…/,
    saveTip: "Guardar (Ctrl+S)",
    recent: "Reciente",
    privacy: /^Tus documentos se quedan en este dispositivo\..*hasta que las elimines\.$/,
    formal: /\b(usted|ustedes)\b/i,
    saved: "Guardado",
    viewTab: "Vista",
    portalOpen: (app: string) => `Abrir ${app} en el navegador`,
    portalLogo: (app: string) => `Logotipo de Rusuite ${app}`,
    portalLead: "Una pequeña suite ofimática con núcleo en Rust",
    portalPrivacy: /tus archivos se quedan en tu equipo/,
    version: /^Compilación \S+/,
    pending: "Español",
  },
] as const;

for (const L of TRANSLATED) {
  test.describe(`${L.pending} UI (${L.lang})`, () => {
    test.use({ locale: L.locale });

    for (const { app, ready } of APPS) {
      test(`${app}: the browser language selects ${L.lang} – "${L.home}" tab, "${L.saveTip}", informal`, async ({ page }) => {
        const errors = trackErrors(page);
        await page.goto(`${app}/`);
        await ready(page).first().waitFor();
        await expect(page.locator("html")).toHaveAttribute("lang", L.lang);
        await expect(page.getByRole("tab", { name: L.home, exact: true })).toHaveAttribute("aria-selected", "true");
        await expect(page.getByRole("tab", { name: L.insert, exact: true })).toBeVisible();
        await shot(page, `${app}-home-${L.lang}`);
        await page.getByRole("tab", { name: L.file, exact: true }).click();
        const backstage = page.getByTestId("backstage");
        await expect(backstage.getByRole("button", { name: L.save })).toBeVisible();
        await expect(backstage.getByRole("button", { name: L.saveAs })).toBeVisible();
        await expect(backstage.getByRole("heading", { name: L.recent })).toBeVisible();
        await expect(backstage.getByTestId("privacy-text")).toHaveText(L.privacy);
        expect(await backstage.innerText()).not.toMatch(L.formal);
        await expect(backstage.getByRole("button", { name: L.save })).toHaveAttribute("title", L.saveTip);
        await shot(page, `${app}-backstage-${L.lang}`);
        errors.expectNone();
      });
    }

    test("portal: texts, links unchanged, informal", async ({ page }) => {
      const errors = trackErrors(page);
      await page.goto("./");
      await expect(page.locator("html")).toHaveAttribute("lang", L.lang);
      for (const app of ["Calc", "Write", "Show"]) {
        await expect(page.getByRole("link", { name: L.portalOpen(app) })).toHaveAttribute("href", `/${app.toLowerCase()}/`);
        await expect(page.getByRole("img", { name: L.portalLogo(app) })).toBeVisible();
      }
      await expect(page.getByText(L.portalLead)).toBeVisible();
      await expect(page.getByText(L.portalPrivacy)).toBeVisible();
      expect(await page.locator("body").innerText()).not.toMatch(L.formal);
      await expect(page.getByTestId("version")).toHaveText(L.version);
      await shot(page, `portal-${L.lang}`);
      errors.expectNone();
    });

    test("calc: View › Language lists it by its own name and switches without a reload", async ({ page }) => {
      const errors = trackErrors(page);
      await page.goto("calc/");
      await page.getByTestId("grid").waitFor();
      await page.getByRole("tab", { name: L.viewTab, exact: true }).click();
      const picker = page.getByRole("combobox", { name: /\/ Language$/ });
      await expect(picker.locator(`option[value="${L.lang}"]`)).toHaveText(L.pending);
      await picker.selectOption("en");
      await expect(page.getByRole("tab", { name: "Home", exact: true })).toBeVisible();
      await page.getByRole("tab", { name: "View", exact: true }).click();
      await page.getByRole("combobox", { name: "Language / Sprache" }).selectOption(L.lang);
      await expect(page.getByRole("tab", { name: L.home, exact: true })).toBeVisible();
      await expect(page.getByTestId("status-bar")).toContainText(L.saved);
      await expect(page.locator("html")).toHaveAttribute("lang", L.lang);
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
  test.use({ locale: "sv-SE" });

  for (const { app, ready } of APPS) {
    test(`${app}: a Swedish browser gets English until the Swedish catalogs land`, async ({ page }) => {
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
      expect(notes.some((n) => /Swedish \(sv\)/.test(n))).toBe(true);
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

  test("portal: the list offers all 24 languages; Swedish shows English", async ({ page }) => {
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
    await list.selectOption("pl");
    await expect(page.getByRole("link", { name: "Open Calc in browser" })).toBeVisible();
    await expect(list).toHaveValue("en");
    await list.selectOption("de");
    await expect(page.getByRole("link", { name: "Calc im Browser öffnen" })).toBeVisible();
    errors.expectNone();
  });
});
