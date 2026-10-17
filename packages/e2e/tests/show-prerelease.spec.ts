import { expect, test, type Page } from "@playwright/test";
import { saveViaBackstage, trackErrors } from "../support/common";
import { zipText } from "../support/zip";

// P8-45: Show pre-release fixes (QA S-01 rich in-place text editor, S-14 text box tool, S-10 combo z-order, S-17 transition defaults).

const stage = (page: Page) => page.getByTestId("editor-stage");
const overlay = (page: Page) => page.getByTestId("text-overlay");

async function openShow(page: Page) {
  await page.goto("show/");
  await stage(page).waitFor();
  await expect(page.getByTestId("dirty")).toHaveText("Saved");
}

async function stageBox(page: Page) {
  const b = (await stage(page).boundingBox())!;
  return { x: b.x, y: b.y, w: b.width, h: b.height, cx: b.x + b.width / 2, cy: b.y + b.height / 2 };
}

/** A new Title and Content slide; its body placeholder in edit mode. */
async function editBody(page: Page) {
  await page.getByRole("button", { name: "New Slide" }).first().click();
  await expect(page.getByTestId("slide-count")).toHaveText("Slide 2 of 2");
  const s = await stageBox(page);
  await page.mouse.dblclick(s.cx, s.cy + s.h * 0.15);
  await expect(overlay(page)).toBeFocused();
}

/** The bounding box of the dark ("ink") pixels of a PNG (decoded in a blank page). */
async function inkBox(page: Page, png: Buffer) {
  const blank = await page.context().newPage();
  const box = await blank.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext("2d")!;
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
    for (let y = 0; y < c.height; y++)
      for (let x = 0; x < c.width; x++) {
        const i = (y * c.width + x) * 4;
        if (d[i]! + d[i + 1]! + d[i + 2]! < 200) {
          x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
        }
      }
    return { x0, y0, x1, y1 };
  }, png.toString("base64"));
  await blank.close();
  return box;
}

/** The `::before` content (the bullet) of each paragraph of the editor. */
const bullets = (page: Page) =>
  overlay(page).evaluate((el) => [...el.querySelectorAll<HTMLElement>("[data-p]")].map((p) => getComputedStyle(p, "::before").content));

test.describe("Show pre-release fixes (P8-45)", () => {
  test("S-01: a bulleted body is edited in place – the bullets stay visible while typing", async ({ page }) => {
    const errors = trackErrors(page);
    await openShow(page);
    await editBody(page);
    await page.keyboard.type("Revenue");
    expect(await bullets(page)).toEqual(['"•"']);
    await page.keyboard.press("Enter");
    await page.keyboard.type("Costs");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Margin");
    expect(await bullets(page)).toEqual(['"•"', '"•"', '"•"']);
    // the text sits after the bullet's hanging indent, in the master's level-1 size
    const style = await overlay(page).evaluate((el) => {
      const p = el.querySelector<HTMLElement>("[data-p]")!;
      const span = p.querySelector("span")!;
      return { pad: parseFloat(getComputedStyle(p).paddingLeft), size: parseFloat(getComputedStyle(span).fontSize) };
    });
    expect(style.pad).toBeGreaterThan(10);
    expect(style.size).toBeCloseTo((28 * 96) / 72, 0);
    await page.screenshot({ path: "../../shots/P8-45-bullets-editing.png" });
    await page.keyboard.press("Escape");
    await expect(overlay(page)).toHaveCount(0);
    const slide2 = zipText(await saveViaBackstage(page), "ppt/slides/slide2.xml");
    expect(slide2).toContain("<a:t>Revenue</a:t>");
    expect(slide2).toContain("<a:t>Margin</a:t>");
    errors.expectNone();
  });

  test("S-01: Tab makes a level-2 paragraph while typing; the saved pptx has lvl=\"1\"", async ({ page }) => {
    const errors = trackErrors(page);
    await openShow(page);
    await editBody(page);
    await page.keyboard.type("Plan");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    await page.keyboard.type("Detail");
    const levels = await overlay(page).evaluate((el) => [...el.querySelectorAll<HTMLElement>("[data-p]")].map((p) => [p.dataset.level, parseFloat(getComputedStyle(p).paddingLeft)]));
    expect(levels.map((l) => l[0])).toEqual(["0", "1"]);
    expect(levels[1]![1] as number).toBeGreaterThan((levels[0]![1] as number) + 20);
    expect(await bullets(page)).toHaveLength(2);
    await page.screenshot({ path: "../../shots/P8-45-level2.png" });
    await page.keyboard.press("Escape");
    const slide2 = zipText(await saveViaBackstage(page), "ppt/slides/slide2.xml");
    expect(slide2).toMatch(/<a:pPr[^>]*lvl="1"[^>]*\/?>(<[^>]*>)*<a:t>Detail<\/a:t>/);
    expect(slide2).toContain("<a:t>Plan</a:t>");
    errors.expectNone();
  });

  test("S-01: the text does not move when editing starts (same metrics as the slide)", async ({ page }) => {
    const errors = trackErrors(page);
    await openShow(page);
    await editBody(page);
    await page.keyboard.type("Revenue grows");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    await page.keyboard.type("Costs fall");
    await page.keyboard.press("Escape");
    await expect(overlay(page)).toHaveCount(0);
    const s = await stageBox(page);
    // the text area of the body placeholder, inside its frame
    const clip = { x: s.x + s.w * 0.07, y: s.y + s.h * 0.275, width: s.w * 0.6, height: s.h * 0.3 };
    const drawn = await inkBox(page, await page.screenshot({ clip }));
    await page.mouse.dblclick(s.x + s.w * 0.6, s.cy + s.h * 0.3);
    await expect(overlay(page)).toBeFocused();
    await overlay(page).evaluate((el) => (el.style.caretColor = "transparent"));
    const editing = await inkBox(page, await page.screenshot({ clip }));
    await page.screenshot({ path: "../../shots/P8-45-parity.png" });
    for (const k of ["x0", "y0", "x1", "y1"] as const) expect(Math.abs(editing[k] - drawn[k]), k).toBeLessThanOrEqual(2);
    errors.expectNone();
  });

  test("S-01: IME composition, Backspace, Ctrl+B on a selection and Ctrl+Z work in the editor", async ({ page }) => {
    const errors = trackErrors(page);
    await openShow(page);
    await editBody(page);
    await page.keyboard.type("Tokyo ");
    // an IME composition (Chromium's IME events), committed
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.imeSetComposition", { text: "とう", selectionStart: 2, selectionEnd: 2 });
    await cdp.send("Input.imeSetComposition", { text: "東京", selectionStart: 2, selectionEnd: 2 });
    await cdp.send("Input.insertText", { text: "東京" });
    await expect(overlay(page)).toHaveText("Tokyo 東京");
    await page.keyboard.press("Backspace");
    await expect(overlay(page)).toHaveText("Tokyo 東");
    await page.keyboard.press("Shift+Home");
    await page.keyboard.press("Control+b");
    await expect(overlay(page).locator("span").first()).toHaveCSS("font-weight", "700");
    await page.keyboard.press("End");
    await page.keyboard.type("!");
    await expect(overlay(page).locator("span")).toHaveCount(1);
    await page.keyboard.press("Control+z");
    await expect(overlay(page)).toHaveText("Tokyo 東");
    await page.keyboard.press("Escape");
    const slide2 = zipText(await saveViaBackstage(page), "ppt/slides/slide2.xml");
    expect(slide2).toMatch(/<a:rPr[^>]*\bb="1"[^>]*\/?>(<[^>]*>)*<a:t>Tokyo 東<\/a:t>/);
    errors.expectNone();
  });

  test("S-14: Insert › Text box arms drawing; a drag draws the box and the editor opens in it", async ({ page }) => {
    const errors = trackErrors(page);
    await openShow(page);
    await page.getByRole("tab", { name: "Insert" }).click();
    const button = page.getByRole("button", { name: "Text box" });
    await button.click();
    // nothing inserted yet: the tool is armed
    await expect(stage(page)).toHaveAttribute("data-draw-mode", "textBox");
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("dirty")).toHaveText("Saved");
    const s = await stageBox(page);
    const a = { x: s.x + s.w * 0.1, y: s.y + s.h * 0.7 };
    const b = { x: s.x + s.w * 0.5, y: s.y + s.h * 0.85 };
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
    await page.mouse.move(b.x, b.y, { steps: 4 });
    await page.mouse.up();
    await expect(stage(page)).not.toHaveAttribute("data-draw-mode", /.+/);
    await expect(overlay(page)).toBeFocused();
    await page.keyboard.type("Drawn box");
    await page.keyboard.press("Escape");
    const slide1 = zipText(await saveViaBackstage(page), "ppt/slides/slide1.xml");
    const sp = slide1.match(/<p:sp>(?:(?!<\/p:sp>)[\s\S])*Drawn box[\s\S]*?<\/p:sp>/)?.[0] ?? "";
    expect(sp).toContain('txBox="1"');
    // the dragged width (40 % of a 16:9 slide, 12192000 EMU); the height fits the one line (spAutoFit, P9-S1)
    const ext = /<a:ext cx="(\d+)" cy="(\d+)"/.exec(sp)!;
    expect(Number(ext[1]) / 12192000).toBeCloseTo(0.4, 1);
    expect(Number(ext[2])).toBeGreaterThan(300000);
    expect(Number(ext[2])).toBeLessThan(450000);
    expect(sp).toContain("<a:spAutoFit/>");
    errors.expectNone();
  });

  test("S-10: Combo › Stacked Area – Clustered Column draws the columns in front of the area (pixel probe)", async ({ page }) => {
    const errors = trackErrors(page);
    await openShow(page);
    await page.getByRole("tab", { name: "Insert" }).click();
    await page.getByRole("button", { name: "Chart", exact: true }).click();
    const dlg = page.getByTestId("insert-chart-dialog");
    await dlg.getByRole("option", { name: "Combo" }).click();
    await dlg.getByRole("radio", { name: "Stacked Area – Clustered Column" }).click();
    await dlg.getByRole("button", { name: "OK" }).click();
    await expect(page.getByRole("tab", { name: "Chart Design" })).toHaveAttribute("aria-selected", "true");
    await page.waitForTimeout(300);
    // pixels of each accent colour on the stage canvas
    const counts = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="editor-stage"] canvas')!;
      const d = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
      const accents: Record<string, [number, number, number]> = { a1: [0x44, 0x72, 0xc4], a2: [0xed, 0x7d, 0x31], a3: [0xa5, 0xa5, 0xa5] };
      const out: Record<string, number> = { a1: 0, a2: 0, a3: 0 };
      for (let i = 0; i < d.length; i += 4)
        for (const [k, c] of Object.entries(accents)) if (Math.abs(d[i]! - c[0]) + Math.abs(d[i + 1]! - c[1]) + Math.abs(d[i + 2]! - c[2]) < 12) out[k]!++;
      return out;
    });
    // the four grey columns (series 3) lie inside the stacked area: drawn behind it only the legend swatch would be grey
    expect(counts.a3).toBeGreaterThan(5000);
    expect(counts.a1).toBeGreaterThan(5000);
    await page.screenshot({ path: "../../shots/P8-45-combo.png" });
    errors.expectNone();
  });

  test("S-17: Transitions › Push starts From Bottom (saved dir=\"u\"), Split Vertical Out, Zoom In", async ({ page }) => {
    const errors = trackErrors(page);
    await openShow(page);
    await page.getByRole("tab", { name: "Transitions" }).click();
    const gallery = page.getByRole("group", { name: "Transitions", exact: true });
    await gallery.getByRole("button", { name: "Push", exact: true }).click();
    await page.getByRole("button", { name: "Effect Options" }).click();
    await expect(page.getByRole("menuitemradio", { name: "From Bottom" }).or(page.getByRole("menuitemcheckbox", { name: "From Bottom" }))).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");
    let slide1 = zipText(await saveViaBackstage(page), "ppt/slides/slide1.xml");
    expect(slide1).toMatch(/<p:push dir="u"\/>/);
    await gallery.getByRole("button", { name: "Split", exact: true }).click();
    slide1 = zipText(await saveViaBackstage(page), "ppt/slides/slide1.xml");
    expect(slide1).toMatch(/<p:split orient="vert"( dir="out")?\/>/);
    await gallery.getByRole("button", { name: "Zoom", exact: true }).click();
    slide1 = zipText(await saveViaBackstage(page), "ppt/slides/slide1.xml");
    expect(slide1).toMatch(/<p:zoom dir="in"\/>/);
    errors.expectNone();
  });
});
