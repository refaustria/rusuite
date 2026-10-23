// The status bar's Sum / Average / Count of the selection on the compact layout (P10-M3): one tappable chip, a tap
// shows the next statistic.

import { useState } from "react";
import { formatNumber } from "@rusuite/ui-shared";
import { useT } from "../i18n";
import { useCalc, type CalcStore } from "../state/store";
import { selectionStats, statKinds, statValue, type StatKind } from "./selectionStats";

export function StatChip({ store }: { store: CalcStore }) {
  const t = useT();
  const [kind, setKind] = useState<StatKind>("sum");
  const key = useCalc(store, (s) => {
    void s.version;
    const st = selectionStats(store.cache(s.activeSheet).cells, store.selectionAreas());
    return st && st.count > 0 ? `${st.count};${st.numbers};${st.sum}` : "";
  });
  if (!key) return null;
  const [count, numbers, sum] = key.split(";").map(Number) as [number, number, number];
  const stats = { count, numbers, sum };
  const kinds = statKinds(stats);
  const shown = kinds.includes(kind) ? kind : kinds[0]!;
  const value = formatNumber(statValue(stats, shown), { maximumFractionDigits: 10 });
  const label = shown === "sum" ? t("calc.stats.sum", { value }) : shown === "average" ? t("calc.stats.average", { value }) : t("calc.stats.count", { value });
  return (
    <button
      type="button"
      data-testid="stat-chip"
      data-stat={shown}
      aria-label={`${label}. ${t("calc.stats.next")}`}
      className="flex min-h-[44px] items-center rounded-full border border-ui-border bg-ui-bg px-3 text-[13px] text-ui-fg"
      onClick={() => setKind(kinds[(kinds.indexOf(shown) + 1) % kinds.length]!)}
    >
      {label}
    </button>
  );
}
