import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CalcApi } from "../backend/calcApi";
import { FakeBackend, FakeCalcCore } from "../dev/fakeBackend";
import type { CellStyle } from "../generated/CellStyle";
import { emptyCache, type SheetCache } from "../state/store";
import App from "../App";
import { loadUsedRange } from "./loadUsed";
import { calcPageCss, DEFAULT_PRINT_SETUP, fitZoom, resolveOrientation } from "./printCss";
import { PrintTableView } from "./PrintTableView";
import { buildPrintTable } from "./printTable";
import { CalcStore } from "../state/store";

afterEach(cleanup);

describe("print CSS", () => {
  const s = DEFAULT_PRINT_SETUP;
  it("@page from paper and orientation", () => {
    expect(calcPageCss(s, "portrait")).toBe("@page { size: A4; margin: 0.5in; }");
    expect(calcPageCss({ ...s, paper: "Letter" }, "landscape")).toBe("@page { size: Letter landscape; margin: 0.5in; }");
  });
  it("auto orientation: landscape when wider than tall", () => {
    expect(resolveOrientation(s, 900, 300)).toBe("landscape");
    expect(resolveOrientation(s, 300, 900)).toBe("portrait");
    expect(resolveOrientation({ ...s, orientation: "portrait" }, 900, 300)).toBe("portrait");
  });
  it("fit-to-width zoom shrinks only", () => {
    // A4 landscape: (11.69 - 1) in = 1026 px wide.
    expect(fitZoom(s, "landscape", 2052)).toBeCloseTo(0.5, 2);
    expect(fitZoom(s, "landscape", 500)).toBe(1);
    expect(fitZoom({ ...s, fitToWidth: false }, "landscape", 2052)).toBe(1);
  });
});

describe("print table", () => {
  const styles: CellStyle[] = [
    {},
    { font: { bold: true }, fill: { kind: "solid", color: { kind: "rgb", value: "FFFF00" } } as never, borders: { bottom: { style: "thin", color: { kind: "rgb", value: "000000" } as never } } },
  ];
  const cache: SheetCache = (() => {
    const c = emptyCache();
    const put = (row: number, col: number, display: string, style = 0, kind: "text" | "number" = "text") =>
      (c.cells.get(row) ?? c.cells.set(row, new Map()).get(row)!).set(col, { row, col, input: display, display, kind, style });
    put(0, 0, "Name", 1);
    put(0, 2, "Qty", 1);
    put(1, 0, "Apple");
    put(1, 2, "3", 0, "number");
    c.cols.set(1, { col: 1, width: null, hidden: true, style: null });
    c.cols.set(0, { col: 0, width: 20, hidden: false, style: null });
    c.rows.set(1, { row: 1, height: 30, hidden: false, style: null });
    return c;
  })();

  it("models the used range with widths, heights, hidden columns and styles", () => {
    const t = buildPrintTable(cache, styles, 1, 2);
    expect(t.cols).toEqual([{ col: 0, width: 145 }, { col: 2, width: 64 }]);
    expect(t.rows.map((r) => r.height)).toEqual([20, 40]);
    expect(t.rows[0]!.cells.map((c) => c.text)).toEqual(["Name", "Qty"]);
    expect(t.rows[0]!.cells[0]!.style).toMatchObject({ fontWeight: "bold", borderBottom: "1px solid #000000" });
    expect(t.rows[1]!.cells[1]!.style.textAlign).toBe("right");
  });

  it("renders a table with the header row in thead", () => {
    const t = buildPrintTable(cache, styles, 1, 2);
    render(<PrintTableView table={t} zoom={0.5} />);
    const table = screen.getByTestId("print-table");
    expect(table.querySelectorAll("thead tr")).toHaveLength(1);
    expect(table.querySelectorAll("tbody tr")).toHaveLength(1);
    expect(table.querySelectorAll("col")).toHaveLength(2);
    expect(table.querySelector("thead")!.textContent).toBe("NameQty");
    expect(table.querySelector("tbody")!.textContent).toBe("Apple3");
    expect((table as HTMLElement).style.zoom).toBe("0.5");
  });
});

describe("export flow", () => {
  it("loadUsedRange finds data beyond the first block", async () => {
    const core = new FakeCalcCore();
    const backend = new FakeBackend(core);
    const store = new CalcStore(new CalcApi(backend));
    await store.init();
    const sheet = store.getState().activeSheet;
    await store.api.apply({ type: "setInput", sheet, row: 70, col: 40, input: "far" });
    await store.api.apply({ type: "setInput", sheet, row: 3, col: 1, input: "near" });
    const fresh = new CalcStore(new CalcApi(backend));
    expect(await loadUsedRange(fresh, sheet)).toEqual({ lastRow: 70, lastCol: 40 });
  });

  it("Export PDF opens the setup dialog; Print… prints and returns", async () => {
    const backend = new FakeBackend(new FakeCalcCore());
    HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
    render(<App backend={backend} />);
    await screen.findByRole("tab", { name: "Sheet1" });
    fireEvent.click(screen.getByRole("button", { name: "Export PDF…" }));
    fireEvent.change(screen.getByLabelText("Paper"), { target: { value: "Letter" } });
    fireEvent.click(screen.getByRole("button", { name: "Print…" }));
    await waitFor(() => expect(backend.printed).toBe(1));
    expect(document.querySelector('[data-testid="print-view"] style')!.textContent).toContain("@page { size: Letter");
    window.dispatchEvent(new Event("afterprint"));
    await waitFor(() => expect(screen.queryByTestId("print-view")).toBeNull());
  });
});
