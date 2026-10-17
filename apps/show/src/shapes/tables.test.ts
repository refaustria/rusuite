import { describe, expect, it } from "vitest";
import type { Table } from "../generated/Table";
import { body } from "../test/fixture";
import {
  alignCommand, anchorOf, bordersCommand, cellsIn, deleteColsCommand, deleteRowsCommand, distributeCommand, effectiveBorders, effectiveFill,
  expandRange, insertColsCommand, insertRowsCommand, keyMove, lookCommand, mergeCommand, moveCell, NO_LINE, resizeColCommand,
  resizeRowCommand, splitCommand, styleCell, styleCommand, BUILTIN_TABLE_STYLES, DEFAULT_TABLE_STYLE, tableStyleGroups, tableStyleOf,
  clearTableCommand, compoundStrokes,
} from "./tables";

/** A rows × cols table in the default style; `merged` = [row, col, rowSpan, colSpan] regions. */
function table(rows: number, cols: number, merged: [number, number, number, number][] = []): Table {
  const t: Table = {
    rows: Array.from({ length: rows }, () => ({ height: 370840 })),
    cols: Array.from({ length: cols }, () => ({ width: 1000000 })),
    cells: Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => ({ text: body(`${r}${c}`) }))),
    styleId: DEFAULT_TABLE_STYLE,
    look: { firstRow: true, bandRows: true },
  };
  for (const [r, c, rs, cs] of merged) {
    for (let i = r; i < r + rs; i++) for (let k = c; k < c + cs; k++) if (i !== r || k !== c) t.cells[i]![k]!.covered = true;
    Object.assign(t.cells[r]![c]!, { rowSpan: rs, colSpan: cs });
  }
  return t;
}

const accent = (slot: string, tint: number) => ({ kind: "theme", value: { slot, tint } });

describe("table styles", () => {
  it("Medium Style 2: accent header with bold light text, banded rows, white grid (thick under the header)", () => {
    const t = table(4, 2);
    expect(styleCell(t, 0, 0)).toMatchObject({ fill: accent("accent1", 0), bold: true, textColor: accent("light1", 0) });
    expect(styleCell(t, 1, 0).fill).toEqual(accent("accent1", 0.6));
    expect(styleCell(t, 2, 0).fill).toEqual(accent("accent1", 0.8));
    expect(styleCell(t, 0, 0).borders.bottom).toEqual({ color: accent("light1", 0), width: 38100 });
    expect(styleCell(t, 2, 1).borders.left).toEqual({ color: accent("light1", 0), width: 12700 });
  });

  it("Dark Style 1 – Accent 1 with first column: the corner cells drop the column's white line in the header and total rows", () => {
    const t = { ...table(4, 3), styleId: "{125E5076-3810-47DD-B79F-674D7AD40C01}", look: { firstRow: true, firstCol: true, lastRow: true, bandRows: true } };
    const white = { color: accent("light1", 0), width: 25400 };
    expect(styleCell(t, 1, 0).borders.right).toEqual(white);
    expect(styleCell(t, 0, 0).borders.right).toBeNull();
    expect(styleCell(t, 3, 0).borders.right).toBeNull();
    expect(styleCell(t, 0, 1).fill).toEqual(accent("dark1", 0));
    expect(styleCell(t, 3, 1).fill).toEqual(accent("accent1", -0.6));
    expect(styleCell(t, 2, 1).textColor).toEqual(accent("light1", 0));
  });

  it("double total-row lines and the table background of themed styles", () => {
    const l2 = { ...table(3, 2), styleId: "{69012ECD-51FC-41F1-AA8D-1B2483CD663E}", look: { lastRow: true } }; // Light Style 2 – Accent 1
    expect(styleCell(l2, 2, 0).borders.top).toEqual({ color: accent("accent1", 0), width: 50800, compound: "double" });
    expect(effectiveBorders(l2, 1, 0).bottom).toEqual({ color: accent("accent1", 0), width: 50800, compound: "double" });
    const t2 = { ...table(3, 2), styleId: "{D113A9D2-9D6B-4929-AA2D-F23B5EE8CBE7}", look: { firstRow: true } }; // Themed Style 2 – Accent 1
    expect(styleCell(t2, 1, 0).fill).toEqual(accent("accent1", 0));
    expect(styleCell(t2, 0, 0).fill).toEqual(accent("accent1", 0));
  });

  it("compound strokes split the width", () => {
    expect(compoundStrokes(undefined, 6)).toEqual([{ width: 6, offset: 0 }]);
    expect(compoundStrokes("double", 6)).toEqual([{ width: 2, offset: -2 }, { width: 2, offset: 2 }]);
    expect(compoundStrokes("triple", 5).map((s) => s.width)).toEqual([1, 1, 1]);
    const tt = compoundStrokes("thickThin", 12);
    expect(tt[0]!.width).toBeGreaterThan(tt[1]!.width);
  });

  it("Clear Table: no style, cell fills and borders back to the style's", () => {
    const t = table(2, 3);
    expect(clearTableCommand(7, t)).toEqual({
      type: "compound",
      commands: [
        { type: "setTableStyle", shape: 7, styleId: null, look: t.look },
        { type: "setTableCellProps", shape: 7, row: 0, col: 0, rowSpan: 2, colSpan: 3, patch: { fill: null, left: null, right: null, top: null, bottom: null } },
      ],
    });
  });

  it("the 74 built-ins come from the core; an unknown style draws nothing", () => {
    expect(BUILTIN_TABLE_STYLES).toHaveLength(74);
    const t = { ...table(2, 2), styleId: "{00A15C55-8517-42AA-B614-E9B94910E393}" }; // Medium Style 2 – Accent 4
    expect(styleCell(t, 0, 0).fill).toEqual(accent("accent4", 0));
    // ids are case-insensitive
    expect(tableStyleOf("{00a15c55-8517-42aa-b614-e9b94910e393}")?.name).toBe("Medium Style 2 - Accent 4");
    const none = { ...table(2, 2), styleId: "{00000000-0000-0000-0000-000000000000}" };
    expect(styleCell(none, 0, 0)).toMatchObject({ fill: null, bold: false });
  });

  it("the gallery groups Best Match (Accent 1 of every family), Light (with the themed styles), Medium and Dark", () => {
    const g = tableStyleGroups();
    expect(g.map((x) => [x.id, x.styles.length])).toEqual([["best", 11], ["light", 35], ["medium", 28], ["dark", 11]]);
    expect(g[0]!.styles.map((s) => s.name)).toEqual([
      "Themed Style 1 - Accent 1", "Themed Style 2 - Accent 1", "Light Style 1 - Accent 1", "Light Style 2 - Accent 1", "Light Style 3 - Accent 1",
      "Medium Style 1 - Accent 1", "Medium Style 2 - Accent 1", "Medium Style 3 - Accent 1", "Medium Style 4 - Accent 1", "Dark Style 1 - Accent 1",
      "Dark Style 2 - Accent 1/Accent 2",
    ]);
    expect(g[1]!.styles[0]!.name).toBe("No Style, No Grid");
  });

  it("Light Style 1: no grid, accent lines at the top, bottom and under the header, banded fill", () => {
    const t = { ...table(4, 3), styleId: "{3B4B98B0-60AC-42C2-AFA5-B58CD77FA1E5}" };
    const head = styleCell(t, 0, 1);
    expect(head.borders.top).toEqual({ color: accent("accent1", 0), width: 12700 });
    expect(head.borders.bottom).toEqual({ color: accent("accent1", 0), width: 12700 });
    expect(head.borders.left).toBeNull();
    expect(styleCell(t, 1, 1).fill).toEqual(accent("accent1", 0.8));
    expect(styleCell(t, 2, 1).fill).toBeNull();
  });

  it("Dark Style 2 pairs take the next accent for the header", () => {
    const t = { ...table(3, 3), styleId: "{46F890A9-2807-4EBB-B81D-B2AA78EC7F39}" }; // Accent 5/Accent 6
    expect(styleCell(t, 0, 0).fill).toEqual(accent("accent6", 0));
    expect(styleCell(t, 1, 0).fill).toEqual(accent("accent5", 0.6));
  });

  it("the presentation's own styles are found first", () => {
    const own = { id: "{11111111-2222-3333-4444-555555555555}", name: "Mine", whole: { fill: { kind: "solid" as const, value: { kind: "rgb" as const, value: "00FF00" } } } };
    const t = { ...table(2, 2), styleId: own.id };
    expect(styleCell(t, 1, 1).fill).toBeNull();
    expect(styleCell(t, 1, 1, [own]).fill).toEqual({ kind: "rgb", value: "00FF00" });
  });

  it("look options: total row and first column are emphasised, banded columns alternate", () => {
    const t = { ...table(3, 3), look: { lastRow: true, firstCol: true, bandCols: true } };
    expect(styleCell(t, 2, 1).bold).toBe(true);
    expect(styleCell(t, 1, 0).bold).toBe(true);
    expect(styleCell(t, 1, 1).fill).toEqual(accent("accent1", 0.6));
    expect(styleCell(t, 1, 2).fill).toEqual(accent("accent1", 0.8));
  });

  it("a cell's own fill and borders override the style (no fill = none)", () => {
    const t = table(2, 2);
    t.cells[1]![1]!.fill = { kind: "solid", value: { kind: "rgb", value: "FF0000" } };
    t.cells[1]![0]!.fill = { kind: "none" };
    t.cells[1]![0]!.borders = { top: NO_LINE };
    expect(effectiveFill(t, 1, 1)).toEqual({ kind: "rgb", value: "FF0000" });
    expect(effectiveFill(t, 1, 0)).toBeNull();
    expect(effectiveBorders(t, 1, 0).top).toBeNull();
    expect(effectiveBorders(t, 1, 0).left).not.toBeNull();
  });

  it("style gallery and look check boxes keep the other setting", () => {
    const t = table(2, 2);
    const accent2 = "{21E4AEA4-8DFA-4A89-87EB-49C32662AFE0}";
    expect(styleCommand(7, t, accent2)).toEqual({ type: "setTableStyle", shape: 7, styleId: accent2, look: t.look });
    expect(lookCommand(7, t, "lastRow", true)).toEqual({ type: "setTableStyle", shape: 7, styleId: DEFAULT_TABLE_STYLE, look: { firstRow: true, bandRows: true, lastRow: true } });
  });
});

describe("merged cells and ranges", () => {
  const t = table(3, 3, [[0, 1, 2, 2]]);

  it("finds the anchor of a covered cell", () => {
    expect(anchorOf(t, 1, 2)).toEqual([0, 1]);
    expect(anchorOf(t, 2, 2)).toEqual([2, 2]);
  });

  it("grows a range over the merged regions it touches", () => {
    expect(expandRange(t, { r0: 1, c0: 0, r1: 1, c1: 1 })).toEqual({ r0: 0, c0: 0, r1: 1, c1: 2 });
    expect(cellsIn(t, { r0: 0, c0: 0, r1: 1, c1: 2 })).toEqual([[0, 0], [0, 1], [1, 0]]);
  });

  it("Merge Cells covers the grown range; one cell gives nothing", () => {
    expect(mergeCommand(4, table(3, 3), { r0: 1, c0: 1, r1: 1, c1: 0 } as never)).toBeNull(); // reversed range: nothing valid
    expect(mergeCommand(4, table(3, 3), { r0: 1, c0: 0, r1: 1, c1: 1 })).toEqual({ type: "mergeTableCells", shape: 4, row: 1, col: 0, rowSpan: 1, colSpan: 2 });
    expect(mergeCommand(4, t, { r0: 0, c0: 1, r1: 1, c1: 2 })).toBeNull();
    expect(mergeCommand(4, t, { r0: 1, c0: 0, r1: 1, c1: 1 })).toEqual({ type: "mergeTableCells", shape: 4, row: 0, col: 0, rowSpan: 2, colSpan: 3 });
  });

  it("Split Cell undoes the merge of the region (from any of its cells)", () => {
    expect(splitCommand(4, t, 1, 2)).toEqual({ type: "splitTableCell", shape: 4, row: 0, col: 1 });
    expect(splitCommand(4, t, 2, 0)).toBeNull();
  });
});

describe("keyboard between cells", () => {
  const t = table(2, 3, [[0, 1, 1, 2]]);

  it("Tab / Shift+Tab in reading order; Tab in the last cell adds a row", () => {
    expect(moveCell(t, 0, 0, "next")).toEqual([0, 1]);
    expect(moveCell(t, 0, 1, "next")).toEqual([1, 0]);
    expect(moveCell(t, 1, 0, "prev")).toEqual([0, 1]);
    expect(moveCell(t, 1, 2, "next")).toBe("insertRow");
    expect(moveCell(t, 0, 0, "prev")).toBeNull();
  });

  it("arrows move over merged cells and wrap left / right at the row ends", () => {
    expect(moveCell(t, 1, 2, "up")).toEqual([0, 1]);
    expect(moveCell(t, 0, 1, "down")).toEqual([1, 1]);
    expect(moveCell(t, 0, 1, "right")).toEqual([1, 0]);
    expect(moveCell(t, 1, 0, "left")).toEqual([0, 1]);
    expect(moveCell(t, 1, 1, "down")).toBeNull();
  });

  it("arrow keys leave the cell only at the text's edges", () => {
    expect(keyMove("Tab", true, "ab", 1, 1)).toBe("prev");
    expect(keyMove("ArrowUp", false, "ab\ncd", 1, 1)).toBe("up");
    expect(keyMove("ArrowUp", false, "ab\ncd", 4, 4)).toBeNull();
    expect(keyMove("ArrowDown", false, "ab\ncd", 4, 4)).toBe("down");
    expect(keyMove("ArrowLeft", false, "ab", 0, 0)).toBe("left");
    expect(keyMove("ArrowRight", false, "ab", 2, 2)).toBe("right");
    expect(keyMove("ArrowRight", false, "ab", 0, 2)).toBeNull();
    expect(keyMove("Enter", false, "ab", 2, 2)).toBeNull();
  });
});

describe("Layout commands", () => {
  const t = table(3, 3);

  it("inserts as many rows / columns as selected, above / below / left / right", () => {
    expect(insertRowsCommand(1, t, { r0: 1, c0: 0, r1: 2, c1: 0 }, true)).toEqual({
      type: "compound",
      commands: [{ type: "insertTableRow", shape: 1, index: 3 }, { type: "insertTableRow", shape: 1, index: 3 }],
    });
    expect(insertRowsCommand(1, t, { r0: 1, c0: 0, r1: 1, c1: 0 }, false)).toEqual({ type: "insertTableRow", shape: 1, index: 1 });
    expect(insertColsCommand(1, t, { r0: 0, c0: 2, r1: 0, c1: 2 }, true)).toEqual({ type: "insertTableCol", shape: 1, index: 3 });
  });

  it("deletes rows / columns bottom-up; all of them deletes the table", () => {
    expect(deleteRowsCommand(1, t, { r0: 0, c0: 0, r1: 1, c1: 0 })).toEqual({
      type: "compound",
      commands: [{ type: "deleteTableRow", shape: 1, index: 1 }, { type: "deleteTableRow", shape: 1, index: 0 }],
    });
    expect(deleteColsCommand(1, t, { r0: 0, c0: 0, r1: 0, c1: 2 })).toEqual({ type: "deleteShapes", ids: [1] });
  });

  it("borders: all in one command, outside as four edges, none as explicit no-line", () => {
    const line = { fill: { kind: "solid" as const, value: { kind: "rgb" as const, value: "000000" } }, width: 12700, dash: "solid" as const };
    const r = { r0: 0, c0: 0, r1: 1, c1: 1 };
    expect(bordersCommand(1, r, "all", line)).toMatchObject({ type: "setTableCellProps", rowSpan: 2, colSpan: 2, patch: { left: line, top: line } });
    const out = bordersCommand(1, r, "outside", line);
    expect(out?.type === "compound" && out.commands.map((c) => (c.type === "setTableCellProps" ? Object.keys(c.patch)[0] : ""))).toEqual(["top", "bottom", "left", "right"]);
    expect(bordersCommand(1, r, "none", line)).toMatchObject({ patch: { left: NO_LINE, bottom: NO_LINE } });
    expect(bordersCommand(1, { r0: 0, c0: 0, r1: 0, c1: 0 }, "insideH", line)).toBeNull();
  });

  it("distributes the selected rows / columns evenly (all for one)", () => {
    const u = { ...table(2, 3), cols: [{ width: 100 }, { width: 200 }, { width: 600 }] };
    expect(distributeCommand(1, u, { r0: 0, c0: 0, r1: 0, c1: 1 }, "cols")).toEqual({ type: "setTableGrid", shape: 1, colWidths: [150, 150, 600] });
    expect(distributeCommand(1, u, null, "cols")).toEqual({ type: "setTableGrid", shape: 1, colWidths: [300, 300, 300] });
    expect(distributeCommand(1, table(2, 2), null, "rows")).toBeNull();
  });

  it("dragging borders: neighbouring columns share the change (minimum width), rows grow", () => {
    expect(resizeColCommand(1, t, 0, 200000)).toEqual({ type: "setTableGrid", shape: 1, colWidths: [1200000, 800000, 1000000] });
    expect(resizeColCommand(1, t, 0, 5000000)).toEqual({ type: "setTableGrid", shape: 1, colWidths: [1908560, 91440, 1000000] });
    expect(resizeColCommand(1, t, 2, -100)).toEqual({ type: "setTableGrid", shape: 1, colWidths: [1000000, 1000000, 999900] });
    expect(resizeRowCommand(1, t, 1, 100000)).toEqual({ type: "setTableGrid", shape: 1, rowHeights: [370840, 470840, 370840] });
    expect(resizeRowCommand(1, t, 1, 0)).toBeNull();
  });

  it("horizontal alignment rewrites the selected cells' paragraphs", () => {
    const c = alignCommand(1, t, { r0: 0, c0: 0, r1: 0, c1: 1 }, "center");
    expect(c?.type).toBe("compound");
    expect(c?.type === "compound" && c.commands[1]).toMatchObject({ type: "setTableCellText", row: 0, col: 1, body: { paragraphs: [{ props: { alignment: "center" }, runs: [{ text: "01" }] }] } });
  });
});
