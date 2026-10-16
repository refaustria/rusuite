// P8-36: opt-in cloud connectors (WebDAV) in the web apps, against a local WebDAV server (support/webdav.ts) on
// port 4846. The live CSP is `connect-src 'self'`; these tests serve the pages with the prepared policy
// (`connect-src 'self' https:` – plus this plain-http test server) except the CSP test, which keeps the live one
// and expects the "security policy" message. `CONNECTORS_SHOTS=<dir>` saves screenshots.

import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { testdata, trackErrors } from "../support/common";
import { Grid } from "../support/calc";
import { zipText } from "../support/zip";
import { DAV_BASE, WebDavServer } from "../support/webdav";

const DAV_PORT = Number(process.env.DAV_PORT ?? 4846);
const DAV_ORIGIN = `http://127.0.0.1:${DAV_PORT}`;
const shots = process.env.CONNECTORS_SHOTS;
const shot = async (page: Page, name: string) => {
  if (shots) await page.screenshot({ path: path.join(shots, `P8-36-${name}.png`) });
};

let dav: WebDavServer;

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ baseURL }) => {
  dav = new WebDavServer(DAV_PORT, new URL(baseURL!).origin);
  await dav.start();
});
test.afterAll(async () => dav?.stop());
test.beforeEach(() => {
  for (const k of [...dav.nodes.keys()]) if (k !== "/") dav.nodes.delete(k);
  dav.log.length = 0;
});

/** Serves the app pages with the prepared CSP (`connect-src 'self' https:`), here plus the plain-http test server. */
async function preparedCsp(page: Page, baseURL: string) {
  // Routed pages have no known address space: Chromium's Local Network Access then asks before contacting
  // 127.0.0.1 (as it asks a user of the public site before contacting a LAN server).
  await page.context().grantPermissions(["local-network-access"]);
  await page.route(`${new URL(baseURL).origin}/**`, async (route) => {
    const res = await route.fetch();
    const headers = { ...res.headers() };
    const csp = headers["content-security-policy"];
    if (csp) headers["content-security-policy"] = csp.replace("connect-src 'self'", `connect-src 'self' https: ${DAV_ORIGIN}`);
    await route.fulfill({ response: res, headers });
  });
}

function recordRequests(page: Page) {
  const urls: string[] = [];
  page.on("request", (r) => urls.push(r.url()));
  return urls;
}

const idbCount = (page: Page, db: string, store: string) =>
  page.evaluate(
    ([db, store]) =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open(db);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          if (!open.result.objectStoreNames.contains(store as string)) {
            open.result.close();
            return resolve(0);
          }
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

const storedJson = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<string>((resolve, reject) => {
        const open = indexedDB.open("rusuite-connections");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const g = open.result.transaction("kv", "readonly").objectStore("kv").get("data");
          g.onsuccess = () => {
            open.result.close();
            resolve(JSON.stringify(g.result ?? null));
          };
        };
      }),
  );

async function backstagePage(page: Page, command: RegExp) {
  await page.getByRole("tab", { name: "File", exact: true }).click();
  await page.getByTestId("backstage").getByRole("button", { name: command }).click();
}

/** File › Open (or Save As) › Add a connection… with the test server's credentials. */
async function addConnection(page: Page, opts: { remember?: boolean; command?: RegExp; expectTest?: RegExp } = {}) {
  await backstagePage(page, opts.command ?? /^Open/);
  await page.getByRole("button", { name: "Add a connection…" }).click();
  const dlg = page.getByRole("dialog", { name: "Add a connection" });
  await dlg.getByLabel("Name", { exact: true }).fill("Nextcloud");
  await dlg.getByLabel("Server URL").fill(dav.url);
  await dlg.getByLabel("Allow unencrypted http://").check();
  await dlg.getByLabel("User name").fill("alice");
  await dlg.getByLabel("Password", { exact: true }).fill("app-secret");
  if (opts.remember) await dlg.getByLabel("Remember password on this device").check();
  await dlg.getByRole("button", { name: "Test connection" }).click();
  await expect(dlg.getByTestId("conn-test-result")).toContainText(opts.expectTest ?? /Connected\. The folder lists \d+ entries\./);
  return dlg;
}

async function saveConnection(page: Page) {
  const dlg = page.getByRole("dialog", { name: "Add a connection" });
  await dlg.getByRole("button", { name: "Save connection" }).click();
  await expect(dlg).toHaveCount(0);
  await expect(page.getByTestId("file-browser")).toBeVisible();
}

const entry = (page: Page, name: string | RegExp) => page.getByTestId("file-list").getByRole("option", { name });

test.describe("Cloud connectors (WebDAV)", () => {
  test("calc: add a connection – tested, stored on this device without the password", async ({ page, baseURL }) => {
    await preparedCsp(page, baseURL!);
    const errors = trackErrors(page);
    dav.put("/Docs/Budget.xlsx", fs.readFileSync(testdata("xlsx/provisional-basic.xlsx")));
    await page.goto("calc/");
    await page.getByTestId("grid").waitFor();
    const dlg = await addConnection(page);
    await expect(dlg.getByTestId("conn-contacts")).toContainText(`This browser will contact ${DAV_ORIGIN} directly`);
    await shot(page, "add-connection");
    await saveConnection(page);
    await expect(page.getByTestId("connection-list").getByRole("button", { name: /Nextcloud/ })).toBeVisible();
    await expect(entry(page, /^Docs/)).toBeVisible();
    expect(await idbCount(page, "rusuite-connections", "secrets")).toBe(0);
    const stored = await storedJson(page);
    expect(stored).toContain(dav.url);
    expect(stored).not.toContain("app-secret");
    expect(dav.log.every((r) => r.origin === new URL(baseURL!).origin)).toBe(true);
    errors.expectNone();
  });

  test("calc: browse and open an .xlsx from the server; title and status bar name the connection", async ({ page, baseURL }) => {
    await preparedCsp(page, baseURL!);
    const errors = trackErrors(page);
    dav.put("/Docs/Budget.xlsx", fs.readFileSync(testdata("xlsx/provisional-basic.xlsx")));
    dav.put("/Docs/notes.docx", "not for calc");
    await page.goto("calc/");
    await page.getByTestId("grid").waitFor();
    await addConnection(page);
    await saveConnection(page);
    await entry(page, /^Docs/).click();
    await expect(page.getByTestId("breadcrumbs")).toContainText("Docs");
    await expect(entry(page, /Budget\.xlsx/)).toBeVisible();
    await expect(entry(page, /notes\.docx/)).toHaveCount(0); // filtered by the app's extension
    await shot(page, "browse");
    await entry(page, /Budget\.xlsx/).dblclick();
    await expect(page.getByTestId("backstage")).toHaveCount(0);
    await expect(page.getByRole("tablist", { name: "Sheets" }).getByRole("tab", { name: "Summary" })).toBeVisible();
    await expect(page).toHaveTitle(/^Budget\.xlsx – Nextcloud – Rusuite Calc$/);
    await expect(page.getByTestId("remote-status")).toHaveText("Nextcloud");
    // The recent list remembers the remote location.
    await page.getByRole("tab", { name: "File", exact: true }).click();
    await expect(page.getByTestId("recent-entry").first()).toContainText("Nextcloud › /Docs/Budget.xlsx");
    await shot(page, "recent-remote");
    errors.expectNone();
  });

  test("write: Save As a .docx to the server – the file exists there", async ({ page, baseURL }) => {
    await preparedCsp(page, baseURL!);
    const errors = trackErrors(page);
    await page.goto("write/");
    const ed = page.locator(".ProseMirror");
    await ed.waitFor();
    await ed.click();
    await page.keyboard.type("Quarterly report on the server");
    await addConnection(page, { command: /^Save As/ });
    await saveConnection(page);
    await page.getByRole("button", { name: "New folder" }).click();
    const folder = page.getByLabel("Name of the new folder");
    await folder.fill("Reports");
    await folder.press("Enter");
    await entry(page, /^Reports/).click();
    await expect(page.getByTestId("breadcrumbs")).toContainText("Reports");
    await page.getByLabel("File name").fill("Q3 Report");
    await shot(page, "save-as");
    await page.getByTestId("file-browser").getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByTestId("backstage")).toHaveCount(0);
    await expect.poll(() => dav.file("/Reports/Q3 Report.docx")?.length ?? 0).toBeGreaterThan(0);
    expect(zipText(dav.file("/Reports/Q3 Report.docx")!, "word/document.xml")).toContain("Quarterly report on the server");
    await expect(page.getByTestId("dirty")).toHaveText("Saved");
    await expect(page).toHaveTitle(/Q3 Report\.docx.* – Nextcloud – Rusuite Write$/);
    expect(dav.log.some((r) => r.method === "PUT" && r.path.endsWith("/Reports/Q3 Report.docx"))).toBe(true);
    errors.expectNone();
  });

  test("calc: a conflicting save offers Overwrite / Save a copy / Reload theirs", async ({ page, baseURL }) => {
    await preparedCsp(page, baseURL!);
    const errors = trackErrors(page);
    const xlsx = fs.readFileSync(testdata("xlsx/provisional-basic.xlsx"));
    dav.put("/Budget.xlsx", xlsx);
    await page.goto("calc/");
    await page.getByTestId("grid").waitFor();
    await addConnection(page);
    await saveConnection(page);
    await entry(page, /Budget\.xlsx/).dblclick();
    await expect(page).toHaveTitle(/Budget\.xlsx – Nextcloud/);
    await new Grid(page).type(0, 0, "mine");
    await expect(page.getByTestId("status-bar")).toContainText("Modified");
    dav.put("/Budget.xlsx", xlsx); // someone else saved: a new entity tag
    await page.keyboard.press("Control+s");
    const ask = page.getByRole("dialog", { name: "Budget.xlsx changed on the server" });
    await expect(ask).toBeVisible();
    for (const name of ["Overwrite", "Save a copy", "Reload theirs"]) await expect(ask.getByRole("button", { name })).toBeVisible();
    await shot(page, "conflict");
    await ask.getByRole("button", { name: "Save a copy" }).click();
    await expect.poll(() => dav.file("/Budget (copy).xlsx")?.length ?? 0).toBeGreaterThan(0);
    expect(zipText(dav.file("/Budget (copy).xlsx")!, "xl/sharedStrings.xml")).toContain("mine");
    expect(zipText(dav.file("/Budget.xlsx")!, "xl/sharedStrings.xml")).not.toContain("mine");
    await expect(page.getByTestId("status-bar")).toContainText("Saved");
    await expect(page).toHaveTitle(/^Budget \(copy\)\.xlsx – Nextcloud – Rusuite Calc$/);
    // The refused conditional PUT is the browser's only complaint.
    expect(errors.list.filter((m) => !/status of 412/.test(m))).toEqual([]);
  });

  test("show: Forget all connections removes the stored data (IndexedDB empty)", async ({ page, baseURL }) => {
    await preparedCsp(page, baseURL!);
    dav.put("/deck.pptx", fs.readFileSync(testdata("pptx/provisional-25-pitch-deck.pptx")));
    await page.goto("show/");
    await page.getByTestId("editor-stage").first().waitFor();
    await addConnection(page, { remember: true });
    await saveConnection(page);
    await entry(page, /deck\.pptx/).dblclick();
    await expect(page.getByTestId("remote-status")).toHaveText("Nextcloud");
    expect(await idbCount(page, "rusuite-connections", "secrets")).toBe(1);
    expect(await idbCount(page, "rusuite-connections", "kv")).toBe(1);
    await page.getByRole("tab", { name: "File", exact: true }).click();
    const privacy = page.getByTestId("privacy");
    await expect(privacy.getByTestId("privacy-connections")).toContainText("contacts only the servers you added (1)");
    await shot(page, "privacy-forget");
    await privacy.getByRole("button", { name: "Forget all connections" }).click();
    await expect(privacy.getByTestId("privacy-forgotten")).toBeVisible();
    expect(await idbCount(page, "rusuite-connections", "secrets")).toBe(0);
    expect(await idbCount(page, "rusuite-connections", "kv")).toBe(0);
    await expect(page.getByTestId("recent-entry").filter({ hasText: "Nextcloud" })).toHaveCount(0);
    await page.reload();
    await page.getByTestId("editor-stage").first().waitFor();
    await backstagePage(page, /^Open/);
    await expect(page.getByTestId("connections-empty")).toBeVisible();
  });

  test("privacy audit: no connection – only own files; one connection – only that host", async ({ page, baseURL }) => {
    await preparedCsp(page, baseURL!);
    const origin = new URL(baseURL!).origin;
    const urls = recordRequests(page);
    await page.goto("calc/");
    await page.getByTestId("grid").waitFor();
    await backstagePage(page, /^Open/);
    await expect(page.getByTestId("connections-empty")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    expect(urls.filter((u) => !u.startsWith(origin) && !u.startsWith("data:") && !u.startsWith("blob:"))).toEqual([]);
    expect(dav.log).toEqual([]);

    dav.put("/a.xlsx", fs.readFileSync(testdata("xlsx/provisional-basic.xlsx")));
    await addConnection(page);
    await saveConnection(page);
    await entry(page, /a\.xlsx/).dblclick();
    await expect(page.getByTestId("remote-status")).toHaveText("Nextcloud");
    const foreign = urls.filter((u) => !u.startsWith(origin) && !u.startsWith("data:") && !u.startsWith("blob:"));
    expect(foreign.length).toBeGreaterThan(0);
    expect(foreign.every((u) => u.startsWith(`${DAV_ORIGIN}${DAV_BASE}/`))).toBe(true);
  });

  test("the live CSP blocks other servers: the dialog says so and nothing reaches the server", async ({ page }) => {
    await page.goto("calc/");
    await page.getByTestId("grid").waitFor();
    await addConnection(page, { expectTest: /This site's security policy does not allow connections to other servers/ });
    await shot(page, "csp-blocked");
    const dlg = page.getByRole("dialog", { name: "Add a connection" });
    await dlg.getByRole("button", { name: "Save connection" }).click();
    await expect(page.getByTestId("remote-hint")).toContainText("security policy does not allow connections to other servers");
    await expect(page.getByTestId("connection-list").getByRole("button", { name: /Nextcloud/ })).toBeDisabled();
    expect(dav.log).toEqual([]);
  });
});
