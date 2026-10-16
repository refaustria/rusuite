import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { applyPageRange } from "@rusuite/ui-shared";
import { CalcApi } from "../backend/calcApi";
import { FakeBackend, FakeCalcCore } from "../dev/fakeBackend";
import type { CellStyle } from "../generated/CellStyle";
import { emptyCache, type SheetCache } from "../state/store";
import App from "../App";
import { loadUsedRange } from "./loadUsed";
import { buildCalcPrintDoc, calcPrintDocument, selectionRange, sliceTableHtml, styleText } from "./calcPrintDoc";
import { calcScale, colLetters, DEFAULT_CALC_PRINT, paginate, printableArea, splitRuns, type CalcPrintOptions } from "./layout";
import { buildPrintTable, type PrintTable } from "./printTable";
import { CalcStore } from "../state/store";

afterEach(cleanup);

const O = DEFAULT_CALC_PRINT;
/** A table of `rows × cols` default-sized cells with "r,c" texts. */
function grid(rows: number, cols: number, w = 64, h = 20): PrintTable {
  return {
    cols: Array.from({ length: cols }, (_, c) => ({ col: c, width: w })),
    rows: Array.from({ length: rows }, (_, r) => ({ row: r, height: h, cells: Array.from({ length: cols }, (_, c) => ({ col: c, text: `${r},${c}`, style: {} })) })),
    width: cols * w,
    height: rows * h,
  };
}

describe("pagination math", () => {
  it("splitRuns packs sizes into runs that fit", () => {
    expect(splitRuns([10, 10, 10, 10, 10], 25)).toEqual([[0, 2], [2, 4], [4, 5]]);
    expect(splitRuns([], 25)).toEqual([]);
  });
  it("splitRuns gives an oversized item its own run and honours a smaller rest", () => {
    expect(splitRuns([5, 50, 5], 20)).toEqual([[0, 1], [1, 2], [2, 3]]);
    expect(splitRuns([10, 10, 10, 10], 30, 20)).toEqual([[0, 3], [3, 4]]);
  });
  it("printable area of A4 portrait with Excel's normal margins", () => {
    const a = printableArea(O);
    expect(a.width).toBeCloseTo((210 / 25.4 - 1.4) * 96, 3);
    expect(a.height).toBeCloseTo((297 / 25.4 - 1.5) * 96, 3);
    expect(printableArea({ ...O, orientation: "landscape" }).width).toBeCloseTo((297 / 25.4 - 1.4) * 96, 3);
  });
  it("scale modes: actual, custom, fit sheet / columns / rows only shrink", () => {
    expect(calcScale(O, 2000, 500, 1000, 1000)).toBe(1);
    expect(calcScale({ ...O, scale: "custom", percent: 75 }, 1, 1, 1000, 1000)).toBe(0.75);
    expect(calcScale({ ...O, scale: "fitColumns" }, 2000, 5000, 1000, 1000)).toBe(0.5);
    expect(calcScale({ ...O, scale: "fitRows" }, 2000, 4000, 1000, 1000)).toBe(0.25);
    expect(calcScale({ ...O, scale: "fitSheet" }, 2000, 4000, 1000, 1000)).toBe(0.25);
    expect(calcScale({ ...O, scale: "fitSheet" }, 200, 400, 1000, 1000)).toBe(1);
  });
  it("120 default rows give 3 A4 portrait pages (48 rows each)", () => {
    const p = paginate([64], Array(120).fill(20), O, printableArea(O));
    expect(p.pages.map((s) => s.rows)).toEqual([[0, 48], [48, 96], [96, 120]]);
  });
  it("wide sheets paginate into page columns, down then over", () => {
    const area = printableArea(O); // ≈ 659 px wide → 10 columns of 64 px
    const p = paginate(Array(25).fill(64), Array(60).fill(20), O, area);
    expect(p.pages.map((s) => `${s.cols[0]}:${s.rows[0]}`)).toEqual(["0:0", "0:48", "10:0", "10:48", "20:0", "20:48"]);
  });
  it("fit all columns: one page column at a smaller scale", () => {
    const p = paginate(Array(25).fill(64), Array(60).fill(20), { ...O, scale: "fitColumns" }, printableArea(O));
    expect(p.scale).toBeLessThan(0.45);
    expect(new Set(p.pages.map((s) => s.cols[0]))).toEqual(new Set([0]));
    expect(paginate(Array(25).fill(64), Array(60).fill(20), { ...O, scale: "fitSheet" }, printableArea(O)).pages).toHaveLength(1);
  });
  it("repeated header rows shrink the later pages and are marked for repetition", () => {
    const p = paginate([64], Array(120).fill(20), { ...O, repeatRows: 2 }, printableArea(O));
    expect(p.pages[0]).toEqual({ rows: [0, 48], cols: [0, 1], repeat: 0 });
    expect(p.pages[1]).toEqual({ rows: [48, 94], cols: [0, 1], repeat: 2 });
  });
  it("headings take a row and a column of the page", () => {
    const p = paginate([64], Array(120).fill(20), { ...O, headings: true }, printableArea(O));
    expect(p.pages[0]!.rows).toEqual([0, 47]);
    expect(colLetters(0)).toBe("A");
    expect(colLetters(27)).toBe("AB");
  });
});

describe("print document", () => {
  it("one sheet part → pages with tokens expanded in header and footer", () => {
    const o: CalcPrintOptions = { ...O, header: { left: "&A", center: "", right: "" }, footer: { left: "", center: "Page &P of &N", right: "" } };
    const doc = calcPrintDocument([{ sheetName: "Data", table: grid(120, 2) }], o);
    expect(doc.pages).toHaveLength(3);
    expect(doc.widthIn).toBeCloseTo(210 / 25.4, 3);
    expect(doc.pages[1]).toContain("Page 2 of 3");
    expect(doc.pages[0]).toContain(">Data<");
    expect(applyPageRange(doc, "2-2").pages).toEqual([doc.pages[1]]);
  });
  it("several sheets: each starts a page; page numbers run over the workbook", () => {
    const o: CalcPrintOptions = { ...O, footer: { left: "", center: "&P/&N", right: "" } };
    const doc = calcPrintDocument([{ sheetName: "A", table: grid(10, 1) }, { sheetName: "B", table: grid(60, 1) }, { sheetName: "Empty", table: grid(0, 0) }], o);
    expect(doc.pages).toHaveLength(3);
    expect(doc.pages[2]).toContain("3/3");
  });
  it("slice table: gridlines, headings and repeated rows", () => {
    const html = sliceTableHtml(grid(5, 3), { rows: [3, 5], cols: [1, 3], repeat: 1 }, { gridlines: true, headings: true });
    expect(html).toContain('class="rs-calc-table rs-grid"');
    expect(html).toContain("<th>B</th><th>C</th>");
    expect([...html.matchAll(/data-row="(\d+)"/g)].map((m) => m[1])).toEqual(["0", "3", "4"]);
    expect(html).not.toContain("0,0");
    expect(html).toContain("<th>4</th>");
  });
  it("styleText turns React styles into inline CSS and escapes quotes", () => {
    expect(styleText({ fontWeight: "bold", fontSize: 12, fontFamily: '"Calibri"', color: undefined })).toBe("font-weight:bold;font-size:12px;font-family:'Calibri'");
  });
  it("selection-only range: whole columns are clipped to the used rows", () => {
    expect(selectionRange({ r0: 1, c0: 1, r1: 3, c1: 2 }, { lastRow: 100, lastCol: 10 })).toEqual({ r0: 1, c0: 1, r1: 3, c1: 2 });
    expect(selectionRange({ r0: 0, c0: 2, r1: 1048575, c1: 2 }, { lastRow: 9, lastCol: 5 })).toEqual({ r0: 0, c0: 2, r1: 9, c1: 2 });
    expect(selectionRange({ r0: 0, c0: 7, r1: 1048575, c1: 7 }, { lastRow: -1, lastCol: -1 })).toBeNull();
  });
});

describe("print table", () => {
  const styles: CellStyle[] = [
    {},
    { font: { bold: true }, fill: { kind: "solid", color: { kind: "rgb", value: "FFFF00" } } as never, borders: { bottom: { style: "thin", color: { kind: "rgb", value: "000000" } as never } } },
  ];
  const cache: SheetCache = (() => {
    const c = emptyCache();
    const put = (row: number, col: number, display: string, style = 0, kind: "text" | "number" = "text") =>
      (c.cells.get(row) ?? c.cells.set(row, new Map()).get(row)!).set(col, { row, col, input: display, display, kind, style });
    put(0, 0, "Name", 1);
    put(0, 2, "Qty", 1);
    put(1, 0, "Apple");
    put(1, 2, "3", 0, "number");
    c.cols.set(1, { col: 1, width: null, hidden: true, style: null });
    c.cols.set(0, { col: 0, width: 20, hidden: false, style: null });
    c.rows.set(1, { row: 1, height: 30, hidden: false, style: null });
    return c;
  })();

  it("models the used range with widths, heights, hidden columns and styles", () => {
    const t = buildPrintTable(cache, styles, 1, 2);
    expect(t.cols).toEqual([{ col: 0, width: 145 }, { col: 2, width: 64 }]);
    expect(t.rows.map((r) => r.height)).toEqual([20, 40]);
    expect(t.rows[0]!.cells.map((c) => c.text)).toEqual(["Name", "Qty"]);
    expect(t.rows[0]!.cells[0]!.style).toMatchObject({ fontWeight: "bold", borderBottom: "1px solid #000000" });
    expect(t.rows[1]!.cells[1]!.style.textAlign).toBe("right");
  });

  it("selection-only table: only the selected rows and columns", () => {
    const t = buildPrintTable(cache, styles, 1, 2, 1, 2);
    expect(t.cols.map((c) => c.col)).toEqual([2]);
    expect(t.rows.map((r) => r.cells.map((c) => c.text))).toEqual([["3"]]);
  });
});

describe("print flow", () => {
  it("loadUsedRange finds data beyond the first block", async () => {
    const core = new FakeCalcCore();
    const backend = new FakeBackend(core);
    const store = new CalcStore(new CalcApi(backend));
    await store.init();
    const sheet = store.getState().activeSheet;
    await store.api.apply({ type: "setInput", sheet, row: 70, col: 40, input: "far" });
    await store.api.apply({ type: "setInput", sheet, row: 3, col: 1, input: "near" });
    const fresh = new CalcStore(new CalcApi(backend));
    expect(await loadUsedRange(fresh, sheet)).toEqual({ lastRow: 70, lastCol: 40 });
  });

  it("entire workbook prints every sheet; selection prints only the selection", async () => {
    const backend = new FakeBackend(new FakeCalcCore());
    const store = new CalcStore(new CalcApi(backend));
    await store.init();
    const first = store.getState().activeSheet;
    await store.apply({ type: "setInput", sheet: first, row: 0, col: 0, input: "one" });
    await store.apply({ type: "setInput", sheet: first, row: 5, col: 3, input: "corner" });
    await store.insertSheet();
    const second = store.getState().info!.sheets.find((s) => s.id !== first)!.id;
    await store.apply({ type: "setInput", sheet: second, row: 0, col: 0, input: "two" });
    const all = await buildCalcPrintDoc(store, { ...O, what: "workbook", header: { left: "&A", center: "", right: "" } });
    expect(all.pages).toHaveLength(2);
    expect(all.pages.join("")).toContain("two");
    expect(await buildCalcPrintDoc(store, O).then((d) => d.pages.length)).toBe(1);
    store.setActiveSheet(first);
    store.select({ anchor: { row: 5, col: 3 }, focus: { row: 5, col: 2 } });
    const sel = await buildCalcPrintDoc(store, { ...O, what: "selection" });
    expect(sel.pages).toHaveLength(1);
    expect(sel.pages[0]).toContain("corner");
    expect(sel.pages[0]).not.toContain("one");
  });

  it("Ctrl+P opens File › Print with a preview; Print and Export PDF… print", async () => {
    const backend = new FakeBackend(new FakeCalcCore());
    HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
    render(<App backend={backend} />);
    await screen.findByRole("tab", { name: "Sheet1" });
    const store = (window as unknown as { __calc: { store: CalcStore } }).__calc.store;
    const sheet = store.getState().activeSheet;
    await store.apply({ type: "setInput", sheet, row: 0, col: 0, input: "printed text" });
    await store.apply({ type: "setInput", sheet, row: 99, col: 0, input: "last" });
    fireEvent.keyDown(window, { key: "p", ctrlKey: true });
    const backstage = await screen.findByRole("dialog", { name: "File" });
    expect(within(backstage).getByTestId("print-os-note").textContent).toContain("system print dialog");
    await waitFor(() => expect(screen.getByTestId("print-page-count").textContent).toBe("Page 1 of 3"));
    expect(screen.getByTestId("print-preview").getAttribute("srcdoc")).toContain("printed text");
    fireEvent.change(within(backstage).getByLabelText("Page range"), { target: { value: "2-3" } });
    await waitFor(() => expect(screen.getByTestId("print-page-count").textContent).toBe("Page 1 of 2"));
    fireEvent.change(within(backstage).getByLabelText("Page range"), { target: { value: "9" } });
    await waitFor(() => expect(screen.getByTestId("print-error").textContent).toContain("3 pages"));
    expect((screen.getByTestId("print-button") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(backstage).getByRole("radio", { name: "All pages" }));
    fireEvent.click(screen.getByTestId("print-button"));
    await waitFor(() => expect(backend.printed).toBe(1));
    expect(document.getElementById("rusuite-print-root")!.querySelectorAll(".rs-print-page")).toHaveLength(3);
    window.dispatchEvent(new Event("afterprint"));
    await waitFor(() => expect(document.getElementById("rusuite-print-root")).toBeNull());
    fireEvent.change(within(backstage).getByLabelText("Paper size"), { target: { value: "Letter" } });
    fireEvent.click(within(backstage).getByRole("button", { name: "Home" }));
    expect(screen.queryByTestId("print-panel")).toBeNull();
    fireEvent.click(within(backstage).getByRole("button", { name: "Export PDF…" }));
    await waitFor(() => expect(backend.printed).toBe(2));
    expect(document.getElementById("rusuite-print-root")!.innerHTML).toContain("size: 8.5in 11in");
    window.dispatchEvent(new Event("afterprint"));
  });
});

describe("merged cells in print (P8-3)", () => {
  function mergedCache(): SheetCache {
    const cache = emptyCache();
    cache.cells.set(0, new Map([[0, { row: 0, col: 0, input: "Report", display: "Report", kind: "text", style: 1 }]]));
    cache.cells.set(2, new Map([[1, { row: 2, col: 1, input: "x", display: "x", kind: "text", style: 0 }]]));
    cache.merges = [{ r0: 0, c0: 0, r1: 1, c1: 2 }];
    return cache;
  }
  const styles: CellStyle[] = [{}, { alignment: { horizontal: "center" } }];

  it("the top-left cell spans the merge (colspan/rowspan), covered cells are left out", () => {
    const t = buildPrintTable(mergedCache(), styles, 2, 2);
    expect(t.rows[0]!.cells[0]).toMatchObject({ text: "Report", span: { rows: 2, cols: 3 } });
    expect(t.rows[1]!.cells.map((c) => !!c.covered)).toEqual([true, true, true]);
    const html = sliceTableHtml(t, { rows: [0, 3], cols: [0, 3], repeat: 0 }, { gridlines: false, headings: false });
    expect(html).toContain('<td colspan="3" rowspan="2" style="');
    expect(html).toContain("text-align:center");
    expect((html.match(/<td/g) ?? []).length).toBe(1 + 3);
  });

  it("a page break through a merge cuts the spans; covered cells of the other page print empty", () => {
    const t = buildPrintTable(mergedCache(), styles, 2, 2);
    const left = sliceTableHtml(t, { rows: [0, 3], cols: [0, 2], repeat: 0 }, { gridlines: false, headings: false });
    expect(left).toContain('<td colspan="2" rowspan="2"');
    const right = sliceTableHtml(t, { rows: [0, 3], cols: [2, 3], repeat: 0 }, { gridlines: false, headings: false });
    expect(right.match(/<td><\/td>/g)).toHaveLength(2);
  });
});

describe("Page Layout names in print (P8-35)", () => {
  it("reads the sheet's print area and title rows", async () => {
    const { sheetPrintNames } = await import("./calcPrintDoc");
    const names = [
      { name: "Print_Area", sheet: 0, builtin: "printArea" as const, refersTo: "Sheet1!$A$1:$C$9", range: { sheet: 0, r0: 0, c0: 0, r1: 8, c1: 2 } },
      { name: "Print_Titles", sheet: 0, builtin: "printTitles" as const, refersTo: "Sheet1!$1:$2,Sheet1!$A:$A" },
      { name: "Print_Titles", sheet: 1, builtin: "printTitles" as const, refersTo: "Sheet2!$3:$4" },
    ];
    expect(sheetPrintNames(names, 0)).toEqual({ area: { r0: 0, c0: 0, r1: 8, c1: 2 }, titleRows: 2 });
    expect(sheetPrintNames(names, 1)).toEqual({ area: null, titleRows: 0 });
    expect(sheetPrintNames([], 0)).toEqual({ area: null, titleRows: 0 });
  });
});
