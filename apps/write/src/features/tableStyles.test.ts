// P8-17: the table style resolver mirrors `Document::resolve_cell_props`
// (the same cases as the Rust tests in `model-text/src/table.rs`), and the
// cell styles the editor renders.

import { describe, expect, it } from "vitest";
import type { Block } from "../generated/Block";
import type { StyleSheet } from "../generated/StyleSheet";
import type { Table } from "../generated/Table";
import type { TableLook } from "../generated/TableLook";
import { makeDoc, para } from "../test/fixtures";
import { toPM } from "../sync/toPM";
import { writeSchema } from "../sync/schema";
import { BUILTIN_TABLE_STYLES, GALLERY_TABLE_STYLES, regions, resolveCellProps, resolveTableStyle, tableStyleFor } from "./tableStyles";
import { cellCss, tableCellStyles } from "./tableRender";

const sheet: StyleSheet = { defaults: {}, styles: BUILTIN_TABLE_STYLES };
const WORD: TableLook = { firstRow: true, lastRow: false, firstCol: true, lastCol: false, bandedRows: true, bandedCols: false };
const accent = (tint: number) => ({ kind: "theme", value: { slot: "accent1", tint } });

/** A `rows × cols` table with cell texts "r,c". */
function grid(rows: number, cols: number, props: Table["props"] = {}): Table {
  let id = 1000;
  return {
    id: 1,
    props: { colWidths: Array(cols).fill(1200), ...props },
    rows: Array.from({ length: rows }, (_, r) => ({
      id: ++id,
      cells: Array.from({ length: cols }, (_, c) => ({ id: ++id, blocks: [para(++id, `${r},${c}`)] })),
    })),
  };
}

describe("table style resolution", () => {
  it("the built-ins: Normal Table is the default; the gallery offers the others", () => {
    expect(BUILTIN_TABLE_STYLES.find((s) => s.isDefault)?.id).toBe("TableNormal");
    expect(GALLERY_TABLE_STYLES).toEqual(["TableGrid", "PlainTable1", "ListTable3", "GridTable4-Accent1", "GridTable4-Accent2", "GridTable4-Accent3"]);
  });

  it("resolveTableStyle merges the basedOn chain (Normal Table's margins reach Grid Table 4)", () => {
    const s = resolveTableStyle(BUILTIN_TABLE_STYLES, "GridTable4-Accent1")!;
    expect(s.table?.cellMargins?.left).toBe(108);
    expect(s.conditional?.map((c) => c.kind)).toContain("firstRow");
    expect(resolveTableStyle(BUILTIN_TABLE_STYLES, "Nope")).toBeNull();
  });

  it("tableStyleFor falls back to the default table style", () => {
    expect(tableStyleFor(BUILTIN_TABLE_STYLES, "Heading1")?.table?.cellMargins?.left).toBe(108);
    expect(tableStyleFor([], null)).toBeNull();
  });

  it("Grid Table 4: header fill and bold white text, bands, inside lines (Rust resolve_banded_grid_table)", () => {
    const t = grid(4, 3, { style: "GridTable4-Accent1", look: WORD });
    const h = resolveCellProps(sheet, t, 0, 1)!;
    expect(h.cell.shading).toEqual(accent(0));
    expect(h.cell.borders?.top?.color).toEqual(accent(0));
    expect(h.cell.borders?.left?.style).toBe("none");
    expect(h.run.bold).toBe(true);
    expect(h.run.color).toEqual({ kind: "theme", value: { slot: "light1", tint: 0 } });
    expect(resolveCellProps(sheet, t, 1, 1)!.cell.shading).toEqual(accent(0.8));
    expect(resolveCellProps(sheet, t, 2, 1)!.cell.shading).toBeUndefined();
    expect(resolveCellProps(sheet, t, 3, 1)!.cell.shading).toEqual(accent(0.8));
    const inner = resolveCellProps(sheet, t, 2, 1)!.cell.borders!;
    expect(inner.top?.color).toEqual(accent(0.4));
    expect(inner.left?.color).toEqual(accent(0.4));
    expect(resolveCellProps(sheet, t, 2, 0)!.run.bold).toBe(true);
    expect(resolveCellProps(sheet, t, 2, 1)!.run.bold).toBeUndefined();
  });

  it("banding off: no fill; direct shading wins; the total row gets a double top border", () => {
    const t = grid(4, 3, { style: "GridTable4-Accent1", look: { ...WORD, bandedRows: false } });
    expect(resolveCellProps(sheet, t, 1, 1)!.cell.shading).toBeUndefined();
    t.rows[1]!.cells[1]!.props = { shading: { kind: "rgb", value: "FF0000" } };
    expect(resolveCellProps(sheet, t, 1, 1)!.cell.shading).toEqual({ kind: "rgb", value: "FF0000" });
    t.props!.look = { ...WORD, lastRow: true };
    expect(resolveCellProps(sheet, t, 3, 0)!.cell.borders?.top?.style).toBe("double");
  });

  it("no style: Normal Table margins, no borders; Table Grid: all edges single; unknown cells are null", () => {
    const p = resolveCellProps(sheet, grid(1, 1), 0, 0)!;
    expect(p.cell.borders).toBeUndefined();
    expect(p.cell.margins?.left).toBe(108);
    const g = grid(2, 2, { style: "TableGrid" });
    const e = resolveCellProps(sheet, g, 1, 1)!.cell.borders!;
    expect([e.top, e.left, e.bottom, e.right].every((s) => s?.style === "single")).toBe(true);
    expect(resolveCellProps(sheet, g, 2, 0)).toBeNull();
    expect(resolveCellProps({ defaults: {}, styles: [] }, g, 0, 0)!.cell.borders).toBeUndefined();
  });

  it("List Table 3 with banded columns: left/right borders on columns 0 and 2 (Rust resolve_banded_columns_list_table)", () => {
    const t = grid(3, 4, { style: "ListTable3", look: { firstRow: false, lastRow: false, firstCol: false, lastCol: false, bandedRows: false, bandedCols: true } });
    const c0 = resolveCellProps(sheet, t, 1, 0)!.cell.borders!;
    expect(c0.left && c0.right).toBeTruthy();
    expect(resolveCellProps(sheet, t, 1, 1)!.cell.borders).toBeUndefined();
    const c2 = resolveCellProps(sheet, t, 1, 2)!.cell.borders!;
    expect(c2.left && c2.right).toBeTruthy();
  });

  it("a vertically merged cell resolves as its whole region (continue cells use the origin)", () => {
    const t = grid(3, 2, { style: "GridTable4-Accent1", look: WORD });
    t.rows[1]!.cells[1]!.vMerge = "restart";
    t.rows[2]!.cells[1]!.vMerge = "continue";
    // The region ends on the last row: its bottom edge is the table's bottom border.
    expect(resolveCellProps(sheet, t, 1, 1)!.cell.borders?.bottom?.color).toEqual(accent(0.4));
    expect(resolveCellProps(sheet, t, 2, 1)!.cell.shading).toEqual(accent(0.8));
  });

  it("regions: priority order and corners", () => {
    const style = resolveTableStyle(BUILTIN_TABLE_STYLES, "PlainTable1")!;
    const all: TableLook = { firstRow: true, lastRow: true, firstCol: true, lastCol: true, bandedRows: true, bandedCols: true };
    expect(regions(4, 4, style, all, { row0: 0, row1: 0, col0: 3, col1: 3 }).map((r) => r.kind)).toEqual(["wholeTable", "firstRow", "lastCol", "neCell"]);
    expect(regions(4, 4, style, all, { row0: 1, row1: 1, col0: 1, col1: 1 }).map((r) => r.kind)).toEqual(["wholeTable", "band1Vert", "band1Horz"]);
    expect(regions(4, 4, style, all, { row0: 2, row1: 2, col0: 2, col1: 2 }).map((r) => r.kind)).toEqual(["wholeTable", "band2Vert", "band2Horz"]);
  });
});

describe("rendered cell styles", () => {
  it("cellCss: edges, fill, padding, text", () => {
    const t = grid(2, 2, { style: "GridTable4-Accent1", look: WORD });
    const css = cellCss(resolveCellProps(sheet, t, 0, 0)!);
    expect(css).toMatch(/background-color: #4472c4/i);
    expect(css).toMatch(/color: #ffffff/i);
    expect(css).toMatch(/font-weight: 700/);
    expect(css).toMatch(/padding: 0\.0px 7\.2px 0\.0px 7\.2px/);
    expect(css).toMatch(/border-top: 1px solid #4472c4/i);
  });

  it("tableCellStyles: one style per PM cell (merged cells once), banding by look", () => {
    const t = grid(3, 3, { style: "GridTable4-Accent1", look: WORD });
    t.rows[0]!.cells[0]!.gridSpan = 2;
    t.rows[0]!.cells.splice(1, 1);
    const doc = toPM(makeDoc([{ kind: "table", value: t } as Block]), writeSchema());
    const styles = tableCellStyles(doc.child(0), sheet);
    expect(styles).toHaveLength(8);
    expect(styles[0]![1]).toMatch(/background-color: #4472c4/i);
    // Row 1 is band 1 (tinted), row 2 band 2 (no fill).
    expect(styles[3]![1]).toMatch(/background-color/);
    expect(styles[6]![1]).not.toMatch(/background-color/);
  });
});
