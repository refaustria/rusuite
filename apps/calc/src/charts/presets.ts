// Chart types, layouts, colours and styles: the shared presets
// (packages/ui-shared/src/chart/ui/presets.ts) with Calc's catalog keys.

import * as shared from "../../../../packages/ui-shared/src/chart/ui/presets";
import type { Chart } from "../../../../packages/ui-shared/src/chart/model";

export * from "../../../../packages/ui-shared/src/chart/ui/presets";

export const CHART_PRESETS = shared.prefixLabels(shared.CHART_PRESETS, "calc");
export const INSERT_GALLERIES = shared.prefixLabels(shared.INSERT_GALLERIES, "calc");
export const TYPE_GROUPS = shared.prefixLabels(shared.TYPE_GROUPS, "calc");
export const COLOR_VARIANTS = shared.prefixLabels(shared.COLOR_VARIANTS, "calc");
export const presetById = (id: string) => CHART_PRESETS.find((p) => p.id === id);
export const presetsOf = (...groups: shared.ChartGroup[]) => CHART_PRESETS.filter((p) => groups.includes(p.group));
export const presetOf = (chart: Chart): shared.ChartPreset | null => {
  const p = shared.presetOf(chart);
  return p ? (presetById(p.id) ?? null) : null;
};
