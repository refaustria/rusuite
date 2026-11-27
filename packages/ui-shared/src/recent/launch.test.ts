// Documents from the OS in the desktop shells (P11-D1): Finder / Explorer opens, drops onto the window, a second
// start. The session takes the shell's queue on start and on its `open-document` event.

import { afterEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({
  invoke: vi.fn(),
  handlers: new Map<string, () => void>(),
  unlisten: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: tauri.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (event: string, fn: () => void) => {
    tauri.handlers.set(event, fn);
    return tauri.unlisten;
  }),
}));

import { DocumentSession } from "./session";
import { MemoryDocStorage } from "./storage";
import { FakeCore, fakeBackend } from "./testing";
import { OPEN_DOCUMENT_EVENT, tauriLaunchDocuments, type LaunchDocuments, type TakenDocuments } from "./launch";
import { setLocale } from "../i18n/locale";

/** A shell queue: `pending` = an openable document waits; `take(open)` hands everything out once. */
function fakeShell() {
  const queue: TakenDocuments[] = [];
  let notify: (() => void) | null = null;
  const docs: LaunchDocuments = {
    pending: vi.fn(async () => queue.some((q) => q.file !== null)),
    take: vi.fn(async (open: boolean) => {
      const all = queue.splice(0);
      const files = all.flatMap((q) => (q.file ? [q.file] : []));
      return {
        file: open ? (files[0] ?? null) : null,
        notOpened: open ? files.slice(1).map((f) => f.name) : [],
        unsupported: all.flatMap((q) => q.unsupported),
      };
    }),
    subscribe: vi.fn((fn: () => void) => {
      notify = fn;
      return () => (notify = null);
    }),
  };
  const arrive = (d: Partial<TakenDocuments>) => {
    queue.push({ file: null, notOpened: [], unsupported: [], ...d });
    notify?.();
  };
  return { docs, arrive, subscribed: () => notify !== null };
}

function setup(confirm = true) {
  const shell = fakeShell();
  const backend = Object.assign(fakeBackend(new FakeCore(), new MemoryDocStorage(() => 1)), { launchDocuments: shell.docs });
  const session = new DocumentSession(backend, { docId: "doc-d", target: null, locks: null });
  const openFile = vi.fn(async () => true);
  const onError = vi.fn();
  const confirmReplace = vi.fn(async () => confirm);
  session.attach({ restore: async () => true, openFile, onError, confirmReplace });
  return { ...shell, session, openFile, onError, confirmReplace };
}

const book = { name: "Book.xlsx", bytesBase64: "UEs=" };

afterEach(() => {
  tauri.invoke.mockReset();
  tauri.handlers.clear();
  tauri.unlisten.mockReset();
});

describe("desktop launch documents", () => {
  it("opens the document the app was started with (cold start)", async () => {
    const { session, arrive, openFile, confirmReplace } = setup();
    arrive({ file: book });
    await session.start();
    expect(confirmReplace).toHaveBeenCalledTimes(1);
    expect(openFile).toHaveBeenCalledWith(book);
    session.stop();
  });

  it("opens documents that arrive while the app runs, after the unsaved-changes question", async () => {
    const { session, arrive, openFile, confirmReplace, docs } = setup();
    await session.start();
    expect(confirmReplace).not.toHaveBeenCalled(); // nothing waited: no question
    arrive({ file: book });
    await vi.waitFor(() => expect(openFile).toHaveBeenCalledWith(book));
    expect(docs.take).toHaveBeenLastCalledWith(true);
    session.stop();
  });

  it("keeps the open document when the user cancels", async () => {
    const { session, arrive, openFile, docs } = setup(false);
    await session.start();
    arrive({ file: book });
    await vi.waitFor(() => expect(docs.take).toHaveBeenLastCalledWith(false));
    expect(openFile).not.toHaveBeenCalled();
    session.stop();
  });

  it("names unsupported files and further documents without asking", async () => {
    setLocale("en");
    const { session, arrive, openFile, onError, confirmReplace } = setup();
    await session.start();
    arrive({ unsupported: ["photo.bmp"] });
    await vi.waitFor(() => expect(onError).toHaveBeenCalled());
    expect(confirmReplace).not.toHaveBeenCalled();
    expect(openFile).not.toHaveBeenCalled();
    expect(String(onError.mock.calls[0]![0])).toContain("photo.bmp");
    arrive({ file: book });
    arrive({ file: { name: "Second.xlsx", bytesBase64: "UEs=" } });
    await vi.waitFor(() => expect(openFile).toHaveBeenCalledWith(book));
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(2));
    expect(String(onError.mock.calls[1]![0])).toMatch(/Second\.xlsx.*Recent/);
    session.stop();
  });

  it("asks one question at a time and stops listening on stop", async () => {
    const { session, arrive, confirmReplace, subscribed } = setup();
    let answer: (ok: boolean) => void = () => undefined;
    confirmReplace.mockImplementation(() => new Promise<boolean>((r) => (answer = r)));
    await session.start();
    arrive({ file: book });
    arrive({ file: { name: "B.xlsx", bytesBase64: "UEs=" } });
    await vi.waitFor(() => expect(confirmReplace).toHaveBeenCalledTimes(1));
    answer(true);
    await session.openLaunchDocument();
    expect(confirmReplace).toHaveBeenCalledTimes(1); // the first take had both
    session.stop();
    expect(subscribed()).toBe(false);
  });
});

describe("tauriLaunchDocuments", () => {
  it("calls the shell's commands and listens to its event", async () => {
    const docs = tauriLaunchDocuments();
    tauri.invoke.mockResolvedValueOnce(true);
    expect(await docs.pending()).toBe(true);
    expect(tauri.invoke).toHaveBeenLastCalledWith("launch_pending");
    tauri.invoke.mockResolvedValueOnce({ file: { path: "/d/Book.xlsx", ...book }, notOpened: [], unsupported: ["x.bmp"] });
    expect(await docs.take(true)).toEqual({ file: book, notOpened: [], unsupported: ["x.bmp"] });
    expect(tauri.invoke).toHaveBeenLastCalledWith("take_launch_documents", { open: true });
    const fn = vi.fn();
    const stop = docs.subscribe(fn);
    await vi.waitFor(() => expect(tauri.handlers.has(OPEN_DOCUMENT_EVENT)).toBe(true));
    tauri.handlers.get(OPEN_DOCUMENT_EVENT)!();
    expect(fn).toHaveBeenCalledTimes(1);
    stop();
    expect(tauri.unlisten).toHaveBeenCalled();
  });
});
