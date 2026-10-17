// P9-C2: custom table styles – the look of each element (stripes with
// sizes, header / totals precedence, edges), the style list helpers and
// the New Table Style dialog through the real App.
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import App from "../App";
import { FakeBackend, FakeCalcCore } from "../dev/fakeBackend";
import type { CalcCommand } from "../generated/CalcCommand";
import type { CustomTableStyle } from "../generated/CustomTableStyle";
import type { Request } from "../generated/Request";
import type { Table } from "../generated/Table";
import type { CalcStore } from "../state/store";
import { customLook, freshStyleName, previewColors, tableLook } from "./styles";
import { builtinAsCustom, deleteStyle, isBuiltinStyleName, saveStyle, styleNameProblem, withDefault } from "./TableStyleDialog";

const rgb = (v: string) => ({ kind: "rgb" as const, value: v });

const mine: CustomTableStyle = {
  name: "Mine",
  elements: [
    { type: "wholeTable", dxf: { borders: { top: { style: "thin", color: rgb("000080") }, bottom: { style: "thin", color: rgb("000080") } } } },
    { type: "headerRow", dxf: { bold: true, fill: rgb("000080"), fontColor: rgb("FFFFFF") } },
    { type: "firstRowStripe", size: 2, dxf: { fill: rgb("DDEBF7") } },
    { type: "secondRowStripe", dxf: { fill: rgb("FFFFFF") } },
    { type: "totalRow", dxf: { bold: true, fill: rgb("FFFF00") } },
    { type: "firstColumn", dxf: { fill: rgb("FF0000") } },
  ],
};

/** A1:C8: header, data rows 1–6, totals row 7. */
const table = (over: Partial<Table> = {}): Table => ({
  id: 1, name: "Table1", r0: 0, c0: 0, r1: 7, c1: 2, headerRow: true, totalsRow: true,
  columns: [{ id: 1, name: "A" }, { id: 2, name: "B" }, { id: 3, name: "C" }],
  style: "Mine", look: { firstColumn: false, lastColumn: false, bandedRows: true, bandedColumns: false }, ...over,
});

describe("custom table style looks", () => {
  it("formats the header row over the whole table", () => {
    const l = customLook(mine, table(), 0, 1);
    expect(l).toMatchObject({ fill: "#000080", color: "#FFFFFF", bold: true, top: "#000080" });
  });
  it("bands rows by the stripe sizes (2 + 1)", () => {
    const fills = [1, 2, 3, 4, 5, 6].map((r) => customLook(mine, table(), r, 1).fill);
    expect(fills).toEqual(["#DDEBF7", "#DDEBF7", "#FFFFFF", "#DDEBF7", "#DDEBF7", "#FFFFFF"]);
  });
  it("no stripes without Banded Rows; the first column only with the option", () => {
    expect(customLook(mine, table({ look: { firstColumn: false, lastColumn: false, bandedRows: false, bandedColumns: false } }), 1, 1).fill).toBeUndefined();
    expect(customLook(mine, table(), 2, 0).fill).toBe("#DDEBF7");
    expect(customLook(mine, table({ look: { firstColumn: true, lastColumn: false, bandedRows: true, bandedColumns: false } }), 2, 0).fill).toBe("#FF0000");
  });
  it("the totals row wins and the whole-table border sits on the outer edge only", () => {
    const tot = customLook(mine, table(), 7, 2);
    expect(tot).toMatchObject({ fill: "#FFFF00", bold: true, bottom: "#000080" });
    expect(customLook(mine, table(), 3, 1).bottom).toBeUndefined();
  });
  it("tableLook uses the workbook's custom styles, else the built-ins", () => {
    expect(tableLook(table(), 0, 0, { custom: [mine] })?.fill).toBe("#000080");
    expect(tableLook(table(), 0, 0)).toBeUndefined();
    expect(tableLook(table({ style: "TableStyleMedium2" }), 0, 0, { custom: [mine] })?.fill).toBe("#4472C4");
  });
  it("gives custom styles gallery preview colours", () => {
    expect(previewColors("mine", { custom: [mine] })).toEqual({ header: "#000080", headerText: "#FFFFFF", rows: ["#DDEBF7", "#FFFFFF"], line: "#000080" });
  });
});

describe("custom table style list", () => {
  it("names new styles Table Style 1, 2, …", () => {
    expect(freshStyleName(undefined, "Table Style")).toBe("Table Style 1");
    expect(freshStyleName({ custom: [{ name: "table style 1", elements: [] }] }, "Table Style")).toBe("Table Style 2");
  });
  it("refuses empty, built-in and taken names (the modified style may keep its own)", () => {
    expect(isBuiltinStyleName("TableStyleMedium2")).toBe(true);
    expect(isBuiltinStyleName("Mine")).toBe(false);
    expect(styleNameProblem({ custom: [mine] }, " ")).toBe("empty");
    expect(styleNameProblem({ custom: [mine] }, "TableStyleLight9")).toBe("taken");
    expect(styleNameProblem({ custom: [mine] }, "MINE")).toBe("taken");
    expect(styleNameProblem({ custom: [mine] }, "mine", "Mine")).toBeNull();
  });
  it("saves new and modified styles with a rename and the default flag", () => {
    const a = saveStyle(undefined, mine, null, true);
    expect(a).toEqual({ styles: { custom: [mine], defaultStyle: "Mine" }, renamed: [] });
    const b = saveStyle(a.styles, { ...mine, name: "Ours" }, "Mine", false);
    expect(b.renamed).toEqual([{ from: "Mine", to: "Ours" }]);
    expect(b.styles.custom).toHaveLength(1);
    expect(b.styles.defaultStyle).toBeUndefined();
    const c = saveStyle(a.styles, { ...mine, name: "Ours" }, "Mine", true);
    expect(c.styles.defaultStyle).toBe("Ours");
  });
  it("deletes a style (its default falls back) and sets defaults", () => {
    expect(deleteStyle({ custom: [mine], defaultStyle: "Mine" }, "mine")).toEqual({ custom: [] });
    expect(withDefault({ custom: [mine] }, "TableStyleLight9")).toEqual({ custom: [mine], defaultStyle: "TableStyleLight9" });
    expect(withDefault({ custom: [mine], defaultStyle: "Mine" }, "TableStyleMedium2")).toEqual({ custom: [mine] });
  });
  it("duplicates a built-in style as editable elements", () => {
    const d = builtinAsCustom("TableStyleMedium2", "Copy");
    expect(d.elements.find((e) => e.type === "headerRow")?.dxf.fill).toEqual(rgb("4472C4"));
    expect(customLook(d, table({ style: "Copy" }), 0, 0).fill).toBe("#4472C4");
  });
});

// --- through the App ---------------------------------------------------------

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
});
afterEach(() => cleanup());

const seed: CalcCommand[] = [["Item", "Qty"], ["Pen", "2"], ["Ink", "3"]].flatMap((r, i) =>
  r.map((v, j): CalcCommand => ({ type: "setInput", sheet: 0, row: i, col: j, input: v })),
);

async function setup() {
  const core = new FakeCalcCore();
  render(<App backend={new FakeBackend(core)} />);
  await screen.findByRole("tab", { name: "Sheet1" });
  await waitFor(() => expect(core.log.some((r) => r.type === "snapshot")).toBe(true));
  const store = (window as unknown as { __calc: { store: CalcStore } }).__calc.store;
  for (const c of seed) await act(() => store.apply(c));
  await act(() => store.apply({ type: "createTable", sheet: 0, r0: 0, c0: 0, r1: 2, c1: 1, hasHeaders: true }));
  core.log.length = 0;
  return { core, store };
}

const applied = (log: Request[]): CalcCommand[] => log.flatMap((r) => (r.type === "apply" ? [r.command] : []));

describe("New Table Style dialog", () => {
  it("creates a style, applies it to the table and lists it under Custom", async () => {
    const { core, store } = await setup();
    fireEvent.click(await screen.findByRole("tab", { name: "Table Design" }));
    fireEvent.click(screen.getByRole("button", { name: "Quick Styles" }));
    fireEvent.click(within(screen.getByTestId("table-style-gallery")).getByRole("button", { name: "New Table Style…" }));
    const dlg = await screen.findByRole("dialog", { name: "New Table Style" });
    expect((within(dlg).getByLabelText("Name:") as HTMLInputElement).value).toBe("Table Style 1");
    fireEvent.click(within(dlg).getByRole("option", { name: "Header Row" }));
    fireEvent.input(within(dlg).getByLabelText("Fill:"), { target: { value: "#112233" } });
    fireEvent.click(within(dlg).getByLabelText("Bold"));
    fireEvent.click(within(dlg).getByRole("option", { name: "First Row Stripe" }));
    fireEvent.change(within(dlg).getByLabelText("Stripe Size:"), { target: { value: "2" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "OK" }));
    await waitFor(() => expect(store.getState().info?.tableStyles?.custom).toHaveLength(1));
    const cmds = applied(core.log);
    expect(cmds[0]).toEqual({
      type: "setTableStyles",
      styles: { custom: [{ name: "Table Style 1", elements: [{ type: "headerRow", dxf: { fill: rgb("112233"), bold: true } }, { type: "firstRowStripe", size: 2, dxf: {} }] }] },
    });
    await waitFor(() => expect(store.tables.of(0)[0]!.style).toBe("Table Style 1"));
    fireEvent.click(screen.getByRole("button", { name: "Quick Styles" }));
    const custom = within(screen.getByTestId("table-style-gallery")).getByRole("group", { name: "Custom" });
    expect(within(custom).getByRole("button", { name: "Table Style 1" })).toBeTruthy();
    // Right-click › Set As Default.
    fireEvent.contextMenu(within(custom).getByRole("button", { name: "Table Style 1" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Set As Default" }));
    await waitFor(() => expect(store.getState().info?.tableStyles?.defaultStyle).toBe("Table Style 1"));
  });
});
