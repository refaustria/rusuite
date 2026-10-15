// Column resize by dragging a cell border (Word): near the right edge of a
// cell the pointer becomes a resize cursor; dragging shows a guide line and
// on release sends `SetTableProps { colWidths }` (the neighbour column gives
// or takes the difference, see `dragBorder`).

import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import type { TableProperties } from "../generated/TableProperties";
import { TWIPS_PER_PX } from "../sync/schema";
import type { SyncController } from "../sync/SyncPlugin";
import { dragBorder } from "./tables";

/** Distance (px) from a cell's right edge that grabs the border. */
export const GRAB_PX = 4;

interface Target {
  table: PMNode;
  id: number;
  col: number;
}

function targetAt(view: EditorView, e: MouseEvent): Target | null {
  const cell = (e.target as HTMLElement | null)?.closest?.("td, th") as HTMLTableCellElement | null;
  if (!cell || !view.dom.contains(cell)) return null;
  const rect = cell.getBoundingClientRect();
  if (rect.right - e.clientX > GRAB_PX || rect.right - e.clientX < -GRAB_PX) return null;
  let pos: number;
  try {
    pos = view.posAtDOM(cell, 0);
  } catch {
    return null;
  }
  const $pos = view.state.doc.resolve(Math.min(pos, view.state.doc.content.size));
  for (let d = $pos.depth; d > 0; d--) {
    const n = $pos.node(d);
    if (n.type.name === "table" && n.attrs.id != null) return { table: n, id: n.attrs.id as number, col: cell.cellIndex };
  }
  return null;
}

/** Column widths (twips) of a table node: its grid, else the rendered widths. */
function widthsOf(table: PMNode, dom: HTMLTableCellElement[] | null): number[] {
  const cols = table.firstChild?.childCount ?? 0;
  const grid = ((table.attrs.props as TableProperties | null)?.colWidths ?? []).slice();
  if (grid.length === cols) return grid;
  if (dom && dom.length === cols) return dom.map((c) => Math.round(c.offsetWidth * TWIPS_PER_PX));
  return Array(cols).fill(1440);
}

export function columnResizePlugin(ctl: SyncController): Plugin {
  let armed: Target | null = null;
  return new Plugin({
    key: new PluginKey("rusuiteColumnResize"),
    props: {
      handleDOMEvents: {
        mousemove(view, e) {
          if (e.buttons) return false;
          armed = targetAt(view, e);
          view.dom.classList.toggle("col-resize", !!armed);
          return false;
        },
        mouseleave(view) {
          armed = null;
          view.dom.classList.remove("col-resize");
          return false;
        },
        mousedown(view, e) {
          const t = armed ?? targetAt(view, e);
          if (!t || e.button !== 0) return false;
          e.preventDefault();
          const cell = (e.target as HTMLElement).closest("td, th") as HTMLTableCellElement;
          const row = cell.parentElement as HTMLTableRowElement;
          const zoom = cell.offsetWidth ? cell.getBoundingClientRect().width / cell.offsetWidth || 1 : 1;
          const widths = widthsOf(t.table, Array.from(row.cells));
          const tableRect = (cell.closest("table") as HTMLElement).getBoundingClientRect();
          const guide = document.createElement("div");
          guide.className = "column-resize-guide";
          guide.setAttribute(
            "style",
            `position:fixed;top:${tableRect.top}px;height:${tableRect.height}px;left:${e.clientX}px;border-left:1px dashed #4472c4;pointer-events:none;z-index:40;`,
          );
          document.body.append(guide);
          const x0 = e.clientX;
          const move = (ev: MouseEvent) => {
            guide.style.left = `${ev.clientX}px`;
          };
          const up = (ev: MouseEvent) => {
            window.removeEventListener("mousemove", move);
            window.removeEventListener("mouseup", up);
            guide.remove();
            view.dom.classList.remove("col-resize");
            const dx = Math.round(((ev.clientX - x0) / zoom) * TWIPS_PER_PX);
            if (Math.abs(dx) < TWIPS_PER_PX) return;
            const next = dragBorder(widths, t.col, dx);
            void ctl.run({ type: "setTableProps", table: t.id, patch: { colWidths: next } });
          };
          window.addEventListener("mousemove", move);
          window.addEventListener("mouseup", up);
          return true;
        },
      },
    },
  });
}
