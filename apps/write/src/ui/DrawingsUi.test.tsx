// P8-34 through the real App (fake backend): Insert › Shapes / Text Box →
// InsertDrawing, the Shape Format tab (styles, fill, rotate, wrap, size,
// align text), typing in a text box (the nested editor → text commands
// for the paragraph inside), Picture Format (styles, corrections, colour,
// border, reset, crop mode), Home › Font (Font dialog, Change Case, Text
// Effects) and View › Hidden text.

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ setTitle: vi.fn() }) }));

import type { Editor } from "@tiptap/core";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { bytesToBase64 } from "@rusuite/ui-shared";
import App from "../App";
import type { Block } from "../generated/Block";
import type { Drawing } from "../generated/Drawing";
import type { Inline } from "../generated/Inline";
import type { WriteCommand } from "../generated/WriteCommand";
import { findPos, pmOffsetOf } from "../sync/SyncPlugin";
import { FakeWriteBackend } from "../test/fakeWriteBackend";
import { makeDoc, para, run } from "../test/fixtures";
import { innerEditors } from "../features/drawings/innerEditors";

const noRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
Range.prototype.getClientRects = noRects;
Range.prototype.getBoundingClientRect = () => new DOMRect();
Element.prototype.getClientRects = noRects;

afterEach(() => {
  innerEditors.release();
  cleanup();
  vi.restoreAllMocks();
});

const b64 = (v: unknown) => bytesToBase64(new TextEncoder().encode(JSON.stringify(v)));
const tab = (name: string) => screen.getByRole("tab", { name });
const applied = (backend: FakeWriteBackend): WriteCommand[] => backend.log.flatMap((r) => (r.type === "apply" ? [r.command] : []));
const flat = (cmds: WriteCommand[]): WriteCommand[] => cmds.flatMap((c) => (c.type === "compound" ? flat(c.commands) : [c]));
const tiptap = (el: HTMLElement) => (el as unknown as { editor: Editor }).editor;
const theme = (slot: string, tint = 0) => ({ kind: "theme", value: { slot, tint } }) as never;

function box(): Drawing {
  return {
    id: 30,
    kind: "textBox",
    width: 1800000,
    height: 900000,
    preset: "rect",
    fill: { kind: "solid", value: { kind: "rgb", value: "FFFFFF" } as never },
    line: { fill: { kind: "solid", value: { kind: "rgb", value: "000000" } as never }, width: 9525 },
    text: { blocks: [para(31, "Box")] },
  };
}
const img: Inline = { kind: "image", value: { media: 1, width: 952500, height: 952500 } };

async function mount(body: Block[] = [para(1, "Hello world")]) {
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

/** Selects the first atom of type `name` as an object. */
function selectNode(editor: Editor, name: string) {
  act(() => {
    let at = -1;
    editor.state.doc.descendants((n, p) => {
      if (at < 0 && n.type.name === name) at = p;
      return at < 0;
    });
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, at)));
  });
}

const menuItem = (name: RegExp | string) =>
  screen.queryByRole("menuitem", { name }) ?? screen.queryByRole("menuitemradio", { name }) ?? screen.getByRole("menuitemcheckbox", { name });
const lastDrawingCmd = (backend: FakeWriteBackend) =>
  flat(applied(backend)).filter((c): c is Extract<WriteCommand, { type: "setDrawingProps" }> => c.type === "setDrawingProps").pop()!;

describe("Insert › Shapes and Text Box", () => {
  it("the shapes gallery arms the drawing tool; Enter inserts the preset at the caret (InsertDrawing) and selects it", async () => {
    const { backend, editor, editorEl } = await mount();
    caret(editor, 1, 5);
    fireEvent.click(tab("Insert"));
    fireEvent.click(screen.getByRole("button", { name: "Shapes" }));
    const lib = await screen.findByTestId("shape-library");
    fireEvent.click(within(lib).getByRole("button", { name: "Rounded rectangle" }));
    // Word: the pointer becomes a crosshair until a click or drag on the page; Enter inserts at the caret.
    await waitFor(() => expect(editorEl.dataset.drawTool).toBe("roundRect"));
    expect(applied(backend).some((c) => c.type === "insertDrawing")).toBe(false);
    fireEvent.keyDown(window, { key: "Enter" });
    await waitFor(() => expect(editorEl.dataset.drawTool).toBeUndefined());
    await waitFor(() => expect(applied(backend)).toContainEqual({ type: "insertDrawing", block: 1, offset: 5, kind: "shape", preset: "roundRect", width: 900000, height: 900000 }));
    await waitFor(() => expect(editorEl.querySelector(".drawing-wrap[data-preset='roundRect']")).toBeTruthy());
    await waitFor(() => expect(tab("Shape Format")).toBeTruthy());
  });

  it("Text Box › Simple Text Box inserts a text box; Text Box with Text Wrapping a floating one", async () => {
    const { backend, editor } = await mount();
    caret(editor, 1, 0);
    fireEvent.click(tab("Insert"));
    fireEvent.click(screen.getByRole("button", { name: "Text Box" }));
    fireEvent.click(menuItem("Simple Text Box"));
    await waitFor(() => expect(applied(backend)).toContainEqual(expect.objectContaining({ type: "insertDrawing", kind: "textBox", preset: "rect" })));
    caret(editor, 1, 0);
    fireEvent.click(tab("Insert"));
    fireEvent.click(screen.getByRole("button", { name: "Text Box" }));
    fireEvent.click(menuItem("Text Box with Text Wrapping"));
    await waitFor(() => expect(applied(backend).filter((c) => c.type === "insertDrawing")[1]).toMatchObject({ anchor: { wrap: "square" } }));
  });
});

describe("Shape Format", () => {
  async function selected() {
    const m = await mount([para(1, [run("A "), { kind: "drawing", value: box() }, run(" B")])]);
    selectNode(m.editor, "drawing");
    await waitFor(() => expect(tab("Shape Format")).toBeTruthy());
    fireEvent.click(tab("Shape Format"));
    return m;
  }

  it("Shape Styles gallery → SetDrawingProps with the style's fill, outline and text colour", async () => {
    const { backend } = await selected();
    fireEvent.click(screen.getByRole("button", { name: "Shape Styles" }));
    fireEvent.click(screen.getByRole("button", { name: "Colored Fill – Accent 2" }));
    await waitFor(() => expect(lastDrawingCmd(backend)).toBeTruthy());
    const c = lastDrawingCmd(backend);
    expect(c.drawing.fill).toEqual({ kind: "solid", value: theme("accent2") });
    expect(c.drawing.textColor).toEqual(theme("light1"));
    expect(c.drawing.text?.blocks).toEqual([]);
  });

  it("Rotate › Rotate Right 90° and Flip Horizontal", async () => {
    const { backend } = await selected();
    fireEvent.click(screen.getByRole("button", { name: "Rotate" }));
    fireEvent.click(menuItem("Rotate Right 90°"));
    await waitFor(() => expect(lastDrawingCmd(backend)?.drawing.rotation).toBe(90));
    fireEvent.click(screen.getByRole("button", { name: "Rotate" }));
    fireEvent.click(menuItem("Flip Horizontal"));
    await waitFor(() => expect(lastDrawingCmd(backend)?.drawing.flipH).toBe(true));
  });

  it("Wrap Text › Square makes it float; Position › Top Right aligns it to the margin", async () => {
    const { backend, editorEl } = await selected();
    fireEvent.click(screen.getByRole("button", { name: "Wrap Text" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Square" }));
    await waitFor(() => expect(lastDrawingCmd(backend)?.drawing.anchor?.wrap).toBe("square"));
    await waitFor(() => expect(editorEl.querySelector(".drawing-wrap.floating")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Position" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Top Right/ }));
    await waitFor(() => expect(lastDrawingCmd(backend)?.drawing.anchor?.h).toEqual({ relativeTo: "margin", place: { kind: "align", value: "right" } }));
  });

  it("Align › Align Center floats the shape centred on the margin; Align Bottom keeps it centred", async () => {
    const { backend } = await selected();
    fireEvent.click(screen.getByRole("button", { name: "Align" }));
    fireEvent.click(menuItem("Align Center"));
    await waitFor(() => expect(lastDrawingCmd(backend)?.drawing.anchor).toMatchObject({ wrap: "square", h: { relativeTo: "margin", place: { kind: "align", value: "center" } } }));
    fireEvent.click(screen.getByRole("button", { name: "Align" }));
    fireEvent.click(menuItem("Align Bottom"));
    await waitFor(() =>
      expect(lastDrawingCmd(backend)?.drawing.anchor).toMatchObject({ h: { place: { value: "center" } }, v: { relativeTo: "margin", place: { kind: "align", value: "bottom" } } }),
    );
  });

  it("Size fields and Align Text › Middle", async () => {
    const { backend } = await selected();
    const w = screen.getByRole("textbox", { name: "Width (cm)" });
    fireEvent.change(w, { target: { value: "6" } });
    fireEvent.blur(w);
    await waitFor(() => expect(lastDrawingCmd(backend)?.drawing.width).toBe(2160000));
    fireEvent.click(screen.getByRole("button", { name: "Align Text" }));
    fireEvent.click(menuItem("Middle"));
    await waitFor(() => expect(lastDrawingCmd(backend)?.drawing.text?.verticalAlign).toBe("center"));
  });

  it("typing in the text box → InsertText to the paragraph inside (the nested editor)", async () => {
    const { backend, editorEl } = await mount([para(1, [run("A "), { kind: "drawing", value: box() }])]);
    const inner = await waitFor(() => {
      const el = editorEl.querySelector(".drawing-text .ProseMirror") as HTMLElement | null;
      expect(el).toBeTruthy();
      return tiptap(el!);
    });
    act(() => {
      inner.commands.focus("end");
      inner.commands.insertContent("es");
    });
    await waitFor(() => expect(flat(applied(backend))).toContainEqual(expect.objectContaining({ type: "insertText", block: 31, offset: 3, text: "es" })));
    await waitFor(() => expect(backend.doc.body[0]!.value).toMatchObject({ inlines: expect.arrayContaining([expect.objectContaining({ kind: "drawing" })]) }));
    const d = (backend.doc.body[0]!.value as { inlines: Inline[] }).inlines.find((i) => i.kind === "drawing")!.value as Drawing;
    expect(d.text!.blocks[0]!.value).toMatchObject({ id: 31, inlines: [{ kind: "run", value: { text: "Boxes" } }] });
  });

  it("Alt text of a shape → SetDrawingProps with the description", async () => {
    const { backend } = await selected();
    fireEvent.click(screen.getByRole("button", { name: "Alt text" }));
    const dialog = await screen.findByRole("dialog", { name: "Alt text" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Alt text" }), { target: { value: "A note" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "OK" }));
    await waitFor(() => expect(lastDrawingCmd(backend)?.drawing.alt).toBe("A note"));
  });
});

describe("Picture Format", () => {
  async function picture() {
    const m = await mount([para(1, [img])]);
    selectNode(m.editor, "image");
    await waitFor(() => expect(tab("Picture Format")).toBeTruthy());
    fireEvent.click(tab("Picture Format"));
    return m;
  }
  const formats = (backend: FakeWriteBackend) => flat(applied(backend)).filter((c): c is Extract<WriteCommand, { type: "setImageFormat" }> => c.type === "setImageFormat");

  it("Picture Styles › Rounded Rectangle with Shadow → SetImageFormat", async () => {
    const { backend } = await picture();
    fireEvent.click(screen.getByRole("button", { name: "Picture Styles" }));
    fireEvent.click(screen.getByRole("button", { name: "Rounded Rectangle with Shadow" }));
    await waitFor(() => expect(formats(backend).pop()?.format).toEqual({ geometry: "roundRect", shadow: true }));
  });

  it("Corrections and Color → brightness / contrast and recolour; Reset Picture clears", async () => {
    const { backend } = await picture();
    fireEvent.click(screen.getByRole("button", { name: "Corrections" }));
    fireEvent.click(screen.getByRole("button", { name: "Brightness: 20 %, Contrast: -20 %" }));
    await waitFor(() => expect(formats(backend).pop()?.format).toEqual({ brightness: 20000, contrast: -20000 }));
    fireEvent.click(screen.getByRole("button", { name: "Color" }));
    fireEvent.click(menuItem("Grayscale"));
    await waitFor(() => expect(formats(backend).pop()?.format).toEqual({ brightness: 20000, contrast: -20000, recolor: "grayscale" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset Picture" }));
    await waitFor(() => expect(formats(backend).pop()?.format).toEqual({}));
  });

  it("Picture Border weight → a:ln on the picture", async () => {
    const { backend } = await picture();
    fireEvent.click(screen.getByRole("button", { name: "Border weight and dashes" }));
    fireEvent.click(menuItem("3 pt"));
    await waitFor(() => expect(formats(backend).pop()?.format.border).toMatchObject({ width: 38100 }));
  });

  it("P9-W4: Picture Effects › Soft Edges and Bevel → SetImageFormat (a:softEdge, a:bevelT)", async () => {
    const { backend } = await picture();
    fireEvent.click(screen.getByRole("button", { name: "Picture Effects" }));
    fireEvent.click(menuItem("5 pt"));
    await waitFor(() => expect(formats(backend).pop()?.format).toEqual({ softEdge: 63500 }));
    fireEvent.click(screen.getByRole("button", { name: "Picture Effects" }));
    fireEvent.click(menuItem("Relaxed Inset"));
    await waitFor(() => expect(formats(backend).pop()?.format).toEqual({ softEdge: 63500, bevel: { preset: "relaxedInset", width: 76200, height: 25400 } }));
  });

  it("P9-W4: Crop ▾ › Aspect Ratio 16:9 crops the picture centred (SetImageFormat + SetImageSize); Fit pads it; Crop to Shape", async () => {
    const { backend } = await picture();
    fireEvent.click(screen.getByRole("button", { name: "Crop options" }));
    const panel = await screen.findByTestId("crop-panel");
    fireEvent.click(within(panel).getByRole("button", { name: "16:9" }));
    await waitFor(() => expect(formats(backend).pop()?.format).toEqual({ crop: { left: 0, top: 21875, right: 0, bottom: 21875 } }));
    await waitFor(() => expect(flat(applied(backend))).toContainEqual(expect.objectContaining({ type: "setImageSize", width: 952500, height: 535781 })));
    fireEvent.click(screen.getByRole("button", { name: "Crop options" }));
    fireEvent.click(within(await screen.findByTestId("crop-panel")).getByRole("button", { name: "Fit" }));
    await waitFor(() => expect(formats(backend).pop()?.format.crop).toEqual({ left: -38889, top: 0, right: -38889, bottom: 0 }));
    fireEvent.click(screen.getByRole("button", { name: "Crop options" }));
    fireEvent.click(within(await screen.findByTestId("crop-panel")).getByRole("button", { name: "Heart" }));
    await waitFor(() => expect(formats(backend).pop()?.format.geometry).toBe("heart"));
  });

  it("Crop enters crop mode on the picture; Enter leaves it", async () => {
    const { editorEl } = await picture();
    fireEvent.click(screen.getByRole("button", { name: "Crop" }));
    const wrap = editorEl.querySelector(".inline-image-wrap")!;
    await waitFor(() => expect(wrap.classList.contains("cropping")).toBe(true));
    expect(wrap.querySelectorAll(".crop-handle")).toHaveLength(8);
    fireEvent.keyDown(editorEl, { key: "Enter" });
    await waitFor(() => expect(wrap.classList.contains("cropping")).toBe(false));
  });
});

describe("Home › Font", () => {
  it("Ctrl+D opens the Font dialog: small caps and 2 pt spacing → SetRunProps", async () => {
    const { backend, editor, editorEl } = await mount();
    caret(editor, 1, 0, 1, 5);
    fireEvent.keyDown(editorEl, { key: "d", ctrlKey: true });
    const dialog = await screen.findByRole("dialog", { name: "Font" });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Small caps" }));
    fireEvent.click(within(dialog).getByRole("tab", { name: "Advanced" }));
    fireEvent.change(within(dialog).getByRole("combobox", { name: "Spacing" }), { target: { value: "plus" } });
    fireEvent.change(within(dialog).getByRole("textbox", { name: /^Spacing by/ }), { target: { value: "2" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "OK" }));
    await waitFor(() => expect(flat(applied(backend))).toContainEqual({ type: "setRunProps", block: 1, from: 0, to: 5, patch: { smallCaps: true, charSpacing: 40 } }));
  });

  it("the Font dialog's effects exclude each other (superscript / subscript)", async () => {
    const { editor, editorEl } = await mount();
    caret(editor, 1, 0, 1, 5);
    fireEvent.keyDown(editorEl, { key: "d", ctrlKey: true });
    const dialog = await screen.findByRole("dialog", { name: "Font" });
    const sup = within(dialog).getByRole("checkbox", { name: "Superscript" }) as HTMLInputElement;
    const sub = within(dialog).getByRole("checkbox", { name: "Subscript" }) as HTMLInputElement;
    fireEvent.click(sup);
    expect(sup.checked).toBe(true);
    fireEvent.click(sub);
    expect(sub.checked).toBe(true);
    expect(sup.checked).toBe(false);
  });

  it("Change Case › UPPERCASE → ChangeCase for the selection", async () => {
    const { backend, editor } = await mount();
    caret(editor, 1, 0, 1, 11);
    fireEvent.click(screen.getByRole("button", { name: "Change Case" }));
    fireEvent.click(menuItem("UPPERCASE"));
    await waitFor(() => expect(applied(backend)).toContainEqual({ type: "changeCase", block: 1, from: 0, to: 11, case: "upper" }));
    await waitFor(() => expect(backend.doc.body[0]!.value).toMatchObject({ inlines: [{ kind: "run", value: { text: "HELLO WORLD" } }] }));
  });

  it("Text Effects › Shadow → SetRunProps shadow", async () => {
    const { backend, editor } = await mount();
    caret(editor, 1, 0, 1, 5);
    fireEvent.click(screen.getByRole("button", { name: "Text Effects" }));
    fireEvent.click(menuItem("Shadow"));
    await waitFor(() => expect(flat(applied(backend))).toContainEqual({ type: "setRunProps", block: 1, from: 0, to: 5, patch: { shadow: true } }));
  });

  it("View › Hidden text shows hidden text (the editor's show-hidden class)", async () => {
    const { editorEl } = await mount([para(1, [run("seen "), run("secret", { hidden: true })])]);
    expect(editorEl.querySelector(".hidden-text")).toBeTruthy();
    expect(editorEl.classList.contains("show-hidden")).toBe(false);
    fireEvent.click(tab("View"));
    fireEvent.click(screen.getByRole("checkbox", { name: "Hidden text" }));
    await waitFor(() => expect(editorEl.classList.contains("show-hidden")).toBe(true));
  });
});
