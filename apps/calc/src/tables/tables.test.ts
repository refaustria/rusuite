// Excel tables in the UI (P8-35): styles, looks, structured reference
// reading, autocomplete and the controller's text helpers.
import { describe, expect, it } from "vitest";
import type { Table } from "../generated/Table";
import { colorRefs } from "../formula/refs";
import { tokenize } from "../formula/tokenize";
import { checkFormula } from "../formula/validate";
import { columnsRef, escapeColumn, needsBrackets, thisRowRef } from "./controller";
import { parseStruct, structCompletion, structInsert, structItems, structRange } from "./structured";
import { dataRows, DEFAULT_TABLE_STYLE, lookAsStyle, previewColors, TABLE_STYLES, tableLook, tableStyle, tableStyleNumber } from "./styles";

/** Item / Qty / Unit Price in B2:D6 (header row 1, data rows 2–5 0-based 2..5). */
const table = (over: Partial<Table> = {}): Table => ({
  id: 1, name: "Table1", r0: 1, c0: 1, r1: 5, c1: 3, headerRow: true,
  columns: [{ id: 1, name: "Item" }, { id: 2, name: "Qty" }, { id: 3, name: "Unit Price" }],
  style: DEFAULT_TABLE_STYLE, look: { firstColumn: false, lastColumn: false, bandedRows: true, bandedColumns: false }, ...over,
});

describe("table styles", () => {
  it("has Excel's 60 built-in styles in gallery order", () => {
    expect(TABLE_STYLES).toHaveLength(60);
    expect(TABLE_STYLES[0]).toBe("TableStyleLight1");
    expect(TABLE_STYLES[21]).toBe("TableStyleMedium1");
    expect(TABLE_STYLES.at(-1)).toBe("TableStyleDark11");
  });
  it("defines every gallery style; unknown names have none", () => {
    for (const s of TABLE_STYLES) expect(tableStyle(s)).not.toBeNull();
    expect(tableStyle("MyStyle")).toBeNull();
    expect(tableStyle("PivotStyleLight16")).toBeNull();
  });
  it("Medium 2 has a blue header with white text and a light blue band", () => {
    const d = tableStyle("TableStyleMedium2")!;
    expect(d.headerFill).toBe("#4472C4");
    expect(d.headerColor).toBe("#FFFFFF");
    expect(d.band).toMatch(/^#[0-9A-F]{6}$/);
    expect(d.band).not.toBe(d.headerFill);
  });
  it("Light 1 has no header fill", () => {
    expect(tableStyle("TableStyleLight1")!.headerFill).toBeNull();
  });
  it("Dark styles have white body text", () => {
    expect(tableStyle("TableStyleDark2")!.bodyColor).toBe("#FFFFFF");
  });
  it("names the gallery entries by family and number", () => {
    expect(tableStyleNumber("TableStyleMedium9")).toEqual({ family: "medium", n: 9 });
    expect(tableStyleNumber("TableStyleLight21")).toEqual({ family: "light", n: 21 });
    expect(tableStyleNumber("Other")).toBeNull();
  });
  it("gives every style preview colours", () => {
    for (const s of TABLE_STYLES) {
      const p = previewColors(s);
      expect(p.header).toMatch(/^#/);
      expect(p.rows).toHaveLength(2);
    }
  });
});

describe("table looks", () => {
  it("knows the data rows with and without header / totals", () => {
    expect(dataRows(table())).toEqual([2, 5]);
    expect(dataRows(table({ totalsRow: true }))).toEqual([2, 4]);
    expect(dataRows(table({ headerRow: false }))).toEqual([1, 5]);
  });
  it("is undefined outside the table", () => {
    expect(tableLook(table(), 0, 1)).toBeUndefined();
    expect(tableLook(table(), 2, 4)).toBeUndefined();
  });
  it("paints the header bold with the style's fill", () => {
    const l = tableLook(table(), 1, 2)!;
    expect(l.bold).toBe(true);
    expect(l.fill).toBe("#4472C4");
    expect(l.color).toBe("#FFFFFF");
  });
  it("bands every other data row starting with the first", () => {
    const band = tableStyle(DEFAULT_TABLE_STYLE)!.band;
    expect(tableLook(table(), 2, 1)!.fill).toBe(band);
    expect(tableLook(table(), 3, 1)!.fill).toBeUndefined();
    expect(tableLook(table(), 4, 1)!.fill).toBe(band);
  });
  it("without banded rows the body is plain", () => {
    const t = table({ look: { firstColumn: false, lastColumn: false, bandedRows: false, bandedColumns: false } });
    expect(tableLook(t, 2, 1)!.fill).toBeUndefined();
  });
  it("bands columns when asked", () => {
    const t = table({ look: { firstColumn: false, lastColumn: false, bandedRows: false, bandedColumns: true } });
    expect(tableLook(t, 3, 1)!.fill).toBeDefined();
    expect(tableLook(t, 3, 2)!.fill).toBeUndefined();
  });
  it("first and last column are bold", () => {
    const t = table({ look: { firstColumn: true, lastColumn: true, bandedRows: false, bandedColumns: false } });
    expect(tableLook(t, 3, 1)!.bold).toBe(true);
    expect(tableLook(t, 3, 3)!.bold).toBe(true);
    expect(tableLook(t, 3, 2)!.bold).toBeUndefined();
  });
  it("the totals row is bold with a line above", () => {
    const l = tableLook(table({ totalsRow: true }), 5, 2)!;
    expect(l.bold).toBe(true);
    expect(l.top).toBeDefined();
  });
  it("the last data row closes the table with the style's line", () => {
    expect(tableLook(table(), 5, 2)!.bottom).toBe(tableStyle(DEFAULT_TABLE_STYLE)!.line);
  });
  it("an unknown style has no look", () => {
    expect(tableLook(table({ style: "Custom" }), 2, 1)).toBeUndefined();
  });
  it("turns a look into cell formats (Convert to Range)", () => {
    const s = lookAsStyle({ fill: "#4472c4", bold: true, color: "#ffffff", bottom: "#000000" });
    expect(s.fill).toEqual({ kind: "solid", color: { kind: "rgb", value: "4472C4" } });
    expect(s.font).toEqual({ bold: true, color: { kind: "rgb", value: "FFFFFF" } });
    expect(s.borders?.bottom).toEqual({ style: "thin", color: { kind: "rgb", value: "000000" } });
    expect(lookAsStyle({})).toEqual({});
  });
});

describe("structured reference text", () => {
  it("knows when a column needs brackets after @", () => {
    expect(needsBrackets("Qty")).toBe(false);
    expect(needsBrackets("Unit Price")).toBe(true);
    expect(needsBrackets("2024")).toBe(true);
    expect(needsBrackets("")).toBe(true);
  });
  it("escapes special characters with '", () => {
    expect(escapeColumn("A[1]")).toBe("A'[1']");
    expect(escapeColumn("#No")).toBe("'#No");
    expect(escapeColumn("It's")).toBe("It''s");
  });
  it("writes this-row references inside and outside the table", () => {
    expect(thisRowRef("Qty", null)).toBe("[@Qty]");
    expect(thisRowRef("Unit Price", null)).toBe("[@[Unit Price]]");
    expect(thisRowRef("Qty", "Table1")).toBe("Table1[@Qty]");
  });
  it("writes column references", () => {
    const t = table();
    expect(columnsRef(t, 2, 2)).toBe("Table1[Qty]");
    expect(columnsRef(t, 2, 3)).toBe("Table1[[Qty]:[Unit Price]]");
    expect(columnsRef(t, 1, 3)).toBe("Table1");
  });
});

describe("parseStruct / structRange", () => {
  const t = table({ totalsRow: true });
  it("reads a column", () => {
    expect(parseStruct("Table1[Qty]")).toEqual({ table: "Table1", items: [], columns: ["Qty", null], thisRow: false });
    expect(structRange(t, parseStruct("Table1[Qty]")!, 0)).toEqual({ r0: 2, c0: 2, r1: 4, c1: 2 });
  });
  it("reads a column range", () => {
    expect(structRange(t, parseStruct("Table1[[Qty]:[Unit Price]]")!, 0)).toEqual({ r0: 2, c0: 2, r1: 4, c1: 3 });
  });
  it("reads #All, #Headers, #Totals", () => {
    expect(structRange(t, parseStruct("Table1[#All]")!, 0)).toEqual({ r0: 1, c0: 1, r1: 5, c1: 3 });
    expect(structRange(t, parseStruct("Table1[[#Headers],[Qty]]")!, 0)).toEqual({ r0: 1, c0: 2, r1: 1, c1: 2 });
    expect(structRange(t, parseStruct("Table1[[#Totals],[Qty]]")!, 0)).toEqual({ r0: 5, c0: 2, r1: 5, c1: 2 });
    expect(structRange(t, parseStruct("Table1[[#Headers],[#Data],[Qty]]")!, 0)).toEqual({ r0: 1, c0: 2, r1: 4, c1: 2 });
  });
  it("reads this-row references for the formula's row", () => {
    expect(parseStruct("[@Qty]")).toEqual({ table: null, items: [], columns: ["Qty", null], thisRow: true });
    expect(structRange(t, parseStruct("[@[Unit Price]]")!, 3)).toEqual({ r0: 3, c0: 3, r1: 3, c1: 3 });
    expect(structRange(t, parseStruct("[@Qty]")!, 0)).toBeNull();
    expect(structRange(t, parseStruct("Table1[[#This Row],[Qty]]")!, 2)).toEqual({ r0: 2, c0: 2, r1: 2, c1: 2 });
  });
  it("an empty bracket is the data", () => {
    expect(structRange(t, parseStruct("Table1[]")!, 0)).toEqual({ r0: 2, c0: 1, r1: 4, c1: 3 });
  });
  it("unknown columns and missing parts resolve to nothing", () => {
    expect(structRange(t, parseStruct("Table1[Nope]")!, 0)).toBeNull();
    expect(structRange(table(), parseStruct("Table1[#Totals]")!, 0)).toBeNull();
  });
  it("unescapes column names", () => {
    expect(parseStruct("T[[A'[1']]]")!.columns).toEqual(["A[1]", null]);
  });
  it("rejects malformed text", () => {
    expect(parseStruct("Table1")).toBeNull();
    expect(parseStruct("T[[a]x]")).toBeNull();
  });
});

describe("structured references in formulas", () => {
  it("tokenizes Table1[...] and [@...] as one token", () => {
    const { tokens, error } = tokenize("=SUM(Table1[[Qty]:[Unit Price]])+[@Qty]");
    expect(error ?? null).toBeNull();
    expect(tokens.filter((x) => x.kind === "struct").map((x) => x.text)).toEqual(["Table1[[Qty]:[Unit Price]]", "[@Qty]"]);
  });
  it("reports an unterminated bracket", () => {
    expect(tokenize("=Table1[Qty").error?.message).toMatch(/unterminated/);
  });
  it("accepts structured references as operands", () => {
    expect(checkFormula("=SUM(Table1[Qty])*2")).toBeNull();
    expect(checkFormula("=[@Qty]*[@[Unit Price]]")).toBeNull();
  });
  it("colours structured references over their cells", () => {
    const refs = colorRefs("=SUM(Table1[Qty])+B3", undefined, undefined, (tok) => (tok === "Table1[Qty]" ? { sheet: null, range: { r0: 2, c0: 2, r1: 4, c1: 2 } } : null));
    expect(refs.map((r) => r.name ?? "ref")).toEqual(["Table1[Qty]", "ref"]);
    expect(refs[0]!.range).toEqual({ r0: 2, c0: 2, r1: 4, c1: 2 });
    expect(refs[0]!.color).not.toBe(refs[1]!.color);
  });
});

describe("structured reference autocomplete", () => {
  it("opens after Table1[ with the typed prefix", () => {
    expect(structCompletion("=SUM(Table1[Q", 13)).toEqual({ table: "Table1", thisRow: false, prefix: "Q", start: 12, end: 13 });
  });
  it("knows [@ and the formula's own table", () => {
    expect(structCompletion("=[@U", 4)).toEqual({ table: null, thisRow: true, prefix: "U", start: 3, end: 4 });
  });
  it("stays closed outside brackets and strings", () => {
    expect(structCompletion("=SUM(A1", 7)).toBeNull();
    expect(structCompletion('="Table1[Q', 10)).toBeNull();
    expect(structCompletion("Table1[Q", 8)).toBeNull();
  });
  it("lists matching columns and special items", () => {
    expect(structItems(["Item", "Qty", "Unit Price"], "", false)).toEqual(["Item", "Qty", "Unit Price", "#All", "#Data", "#Headers", "#Totals", "#This Row"]);
    expect(structItems(["Item", "Qty"], "q", false)).toEqual(["Qty"]);
    expect(structItems(["Item", "Qty"], "", true)).toEqual(["Item", "Qty"]);
    expect(structItems(["Item"], "#t", false)).toEqual(["#Totals", "#This Row"]);
  });
  it("inserts the closing bracket and brackets names after @", () => {
    expect(structInsert("Qty", false, true)).toBe("Qty]");
    expect(structInsert("#All", false, true)).toBe("#All]");
    expect(structInsert("Unit Price", true, false)).toBe("[Unit Price]]");
    expect(structInsert("Qty", true, false)).toBe("Qty]");
  });
});
