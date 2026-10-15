// P7-12 / ADR 0009: documents never leave the device. While opening, editing, autosaving and saving a document in
// each app, the page only requests its own static files (and /version.json on the portal); the nginx CSP headers
// are present; the backstage "Privacy" entry keeps its promises (keep-autosave setting, remove local copies).
// `PRIVACY_SHOTS=<dir>` also saves screenshots of the backstage privacy entry (EN and DE).

import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { openViaBackstage, saveViaBackstage, testdata, trackErrors } from "../support/common";
import { Grid } from "../support/calc";

const shots = process.env.PRIVACY_SHOTS;

/** Paths a page of this site may request: the page itself, hashed assets, the version stamp, the portal's own files. */
const ALLOWED_PATH = [
  /^\/$/,
  /^\/(index|privacy)\.html$/,
  /^\/(styles\.css|i18n\.js|version\.js|version\.json)$/,
  /^\/logos\/[\w.-]+$/,
  /^\/locales\/(en|de)\.json$/,
  /^\/(calc|write|show)\/(index\.html)?$/,
  /^\/(calc|write|show)\/assets\/[\w.-]+$/,
  /^\/favicon\.ico$/,
];

function recordRequests(page: Page) {
  const urls: string[] = [];
  page.on("request", (r) => urls.push(r.url()));
  return {
    urls,
    expectOnlyOwnFiles(baseURL: string) {
      const origin = new URL(baseURL).origin;
      const bad = urls.filter((u) => {
        const url = new URL(u);
        if (url.protocol === "data:") return false;
        if (url.protocol === "blob:") return url.origin !== origin && !u.startsWith(`blob:${origin}/`);
        return url.origin !== origin || !ALLOWED_PATH.some((re) => re.test(url.pathname));
      });
      expect(bad, "requests outside the page's own static files").toEqual([]);
      expect(urls.length).toBeGreaterThan(0);
    },
  };
}

/** Fires the page-hidden autosave. */
async function hidePage(page: Page) {
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
    delete (document as unknown as { visibilityState?: unknown }).visibilityState;
  });
}

/** Number of records in an object store of the app's IndexedDB database. */
const idbCount = (page: Page, db: string, store: string) =>
  page.evaluate(
    ([db, store]) =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open(db);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const c = open.result.transaction(store as string, "readonly").objectStore(store as string).count();
          c.onsuccess = () => {
            open.result.close();
            resolve(c.result);
          };
          c.onerror = () => reject(c.error);
        };
      }),
    [db, store],
  );

const APPS = [
  {
    app: "calc",
    file: testdata("xlsx/provisional-basic.xlsx"),
    ready: (p: Page) => p.getByTestId("grid"),
    edit: async (p: Page) => {
      await new Grid(p).type(0, 0, "private");
      await expect(p.getByTestId("status-bar")).toContainText("Modified");
    },
  },
  {
    app: "write",
    file: testdata("docx/provisional-47-report.docx"),
    ready: (p: Page) => p.locator(".ProseMirror"),
    edit: async (p: Page) => {
      await p.locator(".ProseMirror").click();
      await p.keyboard.type("private");
      await expect(p.getByTestId("dirty")).toHaveText("Modified");
    },
  },
  {
    app: "show",
    file: testdata("pptx/provisional-25-pitch-deck.pptx"),
    ready: (p: Page) => p.getByTestId("editor-stage"),
    edit: async (p: Page) => {
      await p.getByRole("tab", { name: "Insert" }).click();
      await p.getByRole("button", { name: "Shapes" }).click();
      await p.getByRole("dialog", { name: "Shapes" }).getByRole("group", { name: "Rectangles" }).getByRole("button", { name: "Rectangle", exact: true }).press("Enter"); // Enter inserts at once (a click arms drawing, P8-16)
      await expect(p.getByTestId("dirty")).toHaveText("Modified");
    },
  },
] as const;

test.describe("Privacy (ADR 0009)", () => {
  for (const a of APPS) {
    test(`${a.app}: open, edit, autosave and save only request own static files`, async ({ page, baseURL }) => {
      const errors = trackErrors(page); // a CSP violation is a console error
      const rec = recordRequests(page);
      const main = await page.goto(`${a.app}/`);
      const csp = (await main!.allHeaders())["content-security-policy"];
      expect(csp).toContain("connect-src 'self';");
      expect(csp).toContain("frame-ancestors 'none'");
      await a.ready(page).first().waitFor();
      await openViaBackstage(page, a.file);
      await a.edit(page);
      await hidePage(page);
      await expect.poll(() => idbCount(page, `rusuite-${a.app}`, "recovery")).toBe(1);
      await saveViaBackstage(page);
      rec.expectOnlyOwnFiles(baseURL!);
      errors.expectNone();
    });
  }

  test("portal: only its own files and /version.json; security headers", async ({ page, baseURL }) => {
    const rec = recordRequests(page);
    const errors = trackErrors(page);
    const main = await page.goto("");
    const h = await main!.allHeaders();
    expect(h["content-security-policy"]).toContain("default-src 'self'");
    expect(h["referrer-policy"]).toBe("no-referrer");
    await expect(page.getByTestId("version")).not.toHaveText("Version unknown");
    await page.getByRole("link", { name: "Privacy details" }).click();
    await expect(page.getByRole("heading", { name: "What this server stores" })).toBeVisible();
    rec.expectOnlyOwnFiles(baseURL!);
    expect(rec.urls.some((u) => u.endsWith("/version.json"))).toBe(true);
    errors.expectNone();
  });

  for (const a of APPS) {
    test(`${a.app}: backstage Privacy – keep setting and removing local copies`, async ({ page }) => {
      const db = `rusuite-${a.app}`;
      await page.goto(`${a.app}/`);
      await a.ready(page).first().waitFor();
      await openViaBackstage(page, a.file);
      await a.edit(page);
      await hidePage(page);
      await expect.poll(() => idbCount(page, db, "recovery")).toBe(1);

      await page.getByRole("tab", { name: "File", exact: true }).click();
      const privacy = page.getByTestId("privacy");
      await expect(privacy.getByTestId("privacy-text")).toHaveText(
        "Your documents stay on this device. This browser keeps autosave copies and a recent-files list until you remove them.",
      );
      const keep = privacy.getByLabel("Keep autosave copies in this browser");
      await expect(keep).toBeChecked();
      if (shots) await page.screenshot({ path: path.join(shots, `privacy-${a.app}-en.png`) });

      // Off: stored recovery entries go and none are written again.
      await keep.uncheck();
      await expect.poll(() => idbCount(page, db, "recovery")).toBe(0);
      await page.keyboard.press("Escape");
      await hidePage(page);
      await page.waitForTimeout(500);
      expect(await idbCount(page, db, "recovery")).toBe(0);

      // Remove: recent list, snapshots and recovery entries.
      await saveViaBackstage(page); // puts the file on the recent list
      await page.getByRole("tab", { name: "File", exact: true }).click();
      await expect(page.getByTestId("recent-entry")).toHaveCount(1);
      await privacy.getByRole("button", { name: "Remove local copies from this browser" }).click();
      await expect(privacy.getByTestId("privacy-removed")).toBeVisible();
      await expect(page.getByTestId("recent-entry")).toHaveCount(0);
      for (const store of ["kv", "recovery", "blobs"]) expect(await idbCount(page, db, store)).toBe(0);

      // The setting survives a reload.
      await page.reload();
      await a.ready(page).first().waitFor();
      await page.getByRole("tab", { name: "File", exact: true }).click();
      await expect(page.getByTestId("privacy").getByLabel("Keep autosave copies in this browser")).not.toBeChecked();
    });

    test.describe("German", () => {
      test.use({ locale: "de-DE" });
      test(`${a.app}: backstage Datenschutz`, async ({ page }) => {
        await page.goto(`${a.app}/`);
        await a.ready(page).first().waitFor();
        await page.getByRole("tab", { name: "Datei", exact: true }).click();
        const privacy = page.getByTestId("privacy");
        await expect(privacy.getByRole("heading", { name: "Datenschutz" })).toBeVisible();
        await expect(privacy.getByLabel("Autosave-Kopien in diesem Browser behalten")).toBeChecked();
        await expect(privacy.getByRole("button", { name: "Lokale Kopien aus diesem Browser entfernen" })).toBeVisible();
        if (shots) await page.screenshot({ path: path.join(shots, `privacy-${a.app}-de.png`) });
      });
    });
  }
});
