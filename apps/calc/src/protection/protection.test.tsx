// P9-C1: Review › Protect, the protection dialogs, the status bar padlock,
// refused edits, the hidden formula and the sheet tab / Format menu entries.
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import App from "../App";
import { FakeBackend, FakeCalcCore } from "../dev/fakeBackend";
import type { Request } from "../generated/Request";

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
});
afterEach(cleanup);

async function setup(sheets?: string[]) {
  const core = new FakeCalcCore(sheets);
  render(<App backend={new FakeBackend(core)} />);
  await screen.findByRole("tab", { name: "Sheet1" });
  await waitFor(() => expect(core.log.some((r) => r.type === "snapshot")).toBe(true));
  await waitFor(() => expect((screen.getByRole("button", { name: "Bold" }) as HTMLButtonElement).disabled).toBe(false));
  core.log.length = 0;
  const grid = screen.getByTestId("grid");
  grid.focus();
  return { core, grid };
}

const applied = (log: Request[]) => log.flatMap((r) => (r.type === "apply" ? [r.command] : []));

function review() {
  fireEvent.click(screen.getByRole("tab", { name: "Review" }));
}

async function protectWith(password: string) {
  review();
  fireEvent.click(screen.getByRole("button", { name: "Protect Sheet…" }));
  const dlg = await screen.findByRole("dialog", { name: "Protect Sheet" });
  fireEvent.change(within(dlg).getByLabelText("Password to unprotect sheet:"), { target: { value: password } });
  return dlg;
}

describe("protection", () => {
  it("Protect Sheet asks for the password twice and sends the options", async () => {
    const { core } = await setup();
    let dlg = await protectWith("geheim");
    fireEvent.click(within(dlg).getByRole("checkbox", { name: "Select locked cells" }));
    fireEvent.click(within(dlg).getByRole("checkbox", { name: "Format cells" }));
    fireEvent.click(within(dlg).getByRole("button", { name: "OK" }));
    dlg = await screen.findByRole("dialog", { name: "Confirm Password" });
    fireEvent.change(within(dlg).getByLabelText("Reenter password to proceed."), { target: { value: "other" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "OK" }));
    expect(within(dlg).getByRole("alert").textContent).toBe("Confirmation password is not identical.");
    fireEvent.change(within(dlg).getByLabelText("Reenter password to proceed."), { target: { value: "geheim" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "OK" }));
    await waitFor(() => expect(applied(core.log)).toHaveLength(1));
    const cmd = applied(core.log)[0]!;
    expect(cmd.type).toBe("protectSheet");
    if (cmd.type !== "protectSheet") return;
    expect(cmd.password).toBe("geheim");
    expect(cmd.salt).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(cmd.options.selectLockedCells).toBe(true);
    expect(cmd.options.formatCells).toBe(false);
    expect(cmd.options.formatRows).toBe(true);
    // The padlock in the status bar, the button now unprotects.
    await screen.findByTestId("sheet-protected");
    expect(screen.getByRole("button", { name: "Unprotect Sheet" })).toBeTruthy();
  });

  it("typing in a locked cell shows Excel's message; Unprotect checks the password", async () => {
    const { core, grid } = await setup();
    const dlg = await protectWith("");
    fireEvent.click(within(dlg).getByRole("button", { name: "OK" }));
    await screen.findByTestId("sheet-protected");
    fireEvent.keyDown(grid, { key: "x" });
    expect(screen.queryByTestId("cell-editor")).toBeNull();
    expect((await screen.findByRole("alert")).textContent).toContain("is on a protected sheet");
    // Without a password the button unprotects at once.
    core.log.length = 0;
    fireEvent.click(screen.getByRole("button", { name: "Unprotect Sheet" }));
    await waitFor(() => expect(screen.queryByTestId("sheet-protected")).toBeNull());
    expect(applied(core.log)).toEqual([{ type: "unprotectSheet", sheet: 0 }]);
  });

  it("a wrong password keeps the prompt open with Excel's message", async () => {
    await setup();
    let dlg = await protectWith("pw");
    fireEvent.click(within(dlg).getByRole("button", { name: "OK" }));
    dlg = await screen.findByRole("dialog", { name: "Confirm Password" });
    fireEvent.change(within(dlg).getByLabelText("Reenter password to proceed."), { target: { value: "pw" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "OK" }));
    await screen.findByTestId("sheet-protected");
    fireEvent.click(screen.getByRole("button", { name: "Unprotect Sheet" }));
    dlg = await screen.findByRole("dialog", { name: "Unprotect Sheet" });
    fireEvent.change(within(dlg).getByLabelText("Password:"), { target: { value: "PW" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "OK" }));
    expect((await within(dlg).findByRole("alert")).textContent).toMatch(/^The password you supplied is not correct/);
    fireEvent.change(within(dlg).getByLabelText("Password:"), { target: { value: "pw" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "OK" }));
    await waitFor(() => expect(screen.queryByTestId("sheet-protected")).toBeNull());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("the formula bar hides a hidden formula on a protected sheet", async () => {
    const { grid } = await setup();
    fireEvent.keyDown(grid, { key: "=" });
    const ed = screen.getByTestId("cell-editor") as HTMLTextAreaElement;
    fireEvent.change(ed, { target: { value: "=1+2" } });
    fireEvent.keyDown(ed, { key: "Enter" });
    fireEvent.keyDown(grid, { key: "ArrowUp" });
    const bar = screen.getByRole("textbox", { name: "Formula bar" }) as HTMLTextAreaElement;
    await waitFor(() => expect(bar.value).toBe("=1+2"));
    // Format Cells › Protection › Hidden, through the Format menu's Lock Cell and the dialog.
    fireEvent.keyDown(grid, { key: "1", ctrlKey: true });
    const fmt = await screen.findByRole("dialog", { name: "Format cells" });
    fireEvent.click(within(fmt).getByRole("tab", { name: "Protection" }));
    fireEvent.click(within(fmt).getByLabelText("Hidden"));
    fireEvent.submit(fmt.querySelector("form")!);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const dlg = await protectWith("");
    fireEvent.click(within(dlg).getByRole("button", { name: "OK" }));
    await screen.findByTestId("sheet-protected");
    await waitFor(() => expect(bar.value).toBe(""));
    expect(bar.readOnly).toBe(true);
  });

  it("Protect Workbook locks the structure; the sheet tab menu protects a sheet; Lock Cell toggles", async () => {
    const { core } = await setup(["Sheet1", "Sheet2"]);
    review();
    fireEvent.click(screen.getByRole("button", { name: "Protect Workbook" }));
    const dlg = await screen.findByRole("dialog", { name: "Protect Structure and Windows" });
    fireEvent.click(within(dlg).getByRole("button", { name: "OK" }));
    await waitFor(() => expect(applied(core.log)).toEqual([{ type: "protectWorkbook", structure: true, windows: false }]));
    const sheetTab = within(screen.getByRole("tablist", { name: "Sheets" })).getByRole("tab", { name: "Sheet2" });
    fireEvent.contextMenu(sheetTab, { clientX: 30, clientY: 380 });
    fireEvent.click(within(screen.getByRole("menu", { name: "Sheet" })).getByRole("menuitem", { name: "Move left" }));
    expect((await screen.findByRole("alert")).textContent).toContain("The workbook is protected and cannot be changed.");
    fireEvent.contextMenu(sheetTab, { clientX: 30, clientY: 380 });
    fireEvent.click(within(screen.getByRole("menu", { name: "Sheet" })).getByRole("menuitem", { name: "Protect Sheet…" }));
    expect(await screen.findByRole("dialog", { name: "Protect Sheet" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    // Home › Format › Lock Cell unlocks the selection.
    core.log.length = 0;
    fireEvent.click(screen.getByRole("tab", { name: "Home" }));
    fireEvent.click(screen.getByRole("button", { name: "Format" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Lock Cell" }));
    await waitFor(() => expect(applied(core.log)).toEqual([{ type: "applyStyle", sheet: 1, r0: 0, c0: 0, r1: 0, c1: 0, patch: { protection: { locked: false } } }]));
  });
});
