import { describe, expect, it } from "vitest";
import type { CfRule } from "../generated/CfRule";
import { ICON_SETS } from "../grid/cf";
import {
  COLOR_SCALES, colorScaleRule, DATA_BARS, dataBarRule, formulaInput, HIGHLIGHT_PRESETS, ICON_SET_GROUPS, iconSetRule, quickRule, valueFormula,
  type QuickRuleKind,
} from "./presets";
import { describeRule, formFromRule, manageCommands, moveShown, newRuleForm, parseRanges, rangesText, ruleFromForm } from "./rules";

const A1A5 = [{ r0: 0, c0: 0, r1: 4, c1: 0 }];
const lightRed = HIGHLIGHT_PRESETS[0]!.dxf;
const q = (kind: QuickRuleKind, values: string[] = [], duplicate = true) => quickRule(kind, values, lightRed, A1A5, duplicate);

describe("quick rules (Highlight Cells / Top/Bottom)", () => {
  it("typed criteria become formulas: numbers stay, text is quoted, `=` formulas lose the `=`", () => {
    expect(valueFormula(" 5 ")).toBe("5");
    expect(valueFormula('say "hi"')).toBe('"say ""hi"""');
    expect(valueFormula("=$B$1*2")).toBe("$B$1*2");
    expect(valueFormula("true")).toBe("TRUE");
    expect(formulaInput('"say ""hi"""')).toBe('say "hi"');
    expect(formulaInput("$B$1*2")).toBe("=$B$1*2");
    expect(formulaInput("5")).toBe("5");
  });

  it("Greater Than… with Light Red Fill with Dark Red Text", () => {
    expect(q("greaterThan", ["5"])).toEqual({
      id: 0, ranges: A1A5, priority: 1, stopIfTrue: false,
      kind: { type: "cellIs", op: "greaterThan", formulas: ["5"] },
      dxf: { fill: { kind: "rgb", value: "FFC7CE" }, fontColor: { kind: "rgb", value: "9C0006" } },
    });
  });

  it("Less Than…, Between… and Equal To…", () => {
    expect(q("lessThan", ["0"]).kind).toEqual({ type: "cellIs", op: "lessThan", formulas: ["0"] });
    expect(q("between", ["1", "=C1"]).kind).toEqual({ type: "cellIs", op: "between", formulas: ["1", "C1"] });
    expect(q("equalTo", ["apple"]).kind).toEqual({ type: "cellIs", op: "equal", formulas: ['"apple"'] });
  });

  it("Text that Contains… and Duplicate / Unique Values…", () => {
    expect(q("textContains", [" an "]).kind).toEqual({ type: "containsText", text: "an" });
    expect(q("duplicateValues").kind).toEqual({ type: "duplicateValues" });
    expect(q("duplicateValues", [], false).kind).toEqual({ type: "uniqueValues" });
  });

  it("Top / Bottom 10 Items and 10 %", () => {
    expect(q("top10", ["3"]).kind).toEqual({ type: "top10", rank: 3, percent: false, bottom: false });
    expect(q("top10Percent", ["150"]).kind).toEqual({ type: "top10", rank: 100, percent: true, bottom: false });
    expect(q("bottom10", ["10"]).kind).toEqual({ type: "top10", rank: 10, percent: false, bottom: true });
    expect(q("bottom10Percent", ["20"]).kind).toEqual({ type: "top10", rank: 20, percent: true, bottom: true });
  });

  it("Above / Below Average", () => {
    expect(q("aboveAverage").kind).toEqual({ type: "aboveAverage", above: true, equal: false });
    expect(q("belowAverage").kind).toEqual({ type: "aboveAverage", above: false, equal: false });
  });

  it("the other presets: yellow, green, light red fill, red text, red border", () => {
    expect(HIGHLIGHT_PRESETS.map((p) => p.id)).toEqual(["lightRedDarkRed", "yellowDarkYellow", "greenDarkGreen", "lightRed", "redText", "redBorder"]);
    expect(HIGHLIGHT_PRESETS[4]!.dxf).toEqual({ fontColor: { kind: "rgb", value: "9C0006" } });
    expect(Object.keys(HIGHLIGHT_PRESETS[5]!.dxf.borders!)).toEqual(["left", "right", "top", "bottom"]);
  });
});

describe("galleries", () => {
  it("Data Bars: six colours, lowest to highest value", () => {
    expect(DATA_BARS).toHaveLength(6);
    const blue = { kind: "rgb", value: "638EC6" };
    // Excel 2010's gradient bar: automatic bounds, 0–100 %, a border, red negative border.
    expect(dataBarRule("638EC6", A1A5).kind).toEqual({
      type: "dataBar", color: blue, min: { type: "autoMin" }, max: { type: "autoMax" }, showValue: true, minLength: 0, maxLength: 100,
      border: blue, negativeBorder: { kind: "rgb", value: "FF0000" },
    });
    expect(dataBarRule("638EC6", A1A5, true).kind).toMatchObject({ gradient: false });
    expect(dataBarRule("638EC6", A1A5, true).kind).not.toHaveProperty("border");
  });

  it("Color Scales: twelve scales; three colours use the 50th percentile as midpoint", () => {
    expect(COLOR_SCALES).toHaveLength(12);
    const gyr = colorScaleRule(COLOR_SCALES[0]!.colors, A1A5).kind;
    expect(gyr).toEqual({
      type: "colorScale",
      points: [
        { value: { type: "min" }, color: { kind: "rgb", value: "F8696B" } },
        { value: { type: "percentile", value: "50" }, color: { kind: "rgb", value: "FFEB84" } },
        { value: { type: "max" }, color: { kind: "rgb", value: "63BE7B" } },
      ],
    });
    const wr = colorScaleRule(COLOR_SCALES[6]!.colors, A1A5).kind;
    expect(wr.type === "colorScale" && wr.points.map((p) => p.value.type)).toEqual(["min", "max"]);
  });

  it("Icon Sets: grouped, every set once, equal percent thresholds", () => {
    const sets = ICON_SET_GROUPS.flatMap((g) => g.sets);
    expect(new Set(sets)).toEqual(new Set(Object.keys(ICON_SETS)));
    expect(sets).toHaveLength(17);
    expect(iconSetRule("3Arrows", A1A5).kind).toEqual({
      type: "iconSet", set: "3Arrows", reverse: false, showValue: true,
      thresholds: [{ type: "percent", value: "0" }, { type: "percent", value: "33" }, { type: "percent", value: "67" }],
    });
    const five = iconSetRule("5Quarters", A1A5).kind;
    expect(five.type === "iconSet" && five.thresholds.map((t) => ("value" in t ? t.value : ""))).toEqual(["0", "20", "40", "60", "80"]);
  });
});

const rule = (id: number, kind: CfRule["kind"], extra: Partial<CfRule> = {}): CfRule => ({ id, ranges: A1A5, priority: id, stopIfTrue: false, kind, ...extra });

describe("New / Edit Formatting Rule form", () => {
  it("a new rule defaults to a 2-colour scale over the selection", () => {
    const r = ruleFromForm(newRuleForm(A1A5));
    expect(r).toEqual({
      rule: {
        id: 0, ranges: A1A5, priority: 1, stopIfTrue: false,
        kind: { type: "colorScale", points: [{ value: { type: "min" }, color: { kind: "rgb", value: "F8696B" } }, { value: { type: "max" }, color: { kind: "rgb", value: "63BE7B" } }] },
      },
    });
  });

  it("every rule kind survives form → rule", () => {
    const red = { kind: "rgb" as const, value: "FF0000" };
    const kinds: CfRule["kind"][] = [
      { type: "cellIs", op: "notBetween", formulas: ["1", '"x"'] },
      { type: "containsText", text: "ab" },
      { type: "endsWith", text: "z" },
      { type: "notContainsErrors" },
      { type: "top10", rank: 5, percent: true, bottom: true },
      { type: "aboveAverage", above: false, equal: true },
      { type: "uniqueValues" },
      { type: "expression", formula: "MOD(ROW(),2)=0" },
    ];
    for (const kind of kinds) {
      const r = rule(3, kind, { dxf: { bold: true }, stopIfTrue: true });
      expect(ruleFromForm(formFromRule(r))).toEqual({ rule: r });
    }
    const visual: CfRule["kind"][] = [
      { type: "dataBar", color: red, min: { type: "num", value: "0" }, max: { type: "percent", value: "90" }, showValue: false },
      { type: "iconSet", set: "4Rating", thresholds: [{ type: "percent", value: "0" }, { type: "num", value: "2" }, { type: "formula", value: "$B$1" }, { type: "percentile", value: "90" }], reverse: true, showValue: true },
      { type: "colorScale", points: [{ value: { type: "num", value: "-1" }, color: red }, { value: { type: "percent", value: "40" }, color: red }, { value: { type: "max" }, color: red }] },
    ];
    for (const kind of visual) expect(ruleFromForm(formFromRule(rule(2, kind)))).toEqual({ rule: rule(2, kind) });
  });

  it("missing criteria, bad ranks and empty formulas are refused", () => {
    const f = newRuleForm(A1A5);
    expect(ruleFromForm({ ...f, type: "contains", containsWhat: "cellValue", op: "between", v1: "1", v2: "" })).toEqual({ error: "calc.cf.err.value" });
    expect(ruleFromForm({ ...f, type: "topBottom", rank: "0" })).toEqual({ error: "calc.cf.err.rank" });
    expect(ruleFromForm({ ...f, type: "topBottom", rank: "120", percent: true })).toEqual({ error: "calc.cf.err.rank" });
    expect(ruleFromForm({ ...f, type: "formula", formula: " = " })).toEqual({ error: "calc.cf.err.formula" });
    expect(ruleFromForm({ ...f, style: "dataBar", barMin: { type: "num", value: "abc" } })).toEqual({ error: "calc.cf.err.value" });
  });

  it("the highlight format is only kept for the formatting rule types", () => {
    const f = { ...newRuleForm(A1A5), dxf: { italic: true } };
    expect("rule" in ruleFromForm(f) && ruleFromForm(f)).toMatchObject({ rule: { kind: { type: "colorScale" } } });
    const r = ruleFromForm({ ...f, type: "uniqueDup" });
    expect(r).toEqual({ rule: { id: 0, ranges: A1A5, priority: 1, stopIfTrue: false, kind: { type: "duplicateValues" }, dxf: { italic: true } } });
  });
});

describe("Rules Manager", () => {
  it("'applies to' boxes: cells, ranges, whole columns and rows, lists; bad text is null", () => {
    const r = [{ r0: 0, c0: 0, r1: 4, c1: 1 }, { r0: 6, c0: 3, r1: 6, c1: 3 }, { r0: 0, c0: 2, r1: 1_048_575, c1: 2 }, { r0: 1, c0: 0, r1: 2, c1: 16_383 }];
    expect(rangesText(r)).toBe("$A$1:$B$5,$D$7,$C:$C,$2:$3");
    expect(parseRanges("=$A$1:$B$5,$D$7,$C:$C,$2:$3")).toEqual(r);
    expect(parseRanges("b5:a1")).toEqual([{ r0: 0, c0: 0, r1: 4, c1: 1 }]);
    expect(parseRanges("A1:")).toBeNull();
    expect(parseRanges("foo")).toBeNull();
    expect(parseRanges("XFE1")).toBeNull();
    expect(parseRanges("")).toBeNull();
  });

  const r1 = rule(1, { type: "cellIs", op: "greaterThan", formulas: ["5"] }, { priority: 1 });
  const r2 = rule(2, { type: "uniqueValues" }, { priority: 2 });
  const r3 = rule(3, { type: "containsBlanks" }, { priority: 3 });

  it("an unchanged list sends nothing", () => {
    expect(manageCommands(0, [r1, r2, r3], [r1, r2, r3])).toEqual([]);
  });

  it("Move Down swaps a rule with the next one: one reorder", () => {
    expect(manageCommands(0, [r1, r2, r3], [r2, r1, r3])).toEqual([{ type: "reorderCfRule", sheet: 0, id: 2, priority: 1 }]);
    expect(manageCommands(0, [r1, r2, r3], [r3, r1, r2])).toEqual([{ type: "reorderCfRule", sheet: 0, id: 3, priority: 1 }]);
  });

  it("deletes, edits (with their new priority) and new rules on top", () => {
    const edited = { ...r3, stopIfTrue: true, ranges: [{ r0: 0, c0: 0, r1: 9, c1: 0 }] };
    const fresh = rule(0, { type: "containsErrors" });
    expect(manageCommands(0, [r1, r2, r3], [fresh, edited, r1])).toEqual([
      { type: "removeCfRule", sheet: 0, id: 2 },
      { type: "addCfRule", sheet: 0, rule: { ...fresh, priority: 1 } },
      { type: "updateCfRule", sheet: 0, rule: { ...edited, priority: 2 } },
    ]);
  });

  it("Move Up / Down among the rules shown for the selection", () => {
    const list = ["a", "b", "c", "d"];
    expect(moveShown(list, list, "c", -1)).toEqual(["a", "c", "b", "d"]);
    expect(moveShown(list, ["a", "c", "d"], "c", -1)).toEqual(["c", "b", "a", "d"]);
    expect(moveShown(list, list, "a", -1)).toEqual(list);
    expect(moveShown(list, list, "d", 1)).toEqual(list);
  });

  it("describes rules like Excel's list", () => {
    expect(describeRule(r1)).toEqual({ key: "calc.cf.desc.greaterThan", params: { a: "5" } });
    expect(describeRule(rule(4, { type: "cellIs", op: "between", formulas: ["1", '"z"'] }))).toEqual({ key: "calc.cf.desc.between", params: { a: "1", b: "z" } });
    expect(describeRule(rule(5, { type: "top10", rank: 10, percent: true, bottom: false }))).toEqual({ key: "calc.cf.desc.topPercent", params: { n: 10 } });
    expect(describeRule(rule(6, { type: "expression", formula: "A1>0" }))).toEqual({ key: "calc.cf.desc.formula", params: { formula: "=A1>0" } });
    expect(describeRule(r3)).toEqual({ key: "calc.cf.desc.containsBlanks" });
  });
});

describe("P9-C5 rule types in the dialog", () => {
  const roundtrip = (kind: CfRule["kind"], dxf = true) => {
    const r: CfRule = { id: 3, ranges: A1A5, priority: 2, stopIfTrue: true, kind, ...(dxf ? { dxf: lightRed } : {}) };
    const out = ruleFromForm(formFromRule(r));
    expect(out).toEqual({ rule: r });
  };

  it("A Date Occurring: the quick dialog and the New Rule form", () => {
    expect(q("dateOccurring", ["last7Days"]).kind).toEqual({ type: "timePeriod", period: "last7Days" });
    expect(q("dateOccurring").kind).toEqual({ type: "timePeriod", period: "yesterday" });
    const f = { ...newRuleForm(A1A5), type: "contains" as const, containsWhat: "dates" as const, period: "nextMonth" as const, dxf: lightRed };
    expect(ruleFromForm(f)).toMatchObject({ rule: { kind: { type: "timePeriod", period: "nextMonth" } } });
    roundtrip({ type: "timePeriod", period: "thisWeek" });
    expect(describeRule({ ...q("dateOccurring", ["today"]) })).toEqual({ key: "calc.cf.desc.period.today" });
  });

  it("standard deviations above/below the average", () => {
    const f = { ...newRuleForm(A1A5), type: "average" as const, average: "std2Below" as const, dxf: lightRed };
    expect(ruleFromForm(f)).toMatchObject({ rule: { kind: { type: "aboveAverage", above: false, equal: false, stdDev: 2 } } });
    roundtrip({ type: "aboveAverage", above: true, equal: false, stdDev: 3 });
    expect(describeRule({ ...q("aboveAverage"), kind: { type: "aboveAverage", above: true, equal: false, stdDev: 1 } })).toEqual({
      key: "calc.cf.desc.stdAbove", params: { n: 1 },
    });
  });

  it("data bar options: fill, border, negative colours, axis, direction, lengths", () => {
    const blue = { kind: "rgb" as const, value: "638EC6" };
    roundtrip(dataBarRule("638EC6", A1A5).kind, false);
    roundtrip({
      type: "dataBar", color: blue, min: { type: "num", value: "0" }, max: { type: "autoMax" }, showValue: false, gradient: false,
      border: { kind: "rgb", value: "112233" }, negativeColor: { kind: "rgb", value: "0000FF" }, negativeBorder: { kind: "rgb", value: "00FF00" },
      axisColor: { kind: "rgb", value: "808080" }, axis: "midpoint", direction: "rightToLeft", minLength: 5, maxLength: 95,
    }, false);
    // An Excel 2007 bar keeps its defaults (no options written).
    roundtrip({ type: "dataBar", color: blue, min: { type: "min" }, max: { type: "max" }, showValue: true }, false);
    // A new rule's defaults: automatic bounds.
    const f = { ...newRuleForm(A1A5), style: "dataBar" as const };
    expect(ruleFromForm(f)).toMatchObject({ rule: { kind: { min: { type: "autoMin" }, max: { type: "autoMax" }, minLength: 0, maxLength: 100 } } });
  });

  it("icon thresholds with > instead of >=", () => {
    const pct = (v: string) => ({ type: "percent" as const, value: v });
    roundtrip({ type: "iconSet", set: "3Arrows", thresholds: [pct("0"), pct("33"), pct("67")], reverse: true, showValue: false, greater: [false, true, false] }, false);
    roundtrip(iconSetRule("3Flags", A1A5).kind, false);
  });
});
