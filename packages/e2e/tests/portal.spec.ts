import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { trackErrors } from "../support/common";

test.describe("Portal", () => {
  test("the root lists the three apps and shows the build version", async ({ page }) => {
    const errors = trackErrors(page);
    const res = await page.goto("./");
    expect(res?.status()).toBe(200);
    expect(page.url()).not.toContain("/calc/");
    await expect(page.getByRole("heading", { level: 1, name: "Rusuite" })).toBeVisible();
    for (const app of ["Calc", "Write", "Show"]) {
      const link = page.getByRole("link", { name: `Open ${app} in browser` });
      await expect(link).toHaveAttribute("href", `/${app.toLowerCase()}/`);
      await expect(page.getByRole("img", { name: `Rusuite ${app} logo` })).toBeVisible();
    }
    const logos = await page.locator("img").evaluateAll((imgs) => imgs.map((i) => (i as HTMLImageElement).naturalWidth));
    expect(logos.every((w) => w > 0)).toBe(true);
    await expect(page.getByTestId("version")).toHaveText(/^Build \S+ · \d{4}-\d{2}-\d{2}$/);
    errors.expectNone();
  });

  test("P8-47: rusuit.es wordmark, free/open-source statement (EN, DE), canonical links, no extra requests", async ({ page }) => {
    const errors = trackErrors(page);
    const requests: string[] = [];
    page.on("request", (r) => requests.push(new URL(r.url()).pathname));
    await page.goto("./");
    await expect(page).toHaveTitle("rusuit.es – Rusuite: free, open-source office suite");
    const h1 = page.getByRole("heading", { level: 1 });
    await expect(h1).toHaveText("rusuit.es");
    await expect(h1.locator(".wm-a")).toHaveText("rusuit");
    await expect(h1.locator(".wm-b")).toHaveText(".es");
    const statement = page.locator(".statement");
    await expect(statement).toContainText("Rusuite is free to use and open source (MIT licence) – and it will stay that way. No accounts, no tracking, no server-side documents.");
    await expect(statement.getByRole("link", { name: "MIT licence" })).toHaveAttribute("href", "https://github.com/refaustria/rusuite/blob/main/LICENSE");
    await expect(statement.getByRole("link", { name: "no tracking" })).toHaveAttribute("href", "privacy.html");
    const os = page.locator(".opensource");
    await expect(os.getByRole("heading", { name: "Open source, free, and it stays that way" })).toBeVisible();
    await expect(os.getByRole("link", { name: "issue on GitHub" })).toHaveAttribute("href", /github\.com\/refaustria\/rusuite\/issues$/);
    for (const [p, file] of [["./", ""], ["privacy.html", "privacy.html"], ["downloads.html", "downloads.html"]] as const) {
      await page.goto(p);
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `https://rusuit.es/${file}`);
      if (file) await expect(page.locator("a.wordmark")).toHaveText("rusuit.es");
    }
    await page.goto("privacy.html");
    await expect(page.getByText("rusuit.es", { exact: false }).first()).toBeVisible();
    await page.goto("./");
    await page.getByRole("button", { name: "DE" }).click();
    await expect(page).toHaveTitle("rusuit.es – Rusuite: freie, quelloffene Office-Suite");
    await expect(page.locator(".statement")).toContainText("Rusuite ist kostenlos nutzbar und quelloffen (MIT-Lizenz) – und das bleibt so. Keine Konten, kein Tracking, keine Dokumente auf dem Server.");
    await expect(page.locator(".opensource").getByRole("heading", { name: "Quelloffen, kostenlos – und das bleibt so" })).toBeVisible();
    await page.getByRole("button", { name: "EN" }).click();
    // Only the portal's own static files, as before.
    expect(requests.filter((u) => !/^\/(|index\.html|privacy\.html|downloads\.html|styles\.css|i18n\.js|version\.js|downloads\.js|version\.json|favicon\.ico|logos\/[\w.-]+|locales\/(en|de)\.json)$/.test(u))).toEqual([]);
    errors.expectNone();
  });

  test("P8-49: Coming soon section (EN, DE) and the footer link on the Downloads page", async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto("./");
    const soon = page.locator("#soon");
    await expect(soon.getByRole("heading", { name: "Coming soon" })).toBeVisible();
    await expect(soon.locator("li")).toHaveCount(7);
    await expect(soon.locator("li").first()).toContainText("Android and iOS");
    await expect(soon).toContainText("Slicers, sparklines, sheet protection and Flash Fill are planned.");
    await expect(soon).toContainText("Your feedback shapes the order");
    await page.getByRole("button", { name: "DE" }).click();
    await expect(soon.getByRole("heading", { name: "Demnächst" })).toBeVisible();
    await expect(soon).toContainText("Datenschnitte, Sparklines, Blattschutz und Blitzvorschau sind geplant.");
    await expect(soon).toContainText("Dein Feedback bestimmt die Reihenfolge");
    await page.getByRole("button", { name: "EN" }).click();
    await page.goto("downloads.html");
    await expect(page.getByRole("link", { name: "What's coming soon" })).toHaveAttribute("href", "./#soon");
    await page.getByRole("button", { name: "DE" }).click();
    await expect(page.getByRole("link", { name: "Was demnächst kommt" })).toBeVisible();
    await page.getByRole("button", { name: "EN" }).click();
    errors.expectNone();
  });

  test("Open Calc in browser leads to the app", async ({ page }) => {
    await page.goto("./");
    await page.getByRole("link", { name: "Open Calc in browser" }).click();
    await expect(page).toHaveURL(/\/calc\/$/);
    await page.getByTestId("grid").waitFor();
  });
});

// P8-41: the static Downloads page (generated at deploy time by scripts/gen-downloads.sh; never fetches anything).
test.describe("Downloads page", () => {
  const generate = (): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rusuite-dl-"));
    const names = ["Calc", "Write", "Show"].flatMap((app) =>
      ["_0.1.0-rc.1_x64-setup.exe", "_0.1.0-rc.1_x64_en-US.msi", "_0.1.0-rc.1_aarch64.dmg", "_0.1.0-rc.1_x64.dmg",
        "_0.1.0-rc.1_amd64.deb", "-0.1.0~rc.1-1.x86_64.rpm", "_0.1.0-rc.1_amd64.AppImage", "_aarch64.app.tar.gz"].map(
        (suffix) => `Rusuite.${app}${suffix}`,
      ),
    );
    const release = {
      tagName: "v0.1.0-rc.1",
      publishedAt: "2026-10-20T10:00:00Z",
      isPrerelease: true,
      assets: names.map((name, i) => ({
        name,
        size: 4_200_000 + i,
        url: `https://github.com/refaustria/rusuite/releases/download/v0.1.0-rc.1/${name}`,
        digest: `sha256:${"ab".repeat(31)}${i.toString(16).padStart(2, "0")}`,
      })),
    };
    fs.writeFileSync(path.join(dir, "release.json"), JSON.stringify(release));
    const script = fileURLToPath(new URL("../../../scripts/gen-downloads.mjs", import.meta.url));
    execFileSync("node", [script, "--in", path.join(dir, "release.json"), "--out", path.join(dir, "downloads.html")]);
    return fs.readFileSync(path.join(dir, "downloads.html"), "utf8");
  };

  test("the portal header links to the downloads page; without a release it points to GitHub", async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto("./");
    await page.getByRole("navigation").getByRole("link", { name: "Downloads" }).click();
    await expect(page).toHaveURL(/\/downloads\.html$/);
    await expect(page.getByRole("heading", { level: 1, name: "Desktop downloads" })).toBeVisible();
    await expect(page.getByRole("link", { name: "GitHub Releases" })).toHaveAttribute("href", /github\.com\/refaustria\/rusuite\/releases$/);
    await page.getByRole("button", { name: "DE" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Desktop-Downloads" })).toBeVisible();
    await page.getByRole("button", { name: "EN" }).click();
    errors.expectNone();
  });

  test("a generated page offers the visitor's OS first, with checksums, and requests nothing from other hosts", async ({ page }) => {
    const errors = trackErrors(page);
    const html = generate();
    await page.route("**/downloads.html*", (route) => route.fulfill({ contentType: "text/html; charset=utf-8", body: html }));
    const requests: string[] = [];
    page.on("request", (r) => requests.push(r.url()));
    await page.goto("./downloads.html?os=linux");
    const sections = page.locator("section.os");
    await expect(sections).toHaveCount(3);
    await expect(sections.first()).toHaveAttribute("data-os", "linux");
    await expect(sections.first().getByText("Recommended for this device")).toBeVisible();
    await expect(page.getByText("Unsigned alpha builds – expect warnings from your operating system")).toBeVisible();
    const calc = sections.first().locator('[data-app="calc"]');
    await expect(calc.getByRole("link", { name: /Debian, Ubuntu \(\.deb\)/ })).toHaveAttribute("href", /Rusuite\.Calc_0\.1\.0-rc\.1_amd64\.deb$/);
    await expect(calc.getByRole("link", { name: /\.rpm/ })).toBeVisible();
    await expect(calc.getByRole("link", { name: /\.AppImage/ })).toBeVisible();
    await sections.first().getByText("SHA-256 checksums").click();
    await expect(sections.first().locator("dd code").first()).toHaveText(/^[0-9a-f]{64}$/);
    await page.getByRole("button", { name: "DE" }).click();
    await expect(page.getByText("Empfohlen für dieses Gerät")).toBeVisible();
    await expect(calc.locator("small").first()).toHaveText(/^4,2 MB$/);
    await expect(page.getByText("Veröffentlicht am 20. Oktober 2026")).toBeVisible();
    await page.getByRole("button", { name: "EN" }).click();
    // Windows first for a Windows visitor.
    await page.goto("./downloads.html?os=windows");
    await expect(sections.first()).toHaveAttribute("data-os", "windows");
    const host = new URL(page.url()).origin;
    expect(requests.filter((u) => !u.startsWith(host))).toEqual([]);
    errors.expectNone();
  });

  test("without a query the page detects this browser's OS", async ({ page }) => {
    const html = generate();
    await page.route("**/downloads.html*", (route) => route.fulfill({ contentType: "text/html; charset=utf-8", body: html }));
    await page.goto("./downloads.html");
    // The platform the browser reports (Playwright's "Desktop Chrome" device reports Windows on any host).
    const platform = await page.evaluate(() =>
      ((navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform).toLowerCase(),
    );
    const expected = platform.startsWith("win") ? "windows" : platform.startsWith("mac") ? "macos" : "linux";
    await expect(page.locator("section.os").first()).toHaveAttribute("data-os", expected);
  });
});
