// The yellow info bar over a sheet whose pivot tables are stale (their
// source changed since the last refresh, P8-33): "Data changed – Refresh".

import { useT } from "../i18n";
import { useCalc, type CalcStore } from "../state/store";

export function PivotStaleBar({ store }: { store: CalcStore }) {
  const t = useT();
  useCalc(store, (s) => s.version);
  useCalc(store, (s) => s.activeSheet);
  const stale = store.pivots.staleHere();
  if (stale.length === 0) return null;
  return (
    <div role="status" data-testid="pivot-stale-bar" className="flex items-center gap-3 border-b border-amber-300 bg-amber-100 px-3 py-1 text-sm text-amber-950">
      <span className="font-medium">{t("calc.pivot.staleTitle")}</span>
      <span>{t("calc.pivot.staleText", { count: stale.length })}</span>
      <button
        type="button"
        className="h-7 rounded border border-amber-400 bg-white px-3 hover:bg-amber-50"
        onClick={() => {
          void store.pivots.refreshStale();
          store.focusGrid();
        }}
      >
        {t("calc.pivot.refresh")}
      </button>
    </div>
  );
}
