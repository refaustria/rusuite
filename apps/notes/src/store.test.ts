import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { splitRecords, type PersistEffect } from "./effects";
import { IdbNotesStore, MemoryNotesStore, type NotesStore } from "./store";

const b = (...n: number[]) => Uint8Array.from(n);

const stores: [string, () => NotesStore][] = [
  ["IndexedDB", () => new IdbNotesStore(() => new IDBFactory(), "rusuite-notes-test", IDBKeyRange)],
  ["memory", () => new MemoryNotesStore()],
];

describe.each(stores)("%s store", (_name, make) => {
  it("appends records after the snapshot, replaces and deletes docs", async () => {
    const s = make();
    const effects: PersistEffect[] = [
      { kind: "append", notebook: "nb-1", doc: "nb-1", bytes: b(1) },
      { kind: "append", notebook: "nb-1", doc: "nb-1", bytes: b(2, 2) },
      { kind: "replace", notebook: "nb-1", doc: "pg-a", bytes: b(9, 9, 9) },
      { kind: "append", notebook: "nb-1", doc: "pg-a", bytes: b(3) },
      { kind: "append", notebook: "nb-2", doc: "nb-2", bytes: b(4) },
    ];
    await s.apply(effects);
    const docs = await s.loadNotebook("nb-1");
    expect(docs.map((d) => d.doc).sort()).toEqual(["nb-1", "pg-a"]);
    const nb = docs.find((d) => d.doc === "nb-1")!;
    expect(nb.snapshot.length).toBe(0);
    expect(splitRecords(nb.log)).toEqual([b(1), b(2, 2)]);
    const pg = docs.find((d) => d.doc === "pg-a")!;
    expect(pg.snapshot).toEqual(b(9, 9, 9));
    expect(splitRecords(pg.log)).toEqual([b(3)]);

    // A replace empties the log; a delete removes the doc.
    await s.apply([
      { kind: "replace", notebook: "nb-1", doc: "nb-1", bytes: b(7) },
      { kind: "delete", notebook: "nb-1", doc: "pg-a" },
    ]);
    const again = await s.loadNotebook("nb-1");
    expect(again).toEqual([{ doc: "nb-1", snapshot: b(7), log: new Uint8Array(), records: 0 }]);
    expect((await s.loadNotebook("nb-2")).length).toBe(1);
  });

  it("keeps appending in order after a reload of the notebook", async () => {
    const s = make();
    await s.apply([{ kind: "append", notebook: "n", doc: "d", bytes: b(1) }]);
    await s.loadNotebook("n");
    await s.apply([{ kind: "append", notebook: "n", doc: "d", bytes: b(2) }]);
    const [d] = await s.loadNotebook("n");
    expect(splitRecords(d!.log)).toEqual([b(1), b(2)]);
  });

  it("stores blobs, meta, and forgets everything on clearAll / deleteNotebook", async () => {
    const s = make();
    await s.apply([
      { kind: "blob", notebook: "n", doc: "a".repeat(64), bytes: b(5) },
      { kind: "append", notebook: "n", doc: "n", bytes: b(1) },
      { kind: "append", notebook: "m", doc: "m", bytes: b(1) },
    ]);
    expect(await s.blobs("n")).toEqual([b(5)]);
    await s.setMeta("notebooks", [{ id: "n" }]);
    expect(await s.getMeta("notebooks")).toEqual([{ id: "n" }]);
    await s.deleteNotebook("n");
    expect(await s.loadNotebook("n")).toEqual([]);
    expect(await s.blobs("n")).toEqual([]);
    expect((await s.loadNotebook("m")).length).toBe(1);
    await s.clearAll();
    expect(await s.loadNotebook("m")).toEqual([]);
    expect(await s.getMeta("notebooks")).toBeUndefined();
  });
});
