import { expect, type Download, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const testdata = (...p: string[]) => path.resolve(here, "../../../testdata", ...p);

/** Collects uncaught page errors; call `errors.expectNone()` at the end of a test. */
export function trackErrors(page: Page) {
  const list: string[] = [];
  page.on("pageerror", (e) => list.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error" && !/favicon|DevTools/.test(m.text())) list.push(m.text());
  });
  return { list, expectNone: () => expect(list).toEqual([]) };
}

export async function downloadBuffer(dl: Download): Promise<Buffer> {
  const p = await dl.path();
  return fs.readFileSync(p);
}

/** File → backstage command (New, Open…, Save, Save As…, Export PDF…, Close). */
export async function fileCommand(page: Page, name: string | RegExp) {
  await page.getByRole("tab", { name: "File", exact: true }).click();
  await page.getByTestId("backstage").getByRole("button", { name }).first().click();
}

/**
 * P8-42 / ADR 0009: connections and the AI assistant are desktop-app features. The web build does not have them; the
 * connectors and AI specs make the page believe it runs in a desktop app (`window.__RUSUITE_PLATFORM__`, read by
 * `WasmBackend`). Call before `page.goto`.
 */
export async function simulateDesktop(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __RUSUITE_PLATFORM__: string }).__RUSUITE_PLATFORM__ = "desktop";
  });
}

/**
 * File › Open → the file chooser. On the web build Open is the device dialog itself; with the simulated desktop
 * platform it first shows the Open page (connections, P8-36) whose "This device" entry opens the dialog.
 */
export async function openViaBackstage(page: Page, file: string) {
  await page.getByRole("tab", { name: "File", exact: true }).click();
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByTestId("backstage").getByRole("button", { name: /^Open/ }).click();
  const desktop = await page.evaluate(() => (window as unknown as { __RUSUITE_PLATFORM__?: string }).__RUSUITE_PLATFORM__ === "desktop");
  if (desktop) await page.getByTestId("open-page").getByRole("button", { name: /^This device/ }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles(file);
}

export async function saveViaBackstage(page: Page): Promise<Buffer> {
  await page.getByRole("tab", { name: "File", exact: true }).click();
  const [dl] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("backstage").getByRole("button", { name: /^Save$/ }).click(),
  ]);
  return downloadBuffer(dl);
}

/** Replaces `window.print` with a counter (`window.__prints`) that fires `afterprint` so Export PDF can be asserted without a dialog. */
export async function interceptPrint(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __prints: number }).__prints = 0;
    window.print = () => {
      (window as unknown as { __prints: number }).__prints++;
      setTimeout(() => window.dispatchEvent(new Event("afterprint")), 50);
    };
  });
}
export const printCount = (page: Page) => page.evaluate(() => (window as unknown as { __prints: number }).__prints);

/** File › Print (the backstage Print page); waits for the preview's page count. */
export async function openPrint(page: Page) {
  await page.getByRole("tab", { name: "File", exact: true }).click();
  await page.getByTestId("backstage").getByRole("button", { name: "Print", exact: true }).first().click();
  await expect(page.getByTestId("print-panel")).toBeVisible();
  await expect(page.getByTestId("print-page-count")).toHaveText(/^Page 1 of \d+$/);
}

/** Total pages shown by the print preview. */
export async function previewPages(page: Page): Promise<number> {
  const text = (await page.getByTestId("print-page-count").textContent()) ?? "";
  return Number(/of (\d+)/.exec(text)?.[1] ?? 0);
}

/**
 * Renders the preview's document (its `srcdoc`) with headless Chromium's
 * `page.pdf()` at its own `@page` size, saves it (`PRINT_PDF_DIR`, default
 * `test-results/print-pdfs`) and returns its page count.
 */
export async function previewPdf(page: Page, name: string): Promise<number> {
  const html = await page.getByTestId("print-preview").getAttribute("srcdoc");
  expect(html).toBeTruthy();
  const pdfPage = await page.context().newPage();
  try {
    await pdfPage.setContent(html!, { waitUntil: "load" });
    const pdf = await pdfPage.pdf({ preferCSSPageSize: true, printBackground: true });
    const dir = process.env.PRINT_PDF_DIR ?? path.resolve(here, "../test-results/print-pdfs");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${name}.pdf`), pdf);
    return (pdf.toString("latin1").match(/\/Type\s*\/Page(?!s)/g) ?? []).length;
  } finally {
    await pdfPage.close();
  }
}

/**
 * Clicks the ribbon command `label` of group `groupName` on the active tab; on a narrow window the group may be
 * collapsed into one button (P8-38): that is opened first and the command clicked in its popup.
 */
export async function ribbonCommand(page: Page, groupName: string | RegExp, label: string | RegExp, exact = true) {
  const group = page.getByTestId("ribbon-panel").getByRole("group", { name: groupName }).first();
  if ((await group.getAttribute("data-collapsed-group")) !== null) {
    await group.getByRole("button").first().click();
    await page.getByTestId("ribbon-group-popup").getByRole("button", { name: label, exact }).first().click();
    return;
  }
  await group.getByRole("button", { name: label, exact }).first().click();
}
