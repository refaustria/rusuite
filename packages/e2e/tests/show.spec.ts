import { expect, test, type Page } from "@playwright/test";
import { interceptPrint, openPrint, previewPages, previewPdf, openViaBackstage, printCount, saveViaBackstage, testdata, trackErrors, fileCommand } from "../support/common";
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
});

