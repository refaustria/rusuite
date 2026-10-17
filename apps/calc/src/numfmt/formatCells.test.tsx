// P8-44 (C-08): Format Cells tabs → commands, and the dialog driven through the App.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import App from "../App";
import { FakeBackend, FakeCalcCore } from "../dev/fakeBackend";
import type { BorderSide } from "../generated/BorderSide";
import type { Request } from "../generated/Request";
import { computeRenderOps, shrunkFont } from "../grid/render";
import { applyBorderEdits, borderEdits, borderPreset, EDGES, formatCommands, formatState, stylePatch, toggleEdge } from "./formatCells";

const thin: BorderSide = { style: "thin", color: { kind: "auto" } };
const red: BorderSide = { style: "medium", color: { kind: "rgb", value: "FF0000" } };
const R = { r0: 0, c0: 0, r1: 1, c1: 1 };

describe("Format Cells state", () => {
  it("reads defaults from an empty style", () => {
    const s = formatState({});
    expect(s.numberFormat).toBe("General");
    expect(s.horizontal).toBe("general");
    expect(s.vertical).toBe("bottom");
    expect(s.fontFamily).toBe("Calibri");
    expect(s.fontSize).toBe(11);
    expect(s.locked).toBe(true);
    expect(s.hidden).toBe(false);
    expect(s.fill).toBeNull();
    expect(EDGES.every((e) => s.edges[e] === null)).toBe(true);
  });

  it("reads alignment, font, fill, borders and protection", () => {
    const s = formatState({
      alignment: { horizontal: "center", indent: 2, wrapText: true, textRotation: 45, shrinkToFit: true },
      font: { bold: true, italic: true, size: 1400, underline: "double", strike: true, verticalAlign: "subscript", font: { kind: "named", value: "Arial" } },
      fill: { kind: "solid", color: { kind: "rgb", value: "FFFF00" } },
      borders: { top: thin, diagonalUp: red },
      protection: { locked: false, hidden: true },
    }, true);
    expect([s.horizontal, s.indent, s.wrapText, s.rotation, s.shrinkToFit, s.merge]).toEqual(["center", 2, true, 45, true, true]);
    expect([s.bold, s.italic, s.fontSize, s.underline, s.strike, s.script, s.fontFamily]).toEqual([true, true, 14, "double", true, "subscript", "Arial"]);
    expect(s.fill).toEqual({ kind: "rgb", value: "FFFF00" });
    expect(s.edges.top).toEqual(thin);
    expect(s.edges.diagonalUp).toEqual(red);
    expect([s.locked, s.hidden]).toEqual([false, true]);
  });

  it("an untouched dialog sends nothing", () => {
    const s = formatState({ font: { bold: true } });
    expect(formatCommands(s, { ...s }, 0, R)).toEqual([]);
  });
});

describe("Format Cells patches", () => {
  const base = formatState({});
  it("Number: only the code", () => {
    expect(stylePatch(base, { ...base, numberFormat: "0.00" })).toEqual({ numberFormat: "0.00" });
  });
  it("Alignment: changed fields, rotation clamped", () => {
    expect(stylePatch(base, { ...base, horizontal: "right", indent: 1, rotation: 120, shrinkToFit: true })).toEqual({
      alignment: { horizontal: "right", indent: 1, textRotation: 90, shrinkToFit: true },
    });
    expect(stylePatch(base, { ...base, vertical: "top", wrapText: true })).toEqual({ alignment: { vertical: "top", wrapText: true } });
  });
  it("Font: family, style, size in hundredths, underline, effects", () => {
    expect(stylePatch(base, { ...base, fontFamily: "Arial", bold: true, fontSize: 14, underline: "double", strike: true, script: "superscript" })).toEqual({
      font: { font: { kind: "named", value: "Arial" }, bold: true, size: 1400, underline: "double", strike: true, verticalAlign: "superscript" },
      underlineAccounting: false,
    });
  });
  it("Font: accounting underlines (P9-C1) read and write the accounting flag", () => {
    expect(stylePatch(base, { ...base, underline: "singleAccounting" })).toEqual({ font: { underline: "single" }, underlineAccounting: true });
    expect(stylePatch(base, { ...base, underline: "doubleAccounting" })).toEqual({ font: { underline: "double" }, underlineAccounting: true });
    expect(formatState({ font: { underline: "double" }, underlineAccounting: true }).underline).toBe("doubleAccounting");
    expect(formatState({ font: { underline: "single" } }).underline).toBe("single");
  });
  it("Fill: a pattern style with pattern colour over the background colour (P9-C1)", () => {
    const red = { kind: "rgb", value: "FF0000" } as const;
    const blue = { kind: "rgb", value: "0000FF" } as const;
    expect(stylePatch(base, { ...base, pattern: "darkTrellis", patternColor: red, fill: blue })).toEqual({
      fill: { kind: "pattern", color: { pattern: "darkTrellis", fg: red, bg: blue } },
    });
    expect(stylePatch(base, { ...base, pattern: "lightGrid" })).toEqual({ fill: { kind: "pattern", color: { pattern: "lightGrid" } } });
    const st = formatState({ fill: { kind: "pattern", color: { pattern: "gray0625", fg: red } } });
    expect([st.pattern, st.patternColor, st.fill]).toEqual(["gray0625", red, null]);
    // Pattern Style None leaves the background colour as a solid fill.
    expect(stylePatch(st, { ...st, pattern: null, fill: blue })).toEqual({ fill: { kind: "solid", color: blue } });
  });
  it("Font colour back to automatic is the auto colour", () => {
    const coloured = formatState({ font: { color: { kind: "rgb", value: "FF0000" } } });
    expect(stylePatch(coloured, { ...coloured, color: null })).toEqual({ font: { color: { kind: "auto" } } });
  });
  it("Fill: a colour, then No Color", () => {
    expect(stylePatch(base, { ...base, fill: { kind: "rgb", value: "00FF00" } })).toEqual({ fill: { kind: "solid", color: { kind: "rgb", value: "00FF00" } } });
    const filled = formatState({ fill: { kind: "solid", color: { kind: "rgb", value: "00FF00" } } });
    expect(stylePatch(filled, { ...filled, fill: null })).toEqual({ fill: { kind: "none" } });
  });
  it("Protection: locked off, hidden on", () => {
    expect(stylePatch(base, { ...base, locked: false, hidden: true })).toEqual({ protection: { locked: false, hidden: true } });
  });
});

describe("Format Cells borders", () => {
  const base = formatState({});
  it("Outline sets the four outer edges", () => {
    const e = borderPreset(base.edges, "outline", thin);
    expect([e.top, e.bottom, e.left, e.right]).toEqual([thin, thin, thin, thin]);
    expect(e.insideHorizontal).toBeNull();
  });
  it("Inside sets the lines between the cells", () => {
    const e = borderPreset(base.edges, "inside", thin);
    expect([e.insideHorizontal, e.insideVertical, e.top]).toEqual([thin, thin, null]);
  });
  it("None clears every edge", () => {
    const e = borderPreset(borderPreset(base.edges, "outline", thin), "none", thin);
    expect(EDGES.every((x) => e[x] === null)).toBe(true);
  });
  it("a button toggles its edge; another style replaces it", () => {
    let e = toggleEdge(base.edges, "diagonalDown", thin);
    expect(e.diagonalDown).toEqual(thin);
    e = toggleEdge(e, "diagonalDown", red);
    expect(e.diagonalDown).toEqual(red);
    e = toggleEdge(e, "diagonalDown", red);
    expect(e.diagonalDown).toBeNull();
  });
  it("edits name only the changed edges, removals as none", () => {
    const init = formatState({ borders: { top: thin } });
    const next = { ...init, edges: { ...init.edges, top: null, bottom: red } };
    expect(borderEdits(init, next)).toEqual({ top: { kind: "none" }, bottom: { kind: "line", side: red } });
  });
  it("applying edits per cell: outline corners and inside lines", () => {
    const edits = { top: { kind: "line" as const, side: thin }, insideHorizontal: { kind: "line" as const, side: red } };
    expect(applyBorderEdits({}, 0, 0, R, edits)).toEqual({ top: thin, bottom: red });
    expect(applyBorderEdits({}, 1, 1, R, edits)).toEqual({ top: red });
    expect(applyBorderEdits({ left: thin }, 1, 0, R, { left: { kind: "none" } })).toEqual({});
  });
});

describe("Format Cells commands", () => {
  const base = formatState({});
  it("several tabs make one list: merge, style patch, borders", () => {
    const next = { ...base, merge: true, bold: true, edges: borderPreset(base.edges, "outline", thin) };
    const cmds = formatCommands(base, next, 2, R);
    expect(cmds.map((c) => c.type)).toEqual(["mergeCells", "applyStyle", "setBorders"]);
    expect(cmds[0]).toEqual({ type: "mergeCells", sheet: 2, r0: 0, c0: 0, r1: 1, c1: 1 });
  });
  it("unchecking Merge cells unmerges; a single cell is never merged", () => {
    const merged = formatState({}, true);
    expect(formatCommands(merged, { ...merged, merge: false }, 0, R)[0].type).toBe("unmergeCells");
    expect(formatCommands(base, { ...base, merge: true }, 0, { r0: 3, c0: 3, r1: 3, c1: 3 })).toEqual([]);
  });
});

describe("rendering of the new alignment and border properties", () => {
  const measure = (s: string) => s.length * 10;
  it("shrink to fit scales the font down to the width", () => {
    expect(shrunkFont({ alignment: { shrinkToFit: true } }, "abcdefghij", 50, "14.67px Calibri", measure)).toBe("7.33px Calibri");
    expect(shrunkFont({ alignment: { shrinkToFit: true } }, "ab", 50, "14.67px Calibri", measure)).toBe("14.67px Calibri");
    expect(shrunkFont({ alignment: { shrinkToFit: true, wrapText: true } }, "abcdefghij", 50, "14.67px Calibri", measure)).toBe("14.67px Calibri");
  });
});

describe("rendering ops", () => {
  it("draws diagonals and rotated text", async () => {
    const { colGeometry, rowGeometry, DEFAULT_FORMAT } = await import("../grid/geometry");
    const colGeo = colGeometry(DEFAULT_FORMAT, new Map());
    const rowGeo = rowGeometry(DEFAULT_FORMAT, new Map());
    const h = rowGeo.size(0);
    const ops = computeRenderOps(
      { scrollX: 0, scrollY: 0, width: 300, height: 100 },
      {
        colGeo, rowGeo, rows: new Map(), cols: new Map(), merges: [],
        cells: new Map([[0, new Map([[0, { row: 0, col: 0, input: "x", display: "x", kind: "text", style: 1 }]])]]),
      } as never,
      [{}, { borders: { diagonalUp: thin }, alignment: { textRotation: 30 } }],
    );
    expect(ops.some((o) => o.op === "line" && o.y1 === h && o.y2 === 0)).toBe(true);
    expect(ops.some((o) => o.op === "text" && o.rotation === 30)).toBe(true);
  });
});

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function setup() {
  const core = new FakeCalcCore();
  render(<App backend={new FakeBackend(core)} />);
  await screen.findByRole("tab", { name: "Sheet1" });
  await waitFor(() => expect(core.log.some((q) => q.type === "snapshot")).toBe(true));
  core.log.length = 0;
  const grid = screen.getByTestId("grid");
  grid.focus();
  return { core, grid };
}
const applied = (log: Request[]) => log.flatMap((q) => (q.type === "apply" ? [q.command] : []));

describe("Format Cells dialog", () => {
  it("Ctrl+1 opens on Number with the six tabs", async () => {
    const { grid } = await setup();
    fireEvent.keyDown(grid, { key: "1", ctrlKey: true });
    const dlg = screen.getByRole("dialog", { name: "Format cells" });
    const tabs = within(dlg).getAllByRole("tab").map((x) => x.textContent);
    expect(tabs).toEqual(["Number", "Alignment", "Font", "Border", "Fill", "Protection"]);
    expect(within(dlg).getByRole("tab", { name: "Number" }).getAttribute("aria-selected")).toBe("true");
  });

  it("Border Outline + Fill + Bold apply as one compound", async () => {
    const { core, grid } = await setup();
    fireEvent.keyDown(grid, { key: "1", ctrlKey: true });
    const dlg = screen.getByRole("dialog", { name: "Format cells" });
    fireEvent.click(within(dlg).getByRole("tab", { name: "Border" }));
    fireEvent.click(within(dlg).getByRole("button", { name: "Outline" }));
    expect(within(dlg).getByRole("button", { name: "Top border" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(within(dlg).getByRole("tab", { name: "Fill" }));
    fireEvent.click(within(dlg).getByRole("button", { name: "#FFFF00" }));
    fireEvent.click(within(dlg).getByRole("tab", { name: "Font" }));
    fireEvent.change(within(dlg).getByLabelText("Font style"), { target: { value: "bold" } });
    fireEvent.submit(dlg.querySelector("form")!);
    await waitFor(() => expect(applied(core.log)).toHaveLength(1));
    const cmd = applied(core.log)[0];
    expect(cmd.type).toBe("compound");
    const inner = cmd.type === "compound" ? cmd.commands : [];
    expect(inner.map((c) => c.type)).toEqual(["applyStyle", "setBorders"]);
    expect(inner[0]).toMatchObject({ patch: { font: { bold: true }, fill: { kind: "solid", color: { kind: "rgb", value: "FFFF00" } } } });
    expect(inner[1]).toMatchObject({ edits: { top: { kind: "line" }, bottom: { kind: "line" }, left: { kind: "line" }, right: { kind: "line" } } });
  });

  it("Alignment rotation and Protection send their fields", async () => {
    const { core, grid } = await setup();
    fireEvent.keyDown(grid, { key: "1", ctrlKey: true });
    const dlg = screen.getByRole("dialog", { name: "Format cells" });
    fireEvent.click(within(dlg).getByRole("tab", { name: "Alignment" }));
    fireEvent.change(within(dlg).getByLabelText("Degrees"), { target: { value: "45" } });
    fireEvent.click(within(dlg).getByLabelText("Shrink to fit"));
    fireEvent.click(within(dlg).getByRole("tab", { name: "Protection" }));
    fireEvent.click(within(dlg).getByLabelText("Hidden"));
    fireEvent.submit(dlg.querySelector("form")!);
    await waitFor(() =>
      expect(applied(core.log)).toEqual([
        { type: "applyStyle", sheet: 0, r0: 0, c0: 0, r1: 0, c1: 0, patch: { alignment: { shrinkToFit: true, textRotation: 45 }, protection: { hidden: true } } },
      ]),
    );
  });
});
