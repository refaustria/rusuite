// In-cell editor: an <input> overlaid on the active cell. The grid
// positions its wrapper (`boxRef`) on every frame.

import { useLayoutEffect, useRef, type FocusEvent, type KeyboardEvent, type RefObject } from "react";
import { useCalc, type CalcStore } from "../state/store";
import { fontCss } from "./style";

export const FORMULA_BAR_ATTR = "data-formula-bar";

export function CellEditor({
  store, boxRef, onMount,
}: { store: CalcStore; boxRef: RefObject<HTMLDivElement>; onMount: () => void }) {
  const edit = useCalc(store, (s) => s.edit);
  const input = useRef<HTMLInputElement>(null);
  const origin = edit?.origin;

  useLayoutEffect(onMount, [onMount]);
  useLayoutEffect(() => {
    const el = input.current;
    if (origin === "cell" && el) {
      el.focus({ preventScroll: true });
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, [origin]);

  if (!edit) return null;

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const moves: Record<string, [number, number]> = {
      Enter: [e.shiftKey ? -1 : 1, 0],
      Tab: [0, e.shiftKey ? -1 : 1],
    };
    if (store.getState().edit?.mode === "enter") {
      Object.assign(moves, { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] });
    }
    const m = moves[e.key];
    if (m && !e.altKey) {
      e.preventDefault();
      void store.commitEdit(m[0], m[1]);
      store.focusGrid();
    } else if (e.key === "Escape") {
      e.preventDefault();
      store.cancelEdit();
      store.focusGrid();
    }
  };

  const onBlur = (e: FocusEvent<HTMLInputElement>) => {
    const to = e.relatedTarget as HTMLElement | null;
    if (to?.hasAttribute(FORMULA_BAR_ATTR)) store.setEditOrigin("bar");
    else if (store.getState().edit?.origin === "cell") void store.commitEdit(0, 0);
  };

  return (
    <div ref={boxRef} className="absolute z-10" style={{ left: -9999, top: -9999 }}>
      <input
        ref={input}
        aria-label="Cell editor"
        data-testid="cell-editor"
        spellCheck={false}
        autoComplete="off"
        className="block h-full border-2 border-[#217346] bg-white px-[2px] text-black outline-none"
        style={{ font: fontCss(store.activeStyle()), width: `max(100%, ${edit.text.length + 2}ch)` }}
        value={edit.text}
        onChange={(e) => store.setEditText(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
      />
    </div>
  );
}
