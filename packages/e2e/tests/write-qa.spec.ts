// P8-38: regression tests of the Write quality pass (docs/qa/write-2026-10.md, one test per fixed W-item or group).
import { expect, test, type Page } from "@playwright/test";
import { ribbonCommand, saveViaBackstage, trackErrors } from "../support/common";
import { zipText } from "../support/zip";

const editor = (page: Page) => page.locator(".ProseMirror").first();
const LOGO = new URL("../../../apps/write/src-tauri/icons/Square310x310Logo.png", import.meta.url).pathname;

async function openWrite(page: Page) {
  await page.goto("write/");
  await editor(page).waitFor();
  await expect(page.getByTestId("status-bar")).toContainText("Saved");
  await editor(page).click();
}

/** The bottom of the last text line and the top of the white cover below the content on page 1. */
async function lastLineAndCover(page: Page) {
  return page.evaluate(() => {
    const ps = [...document.querySelectorAll(".ProseMirror p")];
    const last = ps[ps.length - 1]!.getBoundingClientRect();
    const covers = [...document.querySelectorAll(".page-cover")].map((e) => e.getBoundingClientRect()).filter((r) => r.top > 200);
    return { bottom: last.bottom, cover: Math.min(...covers.map((r) => r.top)) };
  });
}

test.describe("Write quality pass (P8-38)", () => {
  test("W-02: the paragraph after a list is not hidden by the page cover", async ({ page }) => {
    await openWrite(page);
    const k = page.keyboard;
    await k.press("Control+Shift+l");
    await k.type("Apple");
    await k.press("Enter");
    await k.press("Enter");
    await k.type("After the list.");
    await expect.poll(async () => {
      const { bottom, cover } = await lastLineAndCover(page);
      return cover - bottom;
    }).toBeGreaterThanOrEqual(-0.5);
  });

  test("W-05: a typed word is one undo step; Backspaces in a row another", async ({ page }) => {
    await openWrite(page);
    await page.keyboard.type("First ");
    await page.keyboard.press("Enter");
    await page.keyboard.type("typed words here");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");
    await expect(editor(page)).toContainText("typed words he");
    await page.keyboard.press("Control+z");
    await expect(editor(page)).toContainText("typed words here");
    await page.keyboard.press("Control+z");
    await expect(editor(page).locator("p").nth(1)).toHaveText("");
    await page.keyboard.press("Control+y");
    await expect(editor(page)).toContainText("typed words here");
  });

  test("W-06/W-07: plain text pasted into a list makes one item per line; undo keeps the bullets", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await openWrite(page);
    const k = page.keyboard;
    await k.press("Control+Shift+l");
    await k.type("one");
    await k.press("Enter");
    await k.type("two");
    await k.press("Enter");
    await page.evaluate(() => navigator.clipboard.writeText("A\nB\n\nD"));
    await k.press("Control+v");
    const items = editor(page).locator("li");
    await expect(items).toHaveCount(6);
    await expect(items.nth(4)).toHaveText("");
    await expect(items.nth(5)).toHaveText("D");
    await k.press("Control+z");
    await expect(items).toHaveCount(3);
    await expect(editor(page).locator("li p[data-label]")).toHaveCount(3);
  });

  test("W-08: Ctrl+Z on the find bar's buttons undoes Replace all", async ({ page }) => {
    await openWrite(page);
    await page.keyboard.type("cat and cat");
    await page.keyboard.press("Control+h");
    const bar = page.getByTestId("find-bar");
    await bar.getByLabel("Find", { exact: true }).fill("cat");
    await bar.getByLabel("Replace with").fill("dog");
    await bar.getByRole("button", { name: "Replace all" }).click();
    await expect(editor(page)).toHaveText("dog and dog");
    await page.keyboard.press("Control+z");
    await expect(editor(page)).toHaveText("cat and cat");
  });

  test("W-09/W-11: Insert › Table puts the caret in the first cell; the table is a Table Grid table", async ({ page }) => {
    await openWrite(page);
    await page.keyboard.type("Before");
    await page.getByRole("tab", { name: "Insert" }).click();
    await page.getByRole("button", { name: "Table", exact: true }).click();
    await page.getByRole("button", { name: "2 × 2 table" }).click();
    await page.keyboard.type("A1");
    await page.keyboard.press("Tab");
    await page.keyboard.type("B1");
    await expect(editor(page).locator("td").first()).toHaveText("A1");
    await expect(editor(page).locator("td").nth(1)).toHaveText("B1");
    const xml = zipText(await saveViaBackstage(page), "word/document.xml");
    expect(xml).toContain('<w:tblStyle w:val="TableGrid"/>');
    expect(xml).not.toContain("<w:tblBorders>");
  });

  test("W-12/W-13/W-14: a dragged floating picture stays selected, the text after it reflows, Home has no picture group", async ({ page }) => {
    const errors = trackErrors(page);
    await openWrite(page);
    for (let i = 0; i < 4; i++) {
      await page.keyboard.insertText("Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.");
      await page.keyboard.press("Enter");
    }
    await page.keyboard.insertText("The last paragraph.");
    await page.keyboard.press("Control+Home");
    await page.getByRole("tab", { name: "Insert" }).click();
    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "Picture" }).click()]);
    await chooser.setFiles(LOGO);
    const img = editor(page).locator("img:not(.ProseMirror-separator)").first();
    await img.click();
    await page.getByRole("tab", { name: "Picture Format" }).click();
    await page.getByRole("button", { name: "Wrap Text" }).click();
    await page.getByRole("menu").getByText("Square", { exact: true }).click();
    await expect(editor(page).locator("[data-wrap=square]")).toHaveCount(1);
    const b = (await img.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + 150, b.y + b.height / 2 + 80, { steps: 6 });
    await page.mouse.up();
    await expect.poll(async () => (await img.boundingBox())!.x).toBeGreaterThan(b.x + 100);
    await expect(page.getByRole("tab", { name: "Picture Format" })).toBeVisible();
    await expect.poll(async () => {
      const { bottom, cover } = await lastLineAndCover(page);
      return cover - bottom;
    }).toBeGreaterThanOrEqual(-0.5);
    // P9-W4: the moved picture now has text on both sides; click the paragraph's text, not its middle.
    await editor(page).locator("p", { hasText: "The last paragraph." }).click({ position: { x: 5, y: 5 } });
    await expect(page.getByRole("tab", { name: "Picture Format" })).toHaveCount(0);
    await page.getByRole("tab", { name: "Home" }).click();
    await expect(page.getByTestId("ribbon-panel").getByRole("button", { name: "Crop" })).toHaveCount(0);
    errors.expectNone();
  });

  test("W-17: after Breaks › Next Page, Orientation › Landscape changes the new section", async ({ page }) => {
    await openWrite(page);
    await page.keyboard.type("Portrait section");
    await page.getByRole("tab", { name: "Layout" }).click();
    await page.getByRole("button", { name: "Breaks" }).click();
    await page.getByRole("menu").getByText("Next page", { exact: true }).click();
    await page.keyboard.type("Landscape section");
    await page.getByRole("button", { name: "Orientation" }).click();
    await page.getByRole("menu").getByText("Landscape").click();
    const xml = zipText(await saveViaBackstage(page), "word/document.xml");
    const sects = xml.match(/<w:sectPr>.*?<\/w:sectPr>/g) ?? [];
    expect(sects).toHaveLength(2);
    expect(sects[0]).not.toContain("landscape");
    expect(sects[1]).toContain('w:orient="landscape"');
    expect(xml.indexOf("Landscape section")).toBeGreaterThan(xml.indexOf(sects[0]!));
  });

  for (const [app, width] of [["write", 1400], ["write", 1024], ["calc", 1400], ["calc", 1024], ["show", 1400], ["show", 1024]] as const) {
    test(`W-19/W-20: ${app} at ${width} px: every ribbon control sits inside its group and the window`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      if (app === "write") await openWrite(page);
      else {
        await page.goto(`${app}/`);
        await expect(page.getByTestId("ribbon-panel")).toBeVisible();
      }
      const tabs = (await page.getByRole("tablist").first().getByRole("tab").allInnerTexts()).filter((t) => t !== "File");
      expect(tabs.length).toBeGreaterThan(3);
      for (const name of tabs) {
        await page.getByRole("tab", { name, exact: true }).click();
        const bad = await page.getByTestId("ribbon-panel").evaluate((panel, checkRows) => {
          const out: string[] = [];
          for (const g of panel.querySelectorAll<HTMLElement>('[role="toolbar"] > [role="group"]')) {
            const gr = g.getBoundingClientRect();
            const label = g.lastElementChild as HTMLElement;
            const lr = label.getBoundingClientRect();
            if (gr.right > window.innerWidth + 0.5) out.push(`${g.getAttribute("aria-label")}: beyond the window`);
            for (const c of g.querySelectorAll<HTMLElement>("button, input, select, label")) {
              const r = c.getBoundingClientRect();
              // Calc's and Show's group contents are their own: there only nothing may leave the window.
              if (!r.width || g.hasAttribute("data-collapsed-group") || !checkRows) continue;
              // A pixel or two of a 2-row stack on the label is tolerated; a third row is 26 px over.
              if (r.top < gr.top - 4 || r.bottom > lr.top + 4) out.push(`${g.getAttribute("aria-label")}: ${c.getAttribute("aria-label") ?? c.textContent}`);
            }
          }
          return out;
        }, app === "write");
        expect(bad, name).toEqual([]);
      }
    });
  }

  test("W-20: a group collapsed on a narrow window opens its commands", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await openWrite(page);
    await page.keyboard.type("Narrow");
    // How many groups collapse depends on the tab's contents: at least one at 1024 px.
    const collapsed = page.locator("[data-collapsed-group]");
    await expect.poll(() => collapsed.count()).toBeGreaterThan(0);
    const narrow = await collapsed.count();
    await collapsed.first().getByRole("button").first().click();
    await expect(page.getByTestId("ribbon-group-popup").getByRole("button").first()).toBeVisible();
    await page.keyboard.press("Escape");
    await ribbonCommand(page, "Editing", "Find and replace");
    await expect(page.getByTestId("find-bar")).toBeVisible();
    await expect(page.getByTestId("ribbon-group-popup")).toHaveCount(0);
    // Wider: the gallery and the formatting groups come back first (AI and Editing collapse before them).
    await page.setViewportSize({ width: 1400, height: 900 });
    await expect(page.getByTestId("ribbon-panel").getByRole("group", { name: "Styles", exact: true })).not.toHaveAttribute("data-collapsed-group", "");
    expect(await collapsed.count()).toBeLessThanOrEqual(narrow);
  });

  test("W-21: a new table of contents lists the page numbers at once", async ({ page }) => {
    await openWrite(page);
    await page.keyboard.press("Control+Alt+1");
    await page.keyboard.type("Chapter one");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Text.");
    await editor(page).locator("h1").click();
    await page.keyboard.press("Home");
    await page.getByRole("tab", { name: "References" }).click();
    await page.getByRole("button", { name: "Table of contents" }).click();
    await page.getByRole("menu").locator("[role^=menuitem]").first().click();
    await expect(editor(page).locator("[data-toc], .toc, [data-type=toc]").first()).toContainText(/Chapter one\s*1/);
  });

  test("W-23/W-25: Paragraph and Font dialogs show the values in effect; OK without changes adds no formatting", async ({ page }) => {
    await openWrite(page);
    await page.keyboard.type("Plain text.");
    await page.getByRole("button", { name: "Paragraph settings" }).click();
    const dlg = page.getByRole("dialog");
    await expect(dlg.getByLabel("After (pt)")).toHaveValue("8");
    await expect(dlg.getByLabel("Line spacing")).toHaveValue("multiple");
    await dlg.getByRole("button", { name: "OK", exact: true }).click();
    await expect(dlg).toHaveCount(0);
    await expect(editor(page)).toBeFocused();
    await page.keyboard.press("Control+d");
    await expect(page.getByRole("dialog").getByLabel("Size (pt)")).toHaveValue("11");
    await page.getByRole("dialog").getByRole("button", { name: "OK", exact: true }).click();
    const xml = zipText(await saveViaBackstage(page), "word/document.xml");
    expect(xml).toMatch(/<w:p><w:r><w:t>Plain text\.<\/w:t><\/w:r><\/w:p>/);
  });

  test("W-24: on a narrow window with the side panes the page keeps its width", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await openWrite(page);
    await page.keyboard.type("Some text on the page.");
    const width = async () => (await page.getByTestId("write-page").boundingBox())!.width;
    const before = await width();
    await page.keyboard.press("Control+Alt+Shift+s");
    await page.getByRole("tab", { name: "View", exact: true }).click();
    await page.getByLabel("Navigation Pane").check();
    await expect(page.getByText("Styles pane")).toBeVisible();
    expect(Math.abs((await width()) - before)).toBeLessThan(1);
    await expect(page.getByTestId("page-status")).toHaveText("Page 1 of 1");
  });

  test("W-27: Multilevel list with the caret in a list renumbers the whole list", async ({ page }) => {
    await openWrite(page);
    const k = page.keyboard;
    await page.getByRole("button", { name: "Numbered list" }).click();
    await k.type("One");
    await k.press("Enter");
    await k.press("Tab");
    await k.type("Sub");
    await k.press("Enter");
    await k.press("Shift+Tab");
    await k.type("Two");
    await page.getByRole("button", { name: "Multilevel list" }).click();
    await page.getByTestId("multilevel-gallery").getByRole("button", { name: "1. 1.1. 1.1.1." }).click();
    await expect.poll(() => editor(page).locator("p[data-label]").evaluateAll((els) => els.map((e) => e.getAttribute("data-label")))).toEqual(["1.", "1.1.", "2."]);
  });
});
