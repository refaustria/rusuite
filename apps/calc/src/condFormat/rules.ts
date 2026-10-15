// The New / Edit Formatting Rule dialog as a plain form model, the rule
// descriptions and "applies to" ranges of the Rules Manager, and the
// commands its OK sends (pure).

import type { Color } from "@rusuite/ui-shared";
import type { CalcCommand } from "../generated/CalcCommand";
import type { CfKind } from "../generated/CfKind";
import type { CfRule } from "../generated/CfRule";
import type { CfValue } from "../generated/CfValue";
import type { CompareOp } from "../generated/CompareOp";
import type { DxfStyle } from "../generated/DxfStyle";
import type { IconSetKind } from "../generated/IconSetKind";
import type { Rect } from "../generated/Rect";
import { colName } from "../grid/address";
import { iconCount } from "../grid/cf";
import { colorCss } from "../grid/style";
import { lettersToCol, MAX_COL, MAX_ROW } from "../formula/refs";
import { formulaInput, rgb, valueFormula } from "./presets";

/** The rule types of Excel's "Select a Rule Type" list, in its order. */
export const RULE_TYPES = ["values", "contains", "topBottom", "average", "uniqueDup", "formula"] as const;
export type RuleType = (typeof RULE_TYPES)[number];

export type ValueStyle = "scale2" | "scale3" | "dataBar" | "iconSet";
export type ContainsWhat = "cellValue" | "specificText" | "blanks" | "noBlanks" | "errors" | "noErrors";
export type TextOp = "containing" | "notContaining" | "beginsWith" | "endsWith";
export type AverageOp = "above" | "below" | "equalAbove" | "equalBelow";

export const COMPARE_OPS: CompareOp[] = ["between", "notBetween", "equal", "notEqual", "greaterThan", "lessThan", "greaterThanOrEqual", "lessThanOrEqual"];
export const needsTwo = (op: CompareOp): boolean => op === "between" || op === "notBetween";

/** A threshold in the dialog: its type and the value as typed (`min`/`max` have none). */
export interface Threshold {
  type: CfValue["type"];
  value: string;
}

export interface RuleForm {
  type: RuleType;
  /** "Format all cells based on their values". */
  style: ValueStyle;
  /** Colour-scale points (lowest, midpoint, highest); colours as RRGGBB. */
  points: (Threshold & { color: string })[];
  barColor: string;
  barMin: Threshold;
  barMax: Threshold;
  barOnly: boolean;
  iconSet: IconSetKind;
  /** One per icon, lowest first (the first is not editable: everything below the second). */
  icons: Threshold[];
  iconReverse: boolean;
  iconOnly: boolean;
  /** "Format only cells that contain". */
  containsWhat: ContainsWhat;
  op: CompareOp;
  v1: string;
  v2: string;
  textOp: TextOp;
  text: string;
  /** "Format only top or bottom ranked values". */
  bottom: boolean;
  rank: string;
  percent: boolean;
  average: AverageOp;
  /** "Format only unique or duplicate values": `true` = unique. */
  unique: boolean;
  formula: string;
  dxf: DxfStyle;
  /** Kept from an edited rule. */
  id: number;
  priority: number;
  stopIfTrue: boolean;
  ranges: Rect[];
}

const hexOf = (c: Color, fallback: string) =>
  (colorCss(c) ?? `#${fallback}`).replace(/^#/, "").toUpperCase();

const threshold = (v: CfValue): Threshold => ({ type: v.type, value: "value" in v ? v.value : "" });

/** The default thresholds of an icon set (equal percent steps). */
export function defaultIcons(set: IconSetKind): Threshold[] {
  const n = iconCount(set);
  return Array.from({ length: n }, (_, i) => ({ type: "percent", value: String(Math.round((100 * i) / n)) }));
}

/** Excel's defaults of a new rule ("Format all cells based on their values", 2-colour scale). */
export function newRuleForm(ranges: Rect[]): RuleForm {
  return {
    type: "values",
    style: "scale2",
    points: [
      { type: "min", value: "", color: "F8696B" },
      { type: "percentile", value: "50", color: "FFEB84" },
      { type: "max", value: "", color: "63BE7B" },
    ],
    barColor: "638EC6",
    barMin: { type: "min", value: "" },
    barMax: { type: "max", value: "" },
    barOnly: false,
    iconSet: "3TrafficLights1",
    icons: defaultIcons("3TrafficLights1"),
    iconReverse: false,
    iconOnly: false,
    containsWhat: "cellValue",
    op: "between",
    v1: "",
    v2: "",
    textOp: "containing",
    text: "",
    bottom: false,
    rank: "10",
    percent: false,
    average: "above",
    unique: false,
    formula: "",
    dxf: {},
    id: 0,
    priority: 1,
    stopIfTrue: false,
    ranges: ranges.map((r) => ({ ...r })),
  };
}

/** The dialog's form for an existing rule (Edit Rule…). */
export function formFromRule(rule: CfRule): RuleForm {
  const f = { ...newRuleForm(rule.ranges), id: rule.id, priority: rule.priority, stopIfTrue: rule.stopIfTrue, dxf: { ...rule.dxf } };
  const k = rule.kind;
  switch (k.type) {
    case "colorScale": {
      f.type = "values";
      f.style = k.points.length === 3 ? "scale3" : "scale2";
      const pts = k.points.map((p) => ({ ...threshold(p.value), color: hexOf(p.color, "FFFFFF") }));
      f.points = pts.length === 3 ? pts : [pts[0]!, f.points[1]!, pts[1]!];
      break;
    }
    case "dataBar":
      Object.assign(f, { type: "values", style: "dataBar", barColor: hexOf(k.color, "638EC6"), barMin: threshold(k.min), barMax: threshold(k.max), barOnly: !k.showValue });
      break;
    case "iconSet":
      Object.assign(f, { type: "values", style: "iconSet", iconSet: k.set, icons: k.thresholds.map(threshold), iconReverse: k.reverse, iconOnly: !k.showValue });
      break;
    case "cellIs":
      Object.assign(f, { type: "contains", containsWhat: "cellValue", op: k.op, v1: formulaInput(k.formulas[0] ?? ""), v2: formulaInput(k.formulas[1] ?? "") });
      break;
    case "containsText":
    case "notContainsText":
    case "beginsWith":
    case "endsWith": {
      const ops: Record<string, TextOp> = { containsText: "containing", notContainsText: "notContaining", beginsWith: "beginsWith", endsWith: "endsWith" };
      Object.assign(f, { type: "contains", containsWhat: "specificText", textOp: ops[k.type], text: k.text });
      break;
    }
    case "containsBlanks":
    case "notContainsBlanks":
    case "containsErrors":
    case "notContainsErrors": {
      const what: Record<string, ContainsWhat> = { containsBlanks: "blanks", notContainsBlanks: "noBlanks", containsErrors: "errors", notContainsErrors: "noErrors" };
      Object.assign(f, { type: "contains", containsWhat: what[k.type] });
      break;
    }
    case "top10":
      Object.assign(f, { type: "topBottom", bottom: k.bottom, rank: String(k.rank), percent: k.percent });
      break;
    case "aboveAverage":
      Object.assign(f, { type: "average", average: k.above ? (k.equal ? "equalAbove" : "above") : k.equal ? "equalBelow" : "below" });
      break;
    case "duplicateValues":
    case "uniqueValues":
      Object.assign(f, { type: "uniqueDup", unique: k.type === "uniqueValues" });
      break;
    case "expression":
      Object.assign(f, { type: "formula", formula: `=${k.formula}` });
      break;
  }
  return f;
}

/** A threshold for the rule: `min`/`max` as they are; formulas without `=`. */
function cfValue(t: Threshold): CfValue | null {
  if (t.type === "min" || t.type === "max") return { type: t.type };
  const v = t.value.trim().replace(/^=/, "");
  if (v === "") return null;
  if (t.type !== "formula" && !Number.isFinite(Number(v))) return null;
  return { type: t.type, value: v };
}

/** The rule of the form, or the catalog key of what is missing (`calc.cf.err.*`). */
export function ruleFromForm(f: RuleForm): { rule: CfRule } | { error: string } {
  const base = { id: f.id, ranges: f.ranges.map((r) => ({ ...r })), priority: f.priority, stopIfTrue: f.stopIfTrue };
  const withDxf = (kind: CfKind) => ({ rule: { ...base, kind, ...(Object.keys(f.dxf).length > 0 ? { dxf: f.dxf } : {}) } });
  const plain = (kind: CfKind) => ({ rule: { ...base, kind } });
  switch (f.type) {
    case "values": {
      if (f.style === "scale2" || f.style === "scale3") {
        const pts = f.style === "scale3" ? f.points : [f.points[0]!, f.points[2]!];
        const values = pts.map(cfValue);
        if (values.some((v) => v === null)) return { error: "calc.cf.err.value" };
        return plain({ type: "colorScale", points: pts.map((p, i) => ({ value: values[i]!, color: rgb(p.color) })) });
      }
      if (f.style === "dataBar") {
        const min = cfValue(f.barMin);
        const max = cfValue(f.barMax);
        if (!min || !max) return { error: "calc.cf.err.value" };
        return plain({ type: "dataBar", color: rgb(f.barColor), min, max, showValue: !f.barOnly });
      }
      const thresholds = f.icons.map((t, i) => (i === 0 ? cfValue({ type: t.type === "min" ? "min" : t.type, value: t.value || "0" }) : cfValue(t)));
      if (thresholds.some((v) => v === null)) return { error: "calc.cf.err.value" };
      return plain({ type: "iconSet", set: f.iconSet, thresholds: thresholds as CfValue[], reverse: f.iconReverse, showValue: !f.iconOnly });
    }
    case "contains":
      switch (f.containsWhat) {
        case "cellValue": {
          if (f.v1.trim() === "" || (needsTwo(f.op) && f.v2.trim() === "")) return { error: "calc.cf.err.value" };
          const formulas = needsTwo(f.op) ? [valueFormula(f.v1), valueFormula(f.v2)] : [valueFormula(f.v1)];
          return withDxf({ type: "cellIs", op: f.op, formulas });
        }
        case "specificText": {
          if (f.text === "") return { error: "calc.cf.err.value" };
          const types = { containing: "containsText", notContaining: "notContainsText", beginsWith: "beginsWith", endsWith: "endsWith" } as const;
          return withDxf({ type: types[f.textOp], text: f.text });
        }
        case "blanks":
          return withDxf({ type: "containsBlanks" });
        case "noBlanks":
          return withDxf({ type: "notContainsBlanks" });
        case "errors":
          return withDxf({ type: "containsErrors" });
        case "noErrors":
          return withDxf({ type: "notContainsErrors" });
      }
      break;
    case "topBottom": {
      const rank = Math.round(Number(f.rank));
      if (!Number.isFinite(rank) || rank < 1 || (f.percent && rank > 100) || rank > 1000) return { error: "calc.cf.err.rank" };
      return withDxf({ type: "top10", rank, percent: f.percent, bottom: f.bottom });
    }
    case "average":
      return withDxf({ type: "aboveAverage", above: f.average === "above" || f.average === "equalAbove", equal: f.average.startsWith("equal") });
    case "uniqueDup":
      return withDxf({ type: f.unique ? "uniqueValues" : "duplicateValues" });
    case "formula": {
      const formula = f.formula.trim().replace(/^=/, "").trim();
      if (formula === "") return { error: "calc.cf.err.formula" };
      return withDxf({ type: "expression", formula });
    }
  }
  return { error: "calc.cf.err.value" };
}

// --- "applies to" ranges ---------------------------------------------------------

/** `$A$1:$B$5,$D$1` (whole columns `$A:$A`, whole rows `$1:$3`). */
export function rangesText(ranges: readonly Rect[]): string {
  return ranges
    .map((r) => {
      if (r.r0 === 0 && r.r1 === MAX_ROW) return `$${colName(r.c0)}:$${colName(r.c1)}`;
      if (r.c0 === 0 && r.c1 === MAX_COL) return `$${r.r0 + 1}:$${r.r1 + 1}`;
      const a = `$${colName(r.c0)}$${r.r0 + 1}`;
      return r.r0 === r.r1 && r.c0 === r.c1 ? a : `${a}:$${colName(r.c1)}$${r.r1 + 1}`;
    })
    .join(",");
}

/** Parses an "applies to" box (`=$A$1:$B$5,D1`, `A:A`, `1:3`); `null` when it is not a list of ranges. */
export function parseRanges(text: string): Rect[] | null {
  const col = (s: string) => {
    const c = lettersToCol(s);
    return c === null || c > MAX_COL ? null : c;
  };
  const parts = text.trim().replace(/^=/, "").split(/[,;]/).map((p) => p.trim().replace(/\$/g, "").toUpperCase());
  const out: Rect[] = [];
  for (const p of parts) {
    if (p === "") return null;
    const [a, b = a] = p.split(":");
    let m: RegExpExecArray | null;
    if ((m = /^([A-Z]{1,3})(\d+)$/.exec(a!)) && /^([A-Z]{1,3})(\d+)$/.test(b!)) {
      const n = /^([A-Z]{1,3})(\d+)$/.exec(b!)!;
      const c0 = col(m[1]!), c1 = col(n[1]!);
      const r0 = Number(m[2]) - 1, r1 = Number(n[2]) - 1;
      if (c0 === null || c1 === null || r0 < 0 || r1 < 0 || r0 > MAX_ROW || r1 > MAX_ROW) return null;
      out.push({ r0: Math.min(r0, r1), c0: Math.min(c0, c1), r1: Math.max(r0, r1), c1: Math.max(c0, c1) });
    } else if (/^[A-Z]{1,3}$/.test(a!) && /^[A-Z]{1,3}$/.test(b!) && p.includes(":")) {
      const c0 = col(a!), c1 = col(b!);
      if (c0 === null || c1 === null) return null;
      out.push({ r0: 0, c0: Math.min(c0, c1), r1: MAX_ROW, c1: Math.max(c0, c1) });
    } else if (/^\d+$/.test(a!) && /^\d+$/.test(b!) && p.includes(":")) {
      const r0 = Number(a) - 1, r1 = Number(b) - 1;
      if (r0 < 0 || r1 < 0 || r0 > MAX_ROW || r1 > MAX_ROW) return null;
      out.push({ r0: Math.min(r0, r1), c0: 0, r1: Math.max(r0, r1), c1: MAX_COL });
    } else return null;
  }
  return out.length > 0 ? out : null;
}

// --- Rules Manager --------------------------------------------------------------

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const content = (r: CfRule) => ({ ...r, priority: 0 });

/**
 * The commands that turn the sheet's `original` rules into the manager's
 * `edited` list (top = first): removals, then per position a reorder,
 * an update or an add (id 0) – each placing its rule at that priority,
 * which keeps the rules above it in place. Nothing for an unchanged list.
 */
export function manageCommands(sheet: number, original: readonly CfRule[], edited: readonly CfRule[]): CalcCommand[] {
  const out: CalcCommand[] = [];
  const keep = new Set(edited.filter((r) => r.id !== 0).map((r) => r.id));
  const cur: CfRule[] = [];
  for (const r of original) {
    if (keep.has(r.id)) cur.push(r);
    else out.push({ type: "removeCfRule", sheet, id: r.id });
  }
  edited.forEach((r, i) => {
    const priority = i + 1;
    if (r.id === 0) {
      out.push({ type: "addCfRule", sheet, rule: { ...r, priority } });
      cur.splice(i, 0, r);
      return;
    }
    const at = cur.findIndex((x) => x.id === r.id);
    const changed = !same(content(cur[at]!), content(r));
    if (at === i && !changed) return;
    out.push(changed ? { type: "updateCfRule", sheet, rule: { ...r, priority } } : { type: "reorderCfRule", sheet, id: r.id, priority });
    cur.splice(at, 1);
    cur.splice(i, 0, r);
  });
  return out;
}

/**
 * Move Up / Move Down in the Rules Manager: `item` swaps places with its
 * neighbour among the `shown` rules (the list filtered to the selection,
 * or all of them); the rest of the order stays. The same list when it
 * cannot move.
 */
export function moveShown<T>(list: readonly T[], shown: readonly T[], item: T, delta: -1 | 1): T[] {
  const other = shown[shown.indexOf(item) + delta];
  const a = list.indexOf(item);
  const b = other === undefined ? -1 : list.indexOf(other);
  const out = [...list];
  if (a < 0 || b < 0 || shown.indexOf(item) < 0) return out;
  [out[a], out[b]] = [out[b]!, out[a]!];
  return out;
}

/** Whether a rule applies to any cell of `r`. */
export function ruleTouches(rule: CfRule, r: Rect): boolean {
  return rule.ranges.some((x) => x.r0 <= r.r1 && r.r0 <= x.r1 && x.c0 <= r.c1 && r.c0 <= x.c1);
}

/**
 * The Rules Manager's description of a rule: a catalog key plus its
 * parameters (`calc.cf.desc.*`).
 */
export function describeRule(rule: CfRule): { key: string; params?: Record<string, string | number> } {
  const k = rule.kind;
  switch (k.type) {
    case "cellIs":
      return needsTwo(k.op)
        ? { key: `calc.cf.desc.${k.op}`, params: { a: formulaInput(k.formulas[0] ?? ""), b: formulaInput(k.formulas[1] ?? "") } }
        : { key: `calc.cf.desc.${k.op}`, params: { a: formulaInput(k.formulas[0] ?? "") } };
    case "expression":
      return { key: "calc.cf.desc.formula", params: { formula: `=${k.formula}` } };
    case "containsText":
    case "notContainsText":
    case "beginsWith":
    case "endsWith":
      return { key: `calc.cf.desc.${k.type}`, params: { text: k.text } };
    case "top10":
      return { key: k.bottom ? (k.percent ? "calc.cf.desc.bottomPercent" : "calc.cf.desc.bottom") : k.percent ? "calc.cf.desc.topPercent" : "calc.cf.desc.top", params: { n: k.rank } };
    case "aboveAverage":
      return { key: k.above ? (k.equal ? "calc.cf.desc.equalAbove" : "calc.cf.desc.above") : k.equal ? "calc.cf.desc.equalBelow" : "calc.cf.desc.below" };
    case "colorScale":
      return { key: "calc.cf.desc.colorScale" };
    case "dataBar":
      return { key: "calc.cf.desc.dataBar" };
    case "iconSet":
      return { key: "calc.cf.desc.iconSet" };
    default:
      return { key: `calc.cf.desc.${k.type}` };
  }
}
