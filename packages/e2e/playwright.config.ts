import { defineConfig, devices } from "@playwright/test";

// BASE_URL points the suite at a live site (scripts/deploy-web.sh --e2e); otherwise the local dist-web builds are served.
const external = process.env.BASE_URL;
const baseURL = (external ?? "http://127.0.0.1:4173").replace(/\/$/, "");

export default defineConfig({
  testDir: "./tests",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : undefined,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  outputDir: "test-results",
  use: {
    baseURL: baseURL + "/",
    viewport: { width: 1400, height: 900 },
    acceptDownloads: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1400, height: 900 } } }],
  webServer: external
    ? undefined
    : { command: "node serve.mjs", url: "http://127.0.0.1:4173/calc/", reuseExistingServer: !process.env.CI, timeout: 30_000 },
});
