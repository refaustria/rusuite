// Data validation on the selected cell: the in-cell dropdown of a list
// validation (the arrow button right of the cell, its value list from the
// core's `listValues`) and the input message shown next to the cell. The
// grid positions the wrapper (`boxRef`) over the active cell on every frame.

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useCalc, type CalcStore } from "../state/store";
import { useT } from "../i18n";
import { hasDropdown, inputMessage } from "./validation";

/** Width of the dropdown arrow button, px (it sits right of the cell, as in Excel). */
export const DROPDOWN_W = 17;

export function ValidationOverlay({ store, boxRef, onMount }: { store: CalcStore; boxRef: RefObject<HTMLDivElement>; onMount: () => void }) {
  const t = useT();
  useCalc(store, (s) => s.version);
  const anchor = useCalc(store, (s) => s.selection.anchor);
  const editing = useCalc(store, (s) => s.edit !== null);
  const v = store.activeValidation();
  const dropdown = hasDropdown(v) && !editing;
  const message = inputMessage(v);
  const visible = dropdown || message !== null;
  const [list, setList] = useState<{ at: typeof anchor; values: string[]; index: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const open = list !== null && list.at === anchor;
  const shown = open ? list : null;

  useLayoutEffect(() => {
    if (visible) onMount();
  }, [visible, onMount, anchor]);

  useEffect(() => {
    // Alt+↓ on the cell (grid keyboard handler) opens the list.
    store.openValidationList = () => void openList();
    return () => {
      store.openValidationList = null;
    };
  });

  useEffect(() => {
    if (open) listRef.current?.querySelector<HTMLElement>("[aria-selected=true]")?.focus();
  }, [open, list?.index]);

  if (!visible) return null;

  async function openList() {
    if (!hasDropdown(store.activeValidation())) return;
    const at = store.getState().selection.anchor;
    const values = await store.listValues();
    const current = store.activeCell()?.display ?? "";
    setList({ at, values, index: Math.max(0, values.indexOf(current)) });
  }
  const close = () => {
    setList(null);
    store.focusGrid();
  };
  const pick = (value: string) => {
    setList(null);
    void store.pickListValue(value);
    store.focusGrid();
  };

  return (
    <div ref={boxRef} className="pointer-events-none absolute z-10" style={{ left: -9999, top: -9999 }} data-testid="validation-overlay">
      {dropdown && (
        <button
          type="button"
          aria-label={t("calc.dv.showList")}
          aria-haspopup="listbox"
          aria-expanded={open}
          data-testid="validation-dropdown"
          className="pointer-events-auto absolute top-0 flex h-full items-center justify-center border border-[#a6a6a6] bg-[#f3f3f3] text-[10px] text-black hover:bg-[#e1e1e1]"
          style={{ left: "100%", width: DROPDOWN_W }}
          onPointerDown={(e) => e.preventDefault()}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => (open ? close() : void openList())}
        >
          ▼
        </button>
      )}
      {shown && (
        <div
          ref={listRef}
          role="listbox"
          aria-label={t("calc.dv.list")}
          data-testid="validation-list"
          className="pointer-events-auto absolute left-0 top-full max-h-48 min-w-full overflow-auto border border-[#7a7a7a] bg-white py-0.5 text-sm text-black shadow-md"
          onKeyDown={(e) => {
            const n = shown.values.length;
            if (e.key === "Escape") close();
            else if (e.key === "ArrowDown" && n > 0) setList({ ...shown, index: Math.min(n - 1, shown.index + 1) });
            else if (e.key === "ArrowUp" && n > 0) setList({ ...shown, index: Math.max(0, shown.index - 1) });
            else if ((e.key === "Enter" || e.key === "Tab") && n > 0) pick(shown.values[shown.index]!);
            else return;
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          {shown.values.map((value, i) => (
            <div
              key={`${i}:${value}`}
              role="option"
              tabIndex={-1}
              aria-selected={i === shown.index}
              className="min-h-6 cursor-default whitespace-nowrap px-2 leading-6 outline-none hover:bg-[#cce4f7] aria-selected:bg-[#0078d4] aria-selected:text-white"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(value)}
            >
              {value === "" ? " " : value}
            </div>
          ))}
        </div>
      )}
      {message && !open && (
        <div
          role="tooltip"
          data-testid="validation-input-message"
          className="absolute max-w-64 whitespace-pre-wrap border border-[#7a7a7a] bg-[#ffffe1] px-2 py-1 text-xs text-black shadow"
          style={{ left: "50%", top: "calc(100% + 6px)" }}
        >
          {message.title && <div className="font-semibold">{message.title}</div>}
          {message.message && <div>{message.message}</div>}
        </div>
      )}
    </div>
  );
}
