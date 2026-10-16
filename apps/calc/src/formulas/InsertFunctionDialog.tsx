// Insert Function (Shift+F3, the formula bar's fx, P8-23): search, a
// category list, the functions with their signature and description
// (the argument help); OK inserts `NAME(` at the caret of the edit (or
// starts a formula in the active cell).

import { useState } from "react";
import { Dialog } from "@rusuite/ui-shared";
import { FUNCTIONS, searchFunctions, signatureArgs, type FunctionInfo } from "../formula/functions";
import { useT } from "../i18n";
import type { CalcStore } from "../state/store";

const BTN = "h-7 rounded border border-ui-border bg-ui-bg px-3 text-sm hover:bg-ui-hover disabled:opacity-40";
const FIELD = "h-7 rounded border border-ui-border bg-ui-bg px-2 text-sm text-ui-fg";

/** The categories of the dialog and the ribbon, in Excel's order. */
export const FUNCTION_CATEGORIES = ["recent", "all", "financial", "datetime", "math", "statistical", "lookup", "text", "logical", "info"] as const;
export type FunctionCategoryId = (typeof FUNCTION_CATEGORIES)[number];

/** The functions a category lists (`recent`: the recently used names). */
export function categoryFunctions(category: string, recent: readonly string[]): FunctionInfo[] {
  if (category === "recent") return recent.map((n) => FUNCTIONS.find((f) => f.name === n)).filter((f): f is FunctionInfo => !!f);
  if (category === "all") return FUNCTIONS;
  return FUNCTIONS.filter((f) => f.category === category);
}

export function InsertFunctionDialog({ store, category: initial }: { store: CalcStore; category?: string }) {
  const t = useT();
  const recent = store.recentFunctions();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>(initial ?? "recent");
  const list = query.trim() ? searchFunctions(query, category === "recent" ? "all" : category) : categoryFunctions(category, recent);
  const [picked, setPicked] = useState<string | null>(null);
  const current = list.find((f) => f.name === picked) ?? list[0] ?? null;
  const close = () => {
    store.closeDialog();
    if (!store.getState().edit) store.focusGrid();
  };
  const insert = (f: FunctionInfo | null) => {
    if (!f) return;
    store.closeDialog();
    store.insertIntoFormula(f.name, true);
  };
  return (
    <Dialog open title={t("calc.fn.title")} onClose={close}>
      <form
        className="flex w-[30rem] flex-col gap-2 text-sm"
        data-testid="insert-function"
        onSubmit={(e) => {
          e.preventDefault();
          insert(current);
        }}
      >
        <label className="flex flex-col gap-0.5">
          <span className="text-xs">{t("calc.fn.search")}</span>
          <input
            className={FIELD}
            aria-label={t("calc.fn.search")}
            placeholder={t("calc.fn.searchHint")}
            value={query}
            autoFocus
            onChange={(e) => {
              setQuery(e.target.value);
              setPicked(null);
            }}
          />
        </label>
        <label className="flex items-center gap-2">
          <span className="text-xs">{t("calc.fn.category")}</span>
          <select className={`${FIELD} flex-1`} aria-label={t("calc.fn.category")} value={category} onChange={(e) => { setCategory(e.target.value); setPicked(null); }}>
            {FUNCTION_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(`calc.fn.cat.${c}`)}
              </option>
            ))}
          </select>
        </label>
        <div role="listbox" aria-label={t("calc.fn.list")} className="flex h-44 flex-col overflow-auto rounded border border-ui-border bg-ui-bg py-1">
          {list.map((f) => (
            <button
              key={f.name}
              type="button"
              role="option"
              aria-selected={current?.name === f.name}
              className={`px-2 py-0.5 text-left font-mono ${current?.name === f.name ? "bg-ui-active" : "hover:bg-ui-hover"}`}
              onClick={() => setPicked(f.name)}
              onDoubleClick={() => insert(f)}
            >
              {f.name}
            </button>
          ))}
          {list.length === 0 && <span className="px-2 text-ui-muted">{t("calc.fn.none")}</span>}
        </div>
        {current && (
          <div className="rounded border border-ui-border bg-ui-bg px-2 py-1" data-testid="function-help">
            <div className="font-mono text-xs font-semibold">{current.signature}</div>
            <div className="text-xs">{current.description}</div>
            <ul className="mt-1 list-disc pl-4 text-xs text-ui-muted">
              {signatureArgs(current.signature).map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className={BTN} onClick={close}>
            {t("common.cancel")}
          </button>
          <button type="submit" className={BTN} disabled={!current}>
            {t("common.ok")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
