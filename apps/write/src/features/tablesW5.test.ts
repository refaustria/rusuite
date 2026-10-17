// P9-W5: Split Table / join, text ↔ table, AutoFit, the Table Properties
// form, the Border Painter and the Borders and Shading dialog's lines,
// special-character keys, AutoCorrect, the ruler's drag math and units, the
// unequal columns' margins and File › Options.

import { afterEach, describe, expect, it } from "vitest";
import type { Editor } from "@tiptap/core";
import { CellSelection } from "@tiptap/pm/tables";
import type { Block } from "../generated/Block";
import { makeDoc, para } from "../test/fixtures";
import { makeEditor, select } from "../test/harness";
import { findPos } from "../sync/SyncPlugin";
import { tableContext, SINGLE_BORDER, NO_BORDER } from "./tables";
import {
  autoFitCommand, columnsFor, contentWidths, edgeAt, guessSeparator, joinTablesTarget, paintEdgeCommands, rectBordersCommands, rowsFor,
  selectedTextBlocks, separatorOf, settingBorders, settingOf, splitTableCommand, tablePropsForm, tablePropsFormCommands, tableToTextCommand,
  textToTableCommand,
} from "./tables2";
import { specialCharFor, type KeyLike } from "./specialChars";
import { correction, opensQuote, quotesFor, smartQuote } from "./autoCorrect";
import { columnMarkers, dragIndent, formatLength, indentFrom, indentsOf, markerPositions, rulerTicks, snapTo } from "./rulerDrag";
import { columnBoxes, columnMargins, cssColumnOf } from "./unequalColumns";
import { DEFAULT_AUTOCORRECT, loadOptions, rulerUnitOf, saveOptions, unitForLocale } from "./writeOptions";
import { floatingTableCss, columnsCss, isUnequal } from "../sync/schema";
import { shortcutOf } from "./symbols";

type Cell = { id: number; gridSpan?: number; vMerge?: "restart" | "continue"; blocks: Block[] };
const c = (id: number, text: string, extra: Partial<Cell> = {}): Cell => ({ id, blocks: [para(id + 100, text)], ...extra });

/** 3 × 3 with a merged header (row 0 over columns 0–1). */
function table(id = 10, rowBase = 11): Block {
  return {
    kind: "table",
    value: {
      id,
      props: { colWidths: [1000, 2000, 3000] },
      rows: [
        { id: rowBase, cells: [c(id * 10 + 0, "head", { gridSpan: 2 }), c(id * 10 + 1, "h2")] },
        { id: rowBase + 1, cells: [c(id * 10 + 2, "a"), c(id * 10 + 3, "b"), c(id * 10 + 4, "c")] },
        { id: rowBase + 2, cells: [c(id * 10 + 5, "x"), c(id * 10 + 6, "y"), c(id * 10 + 7, "z")] },
      ],
    },
  } as Block;
}

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});
const open = (blocks: Block[]) => (editor = makeEditor(makeDoc(blocks)));

describe("Split Table and joining tables", () => {
  it("Ctrl+Shift+Enter splits above the caret's row; in the first row a paragraph goes above the table", () => {
    const e = open([para(1, "before"), table()]);
    select(e, 102 + 100, 0); // cell 102 = row 1
    const t = tableContext(e.state)!;
    const cmd = splitTableCommand(e.state, t)!;
    expect(cmd).toMatchObject({ type: "splitTable", table: 10, at: 1 });
    expect((cmd as { newIds: number[] }).newIds).toHaveLength(2);
    select(e, 200, 0); // header cell, row 0
    const first = splitTableCommand(e.state, tableContext(e.state))!;
    expect(first).toMatchObject({ type: "insertBlocks", after: 1, parent: null });
    expect(splitTableCommand(e.state, null)).toBeNull();
  });

  it("an empty paragraph between two tables is the join target", () => {
    const e = open([table(10, 11), para(5, ""), table(30, 41)]);
    select(e, 5, 0);
    expect(joinTablesTarget(e.state)).toBe(5);
    const e2 = open([table(10, 11), para(5, "text"), table(30, 41)]);
    select(e2, 5, 0);
    expect(joinTablesTarget(e2.state)).toBeNull();
    const e3 = open([para(4, ""), para(5, ""), table(30, 41)]);
    select(e3, 5, 0);
    expect(joinTablesTarget(e3.state)).toBeNull();
  });
});

describe("Convert Text to Table / Table to Text", () => {
  it("guesses the separator and the columns like Word", () => {
    expect(guessSeparator(["a\tb", "c"])).toBe("tab");
    expect(guessSeparator(["a,b", "c"])).toBe("comma");
    expect(guessSeparator(["a", "b"])).toBe("paragraph");
    const tab = separatorOf("tab", "");
    expect(columnsFor(["a\tb\tc", "d\te"], tab)).toBe(3);
    expect(rowsFor(["a\tb\tc", "d\te"], tab, 2)).toBe(3);
    expect(columnsFor(["a", "b", "c"], separatorOf("paragraph", ""))).toBe(1);
    expect(rowsFor(["a", "b", "c"], separatorOf("paragraph", ""), 2)).toBe(2);
    expect(separatorOf("other", ";x")).toEqual({ kind: "other", value: ";" });
  });

  it("commands for the selected paragraphs and the caret's table", () => {
    const e = open([para(1, "a\tb"), para(2, "c\td"), table()]);
    const a = findPos(e.state.doc, 1);
    const b = findPos(e.state.doc, 2);
    e.commands.setTextSelection({ from: a + 1, to: b + 2 });
    const blocks = selectedTextBlocks(e.state);
    expect(blocks.map((n) => n.attrs.id)).toEqual([1, 2]);
    expect(textToTableCommand(blocks, { kind: "tab" }, 2)).toEqual({ type: "convertTextToTable", blocks: [1, 2], separator: { kind: "tab" }, cols: 2 });
    expect(textToTableCommand([], { kind: "tab" }, 2)).toBeNull();
    select(e, 203, 0);
    expect(tableToTextCommand(tableContext(e.state)!, { kind: "comma" })).toEqual({ type: "convertTableToText", table: 10, separator: { kind: "comma" } });
  });
});

describe("AutoFit", () => {
  it("Contents widths: the widest content plus padding, scaled into the window", () => {
    expect(contentWidths([[1000, 200], [1500, 0]], 216, 9000)).toEqual([1716, 416]);
    const big = contentWidths([[9000, 9000]], 216, 9000);
    expect(big.reduce((s, w) => s + w, 0)).toBeLessThanOrEqual(9001);
    expect(contentWidths([[0, 0]], 216, 9000)).toEqual([360, 360]);
  });

  it("the command carries widths only when they fit the grid", () => {
    const e = open([table()]);
    select(e, 203, 0);
    const t = tableContext(e.state)!;
    expect(autoFitCommand(t, "window")).toEqual({ type: "autoFitTable", table: 10, mode: "window" });
    expect(autoFitCommand(t, "fixed", [1, 2, 3])).toEqual({ type: "autoFitTable", table: 10, mode: "fixed", colWidths: [1, 2, 3] });
    expect(autoFitCommand(t, "contents", [1, 2])).toEqual({ type: "autoFitTable", table: 10, mode: "contents" });
  });
});

describe("Table Properties", () => {
  it("only what changed is sent: table, wrapping, row, column and cell", () => {
    const e = open([table()]);
    select(e, 203, 0);
    const t = tableContext(e.state)!;
    const before = tablePropsForm(t, [1000, 2000, 3000]);
    expect(before).toMatchObject({ alignment: "left", wrap: "none", widthOn: false, colWidth: 2000, vAlign: "top" });
    expect(tablePropsFormCommands(t, before, before, [1000, 2000, 3000])).toEqual([]);
    const cmds = tablePropsFormCommands(
      t,
      before,
      { ...before, widthOn: true, widthUnit: "pct", width: 80, wrap: "around", heightOn: true, height: 567, heightRule: "exact", colWidthOn: true, colWidth: 2500, vAlign: "center" },
      [1000, 2000, 3000],
    );
    expect(cmds).toContainEqual({ type: "setTableProps", table: 10, patch: { width: { kind: "pct", value: 4000 }, colWidths: [1000, 2500, 3000] } });
    expect(cmds).toContainEqual(expect.objectContaining({ type: "setTableWrap", table: 10, floating: expect.objectContaining({ leftFromText: 180, vertAnchor: "text" }) }));
    expect(cmds).toContainEqual({ type: "setRowProps", table: 10, rows: [1], height: { value: 567, rule: "exact" } });
    expect(cmds).toContainEqual({ type: "setCellProps", cells: [103], patch: { verticalAlign: "center" } });
    // Around → None removes the wrapping
    const around = { ...before, wrap: "around" as const };
    expect(tablePropsFormCommands(t, around, before, [])).toEqual([{ type: "setTableWrap", table: 10, floating: null }]);
  });

  it("a floating table floats beside the text", () => {
    expect(floatingTableCss(null)).toEqual([]);
    expect(floatingTableCss({ leftFromText: 180, rightFromText: 180, topFromText: 0, bottomFromText: 0, x: 0, y: 0, xSpec: "end" })).toContain("float: right");
    expect(floatingTableCss({ leftFromText: 180, rightFromText: 180, topFromText: 0, bottomFromText: 0, x: 0, y: 0 })).toContain("float: left");
    expect(floatingTableCss({ leftFromText: 0, rightFromText: 0, topFromText: 0, bottomFromText: 0, x: 0, y: 0, xSpec: "center" })).toContain("margin-left: auto");
  });
});

describe("Border Painter and Borders and Shading", () => {
  it("edgeAt finds the edge under the pointer", () => {
    const r = { left: 0, top: 0, right: 100, bottom: 40 };
    expect(edgeAt(r, 50, 1)).toBe("top");
    expect(edgeAt(r, 99, 20)).toBe("right");
    expect(edgeAt(r, 50, 39)).toBe("bottom");
    expect(edgeAt(r, 2, 20)).toBe("left");
    expect(edgeAt(r, 50, 20)).toBeNull();
  });

  it("painting an edge sets it on the cell and the facing edge of its neighbours", () => {
    const e = open([table()]);
    const node = e.state.doc.nodeAt(findPos(e.state.doc, 10))!;
    const pen = { style: "double" as const, width: 15, color: { kind: "auto" as const } };
    // bottom of the merged header (columns 0–1): the two cells below get their top
    const cmds = paintEdgeCommands(node, { top: 0, left: 0, bottom: 1, right: 2 }, "bottom", pen);
    expect(cmds).toEqual([
      { type: "setCellProps", cells: [100], patch: { borders: { bottom: pen } } },
      { type: "setCellProps", cells: [102, 103], patch: { borders: { top: pen } } },
    ]);
    // an outer edge has no neighbour
    expect(paintEdgeCommands(node, { top: 2, left: 2, bottom: 3, right: 3 }, "right", pen)).toHaveLength(1);
  });

  it("settings Box / All / Grid / None and Custom", () => {
    const pen = { style: "single" as const, width: 30, color: { kind: "auto" as const } };
    expect(settingBorders("box", pen)).toMatchObject({ top: pen, insideH: NO_BORDER });
    expect(settingBorders("grid", pen)).toMatchObject({ left: pen, insideV: SINGLE_BORDER });
    expect(settingOf(settingBorders("all", pen), pen)).toBe("all");
    expect(settingOf({ top: pen }, pen)).toBe("custom");
  });

  it("the lines go to the selection's outer and inner edges, or to the table", () => {
    const e = open([table()]);
    const pa = findPos(e.state.doc, 102);
    const pb = findPos(e.state.doc, 107);
    e.view.dispatch(e.state.tr.setSelection(CellSelection.create(e.state.doc, pa, pb)));
    const t = tableContext(e.state)!;
    const b = settingBorders("grid", SINGLE_BORDER);
    const cmds = rectBordersCommands(t, b, false);
    const all = cmds.flatMap((x) => (x.type === "setCellProps" ? x.cells : []));
    expect(all.sort()).toEqual([102, 103, 104, 105, 106, 107]);
    expect(rectBordersCommands(t, b, true)).toEqual([{ type: "setTableProps", table: 10, patch: { borders: b } }]);
  });
});

const key = (k: Partial<KeyLike>): KeyLike => ({ key: "", code: "", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, ...k });

describe("special characters", () => {
  it("Word's keys", () => {
    expect(specialCharFor(key({ altKey: true, code: "NumpadSubtract", key: "-" }))).toBe("—");
    expect(specialCharFor(key({ code: "NumpadSubtract", key: "-" }))).toBe("–");
    expect(specialCharFor(key({ shiftKey: true, code: "Space", key: " " }))).toBe(" ");
    expect(specialCharFor(key({ shiftKey: true, code: "Minus", key: "_" }))).toBe("‑");
    expect(specialCharFor(key({ code: "Slash", key: "-" }))).toBe("­"); // German keyboard
    expect(specialCharFor(key({ altKey: true, code: "KeyC", key: "c" }))).toBe("©");
    expect(specialCharFor(key({ altKey: true, code: "KeyR", key: "r" }))).toBe("®");
    expect(specialCharFor(key({ altKey: true, code: "KeyT", key: "t" }))).toBe("™");
    expect(specialCharFor(key({ altKey: true, code: "Period", key: "." }))).toBe("…");
    expect(specialCharFor(key({ ctrlKey: false, code: "Minus", key: "-" }))).toBeNull();
    expect(specialCharFor(key({ code: "KeyC", key: "c" }))).toBeNull();
    expect(shortcutOf("©")).toBe("Alt+Ctrl+C");
    expect(shortcutOf("x")).toBeNull();
  });
});

describe("AutoCorrect", () => {
  const o = DEFAULT_AUTOCORRECT;
  it("smart quotes by language and position", () => {
    expect(quotesFor("de")[0]).toBe("„");
    expect(opensQuote("")).toBe(true);
    expect(opensQuote("word")).toBe(false);
    expect(smartQuote('"', "say ", "en")).toBe("“");
    expect(smartQuote('"', "say hi", "en")).toBe("”");
    expect(smartQuote('"', "", "de")).toBe("„");
    expect(smartQuote("'", "don", "en")).toBe("’");
    expect(correction("x", '"', o, "en")).toEqual({ remove: 0, text: "”" });
    expect(correction("x", '"', { ...o, smartQuotes: false }, "en")).toBeNull();
  });

  it("dashes, (c) (r) (tm) and the ellipsis; ordinals only when on", () => {
    expect(correction("a -- b", " ", o, "en")).toEqual({ remove: 4, text: "– b " });
    expect(correction("a--b", " ", o, "en")).toEqual({ remove: 3, text: "—b " });
    expect(correction("(c", ")", o, "en")).toEqual({ remove: 2, text: "©" });
    expect(correction("(t", "m", o, "en")).toBeNull();
    expect(correction("(tm", ")", o, "en")).toEqual({ remove: 3, text: "™" });
    expect(correction("wait..", ".", o, "en")).toEqual({ remove: 2, text: "…" });
    expect(correction("the 1st", " ", o, "en")).toBeNull();
    expect(correction("the 1st", " ", { ...o, ordinals: true }, "en")).toEqual({ remove: 3, text: "1st ", superscript: 2 });
    expect(correction("plain", " ", o, "en")).toBeNull();
  });
});

describe("ruler", () => {
  it("indent markers move like Word's", () => {
    const start = indentsOf({ left: 720, firstLine: 360 });
    expect(start).toEqual({ left: 720, right: 0, first: 360 });
    expect(markerPositions(start, 9000)).toEqual({ firstLine: 1080, hanging: 720, left: 720, right: 9000 });
    // first line only
    expect(dragIndent(start, "firstLine", 1440, 9000)).toEqual({ left: 720, right: 0, first: 720 });
    // hanging: the left indent moves, the first line stays at 1080
    expect(dragIndent(start, "hanging", 1440, 9000)).toEqual({ left: 1440, right: 0, first: -360 });
    // the box moves both
    expect(dragIndent(start, "left", 0, 9000)).toEqual({ left: 0, right: 0, first: 360 });
    // right indent
    expect(dragIndent(start, "right", 8000, 9000)).toEqual({ left: 720, right: 1000, first: 360 });
    // at least 360 twips of text
    expect(dragIndent(start, "right", 0, 9000).right).toBe(9000 - 1080 - 360);
    expect(indentFrom({ left: 1440, right: 0, first: -360 })).toEqual({ left: 1440, right: 0, firstLine: null, hanging: 360 });
    expect(indentsOf({ hanging: 283 }).first).toBe(-283);
  });

  it("scale and snapping in cm or inches; table column markers", () => {
    const cmTicks = rulerTicks(200, "cm");
    expect(cmTicks.filter((t) => t.label != null).map((t) => t.label)).toEqual([1, 2, 3, 4, 5]);
    const inTicks = rulerTicks(200, "in");
    expect(inTicks.filter((t) => t.label != null).map((t) => t.label)).toEqual([1, 2]);
    expect(inTicks.filter((t) => t.kind === "minor").length).toBeGreaterThan(8);
    expect(snapTo("in", 200)).toBe(180);
    expect(snapTo("cm", 300)).toBe(283);
    expect(formatLength(1440, "in")).toBe('1"');
    expect(formatLength(567, "cm")).toBe("1 cm");
    expect(columnMarkers([1000, 2000])).toEqual([1000, 3000]);
  });
});

describe("unequal columns", () => {
  it("explicit column boxes: each child gets its column's place and width", () => {
    const cols = { count: 2, equal: false, widths: [{ width: 3000, space: 720 }, { width: 5306, space: 0 }] };
    expect(isUnequal(cols)).toBe(true);
    expect(isUnequal({ count: 2, equal: true })).toBe(false);
    expect(columnsCss(cols)).toContain("column-gap: 0");
    const boxes = columnBoxes(cols, 9026 / 15);
    expect(boxes[0]).toEqual({ x: 0, width: 200 });
    expect(boxes[1]!.x).toBeCloseTo(248, 5);
    const total = 9026 / 15;
    const m0 = columnMargins(total, 2, 0, boxes[0]!.x, boxes[0]!.width);
    expect(m0.left).toBe(0);
    expect(total / 2 - m0.left - m0.right).toBeCloseTo(200, 5);
    const m1 = columnMargins(total, 2, 1, boxes[1]!.x, boxes[1]!.width);
    // column 1 starts at its CSS column's origin plus the margin
    expect(total / 2 + m1.left).toBeCloseTo(248, 5);
    expect(total / 2 - m1.left - m1.right).toBeCloseTo(boxes[1]!.width, 5);
    expect(cssColumnOf(total / 2 + m1.left, m1.left, total, 2)).toBe(1);
    expect(cssColumnOf(3, 0, total, 2)).toBe(0);
  });
});

describe("File › Options", () => {
  it("units by locale, saved options", () => {
    expect(unitForLocale("en-US")).toBe("in");
    expect(unitForLocale("en")).toBe("in");
    expect(unitForLocale("en-GB")).toBe("cm");
    expect(unitForLocale("de-AT")).toBe("cm");
    const store = new Map<string, string>();
    const s = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    expect(loadOptions(s).autoCorrect.ordinals).toBe(false);
    saveOptions({ rulerUnit: "in", autoCorrect: { ...DEFAULT_AUTOCORRECT, smartQuotes: false } }, s);
    const back = loadOptions(s);
    expect(back.rulerUnit).toBe("in");
    expect(back.autoCorrect.smartQuotes).toBe(false);
    expect(rulerUnitOf(back, "de")).toBe("in");
    expect(rulerUnitOf({ ...back, rulerUnit: null }, "de")).toBe("cm");
    const bad = { getItem: () => "{nope", setItem: () => undefined };
    expect(loadOptions(bad).rulerUnit).toBeNull();
  });
});
