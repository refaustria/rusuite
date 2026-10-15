// Write keyboard shortcuts, driven through the real App (fake keyboard events).
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

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
  fireEvent.click(screen.getByRole("button", { name: "Open" }));
  await waitFor(() => expect(editor.textContent).toBe(text));
  backend.log.length = 0;
  (editor as HTMLElement).focus();
  return { backend, editor };
}

const applied = (backend: FakeWriteBackend): WriteCommand[] => backend.log.flatMap((r) => (r.type === "apply" ? [r.command] : []));
const ctrl = (key: string, extra: KeyboardEventInit = {}) => ({ key, ctrlKey: true, ...extra });

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

  it("Ctrl+Shift+S asks for a name and saves under it", async () => {
    const { backend, editor } = await mount();
    const save = vi.spyOn(backend, "saveFile").mockResolvedValue(true);
    fireEvent.keyDown(editor, ctrl("S", { shiftKey: true }));
    const input = screen.getByLabelText("File name") as HTMLInputElement;
    expect(input.value).toBe("t.docx");
    fireEvent.change(input, { target: { value: "report" } });
    fireEvent.submit(input.form!);
    await waitFor(() => expect(save).toHaveBeenCalledWith("report.docx", expect.any(String)));
    await waitFor(() => expect(screen.getByTestId("doc-name").textContent).toBe("report.docx"));
    expect(backend.log.find((r) => r.type === "markSaved")).toEqual({ type: "markSaved", name: "report.docx" });
  });

  it("Ctrl+N starts a new document; unsaved changes need a confirmation", async () => {
    const { backend, editor } = await mount();
    fireEvent.keyDown(editor, ctrl("e"));
    await waitFor(() => expect(screen.getByTestId("dirty").textContent).toBe("Modified"));
    backend.log.length = 0;
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    fireEvent.keyDown(editor, ctrl("n"));
    expect(backend.log.some((r) => r.type === "newDocument")).toBe(false);
    fireEvent.keyDown(editor, ctrl("n"));
    await waitFor(() => expect(backend.log.some((r) => r.type === "newDocument")).toBe(true));
    expect(confirm).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.getByTestId("doc-name").textContent).toBe("Untitled"));
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
