import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";
import { DocumentSession } from "../recent/session";
import { FakeCore, fakeBackend } from "../recent/testing";
import { bytesToBase64 } from "../base64";
import { Connectors, type ConnectionDraft, type ConnectorPlatform } from "./controller";
import { MemoryProvider } from "./fake";
import { ConnectorError } from "./provider";
import { IdbConnectionStore, MemoryConnectionStore, parseData } from "./store";
import { TauriConnectionStore, TauriProvider } from "./tauri";

const draft = (over: Partial<ConnectionDraft> = {}): ConnectionDraft => ({
  name: "Nextcloud",
  baseUrl: "https://cloud.example.com/dav/",
  auth: { kind: "basic", username: "alice", password: "pw" },
  rootPath: "",
  allowHttp: false,
  rememberPassword: false,
  ...over,
});

function setup(extensions = [".xlsx"]) {
  const fs = new MemoryProvider();
  const store = new MemoryConnectionStore();
  const targets: unknown[] = [];
  const platform: ConnectorPlatform = {
    kind: "web",
    store,
    extensions,
    provider: (t) => {
      targets.push(t);
      return fs;
    },
  };
  return { fs, store, targets, c: new Connectors(platform) };
}

describe("Connectors: connection records", () => {
  it("stores records without the password unless remembered", async () => {
    const { c, store } = setup();
    const conn = await c.saveConnection(draft());
    expect(conn).toMatchObject({ name: "Nextcloud", baseUrl: "https://cloud.example.com/dav", rootPath: "/", kind: "webdav" });
    expect(conn.id).toMatch(/^c-[A-Za-z0-9_-]+$/);
    expect(JSON.stringify(store.data)).not.toContain("pw");
    expect(store.secrets.size).toBe(0);
    await c.saveConnection(draft({ rememberPassword: true }), conn.id);
    expect(store.secrets.get(conn.id)).toBe("pw");
    expect(JSON.stringify(store.data)).not.toContain('"pw"');
    await c.saveConnection(draft({ rememberPassword: false, auth: { kind: "basic", username: "alice", password: "" } }), conn.id);
    expect(store.secrets.size).toBe(0);
    expect(c.getState().connections).toHaveLength(1);
  });

  it("asks for the password once per page when it is not remembered", async () => {
    const { c, targets } = setup();
    const conn = await c.saveConnection(draft());
    // A new page: same records, no secrets in memory.
    const fresh = new Connectors({ ...c.platform });
    await fresh.load();
    const listing = fresh.list(conn.id, "/");
    await vi.waitFor(() => expect(fresh.getState().prompt?.kind).toBe("password"));
    fresh.answer({ secret: "typed", remember: false });
    await listing;
    await fresh.list(conn.id, "/");
    expect(targets.slice(-2)).toEqual([
      { baseUrl: "https://cloud.example.com/dav", rootPath: "/", auth: { kind: "basic", username: "alice", password: "typed" }, allowHttp: false },
      { baseUrl: "https://cloud.example.com/dav", rootPath: "/", auth: { kind: "basic", username: "alice", password: "typed" }, allowHttp: false },
    ]);
  });

  it("cancelling the password prompt rejects with cancelled; a rejected password is asked again", async () => {
    const { c, fs } = setup();
    const conn = await c.saveConnection(draft());
    const fresh = new Connectors({ ...c.platform });
    await fresh.load();
    const p = fresh.list(conn.id, "/");
    await vi.waitFor(() => expect(fresh.getState().prompt).not.toBeNull());
    fresh.answer(null);
    await expect(p).rejects.toMatchObject({ kind: "cancelled" });
    fs.failWith = new ConnectorError("auth", "401", 401);
    await expect(c.list(conn.id, "/")).rejects.toMatchObject({ kind: "auth" });
    fs.failWith = null;
    const again = c.list(conn.id, "/");
    await vi.waitFor(() => expect(c.getState().prompt?.kind).toBe("password"));
    c.answer({ secret: "right", remember: false });
    await again;
  });

  it("forget all removes records, secrets and recent files", async () => {
    const { c, store } = setup();
    const conn = await c.saveConnection(draft({ rememberPassword: true }));
    await c.rememberRecent({ connectionId: conn.id, path: "/a.xlsx" }, "a.xlsx", 5);
    expect(c.getState().recent).toHaveLength(1);
    await c.forgetAll();
    expect(store.data).toEqual({ version: 1, connections: [], recent: [] });
    expect(store.secrets.size).toBe(0);
    expect(c.getState()).toMatchObject({ connections: [], recent: [], location: null });
  });

  it("shows only this app's recent files, newest first, deduplicated", async () => {
    const { c } = setup([".docx"]);
    const conn = await c.saveConnection(draft());
    await c.rememberRecent({ connectionId: conn.id, path: "/a.docx" }, "a.docx", 1);
    await c.rememberRecent({ connectionId: conn.id, path: "/b.xlsx" }, "b.xlsx", 2);
    await c.rememberRecent({ connectionId: conn.id, path: "/a.docx" }, "a.docx", 3);
    expect(c.getState().recent.map((r) => [r.path, r.openedAt])).toEqual([["/a.docx", 3]]);
    await c.removeConnection(conn.id);
    expect(c.getState().recent).toEqual([]);
  });

  it("test() lists the root with the draft's settings; a CSP block disables the connection", async () => {
    const { c, fs } = setup();
    fs.put("/a.xlsx", "x");
    expect(await c.test(draft())).toBe(1);
    const conn = await c.saveConnection(draft());
    fs.failWith = new ConnectorError("csp", "blocked");
    await expect(c.list(conn.id, "/")).rejects.toMatchObject({ kind: "csp" });
    expect(c.getState().blocked[conn.id]).toBe("This site's security policy does not allow connections to other servers.");
    await expect(c.list(conn.id, "/")).rejects.toMatchObject({ kind: "csp" });
  });

  it("parses stored data leniently and never keeps secrets", () => {
    expect(parseData("nope")).toEqual({ version: 1, connections: [], recent: [] });
    const d = parseData({ connections: [{ id: "c1", baseUrl: "https://h", auth: { kind: "basic", username: "u", password: "pw" } }, { bad: 1 }], recent: [{ x: 1 }] });
    expect(d.connections).toHaveLength(1);
    expect(JSON.stringify(d)).not.toContain("pw");
    expect(d.recent).toEqual([]);
  });

  it("decorates the window title with the connection of a remote document", async () => {
    const { c } = setup();
    const conn = await c.saveConnection(draft());
    expect(c.decorateTitle("a.xlsx – Rusuite Calc")).toBe("a.xlsx – Rusuite Calc");
    c.bind({ connectionId: conn.id, path: "/a.xlsx", etag: '"1"' });
    expect(c.decorateTitle("a.xlsx • – Rusuite Calc")).toBe("a.xlsx • – Nextcloud – Rusuite Calc");
    expect(c.decorateTitle("a.xlsx")).toBe("a.xlsx – Nextcloud");
  });
});

/** A session over a fake core whose backend saves through the connectors, as the real backends do. */
function sessionSetup() {
  const env = setup();
  const core = new FakeCore();
  const base = fakeBackend(core);
  const local = vi.fn(async () => ({ name: "local.xlsx", path: "/home/local.xlsx" }));
  const backend = {
    ...base,
    connectors: env.c,
    saveFile: async (name: string, b64: string, o?: { saveAs?: boolean }) => {
      const r = await env.c.trySave(name, b64, o);
      if (r !== undefined) return r;
      env.c.localSaved();
      return local();
    },
  };
  let now = 1000;
  const session = new DocumentSession(backend, { docId: "doc", now: () => ++now, target: null, locks: null });
  const openFile = vi.fn(async (file: { name: string; bytesBase64: string }) => {
    await session.backend.dispatch({ type: "openXlsx", name: file.name, bytesBase64: file.bytesBase64 });
  });
  /** The app's save flow (as Calc's store.saveFile). */
  const save = async (asName?: string) => {
    const r = await session.backend.saveFile(asName ?? "Untitled.xlsx", "UEs=", { saveAs: asName !== undefined });
    if (!r) return false;
    await session.backend.dispatch({ type: "markSaved", name: typeof r === "object" ? r.name : asName });
    return true;
  };
  const confirmReplace = vi.fn(async () => true);
  session.attach({ restore: async () => true, openFile, confirmReplace, saveAs: (n) => save(n) });
  return { ...env, core, session, openFile, save, local, confirmReplace };
}

describe("DocumentSession with connections", () => {
  it("opens a remote file, binds it, puts it on the recent list and saves back with If-Match", async () => {
    const { c, fs, session, openFile, save, confirmReplace } = sessionSetup();
    const conn = await c.saveConnection(draft());
    const tag = fs.put("/Docs/Budget.xlsx", "PK");
    expect(await session.openRemote(conn.id, "/Docs/Budget.xlsx")).toBe(true);
    expect(confirmReplace).toHaveBeenCalled();
    expect(openFile).toHaveBeenCalledWith({ name: "Budget.xlsx", bytesBase64: bytesToBase64(new TextEncoder().encode("PK")) });
    expect(c.getState().location).toEqual({ connectionId: conn.id, path: "/Docs/Budget.xlsx", etag: tag });
    await vi.waitFor(() => expect(session.getState().recent.map((r) => r.remote?.path)).toEqual(["/Docs/Budget.xlsx"]));
    expect(await save()).toBe(true);
    expect(fs.calls.at(-1)).toBe("write /Docs/Budget.xlsx");
    expect(c.getState().location?.etag).not.toBe(tag);
  });

  it("a conflicting save offers overwrite / copy / reload", async () => {
    const { c, fs, session, save, openFile } = sessionSetup();
    const conn = await c.saveConnection(draft());
    fs.put("/a.xlsx", "v1");
    await session.openRemote(conn.id, "/a.xlsx");
    const theirs = fs.put("/a.xlsx", "theirs");

    let saving = save();
    await vi.waitFor(() => expect(c.getState().prompt).toMatchObject({ kind: "conflict", name: "a.xlsx", connection: "Nextcloud" }));
    c.answer("copy");
    expect(await saving).toBe(true);
    expect(c.getState().location?.path).toBe("/a (copy).xlsx");
    expect(new TextDecoder().decode((await fs.read("/a.xlsx")).bytes)).toBe("theirs");

    c.bind({ connectionId: conn.id, path: "/a.xlsx", etag: '"stale"' });
    saving = save();
    await vi.waitFor(() => expect(c.getState().prompt).not.toBeNull());
    c.answer("overwrite");
    expect(await saving).toBe(true);
    expect(fs.nodes.get("/a.xlsx")!.etag).not.toBe(theirs);

    c.bind({ connectionId: conn.id, path: "/a.xlsx", etag: '"stale"' });
    openFile.mockClear();
    saving = save();
    await vi.waitFor(() => expect(c.getState().prompt).not.toBeNull());
    c.answer("reload");
    expect(await saving).toBe(false);
    await vi.waitFor(() => expect(openFile).toHaveBeenCalledWith(expect.objectContaining({ name: "a.xlsx" })));
    expect(c.getState().location?.etag).toBe(fs.nodes.get("/a.xlsx")!.etag);

    c.bind({ connectionId: conn.id, path: "/a.xlsx", etag: '"stale"' });
    saving = save();
    await vi.waitFor(() => expect(c.getState().prompt).not.toBeNull());
    c.answer("cancel");
    expect(await saving).toBe(false);
  });

  it("Save As to a connection writes there and binds; a local Save As unbinds", async () => {
    const { c, fs, session, local } = sessionSetup();
    const conn = await c.saveConnection(draft());
    await fs.mkdir("/Reports");
    expect(await session.saveRemote(conn.id, "/Reports/Q3.xlsx")).toBe(true);
    expect(fs.nodes.has("/Reports/Q3.xlsx")).toBe(true);
    expect(c.getState().location?.path).toBe("/Reports/Q3.xlsx");
    expect(session.canSaveRemote()).toBe(true);
    await session.backend.saveFile("x.xlsx", "UEs=", { saveAs: true });
    expect(local).toHaveBeenCalled();
    expect(c.getState().location).toBeNull();
  });

  it("an offline save keeps the document and shows a notice; recent remote entries re-open", async () => {
    const { c, fs, session, save, openFile } = sessionSetup();
    const conn = await c.saveConnection(draft());
    fs.put("/a.xlsx", "v1");
    await session.openRemote(conn.id, "/a.xlsx");
    fs.failWith = new ConnectorError("network", "offline");
    expect(await save()).toBe(false);
    expect(c.getState().notice).toMatchObject({ tone: "error" });
    expect(c.getState().notice!.text).toContain("Your changes are still here");
    fs.failWith = null;
    await session.backend.dispatch({ type: "newDocument" });
    expect(c.getState().location).toBeNull();
    openFile.mockClear();
    await vi.waitFor(() => expect(session.getState().recent[0]?.remote).toBeTruthy());
    expect(await session.openRecent(session.getState().recent[0]!)).toBe(true);
    expect(openFile).toHaveBeenCalledOnce();
    await session.clearLocalData();
    expect(c.getState().recent).toEqual([]);
  });
});

describe("connection stores", () => {
  it("IndexedDB: records and secrets in separate stores, clear empties both", async () => {
    const factory = new IDBFactory();
    const s = new IdbConnectionStore("rusuite-connections-test", () => factory);
    await s.save({ version: 1, connections: [{ id: "c1", kind: "webdav", name: "N", baseUrl: "https://h", auth: { kind: "basic", username: "u", password: "pw" }, rootPath: "/", allowHttp: false, rememberPassword: true }], recent: [] });
    await s.setSecret("c1", "pw");
    const back = await s.load();
    expect(back.connections[0]!.auth).toEqual({ kind: "basic", username: "u", password: "" });
    expect(await s.getSecret("c1")).toBe("pw");
    await s.clear();
    expect(await s.load()).toEqual({ version: 1, connections: [], recent: [] });
    expect(await s.getSecret("c1")).toBeNull();
    await s.close();
  });

  it("desktop: the Tauri commands get the target, base64 and the records as JSON", async () => {
    const calls: [string, Record<string, unknown> | undefined][] = [];
    const inv = (async (cmd: string, args?: Record<string, unknown>) => {
      calls.push([cmd, args]);
      if (cmd === "connector_read") return { bytesBase64: "UEs=", etag: '"7"' };
      if (cmd === "connector_write") throw { kind: "conflict", status: 412, message: "PUT failed: HTTP 412" };
      if (cmd === "connector_store_load") return JSON.stringify({ version: 1, connections: [], recent: [] });
      return null;
    }) as <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
    const target = { baseUrl: "https://h", rootPath: "/", auth: { kind: "none" as const }, allowHttp: false };
    const p = new TauriProvider(target, inv);
    expect(await p.read("/a.xlsx")).toEqual({ bytes: new Uint8Array([80, 75]), etag: '"7"' });
    await expect(p.write("/a.xlsx", new Uint8Array([1]), { ifMatch: '"7"' })).rejects.toMatchObject({ kind: "conflict", status: 412 });
    expect(calls[1]).toEqual(["connector_write", { target, path: "/a.xlsx", bytesBase64: "AQ==", ifMatch: '"7"', ifNoneMatch: false }]);
    const store = new TauriConnectionStore(inv);
    expect(await store.load()).toEqual({ version: 1, connections: [], recent: [] });
    await store.clear();
    expect(calls.at(-1)).toEqual(["connector_store_save", { json: "null" }]);
  });
});
