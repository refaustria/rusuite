// P9-W2: Write pagination round 3 – sections with their own page size in the editor and in the printed PDF,
// footnotes continued on the next page (the continuation is the editable note), endnotes at the end of each
// section, nested tables split across pages with open borders, and the pagination timings of a 200-page document.
// The documents are generated here (a stored zip of WordprocessingML parts).
import fs from "node:fs";
import zlib from "node:zlib";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { fileCommand, openViaBackstage, ribbonCommand, saveViaBackstage, trackErrors } from "../support/common";
import { zipText } from "../support/zip";

const SHOTS = process.env.SHOTS_DIR ?? "../../shots";
const editor = (page: Page) => page.locator(".ProseMirror").first();

// ----- a minimal .docx writer -----------------------------------------------------------------------------------

/** A zip with stored entries. */
function zip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text, "utf8");
    const nameBuf = Buffer.from(name, "utf8");
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, data);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(data.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(nameBuf.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const LOREM = "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.";

/** A paragraph: text runs, optional footnote / endnote references and a section end (`sectPr`). */
function p(text: string, o: { foot?: number; end?: number; sect?: string; style?: string } = {}): string {
  const ppr = o.style || o.sect ? `<w:pPr>${o.style ? `<w:pStyle w:val="${o.style}"/>` : ""}${o.sect ?? ""}</w:pPr>` : "";
  const ref = (kind: "footnote" | "endnote", id: number) =>
    `<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:${kind}Reference w:id="${id}"/></w:r>`;
  return `<w:p>${ppr}<w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r>${o.foot ? ref("footnote", o.foot) : ""}${o.end ? ref("endnote", o.end) : ""}</w:p>`;
}

const A4 = '<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>';
const A4L = '<w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>';
const sectPr = (page: string, kind?: string) => `<w:sectPr>${kind ? `<w:type w:val="${kind}"/>` : ""}${page}</w:sectPr>`;

/** A .docx with `body` (paragraphs and tables), notes and settings. */
function docx(body: string, o: { footnotes?: Record<number, string[]>; endnotes?: Record<number, string[]>; settings?: string; last?: string } = {}): Buffer {
  const notes = (kind: "footnote" | "endnote", list: Record<number, string[]>) =>
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:${kind}s ${W}><w:${kind} w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:${kind}><w:${kind} w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:${kind}>${Object.entries(
      list,
    )
      .map(([id, paras]) => `<w:${kind} w:id="${id}">${paras.map((t) => `<w:p><w:r><w:t xml:space="preserve">${esc(t)}</w:t></w:r></w:p>`).join("")}</w:${kind}>`)
      .join("")}</w:${kind}s>`;
  const files: Record<string, string> = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>${o.footnotes ? '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>' : ""}${o.endnotes ? '<Override PartName="/word/endnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml"/>' : ""}</Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    "word/_rels/document.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>${o.footnotes ? '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/>' : ""}${o.endnotes ? '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/endnotes" Target="endnotes.xml"/>' : ""}</Relationships>`,
    "word/settings.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings ${W}>${o.settings ?? ""}${o.footnotes ? '<w:footnotePr><w:footnote w:id="-1"/><w:footnote w:id="0"/></w:footnotePr>' : ""}${o.endnotes ? '<w:endnotePr><w:endnote w:id="-1"/><w:endnote w:id="0"/></w:endnotePr>' : ""}</w:settings>`,
    "word/document.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${body}${o.last ?? sectPr(A4)}</w:body></w:document>`,
  };
  if (o.footnotes) files["word/footnotes.xml"] = notes("footnote", o.footnotes);
  if (o.endnotes) files["word/endnotes.xml"] = notes("endnote", o.endnotes);
  return zip(files);
}

/** A table: rows of cells (each cell's inner XML), row properties per row. */
function tbl(rows: { cells: string[]; trPr?: string }[], borders = true): string {
  const b = borders
    ? '<w:tblBorders><w:top w:val="single" w:sz="8" w:color="000000"/><w:left w:val="single" w:sz="8" w:color="000000"/><w:bottom w:val="single" w:sz="8" w:color="000000"/><w:right w:val="single" w:sz="8" w:color="000000"/><w:insideH w:val="single" w:sz="8" w:color="000000"/><w:insideV w:val="single" w:sz="8" w:color="000000"/></w:tblBorders>'
    : "";
  const cols = Math.max(...rows.map((r) => r.cells.length));
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>${b}</w:tblPr><w:tblGrid>${Array.from({ length: cols }, () => '<w:gridCol w:w="4000"/>').join("")}</w:tblGrid>${rows
    .map((r) => `<w:tr>${r.trPr ? `<w:trPr>${r.trPr}</w:trPr>` : ""}${r.cells.map((c) => `<w:tc><w:tcPr><w:tcW w:w="4000" w:type="dxa"/></w:tcPr>${c}</w:tc>`).join("")}</w:tr>`)
    .join("")}</w:tbl>`;
}

async function openDocx(page: Page, info: TestInfo, name: string, bytes: Buffer) {
  const file = info.outputPath(name);
  fs.writeFileSync(file, bytes);
  await page.goto("write/");
  await editor(page).waitFor();
  await expect(page.getByTestId("status-bar")).toContainText("Saved");
  await openViaBackstage(page, file);
  await expect(page.getByTestId("status-bar")).toContainText("Saved");
}

const chrome = (page: Page) => page.getByTestId("page-chrome");
const pages = async (page: Page) => Number(await chrome(page).getAttribute("data-pages"));
/** The sheets' x and width in the page frame. */
const sheets = async (page: Page) =>
  ((await chrome(page).getAttribute("data-sheets")) ?? "").split(";").map((s) => s.split(",").map(Number) as [number, number]);
/** Body boxes [top, bottom] per page (frame px). */
const bodies = async (page: Page) =>
  ((await chrome(page).getAttribute("data-bodies")) ?? "").split(";").map((s) => s.split(",").map(Number) as [number, number]);
/** The page index (0-based) of frame y `y`. */
const pageAt = (b: [number, number][], y: number) => b.findIndex(([, bottom], i) => y < bottom + (b[i + 1] ? (b[i + 1]![0] - bottom) / 2 : 1e9));
const layoutIdle = (page: Page) => page.waitForTimeout(600);

/**
 * File › Export PDF with the print root kept: per printed page the number of footnote pieces and of table pieces,
 * then the PDF of the print document (`page.pdf` at its `@page` sizes; it fires `afterprint`, which unmounts the root).
 */
async function exportPdf(page: Page): Promise<{ pdf: Buffer; notes: number[]; tables: number[] }> {
  await fileCommand(page, /^Export PDF/);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __printed: number }).__printed)).toBeGreaterThan(0);
  const { notes, tables } = await page.evaluate(() => {
    const list = Array.from(document.querySelectorAll("#rusuite-print-root .rs-print-page"));
    return { notes: list.map((pg) => pg.querySelectorAll(".rs-write-note").length), tables: list.map((pg) => pg.querySelectorAll(".rs-write-piece table").length) };
  });
  await page.emulateMedia({ media: "print" });
  const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  await page.emulateMedia({ media: "screen" });
  return { pdf, notes, tables };
}

/** The page boxes (width × height in pt) of a PDF, in page order. */
function mediaBoxes(pdf: Buffer): [number, number][] {
  return [...pdf.toString("latin1").matchAll(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/g)].map((m) => [Math.round(Number(m[3]) - Number(m[1])), Math.round(Number(m[4]) - Number(m[2]))]);
}

test.describe("Write pagination round 3 (P9-W2)", () => {
  test.beforeEach(async ({ page }) => {
    // Keep the print root mounted while the PDF is made.
    await page.addInitScript(() => {
      (window as unknown as { __printed: number }).__printed = -1;
      window.print = () => {
        (window as unknown as { __printed: number }).__printed = document.querySelectorAll("#rusuite-print-root .rs-print-page").length;
      };
    });
  });

  test("portrait + landscape: two sheet widths in the editor, two page sizes in the PDF", async ({ page }, info) => {
    const errors = trackErrors(page);
    const body = [p("Portrait section."), p(LOREM), p("End of the portrait section.", { sect: sectPr(A4) }), p("Landscape section."), p(LOREM.repeat(4))].join("");
    await openDocx(page, info, "w2-sections.docx", docx(body, { last: sectPr(A4L) }));
    await expect.poll(() => pages(page)).toBe(2);
    const s = await sheets(page);
    // A4 portrait 794 px, landscape 1123 px; the portrait sheet centred in the frame.
    expect(s[0]![1]).toBe(794);
    expect(s[1]![1]).toBe(1123);
    expect(s[0]![0]).toBeGreaterThan(150);
    // The landscape section's text is as wide as its sheet's text column (the portrait's is narrower).
    const widths = await page.evaluate(() => {
      const ps = Array.from(document.querySelectorAll(".ProseMirror p"));
      const w = (t: string) => ps.find((x) => x.textContent?.startsWith(t))!.getBoundingClientRect().width;
      return [w("Portrait section."), w("Landscape section.")];
    });
    expect(widths[1]! - widths[0]!).toBeGreaterThan(300);
    await page.screenshot({ path: `${SHOTS}/P9-W2-sections.png` });
    const { pdf } = await exportPdf(page);
    fs.writeFileSync(info.outputPath("w2-sections.pdf"), pdf);
    const boxes = mediaBoxes(pdf);
    expect(boxes).toHaveLength(2);
    // A4 portrait 595 × 842 pt, then A4 landscape 842 × 595 pt.
    expect(boxes[0]![0]).toBeLessThan(boxes[0]![1]);
    expect(boxes[1]![0]).toBeGreaterThan(boxes[1]![1]);
    errors.expectNone();
  });

  test("a long footnote continues on the next page; typing into the continuation edits the note", async ({ page }, info) => {
    const errors = trackErrors(page);
    const filler = Array.from({ length: 9 }, () => p(LOREM.repeat(2)));
    const note = Array.from({ length: 14 }, (_, k) => `Note line ${k + 1}: ${LOREM}`);
    const body = [...filler, p("The reference.", { foot: 1 }), p(LOREM.repeat(3)), p(LOREM.repeat(3))].join("");
    await openDocx(page, info, "w2-footnote.docx", docx(body, { footnotes: { 1: note } }));
    await expect.poll(() => pages(page)).toBeGreaterThanOrEqual(2);
    const el = editor(page).locator(".note[data-note-kind='foot']");
    await expect(el).toHaveCount(1);
    await expect(el).toHaveAttribute("data-slices", "2");
    // The continuation separator (full width) on the next page.
    await expect(chrome(page).locator(".page-note-sep-cont")).toHaveCount(1);
    await layoutIdle(page);
    // The last note paragraph is on a later page than the first one.
    const b = await bodies(page);
    const ys = await page.evaluate(() => {
      const frame = document.querySelector("[data-testid=write-page]")!.getBoundingClientRect();
      const paras = Array.from(document.querySelectorAll(".note[data-note-kind='foot'] p"));
      return paras.map((x) => x.getBoundingClientRect().top - frame.top);
    });
    const p0 = pageAt(b, ys[0]!);
    const pLast = pageAt(b, ys[ys.length - 1]!);
    expect(pLast).toBeGreaterThan(p0);
    await page.screenshot({ path: `${SHOTS}/P9-W2-footnote-pages.png` });
    // Click at the end of the note's last paragraph (in the continuation) and type.
    const last = el.locator("p").last();
    await last.scrollIntoViewIfNeeded();
    const box = (await last.boundingBox())!;
    await page.mouse.click(box.x + box.width - 2, box.y + box.height / 2);
    await page.keyboard.press("End");
    await page.keyboard.type(" TYPED");
    await expect(last).toContainText("TYPED");
    await expect(editor(page).locator(".note[data-note-kind='foot']")).toHaveCount(1);
    await layoutIdle(page);
    await page.screenshot({ path: `${SHOTS}/P9-W2-footnote-continuation.png` });
    const saved = await saveViaBackstage(page);
    expect(zipText(saved, "word/footnotes.xml")).toContain("TYPED");
    // Printed: the note is split the same way (two separators, no note at the end).
    const printed = await exportPdf(page);
    fs.writeFileSync(info.outputPath("w2-footnote.pdf"), printed.pdf);
    expect(mediaBoxes(printed.pdf).length).toBe(await pages(page));
    expect(printed.notes.filter((n) => n > 0)).toHaveLength(2);
    errors.expectNone();
  });

  test("endnotes End of section (dialog): the endnotes stand before the next section", async ({ page }, info) => {
    const errors = trackErrors(page);
    const body = [p("Section one with an endnote.", { end: 1 }), p(LOREM), p("Last of section one.", { sect: sectPr(A4, "continuous") }), p("Section two starts here."), p(LOREM, { end: 2 })].join("");
    await openDocx(page, info, "w2-endnotes.docx", docx(body, { endnotes: { 1: ["First endnote text."], 2: ["Second endnote text."] } }));
    const first = editor(page).locator(".note[data-note-kind='end']").first();
    await expect(first).toContainText("First endnote");
    // At the end of the document by default: below section two.
    const yOf = (text: string) =>
      page.evaluate((t) => {
        const frame = document.querySelector("[data-testid=write-page]")!.getBoundingClientRect();
        const el = Array.from(document.querySelectorAll(".ProseMirror p")).find((x) => x.textContent?.startsWith(t))!;
        return el.getBoundingClientRect().top - frame.top;
      }, text);
    await expect.poll(async () => (await yOf("First endnote")) - (await yOf("Section two starts"))).toBeGreaterThan(0);
    // References › Footnote and Endnote…: Endnotes, End of section, Apply.
    await page.getByRole("tab", { name: "References", exact: true }).click();
    await ribbonCommand(page, "Footnotes", /Footnote and Endnote/, false);
    const dialog = page.getByTestId("note-dialog");
    await dialog.getByRole("radio").nth(1).check();
    await dialog.getByTestId("note-dialog-end-position").selectOption("section");
    await dialog.getByTestId("note-dialog-apply").click();
    await expect.poll(() => yOf("First endnote")).toBeLessThan(await yOf("Section two starts"));
    expect(await yOf("First endnote")).toBeGreaterThan(await yOf("Last of section one"));
    // The second endnote ends section two (the end of the document).
    expect(await yOf("Second endnote")).toBeGreaterThan(await yOf("Section two starts"));
    await expect(chrome(page).getByTestId("page-endnote-separator")).toHaveCount(2);
    await layoutIdle(page);
    await page.screenshot({ path: `${SHOTS}/P9-W2-endnotes-section.png` });
    const saved = await saveViaBackstage(page);
    expect(zipText(saved, "word/settings.xml")).toMatch(/<w:endnotePr><w:pos w:val="sectEnd"\/>/);
    errors.expectNone();
  });

  test("a nested table splits across pages with its parent row; borders stay open at the cut", async ({ page }, info) => {
    const errors = trackErrors(page);
    const inner = tbl(Array.from({ length: 40 }, (_, k) => ({ cells: [p(`Inner ${k + 1} a`), p(`Inner ${k + 1} b`)] })));
    const outer = tbl([{ cells: [`${p("Outer cell before the nested table.")}${inner}${p("After the nested table.")}`] }]);
    const body = [...Array.from({ length: 4 }, () => p(LOREM.repeat(2))), outer, p("After the table.")].join("");
    await openDocx(page, info, "w2-nested.docx", docx(body));
    await expect.poll(() => pages(page)).toBeGreaterThanOrEqual(2);
    await layoutIdle(page);
    const b = await bodies(page);
    const geo = await page.evaluate(() => {
      const frame = document.querySelector("[data-testid=write-page]")!.getBoundingClientRect();
      const outerTd = document.querySelector(".ProseMirror table td")!.getBoundingClientRect();
      const rows = Array.from(document.querySelectorAll(".ProseMirror td table tr")).map((r) => r.getBoundingClientRect().top - frame.top);
      return { tdTop: outerTd.top - frame.top, tdBottom: outerTd.bottom - frame.top, rows };
    });
    // The outer row starts on page 1 (it does not move whole) and ends on a later page.
    expect(pageAt(b, geo.tdTop)).toBe(0);
    expect(pageAt(b, geo.tdBottom)).toBeGreaterThan(0);
    // Nested rows on both pages, none in the gap between the pages.
    const onPage = geo.rows.map((y) => pageAt(b, y));
    expect(onPage).toContain(0);
    expect(onPage).toContain(1);
    for (const y of geo.rows) expect(b.some(([top, bottom]) => y >= top - 1 && y <= bottom + 1)).toBe(true);
    await chrome(page).evaluate((el) => el.scrollIntoView());
    await page.getByTestId("write-scroll").evaluate((el, y) => (el.scrollTop = y - 300), b[0]![1]);
    await page.screenshot({ path: `${SHOTS}/P9-W2-nested-table.png` });
    // Printed: the split row is cut out of the editor's table (its pieces keep the page gaps).
    const printed = await exportPdf(page);
    fs.writeFileSync(info.outputPath("w2-nested.pdf"), printed.pdf);
    expect(mediaBoxes(printed.pdf).length).toBe(await pages(page));
    expect(printed.tables[0]).toBeGreaterThan(0);
    expect(printed.tables[1]).toBeGreaterThan(0);
    errors.expectNone();
  });

  test("perf: pagination of a 200-page document (full and after an edit on page 100)", async ({ page }, info) => {
    test.setTimeout(240_000);
    const paras: string[] = [];
    for (let k = 0; k < 4000; k++) {
      if (k % 40 === 0) paras.push(p(`Heading ${k / 40 + 1}`, { style: "Heading1" }));
      paras.push(p(`${k + 1}. ${LOREM} ${LOREM.slice(0, 40)}`));
    }
    await openDocx(page, info, "w2-perf.docx", docx(paras.join("")));
    await expect.poll(() => pages(page), { timeout: 60_000 }).toBeGreaterThan(150);
    await page.waitForTimeout(1500);
    /** The timings of the last layout run made for `reason` (`full`: forced re-measure, `edit`: after a keystroke). */
    const ms = (reason: string) =>
      page.evaluate((r) => {
        const log = (document.querySelector(".ProseMirror") as unknown as { rusuitePaginationLog: (Record<string, number> & { reason: string })[] }).rusuitePaginationLog;
        return [...log].reverse().find((x) => x.reason === r)!;
      }, reason);
    // A full layout (as after a zoom): measure every block, build the flow and the pages.
    const full: Record<string, number>[] = [];
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => document.querySelector(".ProseMirror")!.dispatchEvent(new Event("rusuite-remeasure")));
      await page.waitForTimeout(1500);
      full.push(await ms("full"));
    }
    const total = await pages(page);
    // An edit in a paragraph on page 100: one block measured, the pages resumed there.
    const b = await bodies(page);
    const target = b[99]!;
    await page.getByTestId("write-scroll").evaluate((el, y) => (el.scrollTop = y), target[0]);
    await page.waitForTimeout(300);
    const frame = (await page.getByTestId("write-page").boundingBox())!;
    const editRuns: Record<string, number>[] = [];
    for (let i = 0; i < 9; i++) {
      const top = await page.getByTestId("write-page").evaluate((el) => el.getBoundingClientRect().top);
      await page.mouse.click(frame.x + 300, top + target[0] + 60);
      await page.keyboard.type("x");
      await page.waitForTimeout(400);
      editRuns.push(await ms("edit"));
    }
    const median = (v: number[]) => [...v].sort((a, c) => a - c)[v.length >> 1]!;
    const rows = [
      { name: `pagination: pages of the generated document`, value: total, unit: "", target: null },
      { name: "pagination: full layout (all blocks measured), median of 3", value: median(full.map((r) => r.total!)), unit: "ms", target: null },
      { name: "… of which flow + pages (engine and page data)", value: median(full.map((r) => r.build!)), unit: "ms", target: null },
      { name: "pagination after an edit on page 100: whole run, median of 9", value: median(editRuns.map((r) => r.total!)), unit: "ms", target: null },
      { name: "… of which flow + pages (engine and page data)", value: median(editRuns.map((r) => r.build!)), unit: "ms", target: 5 },
      { name: "… blocks measured", value: median(editRuns.map((r) => r.measured!)), unit: "", target: null },
    ];
    console.log(`PERF ${JSON.stringify(rows)}`);
    const parts = ["measure", "flow", "first", "paginate", "layout", "build", "total"];
    console.log(`PERF-PARTS edit ${parts.map((k) => `${k}=${median(editRuns.map((r) => r[k]!)).toFixed(2)}`).join(" ")}; full ${parts.map((k) => `${k}=${median(full.map((r) => r[k]!)).toFixed(2)}`).join(" ")}`);
    if (process.env.PERF_OUT) fs.writeFileSync(process.env.PERF_OUT, JSON.stringify(rows));
    expect(total).toBeGreaterThan(150);
    // Every edit run measured one block and resumed the pages (not a full pagination).
    expect(editRuns.every((r) => r.measured === 1 && r.resumedFrom! > 0)).toBe(true);
  });
});
