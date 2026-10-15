// Calc's ribbon, driven through the real App.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import App from "../App";
import { FakeBackend, FakeCalcCore } from "../dev/fakeBackend";
import type { Request } from "../generated/Request";
import { changeDecimals } from "./CalcRibbon";

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function setup(props: Partial<Parameters<typeof App>[0]> = {}) {
  const core = new FakeCalcCore();
  const backend = new FakeBackend(core);
  render(<App backend={backend} {...props} />);
  await screen.findByRole("tab", { name: "Sheet1" });
  await waitFor(() => expect(core.log.some((r) => r.type === "snapshot")).toBe(true));
  await waitFor(() => expect((screen.getByRole("button", { name: "Bold" }) as HTMLButtonElement).disabled).toBe(false));
  core.log.length = 0;
  const grid = screen.getByTestId("grid");
  grid.focus();
  return { core, backend, grid };
}

const applied = (log: Request[]) => log.flatMap((r) => (r.type === "apply" ? [r.command] : []));
const tab = (name: string) => screen.getByRole("tab", { name });

async function typeCell(grid: HTMLElement, text: string) {
  fireEvent.keyDown(grid, { key: text[0]! });
  const ed = screen.getByTestId("cell-editor") as HTMLTextAreaElement;
  fireEvent.change(ed, { target: { value: text } });
  fireEvent.keyDown(ed, { key: "Enter" });
}

describe("changeDecimals", () => {
  it("adds and removes decimal places per section", () => {
    expect(changeDecimals("General", 1)).toBe("0.0");
    expect(changeDecimals("0.0", -1)).toBe("0");
    expect(changeDecimals("0", -1)).toBe("0");
    expect(changeDecimals("#,##0.00", 1)).toBe("#,##0.000");
    expect(changeDecimals("0%", 1)).toBe("0.0%");
    expect(changeDecimals("#,##0.00;[Red]-#,##0.00", -1)).toBe("#,##0.0;[Red]-#,##0.0");
    expect(changeDecimals("@", 1)).toBe("@");
  });
});

describe("Calc ribbon", () => {
  it("has File, Home, Insert and View; Home is the formatting toolbar", async () => {
    await setup();
    expect(screen.getAllByRole("tab").slice(0, 4).map((t) => t.textContent)).toEqual(["File", "Home", "Insert", "View"]);
    const toolbar = screen.getByRole("toolbar", { name: "Formatting" });
    for (const g of ["Clipboard", "Font", "Alignment", "Number", "Cells", "Editing"]) expect(within(toolbar).getByRole("group", { name: g })).toBeTruthy();
  });

  it("keyboard only: Alt, arrows and Enter reach Insert › New sheet", async () => {
    const { core, grid } = await setup();
    fireEvent.keyDown(window, { key: "Alt", altKey: true });
    fireEvent.keyUp(window, { key: "Alt" });
    expect(document.activeElement).toBe(tab("Home"));
    fireEvent.keyDown(tab("Home"), { key: "ArrowRight" });
    fireEvent.keyDown(tab("Insert"), { key: "Enter" });
    fireEvent.keyDown(tab("Insert"), { key: "ArrowDown" });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "New sheet" })));
    fireEvent.click(document.activeElement!);
    await waitFor(() => expect(applied(core.log)).toContainEqual({ type: "addSheet", name: "Sheet2" }));
    // Esc from the strip goes back to the grid.
    grid.focus();
    fireEvent.keyDown(window, { key: "Alt", altKey: true });
    fireEvent.keyUp(window, { key: "Alt" });
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(document.activeElement).toBe(grid);
  });

  it("number buttons: percent, comma, decimals", async () => {
    const { core } = await setup();
    fireEvent.click(screen.getByRole("button", { name: "Percent style" }));
    fireEvent.click(screen.getByRole("button", { name: "Comma style" }));
    fireEvent.click(screen.getByRole("button", { name: "Increase decimal" }));
    await waitFor(() => expect(applied(core.log)).toHaveLength(3));
    expect(applied(core.log).map((c) => (c.type === "applyStyle" ? c.patch.numberFormat : null))).toEqual(["0%", "#,##0.00", "0.0"]);
  });

  it("copy, paste and cut use the internal clipboard", async () => {
    const { core, grid } = await setup();
    await typeCell(grid, "42");
    fireEvent.keyDown(grid, { key: "ArrowUp" });
    await waitFor(() => expect((screen.getByLabelText("Formula bar") as HTMLInputElement).value).toBe("42"));
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    fireEvent.keyDown(grid, { key: "ArrowRight" });
    core.log.length = 0;
    fireEvent.click(screen.getByRole("button", { name: "Paste" }));
    await waitFor(() => expect(applied(core.log).map((c) => c.type)).toEqual(["pasteRange"]));
    fireEvent.click(screen.getByRole("button", { name: "Cut" }));
    fireEvent.keyDown(grid, { key: "ArrowDown" });
    core.log.length = 0;
    fireEvent.click(screen.getByRole("button", { name: "Paste" }));
    await waitFor(() => expect(applied(core.log).map((c) => c.type)).toEqual(["pasteRange"]));
  });

  it("Cells: insert rows from the menu; row height dialog", async () => {
    const { core } = await setup();
    fireEvent.click(screen.getByRole("button", { name: "Insert" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Insert sheet rows" }));
    await waitFor(() => expect(applied(core.log)).toEqual([{ type: "insertRows", sheet: 0, at: 0, count: 1 }]));
    core.log.length = 0;
    fireEvent.click(screen.getByRole("button", { name: "Format" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Row height…" }));
    const input = screen.getByLabelText("Row height (points)") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "30" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(applied(core.log)).toEqual([expect.objectContaining({ type: "setRowHeight", row: 0, height: 30 })]));
  });

  it("undo/redo and clear", async () => {
    const { core, grid } = await setup();
    expect((screen.getByRole("button", { name: "Undo" }) as HTMLButtonElement).disabled).toBe(true);
    await typeCell(grid, "1");
    await waitFor(() => expect((screen.getByRole("button", { name: "Undo" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(core.log.some((r) => r.type === "undo")).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    await waitFor(() => expect(applied(core.log).some((c) => c.type === "clearRange")).toBe(true));
  });

  it("View: zoom, gridlines and formula bar", async () => {
    await setup();
    fireEvent.click(tab("View"));
    fireEvent.change(screen.getByRole("combobox", { name: "Zoom" }), { target: { value: "1.5" } });
    expect(screen.getByTestId("grid-root").style.zoom).toBe("1.5");
    expect(screen.getByTestId("zoom").textContent).toBe("150 %");
    fireEvent.click(screen.getByRole("button", { name: "100 %" }));
    expect(screen.getByTestId("grid-root").style.zoom).toBe("");
    const gl = screen.getByRole("button", { name: "Gridlines" });
    expect(gl.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(gl);
    expect(gl.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Formula bar" }));
    expect(screen.queryByRole("textbox", { name: "Formula bar" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Formula bar" }));
    expect(screen.getByRole("textbox", { name: "Formula bar" })).toBeTruthy();
  });

  it("View › Keyboard shortcuts opens the help of the shortcut map", async () => {
    await setup();
    fireEvent.click(tab("View"));
    fireEvent.click(screen.getByRole("button", { name: "Keyboard shortcuts" }));
    expect(screen.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeTruthy();
  });

  it("File › Save As… asks for a name; File › Export PDF… opens the setup", async () => {
    const { core } = await setup();
    fireEvent.click(tab("File"));
    fireEvent.click(screen.getByRole("button", { name: "Save As…" }));
    expect(screen.queryByRole("dialog", { name: "File" })).toBeNull();
    const input = screen.getByLabelText("File name") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "q3" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(core.log.find((r) => r.type === "saveXlsx")).toBeTruthy());
    fireEvent.click(tab("File"));
    fireEvent.click(within(screen.getByRole("dialog", { name: "File" })).getByRole("button", { name: "Export PDF…" }));
    expect(await screen.findByRole("dialog", { name: "Export PDF" })).toBeTruthy();
  });

  it("File › New asks before discarding changes", async () => {
    const { core, grid } = await setup();
    await typeCell(grid, "1");
    await waitFor(() => expect(screen.getByTestId("status-bar").textContent).toMatch(/Modified/));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(tab("File"));
    fireEvent.click(screen.getByRole("button", { name: "New" }));
    expect(confirm).toHaveBeenCalled();
    expect(core.log.some((r) => r.type === "newDocument")).toBe(false);
    confirm.mockReturnValue(true);
    fireEvent.click(tab("File"));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(core.log.some((r) => r.type === "newDocument")).toBe(true));
  });

  it("Editing › Find and Format › Format cells… open the P6-3 dialogs", async () => {
    await setup();
    fireEvent.click(screen.getByRole("button", { name: "Find options" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^Replace…/ }));
    expect(await screen.findByRole("dialog", { name: "Find and replace" })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Find and replace" }), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Find" }));
    expect(await screen.findByRole("dialog", { name: "Find" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Format" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Format cells/ }));
    expect(await screen.findByRole("dialog", { name: "Format cells" })).toBeTruthy();
  });
});
