// P7-6: unsaved-changes safety – the Save / Don't save / Cancel question before
// a command replaces the document.
import { expect, test } from "@playwright/test";
import { downloadBuffer, fileCommand, testdata, trackErrors } from "../support/common";
import { Grid, openCalc } from "../support/calc";
import { zipText } from "../support/zip";

test.describe("Unsaved changes", () => {
  test("calc: New on a modified workbook asks; Cancel keeps the document", async ({ page }) => {
    const errors = trackErrors(page);
    await openCalc(page);
    const grid = new Grid(page);
    await grid.type(0, 0, "keep me");
    await expect(page.getByTestId("status-bar")).toContainText("Modified");
    await fileCommand(page, "New");
    const ask = page.getByRole("dialog", { name: "Save changes to Untitled?" });
    await expect(ask).toBeVisible();
    await expect(ask.getByRole("button")).toHaveText(["Save", "Don't save", "Cancel"]);
    await ask.getByRole("button", { name: "Cancel" }).click();
    await expect(ask).toHaveCount(0);
    await expect(page.getByTestId("status-bar")).toContainText("Modified");
    expect(await grid.input(0, 0)).toBe("keep me");
    errors.expectNone();
  });

  test("write: Ctrl+N then Don't save starts a new document", async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto("write/");
    const ed = page.locator(".ProseMirror");
    await ed.waitFor();
    await ed.click();
    await page.keyboard.type("Throw this away");
    await expect(page.getByTestId("dirty")).toHaveText("Modified");
    await page.keyboard.press("Control+n");
    const ask = page.getByRole("dialog", { name: "Save changes to Untitled?" });
    await ask.getByRole("button", { name: "Don't save" }).click();
    await expect(ask).toHaveCount(0);
    await expect(ed).not.toContainText("Throw this away");
    await expect(page.getByTestId("dirty")).toHaveText("Saved");
    errors.expectNone();
  });

  test("calc: Open on a modified workbook, Save names and downloads it, then opens the file", async ({ page }) => {
    const errors = trackErrors(page);
    await openCalc(page);
    const grid = new Grid(page);
    await grid.type(0, 0, "saved first");
    await expect(page.getByTestId("status-bar")).toContainText("Modified");
    await fileCommand(page, /^Open/);
    await page.getByTestId("open-page").getByRole("button", { name: /^This device/ }).click();
    await page.getByRole("dialog", { name: "Save changes to Untitled?" }).getByRole("button", { name: "Save", exact: true }).click();
    const name = page.getByRole("dialog", { name: "Save as" }).getByLabel("File name");
    await expect(name).toHaveValue("Workbook.xlsx");
    await name.fill("draft");
    const download = page.waitForEvent("download");
    const chooser = page.waitForEvent("filechooser");
    await name.press("Enter");
    const dl = await download;
    expect(dl.suggestedFilename()).toBe("draft.xlsx");
    expect(zipText(await downloadBuffer(dl), "xl/sharedStrings.xml")).toContain("saved first");
    await (await chooser).setFiles(testdata("xlsx/provisional-basic.xlsx"));
    await expect(page.getByRole("tablist", { name: "Sheets" }).getByRole("tab", { name: "Summary" })).toBeVisible();
    await expect(page.getByTestId("status-bar")).toContainText("Saved");
    errors.expectNone();
  });
});
