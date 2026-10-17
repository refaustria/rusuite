// P9-W4: Write drawings, pictures and floating objects round 2 – linked text boxes flow the story into the next box,
// two shapes grouped, moved and resized save as wpg:wgp, a picture cropped with the dimmed mask saves a:srcRect, a centred
// picture with "both sides" wrapping has text left and right of it, a hyperlink on a picture saves as a:hlinkClick and
// Ctrl+click opens it.
import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { openViaBackstage, saveViaBackstage, testdata, trackErrors } from "../support/common";
import { zipText } from "../support/zip";

const SHOTS = "../../shots";
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

void testdata;
