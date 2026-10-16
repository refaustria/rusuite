import { describe, expect, it } from "vitest";
import { layoutChart } from "@rusuite/ui-shared";
import type { ChartShape } from "../generated/ChartShape";
import { chartOptions, chartScene } from "./render";
import { SAMPLE_TABLE } from "./ChartDialogs";

const ref = (f: string) => ({ type: "ref" as const, formula: f });
const shape: ChartShape = {
  chart: {
    kind: { type: "bar", direction: "column", grouping: "clustered" },
    title: { text: { type: "literal", text: "Chart Title" } },
    series: SAMPLE_TABLE.series.map((_, i) => ({ values: ref(`V${i}`) })),
    axes: { cat: {}, val: { majorGridlines: true } },
  },
  data: SAMPLE_TABLE,
};

describe("charts on slides", () => {
  it("draw on a transparent area with text in tx1 +35 % of the theme", () => {
    const o = chartOptions({ dark1: "000000", accent1: "FF0000" });
    expect(o.area).toEqual({ fill: null, border: null });
    expect(o.textColor).toBe("#595959");
    const dark = chartOptions({ dark1: "FFFFFF" });
    expect(dark.textColor).toBe("#FFFFFF");
    const scene = layoutChart(shape.chart, { series: [] }, 200, 100, o);
    const area = scene.items[0]!;
    expect(area.t === "rect" && area.fill === undefined && area.stroke === undefined).toBe(true);
  });

  it("use the theme's accents for the series", () => {
    const scene = chartScene(shape, 400, 300, { accent1: "123456" });
    expect(scene.items.some((it) => (it.t === "rect" || it.t === "path") && it.fill === "#123456")).toBe(true);
  });

  it("memoize the scene per chart, size and theme", () => {
    const palette = { accent1: "123456" };
    const a = chartScene(shape, 400, 300, palette);
    expect(chartScene(shape, 400, 300, palette)).toBe(a);
    expect(chartScene(shape, 401, 300, palette)).not.toBe(a);
    expect(chartScene(shape, 401, 300, { accent1: "654321" })).not.toBe(a);
  });
});
