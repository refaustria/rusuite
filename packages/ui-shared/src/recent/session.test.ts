import { afterEach, describe, expect, it, vi } from "vitest";
import { DocumentSession } from "./session";
import { MemoryDocStorage } from "./storage";
import { FakeCore, fakeBackend } from "./testing";

function setup(opts: { storage?: MemoryDocStorage; docId?: string } = {}) {
  const storage = opts.storage ?? new MemoryDocStorage(() => 1);
  const core = new FakeCore();
  const backend = fakeBackend(core, storage);
  let t = 1000;
  const target = new EventTarget();
  const session = new DocumentSession(backend, {
    docId: opts.docId ?? "doc-a",
    now: () => ++t,
    target: target as unknown as Window,
    locks: null,
  });
  const restore = vi.fn(async (json: string, name: string | null) => {
    const r = await session.backend.dispatch({ type: "restoreRecovery", json, name });
    return "ok" in r;
  });
  const openFile = vi.fn(async (file: { name: string; bytesBase64: string }) => {
    await session.backend.dispatch({ type: "openXlsx", name: file.name, bytesBase64: file.bytesBase64 });
  });
  const onError = vi.fn();
  session.attach({ restore, openFile, onError });
  const edit = (text = "x") => session.backend.dispatch({ type: "apply", text });
  return { storage, core, session, target, restore, openFile, onError, edit };
}

afterEach(() => vi.useRealTimers());

describe("DocumentSession autosave", () => {
  it("stores a snapshot only while dirty and changed, and clears it on save", async () => {
    const { session, storage, edit, core } = setup();
    expect(await session.autosave()).toBe(false); // clean: nothing to do
    await edit("a");
    expect(await session.autosave()).toBe(true);
    const stored = storage.recovery.get("doc-a")!;
    expect(stored).toMatchObject({ id: "doc-a", name: null, revision: 1, json: '{"text":"a"}' });
    const snapshots = core.requests.filter((r) => r === "recoverySnapshot").length;
    expect(await session.autosave()).toBe(false); // unchanged: no new snapshot request
    expect(core.requests.filter((r) => r === "recoverySnapshot").length).toBe(snapshots);
    await edit("b");
    expect(await session.autosave()).toBe(true);
    expect(storage.recovery.get("doc-a")!.revision).toBe(2);
    expect(session.getState().lastAutosave).not.toBeNull();
    // Save: markSaved removes the entry.
    await session.backend.dispatch({ type: "saveXlsx" });
    await session.backend.dispatch({ type: "markSaved" });
    await session.idle();
    expect(storage.recovery.size).toBe(0);
    // The saved file is on the recent list with its snapshot (web).
    expect(session.getState().recent.map((r) => r.name)).toEqual(["Untitled.xlsx"]);
    expect(await storage.openRecent(session.getState().recent[0]!)).toEqual({ snapshot: '{"text":"ab"}' });
  });

  it("autosaves every interval and when the page is hidden", async () => {
    vi.useFakeTimers();
    const { session, storage, edit, target } = setup();
    await session.start();
    await edit();
    await vi.advanceTimersByTimeAsync(29_000);
    expect(storage.recovery.size).toBe(0);
    await vi.advanceTimersByTimeAsync(1_000);
    await session.idle();
    expect(storage.recovery.size).toBe(1);
    await edit();
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    target.dispatchEvent(new Event("visibilitychange"));
    await session.idle();
    expect(storage.recovery.get("doc-a")!.revision).toBe(2);
    // A dirty close keeps the entry; stop() keeps it too.
    target.dispatchEvent(new Event("pagehide"));
    session.stop();
    await session.idle();
    expect(storage.recovery.size).toBe(1);
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  });

  it("a clean close or a replaced document removes the entry", async () => {
    const { session, storage, edit, target, core } = setup();
    await session.start();
    await edit();
    await session.autosave();
    expect(storage.recovery.size).toBe(1);
    await session.backend.dispatch({ type: "newDocument" });
    await session.idle();
    expect(storage.recovery.size).toBe(0);
    await edit();
    await session.autosave();
    // The core says clean (e.g. undone to the saved state): entry removed.
    core.dirty = false;
    await session.backend.dispatch({ type: "documentState" }).catch(() => undefined);
    core.revision++;
    expect(await session.autosave(true)).toBe(false);
    expect(storage.recovery.size).toBe(0);
    await edit();
    await session.autosave();
    await session.backend.dispatch({ type: "markSaved" });
    target.dispatchEvent(new Event("pagehide"));
    await session.idle();
    expect(storage.recovery.size).toBe(0);
    session.stop();
  });

  it("does nothing without storage", async () => {
    const backend = fakeBackend(new FakeCore(), null);
    const session = new DocumentSession(backend, { target: null, locks: null });
    await backend.dispatch({ type: "apply" });
    expect(await session.autosave(true)).toBe(false);
    await session.start();
    expect(session.getState()).toMatchObject({ recent: [], recoveries: [] });
    session.stop();
  });
});

describe("DocumentSession recovery", () => {
  it("lists earlier sessions' entries and restores one as dirty", async () => {
    const storage = new MemoryDocStorage(() => 1);
    // An earlier session crashed with unsaved changes.
    const crashed = setup({ storage, docId: "doc-old" });
    await crashed.session.backend.dispatch({ type: "openXlsx", name: "book.xlsx", bytesBase64: "base" });
    await crashed.edit("+edit");
    await crashed.session.autosave();
    await crashed.session.idle();

    const { session, core, restore } = setup({ storage, docId: "doc-new" });
    await session.start();
    expect(session.getState().recoveries).toEqual([
      { id: "doc-old", name: "book.xlsx", savedAt: expect.any(Number), revision: 2 },
    ]);
    expect(await session.restore("doc-old")).toBe(true);
    expect(restore).toHaveBeenCalledWith('{"text":"base+edit"}', "book.xlsx");
    await session.idle();
    expect(core).toMatchObject({ text: "base+edit", dirty: true, name: "book.xlsx" });
    // The restored document is now autosaved under this session's id.
    expect([...storage.recovery.keys()]).toEqual(["doc-new"]);
    expect(session.getState().recoveries).toEqual([]);
    session.stop();
  });

  it("discards entries, keeps them when a restore fails", async () => {
    const storage = new MemoryDocStorage(() => 1);
    await storage.putRecovery({ id: "bad", name: null, savedAt: 1, revision: 1, json: "not json" });
    await storage.putRecovery({ id: "other", name: "x", savedAt: 2, revision: 1, json: '{"text":"x"}' });
    const { session, onError } = setup({ storage });
    await session.start();
    expect(session.getState().recoveries.map((r) => r.id)).toEqual(["other", "bad"]);
    expect(await session.restore("bad")).toBe(false);
    expect(storage.recovery.has("bad")).toBe(true);
    await session.discard("bad");
    expect(storage.recovery.has("bad")).toBe(false);
    expect(session.getState().recoveries.map((r) => r.id)).toEqual(["other"]);
    expect(await session.restore("missing")).toBe(false);
    expect(onError).toHaveBeenCalled();
    session.stop();
  });

  it("hides entries of sessions that are still open (Web Locks)", async () => {
    const storage = new MemoryDocStorage(() => 1);
    await storage.putRecovery({ id: "live", name: null, savedAt: 1, revision: 1, json: "{}" });
    await storage.putRecovery({ id: "dead", name: null, savedAt: 2, revision: 1, json: "{}" });
    const requested: string[] = [];
    const locks = {
      request: vi.fn(async (name: string) => {
        requested.push(name);
      }),
      query: vi.fn(async () => ({ held: [{ name: "rusuite-session-live", mode: "exclusive" as const }], pending: [] })),
    };
    const session = new DocumentSession(fakeBackend(new FakeCore(), storage), {
      docId: "me",
      target: null,
      now: () => 10,
      locks: locks as unknown as LockManager,
    });
    await session.start();
    expect(requested).toEqual(["rusuite-session-me"]);
    expect(session.getState().recoveries.map((r) => r.id)).toEqual(["dead"]);
    session.stop();
  });
});

describe("DocumentSession recent files", () => {
  it("records opens and re-opens a web entry from its snapshot", async () => {
    const { session, core, restore } = setup();
    await session.backend.dispatch({ type: "openXlsx", name: "a.xlsx", bytesBase64: "A" });
    await session.backend.dispatch({ type: "openXlsx", name: "b.xlsx", bytesBase64: "B" });
    await session.idle();
    const recent = session.getState().recent;
    expect(recent.map((r) => r.name)).toEqual(["b.xlsx", "a.xlsx"]);
    expect(await session.openRecent(recent[1]!)).toBe(true);
    expect(restore).toHaveBeenCalledWith('{"text":"A"}', "a.xlsx");
    expect(core.text).toBe("A");
  });

  it("re-opens a desktop entry from its file", async () => {
    const storage = new MemoryDocStorage();
    const fsLike = Object.assign(storage, {
      kind: "fs" as const,
      openRecent: async () => ({ file: { name: "c.xlsx", bytesBase64: "C" } }),
    });
    const { session, openFile, core } = setup({ storage: fsLike as unknown as MemoryDocStorage });
    expect(await session.openRecent({ name: "c.xlsx", path: "/c.xlsx", blobId: null, openedAt: 1 })).toBe(true);
    expect(openFile).toHaveBeenCalledWith({ name: "c.xlsx", bytesBase64: "C" });
    expect(core.name).toBe("c.xlsx");
    // `fs` storage never asks the core for a snapshot to remember a file.
    await session.idle();
    expect(core.requests).not.toContain("recoverySnapshot");
  });

  it("reports a recent entry that cannot be re-opened", async () => {
    const { session, onError } = setup();
    expect(await session.openRecent({ name: "gone", path: null, blobId: "nope", openedAt: 1 })).toBe(false);
    expect(onError).toHaveBeenCalled();
  });

  it("passes every backend member through", async () => {
    const { session } = setup();
    expect(session.backend.kind).toBe("wasm");
    expect(await session.backend.ping()).toBe("Rusuite Fake 0.1.0");
    expect(session.backend.storage).toBe(session.storage);
  });
});

describe("DocumentSession privacy (ADR 0009)", () => {
  afterEach(() => localStorage.removeItem("rusuite.keepAutosave"));

  it("with autosave copies off writes no recovery entry and keeps recent entries without content", async () => {
    const { session, storage, edit } = setup();
    await edit("a");
    expect(await session.autosave()).toBe(true);
    expect(storage.recovery.size).toBe(1);
    await session.setKeepAutosave(false);
    expect(storage.recovery.size).toBe(0);
    expect(session.getState().keepAutosave).toBe(false);
    await edit("b");
    expect(await session.autosave(true)).toBe(false);
    expect(storage.recovery.size).toBe(0);
    await session.backend.dispatch({ type: "saveXlsx" });
    await session.backend.dispatch({ type: "markSaved" });
    await session.idle();
    expect(session.getState().recent.map((r) => r.name)).toEqual(["Untitled.xlsx"]);
    expect(storage.blobs.size).toBe(0);
    await session.setKeepAutosave(true);
    await edit("c");
    expect(await session.autosave()).toBe(true);
  });

  it("clearLocalData removes recent entries, snapshots and recovery entries", async () => {
    const { session, storage, edit } = setup();
    await edit("a");
    await session.autosave();
    await session.backend.dispatch({ type: "saveXlsx" });
    await session.backend.dispatch({ type: "markSaved" });
    await edit("b");
    await session.autosave();
    await session.idle();
    expect(storage.recent.length).toBe(1);
    expect(storage.recovery.size).toBe(1);
    await session.clearLocalData();
    expect([storage.recent.length, storage.recovery.size, storage.blobs.size]).toEqual([0, 0, 0]);
    expect(session.getState().recent).toEqual([]);
  });
});
