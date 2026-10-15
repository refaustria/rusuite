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

  test("Open Calc in browser leads to the app", async ({ page }) => {
    await page.goto("./");
    await page.getByRole("link", { name: "Open Calc in browser" }).click();
    await expect(page).toHaveURL(/\/calc\/$/);
    await page.getByTestId("grid").waitFor();
  });
});
