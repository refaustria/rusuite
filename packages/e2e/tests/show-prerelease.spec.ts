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
    console.log(JSON.stringify({ drawn, editing }));
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
});
