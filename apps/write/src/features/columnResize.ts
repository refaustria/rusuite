// Column resize by dragging a cell border (Word): near the right edge of a
// cell the pointer becomes a resize cursor; dragging shows a guide line and
// on release sends `SetTableProps { colWidths }` (the neighbour column gives
// or takes the difference, see `dragBorder`). Merged cells: the border is
// the one after the cell's last grid column. Pointer events (touch and pen
// too); the grab zone is ±6 px around the border, ±22 px for a finger
// (P10-M4: a 44 px strip; a tap there still places the caret, only a
// sideways drag moves the border).

import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { TableMap } from "@tiptap/pm/tables";
import type { EditorView } from "@tiptap/pm/view";
import type { TableProperties } from "../generated/TableProperties";
import { TWIPS_PER_PX } from "../sync/schema";
import type { SyncController } from "../sync/SyncPlugin";
import { dragBorder } from "./tables";

/** Distance (px) from a cell's right edge that grabs the border. */
export const GRAB_PX = 6;
/** The same for a finger (screen px): a 44 px strip centred on the border. */
export const TOUCH_GRAB_PX = 22;
/** A finger must move this far sideways (px) before the border follows. */
const TOUCH_DRAG_PX = 8;

interface Target {
  table: PMNode;
  tablePos: number;
  id: number;
  /** Grid column left of the border. */
  col: number;
}

function targetAt(view: EditorView, e: PointerEvent): Target | null {
  const cell = (e.target as HTMLElement | null)?.closest?.("td, th") as HTMLTableCellElement | null;
  if (!cell || !view.dom.contains(cell)) return null;
  const rect = cell.getBoundingClientRect();
  const touch = e.pointerType === "touch" || e.pointerType === "pen";
  const grab = touch ? TOUCH_GRAB_PX : GRAB_PX;
  // A finger on the next cell's left part grabs the border before it.
  let leftEdge = false;
  if (Math.abs(rect.right - e.clientX) > grab) {
    if (!touch || Math.abs(e.clientX - rect.left) > grab) return null;
    leftEdge = true;
  }
  let pos: number;
  try {
    pos = view.posAtDOM(cell, 0);
  } catch {
    return null;
  }
  const $pos = view.state.doc.resolve(Math.min(pos, view.state.doc.content.size));
  for (let d = $pos.depth; d > 0; d--) {
    const n = $pos.node(d);
    if (n.type.name === "table" && n.attrs.id != null && d + 2 <= $pos.depth) {
      const start = $pos.start(d);
      const map = TableMap.get(n);
      const r = map.findCell($pos.before(d + 2) - start);
      if (leftEdge && r.left === 0) return null;
      return { table: n, tablePos: $pos.before(d), id: n.attrs.id as number, col: leftEdge ? r.left - 1 : r.right - 1 };
    }
  }
  return null;
}

/** Column widths (twips) of a table node: its grid, else the rendered `<col>` widths, else 1 inch each. */
export function widthsOf(table: PMNode, cols: HTMLElement[] | null): number[] {
  const n = TableMap.get(table).width;
  const grid = ((table.attrs.props as TableProperties | null)?.colWidths ?? []).slice();
  if (grid.length === n) return grid;
  if (cols && cols.length === n && cols.every((c) => c.offsetWidth > 0)) return cols.map((c) => Math.round(c.offsetWidth * TWIPS_PER_PX));
  return Array(n).fill(1440);
}

/** The guide line over the table at viewport x. */
function showGuide(tableEl: HTMLElement, x: number): HTMLElement {
  const tableRect = tableEl.getBoundingClientRect();
  const guide = document.createElement("div");
  guide.className = "column-resize-guide";
  guide.setAttribute("style", `position:fixed;top:${tableRect.top}px;height:${tableRect.height}px;left:${x}px;border-left:1px dashed #4472c4;pointer-events:none;z-index:40;`);
  document.body.append(guide);
  return guide;
}

export function columnResizePlugin(ctl: SyncController): Plugin {
  let armed: Target | null = null;
  /**
   * A finger on a border: nothing happens until it moves sideways (a tap places the caret, a vertical swipe
   * scrolls); then the border follows it and the page does not scroll.
   */
  const touchDrag = (e: PointerEvent, t: Target) => {
    const cell = (e.target as HTMLElement).closest("td, th") as HTMLTableCellElement;
    const tableEl = cell.closest("table") as HTMLElement;
    const zoom = cell.offsetWidth ? cell.getBoundingClientRect().width / cell.offsetWidth || 1 : 1;
    const widths = widthsOf(t.table, Array.from(tableEl.querySelectorAll<HTMLElement>(":scope > colgroup > col")));
    const x0 = e.clientX;
    const y0 = e.clientY;
    const id = e.pointerId;
    let state: "pending" | "drag" | "scroll" = "pending";
    let guide: HTMLElement | null = null;
    const onTouchMove = (ev: TouchEvent) => {
      const p = ev.touches[0];
      if (!p || state === "scroll") return;
      if (state === "pending") {
        const dx = Math.abs(p.clientX - x0);
        const dy = Math.abs(p.clientY - y0);
        if (dy > TOUCH_DRAG_PX && dy > dx) {
          state = "scroll";
          return;
        }
      }
      if (ev.cancelable) ev.preventDefault();
    };
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== id || state === "scroll") return;
      if (state === "pending" && Math.abs(ev.clientX - x0) > TOUCH_DRAG_PX) {
        state = "drag";
        guide = showGuide(tableEl, ev.clientX);
      }
      if (guide) guide.style.left = `${ev.clientX}px`;
    };
    const done = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", done);
      window.removeEventListener("pointercancel", done);
      guide?.remove();
      if (state !== "drag" || ev.type === "pointercancel") return;
      const dx = Math.round(((ev.clientX - x0) / zoom) * TWIPS_PER_PX);
      if (Math.abs(dx) < TWIPS_PER_PX) return;
      void ctl.run({ type: "setTableProps", table: t.id, patch: { colWidths: dragBorder(widths, t.col, dx) } });
    };
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", done);
    window.addEventListener("pointercancel", done);
  };
  return new Plugin({
    key: new PluginKey("rusuiteColumnResize"),
    props: {
      handleDOMEvents: {
        pointermove(view, e) {
          if (e.buttons) return false;
          armed = targetAt(view, e);
          view.dom.classList.toggle("col-resize", !!armed);
          return false;
        },
        pointerleave(view) {
          armed = null;
          view.dom.classList.remove("col-resize");
          return false;
        },
        pointerdown(view, e) {
          const touch = e.pointerType === "touch" || e.pointerType === "pen";
          const t = touch ? targetAt(view, e) : (armed ?? targetAt(view, e));
          if (!t || e.button !== 0) return false;
          if (touch) {
            touchDrag(e, t);
            return false;
          }
          e.preventDefault();
          const cell = (e.target as HTMLElement).closest("td, th") as HTMLTableCellElement;
          const tableEl = cell.closest("table") as HTMLElement;
          const zoom = cell.offsetWidth ? cell.getBoundingClientRect().width / cell.offsetWidth || 1 : 1;
          const widths = widthsOf(t.table, Array.from(tableEl.querySelectorAll<HTMLElement>(":scope > colgroup > col")));
          const tableRect = tableEl.getBoundingClientRect();
          const guide = document.createElement("div");
          guide.className = "column-resize-guide";
          guide.setAttribute(
            "style",
            `position:fixed;top:${tableRect.top}px;height:${tableRect.height}px;left:${e.clientX}px;border-left:1px dashed #4472c4;pointer-events:none;z-index:40;`,
          );
          document.body.append(guide);
          const x0 = e.clientX;
          const move = (ev: PointerEvent) => {
            guide.style.left = `${ev.clientX}px`;
          };
          const up = (ev: PointerEvent) => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            guide.remove();
            view.dom.classList.remove("col-resize");
            const dx = Math.round(((ev.clientX - x0) / zoom) * TWIPS_PER_PX);
            if (Math.abs(dx) < TWIPS_PER_PX) return;
            const next = dragBorder(widths, t.col, dx);
            void ctl.run({ type: "setTableProps", table: t.id, patch: { colWidths: next } });
          };
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", up);
          return true;
        },
      },
    },
  });
}
