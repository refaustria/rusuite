// P7-4: sheet tab context menu (insert, delete with confirm, duplicate,
// move, tab colour), drag reorder, Shift+F11 and the ribbon's Sheet menu.
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import App from "./App";
import { FakeBackend, FakeCalcCore } from "./dev/fakeBackend";
import type { Request } from "./generated/Request";

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
const tabs = () => within(screen.getByRole("tablist", { name: "Sheets" })).getAllByRole("tab").map((t) => t.textContent);
const tab = (name: string) => within(screen.getByRole("tablist", { name: "Sheets" })).getByRole("tab", { name });
const activeTab = () => within(screen.getByRole("tablist", { name: "Sheets" })).getByRole("tab", { selected: true }).textContent;

function menuItem(sheet: string, label: string | RegExp): HTMLElement {
  fireEvent.contextMenu(tab(sheet), { clientX: 30, clientY: 380 });
  return within(screen.getByRole("menu", { name: "Sheet" })).getByRole("menuitem", { name: label });
}

async function typeCell(grid: HTMLElement, text: string) {
  fireEvent.keyDown(grid, { key: text[0]! });
  const ed = screen.getByTestId("cell-editor") as HTMLTextAreaElement;
  fireEvent.change(ed, { target: { value: text } });
  fireEvent.keyDown(ed, { key: "Enter" });
}

describe("sheet tabs", () => {
  it("Duplicate copies the sheet next to it and shows the copy", async () => {
    const { core } = await setup(["Sheet1", "Sheet2"]);
    fireEvent.click(menuItem("Sheet1", "Duplicate"));
    await waitFor(() => expect(tabs()).toEqual(["Sheet1", "Sheet1 (2)", "Sheet2"]));
    expect(applied(core.log)).toEqual([{ type: "duplicateSheet", sheet: 0, name: "Sheet1 (2)" }]);
    await waitFor(() => expect(activeTab()).toBe("Sheet1 (2)"));
    fireEvent.click(menuItem("Sheet1 (2)", "Duplicate"));
    await waitFor(() => expect(tabs()).toContain("Sheet1 (3)"));
  });

  it("deleting an empty sheet needs no confirmation; the neighbour becomes active", async () => {
    const { core } = await setup(["Sheet1", "Sheet2", "Sheet3"]);
    fireEvent.click(tab("Sheet2"));
    fireEvent.click(menuItem("Sheet2", "Delete sheet"));
    await waitFor(() => expect(tabs()).toEqual(["Sheet1", "Sheet3"]));
    expect(applied(core.log)).toEqual([{ type: "deleteSheet", sheet: 1 }]);
    expect(activeTab()).toBe("Sheet3");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("deleting a sheet with data asks first; Cancel keeps it, Delete removes it and undo restores it", async () => {
    const { core, grid } = await setup(["Sheet1", "Sheet2"]);
    await typeCell(grid, "42");
    await waitFor(() => expect(applied(core.log)).toHaveLength(1));
    fireEvent.click(menuItem("Sheet1", "Delete sheet"));
    let dlg = await screen.findByRole("dialog", { name: "Delete sheet" });
    expect(dlg.textContent).toContain("Sheet1");
    fireEvent.click(within(dlg).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(tabs()).toEqual(["Sheet1", "Sheet2"]);

    fireEvent.click(menuItem("Sheet1", "Delete sheet"));
    dlg = await screen.findByRole("dialog", { name: "Delete sheet" });
    fireEvent.click(within(dlg).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(tabs()).toEqual(["Sheet2"]));
    expect(applied(core.log).at(-1)).toEqual({ type: "deleteSheet", sheet: 0 });
    // The last sheet cannot be deleted.
    expect((menuItem("Sheet2", "Delete sheet") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(screen.getByRole("menu", { name: "Sheet" }), { key: "Escape" });

    fireEvent.keyDown(screen.getByTestId("grid"), { key: "z", ctrlKey: true });
    await waitFor(() => expect(tabs()).toEqual(["Sheet1", "Sheet2"]));
  });

  it("Move left / right and drag and drop reorder the tabs", async () => {
    const { core } = await setup(["Sheet1", "Sheet2", "Sheet3"]);
    expect((menuItem("Sheet1", "Move left") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(menuItem("Sheet1", "Move right"));
    await waitFor(() => expect(tabs()).toEqual(["Sheet2", "Sheet1", "Sheet3"]));
    fireEvent.click(menuItem("Sheet3", "Move left"));
    await waitFor(() => expect(tabs()).toEqual(["Sheet2", "Sheet3", "Sheet1"]));
    // Drag Sheet2 onto Sheet1 (jsdom has no layout: a drop lands before the target).
    fireEvent.dragStart(tab("Sheet2"));
    fireEvent.dragOver(tab("Sheet1"));
    fireEvent.drop(tab("Sheet1"));
    await waitFor(() => expect(tabs()).toEqual(["Sheet3", "Sheet2", "Sheet1"]));
    expect(applied(core.log)).toEqual([
      { type: "moveSheet", sheet: 0, index: 1 },
      { type: "moveSheet", sheet: 2, index: 1 },
      { type: "moveSheet", sheet: 1, index: 1 },
    ]);
  });

  it("Tab colour… colours the tab underline; No colour removes it", async () => {
    const { core } = await setup();
    fireEvent.click(menuItem("Sheet1", "Tab colour…"));
    const dlg = await screen.findByRole("dialog", { name: "Tab colour" });
    fireEvent.click(within(dlg).getByRole("button", { name: "#FF0000" }));
    await waitFor(() => expect(within(tab("Sheet1")).getByTestId("tab-color").style.background).toBe("rgb(255, 0, 0)"));
    fireEvent.click(menuItem("Sheet1", "Tab colour…"));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "Tab colour" })).getByRole("button", { name: "No colour" }));
    await waitFor(() => expect(within(tab("Sheet1")).queryByTestId("tab-color")).toBeNull());
    expect(applied(core.log)).toEqual([
      { type: "setSheetTabColor", sheet: 0, color: { kind: "rgb", value: "FF0000" } },
      { type: "setSheetTabColor", sheet: 0, color: null },
    ]);
  });

  it("Insert sheet (menu and Shift+F11) adds a sheet before the active one", async () => {
    const { core, grid } = await setup(["Sheet1", "Sheet2"]);
    fireEvent.click(menuItem("Sheet2", /^Insert sheet/));
    await waitFor(() => expect(tabs()).toEqual(["Sheet1", "Sheet3", "Sheet2"]));
    await waitFor(() => expect(activeTab()).toBe("Sheet3"));
    fireEvent.keyDown(grid, { key: "F11", shiftKey: true });
    await waitFor(() => expect(tabs()).toEqual(["Sheet1", "Sheet4", "Sheet3", "Sheet2"]));
    expect(applied(core.log)).toEqual([
      { type: "addSheet", name: "Sheet3", index: 1 },
      { type: "addSheet", name: "Sheet4", index: 1 },
    ]);
  });

  it("the ribbon's Insert › Sheet menu acts on the active sheet", async () => {
    const { core } = await setup(["Sheet1", "Sheet2"]);
    fireEvent.click(tab("Sheet2"));
    fireEvent.click(screen.getByRole("tab", { name: "Insert" }));
    fireEvent.click(screen.getByRole("button", { name: "Sheet" }));
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Rename" }));
    const dlg = await screen.findByRole("dialog", { name: "Rename sheet" });
    const input = within(dlg).getByRole("textbox") as HTMLInputElement;
    expect(input.value).toBe("Sheet2");
    fireEvent.change(input, { target: { value: "Data" } });
    fireEvent.submit(input.form!);
    await waitFor(() => expect(tabs()).toEqual(["Sheet1", "Data"]));
    fireEvent.click(screen.getByRole("button", { name: "Sheet" }));
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Move left" }));
    await waitFor(() => expect(tabs()).toEqual(["Data", "Sheet1"]));
    expect(applied(core.log)).toEqual([
      { type: "renameSheet", sheet: 1, name: "Data" },
      { type: "moveSheet", sheet: 1, index: 0 },
    ]);
  });
});
