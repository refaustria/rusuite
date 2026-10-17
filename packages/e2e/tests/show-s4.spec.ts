import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { openPrint, openViaBackstage, previewPages, saveViaBackstage, testdata, trackErrors } from "../support/common";
import { unzip } from "../support/zip";

// P9-S4: animations, transitions and media round 2 – Float In by paragraph, a custom motion path, a p14
// transition, Trim Video with a bookmark trigger, no transition when going back, triggers in the show.

const stage = (page: Page) => page.getByTestId("editor-stage");
const PITCH = testdata("pptx/provisional-25-pitch-deck.pptx");
const ANIM2 = testdata("pptx/provisional-35-animations2.pptx");

async function openFile(page: Page, file: string, slides: number) {
  await page.goto("show/");
  await stage(page).waitFor();
  await expect(page.getByTestId("dirty")).toHaveText("Saved");
  await openViaBackstage(page, file);
  await expect(page.getByTestId("slide-count")).toHaveText(`Slide 1 of ${slides}`);
}

async function shot(page: Page, name: string) {
  const dir = path.resolve(testdata("."), "../shots");
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `P9-S4-${name}.png`) });
}

/** Clicks the stage at a fraction of its size (selects the shape there). */
async function clickStage(page: Page, fx: number, fy: number) {
  const b = (await stage(page).boundingBox())!;
  await page.mouse.click(b.x + b.width * fx, b.y + b.height * fy);
}

async function goToSlide(page: Page, n: number) {
  await page.getByTestId("thumbnail").nth(n - 1).click();
  await expect(page.getByTestId("slide-count")).toHaveText(new RegExp(`^Slide ${n} of`));
}

async function saveXml(page: Page, slide: number): Promise<string> {
  const files = unzip(await saveViaBackstage(page));
  return files.get(`ppt/slides/slide${slide}.xml`)!.toString();
}

async function present(page: Page, current = false) {
  if (current) {
    await page.getByRole("tab", { name: "Slide Show" }).click();
    await page.getByRole("button", { name: "From current slide" }).click();
  } else await page.getByRole("button", { name: "Present" }).first().click();
  await expect(page.getByTestId("presenter")).toBeVisible();
}

test.describe("Show animations 2 (P9-S4)", () => {
  test("Float In by paragraph is saved as bldP build=p and the show reveals paragraph by paragraph", async ({ page }) => {
    const errors = trackErrors(page);
    await openFile(page, PITCH, 6);
    await goToSlide(page, 2);
    // the bullets of "Agenda"
    await clickStage(page, 0.3, 0.45);
    await expect(page.getByRole("tab", { name: "Shape Format" })).toBeVisible();
    await page.getByRole("tab", { name: "Animations" }).click();
    await page.getByRole("button", { name: "Animation styles" }).click();
    await page.getByRole("group", { name: "Entrance" }).getByRole("button", { name: "Float In" }).click();
    await page.getByRole("button", { name: "Effect options" }).click();
    await page.getByRole("menuitemradio", { name: "By Paragraph" }).click();
    await page.getByRole("button", { name: "Animation pane" }).click();
    await expect(page.getByTestId("animation-pane").getByTestId("anim-build")).toHaveCount(1);
    await shot(page, "float-by-paragraph");
    const xml = await saveXml(page, 2);
    expect(xml).toMatch(/<p:bldP spid="\d+" grpId="0" build="p"\/>/);
    expect(xml).toMatch(/presetID="42" presetClass="entr"/);
    expect(xml).toContain("<p:txEl><p:pRg st=\"0\" end=\"0\"/></p:txEl>");
    // the show: every 1st-level paragraph comes on its own click, with its sub-paragraphs
    await present(page, true);
    const slide = page.getByTestId("presenter").getByTestId("animated-slide");
    const hiddenParas = async () => ((await slide.getAttribute("data-hidden-paras")) ?? "").split(":")[1]?.split(",").length ?? 0;
    const before = await hiddenParas();
    expect(before).toBeGreaterThan(2);
    await page.keyboard.press("Space");
    await expect(page.getByTestId("presenter")).toHaveAttribute("data-step", "1");
    await expect.poll(hiddenParas).toBeLessThan(before);
    const after1 = await hiddenParas();
    await page.keyboard.press("Space");
    await expect(page.getByTestId("presenter")).toHaveAttribute("data-step", "2");
    await expect.poll(hiddenParas).toBeLessThan(after1);
    await page.keyboard.press("Escape");
    errors.expectNone();
  });

  test("a Custom Path drawn with the mouse is saved as p:animMotion and moves the shape in the show", async ({ page }) => {
    const errors = trackErrors(page);
    await openFile(page, PITCH, 6);
    // a rectangle in the middle of slide 1 (Insert › Shapes, Enter: inserted at once and selected)
    await page.getByRole("tab", { name: "Insert" }).click();
    await page.getByRole("button", { name: "Shapes" }).click();
    await page.getByRole("dialog", { name: "Shapes" }).getByRole("group", { name: "Rectangles" }).getByRole("button", { name: "Rectangle", exact: true }).press("Enter");
    await expect(page.getByRole("tab", { name: "Shape Format" })).toBeVisible();
    await page.getByRole("tab", { name: "Animations" }).click();
    await page.getByRole("button", { name: "Add animation" }).click();
    await page.getByRole("group", { name: "Motion Paths" }).getByRole("button", { name: "Custom Path" }).click();
    const draw = page.getByTestId("custom-path-draw");
    await expect(draw).toBeVisible();
    const b = (await stage(page).boundingBox())!;
    await page.mouse.move(b.x + b.width * 0.5, b.y + b.height * 0.5);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(b.x + b.width * (0.5 + i * 0.03), b.y + b.height * (0.5 + i * 0.015));
    await page.mouse.up();
    await expect(draw).toHaveCount(0);
    // the path shows on the stage with its handles; the pane lists it
    await page.getByRole("button", { name: "Animation pane" }).click();
    await expect(page.getByTestId("animation-pane").getByTestId("anim-row").last()).toContainText("Custom Path");
    await shot(page, "custom-path");
    const xml = await saveXml(page, 1);
    const m = /<p:animMotion origin="layout" path="(M 0 0 L [^"]+ E)"/.exec(xml);
    expect(m, xml).not.toBeNull();
    expect(xml).toMatch(/presetID="0" presetClass="path"/);
    // the show: after the click the shape rests at the path's end
    await present(page);
    const slide = page.getByTestId("presenter").getByTestId("animated-slide");
    await expect(slide).not.toHaveAttribute("data-moved", /.+/);
    await page.keyboard.press("Space");
    await expect(slide).toHaveAttribute("data-moved", /^\d+:0\.2\d+,0\.1\d+$/);
    await page.keyboard.press("Escape");
    errors.expectNone();
  });

  test("Cube (p14) is saved in mc:AlternateContent with a fade fallback and plays in the show", async ({ page }) => {
    const errors = trackErrors(page);
    await openFile(page, PITCH, 6);
    await goToSlide(page, 2);
    await page.getByRole("tab", { name: "Transitions" }).click();
    await page.getByRole("button", { name: "More transitions" }).click();
    await page.getByTestId("transition-gallery").getByRole("button", { name: "Cube", exact: true }).click();
    await page.getByRole("button", { name: "Effect options" }).click();
    await page.getByRole("menuitemradio", { name: "From Bottom" }).click();
    await shot(page, "cube");
    const xml = await saveXml(page, 2);
    expect(xml).toMatch(
      /<mc:AlternateContent[^>]*><mc:Choice [^>]*Requires="p14"><p:transition spd="slow" p14:dur="1000"><p14:prism dir="u"\/><\/p:transition><\/mc:Choice><mc:Fallback><p:transition spd="slow"><p:fade\/><\/p:transition><\/mc:Fallback><\/mc:AlternateContent>/,
    );
    await goToSlide(page, 1);
    await present(page);
    await page.keyboard.press("ArrowRight");
    const show = page.getByTestId("presenter").getByTestId("show-slide");
    await expect(show).toHaveAttribute("data-transition", "cube");
    await expect(show).not.toHaveAttribute("data-transition", /.+/, { timeout: 3000 });
    await page.keyboard.press("Escape");
    errors.expectNone();
  });

  test("Trim Video and a bookmark trigger are saved as p14:trim, p14:bmk and an onMediaBookmark sequence", async ({ page }) => {
    const errors = trackErrors(page);
    await openFile(page, ANIM2, 4);
    await goToSlide(page, 4);
    // the clip (2–14 cm × 2–11 cm of 28 × 15.75 cm)
    await clickStage(page, 8 / 28, 6.5 / 15.75);
    await expect(page.getByRole("tab", { name: "Playback" })).toBeVisible();
    await page.getByRole("tab", { name: "Playback" }).click();
    await page.getByRole("button", { name: "Trim Video" }).click();
    const dialog = page.getByTestId("trim-dialog");
    await expect(dialog.getByTestId("trim-duration")).not.toHaveText("Duration: 00:00.000");
    await dialog.getByRole("textbox", { name: "Start Time" }).fill("00:00.800");
    await dialog.getByRole("textbox", { name: "Start Time" }).press("Tab");
    await dialog.getByRole("textbox", { name: "End Time" }).fill("00:02.000");
    await dialog.getByRole("textbox", { name: "End Time" }).press("Tab");
    await shot(page, "trim");
    await dialog.getByRole("button", { name: "OK" }).click();
    await expect(dialog).toHaveCount(0);
    // a second bookmark at 1.5 s
    await page.getByRole("textbox", { name: "Bookmark time (mm:ss.fff)" }).fill("00:01.500");
    await page.getByRole("button", { name: "Add Bookmark" }).click();
    // the text box leaves at Bookmark 2 instead of Bookmark 1
    await clickStage(page, 21 / 28, 5 / 15.75);
    await page.getByRole("tab", { name: "Animations" }).click();
    await page.getByRole("button", { name: "Trigger" }).click();
    await page.getByRole("menuitemradio", { name: "Bookmark 2" }).click();
    const xml = await saveXml(page, 4);
    expect(xml).toMatch(/<p14:trim st="800" end="\d+"\/>/);
    expect(xml).toContain('<p14:bmk name="Bookmark 2" time="1500"/>');
    expect(xml).toMatch(/p14:bmkName="Bookmark 2"><p:stCondLst><p:cond evt="onMediaBookmark" delay="0">/);
    expect(xml).toContain('<p14:fade in="250" out="250"/>');
    errors.expectNone();
  });

  test("going back shows the slide at once; a jump forward plays the transition", async ({ page }) => {
    const errors = trackErrors(page);
    await openFile(page, ANIM2, 4);
    await present(page);
    const show = page.getByTestId("presenter").getByTestId("show-slide");
    // number + Enter jumps forward to slide 3: Vortex plays
    await page.keyboard.press("3");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("presenter-counter")).toHaveText("3 / 4");
    await expect(show).toHaveAttribute("data-transition", "vortex");
    // back to slide 2: no transition (Cube would play going forward)
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByTestId("presenter-counter")).toHaveText("2 / 4");
    await expect(show).toHaveAttribute("data-visit-forward", "0");
    await expect(show).not.toHaveAttribute("data-transition", /.+/);
    await shot(page, "back-no-transition");
    await page.keyboard.press("Escape");
    errors.expectNone();
  });

  test("a click on the trigger shape plays the triggered Spin without advancing", async ({ page }) => {
    const errors = trackErrors(page);
    await openFile(page, ANIM2, 4);
    await goToSlide(page, 3);
    await present(page, true);
    const presenter = page.getByTestId("presenter");
    const trigger = presenter.getByTestId("show-trigger");
    await expect(trigger).toHaveCount(1);
    await trigger.click();
    await expect(presenter).toHaveAttribute("data-fired", /^click:\d+$/);
    await expect(presenter).toHaveAttribute("data-step", "0");
    await expect(page.getByTestId("presenter-counter")).toHaveText("3 / 4");
    await page.keyboard.press("Escape");
    errors.expectNone();
  });

  test("print shows every slide as in the Normal view: animated shapes printed, the clip as its poster frame", async ({ page }) => {
    const errors = trackErrors(page);
    await openFile(page, ANIM2, 4);
    await openPrint(page);
    expect(await previewPages(page)).toBe(4);
    // the slide pictures of the preview: four images, none empty (the exit's text box and the clip's poster included)
    const html = (await page.getByTestId("print-preview").getAttribute("srcdoc")) ?? "";
    const images = [...html.matchAll(/<img[^>]+src="(data:image\/png;base64,[^"]+)"/g)].map((m) => m[1]!);
    expect(images).toHaveLength(4);
    for (const src of images) expect(src.length).toBeGreaterThan(1000);
    await shot(page, "print");
    // the preview frame is sandboxed (no scripts): Chromium reports that as a console error
    expect(errors.list.filter((e) => !e.includes("sandboxed"))).toEqual([]);
  });
});
