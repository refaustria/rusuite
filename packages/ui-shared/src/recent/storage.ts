// `Backend.storage` (P5-3): the recent list and crash-recovery entries.
// Desktop: JSON files in the app data directory, kept by the Tauri shell
// (`app_common::session`). Web: IndexedDB (`IdbDocStorage`). Both use the
// generated wire types, so entries look the same everywhere.

import { t } from "../i18n/locale";
import type { RecentEntry } from "../generated/RecentEntry";
import type { RecoveryEntry } from "../generated/RecoveryEntry";
import type { RecoveryInfo } from "../generated/RecoveryInfo";

export type { RecentEntry, RecoveryEntry, RecoveryInfo };

/** Maximum length of the recent list (`app_common::session::RECENT_LIMIT`). */
export const RECENT_LIMIT = 10;

/** What re-opens a recent entry: the file itself (desktop) or a stored snapshot (web). */
export type RecentSource = { file: { name: string; bytesBase64: string } } | { snapshot: string };

export interface DocStorage {
  /**
   * `fs`: the shell records opened/saved paths itself and re-opens them
   * from disk. `browser`: no paths; a recent entry re-opens the document
   * snapshot stored with it.
   */
  readonly kind: "fs" | "browser";
  /** The recent list, newest first. */
  listRecent(): Promise<RecentEntry[]>;
  /**
   * Records a just opened or saved document. `browser` stores
   * `snapshotJson` (the core's `recoverySnapshot`) with the entry; `fs`
   * ignores both arguments (the shell recorded the path) and only returns
   * the list.
   */
  rememberRecent(name: string, snapshotJson: string | null): Promise<RecentEntry[]>;
  /** Re-opens a recent entry. Rejects when the file or snapshot is gone (the entry is then dropped). */
  openRecent(entry: RecentEntry): Promise<RecentSource>;
  /** Recovery entries without their snapshot, newest first. */
  listRecovery(): Promise<RecoveryInfo[]>;
  getRecovery(id: string): Promise<RecoveryEntry | null>;
  putRecovery(entry: RecoveryEntry): Promise<void>;
  /** Removing a missing entry is not an error. */
  removeRecovery(id: string): Promise<void>;
  /**
   * Privacy (ADR 0009): deletes every locally kept copy of this app – the recent list with its
   * snapshots and all recovery entries. Desktop (`fs`) can only remove the recovery entries from
   * the UI side; the recent list there holds paths, not content.
   */
  clearAll?(): Promise<void>;
}

/** Identity in the recent list: the path when there is one, else the name. */
export function recentKey(e: RecentEntry): string {
  return e.path ?? e.name;
}

/**
 * Puts `entry` first, drops older entries with the same key and trims to
 * `RECENT_LIMIT`; returns the new list and the removed entries (whose
 * blobs the caller deletes). Mirrors `app_common::session::push_recent`.
 */
export function pushRecent(list: RecentEntry[], entry: RecentEntry): { list: RecentEntry[]; removed: RecentEntry[] } {
  const key = recentKey(entry);
  const removed = list.filter((e) => recentKey(e) === key);
  const next = [entry, ...list.filter((e) => recentKey(e) !== key)];
  removed.push(...next.splice(RECENT_LIMIT));
  return {
    list: next,
    removed: removed.map((r) => (r.blobId !== null && r.blobId === entry.blobId ? { ...r, blobId: null } : r)),
  };
}

/** Valid recovery/document id: 1–64 characters of `[A-Za-z0-9_-]` (as in Rust). */
export function validId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(id);
}

/** A new random document id. */
export function newDocId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

const info = ({ id, name, savedAt, revision }: RecoveryEntry): RecoveryInfo => ({ id, name, savedAt, revision });

/** In-memory `browser`-like storage (tests, and pages without IndexedDB). */
export class MemoryDocStorage implements DocStorage {
  readonly kind = "browser" as const;
  recent: RecentEntry[] = [];
  readonly recovery = new Map<string, RecoveryEntry>();
  readonly blobs = new Map<string, string>();

  constructor(private readonly now: () => number = Date.now) {}

  async listRecent(): Promise<RecentEntry[]> {
    return [...this.recent];
  }

  async rememberRecent(name: string, snapshotJson: string | null): Promise<RecentEntry[]> {
    const old = this.recent.find((e) => e.path === null && e.name === name);
    const blobId = old?.blobId ?? `r-${newDocId()}`;
    if (snapshotJson !== null) this.blobs.set(blobId, snapshotJson);
    const { list, removed } = pushRecent(this.recent, { name, path: null, blobId, openedAt: this.now() });
    for (const r of removed) if (r.blobId) this.blobs.delete(r.blobId);
    this.recent = list;
    return [...list];
  }

  async openRecent(entry: RecentEntry): Promise<RecentSource> {
    const json = entry.blobId ? this.blobs.get(entry.blobId) : undefined;
    if (json === undefined) {
      this.recent = this.recent.filter((e) => recentKey(e) !== recentKey(entry));
      throw new Error(t("recent.notStored", { name: entry.name }));
    }
    return { snapshot: json };
  }

  async listRecovery(): Promise<RecoveryInfo[]> {
    return [...this.recovery.values()].map(info).sort((a, b) => b.savedAt - a.savedAt);
  }

  async getRecovery(id: string): Promise<RecoveryEntry | null> {
    return this.recovery.get(id) ?? null;
  }

  async putRecovery(entry: RecoveryEntry): Promise<void> {
    if (!validId(entry.id)) throw new Error(`invalid document id "${entry.id}"`);
    this.recovery.set(entry.id, entry);
  }

  async removeRecovery(id: string): Promise<void> {
    this.recovery.delete(id);
  }

  async clearAll(): Promise<void> {
    this.recent = [];
    this.recovery.clear();
    this.blobs.clear();
  }
}
