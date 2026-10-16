import { expect, test, type Page } from "@playwright/test";
import { Grid, openCalc } from "../support/calc";

/** Fires the autosave the app does when the tab is hidden. */
async function hideTab(page: Page) {
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    window.dispatchEvent(new Event("visibilitychange"));
  });
  // Autosave writes to IndexedDB; give the write a moment, polled by the reload below.
  await page.waitForTimeout(400);
}

const apps = [
  { name: "calc", ready: (p: Page) => p.getByTestId("grid") },
  { name: "write", ready: (p: Page) => p.locator(".ProseMirror") },
  { name: "show", ready: (p: Page) => p.getByTestId("editor-stage") },
] as const;

test.describe("Cross-app", () => {
  for (const app of apps) {
    test(`${app.name}: Ctrl+/ opens the shortcut help, Esc closes it`, async ({ page }) => {
      await page.goto(`${app.name}/`);
      await app.ready(page).waitFor();
      await page.keyboard.press("Control+/");
      const dlg = page.getByRole("dialog", { name: "Keyboard shortcuts" });
      await expect(dlg).toBeVisible();
      await expect(dlg).toContainText("Ctrl");
      await page.keyboard.press("Escape");
      await expect(dlg).toHaveCount(0);
    });
  }

  test("calc: an unsaved edit is offered for recovery after a reload", async ({ page }) => {
    await openCalc(page);
    const grid = new Grid(page);
    await grid.type(0, 0, "recover me");
    await hideTab(page);
    await page.reload();
    const banner = page.getByTestId("recovery-banner");
    await expect(banner).toBeVisible();
    await expect(page.getByTestId("recovery-entry")).toHaveCount(1);
    await page.getByRole("button", { name: /^Restore/ }).click();
    await expect(banner).toHaveCount(0);
    await expect(page.getByTestId("grid")).toBeVisible();
    expect(await new Grid(page).input(0, 0)).toBe("recover me");
  });

  test("write: an unsaved edit is offered for recovery after a reload", async ({ page }) => {
    await page.goto("write/");
    const ed = page.locator(".ProseMirror");
    await ed.waitFor();
    await ed.click();
    await page.keyboard.type("Draft that must survive");
    await expect(page.getByTestId("dirty")).toHaveText("Modified");
    await hideTab(page);
    await page.reload();
    await expect(page.getByTestId("recovery-banner")).toBeVisible();
    await page.getByRole("button", { name: /^Restore/ }).click();
    await expect(ed).toContainText("Draft that must survive");
    await expect(page.getByTestId("recovery-banner")).toHaveCount(0);
  });

  test("show: a discarded recovery entry is gone after another reload", async ({ page }) => {
    await page.goto("show/");
    await page.getByTestId("editor-stage").waitFor();
    await page.getByRole("tab", { name: "Insert" }).click();
    await page.getByRole("button", { name: "Text box" }).click();
    // Text box arms drawing (P8-45 S-14): a click on the slide inserts it
    const stageBox = (await page.getByTestId("editor-stage").boundingBox())!;
    await page.mouse.click(stageBox.x + stageBox.width * 0.2, stageBox.y + stageBox.height * 0.8);
    await page.keyboard.type("Recovered");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("dirty")).toHaveText("Modified");
    await hideTab(page);
    await page.reload();
    await expect(page.getByTestId("recovery-entry")).toHaveCount(1);
    await page.getByRole("button", { name: /^Discard/ }).click();
    await expect(page.getByTestId("recovery-banner")).toHaveCount(0);
    await page.reload();
    await page.getByTestId("editor-stage").waitFor();
    await expect(page.getByTestId("recovery-banner")).toHaveCount(0);
  });
});
