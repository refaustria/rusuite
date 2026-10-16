// P6-4 through the real App (fake backend): Table / Picture Format tabs,
// context menu, Tab in tables, find bar, header & footer, page setup,
// views, formatting buttons and shortcuts.

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

/** The Tiptap editor behind the DOM (Tiptap keeps it on the element). */
const tiptap = (el: HTMLElement) => (el as unknown as { editor: Editor }).editor;

async function mount(body: Block[] = [para(1, "hello world")]) {
  const backend = new FakeWriteBackend();
  render(<App backend={backend} />);
  const editorEl = await screen.findByTestId("editor");
  await waitFor(() => expect(backend.log.some((r) => r.type === "newDocument")).toBe(true));
  vi.spyOn(backend, "openFile").mockResolvedValue({ name: "t.docx", bytesBase64: b64(makeDoc(body)) });
  fireEvent.keyDown(window, { key: "o", ctrlKey: true });
  await waitFor(() => expect(editorEl.querySelector("p")).toBeTruthy());
  await waitFor(() => expect(backend.log.some((r) => r.type === "openDocx")).toBe(true));
  backend.log.length = 0;
  (editorEl as HTMLElement).focus();
  const editor = tiptap(editorEl);
  return { backend, editorEl, editor };
}

/** Puts the caret at char `offset` of block `id`. */
function caret(editor: Editor, id: number, offset = 0, toOffset = offset) {
  act(() => {
    const doc = editor.state.doc;
    const pos = findPos(doc, id);
    const node = doc.nodeAt(pos)!;
    const a = pos + 1 + pmOffsetOf(node, offset);
    const b = pos + 1 + pmOffsetOf(node, toOffset);
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(doc, a, b)));
  });
}

describe("Table tab and context menu", () => {
  it("the Table Design / Table Layout tabs appear in a table; Insert below / Delete table are Rust commands", async () => {
    const { backend, editor } = await mount([para(1, "x"), tableBlock()]);
    expect(screen.queryByRole("tab", { name: "Table Layout" })).toBeNull();
    caret(editor, 20);
    await waitFor(() => expect(tab("Table Layout")).toBeTruthy());
    expect(tab("Table Design")).toBeTruthy();
    fireEvent.click(tab("Table Layout"));
    fireEvent.click(screen.getByRole("button", { name: "Insert below" }));
    await waitFor(() => expect(applied(backend)).toContainEqual({ type: "insertTableRow", table: 10, at: 1 }));
    await waitFor(() => expect(editor.view.dom.querySelectorAll("tr")).toHaveLength(3));
    fireEvent.click(screen.getByRole("button", { name: "Header row" }));
    await waitFor(() => expect(applied(backend)).toContainEqual({ type: "setRowProps", table: 10, rows: [0], header: true }));
    await waitFor(() => expect(editor.view.dom.querySelector("tr[data-header]")).toBeTruthy());
    fireEvent.click(tab("Table Design"));
    fireEvent.click(screen.getByRole("button", { name: "Borders" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "No border" }));
    await waitFor(() => expect(applied(backend)).toContainEqual(expect.objectContaining({ type: "setCellProps", cells: [12] })));
    fireEvent.click(tab("Table Layout"));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete table" }));
    await waitFor(() => expect(applied(backend)).toContainEqual({ type: "deleteBlocks", ids: [10] }));
    await waitFor(() => expect(editor.view.dom.querySelector("table")).toBeNull());
  });

  it("right-click in a table offers the table commands", async () => {
    const { backend, editor, editorEl } = await mount([tableBlock()]);
    caret(editor, 23);
    fireEvent.contextMenu(editorEl.querySelectorAll("td")[3]!, { clientX: 5, clientY: 5 });
    const menu = await screen.findByRole("menu", { name: "Editor" });
    expect(within(menu).getByRole("menuitem", { name: "Insert column left" })).toBeTruthy();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Insert row above" }));
    await waitFor(() => expect(applied(backend)).toContainEqual({ type: "insertTableRow", table: 10, at: 1 }));
  });

  it("row height dialog sends SetRowProps", async () => {
    const { backend, editor } = await mount([tableBlock()]);
    caret(editor, 22);
    await waitFor(() => expect(tab("Table Layout")).toBeTruthy());
    fireEvent.click(tab("Table Layout"));
    fireEvent.click(screen.getByRole("button", { name: "Row height" }));
    const dlg = screen.getByRole("dialog", { name: "Row height" });
    fireEvent.change(within(dlg).getByLabelText("Row height is"), { target: { value: "exact" } });
    fireEvent.change(within(dlg).getByLabelText("Height (cm)"), { target: { value: "2,54" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "OK" }));
    await waitFor(() => expect(applied(backend)).toContainEqual({ type: "setRowProps", table: 10, rows: [1], height: { value: 1440, rule: "exact" } }));
  });

  it("Tab moves to the next cell; Tab in the last cell appends a row and enters it", async () => {
    const { backend, editor, editorEl } = await mount([tableBlock()]);
    caret(editor, 20);
    fireEvent.keyDown(editorEl, { key: "Tab" });
    expect(editor.state.selection.$from.parent.attrs.id).toBe(21);
    caret(editor, 23, 1);
    fireEvent.keyDown(editorEl, { key: "Tab" });
    await waitFor(() => expect(applied(backend)).toContainEqual({ type: "insertTableRow", table: 10, at: 2 }));
    await waitFor(() => expect(editorEl.querySelectorAll("tr")).toHaveLength(3));
    await waitFor(() => {
      const $f = editor.state.selection.$from;
      expect($f.node($f.depth - 2).type.name).toBe("tableRow");
      expect($f.index($f.depth - 3)).toBe(2);
    });
    fireEvent.keyDown(editorEl, { key: "Tab", shiftKey: true });
    expect(editor.state.selection.$from.parent.attrs.id).toBe(23);
  });
});

describe("Pictures", () => {
  const withImage = [para(1, [run("x"), { kind: "image", value: { media: 1, width: 952500, height: 476250 } }])] as Block[];

  it("the Picture Format tab: alt text dialog → SetImageAlt; width keeps the aspect ratio → SetImageSize", async () => {
    const { backend, editor } = await mount(withImage);
    act(() => {
      const pos = findPos(editor.state.doc, 1) + 2;
      editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)));
    });
    await waitFor(() => expect(tab("Picture Format")).toBeTruthy());
    fireEvent.click(tab("Picture Format"));
    fireEvent.click(screen.getByRole("button", { name: "Alt text" }));
    const dlg = screen.getByRole("dialog", { name: "Alt text" });
    fireEvent.change(within(dlg).getByLabelText("Alt text"), { target: { value: "A logo" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "OK" }));
    await waitFor(() => expect(applied(backend)).toContainEqual({ type: "setImageAlt", block: 1, offset: 1, alt: "A logo" }));
    const width = screen.getByLabelText("Width (cm)");
    fireEvent.change(width, { target: { value: "5" } });
    fireEvent.keyDown(width, { key: "Enter" });
    await waitFor(() => expect(applied(backend)).toContainEqual({ type: "setImageSize", block: 1, offset: 1, width: 1800000, height: 900000 }));
  });

  it("pasting a PNG from the clipboard inserts it (InsertImage)", async () => {
    const { backend, editor, editorEl } = await mount();
    caret(editor, 1, 5);
    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "shot.png", { type: "image/png" });
    const clipboardData = { files: [png], items: [], types: ["Files"], getData: () => "" };
    fireEvent.paste(editorEl, { clipboardData });
    await waitFor(() => expect(applied(backend)).toContainEqual(expect.objectContaining({ type: "insertImage", block: 1, offset: 5, contentType: "image/png" })), { timeout: 5000 });
  });
});

describe("Find bar", () => {
  it("Ctrl+F highlights all matches; Enter moves; Escape clears; Replace replaces the current match", async () => {
    const { backend, editor, editorEl } = await mount([para(1, "red fish red"), para(2, "red")]);
    fireEvent.keyDown(editorEl, { key: "f", ctrlKey: true });
    const bar = screen.getByRole("dialog", { name: "Find and replace" });
    const input = within(bar).getByLabelText("Find");
    fireEvent.change(input, { target: { value: "red" } });
    await waitFor(() => expect(editorEl.querySelectorAll(".find-match")).toHaveLength(3));
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(screen.getByTestId("match-count").textContent).toBe("1 of 3"));
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(screen.getByTestId("match-count").textContent).toBe("2 of 3"));
    fireEvent.click(within(bar).getByRole("button", { name: "Replace…" }));
    fireEvent.change(within(bar).getByLabelText("Replace with"), { target: { value: "blue" } });
    fireEvent.click(within(bar).getByRole("button", { name: "Replace" }));
    await waitFor(() => expect(applied(backend)).toContainEqual({ type: "replaceText", block: 1, from: 9, to: 12, text: "blue" }));
    expect(editor.state.doc.textContent).toBe("red fish bluered");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Find and replace" })).toBeNull();
    expect(editorEl.querySelectorAll(".find-match")).toHaveLength(0);
  });
});

describe("Header, footer, page setup and views", () => {
  it("Insert › Header opens the dialog; OK sends SetPage and the page shows the header greyed", async () => {
    const { backend } = await mount();
    fireEvent.click(tab("Insert"));
    fireEvent.click(screen.getByRole("button", { name: "Header" }));
    const dlg = screen.getByRole("dialog", { name: "Header and footer" });
    fireEvent.change(within(dlg).getByLabelText("Header"), { target: { value: "Quarterly report" } });
    const footerRow = within(dlg).getByLabelText("Footer").parentElement!;
    fireEvent.click(within(footerRow).getByRole("button", { name: "Insert page number" }));
    fireEvent.click(within(dlg).getByRole("button", { name: "OK" }));
    await waitFor(() => expect(applied(backend)).toContainEqual({ type: "setPage", patch: { headerText: "Quarterly report", footerText: "{PAGE}" } }));
    await waitFor(() => expect(screen.getByTestId("page-header").textContent).toBe("Quarterly report"));
    expect(screen.getByTestId("page-footer").textContent).toBe("1");
    fireEvent.doubleClick(screen.getByTestId("page-footer"));
    expect(screen.getByRole("dialog", { name: "Header and footer" })).toBeTruthy();
  });

  it("Layout › Margins › Custom margins… sends the margins in twips", async () => {
    const { backend } = await mount();
    fireEvent.click(tab("Layout"));
    fireEvent.click(screen.getByRole("button", { name: "Margins" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Custom margins…" }));
    const dlg = screen.getByRole("dialog", { name: "Page setup" });
    fireEvent.change(within(dlg).getByLabelText("Left (cm)"), { target: { value: "1.27" } });
    fireEvent.change(within(dlg).getByLabelText("Orientation"), { target: { value: "landscape" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "OK" }));
    await waitFor(() =>
      expect(applied(backend)).toContainEqual({ type: "setPage", patch: { orientation: "landscape", margins: { top: 1440, bottom: 1440, left: 720, right: 1440 } } }),
    );
  });

  it("View › Draft / Print layout and Spelling toggle the page frame and spellcheck", async () => {
    const { editorEl } = await mount();
    expect(screen.getByTestId("write-page").dataset.view).toBe("print");
    expect(editorEl.getAttribute("spellcheck")).toBe("true");
    expect(editorEl.getAttribute("lang")).toBeTruthy();
    fireEvent.click(tab("View"));
    fireEvent.click(screen.getByRole("button", { name: "Draft" }));
    expect(screen.getByTestId("write-page").dataset.view).toBe("draft");
    expect(screen.queryByTestId("page-header")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Spelling" }));
    await waitFor(() => expect(editorEl.getAttribute("spellcheck")).toBe("false"));
    fireEvent.click(screen.getByRole("button", { name: "Print layout" }));
    expect(screen.getByTestId("write-page").dataset.view).toBe("print");
  });
});

describe("Formatting details", () => {
  it("superscript, highlight and clear formatting", async () => {
    const { backend, editor } = await mount();
    caret(editor, 1, 0, 5);
    fireEvent.click(screen.getByRole("button", { name: "Superscript" }));
    await waitFor(() => expect(applied(backend)).toContainEqual({ type: "setRunProps", block: 1, from: 0, to: 5, patch: { verticalAlign: "superscript" } }));
    fireEvent.click(screen.getByRole("button", { name: "Text highlight color" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Yellow" }));
    await waitFor(() =>
      expect(applied(backend)).toContainEqual(expect.objectContaining({ type: "setRunProps", patch: { highlight: { kind: "rgb", value: "FFFF00" } } })),
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear formatting" }));
    await waitFor(() => expect(applied(backend)).toContainEqual({ type: "clearFormatting", block: 1, from: 0, to: 5, paragraph: true }));
    await waitFor(() => expect(editor.view.dom.querySelector("sup")).toBeNull());
  });

  it("line spacing options dialog and Ctrl+2 / Ctrl+0", async () => {
    const { backend, editorEl } = await mount();
    fireEvent.click(screen.getByRole("button", { name: "Line spacing" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Line spacing options…" }));
    const dlg = screen.getByRole("dialog", { name: "Paragraph" });
    fireEvent.change(within(dlg).getByLabelText("Line spacing"), { target: { value: "exact" } });
    fireEvent.change(within(dlg).getByLabelText("At"), { target: { value: "18" } });
    fireEvent.change(within(dlg).getByLabelText("After (pt)"), { target: { value: "6" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "OK" }));
    await waitFor(() =>
      expect(applied(backend)).toContainEqual(
        expect.objectContaining({ type: "setParagraphProps", patch: expect.objectContaining({ spacing: { after: 120, line: { kind: "exact", value: 360 } } }) }),
      ),
    );
    fireEvent.keyDown(editorEl, { key: "2", code: "Digit2", ctrlKey: true });
    await waitFor(() =>
      expect(applied(backend)).toContainEqual(expect.objectContaining({ patch: { spacing: expect.objectContaining({ line: { kind: "multiple", value: 2 } }) } })),
    );
    fireEvent.keyDown(editorEl, { key: "0", code: "Digit0", ctrlKey: true });
    await waitFor(() => expect(applied(backend)).toContainEqual(expect.objectContaining({ patch: { spacing: expect.objectContaining({ before: 240 }) } })));
  });

  it("format painter: Ctrl+Shift+C copies, the next selection gets the formatting", async () => {
    const { backend, editor, editorEl } = await mount([para(1, [run("bold", { bold: true }), run(" plain")])]);
    caret(editor, 1, 1);
    fireEvent.keyDown(editorEl, { key: "C", ctrlKey: true, shiftKey: true });
    expect(editorEl.classList.contains("format-painter")).toBe(true);
    caret(editor, 1, 5, 10);
    fireEvent.mouseUp(editorEl);
    await waitFor(() => expect(applied(backend)).toContainEqual({ type: "setRunProps", block: 1, from: 5, to: 10, patch: { bold: true } }));
    // Sticky (copied with the shortcut): still active until Esc.
    fireEvent.keyDown(editorEl, { key: "Escape" });
    expect(editorEl.classList.contains("format-painter")).toBe(false);
  });

  it("Ctrl+Shift+= superscript and Ctrl+= subscript in the editor", async () => {
    const { backend, editor, editorEl } = await mount();
    caret(editor, 1, 0, 5);
    fireEvent.keyDown(editorEl, { key: "+", code: "Equal", ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(applied(backend)).toContainEqual(expect.objectContaining({ patch: { verticalAlign: "superscript" } })));
    fireEvent.keyDown(editorEl, { key: "=", code: "Equal", ctrlKey: true });
    await waitFor(() => expect(applied(backend)).toContainEqual(expect.objectContaining({ patch: { verticalAlign: "subscript" } })));
  });
});
