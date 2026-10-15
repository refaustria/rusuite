import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ setTitle: vi.fn() }) }));

import { bytesToBase64 } from "@rusuite/ui-shared";
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

describe("Write app", () => {
  it("mounts the ribbon, editor and status bar on a new document", async () => {
    const { editor, setTitle } = await mount();
    expect(editor.querySelectorAll("p").length).toBe(1);
    expect(screen.getByRole("toolbar", { name: "Formatting" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Paragraph styles" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Bulleted list" })).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Number" })).toBeNull();
    expect(screen.getByTestId("doc-name").textContent).toBe("Untitled");
    expect(screen.getByTestId("dirty").textContent).toBe("Saved");
    expect(screen.getByTestId("words").textContent).toBe("0 words");
    await waitFor(() => expect(setTitle).toHaveBeenLastCalledWith("Untitled – Rusuite Write"));
  });

  it("Open loads a docx through openDocx and shows the reader warnings", async () => {
    const { backend, editor } = await mount();
    const doc = makeDoc([para(1, "Opened", { style: "Heading1" }), para(2, "two words")]);
    vi.spyOn(backend, "openFile").mockResolvedValue({ name: "r.docx", bytesBase64: b64(doc) });
    fileCommand("Open…");
    await waitFor(() => expect(editor.querySelector("h1")?.textContent).toBe("Opened"));
    expect(screen.getByTestId("doc-name").textContent).toBe("r.docx");
    expect(screen.getByTestId("warnings").textContent).toContain("1 warning");
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
    fireEvent.click(screen.getByRole("button", { name: "Find and replace" }));
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
    expect(screen.getByTestId("dirty").textContent).toBe("Modified");
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
