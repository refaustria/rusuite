// The slicers of the active sheet as floating panels over the grid
// (P9-C2): caption with Multi-Select and Clear Filter, a grid of item
// buttons (selected / with data / without data, in the slicer's style),
// a click selects the slicer (Slicer tab); drag the frame to move it, the
// corner handles resize it, Delete removes it. Positions come from the
// grid (`store.comments.screen`), refreshed after every frame.

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { SlicerView } from "../generated/SlicerView";
import type { PxRect } from "../charts/anchor";
import { HEADER_H, HEADER_W } from "../grid/render";
import { useT } from "../i18n";
import { useCalc, type CalcStore } from "../state/store";
import { buttonLayout, CAPTION_H, GAP, isFiltered, PAD } from "./controller";
import { clearFilterIcon, multiSelectIcon } from "./icons";
import { slicerColors } from "./styles";

type Handle = "nw" | "ne" | "se" | "sw";
const HANDLES: Handle[] = ["nw", "ne", "se", "sw"];
const CURSOR: Record<Handle, string> = { nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize" };
const MIN = 40;

function resized(r: PxRect, h: Handle, dx: number, dy: number): PxRect {
  let { x, y, w, h: hh } = r;
  if (h.includes("w")) {
    x += Math.min(dx, w - MIN);
    w = Math.max(MIN, w - dx);
  } else w = Math.max(MIN, w + dx);
  if (h.includes("n")) {
    y += Math.min(dy, hh - MIN);
    hh = Math.max(MIN, hh - dy);
  } else hh = Math.max(MIN, hh + dy);
  return { x, y, w, h: hh };
}

function SlicerBox({ store, view, sheet }: { store: CalcStore; view: SlicerView; sheet: number }) {
  const t = useT();
  const ctl = store.slicers;
  const s = view.slicer;
  const selected = ctl.selected?.sheet === sheet && ctl.selected.id === s.id;
  const multi = ctl.multi.has(s.id);
  const colors = slicerColors(s.style);
  const rect = ctl.rect(sheet, view);
  const on = store.sheetView().showHeadings;
  const p = store.comments.screen?.(rect.x, rect.y) ?? { x: rect.x, y: rect.y };
  const box = { x: p.x + (on ? HEADER_W : 0), y: p.y + (on ? HEADER_H : 0), w: rect.w, h: rect.h };
  const layout = buttonLayout(view, rect);
  const caption = s.caption || s.name;
  const drag = (e: ReactPointerEvent, handle: Handle | null) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (handle) e.preventDefault();
    ctl.select(sheet, s.id);
    const x0 = e.clientX;
    const y0 = e.clientY;
    const start = rect;
    const z = store.sheetView().zoom / 100 || 1;
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - x0) / z;
      const dy = (ev.clientY - y0) / z;
      if (!moved && Math.hypot(dx, dy) < 3) return;
      moved = true;
      const r = handle ? resized(start, handle, dx, dy) : { ...start, x: Math.max(0, start.x + dx), y: Math.max(0, start.y + dy) };
      ctl.preview = { id: s.id, rect: r };
      store.notify();
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const pv = ctl.preview;
      if (moved && pv) void ctl.setRect(s.id, pv.rect).finally(() => {
        ctl.preview = null;
        store.notify();
      });
      else store.notify();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const onKeyDown = (e: ReactKeyboardEvent) => {
    // Excel: Alt+S toggles Multi-Select, Alt+C clears the filter (also from a button).
    if (e.altKey && (e.key === "s" || e.key === "S")) {
      e.preventDefault();
      ctl.toggleMulti(s.id);
      return;
    }
    if (e.altKey && (e.key === "c" || e.key === "C")) {
      e.preventDefault();
      void ctl.clear(view);
      return;
    }
    if (e.target !== e.currentTarget) return;
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      void ctl.remove(s.id);
      store.focusGrid();
    } else if (e.key === "Escape") {
      ctl.deselect();
      store.focusGrid();
    }
  };
  return (
    <>
      <div
        role="group"
        aria-label={t("calc.slicer.label", { name: caption })}
        tabIndex={0}
        data-testid="slicer"
        data-slicer={s.name}
        className={`pointer-events-auto absolute flex select-none flex-col overflow-hidden text-xs shadow ${selected ? "outline outline-2 outline-[#217346]" : ""}`}
        style={{ left: box.x, top: box.y, width: box.w, height: box.h, background: colors.background, border: `1px solid ${colors.frame}`, cursor: "move" }}
        onPointerDown={(e) => drag(e, null)}
        onKeyDown={onKeyDown}
      >
        {s.showCaption !== false && (
          <div className="flex shrink-0 items-center gap-1 px-2" style={{ height: CAPTION_H, color: colors.caption }}>
            <span className="min-w-0 flex-1 truncate font-semibold" data-testid="slicer-caption">
              {caption}
            </span>
            <button
              type="button"
              aria-label={t("calc.slicer.multiSelect")}
              title={t("calc.slicer.multiSelectTip")}
              aria-pressed={multi}
              className={`flex h-6 w-6 items-center justify-center rounded ${multi ? "bg-ui-active" : "hover:bg-ui-hover"}`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => ctl.toggleMulti(s.id)}
            >
              {multiSelectIcon()}
            </button>
            <button
              type="button"
              aria-label={t("calc.slicer.clearFilter")}
              title={t("calc.slicer.clearFilterTip")}
              disabled={!isFiltered(view)}
              className="flex h-6 w-6 items-center justify-center rounded hover:bg-ui-hover disabled:opacity-30"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => void ctl.clear(view)}
            >
              {clearFilterIcon()}
            </button>
          </div>
        )}
        <div
          className="grid min-h-0 flex-1 content-start overflow-auto"
          style={{ gridTemplateColumns: `repeat(${layout.cols}, minmax(0, 1fr))`, gap: GAP, padding: `${s.showCaption !== false ? 0 : PAD}px ${PAD}px ${PAD}px` }}
        >
          {view.items.map((it) => (
            <button
              key={it.name}
              type="button"
              aria-pressed={it.selected}
              data-has-data={it.hasData ? "true" : "false"}
              className="truncate rounded-sm px-2 text-left"
              style={{
                height: layout.h,
                background: it.selected ? colors.on : colors.off,
                color: it.hasData ? (it.selected ? colors.onText : colors.offText) : colors.noData,
                border: `1px solid ${colors.border}`,
                cursor: "pointer",
              }}
              onPointerDown={(e) => {
                e.stopPropagation();
                ctl.select(sheet, s.id);
              }}
              onClick={(e) => void ctl.click(view, it.name, e.ctrlKey || e.metaKey)}
            >
              {it.name === "" ? t("calc.slicer.blank") : it.name}
            </button>
          ))}
        </div>
      </div>
      {selected &&
        HANDLES.map((h) => {
          const x = h.includes("w") ? box.x : box.x + box.w;
          const y = h.includes("n") ? box.y : box.y + box.h;
          return (
            <div
              key={h}
              data-testid={`slicer-handle-${h}`}
              className="pointer-events-auto absolute flex h-6 w-6 items-center justify-center"
              style={{ left: x - 12, top: y - 12, cursor: CURSOR[h] }}
              onPointerDown={(e) => drag(e, h)}
            >
              <span className="h-2 w-2 border border-[#217346] bg-white" />
            </div>
          );
        })}
    </>
  );
}

/** Every slicer of the active sheet. */
export function SlicerLayer({ store }: { store: CalcStore }) {
  useCalc(store, (s) => s.version);
  const sheet = useCalc(store, (s) => s.activeSheet);
  const [, setFrame] = useState(0);
  const lastKey = useRef("");
  useEffect(() => {
    store.slicers.positioner = () => {
      const p = store.comments.screen?.(0, 0);
      const key = p ? `${p.x},${p.y}` : "";
      if (key !== lastKey.current) {
        lastKey.current = key;
        setFrame((n) => n + 1);
      }
    };
    return () => {
      store.slicers.positioner = null;
    };
  }, [store]);
  const views = store.slicers.of(sheet);
  if (views.length === 0) return null;
  const on = store.sheetView().showHeadings;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" style={{ clipPath: `inset(${on ? HEADER_H : 0}px 0 0 ${on ? HEADER_W : 0}px)` }} data-testid="slicer-layer">
      {views.map((v) => (
        <SlicerBox key={v.slicer.id} store={store} view={v} sheet={sheet} />
      ))}
    </div>
  );
}
