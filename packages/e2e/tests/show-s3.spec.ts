import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { openViaBackstage, saveViaBackstage, testdata, trackErrors } from "../support/common";
import { unzip } from "../support/zip";

// P9-S3: rich Outline View, custom shows, Format Background › Apply to All, master / layout guides and the
// window state saved with the file.

const stage = (page: Page) => page.getByTestId("editor-stage");
const TESTDATA = testdata("pptx");

async function openShow(page: Page) {
  await page.goto("show/");
  await stage(page).waitFor();
  await expect(page.getByTestId("dirty")).toHaveText("Saved");
}

async function shot(page: Page, name: string) {
  const dir = path.resolve(testdata("."), "../shots");
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `P9-S3-${name}.png`) });
}

/** Saves, writes the file next to the test's output and opens it again. */
async function saveAndReopen(page: Page, file: string): Promise<Map<string, Buffer>> {
  const pptx = await saveViaBackstage(page);
  fs.writeFileSync(file, pptx);
  await openViaBackstage(page, file);
  await expect(page.getByTestId("dirty")).toHaveText("Saved");
  return unzip(pptx);
}

/** The canvas pixel (RGB) at a page point. */
async function pixelAt(page: Page, x: number, y: number): Promise<[number, number, number]> {
  return page.evaluate(({ x, y }) => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="editor-stage"] canvas')!;
    const r = canvas.getBoundingClientRect();
    const k = canvas.width / r.width;
    const d = canvas.getContext("2d")!.getImageData(Math.round((x - r.left) * k), Math.round((y - r.top) * k), 1, 1).data;
    return [d[0]!, d[1]!, d[2]!] as [number, number, number];
  }, { x, y });
}

test.describe("Show views and design (P9-S3)", () => {
  test("Outline View: Enter after a title makes a slide, Tab on its title merges it into the previous slide", async ({ page }) => {
    const errors = trackErrors(page);
    await openShow(page);
    await page.getByRole("tab", { name: "View" }).click();
    await page.getByRole("button", { name: "Outline View" }).click();
    const outline = page.getByTestId("outline-text");
    await expect(outline).toHaveCount(1);
    await outline.first().click();
    await page.keyboard.type("Plan");
    // Enter after a title: a new slide at once
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("outline-slide")).toHaveCount(2);
    await page.keyboard.type("Budget");
    await page.keyboard.press("Control+b");
    await shot(page, "outline-two-slides");
    // Tab on the second slide's title: it joins the first slide's body, the slide goes (one undo step)
    await page.keyboard.press("Home");
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("outline-slide")).toHaveCount(1);
    const lines = page.getByTestId("outline-slide").first().locator("[data-depth]");
    await expect(lines).toHaveCount(2);
    await expect(lines.nth(0)).toHaveAttribute("data-depth", "0");
    await expect(lines.nth(0)).toHaveText("Plan");
    await expect(lines.nth(1)).toHaveAttribute("data-depth", "1");
    await expect(lines.nth(1)).toHaveText("Budget");
    await shot(page, "outline-merged");
    const saved = unzip(await saveViaBackstage(page));
    const xml = saved.get("ppt/slides/slide1.xml")!.toString();
    expect([...saved.keys()].filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))).toHaveLength(1);
    expect(xml).toContain("Plan");
    expect(xml).toContain("Budget");
    await page.keyboard.press("Escape");
    // undo brings the slide back
    await page.getByRole("tab", { name: "Home" }).click();
    await page.keyboard.press("Control+z");
    await expect(page.getByTestId("outline-slide")).toHaveCount(2);
    errors.expectNone();
  });

  test("a custom show defined from slides 3 and 5 runs only those slides", async ({ page }) => {
    const errors = trackErrors(page);
    await openShow(page);
    await openViaBackstage(page, path.join(TESTDATA, "provisional-22-ten-slides-mixed.pptx"));
    await expect(page.getByTestId("slide-count")).toHaveText(/of 10/);
    await page.getByRole("tab", { name: "Slide Show" }).click();
    await page.getByRole("button", { name: "Custom Slide Show" }).click();
    await page.getByRole("menuitem", { name: "Custom Shows…" }).click();
    await page.getByRole("button", { name: "New…" }).click();
    await page.getByRole("textbox", { name: "Slide show name:" }).fill("Highlights");
    const boxes = page.getByTestId("define-custom-show").locator('input[type="checkbox"]');
    await boxes.nth(2).check();
    await boxes.nth(4).check();
    await page.getByRole("button", { name: "Add »" }).click();
    await expect(page.getByTestId("custom-show-slides").getByRole("option")).toHaveCount(2);
    await shot(page, "define-custom-show");
    await page.getByRole("button", { name: "OK" }).click();
    await expect(page.getByTestId("custom-show-list").getByRole("option", { name: "Highlights" })).toBeVisible();
    await page.getByRole("button", { name: "Show", exact: true }).click();
    const counter = page.getByTestId("presenter-counter");
    await expect(counter).toHaveText("1 / 2");
    await page.keyboard.press("ArrowRight");
    await expect(counter).toHaveText("2 / 2");
    await shot(page, "custom-show-running");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("presenter")).toHaveCount(0);
    // saved as p:custShowLst with the slides' relationships
    const pres = unzip(await saveViaBackstage(page)).get("ppt/presentation.xml")!.toString();
    expect(pres).toMatch(/<p:custShow name="Highlights" id="0"><p:sldLst><p:sld r:id="rId4"\/><p:sld r:id="rId6"\/><\/p:sldLst><\/p:custShow>/);
    errors.expectNone();
  });

  test("a gradient background applied to all goes to the master and shows on a new slide", async ({ page }) => {
    const errors = trackErrors(page);
    await openShow(page);
    await page.getByRole("tab", { name: "Design" }).click();
    await page.getByRole("button", { name: "Format Background" }).click();
    await page.getByTestId("bg-kind-gradient").check();
    await page.getByTestId("bg-preset-medium-accent2").click();
    await page.getByRole("button", { name: "Apply to all" }).click();
    await page.getByRole("tab", { name: "Home" }).click();
    await page.getByRole("button", { name: "New Slide" }).first().click();
    await expect(page.getByTestId("slide-count")).toHaveText("Slide 2 of 2");
    const b = (await stage(page).boundingBox())!;
    // the new slide is drawn with the gradient: lighter at the top than at the bottom, in the accent's hue
    const top = await pixelAt(page, b.x + 6, b.y + 6);
    const bottom = await pixelAt(page, b.x + 6, b.y + b.height - 6);
    expect(top[0] + top[1] + top[2]).toBeGreaterThan(bottom[0] + bottom[1] + bottom[2] + 60);
    expect(bottom[0]).toBeGreaterThan(bottom[2]);
    await shot(page, "gradient-new-slide");
    const files = unzip(await saveViaBackstage(page));
    const master = files.get("ppt/slideMasters/slideMaster1.xml")!.toString();
    expect(master).toMatch(/<p:bg><p:bgPr><a:gradFill[^>]*><a:gsLst>(<a:gs pos="\d+"><a:schemeClr val="accent2".*?<\/a:gs>){3}<\/a:gsLst><a:lin ang="5400000"/);
    for (const n of ["ppt/slides/slide1.xml", "ppt/slides/slide2.xml"]) expect(files.get(n)!.toString()).not.toContain("<p:bg>");
    errors.expectNone();
  });

  test("a guide added on a layout is saved in p15:sldGuideLst and shown after reopening", async ({ page }, info) => {
    const errors = trackErrors(page);
    await openShow(page);
    await page.getByRole("tab", { name: "View" }).click();
    await page.getByRole("button", { name: "Slide Master" }).click();
    await expect(stage(page)).toHaveAttribute("data-master-view", "title");
    const b = (await stage(page).boundingBox())!;
    await page.mouse.click(b.x + b.width * 0.05, b.y + b.height * 0.95, { button: "right" });
    await page.getByRole("menuitem", { name: "Add Vertical Guide" }).click();
    await expect(stage(page)).toHaveAttribute("data-drawing-guides", "1");
    await shot(page, "layout-guide");
    await page.getByRole("button", { name: "Close Master View" }).click();
    // on the slide: the layout's guide, drawn but not the slide's own
    await expect(stage(page)).toHaveAttribute("data-drawing-guides", "0");
    await expect(stage(page)).toHaveAttribute("data-design-guides", "1");
    const files = await saveAndReopen(page, info.outputPath("guides.pptx"));
    const layouts = [...files].filter(([n]) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(n)).map(([, x]) => x.toString());
    const withGuide = layouts.filter((x) => x.includes("<p15:sldGuideLst"));
    expect(withGuide).toHaveLength(1);
    expect(withGuide[0]).toContain('{DCECCB84-F9BA-43D5-87BE-67443E8EF086}');
    expect(withGuide[0]).toMatch(/<p15:guide id="1" pos="3840" userDrawn="1"><p15:clr><a:srgbClr val="FBAE40"\/><\/p15:clr><\/p15:guide>/);
    await expect(stage(page)).toHaveAttribute("data-design-guides", "1");
    await page.getByRole("tab", { name: "View" }).click();
    await page.getByRole("button", { name: "Slide Master" }).click();
    await expect(stage(page)).toHaveAttribute("data-drawing-guides", "1");
    errors.expectNone();
  });

  test("the last view and the sorter zoom come back after save and reopen", async ({ page }, info) => {
    const errors = trackErrors(page);
    await openShow(page);
    await page.getByRole("button", { name: "New Slide" }).first().click();
    await page.getByRole("tab", { name: "View" }).click();
    await page.getByRole("button", { name: "Slide Sorter" }).click();
    await expect(page.getByTestId("slide-sorter")).toBeVisible();
    await page.getByTestId("sorter-zoom").fill("60");
    await expect(page.getByTestId("sorter-zoom")).toHaveValue("60");
    const files = await saveAndReopen(page, info.outputPath("view.pptx"));
    const view = files.get("ppt/viewProps.xml")!.toString();
    expect(view).toContain('lastView="sldSorterView"');
    expect(view).toContain('<p:sorterViewPr><p:cViewPr><p:scale><a:sx n="60" d="100"/>');
    // reopened: Slide Sorter at 60 %
    await expect(page.getByTestId("slide-sorter")).toBeVisible();
    await expect(page.getByTestId("sorter-zoom")).toHaveValue("60");
    await shot(page, "sorter-restored");
    // the Normal view zoom too
    await page.getByRole("button", { name: "Normal" }).click();
    await page.getByRole("combobox", { name: "Zoom" }).selectOption("1.5");
    const again = await saveAndReopen(page, info.outputPath("zoom.pptx"));
    expect(again.get("ppt/viewProps.xml")!.toString()).toMatch(/<p:slideViewPr><p:cSldViewPr[^>]*><p:cViewPr><p:scale><a:sx n="150" d="100"\/>/);
    await expect(page.getByRole("combobox", { name: "Zoom" })).toHaveValue("1.5");
    errors.expectNone();
  });

  test("the reference deck opens with its custom show, guides and backgrounds", async ({ page }) => {
    const errors = trackErrors(page);
    await openShow(page);
    await openViaBackstage(page, path.join(TESTDATA, "provisional-34-views-design.pptx"));
    await expect(page.getByTestId("slide-count")).toHaveText(/of 4/);
    await page.getByRole("tab", { name: "Slide Show" }).click();
    await page.getByRole("button", { name: "Custom Slide Show" }).click();
    await expect(page.getByRole("menuitem", { name: "Short" })).toBeVisible();
    await page.keyboard.press("Escape");
    // F5 runs the custom show Set Up Show names
    await page.keyboard.press("F5");
    await expect(page.getByTestId("presenter-counter")).toHaveText("1 / 2");
    await page.keyboard.press("Escape");
    await page.getByRole("tab", { name: "View" }).click();
    await page.getByRole("checkbox", { name: "Guides" }).check();
    await expect(stage(page)).toHaveAttribute("data-design-guides", /[1-9]/);
    await shot(page, "reference-deck");
    errors.expectNone();
  });
});
