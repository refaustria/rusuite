// Formulas › Watch Window (P9-C4): watched cells with their live values
// and formulas; Add Watch takes the selection, Delete Watch the picked row,
// a double click goes to the cell.

import { useState } from "react";
import { cellAddress } from "../grid/address";
import { cellSelection } from "../grid/Selection";
import { useT } from "../i18n";
import { useCalc, type CalcStore } from "../state/store";

const BTN = "h-7 rounded border border-ui-border bg-ui-bg px-2 text-sm hover:bg-ui-hover disabled:opacity-40";

export function WatchWindow({ store }: { store: CalcStore }) {
  const t = useT();
  useCalc(store, (s) => s.version);
  const [picked, setPicked] = useState<number | null>(null);
  const a = store.audit;
  if (!a.watchOpen) return null;
  const book = store.getState().name ?? t("calc.defaultName");
  const close = () => {
    a.toggleWatchWindow(false);
    store.focusGrid();
  };
  return (
    <aside
      className="flex w-[30rem] shrink-0 flex-col gap-2 overflow-hidden border-l border-ui-border bg-ui-panel p-3 text-ui-fg"
      aria-label={t("calc.watch.title")}
      data-testid="watch-window"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          close();
        }
      }}
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">{t("calc.watch.title")}</h2>
        <button type="button" className="h-7 rounded px-2 text-sm hover:bg-ui-hover" aria-label={t("common.close")} onClick={close}>
          ✕
        </button>
      </div>
      <div className="flex gap-2">
        <button type="button" className={BTN} onClick={() => a.addWatches()}>
          {t("calc.watch.add")}
        </button>
        <button
          type="button"
          className={BTN}
          disabled={picked === null}
          onClick={() => {
            if (picked !== null) a.removeWatch(picked);
            setPicked(null);
          }}
        >
          {t("calc.watch.delete")}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto rounded border border-ui-border bg-ui-bg">
        <table className="w-full border-collapse text-left text-xs" aria-label={t("calc.watch.title")}>
          <thead className="sticky top-0 bg-ui-panel">
            <tr>
              <th className="px-2 py-1">{t("calc.watch.book")}</th>
              <th className="px-2 py-1">{t("calc.watch.sheet")}</th>
              <th className="px-2 py-1">{t("calc.watch.name")}</th>
              <th className="px-2 py-1">{t("calc.watch.cell")}</th>
              <th className="px-2 py-1">{t("calc.watch.value")}</th>
              <th className="px-2 py-1">{t("calc.watch.formula")}</th>
            </tr>
          </thead>
          <tbody>
            {a.watchItems.map((w, i) => (
              <tr
                key={`${w.sheet}:${w.row}:${w.col}`}
                data-testid="watch-row"
                aria-selected={picked === i}
                className={`cursor-default ${picked === i ? "bg-ui-active" : "hover:bg-ui-hover"}`}
                onClick={() => setPicked(i)}
                onDoubleClick={() => {
                  if (w.sheetName === undefined) return;
                  store.setActiveSheet(w.sheet);
                  store.select(cellSelection(w.row, w.col));
                  store.focusGrid();
                }}
              >
                <td className="max-w-24 truncate px-2 py-0.5">{book}</td>
                <td className="px-2 py-0.5">{w.sheetName ?? "#REF!"}</td>
                <td className="px-2 py-0.5 font-mono">{w.name ?? ""}</td>
                <td className="px-2 py-0.5 font-mono">{cellAddress(w.row, w.col)}</td>
                <td className="px-2 py-0.5 font-mono" data-testid="watch-value">
                  {w.value}
                </td>
                <td className="max-w-40 truncate px-2 py-0.5 font-mono" title={w.formula ?? ""}>
                  {w.formula ?? ""}
                </td>
              </tr>
            ))}
            {a.watchItems.length === 0 && (
              <tr>
                <td colSpan={6} className="px-2 py-2 text-ui-muted">
                  {t("calc.watch.none")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </aside>
  );
}
