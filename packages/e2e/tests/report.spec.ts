// P8-43: Help › Report a problem… / File › Report a problem… in the web apps, against a mock relay
// (support/reportMock.ts) on port 4853. The pages post to their own origin (`/api/report`, CSP `connect-src 'self'`);
// `page.route` forwards that path to the mock. `REPORT_SHOTS=<dir>` saves screenshots (P8-43-*.png).

import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { trackErrors } from "../support/common";
import { Grid, openCalc } from "../support/calc";
import { ReportMockServer } from "../support/reportMock";

const PORT = Number(process.env.REPORT_PORT ?? 4853);
const shots = process.env.REPORT_SHOTS;
const shot = async (page: Page, name: string) => {
  if (shots) await page.screenshot({ path: path.join(shots, `P8-43-${name}.png`) });
};

// A 2×2 PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR4nGP8z8DwnwEIGBkZGRgZAQAoiAQBXbAa7wAAAABJRU5ErkJggg==",
  "base64",
);

let mock: ReportMockServer;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  mock = new ReportMockServer(PORT);
  await mock.start();
});
test.afterAll(async () => mock?.stop());
test.beforeEach(() => mock.reset());

/** Forwards the page's `/api/report` to the mock relay; returns the URLs the page requested. */
async function relayRoute(page: Page) {
  const urls: string[] = [];
  page.on("request", (r) => urls.push(r.url()));
  await page.route("**/api/report", async (route) => {
    const res = await route.fetch({ url: mock.url });
    await route.fulfill({ response: res });
  });
  return urls;
}

const reportRequests = (urls: string[]) => urls.filter((u) => new URL(u).pathname.startsWith("/api/"));

/** The "?" Help menu at the right end of the tab strip › Report a problem…. */
async function openFromHelp(page: Page) {
  await page.getByRole("button", { name: "Help", exact: true }).click();
  await page.getByRole("menuitem", { name: "Report a problem…" }).click();
  await expect(page.getByTestId("report-dialog")).toBeVisible();
  return page.getByRole("dialog", { name: "Report a problem" });
}

async function fill(dlg: ReturnType<Page["getByRole"]>, title = "Sum shows the wrong total") {
  await dlg.getByTestId("report-title").fill(title);
  await dlg.getByTestId("report-description").fill("After typing 1, 2 and 3 into A1:A3, =SUM(A1:A3) shows 5 instead of 6.");
}

test.describe("Report a problem (P8-43)", () => {
  test("calc: submit a bug with a screenshot → the relay gets the report, the success card links the issue", async ({ page }) => {
    const errors = trackErrors(page);
    const urls = await relayRoute(page);
    await openCalc(page);
    await new Grid(page).type(0, 0, "confidential-cell-text");
    const dlg = await openFromHelp(page);
    await fill(dlg);
    await dlg.getByTestId("report-steps").fill("1. Type 1, 2, 3\n2. =SUM(A1:A3)");
    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), dlg.getByRole("button", { name: "Add screenshot…" }).click()]);
    await chooser.setFiles({ name: "sum.png", mimeType: "image/png", buffer: PNG });
    await expect(dlg.getByRole("img", { name: "sum.png" })).toBeVisible();
    await dlg.getByTestId("report-understood").check();
    await shot(page, "dialog");
    await dlg.getByTestId("report-submit").click();
    await expect(dlg.getByTestId("report-success")).toContainText("Thank you! Your report is issue #101.");
    const link = dlg.getByRole("link", { name: "Open the issue on GitHub" });
    await expect(link).toHaveAttribute("href", "https://github.com/refaustria/rusuite/issues/101");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(dlg.getByTestId("report-wait")).toHaveText("You can send another report in 60 min.");
    await shot(page, "success");

    expect(mock.log).toHaveLength(1);
    const body = mock.log[0]!.body!;
    expect(body).toMatchObject({
      app: "calc",
      platform: "web",
      os: expect.stringMatching(/^(Windows|Linux)$/), // Playwright's Desktop Chrome profile reports Windows
      locale: "en",
      kind: "bug",
      title: "Sum shows the wrong total",
      steps: "1. Type 1, 2, 3\n2. =SUM(A1:A3)",
      screenshots: [{ name: "sum.png", mime: "image/png", dataBase64: PNG.toString("base64") }],
    });
    expect(String(body.appVersion)).toMatch(/^\d+\.\d+\.\d+/);
    expect(String(body.instanceId)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(Object.keys(body).sort()).toEqual(
      ["app", "appVersion", "description", "diagnostics", "instanceId", "kind", "locale", "os", "platform", "screenshots", "steps", "title"],
    );
    expect(JSON.stringify(body)).not.toContain("confidential-cell-text");
    expect(reportRequests(urls)).toHaveLength(1);
    errors.expectNone();
  });

  test("write: a second report is gated in the app, and the relay's 429 is shown with its retry time", async ({ page }) => {
    await relayRoute(page);
    await page.goto("write/");
    await page.locator(".ProseMirror").waitFor();
    // File › Report a problem… (the backstage entry).
    await page.getByRole("tab", { name: "File", exact: true }).click();
    await page.getByTestId("backstage").getByRole("button", { name: "Report a problem…" }).click();
    let dlg = page.getByRole("dialog", { name: "Report a problem" });
    await dlg.getByLabel("Feature request").check();
    await expect(dlg.getByTestId("report-steps")).toHaveCount(0);
    await fill(dlg, "Please add a word count dialog");
    await dlg.getByTestId("report-understood").check();
    await dlg.getByTestId("report-submit").click();
    await expect(dlg.getByTestId("report-success")).toBeVisible();
    await dlg.getByRole("button", { name: "Close" }).click();

    // Reopened within the hour: the client-side gate.
    dlg = await openFromHelp(page);
    await expect(dlg.getByTestId("report-wait")).toHaveText(/^You can send another report in (59|60) min\.$/);
    await expect(dlg.getByTestId("report-submit")).toBeDisabled();
    await shot(page, "gate");
    await dlg.getByRole("button", { name: "Cancel" }).click();

    // Without the local gate (e.g. another browser profile of the same install) the relay refuses it: 429.
    await page.evaluate(() => localStorage.removeItem("rusuite.report.nextAllowedAt"));
    dlg = await openFromHelp(page);
    await fill(dlg, "Second report");
    await dlg.getByTestId("report-understood").check();
    await dlg.getByTestId("report-submit").click();
    await expect(dlg.getByTestId("report-error")).toHaveText("Too many reports – you can send another report in 43 min.");
    await expect(dlg.getByTestId("report-submit")).toBeDisabled();
    await shot(page, "rate-limit");
    expect(mock.log).toHaveLength(2);
    expect(mock.log[0]!.body!.instanceId).toBe(mock.log[1]!.body!.instanceId);
  });

  test("privacy: no request to /api/report unless the user submits", async ({ page }) => {
    const urls = await relayRoute(page);
    for (const app of ["calc", "write", "show"]) {
      await page.goto(`${app}/`);
      await page.getByRole("tab", { name: "Home", exact: true }).waitFor();
      await page.waitForTimeout(300);
      const dlg = await openFromHelp(page);
      await fill(dlg);
      await dlg.getByTestId("report-understood").check();
      await dlg.getByTestId("report-capture").click();
      await expect(dlg.getByTestId("report-shots").getByRole("img")).toHaveCount(1);
      await dlg.getByRole("button", { name: "Cancel" }).click();
      await expect(page.getByTestId("report-dialog")).toHaveCount(0);
    }
    expect(reportRequests(urls)).toEqual([]);
    expect(mock.log).toEqual([]);
  });

  test("show: the diagnostics preview is exactly what is sent", async ({ page }) => {
    await relayRoute(page);
    await page.goto("show/");
    await page.getByTestId("editor-stage").first().waitFor();
    const dlg = await openFromHelp(page);
    await fill(dlg, "Slide sorter question");
    await dlg.getByLabel("Question").check();
    await dlg.getByText("Show exactly what is sent").click();
    const preview = JSON.parse((await dlg.getByTestId("report-diagnostics-preview").textContent()) ?? "");
    expect(preview).toMatchObject({ viewport: { width: 1400, height: 900 }, docStats: { slides: expect.any(Number) } });
    expect(preview.userAgent).toContain("Mozilla/5.0");
    await shot(page, "diagnostics");
    await dlg.getByTestId("report-understood").check();
    await dlg.getByTestId("report-submit").click();
    await expect(dlg.getByTestId("report-success")).toBeVisible();
    expect(mock.log[0]!.body!.diagnostics).toEqual(preview);
    expect(mock.log[0]!.body!.kind).toBe("question");
  });

  test("the 'I understand' checkbox gates submit", async ({ page }) => {
    await relayRoute(page);
    await openCalc(page);
    const dlg = await openFromHelp(page);
    await expect(dlg.getByTestId("report-public")).toContainText(
      "Your report, including screenshots, will be posted publicly at github.com/refaustria/rusuite/issues. Do not include confidential content.",
    );
    await fill(dlg);
    const submit = dlg.getByTestId("report-submit");
    await expect(submit).toBeDisabled();
    await dlg.getByTestId("report-understood").check();
    await expect(submit).toBeEnabled();
    await dlg.getByTestId("report-understood").uncheck();
    await expect(submit).toBeDisabled();
    expect(mock.log).toEqual([]);
  });

  test.describe("German", () => {
    test.use({ locale: "de-DE" });
    test("calc: Problem melden", async ({ page }) => {
      await relayRoute(page);
      await openCalc(page);
      await page.getByRole("button", { name: "Hilfe", exact: true }).click();
      await page.getByRole("menuitem", { name: "Problem melden…" }).click();
      const dlg = page.getByRole("dialog", { name: "Problem melden" });
      await expect(dlg.getByTestId("report-public")).toContainText("öffentlich unter github.com/refaustria/rusuite/issues");
      await expect(dlg.getByLabel("Verstanden")).not.toBeChecked();
      await shot(page, "dialog-de");
    });
  });
});
