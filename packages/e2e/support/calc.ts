import { expect, type Page } from "@playwright/test";

// Grid geometry at 100 %: 46 px row headers, 22 px column headers, 64 x 20 px cells.
const HEADER_W = 46, HEADER_H = 22, COL_W = 64, ROW_H = 20;

export async function openCalc(page: Page) {
  await page.goto("calc/");
  await page.getByTestId("grid").waitFor();
  // The wasm core is ready once the first interaction round-trips.
  await expect(page.getByTestId("cell-address")).toHaveValue("A1");
}

export class Grid {
  constructor(public page: Page) {}
  pos(row: number, col: number, dx = 0, dy = 0) {
    return this.page.getByTestId("grid").boundingBox().then((b) => ({
      x: b!.x + HEADER_W + COL_W * col + COL_W / 2 + dx,
      y: b!.y + HEADER_H + ROW_H * row + ROW_H / 2 + dy,
    }));
  }
  async click(row: number, col: number, opts: { shift?: boolean; button?: "right" } = {}) {
    const q = await this.pos(row, col);
    if (opts.shift) await this.page.keyboard.down("Shift");
    await this.page.mouse.click(q.x, q.y, { button: opts.button });
    if (opts.shift) await this.page.keyboard.up("Shift");
  }
  /**
   * Resolves once the app has no request to the core pending, no region re-fetch queued and no rule change settling
   * (the grid's `data-busy`). Use it after a dialog's OK before acting on the result.
   */
  async waitIdle() {
    await expect(this.page.getByTestId("grid")).not.toHaveAttribute("data-busy");
  }
  /** Types text into a cell and commits with Enter. */
  async type(row: number, col: number, text: string) {
    await this.click(row, col);
    await this.page.keyboard.type(text);
    await this.page.keyboard.press("Enter");
    await expect(this.page.getByTestId("cell-editor")).toHaveCount(0);
  }
  /** The cell's input as the formula bar shows it. */
  async input(row: number, col: number) {
    await this.click(row, col);
    return this.page.getByLabel("Formula bar").inputValue();
  }
  /** The displayed value: copy, paste-values into a scratch cell, read that cell's input, clear it. */
  async display(row: number, col: number) {
    const scratch = { r: 27, c: 19 };
    await this.click(row, col);
    await this.page.keyboard.press("Control+c");
    await this.click(scratch.r, scratch.c);
    await this.page.keyboard.press("Control+Shift+v");
    const v = await expect.poll(async () => this.page.getByLabel("Formula bar").inputValue()).not.toBe("").then(() => this.page.getByLabel("Formula bar").inputValue());
    await this.page.keyboard.press("Delete");
    await this.page.keyboard.press("Escape");
    return v;
  }
}
