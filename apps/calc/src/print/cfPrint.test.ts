import { describe, expect, it } from "vitest";
import { cfKey } from "../grid/cf";
import { emptyCache } from "../state/store";
import { iconHtml, sliceTableHtml } from "./calcPrintDoc";
import { buildPrintTable } from "./printTable";

describe("print view honours conditional formatting", () => {
  it("highlight fills, colour scales, data bars, icons and hidden values", () => {
    const cache = emptyCache();
    const put = (row: number, col: number, display: string) => {
      if (!cache.cells.has(row)) cache.cells.set(row, new Map());
      cache.cells.get(row)!.set(col, { row, col, input: display, display, kind: "number", style: 0 });
    };
    put(0, 0, "1");
    put(0, 1, "2");
    put(0, 2, "3");
    put(0, 3, "4");
    cache.cf.set(cfKey(0, 0), { dxf: { fill: { kind: "rgb", value: "FFC7CE" }, fontColor: { kind: "rgb", value: "9C0006" }, bold: true } });
    cache.cf.set(cfKey(0, 1), { color: { kind: "rgb", value: "63BE7B" } });
    cache.cf.set(cfKey(0, 2), { bar: 0.5, barColor: { kind: "rgb", value: "638EC6" } });
    cache.cf.set(cfKey(0, 3), { icon: 0, iconSet: "3Arrows", hideValue: true });
    const t = buildPrintTable(cache, [{}], 0, 3);
    const [a, b, c, d] = t.rows[0]!.cells;
    expect(a!.style).toMatchObject({ backgroundColor: "#FFC7CE", color: "#9C0006", fontWeight: "bold" });
    expect(b!.style.backgroundColor).toBe("#63BE7B");
    expect(c!.style).toMatchObject({ backgroundImage: "linear-gradient(to right, #638EC6, #ffffff)", backgroundSize: "33px 70%", backgroundPosition: "2px center" });
    expect(d).toMatchObject({ text: "", icon: { set: "3Arrows", index: 0 } });
    const html = sliceTableHtml(t, { rows: [0, 1], cols: [0, 4], repeat: 0 }, { gridlines: false, headings: false });
    expect(html).toContain(iconHtml("3Arrows", 0));
    expect(iconHtml("3Arrows", 0)).toMatch(/^<svg class="rs-cf-icon"[^>]*><path d="M8 15/);
    expect(iconHtml("3Arrows", 7)).toBe("");
  });
});
