import { expect, test, type Page } from "@playwright/test";
import { interceptPrint, openPrint, previewPages, previewPdf, openViaBackstage, printCount, saveViaBackstage, testdata, trackErrors, fileCommand, ribbonCommand } from "../support/common";
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

/** Insert › Shapes › Rectangle chosen with Enter (inserted at once, selected, centred on the slide). */
async function insertRectangle(page: Page) {
  await page.getByRole("tab", { name: "Insert" }).click();
  await page.getByRole("button", { name: "Shapes" }).click();
  await page.getByRole("dialog", { name: "Shapes" }).getByRole("group", { name: "Rectangles" }).getByRole("button", { name: "Rectangle", exact: true }).press("Enter");
  await expect(page.getByRole("tab", { name: "Shape Format" })).toBeVisible();
}

/** Insert › Shapes, a real click on `name` (in `group`), then a drag on the stage from `a` to `b` (stage px). */
async function drawShape(page: Page, group: string, name: string, a: [number, number], b: [number, number]) {
  await page.getByRole("tab", { name: "Insert" }).click();
  await page.getByRole("button", { name: "Shapes" }).click();
  await page.getByRole("dialog", { name: "Shapes" }).getByRole("group", { name: group }).getByRole("button", { name, exact: true }).click();
  await expect(stage(page)).toHaveAttribute("data-draw-mode", /.+/);
  const box = (await stage(page).boundingBox())!;
  await page.mouse.move(box.x + a[0], box.y + a[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + (a[0] + b[0]) / 2, box.y + (a[1] + b[1]) / 2, { steps: 4 });
  await page.mouse.move(box.x + b[0], box.y + b[1], { steps: 4 });
  await page.mouse.up();
  await expect(stage(page)).not.toHaveAttribute("data-draw-mode", /.+/);
}

/** Insert › Table › rows × cols from the picker; the table is selected. */
async function insertTable(page: Page, rows: number, cols: number) {
  await page.getByRole("tab", { name: "Insert" }).click();
  await page.getByRole("button", { name: "Table", exact: true }).click();
  await page.getByRole("button", { name: `${rows} × ${cols} table` }).click();
  await expect(page.getByTestId("table-overlay")).toBeVisible();
}

const cell = (page: Page, r: number, c: number) => page.locator(`[data-testid="table-cell"][data-cell="${r},${c}"]`);

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

  test("presenter view opens the audience window and advances both", async ({ page, context }) => {
    const errors = trackErrors(page);
    await openDeck(page);
    await page.keyboard.press("Escape");
    const popup = context.waitForEvent("page");
    await page.getByRole("tab", { name: "View" }).click();
    await page.getByRole("button", { name: "Presenter view" }).click();
    const audience = await popup;
    const console = page.getByTestId("presenter-console");
    await expect(console).toBeVisible();
    await expect(page.getByTestId("console-counter")).toHaveText("Slide 1 of 6");
    await expect(audience.getByTestId("presenter-counter")).toHaveText("1 / 6");
    await expect(audience.locator("canvas").first()).toBeVisible();
    // Next in the presenter window moves the audience window.
    await console.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByTestId("console-counter")).toHaveText("Slide 2 of 6");
    await expect(audience.getByTestId("presenter-counter")).toHaveText("2 / 6");
    // A key in the audience window moves the presenter.
    await audience.getByTestId("presenter").click({ position: { x: 5, y: 5 } }); // left half: previous
    await expect(page.getByTestId("console-counter")).toHaveText("Slide 1 of 6");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect(audience.getByTestId("presenter-counter")).toHaveText("3 / 6");
    await page.keyboard.press("Escape");
    await expect(console).toHaveCount(0);
    await expect.poll(() => audience.isClosed()).toBe(true);
    await expect(page.getByTestId("slide-count")).toHaveText("Slide 3 of 6");
    errors.expectNone();
  });

  test("B blanks the screen and number + Enter jumps to a slide", async ({ page }) => {
    await openDeck(page);
    await page.keyboard.press("Escape");
    await page.keyboard.press("F5");
    const presenter = page.getByTestId("presenter");
    await expect(page.getByTestId("presenter-counter")).toHaveText("1 / 6");
    await page.keyboard.press("b");
    await expect(presenter).toHaveAttribute("data-blank", "black");
    await expect(presenter.locator("canvas")).toHaveCount(0);
    await page.keyboard.press("b");
    await expect(presenter).toHaveAttribute("data-blank", "none");
    await page.keyboard.press("w");
    await expect(presenter).toHaveAttribute("data-blank", "white");
    await page.keyboard.press("ArrowRight"); // unblanks, stays on the slide
    await expect(page.getByTestId("presenter-counter")).toHaveText("1 / 6");
    await page.keyboard.press("5");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("presenter-counter")).toHaveText("5 / 6");
    await page.keyboard.press("End");
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("presenter-end")).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await expect(presenter).toHaveCount(0);
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

  test("File › Print: full pages and handouts (6 per page → 1 page); Print and Export PDF call window.print", async ({ page }) => {
    await interceptPrint(page);
    await openDeck(page);
    await openPrint(page);
    await expect(page.getByTestId("print-page-count")).toHaveText("Page 1 of 6");
    expect(await previewPdf(page, "show-full-pages")).toBe(6);
    await page.getByLabel("Print layout").selectOption("handout6");
    await expect(page.getByTestId("print-page-count")).toHaveText("Page 1 of 1");
    expect(await previewPdf(page, "show-handouts-6")).toBe(1);
    await page.getByLabel("Print layout").selectOption("notes");
    await expect(page.getByTestId("print-page-count")).toHaveText("Page 1 of 6");
    await page.getByLabel("Print layout").selectOption("handout3");
    await expect(page.getByTestId("print-page-count")).toHaveText("Page 1 of 2");
    expect(await previewPages(page)).toBe(2);
    await page.getByTestId("print-button").click();
    await expect.poll(() => printCount(page)).toBe(1);
    await page.keyboard.press("Escape");
    await fileCommand(page, /^Export PDF/);
    await expect.poll(() => printCount(page)).toBe(2);
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

  test("a real click on a Shapes gallery button arms drawing; a click on the slide inserts the shape", async ({ page }) => {
    await openShow(page);
    await page.getByRole("tab", { name: "Insert" }).click();
    await page.getByRole("button", { name: "Shapes" }).click();
    const gallery = page.getByRole("dialog", { name: "Shapes" });
    const basic = gallery.getByRole("group", { name: "Basic shapes" });
    const boxes = await Promise.all((await basic.getByRole("button").all()).map((b) => b.boundingBox()));
    // no two buttons overlap
    for (let i = 1; i < boxes.length; i++) {
      const [p, q] = [boxes[i - 1]!, boxes[i]!];
      expect(q.x >= p.x + p.width - 0.5 || q.y >= p.y + p.height - 0.5).toBe(true);
    }
    await basic.getByRole("button", { name: "Oval" }).click();
    await expect(gallery).toBeHidden();
    await expect(stage(page)).toHaveAttribute("data-draw-mode", "ellipse");
    const c = await stageCentre(page);
    await page.mouse.click(c.x, c.y);
    await expect(page.getByRole("tab", { name: "Shape Format" })).toBeVisible();
    await expect(stage(page)).not.toHaveAttribute("data-draw-mode", /.+/);
  });

  // ----- P8-16: shape library, connectors, tables -----

  test("Insert › Shapes › 5-point star drawn on the slide is saved as prst=star5", async ({ page }) => {
    const errors = trackErrors(page);
    await openShow(page);
    await drawShape(page, "Stars and banners", "Star: 5 points", [80, 80], [220, 210]);
    await expect(page.getByRole("tab", { name: "Shape Format" })).toBeVisible();
    const slide1 = zipText(await saveViaBackstage(page), "ppt/slides/slide1.xml");
    expect(slide1).toContain('prst="star5"');
    errors.expectNone();
  });

  test("an elbow connector drawn between two shapes stays glued when a shape moves", async ({ page }) => {
    const errors = trackErrors(page);
    await openShow(page);
    await drawShape(page, "Rectangles", "Rectangle", [80, 80], [200, 160]);
    await drawShape(page, "Rectangles", "Rectangle", [480, 320], [600, 400]);
    // from the first rectangle's right site to the second one's left site
    await drawShape(page, "Lines", "Connector: elbow", [200, 120], [480, 360]);
    let slide1 = zipText(await saveViaBackstage(page), "ppt/slides/slide1.xml");
    const cxn = (xml: string) => xml.match(/<p:cxnSp>[\s\S]*?<\/p:cxnSp>/)?.[0] ?? "";
    const before = cxn(slide1);
    expect(before).toContain("<a:stCxn");
    expect(before).toContain("<a:endCxn");
    expect(before).toMatch(/prst="bentConnector\d"/);
    // drag the first rectangle down
    const box = (await stage(page).boundingBox())!;
    await page.keyboard.press("Escape");
    await page.mouse.move(box.x + 140, box.y + 120);
    await page.mouse.down();
    await page.mouse.move(box.x + 140, box.y + 160, { steps: 4 });
    await page.mouse.move(box.x + 140, box.y + 200, { steps: 4 });
    await page.mouse.up();
    slide1 = zipText(await saveViaBackstage(page), "ppt/slides/slide1.xml");
    const after = cxn(slide1);
    expect(after).toContain("<a:stCxn");
    expect(after).toContain("<a:endCxn");
    expect(after).not.toBe(before);
    errors.expectNone();
  });

  test("Insert › Table 3 × 3, typing in a cell is saved in a:tbl", async ({ page }) => {
    const errors = trackErrors(page);
    await openShow(page);
    await insertTable(page, 3, 3);
    await cell(page, 0, 0).click({ force: true });
    await expect(page.getByTestId("text-overlay")).toBeFocused();
    await page.keyboard.type("Revenue");
    await page.keyboard.press("Tab");
    await page.keyboard.type("2026");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("text-overlay")).toHaveCount(0);
    const slide1 = zipText(await saveViaBackstage(page), "ppt/slides/slide1.xml");
    const tbl = slide1.match(/<a:tbl>[\s\S]*<\/a:tbl>/)?.[0] ?? "";
    expect(tbl).toContain("Revenue");
    expect(tbl).toContain("2026");
    expect(tbl.match(/<a:tr /g)).toHaveLength(3);
    errors.expectNone();
  });

  test("selecting two cells by dragging and Layout › Merge cells saves gridSpan", async ({ page }) => {
    const errors = trackErrors(page);
    await openShow(page);
    await insertTable(page, 3, 3);
    const a = (await cell(page, 1, 0).boundingBox())!;
    const b = (await cell(page, 1, 1).boundingBox())!;
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 5 });
    await page.mouse.up();
    await expect(cell(page, 1, 1)).toHaveAttribute("aria-selected", "true");
    await page.getByRole("tab", { name: "Layout" }).click();
    await page.getByRole("button", { name: "Merge cells" }).click();
    await expect(cell(page, 1, 1)).toHaveCount(0);
    const slide1 = zipText(await saveViaBackstage(page), "ppt/slides/slide1.xml");
    expect(slide1).toContain('gridSpan="2"');
    expect(slide1).toContain('hMerge="1"');
    errors.expectNone();
  });

  test("Table Design › table style changes the cells' fill on the canvas", async ({ page }) => {
    const errors = trackErrors(page);
    await openShow(page);
    await insertTable(page, 3, 3);
    const pixel = async () => {
      const box = (await cell(page, 2, 0).boundingBox())!;
      return page.evaluate(({ x, y }) => {
        const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="editor-stage"] canvas')!;
        const r = canvas.getBoundingClientRect();
        const k = canvas.width / r.width;
        const d = canvas.getContext("2d")!.getImageData(Math.round((x - r.left) * k), Math.round((y - r.top) * k), 1, 1).data;
        return [d[0]!, d[1]!, d[2]!];
      }, { x: box.x + box.width / 2, y: box.y + box.height - 4 });
    };
    const before = await pixel();
    expect(before[2]).toBeGreaterThan(before[0]); // accent 1: blue
    await page.getByRole("tab", { name: "Table Design" }).click();
    await page.getByRole("button", { name: "Medium Style 2 – Accent 2" }).click();
    await expect.poll(async () => { const [r, , b] = await pixel(); return r > b; }).toBe(true); // accent 2: orange
    await expect(page.getByRole("button", { name: "Medium Style 2 – Accent 2" })).toHaveAttribute("aria-pressed", "true");
    errors.expectNone();
  });

  // ----- P8-8: transitions and animations -----

  test("Transitions › Fade is saved as p:transition", async ({ page }) => {
    const errors = trackErrors(page);
    await openDeck(page);
    await page.getByRole("tab", { name: "Transitions" }).click();
    await page.getByRole("group", { name: "Transitions", exact: true }).getByRole("button", { name: "Fade", exact: true }).click();
    await expect(page.getByTestId("thumbnail").first().getByTestId("effects-star")).toBeVisible();
    const slide1 = zipText(await saveViaBackstage(page), "ppt/slides/slide1.xml");
    expect(slide1).toMatch(/<p:transition[^>]*>\s*<p:fade/);
    errors.expectNone();
  });

  test("Animations › Fly In shows in the Animation pane and is saved as p:timing", async ({ page }) => {
    const errors = trackErrors(page);
    await openDeck(page);
    await insertRectangle(page);
    await page.getByRole("tab", { name: "Animations" }).click();
    await page.getByRole("button", { name: "Animation styles" }).click();
    await page.getByRole("group", { name: "Entrance" }).getByRole("button", { name: "Fly In" }).click();
    await expect(page.getByTestId("anim-badge")).toHaveText(["1"]);
    await page.getByRole("button", { name: "Animation pane" }).click();
    const rows = page.getByTestId("animation-pane").getByTestId("anim-row");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Fly In");
    const slide1 = zipText(await saveViaBackstage(page), "ppt/slides/slide1.xml");
    expect(slide1).toContain("<p:timing");
    expect(slide1).toContain('presetClass="entr"');
    errors.expectNone();
  });

  test("the slide show needs two clicks to reveal two On Click shapes", async ({ page }) => {
    const errors = trackErrors(page);
    await openDeck(page);
    for (let i = 0; i < 2; i++) {
      await insertRectangle(page);
      await page.getByRole("tab", { name: "Animations" }).click();
      await page.getByRole("button", { name: "Animation styles" }).click();
      await page.getByRole("group", { name: "Entrance" }).getByRole("button", { name: "Fade", exact: true }).click();
    }
    await expect(page.getByTestId("anim-badge")).toHaveText(["1", "2"]);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Present" }).first().click();
    const presenter = page.getByTestId("presenter");
    const slide = presenter.getByTestId("animated-slide");
    const hidden = async () => ((await slide.getAttribute("data-hidden-shapes")) ?? "").split(",").filter(Boolean).length;
    await expect(page.getByTestId("presenter-counter")).toHaveText("1 / 6");
    await expect.poll(hidden).toBe(2);
    const box = (await presenter.boundingBox())!;
    const click = () => presenter.click({ position: { x: box.width - 20, y: box.height / 2 } });
    await click();
    await expect(presenter).toHaveAttribute("data-step", "1");
    await expect.poll(hidden).toBe(1);
    await click();
    await expect.poll(hidden).toBe(0);
    await expect(page.getByTestId("presenter-counter")).toHaveText("1 / 6");
    await click();
    await expect(page.getByTestId("presenter-counter")).toHaveText("2 / 6");
    // ← back onto the slide: every step done; once more: one step back.
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByTestId("presenter-counter")).toHaveText("1 / 6");
    await expect.poll(hidden).toBe(0);
    await page.keyboard.press("ArrowLeft");
    await expect.poll(hidden).toBe(1);
    await page.keyboard.press("Escape");
    await expect(presenter).toHaveCount(0);
    errors.expectNone();
  });

  // ----- P8-22: design, layouts, master view, footers, sections, pictures -----

  test("Design › Themes › Harbor re-colours the title on the canvas and is saved in theme1.xml", async ({ page }) => {
    const errors = trackErrors(page);
    await openShow(page);
    const c = await stageCentre(page);
    // type a title into the new presentation's title placeholder
    await page.mouse.dblclick(c.x, c.y - c.h * 0.12);
    await page.keyboard.type("Harbor");
    await page.mouse.click(c.x - c.w * 0.45, c.y + c.h * 0.45);
    await expect(page.getByTestId("dirty")).toHaveText("Modified");
    /** The darkest pixel of the title's band (glyph strokes carry the full text colour). */
    const darkest = () =>
      page.evaluate(() => {
        const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="editor-stage"] canvas')!;
        const ctx = canvas.getContext("2d")!;
        const d = ctx.getImageData(0, Math.round(canvas.height * 0.2), canvas.width, Math.round(canvas.height * 0.3)).data;
        let best = [255, 255, 255];
        for (let i = 0; i < d.length; i += 4) if (d[i]! + d[i + 1]! + d[i + 2]! < best[0]! + best[1]! + best[2]!) best = [d[i]!, d[i + 1]!, d[i + 2]!];
        return best;
      });
    expect(await darkest()).toEqual([0, 0, 0]);
    await page.getByRole("tab", { name: "Design" }).click();
    await page.getByRole("group", { name: "Themes" }).last().getByRole("button", { name: "Harbor" }).click();
    await expect(page.getByRole("group", { name: "Themes" }).last().getByRole("button", { name: "Harbor" })).toHaveAttribute("aria-pressed", "true");
    // Harbor's Dark 1 is 1B1F24
    await expect.poll(async () => { const [r, g, b] = await darkest(); return r! > 10 && b! > r!; }).toBe(true);
    const files = unzip(await saveViaBackstage(page));
    const theme = [...files].find(([n]) => /^ppt\/theme\/theme\d+\.xml$/.test(n))![1].toString();
    expect(theme).toContain('name="Harbor"');
    expect(theme).toContain("1B1F24");
    errors.expectNone();
  });

  test("New Slide ▾ › Two content saves a slide with two content placeholders", async ({ page }) => {
    const errors = trackErrors(page);
    await openShow(page);
    await page.getByRole("button", { name: "Slide layouts" }).first().click();
    await page.getByRole("group", { name: "Slide layouts" }).getByRole("button", { name: "Two content" }).click();
    await expect(page.getByTestId("slide-count")).toHaveText("Slide 2 of 2");
    const slide2 = zipText(await saveViaBackstage(page), "ppt/slides/slide2.xml");
    const content = [...slide2.matchAll(/<p:ph\b[^>]*>/g)].map((m) => m[0]).filter((ph) => !/type="(title|dt|ftr|sldNum)"/.test(ph));
    expect(content).toHaveLength(2);
    errors.expectNone();
  });

  test("Insert › Header & Footer › Apply to all puts slide-number fields on every slide", async ({ page }) => {
    const errors = trackErrors(page);
    await openDeck(page);
    await page.getByRole("tab", { name: "Insert" }).click();
    await page.getByRole("button", { name: "Header & Footer…" }).click();
    const dlg = page.getByRole("dialog", { name: "Header and Footer" });
    await dlg.getByLabel("Slide number").check();
    await dlg.getByLabel("Footer", { exact: true }).check();
    await dlg.getByLabel("Footer text").fill("Pitch");
    await dlg.getByRole("button", { name: "Apply to all" }).click();
    await expect(page.getByTestId("dirty")).toHaveText("Modified");
    const files = unzip(await saveViaBackstage(page));
    const slides = [...files].filter(([n]) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
    expect(slides).toHaveLength(6);
    for (const [, xml] of slides) {
      expect(xml.toString()).toContain('type="slidenum"');
      expect(xml.toString()).toContain("Pitch");
    }
    errors.expectNone();
  });

  test("Add Section shows a section header and is saved as p14:sectionLst", async ({ page }) => {
    const errors = trackErrors(page);
    await openDeck(page);
    await page.getByTestId("thumbnail").nth(2).click();
    await page.getByRole("button", { name: "Add Section" }).click();
    const dlg = page.getByRole("dialog", { name: "Rename Section" });
    await dlg.getByLabel("Section name").fill("Market");
    await dlg.getByRole("button", { name: "Rename" }).click();
    await expect(page.getByTestId("section-name")).toHaveText(["Default Section", "Market"]);
    const pres = zipText(await saveViaBackstage(page), "ppt/presentation.xml");
    expect(pres).toContain("p14:sectionLst");
    expect(pres).toContain('name="Market"');
    errors.expectNone();
  });

  test("Picture Format › Crop: dragging a crop handle and Enter is saved as a:srcRect", async ({ page }) => {
    const errors = trackErrors(page);
    await openShow(page);
    await openViaBackstage(page, testdata("pptx/provisional-31-picture-adjustments.pptx"));
    await expect(page.getByTestId("slide-count")).toHaveText("Slide 1 of 2");
    await page.getByTestId("thumbnail").nth(1).click();
    const before = (zipText(await saveViaBackstage(page), "ppt/slides/slide2.xml").match(/<a:srcRect/g) ?? []).length;
    // the first picture of slide 2 (left half, not cropped)
    const c = await stageCentre(page);
    await page.mouse.click(c.x - c.w * 0.25, c.y - c.h * 0.1);
    await page.getByRole("tab", { name: "Picture Format" }).click();
    await page.getByRole("button", { name: "Crop", exact: true }).click();
    const h = (await page.getByTestId("crop-handle-r").boundingBox())!;
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await page.mouse.down();
    await page.mouse.move(h.x + h.width / 2 - 80, h.y + h.height / 2, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("crop-overlay")).toHaveCount(0);
    const slide2 = zipText(await saveViaBackstage(page), "ppt/slides/slide2.xml");
    expect((slide2.match(/<a:srcRect/g) ?? []).length).toBe(before + 1);
    expect(slide2).toMatch(/<a:srcRect[^>]*\br="\d+"/);
    errors.expectNone();
  });

  test("Slide Master: moving the layout's title placeholder moves the title of slides that follow it", async ({ page }) => {
    const errors = trackErrors(page);
    await openShow(page);
    const titleY = (xml: string) => Number(/<p:sp>(?:(?!<\/p:sp>).)*?type="(?:ctrTitle|title)"(?:(?!<\/p:sp>).)*?<a:off x="\d+" y="(\d+)"/s.exec(xml)?.[1]);
    const before = unzip(await saveViaBackstage(page));
    const slideBefore = titleY(before.get("ppt/slides/slide1.xml")!.toString());
    await page.getByRole("tab", { name: "View" }).click();
    await page.getByRole("button", { name: "Slide Master" }).click();
    await expect(stage(page)).toHaveAttribute("data-master-view", "title");
    const c = await stageCentre(page);
    // the centred title (upper half of the Title Slide layout)
    await page.mouse.click(c.x, c.y - c.h * 0.12);
    await page.mouse.move(c.x, c.y - c.h * 0.12);
    await page.mouse.down();
    await page.mouse.move(c.x, c.y - c.h * 0.12 + 40, { steps: 5 });
    await page.mouse.move(c.x, c.y - c.h * 0.12 + 80, { steps: 5 });
    await page.mouse.up();
    await expect(page.getByTestId("dirty")).toHaveText("Modified");
    await page.getByRole("button", { name: "Close Master View" }).click();
    await expect(stage(page)).not.toHaveAttribute("data-master-view", /.+/);
    const after = unzip(await saveViaBackstage(page));
    const slideAfter = after.get("ppt/slides/slide1.xml")!.toString();
    // the slide's title follows the layout's
    expect(titleY(slideAfter)).toBeGreaterThan(slideBefore + 500000);
    const layouts = [...after].filter(([n]) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(n)).map(([, b]) => b.toString());
    const titleLayout = layouts.find((x) => x.includes('type="title"') && x.includes('type="ctrTitle"'))!;
    expect(titleY(titleLayout)).toBeGreaterThan(slideBefore + 500000);
    errors.expectNone();
  });

  // ----- P8-24: charts, links, action buttons, media, reuse slides -----

  /** Insert › Chart › OK (clustered column); the chart is selected with Chart Design shown. */
  async function insertColumnChart(page: Page) {
    await page.getByRole("tab", { name: "Insert" }).click();
    await page.getByRole("button", { name: "Chart", exact: true }).click();
    const dlg = page.getByTestId("insert-chart-dialog");
    await expect(dlg.getByRole("radio", { name: "Clustered Column" })).toHaveAttribute("aria-checked", "true");
    await dlg.getByRole("button", { name: "OK" }).click();
    await expect(page.getByRole("tab", { name: "Chart Design" })).toHaveAttribute("aria-selected", "true");
  }

  /** The stage canvas pixels of a band (rows `y0`..`y1` as fractions of the height) as a hash-like sum. */
  const bandSum = (page: Page, y0: number, y1: number) =>
    page.evaluate(([a, b]) => {
      const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="editor-stage"] canvas')!;
      const d = canvas.getContext("2d")!.getImageData(0, Math.round(canvas.height * a!), canvas.width, Math.round(canvas.height * (b! - a!))).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += (d[i]! * 3 + d[i + 1]! * 5 + d[i + 2]! * 7) * ((i / 4) % 97);
      return sum;
    }, [y0, y1]);

  test("Insert › Chart saves ppt/charts/chart1.xml and an embedded workbook", async ({ page }) => {
    const errors = trackErrors(page);
    await openShow(page);
    await insertColumnChart(page);
    const files = unzip(await saveViaBackstage(page));
    const chart = files.get("ppt/charts/chart1.xml")!.toString();
    expect(chart).toContain("<c:barChart>");
    expect(chart).toContain("<c:v>Category 1</c:v>");
    expect(chart).toMatch(/<c:externalData r:id="rId\d+">/);
    const xlsx = files.get("ppt/embeddings/Microsoft_Excel_Worksheet1.xlsx")!;
    expect(xlsx.subarray(0, 2).toString()).toBe("PK");
    // the minimal workbook: inline strings in Sheet1 (P8-32)
    expect(zipText(xlsx, "xl/worksheets/sheet1.xml")).toContain("Series 1");
    expect(files.get("ppt/slides/slide1.xml")!.toString()).toContain('uri="http://schemas.openxmlformats.org/drawingml/2006/chart"');
    errors.expectNone();
  });

  test("Chart Design › Edit Data changes a bar on the canvas and in the saved chart", async ({ page }) => {
    const errors = trackErrors(page);
    await openShow(page);
    await insertColumnChart(page);
    const before = await bandSum(page, 0.2, 0.8);
    await page.getByRole("button", { name: "Edit Data" }).click();
    const dlg = page.getByTestId("edit-data-dialog");
    await dlg.getByRole("textbox", { name: "Cell B2" }).fill("1");
    await dlg.getByRole("button", { name: "OK" }).click();
    await expect.poll(() => bandSum(page, 0.2, 0.8)).not.toBe(before);
    const chart = zipText(await saveViaBackstage(page), "ppt/charts/chart1.xml");
    expect(chart).toMatch(/<c:val><c:numRef><c:f>Sheet1!\$B\$2:\$B\$5<\/c:f><c:numCache><c:formatCode>General<\/c:formatCode><c:ptCount val="4"\/><c:pt idx="0"><c:v>1<\/c:v>/);
    errors.expectNone();
  });

  test("Ctrl+K links a shape to slide 2 and a click on it in the slide show jumps there", async ({ page }) => {
    const errors = trackErrors(page);
    await openShow(page);
    await page.getByRole("button", { name: "New slide", exact: true }).first().click();
    await expect(page.getByTestId("slide-count")).toHaveText("Slide 2 of 2");
    await page.getByTestId("thumbnail").first().click();
    await insertRectangle(page);
    await page.keyboard.press("Control+k");
    const dlg = page.getByTestId("link-dialog");
    await dlg.getByRole("tab", { name: "Place in This Document" }).click();
    await dlg.locator('[data-target="slide-2"]').click();
    await dlg.getByRole("button", { name: "OK" }).click();
    await expect(page.getByTestId("dirty")).toHaveText("Modified");
    // the show: a click on the (centred) rectangle jumps to slide 2 instead of advancing
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Present" }).first().click();
    await expect(page.getByTestId("presenter")).toBeVisible();
    await expect(page.getByTestId("presenter-counter")).toHaveText("1 / 2");
    await page.getByTestId("show-link").click();
    await expect(page.getByTestId("presenter-counter")).toHaveText("2 / 2");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("presenter")).toHaveCount(0);
    const slide1 = zipText(await saveViaBackstage(page), "ppt/slides/slide1.xml");
    expect(slide1).toContain('action="ppaction://hlinksldjump"');
    errors.expectNone();
  });

  test("an action button Forward or Next is inserted and saved with ppaction://hlinkshowjump", async ({ page }) => {
    const errors = trackErrors(page);
    await openShow(page);
    await page.getByRole("tab", { name: "Insert" }).click();
    await page.getByRole("button", { name: "Shapes" }).click();
    await page.getByRole("dialog", { name: "Shapes" }).getByRole("group", { name: "Action Buttons" }).getByRole("button", { name: "Action Button: Go Forward or Next" }).press("Enter");
    await expect(page.getByRole("tab", { name: "Shape Format" })).toBeVisible();
    const slide1 = zipText(await saveViaBackstage(page), "ppt/slides/slide1.xml");
    expect(slide1).toContain('prst="actionButtonForwardNext"');
    expect(slide1).toMatch(/<a:hlinkClick r:id="" action="ppaction:\/\/hlinkshowjump\?jump=nextslide"\/>/);
    errors.expectNone();
  });

  test("Insert › Video with a small webm saves p:pic with a:videoFile; the editor shows the placeholder", async ({ page }) => {
    const errors = trackErrors(page);
    await openShow(page);
    await page.getByRole("tab", { name: "Insert" }).click();
    // an EBML header: enough for the package (no playable video needed)
    const webm = Buffer.from("1a45dfa39f4286810142f7810142f2810442f381084282847765626d", "hex");
    await page.getByTestId("video-input").setInputFiles({ name: "clip.webm", mimeType: "video/webm", buffer: webm });
    await expect(page.getByRole("tab", { name: "Playback" })).toHaveAttribute("aria-selected", "true");
    // the placeholder: a dark frame (#262626) in the middle of the slide
    const c = await stageCentre(page);
    const box = (await stage(page).boundingBox())!;
    const px = await page.evaluate(([x, y]) => {
      const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="editor-stage"] canvas')!;
      const r = canvas.width / canvas.clientWidth;
      return [...canvas.getContext("2d")!.getImageData(Math.round(x! * r), Math.round(y! * r), 1, 1).data].slice(0, 3);
    }, [c.x - box.x - c.w * 0.18, c.y - box.y]);
    expect(px).toEqual([38, 38, 38]);
    const files = unzip(await saveViaBackstage(page));
    const slide1 = files.get("ppt/slides/slide1.xml")!.toString();
    expect(slide1).toMatch(/<p:pic>(?:(?!<\/p:pic>).)*<a:videoFile r:link="rId\d+"\/>/s);
    expect(slide1).toContain("p14:media");
    expect([...files.keys()]).toContain("ppt/media/media1.webm");
    errors.expectNone();
  });

  test("Reuse Slides inserts a slide of another presentation after the current one", async ({ page }) => {
    const errors = trackErrors(page);
    await openShow(page);
    await page.getByRole("button", { name: "Slide layouts" }).first().click();
    await page.getByTestId("reuse-slides").click();
    const pane = page.getByTestId("reuse-pane");
    await pane.getByTestId("reuse-input").setInputFiles(testdata("pptx/provisional-03-title-content-3-bullets.pptx"));
    await expect(pane.getByTestId("reuse-slide-1")).toBeVisible();
    await pane.getByTestId("reuse-slide-1").click();
    await expect(page.getByTestId("slide-count")).toHaveText("Slide 2 of 2");
    const slide2 = zipText(await saveViaBackstage(page), "ppt/slides/slide2.xml");
    expect(slide2).toContain("<a:t>");
    // one undo step removes it again
    await page.keyboard.press("Control+z");
    await expect(page.getByTestId("thumbnail")).toHaveCount(1);
    errors.expectNone();
  });

  // ----- P8-28: views, guides, smart guides, autofit, Selection pane, hidden slides -----

  /** A pixel of the editor's canvas at viewport point (x, y). */
  const stagePixel = (page: Page, x: number, y: number) =>
    page.evaluate(({ x, y }) => {
      const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="editor-stage"] canvas')!;
      const r = canvas.getBoundingClientRect();
      const k = canvas.width / r.width;
      const d = canvas.getContext("2d")!.getImageData(Math.round((x - r.left) * k), Math.round((y - r.top) * k), 1, 1).data;
      return [d[0]!, d[1]!, d[2]!];
    }, { x, y });

  /** The title text of every saved slide, in order. */
  const savedTitles = (pptx: Buffer) => {
    const files = unzip(pptx);
    const n = [...files.keys()].filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k)).length;
    return Array.from({ length: n }, (_, i) => (files.get(`ppt/slides/slide${i + 1}.xml`)!.toString().match(/<a:t>([^<]*)<\/a:t>/)?.[1] ?? ""));
  };

  test("Slide Sorter: dragging a slide reorders it and the saved order changes", async ({ page }) => {
    const errors = trackErrors(page);
    await openDeck(page);
    const before = savedTitles(await saveViaBackstage(page));
    await page.getByRole("tab", { name: "View" }).click();
    await page.getByRole("button", { name: "Slide Sorter" }).click();
    const thumbs = page.getByTestId("sorter-thumb");
    await expect(thumbs).toHaveCount(6);
    const a = (await thumbs.nth(0).boundingBox())!;
    const b = (await thumbs.nth(2).boundingBox())!;
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(a.x + a.width / 2 + 30, a.y + a.height / 2, { steps: 4 });
    await page.mouse.move(b.x + b.width * 0.85, b.y + b.height / 2, { steps: 8 });
    await expect(page.getByTestId("sorter-drop")).toBeVisible();
    await page.mouse.up();
    await expect(page.getByTestId("dirty")).toHaveText("Modified");
    const after = savedTitles(await saveViaBackstage(page));
    expect(after).toEqual([before[1], before[2], before[0], ...before.slice(3)]);
    await page.screenshot({ path: "test-results/p8-28-sorter.png" });
    errors.expectNone();
  });

  test("View › Guides: the centre guides are saved in viewProps.xml", async ({ page }) => {
    await openShow(page);
    await page.getByRole("tab", { name: "View" }).click();
    await page.getByRole("checkbox", { name: "Guides" }).check();
    await expect(stage(page)).toHaveAttribute("data-drawing-guides", "2");
    await page.getByRole("checkbox", { name: "Ruler" }).check();
    await expect(page.getByTestId("ruler-h")).toBeVisible();
    const view = zipText(await saveViaBackstage(page), "ppt/viewProps.xml");
    expect(view).toContain('showGuides="1"');
    expect(view).toContain('<p:guide orient="horz" pos="2160"/>');
    expect(view).toContain('<p:guide pos="3840"/>');
    expect(view).toContain('showRuler="1"');
  });

  test("dragging a shape in line with another shows a red smart guide (pixel probe)", async ({ page }) => {
    await openShow(page);
    await insertRectangle(page);
    await page.keyboard.press("Control+d");
    const c = await stageCentre(page);
    const left = c.x - c.w * 0.0375; // the 1-inch rectangle's left edge (13.33 in wide slide)
    // the copy sits 20 px right and down of the original: drag it far down, its left edge back over the original's
    const copy = { x: c.x + (20 * c.w) / 1280, y: c.y + (20 * c.h) / 720 };
    await page.mouse.move(copy.x, copy.y);
    await page.mouse.down();
    await page.mouse.move(copy.x - 40, copy.y + 120, { steps: 6 });
    await page.mouse.move(copy.x - (20 * c.w) / 1280 + 1, copy.y + 150, { steps: 8 });
    await expect(stage(page)).not.toHaveAttribute("data-guides", "0");
    // a red pixel on the guide line above the shapes
    const red = await (async () => {
      for (let dy = -12; dy <= 0; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const [r, g, b] = await stagePixel(page, left + dx, c.y - c.h * 0.3 + dy);
          if (r > 180 && r - g > 50 && r - b > 50) return true; // the red dashed line (anti-aliased)
        }
      }
      return false;
    })();
    await page.screenshot({ path: "test-results/p8-28-smart-guide.png" });
    await page.mouse.up();
    expect(red).toBe(true);
  });

  test("Shrink text on overflow stores a:normAutofit with fontScale", async ({ page }) => {
    await openShow(page);
    const s = await stageCentre(page);
    // the subtitle placeholder of the title slide
    await page.mouse.dblclick(s.x, s.y + s.h * 0.17);
    const editor = page.getByRole("textbox", { name: "Shape text" });
    await expect(editor).toBeVisible();
    await editor.fill(Array.from({ length: 12 }, (_, i) => `Line ${i + 1}`).join("\n"));
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("dirty")).toHaveText("Modified");
    await page.mouse.click(s.x, s.y + s.h * 0.17, { button: "right" });
    await page.getByRole("menuitem", { name: "Text Options…" }).click();
    await page.getByTestId("format-pane").getByRole("radio", { name: "Shrink text on overflow" }).check();
    await expect(page.getByTestId("fmt-font-scale")).toBeVisible();
    const slide = zipText(await saveViaBackstage(page), "ppt/slides/slide1.xml");
    expect(slide).toMatch(/<a:normAutofit fontScale="\d+" lnSpcReduction="20000"\/>/);
  });

  test("Selection pane: hiding a shape stops drawing it and saves it hidden", async ({ page }) => {
    await openShow(page);
    await insertRectangle(page);
    const c = await stageCentre(page);
    const blue = await stagePixel(page, c.x, c.y);
    expect(blue[2]).toBeGreaterThan(blue[0]); // accent 1 fill
    await page.getByRole("tab", { name: "Home" }).click();
    await ribbonCommand(page, "Editing", "Select");
    await page.getByRole("menuitemradio", { name: /Selection Pane/ }).click();
    const row = page.getByTestId("selection-row").first();
    await expect(row.getByTestId("selection-name")).toHaveText(/Rectangle/);
    await row.getByTestId("selection-eye").click();
    await expect.poll(async () => { const [r, g, b] = await stagePixel(page, c.x, c.y); return r > 240 && g > 240 && b > 240; }).toBe(true);
    await page.screenshot({ path: "test-results/p8-28-selection-pane.png" });
    expect(zipText(await saveViaBackstage(page), "ppt/slides/slide1.xml")).toMatch(/<p:cNvPr id="\d+" name="Rectangle[^"]*" hidden="1"/);
  });

  test("Slide Show › Hide Slide: the hidden slide is skipped in the show", async ({ page }) => {
    await openDeck(page);
    await page.getByTestId("thumbnail").nth(1).click();
    await page.getByRole("tab", { name: "Slide Show" }).click();
    await page.getByRole("toolbar").getByRole("button", { name: "Hide slide" }).click();
    await expect(page.getByTestId("thumbnail").nth(1)).toHaveAttribute("data-hidden", "true");
    await page.getByRole("button", { name: "From beginning" }).click();
    await expect(page.getByTestId("presenter-counter")).toHaveText("1 / 5");
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("presenter-counter")).toHaveText("2 / 5");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("slide-count")).toHaveText("Slide 3 of 6");
  });

  test("slide show: Ctrl+P pen draws session-only ink, G shows all slides", async ({ page }) => {
    await openDeck(page);
    await page.getByRole("button", { name: "Present" }).first().click();
    await expect(page.getByTestId("presenter-counter")).toHaveText("1 / 6");
    await page.keyboard.press("Control+p");
    await expect(page.getByTestId("presenter")).toHaveAttribute("data-tool", "pen");
    await page.mouse.move(400, 300);
    await page.mouse.down();
    await page.mouse.move(600, 380, { steps: 10 });
    await page.mouse.up();
    await expect(page.getByTestId("ink-layer")).toHaveAttribute("data-strokes", "1");
    await expect(page.getByTestId("presenter-counter")).toHaveText("1 / 6"); // drawing does not advance
    await page.keyboard.press("g");
    await page.getByTestId("see-all").getByRole("button", { name: "Slide 3" }).click();
    await expect(page.getByTestId("presenter-counter")).toHaveText("3 / 6");
  });

  // ----- P8-32: layouts and master text styles, picture backgrounds, table styles, presets -----

  test("Slide Master › Rename: the layout's new name shows in New Slide and is saved as p:cSld name", async ({ page }) => {
    const errors = trackErrors(page);
    await openShow(page);
    await page.getByRole("tab", { name: "View" }).click();
    await page.getByRole("button", { name: "Slide Master" }).click();
    await expect(stage(page)).toHaveAttribute("data-master-view", "title");
    await page.getByRole("button", { name: "Rename", exact: true }).click();
    const dlg = page.getByRole("dialog", { name: "Rename Layout" });
    await dlg.getByLabel("Layout name").fill("Opening");
    await dlg.getByRole("button", { name: "Rename" }).click();
    await expect(page.getByTestId("master-panel").getByRole("button", { name: "Opening" })).toBeVisible();
    await page.getByRole("button", { name: "Close Master View" }).click();
    await page.getByRole("tab", { name: "Home" }).click();
    await page.getByRole("button", { name: "Slide layouts" }).first().click();
    await expect(page.getByRole("group", { name: "Slide layouts" }).getByRole("button", { name: "Opening" })).toBeVisible();
    await page.keyboard.press("Escape");
    const layouts = [...unzip(await saveViaBackstage(page))].filter(([n]) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(n)).map(([, b]) => b.toString());
    expect(layouts.some((x) => x.includes('type="title"') && x.includes('<p:cSld name="Opening">'))).toBe(true);
    errors.expectNone();
  });

  test("Format Background › Picture or texture fill is saved as a:blipFill in p:bg", async ({ page }) => {
    const errors = trackErrors(page);
    await openShow(page);
    await page.getByRole("tab", { name: "Design" }).click();
    await page.getByRole("button", { name: "Format Background" }).click();
    const pane = page.getByRole("complementary", { name: "Format Background" });
    await pane.getByLabel("Picture or texture fill").check();
    // a 2 × 2 PNG
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP4z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==", "base64");
    await pane.getByTestId("bg-picture-file").setInputFiles({ name: "paper.png", mimeType: "image/png", buffer: png });
    await expect(page.getByTestId("dirty")).toHaveText("Modified");
    await pane.getByTestId("bg-tile").check();
    await expect(pane.getByTestId("bg-tile")).toBeChecked();
    const pptx = unzip(await saveViaBackstage(page));
    const slide1 = pptx.get("ppt/slides/slide1.xml")!.toString();
    const bg = slide1.slice(slide1.indexOf("<p:bg>"), slide1.indexOf("</p:bg>"));
    expect(bg).toContain("<a:blipFill");
    expect(bg).toContain("<a:tile");
    const rid = /<a:blip r:embed="(rId\d+)"/.exec(bg)![1];
    expect(pptx.get("ppt/slides/_rels/slide1.xml.rels")!.toString()).toMatch(new RegExp(`Id="${rid}"[^>]*Target="../media/image\\d+\\.png"`));
    errors.expectNone();
  });

  test("Table Design › Medium Style 2 – Accent 3 writes its GUID and tableStyles.xml defines it", async ({ page }) => {
    const errors = trackErrors(page);
    await openShow(page);
    await insertTable(page, 3, 3);
    await page.getByRole("tab", { name: "Table Design" }).click();
    await page.getByRole("button", { name: "More table styles" }).click();
    const menu = page.getByTestId("table-styles-menu");
    await expect(menu.getByRole("heading")).toHaveText(["Light", "Medium", "Dark"]);
    await menu.getByRole("group", { name: "Medium" }).getByRole("button", { name: "Medium Style 2 – Accent 3" }).click();
    await expect(page.getByTestId("dirty")).toHaveText("Modified");
    const pptx = unzip(await saveViaBackstage(page));
    const guid = "{F5AB1C69-6EDB-4FF4-983F-18BD219EF322}";
    expect(pptx.get("ppt/slides/slide1.xml")!.toString()).toContain(`<a:tableStyleId>${guid}</a:tableStyleId>`);
    const styles = pptx.get("ppt/tableStyles.xml")!.toString();
    expect(styles).toContain(`styleId="${guid}" styleName="Medium Style 2 - Accent 3"`);
    // the cells carry no spelled-out style fills any more
    expect(pptx.get("ppt/slides/slide1.xml")!.toString()).not.toContain("<a:tcPr><a:solidFill>");
    errors.expectNone();
  });

  test("Insert › Shapes › Arrow: U-turn inserts and saves prst=uturnArrow", async ({ page }) => {
    const errors = trackErrors(page);
    await openShow(page);
    await page.getByRole("tab", { name: "Insert" }).click();
    await page.getByRole("button", { name: "Shapes" }).click();
    await page.getByRole("dialog", { name: "Shapes" }).getByRole("group", { name: "Block arrows" }).getByRole("button", { name: "Arrow: U-turn" }).press("Enter");
    await expect(page.getByRole("tab", { name: "Shape Format" })).toBeVisible();
    // the core's handles: five yellow diamonds once the outline arrived
    await expect(stage(page)).toHaveAttribute("data-adjust-handles", "5");
    const slide1 = zipText(await saveViaBackstage(page), "ppt/slides/slide1.xml");
    expect(slide1).toContain('prst="uturnArrow"');
    expect(slide1).toContain('name="U-Turn Arrow');
    errors.expectNone();
  });

  test("Slide Master › Text level 2 colour goes to the master's body style; slides' level-2 text inherits it", async ({ page }) => {
    const errors = trackErrors(page);
    await openShow(page);
    // a Title and Content slide with a level-2 bullet
    await page.getByRole("button", { name: "New Slide" }).first().click();
    await expect(page.getByTestId("slide-count")).toHaveText("Slide 2 of 2");
    await page.getByRole("tab", { name: "View" }).click();
    await page.getByRole("button", { name: "Slide Master" }).click();
    await page.getByTestId("master-panel").getByRole("button", { name: "Slide master" }).click();
    await expect(stage(page)).toHaveAttribute("data-master-view", "master");
    const c = await stageCentre(page);
    await page.mouse.click(c.x, c.y + c.h * 0.15); // the body placeholder
    await page.getByTestId("master-level").selectOption("1");
    await page.getByRole("tab", { name: "Home" }).click();
    await page.getByRole("button", { name: "Text color" }).click();
    await page.getByRole("button", { name: "Standard color C00000" }).click();
    await expect(page.getByTestId("dirty")).toHaveText("Modified");
    const pptx = unzip(await saveViaBackstage(page));
    const master = pptx.get("ppt/slideMasters/slideMaster1.xml")!.toString();
    const body = master.slice(master.indexOf("<p:bodyStyle>"), master.indexOf("</p:bodyStyle>"));
    const lvl1 = body.slice(body.indexOf("<a:lvl1pPr"), body.indexOf("</a:lvl1pPr>"));
    const lvl2 = body.slice(body.indexOf("<a:lvl2pPr"), body.indexOf("</a:lvl2pPr>"));
    expect(lvl2).toContain('<a:srgbClr val="C00000"/>');
    expect(lvl1).not.toContain("C00000");
    // the slide's body placeholder states no colour of its own: level 2 comes from the master
    expect(pptx.get("ppt/slides/slide2.xml")!.toString()).not.toContain("C00000");
    errors.expectNone();
  });
});

test.describe("Show quality pass (P8-40)", () => {
  test("S-02: at 1024 px the Home groups fold instead of running off the ribbon; a folded group opens its controls", async ({ page }) => {
    const errors = trackErrors(page);
    await openShow(page);
    const toolbar = page.getByTestId("ribbon-panel").getByRole("toolbar");
    // at 1400 px the whole Home tab fits
    await expect(toolbar.getByRole("group", { name: "Drawing", exact: true })).toBeVisible();
    await expect(toolbar).not.toHaveAttribute("data-collapsed-groups", /\d/);
    await page.setViewportSize({ width: 1024, height: 768 });
    for (const name of ["Home", "Insert", "Design", "Transitions", "Animations", "Slide Show", "View"]) {
      await page.getByRole("tab", { name, exact: true }).click();
      // no control outside the window
      expect(await toolbar.evaluate((el) => el.scrollWidth - el.clientWidth), name).toBeLessThanOrEqual(0);
    }
    await page.getByRole("tab", { name: "Home", exact: true }).click();
    await expect(toolbar).toHaveAttribute("data-collapsed-groups", /\d/);
    // whichever group collapsed: its button opens a popup with its controls
    const collapsed = toolbar.locator("[data-collapsed-group]").first();
    await collapsed.getByRole("button").first().click();
    const popup = page.getByTestId("ribbon-group-popup");
    await expect(popup).toBeVisible();
    expect(await popup.locator("button, select, input").count()).toBeGreaterThan(0);
    const box = (await popup.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(1024);
    await page.keyboard.press("Escape");
    await ribbonCommand(page, "Slides", "New slide");
    await expect(page.getByTestId("slide-count")).toHaveText("Slide 2 of 2");
    // German labels: no large button's label runs into its neighbour (S-16)
    await page.getByRole("tab", { name: "View", exact: true }).click();
    const lang = toolbar.getByRole("group", { name: "Language / Sprache" });
    if ((await lang.getAttribute("data-collapsed-group")) !== null) await lang.getByRole("button").first().click();
    await page.getByRole("combobox", { name: "Language / Sprache" }).selectOption("de");
    for (const name of ["Start", "Bildschirmpräsentation", "Ansicht"]) {
      await page.getByRole("tab", { name, exact: true }).click();
      const over = await toolbar.evaluate((el) =>
        [...el.querySelectorAll("button")].filter((b) => b.scrollWidth > b.clientWidth + 1).map((b) => b.getAttribute("aria-label") ?? b.textContent),
      );
      expect(over, name).toEqual([]);
    }
    errors.expectNone();
  });

  test("S-15: Ctrl+B while typing in a placeholder makes the selected text bold", async ({ page }) => {
    await openShow(page);
    const c = await stageCentre(page);
    await page.mouse.dblclick(c.x, c.y - c.h * 0.1);
    await expect(page.getByTestId("text-overlay")).toBeFocused();
    await page.keyboard.type("Quarterly Review");
    await page.keyboard.press("Shift+Home");
    await page.keyboard.press("Control+b");
    await expect(page.getByRole("button", { name: "Bold" })).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Control+k");
    await expect(page.getByTestId("link-dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    const slide1 = zipText(await saveViaBackstage(page), "ppt/slides/slide1.xml");
    expect(slide1).toMatch(/<a:rPr[^>]*\bb="1"[^>]*\/?>(<[^>]*>)*<a:t>Quarterly Review<\/a:t>/);
  });

  test("S-09: Tab and Shift+Tab select the cell's text, so typing replaces it", async ({ page }) => {
    await openShow(page);
    await insertTable(page, 3, 3);
    await cell(page, 0, 0).click({ force: true });
    await page.keyboard.type("A");
    await page.keyboard.press("Tab");
    await page.keyboard.type("B");
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.type("C");
    await page.keyboard.press("Escape");
    const slide1 = zipText(await saveViaBackstage(page), "ppt/slides/slide1.xml");
    const texts = [...slide1.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]);
    expect(texts).toContain("C");
    expect(texts).toContain("B");
    expect(texts).not.toContain("AC");
  });

  test("S-05: nudging glued shapes together with their connectors keeps the connectors' routes", async ({ page }) => {
    await openShow(page);
    await openViaBackstage(page, testdata("pptx/provisional-28-flowchart.pptx"));
    await expect(page.getByTestId("slide-count")).toHaveText("Slide 1 of 2");
    const box = (await stage(page).boundingBox())!;
    await page.mouse.click(box.x + 5, box.y + 5);
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Shift+ArrowRight");
    await expect(page.getByTestId("dirty")).toHaveText("Modified");
    const slide1 = zipText(await saveViaBackstage(page), "ppt/slides/slide1.xml");
    // the first connector (Start → Read): straight, 360 × 720360 EMU, moved 10 px (95250 EMU) to the right
    const first = slide1.slice(slide1.indexOf("<p:cxnSp>"), slide1.indexOf("</p:cxnSp>"));
    expect(first).toContain('prst="straightConnector1"');
    expect(first).toContain('<a:off x="1355250" y="1080000"/><a:ext cx="360" cy="720360"/>');
  });
});

