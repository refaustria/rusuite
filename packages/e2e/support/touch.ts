// P10-X2: shared pieces of the touch suites (`*-touch.spec.ts`, `compact.spec.ts`).
//
// - `test`: Playwright's `test` whose `page` fixture slows the page's CPU down when `E2E_SLOW` is set
//   (`E2E_SLOW=1` → 4×, `E2E_SLOW=6` → 6×; DevTools `Emulation.setCPUThrottlingRate`), to reproduce a 2-core CI runner
//   on a fast machine.
// - `tapStable(locator)` / `stableCentre(locator)`: a tap on a control that has just appeared or moved (the floating
//   selection bar after a long press or a selection change, a menu opened by a long press, Calc's fill handle after the
//   selection grew) waits until the control is visible, enabled and its box is unchanged across two animation frames.
import { expect, test as base, type Locator } from "@playwright/test";

export { expect };

/** The CPU throttling rate `E2E_SLOW` asks for (0: none). */
export function slowRate(): number {
  const v = process.env.E2E_SLOW;
  if (!v || v === "0") return 0;
  const n = Number(v);
  return Number.isFinite(n) && n > 1 ? n : 4;
}

export const test = base.extend({
  // Only pages the test uses are slowed (a test that opens its own contexts gets no extra page).
  page: async ({ page }, use, testInfo) => {
    const rate = slowRate();
    if (rate) {
      testInfo.setTimeout(testInfo.timeout * 3);
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate });
    }
    await use(page);
  },
});

type Box = { x: number; y: number; width: number; height: number };
const same = (a: Box | null, b: Box | null) =>
  !!a && !!b && Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5;

/** The box of `locator` once it is visible and has not moved across two animation frames. */
export async function stableBox(locator: Locator): Promise<Box> {
  await expect(locator).toBeVisible();
  let box: Box | null = null;
  await expect
    .poll(async () => {
      const a = await locator.boundingBox();
      await locator.page().evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      const b = await locator.boundingBox();
      box = b;
      return same(a, b);
    })
    .toBe(true);
  return box!;
}

/** The centre of `locator` once it stands still (see `stableBox`). */
export async function stableCentre(locator: Locator): Promise<{ x: number; y: number }> {
  const b = await stableBox(locator);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** A tap on a control that may just have appeared or moved: visible, enabled, standing still – then the tap. */
export async function tapStable(locator: Locator): Promise<void> {
  await stableBox(locator);
  await expect(locator).toBeEnabled();
  await locator.tap();
}
