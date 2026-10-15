// The web `DocStorage`: a tiny promise wrapper over IndexedDB (no deps).
// One database per app (`rusuite-calc`, ...; the apps share an origin):
//   kv       – "recent": RecentEntry[]
//   recovery – RecoveryEntry, keyPath "id"
//   blobs    – snapshot JSON of recent entries, keyed by `blobId`

import { t } from "../i18n/locale";
import { newDocId, pushRecent, recentKey, validId, type DocStorage, type RecentEntry, type RecentSource, type RecoveryEntry, type RecoveryInfo } from "./storage";

const VERSION = 1;
const STORES = ["kv", "recovery", "blobs"] as const;
type StoreName = (typeof STORES)[number];

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

/** IndexedDB database name of an app, from its `ping()` text (`"Rusuite Calc 0.1.0"` → `rusuite-calc`). */
export function dbNameFromPing(ping: string): string {
  const app = ping.split(/\s+/)[1]?.toLowerCase().replace(/[^a-z0-9]/g, "");
  return `rusuite-${app || "app"}`;
}

export class IdbDocStorage implements DocStorage {
  readonly kind = "browser" as const;
  private db: Promise<IDBDatabase> | null = null;

  constructor(
    /** Database name, or a function computing it on first use. */
    private readonly name: string | (() => string),
    private readonly factory: () => IDBFactory = () => indexedDB,
    private readonly now: () => number = Date.now,
  ) {}

  /** Whether this page can use IndexedDB at all. */
  static available(): boolean {
    return typeof indexedDB !== "undefined";
  }

  private open(): Promise<IDBDatabase> {
    if (!this.db) {
      const name = typeof this.name === "string" ? this.name : this.name();
      const req = this.factory().open(name, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
        if (!db.objectStoreNames.contains("recovery")) db.createObjectStore("recovery", { keyPath: "id" });
        if (!db.objectStoreNames.contains("blobs")) db.createObjectStore("blobs");
      };
      this.db = promised(req).catch((e) => {
        this.db = null;
        throw e;
      });
    }
    return this.db;
  }

  /** Runs `fn` in one transaction and resolves with its result once committed. */
  private async tx<T>(
    stores: StoreName[],
    mode: IDBTransactionMode,
    fn: (s: Record<StoreName, IDBObjectStore>) => Promise<T> | T,
  ): Promise<T> {
    const db = await this.open();
    const tx = db.transaction(stores, mode);
    const committed = done(tx);
    const s = Object.fromEntries(stores.map((n) => [n, tx.objectStore(n)])) as Record<StoreName, IDBObjectStore>;
    const result = await fn(s);
    await committed;
    return result;
  }

  private static async recentOf(kv: IDBObjectStore): Promise<RecentEntry[]> {
    const v = (await promised(kv.get("recent"))) as unknown;
    return Array.isArray(v) ? (v as RecentEntry[]) : [];
  }

  listRecent(): Promise<RecentEntry[]> {
    return this.tx(["kv"], "readonly", (s) => IdbDocStorage.recentOf(s.kv));
  }

  rememberRecent(name: string, snapshotJson: string | null): Promise<RecentEntry[]> {
    return this.tx(["kv", "blobs"], "readwrite", async (s) => {
      const current = await IdbDocStorage.recentOf(s.kv);
      const old = current.find((e) => e.path === null && e.name === name);
      const blobId = old?.blobId ?? `r-${newDocId()}`;
      if (snapshotJson !== null) s.blobs.put(snapshotJson, blobId);
      const { list, removed } = pushRecent(current, { name, path: null, blobId, openedAt: this.now() });
      for (const r of removed) if (r.blobId) s.blobs.delete(r.blobId);
      s.kv.put(list, "recent");
      return list;
    });
  }

  async openRecent(entry: RecentEntry): Promise<RecentSource> {
    const json = await this.tx(["blobs"], "readonly", async (s) =>
      entry.blobId ? ((await promised(s.blobs.get(entry.blobId))) as string | undefined) : undefined,
    );
    if (typeof json === "string") return { snapshot: json };
    await this.tx(["kv"], "readwrite", async (s) => {
      const list = (await IdbDocStorage.recentOf(s.kv)).filter((e) => recentKey(e) !== recentKey(entry));
      s.kv.put(list, "recent");
    });
    throw new Error(t("recent.notStored", { name: entry.name }));
  }

  listRecovery(): Promise<RecoveryInfo[]> {
    return this.tx(["recovery"], "readonly", async (s) => {
      const all = (await promised(s.recovery.getAll())) as RecoveryEntry[];
      return all
        .map(({ id, name, savedAt, revision }) => ({ id, name, savedAt, revision }))
        .sort((a, b) => b.savedAt - a.savedAt);
    });
  }

  getRecovery(id: string): Promise<RecoveryEntry | null> {
    return this.tx(["recovery"], "readonly", async (s) => ((await promised(s.recovery.get(id))) as RecoveryEntry | undefined) ?? null);
  }

  async putRecovery(entry: RecoveryEntry): Promise<void> {
    if (!validId(entry.id)) throw new Error(`invalid document id "${entry.id}"`);
    await this.tx(["recovery"], "readwrite", (s) => {
      s.recovery.put(entry);
    });
  }

  async removeRecovery(id: string): Promise<void> {
    await this.tx(["recovery"], "readwrite", (s) => {
      s.recovery.delete(id);
    });
  }

  async clearAll(): Promise<void> {
    await this.tx([...STORES], "readwrite", (s) => {
      for (const n of STORES) s[n].clear();
    });
  }

  /** Closes the connection (tests). */
  async close(): Promise<void> {
    if (this.db) (await this.db).close();
    this.db = null;
  }
}
