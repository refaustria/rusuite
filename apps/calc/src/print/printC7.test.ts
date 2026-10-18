// P9-C7: printed cells as on the screen — overflow into empty neighbours up to the page edge, `####`, wrap, indent.
import { describe, expect, it } from "vitest";
import type { CellStyle } from "../generated/CellStyle";
import type { CellView } from "../generated/CellView";
import { emptyCache, type SheetCache } from "../state/store";
import { overflowExtent, sliceTableHtml } from "./calcPrintDoc";
import { buildPrintTable, printedText } from "./printTable";
import type { Measure } from "../grid/textLayout";

const m7: Measure = (t) => t.length * 7;
const styles: CellStyle[] = [{}, { numberFormat: "0.00" }, { alignment: { wrapText: true } }, { alignment: { horizontal: "right", indent: 2 } }, { alignment: { horizontal: "right" } }];

function cache(cells: [number, number, string, CellView["kind"], number?][]): SheetCache {
  const c = emptyCache();
  for (const [row, col, display, kind, style = 0] of cells) {
    (c.cells.get(row) ?? c.cells.set(row, new Map()).get(row)!).set(col, { row, col, input: display, display, kind, style });
  }
  return c;
}

describe("print overflow and number fitting (P9-C7)", () => {
  it("a long text is marked to overflow; numbers and wrapped text are not", () => {
    const t = buildPrintTable(cache([[0, 0, "x".repeat(20), "text"], [0, 1, "123456789012", "number"], [0, 2, "a b c d e f g h i j", "text", 2]]), styles, 0, 3, 0, 0, undefined, m7);
    const [a, b, c] = t.rows[0]!.cells;
    expect(a!.overflow).toEqual({ width: 146, align: "left" });
    expect(b!.overflow).toBeUndefined();
    expect(b!.text).toBe("1.23E+11");
    expect(c!.overflow).toBeUndefined();
    expect(c!.style.whiteSpace).toBe("pre-wrap");
  });

  it("numbers that do not fit print as #### (fixed decimals) and right indents pad the right side", () => {
    expect(printedText({ row: 0, col: 0, input: "1", display: "123456789.00", kind: "number", style: 1 }, styles[1]!, 64, m7)).toBe("########");
    const t = buildPrintTable(cache([[0, 0, "ab", "text", 3]]), styles, 0, 0, 0, 0, undefined, m7);
    expect(t.rows[0]!.cells[0]!.style.paddingRight).toBe(21);
  });

  it("overflowExtent runs over empty cells on the page and stops at a value, the page edge or a merge", () => {
    const cells = [
      { col: 0, text: "long", style: {} },
      { col: 1, text: "", style: {} },
      { col: 2, text: "", style: {} },
      { col: 3, text: "v", style: {} },
    ];
    const cols = [{ width: 64 }, { width: 64 }, { width: 64 }, { width: 64 }];
    expect(overflowExtent(cells, [0, 1, 2, 3], 0, cols, { width: 300, align: "left" })).toEqual({ left: 0, right: 128 });
    // The page ends after column B: the text is cut there.
    expect(overflowExtent(cells, [0, 1], 0, cols, { width: 300, align: "left" })).toEqual({ left: 0, right: 64 });
    expect(overflowExtent(cells, [0, 1, 2, 3], 2, cols, { width: 200, align: "right" })).toEqual({ left: 64, right: 0 }); // A1 has a value
    expect(overflowExtent(cells, [0, 1, 2, 3], 2, cols, { width: 200, align: "center" })).toEqual({ left: 64, right: 0 });
    const merged = cells.map((c, i) => (i === 1 ? { ...c, span: { rows: 1, cols: 2 } } : c));
    expect(overflowExtent(merged, [0, 1, 2, 3], 0, cols, { width: 300, align: "left" })).toEqual({ left: 0, right: 0 });
  });

  it("the page HTML draws the overflowing text over its neighbours", () => {
    const t = buildPrintTable(cache([[0, 0, "x".repeat(20), "text"], [1, 2, "y".repeat(20), "text", 4]]), styles, 1, 2, 0, 0, undefined, m7);
    const html = sliceTableHtml(t, { rows: [0, 2], cols: [0, 3], repeat: 0 }, { gridlines: false, headings: false });
    expect(html).toContain('class="rs-spill" style="position:absolute;top:0;bottom:0;left:0px;right:-128px;display:flex;justify-content:flex-start');
    expect(html).toContain("left:-128px;right:0px;display:flex;justify-content:flex-end");
  });
});
