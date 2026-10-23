// The formula key row of the compact layout (P10-M3): while a cell is edited, a row of 44 px keys sits above the
// command bar (pinned to the visual viewport like the bar; while the on-screen keyboard is open it takes the bar's
// place, right above the keyboard): operators and separators, fx (the Insert Function dialog as a sheet), Ref mode
// (taps and drags on cells insert the reference at the caret, the handles extend it; ⇤ ⇥ move the caret by one
// token), ✕ cancel and ↵ commit. The keys never take the focus, so the on-screen keyboard stays as it is.

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { useCompact } from "@rusuite/ui-shared";
import { tokenize } from "../formula/tokenize";
import { commitAndMove } from "../grid/editorKit";
import { useT } from "../i18n";
import { useCalc, type CalcStore } from "../state/store";
import { tokenStep } from "./gestures";

/** The characters of the key row, in order. */
export const FORMULA_KEYS = ["=", "+", "-", "*", "/", "(", ")", ":", ";", ",", "$", "%"] as const;

/** Inserts `text` at the edit's caret (replacing a selection). */
export function insertAtCaret(store: CalcStore, text: string): void {
  const e = store.getState().edit;
  if (!e) return;
  const s = Math.min(e.selStart, e.selEnd), end = Math.max(e.selStart, e.selEnd);
  store.setEditText(e.text.slice(0, s) + text + e.text.slice(end), s + text.length);
}

/** Moves the edit's caret one token left or right. */
export function stepCaret(store: CalcStore, dir: -1 | 1): void {
  const e = store.getState().edit;
  if (!e) return;
  const at = tokenStep(tokenize(e.text).tokens, e.text.length, e.selEnd, dir);
  store.setEditCaret(at, at);
}

function Key({ label, testId, onPress, pressed, wide, children }: {
  label: string; testId: string; onPress: () => void; pressed?: boolean; wide?: boolean; children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      data-testid={testId}
      className={`flex h-11 shrink-0 items-center justify-center rounded-md border font-mono text-base ${wide ? "min-w-[56px] px-2" : "min-w-[44px]"} ${
        pressed ? "border-[#1a73e8] bg-[#1a73e8] text-white" : "border-ui-border bg-ui-bg text-ui-fg active:bg-ui-active"
      }`}
      // The editor keeps the focus (and the on-screen keyboard stays as it is).
      onPointerDown={(e) => e.preventDefault()}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onPress}
    >
      {children}
    </button>
  );
}

export function FormulaKeys({ store }: { store: CalcStore }) {
  const t = useT();
  const compact = useCompact();
  const editing = useCalc(store, (s) => s.edit !== null);
  const refMode = useCalc(store, () => store.touchRef);
  const row = useRef<HTMLDivElement>(null);
  const shown = compact && editing;

  // `<html data-formula-keys>` while shown: the app leaves room for the row, the keyboard hides the command bar.
  useLayoutEffect(() => {
    if (!shown) return;
    const root = document.documentElement;
    root.setAttribute("data-formula-keys", "");
    const el = row.current;
    const set = () => root.style.setProperty("--rs-formula-keys-h", `${el?.offsetHeight ?? 0}px`);
    set();
    const ro = typeof ResizeObserver === "undefined" || !el ? null : new ResizeObserver(set);
    if (el) ro?.observe(el);
    return () => {
      ro?.disconnect();
      root.removeAttribute("data-formula-keys");
      root.style.removeProperty("--rs-formula-keys-h");
    };
  }, [shown]);

  if (!shown) return null;
  return (
    <div
      ref={row}
      role="toolbar"
      aria-label={t("calc.keys.label")}
      data-testid="formula-keys"
      className="rs-touch fixed inset-x-0 z-30 flex items-center gap-1 border-t border-ui-border bg-ui-panel px-1 py-1 pl-[max(4px,env(safe-area-inset-left))] pr-[max(4px,env(safe-area-inset-right))]"
      style={{ bottom: "calc(var(--rs-kb-inset, 0px) + var(--rs-command-bar-h, 0px))" }}
    >
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none]">
        <Key label={t("calc.keys.ref")} testId="key-ref" pressed={refMode} wide onPress={() => store.setTouchRef(!store.touchRef)}>
          {t("calc.keys.refShort")}
        </Key>
        {refMode && (
          <>
            <Key label={t("calc.keys.prevToken")} testId="key-prev" onPress={() => stepCaret(store, -1)}>
              ⇤
            </Key>
            <Key label={t("calc.keys.nextToken")} testId="key-next" onPress={() => stepCaret(store, 1)}>
              ⇥
            </Key>
          </>
        )}
        <Key label={t("calc.insertFunction")} testId="key-fx" onPress={() => store.openDialog({ kind: "insertFunction" })}>
          <span className="italic">fx</span>
        </Key>
        {FORMULA_KEYS.map((k) => (
          <Key key={k} label={k} testId={`key-${k}`} onPress={() => insertAtCaret(store, k)}>
            {k}
          </Key>
        ))}
      </div>
      <Key label={t("calc.keys.cancel")} testId="key-cancel" onPress={() => {
        store.cancelEdit();
        store.focusGrid();
      }}>
        ✕
      </Key>
      <Key label={t("calc.keys.commit")} testId="key-commit" wide onPress={() => commitAndMove(store, 1, 0)}>
        ↵
      </Key>
    </div>
  );
}
