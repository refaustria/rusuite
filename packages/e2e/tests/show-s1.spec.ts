import { expect, test, type Page } from "@playwright/test";
import { openPrint, saveViaBackstage, trackErrors } from "../support/common";
import { unzip, zipText } from "../support/zip";

// P9-S1: rich in-place text editing (levels, Shift+Enter, run formatting), autofit text boxes,
// master text and prompt text.

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

/** The `p:sp` of a slide's XML that holds `text`. */
const spWith = (xml: string, text: string) => xml.match(new RegExp(`<p:sp>(?:(?!</p:sp>)[\\s\\S])*${text}[\\s\\S]*?</p:sp>`))?.[0] ?? "";

/** Pixel statistics of a PNG data URL (decoded in a blank page): dark pixels and red pixels. */
async function pixels(page: Page, src: string) {
  const blank = await page.context().newPage();
  const r = await blank.evaluate(async (url) => {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext("2d")!;
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let dark = 0;
    let red = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i]! + d[i + 1]! + d[i + 2]! < 300) dark++;
      if (d[i]! > 150 && d[i + 1]! < 70 && d[i + 2]! < 70) red++;
    }
    return { dark, red };
  }, src);
  await blank.close();
  return r;
}

/** The slide images of the print preview (data URLs). */
async function previewImages(page: Page): Promise<string[]> {
  const html = (await page.getByTestId("print-preview").getAttribute("srcdoc")) ?? "";
  return [...html.matchAll(/<img class="rs-show-slide[^"]*"[^>]*src="([^"]+)"/g)].map((m) => m[1]!.replace(/&amp;/g, "&"));
}

test.describe("Show rich text (P9-S1)", () => {
  test("two paragraphs with Tab and Shift+Enter: the saved pptx has the level and a:br, and reopens with them", async ({ page }) => {
    const errors = trackErrors(page);
    await openShow(page);
    await editBody(page);
    await page.keyboard.type("First line");
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.type("same paragraph");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    await page.keyboard.type("Second level");
    // shown while editing: two paragraphs, the second at level 2
    const levels = await overlay(page).evaluate((el) => [...el.querySelectorAll<HTMLElement>("[data-p]")].map((p) => p.dataset.level));
    expect(levels).toEqual(["0", "1"]);
    await page.keyboard.press("Escape");
    const pptx = await saveViaBackstage(page);
    const sp = spWith(zipText(pptx, "ppt/slides/slide2.xml"), "Second level");
    expect(sp).toMatch(/<a:t>First line<\/a:t><\/a:r><a:br\/?>(<\/a:br>)?<a:r>(<a:rPr[^>]*\/>)?<a:t>same paragraph<\/a:t>/);
    expect(sp).toMatch(/<a:pPr[^>]*lvl="1"[^>]*\/?>(?:(?!<\/a:p>)[\s\S])*Second level/);
    expect(sp.match(/<a:p>/g)).toHaveLength(2);
    await page.screenshot({ path: "../../shots/P9-S1-levels.png" });
    // reopen the saved file: the break and the level are still there
    await page.getByRole("tab", { name: "File", exact: true }).click();
    const chooser = page.waitForEvent("filechooser");
    await page.getByTestId("backstage").getByRole("button", { name: /^Open/ }).click();
    await (await chooser).setFiles({ name: "s1-levels.pptx", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", buffer: pptx });
    await expect(page.getByTestId("doc-name")).toHaveText("s1-levels.pptx");
    await page.getByTestId("thumbnail").nth(1).click();
    const s = await stageBox(page);
    await page.mouse.dblclick(s.cx, s.cy + s.h * 0.0);
    await expect(overlay(page)).toBeFocused();
    const paras = await overlay(page).evaluate((el) => [...el.querySelectorAll<HTMLElement>("[data-p]")].map((p) => [p.dataset.level, p.textContent]));
    expect(paras).toEqual([["0", "First line\nsame paragraph"], ["1", "Second level"]]);
    errors.expectNone();
  });

  test("bold a word in the middle of a paragraph in place: only that run is bold", async ({ page }) => {
    const errors = trackErrors(page);
    await openShow(page);
    await editBody(page);
    await page.keyboard.type("alpha beta gamma");
    await page.keyboard.press("Home");
    for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowRight");
    for (let i = 0; i < 4; i++) await page.keyboard.press("Shift+ArrowRight");
    await page.keyboard.press("Control+b");
    // shown at once in the editor
    await expect(overlay(page).locator("span", { hasText: /^beta$/ })).toHaveCSS("font-weight", "700");
    await expect(overlay(page).locator("span", { hasText: /^alpha $/ })).toHaveCSS("font-weight", "400");
    // typing goes on in the same session
    await page.keyboard.press("End");
    await page.keyboard.type("!");
    await page.keyboard.press("Escape");
    const sp = spWith(zipText(await saveViaBackstage(page), "ppt/slides/slide2.xml"), "gamma");
    expect(sp).toMatch(/<a:r>(<a:rPr(?![^>]*\bb="1")[^>]*\/>)?<a:t>alpha <\/a:t><\/a:r><a:r><a:rPr[^>]*\bb="1"[^>]*\/?>(<[^>]*>)*<a:t>beta<\/a:t>/);
    expect(sp).toMatch(/<a:t> gamma!<\/a:t>/);
    errors.expectNone();
  });

  test("a new text box grows while typing: wider from a click, taller from a drag; spAutoFit saved", async ({ page }) => {
    const errors = trackErrors(page);
    await openShow(page);
    const s = await stageBox(page);
    // a click: one line 2.5 cm wide that grows in width
    await page.getByRole("tab", { name: "Insert" }).click();
    await page.getByRole("button", { name: "Text box" }).click();
    await page.mouse.click(s.x + s.w * 0.05, s.y + s.h * 0.05);
    await expect(overlay(page)).toBeFocused();
    const box = page.getByTestId("text-overlay-box");
    const w0 = (await box.boundingBox())!.width;
    await page.keyboard.type("A line that is much wider than the box");
    expect((await box.boundingBox())!.width).toBeGreaterThan(w0 * 2);
    await page.keyboard.press("Escape");
    // a drag: the dragged width, the height grows with the wrapped text
    await page.getByRole("tab", { name: "Insert" }).click();
    await page.getByRole("button", { name: "Text box" }).click();
    const a = { x: s.x + s.w * 0.1, y: s.y + s.h * 0.6 };
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(a.x + s.w * 0.1, a.y + 20, { steps: 4 });
    await page.mouse.move(a.x + s.w * 0.2, a.y + 40, { steps: 4 });
    await page.mouse.up();
    await expect(overlay(page)).toBeFocused();
    const h0 = (await box.boundingBox())!.height;
    await page.keyboard.type("Several words that wrap onto more lines in the narrow box");
    const h1 = (await box.boundingBox())!.height;
    expect(h1).toBeGreaterThan(h0 * 2);
    await page.screenshot({ path: "../../shots/P9-S1-textbox.png" });
    await page.keyboard.press("Escape");
    const slide1 = zipText(await saveViaBackstage(page), "ppt/slides/slide1.xml");
    const wide = spWith(slide1, "much wider");
    expect(wide).toContain('wrap="none"');
    expect(wide).toContain("<a:spAutoFit/>");
    expect(Number(/<a:ext cx="(\d+)"/.exec(wide)![1])).toBeGreaterThan(900000 * 2);
    const tall = spWith(slide1, "Several words");
    expect(tall).toContain('wrap="square"');
    expect(Number(/<a:ext cx="\d+" cy="(\d+)"/.exec(tall)![1])).toBeGreaterThan(369332 * 2);
    errors.expectNone();
  });

  test("Slide Master: the master title's colour recolours the slides' titles", async ({ page }) => {
    const errors = trackErrors(page);
    await openShow(page);
    const s = await stageBox(page);
    await page.mouse.dblclick(s.cx, s.cy - s.h * 0.12);
    await expect(overlay(page)).toBeFocused();
    await page.keyboard.type("Quarterly review");
    await page.keyboard.press("Escape");
    await page.getByRole("tab", { name: "View" }).click();
    await page.getByRole("button", { name: "Slide Master" }).click();
    await page.getByTestId("master-panel").getByRole("button", { name: "Slide master" }).click();
    await expect(stage(page)).toHaveAttribute("data-master-view", "master");
    // the master's title placeholder (top of the slide)
    await page.mouse.click(s.cx, s.y + s.h * 0.15);
    await page.getByRole("tab", { name: "Home" }).click();
    await page.getByRole("button", { name: "Text color" }).click();
    await page.getByRole("button", { name: "Standard color C00000" }).click();
    await expect(page.getByTestId("dirty")).toHaveText("Modified");
    await page.getByRole("tab", { name: "Slide Master" }).click();
    await page.getByRole("button", { name: "Close Master View" }).click();
    await expect(stage(page)).not.toHaveAttribute("data-master-view", /.+/);
    await page.screenshot({ path: "../../shots/P9-S1-master-title.png" });
    const pptx = unzip(await saveViaBackstage(page));
    const master = pptx.get("ppt/slideMasters/slideMaster1.xml")!.toString();
    expect(master.slice(master.indexOf("<p:titleStyle>"), master.indexOf("</p:titleStyle>"))).toContain('<a:srgbClr val="C00000"/>');
    // the slide's own title states no colour: it inherits
    expect(spWith(pptx.get("ppt/slides/slide1.xml")!.toString(), "Quarterly review")).not.toContain("C00000");
    errors.expectNone();
    // the slide's title is drawn red (print preview image of slide 1)
    await openPrint(page);
    const [img] = await previewImages(page);
    expect((await pixels(page, img!)).red).toBeGreaterThan(200);
  });

  test("prompt text shows on the stage and in the editor, never in the print preview / export", async ({ page }) => {
    const errors = trackErrors(page);
    await openShow(page);
    // the empty title slide: an editor click shows the prompt under the caret
    const s = await stageBox(page);
    await page.mouse.dblclick(s.cx, s.cy - s.h * 0.12);
    await expect(overlay(page)).toBeFocused();
    await expect(page.getByTestId("text-overlay-prompt")).toHaveText("Click to add title");
    await page.keyboard.type("x");
    await expect(page.getByTestId("text-overlay-prompt")).toHaveCount(0);
    await page.keyboard.press("Backspace");
    await expect(page.getByTestId("text-overlay-prompt")).toHaveText("Click to add title");
    await page.keyboard.press("Escape");
    errors.expectNone();
    // (the print preview's sandboxed frame logs a blocked-script message of its own)
    await openPrint(page);
    const imgs = await previewImages(page);
    expect(imgs.length).toBeGreaterThan(0);
    // an empty title slide prints blank: no prompt text
    expect((await pixels(page, imgs[0]!)).dark).toBe(0);
    expect(await page.getByTestId("print-preview").getAttribute("srcdoc")).not.toContain("Click to add");
  });
});
