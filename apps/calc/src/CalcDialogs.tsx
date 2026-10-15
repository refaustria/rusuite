// The dialogs Calc opens through the store (`store.openDialog`): Format
// Cells (number format, Ctrl+1), Find & Replace (Ctrl+F / Ctrl+H) and the
// row height / column width prompts.

import { useEffect, useRef, useState } from "react";
import { Dialog, PromptDialog } from "@rusuite/ui-shared";
import {
  buildCode, CATEGORIES, DATE_CODES, parseCode, previewValue, SYMBOLS, TIME_CODES, type CurrencySymbol, type FormatChoice,
} from "./numberFormat";
import type { FindOptions } from "./state/find";
import { useCalc, type CalcStore } from "./state/store";

const BTN = "h-7 rounded border border-ui-border bg-ui-bg px-3 text-sm hover:bg-ui-hover disabled:opacity-40";
const FIELD = "h-7 rounded border border-ui-border bg-ui-bg px-2 text-sm text-ui-fg";

function NumberFormatDialog({ store }: { store: CalcStore }) {
  const [choice, setChoice] = useState<FormatChoice>(() => parseCode(store.activeStyle().numberFormat));
  const [preview, setPreview] = useState("");
  const code = buildCode(choice);
  const cell = store.activeCell();
  const value = previewValue(cell);
  useEffect(() => {
    let live = true;
    if (value === null) {
      setPreview(cell?.display ?? "");
      return;
    }
    store.formatPreview(value, code).then(
      (t) => live && setPreview(t),
      () => live && setPreview("—"),
    );
    return () => {
      live = false;
    };
  }, [store, code, value, cell?.display]);
  const set = (p: Partial<FormatChoice>) => setChoice((c) => ({ ...c, ...p }));
  const close = () => {
    store.closeDialog();
    store.focusGrid();
  };
  const c = choice.category;
  return (
    <Dialog open title="Format cells" onClose={close}>
      <form
        className="flex w-[30rem] flex-col gap-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          void store.applyStyle({ numberFormat: code });
          close();
        }}
      >
        <div className="flex gap-3">
          <div role="listbox" aria-label="Category" className="flex w-32 flex-col rounded border border-ui-border bg-ui-bg py-1">
            {CATEGORIES.map((k) => (
              <button
                key={k.id}
                type="button"
                role="option"
                aria-selected={c === k.id}
                className={`px-2 py-0.5 text-left ${c === k.id ? "bg-ui-active font-medium" : "hover:bg-ui-hover"}`}
                onClick={() => set({ category: k.id, custom: k.id === "custom" ? code : choice.custom })}
              >
                {k.label}
              </button>
            ))}
          </div>
          <div className="flex flex-1 flex-col gap-2">
            <div className="rounded border border-ui-border bg-ui-bg px-2 py-1">
              <div className="text-xs text-ui-muted">Sample</div>
              <div data-testid="format-preview" className="min-h-5 font-mono">
                {preview}
              </div>
            </div>
            {(c === "number" || c === "currency" || c === "percentage") && (
              <label className="flex items-center gap-2">
                Decimal places
                <input
                  type="number"
                  min={0}
                  max={30}
                  className={`${FIELD} w-16`}
                  value={choice.decimals}
                  onChange={(e) => set({ decimals: Math.max(0, Math.min(30, Number(e.target.value) || 0)) })}
                />
              </label>
            )}
            {c === "number" && (
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={choice.thousands} onChange={(e) => set({ thousands: e.target.checked })} />
                Use 1000 separator (,)
              </label>
            )}
            {c === "currency" && (
              <label className="flex items-center gap-2">
                Symbol
                <select className={FIELD} value={choice.symbol} onChange={(e) => set({ symbol: e.target.value as CurrencySymbol })}>
                  {SYMBOLS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {(c === "date" || c === "time") && (
              <label className="flex flex-col gap-1">
                Type
                <select
                  className={FIELD}
                  size={5}
                  value={c === "date" ? choice.date : choice.time}
                  onChange={(e) => set(c === "date" ? { date: e.target.value } : { time: e.target.value })}
                >
                  {(c === "date" ? DATE_CODES : TIME_CODES).map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {c === "custom" && (
              <label className="flex flex-col gap-1">
                Format code
                <input className={FIELD} aria-label="Format code" value={choice.custom} onChange={(e) => set({ custom: e.target.value })} />
              </label>
            )}
            {c === "general" && <p className="text-xs text-ui-muted">General cells have no specific number format.</p>}
            {c === "text" && <p className="text-xs text-ui-muted">Text cells show the content exactly as entered.</p>}
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className={BTN} onClick={close}>
            Cancel
          </button>
          <button type="submit" className={BTN}>
            OK
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** Non-modal Find & Replace panel (the grid stays usable while it is open). */
function FindPanel({ store, replace }: { store: CalcStore; replace: boolean }) {
  const [opts, setOpts] = useState<FindOptions>({ query: "", matchCase: false, wholeCell: false, allSheets: false });
  const [replacement, setReplacement] = useState("");
  const [showReplace, setShowReplace] = useState(replace);
  const [status, setStatus] = useState("");
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => setShowReplace(replace), [replace]);
  useEffect(() => first.current?.focus(), [replace]);
  const close = () => {
    store.closeDialog();
    store.focusGrid();
  };
  const set = (p: Partial<FindOptions>) => {
    setOpts((o) => ({ ...o, ...p }));
    setStatus("");
  };
  const report = (hit: unknown) => setStatus(hit ? "" : "No match found.");
  const empty = opts.query === "";
  return (
    <div
      role="dialog"
      aria-label={showReplace ? "Find and replace" : "Find"}
      className="fixed right-4 top-24 z-40 w-96 rounded-lg border border-ui-border bg-ui-panel p-3 text-sm text-ui-fg shadow-xl"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          close();
        }
      }}
    >
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!empty) void store.findNext(opts, false).then(report);
        }}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">{showReplace ? "Find and replace" : "Find"}</h2>
          <button type="button" className="text-xs underline" onClick={() => setShowReplace((r) => !r)}>
            {showReplace ? "Hide replace" : "Replace…"}
          </button>
        </div>
        <label className="flex items-center gap-2">
          <span className="w-24">Find what</span>
          <input ref={first} className={`${FIELD} flex-1`} value={opts.query} onChange={(e) => set({ query: e.target.value })} />
        </label>
        {showReplace && (
          <label className="flex items-center gap-2">
            <span className="w-24">Replace with</span>
            <input className={`${FIELD} flex-1`} value={replacement} onChange={(e) => setReplacement(e.target.value)} />
          </label>
        )}
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <label className="flex items-center gap-1">
            Within
            <select className={FIELD} value={opts.allSheets ? "book" : "sheet"} onChange={(e) => set({ allSheets: e.target.value === "book" })}>
              <option value="sheet">Sheet</option>
              <option value="book">Workbook</option>
            </select>
          </label>
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={opts.matchCase} onChange={(e) => set({ matchCase: e.target.checked })} />
            Match case
          </label>
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={opts.wholeCell} onChange={(e) => set({ wholeCell: e.target.checked })} />
            Match entire cell contents
          </label>
        </div>
        <div role="status" className="min-h-5 text-xs text-ui-muted">
          {status}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {showReplace && (
            <>
              <button
                type="button"
                className={BTN}
                disabled={empty}
                onClick={() => void store.replaceAll(opts, replacement).then((n) => setStatus(`Replaced ${n} cell${n === 1 ? "" : "s"}.`))}
              >
                Replace all
              </button>
              <button type="button" className={BTN} disabled={empty} onClick={() => void store.replaceNext(opts, replacement).then(report)}>
                Replace
              </button>
            </>
          )}
          <button type="button" className={BTN} disabled={empty} onClick={() => void store.findNext(opts, true).then(report)}>
            Find previous
          </button>
          <button type="submit" className={BTN} disabled={empty}>
            Find next
          </button>
          <button type="button" className={BTN} onClick={close}>
            Close
          </button>
        </div>
      </form>
    </div>
  );
}

export function CalcDialogs({ store }: { store: CalcStore }) {
  const dialog = useCalc(store, (s) => s.dialog);
  const close = () => {
    store.closeDialog();
    store.focusGrid();
  };
  if (!dialog) return null;
  switch (dialog.kind) {
    case "numberFormat":
      return <NumberFormatDialog store={store} />;
    case "find":
      return <FindPanel store={store} replace={dialog.replace} />;
    case "rowHeight":
    case "colWidth": {
      const rows = dialog.kind === "rowHeight";
      return (
        <PromptDialog
          open
          title={rows ? "Row height" : "Column width"}
          label={rows ? "Row height (points)" : "Column width (characters)"}
          initial={String(store.currentSize(rows ? "rows" : "cols"))}
          onClose={close}
          onSubmit={(v) => {
            const n = Number(v.replace(",", "."));
            if (!Number.isFinite(n) || n < 0 || n > (rows ? 409 : 255)) {
              store.pushError(new Error(rows ? "Row height must be between 0 and 409" : "Column width must be between 0 and 255"));
              return;
            }
            void store.setSize(rows ? "rows" : "cols", n);
            close();
          }}
        />
      );
    }
  }
}
