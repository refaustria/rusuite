// P11-N6b: Rusuite Notes import / export – OneNote sections and packages, Markdown, HTML and Word files, exports in
// every format (re-imported), rich HTML paste through the core's sanitiser, and the lazily loaded converter module:
// fetched from the same origin on first use only, never on a normal page open, and nothing else goes over the
// network. `NOTES_SHOTS=<dir>` saves screenshots (shots/P11-N6b-*.png).

import { expect, test, type Page, type Request } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { downloadBuffer, trackErrors } from "../support/common";
import { unzip } from "../support/zip";

const shots = process.env.NOTES_SHOTS;
const shot = async (page: Page, name: string) => {
  if (shots) await page.screenshot({ path: path.join(shots, `P11-N6b-${name}.png`) });
};

const testdata = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../testdata");
const sample = (rel: string) => path.join(testdata, rel);
const CONVERT = /app_notes_convert_wasm/;

/** An uncompressed cabinet (`.onepkg`) of `files` – the format OneNote's File › Export › OneNote Package writes. */
function cabinet(files: { name: string; bytes: Buffer }[]): Buffer {
  const data = Buffer.concat(files.map((f) => f.bytes));
  const blocks: Buffer[] = [];
  for (let at = 0; at < data.length || blocks.length === 0; at += 32768) {
    const chunk = data.subarray(at, Math.min(at + 32768, data.length));
    const head = Buffer.alloc(8);
    head.writeUInt32LE(0, 0); // no checksum
    head.writeUInt16LE(chunk.length, 4);
    head.writeUInt16LE(chunk.length, 6);
    blocks.push(head, chunk);
  }
  const entries: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const e = Buffer.alloc(16);
    e.writeUInt32LE(f.bytes.length, 0);
    e.writeUInt32LE(offset, 4);
    e.writeUInt16LE(0, 8); // folder 0
    e.writeUInt16LE(0x5a21, 10); // date
    e.writeUInt16LE(0, 12); // time
    e.writeUInt16LE(0x20, 14); // archive
    entries.push(e, Buffer.from(`${f.name}\0`, "latin1"));
    offset += f.bytes.length;
  }
  const fileTable = Buffer.concat(entries);
  const headerLen = 36;
  const folderLen = 8;
  const dataStart = headerLen + folderLen + fileTable.length;
  const body = Buffer.concat(blocks);
  const header = Buffer.alloc(headerLen);
  header.write("MSCF", 0, "latin1");
  header.writeUInt32LE(dataStart + body.length, 8);
  header.writeUInt32LE(headerLen + folderLen, 16);
  header.writeUInt8(3, 24);
  header.writeUInt8(1, 25);
  header.writeUInt16LE(1, 26);
  header.writeUInt16LE(files.length, 28);
  const folder = Buffer.alloc(folderLen);
  folder.writeUInt32LE(dataStart, 0);
  folder.writeUInt16LE(blocks.length / 2, 4);
  folder.writeUInt16LE(0, 6); // no compression
  return Buffer.concat([header, folder, fileTable, body]);
}

async function openNotes(page: Page) {
  await page.goto("notes/");
  await expect(page.getByTestId("page-editor")).toBeVisible();
  await expect(page.getByTestId("save-state")).toHaveAttribute("data-state", "saved");
}

const pageItems = (page: Page) => page.getByTestId("page-item");
const sectionItems = (page: Page) => page.getByTestId("section-item");
const editor = (page: Page) => page.getByTestId("page-editor");

/** Requests to anywhere but this site (data:/blob: URLs are local). */
function audit(page: Page) {
  const all: Request[] = [];
  page.on("request", (r) => all.push(r));
  return {
    all,
    foreign: () => {
      const origin = new URL(page.url()).origin;
      return all.map((r) => r.url()).filter((u) => !u.startsWith(origin) && !/^(data|blob):/.test(u));
    },
    convert: () => all.filter((r) => CONVERT.test(r.url())).map((r) => r.url()),
  };
}

async function fileMenu(page: Page, name: string) {
  await page.getByRole("tab", { name: "File", exact: true }).click();
  await page.getByTestId("backstage").getByRole("button", { name }).first().click();
}

/** File › Import… → one of the formats → the file chooser with `files`. */
async function importVia(page: Page, kind: "oneNote" | "markdown" | "html" | "docx", files: (string | { name: string; mimeType: string; buffer: Buffer })[]) {
  await fileMenu(page, "Import…");
  await expect(page.getByTestId("import-dialog")).toBeVisible();
  const chooser = page.waitForEvent("filechooser");
  await page.getByTestId(`import-${kind}`).click();
  await (await chooser).setFiles(files as never);
  await expect(page.getByTestId("import-result")).toBeVisible({ timeout: 30_000 });
}

/** Drops files onto the navigation pane (a synthetic drop with a DataTransfer). */
async function dropOnNav(page: Page, files: { name: string; bytes: Buffer }[]) {
  await page.evaluate((files) => {
    const dt = new DataTransfer();
    for (const f of files) dt.items.add(new File([new Uint8Array(f.bytes)], f.name));
    const nav = document.querySelector('[data-testid="nav-pane"]')!;
    nav.dispatchEvent(new DragEvent("dragover", { dataTransfer: dt, bubbles: true, cancelable: true }));
    nav.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, files.map((f) => ({ name: f.name, bytes: Array.from(f.bytes) })));
}

/** File › Export… with a scope and a format → the download. */
async function exportVia(page: Page, scope: "page" | "section", format: "md" | "html" | "docx") {
  await fileMenu(page, "Export…");
  await expect(page.getByTestId("export-dialog")).toBeVisible();
  await page.getByTestId(`export-scope-${scope}`).check();
  await page.getByTestId(`export-format-${format}`).check();
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-run").click()]);
  return { name: dl.suggestedFilename(), bytes: await downloadBuffer(dl) };
}

async function pasteHtml(page: Page, html: string, text = "") {
  await page.evaluate(
    ([html, text]) => {
      const dt = new DataTransfer();
      dt.setData("text/html", html!);
      if (text) dt.setData("text/plain", text);
      document.querySelector(".ProseMirror")!.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    },
    [html, text],
  );
}

const docJson = (page: Page) =>
  page.evaluate(() => (document.querySelector(".ProseMirror") as unknown as { editor: { getJSON(): unknown } }).editor.getJSON()) as Promise<{
    content: { type: string; attrs?: Record<string, unknown>; content?: unknown[] }[];
  }>;

async function newPage(page: Page) {
  await page.getByTestId("new-page").click();
  await expect(page.getByTestId("page-title")).toHaveValue("");
  await editor(page).click();
}

test.describe("Notes import / export (P11-N6b)", () => {
  test("a normal page open and a plain-text paste do not load the converter module", async ({ page }) => {
    const errors = trackErrors(page);
    const net = audit(page);
    await openNotes(page);
    await newPage(page);
    await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.setData("text/plain", "just text");
      document.querySelector(".ProseMirror")!.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    await expect(editor(page)).toContainText("just text");
    await page.waitForLoadState("networkidle");
    expect(net.convert()).toEqual([]);
    expect(net.foreign()).toEqual([]);
    errors.expectNone();
  });

  test("OneNote sections (.one) and a package (.onepkg): tree, titles, a picture, an ink canvas page", async ({ page }) => {
    const errors = trackErrors(page);
    const net = audit(page);
    await openNotes(page);
    await page.getByRole("tab", { name: "File", exact: true }).click();
    await expect(page.getByTestId("backstage").getByRole("button", { name: "Import…" })).toBeVisible();
    await shot(page, "backstage");
    await page.getByTestId("backstage-back").click();
    await importVia(page, "oneNote", [sample("onenote/notebook/New Section 1.one"), sample("onenote/notebook/New Section Group/New Section 2.one"), sample("onenote/handwriting_recognition.one")]);
    const counts = page.getByTestId("import-counts");
    await expect(counts).toContainText("3 sections");
    await expect(counts).toContainText(/\d+ pictures?/);
    await shot(page, "import-result");
    // The converter module came from this site, once.
    expect(net.convert().length).toBeGreaterThanOrEqual(1);
    const origin = new URL(page.url()).origin;
    for (const u of net.convert()) expect(u.startsWith(origin)).toBe(true);
    await page.getByTestId("import-open").click();
    await expect(page.getByTestId("import-result")).toBeHidden();
    await expect(sectionItems(page).filter({ hasText: "New Section 1" })).toBeVisible();
    await expect(sectionItems(page).filter({ hasText: "New Section 2" })).toBeVisible();
    await expect(sectionItems(page).filter({ hasText: "handwriting_recognition" })).toBeVisible();

    // A picture (New Section 2 › Test Page 3).
    await sectionItems(page).filter({ hasText: "New Section 2" }).click();
    await expect(pageItems(page)).toHaveText([/Test Page 3/, /Test Page 4/]);
    await pageItems(page).filter({ hasText: "Test Page 3" }).click();
    const img = editor(page).getByTestId("image").locator("img");
    await expect(img).toBeVisible();
    expect(await img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
    await shot(page, "onenote-picture");

    // Ink: a canvas page.
    await sectionItems(page).filter({ hasText: "handwriting_recognition" }).click();
    await expect(page.getByTestId("canvas-surface")).toBeVisible();
    await expect(page.locator('[data-testid^="ink-layer-"] path, [data-testid^="ink-layer-"] polyline').first()).toBeAttached();
    await shot(page, "onenote-ink");

    // A package dropped on the navigation pane: a new notebook.
    const group = "onenote/notebook/New Section Group";
    const pkg = cabinet([
      { name: "Open Notebook.onetoc2", bytes: fs.readFileSync(sample(`${group}/Open Notebook.onetoc2`)) },
      { name: "New Section 2.one", bytes: fs.readFileSync(sample(`${group}/New Section 2.one`)) },
      { name: "New Section 1.one", bytes: fs.readFileSync(sample(`${group}/New Section 1.one`)) },
    ]);
    await dropOnNav(page, [{ name: "Work Notes.onepkg", bytes: pkg }]);
    await expect(page.getByTestId("import-result")).toBeVisible();
    await expect(page.getByTestId("import-counts")).toContainText("1 notebook");
    await expect(page.getByTestId("import-counts")).toContainText("3 pages");
    await page.getByTestId("import-open").click();
    await expect(page.getByTestId("notebook-name")).toHaveText("Work Notes");
    await expect(sectionItems(page)).toHaveText([/New Section 1/, /New Section 2/]);
    await expect(page.getByTestId("save-state")).toHaveAttribute("data-state", "saved");

    // It is stored: after a reload the notebook and its pages are still there.
    await page.reload();
    await expect(page.getByTestId("page-editor").or(page.getByTestId("canvas-surface")).first()).toBeVisible();
    await page.getByTestId("notebook-switcher").click();
    await expect(page.getByTestId("notebook-list")).toContainText("Work Notes");
    expect(net.foreign()).toEqual([]);
    errors.expectNone();
  });

  test("Markdown, HTML and Word files become pages with their headings and text", async ({ page }) => {
    const errors = trackErrors(page);
    const net = audit(page);
    await openNotes(page);
    await importVia(page, "markdown", [
      { name: "Plan.md", mimeType: "text/markdown", buffer: Buffer.from("# Weekly plan\n\n## Monday\n\n- ship **it**\n- [ ] review\n") },
      { name: "Ideas.md", mimeType: "text/markdown", buffer: Buffer.from("Just an idea with a [link](https://example.com/).\n") },
    ]);
    await expect(page.getByTestId("import-counts")).toContainText("2 pages");
    await page.getByTestId("import-open").click();
    await expect(page.getByTestId("page-title")).toHaveValue("Weekly plan");
    await expect(editor(page).locator("h2")).toHaveText("Monday");
    await expect(editor(page).locator("strong")).toHaveText("it");
    await expect(pageItems(page).filter({ hasText: "Ideas" })).toBeVisible();

    await importVia(page, "html", [
      { name: "page.html", mimeType: "text/html", buffer: Buffer.from('<html><head><title>From the web</title><script>alert(1)</script></head><body><h2>Hello</h2><p onclick="x()">Some <b>bold</b> text</p><img src="https://tracker.example/pixel.png" alt="pixel"></body></html>') },
    ]);
    await expect(page.getByTestId("import-warnings")).toBeVisible();
    await shot(page, "import-warnings");
    await page.getByTestId("import-open").click();
    await expect(page.getByTestId("page-title")).toHaveValue("From the web");
    await expect(editor(page).locator("h2")).toHaveText("Hello");
    await expect(editor(page)).toContainText("Some bold text");
    await expect(editor(page).locator("script, [onclick]")).toHaveCount(0);

    await importVia(page, "docx", [sample("docx/provisional-07-title-headings.docx")]);
    await page.getByTestId("import-open").click();
    await expect(editor(page)).toContainText("First chapter");
    await expect(editor(page)).toContainText("The quick brown fox jumps over the lazy dog.");
    await expect(editor(page).locator("h1, h2, h3").first()).toBeVisible();
    // Remote images are never fetched.
    expect(net.foreign()).toEqual([]);
    errors.expectNone();
  });

  test("exports: page as Markdown, HTML and Word, section as a Markdown zip – re-imported with the same text", async ({ page }) => {
    const errors = trackErrors(page);
    const net = audit(page);
    await openNotes(page);
    await importVia(page, "markdown", [{ name: "Round trip.md", mimeType: "text/markdown", buffer: Buffer.from("# Round trip\n\n## Part one\n\nSome **bold** and *italic* text.\n\n- first\n- second\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n") }]);
    await page.getByTestId("import-open").click();
    await expect(page.getByTestId("page-title")).toHaveValue("Round trip");

    const md = await exportVia(page, "page", "md");
    expect(md.name).toBe("Round trip.md");
    expect(md.bytes.toString("utf8")).toContain("Some **bold** and *italic* text.");
    const html = await exportVia(page, "page", "html");
    expect(html.name).toBe("Round trip.html");
    expect(html.bytes.toString("utf8")).toContain("<strong>bold</strong>");
    const docx = await exportVia(page, "page", "docx");
    expect(docx.name).toBe("Round trip.docx");
    expect(docx.bytes.subarray(0, 2).toString("latin1")).toBe("PK");
    const zip = await exportVia(page, "section", "md");
    expect(zip.name).toMatch(/\.zip$/);
    const names = [...unzip(zip.bytes).keys()];
    expect(names.some((n) => /Round trip\.md$/.test(n))).toBe(true);
    await shot(page, "export-dialog-done");

    // Re-import each export: the same text.
    for (const f of [
      { kind: "markdown" as const, file: { name: "again.md", mimeType: "text/markdown", buffer: md.bytes } },
      { kind: "html" as const, file: { name: "again.html", mimeType: "text/html", buffer: html.bytes } },
      { kind: "docx" as const, file: { name: "again.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: docx.bytes } },
    ]) {
      await importVia(page, f.kind, [f.file]);
      await page.getByTestId("import-open").click();
      await expect(editor(page)).toContainText("Some bold and italic text.");
      await expect(editor(page).locator("strong")).toHaveText("bold");
      await expect(editor(page).locator("li")).toHaveText(["first", "second"]);
      await expect(editor(page).locator("table")).toBeVisible();
    }
    expect(net.foreign()).toEqual([]);
    errors.expectNone();
  });

  test("the page context menu exports a page; the section menu a section", async ({ page }) => {
    await openNotes(page);
    await pageItems(page).first().click({ button: "right" });
    await page.getByRole("menuitem", { name: "Export page…" }).click();
    await expect(page.getByTestId("export-dialog")).toBeVisible();
    await expect(page.getByTestId("export-scope-page")).toBeChecked();
    await page.getByTestId("export-format-html").check();
    await shot(page, "export-dialog");
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-run").click()]);
    expect(dl.suggestedFilename()).toMatch(/\.html$/);
    await sectionItems(page).first().click({ button: "right" });
    await page.getByRole("menuitem", { name: "Export section…" }).click();
    await expect(page.getByTestId("export-scope-section")).toBeChecked();
    await page.getByTestId("export-format-docx").check();
    const [dl2] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-run").click()]);
    expect(dl2.suggestedFilename()).toMatch(/\.docx$/);
  });

  test("rich paste from Word and from a web page keeps the structure; remote images become links", async ({ page }) => {
    const errors = trackErrors(page);
    const net = audit(page);
    await openNotes(page);
    await newPage(page);
    // As Word puts it on the clipboard (Office HTML: mso classes, conditional comments, <o:p>).
    const word = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta name=Generator content="Microsoft Word 15"><style><!-- p.MsoNormal {margin:0cm;} --></style></head><body lang=DE><!--StartFragment--><h1 style="mso-outline-level:1">Project<o:p></o:p></h1><p class=MsoNormal>Plain <b>bold</b> <i>italic</i> <span style="color:#C00000">red</span><o:p></o:p></p><p class=MsoListParagraphCxSpFirst style="mso-list:l0 level1 lfo1"><![if !supportLists]><span>·<span>&nbsp;&nbsp;</span></span><![endif]>Alpha<o:p></o:p></p><ul><li>Beta</li><li>Gamma</li></ul><table class=MsoTableGrid border=1><tr><td><p class=MsoNormal>A1</p></td><td><p class=MsoNormal>B1</p></td></tr><tr><td><p class=MsoNormal>A2</p></td><td><p class=MsoNormal>B2</p></td></tr></table><!--EndFragment--></body></html>`;
    await pasteHtml(page, word, "Project\nPlain bold italic red");
    await expect(editor(page).locator("h1")).toHaveText("Project");
    await expect(editor(page).locator("strong").first()).toHaveText("bold");
    await expect(editor(page).locator("table td")).toHaveCount(4);
    await expect(editor(page).locator("li").filter({ hasText: "Gamma" })).toBeVisible();
    expect(net.convert().length).toBeGreaterThanOrEqual(1);

    // A web page: scripts dropped, links kept, a data: image stored, a remote image a link (never fetched).
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const web = `<meta charset="utf-8"><h2>Release notes</h2><script>window.__pwned = 1</script><p>Read the <a href="https://example.com/notes" onclick="x()">full notes</a>.</p><ol><li>One</li><li>Two</li></ol><p><img src="data:image/png;base64,${png}" alt="dot"></p><p><img src="https://tracker.example/pixel.png" alt="tracker"></p><p><a href="javascript:alert(1)">bad</a></p>`;
    // Typed text first: the paste lands after it, the cursor after the pasted content.
    await newPage(page);
    await page.keyboard.type("Intro");
    await page.keyboard.press("Enter");
    await pasteHtml(page, web, "Release notes");
    await page.keyboard.type("Outro");
    await expect(editor(page).locator("p").first()).toHaveText("Intro");
    await expect(editor(page).locator("p").last()).toHaveText(/Outro$/);
    await expect(editor(page).locator("h2")).toHaveText("Release notes");
    await expect(editor(page).locator('a[href="https://example.com/notes"]')).toHaveText("full notes");
    await expect(editor(page).locator("ol li")).toHaveText(["One", "Two"]);
    await expect(editor(page).getByTestId("image").locator("img")).toHaveCount(1);
    await expect(editor(page).locator('a[href^="javascript:"]')).toHaveCount(0);
    const json = JSON.stringify(await docJson(page));
    expect(json).toContain("https://tracker.example/pixel.png"); // as a link
    expect(json).not.toContain("__pwned");
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
    await shot(page, "paste");
    await page.waitForLoadState("networkidle");
    expect(net.foreign()).toEqual([]);
    errors.expectNone();
  });

  test("when the converter module cannot load, the import says so", async ({ page }) => {
    await page.route(CONVERT, (r) => r.abort());
    await openNotes(page);
    await importVia(page, "markdown", [{ name: "a.md", mimeType: "text/markdown", buffer: Buffer.from("# A\n") }]);
    await expect(page.getByTestId("import-error")).toContainText("The converters could not be loaded");
    await expect(page.getByTestId("import-open")).toHaveCount(0);
    await page.getByTestId("import-close").click();
    await expect(page.getByTestId("notes-busy")).toHaveCount(0);
  });
});
