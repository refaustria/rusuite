import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { downloadBuffer, openViaBackstage, saveViaBackstage, testdata, trackErrors } from "../support/common";
import { unzip } from "../support/zip";

// P9-S5: presenter view, rehearsal and reuse round 2 – notes edited in the presenter view, Rehearse Timings
// saved as advTm and replayed, Reuse Slides with the source master, a .thmx theme, kept ink, Save Current
// Theme, a picture into a picture placeholder.

const stage = (page: Page) => page.getByTestId("editor-stage");
const BASIC = testdata("pptx/provisional-basic.pptx");
const PITCH = testdata("pptx/provisional-25-pitch-deck.pptx");
const THEME = testdata("pptx/rusuite-harbor.thmx");
const PNG = path.resolve(testdata("."), "../apps/portal/logos/rusuite.png");

async function openShow(page: Page) {
  await page.goto("show/");
  await stage(page).waitFor();
  await expect(page.getByTestId("dirty")).toHaveText("Saved");
}

async function openFile(page: Page, file: string, slides: number) {
  await openShow(page);
  await openViaBackstage(page, file);
  await expect(page.getByTestId("slide-count")).toHaveText(`Slide 1 of ${slides}`);
}

async function shot(page: Page, name: string) {
  const dir = path.resolve(testdata("."), "../shots");
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `P9-S5-${name}.png`) });
}

const text = (files: Map<string, Buffer>, name: string) => files.get(name)?.toString() ?? "";

test.describe("Show presenter, rehearsal and reuse (P9-S5)", () => {
  test("notes edited in the presenter view are saved in the deck", async ({ page, context }) => {
    const errors = trackErrors(page);
    await openFile(page, BASIC, 3);
    const popup = context.waitForEvent("page");
    await page.getByRole("tab", { name: "View" }).click();
    await page.getByRole("button", { name: "Presenter view" }).click();
    const audience = await popup;
    const console = page.getByTestId("presenter-console");
    await expect(page.getByTestId("console-counter")).toHaveText("Slide 1 of 3");
    await expect(audience.getByTestId("presenter-counter")).toHaveText("1 / 3");
    const notes = page.getByTestId("console-notes");
    await notes.click();
    await page.keyboard.type("Mention the demo next");
    // typing in the notes does not drive the show ("n" is Next in the show)
    await expect(page.getByTestId("console-counter")).toHaveText("Slide 1 of 3");
    await shot(page, "presenter-notes");
    await console.getByRole("button", { name: "Next", exact: true }).click();
    await expect(audience.getByTestId("presenter-counter")).toHaveText("2 / 3");
    // pause the timer, white screen on the audience window
    await page.getByTestId("timer-pause").click();
    await expect(page.getByTestId("presenter-timer")).toHaveAttribute("data-paused", "true");
    await console.getByRole("button", { name: "White screen" }).click();
    await expect(audience.getByTestId("presenter")).toHaveAttribute("data-blank", "white");
    await console.getByRole("button", { name: "End show" }).click();
    await expect(console).toHaveCount(0);
    const files = unzip(await saveViaBackstage(page));
    const notesXml = [...files.keys()].filter((k) => k.startsWith("ppt/notesSlides/")).map((k) => text(files, k)).join("\n");
    expect(notesXml).toContain("Mention the demo next");
    errors.expectNone();
  });

  test("Rehearse Timings saves advTm per slide and Use Timings advances the show by itself", async ({ page }) => {
    const errors = trackErrors(page);
    // The page's clock is ours: the rehearsal measures exactly 1 s per slide however slow the machine is (P9-Q1).
    await page.clock.install();
    await openFile(page, BASIC, 3);
    await page.getByRole("tab", { name: "Slide Show" }).click();
    await page.getByRole("button", { name: "Rehearse Timings" }).click();
    const bar = page.getByTestId("rehearse-bar");
    await expect(bar).toBeVisible();
    await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
    // Repeat restarts the first slide's time at the paused clock.
    await bar.getByRole("button", { name: "Repeat this slide" }).click();
    await expect(page.getByTestId("rehearse-slide-time")).toHaveText("00:00");
    for (let i = 1; i <= 3; i++) {
      await page.clock.runFor(1000);
      await expect(page.getByTestId("rehearse-slide-time")).toHaveText("00:01");
      await page.keyboard.press("ArrowRight");
      if (i < 3) await expect(page.getByTestId("presenter-counter")).toHaveText(`${i + 1} / 3`);
    }
    await page.clock.resume();
    const ask = page.getByTestId("rehearse-confirm");
    await expect(ask).toContainText("Do you want to keep the new slide timings?");
    await shot(page, "rehearse-keep");
    await ask.getByRole("button", { name: "Yes" }).click();
    await expect(page.getByTestId("presenter")).toHaveCount(0);
    await expect(page.getByRole("checkbox", { name: "Use Timings" })).toBeChecked();
    const files = unzip(await saveViaBackstage(page));
    for (let n = 1; n <= 3; n++) expect(text(files, `ppt/slides/slide${n}.xml`)).toMatch(/<p:transition[^>]* advTm="1000"/);
    // the show advances by itself
    await page.keyboard.press("F5");
    await expect(page.getByTestId("presenter-counter")).toHaveText("1 / 3");
    await expect(page.getByTestId("presenter-counter")).toHaveText("2 / 3", { timeout: 4000 });
    await expect(page.getByTestId("presenter-counter")).toHaveText("3 / 3", { timeout: 4000 });
    await page.keyboard.press("Escape");
    errors.expectNone();
  });

  test("Reuse Slides with Keep source formatting brings the source master and theme (two masters)", async ({ page }) => {
    const errors = trackErrors(page);
    await openShow(page);
    await page.getByRole("button", { name: "Slide layouts" }).first().click();
    await page.getByTestId("reuse-slides").click();
    const pane = page.getByTestId("reuse-pane");
    await pane.getByTestId("reuse-input").setInputFiles(PITCH);
    await expect(pane.getByTestId("reuse-slide-2")).toBeVisible();
    await pane.getByRole("checkbox", { name: "Keep source formatting" }).check();
    await pane.getByTestId("reuse-slide-2").click();
    await expect(page.getByTestId("slide-count")).toHaveText("Slide 2 of 2");
    await pane.getByTestId("reuse-slide-3").click();
    await expect(page.getByTestId("slide-count")).toHaveText("Slide 3 of 3");
    await shot(page, "reuse-keep-source");
    const files = unzip(await saveViaBackstage(page));
    const pres = text(files, "ppt/presentation.xml");
    expect(pres.match(/<p:sldMasterId /g)).toHaveLength(2);
    expect(files.has("ppt/slideMasters/slideMaster2.xml")).toBe(true);
    expect(files.has("ppt/theme/theme2.xml")).toBe(true);
    // the reused slides use the second master's layouts
    const rels = text(files, "ppt/slides/_rels/slide2.xml.rels");
    const layout = /slideLayouts\/(slideLayout\d+\.xml)/.exec(rels)![1]!;
    expect(text(files, `ppt/slideLayouts/_rels/${layout}.rels`)).toContain("slideMaster2.xml");
    // one undo step takes the slide and the design away again
    await page.keyboard.press("Control+z");
    await expect(page.getByTestId("thumbnail")).toHaveCount(2);
    errors.expectNone();
  });

  test("Browse for Themes with a .thmx changes the theme of every slide; Save Current Theme downloads a .thmx", async ({ page }) => {
    const errors = trackErrors(page);
    await openFile(page, BASIC, 3);
    await page.getByRole("tab", { name: "Design" }).click();
    await page.getByRole("button", { name: "More themes" }).click();
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("menuitem", { name: "Browse for Themes…" }).click();
    await (await chooser).setFiles(THEME);
    await expect(page.getByTestId("dirty")).not.toHaveText("Saved");
    await shot(page, "theme-imported");
    const files = unzip(await saveViaBackstage(page));
    expect(text(files, "ppt/presentation.xml").match(/<p:sldMasterId /g)).toHaveLength(1);
    expect(text(files, "ppt/theme/theme1.xml")).toMatch(/<a:theme [^>]*name="Harbor"/);
    const master = text(files, "ppt/slideMasters/slideMaster1.xml");
    expect(master).toContain('<p:cSld name="Harbor">');
    expect(master).toContain('name="Accent bar"');
    // every slide is on a layout of the new master and keeps its own text
    for (let n = 1; n <= 3; n++) expect(text(files, `ppt/slides/_rels/slide${n}.xml.rels`)).toMatch(/slideLayout\d+\.xml/);
    expect(text(files, "ppt/slides/slide2.xml")).toContain("<a:t>");
    // Save Current Theme: a .thmx download of the theme, master and layouts
    await page.getByRole("button", { name: "More themes" }).click();
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name: "Save Current Theme…" }).click()]);
    expect(dl.suggestedFilename()).toBe("Harbor.thmx");
    const thmx = unzip(await downloadBuffer(dl));
    expect(thmx.has("theme/theme/theme1.xml")).toBe(true);
    expect(thmx.has("theme/slideMasters/slideMaster1.xml")).toBe(true);
    errors.expectNone();
  });

  test("pen ink kept at the end of the show is saved as freeforms on the slide", async ({ page }) => {
    const errors = trackErrors(page);
    await openFile(page, BASIC, 3);
    await page.keyboard.press("F5");
    const show = page.getByTestId("presenter");
    await expect(page.getByTestId("presenter-counter")).toHaveText("1 / 3");
    await page.keyboard.press("Control+p");
    await expect(show).toHaveAttribute("data-tool", "pen");
    const layer = show.getByTestId("ink-layer");
    const b = (await layer.boundingBox())!;
    await page.mouse.move(b.x + b.width * 0.2, b.y + b.height * 0.7);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(b.x + b.width * (0.2 + i * 0.05), b.y + b.height * (0.7 - i * 0.02));
    await page.mouse.up();
    await expect(layer).toHaveAttribute("data-strokes", "1");
    await shot(page, "pen-ink");
    await page.keyboard.press("Escape"); // pen off
    await page.keyboard.press("Escape"); // end of the show
    const ask = page.getByTestId("ink-confirm");
    await expect(ask).toContainText("Do you want to keep your ink annotations?");
    await ask.getByRole("button", { name: "Keep" }).click();
    await expect(show).toHaveCount(0);
    const slide1 = text(unzip(await saveViaBackstage(page)), "ppt/slides/slide1.xml");
    expect(slide1).toMatch(/<p:cNvPr id="\d+" name="Ink 1"\/>/);
    expect(slide1).toContain("<a:custGeom>");
    expect(slide1).toMatch(/<a:ln w="28575"><a:solidFill><a:srgbClr val="E81123"\/>/);
    errors.expectNone();
  });

  test("the Insert Picture icon of a picture placeholder fills it with the picture", async ({ page }) => {
    const errors = trackErrors(page);
    await openShow(page);
    await page.getByRole("button", { name: "Slide layouts" }).first().click();
    await page.getByRole("button", { name: "Picture with Caption" }).first().click();
    await expect(page.getByTestId("slide-count")).toHaveText("Slide 2 of 2");
    const icon = page.locator('[data-testid^="ph-picture-"]').first();
    await expect(icon).toBeVisible();
    const chooser = page.waitForEvent("filechooser");
    await icon.click();
    await (await chooser).setFiles(PNG);
    await expect(page.locator('[data-testid^="ph-picture-"]')).toHaveCount(0);
    await shot(page, "picture-placeholder");
    const slide2 = text(unzip(await saveViaBackstage(page)), "ppt/slides/slide2.xml");
    expect(slide2).toMatch(/<p:pic>(?:(?!<\/p:pic>).)*<p:ph type="pic"/s);
    errors.expectNone();
  });
});
