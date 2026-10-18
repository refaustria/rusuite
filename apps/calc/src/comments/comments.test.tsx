// P8-26: notes, comments and links through the store and the UI, against
// the fake backend: commands sent, annotation lists from patches, hover,
// the composer and user prompt, the pane, the Link dialog, following links
// and printing.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import App from "../App";
import { CalcApi } from "../backend/calcApi";
import { FakeBackend, FakeCalcCore } from "../dev/fakeBackend";
import type { CalcCommand } from "../generated/CalcCommand";
import type { Request } from "../generated/Request";
import { cellSelection } from "../grid/Selection";
import { calcPrintDocument, printAnnotations, annotationPages } from "../print/calcPrintDoc";
import { DEFAULT_CALC_PRINT } from "../print/layout";
import { CalcStore } from "../state/store";
import { loadUser, USER_KEY } from "./controller";
import { formFromLink, linkFromForm } from "./LinkDialog";

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
});
beforeEach(() => localStorage.removeItem(USER_KEY));
afterEach(cleanup);

const applied = (log: Request[]): CalcCommand[] => log.flatMap((r) => (r.type === "apply" ? [r.command] : []));

async function ready(user = true) {
  if (user) localStorage.setItem(USER_KEY, JSON.stringify({ name: "Ann Lee", initials: "AL" }));
  const core = new FakeCalcCore();
  const store = new CalcStore(new CalcApi(new FakeBackend(core)));
  await store.init();
  await store.comments.ensure(0);
  core.log.length = 0;
  return { store, core };
}

describe("notes", () => {
  it("New Note starts with the author in bold; committing sends setNote with the author", async () => {
    const { store, core } = await ready();
    store.select(cellSelection(1, 1));
    store.comments.editNote();
    expect(store.comments.editing?.runs).toEqual([{ text: "Ann Lee:", font: { bold: true } }, { text: "\n" }]);
    await store.comments.commitNote([{ text: "Ann Lee:", font: { bold: true } }, { text: "\nCheck it" }]);
    expect(applied(core.log)).toEqual([{ type: "setNote", sheet: 0, row: 1, col: 1, text: [{ text: "Ann Lee:", font: { bold: true } }, { text: "\nCheck it" }], author: "Ann Lee" }]);
    expect(store.comments.note({ sheet: 0, row: 1, col: 1 })?.author).toBe("Ann Lee");
    // The patch carries the indicator flag of the cell.
    expect(store.cache(0).cells.get(1)?.get(1)?.note).toBe(true);
  });

  it("an empty new note or an unchanged edit sends nothing", async () => {
    const { store, core } = await ready();
    store.comments.editNote();
    await store.comments.commitNote([{ text: "Ann Lee:", font: { bold: true } }, { text: "\n" }]);
    await store.apply({ type: "setNote", sheet: 0, row: 0, col: 0, text: [{ text: "x" }] });
    core.log.length = 0;
    store.comments.editNote();
    await store.comments.commitNote([{ text: "x" }]);
    expect(applied(core.log)).toEqual([]);
  });

  it("Show/Hide, Show All Notes and Delete Note", async () => {
    const { store, core } = await ready();
    await store.apply({ type: "setNote", sheet: 0, row: 2, col: 2, text: [{ text: "n" }] });
    store.select(cellSelection(2, 2));
    expect(store.comments.shownNotes(0)).toEqual([]);
    await store.comments.toggleNote();
    expect(store.comments.shownNotes(0).map((n) => n.visible)).toEqual([true]);
    store.comments.toggleAllNotes();
    expect(store.comments.showAllNotes).toBe(true);
    store.select({ anchor: { row: 0, col: 0 }, focus: { row: 5, col: 5 } });
    await store.comments.deleteNotes();
    expect(applied(core.log).at(-1)).toEqual({ type: "deleteNote", sheet: 0, r0: 0, c0: 0, r1: 5, c1: 5 });
    expect(store.comments.of(0).notes).toEqual([]);
  });

  it("moving a note box sends its new bounds; undo restores the old box", async () => {
    const { store } = await ready();
    await store.apply({ type: "setNote", sheet: 0, row: 0, col: 0, text: [{ text: "n" }], visible: true });
    await store.comments.setNoteBounds({ sheet: 0, row: 0, col: 0 }, { x: 30, y: 0, w: 120, h: 60 });
    expect(store.comments.note({ sheet: 0, row: 0, col: 0 })?.bounds).toEqual({ x: 30, y: 0, w: 120, h: 60 });
    await store.undo();
    expect(store.comments.note({ sheet: 0, row: 0, col: 0 })?.bounds).toBeUndefined();
  });

  it("a note stays with its cell when a row is inserted above", async () => {
    const { store } = await ready();
    await store.apply({ type: "setNote", sheet: 0, row: 3, col: 1, text: [{ text: "n" }] });
    await store.apply({ type: "insertRows", sheet: 0, at: 0, count: 2 });
    expect(store.comments.of(0).notes.map((n) => [n.row, n.col])).toEqual([[5, 1]]);
  });

  it("Previous/Next Note select the annotated cells in order", async () => {
    const { store } = await ready();
    await store.apply({ type: "setNote", sheet: 0, row: 4, col: 0, text: [{ text: "a" }] });
    await store.apply({ type: "setNote", sheet: 0, row: 1, col: 2, text: [{ text: "b" }] });
    store.comments.stepNote(1);
    expect(store.activeAnchor()).toEqual({ row: 1, col: 2 });
    store.comments.stepNote(1);
    expect(store.activeAnchor()).toEqual({ row: 4, col: 0 });
    store.comments.stepNote(-1);
    expect(store.activeAnchor()).toEqual({ row: 1, col: 2 });
  });
});

describe("threaded comments", () => {
  it("New Comment asks for the user name first (kept in local storage), then opens the composer", async () => {
    const { store, core } = await ready(false);
    store.comments.newComment();
    expect(store.getState().dialog).toEqual({ kind: "userName", next: "comment" });
    const then = store.comments.afterUser!;
    store.closeDialog();
    await store.comments.setUser("Bob Ray", "");
    then();
    expect(loadUser()).toEqual({ name: "Bob Ray", initials: "BR" });
    expect(applied(core.log)).toEqual([{ type: "setUser", name: "Bob Ray", initials: "BR" }]);
    expect(store.comments.composing).toEqual({ sheet: 0, row: 0, col: 0 });
  });

  it("posting, replying, resolving and deleting send the thread commands", async () => {
    const { store, core } = await ready();
    store.select(cellSelection(0, 3));
    store.comments.newComment();
    await store.comments.postComment("  Why?  ");
    const at = { sheet: 0, row: 0, col: 3 };
    const add = applied(core.log)[0]!;
    expect(add).toMatchObject({ type: "addComment", sheet: 0, row: 0, col: 3, text: "Why?", author: { name: "Ann Lee", initials: "AL" } });
    expect(add.type === "addComment" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.00$/.test(add.date)).toBe(true);
    expect(store.comments.pinned).toEqual(at);
    expect(store.cache(0).cells.get(0)?.get(3)?.comment).toBe("open");
    store.comments.reply(at, "Because.");
    await waitFor(() => expect(store.comments.thread(at)?.replies?.length).toBe(1));
    await store.comments.resolve(at, true);
    expect(store.cache(0).cells.get(0)?.get(3)?.comment).toBe("resolved");
    await store.comments.deleteThreads(at);
    expect(store.comments.thread(at)).toBeUndefined();
    expect(applied(core.log).map((c) => c.type)).toEqual(["addComment", "replyComment", "resolveThread", "deleteThread"]);
  });

  it("New Comment on a cell with a thread opens it to reply; Next Comment pins the next thread", async () => {
    const { store } = await ready();
    await store.apply({ type: "addComment", sheet: 0, row: 2, col: 0, text: "a", author: { name: "X" }, date: "d" });
    await store.apply({ type: "addComment", sheet: 0, row: 6, col: 1, text: "b", author: { name: "X" }, date: "d" });
    store.select(cellSelection(2, 0));
    store.comments.newComment();
    expect(store.comments.composing).toBeNull();
    expect(store.comments.pinned).toEqual({ sheet: 0, row: 2, col: 0 });
    store.comments.stepComment(1);
    expect(store.activeAnchor()).toEqual({ row: 6, col: 1 });
    expect(store.comments.pinned).toEqual({ sheet: 0, row: 6, col: 1 });
  });

  it("hover only counts annotated cells and lingers briefly for the card", async () => {
    vi.useFakeTimers();
    try {
      const { store } = await ready();
      await store.apply({ type: "setNote", sheet: 0, row: 1, col: 1, text: [{ text: "n" }], author: "Ann" });
      store.comments.hoverAt({ row: 0, col: 0 });
      expect(store.comments.hover).toBeNull();
      store.comments.hoverAt({ row: 1, col: 1 });
      expect(store.comments.hoverNote()?.author).toBe("Ann");
      store.comments.hoverAt(null);
      expect(store.comments.hover).not.toBeNull();
      vi.advanceTimersByTime(400);
      expect(store.comments.hover).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a cut moves the thread with the cell; a copy only copies the note", async () => {
    const { store } = await ready();
    await store.apply({ type: "setInput", sheet: 0, row: 0, col: 0, input: "v" });
    await store.apply({ type: "setNote", sheet: 0, row: 0, col: 0, text: [{ text: "n" }] });
    await store.apply({ type: "addComment", sheet: 0, row: 0, col: 0, text: "t", author: { name: "X" }, date: "d" });
    store.select(cellSelection(0, 0));
    store.copy();
    store.select(cellSelection(4, 4));
    await store.paste();
    expect(store.comments.note({ sheet: 0, row: 4, col: 4 })).toBeTruthy();
    expect(store.comments.thread({ sheet: 0, row: 4, col: 4 })).toBeUndefined();
    store.select(cellSelection(0, 0));
    store.copy(true);
    store.select(cellSelection(8, 1));
    await store.paste();
    expect(store.comments.thread({ sheet: 0, row: 8, col: 1 })).toBeTruthy();
    expect(store.comments.thread({ sheet: 0, row: 0, col: 0 })).toBeUndefined();
  });
});

describe("hyperlinks", () => {
  it("the Link dialog's fields map to targets and back", () => {
    const base = formFromLink(undefined, "Shop", "Sheet1");
    expect(linkFromForm({ ...base, address: "www.shop.at" })).toEqual({ kind: "url", url: "http://www.shop.at" });
    expect(linkFromForm({ ...base, address: "" })).toBeNull();
    expect(linkFromForm({ ...base, kind: "email", email: "mailto:a@b.at", subject: " Hi " })).toEqual({ kind: "email", address: "a@b.at", subject: "Hi" });
    expect(linkFromForm({ ...base, kind: "place", sheet: "My Data", cell: "$b$4" })).toEqual({ kind: "location", location: "'My Data'!B4" });
    expect(linkFromForm({ ...base, kind: "place", cell: "nope" })).toBeNull();
    expect(linkFromForm({ ...base, kind: "place", name: "Totals" })).toEqual({ kind: "location", location: "Totals" });
    const edit = formFromLink({ r0: 0, c0: 0, r1: 0, c1: 0, target: { kind: "location", location: "'My Data'!C3" }, tooltip: "tip" }, "x", "Sheet1");
    expect(edit).toMatchObject({ kind: "place", sheet: "My Data", cell: "C3", tooltip: "tip" });
    expect(formFromLink({ r0: 0, c0: 0, r1: 0, c1: 0, target: { kind: "email", address: "a@b", subject: "s" } }, "", "S")).toMatchObject({ kind: "email", email: "a@b", subject: "s" });
  });

  it("setLink sends setHyperlink for the selection; Ctrl+click on it opens the page through an anchor", async () => {
    const { store, core } = await ready();
    store.select(cellSelection(2, 1));
    await store.comments.setLink({ kind: "url", url: "https://example.com/" }, "Example", "Go");
    expect(applied(core.log)[0]).toEqual({ type: "setHyperlink", sheet: 0, r0: 2, c0: 1, r1: 2, c1: 1, target: { kind: "url", url: "https://example.com/" }, text: "Example", tooltip: "Go" });
    expect(store.cache(0).cells.get(2)?.get(1)?.link).toBe(true);
    const opened: string[] = [];
    const action = await store.comments.follow({ sheet: 0, row: 2, col: 1 }, (h) => opened.push(h));
    expect(action).toEqual({ kind: "external", href: "https://example.com/" });
    expect(opened).toEqual(["https://example.com/"]);
  });

  it("a place link and a HYPERLINK() formula select their target", async () => {
    const { store } = await ready();
    store.select(cellSelection(0, 0));
    await store.comments.setLink({ kind: "location", location: "Sheet1!D9" }, "", "");
    await store.comments.follow({ sheet: 0, row: 0, col: 0 });
    expect(store.activeAnchor()).toEqual({ row: 8, col: 3 });
    await store.apply({ type: "setInput", sheet: 0, row: 1, col: 0, input: '=HYPERLINK("#Sheet1!B3","go")' });
    await store.comments.follow({ sheet: 0, row: 1, col: 0 });
    expect(store.activeAnchor()).toEqual({ row: 2, col: 1 });
  });

  it("Remove Hyperlink sends removeHyperlink for the selection", async () => {
    const { store, core } = await ready();
    store.select({ anchor: { row: 0, col: 0 }, focus: { row: 1, col: 1 } });
    await store.comments.removeLink();
    expect(applied(core.log)).toEqual([{ type: "removeHyperlink", sheet: 0, r0: 0, c0: 0, r1: 1, c1: 1 }]);
  });
});

describe("printing notes and comments", () => {
  it("At end of sheet lists notes and threads by cell after the sheet's pages", async () => {
    const { store } = await ready();
    await store.apply({ type: "setInput", sheet: 0, row: 0, col: 0, input: "data" });
    await store.apply({ type: "setNote", sheet: 0, row: 3, col: 0, text: [{ text: "Check the supplier" }], author: "Ann" });
    await store.apply({ type: "addComment", sheet: 0, row: 1, col: 2, text: "Why?", author: { name: "Bob" }, date: "d" });
    const a = await printAnnotations(store, 0, { comments: "atEnd" });
    expect(a.list.map((x) => [x.cell, x.kind, x.author, x.text])).toEqual([["C2", "comment", "Bob", "Why?"], ["A4", "note", "Ann", "Check the supplier"]]);
    const table = { cols: [{ col: 0, width: 64 }], rows: [{ row: 0, height: 20, cells: [{ col: 0, text: "data", style: {} }] }], width: 64, height: 20 };
    const doc = calcPrintDocument([{ sheetName: "Sheet1", table, annotations: a.list }], { ...DEFAULT_CALC_PRINT, comments: "atEnd" });
    expect(doc.pages.length).toBe(2);
    expect(doc.pages[1]).toContain("Check the supplier");
    expect(doc.pages[1]).toContain('data-annotation="A4"');
  });

  it("As displayed prints the visible notes as boxes; None prints nothing", async () => {
    const { store } = await ready();
    await store.apply({ type: "setNote", sheet: 0, row: 0, col: 0, text: [{ text: "shown", font: { bold: true } }], visible: true });
    await store.apply({ type: "setNote", sheet: 0, row: 5, col: 0, text: [{ text: "hidden" }] });
    const shown = await printAnnotations(store, 0, { comments: "asDisplayed" });
    expect(shown.boxes.length).toBe(1);
    expect(shown.boxes[0]!.svg).toContain("font-weight:bold");
    expect(await printAnnotations(store, 0, { comments: "none" })).toEqual({ boxes: [], list: [] });
    expect(annotationPages([], 500)).toEqual([]);
  });
});

describe("Review tab and shortcuts", () => {
  async function setup() {
    localStorage.setItem(USER_KEY, JSON.stringify({ name: "Ann Lee", initials: "AL" }));
    const core = new FakeCalcCore();
    render(<App backend={new FakeBackend(core)} />);
    await screen.findByRole("tab", { name: "Sheet1" });
    const grid = screen.getByTestId("grid");
    grid.focus();
    core.log.length = 0;
    return { core, grid };
  }

  it("Review › Show Comments opens the pane; New Comment there opens the composer and Post adds the thread", async () => {
    const { core } = await setup();
    fireEvent.click(screen.getByRole("tab", { name: "Review" }));
    fireEvent.click(screen.getByRole("button", { name: "Show Comments" }));
    const pane = await screen.findByTestId("comments-pane");
    expect(within(pane).getByText("No comments in this workbook.")).toBeTruthy();
    fireEvent.click(within(pane).getByRole("button", { name: "New Comment" }));
    const composer = await screen.findByTestId("comment-composer");
    fireEvent.change(within(composer).getByLabelText("Comment"), { target: { value: "Looks off" } });
    fireEvent.click(within(composer).getByRole("button", { name: "Post" }));
    await waitFor(() => expect(applied(core.log).map((c) => c.type)).toContain("addComment"));
    await waitFor(() => expect(within(screen.getByTestId("comments-pane")).getAllByTestId("thread").length).toBe(1));
  });

  it("Ctrl+K opens the Link dialog; OK sends setHyperlink with the typed address, shown in the empty cell", async () => {
    const { core, grid } = await setup();
    fireEvent.keyDown(grid, { key: "k", ctrlKey: true });
    const dialog = await screen.findByTestId("link-dialog");
    fireEvent.change(within(dialog).getByLabelText("Address"), { target: { value: "www.rusuite.at" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "OK" }));
    await waitFor(() => expect(applied(core.log)).toEqual([{ type: "setHyperlink", sheet: 0, r0: 0, c0: 0, r1: 0, c1: 0, target: { kind: "url", url: "http://www.rusuite.at" }, text: "http://www.rusuite.at" }]));
  });

  it("Shift+F2 opens the note editor at the active cell with its font toolbar", async () => {
    const { grid } = await setup();
    fireEvent.keyDown(grid, { key: "F2", shiftKey: true });
    const editor = await screen.findByTestId("note-editor");
    expect(editor.textContent).toBe("Ann Lee:");
    expect(editor.querySelectorAll("br").length).toBe(2);
    const toolbar = screen.getByTestId("note-toolbar");
    expect(within(toolbar).getByRole("button", { name: "Bold" })).toBeTruthy();
    act(() => {
      fireEvent.keyDown(editor, { key: "Escape" });
    });
    await waitFor(() => expect(screen.queryByTestId("note-editor")).toBeNull());
  });

  it("the cell context menu offers the note and link entries of the cell", async () => {
    // jsdom has no layout: give the grid a size so hit testing works.
    const saved = (["clientWidth", "clientHeight"] as const).map((k) => [k, Object.getOwnPropertyDescriptor(HTMLElement.prototype, k)] as const);
    for (const [k] of saved) Object.defineProperty(HTMLElement.prototype, k, { configurable: true, get: () => 600 });
    try {
      const { grid } = await setup();
      fireEvent.contextMenu(grid, { clientX: 46 + 64 + 10, clientY: 22 + 20 + 5 });
      const menu = screen.getByRole("menu", { name: "Cell" });
      for (const name of ["New Comment", "New Note", "Link"]) expect(within(menu).getByRole("menuitem", { name: new RegExp(`^${name}`) })).toBeTruthy();
    } finally {
      for (const [k, d] of saved) if (d) Object.defineProperty(HTMLElement.prototype, k, d);
    }
  });
});
