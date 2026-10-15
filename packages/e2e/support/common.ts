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

export async function openViaBackstage(page: Page, file: string) {
  await page.getByRole("tab", { name: "File", exact: true }).click();
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByTestId("backstage").getByRole("button", { name: /^Open/ }).click(),
  ]);
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
