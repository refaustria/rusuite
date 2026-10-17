// Write's ribbon, driven through the real App.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ setTitle: vi.fn() }) }));

import { bytesToBase64 } from "@rusuite/ui-shared";
import App from "../App";
import type { WriteCommand } from "../generated/WriteCommand";
import { FakeWriteBackend } from "../test/fakeWriteBackend";
import { makeDoc, para } from "../test/fixtures";
import { marginPresetOf, paperOf, paperPatch } from "./WriteToolbar";

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

async function mount(text = "hello world") {
  const backend = new FakeWriteBackend();
  render(<App backend={backend} />);
  const editor = await screen.findByTestId("editor", undefined, { timeout: 5000 });
  await waitFor(() => expect(backend.log.some((r) => r.type === "newDocument")).toBe(true), { timeout: 5000 });
  vi.spyOn(backend, "openFile").mockResolvedValue({ name: "t.docx", bytesBase64: b64(makeDoc([para(1, text)])) });
  fireEvent.keyDown(window, { key: "o", ctrlKey: true });
  await waitFor(() => expect(editor.textContent).toBe(text), { timeout: 5000 });
  backend.log.length = 0;
  (editor as HTMLElement).focus();
  return { backend, editor };
}

const applied = (backend: FakeWriteBackend): WriteCommand[] => backend.log.flatMap((r) => (r.type === "apply" ? [r.command] : []));

describe("page setup helpers", () => {
  const page = { width: 11906, height: 16838, orientation: "portrait" as const, margins: { top: 1440, right: 1440, bottom: 1440, left: 1440, header: 708, footer: 708, gutter: 0 } };
  it("recognises paper and margins; keeps the orientation when changing paper", () => {
    expect(paperOf(page)).toBe("A4");
    expect(paperOf({ ...page, width: 16838, height: 11906, orientation: "landscape" })).toBe("A4");
    expect(marginPresetOf(page)).toBe("normal");
    expect(paperPatch(page, "Letter")).toEqual({ width: 12240, height: 15840 });
    expect(paperPatch({ ...page, orientation: "landscape" }, "Letter")).toEqual({ width: 15840, height: 12240 });
  });
});

describe("Write ribbon", () => {
  it("has File, Home, Insert, Design, Layout, References, Review and View", async () => {
    await mount();
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["File", "Home", "Insert", "Design", "Layout", "References", "Review", "View"]);
    const toolbar = screen.getByRole("toolbar", { name: "Formatting" });
    for (const g of ["Clipboard", "Font", "Paragraph", "Styles", "Editing"]) expect(within(toolbar).getByRole("group", { name: g })).toBeTruthy();
  });

  it("styles gallery sets the paragraph style and shows the current one", async () => {
    const { backend, editor } = await mount();
    const gallery = screen.getByRole("group", { name: "Paragraph styles" });
    expect(within(gallery).getByRole("button", { name: "Normal" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(within(gallery).getByRole("button", { name: "Heading 1" }));
    await waitFor(() => expect(editor.querySelector("h1")?.textContent).toBe("hello world"));
    await waitFor(() => expect(applied(backend)).toContainEqual(expect.objectContaining({ type: "setStyle", style: "Heading1" })));
    await waitFor(() => expect(within(gallery).getByRole("button", { name: "Heading 1" }).getAttribute("aria-pressed")).toBe("true"));
    fireEvent.click(screen.getByRole("button", { name: "More styles" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "More styles" })).getByRole("button", { name: "Title" }));
    await waitFor(() => expect(editor.querySelector(".doc-title")).toBeTruthy());
  });

  it("line spacing menu sets the paragraph spacing", async () => {
    const { backend } = await mount();
    fireEvent.click(screen.getByRole("button", { name: "Line spacing" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "1.5" }));
    await waitFor(() =>
      expect(applied(backend)).toContainEqual(expect.objectContaining({ type: "setParagraphProps", patch: expect.objectContaining({ spacing: expect.objectContaining({ line: { kind: "multiple", value: 1.5 } }) }) })),
    );
  });

  it("Insert › Table picks rows × columns", async () => {
    const { backend } = await mount();
    // Deterministic under CPU load: wait for each control instead of assuming it rendered, with generous timeouts.
    fireEvent.click(tab("Insert"));
    fireEvent.click(await screen.findByRole("button", { name: "Table" }, { timeout: 5000 }));
    fireEvent.click(await screen.findByRole("button", { name: "3 × 4 table" }, { timeout: 5000 }));
    await waitFor(() => expect(applied(backend)).toContainEqual(expect.objectContaining({ type: "insertTable", rows: 3, cols: 4 })), { timeout: 5000 });
  });

  it("Insert › Page break and Line break", async () => {
    const { editor } = await mount();
    fireEvent.click(tab("Insert"));
    fireEvent.click(screen.getByRole("button", { name: "Page break" }));
    await waitFor(() => expect(editor.querySelector(".page-break")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Line break" }));
    await waitFor(() => expect(editor.querySelector("br")).toBeTruthy());
  });

  it("Layout › Size, Orientation and Margins send SetPage and update the page", async () => {
    const { backend } = await mount();
    fireEvent.click(tab("Layout"));
    fireEvent.click(screen.getByRole("button", { name: "Orientation" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Landscape" }));
    await waitFor(() => expect(applied(backend)).toContainEqual({ type: "setPage", patch: { orientation: "landscape" } }));
    fireEvent.click(screen.getByRole("button", { name: "Orientation" }));
    await waitFor(() => expect(screen.getByRole("menuitemradio", { name: "Landscape" }).getAttribute("aria-checked")).toBe("true"));
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Margins" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Narrow/ }));
    await waitFor(() => expect(applied(backend)).toContainEqual({ type: "setPage", patch: { margins: { top: 720, right: 720, bottom: 720, left: 720 } } }));
    fireEvent.click(screen.getByRole("button", { name: "Size" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Letter/ }));
    await waitFor(() => expect(applied(backend)).toContainEqual({ type: "setPage", patch: { width: 15840, height: 12240 } }));
  });

  it("View › Zoom scales the page; Keyboard shortcuts opens the help", async () => {
    await mount();
    fireEvent.click(tab("View"));
    fireEvent.change(screen.getByRole("combobox", { name: "Zoom" }), { target: { value: "2" } });
    expect(screen.getByTestId("write-zoom").style.zoom).toBe("2");
    fireEvent.click(screen.getByRole("button", { name: "Keyboard shortcuts" }));
    expect(screen.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeTruthy();
  });

  it("undo/redo buttons follow the core state", async () => {
    const { backend } = await mount();
    const undo = screen.getByRole("button", { name: "Undo" }) as HTMLButtonElement;
    expect(undo.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Align center" }));
    await waitFor(() => expect(undo.disabled).toBe(false));
    fireEvent.click(undo);
    await waitFor(() => expect(backend.log.some((r) => r.type === "undo")).toBe(true));
  });

  it("keyboard only: Alt, arrows and Enter open Layout; File › Save As… asks for a name", async () => {
    const { editor } = await mount();
    fireEvent.keyDown(window, { key: "Alt", altKey: true });
    fireEvent.keyUp(window, { key: "Alt" });
    expect(document.activeElement).toBe(tab("Home"));
    fireEvent.keyDown(tab("Home"), { key: "ArrowRight" });
    fireEvent.keyDown(tab("Insert"), { key: "ArrowRight" });
    fireEvent.keyDown(tab("Design"), { key: "ArrowRight" });
    fireEvent.keyDown(tab("Layout"), { key: "Enter" });
    expect(tab("Layout").getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(tab("Layout"), { key: "Escape" });
    expect(document.activeElement).toBe(editor);
    fireEvent.click(tab("File"));
    fireEvent.click(screen.getByRole("button", { name: "Save As…" }));
    expect(screen.getByLabelText("File name")).toBeTruthy();
  });
});
