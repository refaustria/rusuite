// Table gutters (P10-M4): in touch mode, while the caret is in a table, a strip above the table (one segment per
// column) and one left of it (one per row); a tap selects that column or row (a cell selection, as Table Layout ›
// Select). 44 px thick, outside the table, in screen px.

import { useEffect, useState, useSyncExternalStore } from "react";
import type { Editor } from "@tiptap/react";
import { CellSelection, TableMap } from "@tiptap/pm/tables";
import type { EditorView } from "@tiptap/pm/view";
import { VISUAL_VIEWPORT_EVENT } from "@rusuite/ui-shared";
import { tableContext } from "../features/tables";
import { useT } from "../i18n";
import { isTouchMode, subscribeTouchMode } from "./touchMode";
import { visibleBounds } from "./TouchSelection";

/** Thickness (px) of a gutter. */
export const GUTTER_PX = 44;

interface Span {
  index: number;
  from: number;
  to: number;
}

interface Gutters {
  tablePos: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
  cols: Span[];
  rows: Span[];
  selCols: number[];
  selRows: number[];
}

function measure(editor: Editor): Gutters | null {
  const t = tableContext(editor.state);
  if (!t) return null;
  const view = editor.view;
  const dom = view.nodeDOM(t.pos) as HTMLElement | null;
  const table = (dom?.tagName === "TABLE" ? dom : dom?.querySelector?.("table")) as HTMLTableElement | null;
  if (!table) return null;
  const r = table.getBoundingClientRect();
  const { map } = t;
  const start = t.pos + 1;
  const cellRect = (offset: number) => (view.nodeDOM(start + offset) as HTMLElement | null)?.getBoundingClientRect?.() ?? null;
  const cols: Span[] = [];
  for (let c = 0; c < map.width; c++) {
    // A cell of this column only (no colspan); else a share of the table's width.
    let span: Span | null = null;
    for (let row = 0; row < map.height && !span; row++) {
      const off = map.map[row * map.width + c]!;
      const g = map.findCell(off);
      const cr = g.left === c && g.right === c + 1 ? cellRect(off) : null;
      if (cr) span = { index: c, from: cr.left, to: cr.right };
    }
    cols.push(span ?? { index: c, from: r.left + (r.width * c) / map.width, to: r.left + (r.width * (c + 1)) / map.width });
  }
  const trs = Array.from(table.querySelectorAll<HTMLElement>(":scope > tbody > tr, :scope > thead > tr, :scope > tr"));
  const rows: Span[] = trs.slice(0, map.height).map((tr, i) => {
    const b = tr.getBoundingClientRect();
    return { index: i, from: b.top, to: b.bottom };
  });
  return { tablePos: t.pos, left: r.left, top: r.top, right: r.right, bottom: r.bottom, cols, rows, selCols: t.colIndices, selRows: t.rowIndices };
}

/** Selects grid rows [top, bottom) × columns [left, right) of the table at `tablePos`. */
export function selectGrid(view: EditorView, tablePos: number, rect: { top: number; bottom: number; left: number; right: number }): boolean {
  const node = view.state.doc.nodeAt(tablePos);
  if (!node || node.type.name !== "table") return false;
  const map = TableMap.get(node);
  const offs = map.cellsInRect(rect);
  if (!offs.length) return false;
  const start = tablePos + 1;
  view.dispatch(view.state.tr.setSelection(CellSelection.create(view.state.doc, start + offs[0]!, start + offs[offs.length - 1]!)));
  view.focus();
  return true;
}

export function TableGutters({ editor }: { editor: Editor }) {
  const t = useT();
  const touch = useSyncExternalStore(subscribeTouchMode, isTouchMode);
  const [g, setG] = useState<Gutters | null>(null);
  useEffect(() => {
    if (!touch) {
      setG(null);
      return;
    }
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setG(editor.isDestroyed ? null : measure(editor)));
    };
    editor.on("transaction", update);
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    window.addEventListener(VISUAL_VIEWPORT_EVENT, update);
    update();
    return () => {
      cancelAnimationFrame(frame);
      editor.off("transaction", update);
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
      window.removeEventListener(VISUAL_VIEWPORT_EVENT, update);
    };
  }, [editor, touch]);
  if (!touch || !g) return null;
  const b = visibleBounds(editor);
  const width = g.cols.length;
  const height = g.rows.length;
  return (
    <div className="write-table-gutters" data-testid="table-gutters" style={{ clipPath: `inset(${b.top}px ${window.innerWidth - b.right}px ${window.innerHeight - b.bottom}px ${b.left}px)` }}>
      {g.cols.map((c) => (
        <button
          key={`c${c.index}`}
          type="button"
          tabIndex={-1}
          aria-label={`${t("write.select.column")} ${c.index + 1}`}
          data-testid={`table-gutter-col-${c.index}`}
          data-selected={g.selCols.includes(c.index) && g.selRows.length === height ? "" : undefined}
          className="write-gutter write-gutter-col"
          style={{ left: c.from, width: Math.max(1, c.to - c.from), top: g.top - GUTTER_PX, height: GUTTER_PX }}
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => selectGrid(editor.view, g.tablePos, { top: 0, bottom: height, left: c.index, right: c.index + 1 })}
        />
      ))}
      {g.rows.map((r) => (
        <button
          key={`r${r.index}`}
          type="button"
          tabIndex={-1}
          aria-label={`${t("write.select.row")} ${r.index + 1}`}
          data-testid={`table-gutter-row-${r.index}`}
          data-selected={g.selRows.includes(r.index) && g.selCols.length === width ? "" : undefined}
          className="write-gutter write-gutter-row"
          style={{ left: g.left - GUTTER_PX, width: GUTTER_PX, top: r.from, height: Math.max(1, r.to - r.from) }}
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => selectGrid(editor.view, g.tablePos, { top: r.index, bottom: r.index + 1, left: 0, right: width })}
        />
      ))}
    </div>
  );
}
