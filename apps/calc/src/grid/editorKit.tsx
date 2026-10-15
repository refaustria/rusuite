// Pieces shared by the in-cell editor and the formula bar, which are two
// views of one edit session (`CalcStore.edit`): caret syncing, the key
// handling of Excel's enter / edit / point modes, the coloured reference
// overlay and the popups (autocomplete, signature tip, inline error).

import { Fragment, useEffect, useLayoutEffect, type CSSProperties, type KeyboardEvent, type ReactNode, type RefObject, type SyntheticEvent } from "react";
import type { ColoredRef } from "../formula/refs";
import { useCalc, type CalcStore, type EditState } from "../state/store";

type Field = HTMLInputElement | HTMLTextAreaElement;

/** Registers the editor's focus callback and mirrors the store's caret into the field while it has the focus. */
export function useEditorBinding(store: CalcStore, origin: EditState["origin"], ref: RefObject<Field>): void {
  const edit = useCalc(store, (s) => s.edit);
  useEffect(() => {
    const focus = () => ref.current?.focus({ preventScroll: true });
    store.editorFocus[origin] = focus;
    return () => {
      if (store.editorFocus[origin] === focus) delete store.editorFocus[origin];
    };
  }, [store, origin, ref]);
  const text = edit?.text;
  const start = edit?.selStart;
  const end = edit?.selEnd;
  const owner = edit?.origin;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || owner !== origin || start === undefined || end === undefined || el.ownerDocument.activeElement !== el) return;
    if (el.selectionStart !== start || el.selectionEnd !== end) el.setSelectionRange(start, end);
  }, [ref, origin, owner, text, start, end]);
}

/** Reports the field's caret to the store (select / key up / mouse up). */
export function syncCaret(store: CalcStore) {
  return (e: SyntheticEvent<Field>) => {
    const el = e.currentTarget;
    if (el.selectionStart !== null && el.selectionEnd !== null) store.setEditCaret(el.selectionStart, el.selectionEnd);
  };
}

const ARROWS: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };

/** Commits and moves; on success the focus goes back to the grid, otherwise it stays in the editor. */
export function commitAndMove(store: CalcStore, dRow: number, dCol: number): void {
  void store.commitEdit(dRow, dCol);
  if (store.getState().edit) store.focusEditor();
  else store.focusGrid();
}

/**
 * Keys of an editor field. Autocomplete keys first; F4 anchors, F2 toggles
 * enter/edit mode; Enter/Tab commit; in enter mode the arrows point
 * (formula, caret at an operand position) or commit and move; Esc cancels.
 */
export function handleEditorKey(store: CalcStore, e: KeyboardEvent<Field>): void {
  const edit = store.getState().edit;
  if (!edit) return;
  const el = e.currentTarget;
  if (el.selectionStart !== null && el.selectionEnd !== null) store.setEditCaret(el.selectionStart, el.selectionEnd);
  const ctrl = e.ctrlKey || e.metaKey;
  if (store.completion()) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      store.moveCompletion(e.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if ((e.key === "Tab" || e.key === "Enter") && !e.altKey && !ctrl) {
      e.preventDefault();
      store.acceptCompletion();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      store.dismissCompletion();
      return;
    }
  }
  if (e.key === "F4") {
    e.preventDefault();
    store.cycleRefAnchor();
    return;
  }
  if (e.key === "F2") {
    e.preventDefault();
    store.toggleEditMode();
    return;
  }
  if (e.key === "Enter" && e.altKey) {
    // Alt+Enter: line break (cells do not wrap yet, the text just carries "\n").
    e.preventDefault();
    const s = el.selectionStart ?? el.value.length;
    store.setEditText(el.value.slice(0, s) + "\n" + el.value.slice(el.selectionEnd ?? s), s + 1);
    return;
  }
  if (e.key === "Enter" || e.key === "Tab") {
    e.preventDefault();
    const back = e.shiftKey ? -1 : 1;
    commitAndMove(store, e.key === "Enter" ? back : 0, e.key === "Tab" ? back : 0);
    return;
  }
  const d = ARROWS[e.key];
  if (d && edit.mode === "enter" && !e.altKey) {
    e.preventDefault();
    if (!ctrl && store.pointMove(d[0], d[1], e.shiftKey)) return;
    commitAndMove(store, d[0], d[1]);
    return;
  }
  if (e.key === "Escape") {
    e.preventDefault();
    store.cancelEdit();
    store.focusGrid();
  }
}

/** The edit text with its references coloured (drawn behind a transparent-text field). */
export function FormulaOverlay({ text, refs, className, style }: {
  text: string; refs: ColoredRef[]; className?: string; style?: CSSProperties;
}) {
  const parts: ReactNode[] = [];
  let at = 0;
  for (const r of refs) {
    if (r.start > at) parts.push(<Fragment key={`t${at}`}>{text.slice(at, r.start)}</Fragment>);
    parts.push(
      <span key={`r${r.start}`} data-ref-color={r.color} style={{ color: r.color }}>
        {text.slice(r.start, r.end)}
      </span>,
    );
    at = r.end;
  }
  if (at < text.length) parts.push(<Fragment key={`t${at}`}>{text.slice(at)}</Fragment>);
  return (
    <div aria-hidden="true" data-testid="formula-overlay" className={className} style={style}>
      {parts}
    </div>
  );
}

/** Autocomplete list, signature tip or inline error under an editor. */
export function EditPopups({ store }: { store: CalcStore }) {
  const edit = useCalc(store, (s) => s.edit);
  if (!edit) return null;
  const completion = store.completion();
  const tip = completion ? null : store.signature();
  return (
    <div className="absolute left-0 top-full z-30 mt-0.5 flex flex-col items-start gap-0.5 text-xs" style={{ minWidth: 0 }}>
      {edit.error && (
        <div role="alert" data-testid="formula-error" className="whitespace-nowrap rounded border border-red-300 bg-red-50 px-2 py-1 text-red-800 shadow">
          {edit.error}
        </div>
      )}
      {completion && (
        <ul
          role="listbox"
          aria-label="Functions"
          data-testid="function-list"
          className="max-h-60 w-72 overflow-auto rounded border border-ui-border bg-ui-bg py-0.5 text-ui-fg shadow-lg"
          onMouseDown={(e) => e.preventDefault()}
        >
          {completion.items.map((f, i) => (
            <li
              key={f.name}
              role="option"
              aria-selected={i === completion.index}
              ref={i === completion.index ? (li) => li?.scrollIntoView?.({ block: "nearest" }) : undefined}
              className={`flex cursor-pointer items-baseline gap-2 px-2 py-0.5 ${i === completion.index ? "bg-ui-active" : "hover:bg-ui-hover"}`}
              onClick={() => {
                store.acceptCompletion(i);
                store.focusEditor();
              }}
            >
              <span className="font-mono font-medium">{f.name}</span>
              <span className="truncate text-ui-muted">{f.description}</span>
            </li>
          ))}
        </ul>
      )}
      {tip && (
        <div role="tooltip" data-testid="signature-tip" className="whitespace-nowrap rounded border border-ui-border bg-ui-panel px-2 py-0.5 font-mono text-ui-fg shadow">
          {tip.name}(
          {tip.args.map((a, i) => (
            <Fragment key={i}>
              {i > 0 && ", "}
              {i === tip.active ? <b>{a}</b> : a}
            </Fragment>
          ))}
          )
        </div>
      )}
    </div>
  );
}
