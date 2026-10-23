import { expect, test, type Page } from "@playwright/test";
import { fileCommand, interceptPrint, printCount, simulateDesktop, trackErrors } from "../support/common";
import { Grid, openCalc } from "../support/calc";

const editor = (page: Page) => page.locator(".ProseMirror");

async function openWrite(page: Page) {
  await page.goto("write/");
  await editor(page).waitFor();
  await expect(page.getByTestId("status-bar")).toContainText("Saved");
}

/**
 * P10-M6: File › Export PDF… without a print dialog. The web build has no PDF renderer; with the simulated desktop
 * and the e2e stand-in for the shell's commands (`window.__RUSUITE_TEST_INVOKE__`) it takes the shell's path:
 * `export_pdf` with the print root mounted and the "Creating PDF…" sheet shown until the shell answers.
 */
async function stubPdfShell(page: Page) {
  await simulateDesktop(page);
  await page.addInitScript(() => {
    const w = window as unknown as {
      __pdfCalls: unknown[];
      __pdfRelease: (() => void) | null;
      __RUSUITE_TEST_INVOKE__: (cmd: string, args: Record<string, unknown>) => Promise<unknown>;
    };
    w.__pdfCalls = [];
    w.__pdfRelease = null;
    w.__RUSUITE_TEST_INVOKE__ = (cmd, args) =>
      new Promise((resolve) => {
        const root = document.getElementById("rusuite-print-root");
        w.__pdfCalls.push({ cmd, args, pages: root?.querySelectorAll(".rs-print-page").length ?? 0 });
        // Held until the test releases it, so the busy sheet can be checked.
        w.__pdfRelease = () => resolve(String(args.suggestedName));
      });
  });
}

const pdfCalls = (page: Page) => page.evaluate(() => (window as unknown as { __pdfCalls: unknown[] }).__pdfCalls);
const releasePdf = (page: Page) => page.evaluate(() => (window as unknown as { __pdfRelease: () => void }).__pdfRelease());
const printRoot = (page: Page) => page.locator("#rusuite-print-root");

test.describe("PDF export (P10-M6)", () => {
  test("Calc: Export PDF… calls export_pdf with the paper and name, shows the busy sheet, never the print dialog", async ({ page }) => {
    const errors = trackErrors(page);
    await interceptPrint(page);
    await stubPdfShell(page);
    await openCalc(page);
    const grid = new Grid(page);
    await grid.type(0, 0, "hello");
    // Print › Landscape: the PDF's paper follows the print settings.
    await page.keyboard.press("Control+p");
    await expect(page.getByTestId("print-panel")).toBeVisible();
    await page.getByLabel("Orientation").selectOption("landscape");
    await expect(page.getByTestId("print-export-pdf")).toBeVisible();
    await page.keyboard.press("Escape");
    await fileCommand(page, /^Export PDF/);
    const busy = page.getByTestId("pdf-busy");
    await expect(busy).toBeVisible();
    await expect(busy).toHaveAttribute("data-busy", "true");
    await expect(busy).toContainText("Creating PDF…");
    await expect(printRoot(page)).toHaveCount(1);
    expect(await pdfCalls(page)).toEqual([
      {
        cmd: "export_pdf",
        args: { suggestedName: "Untitled.pdf", paper: { widthMm: 297, heightMm: 210, landscape: true }, dialog: { title: "Export PDF" } },
        pages: 1,
      },
    ]);
    await releasePdf(page);
    await expect(busy).toHaveCount(0);
    await expect(printRoot(page)).toHaveCount(0);
    expect(await printCount(page)).toBe(0);
    // The Print page's own Export PDF button takes the same path; Print keeps the dialog.
    await page.keyboard.press("Control+p");
    await page.getByTestId("print-export-pdf").click();
    await expect.poll(async () => (await pdfCalls(page)).length).toBe(2);
    await releasePdf(page);
    await expect(page.getByTestId("pdf-busy")).toHaveCount(0);
    await page.getByTestId("print-button").click();
    await expect.poll(() => printCount(page)).toBe(1);
    // (The preview frame is sandboxed without scripts: Chromium logs that, nothing else may fail.)
    expect(errors.list.filter((e) => !/sandboxed/.test(e))).toEqual([]);
  });

  test("Write: Export PDF… names the PDF after the document and uses its page size", async ({ page }) => {
    await interceptPrint(page);
    await stubPdfShell(page);
    await openWrite(page);
    await editor(page).click();
    await page.keyboard.type("A PDF of this");
    await fileCommand(page, /^Export PDF/);
    await expect(page.getByTestId("pdf-busy")).toBeVisible();
    const calls = (await pdfCalls(page)) as { cmd: string; args: { suggestedName: string; paper: { widthMm: number; heightMm: number; landscape: boolean } }; pages: number }[];
    expect(calls).toHaveLength(1);
    expect(calls[0]!.cmd).toBe("export_pdf");
    expect(calls[0]!.args.suggestedName).toMatch(/\.pdf$/);
    expect(calls[0]!.args.paper.landscape).toBe(false);
    expect(calls[0]!.args.paper.heightMm).toBeGreaterThan(calls[0]!.args.paper.widthMm);
    expect(calls[0]!.pages).toBeGreaterThan(0);
    await releasePdf(page);
    await expect(page.getByTestId("pdf-busy")).toHaveCount(0);
    expect(await printCount(page)).toBe(0);
  });

  test("without the shell's PDF renderer Export PDF… stays the print dialog and the Print page has no PDF button", async ({ page }) => {
    await interceptPrint(page);
    await simulateDesktop(page);
    await openCalc(page);
    await new Grid(page).type(0, 0, "hello");
    await page.keyboard.press("Control+p");
    await expect(page.getByTestId("print-panel")).toBeVisible();
    await expect(page.getByTestId("print-export-pdf")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await fileCommand(page, /^Export PDF/);
    await expect.poll(() => printCount(page)).toBe(1);
    await expect(page.getByTestId("pdf-busy")).toHaveCount(0);
  });
});
