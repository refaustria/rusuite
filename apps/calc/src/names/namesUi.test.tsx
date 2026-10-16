// P8-23 through the real App: Name Box, Name Manager, New Name, Create from
// Selection, Go To, the Formulas tab (Insert Function, Use in Formula,
// AutoSum, Show Formulas, Trace Precedents), name autocomplete and the
// Number group / Format Cells categories.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import App from "../App";
import { FakeBackend, FakeCalcCore } from "../dev/fakeBackend";
import type { CalcCommand } from "../generated/CalcCommand";
import type { Request } from "../generated/Request";
import { accountingCode } from "../numberFormat";
import type { CalcStore } from "../state/store";

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

async function setup(seed: CalcCommand[] = []) {
  const core = new FakeCalcCore();
  const backend = new FakeBackend(core);
  render(<App backend={backend} />);
  await screen.findByRole("tab", { name: "Sheet1" });
  await waitFor(() => expect(core.log.some((r) => r.type === "snapshot")).toBe(true));
  await waitFor(() => expect((screen.getByRole("button", { name: "Bold" }) as HTMLButtonElement).disabled).toBe(false));
  const store = (window as unknown as { __calc: { store: CalcStore } }).__calc.store;
  for (const c of seed) await act(() => store.apply(c));
  core.log.length = 0;
  const grid = screen.getByTestId("grid");
  grid.focus();
  return { core, grid, store };
}

const applied = (log: Request[]): CalcCommand[] => log.flatMap((r) => (r.type === "apply" ? [r.command] : []));
const nameBox = () => screen.getByTestId("cell-address") as HTMLInputElement;
const bar = () => screen.getByLabelText("Formula bar") as HTMLInputElement;
const tab = (name: string) => fireEvent.click(screen.getByRole("tab", { name }));

/** A1:B3 with a header row (Qty / Price) and numbers. */
const table: CalcCommand[] = [["Qty", "Price"], ["2", "10"], ["3", "20"]].flatMap((r, i) =>
  r.map((v, j): CalcCommand => ({ type: "setInput", sheet: 0, row: i, col: j, input: v })),
);

const defineQty: CalcCommand[] = [...table, { type: "defineName", def: { name: "Qty", refersTo: "Sheet1!$A$2:$A$3" } }];

describe("Name Box", () => {
  it("defines a name for the selection with Enter and then shows it", async () => {
    const { core, grid } = await setup(table);
    fireEvent.keyDown(grid, { key: "ArrowDown", shiftKey: true });
    expect(nameBox().value).toBe("A1:A2");
    fireEvent.focus(nameBox());
    fireEvent.change(nameBox(), { target: { value: "Items" } });
    fireEvent.keyDown(nameBox(), { key: "Enter" });
    await waitFor(() => expect(applied(core.log)).toEqual([{ type: "defineName", def: { name: "Items", refersTo: "=Sheet1!$A$1:$A$2" } }]));
    await waitFor(() => expect(nameBox().value).toBe("Items"));
  });

  it("navigates to references and names, and lists the names", async () => {
    const { core } = await setup(defineQty);
    fireEvent.change(nameBox(), { target: { value: "c5" } });
    fireEvent.keyDown(nameBox(), { key: "Enter" });
    await waitFor(() => expect(nameBox().value).toBe("C5"));
    fireEvent.click(screen.getByRole("button", { name: "Defined names" }));
    const list = screen.getByTestId("name-list");
    fireEvent.click(within(list).getByRole("option", { name: "Qty" }));
    await waitFor(() => expect(nameBox().value).toBe("Qty"));
    expect(applied(core.log)).toEqual([]);
  });

  it("rejects an invalid name with a message", async () => {
    const { core } = await setup();
    fireEvent.change(nameBox(), { target: { value: "1st" } });
    fireEvent.keyDown(nameBox(), { key: "Enter" });
    await screen.findByText(/must start with a letter/);
    expect(applied(core.log)).toEqual([]);
  });
});

describe("Name Manager", () => {
  it("lists names with their values and edits refers-to in place", async () => {
    const { core } = await setup(defineQty);
    tab("Formulas");
    fireEvent.click(screen.getByRole("button", { name: "Name Manager" }));
    const dialog = await screen.findByRole("dialog", { name: "Name Manager" });
    const row = await within(dialog).findByText("Qty");
    expect(within(dialog).getByText("{2;3}")).toBeTruthy();
    fireEvent.click(row);
    const field = within(dialog).getByTestId("manager-refers-to") as HTMLInputElement;
    expect(field.value).toBe("=Sheet1!$A$2:$A$3");
    fireEvent.change(field, { target: { value: "=Sheet1!$B$2:$B$3" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply the definition" }));
    await waitFor(() =>
      expect(applied(core.log)).toEqual([{ type: "updateName", name: "Qty", def: { name: "Qty", refersTo: "Sheet1!$B$2:$B$3" } }]),
    );
    await waitFor(() => expect(within(dialog).getByText("{10;20}")).toBeTruthy());
  });

  it("deletes the selected name", async () => {
    const { core } = await setup(defineQty);
    tab("Formulas");
    fireEvent.click(screen.getByRole("button", { name: "Name Manager" }));
    const dialog = await screen.findByRole("dialog", { name: "Name Manager" });
    fireEvent.click(await within(dialog).findByText("Qty"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(applied(core.log)).toEqual([{ type: "deleteName", name: "Qty" }]));
    await within(dialog).findByText("No names defined.");
  });

  it("New Name validates and defines with scope and comment", async () => {
    const { core } = await setup(defineQty);
    tab("Formulas");
    fireEvent.click(screen.getByRole("button", { name: "Define Name" }));
    const dialog = await screen.findByRole("dialog", { name: "New Name" });
    const name = within(dialog).getByLabelText("Name");
    fireEvent.change(name, { target: { value: "A1" } });
    expect(within(dialog).getByRole("alert").textContent).toMatch(/cell reference/);
    fireEvent.change(name, { target: { value: "qty" } });
    expect(within(dialog).getByRole("alert").textContent).toMatch(/already exists/);
    fireEvent.change(within(dialog).getByLabelText("Scope"), { target: { value: "0" } });
    expect(within(dialog).queryByRole("alert")).toBeNull();
    fireEvent.change(within(dialog).getByLabelText("Comment"), { target: { value: "Local copy" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "OK" }));
    await waitFor(() =>
      expect(applied(core.log)).toEqual([{ type: "defineName", def: { name: "qty", refersTo: "Sheet1!$A$1", sheet: 0, comment: "Local copy" } }]),
    );
  });
});

describe("Create from Selection and Go To", () => {
  it("creates names from the top row by default", async () => {
    const { core, grid } = await setup(table);
    fireEvent.keyDown(grid, { key: "ArrowDown", shiftKey: true });
    fireEvent.keyDown(grid, { key: "ArrowDown", shiftKey: true });
    fireEvent.keyDown(grid, { key: "ArrowRight", shiftKey: true });
    tab("Formulas");
    fireEvent.click(screen.getByRole("button", { name: "Create from Selection" }));
    const dialog = await screen.findByRole("dialog", { name: "Create Names from Selection" });
    expect((within(dialog).getByLabelText("Top row") as HTMLInputElement).checked).toBe(true);
    expect((within(dialog).getByLabelText("Left column") as HTMLInputElement).checked).toBe(false);
    fireEvent.click(within(dialog).getByRole("button", { name: "OK" }));
    await waitFor(() =>
      expect(applied(core.log)).toEqual([
        { type: "createNamesFromSelection", sheet: 0, r0: 0, c0: 0, r1: 2, c1: 1, edges: { top: true, left: false, bottom: false, right: false } },
      ]),
    );
    expect(core.names.map((n) => `${n.name}=${n.refersTo}`)).toEqual(["Qty=Sheet1!$A$2:$A$3", "Price=Sheet1!$B$2:$B$3"]);
  });

  it("Ctrl+G goes to a name", async () => {
    const { grid } = await setup(defineQty);
    fireEvent.keyDown(grid, { key: "g", ctrlKey: true });
    const dialog = await screen.findByRole("dialog", { name: "Go To" });
    fireEvent.click(within(dialog).getByRole("option", { name: "Qty" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "OK" }));
    await waitFor(() => expect(nameBox().value).toBe("Qty"));
    expect(screen.queryByRole("dialog", { name: "Go To" })).toBeNull();
  });
});

describe("Formulas tab", () => {
  it("Insert Function searches and shows the argument help", async () => {
    await setup();
    tab("Formulas");
    fireEvent.click(screen.getByRole("button", { name: "Insert Function" }));
    const dialog = await screen.findByRole("dialog", { name: "Insert Function" });
    fireEvent.change(within(dialog).getByLabelText("Search for a function"), { target: { value: "vlook" } });
    const list = within(dialog).getByRole("listbox", { name: "Select a function" });
    expect(within(list).getAllByRole("option").map((o) => o.textContent)).toEqual(["VLOOKUP"]);
    expect(within(dialog).getByTestId("function-help").textContent).toContain("VLOOKUP(");
    fireEvent.click(within(dialog).getByRole("button", { name: "OK" }));
    expect(bar().value).toBe("=VLOOKUP()");
    expect(JSON.parse(localStorage.getItem("rusuite.calc.recentFunctions") ?? "[]")[0]).toBe("VLOOKUP");
  });

  it("Use in Formula inserts a name at the caret", async () => {
    await setup(defineQty);
    fireEvent.focus(bar());
    fireEvent.change(bar(), { target: { value: "=SUM()", selectionEnd: 5 } });
    tab("Formulas");
    fireEvent.click(screen.getByRole("button", { name: "Use in Formula" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Qty" }));
    expect(bar().value).toBe("=SUM(Qty)");
  });

  it("autocomplete offers names and accepting one inserts it without a parenthesis", async () => {
    const { grid } = await setup(defineQty);
    fireEvent.keyDown(grid, { key: "=" });
    const ed = screen.getByTestId("cell-editor") as HTMLTextAreaElement;
    fireEvent.change(ed, { target: { value: "=Q", selectionStart: 2, selectionEnd: 2 } });
    const option = await screen.findByRole("option", { name: /Qty/ });
    fireEvent.mouseDown(option);
    fireEvent.click(option);
    await waitFor(() => expect(ed.value).toBe("=Qty"));
  });

  it("AutoSum sums the numbers above the active cell", async () => {
    const { grid } = await setup(table);
    for (let i = 0; i < 3; i++) fireEvent.keyDown(grid, { key: "ArrowDown" });
    fireEvent.keyDown(grid, { key: "=", altKey: true });
    await waitFor(() => expect((screen.getByTestId("cell-editor") as HTMLTextAreaElement).value).toBe("=SUM(A2:A3)"));
  });

  it("Show Formulas toggles with Ctrl+` and the ribbon", async () => {
    const { grid } = await setup();
    fireEvent.keyDown(grid, { key: "`", code: "Backquote", ctrlKey: true });
    tab("Formulas");
    const button = screen.getByRole("button", { name: "Show Formulas" });
    await waitFor(() => expect(button.getAttribute("aria-pressed")).toBe("true"));
    fireEvent.click(button);
    await waitFor(() => expect(button.getAttribute("aria-pressed")).toBe("false"));
  });

  it("Trace Precedents asks the core and draws arrows; Remove Arrows clears them", async () => {
    const { core, grid } = await setup([...table, { type: "setInput", sheet: 0, row: 4, col: 0, input: "=SUM(A2:A3)+B2" }]);
    for (let i = 0; i < 4; i++) fireEvent.keyDown(grid, { key: "ArrowDown" });
    tab("Formulas");
    fireEvent.click(screen.getByRole("button", { name: "Trace Precedents" }));
    await waitFor(() => expect(core.log.some((r) => r.type === "precedents")).toBe(true));
    const remove = screen.getByRole("button", { name: "Remove Arrows" });
    await waitFor(() => expect((remove as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(remove);
    await waitFor(() => expect((remove as HTMLButtonElement).disabled).toBe(true));
  });
});

describe("Number formats", () => {
  it("the Number Format box applies one of Excel's eleven formats", async () => {
    const { core } = await setup();
    fireEvent.click(screen.getByRole("button", { name: "General" }));
    const menu = await screen.findByTestId("number-format-menu");
    expect(within(menu).getAllByRole("menuitem")).toHaveLength(12);
    fireEvent.click(within(menu).getByRole("menuitem", { name: /Scientific/ }));
    await waitFor(() => expect(applied(core.log)).toMatchObject([{ type: "applyStyle", patch: { numberFormat: "0.00E+00" } }]));
  });

  it("Accounting ▾ applies the symbol's accounting format", async () => {
    const { core } = await setup();
    fireEvent.click(screen.getByRole("button", { name: "Accounting formats" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "£ English (United Kingdom)" }));
    await waitFor(() => expect(applied(core.log)).toMatchObject([{ type: "applyStyle", patch: { numberFormat: accountingCode("£", 2) } }]));
  });

  it("Format Cells offers every category and builds its code", async () => {
    const { core, grid } = await setup();
    fireEvent.keyDown(grid, { key: "1", code: "Digit1", ctrlKey: true });
    const dialog = await screen.findByRole("dialog", { name: "Format cells" });
    const categories = within(within(dialog).getByRole("listbox", { name: "Category" })).getAllByRole("option").map((o) => o.textContent);
    expect(categories).toEqual(["General", "Number", "Currency", "Accounting", "Date", "Time", "Percentage", "Fraction", "Scientific", "Text", "Custom"]);
    fireEvent.click(within(dialog).getByRole("option", { name: "Fraction" }));
    fireEvent.click(within(dialog).getByRole("option", { name: "As eighths (4/8)" }));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "OK" }));
    });
    await waitFor(() => expect(applied(core.log)).toMatchObject([{ type: "applyStyle", patch: { numberFormat: "# ?/8" } }]));
  });
});
