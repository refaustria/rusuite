// DOM layer over the selected table (P8-16; pointer events, so mouse,
// pen and touch work alike): a click in a cell edits it, a drag across
// cells selects them (highlighted), the column and row borders resize
// the grid (`SetTableGrid`), right-click opens the table menu. It is
// inset a few px so the Transformer's handles and the table's frame (to
// move it) stay reachable on the canvas below.

import { useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import type React from "react";
import { EMU_PER_PX, emuToPx } from "../geometry";
import { themePalette } from "../model";
import { cellsIn, expandRange, rangeOf } from "../shapes/tables";
import { tableOf, useShow, type ShowStore } from "../state/store";
import { cellAt, tableLayout } from "./tableLayout";
import { useT } from "../i18n";

/** Inset of the layer from the table's frame (px). */
const INSET = 5;
/**
 * Hit width of a border's resize grip (px): the 32 px touch target
 * (WCAG 2.5.8 / PowerPoint on touch screens); the border itself stays a
 * thin line. A tap on a grip that does not drag edits the cell under it.
 */
export const GRIP = 32;

export function TableOverlay({ store, scale, onMenu }: { store: ShowStore; scale: number; onMenu: (at: { x: number; y: number }) => void }) {
  const t = useT();
  const pres = useShow(store, (s) => s.pres);
  const selection = useShow(store, (s) => s.selection);
  const cellSel = useShow(store, (s) => s.cellSel);
  const drawMode = useShow(store, (s) => s.drawMode);
  const current = useShow(store, (s) => s.current);
  const slide = pres?.slides.find((s) => s.id === current) ?? null;
  const shape = selection.length === 1 ? (slide?.shapes.find((s) => s.id === selection[0]) ?? null) : null;
  const table = tableOf(shape);
  const palette = useMemo(() => themePalette(pres?.theme), [pres?.theme]);
  const layout = useMemo(() => (table && pres ? tableLayout(table, pres.theme, palette, pres.tableStyles) : null), [table, pres, palette]);
  const drag = useRef<{ from: [number, number]; moved: boolean; id: number } | null>(null);
  const [resize, setResize] = useState<{ axis: "rows" | "cols"; index: number; start: number; delta: number } | null>(null);
  if (!shape || !table || !layout || drawMode || !pres) return null;

  const tf = shape.transform;
  const left = emuToPx(tf.x) * scale;
  const top = emuToPx(tf.y) * scale;
  const width = layout.colX[layout.colX.length - 1]! * scale;
  const height = layout.rowY[layout.rowY.length - 1]! * scale;
  const local = (e: ReactMouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: (e.clientX - r.left + INSET) / scale, y: (e.clientY - r.top + INSET) / scale };
  };
  const sel = cellSel && cellSel.shape === shape.id ? expandRange(table, cellSel.range) : null;
  const selected = new Set(sel && cellsIn(table, sel).length > 1 ? cellsIn(table, sel).map(([r, c]) => `${r},${c}`) : []);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const p = local(e);
    drag.current = { from: cellAt(layout, p.x, p.y), moved: false, id: e.pointerId };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const p = local(e);
    const to = cellAt(layout, p.x, p.y);
    if (!d.moved && to[0] === d.from[0] && to[1] === d.from[1]) return;
    d.moved = true;
    store.selectCells(shape.id, rangeOf(d.from, to));
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.id !== e.pointerId) return;
    if (!d.moved) store.startCellEdit(shape.id, d.from[0], d.from[1]);
  };

  const grip = (axis: "rows" | "cols", index: number, at: number) => {
    const style =
      axis === "cols"
        ? { left: at * scale - INSET - GRIP / 2, top: 0, width: GRIP, height: height - 2 * INSET, cursor: "col-resize" }
        : { top: at * scale - INSET - GRIP / 2, left: 0, height: GRIP, width: width - 2 * INSET, cursor: "row-resize" };
    return (
      <div
        key={`${axis}${index}`}
        data-testid={`table-grip-${axis}-${index}`}
        aria-hidden="true"
        className="absolute"
        style={style}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
          setResize({ axis, index, start: axis === "cols" ? e.clientX : e.clientY, delta: 0 });
        }}
        onPointerMove={(e) => {
          if (!resize || resize.axis !== axis || resize.index !== index) return;
          setResize({ ...resize, delta: (axis === "cols" ? e.clientX : e.clientY) - resize.start });
        }}
        onPointerUp={(e) => {
          const r = resize;
          setResize(null);
          if (r && Math.abs(r.delta) >= 1) {
            void store.resizeTrack(shape.id, axis, index, Math.round((r.delta / scale) * EMU_PER_PX));
            return;
          }
          // no drag: a click in the cell under the grip
          const box = (e.currentTarget as HTMLElement).parentElement?.getBoundingClientRect();
          if (!box) return;
          const [row, col] = cellAt(layout, (e.clientX - box.left + INSET) / scale, (e.clientY - box.top + INSET) / scale);
          store.startCellEdit(shape.id, row, col);
        }}
      />
    );
  };

  return (
    <div
      data-testid="table-overlay"
      role="grid"
      aria-label={t("show.table.cells")}
      className="absolute touch-none"
      style={{ left: left + INSET, top: top + INSET, width: Math.max(0, width - 2 * INSET), height: Math.max(0, height - 2 * INSET) }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const p = local(e);
        const [r, c] = cellAt(layout, p.x, p.y);
        const cs = store.getState().cellSel;
        const inSel = cs && cs.shape === shape.id && r >= cs.range.r0 && r <= cs.range.r1 && c >= cs.range.c0 && c <= cs.range.c1;
        if (!inSel && !store.getState().editing) store.selectCells(shape.id, { r0: r, c0: c, r1: r, c1: c });
        onMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      {layout.cells.map((c) => (
        <div
          key={`${c.row},${c.col}`}
          role="gridcell"
          data-testid="table-cell"
          data-cell={`${c.row},${c.col}`}
          aria-selected={selected.has(`${c.row},${c.col}`)}
          className={`pointer-events-none absolute ${selected.has(`${c.row},${c.col}`) ? "bg-blue-500/25" : ""}`}
          style={{ left: c.x * scale - INSET, top: c.y * scale - INSET, width: c.w * scale, height: c.h * scale }}
        />
      ))}
      {layout.colX.slice(1, -1).map((x, i) => grip("cols", i, x))}
      {layout.rowY.slice(1).map((y, i) => grip("rows", i, y))}
      {resize && (
        <div
          className="pointer-events-none absolute border-blue-600"
          style={
            resize.axis === "cols"
              ? { left: layout.colX[resize.index + 1]! * scale - INSET + resize.delta, top: -INSET, height, borderLeftWidth: 1, borderStyle: "dashed" }
              : { top: layout.rowY[resize.index + 1]! * scale - INSET + resize.delta, left: -INSET, width, borderTopWidth: 1, borderStyle: "dashed" }
          }
        />
      )}
    </div>
  );
}
