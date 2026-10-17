// P9-C1: Move or Copy, Unhide with several sheets, Ctrl+PageUp/Down skip
// hidden sheets, coloured inactive tabs, the active sheet sent on save.
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import App from "../App";
import { FakeBackend, FakeCalcCore } from "../dev/fakeBackend";
import type { Request } from "../generated/Request";
import { readableOn } from "../SheetTabs";

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
});
afterEach(cleanup);

async function setup(sheets?: string[]) {
  const core = new FakeCalcCore(sheets);
  render(<App backend={new FakeBackend(core)} />);
  await screen.findByRole("tab", { name: "Sheet1" });
  await waitFor(() => expect(core.log.some((r) => r.type === "snapshot")).toBe(true));
  core.log.length = 0;
  const grid = screen.getByTestId("grid");
  grid.focus();
  return { core, grid };
}

const applied = (log: Request[]) => log.flatMap((r) => (r.type === "apply" ? [r.command] : []));
const tabList = () => within(screen.getByRole("tablist", { name: "Sheets" }));
const tabs = () => tabList().getAllByRole("tab").map((t) => t.textContent);
const activeTab = () => tabList().getByRole("tab", { selected: true }).textContent;

function menuItem(sheet: string, label: string | RegExp): HTMLElement {
  fireEvent.contextMenu(tabList().getByRole("tab", { name: sheet }), { clientX: 30, clientY: 380 });
  return within(screen.getByRole("menu", { name: "Sheet" })).getByRole("menuitem", { name: label });
}

describe("sheet handling (P9-C1)", () => {
  it("Move or Copy with Create a copy puts Sheet1 (2) before the chosen sheet, as one command", async () => {
    const { core } = await setup(["Sheet1", "Sheet2", "Sheet3"]);
    fireEvent.click(menuItem("Sheet1", "Move or Copy…"));
    const dlg = await screen.findByRole("dialog", { name: "Move or Copy" });
    fireEvent.click(within(dlg).getByRole("option", { name: "Sheet3" }));
    fireEvent.click(within(dlg).getByRole("checkbox", { name: "Create a copy" }));
    fireEvent.click(within(dlg).getByRole("button", { name: "OK" }));
    await waitFor(() => expect(tabs()).toEqual(["Sheet1", "Sheet2", "Sheet1 (2)", "Sheet3"]));
    expect(applied(core.log)).toEqual([{ type: "duplicateSheet", sheet: 0, name: "Sheet1 (2)", index: 2 }]);
    await waitFor(() => expect(activeTab()).toBe("Sheet1 (2)"));
  });

  it("Move or Copy without a copy moves; (move to end) puts the sheet last", async () => {
    const { core } = await setup(["Sheet1", "Sheet2", "Sheet3"]);
    fireEvent.click(menuItem("Sheet1", "Move or Copy…"));
    const dlg = await screen.findByRole("dialog", { name: "Move or Copy" });
    fireEvent.click(within(dlg).getByRole("option", { name: "(move to end)" }));
    fireEvent.click(within(dlg).getByRole("button", { name: "OK" }));
    await waitFor(() => expect(tabs()).toEqual(["Sheet2", "Sheet3", "Sheet1"]));
    expect(applied(core.log)).toEqual([{ type: "moveSheet", sheet: 0, index: 2 }]);
  });

  it("Unhide shows several picked sheets in one step; Ctrl+PageDown skips hidden sheets", async () => {
    const { core, grid } = await setup(["Sheet1", "Sheet2", "Sheet3", "Sheet4"]);
    for (const s of ["Sheet2", "Sheet3"]) fireEvent.click(menuItem(s, "Hide"));
    await waitFor(() => expect(tabs()).toEqual(["Sheet1", "Sheet4"]));
    fireEvent.click(tabList().getByRole("tab", { name: "Sheet1" }));
    await waitFor(() => expect(activeTab()).toBe("Sheet1"));
    const g = screen.getByTestId("grid");
    g.focus();
    fireEvent.keyDown(g, { key: "PageDown", ctrlKey: true });
    void grid;
    await waitFor(() => expect(activeTab()).toBe("Sheet4"));
    core.log.length = 0;
    fireEvent.click(menuItem("Sheet1", "Unhide…"));
    const dlg = await screen.findByRole("dialog", { name: "Unhide" });
    const list = within(dlg).getByRole("listbox");
    expect(list.getAttribute("aria-multiselectable")).toBe("true");
    fireEvent.click(within(dlg).getByRole("option", { name: "Sheet3" }), { ctrlKey: true });
    expect(within(dlg).getAllByRole("option", { selected: true }).map((o) => o.textContent)).toEqual(["Sheet2", "Sheet3"]);
    fireEvent.click(within(dlg).getByRole("button", { name: "OK" }));
    await waitFor(() => expect(tabs()).toEqual(["Sheet1", "Sheet2", "Sheet3", "Sheet4"]));
    expect(applied(core.log)).toEqual([
      { type: "compound", commands: [{ type: "setSheetHidden", sheet: 1, hidden: false }, { type: "setSheetHidden", sheet: 2, hidden: false }] },
    ]);
  });

  it("an inactive coloured tab is filled; the active one shows a bar; save sends the active sheet", async () => {
    const { core } = await setup(["Sheet1", "Sheet2"]);
    fireEvent.click(menuItem("Sheet2", "Tab colour…"));
    const dlg = await screen.findByRole("dialog", { name: "Tab colour" });
    fireEvent.click(within(dlg).getByRole("button", { name: "#FF0000" }));
    await waitFor(() => expect(tabList().getByRole("tab", { name: "Sheet2" }).hasAttribute("data-tab-fill")).toBe(false));
    // Sheet2 is active (the context menu selected it): bar, no fill.
    expect(within(tabList().getByRole("tab", { name: "Sheet2" })).getByTestId("tab-color")).toBeTruthy();
    fireEvent.click(tabList().getByRole("tab", { name: "Sheet1" }));
    const inactive = tabList().getByRole("tab", { name: "Sheet2" });
    await waitFor(() => expect(inactive.hasAttribute("data-tab-fill")).toBe(true));
    expect(inactive.style.background).toMatch(/rgb\(255, 0, 0\)|#FF0000/i);
    expect(readableOn("#FF0000")).toBe("#000000");
    expect(readableOn("#002060")).toBe("#ffffff");
    core.log.length = 0;
    fireEvent.keyDown(screen.getByTestId("grid"), { key: "s", ctrlKey: true });
    await waitFor(() => expect(core.log.find((r) => r.type === "saveXlsx")).toEqual({ type: "saveXlsx", activeSheet: 0 }));
  });
});
