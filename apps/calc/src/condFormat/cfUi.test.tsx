// P8-13 UI: Home › Conditional Formatting (menu, quick dialogs, galleries,
// New Rule, Manage Rules) and Data › Data Validation (dialog, in-cell
// dropdown, input message, alert), driven through the real App over the
// fake backend.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import App from "../App";
import { FakeBackend, FakeCalcCore } from "../dev/fakeBackend";
import type { CalcCommand } from "../generated/CalcCommand";
import type { Request } from "../generated/Request";

const sizes = { clientWidth: 800, clientHeight: 400 };
const saved: Record<string, PropertyDescriptor | undefined> = {};
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
  for (const [k, v] of Object.entries(sizes)) {
    saved[k] = Object.getOwnPropertyDescriptor(HTMLElement.prototype, k);
    Object.defineProperty(HTMLElement.prototype, k, { configurable: true, get: () => v });
  }
});
afterAll(() => {
  for (const [k, d] of Object.entries(saved)) if (d) Object.defineProperty(HTMLElement.prototype, k, d);
});
afterEach(cleanup);

const applied = (log: Request[]): CalcCommand[] => log.flatMap((r) => (r.type === "apply" ? [r.command] : []));
const at = (row: number, col: number) => ({ clientX: 46 + 64 * col + 10, clientY: 22 + 20 * row + 5 });

async function setup() {
  const core = new FakeCalcCore();
  render(<App backend={new FakeBackend(core)} />);
  await screen.findByRole("tab", { name: "Sheet1" });
  await waitFor(() => expect(core.log.some((r) => r.type === "snapshot")).toBe(true));
  const grid = screen.getByTestId("grid");
  grid.focus();
  core.log.length = 0;
  return { core, grid };
}

const select = (grid: HTMLElement, r0: number, c0: number, r1 = r0, c1 = c0) => {
  fireEvent.pointerDown(grid, at(r0, c0));
  fireEvent.pointerUp(window);
  if (r1 !== r0 || c1 !== c0) {
    fireEvent.pointerDown(grid, { ...at(r1, c1), shiftKey: true });
    fireEvent.pointerUp(window);
  }
};

function openCfMenu() {
  fireEvent.click(screen.getByRole("tab", { name: "Home" }));
  fireEvent.click(screen.getByRole("button", { name: "Conditional Formatting" }));
  return screen.getByTestId("cf-menu");
}

function flyout(menu: HTMLElement, name: string) {
  fireEvent.click(within(menu).getByRole("menuitem", { name }));
  return screen.getByRole("menu", { name });
}

describe("Conditional Formatting menu", () => {
  it("Highlight Cells Rules › Greater Than… adds a cellIs rule with Excel's default preset", async () => {
    const { core, grid } = await setup();
    select(grid, 0, 0, 4, 0);
    const sub = flyout(openCfMenu(), "Highlight Cells Rules");
    expect(within(sub).getAllByRole("menuitem").map((b) => b.textContent)).toEqual([
      "Greater Than…", "Less Than…", "Between…", "Equal To…", "Text that Contains…", "A Date Occurring…", "Duplicate Values…", "More Rules…",
    ]);
    fireEvent.click(within(sub).getByRole("menuitem", { name: "Greater Than…" }));
    const dlg = screen.getByRole("dialog", { name: "Greater Than" });
    expect(within(dlg).getByText("Format cells that are GREATER THAN:")).toBeTruthy();
    fireEvent.change(within(dlg).getByLabelText("Value"), { target: { value: "5" } });
    expect((within(dlg).getByLabelText("Format") as HTMLSelectElement).value).toBe("lightRedDarkRed");
    fireEvent.click(within(dlg).getByRole("button", { name: "OK" }));
    await waitFor(() =>
      expect(applied(core.log)).toEqual([
        {
          type: "addCfRule", sheet: 0,
          rule: {
            id: 0, ranges: [{ r0: 0, c0: 0, r1: 4, c1: 0 }], priority: 1, stopIfTrue: false,
            kind: { type: "cellIs", op: "greaterThan", formulas: ["5"] },
            dxf: { fill: { kind: "rgb", value: "FFC7CE" }, fontColor: { kind: "rgb", value: "9C0006" } },
          },
        },
      ]),
    );
  });

  it("Between… needs both values; another preset is used", async () => {
    const { core, grid } = await setup();
    select(grid, 1, 1);
    fireEvent.click(within(flyout(openCfMenu(), "Highlight Cells Rules")).getByRole("menuitem", { name: "Between…" }));
    const dlg = screen.getByRole("dialog", { name: "Between" });
    fireEvent.change(within(dlg).getByLabelText("First value"), { target: { value: "1" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "OK" }));
    expect(screen.getByRole("dialog", { name: "Between" })).toBeTruthy();
    fireEvent.change(within(dlg).getByLabelText("Second value"), { target: { value: "3" } });
    fireEvent.change(within(dlg).getByLabelText("Format"), { target: { value: "greenDarkGreen" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "OK" }));
    await waitFor(() => expect(applied(core.log)[0]).toMatchObject({
      type: "addCfRule",
      rule: { kind: { type: "cellIs", op: "between", formulas: ["1", "3"] }, dxf: { fill: { kind: "rgb", value: "C6EFCE" } } },
    }));
  });

  it("Duplicate Values… can mark unique values; Custom Format… opens the format editor", async () => {
    const { core } = await setup();
    fireEvent.click(within(flyout(openCfMenu(), "Highlight Cells Rules")).getByRole("menuitem", { name: "Duplicate Values…" }));
    const dlg = screen.getByRole("dialog", { name: "Duplicate Values" });
    fireEvent.change(within(dlg).getByLabelText("Values"), { target: { value: "unique" } });
    fireEvent.change(within(dlg).getByLabelText("Format"), { target: { value: "custom" } });
    const fmt = screen.getByRole("dialog", { name: "Format Cells" });
    fireEvent.change(within(fmt).getByLabelText("Font style"), { target: { value: "boldItalic" } });
    fireEvent.click(within(fmt).getByLabelText("Strikethrough"));
    fireEvent.click(within(fmt).getByRole("button", { name: "OK" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Duplicate Values" })).getByRole("button", { name: "OK" }));
    await waitFor(() => expect(applied(core.log)[0]).toMatchObject({
      type: "addCfRule", rule: { kind: { type: "uniqueValues" }, dxf: { bold: true, italic: true, strike: true } },
    }));
  });

  it("Top/Bottom Rules › Top 10%… and Below Average…", async () => {
    const { core } = await setup();
    fireEvent.click(within(flyout(openCfMenu(), "Top/Bottom Rules")).getByRole("menuitem", { name: "Top 10%…" }));
    let dlg = screen.getByRole("dialog", { name: "Top 10%" });
    fireEvent.change(within(dlg).getByLabelText("Rank"), { target: { value: "25" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "OK" }));
    fireEvent.click(within(flyout(openCfMenu(), "Top/Bottom Rules")).getByRole("menuitem", { name: "Below Average…" }));
    dlg = screen.getByRole("dialog", { name: "Below Average" });
    fireEvent.click(within(dlg).getByRole("button", { name: "OK" }));
    await waitFor(() => expect(applied(core.log).map((c) => c.type === "addCfRule" && c.rule.kind)).toEqual([
      { type: "top10", rank: 25, percent: true, bottom: false },
      { type: "aboveAverage", above: false, equal: false },
    ]));
  });

  it("the galleries add data bars, colour scales and icon sets at once", async () => {
    const { core, grid } = await setup();
    select(grid, 0, 0, 9, 0);
    fireEvent.click(within(flyout(openCfMenu(), "Data Bars")).getByRole("menuitem", { name: "Green Data Bar" }));
    fireEvent.click(within(flyout(openCfMenu(), "Color Scales")).getByRole("menuitem", { name: "Red - White - Blue Color Scale" }));
    const icons = flyout(openCfMenu(), "Icon Sets");
    expect(within(icons).getAllByRole("group").map((g) => g.getAttribute("aria-label"))).toEqual(["Directional", "Shapes", "Indicators", "Ratings"]);
    fireEvent.click(within(icons).getByRole("menuitem", { name: "3 Flags" }));
    await waitFor(() => expect(applied(core.log).map((c) => c.type === "addCfRule" && c.rule.kind.type)).toEqual(["dataBar", "colorScale", "iconSet"]));
    const [bar, scale, set] = applied(core.log).map((c) => (c.type === "addCfRule" ? c.rule : null));
    expect(bar!.ranges).toEqual([{ r0: 0, c0: 0, r1: 9, c1: 0 }]);
    expect(bar!.kind).toMatchObject({ color: { kind: "rgb", value: "63C384" } });
    expect(scale!.kind.type === "colorScale" && scale!.kind.points.map((p) => p.color)).toEqual([
      { kind: "rgb", value: "5A8AC6" }, { kind: "rgb", value: "FCFCFF" }, { kind: "rgb", value: "F8696B" },
    ]);
    expect(set!.kind).toMatchObject({ type: "iconSet", set: "3Flags" });
  });

  it("keyboard: arrows move, → opens a flyout, ← closes it", async () => {
    await setup();
    const menu = openCfMenu();
    const first = within(menu).getByRole("menuitem", { name: "Highlight Cells Rules" });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(document.activeElement).toBe(within(menu).getByRole("menuitem", { name: "Top/Bottom Rules" }));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    const sub = screen.getByRole("menu", { name: "Top/Bottom Rules" });
    await waitFor(() => expect(document.activeElement).toBe(within(sub).getByRole("menuitem", { name: "Top 10 Items…" })));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    expect(screen.queryByRole("menu", { name: "Top/Bottom Rules" })).toBeNull();
    expect(document.activeElement).toBe(within(menu).getByRole("menuitem", { name: "Top/Bottom Rules" }));
  });

  it("New Rule… › Use a formula adds an expression rule with its format", async () => {
    const { core } = await setup();
    fireEvent.click(within(openCfMenu()).getByRole("menuitem", { name: "New Rule…" }));
    const dlg = screen.getByRole("dialog", { name: "New Formatting Rule" });
    fireEvent.click(within(dlg).getByRole("option", { name: "Use a formula to determine which cells to format" }));
    fireEvent.click(within(dlg).getByRole("button", { name: "OK" }));
    expect(within(dlg).getByRole("alert").textContent).toBe("Enter a formula.");
    fireEvent.change(within(dlg).getByLabelText("Formula"), { target: { value: "=MOD(ROW(),2)=0" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "Format…" }));
    const fmt = screen.getByRole("dialog", { name: "Format Cells" });
    fireEvent.change(within(fmt).getByLabelText("Border"), { target: { value: "outline" } });
    fireEvent.click(within(fmt).getByRole("button", { name: "OK" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "New Formatting Rule" })).getByRole("button", { name: "OK" }));
    await waitFor(() => expect(applied(core.log)[0]).toMatchObject({
      type: "addCfRule",
      rule: { kind: { type: "expression", formula: "MOD(ROW(),2)=0" }, dxf: { borders: { top: { style: "thin", color: { kind: "rgb", value: "000000" } } } } },
    }));
  });

  it("Clear Rules › from Entire Sheet", async () => {
    const { core } = await setup();
    fireEvent.click(within(flyout(openCfMenu(), "Clear Rules")).getByRole("menuitem", { name: "Clear Rules from Entire Sheet" }));
    await waitFor(() => expect(applied(core.log)).toEqual([{ type: "clearCf", sheet: 0, range: null }]));
  });
});

describe("Rules Manager", () => {
  async function withRules() {
    const ctx = await setup();
    const rule = (kind: Extract<CalcCommand, { type: "addCfRule" }>["rule"]["kind"], r1: number) =>
      act(() => ctx.core.handle({ type: "apply", command: { type: "addCfRule", sheet: 0, rule: { id: 0, ranges: [{ r0: 0, c0: 0, r1, c1: 0 }], priority: 99, stopIfTrue: false, kind } } }));
    await rule({ type: "cellIs", op: "greaterThan", formulas: ["5"] }, 4);
    await rule({ type: "uniqueValues" }, 9);
    await rule({ type: "containsBlanks" }, 19);
    ctx.core.log.length = 0;
    fireEvent.click(within(openCfMenu()).getByRole("menuitem", { name: "Manage Rules…" }));
    const dlg = screen.getByRole("dialog", { name: "Conditional Formatting Rules Manager" });
    await waitFor(() => expect(within(dlg).getAllByTestId("cf-rule-row")).toHaveLength(3));
    return { ...ctx, dlg };
  }

  it("lists the rules by priority with their ranges; Move Down + OK sends one reorder", async () => {
    const { core, dlg } = await withRules();
    const rows = within(dlg).getAllByTestId("cf-rule-row");
    expect(rows.map((r) => r.querySelector("td")!.textContent)).toEqual(["Cell Value > 5", "Unique Values", "Blanks"]);
    expect(within(dlg).getAllByLabelText("Applies to").map((i) => (i as HTMLInputElement).value)).toEqual(["=$A$1:$A$5", "=$A$1:$A$10", "=$A$1:$A$20"]);
    fireEvent.click(rows[0]!);
    fireEvent.click(within(dlg).getByRole("button", { name: "Move Down" }));
    expect(within(dlg).getAllByTestId("cf-rule-row").map((r) => r.querySelector("td")!.textContent)).toEqual(["Unique Values", "Cell Value > 5", "Blanks"]);
    fireEvent.click(within(dlg).getByRole("button", { name: "OK" }));
    await waitFor(() => expect(applied(core.log)).toEqual([{ type: "reorderCfRule", sheet: 0, id: 2, priority: 1 }]));
    expect(screen.queryByRole("dialog", { name: "Conditional Formatting Rules Manager" })).toBeNull();
  });

  it("Delete Rule, Stop If True and a new 'applies to' range", async () => {
    const { core, dlg } = await withRules();
    fireEvent.click(within(dlg).getAllByTestId("cf-rule-row")[1]!);
    fireEvent.click(within(dlg).getByRole("button", { name: "Delete Rule" }));
    const boxes = within(dlg).getAllByLabelText("Applies to");
    fireEvent.change(boxes[1]!, { target: { value: "=$B$1:$B$3,D1" } });
    fireEvent.click(within(dlg).getAllByLabelText("Stop If True")[0]!);
    fireEvent.click(within(dlg).getByRole("button", { name: "OK" }));
    await waitFor(() => expect(applied(core.log)).toEqual([
      { type: "compound", commands: [
        { type: "removeCfRule", sheet: 0, id: 2 },
        { type: "updateCfRule", sheet: 0, rule: expect.objectContaining({ id: 1, priority: 1, stopIfTrue: true }) },
        { type: "updateCfRule", sheet: 0, rule: expect.objectContaining({ id: 3, priority: 2, ranges: [{ r0: 0, c0: 1, r1: 2, c1: 1 }, { r0: 0, c0: 3, r1: 0, c1: 3 }] }) },
      ] },
    ]));
  });

  it("Duplicate Rule adds a copy above the rule; Apply sends it and keeps the dialog open", async () => {
    const { core, dlg } = await withRules();
    fireEvent.click(within(dlg).getAllByTestId("cf-rule-row")[1]!);
    fireEvent.click(within(dlg).getByRole("button", { name: "Duplicate Rule" }));
    expect(within(dlg).getAllByTestId("cf-rule-row").map((r) => r.querySelector("td")!.textContent)).toEqual(["Cell Value > 5", "Unique Values", "Unique Values", "Blanks"]);
    fireEvent.click(within(dlg).getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(applied(core.log)).toEqual([
      { type: "addCfRule", sheet: 0, rule: expect.objectContaining({ id: 0, priority: 2, kind: { type: "uniqueValues" }, ranges: [{ r0: 0, c0: 0, r1: 9, c1: 0 }] }) },
    ]));
    expect(screen.getByRole("dialog", { name: "Conditional Formatting Rules Manager" })).toBeTruthy();
  });

  it("a bad range keeps the dialog open; Edit Rule… changes the rule; Cancel sends nothing", async () => {
    const { core, dlg } = await withRules();
    fireEvent.change(within(dlg).getAllByLabelText("Applies to")[0]!, { target: { value: "nonsense" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "OK" }));
    expect(within(dlg).getByRole("alert").textContent).toBe("“nonsense” is not a valid reference.");
    fireEvent.click(within(dlg).getAllByTestId("cf-rule-row")[0]!);
    fireEvent.click(within(dlg).getByRole("button", { name: "Edit Rule…" }));
    const edit = screen.getByRole("dialog", { name: "Edit Formatting Rule" });
    expect((within(edit).getByLabelText("First value") as HTMLInputElement).value).toBe("5");
    fireEvent.change(within(edit).getByLabelText("First value"), { target: { value: "7" } });
    fireEvent.click(within(edit).getByRole("button", { name: "OK" }));
    const back = screen.getByRole("dialog", { name: "Conditional Formatting Rules Manager" });
    expect(within(back).getAllByTestId("cf-rule-row")[0]!.querySelector("td")!.textContent).toBe("Cell Value > 7");
    fireEvent.click(within(back).getByRole("button", { name: "Cancel" }));
    expect(applied(core.log)).toEqual([]);
  });
});

/** Sets a validation on the selection through Data › Data Validation…. */
async function validate(core: FakeCalcCore, fill: (dlg: HTMLElement) => void) {
  fireEvent.click(screen.getByRole("tab", { name: "Data" }));
  fireEvent.click(screen.getByRole("button", { name: "Data Validation" }));
  const dlg = screen.getByRole("dialog", { name: "Data Validation" });
  fill(dlg);
  fireEvent.click(within(dlg).getByRole("button", { name: "OK" }));
  await waitFor(() => expect(applied(core.log).some((c) => c.type === "setValidation")).toBe(true));
  core.log.length = 0;
}

describe("Data Validation", () => {
  it("Data › Data Validation…: a list with messages; the dropdown picks a value; the input message shows", async () => {
    const { core, grid } = await setup();
    select(grid, 1, 1, 3, 1);
    fireEvent.click(screen.getByRole("tab", { name: "Data" }));
    fireEvent.click(screen.getByRole("button", { name: "Data Validation" }));
    const dlg = screen.getByRole("dialog", { name: "Data Validation" });
    fireEvent.change(within(dlg).getByLabelText("Allow:"), { target: { value: "list" } });
    fireEvent.change(within(dlg).getByLabelText("Source:"), { target: { value: "pear,apple,fig" } });
    fireEvent.click(within(dlg).getByRole("tab", { name: "Input Message" }));
    fireEvent.change(within(dlg).getByLabelText("Title:"), { target: { value: "Fruit" } });
    fireEvent.change(within(dlg).getByLabelText("Input message:"), { target: { value: "Pick one" } });
    fireEvent.click(within(dlg).getByRole("tab", { name: "Error Alert" }));
    fireEvent.change(within(dlg).getByLabelText("Style:"), { target: { value: "warning" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "OK" }));
    await waitFor(() => expect(applied(core.log)).toEqual([{
      type: "setValidation", sheet: 0,
      validation: {
        ranges: [{ r0: 1, c0: 1, r1: 3, c1: 1 }], kind: { type: "list", source: { type: "literal", values: ["pear", "apple", "fig"] } },
        allowBlank: true, showDropdown: true, showInput: true, showError: true, errorStyle: "warning", inputTitle: "Fruit", inputMessage: "Pick one",
      },
    }]));
    const arrow = await screen.findByRole("button", { name: "Show list" });
    expect(screen.getByTestId("validation-input-message").textContent).toBe("FruitPick one");
    fireEvent.click(arrow);
    const list = await screen.findByRole("listbox", { name: "Allowed values" });
    expect(within(list).getAllByRole("option").map((o) => o.textContent)).toEqual(["pear", "apple", "fig"]);
    fireEvent.click(within(list).getByRole("option", { name: "apple" }));
    await waitFor(() => expect(applied(core.log).at(-1)).toEqual({ type: "setInput", sheet: 0, row: 1, col: 1, input: "apple" }));
    // Outside the validated range: no arrow, no message.
    select(grid, 6, 6);
    expect(screen.queryByRole("button", { name: "Show list" })).toBeNull();
    expect(screen.queryByTestId("validation-input-message")).toBeNull();
  });

  it("Alt+↓ opens the list; Enter picks the highlighted value", async () => {
    const { core, grid } = await setup();
    select(grid, 0, 0);
    await validate(core, (dlg) => {
      fireEvent.change(within(dlg).getByLabelText("Allow:"), { target: { value: "list" } });
      fireEvent.change(within(dlg).getByLabelText("Source:"), { target: { value: "a,b" } });
    });
    await screen.findByRole("button", { name: "Show list" });
    grid.focus();
    fireEvent.keyDown(grid, { key: "ArrowDown", altKey: true });
    const list = await screen.findByRole("listbox", { name: "Allowed values" });
    fireEvent.keyDown(list, { key: "ArrowDown" });
    fireEvent.keyDown(list, { key: "Enter" });
    await waitFor(() => expect(applied(core.log).at(-1)).toEqual({ type: "setInput", sheet: 0, row: 0, col: 0, input: "b" }));
  });

  it("a Stop alert keeps the editor open; Retry returns to it, Cancel restores the cell", async () => {
    const { core, grid } = await setup();
    select(grid, 0, 0);
    await validate(core, (dlg) => {
      fireEvent.change(within(dlg).getByLabelText("Allow:"), { target: { value: "whole" } });
      fireEvent.change(within(dlg).getByLabelText("Data:"), { target: { value: "lessThan" } });
      fireEvent.change(within(dlg).getByLabelText("Value:"), { target: { value: "10" } });
      fireEvent.click(within(dlg).getByRole("tab", { name: "Error Alert" }));
      fireEvent.change(within(dlg).getByLabelText("Title:"), { target: { value: "Too big" } });
      fireEvent.change(within(dlg).getByLabelText("Error message:"), { target: { value: "Below 10" } });
    });
    // The validation reaches the cache with the re-fetched snapshot: the grid is idle again (P9-Q1).
    await waitFor(() => expect(grid.hasAttribute("data-busy")).toBe(false));
    core.log.length = 0;
    grid.focus();
    fireEvent.keyDown(grid, { key: "4" });
    const ed = screen.getByTestId("cell-editor");
    fireEvent.change(ed, { target: { value: "42" } });
    fireEvent.keyDown(ed, { key: "Enter" });
    const alert = await screen.findByRole("dialog", { name: "Too big" });
    expect(within(alert).getByText("Below 10")).toBeTruthy();
    expect(screen.getByTestId("cell-editor")).toBeTruthy();
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(screen.queryByRole("dialog", { name: "Too big" })).toBeNull();
    expect((screen.getByTestId("cell-editor") as HTMLTextAreaElement).value).toBe("42");
    fireEvent.keyDown(screen.getByTestId("cell-editor"), { key: "Enter" });
    fireEvent.click(within(await screen.findByRole("dialog", { name: "Too big" })).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByTestId("cell-editor")).toBeNull());
    expect(applied(core.log)).toEqual([]);
  });

  it("Clear All removes the selection's validation", async () => {
    const { core, grid } = await setup();
    select(grid, 0, 0, 1, 1);
    fireEvent.click(screen.getByRole("tab", { name: "Data" }));
    fireEvent.click(screen.getByRole("button", { name: "Data Validation" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Data Validation" })).getByRole("button", { name: "Clear All" }));
    await waitFor(() => expect(applied(core.log)).toEqual([{ type: "removeValidation", sheet: 0, range: { r0: 0, c0: 0, r1: 1, c1: 1 } }]));
  });
});
