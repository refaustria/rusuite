// Chart types, layouts and colours with Calc's catalog keys: the shared presets
// (`@rusuite/ui-shared`, packages/ui-shared/src/chart/ui/presets.ts – the one copy, P9-X2) with
// their labels below the `calc.` prefix (`chart.t.colClustered` → `calc.chart.t.colClustered`).
// Everything else of the chart UI helpers is imported from `@rusuite/ui-shared` directly.

import {
  CHART_PRESETS as SHARED_PRESETS,
  COLOR_VARIANTS as SHARED_COLORS,
  INSERT_GALLERIES as SHARED_GALLERIES,
  TYPE_GROUPS as SHARED_GROUPS,
  prefixLabels,
  presetOf as sharedPresetOf,
  type ChartGroup,
  type ChartModel,
  type ChartPreset,
} from "@rusuite/ui-shared";

export const CHART_PRESETS = prefixLabels(SHARED_PRESETS, "calc");
export const INSERT_GALLERIES = prefixLabels(SHARED_GALLERIES, "calc");
export const TYPE_GROUPS = prefixLabels(SHARED_GROUPS, "calc");
export const COLOR_VARIANTS = prefixLabels(SHARED_COLORS, "calc");
export const presetById = (id: string) => CHART_PRESETS.find((p) => p.id === id);
export const presetsOf = (...groups: ChartGroup[]) => CHART_PRESETS.filter((p) => groups.includes(p.group));
export const presetOf = (chart: ChartModel): ChartPreset | null => {
  const p = sharedPresetOf(chart);
  return p ? (presetById(p.id) ?? null) : null;
};
