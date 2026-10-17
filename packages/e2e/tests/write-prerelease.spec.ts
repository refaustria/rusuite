// P8-46: regression tests of the Write pre-release fixes (docs/qa/write-2026-10.md W-03, W-28, W-30, W-26, W-18).
import { expect, test, type Page } from "@playwright/test";
import { saveViaBackstage, testdata, trackErrors } from "../support/common";
import { zipText } from "../support/zip";

const editor = (page: Page) => page.locator(".ProseMirror").first();

async function openWrite(page: Page) {
  await page.goto("write/");
  await editor(page).waitFor();
  await expect(page.getByTestId("status-bar")).toContainText("Saved");
  await editor(page).click();
}

/** Types list items "one", "two", "three" into a new bulleted list. */
async function bulletList(page: Page, items = ["one", "two", "three"]) {
  const k = page.keyboard;
  await k.press("Control+Shift+l");
  for (const [i, t] of items.entries()) {
    if (i) await k.press("Enter");
    await k.type(t);
  }
  await expect(editor(page).locator("li")).toHaveCount(items.length);
}

test.describe("Write pre-release fixes (P8-46)", () => {
  test("W-03: a new bullet list uses List Paragraph (contextual spacing) on screen and in the saved file", async ({ page }) => {
    const errors = trackErrors(page);
    await openWrite(page);
    await bulletList(page);
    await expect(editor(page).locator('li > p[data-style="ListParagraph"]')).toHaveCount(3);
    // No space between the items (Normal would put 8 pt after each).
    const gaps = await page.evaluate(() => {
      const ps = [...document.querySelectorAll(".ProseMirror li > p")].map((p) => p.getBoundingClientRect());
      return ps.slice(1).map((r, i) => Math.round(r.top - ps[i]!.bottom));
    });
    expect(gaps).toEqual([0, 0]);
    const docx = await saveViaBackstage(page);
    const doc = zipText(docx, "word/document.xml");
    expect(doc.match(/<w:pStyle w:val="ListParagraph"\/>/g)).toHaveLength(3);
    const styles = zipText(docx, "word/styles.xml");
    const list = /<w:style [^>]*w:styleId="ListParagraph"[^>]*>(?:(?!<\/w:style>)[^])*<\/w:style>/.exec(styles)?.[0] ?? "";
    expect(list).toContain("<w:contextualSpacing/>");
    errors.expectNone();
  });

  test("W-28: Backspace at a list item's start removes the bullet first (indent kept), then the indent, then joins", async ({ page }) => {
    await openWrite(page);
    await bulletList(page, ["one", "two"]);
    const two = editor(page).locator("p", { hasText: "two" });
    const left = async () => (await two.boundingBox())!.x - (await editor(page).boundingBox())!.x;
    await page.keyboard.press("Home");
    await page.keyboard.press("Backspace");
    await expect(editor(page).locator("li")).toHaveCount(1);
    await expect(two).toBeVisible();
    // The paragraph keeps the level's indent (0.5", 48 px), it does not jump to the margin.
    await expect.poll(left).toBeGreaterThan(46);
    expect(await left()).toBeLessThan(50);
    // P9-W1 (Word): the second press outdents to the margin, the third joins.
    await page.keyboard.press("Backspace");
    await expect.poll(left).toBeLessThan(2);
    await page.keyboard.press("Backspace");
    await expect(editor(page).locator("li")).toHaveText(["onetwo"]);
    await expect(editor(page).locator("p", { hasText: /^two$/ })).toHaveCount(0);
  });

  test("W-30: Ctrl+] grows the selection by 1 pt (saved w:sz +2)", async ({ page }) => {
    await openWrite(page);
    await page.keyboard.type("Hello");
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Control+]");
    await page.keyboard.press("Control+Shift+k");
    const docx = await saveViaBackstage(page);
    const doc = zipText(docx, "word/document.xml");
    // Normal is 11 pt (w:sz 22): the run is 12 pt.
    expect(doc).toMatch(/<w:r><w:rPr>(?:(?!<\/w:rPr>).)*<w:sz w:val="24"\/>(?:(?!<\/w:rPr>).)*<\/w:rPr><w:t[^>]*>Hello<\/w:t>/);
    expect(doc).toContain("<w:smallCaps/>");
  });

  test.describe("in German", () => {
    test.use({ locale: "de-DE" });

    test("W-26: the reader's warning of provisional-42 (right-to-left paragraph) is shown in German", async ({ page }) => {
      await page.goto("write/");
      await editor(page).waitFor();
      await page.getByRole("tab", { name: "Datei", exact: true }).click();
      const chooser = page.waitForEvent("filechooser");
      await page.getByTestId("backstage").getByRole("button", { name: /^Öffnen/ }).click();
      // (provisional-56's "list level linked to a style" warning is gone: P9-W1 reads the style links.)
      await (await chooser).setFiles(testdata("docx", "provisional-42-unicode.docx"));
      const w = page.getByTestId("warnings");
      await expect(w).toContainText("Absatzrichtung von rechts nach links verworfen");
      await expect(w).not.toContainText("right-to-left");
      expect(await w.getAttribute("title")).not.toContain("dropped");
    });
  });

  test("W-18: a landscape section's sheet is wider than the portrait sheet before it, both centred", async ({ page }) => {
    const errors = trackErrors(page);
    await openWrite(page);
    await page.keyboard.type("Portrait section with some text to fill a line or two of the page. ".repeat(3).trim());
    await page.getByRole("tab", { name: "Layout" }).click();
    await page.getByRole("button", { name: "Breaks" }).click();
    await page.getByRole("menu").getByText("Next page", { exact: true }).click();
    await page.keyboard.type("Landscape section with some text to fill a line or two of the page. ".repeat(3).trim());
    await page.getByRole("button", { name: "Orientation" }).click();
    await page.getByRole("menu").getByText("Landscape").click();
    const chrome = page.getByTestId("page-chrome");
    // "x,width;x,width": the landscape sheet (second) is wider, the portrait one is moved to the centre.
    await expect
      .poll(async () => ((await chrome.getAttribute("data-sheets")) ?? "").split(";").map((s) => Number(s.split(",")[1])))
      .toEqual([794, 1123]);
    const sheets = await page.locator(".page-sheet").evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ x: r.x, width: r.width, height: r.height })));
    expect(sheets).toHaveLength(2);
    const [p, l] = sheets as [{ x: number; width: number; height: number }, { x: number; width: number; height: number }];
    expect(l.width).toBeGreaterThan(p.width + 200);
    expect(l.height).toBeLessThan(p.height);
    // Centred: the portrait sheet's middle is the landscape sheet's middle.
    expect(Math.abs(p.x + p.width / 2 - (l.x + l.width / 2))).toBeLessThan(2);
    // Each text column sits inside its own sheet at its margins; the landscape lines are longer.
    const text = async (t: string) => (await editor(page).locator("p", { hasText: t }).first().boundingBox())!;
    const pt = await text("Portrait section");
    const lt = await text("Landscape section");
    expect(pt.x - p.x).toBeGreaterThan(90);
    expect(pt.x - p.x).toBeLessThan(100);
    expect(lt.x - l.x).toBeGreaterThan(90);
    expect(lt.x - l.x).toBeLessThan(100);
    expect(lt.width).toBeGreaterThan(pt.width + 200);
    // The scroll area is as wide as the landscape page.
    const frame = (await page.getByTestId("write-page").boundingBox())!;
    expect(Math.abs(frame.width - l.width)).toBeLessThan(2);
    await page.screenshot({ path: "../../shots/P8-46-w18-mixed-sections.png" });
    errors.expectNone();
  });
});
