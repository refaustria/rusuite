#!/usr/bin/env node
// Store screenshots and graphics (P10-M7). Drives the local web builds of Calc, Write and Show with Playwright and writes
// docs/store/screenshots/<app>/<form>/<lang>/<nn>-<name>.png plus docs/store/graphics/<app>/*.png.
//
//   pnpm --filter calc build:web && pnpm --filter write build:web && pnpm --filter show build:web
//   E2E_PORT=5017 node packages/e2e/serve.mjs &
//   node scripts/store/screenshots.mjs [shots|graphics|all] [--base http://127.0.0.1:5017] [--apps calc,write]
//        [--forms phone,tablet-10] [--langs en,de] [--out docs/store]
//
// Forms (CSS viewport × deviceScaleFactor = store size): phone 360×780 @3 = 1080×2340 (Play phone), phone-65
// 428×926 @3 = 1284×2778 (App Store 6.5"), phone-67 430×932 @3 = 1290×2796 (App Store 6.7"), tablet-7 600×960 @2 =
// 1200×1920 (Play 7", compact layout), tablet-10 1024×1366 @2 = 2048×2732 (Play 10", iPad Pro 12.9", desktop ribbon).
// Every image is a 24 px caption bar (app colour) above the app; PNGs are written opaque (no alpha channel).

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { toOpaquePng, pngInfo } from "./png.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { chromium } = createRequire(path.join(root, "packages/e2e/"))("@playwright/test");

export const CAPTION_PX = 24;
export const FORMS = {
  phone: { w: 360, h: 780, dsf: 3, compact: true, size: [1080, 2340] },
  "phone-65": { w: 428, h: 926, dsf: 3, compact: true, size: [1284, 2778] },
  "phone-67": { w: 430, h: 932, dsf: 3, compact: true, size: [1290, 2796] },
  "tablet-7": { w: 600, h: 960, dsf: 2, compact: true, size: [1200, 1920] },
  "tablet-10": { w: 1024, h: 1366, dsf: 2, compact: false, size: [2048, 2732] },
};
export const COLORS = { calc: "#1E7A46", write: "#1F4E9A", show: "#C2410C" };
const LOCALES = { en: "en-US", de: "de-DE" };
const td = (...p) => path.join(root, "testdata", ...p);

const OPEN = /^(Open|Öffnen)/;
const wait = (page, ms = 600) => page.waitForTimeout(ms);

/** Opens a command tab (compact: the chips above the command strip, desktop: the ribbon tab after "File"). */
async function tab(page, form, i) {
  const tabs = form.compact ? page.getByTestId("command-tabs").getByRole("tab") : page.getByTestId("ribbon").getByRole("tablist").getByRole("tab");
  await tabs.nth(form.compact ? i : i + 1).click();
  await wait(page, 500);
}

/** Opens `fixture` through File → Open (the file chooser of the web build). */
async function openFile(page, form, fixture) {
  if (form.compact) await page.getByTestId("compact-file").click();
  else await page.getByTestId("ribbon").getByRole("tablist").getByRole("tab").first().click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByTestId("backstage").getByRole("button", { name: OPEN }).click();
  await (await chooser).setFiles(fixture);
  await wait(page, 3500);
}

/** Zoom of the page view so that the page fits the narrow viewports (50 % on phones, 75 % on 7" tablets, 100 % on desktop). */
async function fit(page, form) {
  if (!form.compact) return;
  await tab(page, form, 6);
  await page.locator("[data-compact-strip] select").first().selectOption({ label: form.w < 500 ? "50 %" : "75 %" });
  await wait(page, 700);
  await tab(page, form, 0);
}

/** Puts the caret into the text line starting with `text` and selects the line (Home, Shift+End). */
async function selectLine(page, text) {
  await page.locator(".ProseMirror").getByText(text).first().click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  await wait(page, 500);
}

/** Selects slide `n` (1-based) in the thumbnail strip. */
async function thumb(page, form, n) {
  await page.getByTestId("thumbnail").nth(n - 1).click();
  await wait(page, 800);
}

async function selectRange(page, range) {
  await page.getByTestId("cell-address").fill(range);
  await page.getByTestId("cell-address").press("Enter");
  await wait(page);
}

/** A tool-button of the compact strip or the ribbon panel by (en|de) text. */
const control = (page, form, re) =>
  (form.compact ? page.locator("[data-compact-strip]") : page.getByTestId("ribbon-panel")).getByRole("button", { name: re }).first();

export const APP_DEFS = {
  calc: {
    ready: (p) => p.getByTestId("grid"),
    fixture: td("xlsx", "provisional-chart-combo.xlsx"),
    shots: [
      { name: "chart", fixture: td("xlsx", "provisional-charts-c6.xlsx"), caption: { en: "Open Excel workbooks with charts, offline", de: "Excel-Mappen mit Diagrammen offline öffnen" },
        async run(page) {
          await page.getByRole("tab", { name: "Chart1" }).click();
          await wait(page, 1500);
        } },
      { name: "select", caption: { en: "Select ranges with a tap", de: "Bereiche per Fingertipp auswählen" },
        async run(page) { await selectRange(page, "A1:C7"); } },
      { name: "insert", caption: { en: "Insert charts, tables and PivotTables", de: "Diagramme, Tabellen, PivotTables einfügen" },
        async run(page, form) { await selectRange(page, "A1:C7"); await tab(page, form, 1); } },
      { name: "formulas", caption: { en: "Excel-compatible formulas and functions", de: "Excel-kompatible Formeln und Funktionen" },
        async run(page, form) { await selectRange(page, "B2:B7"); await tab(page, form, 3); } },
      { name: "dialog", caption: { en: "Create PivotTables from your data", de: "PivotTables aus deinen Daten erstellen" },
        async run(page, form) {
          await selectRange(page, "A1:C7");
          await tab(page, form, 1);
          await control(page, form, /^(PivotTable)$/).click();
          await wait(page, 800);
        } },
    ],
  },
  write: {
    ready: (p) => p.locator(".ProseMirror"),
    fixture: td("docx", "provisional-47-report.docx"),
    shots: [
      { name: "page", caption: { en: "Open Word documents and keep editing", de: "Word-Dokumente öffnen und weiterschreiben" },
        async run(page, form) { await fit(page, form); } },
      { name: "format", caption: { en: "Format text with a tap", de: "Text mit einem Fingertipp formatieren" },
        async run(page, form) {
          await fit(page, form);
          await selectLine(page, "The quick brown fox");
          await tab(page, form, 0);
          await control(page, form, /^(Bold|Fett)$/).click();
          await wait(page);
        } },
      { name: "styles", caption: { en: "Styles, lists and tables", de: "Formatvorlagen, Listen und Tabellen" },
        async run(page, form) {
          await fit(page, form);
          await selectLine(page, "Highlights");
          await tab(page, form, 0);
          if (form.compact) await control(page, form, /^(Styles pane|Formatvorlagenbereich|Aufgabenbereich)/).click();
          else await page.locator("[data-collapsed-group] > button").filter({ hasText: /Styles|Formatvorlagen/ }).first().click();
          await wait(page, 900);
        } },
      { name: "insert", caption: { en: "Insert tables, pictures and shapes", de: "Tabellen, Bilder und Formen einfügen" },
        async run(page, form) { await fit(page, form); await selectLine(page, "Conclusion"); await tab(page, form, 1); } },
      { name: "layout", caption: { en: "Page layout, headers and footers", de: "Seitenlayout, Kopf- und Fußzeilen" },
        async run(page, form) { await fit(page, form); await tab(page, form, 3); } },
    ],
  },
  show: {
    ready: (p) => p.getByTestId("editor-stage"),
    fixture: td("pptx", "provisional-25-pitch-deck.pptx"),
    shots: [
      { name: "slides", caption: { en: "Open PowerPoint decks and edit slides", de: "PowerPoint-Dateien öffnen, Folien bearbeiten" },
        async run(page, form) { await thumb(page, form, 4); } },
      { name: "sorter", caption: { en: "Reorder slides in the slide sorter", de: "Folien in der Foliensortierung ordnen" },
        async run(page, form) { await tab(page, form, 6); await control(page, form, /^(Slide Sorter|Foliensortierung)/).click(); await wait(page, 900); } },
      { name: "insert", caption: { en: "Add shapes, pictures and tables", de: "Formen, Bilder und Tabellen einfügen" },
        async run(page, form) { await thumb(page, form, 3); await tab(page, form, 1); } },
      { name: "transitions", caption: { en: "Transitions and animations for every slide", de: "Übergänge und Animationen für jede Folie" },
        async run(page, form) { await thumb(page, form, 5); await tab(page, form, 3); } },
      { name: "reading", caption: { en: "Read and present your slides", de: "Folien lesen und präsentieren" },
        async run(page, form) { await thumb(page, form, 2); await tab(page, form, 6); await control(page, form, /^(Reading View|Leseansicht)/).click(); await wait(page, 900); } },
    ],
  },
};

/** The captioned, opaque PNG of one scenario. */
async function capture(browser, base, app, def, shot, formName, lang) {
  const form = FORMS[formName];
  const ctx = await browser.newContext({ viewport: { width: form.w, height: form.h - CAPTION_PX }, deviceScaleFactor: form.dsf, locale: LOCALES[lang], hasTouch: form.compact, isMobile: form.compact });
  await ctx.addInitScript((c) => { window.__RUSUITE_FORCE_COMPACT__ = c; }, form.compact);
  const page = await ctx.newPage();
  try {
    await page.goto(`${base}/${app}/`);
    await def.ready(page).first().waitFor();
    await wait(page, 1500);
    await openFile(page, form, shot.fixture ?? def.fixture);
    await shot.run(page, form);
    const png = await page.screenshot();
    const compose = await ctx.newPage();
    await compose.setViewportSize({ width: form.w, height: form.h });
    await compose.setContent(
      `<body style="margin:0;background:#fff"><div style="height:${CAPTION_PX}px;background:${COLORS[app]};color:#fff;font:600 ${form.w > 700 ? 14 : 13}px/${CAPTION_PX}px 'Liberation Sans',Arial,sans-serif;text-align:center;white-space:nowrap;overflow:hidden">${shot.caption[lang]}</div><img style="display:block;width:${form.w}px;height:${form.h - CAPTION_PX}px" src="data:image/png;base64,${png.toString("base64")}"></body>`,
    );
    await compose.waitForFunction(() => document.images[0].complete);
    return toOpaquePng(await compose.screenshot(), [255, 255, 255]);
  } finally {
    await ctx.close();
  }
}

async function shots(opts) {
  const browser = await chromium.launch();
  let count = 0;
  try {
    for (const app of opts.apps) {
      const def = APP_DEFS[app];
      for (const formName of opts.forms) {
        for (const lang of opts.langs) {
          const dir = path.join(opts.out, "screenshots", app, formName, lang);
          fs.rmSync(dir, { recursive: true, force: true });
          fs.mkdirSync(dir, { recursive: true });
          for (const [i, shot] of def.shots.entries()) {
            const buf = await capture(browser, opts.base, app, def, shot, formName, lang);
            const { width, height } = pngInfo(buf);
            const [ew, eh] = FORMS[formName].size;
            if (width !== ew || height !== eh) throw new Error(`${app}/${formName}/${shot.name}: ${width}×${height}, expected ${ew}×${eh}`);
            fs.writeFileSync(path.join(dir, `${String(i + 1).padStart(2, "0")}-${shot.name}.png`), buf);
            count++;
          }
        }
        console.log(`${app}/${formName}: done`);
      }
    }
  } finally {
    await browser.close();
  }
  console.log(`${count} screenshots`);
}

const TAGLINES = {
  calc: { line: "Spreadsheets – free, offline", fmt: "Opens and saves Excel files (.xlsx)" },
  write: { line: "Documents – free, offline", fmt: "Opens and saves Word files (.docx)" },
  show: { line: "Presentations – free, offline", fmt: "Opens and saves PowerPoint files (.pptx)" },
};
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

/** Play icon 512, App Store icon 1024 (square, no alpha) and the Play feature graphic 1024×500 of every app. */
async function graphics(opts) {
  const browser = await chromium.launch();
  let count = 0;
  try {
    for (const app of opts.apps) {
      const dir = path.join(opts.out, "graphics", app);
      fs.mkdirSync(dir, { recursive: true });
      const iconDir = path.join(root, "apps", app, "src-tauri", "icons");
      const iconB64 = fs.readFileSync(path.join(iconDir, "icon.png")).toString("base64");
      const bg = hexRgb(COLORS[app]);
      const ctx = await browser.newContext({ deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      // Play icon and App Store icon: the full-bleed square source (icons/icon-fullbleed.png, 1024², RGB, no baked-in
      // corners – Apple and Google apply their own masks), scaled for the 512 px Play icon.
      const full = fs.readFileSync(path.join(iconDir, "icon-fullbleed.png"));
      await page.setViewportSize({ width: 512, height: 512 });
      await page.setContent(`<body style="margin:0;background:transparent"><img style="display:block;width:512px;height:512px" src="data:image/png;base64,${full.toString("base64")}">`);
      await page.waitForFunction(() => document.images[0].complete);
      fs.writeFileSync(path.join(dir, "icon-512.png"), toOpaquePng(await page.screenshot({ omitBackground: true }), bg));
      fs.writeFileSync(path.join(dir, "appstore-1024.png"), toOpaquePng(full, bg));
      // Feature graphic.
      const c = COLORS[app];
      await page.setViewportSize({ width: 1024, height: 500 });
      await page.setContent(`<body style="margin:0;width:1024px;height:500px;overflow:hidden;position:relative;background:linear-gradient(135deg,${c},color-mix(in srgb,${c} 55%,black));font-family:'Liberation Sans',Arial,sans-serif;color:#fff">
<img style="position:absolute;right:-110px;bottom:-130px;width:560px;opacity:.13;transform:rotate(-12deg)" src="data:image/png;base64,${iconB64}">
<img style="position:absolute;left:72px;top:140px;width:220px;height:220px;border-radius:50px;box-shadow:0 14px 40px rgba(0,0,0,.35)" src="data:image/png;base64,${iconB64}">
<div style="position:absolute;left:340px;top:128px;right:40px"><div style="font-size:78px;font-weight:700;line-height:1.05">Rusuite ${app[0].toUpperCase() + app.slice(1)}</div>
<div style="font-size:38px;margin-top:18px">${TAGLINES[app].line}</div>
<div style="font-size:24px;margin-top:22px;opacity:.88">${TAGLINES[app].fmt}</div>
<div style="font-size:24px;margin-top:6px;opacity:.88">Open source (MIT) · No account · No ads</div></div></body>`);
      await page.waitForFunction(() => [...document.images].every((i) => i.complete));
      fs.writeFileSync(path.join(dir, "feature-1024x500.png"), toOpaquePng(await page.screenshot(), bg));
      await ctx.close();
      count += 3;
    }
  } finally {
    await browser.close();
  }
  console.log(`${count} graphics`);
}

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "all";
  const opts = {
    base: arg("base", `http://127.0.0.1:${process.env.E2E_PORT ?? 5017}`).replace(/\/$/, ""),
    apps: arg("apps", "calc,write,show").split(","),
    forms: arg("forms", Object.keys(FORMS).join(",")).split(","),
    langs: arg("langs", "en,de").split(","),
    out: path.resolve(root, arg("out", "docs/store")),
  };
  if (mode === "shots" || mode === "all") await shots(opts);
  if (mode === "graphics" || mode === "all") await graphics(opts);
}
