// Table styles in the editor (mirror of `model_text`'s
// `Document::resolve_cell_props` / `table_text_props`): the table style
// (resolved along `basedOn`), its conditional formats under the table's
// `TableLook` (whole table, column bands, row bands, first/last row,
// first/last column, corner cells, in that priority), then the cell's
// direct properties. Borders are the four edges of each cell: table
// borders on the outer edges and inside lines between cells, overridden
// by the conditional formats (whose borders describe their region as a
// whole) and the cell's own borders.

import type { RunProperties } from "../../../../packages/ui-shared/src/generated/RunProperties";
import type { BorderSide } from "../generated/BorderSide";
import type { CellMargins } from "../generated/CellMargins";
import type { CellProperties } from "../generated/CellProperties";
import type { ConditionalFormat } from "../generated/ConditionalFormat";
import type { ConditionalKind } from "../generated/ConditionalKind";
import type { Style } from "../generated/Style";
import type { StyleSheet } from "../generated/StyleSheet";
import type { Table } from "../generated/Table";
import type { TableBorders } from "../generated/TableBorders";
import type { TableLook } from "../generated/TableLook";
import type { TableProperties } from "../generated/TableProperties";
import type { TableStyle } from "../generated/TableStyle";
import builtins from "./builtinTableStyles.json";

/** Word's built-in table styles as the core defines them (`StyleSheet::office_defaults`). */
export const BUILTIN_TABLE_STYLES = builtins as unknown as Style[];

/** Ids of the built-in table styles offered in the gallery (the core adds a missing one on use). */
export const GALLERY_TABLE_STYLES = BUILTIN_TABLE_STYLES.filter((s) => s.id !== "TableNormal").map((s) => s.id);

/** A cell's grid rectangle (inclusive rows and columns, like the core's `CellRect`). */
export interface CellRect {
  row0: number;
  row1: number;
  col0: number;
  col1: number;
}

const or = <T>(over: T | null | undefined, base: T | null | undefined): T | undefined => (over ?? base) ?? undefined;

export function mergeBorders(a: TableBorders | null | undefined, b: TableBorders | null | undefined): TableBorders | undefined {
  if (!a) return b ?? undefined;
  if (!b) return a;
  return {
    top: or(b.top, a.top), left: or(b.left, a.left), bottom: or(b.bottom, a.bottom), right: or(b.right, a.right),
    insideH: or(b.insideH, a.insideH), insideV: or(b.insideV, a.insideV),
  };
}

export function mergeMargins(a: CellMargins | null | undefined, b: CellMargins | null | undefined): CellMargins | undefined {
  if (!a) return b ?? undefined;
  if (!b) return a;
  return { top: or(b.top, a.top), left: or(b.left, a.left), bottom: or(b.bottom, a.bottom), right: or(b.right, a.right) };
}

/** `merge_cell_props`: `over` on `base`, field by field (borders and margins side by side). */
export function mergeCellProps(base: CellProperties, over: CellProperties): CellProperties {
  return {
    width: or(over.width, base.width),
    shading: or(over.shading, base.shading),
    borders: mergeBorders(base.borders, over.borders),
    verticalAlign: or(over.verticalAlign, base.verticalAlign),
    margins: mergeMargins(base.margins, over.margins),
  };
}

function mergeTableProps(base: TableProperties, over: TableProperties): TableProperties {
  return {
    ...base,
    ...Object.fromEntries(Object.entries(over).filter(([, v]) => v != null)),
    borders: mergeBorders(base.borders, over.borders),
    cellMargins: mergeMargins(base.cellMargins, over.cellMargins),
  };
}

const applyRun = (base: RunProperties, over: RunProperties | undefined): RunProperties => ({
  ...base,
  ...Object.fromEntries(Object.entries(over ?? {}).filter(([, v]) => v != null)),
});

const styleById = (styles: Style[], id: string) => styles.find((s) => s.id === id);

/** `resolve_table_style`: the table formatting of `id` along its `basedOn` chain (root first), or null. */
export function resolveTableStyle(styles: Style[], id: string): TableStyle | null {
  const chain: Style[] = [];
  let next = styleById(styles, id);
  while (next && !chain.includes(next)) {
    chain.push(next);
    next = next.basedOn ? styleById(styles, next.basedOn) : undefined;
  }
  if (!chain.length) return null;
  chain.reverse();
  let out: TableStyle = {};
  const cond: ConditionalFormat[] = [];
  for (const s of chain) {
    const t = s.table;
    if (!t) continue;
    out = {
      table: mergeTableProps(out.table ?? {}, t.table ?? {}),
      cell: mergeCellProps(out.cell ?? {}, t.cell ?? {}),
      rowBandSize: t.rowBandSize ?? out.rowBandSize,
      colBandSize: t.colBandSize ?? out.colBandSize,
    };
    for (const c of t.conditional ?? []) {
      const o = cond.find((x) => x.kind === c.kind);
      if (o) {
        o.paragraph = { ...(o.paragraph ?? {}), ...(c.paragraph ?? {}) };
        o.run = applyRun(o.run ?? {}, c.run);
        o.cell = mergeCellProps(o.cell ?? {}, c.cell ?? {});
      } else cond.push(structuredClone(c));
    }
  }
  out.conditional = cond;
  return out;
}

/** `table_style_of`: the table's own style if it is a table style, else the default table style. */
export function tableStyleFor(styles: Style[], styleId: string | null | undefined): TableStyle | null {
  const own = styleId ? styleById(styles, styleId) : undefined;
  const id = own?.kind === "table" ? own.id : styles.find((s) => s.kind === "table" && s.isDefault)?.id;
  return id ? resolveTableStyle(styles, id) : null;
}

interface Region {
  kind: ConditionalKind;
  row0: number;
  row1: number;
  col0: number;
  col1: number;
}

/** The conditional regions holding `rect`, in increasing priority (`Document::regions`). */
export function regions(nrows: number, ncols: number, style: TableStyle, look: TableLook, rect: CellRect): Region[] {
  const lastR = Math.max(0, nrows - 1);
  const lastC = Math.max(0, ncols - 1);
  const out: Region[] = [{ kind: "wholeTable", row0: 0, row1: lastR, col0: 0, col1: lastC }];
  const firstRow = look.firstRow && nrows > 0;
  const lastRow = look.lastRow && nrows > 1;
  const firstCol = look.firstCol && ncols > 0;
  const lastCol = look.lastCol && ncols > 1;
  if (look.bandedCols) {
    const lo = firstCol ? 1 : 0;
    const hi = lastCol ? lastC : ncols;
    const size = Math.max(1, style.colBandSize ?? 1);
    if (rect.col0 >= lo && rect.col0 < hi) {
      const band = Math.floor((rect.col0 - lo) / size);
      const col0 = lo + band * size;
      out.push({ kind: band % 2 === 0 ? "band1Vert" : "band2Vert", row0: 0, row1: lastR, col0, col1: Math.min(col0 + size - 1, Math.max(0, hi - 1)) });
    }
  }
  if (look.bandedRows) {
    const lo = firstRow ? 1 : 0;
    const hi = lastRow ? lastR : nrows;
    const size = Math.max(1, style.rowBandSize ?? 1);
    if (rect.row0 >= lo && rect.row0 < hi) {
      const band = Math.floor((rect.row0 - lo) / size);
      const row0 = lo + band * size;
      out.push({ kind: band % 2 === 0 ? "band1Horz" : "band2Horz", row0, row1: Math.min(row0 + size - 1, Math.max(0, hi - 1)), col0: 0, col1: lastC });
    }
  }
  const row = (kind: ConditionalKind, r: number): Region => ({ kind, row0: r, row1: r, col0: 0, col1: lastC });
  const col = (kind: ConditionalKind, c: number): Region => ({ kind, row0: 0, row1: lastR, col0: c, col1: c });
  const corner = (kind: ConditionalKind, r: number, c: number): Region => ({ kind, row0: r, row1: r, col0: c, col1: c });
  if (firstRow && rect.row0 === 0) out.push(row("firstRow", 0));
  if (lastRow && rect.row1 === lastR) out.push(row("lastRow", lastR));
  if (firstCol && rect.col0 === 0) out.push(col("firstCol", 0));
  if (lastCol && rect.col1 === lastC) out.push(col("lastCol", lastC));
  const top = firstRow && rect.row0 === 0;
  const bottom = lastRow && rect.row1 === lastR;
  const left = firstCol && rect.col0 === 0;
  const right = lastCol && rect.col1 === lastC;
  if (top && right) out.push(corner("neCell", 0, lastC));
  if (top && left) out.push(corner("nwCell", 0, 0));
  if (bottom && right) out.push(corner("seCell", lastR, lastC));
  if (bottom && left) out.push(corner("swCell", lastR, 0));
  return out;
}

type Edges = [BorderSide | undefined, BorderSide | undefined, BorderSide | undefined, BorderSide | undefined];

/** `overlay_edges`: region borders onto `[top, left, bottom, right]` (outer sides on the region's boundary, inside lines elsewhere). */
function overlayEdges(edges: Edges, b: TableBorders, atTop: boolean, atLeft: boolean, atBottom: boolean, atRight: boolean): void {
  const sides = [atTop ? b.top : b.insideH, atLeft ? b.left : b.insideV, atBottom ? b.bottom : b.insideH, atRight ? b.right : b.insideV];
  sides.forEach((s, i) => {
    if (s) edges[i] = s;
  });
}

/** The look of a table: its own, else nothing (`None` = no conditional formats). */
const NO_LOOK: TableLook = { firstRow: false, lastRow: false, firstCol: false, lastCol: false, bandedRows: false, bandedCols: false };

/** Resolved formatting of one cell: cell properties (four edges in `borders`) and the run formatting of its text. */
export interface ResolvedCell {
  cell: CellProperties;
  run: RunProperties;
}

/**
 * `resolve_cell_format` for a cell covering `rect` of an `nrows × ncols`
 * grid: `style` = the table's resolved style (null = none), `table` its
 * direct properties, `direct` the cell's own.
 */
export function resolveCell(style: TableStyle | null, table: TableProperties, direct: CellProperties, rect: CellRect, nrows: number, ncols: number): ResolvedCell {
  const st = style ?? {};
  const tb = mergeBorders(st.table?.borders, table.borders) ?? {};
  const edges: Edges = [
    rect.row0 === 0 ? (tb.top ?? undefined) : (tb.insideH ?? undefined),
    rect.col0 === 0 ? (tb.left ?? undefined) : (tb.insideV ?? undefined),
    rect.row1 + 1 >= nrows ? (tb.bottom ?? undefined) : (tb.insideH ?? undefined),
    rect.col1 + 1 >= ncols ? (tb.right ?? undefined) : (tb.insideV ?? undefined),
  ];
  let props: CellProperties = { ...(st.cell ?? {}), borders: undefined };
  if (st.cell?.borders) overlayEdges(edges, st.cell.borders, true, true, true, true);
  const margins = mergeMargins(st.table?.cellMargins, table.cellMargins);
  props.margins = mergeMargins(margins, props.margins);
  let run: RunProperties = {};
  const look = table.look ?? NO_LOOK;
  for (const region of regions(nrows, ncols, st, look, rect)) {
    const f = st.conditional?.find((c) => c.kind === region.kind);
    if (!f) continue;
    run = applyRun(run, f.run);
    const fc = { ...(f.cell ?? {}) };
    if (fc.borders) {
      overlayEdges(edges, fc.borders, rect.row0 === region.row0, rect.col0 === region.col0, rect.row1 === region.row1, rect.col1 === region.col1);
      delete fc.borders;
    }
    props = mergeCellProps(props, fc);
  }
  const d = { ...direct };
  if (d.borders) {
    overlayEdges(edges, d.borders, true, true, true, true);
    delete d.borders;
  }
  props = mergeCellProps(props, d);
  const [top, left, bottom, right] = edges;
  const borders: TableBorders = {};
  if (top) borders.top = top;
  if (left) borders.left = left;
  if (bottom) borders.bottom = bottom;
  if (right) borders.right = right;
  props.borders = Object.keys(borders).length ? borders : undefined;
  return { cell: props, run };
}

/** `Document::resolve_cell_props` on a model table (cell `cell` of row `row`), or null. */
export function resolveCellProps(sheet: StyleSheet | null, table: Table, row: number, cell: number): ResolvedCell | null {
  const c = table.rows[row]?.cells[cell];
  if (!c) return null;
  const span = (x: { gridSpan?: number }) => Math.max(1, x.gridSpan ?? 1);
  const start = (r: number, i: number) => table.rows[r]!.cells.slice(0, i).reduce((s, x) => s + span(x), 0);
  const exactly = (r: number, col: number, w: number) => {
    const cells = table.rows[r]?.cells ?? [];
    let s = 0;
    for (let i = 0; i < cells.length; i++) {
      if (s === col && span(cells[i]!) === w) return i;
      s += span(cells[i]!);
    }
    return -1;
  };
  // merge_origin
  let [r, i] = [row, cell];
  while (r > 0 && table.rows[r]!.cells[i]?.vMerge === "continue") {
    const above = exactly(r - 1, start(r, i), span(table.rows[r]!.cells[i]!));
    if (above < 0) break;
    r -= 1;
    i = above;
  }
  // row_span
  let n = 1;
  if (table.rows[r]!.cells[i]!.vMerge === "restart") {
    const col = start(r, i);
    const w = span(table.rows[r]!.cells[i]!);
    for (;;) {
      const k = exactly(r + n, col, w);
      if (k < 0 || table.rows[r + n]!.cells[k]!.vMerge !== "continue") break;
      n++;
    }
  }
  const col0 = start(row, cell);
  const rect = { row0: r, row1: r + n - 1, col0, col1: col0 + span(c) - 1 };
  const ncols = Math.max(0, ...table.rows.map((x) => x.cells.reduce((s, y) => s + span(y), 0)));
  const style = sheet ? tableStyleFor(sheet.styles, table.props?.style) : null;
  return resolveCell(style, table.props ?? {}, c.props ?? {}, rect, table.rows.length, ncols);
}
