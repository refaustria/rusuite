// P9-W4: Write drawings, pictures and floating objects round 2 – linked text boxes flow the story into the next box,
// two shapes grouped, moved and resized save as wpg:wgp, a picture cropped with the dimmed mask saves a:srcRect, a centred
// picture with "both sides" wrapping has text left and right of it, a hyperlink on a picture saves as a:hlinkClick and
// Ctrl+click opens it.
import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { openViaBackstage, saveViaBackstage, testdata, trackErrors } from "../support/common";
import { zipText } from "../support/zip";

const SHOTS = "../../shots";
const LOGO = new URL("../../../apps/write/src-tauri/icons/Square310x310Logo.png", import.meta.url).pathname;
const editor = (page: Page) => page.locator(".ProseMirror").first();

async function openWrite(page: Page) {
  await page.goto("write/");
  await editor(page).waitFor();
  await expect(page.getByTestId("status-bar")).toContainText("Saved");
  await editor(page).click();
}

/** Inserts a floating text box (Insert › Text Box › Text Box with Text Wrapping) at the caret. */
async function floatingTextBox(page: Page) {
  await page.getByRole("tab", { name: "Insert" }).click();
  await page.getByRole("button", { name: "Text Box" }).click();
  await page.getByRole("menuitem", { name: "Text Box with Text Wrapping" }).click();
}

/** Inserts the logo picture at the caret (Insert › Picture) and selects it. */
async function insertPicture(page: Page) {
  await page.getByRole("tab", { name: "Insert" }).click();
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "Picture" }).click()]);
  await chooser.setFiles(LOGO);
  const img = editor(page).locator(".inline-image-wrap img").first();
  await img.click();
  await expect(page.getByRole("tab", { name: "Picture Format" })).toBeVisible();
  return img;
}

/** Arms Insert › Shapes with `name` and draws it by dragging from (x, y) by (w, h) on the page. */
async function drawShape(page: Page, name: string, x: number, y: number, w: number, h: number) {
  await page.getByRole("tab", { name: "Insert" }).click();
  await page.getByRole("button", { name: "Shapes" }).click();
  await page.getByTestId("shape-library").getByRole("button", { name }).first().click();
  await expect(editor(page)).toHaveAttribute("data-draw-tool", /.+/);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + w / 2, y + h / 2, { steps: 4 });
  await page.mouse.move(x + w, y + h, { steps: 4 });
  await page.mouse.up();
}

test.describe("Write drawings round 2 (P9-W4)", () => {
  test("two linked text boxes: typing in the first flows the text on into the second", async ({ page }) => {
    const errors = trackErrors(page);
    await openWrite(page);
    await page.keyboard.type("Linked text boxes. ".repeat(8));
    await page.keyboard.press("Enter");
    await page.keyboard.type("The second paragraph. ".repeat(8));
    await page.keyboard.press("Control+Home");
    await floatingTextBox(page);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await editor(page).click();
    await page.keyboard.press("Control+End");
    await floatingTextBox(page);
    const boxes = page.locator(".drawing-wrap[data-kind='textBox']");
    await expect(boxes).toHaveCount(2);
    // Select the first box, Create Link, click the second one.
    await boxes.nth(0).locator(".drawing-text .ProseMirror").click();
    await page.getByRole("tab", { name: "Shape Format" }).click();
    await page.getByRole("button", { name: "Create Link" }).click();
    await boxes.nth(1).click();
    await expect(boxes.nth(1)).toHaveAttribute("data-chain", "follower");
    await expect(boxes.nth(0)).toHaveAttribute("data-chain", "head");
    // Type until the first box is full: the rest shows in the second.
    await boxes.nth(0).locator(".drawing-text .ProseMirror").click();
    await page.keyboard.type("One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen. Overflow words arrive here.");
    await expect(boxes.nth(1).locator(".chain-copy")).toContainText("arrive");
    await expect(boxes.nth(0).locator(".drawing-text")).toHaveAttribute("data-chain-overflow", "1");
    await page.screenshot({ path: `${SHOTS}/P9-W4-linked-text-boxes.png` });
    const xml = zipText(await saveViaBackstage(page), "word/document.xml");
    expect(xml).toMatch(/<wps:txbx id="1"><w:txbxContent>(?:(?!<\/w:txbxContent>)[^])*arrive here/);
    expect(xml).toContain('<wps:linkedTxbx id="1" seq="1"/>');
    errors.expectNone();
  });

  test("two shapes drawn, grouped, moved and resized save as one wpg:wgp", async ({ page }) => {
    const errors = trackErrors(page);
    await openWrite(page);
    await page.keyboard.type("Shapes to group. ".repeat(10));
    const box = (await editor(page).boundingBox())!;
    await drawShape(page, "Oval", box.x + 80, box.y + 60, 100, 60);
    const ovals = page.locator(".drawing-wrap[data-preset='ellipse']");
    await expect(ovals).toHaveCount(1);
    await drawShape(page, "Rectangle", box.x + 220, box.y + 70, 80, 50);
    const rect = page.locator(".drawing-wrap[data-preset='rect']");
    await expect(rect).toHaveCount(1);
    // Shift+click adds the oval to the selection; Arrange › Group.
    await page.keyboard.down("Shift");
    await ovals.click();
    await page.keyboard.up("Shift");
    await expect(ovals).toHaveClass(/multi-selected/);
    await page.getByRole("tab", { name: "Shape Format" }).click();
    await page.getByRole("button", { name: "Group", exact: true }).click();
    await page.getByRole("menuitem", { name: "Group", exact: true }).click();
    const group = page.locator(".drawing-wrap[data-kind='group']");
    await expect(group).toHaveCount(1);
    await expect(group.locator(".drawing-member")).toHaveCount(2);
    // Move it by dragging (Alt: no snapping) and resize it from the bottom-right handle.
    const g0 = (await group.boundingBox())!;
    await page.mouse.move(g0.x + g0.width / 2, g0.y + 4);
    await page.keyboard.down("Alt");
    await page.mouse.down();
    await page.mouse.move(g0.x + g0.width / 2 + 40, g0.y + 34, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up("Alt");
    await expect.poll(async () => Math.round((await group.boundingBox())!.x - g0.x)).toBeGreaterThan(30);
    const g1 = (await group.boundingBox())!;
    const handle = group.locator(".image-handle-se");
    const hb = (await handle.boundingBox())!;
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x + 60, hb.y + 30, { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => Math.round((await group.boundingBox())!.width - g1.width)).toBeGreaterThan(40);
    await page.screenshot({ path: `${SHOTS}/P9-W4-group.png` });
    const docx = await saveViaBackstage(page);
    const xml = zipText(docx, "word/document.xml");
    expect(xml).toContain('<mc:Choice Requires="wpg">');
    expect(xml).toMatch(/<wpg:wgp>(?:(?!<\/wpg:wgp>)[^])*prst="ellipse"(?:(?!<\/wpg:wgp>)[^])*prst="rect"/);
    // Reopened: still one group of two members.
    const file = test.info().outputPath("group.docx");
    fs.writeFileSync(file, docx);
    await openViaBackstage(page, file);
    await expect(page.locator(".drawing-wrap[data-kind='group'] .drawing-member")).toHaveCount(2);
    errors.expectNone();
  });
});

test.describe("Write pictures round 2 (P9-W4)", () => {
  test("cropping shows the dimmed mask outside the crop window and saves a:srcRect", async ({ page }) => {
    const errors = trackErrors(page);
    await openWrite(page);
    await page.keyboard.type("A picture: ");
    await insertPicture(page);
    await page.getByRole("tab", { name: "Picture Format" }).click();
    await page.getByRole("button", { name: "Crop", exact: true }).click();
    const wrap = editor(page).locator(".inline-image-wrap");
    await expect(wrap).toHaveClass(/cropping/);
    // Drag the right crop handle 60 px to the left: the cut-off part stays visible, dimmed.
    const h = (await wrap.locator(".crop-handle-e").boundingBox())!;
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await page.mouse.down();
    await page.mouse.move(h.x - 60, h.y + h.height / 2, { steps: 5 });
    await page.mouse.up();
    const mask = wrap.locator(".crop-mask:not([hidden])");
    await expect(mask).toHaveCount(1);
    await expect.poll(async () => Math.round((await mask.boundingBox())!.width)).toBeGreaterThan(50);
    await expect(mask).toHaveCSS("background-color", "rgba(0, 0, 0, 0.55)");
    await page.screenshot({ path: `${SHOTS}/P9-W4-crop-mask.png` });
    await page.keyboard.press("Enter");
    await expect(wrap).not.toHaveClass(/cropping/);
    const xml = zipText(await saveViaBackstage(page), "word/document.xml");
    expect(xml).toMatch(/<a:srcRect r="\d{4,5}"\/>/);
    errors.expectNone();
  });

  test("Wrap Text Square around a centred picture puts text on both sides of it", async ({ page }) => {
    const errors = trackErrors(page);
    await openWrite(page);
    await page.keyboard.insertText("Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ".repeat(6));
    await page.keyboard.press("Control+Home");
    const img = await insertPicture(page);
    await page.getByRole("tab", { name: "Picture Format" }).click();
    await page.getByLabel("Width (cm)").fill("4");
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Wrap Text" }).click();
    await page.getByRole("menu").getByText("Square", { exact: true }).click();
    await page.getByRole("button", { name: "Position" }).click();
    await page.getByRole("menuitemradio", { name: /Top Center/ }).click();
    const wrap = editor(page).locator(".inline-image-wrap");
    await expect(wrap).toHaveClass(/\bboth\b/);
    // Every line beside the picture has a gap for it: text left and right of the picture.
    await expect.poll(async () => editor(page).locator(".wrap-spacer").count()).toBeGreaterThan(2);
    const b = (await img.boundingBox())!;
    const sides = await page.evaluate(({ top, bottom, left, right }) => {
      const p = document.querySelector(".ProseMirror p")!;
      const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
      const r = document.createRange();
      let l = 0;
      let rr = 0;
      let inside = 0;
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        for (let i = 0; i < (n.textContent ?? "").length; i++) {
          r.setStart(n, i);
          r.setEnd(n, i + 1);
          const c = r.getClientRects()[0];
          if (!c || c.bottom < top + 2 || c.top > bottom - 2) continue;
          if (c.right <= left + 1) l++;
          else if (c.left >= right - 1) rr++;
          else if (n.textContent![i]!.trim()) inside++;
        }
      }
      return { l, rr, inside };
    }, { top: b.y, bottom: b.y + b.height, left: b.x, right: b.x + b.width });
    expect(sides.l).toBeGreaterThan(20);
    expect(sides.rr).toBeGreaterThan(20);
    expect(sides.inside).toBe(0);
    await page.screenshot({ path: `${SHOTS}/P9-W4-wrap-both-sides.png` });
    const xml = zipText(await saveViaBackstage(page), "word/document.xml");
    expect(xml).toContain('<wp:wrapSquare wrapText="bothSides"/>');
    errors.expectNone();
  });
});

test.describe("Write links on pictures (P9-W4)", () => {
  test("a hyperlink on a picture saves as a:hlinkClick and Ctrl+click opens it", async ({ page, context }) => {
    const errors = trackErrors(page);
    await context.route("https://rusuite.example/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<title>linked</title>" }));
    await openWrite(page);
    await page.keyboard.type("Click the logo: ");
    const img = await insertPicture(page);
    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog", { name: "Insert Hyperlink" });
    await dialog.getByRole("textbox", { name: "Address", exact: true }).fill("https://rusuite.example/logo");
    await dialog.getByLabel("ScreenTip").fill("The logo page");
    await dialog.getByTestId("link-ok").click();
    await expect(img).toHaveAttribute("title", /The logo page[\s\S]*Ctrl\+Click to follow link/);
    const docx = await saveViaBackstage(page);
    const xml = zipText(docx, "word/document.xml");
    const rid = /<wp:docPr [^>]*><a:hlinkClick xmlns:a="[^"]+" r:id="(rId\d+)" tooltip="The logo page"\/>/.exec(xml)?.[1];
    expect(rid).toBeTruthy();
    expect(zipText(docx, "word/_rels/document.xml.rels")).toMatch(new RegExp(`Id="${rid}"[^>]*Target="https://rusuite.example/logo" TargetMode="External"`));
    // Ctrl+click follows the link (a new tab); the picture stays.
    const [tab] = await Promise.all([context.waitForEvent("page"), img.click({ modifiers: ["Control"] })]);
    await expect.poll(() => tab.url()).toBe("https://rusuite.example/logo");
    await tab.close();
    // Remove Link (context menu) keeps the picture.
    await img.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Remove Link" }).click();
    await expect(editor(page).locator(".inline-image-wrap")).toHaveCount(1);
    await expect(img).not.toHaveAttribute("title", /Ctrl/);
    const xml2 = zipText(await saveViaBackstage(page), "word/document.xml");
    expect(xml2).not.toContain("a:hlinkClick");
    expect(xml2).toContain("<pic:pic>");
    errors.expectNone();
  });
});

void testdata;
