import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ setTitle: vi.fn() }) }));

import { bytesToBase64, setLocale } from "@rusuite/ui-shared";
import App, { countWords } from "./App";
import { FakeWriteBackend } from "./test/fakeWriteBackend";
import { makeDoc, para } from "./test/fixtures";

afterEach(cleanup);

const b64 = (v: unknown) => bytesToBase64(new TextEncoder().encode(JSON.stringify(v)));

async function mount() {
  const backend = new FakeWriteBackend();
  const setTitle = vi.spyOn(backend, "setTitle");
  render(<App backend={backend} />);
  const editor = await screen.findByTestId("editor");
  await waitFor(() => expect(backend.log.some((r) => r.type === "newDocument")).toBe(true));
  return { backend, editor, setTitle };
}


/** Runs a File (backstage) command. */
function fileCommand(name: string) {
  fireEvent.click(screen.getByRole("tab", { name: "File" }));
  fireEvent.click(within(screen.getByRole("dialog", { name: "File" })).getByRole("button", { name }));
}

describe("Write app in German", () => {
  it("shows the German ribbon and status bar", async () => {
    setLocale("de", { persist: false });
    try {
      await mount();
      expect(screen.getByRole("tab", { name: "Start" }).getAttribute("aria-selected")).toBe("true");
      expect(screen.getByRole("toolbar", { name: "Formatierung" })).toBeTruthy();
      expect(screen.getByRole("group", { name: "Absatzformatvorlagen" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Überschrift 1" })).toBeTruthy();
      await waitFor(() => expect(screen.getByTestId("words").textContent).toBe("0 Wörter"), { timeout: 10000 });
      fireEvent.click(screen.getByRole("tab", { name: "Datei" }));
      expect(within(screen.getByRole("dialog", { name: "Datei" })).getByRole("button", { name: "Speichern" }).title).toBe("Speichern (Strg+S)");
    } finally {
      setLocale("en", { persist: false });
    }
  });
});

describe("Write app in German", () => {
  it("translates the reader's warnings by their code; unknown codes keep the English text (W-26)", async () => {
    setLocale("de", { persist: false });
    try {
      const { backend, editor } = await mount();
      backend.openWarnings = [
        { code: "docx.numbering.levelStyleLink", params: {}, text: "word/numbering.xml: list level linked to a style; link dropped", count: 3 },
        { code: "docx.run.propertyDropped", params: { ctx: "word/document.xml", name: "w:foo" }, text: "word/document.xml: run property w:foo dropped", count: 1 },
        { code: "docx.someday", params: {}, text: "something new dropped", count: 1 },
      ];
      vi.spyOn(backend, "openFile").mockResolvedValue({ name: "r.docx", bytesBase64: b64(makeDoc([para(1, "x")])) });
      fireEvent.click(screen.getByRole("tab", { name: "Datei" }));
      fireEvent.click(within(screen.getByRole("dialog", { name: "Datei" })).getByRole("button", { name: "Öffnen…" }));
      await waitFor(() => expect(editor.textContent).toBe("x"));
      const w = await screen.findByTestId("warnings", {}, { timeout: 10000 });
      expect(w.textContent).toContain("word/numbering.xml: Listenebene mit einer Formatvorlage verknüpft; Verknüpfung verworfen (3×)");
      expect(w.title).toContain("word/document.xml: Zeicheneigenschaft w:foo verworfen");
      expect(w.title).toContain("something new dropped");
      // Switching back to English re-renders the status bar.
      act(() => setLocale("en", { persist: false }));
      await waitFor(() => expect(screen.getByTestId("warnings").textContent).toContain("list level linked to a style; link dropped (3×)"));
    } finally {
      setLocale("en", { persist: false });
    }
  });
});

describe("Write app", () => {
  it("mounts the ribbon, editor and status bar on a new document", async () => {
    const { editor, setTitle } = await mount();
    expect(editor.querySelectorAll("p").length).toBe(1);
    expect(screen.getByRole("toolbar", { name: "Formatting" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Paragraph styles" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Bulleted list" })).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Number" })).toBeNull();
    await waitFor(() => expect(screen.getByTestId("doc-name").textContent).toBe("Untitled"), { timeout: 10000 });
    await waitFor(() => expect(screen.getByTestId("dirty").textContent).toBe("Saved"), { timeout: 10000 });
    await waitFor(() => expect(screen.getByTestId("words").textContent).toBe("0 words"), { timeout: 10000 });
    await waitFor(() => expect(setTitle).toHaveBeenLastCalledWith("Untitled – Rusuite Write"));
  });

  it("Open loads a docx through openDocx and shows the reader warnings", async () => {
    const { backend, editor } = await mount();
    const doc = makeDoc([para(1, "Opened", { style: "Heading1" }), para(2, "two words")]);
    vi.spyOn(backend, "openFile").mockResolvedValue({ name: "r.docx", bytesBase64: b64(doc) });
    fileCommand("Open…");
    await waitFor(() => expect(editor.querySelector("h1")?.textContent).toBe("Opened"));
    await waitFor(() => expect(screen.getByTestId("doc-name").textContent).toBe("r.docx"), { timeout: 10000 });
    await waitFor(() => expect(screen.getByTestId("warnings").textContent).toContain("1 warning"), { timeout: 10000 });
    // The status-bar count is debounced (250 ms).
    await waitFor(() => expect(screen.getByTestId("words").textContent).toBe("3 words"));
  });

  it("Save writes the file and marks it saved only when the shell confirms", async () => {
    const { backend, setTitle } = await mount();
    const saveFile = vi.spyOn(backend, "saveFile").mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await act(async () => {
      await backend.dispatch({ type: "apply", command: { type: "insertText", block: 1, offset: 0, text: "x" } });
    });
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    await waitFor(() => expect(saveFile).toHaveBeenCalledTimes(1));
    expect(backend.log.some((r) => r.type === "markSaved")).toBe(false);
    fileCommand("Save");
    await waitFor(() => expect(backend.log.some((r) => r.type === "markSaved")).toBe(true));
    expect(saveFile).toHaveBeenLastCalledWith("Untitled.docx", expect.any(String));
    await waitFor(() => expect(screen.getByTestId("doc-name").textContent).toBe("Untitled.docx"));
    await waitFor(() => expect(setTitle).toHaveBeenLastCalledWith("Untitled.docx – Rusuite Write"));
  });

  it("Find and replace runs the Rust command and reports the count", async () => {
    const { backend, editor } = await mount();
    vi.spyOn(backend, "openFile").mockResolvedValue({
      name: "f.docx",
      bytesBase64: b64(makeDoc([para(1, "red fish red")])),
    });
    fileCommand("Open…");
    await waitFor(() => expect(editor.textContent).toBe("red fish red"));
    fireEvent.click(screen.getByRole("button", { name: "Replace" }));
    fireEvent.change(screen.getByLabelText("Find"), { target: { value: "red" } });
    fireEvent.change(screen.getByLabelText("Replace with"), { target: { value: "blue" } });
    fireEvent.click(screen.getByRole("button", { name: "Replace all" }));
    await waitFor(() => expect(editor.textContent).toBe("blue fish blue"));
    expect(screen.getByRole("status").textContent).toBe("2 replacements");
  });

  it("errors from the core show up as toasts", async () => {
    const { backend } = await mount();
    vi.spyOn(backend, "openFile").mockResolvedValue({ name: "bad.docx", bytesBase64: btoa("not json") });
    vi.spyOn(backend, "dispatch").mockResolvedValueOnce({ err: { code: "bad_docx", message: "not a docx" } } as never);
    fileCommand("Open…");
    expect((await screen.findByRole("alert")).textContent).toContain("bad_docx");
  });

  it("countWords", () => {
    expect(countWords("  one two\tthree ")).toBe(3);
    expect(countWords("")).toBe(0);
  });
});

describe("Write app recovery (P5-3)", () => {
  it("restores an autosaved document from the banner as modified", async () => {
    const { MemoryDocStorage } = await import("@rusuite/ui-shared");
    const storage = new MemoryDocStorage();
    const doc = makeDoc([para(1, "Recovered text")]);
    await storage.putRecovery({ id: "crashed", name: "letter.docx", savedAt: Date.now(), revision: 3, json: JSON.stringify(doc) });
    const backend = Object.assign(new FakeWriteBackend(), { storage });
    render(<App backend={backend} />);
    const editor = await screen.findByTestId("editor");
    const banner = await screen.findByRole("region", { name: "Recovered documents" });
    expect(banner.textContent).toContain("letter.docx");
    fireEvent.click(screen.getByRole("button", { name: "Restore letter.docx" }));
    await waitFor(() => expect(editor.textContent).toBe("Recovered text"));
    // The status bar is throttled (60 ms).
    await waitFor(() => expect(screen.getByTestId("doc-name").textContent).toBe("letter.docx"));
    await waitFor(() => expect(screen.getByTestId("dirty").textContent).toBe("Modified"), { timeout: 10000 });
    expect(screen.queryByTestId("recovery-banner")).toBeNull();
    await waitFor(() => expect(storage.recovery.has("crashed")).toBe(false));
    expect(storage.recovery.size).toBe(1);
  });

  it("the File view re-opens a recent document from browser storage", async () => {
    const { MemoryDocStorage } = await import("@rusuite/ui-shared");
    const storage = new MemoryDocStorage();
    await storage.rememberRecent("notes.docx", JSON.stringify(makeDoc([para(1, "From the recent list")])));
    const backend = Object.assign(new FakeWriteBackend(), { storage });
    render(<App backend={backend} />);
    const editor = await screen.findByTestId("editor");
    await waitFor(() => expect(backend.log.some((r) => r.type === "newDocument")).toBe(true));
    fireEvent.click(screen.getByRole("tab", { name: "File" }));
    fireEvent.click(await screen.findByTestId("recent-entry"));
    await waitFor(() => expect(editor.textContent).toBe("From the recent list"));
    await waitFor(() => expect(screen.getByTestId("doc-name").textContent).toBe("notes.docx"));
  });
});
