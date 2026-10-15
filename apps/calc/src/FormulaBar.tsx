// Active cell address + editable input. The bar and the in-cell editor are
// two views of the same edit session (typing in either updates both,
// pointing works from either); the fx button opens the function list.

import { useLayoutEffect, useRef, useState, type FocusEvent } from "react";
import { isFormula } from "./formula/tokenize";
import { cellAddress, sheetPrefix } from "./grid/address";
import { FORMULA_BAR_ATTR } from "./grid/CellEditor";
import { EditPopups, FormulaOverlay, handleEditorKey, syncCaret, useEditorBinding } from "./grid/editorKit";
import { normalize } from "./grid/Selection";
import { useCalc, type CalcStore } from "./state/store";

export function FormulaBar({ store }: { store: CalcStore }) {
  const input = useRef<HTMLInputElement>(null);
  const edit = useCalc(store, (s) => s.edit);
  const selection = useCalc(store, (s) => s.selection);
  useCalc(store, (s) => s.version);
  const sheets = useCalc(store, (s) => s.info?.sheets);
  const activeSheet = useCalc(store, (s) => s.activeSheet);
  const [scrollX, setScrollX] = useState(0);
  useEditorBinding(store, "bar", input);

  const origin = edit?.origin;
  useLayoutEffect(() => {
    const el = input.current;
    if (origin === "bar" && el && el.ownerDocument.activeElement !== el) el.focus({ preventScroll: true });
  }, [origin]);

  const { row, col } = selection.anchor;
  const index = sheets?.findIndex((s) => s.id === activeSheet) ?? 0;
  const prefix = index > 0 && sheets ? sheetPrefix(sheets[index].name) : "";
  const r = normalize(selection);
  const single = r.r0 === r.r1 && r.c0 === r.c1;
  const address = single ? `${prefix}${cellAddress(row, col)}` : `${prefix}${cellAddress(r.r0, r.c0)}:${cellAddress(r.r1, r.c1)}`;
  const value = edit ? edit.text : (store.activeCell()?.input ?? "");
  const refs = edit && isFormula(edit.text) ? store.editRefs() : [];
  const colored = refs.length > 0;
  // The in-cell editor is hidden while pointing on another sheet: the bar then shows the popups.
  const popups = !!edit && (origin === "bar" || edit.sheet !== activeSheet);

  const onFocus = () => {
    if (store.getState().edit) store.setEditOrigin("bar");
    else store.beginEdit(null, "bar");
  };

  const onBlur = (e: FocusEvent<HTMLInputElement>) => {
    // Leaving the bar keeps the edit open; only the in-cell editor takes it over.
    const to = e.relatedTarget as HTMLElement | null;
    if (to?.getAttribute("data-testid") === "cell-editor") store.setEditOrigin("cell");
  };

  const track = () => setScrollX(input.current?.scrollLeft ?? 0);

  return (
    <div className="flex items-center gap-2 border-b border-ui-border bg-ui-bg px-2 py-1 text-sm text-ui-fg">
      <output aria-label="Cell address" data-testid="cell-address" className="w-28 shrink-0 truncate rounded border border-ui-border px-2 py-0.5 font-mono">
        {address}
      </output>
      <button
        type="button"
        aria-label="Insert function"
        title="Insert function"
        className="select-none rounded px-1 italic text-ui-muted hover:bg-ui-hover"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          store.openFunctionList();
          store.focusEditor();
        }}
      >
        fx
      </button>
      <div className="relative min-w-0 flex-1">
        {colored && (
          <div className="pointer-events-none absolute inset-0 overflow-hidden rounded border border-transparent px-2 py-0.5 font-mono">
            <FormulaOverlay text={value} refs={refs} className="whitespace-pre" style={{ transform: `translateX(${-scrollX}px)` }} />
          </div>
        )}
        <input
          ref={input}
          {...{ [FORMULA_BAR_ATTR]: "" }}
          aria-label="Formula bar"
          spellCheck={false}
          autoComplete="off"
          className={`relative w-full rounded border border-ui-border px-2 py-0.5 font-mono outline-none focus:border-ui-focus ${
            colored ? "bg-transparent text-transparent" : "bg-ui-bg"
          }`}
          style={colored ? { caretColor: "var(--ui-fg)" } : undefined}
          value={value}
          onFocus={onFocus}
          onBlur={onBlur}
          onChange={(e) => {
            if (!store.getState().edit) store.beginEdit(null, "bar");
            store.setEditText(e.target.value, e.target.selectionEnd ?? e.target.value.length);
            track();
          }}
          onKeyDown={(e) => handleEditorKey(store, e)}
          onSelect={(e) => {
            syncCaret(store)(e);
            track();
          }}
          onKeyUp={syncCaret(store)}
          onMouseUp={syncCaret(store)}
          onScroll={track}
        />
        {popups && <EditPopups store={store} />}
      </div>
    </div>
  );
}
