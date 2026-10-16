// The right-click menu of a chart (Excel's chart area menu, flat).

import type { ContextMenuItem } from "@rusuite/ui-shared";
import { t } from "../i18n";
import type { CalcStore } from "../state/store";

/** Cut / Copy / Paste, Edit Data…, Change Chart Type…, Move Chart…, Format…, Delete. */
export function chartMenu(store: CalcStore): ContextMenuItem[] {
  const c = store.charts;
  const unsupported = c.selectedChart()?.chart.kind.type === "unsupported";
  const copy = () => {
    const text = c.copy();
    void navigator.clipboard?.writeText(text).catch(() => undefined);
  };
  return [
    { id: "cut", label: t("cmd.cut"), shortcut: "Ctrl+X", onSelect: () => {
      copy();
      void c.remove();
    } },
    { id: "copy", label: t("cmd.copy"), shortcut: "Ctrl+C", onSelect: copy },
    { id: "paste", label: t("cmd.paste"), shortcut: "Ctrl+V", disabled: !c.hasClip(), onSelect: () => void c.paste() },
    { separator: true },
    { id: "edit-data", label: t("calc.chart.selectDataDots"), disabled: unsupported, onSelect: () => store.openDialog({ kind: "selectData" }) },
    { id: "change-type", label: t("calc.chart.changeTypeDots"), disabled: unsupported, onSelect: () => store.openDialog({ kind: "changeChartType" }) },
    { id: "move", label: t("calc.chart.moveDots"), onSelect: () => store.openDialog({ kind: "moveChart" }) },
    { separator: true },
    { id: "format", label: t("calc.chart.formatDots"), disabled: unsupported, onSelect: () => {
      c.pane = true;
      store.notify();
    } },
    { id: "delete", label: t("cmd.delete"), shortcut: "Del", onSelect: () => void c.remove() },
  ];
}
