// Recent files, autosave and crash recovery for one window (P5-3).
//
// `DocumentSession` wraps the app's `Backend`: the app talks to the core
// through `session.backend`, and the session watches the replies to learn
// about edits (envelope revision/dirty), opens (`open*`), document
// replacements (`new*`, `load*`, `restoreRecovery`) and saves
// (`markSaved`). It never changes a request or reply.
//
// * Autosave: every `intervalMs` (30 s) while the document changed since
//   the last stored snapshot, and when the page becomes hidden, it asks
//   the core for `recoverySnapshot` and stores it under this session's
//   document id. A successful save, a replaced document and a clean close
//   (`pagehide` while not dirty) remove the entry.
// * Recovery: `start()` lists the entries of earlier sessions (entries of
//   sessions still open in another tab are skipped via the Web Locks API
//   where available); `restore(id)` loads one (`restoreRecovery`, dirty).
// * Recent files: the storage's recent list; desktop entries re-open the
//   file by path, web entries re-open the snapshot stored with them.

import type { Backend, OpenedFile } from "../backend";
import { newDocId, type DocStorage, type RecentEntry, type RecoveryInfo } from "./storage";

/** App hooks the session calls; each resolves `false` (or rejects) on failure. */
export interface SessionAdapter {
  /** Replaces the document by a `recoverySnapshot` JSON (`restoreRecovery`) and shows it. */
  restore(json: string, name: string | null): Promise<boolean | void>;
  /** Opens file contents exactly like the Open command. */
  openFile(file: OpenedFile): Promise<boolean | void>;
  /** Shows an error (e.g. as a toast). */
  onError?(e: unknown): void;
  /**
   * Asked before a recent file or a recovered document replaces the open
   * one (the unsaved-changes question, `UnsavedGuard.ensureSaved`);
   * `false` = keep the open document.
   */
  confirmReplace?(): Promise<boolean>;
}

export interface SessionState {
  /** The recent list, newest first. */
  recent: RecentEntry[];
  /** Unsaved documents of earlier sessions (the recovery banner). */
  recoveries: RecoveryInfo[];
  /** When this session last stored a snapshot (ms since the epoch). */
  lastAutosave: number | null;
}

export interface SessionOptions {
  /** Autosave period; default 30 s. */
  intervalMs?: number;
  now?: () => number;
  /** This session's document id; default a random UUID. */
  docId?: string;
  /** Event target for `visibilitychange`/`pagehide`; default `window` (null = none). */
  target?: Pick<Window, "addEventListener" | "removeEventListener"> | null;
  /** Web Locks API; default `navigator.locks` (null = none). */
  locks?: Pick<LockManager, "request" | "query"> | null;
}

/** A session of any app (for app-agnostic components). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnySession = DocumentSession<any, any>;

export const AUTOSAVE_INTERVAL_MS = 30_000;
/** Recovery entries older than this (7 days) are dropped instead of offered. */
export const RECOVERY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const REPLACING = new Set([
  "newDocument",
  "newPresentation",
  "load",
  "loadSnapshotJson",
  "openXlsx",
  "openDocx",
  "openPptx",
  "restoreRecovery",
]);
const OPENING = new Set(["openXlsx", "openDocx", "openPptx"]);
const SAVING = new Set(["saveXlsx", "saveDocx", "savePptx"]);
const LOCK_PREFIX = "rusuite-session-";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

interface Snapshot {
  json: string;
  revision: number;
  dirty: boolean;
  name: string | null;
}

export class DocumentSession<Req = unknown, Body = unknown> {
  readonly docId: string;
  /** The backend the app must use (all calls pass through unchanged). */
  readonly backend: Backend<Req, Body>;
  readonly storage: DocStorage | null;

  private state: SessionState = { recent: [], recoveries: [], lastAutosave: null };
  private listeners = new Set<() => void>();
  private adapter: SessionAdapter | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private timer: ReturnType<typeof setInterval> | null = null;
  private releaseLock: (() => void) | null = null;
  private readonly intervalMs: number;
  private readonly now: () => number;
  private readonly target: SessionOptions["target"];
  private readonly locks: SessionOptions["locks"];

  /** Last revision/dirty flag seen in a reply. */
  private seenRevision = -1;
  private seenDirty = false;
  /** Revision of the stored recovery snapshot; `null` = none stored. */
  private storedRevision: number | null = null;
  /** `suggestedName` of the last `save*` reply (Calc keeps no name in the core). */
  private suggestedName: string | null = null;

  constructor(
    private readonly inner: Backend<Req, Body>,
    options: SessionOptions = {},
  ) {
    this.docId = options.docId ?? newDocId();
    this.storage = inner.storage ?? null;
    this.intervalMs = options.intervalMs ?? AUTOSAVE_INTERVAL_MS;
    this.now = options.now ?? Date.now;
    this.target = options.target === undefined ? (typeof window === "undefined" ? null : window) : options.target;
    this.locks =
      options.locks === undefined
        ? ((typeof navigator !== "undefined" && (navigator as Navigator & { locks?: LockManager }).locks) || null)
        : options.locks;
    // Forward every member of the inner backend (methods added later
    // included, bound to it) and only intercept `dispatch`.
    const dispatch = async (request: Req) => {
      const reply = await inner.dispatch(request);
      await this.observe(request, reply);
      return reply;
    };
    this.backend = new Proxy(inner, {
      get(target, prop) {
        if (prop === "dispatch") return dispatch;
        const value: unknown = Reflect.get(target, prop, target);
        return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
      },
    });
  }

  // --- store plumbing -------------------------------------------------------

  getState = (): SessionState => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private set(partial: Partial<SessionState>): void {
    this.state = { ...this.state, ...partial };
    for (const fn of this.listeners) fn();
  }

  /** Connects the app (call before `start`). */
  attach(adapter: SessionAdapter): void {
    this.adapter = adapter;
  }

  private report(e: unknown): void {
    if (this.adapter?.onError) this.adapter.onError(e);
    else console.error(e);
  }

  /** Runs storage work strictly in order; failures are reported, never thrown. */
  private queue<T>(fn: (storage: DocStorage) => Promise<T>): Promise<T | undefined> {
    const storage = this.storage;
    if (!storage) return Promise.resolve(undefined);
    const run = this.chain.then(() => fn(storage));
    this.chain = run.catch(() => undefined);
    return run.catch((e) => {
      this.report(e);
      return undefined;
    });
  }

  /** Resolves when all queued storage work is done (tests). */
  idle(): Promise<void> {
    return this.chain.then(() => undefined);
  }

  // --- lifecycle ------------------------------------------------------------

  private onVisibility = () => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") void this.autosave();
  };

  private onPageHide = () => {
    // A clean close leaves no recovery entry; a dirty one keeps the last
    // snapshot (taken on `visibilitychange`) for the next start.
    if (!this.seenDirty) void this.queue((s) => s.removeRecovery(this.docId));
  };

  /** Loads the recent list and the recovery entries, starts autosave. */
  async start(): Promise<void> {
    if (this.timer !== null) return;
    this.timer = setInterval(() => void this.autosave(), this.intervalMs);
    this.target?.addEventListener("visibilitychange", this.onVisibility);
    this.target?.addEventListener("pagehide", this.onPageHide);
    if (this.locks && !this.releaseLock) {
      const held = new Promise<void>((resolve) => (this.releaseLock = resolve));
      void Promise.resolve(this.locks.request(LOCK_PREFIX + this.docId, () => held)).catch(() => undefined);
    }
    await this.refresh();
  }

  /** Stops autosave (the stored entry stays). */
  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.target?.removeEventListener("visibilitychange", this.onVisibility);
    this.target?.removeEventListener("pagehide", this.onPageHide);
    this.releaseLock?.();
    this.releaseLock = null;
  }

  /** Re-reads the recent list and the recovery entries of other sessions. */
  async refresh(): Promise<void> {
    await this.queue(async (s) => {
      const [recent, all] = await Promise.all([s.listRecent(), s.listRecovery()]);
      const live = await this.liveSessions();
      const oldest = this.now() - RECOVERY_MAX_AGE_MS;
      const expired = all.filter((r) => r.id !== this.docId && !live.has(r.id) && r.savedAt < oldest);
      for (const r of expired) await s.removeRecovery(r.id);
      this.set({ recent, recoveries: all.filter((r) => r.id !== this.docId && r.savedAt >= oldest && !live.has(r.id)) });
    });
  }

  private async liveSessions(): Promise<Set<string>> {
    if (!this.locks) return new Set();
    try {
      const { held = [] } = await this.locks.query();
      return new Set(
        held.flatMap((l) => (l.name?.startsWith(LOCK_PREFIX) ? [l.name.slice(LOCK_PREFIX.length)] : [])),
      );
    } catch {
      return new Set();
    }
  }

  // --- observing the backend ------------------------------------------------

  /**
   * Learns from a successful reply. Resolves before the reply reaches the
   * app, so a snapshot taken here (web recent entries) is of exactly the
   * document that was just opened or saved.
   */
  private async observe(request: Req, reply: unknown): Promise<void> {
    if (!isObj(reply) || !isObj(reply.ok)) return;
    const type = isObj(request) && typeof request.type === "string" ? request.type : "";
    const body = reply.ok;
    if (isObj(body.envelope) && typeof body.envelope.revision === "number") {
      this.seenRevision = body.envelope.revision;
      this.seenDirty = body.envelope.dirty === true;
    } else if (body.type === "documentState" && typeof body.revision === "number") {
      this.seenRevision = body.revision;
      this.seenDirty = body.dirty === true;
    }
    if (SAVING.has(type) && typeof body.suggestedName === "string") this.suggestedName = body.suggestedName;
    if (type === "markSaved" && body.dirty === false) {
      const name = typeof body.name === "string" ? body.name : this.suggestedName;
      this.seenDirty = false;
      this.storedRevision = null;
      if (this.state.lastAutosave !== null) this.set({ lastAutosave: null });
      void this.queue((s) => s.removeRecovery(this.docId));
      await this.remember(name ?? "Untitled");
    } else if (REPLACING.has(type)) {
      this.storedRevision = null;
      if (type === "restoreRecovery") {
        this.seenDirty = true;
        void this.autosave(true);
        return;
      }
      this.seenDirty = false;
      if (this.state.lastAutosave !== null) this.set({ lastAutosave: null });
      void this.queue((s) => s.removeRecovery(this.docId));
      const name = isObj(request) && typeof request.name === "string" ? request.name : null;
      if (OPENING.has(type) && name !== null) await this.remember(name);
    }
  }

  /** Puts `name` on the recent list (web: with a snapshot of the current document). */
  private async remember(name: string): Promise<void> {
    const storage = this.storage;
    if (!storage) return;
    let json: string | null = null;
    if (storage.kind === "browser") {
      try {
        json = (await this.snapshot()).json;
      } catch (e) {
        this.report(e);
        return;
      }
    }
    void this.queue(async (s) => this.set({ recent: await s.rememberRecent(name, json) }));
  }

  private async snapshot(): Promise<Snapshot> {
    const reply = (await this.inner.dispatch({ type: "recoverySnapshot" } as Req)) as unknown;
    if (isObj(reply) && isObj(reply.ok) && reply.ok.type === "recoverySnapshot" && typeof reply.ok.json === "string") {
      const b = reply.ok;
      return {
        json: b.json as string,
        revision: Number(b.revision),
        dirty: b.dirty === true,
        name: typeof b.name === "string" ? b.name : null,
      };
    }
    const err = isObj(reply) && isObj(reply.err) ? `${String(reply.err.code)}: ${String(reply.err.message)}` : "bad reply";
    throw new Error(`recoverySnapshot failed: ${err}`);
  }

  // --- actions --------------------------------------------------------------

  /**
   * Stores a recovery snapshot if the document changed since the last one
   * (always with `force`); removes the entry when the core says the
   * document is clean. Resolves `true` when a snapshot was stored.
   */
  async autosave(force = false): Promise<boolean> {
    if (!this.storage) return false;
    if (!force && (!this.seenDirty || this.seenRevision === this.storedRevision)) return false;
    const stored = await this.queue(async (s) => {
      const snap = await this.snapshot();
      this.seenRevision = snap.revision;
      this.seenDirty = snap.dirty;
      if (!snap.dirty) {
        if (this.storedRevision !== null) await s.removeRecovery(this.docId);
        this.storedRevision = null;
        return false;
      }
      if (!force && snap.revision === this.storedRevision) return false;
      const savedAt = this.now();
      await s.putRecovery({ id: this.docId, name: snap.name, savedAt, revision: snap.revision, json: snap.json });
      this.storedRevision = snap.revision;
      this.set({ lastAutosave: savedAt });
      return true;
    });
    return stored === true;
  }

  /** Restores a recovery entry of an earlier session; it is removed once this session stored its own copy. */
  async restore(id: string): Promise<boolean> {
    if (!(await this.confirmReplace())) return false;
    const entry = await this.queue((s) => s.getRecovery(id));
    if (!entry) {
      if (entry === null) this.report(new Error("This recovered document is no longer available."));
      this.set({ recoveries: this.state.recoveries.filter((r) => r.id !== id) });
      return false;
    }
    if (!this.adapter) throw new Error("DocumentSession.attach() was not called");
    let ok: boolean | void;
    try {
      ok = await this.adapter.restore(entry.json, entry.name);
    } catch (e) {
      this.report(e);
      return false;
    }
    if (ok === false) return false;
    await this.queue((s) => s.removeRecovery(id));
    this.set({ recoveries: this.state.recoveries.filter((r) => r.id !== id) });
    return true;
  }

  /** The app's unsaved-changes question (`SessionAdapter.confirmReplace`); `true` without one. */
  private async confirmReplace(): Promise<boolean> {
    if (!this.adapter?.confirmReplace) return true;
    try {
      return await this.adapter.confirmReplace();
    } catch (e) {
      this.report(e);
      return false;
    }
  }

  /** Deletes every recovery entry offered (the banner's "Discard all"). */
  async discardAll(): Promise<void> {
    const ids = this.state.recoveries.map((r) => r.id);
    await this.queue(async (s) => {
      for (const id of ids) await s.removeRecovery(id);
    });
    this.set({ recoveries: this.state.recoveries.filter((r) => !ids.includes(r.id)) });
  }

  /** Deletes a recovery entry of an earlier session. */
  async discard(id: string): Promise<void> {
    await this.queue((s) => s.removeRecovery(id));
    this.set({ recoveries: this.state.recoveries.filter((r) => r.id !== id) });
  }

  /** Re-opens a recent entry (desktop: the file; web: its stored snapshot). */
  async openRecent(entry: RecentEntry): Promise<boolean> {
    if (!this.storage || !this.adapter) return false;
    if (!(await this.confirmReplace())) return false;
    try {
      const source = await this.storage.openRecent(entry);
      const ok = "file" in source ? await this.adapter.openFile(source.file) : await this.adapter.restore(source.snapshot, entry.name);
      return ok !== false;
    } catch (e) {
      this.report(e);
      await this.refresh();
      return false;
    }
  }
}
