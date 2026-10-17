// P9-C1: Home › Borders ▾ sends one setBorders command per preset; More Borders opens Format Cells › Border.
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import App from "../App";
import { FakeBackend, FakeCalcCore } from "../dev/fakeBackend";
import type { Request } from "../generated/Request";

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
});
afterEach(cleanup);

const applied = (log: Request[]) => log.flatMap((r) => (r.type === "apply" ? [r.command] : []));

describe("Home › Borders", () => {
  it("No Border, All Borders and Thick Outside Borders go through setBorders", async () => {
    const core = new FakeCalcCore();
    render(<App backend={new FakeBackend(core)} />);
    await screen.findByRole("tab", { name: "Sheet1" });
    await waitFor(() => expect((screen.getByRole("button", { name: "Bold" }) as HTMLButtonElement).disabled).toBe(false));
    core.log.length = 0;
    for (const name of ["No Border", "All Borders", "Thick Outside Borders"]) {
      fireEvent.click(screen.getByRole("button", { name: "Borders" }));
      fireEvent.click(screen.getByRole("menuitem", { name }));
    }
    await waitFor(() => expect(applied(core.log)).toHaveLength(3));
    const cmds = applied(core.log);
    expect(cmds.every((c) => c.type === "setBorders")).toBe(true);
    if (cmds[2]!.type === "setBorders") expect(cmds[2]!.edits.left).toEqual({ kind: "line", side: { style: "medium", color: { kind: "auto" } } });
    fireEvent.click(screen.getByRole("button", { name: "Borders" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "More Borders…" }));
    const dlg = await screen.findByRole("dialog", { name: "Format cells" });
    expect(within(dlg).getByRole("tab", { name: "Border", selected: true })).toBeTruthy();
  });
});
