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
    await expect(page.getByTestId("version")).toHaveText(/^Rusuite \d+\.\d+(\.\d+)?(-\S+)? · Build \S+ · \d{4}-\d{2}-\d{2}$/);
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
    await page.getByTestId("portal-language").selectOption("de");
    await expect(page).toHaveTitle("rusuit.es – Rusuite: freie, quelloffene Office-Suite");
    await expect(page.locator(".statement")).toContainText("Rusuite ist kostenlos nutzbar und quelloffen (MIT-Lizenz) – und das bleibt so. Keine Konten, kein Tracking, keine Dokumente auf dem Server.");
    await expect(page.locator(".opensource").getByRole("heading", { name: "Quelloffen, kostenlos – und das bleibt so" })).toBeVisible();
    await page.getByTestId("portal-language").selectOption("en");
    // Only the portal's own static files, as before.
    expect(requests.filter((u) => !/^\/(|index\.html|privacy\.html|downloads\.html|styles\.css|i18n\.js|version\.js|downloads\.js|version\.json|favicon\.ico|logos\/[\w.-]+|locales\/(en|de)\.json)$/.test(u))).toEqual([]);
    errors.expectNone();
  });

  test("P8-49/P10-R1: New in 3.1415 and Coming soon sections (EN, DE, English for pending keys) and the footer link on the Downloads page", async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto("./");
    const fresh = page.locator("#new");
    await expect(fresh.getByRole("heading", { name: "New in 3.1415" })).toBeVisible();
    await expect(fresh.locator("li")).toHaveCount(4);
    await expect(fresh).toContainText("Calc, Write and Show for Android and iOS");
    await expect(fresh.getByRole("link", { name: "release notes" })).toHaveAttribute("href", /docs\/release-notes\/3\.1415\.md$/);
    const soon = page.locator("#soon");
    await expect(soon.getByRole("heading", { name: "Coming soon" })).toBeVisible();
    await expect(soon.locator("li")).toHaveCount(2);
    await expect(soon.locator("li").first()).toContainText("Google Drive");
    await expect(soon).toContainText("Signed Windows builds");
    await expect(soon).not.toContainText("Android and iOS apps for Calc, Write and Show are planned");
    await expect(soon).toContainText("Your feedback shapes the order");
    await page.getByTestId("portal-language").selectOption("de");
    await expect(fresh.getByRole("heading", { name: "Neu in 3.1415" })).toBeVisible();
    await expect(fresh).toContainText("Calc, Write und Show für Android und iOS");
    await expect(soon.getByRole("heading", { name: "Demnächst" })).toBeVisible();
    await expect(soon).toContainText("Signierte Windows-Versionen");
    await expect(soon).toContainText("Dein Feedback bestimmt die Reihenfolge");
    // A language whose catalog lacks a key yet shows the English text, never the key name.
    await page.getByTestId("portal-language").selectOption("fr");
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    expect(await page.locator("main").innerText()).not.toMatch(/\bportal\.[a-z]/);
    await page.getByTestId("portal-language").selectOption("en");
    await page.goto("downloads.html");
    await expect(page.getByRole("link", { name: "What's coming soon" })).toHaveAttribute("href", "./#soon");
    await page.getByTestId("portal-language").selectOption("de");
    await expect(page.getByRole("link", { name: "Was demnächst kommt" })).toBeVisible();
    await page.getByTestId("portal-language").selectOption("en");
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
  // P10-S1: `signing` = the release's signing.json; a GPG-signed release also carries the .asc files and SHA256SUMS.
  type Signing = { macos: boolean; windows: boolean; linux: boolean };
  const generate = (signing?: Signing): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rusuite-dl-"));
    const names = ["Calc", "Write", "Show"].flatMap((app) =>
      ["_0.1.0-rc.1_x64-setup.exe", "_0.1.0-rc.1_x64_en-US.msi", "_0.1.0-rc.1_aarch64.dmg", "_0.1.0-rc.1_x64.dmg",
        "_0.1.0-rc.1_amd64.deb", "-0.1.0~rc.1-1.x86_64.rpm", "_0.1.0-rc.1_amd64.AppImage", "_aarch64.app.tar.gz"].map(
        (suffix) => `Rusuite.${app}${suffix}`,
      ),
    );
    if (signing?.linux) names.push(...names.filter((n) => /\.(deb|rpm|AppImage)$/.test(n)).map((n) => `${n}.asc`), "SHA256SUMS", "SHA256SUMS.asc");
    const release = {
      tagName: "v0.1.0-rc.1",
      publishedAt: "2026-10-20T10:00:00Z",
      isPrerelease: true,
      ...(signing && {
        signing: {
          macos: { signed: signing.macos, notarized: signing.macos },
          windows: { signed: signing.windows, method: signing.windows ? "azure" : null },
          linux: { gpg: signing.linux, fingerprint: signing.linux ? "0123456789ABCDEF0123456789ABCDEF01234567" : null },
          sha256sums: signing.linux,
        },
      }),
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

  test("the portal header links to the downloads page; a release lists the installers, without one it points to GitHub", async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto("./");
    await page.getByRole("navigation").getByRole("link", { name: "Downloads" }).click();
    await expect(page).toHaveURL(/\/downloads\.html$/);
    await expect(page.getByRole("heading", { level: 1, name: "Desktop downloads" })).toBeVisible();
    // Two states: the committed fallback (no release) and the page generated at deploy time from a release.
    const release = (await page.getByTestId("downloads").getAttribute("data-release")) ?? "none";
    if (release === "none") {
      await expect(page.getByRole("link", { name: "GitHub Releases" })).toHaveAttribute("href", /github\.com\/refaustria\/rusuite\/releases$/);
    } else {
      expect(release).toMatch(/^v\d/);
      await expect(page.locator("section.os")).toHaveCount(3);
      for (const os of ["windows", "macos", "linux"]) {
        const section = page.locator(`section[data-os="${os}"]`);
        for (const app of ["calc", "write", "show"]) {
          await expect(section.locator(`[data-app="${app}"] a.button`).first()).toHaveAttribute("href", /github\.com\/refaustria\/rusuite\/releases\/download\//);
        }
      }
      await expect(page.locator('[data-steps="macos15"]')).toContainText("Open Anyway");
    }
    await page.getByTestId("portal-language").selectOption("de");
    await expect(page.getByRole("heading", { level: 1, name: "Desktop-Downloads" })).toBeVisible();
    await page.getByTestId("portal-language").selectOption("en");
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
    await expect(page.getByText("These builds are not signed yet – your system will warn once")).toBeVisible();
    const calc = sections.first().locator('[data-app="calc"]');
    await expect(calc.getByRole("link", { name: /Debian, Ubuntu \(\.deb\)/ })).toHaveAttribute("href", /Rusuite\.Calc_0\.1\.0-rc\.1_amd64\.deb$/);
    await expect(calc.getByRole("link", { name: /\.rpm/ })).toBeVisible();
    await expect(calc.getByRole("link", { name: /\.AppImage/ })).toBeVisible();
    // P10-R1: phones and tablets – store links come from docs/store/links.json; empty = "coming soon" (not an `os` section).
    const phones = page.getByTestId("mobile-apps");
    await expect(phones.getByRole("heading", { name: "Phones and tablets" })).toBeVisible();
    await expect(phones.locator("li.dl-app")).toHaveCount(3);
    await expect(phones.locator('[data-soon="true"]')).toHaveCount(6);
    await expect(phones.locator("a")).toHaveCount(0);
    await sections.first().getByText("SHA-256 checksums").click();
    await expect(sections.first().locator("dd code").first()).toHaveText(/^[0-9a-f]{64}$/);
    await page.getByTestId("portal-language").selectOption("de");
    await expect(page.getByText("Empfohlen für dieses Gerät")).toBeVisible();
    await expect(calc.locator("small").first()).toHaveText(/^4,2 MB$/);
    await expect(page.getByText("Veröffentlicht am 20. Oktober 2026")).toBeVisible();
    await page.getByTestId("portal-language").selectOption("en");
    // P8-50: Gatekeeper / SmartScreen steps next to the buttons.
    const mac = page.locator('section[data-os="macos"]');
    await expect(page.getByText("These builds are not signed yet – your system will warn once")).toBeVisible();
    await expect(mac.getByRole("heading", { name: "macOS 15 Sequoia and later" })).toBeVisible();
    await expect(mac.locator('[data-steps="macos15"]')).toContainText("Done");
    await expect(mac.locator('[data-steps="macos15"]')).toContainText("Open Anyway");
    await expect(mac.locator('[data-steps="macos15"] code').first()).toHaveText('xattr -dr com.apple.quarantine "/Applications/Rusuite Calc.app"');
    await expect(mac.getByRole("heading", { name: "macOS 14 and earlier" })).toBeVisible();
    await expect(page.locator('section[data-os="windows"]')).toContainText("Run anyway");
    await page.getByTestId("portal-language").selectOption("de");
    await expect(mac.getByRole("heading", { name: "macOS 15 Sequoia und neuer" })).toBeVisible();
    await expect(mac.locator('[data-steps="macos15"]')).toContainText("Dennoch öffnen");
    await expect(mac.locator('[data-steps="macos14"]')).toContainText("rechten Maustaste");
    await expect(page.locator('section[data-os="windows"]')).toContainText("Trotzdem ausführen");
    await page.getByTestId("portal-language").selectOption("en");
    // Windows first for a Windows visitor.
    await page.goto("./downloads.html?os=windows");
    await expect(sections.first()).toHaveAttribute("data-os", "windows");
    const host = new URL(page.url()).origin;
    expect(requests.filter((u) => !u.startsWith(host))).toEqual([]);
    errors.expectNone();
  });

  test("P10-S1: a signed release says so per OS instead of the Gatekeeper/SmartScreen steps (EN, DE)", async ({ page }) => {
    const errors = trackErrors(page);
    let html = generate({ macos: true, windows: true, linux: true });
    await page.route("**/downloads.html*", (route) => route.fulfill({ contentType: "text/html; charset=utf-8", body: html }));
    const requests: string[] = [];
    page.on("request", (r) => requests.push(r.url()));
    await page.goto("./downloads.html?os=macos");
    await expect(page.locator("aside.unsigned")).toHaveCount(0);
    const mac = page.locator('section[data-os="macos"]');
    await expect(mac.locator('[data-signed="macos"]')).toHaveText(/Signed and notarized by Rusuite \(Apple Developer ID\)/);
    await expect(mac.locator("[data-steps]")).toHaveCount(0);
    await expect(page.locator('section[data-os="windows"] [data-signed="windows"]')).toContainText("Signed with an Authenticode certificate");
    await expect(page.locator('section[data-os="windows"] [data-steps]')).toHaveCount(0);
    const linux = page.locator('section[data-os="linux"]');
    await expect(linux.locator('[data-signed="linux"]')).toContainText("fingerprint 0123 4567 89AB CDEF");
    await expect(linux.locator('[data-steps="linux"]')).toBeVisible();
    await linux.getByText("SHA-256 checksums").click();
    await expect(linux.locator("a.asc").first()).toHaveAttribute("href", /releases\/download\/v0\.1\.0-rc\.1\/Rusuite\.Calc_0\.1\.0-rc\.1_amd64\.deb\.asc$/);
    const sums = page.getByTestId("sha256sums");
    await expect(sums.getByRole("link", { name: "SHA256SUMS.asc" })).toHaveAttribute("href", /\/SHA256SUMS\.asc$/);
    await expect(sums.getByRole("link", { name: "Rusuite release key" })).toHaveAttribute("href", "rusuite-release-key.asc");
    await page.getByTestId("portal-language").selectOption("de");
    await expect(mac.locator('[data-signed="macos"]')).toContainText("Signiert und notarisiert von Rusuite");
    await expect(linux.locator('[data-signed="linux"]')).toContainText("Fingerabdruck 0123 4567");
    await expect(sums.getByRole("heading", { name: "Download prüfen" })).toBeVisible();
    await page.getByTestId("portal-language").selectOption("en");
    // Partly signed: the notice names only the unsigned OS, whose steps stay.
    html = generate({ macos: false, windows: true, linux: true });
    await page.goto("./downloads.html?os=windows");
    await expect(page.locator("aside.unsigned h2")).toHaveText("Not signed yet: macOS");
    await expect(mac.locator('[data-steps="macos15"]')).toContainText("Open Anyway");
    await expect(page.locator('section[data-os="windows"] [data-steps]')).toHaveCount(0);
    await page.getByTestId("portal-language").selectOption("de");
    await expect(page.locator("aside.unsigned h2")).toHaveText("Noch nicht signiert: macOS");
    await page.getByTestId("portal-language").selectOption("en");
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
