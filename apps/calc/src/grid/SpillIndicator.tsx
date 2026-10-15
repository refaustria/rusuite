// The error indicator of a blocked array formula (`#SPILL!`): a small
// warning button left of the selected formula cell, as Excel's smart tag,
// with the reason and "Select obstructing cells". The grid positions the
// wrapper (`boxRef`) on every frame.

import { useLayoutEffect, useState, type RefObject } from "react";
import { useCalc, type CalcStore } from "../state/store";
import { useT } from "../i18n";

/** Width of the indicator button, px (it sits left of the cell). */
export const SPILL_TAG_W = 18;

/** Whether the indicator shows: the active cell is a `#SPILL!` formula cell and nothing is being edited. */
export function spillIndicatorVisible(store: CalcStore): boolean {
  if (store.getState().edit) return false;
  const o = store.activeSpill();
  const a = store.activeAnchor();
  return !!o?.blocked && o.anchor.row === a.row && o.anchor.col === a.col;
}

export function SpillIndicator({ store, boxRef, onMount }: { store: CalcStore; boxRef: RefObject<HTMLDivElement>; onMount: () => void }) {
  const t = useT();
  useCalc(store, (s) => s.version);
  const anchor = useCalc(store, (s) => s.selection.anchor);
  useCalc(store, (s) => s.edit);
  const [openAt, setOpenAt] = useState<typeof anchor | null>(null);
  const visible = spillIndicatorVisible(store);
  useLayoutEffect(() => {
    if (visible) onMount();
  }, [visible, onMount]);
  if (!visible) return null;
  // The menu belongs to the cell it was opened on.
  const open = openAt === anchor;
  const reason = t("calc.spill.notBlank");
  return (
    <div ref={boxRef} className="absolute z-10" style={{ left: -9999, top: -9999 }} data-testid="spill-indicator">
      <button
        type="button"
        title={reason}
        aria-label={t("calc.spill.error")}
        aria-expanded={open}
        className="flex h-[18px] w-[18px] items-center justify-center rounded-sm border border-[#c9a400] bg-[#ffd400] text-xs font-bold leading-none text-black shadow"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpenAt(open ? null : anchor)}
      >
        !
      </button>
      {open && (
        <div role="menu" data-testid="spill-menu" className="absolute left-0 top-5 min-w-[14rem] rounded border border-ui-border bg-ui-bg py-1 text-sm text-ui-fg shadow-lg">
          <div className="px-3 py-1 font-semibold">{reason}</div>
          <button
            type="button"
            role="menuitem"
            className="block w-full px-3 py-1 text-left hover:bg-ui-hover"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setOpenAt(null);
              store.selectObstructing();
              store.focusGrid();
            }}
          >
            {t("calc.spill.selectObstructing")}
          </button>
        </div>
      )}
    </div>
  );
}
