// Flash Fill's greyed suggestions over the empty cells (P9-C2) and the
// hint "Enter to accept"; positions come from the grid
// (`store.comments.screen`), refreshed after every frame.

import { useEffect, useRef, useState } from "react";
import { HEADER_H, HEADER_W } from "../grid/render";
import { useT } from "../i18n";
import { useCalc, type CalcStore } from "../state/store";

/** At most this many suggestions are drawn (the visible ones). */
const MAX_SHOWN = 400;

export function FlashPreviewLayer({ store }: { store: CalcStore }) {
  const t = useT();
  useCalc(store, (s) => s.version);
  const sheet = useCalc(store, (s) => s.activeSheet);
  const [, setFrame] = useState(0);
  const lastKey = useRef("");
  useEffect(() => {
    store.flashPositioner = () => {
      const p = store.comments.screen?.(0, 0);
      const key = p ? `${p.x},${p.y}` : "";
      if (key !== lastKey.current) {
        lastKey.current = key;
        setFrame((n) => n + 1);
      }
    };
    return () => {
      store.flashPositioner = null;
    };
  }, [store]);
  const p = store.flash.preview;
  if (!p || p.sheet !== sheet) return null;
  const on = store.sheetView().showHeadings;
  const hw = on ? HEADER_W : 0;
  const hh = on ? HEADER_H : 0;
  const geo = store.geometry(sheet);
  const box = (row: number) => {
    const q = store.comments.screen?.(geo.col.offset(p.col), geo.row.offset(row)) ?? { x: geo.col.offset(p.col), y: geo.row.offset(row) };
    return { x: q.x + hw, y: q.y + hh, w: geo.col.size(p.col), h: geo.row.size(row) };
  };
  const first = box(p.cells[0]!.row);
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" style={{ clipPath: `inset(${hh}px 0 0 ${hw}px)` }} data-testid="flash-preview">
      {p.cells.slice(0, MAX_SHOWN).map((c) => {
        const b = box(c.row);
        return (
          <div key={c.row} data-testid="flash-suggestion" className="absolute truncate px-[3px] text-[11pt] leading-none text-[#a6a6a6]" style={{ left: b.x, top: b.y + Math.max(0, b.h - 17), width: b.w, height: b.h }}>
            {c.input}
          </div>
        );
      })}
      <div role="status" className="absolute rounded border border-ui-border bg-ui-panel px-2 py-0.5 text-xs text-ui-fg shadow" style={{ left: first.x + first.w + 4, top: first.y }}>
        {t("calc.flash.hint")}
      </div>
    </div>
  );
}
