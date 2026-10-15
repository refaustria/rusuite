import { describe, expect, it } from "vitest";
import { cellAddress, colName, sheetPrefix } from "./address";
import {
  cellSelection, colSelection, dataEdge, isWholeCols, isWholeRows, LAST_COL, LAST_ROW, move, navigate, normalize,
  pointerSelect, rowSelection, type NavContext, type Selection,
} from "./Selection";

function ctx(filled: [number, number][], pageRows = 10): NavContext {
  const set = new Set(filled.map(([r, c]) => `${r},${c}`));
  let lastRow = -1;
  let lastCol = -1;
  for (const [r, c] of filled) {
    lastRow = Math.max(lastRow, r);
    lastCol = Math.max(lastCol, c);
  }
  return { isFilled: (r, c) => set.has(`${r},${c}`), usedLastRow: lastRow, usedLastCol: lastCol, pageRows };
}

const key = (k: string, shift = false, ctrl = false) => ({ key: k, shift, ctrl });

describe("addresses", () => {
  it("names columns and cells", () => {
    expect(colName(0)).toBe("A");
    expect(colName(25)).toBe("Z");
    expect(colName(26)).toBe("AA");
    expect(colName(16383)).toBe("XFD");
    expect(cellAddress(2, 1)).toBe("B3");
    expect(sheetPrefix("Sheet2")).toBe("Sheet2!");
    expect(sheetPrefix("My Sheet")).toBe("'My Sheet'!");
  });
});

describe("selection", () => {
  it("normalizes anchor/focus into a range", () => {
    const sel: Selection = { anchor: { row: 5, col: 3 }, focus: { row: 2, col: 7 } };
    expect(normalize(sel)).toEqual({ r0: 2, c0: 3, r1: 5, c1: 7 });
  });

  it("represents whole rows and columns as clipped ranges", () => {
    expect(normalize(rowSelection(3, 1))).toEqual({ r0: 1, c0: 0, r1: 3, c1: LAST_COL });
    expect(isWholeRows(normalize(rowSelection(3)))).toBe(true);
    expect(isWholeCols(normalize(colSelection(2)))).toBe(true);
    expect(colSelection(2).anchor).toEqual({ row: 0, col: 2 });
  });

  it("moves, extends and clamps", () => {
    const s = cellSelection(0, 0);
    expect(move(s, -1, -1, false)).toEqual(cellSelection(0, 0));
    expect(move(s, 2, 1, false)).toEqual(cellSelection(2, 1));
    const ext = move(move(s, 1, 0, true), 0, 2, true);
    expect(ext).toEqual({ anchor: { row: 0, col: 0 }, focus: { row: 1, col: 2 } });
    expect(pointerSelect(ext, { row: 4, col: 4 }, true).anchor).toEqual({ row: 0, col: 0 });
    expect(pointerSelect(ext, { row: 4, col: 4 }, false)).toEqual(cellSelection(4, 4));
  });

  it("handles arrows, Tab/Enter, Page and Home/End keys", () => {
    const c = ctx([[0, 0], [9, 4]]);
    const s = cellSelection(3, 2);
    expect(navigate(s, key("ArrowDown"), c)).toEqual(cellSelection(4, 2));
    expect(navigate(s, key("ArrowLeft", true), c)).toEqual({ anchor: { row: 3, col: 2 }, focus: { row: 3, col: 1 } });
    expect(navigate(s, key("Tab"), c)).toEqual(cellSelection(3, 3));
    expect(navigate(s, key("Tab", true), c)).toEqual(cellSelection(3, 1));
    expect(navigate(s, key("Enter"), c)).toEqual(cellSelection(4, 2));
    expect(navigate(s, key("Enter", true), c)).toEqual(cellSelection(2, 2));
    expect(navigate(s, key("PageDown"), c)).toEqual(cellSelection(13, 2));
    expect(navigate(s, key("PageUp"), c)).toEqual(cellSelection(0, 2));
    expect(navigate(s, key("Home"), c)).toEqual(cellSelection(3, 0));
    expect(navigate(s, key("Home", false, true), c)).toEqual(cellSelection(0, 0));
    expect(navigate(s, key("End", false, true), c)).toEqual(cellSelection(9, 4));
    expect(navigate(s, key("x"), c)).toBeNull();
  });

  it("Ctrl+A selects the used range, or the whole sheet when empty", () => {
    expect(navigate(cellSelection(3, 3), key("a", false, true), ctx([[2, 1], [5, 6]]))).toEqual({
      anchor: { row: 0, col: 0 }, focus: { row: 5, col: 6 },
    });
    expect(normalize(navigate(cellSelection(3, 3), key("a", false, true), ctx([]))!)).toEqual({
      r0: 0, c0: 0, r1: LAST_ROW, c1: LAST_COL,
    });
  });

  it("Ctrl+Arrow jumps to data edges", () => {
    // Column 0: rows 0-3 filled, gap, row 7 filled.
    const c = ctx([[0, 0], [1, 0], [2, 0], [3, 0], [7, 0]]);
    expect(dataEdge({ row: 0, col: 0 }, 1, 0, c)).toEqual({ row: 3, col: 0 }); // end of run
    expect(dataEdge({ row: 3, col: 0 }, 1, 0, c)).toEqual({ row: 7, col: 0 }); // next filled
    expect(dataEdge({ row: 7, col: 0 }, 1, 0, c)).toEqual({ row: LAST_ROW, col: 0 }); // sheet edge
    expect(dataEdge({ row: 7, col: 0 }, -1, 0, c)).toEqual({ row: 3, col: 0 });
    expect(dataEdge({ row: 5, col: 3 }, 0, -1, c)).toEqual({ row: 5, col: 0 });
    expect(navigate(cellSelection(0, 0), key("ArrowDown", true, true), c)).toEqual({
      anchor: { row: 0, col: 0 }, focus: { row: 3, col: 0 },
    });
  });
});
