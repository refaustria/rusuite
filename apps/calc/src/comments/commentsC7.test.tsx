// P9-C7: the Comments pane across sheets, @mentions, followed links, Remove Hyperlink.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import App from "../App";
import { FakeBackend, FakeCalcCore } from "../dev/fakeBackend";
import type { CalcCommand } from "../generated/CalcCommand";
import type { Request } from "../generated/Request";
import type { CalcStore } from "../state/store";
import { USER_KEY } from "./controller";
import { insertMention, mentionCandidates, mentionQuery } from "./mentions";
import { computeRenderOps, type SheetData, type TextOp } from "../grid/render";
import { colGeometry, DEFAULT_FORMAT, rowGeometry } from "../grid/geometry";
import { CALC_THEME } from "../grid/style";
import { OFFICE_THEME } from "@rusuite/ui-shared";

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
});
beforeEach(() => localStorage.setItem(USER_KEY, JSON.stringify({ name: "Ann Lee", initials: "AL" })));
afterEach(cleanup);

const applied = (log: Request[]): CalcCommand[] => log.flatMap((r) => (r.type === "apply" ? [r.command] : []));

async function setup() {
  const core = new FakeCalcCore(["Sheet1", "Data"]);
  render(<App backend={new FakeBackend(core)} />);
  await screen.findByRole("tab", { name: "Sheet1" });
  const store = (window as unknown as { __calc: { store: CalcStore } }).__calc.store;
  core.log.length = 0;
  return { core, store };
}

const comment = (sheet: number, row: number, col: number, text: string): CalcCommand => ({
  type: "addComment", sheet, row, col, text, author: { name: "Ann Lee", initials: "AL" }, date: "2026-10-18T09:00:00.00",
});

describe("Comments pane across sheets", () => {
  it("lists the threads of every sheet by sheet; a card goes to its cell; Resolve works from the pane", async () => {
    const { core, store } = await setup();
    await store.apply(comment(0, 1, 1, "first sheet"));
    await store.apply(comment(1, 4, 2, "second sheet"));
    fireEvent.click(screen.getByRole("tab", { name: "Review" }));
    fireEvent.click(screen.getByRole("button", { name: "Show Comments" }));
    const pane = await screen.findByTestId("comments-pane");
    await waitFor(() => expect(within(pane).getAllByTestId("comments-sheet").map((g) => g.dataset.sheet)).toEqual(["Sheet1", "Data"]));
    expect(core.log.some((r) => r.type === "allComments" && r.sheet === null)).toBe(true);
    const data = within(pane).getAllByTestId("comments-sheet")[1]!;
    fireEvent.click(within(data).getByTestId("thread"));
    await waitFor(() => expect(store.getState().activeSheet).toBe(1));
    expect(store.getState().selection.anchor).toEqual({ row: 4, col: 2 });
    fireEvent.click(within(data).getByRole("button", { name: "Resolve" }));
    await waitFor(() => expect(applied(core.log).some((c) => c.type === "resolveThread" && c.sheet === 1 && c.resolved)).toBe(true));
  });

  it("the reply box suggests people after @ and inserts the name", async () => {
    const { store } = await setup();
    await store.apply({ type: "setUser", name: "Bob Stone", initials: "BS" });
    await store.apply(comment(0, 0, 0, "hello"));
    fireEvent.click(screen.getByRole("tab", { name: "Review" }));
    fireEvent.click(screen.getByRole("button", { name: "Show Comments" }));
    const pane = await screen.findByTestId("comments-pane");
    const box = (await within(pane).findByLabelText("Reply")) as HTMLInputElement;
    fireEvent.change(box, { target: { value: "thanks @bo", selectionEnd: 10 } });
    const list = await within(pane).findByRole("listbox", { name: "Mention someone" });
    expect(within(list).getAllByRole("option").map((o) => o.textContent)).toEqual(["Bob Stone"]);
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(box.value).toBe("thanks @Bob Stone "));
  });
});

describe("@mention helpers", () => {
  const people = [{ name: "Ann Lee" }, { name: "Bob Stone" }, { name: "Bea" }];
  it("finds the query being typed after a word-starting @", () => {
    expect(mentionQuery("hi @Bo", 6)).toEqual({ start: 3, query: "Bo" });
    expect(mentionQuery("mail@x", 6)).toBeNull();
    expect(mentionQuery("@Ann Lee is", 7)).toEqual({ start: 0, query: "Ann Le" });
    expect(mentionQuery("no at", 5)).toBeNull();
  });
  it("matches names by any word, case-insensitive; inserts @Name and a space", () => {
    expect(mentionCandidates(people, "b").map((p) => p.name)).toEqual(["Bob Stone", "Bea"]);
    expect(mentionCandidates(people, "lee").map((p) => p.name)).toEqual(["Ann Lee"]);
    expect(insertMention("hi @an!", 3, 6, "Ann Lee")).toEqual({ text: "hi @Ann Lee !", caret: 12 });
  });
});

describe("hyperlink colours", () => {
  it("the shared Office theme carries hlink / folHlink; a followed link cell draws in the followed colour", () => {
    expect(OFFICE_THEME.hyperlink).toBe("0563C1");
    expect(OFFICE_THEME.followedHyperlink).toBe("954F72");
    expect(CALC_THEME.hyperlink).toBe("0563C1");
    const cells = new Map([[0, new Map([[0, { row: 0, col: 0, input: "x", display: "x", kind: "text" as const, style: 1 }]])]]);
    const cols = new Map(), rows = new Map();
    const data: SheetData = { cells, cols, rows, colGeo: colGeometry(DEFAULT_FORMAT, cols), rowGeo: rowGeometry(DEFAULT_FORMAT, rows) };
    const styles = [{}, { font: { color: { kind: "theme" as const, value: { slot: "hyperlink" as const, tint: 0 } }, underline: "single" as const } }];
    const vp = { scrollX: 0, scrollY: 0, width: 200, height: 40 };
    const text = (d: SheetData) => computeRenderOps(vp, d, styles).find((o): o is TextOp => o.op === "text")!;
    expect(text(data).color.toUpperCase()).toBe("#0563C1");
    expect(text({ ...data, followed: () => true }).color.toUpperCase()).toBe("#954F72");
  });
});
