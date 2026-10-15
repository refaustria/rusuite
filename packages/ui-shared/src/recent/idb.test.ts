import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { IdbDocStorage, dbNameFromPing } from "./idb";
import { RECENT_LIMIT, pushRecent, type RecentEntry, type RecoveryEntry } from "./storage";

function storage(factory = new IDBFactory(), name = "rusuite-test", now = () => 1000) {
  return { s: new IdbDocStorage(name, () => factory, now), factory };
}

const entry = (id: string, savedAt: number): RecoveryEntry => ({ id, name: `${id}.xlsx`, savedAt, revision: 3, json: `{"id":"${id}"}` });

describe("dbNameFromPing", () => {
  it("names one database per app", () => {
    expect(dbNameFromPing("Rusuite Calc 0.1.0")).toBe("rusuite-calc");
    expect(dbNameFromPing("Rusuite Show 0.1.0")).toBe("rusuite-show");
    expect(dbNameFromPing("pong")).toBe("rusuite-app");
  });
});

describe("pushRecent", () => {
  it("dedupes by path/name, caps and reports removed blobs", () => {
    let list: RecentEntry[] = Array.from({ length: RECENT_LIMIT }, (_, i) => ({ name: `f${i}`, path: `/f${i}`, blobId: null, openedAt: i }));
    const r = pushRecent(list, { name: "new", path: "/new", blobId: null, openedAt: 99 });
    expect(r.list).toHaveLength(RECENT_LIMIT);
    expect(r.list[0]!.name).toBe("new");
    expect(r.removed.map((e) => e.name)).toEqual(["f9"]);
    list = r.list;
    const again = pushRecent(list, { name: "f3", path: "/f3", blobId: null, openedAt: 100 });
    expect(again.list.filter((e) => e.path === "/f3")).toHaveLength(1);
    expect(again.removed).toEqual([{ name: "f3", path: "/f3", blobId: null, openedAt: 3 }]);
  });
});

describe("IdbDocStorage", () => {
  it("stores, lists, reads and removes recovery entries", async () => {
    const { s, factory } = storage();
    expect(await s.listRecovery()).toEqual([]);
    await s.putRecovery(entry("old", 1));
    await s.putRecovery(entry("new", 2));
    await s.putRecovery({ ...entry("old", 3), revision: 9 });
    const list = await s.listRecovery();
    expect(list).toEqual([
      { id: "old", name: "old.xlsx", savedAt: 3, revision: 9 },
      { id: "new", name: "new.xlsx", savedAt: 2, revision: 3 },
    ]);
    expect((await s.getRecovery("new"))?.json).toBe('{"id":"new"}');
    expect(await s.getRecovery("missing")).toBeNull();
    await s.removeRecovery("old");
    await s.removeRecovery("old");
    await expect(s.putRecovery(entry("../x", 1))).rejects.toThrow(/invalid document id/);
    await s.close();
    // Persisted: a new connection (page reload) sees the same data.
    const reopened = new IdbDocStorage("rusuite-test", () => factory);
    expect((await reopened.listRecovery()).map((e) => e.id)).toEqual(["new"]);
    // Databases are per app.
    const other = new IdbDocStorage("rusuite-other", () => factory);
    expect(await other.listRecovery()).toEqual([]);
  });

  it("keeps a recent list with snapshot blobs", async () => {
    let t = 0;
    const { s } = storage(new IDBFactory(), "rusuite-r", () => ++t);
    const first = await s.rememberRecent("a.docx", '{"v":1}');
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ name: "a.docx", path: null, openedAt: 1 });
    await s.rememberRecent("b.docx", '{"v":2}');
    const list = await s.rememberRecent("a.docx", '{"v":3}');
    expect(list.map((e) => e.name)).toEqual(["a.docx", "b.docx"]);
    expect(list[0]!.blobId).toBe(first[0]!.blobId);
    expect(await s.openRecent(list[0]!)).toEqual({ snapshot: '{"v":3}' });
    expect(await s.listRecent()).toEqual(list);
    // A missing blob drops the entry.
    await expect(s.openRecent({ ...list[1]!, blobId: "gone" })).rejects.toThrow(/no longer stored/);
    expect((await s.listRecent()).map((e) => e.name)).toEqual(["a.docx"]);
  });

  it("deletes the blobs of entries trimmed off the list", async () => {
    const { s } = storage();
    const firstList = await s.rememberRecent("f0", "{}");
    for (let i = 1; i <= RECENT_LIMIT; i++) await s.rememberRecent(`f${i}`, `{"i":${i}}`);
    const list = await s.listRecent();
    expect(list).toHaveLength(RECENT_LIMIT);
    expect(list.some((e) => e.name === "f0")).toBe(false);
    await expect(s.openRecent(firstList[0]!)).rejects.toThrow();
  });
});
