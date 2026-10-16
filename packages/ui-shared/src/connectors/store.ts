// Where connections are kept: on this device only, never synced, never logged (ADR 0009 amendment).
// * Web (`IdbConnectionStore`): IndexedDB database `rusuite-connections` of this site's origin (shared by Calc,
//   Write and Show): `kv` holds the records (never with a secret) and the remote recent files; `secrets` holds a
//   password only when the user ticked "Remember password on this device" – unencrypted, which the dialog says.
//   Otherwise the password lives in memory for this page only and is asked again next time.
// * Desktop (`TauriConnectionStore`): `connections.json` in the app data directory, passwords in the OS keyring.
// "Forget all connections" (`clear`) removes all of it.

import type { Connection } from "./provider";
import { withoutSecret } from "./provider";

/** A remote document on the recent list. */
export interface RemoteRecent {
  connectionId: string;
  path: string;
  name: string;
  openedAt: number;
}

export interface StoredData {
  version: 1;
  /** Without secrets. */
  connections: Connection[];
  /** Newest first, all apps (filtered by extension when shown). */
  recent: RemoteRecent[];
}

/** Remote entries kept (all apps together). */
export const REMOTE_RECENT_LIMIT = 30;

export const emptyData = (): StoredData => ({ version: 1, connections: [], recent: [] });

/** Reads stored JSON leniently (unknown or broken content → empty). */
export function parseData(json: string | unknown): StoredData {
  let v: unknown = json;
  if (typeof json === "string") {
    try {
      v = JSON.parse(json);
    } catch {
      return emptyData();
    }
  }
  if (typeof v !== "object" || v === null) return emptyData();
  const o = v as Partial<StoredData>;
  const connections = Array.isArray(o.connections)
    ? o.connections.filter((c): c is Connection => typeof c?.id === "string" && typeof c.baseUrl === "string").map(withoutSecret)
    : [];
  const recent = Array.isArray(o.recent)
    ? o.recent.filter((r): r is RemoteRecent => typeof r?.connectionId === "string" && typeof r.path === "string")
    : [];
  return { version: 1, connections, recent };
}

export interface ConnectionStore {
  readonly kind: "browser" | "desktop" | "memory";
  load(): Promise<StoredData>;
  /** Replaces the records (callers pass them without secrets; stores strip them again). */
  save(data: StoredData): Promise<void>;
  getSecret(id: string): Promise<string | null>;
  setSecret(id: string, secret: string): Promise<void>;
  /** Deleting a missing secret is not an error. */
  deleteSecret(id: string): Promise<void>;
  /** "Forget all connections": records, remote recent files and secrets. */
  clear(): Promise<void>;
}

const strip = (data: StoredData): StoredData => ({ ...data, connections: data.connections.map(withoutSecret) });

/** In-memory store (tests, and pages without IndexedDB: nothing survives the page). */
export class MemoryConnectionStore implements ConnectionStore {
  readonly kind = "memory" as const;
  data: StoredData = emptyData();
  readonly secrets = new Map<string, string>();

  async load(): Promise<StoredData> {
    return structuredClone(this.data);
  }

  async save(data: StoredData): Promise<void> {
    this.data = structuredClone(strip(data));
  }

  async getSecret(id: string): Promise<string | null> {
    return this.secrets.get(id) ?? null;
  }

  async setSecret(id: string, secret: string): Promise<void> {
    this.secrets.set(id, secret);
  }

  async deleteSecret(id: string): Promise<void> {
    this.secrets.delete(id);
  }

  async clear(): Promise<void> {
    this.data = emptyData();
    this.secrets.clear();
  }
}

/** IndexedDB database of the connections (one per origin, shared by the apps). */
export const CONNECTIONS_DB = "rusuite-connections";
const STORES = ["kv", "secrets"] as const;

function promised<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

export class IdbConnectionStore implements ConnectionStore {
  readonly kind = "browser" as const;
  private db: Promise<IDBDatabase> | null = null;

  constructor(
    private readonly name = CONNECTIONS_DB,
    private readonly factory: () => IDBFactory = () => indexedDB,
  ) {}

  static available(): boolean {
    return typeof indexedDB !== "undefined";
  }

  private open(): Promise<IDBDatabase> {
    if (!this.db) {
      const req = this.factory().open(this.name, 1);
      req.onupgradeneeded = () => {
        for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s);
      };
      this.db = promised(req).catch((e) => {
        this.db = null;
        throw e;
      });
    }
    return this.db;
  }

  private async tx<T>(stores: (typeof STORES)[number][], mode: IDBTransactionMode, fn: (s: Record<string, IDBObjectStore>) => Promise<T> | T): Promise<T> {
    const db = await this.open();
    const tx = db.transaction(stores, mode);
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    });
    const result = await fn(Object.fromEntries(stores.map((n) => [n, tx.objectStore(n)])));
    await done;
    return result;
  }

  load(): Promise<StoredData> {
    return this.tx(["kv"], "readonly", async (s) => parseData((await promised(s.kv!.get("data"))) ?? null));
  }

  async save(data: StoredData): Promise<void> {
    await this.tx(["kv"], "readwrite", (s) => {
      s.kv!.put(strip(data), "data");
    });
  }

  getSecret(id: string): Promise<string | null> {
    return this.tx(["secrets"], "readonly", async (s) => {
      const v = (await promised(s.secrets!.get(id))) as unknown;
      return typeof v === "string" ? v : null;
    });
  }

  async setSecret(id: string, secret: string): Promise<void> {
    await this.tx(["secrets"], "readwrite", (s) => {
      s.secrets!.put(secret, id);
    });
  }

  async deleteSecret(id: string): Promise<void> {
    await this.tx(["secrets"], "readwrite", (s) => {
      s.secrets!.delete(id);
    });
  }

  async clear(): Promise<void> {
    await this.tx([...STORES], "readwrite", (s) => {
      for (const n of STORES) s[n]!.clear();
    });
  }

  async close(): Promise<void> {
    if (this.db) (await this.db).close();
    this.db = null;
  }
}
