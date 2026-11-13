// P11-N2: Notes in the compact layout (412 px, Pixel 7 emulation; project `mobile`): the shared top bar and command
// bar replace the ribbon, the navigation pane is a drawer, the page stays editable. Touch-specific work: later.

import { expect, test } from "@playwright/test";
import path from "node:path";
import { trackErrors } from "../support/common";

const shots = process.env.NOTES_SHOTS;

test.describe("Notes compact layout @mobile", () => {
  test("notes: the drawer opens the navigation, a page is picked and edited; no sideways scroll", async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto("notes/");
    const editor = page.getByTestId("page-editor");
    await expect(editor).toBeVisible();
    await expect(page.getByTestId("nav-pane")).toHaveCount(0);
    await expect(page.getByTestId("ribbon")).toHaveCount(0);
    // The page is editable without the drawer.
    await editor.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type(" Typed on a phone.");
    await expect(editor).toContainText("Typed on a phone.");
    // The drawer: navigation, a new page, back to the page.
    await page.getByTestId("nav-drawer-button").click();
    const drawer = page.getByTestId("nav-drawer");
    await expect(drawer.getByTestId("section-item")).toHaveText(["Quick notes"]);
    if (shots) await page.screenshot({ path: path.join(shots, "P11-N2-compact-drawer.png") });
    await drawer.getByTestId("new-page").click();
    await expect(page.getByTestId("nav-drawer")).toHaveCount(0);
    await expect(page.getByTestId("page-title")).toHaveValue("");
    await page.getByTestId("nav-drawer-button").click();
    await page.getByTestId("nav-drawer").getByTestId("page-item").filter({ hasText: "Welcome to Rusuite Notes" }).click();
    await expect(page.getByTestId("nav-drawer")).toHaveCount(0);
    await expect(editor).toContainText("Typed on a phone.");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    if (shots) await page.screenshot({ path: path.join(shots, "P11-N2-compact.png") });
    errors.expectNone();
  });
});
