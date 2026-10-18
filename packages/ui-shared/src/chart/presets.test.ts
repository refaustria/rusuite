// P9-X2: every shared chart preset (packages/ui-shared/src/chart/ui, the one copy Calc and Show consume) renders
// exactly as before the apps imported it from `@rusuite/ui-shared`. The snapshot holds a digest of each preset's SVG
// with Calc's layout options (Excel's axis bounds and label rotation) and with Show's (the same since P9-X2, plus a
// transparent chart area and PowerPoint's text colour), generated with the renderer of main before P9-X2.
// The options-off rendering stays pinned by chartC6.test.ts ("Show's presets render as before P9-C6").

import { describe, expect, it } from "vitest";
import { CHART_PRESETS as FROM_INDEX, applyPreset as applyFromIndex } from "..";
import { layoutChart, type ChartLayoutOptions } from "./layout";
import type { Chart, ResolvedChart } from "./model";
import { sceneToSvg } from "./svg";
import { CHART_PRESETS, applyPreset } from "./ui/presets";

const ref = (formula: string) => ({ type: "ref" as const, formula });
const CATS = ["Category 1", "Category 2", "Category 3", "Category 4"];
// PowerPoint's sample (three series × four categories), as Insert › Chart in both apps.
const SAMPLE: ResolvedChart = {
  series: [
    { name: "Series 1", categories: CATS, values: [4.3, 2.5, 3.5, 4.5] },
    { name: "Series 2", categories: CATS, values: [2.4, 4.4, 1.8, 2.8] },
    { name: "Series 3", categories: CATS, values: [2, 2, 3, 5] },
  ],
};
const BASE: Chart = {
  kind: { type: "bar", direction: "column", grouping: "clustered" },
  series: [0, 1, 2].map((i) => ({ name: ref(`Sheet1!$${"BCD"[i]}$1`), values: ref(`Sheet1!$${"BCD"[i]}$2:$${"BCD"[i]}$5`) })),
  categories: ref("Sheet1!$A$2:$A$5"),
  axes: { cat: {}, val: { majorGridlines: true } },
  legend: { position: "bottom" },
  title: { text: { type: "literal", text: "Chart Title" } },
};
const EXCEL: ChartLayoutOptions = { excelScale: true, autoRotateLabels: true };
const OPTIONS: Record<string, ChartLayoutOptions> = {
  calc: EXCEL,
  show: { ...EXCEL, area: { fill: null, border: null }, textColor: "#595959" },
};

/** FNV-1a of the SVG text: equal digests = the same drawing. */
function digest(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return `${s.length}:${h.toString(16).padStart(8, "0")}`;
}

describe("shared chart presets render as before P9-X2", () => {
  it("the package index exports the one copy", () => {
    expect(FROM_INDEX).toBe(CHART_PRESETS);
    expect(applyFromIndex).toBe(applyPreset);
    expect(CHART_PRESETS).toHaveLength(25);
  });

  for (const [app, options] of Object.entries(OPTIONS)) {
    it(`${app}: every preset at 480 × 270 and 240 × 135`, () => {
      const out: Record<string, string> = {};
      for (const p of CHART_PRESETS) {
        for (const [w, h] of [[480, 270], [240, 135]] as const) {
          out[`${p.id} ${w}x${h}`] = digest(sceneToSvg(layoutChart(applyPreset(BASE, p), SAMPLE, w, h, options), undefined, "p-"));
        }
      }
      expect(out).toMatchSnapshot();
    });
  }
});
