// One window per document in the desktop shells (P11-D2): New opens a window, Open and the recent list leave this
// window's document alone (the shell routes them), the shell's per-window events reach only this window, Cancel on
// a held close tells the shell (Quit asks window by window), and macOS titles read "<name> — Edited".

import { afterEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({
  invoke: vi.fn(async (_cmd: string, _args?: unknown): Promise<unknown> => undefined),
  listen: vi.fn(async (_event: string, _fn: () => void, _options?: unknown) => () => {}),
  close: vi.fn(async () => {}),
  label: "doc-2",
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: tauri.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: tauri.listen }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ label: tauri.label, close: tauri.close, setTitle: async () => {} }),
}));

import { setLocale } from "../i18n/locale";
import { tauriCloseHooks, CLOSE_REQUESTED_EVENT } from "./closeGuard";
import { OPEN_DOCUMENT_EVENT, tauriLaunchDocuments } from "./launch";
import { DocumentSession } from "./session";
import { MemoryDocStorage } from "./storage";
import { TauriDocStorage } from "./tauri";
import { FakeCore, fakeBackend } from "./testing";
import { UnsavedGuard, type DocState } from "./unsaved";
import { macWindowTitle, menuTexts, MENU_KEYS, tauriWindows, type DesktopWindows } from "./windows";

afterEach(() => {
  vi.clearAllMocks();
  setLocale("en", { persist: false });
});

function dirtyDoc(): DocState {
  return { dirty: () => true, name: () => "a.xlsx", defaultName: "Workbook.xlsx", save: async () => true };
}

function desktop(): DesktopWindows & { newWindow: ReturnType<typeof vi.fn>; closeWindow: ReturnType<typeof vi.fn> } {
  return { newWindow: vi.fn(async () => {}), closeWindow: vi.fn(async () => {}) };
}

describe("UnsavedGuard with desktop windows", () => {
  it("New opens a new window and never asks about this window's changes", async () => {
    const windows = desktop();
    const guard = new UnsavedGuard({ kind: "tauri", windows }, dirtyDoc());
    const replace = vi.fn();
    expect(await guard.runNew(replace)).toBe(true);
    expect(windows.newWindow).toHaveBeenCalledOnce();
    expect(replace).not.toHaveBeenCalled();
    expect(guard.getState()).toBeNull();
  });

  it("Open runs at once (the shell opens the file elsewhere); Cmd+W closes this window", async () => {
    const windows = desktop();
    const guard = new UnsavedGuard({ kind: "tauri", windows }, dirtyDoc());
    const open = vi.fn();
    expect(await guard.runOpen(open)).toBe(true);
    expect(open).toHaveBeenCalledOnce();
    expect(guard.getState()).toBeNull();
    expect(guard.closeWindow()).toBe(true);
    expect(windows.closeWindow).toHaveBeenCalledOnce();
  });

  it("without windows (browser, mobile) New and Open ask first, as before", async () => {
    const guard = new UnsavedGuard({ kind: "wasm" }, dirtyDoc());
    const replace = vi.fn();
    const running = guard.runNew(replace);
    await vi.waitFor(() => expect(guard.getState()).toEqual({ kind: "save", name: "a.xlsx" }));
    guard.choose("cancel");
    expect(await running).toBe(false);
    expect(replace).not.toHaveBeenCalled();
    expect(guard.closeWindow()).toBe(false);
  });

  it("Cancel on a held close tells the shell, so a Quit in progress stops", async () => {
    const hooks = { setGuard: vi.fn(async () => {}), listen: vi.fn(async () => () => {}), close: vi.fn(async () => {}), cancelled: vi.fn(async () => {}) };
    const guard = new UnsavedGuard({ kind: "tauri", windows: desktop() }, dirtyDoc());
    guard.watchWindow({ hooks });
    const asked = guard.closeRequested();
    await vi.waitFor(() => expect(guard.getState()).not.toBeNull());
    guard.choose("cancel");
    expect(await asked).toBe(false);
    expect(hooks.cancelled).toHaveBeenCalledOnce();
    expect(hooks.close).not.toHaveBeenCalled();
  });
});

describe("the shell's per-window commands and events", () => {
  it("listens only to the events the shell sends to this window", async () => {
    tauriCloseHooks().listen(() => {});
    tauriLaunchDocuments().subscribe(() => {});
    await vi.waitFor(() => expect(tauri.listen).toHaveBeenCalledTimes(2));
    expect(tauri.listen).toHaveBeenCalledWith(CLOSE_REQUESTED_EVENT, expect.any(Function), { target: "doc-2" });
    expect(tauri.listen).toHaveBeenCalledWith(OPEN_DOCUMENT_EVENT, expect.any(Function), { target: "doc-2" });
    await tauriCloseHooks().cancelled!();
    expect(tauri.invoke).toHaveBeenCalledWith("close_cancelled");
  });

  it("New calls window_new; macOS: the localized menu goes to the shell and again on a language switch", async () => {
    tauriWindows(false);
    expect(tauri.invoke).not.toHaveBeenCalled();
    const windows = tauriWindows(true);
    expect(tauri.invoke).toHaveBeenCalledWith("menu_texts", { texts: menuTexts() });
    await windows.newWindow();
    expect(tauri.invoke).toHaveBeenCalledWith("window_new");
    await windows.closeWindow();
    expect(tauri.close).toHaveBeenCalledOnce();
    tauri.invoke.mockClear();
    setLocale("de", { persist: false });
    await vi.waitFor(() => expect(tauri.invoke).toHaveBeenCalledWith("menu_texts", { texts: expect.objectContaining({ file: "Ablage", quit: "{app} beenden" }) }));
  });

  it("every menu entry has a text", () => {
    const texts = menuTexts();
    expect(Object.keys(texts)).toEqual(Object.keys(MENU_KEYS));
    for (const [field, text] of Object.entries(texts)) expect(text, field).not.toBe(MENU_KEYS[field as keyof typeof MENU_KEYS]);
  });

  it("a recent file the shell opened in another window leaves this document alone, without asking", async () => {
    const storage = new TauriDocStorage();
    tauri.invoke.mockImplementationOnce(async () => null);
    expect(await storage.openRecent({ name: "b.xlsx", path: "/b.xlsx", blobId: null, openedAt: 1 })).toBeNull();
    expect(tauri.invoke).toHaveBeenCalledWith("recent_open", { path: "/b.xlsx" });

    const openRecent = vi.fn(async () => null);
    const fs = Object.assign(new MemoryDocStorage(), { kind: "fs" as const, openRecent });
    const backend = { ...fakeBackend(new FakeCore(), fs as unknown as MemoryDocStorage), kind: "tauri" as const, windows: desktop() };
    const session = new DocumentSession(backend, { target: null, locks: null });
    const confirmReplace = vi.fn(async () => false);
    const openFile = vi.fn();
    session.attach({ restore: vi.fn(), openFile, confirmReplace });
    expect(await session.openRecent({ name: "b.xlsx", path: "/b.xlsx", blobId: null, openedAt: 1 })).toBe(false);
    expect(confirmReplace).not.toHaveBeenCalled();
    expect(openRecent).toHaveBeenCalledOnce();
    expect(openFile).not.toHaveBeenCalled();
    session.stop();
  });
});

describe("macOS window titles", () => {
  it("show the document's name, with Edited while it has unsaved changes", () => {
    expect(macWindowTitle("Book 1.xlsx – Rusuite Calc", "Edited")).toBe("Book 1.xlsx");
    expect(macWindowTitle("Book 1.xlsx • – Rusuite Calc", "Edited")).toBe("Book 1.xlsx — Edited");
    expect(macWindowTitle("• Letter.docx – Rusuite Write", "Bearbeitet")).toBe("Letter.docx — Bearbeitet");
    expect(macWindowTitle("Deck.pptx • – Server – Rusuite Show", "Edited")).toBe("Deck.pptx – Server — Edited");
    expect(macWindowTitle("Something else", "Edited")).toBe("Something else");
  });
});
