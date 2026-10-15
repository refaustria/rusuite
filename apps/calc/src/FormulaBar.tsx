// Active cell address + editable input, synced with the in-cell editor.

import { useRef, type FocusEvent, type KeyboardEvent } from "react";
import { cellAddress, sheetPrefix } from "./grid/address";
import { FORMULA_BAR_ATTR } from "./grid/CellEditor";
import { normalize } from "./grid/Selection";
import { useCalc, type CalcStore } from "./state/store";

export function FormulaBar({ store }: { store: CalcStore }) {
  const input = useRef<HTMLInputElement>(null);
  const edit = useCalc(store, (s) => s.edit);
  const selection = useCalc(store, (s) => s.selection);
  useCalc(store, (s) => s.version);
  const sheets = useCalc(store, (s) => s.info?.sheets);
  const activeSheet = useCalc(store, (s) => s.activeSheet);

  const { row, col } = selection.anchor;
  const index = sheets?.findIndex((s) => s.id === activeSheet) ?? 0;
  const prefix = index > 0 && sheets ? sheetPrefix(sheets[index].name) : "";
  const r = normalize(selection);
  const single = r.r0 === r.r1 && r.c0 === r.c1;
  const address = single ? `${prefix}${cellAddress(row, col)}` : `${prefix}${cellAddress(r.r0, r.c0)}:${cellAddress(r.r1, r.c1)}`;
  const value = edit ? edit.text : (store.activeCell()?.input ?? "");

  const onFocus = () => {
    if (store.getState().edit) store.setEditOrigin("bar");
    else store.beginEdit(null, "bar");
  };

  const onBlur = (e: FocusEvent<HTMLInputElement>) => {
    const to = e.relatedTarget as HTMLElement | null;
    if (to?.getAttribute("data-testid") === "cell-editor") store.setEditOrigin("cell");
    else if (store.getState().edit?.origin === "bar") void store.commitEdit(0, 0);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      const back = e.shiftKey ? -1 : 1;
      void store.commitEdit(e.key === "Enter" ? back : 0, e.key === "Tab" ? back : 0);
      store.focusGrid();
    } else if (e.key === "Escape") {
      e.preventDefault();
      store.cancelEdit();
      store.focusGrid();
    }
  };

  return (
    <div className="flex items-center gap-2 border-b border-ui-border bg-ui-bg px-2 py-1 text-sm text-ui-fg">
      <output aria-label="Cell address" data-testid="cell-address" className="w-28 shrink-0 truncate rounded border border-ui-border px-2 py-0.5 font-mono">
        {address}
      </output>
      <span className="select-none italic text-ui-muted">fx</span>
      <input
        ref={input}
        {...{ [FORMULA_BAR_ATTR]: "" }}
        aria-label="Formula bar"
        spellCheck={false}
        autoComplete="off"
        className="min-w-0 flex-1 rounded border border-ui-border bg-ui-bg px-2 py-0.5 font-mono outline-none focus:border-ui-focus"
        value={value}
        onFocus={onFocus}
        onBlur={onBlur}
        onChange={(e) => {
          if (!store.getState().edit) store.beginEdit(null, "bar");
          store.setEditText(e.target.value);
        }}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}
