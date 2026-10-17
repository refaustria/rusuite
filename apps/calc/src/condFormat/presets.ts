// Home › Conditional Formatting: Excel's quick rules (Highlight Cells
// Rules, Top/Bottom Rules), its highlight format presets and the Data
// Bars / Color Scales / Icon Sets galleries, as `CfRule` builders (pure).

import type { Color } from "@rusuite/ui-shared";
import type { CfKind } from "../generated/CfKind";
import type { CfRule } from "../generated/CfRule";
import type { DxfStyle } from "../generated/DxfStyle";
import type { IconSetKind } from "../generated/IconSetKind";
import type { Rect } from "../generated/Rect";
import type { TimePeriod } from "../generated/TimePeriod";
import { iconCount } from "../grid/cf";

export const rgb = (hex: string): Color => ({ kind: "rgb", value: hex });

/** The small dialogs of Highlight Cells Rules and Top/Bottom Rules. */
export type QuickRuleKind =
  | "greaterThan" | "lessThan" | "between" | "equalTo" | "textContains" | "dateOccurring" | "duplicateValues"
  | "top10" | "top10Percent" | "bottom10" | "bottom10Percent" | "aboveAverage" | "belowAverage";

export const HIGHLIGHT_RULES: QuickRuleKind[] = ["greaterThan", "lessThan", "between", "equalTo", "textContains", "dateOccurring", "duplicateValues"];
export const TOP_BOTTOM_RULES: QuickRuleKind[] = ["top10", "top10Percent", "bottom10", "bottom10Percent", "aboveAverage", "belowAverage"];

/** How many values a quick dialog asks for. */
export function quickValueCount(kind: QuickRuleKind): number {
  if (kind === "between") return 2;
  if (kind === "duplicateValues" || kind === "dateOccurring" || kind === "aboveAverage" || kind === "belowAverage") return 0;
  return 1;
}

/** The ranked rules ask for a count (or percent) instead of a value. */
export const isRankRule = (kind: QuickRuleKind): boolean =>
  kind === "top10" || kind === "top10Percent" || kind === "bottom10" || kind === "bottom10Percent";

/** Excel's highlight presets ("Light Red Fill with Dark Red Text" …); labels: `calc.cf.preset.<id>`. */
export const HIGHLIGHT_PRESETS: { id: string; dxf: DxfStyle }[] = [
  { id: "lightRedDarkRed", dxf: { fill: rgb("FFC7CE"), fontColor: rgb("9C0006") } },
  { id: "yellowDarkYellow", dxf: { fill: rgb("FFEB9C"), fontColor: rgb("9C5700") } },
  { id: "greenDarkGreen", dxf: { fill: rgb("C6EFCE"), fontColor: rgb("006100") } },
  { id: "lightRed", dxf: { fill: rgb("FFC7CE") } },
  { id: "redText", dxf: { fontColor: rgb("9C0006") } },
  {
    id: "redBorder",
    dxf: {
      borders: {
        left: { style: "thin", color: rgb("9C0006") }, right: { style: "thin", color: rgb("9C0006") },
        top: { style: "thin", color: rgb("9C0006") }, bottom: { style: "thin", color: rgb("9C0006") },
      },
    },
  },
];

/**
 * A typed criterion as a rule formula: `=…` is a formula (the `=` is
 * dropped), a number stays a number, anything else becomes a text
 * literal (Excel turns `abc` into `="abc"`).
 */
export function valueFormula(input: string): string {
  const s = input.trim();
  if (s.startsWith("=")) return s.slice(1).trim();
  if (s !== "" && Number.isFinite(Number(s))) return s;
  if (/^(TRUE|FALSE)$/i.test(s)) return s.toUpperCase();
  return `"${s.replace(/"/g, '""')}"`;
}

/** Inverse of `valueFormula` for the dialogs: a text literal shows unquoted, a formula with `=`. */
export function formulaInput(formula: string): string {
  const m = /^"((?:[^"]|"")*)"$/.exec(formula);
  if (m) return m[1]!.replace(/""/g, '"');
  if (formula === "" || Number.isFinite(Number(formula)) || /^(TRUE|FALSE)$/i.test(formula)) return formula;
  return `=${formula}`;
}

const rule = (ranges: Rect[], kind: CfKind, dxf?: DxfStyle): CfRule => ({
  id: 0, ranges: ranges.map((r) => ({ ...r })), priority: 1, stopIfTrue: false, kind, ...(dxf ? { dxf } : {}),
});

/**
 * The rule of a quick dialog: `values` as typed (one, two for Between,
 * the count for Top/Bottom), `duplicate` for Duplicate Values (else
 * Unique).
 */
export function quickRule(kind: QuickRuleKind, values: string[], dxf: DxfStyle, ranges: Rect[], duplicate = true): CfRule {
  const v = (i: number) => valueFormula(values[i] ?? "");
  const rank = Math.max(1, Math.round(Number(values[0] ?? "10")) || 10);
  switch (kind) {
    case "greaterThan":
      return rule(ranges, { type: "cellIs", op: "greaterThan", formulas: [v(0)] }, dxf);
    case "lessThan":
      return rule(ranges, { type: "cellIs", op: "lessThan", formulas: [v(0)] }, dxf);
    case "between":
      return rule(ranges, { type: "cellIs", op: "between", formulas: [v(0), v(1)] }, dxf);
    case "equalTo":
      return rule(ranges, { type: "cellIs", op: "equal", formulas: [v(0)] }, dxf);
    case "textContains":
      return rule(ranges, { type: "containsText", text: (values[0] ?? "").trim() }, dxf);
    case "dateOccurring":
      return rule(ranges, { type: "timePeriod", period: (values[0] || "yesterday") as TimePeriod }, dxf);
    case "duplicateValues":
      return rule(ranges, { type: duplicate ? "duplicateValues" : "uniqueValues" }, dxf);
    case "top10":
    case "top10Percent":
    case "bottom10":
    case "bottom10Percent": {
      const percent = kind.endsWith("Percent");
      return rule(ranges, { type: "top10", rank: percent ? Math.min(100, rank) : rank, percent, bottom: kind.startsWith("bottom") }, dxf);
    }
    case "aboveAverage":
    case "belowAverage":
      return rule(ranges, { type: "aboveAverage", above: kind === "aboveAverage", equal: false }, dxf);
  }
}

/** Data Bars gallery (Excel's gradient fills); labels: `calc.cf.color.<id>`. */
export const DATA_BARS: { id: string; color: string }[] = [
  { id: "blue", color: "638EC6" },
  { id: "green", color: "63C384" },
  { id: "red", color: "FF555A" },
  { id: "orange", color: "FFB628" },
  { id: "lightBlue", color: "008AEF" },
  { id: "purple", color: "D6007B" },
];

/**
 * A gallery data bar as Excel 2010 makes it: automatic bounds and axis,
 * bars from 0 % to 100 % of the cell, red negative bars; `solid`: the
 * Solid Fill gallery (no gradient, a border in the bar colour).
 */
export function dataBarRule(color: string, ranges: Rect[], solid = false): CfRule {
  const kind: CfKind = { type: "dataBar", color: rgb(color), min: { type: "autoMin" }, max: { type: "autoMax" }, showValue: true, minLength: 0, maxLength: 100 };
  if (solid) Object.assign(kind, { gradient: false });
  else Object.assign(kind, { border: rgb(color), negativeBorder: rgb("FF0000") });
  return rule(ranges, kind);
}

/**
 * Color Scales gallery: Excel's twelve scales, named highest value first
 * ("Green - Yellow - Red": green on top); `colors` lowest value first.
 * Labels: `calc.cf.scale.<id>`.
 */
export const COLOR_SCALES: { id: string; colors: string[] }[] = [
  { id: "gyr", colors: ["F8696B", "FFEB84", "63BE7B"] },
  { id: "ryg", colors: ["63BE7B", "FFEB84", "F8696B"] },
  { id: "gwr", colors: ["F8696B", "FCFCFF", "63BE7B"] },
  { id: "rwg", colors: ["63BE7B", "FCFCFF", "F8696B"] },
  { id: "bwr", colors: ["F8696B", "FCFCFF", "5A8AC6"] },
  { id: "rwb", colors: ["5A8AC6", "FCFCFF", "F8696B"] },
  { id: "wr", colors: ["F8696B", "FCFCFF"] },
  { id: "rw", colors: ["FCFCFF", "F8696B"] },
  { id: "gw", colors: ["FCFCFF", "63BE7B"] },
  { id: "wg", colors: ["63BE7B", "FCFCFF"] },
  { id: "gy", colors: ["FFEF9C", "63BE7B"] },
  { id: "yg", colors: ["63BE7B", "FFEF9C"] },
];

/** A 2- or 3-colour scale: lowest value, (50th percentile,) highest value. */
export function colorScaleRule(colors: string[], ranges: Rect[]): CfRule {
  const values = colors.length === 3
    ? [{ type: "min" as const }, { type: "percentile" as const, value: "50" }, { type: "max" as const }]
    : [{ type: "min" as const }, { type: "max" as const }];
  return rule(ranges, { type: "colorScale", points: colors.map((c, i) => ({ value: values[i]!, color: rgb(c) })) });
}

/** Icon Sets gallery groups (Excel's order); labels: `calc.cf.iconGroup.<id>` and `calc.cf.icons.<set>`. */
export const ICON_SET_GROUPS: { id: string; sets: IconSetKind[] }[] = [
  { id: "directional", sets: ["3Arrows", "3ArrowsGray", "4Arrows", "4ArrowsGray", "5Arrows", "5ArrowsGray"] },
  { id: "shapes", sets: ["3TrafficLights1", "3TrafficLights2", "3Signs", "4TrafficLights", "4RedToBlack"] },
  { id: "indicators", sets: ["3Symbols", "3Symbols2", "3Flags"] },
  { id: "ratings", sets: ["4Rating", "5Rating", "5Quarters"] },
];

/** An icon set with Excel's default thresholds: equal percent steps (3 icons: 0, 33, 67). */
export function iconSetRule(set: IconSetKind, ranges: Rect[]): CfRule {
  const n = iconCount(set);
  const thresholds = Array.from({ length: n }, (_, i) => ({ type: "percent" as const, value: String(Math.round((100 * i) / n)) }));
  return rule(ranges, { type: "iconSet", set, thresholds, reverse: false, showValue: true });
}
