// P8-17 through the real App (fake backend): Table Design / Table Layout
// tabs and their dialogs, Picture Format Wrap Text / Position, Home ›
// Paragraph borders, shading and tabs, the ruler.

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ setTitle: vi.fn() }) }));

import type { Editor } from "@tiptap/core";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { bytesToBase64 } from "@rusuite/ui-shared";
import App from "../App";
import type { Block } from "../generated/Block";
import type { WriteCommand } from "../generated/WriteCommand";
import { findPos, pmOffsetOf } from "../sync/SyncPlugin";
import { FakeWriteBackend } from "../test/fakeWriteBackend";
import { makeDoc, para, run } from "../test/fixtures";

const noRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
Range.prototype.getClientRects = noRects;
Range.prototype.getBoundingClientRect = () => new DOMRect();
Element.prototype.getClientRects = noRects;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const b64 = (v: unknown) => bytesToBase64(new TextEncoder().encode(JSON.stringify(v)));
const tab = (name: string) => screen.getByRole("tab", { name });
const applied = (backend: FakeWriteBackend): WriteCommand[] => backend.log.flatMap((r) => (r.type === "apply" ? [r.command] : []));
const flat = (cmds: WriteCommand[]): WriteCommand[] => cmds.flatMap((c) => (c.type === "compound" ? flat(c.commands) : [c]));
const tiptap = (el: HTMLElement) => (el as unknown as { editor: Editor }).editor;

function tableBlock(): Block {
  return {
    kind: "table",
    value: {
      id: 10,
      props: { colWidths: [4500, 4500] },
      rows: [
        { id: 11, cells: [{ id: 12, blocks: [para(20, "a")] }, { id: 13, blocks: [para(21, "b")] }] },
        { id: 14, cells: [{ id: 15, blocks: [para(22, "c")] }, { id: 16, blocks: [para(23, "d")] }] },
      ],
    },
  } as Block;
}

async function mount(body: Block[]) {
  const backend = new FakeWriteBackend();
  render(<App backend={backend} />);
  const editorEl = await screen.findByTestId("editor");
  await waitFor(() => expect(backend.log.some((r) => r.type === "newDocument")).toBe(true));
  vi.spyOn(backend, "openFile").mockResolvedValue({ name: "t.docx", bytesBase64: b64(makeDoc(body)) });
  fireEvent.keyDown(window, { key: "o", ctrlKey: true });
  await waitFor(() => expect(backend.log.some((r) => r.type === "openDocx")).toBe(true));
  await waitFor(() => expect(editorEl.querySelector("p")).toBeTruthy());
  backend.log.length = 0;
  return { backend, editorEl, editor: tiptap(editorEl) };
}

function caret(editor: Editor, id: number, offset = 0, toId = id, toOffset = offset) {
  act(() => {
    const doc = editor.state.doc;
    const at = (bid: number, off: number) => findPos(doc, bid) + 1 + pmOffsetOf(doc.nodeAt(findPos(doc, bid))!, off);
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(doc, at(id, offset), at(toId, toOffset))));
  });
}

describe("Table Design and Table Layout", () => {
  it("style gallery and style options send SetTableProps (Word's default look with a first style)", async () => {
    const { backend, editor } = await mount([tableBlock()]);
    caret(editor, 20);
    await waitFor(() => expect(tab("Table Design")).toBeTruthy());
    fireEvent.click(tab("Table Design"));
    fireEvent.click(screen.getAllByRole("button", { name: "Grid Table 4 Accent 1" })[0]!);
    await waitFor(() =>
      expect(applied(backend)).toContainEqual({
        type: "setTableProps", table: 10,
        patch: { style: "GridTable4-Accent1", look: { firstRow: true, lastRow: false, firstCol: true, lastCol: false, bandedRows: true, bandedCols: false } },
      }),
    );
    await waitFor(() => expect((screen.getByRole("checkbox", { name: "Header Row" }) as HTMLInputElement).checked).toBe(true));
    fireEvent.click(screen.getByRole("checkbox", { name: "Total Row" }));
    await waitFor(() => expect(applied(backend)).toContainEqual({ type: "setTableProps", table: 10, patch: { look: expect.objectContaining({ lastRow: true, firstRow: true }) } }));
  });

  it("Merge Cells is enabled for several cells and sends their rectangle", async () => {
    const { backend, editor } = await mount([tableBlock()]);
    caret(editor, 20, 0, 21, 1);
    await waitFor(() => expect(tab("Table Layout")).toBeTruthy());
    fireEvent.click(tab("Table Layout"));
    await waitFor(() => expect((screen.getByRole("button", { name: "Merge Cells" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Merge Cells" }));
    await waitFor(() => expect(applied(backend)).toContainEqual({ type: "mergeCells", table: 10, top: 0, left: 0, bottom: 0, right: 1 }));
  });

  it("Split Cells…, Cell Margins… and Table Properties… dialogs send their commands", async () => {
    const { backend, editor } = await mount([tableBlock()]);
    caret(editor, 23);
    await waitFor(() => expect(tab("Table Layout")).toBeTruthy());
    fireEvent.click(tab("Table Layout"));
    fireEvent.click(screen.getByRole("button", { name: "Split Cells" }));
    let dlg = screen.getByRole("dialog", { name: "Split Cells" });
    fireEvent.change(within(dlg).getByLabelText("Number of columns"), { target: { value: "3" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "OK" }));
    await waitFor(() => expect(applied(backend)).toContainEqual({ type: "splitCell", table: 10, row: 1, col: 1, rows: 1, cols: 3 }));

    caret(editor, 23);
    fireEvent.click(screen.getByRole("button", { name: "Cell Margins" }));
    dlg = screen.getByRole("dialog", { name: "Cell Margins" });
    expect((within(dlg).getByLabelText("Left (cm)") as HTMLInputElement).value).toBe("0.19");
    fireEvent.change(within(dlg).getByLabelText("Top (cm)"), { target: { value: "0,1" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "OK" }));
    await waitFor(() => expect(applied(backend)).toContainEqual({ type: "setTableProps", table: 10, patch: { cellMargins: { top: 57, bottom: 0, left: 108, right: 108 } } }));

    caret(editor, 23);
    fireEvent.click(screen.getByRole("button", { name: "Properties" }));
    dlg = screen.getByRole("dialog", { name: "Table Properties" });
    fireEvent.click(within(dlg).getByRole("radio", { name: "Centered" }));
    fireEvent.click(within(dlg).getByRole("checkbox", { name: "Allow row to break across pages" }));
    fireEvent.click(within(dlg).getByRole("button", { name: "OK" }));
    await waitFor(() => {
      const cmds = flat(applied(backend));
      expect(cmds).toContainEqual({ type: "setTableProps", table: 10, patch: { alignment: "center" } });
      expect(cmds).toContainEqual({ type: "setRowProps", table: 10, rows: [1], cantSplit: true });
    });
  });

  it("the context menu offers Split Cells and Table Properties", async () => {
    const { editor, editorEl } = await mount([tableBlock()]);
    caret(editor, 23);
    fireEvent.contextMenu(editorEl.querySelectorAll("td")[3]!, { clientX: 5, clientY: 5 });
    const menu = await screen.findByRole("menu", { name: "Editor" });
    expect(within(menu).getByRole("menuitem", { name: "Split Cells…" })).toBeTruthy();
    expect(within(menu).getByRole("menuitem", { name: "Table Properties…" })).toBeTruthy();
  });

  it("cell alignment 9-grid sends vertical alignment and paragraph alignment", async () => {
    const { backend, editor } = await mount([tableBlock()]);
    caret(editor, 22);
    await waitFor(() => expect(tab("Table Layout")).toBeTruthy());
    fireEvent.click(tab("Table Layout"));
    fireEvent.click(screen.getByRole("button", { name: "Cell alignment" }));
    fireEvent.click(screen.getByRole("button", { name: "Align Bottom Right" }));
    await waitFor(() => {
      const cmds = flat(applied(backend));
      expect(cmds).toContainEqual({ type: "setCellProps", cells: [15], patch: { verticalAlign: "bottom" } });
      expect(cmds).toContainEqual({ type: "setParagraphProps", blocks: [22], patch: { alignment: "right" } });
    });
  });
});

describe("Picture Format › Arrange", () => {
  const withImage = [para(1, [run("x"), { kind: "image", value: { media: 1, width: 952500, height: 476250 } }])] as Block[];

  it("Wrap Text ▾ Square and Position ▾ presets send SetImageAnchor; In Line removes it", async () => {
    const { backend, editor } = await mount(withImage);
    const pick = () =>
      act(() => {
        const pos = findPos(editor.state.doc, 1) + 2;
        editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)));
      });
    pick();
    await waitFor(() => expect(tab("Picture Format")).toBeTruthy());
    fireEvent.click(tab("Picture Format"));
    fireEvent.click(screen.getByRole("button", { name: "Wrap Text" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Square" }));
    await waitFor(() => expect(applied(backend)).toContainEqual(expect.objectContaining({ type: "setImageAnchor", block: 1, offset: 1, anchor: expect.objectContaining({ wrap: "square" }) })));
    await waitFor(() => expect(editor.view.dom.querySelector(".inline-image-wrap.floating.float-left")).toBeTruthy());
    pick();
    fireEvent.click(screen.getByRole("button", { name: "Position" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Position in Bottom Right with Square Text Wrapping" }));
    await waitFor(() =>
      expect(applied(backend)).toContainEqual(
        expect.objectContaining({ type: "setImageAnchor", anchor: expect.objectContaining({ h: { relativeTo: "margin", place: { kind: "align", value: "right" } } }) }),
      ),
    );
    pick();
    fireEvent.click(screen.getByRole("button", { name: "Wrap Text" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "In Line with Text" }));
    await waitFor(() => expect(applied(backend)).toContainEqual({ type: "setImageAnchor", block: 1, offset: 1, anchor: null }));
  });
});

describe("Home › Paragraph borders, shading, tabs; the ruler", () => {
  it("Borders ▾ Bottom border and Shading send SetParagraphProps", async () => {
    const { backend, editor } = await mount([para(1, "hello")]);
    caret(editor, 1, 2);
    fireEvent.click(screen.getByRole("button", { name: "Borders" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Bottom border" }));
    await waitFor(() =>
      expect(applied(backend)).toContainEqual({ type: "setParagraphProps", blocks: [1], patch: { borders: { bottom: { style: "single", width: 10, color: { kind: "auto" }, space: 1 } } } }),
    );
    await waitFor(() => expect((editor.view.dom.querySelector("p") as HTMLElement).style.borderBottom).toContain("solid"));
  });

  it("Borders and Shading… dialog: Box with a double line", async () => {
    const { backend, editor } = await mount([para(1, "hello")]);
    caret(editor, 1, 2);
    fireEvent.click(screen.getByRole("button", { name: "Borders" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Borders and Shading…" }));
    const dlg = screen.getByRole("dialog", { name: "Borders and Shading" });
    fireEvent.click(within(dlg).getByRole("button", { name: "Box" }));
    fireEvent.change(within(dlg).getByLabelText("Style"), { target: { value: "double" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "OK" }));
    await waitFor(() => {
      const c = applied(backend).find((x) => x.type === "setParagraphProps") as Extract<WriteCommand, { type: "setParagraphProps" }> | undefined;
      expect(Object.keys(c?.patch.borders ?? {}).sort()).toEqual(["bottom", "left", "right", "top"]);
      expect(c?.patch.borders?.top?.style).toBe("double");
    });
  });

  it("Tabs… dialog sets a right tab with a dot leader", async () => {
    const { backend, editor } = await mount([para(1, "a\tb")]);
    caret(editor, 1, 0);
    fireEvent.click(screen.getByRole("button", { name: "Tabs…" }));
    const dlg = screen.getByRole("dialog", { name: "Tabs" });
    fireEvent.change(within(dlg).getByLabelText("Tab stop position (cm)"), { target: { value: "5" } });
    fireEvent.click(within(dlg).getByRole("radio", { name: "Right" }));
    fireEvent.click(within(dlg).getByRole("radio", { name: "Dots ……" }));
    fireEvent.click(within(dlg).getByRole("button", { name: "Set" }));
    expect(within(dlg).getByRole("option", { name: "5 cm" })).toBeTruthy();
    fireEvent.click(within(dlg).getByRole("button", { name: "OK" }));
    await waitFor(() => expect(applied(backend)).toContainEqual({ type: "setParagraphProps", blocks: [1], patch: { tabs: [{ pos: 2835, kind: "right", leader: "dot" }] } }));
    await waitFor(() => expect(editor.state.doc.child(0).attrs.extra).toEqual({ tabs: [{ pos: 2835, kind: "right", leader: "dot" }] }));
  });

  it("Tab outside tables and lists types a tab character (InsertText)", async () => {
    const { backend, editor, editorEl } = await mount([para(1, "ab")]);
    caret(editor, 1, 1);
    fireEvent.keyDown(editorEl, { key: "Tab" });
    expect(editor.state.doc.child(0).textContent).toBe("a\tb");
    await waitFor(() => expect(applied(backend)).toContainEqual(expect.objectContaining({ type: "insertText", block: 1, offset: 1, text: "\t" })));
  });

  it("the ruler: the corner selector cycles; a click adds a stop of that kind; View › Ruler hides it", async () => {
    const { backend, editor } = await mount([para(1, "a\tb")]);
    caret(editor, 1, 1);
    const kind = screen.getByTestId("tab-kind");
    expect(kind.getAttribute("aria-label")).toMatch(/Left/);
    fireEvent.click(kind);
    expect(kind.getAttribute("aria-label")).toMatch(/Center/);
    // jsdom has no layout: the column starts at the page margin (96 px), 1 px = 15 twips.
    fireEvent.pointerDown(screen.getByRole("group", { name: "Ruler" }), { clientX: 96 + 200, button: 0 });
    await waitFor(() => expect(applied(backend)).toContainEqual({ type: "setParagraphProps", blocks: [1], patch: { tabs: [{ pos: 2976, kind: "center" }] } }));
    await waitFor(() => expect(screen.getAllByRole("button", { name: /Center tab at/ })).toHaveLength(1));
    fireEvent.click(tab("View"));
    fireEvent.click(screen.getByRole("checkbox", { name: "Ruler" }));
    expect(screen.queryByTestId("ruler")).toBeNull();
  });
});
