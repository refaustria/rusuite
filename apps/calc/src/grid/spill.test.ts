import { describe, expect, it } from "vitest";
import type { CellView } from "../generated/CellView";
import type { Rect } from "../generated/Rect";
import { colGeometry, DEFAULT_FORMAT, rowGeometry } from "./geometry";
import type { SheetData } from "./render";
import {
  changesPartOfArray, hasSpilledCells, isFilledCell, obstructingCells, onlySpilledCells, spillAt, spillOutlineOps,
  SPILL_BLOCKED_COLOR, SPILL_COLOR,
} from "./spill";

type Cells = Map<number, Map<number, CellView>>;

function cellsOf(list: CellView[]): Cells {
  const map: Cells = new Map();
  for (const c of list) {
    if (!map.has(c.row)) map.set(c.row, new Map());
    map.get(c.row)!.set(c.col, c);
  }
  return map;
}

const anchor = (row: number, col: number, input: string, display: string, spill: Rect, kind: CellView["kind"] = "number"): CellView => ({
  row, col, input, display, kind, style: 0, spill,
});
const spilled = (row: number, col: number, display: string, from: [number, number]): CellView => ({
  row, col, input: "", display, kind: "number", style: 0, spilled: from,
});
const plain = (row: number, col: number, input: string): CellView => ({ row, col, input, display: input, kind: "text", style: 0 });

/** `=SEQUENCE(3)` in B2 spilling to B2:B4. */
const seq = () => {
  const a = anchor(1, 1, "=SEQUENCE(3)", "1", { r0: 1, c0: 1, r1: 3, c1: 1 });
  const cells = cellsOf([a, spilled(2, 1, "2", [1, 1]), spilled(3, 1, "3", [1, 1])]);
  return { a, cells };
};

/** `=SEQUENCE(3)` in B2 blocked by "x" in B3. */
const blocked = () => {
  const a = anchor(1, 1, "=SEQUENCE(3)", "#SPILL!", { r0: 1, c0: 1, r1: 3, c1: 1 }, "error");
  return { a, cells: cellsOf([a, plain(2, 1, "x")]) };
};

function sheetData(cells: Cells): SheetData {
  const cols = new Map();
  const rows = new Map();
  return { cells, cols, rows, colGeo: colGeometry(DEFAULT_FORMAT, cols), rowGeo: rowGeometry(DEFAULT_FORMAT, rows) };
}

describe("spill ranges", () => {
  it("finds the spill range from the formula cell and from any spilled cell", () => {
    const { a, cells } = seq();
    const want = { anchor: { row: 1, col: 1 }, range: { r0: 1, c0: 1, r1: 3, c1: 1 }, blocked: false };
    expect(spillAt(cells, [a], 1, 1)).toEqual(want);
    expect(spillAt(cells, [a], 3, 1)).toEqual(want);
    expect(spillAt(cells, [a], 0, 1)).toBeNull();
    expect(spillAt(cells, [a], 1, 2)).toBeNull();
  });

  it("a #SPILL! formula is blocked, also seen from the cell in its way", () => {
    const { a, cells } = blocked();
    expect(spillAt(cells, [a], 1, 1)?.blocked).toBe(true);
    expect(spillAt(cells, [a], 2, 1)).toMatchObject({ anchor: { row: 1, col: 1 }, blocked: true });
    expect(spillAt(cells, [a], 4, 1)).toBeNull();
  });

  it("counts spilled cells as filled (Ctrl+arrows, regions, used range)", () => {
    const { cells } = seq();
    expect(isFilledCell(cells.get(2)!.get(1))).toBe(true);
    expect(isFilledCell(plain(0, 0, ""))).toBe(false);
    expect(isFilledCell(undefined)).toBe(false);
  });
});

describe("spill outline render ops", () => {
  const vp = { scrollX: 0, scrollY: 0, width: 400, height: 200 };

  it("draws a thin solid blue box around the spill range", () => {
    const { a, cells } = seq();
    const ops = spillOutlineOps(vp, sheetData(cells), spillAt(cells, [a], 1, 1)!);
    expect(ops).toHaveLength(4);
    for (const o of ops) expect(o).toMatchObject({ op: "line", color: SPILL_COLOR, width: 1, dash: [] });
    // B2:B4 at 64×20 px cells: x 64..128, y 20..80.
    const xs = ops.flatMap((o) => (o.op === "line" ? [o.x1, o.x2] : []));
    const ys = ops.flatMap((o) => (o.op === "line" ? [o.y1, o.y2] : []));
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([65, 128]);
    expect([Math.min(...ys), Math.max(...ys)]).toEqual([21, 80]);
  });

  it("a blocked spill is outlined dashed red", () => {
    const { a, cells } = blocked();
    const ops = spillOutlineOps(vp, sheetData(cells), spillAt(cells, [a], 1, 1)!);
    expect(ops).toHaveLength(4);
    for (const o of ops) expect(o).toMatchObject({ op: "line", color: SPILL_BLOCKED_COLOR, dash: [4, 3] });
  });

  it("nothing is drawn for a spill range scrolled out of view", () => {
    const { a, cells } = seq();
    expect(spillOutlineOps({ ...vp, scrollY: 5000 }, sheetData(cells), spillAt(cells, [a], 1, 1)!)).toEqual([]);
  });
});

describe("part of an array", () => {
  it("writing over spilled cells without their formula cell changes part of an array", () => {
    const { cells } = seq();
    expect(changesPartOfArray(cells, { r0: 2, c0: 1, r1: 2, c1: 1 })).toBe(true);
    expect(changesPartOfArray(cells, { r0: 3, c0: 0, r1: 9, c1: 5 })).toBe(true);
  });

  it("covering the formula cell (the whole spill goes) or no spilled cell is fine", () => {
    const { cells } = seq();
    expect(changesPartOfArray(cells, { r0: 1, c0: 1, r1: 1, c1: 1 })).toBe(false);
    expect(changesPartOfArray(cells, { r0: 0, c0: 0, r1: 5, c1: 5 })).toBe(false);
    expect(changesPartOfArray(cells, { r0: 0, c0: 2, r1: 9, c1: 9 })).toBe(false);
  });

  it("a sort refuses any range with spilled cells", () => {
    const { cells } = seq();
    expect(hasSpilledCells(cells, { r0: 0, c0: 0, r1: 9, c1: 9 })).toBe(true);
    expect(hasSpilledCells(cells, { r0: 1, c0: 1, r1: 1, c1: 1 })).toBe(false);
  });

  it("Delete over spilled cells only changes nothing; with other content it clears", () => {
    const { cells } = seq();
    expect(onlySpilledCells(cells, { r0: 2, c0: 1, r1: 3, c1: 1 })).toBe(true);
    expect(onlySpilledCells(cells, { r0: 1, c0: 1, r1: 3, c1: 1 })).toBe(false);
    expect(onlySpilledCells(cells, { r0: 8, c0: 8, r1: 9, c1: 9 })).toBe(false);
  });

  it("finds the cells obstructing a blocked spill", () => {
    const { a, cells } = blocked();
    cells.set(3, new Map([[1, plain(3, 1, "y")]]));
    const o = spillAt(cells, [a], 1, 1)!;
    expect(obstructingCells(cells, o)).toEqual({ range: { r0: 2, c0: 1, r1: 3, c1: 1 }, first: { row: 2, col: 1 } });
    const s = seq();
    expect(obstructingCells(s.cells, spillAt(s.cells, [s.a], 1, 1)!)).toBeNull();
  });
});
