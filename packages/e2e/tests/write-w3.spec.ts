// P9-W3: Write styles round 2, templates and document properties – Create a Style makes a linked pair and a partial
// selection gets its character half, Design › Style Sets › Shaded survives save → reopen, File › New › Memo opens a
// document from the shipped template, File › Info › Title fills dc:title and a TITLE field, the Font dialog's small
// caps and expanded spacing are saved, Save As › Word Template writes a .dotx.
import fs from "node:fs";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { fileCommand, openViaBackstage, saveViaBackstage, trackErrors } from "../support/common";
import { zipText } from "../support/zip";

const SHOTS = "../../shots";
const editor = (page: Page) => page.locator(".ProseMirror").first();

async function openWrite(page: Page) {
  await page.goto("write/");
  await editor(page).waitFor();
  await expect(page.getByTestId("status-bar")).toContainText("Saved");
  await editor(page).click();
}

/** Selects `text` inside the first paragraph containing it (and waits until ProseMirror has the selection). */
async function selectText(page: Page, text: string) {
  await page.evaluate((t) => {
    const root = document.querySelector(".ProseMirror")!;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const i = n.textContent!.indexOf(t);
      if (i < 0) continue;
      const r = document.createRange();
      r.setStart(n, i);
      r.setEnd(n, i + t.length);
      const s = window.getSelection()!;
      s.removeAllRanges();
      s.addRange(r);
      return;
    }
    throw new Error(`${t} not found`);
  }, text);
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(text);
}

async function saveAndReopen(page: Page, info: TestInfo, name: string): Promise<Buffer> {
  const docx = await saveViaBackstage(page);
  const file = info.outputPath(name);
  fs.writeFileSync(file, docx);
  await openViaBackstage(page, file);
  await expect(page.getByTestId("status-bar")).toContainText("Saved");
  return docx;
}

test.describe("Write styles round 2, templates and properties (P9-W3)", () => {
  test("Create a Style makes a linked pair; applied to part of a paragraph it formats the text as its character half", async ({ page }) => {
    const errors = trackErrors(page);
    await openWrite(page);
    await page.keyboard.type("Callout text");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Plain words here");
    await selectText(page, "Callout text");
    await page.getByRole("button", { name: "Bold" }).click();
    await expect(editor(page).locator("strong")).toHaveText("Callout text");
    await page.getByRole("button", { name: "More styles" }).click();
    await page.getByRole("button", { name: "Create a Style…" }).click();
    const dlg = page.getByRole("dialog", { name: "Create New Style from Formatting" });
    await dlg.getByLabel("Name").fill("Callout");
    await dlg.getByRole("button", { name: "OK" }).click();
    await expect(editor(page).locator('p[data-style="Callout"]')).toHaveText("Callout text");
    // Part of the second paragraph: the linked style's character half.
    await selectText(page, "words");
    await page.getByRole("group", { name: "Paragraph styles" }).getByRole("button", { name: "Callout" }).click();
    const run = editor(page).locator('span[data-cstyle="CalloutChar"]');
    await expect(run).toHaveText("words");
    await expect(run).toHaveCSS("font-weight", "700");
    await expect(editor(page).locator("p", { hasText: "Plain words here" })).not.toHaveAttribute("data-style", "Callout");
    await page.screenshot({ path: `${SHOTS}/P9-W3-linked-style.png` });
    const docx = await saveViaBackstage(page);
    const styles = zipText(docx, "word/styles.xml");
    expect(styles).toMatch(/<w:style w:type="paragraph" w:customStyle="1" w:styleId="Callout">(?:(?!<\/w:style>)[^])*<w:link w:val="CalloutChar"\/>/);
    expect(styles).toMatch(/<w:style w:type="character" w:customStyle="1" w:styleId="CalloutChar">(?:(?!<\/w:style>)[^])*<w:link w:val="Callout"\/>/);
    const doc = zipText(docx, "word/document.xml");
    expect(doc).toContain('<w:rStyle w:val="CalloutChar"/>');
    expect(doc.match(/<w:pStyle w:val="Callout"\/>/g)).toHaveLength(1);
    errors.expectNone();
  });

  test("Design › Style Sets › Shaded shades the headings and survives save → reopen", async ({ page }, info) => {
    const errors = trackErrors(page);
    await openWrite(page);
    await page.keyboard.type("Chapter one");
    await page.keyboard.press("Control+Alt+1");
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Body text.");
    const heading = editor(page).locator("h1", { hasText: "Chapter one" });
    await expect(heading).toHaveCSS("text-transform", "none");
    await page.getByRole("tab", { name: "Design" }).click();
    const gallery = page.getByRole("group", { name: "Style Sets" });
    // Like Word, the first sets are inline; Shaded is in the ▾ gallery.
    await page.getByRole("button", { name: "More style sets" }).click();
    await page.getByTestId("style-sets-more").getByRole("button", { name: "Shaded" }).click();
    await expect(heading).toHaveCSS("text-transform", "uppercase");
    await expect(heading).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await page.getByRole("button", { name: "More style sets" }).click();
    await expect(page.getByTestId("style-sets-more").getByRole("button", { name: "Shaded" })).toHaveAttribute("aria-pressed", "true");
    await page.screenshot({ path: `${SHOTS}/P9-W3-style-set-shaded.png` });
    await page.keyboard.press("Escape");
    void gallery;
    const docx = await saveAndReopen(page, info, "shaded.docx");
    const styles = zipText(docx, "word/styles.xml");
    expect(styles).toMatch(/<w:style w:type="paragraph" w:styleId="Heading1">(?:(?!<\/w:style>)[^])*<w:shd [^>]*w:val="clear"(?:(?!<\/w:style>)[^])*<w:caps\/>/);
    const reopened = editor(page).locator("h1", { hasText: "Chapter one" });
    await expect(reopened).toHaveCSS("text-transform", "uppercase");
    await expect(reopened).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await page.getByRole("tab", { name: "Design" }).click();
    await page.getByRole("button", { name: "More style sets" }).click();
    await expect(page.getByTestId("style-sets-more").getByRole("button", { name: "Shaded" })).toHaveAttribute("aria-pressed", "true");
    errors.expectNone();
  });

  test("File › New › Memo opens an untitled document from the template", async ({ page }) => {
    const errors = trackErrors(page);
    await openWrite(page);
    await fileCommand(page, /^New/);
    const gallery = page.getByTestId("new-gallery");
    await expect(gallery).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/P9-W3-file-new.png` });
    await gallery.getByTestId("new-memo").click();
    await expect(editor(page)).toContainText("[Recipient names]");
    await expect(editor(page).locator(".doc-title")).toHaveText("Memo");
    await expect(page.getByTestId("doc-name")).toHaveText("Untitled");
    await expect(page.getByTestId("status-bar")).toContainText("Saved");
    // A plain document again when saved.
    const docx = await saveViaBackstage(page);
    expect(zipText(docx, "[Content_Types].xml")).toContain("wordprocessingml.document.main+xml");
    expect(zipText(docx, "docProps/core.xml")).toContain("<dc:title>Memo</dc:title>");
    errors.expectNone();
  });

  test("File › Info › Title goes to dc:title and updates a TITLE field", async ({ page }) => {
    const errors = trackErrors(page);
    await openWrite(page);
    await page.keyboard.type("Title: ");
    await page.getByRole("tab", { name: "Insert" }).click();
    await page.getByRole("button", { name: "Field" }).click();
    await page.getByRole("menuitem", { name: "Title" }).click();
    await page.getByRole("tab", { name: "File", exact: true }).click();
    await page.getByTestId("backstage").getByRole("button", { name: "Info" }).click();
    const panel = page.getByTestId("info-panel");
    await panel.getByLabel("Title").fill("Quarterly Report");
    await panel.getByLabel("Company").fill("ACME Corp");
    await panel.getByLabel("Company").press("Enter");
    await expect(panel.getByTestId("info-paragraphs")).toHaveText("1");
    await page.screenshot({ path: `${SHOTS}/P9-W3-info.png` });
    await page.keyboard.press("Escape");
    // Like Word, the save updates the fields (TITLE shows the new title afterwards).
    const docx = await saveViaBackstage(page);
    await expect(editor(page)).toContainText("Quarterly Report");
    expect(zipText(docx, "docProps/core.xml")).toContain("<dc:title>Quarterly Report</dc:title>");
    expect(zipText(docx, "docProps/app.xml")).toContain("<Company>ACME Corp</Company>");
    const doc = zipText(docx, "word/document.xml");
    expect(doc).toMatch(/TITLE(?:(?!<w:fldChar w:fldCharType="end"\/>)[^])*Quarterly Report/);
    errors.expectNone();
  });

  test("Font dialog: small caps and spacing expanded by 2 pt are saved as w:smallCaps / w:spacing", async ({ page }, info) => {
    const errors = trackErrors(page);
    await openWrite(page);
    await page.keyboard.type("Spaced caps");
    await selectText(page, "Spaced caps");
    await page.keyboard.press("Control+d");
    const dlg = page.getByRole("dialog", { name: "Font" });
    await dlg.getByRole("checkbox", { name: "Small caps" }).check();
    await dlg.getByRole("tab", { name: "Advanced" }).click();
    await dlg.getByRole("combobox", { name: "Spacing" }).selectOption("plus");
    await dlg.getByRole("textbox", { name: "Spacing by (pt)" }).fill("2");
    await dlg.getByRole("button", { name: "OK" }).click();
    const run = editor(page).locator("span", { hasText: "Spaced caps" }).first();
    await expect(run).toHaveCSS("font-variant-caps", "small-caps");
    await expect(run).toHaveCSS("letter-spacing", /^2\.66\d*px$/);
    const docx = await saveAndReopen(page, info, "caps.docx");
    const doc = zipText(docx, "word/document.xml");
    expect(doc).toContain("<w:smallCaps/>");
    expect(doc).toContain('<w:spacing w:val="40"/>');
    await expect(editor(page).locator("span", { hasText: "Spaced caps" }).first()).toHaveCSS("font-variant-caps", "small-caps");
    errors.expectNone();
  });

  test("Save As › Word Template downloads a .dotx with the template content type", async ({ page }) => {
    const errors = trackErrors(page);
    await openWrite(page);
    await page.keyboard.type("Letterhead");
    await page.keyboard.press("F12");
    await page.getByLabel("Save as type").selectOption("dotx");
    await page.getByLabel("File name").fill("Letterhead");
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Save", exact: true }).click()]);
    expect(dl.suggestedFilename()).toBe("Letterhead.dotx");
    const bytes = fs.readFileSync(await dl.path());
    expect(zipText(bytes, "[Content_Types].xml")).toContain("wordprocessingml.template.main+xml");
    await expect(page.getByTestId("doc-name")).toHaveText("Letterhead.dotx");
    errors.expectNone();
  });
});
