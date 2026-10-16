// Active cell address + editable input. The bar and the in-cell editor are
// two views of the same edit session (typing in either updates both,
// pointing works from either); the fx button opens the function list.

import { useLayoutEffect, useRef, useState, type FocusEvent } from "react";
import { isFormula } from "./formula/tokenize";
import { cellAddress, sheetPrefix } from "./grid/address";
import { FORMULA_BAR_ATTR } from "./grid/CellEditor";
import { EditPopups, FormulaOverlay, handleEditorKey, syncCaret, useEditorBinding } from "./grid/editorKit";
import { normalize } from "./grid/Selection";
import { isSingleCell } from "./grid/merges";
import { useCalc, type CalcStore } from "./state/store";
import { useT } from "./i18n";
import { NameBox } from "./names/NameBox";

export function FormulaBar({ store }: { store: CalcStore }) {
  const t = useT();
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
  // A merged cell is addressed by its top-left cell, as in Excel's name box.
  const single = isSingleCell(r, store.merges());
  const address = single ? `${prefix}${cellAddress(row, col)}` : `${prefix}${cellAddress(r.r0, r.c0)}:${cellAddress(r.r1, r.c1)}`;
  // A spilled cell shows its array formula greyed and read-only (Excel); typing into the cell still replaces it.
  const ghost = edit ? null : store.ghostFormula();
  const value = edit ? edit.text : (ghost?.input ?? store.activeCell()?.input ?? "");
  const refs = edit && isFormula(edit.text) ? store.editRefs() : [];
  const colored = refs.length > 0;
  // The in-cell editor is hidden while pointing on another sheet: the bar then shows the popups.
  const popups = !!edit && (origin === "bar" || edit.sheet !== activeSheet);

  const onFocus = () => {
    if (ghost) return;
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
      <NameBox store={store} address={address} />
      <button
        type="button"
        aria-label={t("calc.insertFunction")}
        title={t("calc.insertFunction")}
        className="select-none rounded px-1 italic text-ui-muted hover:bg-ui-hover"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          // Excel's fx: the Insert Function dialog.
          store.openDialog({ kind: "insertFunction" });
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
          aria-label={t("calc.formulaBar")}
          spellCheck={false}
          autoComplete="off"
          className={`relative w-full rounded border border-ui-border px-2 py-0.5 font-mono outline-none focus:border-ui-focus ${
            colored ? "bg-transparent text-transparent" : ghost ? "bg-ui-bg text-ui-muted" : "bg-ui-bg"
          }`}
          readOnly={!!ghost}
          aria-readonly={ghost ? true : undefined}
          title={ghost ? t("calc.spill.ghost", { cell: cellAddress(ghost.anchor.row, ghost.anchor.col) }) : undefined}
          data-spilled={ghost ? "" : undefined}
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
