// Write keyboard shortcuts, driven through the real App (fake keyboard events).
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ setTitle: vi.fn() }) }));

import { bytesToBase64 } from "@rusuite/ui-shared";
import App from "./App";
import type { WriteCommand } from "./generated/WriteCommand";
import { FakeWriteBackend } from "./test/fakeWriteBackend";
import { makeDoc, para } from "./test/fixtures";

// jsdom has no layout: ProseMirror's scroll-into-view needs rects.
const noRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
Range.prototype.getClientRects = noRects;
Range.prototype.getBoundingClientRect = () => new DOMRect();
Element.prototype.getClientRects = noRects;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const b64 = (v: unknown) => bytesToBase64(new TextEncoder().encode(JSON.stringify(v)));

async function mount(text = "hello world") {
  const backend = new FakeWriteBackend();
  render(<App backend={backend} />);
  const editor = await screen.findByTestId("editor");
  await waitFor(() => expect(backend.log.some((r) => r.type === "newDocument")).toBe(true));
  vi.spyOn(backend, "openFile").mockResolvedValue({ name: "t.docx", bytesBase64: b64(makeDoc([para(1, text)])) });
  fileCommand("Open…");
  await waitFor(() => expect(editor.textContent).toBe(text));
  backend.log.length = 0;
  (editor as HTMLElement).focus();
  return { backend, editor };
}

const applied = (backend: FakeWriteBackend): WriteCommand[] => backend.log.flatMap((r) => (r.type === "apply" ? [r.command] : []));
const ctrl = (key: string, extra: KeyboardEventInit = {}) => ({ key, ctrlKey: true, ...extra });


/** Runs a File (backstage) command. */
function fileCommand(name: string) {
  fireEvent.click(screen.getByRole("tab", { name: "File" }));
  fireEvent.click(within(screen.getByRole("dialog", { name: "File" })).getByRole("button", { name }));
}

describe("Write shortcuts", () => {
  it("Ctrl+E / L / R / J set the paragraph alignment", async () => {
    const { backend, editor } = await mount();
    for (const k of ["e", "r", "j", "l"]) fireEvent.keyDown(editor, ctrl(k));
    await waitFor(() => expect(applied(backend)).toHaveLength(4));
    const aligns = applied(backend).map((c) => JSON.stringify(c));
    expect(aligns[0]).toContain("center");
    expect(aligns[1]).toContain("right");
    expect(aligns[2]).toContain("justify");
    expect(aligns[3]).toContain("left");
  });

  it("Ctrl+Shift+L toggles a bulleted list", async () => {
    const { editor } = await mount();
    fireEvent.keyDown(editor, ctrl("L", { shiftKey: true }));
    await waitFor(() => expect(editor.querySelector("ul li")).not.toBeNull());
    fireEvent.keyDown(editor, ctrl("L", { shiftKey: true }));
    await waitFor(() => expect(editor.querySelector("ul")).toBeNull());
  });

  it("Ctrl+Alt+1..3 set heading styles; pressing again returns to Normal", async () => {
    const { editor } = await mount();
    fireEvent.keyDown(editor, ctrl("1", { altKey: true, code: "Digit1" }));
    await waitFor(() => expect(editor.querySelector("h1")?.textContent).toBe("hello world"));
    fireEvent.keyDown(editor, ctrl("1", { altKey: true, code: "Digit1" }));
    await waitFor(() => expect(editor.querySelector("h1")).toBeNull());
    fireEvent.keyDown(editor, ctrl("2", { altKey: true, code: "Digit2" }));
    await waitFor(() => expect(editor.querySelector("h2")).not.toBeNull());
    fireEvent.keyDown(editor, ctrl("3", { altKey: true, code: "Digit3" }));
    await waitFor(() => expect(editor.querySelector("h3")).not.toBeNull());
    expect(editor.querySelector("h2")).toBeNull();
  });

  it("Ctrl+H and Ctrl+F open find and replace", async () => {
    const { editor } = await mount();
    fireEvent.keyDown(editor, ctrl("h"));
    expect(screen.getByRole("dialog", { name: "Find and replace" })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.keyDown(editor, ctrl("f"));
    expect(screen.getByRole("dialog", { name: "Find and replace" })).toBeTruthy();
  });

  it("Ctrl+B / I / U format the selection inside the editor", async () => {
    const { backend, editor } = await mount();
    act(() => {
      const range = document.createRange();
      range.selectNodeContents(editor.querySelector("p")!);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    });
    for (const k of ["b", "i", "u"]) fireEvent.keyDown(editor, ctrl(k));
    await waitFor(() => expect(editor.querySelector("strong, b")).not.toBeNull());
    expect(editor.querySelector("em, i")).not.toBeNull();
    expect(editor.querySelector("u")).not.toBeNull();
    expect(applied(backend).length).toBeGreaterThan(0);
  });

  it("Ctrl+Z and Ctrl+Y send undo and redo to the core", async () => {
    const { backend, editor } = await mount();
    fireEvent.keyDown(editor, ctrl("z"));
    fireEvent.keyDown(editor, ctrl("y"));
    fireEvent.keyDown(editor, ctrl("Z", { shiftKey: true, keyCode: 90 }));
    await waitFor(() => expect(backend.log.map((r) => r.type).filter((t) => t === "undo" || t === "redo")).toEqual(["undo", "redo", "redo"]));
  });

  it("Ctrl+S and Ctrl+O work from inside the editor", async () => {
    const { backend, editor } = await mount();
    const save = vi.spyOn(backend, "saveFile").mockResolvedValue(true);
    fireEvent.keyDown(editor, ctrl("s"));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    fireEvent.keyDown(editor, ctrl("o"));
    await waitFor(() => expect(backend.log.some((r) => r.type === "openDocx")).toBe(true));
  });

  it("F12 (Word's Save As) asks for a name and saves under it", async () => {
    const { backend, editor } = await mount();
    const save = vi.spyOn(backend, "saveFile").mockResolvedValue(true);
    fireEvent.keyDown(editor, { key: "F12" });
    const input = screen.getByLabelText("File name") as HTMLInputElement;
    expect(input.value).toBe("t.docx");
    fireEvent.change(input, { target: { value: "report" } });
    fireEvent.submit(input.form!);
    await waitFor(() => expect(save).toHaveBeenCalledWith("report.docx", expect.any(String), { saveAs: true }));
    await waitFor(() => expect(screen.getByTestId("doc-name").textContent).toBe("report.docx"));
    expect(backend.log.find((r) => r.type === "markSaved")).toEqual({ type: "markSaved", name: "report.docx" });
  });

  it("Ctrl+Shift+S opens the Apply Styles box (Word), Alt+Ctrl+Shift+S the Styles pane", async () => {
    const { editor } = await mount();
    fireEvent.keyDown(editor, ctrl("S", { shiftKey: true }));
    expect(await screen.findByTestId("apply-styles")).toBeTruthy();
    fireEvent.keyDown(editor, ctrl("S", { shiftKey: true, altKey: true, code: "KeyS" }));
    expect(await screen.findByTestId("styles-pane")).toBeTruthy();
  });

  it("desktop: F12 goes straight to the save dialog; the chosen file names the document and Ctrl+S saves there", async () => {
    const { backend, editor } = await mount();
    backend.kind = "tauri";
    const save = vi.spyOn(backend, "saveFile").mockResolvedValue({ name: "final.docx", path: "/docs/final.docx" });
    fireEvent.keyDown(editor, { key: "F12" });
    await waitFor(() => expect(save).toHaveBeenCalledWith("t.docx", expect.any(String), { saveAs: true }));
    expect(screen.queryByLabelText("File name")).toBeNull();
    await waitFor(() => expect(screen.getByTestId("doc-name").textContent).toBe("final.docx"));
    expect(backend.log.find((r) => r.type === "markSaved")).toEqual({ type: "markSaved", name: "final.docx" });
    fireEvent.keyDown(editor, ctrl("s"));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save).toHaveBeenLastCalledWith("final.docx", expect.any(String));
  });

  it("Ctrl+N starts a new document; unsaved changes ask Save / Don't save / Cancel", async () => {
    const { backend, editor } = await mount();
    fireEvent.keyDown(editor, ctrl("e"));
    await waitFor(() => expect(screen.getByTestId("dirty").textContent).toBe("Modified"));
    backend.log.length = 0;
    fireEvent.keyDown(editor, ctrl("n"));
    const ask = await screen.findByRole("dialog", { name: "Save changes to t.docx?" });
    fireEvent.click(within(ask).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(backend.log.some((r) => r.type === "newDocument")).toBe(false);
    fireEvent.keyDown(editor, ctrl("n"));
    fireEvent.click(await screen.findByRole("button", { name: "Don't save" }));
    await waitFor(() => expect(backend.log.some((r) => r.type === "newDocument")).toBe(true));
    await waitFor(() => expect(screen.getByTestId("doc-name").textContent).toBe("Untitled"));
  });

  it("File › Open on a modified document: Save writes it under its name, then opens", async () => {
    const { backend, editor } = await mount();
    fireEvent.keyDown(editor, ctrl("e"));
    await waitFor(() => expect(screen.getByTestId("dirty").textContent).toBe("Modified"));
    const save = vi.spyOn(backend, "saveFile").mockResolvedValue(true);
    const open = vi.mocked(backend.openFile);
    open.mockClear();
    fileCommand("Open…");
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));
    await waitFor(() => expect(open).toHaveBeenCalled());
    expect(save).toHaveBeenCalledWith("t.docx", expect.any(String));
    expect(screen.queryByLabelText("File name")).toBeNull();
  });

  describe("Word's character and paragraph keys (W-30)", () => {
    const selectAll = (editor: HTMLElement) =>
      act(() => {
        const range = document.createRange();
        range.selectNodeContents(editor.querySelector("p")!);
        getSelection()!.removeAllRanges();
        getSelection()!.addRange(range);
        document.dispatchEvent(new Event("selectionchange"));
      });
    const runProps = (backend: FakeWriteBackend) => applied(backend).flatMap((c) => (c.type === "setRunProps" ? [c.patch] : []));

    it("Ctrl+] and Ctrl+[ grow / shrink the selection by 1 pt", async () => {
      const { backend, editor } = await mount();
      selectAll(editor);
      fireEvent.keyDown(editor, ctrl("]", { code: "BracketRight" }));
      await waitFor(() => expect(runProps(backend).at(-1)?.size).toBeDefined());
      const grown = runProps(backend).at(-1)!.size!;
      fireEvent.keyDown(editor, ctrl("[", { code: "BracketLeft" }));
      await waitFor(() => expect(runProps(backend).at(-1)?.size).toBe(grown - 100));
    });

    it("Ctrl+Shift+> / < step through Word's size list", async () => {
      const { backend, editor } = await mount();
      selectAll(editor);
      fireEvent.keyDown(editor, ctrl(">", { shiftKey: true, code: "Period" }));
      await waitFor(() => expect(runProps(backend).length).toBeGreaterThan(0));
      const first = runProps(backend).at(-1)!.size!;
      fireEvent.keyDown(editor, ctrl(">", { shiftKey: true, code: "Period" }));
      await waitFor(() => expect(runProps(backend).at(-1)!.size!).toBeGreaterThan(first));
      fireEvent.keyDown(editor, ctrl("<", { shiftKey: true, code: "Comma" }));
      await waitFor(() => expect(runProps(backend).at(-1)!.size!).toBe(first));
    });

    it("Ctrl+Shift+K / A / D: small caps, all caps, double underline", async () => {
      const { backend, editor } = await mount();
      selectAll(editor);
      fireEvent.keyDown(editor, ctrl("K", { shiftKey: true, code: "KeyK" }));
      await waitFor(() => expect(runProps(backend).at(-1)).toMatchObject({ smallCaps: true }));
      fireEvent.keyDown(editor, ctrl("A", { shiftKey: true, code: "KeyA" }));
      await waitFor(() => expect(runProps(backend).at(-1)).toMatchObject({ allCaps: true }));
      expect(runProps(backend).at(-1)?.smallCaps).toBeFalsy();
      fireEvent.keyDown(editor, ctrl("D", { shiftKey: true, code: "KeyD" }));
      await waitFor(() => expect(runProps(backend).at(-1)).toMatchObject({ underline: "double" }));
    });

    it("Shift+F3 cycles the case of the selection with ChangeCase", async () => {
      const { backend, editor } = await mount();
      selectAll(editor);
      fireEvent.keyDown(editor, { key: "F3", shiftKey: true });
      await waitFor(() => expect(applied(backend)).toContainEqual(expect.objectContaining({ type: "changeCase", case: "capitalize" })));
    });

    it("Ctrl+T / Ctrl+Shift+T: hanging indent and back; Ctrl+Q removes it again", async () => {
      const { backend, editor } = await mount();
      fireEvent.keyDown(editor, ctrl("t"));
      await waitFor(() => expect(applied(backend)).toContainEqual(expect.objectContaining({ type: "setParagraphProps", patch: { indent: { left: 720, hanging: 720 } } })));
      fireEvent.keyDown(editor, ctrl("T", { shiftKey: true }));
      await waitFor(() => expect(applied(backend)).toContainEqual(expect.objectContaining({ type: "setParagraphProps", patch: { indent: { left: 0, hanging: 0 } } })));
      fireEvent.keyDown(editor, ctrl("e"));
      fireEvent.keyDown(editor, ctrl("q"));
      await waitFor(() => expect(editor.querySelector("p")!.getAttribute("style") ?? "").not.toContain("text-align"));
    });

    it("Ctrl+Shift+N applies the Normal style", async () => {
      const { backend, editor } = await mount();
      fireEvent.keyDown(editor, ctrl("2", { altKey: true, code: "Digit2" }));
      await waitFor(() => expect(editor.querySelector("h2")).not.toBeNull());
      fireEvent.keyDown(editor, ctrl("N", { shiftKey: true }));
      await waitFor(() => expect(editor.querySelector("h2")).toBeNull());
      expect(applied(backend).at(-1)).toMatchObject({ type: "setStyle", style: "Normal" });
    });

    it("the help lists the new keys", async () => {
      const { editor } = await mount();
      fireEvent.keyDown(editor, ctrl("/"));
      const help = screen.getByRole("dialog", { name: "Keyboard shortcuts" });
      for (const label of ["Font size 1 pt larger", "Small caps", "Double underline", "Hanging indent", "Remove paragraph formatting", "Normal style"]) {
        expect(help.textContent).toContain(label);
      }
      expect(help.textContent).toContain("Shift+F3");
    });
  });

  it("Ctrl+/ lists the shortcuts, including the editor-native ones", async () => {
    const { editor } = await mount();
    fireEvent.keyDown(editor, ctrl("/"));
    const help = screen.getByRole("dialog", { name: "Keyboard shortcuts" });
    expect(help.textContent).toContain("Heading 2");
    expect(help.textContent).toContain("Bold");
    expect(help.textContent).toContain("Ctrl+Shift+L");
  });

  it("Ctrl+P is bound (Export PDF)", async () => {
    const { editor } = await mount();
    const e = new KeyboardEvent("keydown", { key: "p", ctrlKey: true, bubbles: true, cancelable: true });
    editor.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
  });
});
