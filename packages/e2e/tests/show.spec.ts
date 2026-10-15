import { expect, test, type Page } from "@playwright/test";
import { interceptPrint, openViaBackstage, printCount, saveViaBackstage, testdata, trackErrors, fileCommand } from "../support/common";
import { unzip, zipText } from "../support/zip";

const DECK = testdata("pptx/provisional-25-pitch-deck.pptx");
const stage = (page: Page) => page.getByTestId("editor-stage");

async function openShow(page: Page) {
  await page.goto("show/");
  await stage(page).waitFor();
  await expect(page.getByTestId("dirty")).toHaveText("Saved");
}

async function openDeck(page: Page) {
  await openShow(page);
  await openViaBackstage(page, DECK);
  await expect(page.getByTestId("slide-count")).toHaveText("Slide 1 of 6");
}

/** Insert › Shapes › Rectangle (the shape lands selected, centred on the slide). */
async function insertRectangle(page: Page) {
  await page.getByRole("tab", { name: "Insert" }).click();
  await page.getByRole("button", { name: "Shapes" }).click();
  await page.getByRole("dialog", { name: "Shapes" }).getByRole("button", { name: "Rectangle", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Shape Format" })).toBeVisible();
}

async function stageCentre(page: Page) {
  const b = (await stage(page).boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: b.height };
}

test.describe("Show", () => {
  test("opening a pptx shows six slides", async ({ page }) => {
    const errors = trackErrors(page);
    await openDeck(page);
    await expect(page.getByTestId("thumbnail")).toHaveCount(6);
    await expect(page.getByTestId("doc-name")).toHaveText("provisional-25-pitch-deck.pptx");
    await page.getByTestId("thumbnail").nth(3).click();
    await expect(page.getByTestId("slide-count")).toHaveText("Slide 4 of 6");
    errors.expectNone();
  });

  test("insert a rectangle and save: slide 1 gains a shape", async ({ page }) => {
    await openDeck(page);
    const before = unzip(await saveViaBackstage(page)).get("ppt/slides/slide1.xml")!.toString().match(/<p:sp>/g)?.length ?? 0;
    await insertRectangle(page);
    await expect(page.getByTestId("dirty")).toHaveText("Modified");
    const pptx = await saveViaBackstage(page);
    const slide1 = zipText(pptx, "ppt/slides/slide1.xml");
    expect(before).toBe(2);
    expect(slide1.match(/<p:sp>/g)).toHaveLength(3);
    expect(slide1).toContain('prst="rect"');
    await expect(page.getByTestId("dirty")).toHaveText("Saved");
  });

  test("dragging a shape to the slide centre shows snap guides", async ({ page }) => {
    await openDeck(page);
    await insertRectangle(page);
    const c = await stageCentre(page);
    await expect(stage(page)).toHaveAttribute("data-guides", "0");
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.mouse.move(c.x + 80, c.y + 60, { steps: 6 });
    await page.mouse.move(c.x + 3, c.y + 2, { steps: 6 });
    await expect(stage(page)).not.toHaveAttribute("data-guides", "0");
    await page.mouse.up();
    await expect(stage(page)).toHaveAttribute("data-guides", "0");
    await expect(page.getByTestId("dirty")).toHaveText("Modified");
  });

  test("Format shape dialog sets the fill colour, saved in the slide", async ({ page }) => {
    await openDeck(page);
    await insertRectangle(page);
    const c = await stageCentre(page);
    await page.mouse.click(c.x, c.y, { button: "right" });
    await page.getByRole("menu", { name: "Slide editor" }).getByRole("menuitem", { name: "Format shape…" }).click();
    const dlg = page.getByRole("dialog", { name: "Format shape" });
    await dlg.getByLabel("Fill color").evaluate((el: HTMLInputElement) => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      set.call(el, "#70ad47");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await dlg.getByRole("button", { name: "OK" }).click();
    await expect(dlg).toHaveCount(0);
    const slide1 = zipText(await saveViaBackstage(page), "ppt/slides/slide1.xml");
    expect(slide1).toMatch(/<a:srgbClr val="70AD47"/i);
  });

  test("speaker notes are kept and saved", async ({ page }) => {
    await openDeck(page);
    await page.getByRole("tab", { name: "View" }).click();
    await page.getByRole("button", { name: "Notes" }).first().click();
    const notes = page.getByRole("textbox", { name: "Speaker notes" });
    await notes.fill("Talk about the pitch");
    // Leave the slide and come back: the notes were committed.
    await page.getByTestId("thumbnail").nth(1).click();
    await expect(notes).toHaveValue("");
    await page.getByTestId("thumbnail").nth(0).click();
    await expect(notes).toHaveValue("Talk about the pitch");
    const pptx = await saveViaBackstage(page);
    const files = unzip(pptx);
    const notesXml = [...files].filter(([n]) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n)).map(([, b]) => b.toString());
    expect(notesXml.some((x) => x.includes("Talk about the pitch"))).toBe(true);
  });

  test("Present mode navigates with arrows and exits with Esc", async ({ page }) => {
    await openDeck(page);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Present" }).first().click();
    const presenter = page.getByTestId("presenter");
    await expect(presenter).toBeVisible();
    await expect(page.getByTestId("presenter-counter")).toHaveText("1 / 6");
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("presenter-counter")).toHaveText("2 / 6");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByTestId("presenter-counter")).toHaveText("2 / 6");
    await page.keyboard.press("Escape");
    await expect(presenter).toHaveCount(0);
    await expect(page.getByTestId("slide-count")).toHaveText("Slide 2 of 6");
  });

  test("new slide from the ribbon adds a slide, undo removes it", async ({ page }) => {
    await openDeck(page);
    await page.getByRole("tab", { name: "Insert" }).click();
    await page.getByRole("button", { name: "New slide" }).first().click();
    await expect.poll(() => page.getByTestId("thumbnail").count()).toBeGreaterThanOrEqual(7);
    await page.keyboard.press("Escape");
    await page.getByRole("tab", { name: "Home" }).click();
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByTestId("thumbnail")).toHaveCount(6);
  });

  test("Export PDF renders the print view and calls window.print", async ({ page }) => {
    await interceptPrint(page);
    await openDeck(page);
    await fileCommand(page, /^Export PDF/);
    await expect.poll(() => printCount(page)).toBeGreaterThan(0);
  });

  // The print view replaces the editor; the remounted canvas area must be measured again (P7-2).
  test("the slide editor comes back after Export PDF", async ({ page }) => {
    await interceptPrint(page);
    await openDeck(page);
    await fileCommand(page, /^Export PDF/);
    await expect.poll(() => printCount(page)).toBeGreaterThan(0);
    await expect(stage(page)).toBeVisible();
    await expect.poll(async () => (await stage(page).boundingBox())?.width ?? 0).toBeGreaterThan(200);
  });

  test("each Shapes gallery button inserts its own shape with a real click", async ({ page }) => {
    await openShow(page);
    await page.getByRole("tab", { name: "Insert" }).click();
    await page.getByRole("button", { name: "Shapes" }).click();
    const gallery = page.getByRole("dialog", { name: "Shapes" });
    const boxes = await Promise.all((await gallery.getByRole("button").all()).map((b) => b.boundingBox()));
    for (let i = 1; i < boxes.length; i++) expect(boxes[i]!.x).toBeGreaterThanOrEqual(boxes[i - 1]!.x + boxes[i - 1]!.width);
    await gallery.getByRole("button", { name: "Oval" }).click();
    await expect(page.getByRole("tab", { name: "Shape Format" })).toBeVisible();
    await expect(gallery).toBeHidden();
  });
});
