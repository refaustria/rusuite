// P11-N3: Rusuite Notes rich content – tables, pictures, attachments, tags and the tasks view, search, page links
// and backlinks, page history, print / PDF, single-tab safety, recycle-bin purge. Every test starts with an empty
// browser profile. `NOTES_SHOTS=<dir>` saves screenshots (shots/P11-N3-*.png).

import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { downloadBuffer, interceptPrint, openPrint, previewPages, previewPdf, printCount, trackErrors as trackAll } from "../support/common";

const shots = process.env.NOTES_SHOTS;

/** Page errors, without Chromium's note about the print preview's sandboxed frame (it has no scripts on purpose). */
function trackErrors(page: Page) {
  const e = trackAll(page);
  return { list: e.list, expectNone: () => expect(e.list.filter((m) => !/^Blocked script execution in 'about:(blank|srcdoc)'/.test(m))).toEqual([]) };
}
const shot = async (page: Page, name: string) => {
  if (shots) await page.screenshot({ path: path.join(shots, `P11-N3-${name}.png`) });
};

async function openNotes(page: Page) {
  await page.goto("notes/");
  await expect(page.getByTestId("page-editor")).toBeVisible();
  await expect(page.getByTestId("save-state")).toHaveAttribute("data-state", "saved");
}

const editor = (page: Page) => page.getByTestId("page-editor");
const pageItems = (page: Page) => page.getByTestId("page-item");

async function saved(page: Page) {
  await page.evaluate(() => (window as unknown as { __rusuiteNotes: { idle(): Promise<void> } }).__rusuiteNotes.idle());
  await expect(page.getByTestId("save-state")).toHaveAttribute("data-state", "saved");
}

async function newPage(page: Page, title: string) {
  await page.getByTestId("new-page").click();
  const t = page.getByTestId("page-title");
  await expect(t).toHaveValue("");
  await t.fill(title);
  await t.press("Enter");
  await expect(pageItems(page).filter({ hasText: title })).toHaveAttribute("aria-current", "page");
}

async function tab(page: Page, name: string) {
  await page.getByRole("tab", { name, exact: true }).click();
}

/** The editor's JSON (Tiptap). */
const docJson = (page: Page) =>
  page.evaluate(() => (document.querySelector(".ProseMirror") as unknown as { editor: { getJSON(): unknown } }).editor.getJSON()) as Promise<{
    content: { type: string; attrs?: Record<string, unknown>; content?: unknown[] }[];
  }>;

/** A PNG of `w × h` pixels drawn in the page (bytes as a plain array). */
async function makePng(page: Page, w: number, h: number, color = "#3366ff"): Promise<Buffer> {
  const bytes = await page.evaluate(
    async ([w, h, color]) => {
      const c = document.createElement("canvas");
      c.width = w as number;
      c.height = h as number;
      const g = c.getContext("2d")!;
      g.fillStyle = color as string;
      g.fillRect(0, 0, w as number, h as number);
      g.fillStyle = "#fff";
      g.fillRect(0, 0, Math.min(10, w as number), Math.min(10, h as number));
      const b = await new Promise<Blob>((r) => c.toBlob((x) => r(x!), "image/png"));
      return Array.from(new Uint8Array(await b.arrayBuffer()));
    },
    [w, h, color] as const,
  );
  return Buffer.from(bytes);
}

/** Pastes files into the editor (a synthetic paste event with a DataTransfer). */
async function pasteFiles(page: Page, files: { name: string; type: string; bytes: number[] }[]) {
  await page.evaluate((files) => {
    const dt = new DataTransfer();
    for (const f of files) dt.items.add(new File([new Uint8Array(f.bytes)], f.name, { type: f.type }));
    const ev = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true });
    document.querySelector(".ProseMirror")!.dispatchEvent(ev);
  }, files);
}

test.describe("Notes rich content (P11-N3)", () => {
  test("tables: insert from the grid, Tab between cells, rows/columns, header row, merge/split, column resize; reload keeps them", async ({ page }) => {
    const errors = trackErrors(page);
    await openNotes(page);
    await newPage(page, "Table page");
    await editor(page).click();
    await tab(page, "Insert");
    await page.getByRole("button", { name: "Table", exact: true }).click();
    await page.getByRole("button", { name: "3 × 2 table" }).or(page.getByLabel(/^3\D+2/)).first().click();
    const table = editor(page).locator("table");
    await expect(table).toHaveCount(1);
    await expect(table.locator("tr")).toHaveCount(3);
    await expect(table.locator("tr").first().locator("th")).toHaveCount(2);
    // Tab moves through the cells; at the end it adds a row.
    for (const s of ["Name", "Qty", "Apples", "3", "Pears", "5"]) {
      await page.keyboard.type(s);
      await page.keyboard.press("Tab");
    }
    await expect(table.locator("tr")).toHaveCount(4);
    await page.keyboard.type("Plums");
    // The contextual Layout tab and the context menu.
    await expect(page.getByRole("tab", { name: "Layout" })).toBeVisible();
    await table.locator("td").filter({ hasText: "Apples" }).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Insert right" }).click();
    await expect(table.locator("tr").first().locator("th, td")).toHaveCount(3);
    await table.locator("tr").nth(1).locator("td").nth(1).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Delete column" }).click();
    await expect(table.locator("td").filter({ hasText: "Apples" })).toHaveCount(1);
    await expect(table.locator("tr").first().locator("th, td")).toHaveCount(2);
    // Merge: select two cells of a row (Shift+click), merge, then split again.
    await table.locator("td").filter({ hasText: "Pears" }).click();
    await table.locator("td").filter({ hasText: "5" }).click({ modifiers: ["Shift"] });
    await tab(page, "Layout");
    await page.getByRole("button", { name: "Merge cells" }).click();
    await expect(table.locator("td[colspan='2']")).toHaveCount(1);
    await page.getByRole("button", { name: "Split cell" }).click();
    await expect(table.locator("td[colspan='2']")).toHaveCount(0);
    // Header row off and on.
    await page.getByRole("button", { name: "Header row" }).click();
    await expect(table.locator("th")).toHaveCount(0);
    await page.getByRole("button", { name: "Header row" }).click();
    await expect(table.locator("tr").first().locator("th")).toHaveCount(2);
    // Column resize: drag the right border of the first header cell.
    const th = table.locator("th").first();
    const box = (await th.boundingBox())!;
    await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 80, box.y + box.height / 2, { steps: 5 });
    await page.mouse.up();
    const colwidth = async () => {
      const t = (await docJson(page)).content.find((b) => b.type === "table") as { content: { content: { attrs: { colwidth: number[] | null } }[] }[] };
      return t.content[0]!.content[0]!.attrs.colwidth;
    };
    await expect.poll(colwidth).toEqual([expect.any(Number)]);
    await shot(page, "table");
    await saved(page);
    await page.reload();
    await expect(table.locator("tr")).toHaveCount(4);
    await expect(table.locator("td").filter({ hasText: "Plums" })).toHaveCount(1);
    errors.expectNone();
  });

  test("pictures: Insert › Picture, paste, drop; resize keeps the aspect; alt text and centring; large pictures are downscaled", async ({ page }) => {
    const errors = trackErrors(page);
    await openNotes(page);
    await newPage(page, "Pictures");
    await editor(page).click();
    const png = await makePng(page, 400, 200);
    await tab(page, "Insert");
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Picture", exact: true }).click();
    await (await chooser).setFiles({ name: "blue.png", mimeType: "image/png", buffer: png });
    const img = editor(page).getByTestId("image").locator("img");
    await expect(img).toHaveCount(1);
    await expect(img).toHaveAttribute("src", /^blob:/);
    await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(400);
    const json = await docJson(page);
    const node = json.content.find((b) => b.type === "image")!;
    expect(node.attrs).toMatchObject({ alt: "blue", width: 300, height: 150 });
    expect(String(node.attrs!.blob)).toMatch(/^[0-9a-f]{64}$/);
    // Select it; drag the bottom-right handle 100 px to the left: the height follows (aspect 2:1).
    await editor(page).getByTestId("image").click();
    await expect(page.getByRole("tab", { name: "Picture" })).toBeVisible();
    const handle = editor(page).getByTestId("image-resize-se");
    const hb = (await handle.boundingBox())!;
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x - 100, hb.y + 20, { steps: 6 });
    await page.mouse.up();
    await expect.poll(async () => Number((await docJson(page)).content.find((b) => b.type === "image")!.attrs!.width)).toBeLessThan(230);
    const resized = (await docJson(page)).content.find((b) => b.type === "image")!.attrs as { width: number; height: number };
    expect(resized.width).toBeGreaterThan(210);
    expect(Math.abs(resized.height - resized.width / 2)).toBeLessThanOrEqual(1);
    // Alt text and centring from the Picture tab.
    await tab(page, "Picture");
    await page.getByRole("button", { name: "Alt text…" }).click();
    await page.getByRole("dialog").getByRole("textbox").fill("A blue rectangle");
    await page.getByRole("dialog").getByRole("textbox").press("Enter");
    await page.getByRole("button", { name: "Centre" }).click();
    await expect(editor(page).getByTestId("image")).toHaveAttribute("data-align", "center");
    await expect(img).toHaveAttribute("alt", "A blue rectangle");
    // Paste a picture.
    await editor(page).press("End");
    await pasteFiles(page, [{ name: "red.png", type: "image/png", bytes: Array.from(await makePng(page, 50, 50, "#ff0000")) }]);
    await expect(editor(page).getByTestId("image")).toHaveCount(2);
    // Drop a picture.
    await page.evaluate(async () => {
      const c = document.createElement("canvas");
      c.width = 30;
      c.height = 30;
      c.getContext("2d")!.fillRect(0, 0, 30, 30);
      const b = await new Promise<Blob>((r) => c.toBlob((x) => r(x!), "image/png"));
      const dt = new DataTransfer();
      dt.items.add(new File([b], "dropped.png", { type: "image/png" }));
      const target = document.querySelector(".ProseMirror p") ?? document.querySelector(".ProseMirror")!;
      const r = target.getBoundingClientRect();
      target.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true, clientX: r.left + 5, clientY: r.top + 5 }));
    });
    await expect(editor(page).getByTestId("image")).toHaveCount(3);
    // A picture wider than 4096 px is stored downscaled.
    const big = await makePng(page, 5000, 100);
    await pasteFiles(page, [{ name: "wide.png", type: "image/png", bytes: Array.from(big) }]);
    await expect(editor(page).getByTestId("image")).toHaveCount(4);
    await expect(page.getByTestId("toast")).toContainText("larger than 4096 pixels");
    const widths = await editor(page).getByTestId("image").locator("img").evaluateAll((els) => (els as HTMLImageElement[]).map((i) => i.naturalWidth));
    expect(widths).toContain(4096);
    await shot(page, "pictures");
    await saved(page);
    // After a reload the pictures come from IndexedDB.
    await page.reload();
    await expect(editor(page).getByTestId("image")).toHaveCount(4);
    const blue = editor(page).locator('img[alt="A blue rectangle"]');
    await expect.poll(() => blue.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(400);
    errors.expectNone();
  });

  test("attachments: Insert › File and dropped files become cards; Download returns the bytes; files over 25 MB are refused", async ({ page }) => {
    const errors = trackErrors(page);
    await openNotes(page);
    await newPage(page, "Files");
    await editor(page).click();
    await tab(page, "Insert");
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "File", exact: true }).click();
    await (await chooser).setFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello attachment") });
    const card = editor(page).getByTestId("attachment");
    await expect(card).toHaveCount(1);
    await expect(card).toContainText("notes.txt");
    await expect(card).toContainText("16 B");
    await expect(card.locator(".notes-attachment-icon")).toHaveText("TXT");
    const [dl] = await Promise.all([page.waitForEvent("download"), card.getByTestId("attachment-download").click()]);
    expect(dl.suggestedFilename()).toBe("notes.txt");
    expect((await downloadBuffer(dl)).toString()).toBe("hello attachment");
    // A non-picture pasted / dropped also becomes a card.
    await pasteFiles(page, [{ name: "data.csv", type: "text/csv", bytes: Array.from(Buffer.from("a,b\n1,2\n")) }]);
    await expect(card).toHaveCount(2);
    // Too large.
    const chooser2 = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "File", exact: true }).click();
    await (await chooser2).setFiles({ name: "huge.bin", mimeType: "application/octet-stream", buffer: Buffer.alloc(25 * 1024 * 1024 + 1) });
    await expect(page.getByTestId("toast")).toContainText("“huge.bin” is larger than");
    await expect(card).toHaveCount(2);
    await shot(page, "attachments");
    await saved(page);
    await page.reload();
    await expect(card).toHaveCount(2);
    errors.expectNone();
  });

  test("tags: icons before the block, the to-do box ticks; custom tags; the tasks view filters, jumps and ticks", async ({ page }) => {
    const errors = trackErrors(page);
    await openNotes(page);
    await newPage(page, "Plans");
    await editor(page).click();
    await page.keyboard.type("Pay the rent");
    await page.keyboard.press("Control+1");
    // Enter continues the tag (OneNote), unticked; Ctrl+1 takes it off again.
    await page.keyboard.press("Enter");
    await expect(editor(page).getByTestId("tag-checkbox")).toHaveCount(2);
    await page.keyboard.press("Control+1");
    await page.keyboard.type("A great idea");
    await page.keyboard.press("Control+2");
    const box = editor(page).getByTestId("tag-checkbox");
    await expect(box).toHaveCount(1);
    await expect(box).toHaveAttribute("aria-checked", "false");
    await expect(editor(page).locator('[data-tag="important"]')).toHaveCount(1);
    await box.click();
    await expect(box).toHaveAttribute("aria-checked", "true");
    await expect(editor(page).locator("p.notes-done")).toHaveText("Pay the rent");
    await box.click();
    // A custom to-do tag from Customize tags.
    await page.getByRole("button", { name: "Tags", exact: true }).click();
    await page.getByRole("menuitem", { name: "Customize tags…" }).click();
    await page.getByTestId("new-tag-name").fill("Waiting");
    await page.getByTestId("new-tag-todo").check();
    await page.getByTestId("new-tag-create").click();
    await expect(page.getByTestId("custom-tag")).toHaveCount(1);
    await page.getByTestId("custom-tag").getByRole("textbox").fill("Waiting for");
    await page.getByTestId("custom-tag").getByRole("textbox").press("Enter");
    await page.getByRole("dialog").getByRole("button", { name: "Close" }).last().click();
    await editor(page).click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Answer from the bank");
    await page.getByRole("button", { name: "Tags", exact: true }).click();
    await page.getByRole("menu").getByText("Waiting for", { exact: true }).click();
    await expect(editor(page).getByTestId("tag-checkbox")).toHaveCount(2);
    // A check list item is a task too (listed once even when tagged).
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Tags", exact: true }).click();
    await page.getByRole("menu").getByText("Remove tags", { exact: true }).click();
    await expect(editor(page).getByTestId("tag-checkbox")).toHaveCount(2);
    await page.getByRole("button", { name: "Checklist" }).click();
    await page.keyboard.type("Buy stamps");
    await page.keyboard.press("Control+1");
    await expect(editor(page).locator('ul[data-type="taskList"] li')).toContainText("Buy stamps");
    await expect(editor(page).locator("p", { hasText: "Answer from the bank" }).getByTestId("tag-checkbox")).toHaveCount(1);
    await expect(editor(page).locator("p", { hasText: "Pay the rent" }).getByTestId("tag-checkbox")).toHaveCount(1);
    await shot(page, "tags");
    await saved(page);
    // The tasks view.
    await page.getByTestId("tasks-button").click();
    const view = page.getByTestId("tasks-view");
    await expect(view).toBeVisible();
    const tasks = view.getByTestId("task");
    const plans = tasks.filter({ hasText: /Pay the rent|Answer from the bank|Buy stamps/ });
    await expect(plans).toHaveCount(3);
    await expect(tasks.filter({ hasText: "Buy stamps" })).toHaveCount(1);
    await expect(view.getByTestId("tasks-group").filter({ hasText: "My notebook › Quick notes" })).toBeVisible();
    await page.getByTestId("tasks-tag").selectOption({ label: "Waiting for" });
    await expect(tasks).toHaveText([/Answer from the bank/]);
    await page.getByTestId("tasks-tag").selectOption("");
    // Tick one in the view → done filter shows it, the page has it ticked.
    await tasks.filter({ hasText: "Pay the rent" }).getByTestId("task-check").click();
    await expect(tasks.filter({ hasText: "Pay the rent" })).toHaveCount(0);
    await page.getByTestId("tasks-filter-done").click();
    await expect(tasks.filter({ hasText: "Pay the rent" })).toHaveCount(1);
    await shot(page, "tasks");
    await tasks.filter({ hasText: "Pay the rent" }).getByTestId("task-open").click();
    await expect(page.getByTestId("tasks-view")).toHaveCount(0);
    await expect(editor(page).getByTestId("flash")).toHaveText("Pay the rent");
    await expect(editor(page).getByTestId("tag-checkbox").first()).toHaveAttribute("aria-checked", "true");
    // Ticking a to-do of a page that is not open (through its page document).
    await page.getByTestId("tasks-button").click();
    await page.getByTestId("tasks-filter-open").click();
    await pageItems(page).filter({ hasText: "Welcome" }).click();
    await page.getByTestId("tasks-button").click();
    await tasks.filter({ hasText: "Buy stamps" }).getByTestId("task-check").click();
    await expect(tasks.filter({ hasText: "Buy stamps" })).toHaveCount(0);
    await pageItems(page).filter({ hasText: "Plans" }).click();
    await expect(editor(page).locator('li[data-checked="true"]')).toContainText("Buy stamps");
    errors.expectNone();
  });

  test("search: results while typing with highlights, scope, Enter opens the page and highlights the matches; Ctrl+F find on page", async ({ page }) => {
    const errors = trackErrors(page);
    await openNotes(page);
    await newPage(page, "Holiday");
    await editor(page).click();
    await page.keyboard.type("We fly to Lisbon in May. Lisbon has trams.");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Pack sunscreen.");
    await saved(page);
    await pageItems(page).filter({ hasText: "Welcome" }).click();
    await page.keyboard.press("Control+e");
    await expect(page.getByTestId("search-input")).toBeFocused();
    await page.keyboard.type("lisbon");
    const hits = page.getByTestId("search-hit");
    await expect(hits).toHaveCount(1);
    await expect(hits.first()).toContainText("Holiday");
    await expect(hits.first()).toContainText("My notebook › Quick notes");
    await expect(hits.first().locator("mark").first()).toHaveText(/lisbon/i);
    await shot(page, "search");
    // This notebook / all notebooks both find it; nothing for nonsense.
    await page.getByTestId("search-scope").selectOption("notebook");
    await expect(hits).toHaveCount(1);
    await page.getByTestId("search-input").press("Enter");
    await expect(page.getByTestId("page-title")).toHaveValue("Holiday");
    const bar = page.getByTestId("find-bar");
    await expect(bar).toBeVisible();
    await expect(editor(page).getByTestId("find-match")).toHaveCount(2);
    await expect(page.getByTestId("find-count")).toHaveText("1 of 2");
    await page.getByTestId("find-input").press("Enter");
    await expect(page.getByTestId("find-count")).toHaveText("2 of 2");
    await page.getByTestId("find-input").press("Escape");
    await expect(bar).toHaveCount(0);
    await expect(editor(page).getByTestId("find-match")).toHaveCount(0);
    // Ctrl+F in the editor.
    await editor(page).click();
    await page.keyboard.press("Control+f");
    await expect(page.getByTestId("find-input")).toBeFocused();
    await page.keyboard.type("sunscreen");
    await expect(editor(page).getByTestId("find-match")).toHaveCount(1);
    await expect(page.getByTestId("find-count")).toHaveText("1 of 1");
    await page.getByTestId("search-input").fill("zzqx");
    await expect(page.getByTestId("search-count")).toHaveText("No pages found");
    errors.expectNone();
  });

  test("page links: Linked from on the target, live titles after a rename, broken styling after a delete", async ({ page }) => {
    const errors = trackErrors(page);
    await openNotes(page);
    await newPage(page, "Target");
    await newPage(page, "Source");
    await editor(page).click();
    await page.keyboard.type("See [[");
    await page.getByTestId("page-picker").getByRole("textbox").fill("Targ");
    await page.getByTestId("page-picker").getByRole("textbox").press("Enter");
    const link = editor(page).getByTestId("page-link");
    await expect(link).toHaveText("Target");
    await saved(page);
    await link.click();
    await expect(page.getByTestId("page-title")).toHaveValue("Target");
    const linked = page.getByTestId("linked-from");
    await expect(linked.getByTestId("backlink")).toHaveText(["Source"]);
    // Rename the target: the link shows the new title.
    await page.getByTestId("page-title").fill("Goal");
    await page.getByTestId("page-title").press("Enter");
    await expect(pageItems(page).filter({ hasText: "Goal" })).toHaveCount(1);
    await linked.getByTestId("backlink").click();
    await expect(page.getByTestId("page-title")).toHaveValue("Source");
    await expect(link).toHaveText("Goal");
    await shot(page, "links");
    // Delete the target: a broken link.
    await pageItems(page).filter({ hasText: "Goal" }).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await pageItems(page).filter({ hasText: "Source" }).click();
    await expect(link).toHaveClass(/broken/);
    errors.expectNone();
  });

  test("page history: versions with device, preview with changed paragraphs, restore; keyboard", async ({ page }) => {
    const errors = trackErrors(page);
    await page.clock.install();
    await openNotes(page);
    await newPage(page, "Draft");
    await editor(page).click();
    await page.keyboard.type("First version of the text.");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Second paragraph stays.");
    await saved(page);
    await page.clock.fastForward("05:00");
    await editor(page).locator("p").first().click();
    await page.keyboard.press("End");
    await page.keyboard.type(" Edited later.");
    await saved(page);
    await tab(page, "View");
    await page.getByRole("button", { name: "Page history" }).click();
    const panel = page.getByTestId("history-panel");
    await expect(panel).toBeVisible();
    const entries = panel.getByTestId("history-entry");
    await expect.poll(() => entries.count()).toBeGreaterThanOrEqual(2);
    await expect(entries.first()).toContainText("Current version");
    await expect(entries.first()).toContainText(/device web-/);
    // Keyboard: ↓ then Enter previews the earlier version.
    await panel.getByRole("listbox").focus();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    const preview = page.getByTestId("version-preview");
    await expect(preview).toBeVisible();
    await expect(preview.getByTestId("version-content")).toContainText("First version of the text.");
    await expect(preview.getByTestId("version-content")).not.toContainText("Edited later");
    await expect(preview.locator(".notes-changed")).toHaveCount(1);
    await expect(preview.locator(".notes-changed")).toHaveText("First version of the text.");
    await shot(page, "history");
    await preview.getByTestId("history-restore").click();
    await page.getByTestId("confirm-dialog").getByRole("button", { name: "Restore" }).click();
    await expect(preview).toHaveCount(0);
    await expect(editor(page).locator("p").first()).toHaveText("First version of the text.");
    await saved(page);
    // History only grows: the restore is a new version.
    await page.getByRole("button", { name: "Page history" }).click();
    await page.getByRole("button", { name: "Page history" }).click();
    await expect.poll(() => entries.count()).toBeGreaterThanOrEqual(3);
    errors.expectNone();
  });

  test("print and PDF: page and section through the print pipeline with a preview; Export PDF", async ({ page }) => {
    const errors = trackErrors(page);
    await interceptPrint(page);
    await openNotes(page);
    await newPage(page, "Printable");
    await editor(page).click();
    await page.evaluate(() => {
      const paras = Array.from({ length: 70 }, (_, i) => ({ type: "paragraph", content: [{ type: "text", text: `Line ${i + 1} of a long page that needs more than one sheet.` }] }));
      const ed = (document.querySelector(".ProseMirror") as unknown as { editor: { commands: { setContent(c: unknown): void } } }).editor;
      ed.commands.setContent({ type: "doc", content: [{ type: "table", content: [{ type: "tableRow", content: [{ type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "Head" }] }] }] }] }, ...paras] });
    });
    await saved(page);
    await openPrint(page);
    const pages = await previewPages(page);
    expect(pages).toBeGreaterThanOrEqual(2);
    expect(await previewPdf(page, "P11-N3-page")).toBe(pages);
    await expect(page.getByTestId("print-preview")).toBeVisible();
    await shot(page, "print");
    // The whole section: the welcome page starts a sheet of its own.
    await page.getByTestId("print-panel").getByLabel("Print", { exact: true }).selectOption("section");
    await expect.poll(() => previewPages(page)).toBeGreaterThan(pages);
    await page.getByTestId("print-button").click();
    await expect.poll(() => printCount(page)).toBe(1);
    // File › Export PDF (the web: the print dialog with "Save as PDF").
    await page.getByTestId("backstage").getByRole("button", { name: /^Export PDF/ }).first().click();
    await expect.poll(() => printCount(page)).toBe(2);
    errors.expectNone();
  });

  test("single tab: a second tab waits, Use here takes over, the first becomes read-only", async ({ page, context }) => {
    const errors = trackErrors(page);
    await openNotes(page);
    const second = await context.newPage();
    await second.goto("notes/");
    const lock = second.getByTestId("tab-lock");
    await expect(lock).toBeVisible();
    await expect(lock).toContainText("Notes is open in another tab");
    await shot(second, "tab-lock");
    await lock.getByTestId("tab-lock-use-here").click();
    await expect(second.getByTestId("page-editor")).toBeVisible();
    await expect(page.getByTestId("tab-lock")).toHaveAttribute("data-state", "lost");
    await expect(editor(page)).toHaveAttribute("contenteditable", "false");
    await second.close();
    errors.expectNone();
  });

  test("recycle bin: delete one entry forever", async ({ page }) => {
    const errors = trackErrors(page);
    await openNotes(page);
    await newPage(page, "Keep");
    await newPage(page, "Drop");
    for (const n of ["Keep", "Drop"]) {
      await pageItems(page).filter({ hasText: n }).click({ button: "right" });
      await page.getByRole("menuitem", { name: "Delete" }).click();
    }
    await page.getByTestId("recycle-bin-button").click();
    await expect(page.getByTestId("recycle-entry")).toHaveCount(2);
    await page.getByTestId("recycle-entry").filter({ hasText: "Drop" }).getByTestId("purge-entry").click();
    await page.getByTestId("confirm-dialog").getByRole("button", { name: "Delete permanently" }).click();
    await expect(page.getByTestId("recycle-entry")).toHaveText([/Keep/]);
    await saved(page);
    await page.reload();
    await page.getByTestId("recycle-bin-button").click();
    await expect(page.getByTestId("recycle-entry")).toHaveText([/Keep/]);
    errors.expectNone();
  });
});
