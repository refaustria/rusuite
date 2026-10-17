// Tables round 2 (P9-W5): Split Table (Ctrl+Shift+Enter) and joining two
// tables (Delete / Backspace on the empty paragraph between them), Convert
// Text to Table / Table to Text, AutoFit, the Table Properties dialog's
// values and commands (table, row, column, cell, text wrapping), the
// Border Painter (pen style / weight / colour applied by clicking cell
// edges) and the table Borders and Shading dialog (None / Box / All / Grid /
// Custom). Structure changes are Rust commands; this module only computes
// them from the editor state.

import type { Node as PMNode } from "@tiptap/pm/model";
import { TextSelection, type EditorState } from "@tiptap/pm/state";
import { TableMap } from "@tiptap/pm/tables";
import type { EditorView } from "@tiptap/pm/view";
import type { AutoFitMode } from "../generated/AutoFitMode";
import type { BorderSide } from "../generated/BorderSide";
import type { HeightRule } from "../generated/HeightRule";
import type { TableAlignment } from "../generated/TableAlignment";
import type { TableAnchor } from "../generated/TableAnchor";
import type { TableBorders } from "../generated/TableBorders";
import type { TablePosition } from "../generated/TablePosition";
import type { TablePosSpec } from "../generated/TablePosSpec";
import type { TableProperties } from "../generated/TableProperties";
import type { TableWidth } from "../generated/TableWidth";
import type { TextSeparator } from "../generated/TextSeparator";
import type { VAlign } from "../generated/VAlign";
import type { WriteCommand } from "../generated/WriteCommand";
import { nextTempId } from "../sync/SyncPlugin";
import { TEXTBLOCK_TYPES, TWIPS_PER_PX } from "../sync/schema";
import { NO_BORDER, SINGLE_BORDER, type GridRect, type TableContext } from "./tables";

// ----- Split Table / join tables ---------------------------------------------------------

/** The PM depth of the innermost table around `$from`, or -1. */
function tableDepth(state: EditorState): number {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) if ($from.node(d).type.name === "table") return d;
  return -1;
}

/** The id of the model container (a cell, or null for the body) holding the node at `depth`. */
function containerId(state: EditorState, depth: number): number | null {
  const { $from } = state.selection;
  for (let d = depth - 1; d > 0; d--) {
    const n = $from.node(d);
    if (n.type.name === "tableCell") return (n.attrs.id as number | null) ?? null;
  }
  return null;
}

/** The id of the model block before the node at `depth` in its container (lists and column boxes are flattened). */
function previousBlockId(state: EditorState, depth: number): number | null {
  const { $from } = state.selection;
  const before = $from.before(depth);
  let id: number | null = null;
  const parentDepth = depth - 1;
  const parent = $from.node(parentDepth);
  const start = parentDepth === 0 ? 0 : $from.start(parentDepth);
  parent.forEach((child, off) => {
    if (start + off >= before) return;
    // The last model block of the child (a list holds paragraphs, a column box blocks).
    child.descendants((n) => {
      if (n.attrs.id != null && (TEXTBLOCK_TYPES.has(n.type.name) || n.type.name === "table" || n.type.name === "toc")) {
        id = n.attrs.id as number;
        return false;
      }
      return true;
    });
    if (child.attrs.id != null) id = child.attrs.id as number;
  });
  return id;
}

/**
 * Ctrl+Shift+Enter (Layout › Split Table): the table splits above the caret's row; in the first row Word inserts
 * an empty paragraph above the table instead. Null outside a table.
 */
export function splitTableCommand(state: EditorState, t: TableContext | null): WriteCommand | null {
  if (!t) return null;
  if (t.row === 0) {
    const d = tableDepth(state);
    if (d < 0) return null;
    return {
      type: "insertBlocks",
      after: previousBlockId(state, d),
      parent: containerId(state, d),
      blocks: [{ kind: "paragraph", value: { id: nextTempId(), inlines: [] } }],
    };
  }
  return { type: "splitTable", table: t.table, at: t.row, newIds: [nextTempId(), nextTempId()] };
}

/** After a split: the caret into the paragraph after table `id` (or before it, when the split was at row 0). */
export function caretAfterSplit(view: EditorView, tablePos: number, firstRow: boolean): void {
  const doc = view.state.doc;
  const at = Math.min(Math.max(0, tablePos), doc.content.size);
  const table = doc.nodeAt(at);
  let pos = at;
  if (table && !firstRow) pos = at + table.nodeSize + 1;
  else if (firstRow) pos = Math.max(0, at - 1);
  const sel = TextSelection.near(view.state.doc.resolve(Math.min(pos, view.state.doc.content.size)), firstRow ? -1 : 1);
  view.dispatch(view.state.tr.setSelection(sel).scrollIntoView());
}

/**
 * Delete / Backspace in the empty paragraph between two tables joins them (Word). The paragraph's id, or null when
 * the caret is not in such a paragraph.
 */
export function joinTablesTarget(state: EditorState): number | null {
  const { $from, empty } = state.selection;
  const p = $from.parent;
  if (!empty || !p.isTextblock || p.content.size > 0 || p.attrs.id == null) return null;
  const d = $from.depth;
  if (d < 1) return null;
  const parent = $from.node(d - 1);
  const index = $from.index(d - 1);
  const before = index > 0 ? parent.child(index - 1) : null;
  const after = index + 1 < parent.childCount ? parent.child(index + 1) : null;
  if (before?.type.name !== "table" || after?.type.name !== "table") return null;
  return p.attrs.id as number;
}

export const mergeTablesCommand = (paragraph: number): WriteCommand => ({ type: "mergeTables", paragraph });

// ----- Convert Text to Table / Table to Text ----------------------------------------------

export type SeparatorKind = "tab" | "comma" | "paragraph" | "other";

export const separatorOf = (kind: SeparatorKind, other: string): TextSeparator =>
  kind === "other" ? { kind: "other", value: other.slice(0, 1) || "-" } : { kind };

const sepChar = (s: TextSeparator): string | null => (s.kind === "tab" ? "\t" : s.kind === "comma" ? "," : s.kind === "other" ? s.value.slice(0, 1) || null : null);

/** Word's guess for "Separate text at": tabs when the text has any, else commas, else paragraphs. */
export function guessSeparator(texts: string[]): SeparatorKind {
  if (texts.some((t) => t.includes("\t"))) return "tab";
  if (texts.some((t) => t.includes(","))) return "comma";
  return "paragraph";
}

/** "Number of columns" Word proposes: the most cells of a paragraph (1 for paragraphs). */
export function columnsFor(texts: string[], sep: TextSeparator): number {
  const c = sepChar(sep);
  if (!c) return 1;
  return Math.max(1, ...texts.map((t) => t.split(c).length));
}

/** Rows Word will make for `texts` with `cols` columns (long rows wrap). */
export function rowsFor(texts: string[], sep: TextSeparator, cols: number): number {
  const c = sepChar(sep);
  const n = Math.max(1, cols);
  if (!c) return Math.ceil(texts.length / n);
  return texts.reduce((s, t) => s + Math.ceil(t.split(c).length / n), 0);
}

/** The model paragraphs of the selection (top-level or in one cell), in order. */
export function selectedTextBlocks(state: EditorState): PMNode[] {
  const { from, to } = state.selection;
  const out: PMNode[] = [];
  state.doc.nodesBetween(from, Math.max(to, from + 1), (node) => {
    if (node.type.name === "table") return false;
    if (TEXTBLOCK_TYPES.has(node.type.name)) {
      if (node.attrs.id != null) out.push(node);
      return false;
    }
    return true;
  });
  return out;
}

export function textToTableCommand(blocks: PMNode[], sep: TextSeparator, cols: number | null): WriteCommand | null {
  if (!blocks.length) return null;
  const cmd: WriteCommand = { type: "convertTextToTable", blocks: blocks.map((b) => b.attrs.id as number), separator: sep };
  if (cols != null && cols > 0) cmd.cols = Math.min(63, Math.round(cols));
  return cmd;
}

export const tableToTextCommand = (t: TableContext, sep: TextSeparator): WriteCommand => ({ type: "convertTableToText", table: t.table, separator: sep });

// ----- AutoFit ------------------------------------------------------------------------------

let canvas: HTMLCanvasElement | null = null;

/** Natural (unwrapped) width in CSS px of an element's text, measured with its computed font. */
function naturalWidth(el: HTMLElement): number {
  const text = el.textContent ?? "";
  if (!text) return 0;
  try {
    canvas ??= document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return text.length * 7;
    const cs = getComputedStyle(el);
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    return ctx.measureText(text).width;
  } catch {
    return text.length * 7;
  }
}

/**
 * AutoFit Contents: column widths (twips) from the cells' natural content widths (the widest paragraph of each
 * single-column cell plus its padding), at least `min`, scaled down to `avail` twips when wider (Word never
 * makes an AutoFit table wider than the window).
 */
export function contentWidths(natural: number[][], padding: number, avail: number, min = 360): number[] {
  const cols = Math.max(0, ...natural.map((r) => r.length));
  const out = Array.from({ length: cols }, (_, c) => Math.max(min, Math.max(0, ...natural.map((r) => r[c] ?? 0)) + padding));
  const total = out.reduce((a, b) => a + b, 0);
  if (total <= avail || total === 0) return out.map(Math.round);
  return out.map((w) => Math.max(min, Math.round((w * avail) / total)));
}

/** The natural content width (twips) per grid column for each row, measured in the editor DOM (merged cells count 0). */
export function measureNatural(view: EditorView, t: TableContext): number[][] {
  const out: number[][] = [];
  const dom = view.nodeDOM(t.pos) as HTMLElement | null;
  const table = dom?.tagName === "TABLE" ? dom : (dom?.querySelector?.("table") ?? null);
  if (!table) return out;
  const map = t.map;
  for (let r = 0; r < map.height; r++) {
    const row: number[] = [];
    for (let c = 0; c < map.width; c++) {
      const off = map.map[r * map.width + c]!;
      const rect = map.findCell(off);
      if (rect.left !== c || rect.top !== r || rect.right - rect.left > 1) {
        row.push(0);
        continue;
      }
      const cellDom = view.nodeDOM(t.pos + 1 + off) as HTMLElement | null;
      let w = 0;
      cellDom?.querySelectorAll?.("p, h1, h2, h3, h4, h5, h6").forEach((p) => {
        w = Math.max(w, naturalWidth(p as HTMLElement));
      });
      row.push(Math.ceil(w * TWIPS_PER_PX));
    }
    out.push(row);
  }
  return out;
}

/** The rendered widths of the table's grid columns (twips), from the `col` elements. */
export function renderedWidths(view: EditorView, t: TableContext): number[] {
  const dom = view.nodeDOM(t.pos) as HTMLElement | null;
  const table = dom?.tagName === "TABLE" ? dom : (dom?.querySelector?.("table") ?? null);
  const cols = table ? [...table.querySelectorAll(":scope > colgroup > col")] : [];
  const w = cols.map((c) => Math.round((c as HTMLElement).getBoundingClientRect().width * TWIPS_PER_PX));
  return w.length === t.cols && w.every((x) => x > 0) ? w : [];
}

export function autoFitCommand(t: TableContext, mode: AutoFitMode, colWidths: number[] = []): WriteCommand {
  const cmd: WriteCommand = { type: "autoFitTable", table: t.table, mode };
  if (colWidths.length === t.cols && colWidths.every((w) => w > 0)) cmd.colWidths = colWidths.map((w) => Math.round(w));
  return cmd;
}

// ----- Table Properties ---------------------------------------------------------------------

/** All values of the Table Properties dialog (lengths in twips). */
export interface TablePropsForm {
  // Table tab
  alignment: TableAlignment;
  indent: number;
  /** Preferred width: off, or a length / a percentage of the text width. */
  widthOn: boolean;
  widthUnit: "twips" | "pct";
  width: number;
  wrap: "none" | "around";
  position: TablePosition;
  autoResize: boolean;
  // Row tab
  heightOn: boolean;
  height: number;
  heightRule: HeightRule;
  cantSplit: boolean;
  header: boolean;
  // Column tab
  colWidthOn: boolean;
  colWidth: number;
  // Cell tab
  vAlign: VAlign;
}

export const AROUND: TablePosition = { leftFromText: 180, rightFromText: 180, topFromText: 0, bottomFromText: 0, vertAnchor: "text", x: 0, y: 1 };

const widthForm = (w: TableWidth | null | undefined): { on: boolean; unit: "twips" | "pct"; value: number } =>
  !w || w.kind === "auto" ? { on: false, unit: "twips", value: 0 } : w.kind === "pct" ? { on: true, unit: "pct", value: w.value / 50 } : { on: true, unit: "twips", value: w.value };

/** The dialog's values for the caret's table / row / column / cell. */
export function tablePropsForm(t: TableContext, colWidths: number[]): TablePropsForm {
  const w = widthForm(t.props.width);
  const h = t.rowProps.height;
  const cellNode = t.node.nodeAt(t.map.map[t.cell.top * t.map.width + t.cell.left]!);
  const extra = (cellNode?.attrs.extra as { verticalAlign?: VAlign } | null) ?? {};
  const cw = colWidths[t.col] ?? 0;
  return {
    alignment: t.props.alignment ?? "left",
    indent: t.props.indent ?? 0,
    widthOn: w.on,
    widthUnit: w.unit,
    width: w.value,
    wrap: t.props.floating ? "around" : "none",
    position: t.props.floating ?? AROUND,
    autoResize: (t.props.layout ?? "autofit") === "autofit",
    heightOn: !!h && h.value > 0,
    height: h?.value ?? 0,
    heightRule: h?.rule ?? "atLeast",
    cantSplit: !!t.rowProps.cantSplit,
    header: !!t.rowProps.header,
    colWidthOn: cw > 0,
    colWidth: cw,
    vAlign: extra.verticalAlign ?? "top",
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The commands for what changed in the Table Properties dialog. */
export function tablePropsFormCommands(t: TableContext, before: TablePropsForm, v: TablePropsForm, colWidths: number[]): WriteCommand[] {
  const cmds: WriteCommand[] = [];
  const patch: TableProperties = {};
  if (v.alignment !== before.alignment) patch.alignment = v.alignment;
  if (v.indent !== before.indent) patch.indent = v.indent;
  if (v.autoResize !== before.autoResize) patch.layout = v.autoResize ? "autofit" : "fixed";
  if (v.widthOn !== before.widthOn || v.width !== before.width || v.widthUnit !== before.widthUnit) {
    patch.width = !v.widthOn ? { kind: "auto" } : v.widthUnit === "pct" ? { kind: "pct", value: Math.round(Math.min(600, Math.max(0, v.width)) * 50) } : { kind: "twips", value: Math.max(0, Math.round(v.width)) };
  }
  if (v.colWidthOn && v.colWidth > 0 && v.colWidth !== before.colWidth && colWidths.length === t.cols) {
    const w = [...colWidths];
    for (const c of t.colIndices) w[c] = Math.round(v.colWidth);
    patch.colWidths = w;
  }
  if (Object.keys(patch).length) cmds.push({ type: "setTableProps", table: t.table, patch });
  if (v.wrap !== before.wrap || (v.wrap === "around" && !same(v.position, before.position))) {
    cmds.push({ type: "setTableWrap", table: t.table, floating: v.wrap === "around" ? v.position : null });
  }
  const rowChanged = v.heightOn !== before.heightOn || v.height !== before.height || v.heightRule !== before.heightRule;
  if (rowChanged || v.cantSplit !== before.cantSplit || v.header !== before.header) {
    const c: WriteCommand = { type: "setRowProps", table: t.table, rows: t.rowIndices };
    if (rowChanged) c.height = v.heightOn && v.height > 0 ? { value: Math.round(v.height), rule: v.heightRule } : { value: 0, rule: "atLeast" };
    if (v.cantSplit !== before.cantSplit) c.cantSplit = v.cantSplit;
    if (v.header !== before.header) c.header = v.header;
    cmds.push(c);
  }
  if (v.vAlign !== before.vAlign) cmds.push({ type: "setCellProps", cells: t.cells, patch: { verticalAlign: v.vAlign } });
  return cmds;
}

/** Horizontal position choices of Table Positioning (Word: Left, Center, Right, Inside, Outside, or a length). */
export const H_SPECS: (TablePosSpec | null)[] = [null, "start", "center", "end", "inside", "outside"];
export const V_SPECS: (TablePosSpec | null)[] = [null, "start", "center", "end", "inside", "outside"];
export const ANCHORS: TableAnchor[] = ["margin", "page", "text"];

// ----- Border Painter and the Borders and Shading dialog --------------------------------------

export type Edge = "top" | "left" | "bottom" | "right";

/** Word's Border Styles gallery: a few themed pens (style, ½–3 pt, colour). */
export const BORDER_PENS: BorderSide[] = [
  { style: "single", width: 10, color: { kind: "auto" } },
  { style: "single", width: 20, color: { kind: "auto" } },
  { style: "double", width: 10, color: { kind: "auto" } },
  { style: "dashed", width: 10, color: { kind: "auto" } },
  { style: "dotted", width: 10, color: { kind: "auto" } },
  { style: "single", width: 10, color: { kind: "theme", value: { slot: "accent1", tint: 0 } } },
  { style: "single", width: 30, color: { kind: "theme", value: { slot: "accent1", tint: 0 } } },
  { style: "double", width: 10, color: { kind: "theme", value: { slot: "accent2", tint: 0 } } },
];

/** Pen weights (twips: 1 pt = 20) of the Pen Weight list. */
export const PEN_WEIGHTS = [5, 10, 15, 20, 30, 45, 60, 90, 120];

/**
 * The cell edge nearest to the point (`x`, `y`) inside the cell box `rect` (client px) when within `tol` px,
 * else null (Word's Border Painter paints the edge under the pointer).
 */
export function edgeAt(rect: { left: number; top: number; right: number; bottom: number }, x: number, y: number, tol = 6): Edge | null {
  const d: [Edge, number][] = [
    ["top", Math.abs(y - rect.top)],
    ["bottom", Math.abs(y - rect.bottom)],
    ["left", Math.abs(x - rect.left)],
    ["right", Math.abs(x - rect.right)],
  ];
  d.sort((a, b) => a[1] - b[1]);
  return d[0]![1] <= tol ? d[0]![0] : null;
}

const OPPOSITE: Record<Edge, Edge> = { top: "bottom", bottom: "top", left: "right", right: "left" };

/**
 * Border Painter: `pen` on edge `edge` of the cell at grid rectangle `cell` of `table`, and on the facing edge of
 * the neighbouring cells (so both sides agree, as in Word). Cells are given by id.
 */
export function paintEdgeCommands(table: PMNode, cell: GridRect, edge: Edge, pen: BorderSide): WriteCommand[] {
  const map = TableMap.get(table);
  const idAt = (r: number, c: number) => (table.nodeAt(map.map[r * map.width + c]!)?.attrs.id as number | null) ?? null;
  const own = idAt(cell.top, cell.left);
  const cmds: WriteCommand[] = [];
  if (own != null) cmds.push({ type: "setCellProps", cells: [own], patch: { borders: { [edge]: pen } } });
  const neighbours = new Set<number>();
  if (edge === "top" && cell.top > 0) for (let c = cell.left; c < cell.right; c++) neighbours.add(idAt(cell.top - 1, c) ?? -1);
  if (edge === "bottom" && cell.bottom < map.height) for (let c = cell.left; c < cell.right; c++) neighbours.add(idAt(cell.bottom, c) ?? -1);
  if (edge === "left" && cell.left > 0) for (let r = cell.top; r < cell.bottom; r++) neighbours.add(idAt(r, cell.left - 1) ?? -1);
  if (edge === "right" && cell.right < map.width) for (let r = cell.top; r < cell.bottom; r++) neighbours.add(idAt(r, cell.right) ?? -1);
  neighbours.delete(-1);
  if (own != null) neighbours.delete(own);
  if (neighbours.size) cmds.push({ type: "setCellProps", cells: [...neighbours], patch: { borders: { [OPPOSITE[edge]]: pen } } });
  return cmds;
}

export type BorderSetting = "none" | "box" | "all" | "grid" | "custom";

/** The six lines of the Borders and Shading preview for a setting (Grid: the pen outside, ½ pt single inside, as Word). */
export function settingBorders(setting: Exclude<BorderSetting, "custom">, pen: BorderSide): TableBorders {
  const none = NO_BORDER;
  switch (setting) {
    case "none":
      return { top: none, left: none, bottom: none, right: none, insideH: none, insideV: none };
    case "box":
      return { top: pen, left: pen, bottom: pen, right: pen, insideH: none, insideV: none };
    case "all":
      return { top: pen, left: pen, bottom: pen, right: pen, insideH: pen, insideV: pen };
    case "grid":
      return { top: pen, left: pen, bottom: pen, right: pen, insideH: SINGLE_BORDER, insideV: SINGLE_BORDER };
  }
}

/** Which setting `b` corresponds to (custom when none matches). */
export function settingOf(b: TableBorders, pen: BorderSide): BorderSetting {
  for (const s of ["none", "box", "all", "grid"] as const) if (same(settingBorders(s, pen), b)) return s;
  return "custom";
}

/**
 * Commands applying the six lines `b` (undefined = unchanged) to the selected cells: outer edges of the selection
 * rectangle take top/left/bottom/right, the lines between cells insideH/insideV. With `wholeTable` (Apply to: Table)
 * the table's own borders are set instead.
 */
export function rectBordersCommands(t: TableContext, b: TableBorders, wholeTable: boolean): WriteCommand[] {
  if (wholeTable) return [{ type: "setTableProps", table: t.table, patch: { borders: b } }];
  const groups = new Map<string, { patch: TableBorders; cells: number[] }>();
  const { rect, map, node } = t;
  for (const off of map.cellsInRect(rect)) {
    const id = node.nodeAt(off)?.attrs.id as number | null;
    if (id == null) continue;
    const c = map.findCell(off);
    const patch: TableBorders = {};
    const put = (k: Edge, side: BorderSide | null | undefined) => {
      if (side) patch[k] = side;
    };
    put("top", c.top === rect.top ? b.top : b.insideH);
    put("bottom", c.bottom === rect.bottom ? b.bottom : b.insideH);
    put("left", c.left === rect.left ? b.left : b.insideV);
    put("right", c.right === rect.right ? b.right : b.insideV);
    if (!Object.keys(patch).length) continue;
    const key = JSON.stringify(patch);
    const g = groups.get(key) ?? { patch, cells: [] };
    g.cells.push(id);
    groups.set(key, g);
  }
  return [...groups.values()].map((g) => ({ type: "setCellProps", cells: g.cells, patch: { borders: g.patch } }));
}

/** A pen's line as CSS (gallery swatches and the preview). */
export function penCss(p: BorderSide | null | undefined): string {
  if (!p || p.style === "none") return "1px dashed #c8c8c8";
  const px = Math.max(1, Math.round(p.width / TWIPS_PER_PX));
  const css = p.style === "double" ? "double" : p.style === "dashed" ? "dashed" : p.style === "dotted" ? "dotted" : "solid";
  return `${p.style === "double" ? Math.max(3, px) : px}px ${css} currentColor`;
}
