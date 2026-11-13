// Browser storage of notebooks (docs/notes-format.md §2, web): IndexedDB database `rusuite-notes` with
//   docs  – key [notebook, doc, 0] = the document's snapshot, [notebook, doc, seq ≥ 1] = one log record each
//   blobs – key [notebook, sha256] = the blob's bytes
//   meta  – string key → JSON value (known notebooks, recent list, settings)
// The same units as a notebook folder; `loadNotebook` hands them to the core in the `.log` framing.

import { frameRecords, type PersistEffect } from "./effects";

export const DB_NAME = "rusuite-notes";
const VERSION = 1;

/** One stored document as the core's `load_doc` takes it. */
export interface StoredDoc {
  doc: string;
  snapshot: Uint8Array;
  /** Log records in `.log` framing (`len:u32` + bytes each). */
  log: Uint8Array;
  records: number;
}

export interface NotesStore {
  /** Applies persist effects atomically (one transaction). */
  apply(effects: readonly PersistEffect[]): Promise<void>;
  /** All documents of a notebook (empty when nothing is stored). */
  loadNotebook(notebook: string): Promise<StoredDoc[]>;
  /** All blobs of a notebook. */
  blobs(notebook: string): Promise<Uint8Array[]>;
  /** Removes a notebook's documents and blobs. */
  deleteNotebook(notebook: string): Promise<void>;
  getMeta<T>(key: string): Promise<T | undefined>;
  setMeta(key: string, value: unknown): Promise<void>;
  /** Everything this app stored in the browser (ADR 0009 rule 4). */
  clearAll(): Promise<void>;
}

function promised<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
  });
}

/** Key range of one document (`[nb, doc, *]`) or of a whole notebook (`[nb, *]`). Arrays sort after numbers and strings. */
const docRange = (K: typeof IDBKeyRange, nb: string, doc: string) => K.bound([nb, doc, 0], [nb, doc, []]);
const nbRange = (K: typeof IDBKeyRange, nb: string) => K.bound([nb], [nb, []]);

const asBytes = (v: unknown): Uint8Array => (v instanceof Uint8Array ? v : new Uint8Array(v as ArrayBuffer));

/** Groups `[nb, doc, seq] → bytes` rows into stored documents (rows arrive sorted by key). */
export function groupDocs(rows: readonly { key: [string, string, number]; value: Uint8Array }[]): StoredDoc[] {
  const byDoc = new Map<string, { snapshot: Uint8Array; records: Uint8Array[] }>();
  for (const { key, value } of rows) {
    const [, doc, seq] = key;
    let d = byDoc.get(doc);
    if (!d) byDoc.set(doc, (d = { snapshot: new Uint8Array(), records: [] }));
    if (seq === 0) d.snapshot = value;
    else d.records.push(value);
  }
  return [...byDoc].map(([doc, d]) => ({ doc, snapshot: d.snapshot, log: frameRecords(d.records), records: d.records.length }));
}

export class IdbNotesStore implements NotesStore {
  private db: Promise<IDBDatabase> | null = null;
  /** Next log sequence number per `nb\0doc` (filled by `loadNotebook`). */
  private seq = new Map<string, number>();

  constructor(
    private readonly factory: () => IDBFactory = () => indexedDB,
    private readonly name = DB_NAME,
    private readonly K: typeof IDBKeyRange = globalThis.IDBKeyRange,
  ) {}

  static available(): boolean {
    return typeof indexedDB !== "undefined";
  }

  private open(): Promise<IDBDatabase> {
    if (!this.db) {
      const req = this.factory().open(this.name, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of ["docs", "blobs", "meta"]) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
      };
      this.db = promised(req).then((db) => {
        // Another tab deleting the database (Remove local data) must not be blocked by us.
        db.onversionchange = () => {
          db.close();
          this.db = null;
        };
        return db;
      });
      this.db.catch(() => (this.db = null));
    }
    return this.db;
  }

  private nextSeq(nb: string, doc: string): number {
    const k = `${nb}\0${doc}`;
    // A document not loaded in this session (should not happen): a key far above any counter, still unique.
    const n = this.seq.get(k) ?? Date.now() * 1000;
    this.seq.set(k, n + 1);
    return n;
  }

  async apply(effects: readonly PersistEffect[]): Promise<void> {
    if (effects.length === 0) return;
    const db = await this.open();
    const tx = db.transaction(["docs", "blobs"], "readwrite");
    const docs = tx.objectStore("docs");
    const blobs = tx.objectStore("blobs");
    for (const e of effects) {
      switch (e.kind) {
        case "append":
          docs.put(e.bytes, [e.notebook, e.doc, this.nextSeq(e.notebook, e.doc)]);
          break;
        case "replace":
          docs.delete(docRange(this.K, e.notebook, e.doc));
          docs.put(e.bytes, [e.notebook, e.doc, 0]);
          this.seq.set(`${e.notebook}\0${e.doc}`, 1);
          break;
        case "delete":
          docs.delete(docRange(this.K, e.notebook, e.doc));
          this.seq.delete(`${e.notebook}\0${e.doc}`);
          break;
        case "blob":
          blobs.put(e.bytes, [e.notebook, e.doc]);
          break;
      }
    }
    await done(tx);
  }

  async loadNotebook(notebook: string): Promise<StoredDoc[]> {
    const db = await this.open();
    const tx = db.transaction("docs", "readonly");
    const store = tx.objectStore("docs");
    const range = nbRange(this.K, notebook);
    const [keys, values] = await Promise.all([promised(store.getAllKeys(range)), promised(store.getAll(range))]);
    const rows = keys.map((key, i) => ({ key: key as [string, string, number], value: asBytes(values[i]) }));
    for (const { key } of rows) {
      const k = `${key[0]}\0${key[1]}`;
      this.seq.set(k, Math.max(this.seq.get(k) ?? 1, key[2] + 1));
    }
    return groupDocs(rows);
  }

  async blobs(notebook: string): Promise<Uint8Array[]> {
    const db = await this.open();
    const values = await promised(db.transaction("blobs", "readonly").objectStore("blobs").getAll(nbRange(this.K, notebook)));
    return values.map(asBytes);
  }

  async deleteNotebook(notebook: string): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(["docs", "blobs"], "readwrite");
    tx.objectStore("docs").delete(nbRange(this.K, notebook));
    tx.objectStore("blobs").delete(nbRange(this.K, notebook));
    for (const k of [...this.seq.keys()]) if (k.startsWith(`${notebook}\0`)) this.seq.delete(k);
    await done(tx);
  }

  async getMeta<T>(key: string): Promise<T | undefined> {
    const db = await this.open();
    return (await promised(db.transaction("meta", "readonly").objectStore("meta").get(key))) as T | undefined;
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    const db = await this.open();
    const tx = db.transaction("meta", "readwrite");
    tx.objectStore("meta").put(value, key);
    await done(tx);
  }

  async clearAll(): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(["docs", "blobs", "meta"], "readwrite");
    for (const s of ["docs", "blobs", "meta"]) tx.objectStore(s).clear();
    await done(tx);
    this.seq.clear();
  }
}

/** The same semantics in memory (tests; browsers without IndexedDB keep notes for the session only). */
export class MemoryNotesStore implements NotesStore {
  readonly docs = new Map<string, { snapshot: Uint8Array; records: Uint8Array[] }>();
  readonly blobMap = new Map<string, Uint8Array>();
  readonly meta = new Map<string, unknown>();
  /** Effects applied so far (tests). */
  applied = 0;

  async apply(effects: readonly PersistEffect[]): Promise<void> {
    for (const e of effects) {
      const k = `${e.notebook}\0${e.doc}`;
      if (e.kind === "append") {
        const d = this.docs.get(k) ?? { snapshot: new Uint8Array(), records: [] };
        d.records.push(e.bytes);
        this.docs.set(k, d);
      } else if (e.kind === "replace") this.docs.set(k, { snapshot: e.bytes, records: [] });
      else if (e.kind === "delete") this.docs.delete(k);
      else this.blobMap.set(k, e.bytes);
      this.applied++;
    }
  }

  async loadNotebook(notebook: string): Promise<StoredDoc[]> {
    return [...this.docs]
      .filter(([k]) => k.startsWith(`${notebook}\0`))
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, d]) => ({ doc: k.slice(notebook.length + 1), snapshot: d.snapshot, log: frameRecords(d.records), records: d.records.length }));
  }

  async blobs(notebook: string): Promise<Uint8Array[]> {
    return [...this.blobMap].filter(([k]) => k.startsWith(`${notebook}\0`)).map(([, v]) => v);
  }

  async deleteNotebook(notebook: string): Promise<void> {
    for (const m of [this.docs, this.blobMap]) for (const k of [...m.keys()]) if (k.startsWith(`${notebook}\0`)) m.delete(k);
  }

  async getMeta<T>(key: string): Promise<T | undefined> {
    return structuredClone(this.meta.get(key)) as T | undefined;
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    this.meta.set(key, structuredClone(value));
  }

  async clearAll(): Promise<void> {
    this.docs.clear();
    this.blobMap.clear();
    this.meta.clear();
  }
}
