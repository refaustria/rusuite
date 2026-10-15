// In-cell editor: a one-line <textarea> overlaid on the edited cell. The
// grid positions its wrapper (`boxRef`) on every frame. It shares the edit
// session with the formula bar (see editorKit.tsx).

import { useLayoutEffect, useRef, type FocusEvent, type RefObject } from "react";
import { isFormula } from "../formula/tokenize";
import { useCalc, type CalcStore } from "../state/store";
import { EditPopups, FormulaOverlay, handleEditorKey, syncCaret, useEditorBinding } from "./editorKit";
import { fontCss } from "./style";

export const FORMULA_BAR_ATTR = "data-formula-bar";

export function CellEditor({
  store, boxRef, onMount,
}: { store: CalcStore; boxRef: RefObject<HTMLDivElement>; onMount: () => void }) {
  const edit = useCalc(store, (s) => s.edit);
  const input = useRef<HTMLTextAreaElement>(null);
  const origin = edit?.origin;
  useEditorBinding(store, "cell", input);

  useLayoutEffect(onMount, [onMount]);
  useLayoutEffect(() => {
    const el = input.current;
    const e = store.getState().edit;
    if (origin === "cell" && el && e) {
      el.focus({ preventScroll: true });
      el.setSelectionRange(e.selStart, e.selEnd);
    }
  }, [origin, store]);

  if (!edit) return null;

  const onBlur = (e: FocusEvent<HTMLTextAreaElement>) => {
    // Leaving the editor never commits or discards (Excel keeps the edit
    // while e.g. the toolbar is used); only the formula bar takes it over.
    const to = e.relatedTarget as HTMLElement | null;
    if (to?.hasAttribute(FORMULA_BAR_ATTR)) store.setEditOrigin("bar");
  };

  const refs = isFormula(edit.text) ? store.editRefs() : [];
  const colored = refs.length > 0;
  const font = fontCss(store.activeStyle());
  const width = `max(100%, ${edit.text.length + 2}ch)`;

  return (
    <div ref={boxRef} className="absolute z-10" style={{ left: -9999, top: -9999 }}>
      {colored && (
        <FormulaOverlay
          text={edit.text}
          refs={refs}
          className="pointer-events-none absolute left-0 top-0 h-full overflow-hidden whitespace-pre border-2 border-transparent bg-white px-[2px] text-black"
          style={{ font, width }}
        />
      )}
      <textarea
        ref={input}
        rows={1}
        wrap="off"
        aria-label="Cell editor"
        data-testid="cell-editor"
        spellCheck={false}
        autoComplete="off"
        className={`relative block h-full resize-none overflow-hidden whitespace-pre border-2 border-[#217346] px-[2px] outline-none ${
          colored ? "bg-transparent text-transparent" : "bg-white text-black"
        }`}
        style={{ font, width, caretColor: "#000" }}
        value={edit.text}
        onChange={(e) => store.setEditText(e.target.value, e.target.selectionEnd)}
        onKeyDown={(e) => handleEditorKey(store, e)}
        onSelect={syncCaret(store)}
        onKeyUp={syncCaret(store)}
        onMouseUp={syncCaret(store)}
        onBlur={onBlur}
      />
      {origin === "cell" && <EditPopups store={store} />}
    </div>
  );
}
