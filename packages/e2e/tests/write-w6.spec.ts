// P9-W6: Write comments, notes and fields round 2 – bold text and an @mention typed in a comment are saved as runs and
// people.xml, Simple Markup collapses the balloons to markers (a click opens one), a comment inside a footnote survives
// save and reopen, Convert Notes turns every footnote into an endnote, Alt+F9 shows `{ PAGE }` codes and F9 updates a
// STYLEREF field in the header.
import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { openViaBackstage, saveViaBackstage, testdata, trackErrors } from "../support/common";
import { zipText } from "../support/zip";

const SHOTS = "../../shots";
const FILE = testdata("docx", "provisional-67-comments-notes-fields-2.docx");
const editor = (page: Page) => page.locator(".ProseMirror").first();

async function openWrite(page: Page) {
  await page.goto("write/");
  await editor(page).waitFor();
  await expect(page.getByTestId("status-bar")).toContainText("Saved");
}

async function openFile(page: Page, file = FILE) {
  await openWrite(page);
  await openViaBackstage(page, file);
  await expect(editor(page)).toContainText("Methods");
}

/** Review › New Comment on the selection; answers the user name dialog the first time. */
async function newComment(page: Page) {
  await page.getByRole("tab", { name: "Review" }).click();
  await page.getByRole("button", { name: "New Comment" }).click();
  const dialog = page.getByRole("dialog", { name: "User Name" });
  if (await dialog.isVisible().catch(() => false)) {
    await dialog.getByTestId("user-name").fill("Carla Diaz");
    await dialog.getByTestId("user-ok").click();
  }
  const box = page.getByTestId("comment-draft-text");
  await expect(box).toBeVisible();
  return box;
}

test.describe("Write comments, notes and fields round 2 (P9-W6)", () => {
  test("bold text and an @mention typed in a comment are saved as runs and people.xml", async ({ page }) => {
    const errors = trackErrors(page);
    await openFile(page);
    await editor(page).getByText("Results").dblclick();
    const box = await newComment(page);
    await box.click();
    await page.keyboard.press("Control+b");
    await page.keyboard.type("Bold");
    await page.keyboard.press("Control+b");
    await page.keyboard.type(" ask @ben");
    const list = page.getByTestId("mention-list");
    await expect(list.getByTestId("mention-option")).toHaveCount(1);
    await expect(list).toContainText("ben.cole@example.com");
    await page.keyboard.press("Enter");
    await expect(list).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/P9-W6-mention.png` });
    await page.keyboard.press("Control+Enter");
    const mention = page.getByTestId("comment-mention").filter({ hasText: "@Ben Cole" });
    await expect(mention.first()).toBeVisible();
    const docx = await saveViaBackstage(page);
    const comments = zipText(docx, "word/comments.xml");
    expect(comments).toMatch(/<w:b\/>(?:(?!<\/w:r>)[^])*<w:t>Bold<\/w:t>/);
    expect(comments).toContain('<w:rStyle w:val="Mention"/>');
    expect(comments).toContain("@Ben Cole");
    const rels = zipText(docx, "word/_rels/comments.xml.rels");
    expect(rels).toContain("mailto:ben.cole@example.com");
    const people = zipText(docx, "word/people.xml");
    expect(people).toContain('w15:author="Carla Diaz"');
    expect(people).toContain('w15:providerId="AD" w15:userId="ben.cole@example.com"');
    errors.expectNone();
  });

  test("Simple Markup collapses the balloons to markers; a click opens one", async ({ page }) => {
    const errors = trackErrors(page);
    await openFile(page);
    const margin = page.getByTestId("comments-margin");
    await expect(margin.getByTestId("comment-thread").first()).toBeVisible();
    await page.getByRole("tab", { name: "Review" }).click();
    await page.getByTestId("markup-mode").selectOption("simple");
    await expect(margin.getByTestId("comment-thread")).toHaveCount(0);
    const markers = margin.getByTestId("comment-indicator");
    await expect(markers.first()).toBeVisible();
    await markers.first().click();
    const open = page.getByTestId("comment-open-balloon");
    await expect(open).toBeVisible();
    await expect(open.getByTestId("comment-text").first()).toContainText("check");
    await page.screenshot({ path: `${SHOTS}/P9-W6-simple-markup.png` });
    await page.getByTestId("markup-mode").selectOption("none");
    await expect(margin).toHaveCount(0);
    await page.getByTestId("markup-mode").selectOption("all");
    await expect(page.getByTestId("comments-margin").getByTestId("comment-thread").first()).toBeVisible();
    errors.expectNone();
  });

  test("a comment inside a footnote survives save and reopen", async ({ page }) => {
    const errors = trackErrors(page);
    await openWrite(page);
    await editor(page).click();
    await page.keyboard.type("Body text");
    await page.keyboard.press("Control+Alt+f");
    await page.keyboard.type("note words here");
    const word = editor(page).locator(".note").getByText("note words here");
    await word.dblclick();
    const box = await newComment(page);
    await box.click();
    await page.keyboard.type("Inside the note");
    await page.keyboard.press("Control+Enter");
    await expect(page.getByTestId("comment-text").filter({ hasText: "Inside the note" }).first()).toBeVisible();
    await expect(editor(page).locator(".note [data-comment-start]")).toHaveCount(1);
    const docx = await saveViaBackstage(page);
    expect(zipText(docx, "word/footnotes.xml")).toContain("<w:commentRangeStart ");
    const file = test.info().outputPath("note-comment.docx");
    fs.writeFileSync(file, docx);
    await openViaBackstage(page, file);
    await expect(editor(page)).toContainText("Body text");
    await expect(editor(page).locator(".note [data-comment-start]")).toHaveCount(1);
    await expect(page.getByTestId("comment-text").filter({ hasText: "Inside the note" }).first()).toBeVisible();
    errors.expectNone();
  });

  test("Convert Notes turns every footnote into an endnote", async ({ page }) => {
    const errors = trackErrors(page);
    await openFile(page);
    await page.getByRole("tab", { name: "References" }).click();
    await page.getByRole("button", { name: "Footnote and Endnote…" }).click();
    await page.getByTestId("note-dialog-convert").click();
    const dialog = page.getByTestId("convert-notes-dialog");
    await dialog.getByTestId("convert-footToEnd").check();
    await dialog.getByTestId("convert-ok").click();
    await expect(dialog).toHaveCount(0);
    await expect(editor(page).locator(".note[data-kind='end'], .note[data-note-kind='end']").first()).toBeAttached();
    const docx = await saveViaBackstage(page);
    expect(zipText(docx, "word/document.xml")).toContain("<w:endnoteReference ");
    expect(zipText(docx, "word/document.xml")).not.toContain("<w:footnoteReference ");
    expect(zipText(docx, "word/endnotes.xml")).toContain("A footnote with a");
    errors.expectNone();
  });

  test("Alt+F9 shows { PAGE } codes and F9 updates a STYLEREF field in the header", async ({ page }) => {
    const errors = trackErrors(page);
    await openFile(page);
    const header = page.getByTestId("page-header");
    await expect(header).toContainText("Chapter: Methods");
    // Insert › Field › Field…: PAGE at the end of the last paragraph.
    await editor(page).locator("p").last().click();
    await page.keyboard.press("End");
    await page.getByRole("tab", { name: "Insert" }).click();
    await page.getByRole("button", { name: "Field", exact: true }).click();
    await page.getByRole("menuitem", { name: "Field…" }).click();
    const dialog = page.getByTestId("field-dialog");
    await dialog.getByTestId("field-name-PAGE").click();
    await expect(dialog.getByTestId("field-code")).toHaveText("{ PAGE }");
    await dialog.getByTestId("field-ok").click();
    await expect(editor(page).locator(".field[data-field='page']")).toHaveCount(1);
    await editor(page).click();
    await page.keyboard.press("Alt+F9");
    await expect(editor(page).locator(".field-show-code[data-code='{ PAGE }']")).toHaveCount(1);
    await expect(editor(page).locator(".field-show-code[data-code^='{ SEQ Figure']")).toHaveCount(2);
    await page.screenshot({ path: `${SHOTS}/P9-W6-field-codes.png` });
    await page.keyboard.press("Alt+F9");
    await expect(editor(page).locator(".field-show-code")).toHaveCount(0);
    // Rename the heading, then Ctrl+A F9: the header's STYLEREF follows.
    await editor(page).getByText("Methods").click();
    await page.keyboard.press("End");
    await page.keyboard.type(" and tools");
    await page.keyboard.press("Control+a");
    await page.keyboard.press("F9");
    await expect(header).toContainText("Chapter: Methods and tools");
    const docx = await saveViaBackstage(page);
    expect(zipText(docx, "word/header1.xml")).toContain("Methods and tools");
    // The locked DATE field kept its result.
    expect(zipText(docx, "word/document.xml")).toContain("1.1.2020");
    errors.expectNone();
  });
});
