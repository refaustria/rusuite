import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import App from "./App";
import { FakeBackend, FakeCalcCore } from "./dev/fakeBackend";
import type { Request } from "./generated/Request";

beforeAll(() => {
  // jsdom has no canvas; drawing is covered by computeRenderOps tests.
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
});
afterEach(cleanup);

async function setup(sheets?: string[]) {
  const core = new FakeCalcCore(sheets);
  const backend = new FakeBackend(core);
  render(<App backend={backend} />);
  await screen.findByRole("tab", { name: "Sheet1" });
  await waitFor(() => expect(core.log.some((r) => r.type === "snapshot")).toBe(true));
  core.log.length = 0;
  const grid = screen.getByTestId("grid");
  grid.focus();
  return { core, grid, backend };
}

const applied = (log: Request[]) => log.flatMap((r) => (r.type === "apply" ? [r.command] : []));
const address = () => screen.getByTestId("cell-address").textContent;

describe("App", () => {
  it("starts with NewDocument, Info and a first snapshot", async () => {
    const core = new FakeCalcCore();
    render(<App backend={new FakeBackend(core)} />);
    await waitFor(() => expect(core.log.map((r) => r.type).slice(0, 3)).toEqual(["newDocument", "info", "snapshot"]));
    expect(screen.getByRole("toolbar", { name: "Formatting" })).toBeTruthy();
    expect(address()).toBe("A1");
  });

  it("typing =1+2 and Enter sends SetInput and moves the selection down", async () => {
    const { core, grid } = await setup();
    fireEvent.keyDown(grid, { key: "=" });
    const editor = screen.getByTestId("cell-editor") as HTMLInputElement;
    expect(editor.value).toBe("=");
    expect((screen.getByLabelText("Formula bar") as HTMLInputElement).value).toBe("=");
    fireEvent.change(editor, { target: { value: "=1+2" } });
    fireEvent.keyDown(editor, { key: "Enter" });
    await waitFor(() => expect(applied(core.log)).toEqual([{ type: "setInput", sheet: 0, row: 0, col: 0, input: "=1+2" }]));
    expect(address()).toBe("A2");
    expect(screen.queryByTestId("cell-editor")).toBeNull();
    fireEvent.keyDown(grid, { key: "ArrowUp" });
    expect((screen.getByLabelText("Formula bar") as HTMLInputElement).value).toBe("=1+2");
  });

  it("Esc cancels the edit without sending anything", async () => {
    const { core, grid } = await setup();
    fireEvent.keyDown(grid, { key: "x" });
    fireEvent.keyDown(screen.getByTestId("cell-editor"), { key: "Escape" });
    expect(screen.queryByTestId("cell-editor")).toBeNull();
    expect(applied(core.log)).toEqual([]);
    expect(address()).toBe("A1");
  });

  it("Tab commits and moves right; F2 edits the existing input", async () => {
    const { core, grid } = await setup();
    fireEvent.keyDown(grid, { key: "7" });
    fireEvent.keyDown(screen.getByTestId("cell-editor"), { key: "Tab" });
    await waitFor(() => expect(applied(core.log)).toHaveLength(1));
    expect(address()).toBe("B1");
    fireEvent.keyDown(grid, { key: "ArrowLeft" });
    fireEvent.keyDown(grid, { key: "F2" });
    expect((screen.getByTestId("cell-editor") as HTMLInputElement).value).toBe("7");
  });

  it("Ctrl+Z sends Undo and Ctrl+Y / Ctrl+Shift+Z send Redo", async () => {
    const { core, grid } = await setup();
    fireEvent.keyDown(grid, { key: "z", ctrlKey: true });
    fireEvent.keyDown(grid, { key: "y", ctrlKey: true });
    fireEvent.keyDown(grid, { key: "Z", ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(core.log.map((r) => r.type)).toEqual(["undo", "redo", "redo"]));
  });

  it("Ctrl+B applies bold to the selection; Delete clears it", async () => {
    const { core, grid } = await setup();
    fireEvent.keyDown(grid, { key: "ArrowRight", shiftKey: true });
    fireEvent.keyDown(grid, { key: "b", ctrlKey: true });
    fireEvent.keyDown(grid, { key: "Delete" });
    await waitFor(() => expect(applied(core.log)).toEqual([
      { type: "applyStyle", sheet: 0, r0: 0, c0: 0, r1: 0, c1: 1, patch: { font: { bold: true } } },
      { type: "clearRange", sheet: 0, r0: 0, c0: 0, r1: 0, c1: 1 },
    ]));
  });

  it("the toolbar sends ApplyStyle with CellStyle-shaped patches", async () => {
    const { core } = await setup();
    fireEvent.click(screen.getByRole("button", { name: "Italic" }));
    fireEvent.click(screen.getByRole("button", { name: "Align center" }));
    await waitFor(() => expect(applied(core.log).map((c) => c.type === "applyStyle" && c.patch)).toEqual([
      { font: { italic: true } }, { alignment: { horizontal: "center" } },
    ]));
    await waitFor(() => expect(screen.getByRole("button", { name: "Italic" }).getAttribute("aria-pressed")).toBe("true"));
  });

  it("clicking a sheet tab switches the sheet and requests its snapshot", async () => {
    const { core } = await setup(["Sheet1", "Sheet2"]);
    fireEvent.click(screen.getByRole("tab", { name: "Sheet2" }));
    expect(screen.getByRole("tab", { name: "Sheet2" }).getAttribute("aria-selected")).toBe("true");
    await waitFor(() => expect(core.log.some((r) => r.type === "snapshot" && r.sheet === 1)).toBe(true));
    expect(address()).toBe("Sheet2!A1");
  });

  it("adds and renames sheets", async () => {
    const { core } = await setup();
    fireEvent.click(screen.getByRole("button", { name: "Add sheet" }));
    const tab = await screen.findByRole("tab", { name: "Sheet2" });
    expect(tab.getAttribute("aria-selected")).toBe("true");
    fireEvent.doubleClick(tab);
    const input = screen.getByLabelText("Sheet name");
    fireEvent.change(input, { target: { value: "Data" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await screen.findByRole("tab", { name: "Data" });
    expect(applied(core.log)).toEqual([{ type: "addSheet", name: "Sheet2" }, { type: "renameSheet", sheet: 1, name: "Data" }]);
  });

  it("edits through the formula bar", async () => {
    const { core } = await setup();
    const bar = screen.getByLabelText("Formula bar") as HTMLInputElement;
    fireEvent.focus(bar);
    fireEvent.change(bar, { target: { value: "hello" } });
    expect((screen.getByTestId("cell-editor") as HTMLInputElement).value).toBe("hello");
    fireEvent.keyDown(bar, { key: "Enter" });
    await waitFor(() => expect(applied(core.log)).toEqual([{ type: "setInput", sheet: 0, row: 0, col: 0, input: "hello" }]));
    expect(address()).toBe("A2");
  });

  it("pastes TSV from the clipboard event", async () => {
    const { core, grid } = await setup();
    fireEvent.paste(grid, { clipboardData: { getData: () => "1\t2" } });
    await waitFor(() => expect(applied(core.log)).toEqual([{
      type: "compound",
      commands: [
        { type: "setInput", sheet: 0, row: 0, col: 0, input: "1" },
        { type: "setInput", sheet: 0, row: 0, col: 1, input: "2" },
      ],
    }]));
    expect(address()).toBe("A1:B1");
  });

  it("keeps an unparsable formula open with an inline error; backend errors become a toast", async () => {
    const { core, grid } = await setup();
    fireEvent.keyDown(grid, { key: "=" });
    const editor = screen.getByTestId("cell-editor") as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: "=SUM(1" } });
    await act(async () => {
      fireEvent.keyDown(editor, { key: "Enter" });
    });
    expect(screen.getByTestId("formula-error").textContent).toMatch(/in call to SUM.*press Esc to discard/);
    expect((screen.getByTestId("cell-editor") as HTMLTextAreaElement).value).toBe("=SUM(1");
    expect(applied(core.log)).toEqual([]);
    fireEvent.keyDown(screen.getByTestId("cell-editor"), { key: "Escape" });
    expect(screen.queryByTestId("cell-editor")).toBeNull();
    const exec = vi.spyOn(core, "exec").mockImplementationOnce(() => {
      throw new Error("boom");
    });
    fireEvent.keyDown(grid, { key: "4" });
    await act(async () => {
      fireEvent.keyDown(screen.getByTestId("cell-editor"), { key: "Enter" });
    });
    expect((await screen.findByRole("alert")).textContent).toMatch(/internal/);
    exec.mockRestore();
    fireEvent.keyDown(grid, { key: "5" });
    fireEvent.keyDown(screen.getByTestId("cell-editor"), { key: "Enter" });
    await waitFor(() => expect(screen.getByTestId("status-bar").textContent).toMatch(new RegExp(`Revision ${core.revision}.*Modified`)));
  });

  it("Open: picks a file, sends openXlsx, reloads and shows warnings and the title", async () => {
    const { core, backend } = await setup();
    await waitFor(() => expect(backend.title).toBe("Untitled – Rusuite Calc"));
    backend.nextOpen = { name: "budget.xlsx", bytesBase64: "UEsDBA==" };
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    await waitFor(() => expect(screen.getByTestId("open-warnings").textContent).toMatch(/file content ignored/));
    expect(core.log[0]).toEqual({ type: "openXlsx", bytesBase64: "UEsDBA==", name: "budget.xlsx" });
    expect(core.log.some((r) => r.type === "snapshot")).toBe(true);
    await waitFor(() => expect(backend.title).toBe("budget.xlsx – Rusuite Calc"));
    fireEvent.keyDown(screen.getByTestId("grid"), { key: "1" });
    fireEvent.keyDown(screen.getByTestId("cell-editor"), { key: "Enter" });
    await waitFor(() => expect(backend.title).toBe("budget.xlsx • – Rusuite Calc"));
  });

  it("Save (Ctrl+S): saveXlsx, writes the file, then markSaved; a cancelled write stays dirty", async () => {
    const { core, backend, grid } = await setup();
    fireEvent.keyDown(grid, { key: "1" });
    fireEvent.keyDown(screen.getByTestId("cell-editor"), { key: "Enter" });
    await waitFor(() => expect(screen.getByTestId("status-bar").textContent).toMatch(/Modified/));
    backend.saveResult = false;
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    await waitFor(() => expect(core.log.filter((r) => r.type === "saveXlsx")).toHaveLength(1));
    expect(core.log.some((r) => r.type === "markSaved")).toBe(false);
    expect(screen.getByTestId("status-bar").textContent).toMatch(/Modified/);
    backend.saveResult = true;
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(core.log.map((r) => r.type).slice(-2)).toEqual(["saveXlsx", "markSaved"]));
    expect(backend.saved).toEqual([{ name: "Untitled.xlsx", bytesBase64: "UEsDBA==" }]);
    await waitFor(() => expect(screen.getByTestId("status-bar").textContent).toMatch(/Saved/));
  });
});

describe("App recovery (P5-3)", () => {
  it("offers an earlier session's autosave and restores it as modified", async () => {
    const { MemoryDocStorage } = await import("@rusuite/ui-shared");
    const storage = new MemoryDocStorage();
    // What an earlier session of the fake core autosaved before it crashed.
    const earlier = new FakeCalcCore();
    earlier.handle({ type: "apply", command: { type: "setInput", sheet: 0, row: 0, col: 0, input: "recovered" } });
    const snap = earlier.handle({ type: "recoverySnapshot" });
    const json = "ok" in snap && snap.ok.type === "recoverySnapshot" ? snap.ok.json : "";
    await storage.putRecovery({ id: "crashed", name: "budget.xlsx", savedAt: Date.now(), revision: 1, json });

    const core = new FakeCalcCore();
    const backend = Object.assign(new FakeBackend(core), { storage });
    render(<App backend={backend} />);
    const banner = await screen.findByRole("region", { name: "Recovered documents" });
    expect(banner.textContent).toContain("budget.xlsx");
    fireEvent.click(screen.getByRole("button", { name: "Restore budget.xlsx" }));
    await waitFor(() => expect(screen.queryByTestId("recovery-banner")).toBeNull());
    expect(core.log.some((r) => r.type === "restoreRecovery")).toBe(true);
    await waitFor(() => expect(backend.title).toBe("budget.xlsx • – Rusuite Calc"));
    expect(screen.getByTestId("status-bar").textContent).toContain("Modified");
    expect((screen.getByLabelText("Formula bar") as HTMLInputElement).value).toBe("recovered");
    // The restored workbook is autosaved under the new session; the old entry is gone.
    await waitFor(() => expect([...storage.recovery.keys()]).toHaveLength(1));
    expect(storage.recovery.has("crashed")).toBe(false);
  });

  it("Discard drops the entry; the File menu lists recent files", async () => {
    const { MemoryDocStorage } = await import("@rusuite/ui-shared");
    const storage = new MemoryDocStorage();
    await storage.putRecovery({ id: "old", name: null, savedAt: Date.now(), revision: 1, json: '{"cells":[]}' });
    await storage.rememberRecent("last.xlsx", '{"cells":[[0,0,0,"from recent"]]}');
    const core = new FakeCalcCore();
    render(<App backend={Object.assign(new FakeBackend(core), { storage })} />);
    fireEvent.click(await screen.findByRole("button", { name: "Discard Untitled" }));
    await waitFor(() => expect(screen.queryByTestId("recovery-banner")).toBeNull());
    expect(storage.recovery.size).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "File" }));
    const entry = await screen.findByTestId("recent-entry");
    expect(entry.textContent).toContain("last.xlsx");
    expect(screen.getByTestId("recent-web-note")).toBeTruthy();
    fireEvent.click(entry);
    await waitFor(() => expect((screen.getByLabelText("Formula bar") as HTMLInputElement).value).toBe("from recent"));
  });
});
