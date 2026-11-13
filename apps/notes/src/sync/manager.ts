// Sharing on this device (P11-N5b): the device keys (IndexedDB `meta`, created on first share or join), the display
// name, the list of shared notebooks and one `NotebookSync` per open shared notebook. A notebook that is never
// shared never creates an engine, so it never opens a connection (ADR 0009/0010).

import type { NotesStore } from "../store";
import { canManage, type JoinInfo, type MemberInfo, type Role, type ShareStatus, type SyncCrypto } from "./crypto";
import { emptyState, NotebookSync, type EngineState, type Peer, type SocketFactory, type SyncDocHost, type SyncPhase } from "./engine";

export const META_DEVICE_KEYS = "sync:deviceKeys";
export const META_PROFILE = "sync:profile";
export const META_SHARES = "sync:shares";
const stateKey = (nb: string) => `sync:state:${nb}`;
const bookKey = (nb: string) => `sync:book:${nb}`;

export interface Profile {
  name: string;
}

/** A shared notebook of this device: the relay notebook id and the local notebook id (empty while joining). */
export interface ShareRecord {
  notebook: string;
  localId: string;
  /** Joining: the inviter's name from the link (shown while waiting). */
  inviter?: string;
}

/** What the UI shows for one shared notebook. */
export interface ShareView {
  notebook: string;
  localId: string;
  phase: SyncPhase;
  error: string | null;
  role: Role | null;
  members: MemberInfo[];
  names: Record<string, string>;
  joins: JoinInfo[];
  peers: Peer[];
  pending: number;
  inviter?: string;
}

/** The invite link fragment (`#i=<invite>[&n=<inviter>]`). */
export function parseInviteHash(hash: string): { fragment: string; inviter: string } | null {
  const m = /^#i=([A-Za-z0-9_-]+)(?:&n=([^&]*))?/.exec(hash);
  if (!m) return null;
  let inviter = "";
  try {
    inviter = decodeURIComponent(m[2] ?? "");
  } catch {
    inviter = "";
  }
  return { fragment: m[1]!, inviter };
}

/** The colour of a device (people bar, cursors, dots): stable, from its id. */
export const PEOPLE_COLORS = ["#d13438", "#0078d4", "#107c10", "#8764b8", "#ca5010", "#038387", "#c239b3", "#986f0b"];
export function colorOf(device: string): string {
  let h = 0;
  for (let i = 0; i < device.length; i++) h = (h * 31 + device.charCodeAt(i)) >>> 0;
  return PEOPLE_COLORS[h % PEOPLE_COLORS.length]!;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts.length === 1 ? parts[0]!.slice(0, 2) : parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/** The same-origin relay (web: only its own origin, ADR 0010 §5). */
export function relayUrl(loc: Pick<Location, "protocol" | "host"> = location): string {
  return `${loc.protocol === "https:" ? "wss" : "ws"}://${loc.host}/api/notes/ws`;
}

export class SyncManager {
  device: string | null = null;
  profile: Profile | null = null;
  shares: ShareRecord[] = [];
  readonly engines = new Map<string, NotebookSync>();
  /** Called after any change the UI shows. */
  onChange: () => void = () => undefined;
  onJoinRequest: (localId: string, join: JoinInfo) => void = () => undefined;
  onAdopted: (rec: ShareRecord) => void = () => undefined;
  onRemoved: (localId: string) => void = () => undefined;
  onStopped: (localId: string, wasOwner: boolean) => void = () => undefined;

  constructor(
    readonly crypto: SyncCrypto,
    private readonly store: NotesStore,
    private readonly host: SyncDocHost,
    private readonly socket: SocketFactory,
    private readonly now: () => number = Date.now,
  ) {}

  /** Loads the device keys, the profile and the shared notebooks (no connection yet). */
  async init(): Promise<void> {
    const keys = await this.store.getMeta<Uint8Array>(META_DEVICE_KEYS);
    if (keys) this.device = this.crypto.deviceLoad(keys instanceof Uint8Array ? keys : new Uint8Array(keys as ArrayBuffer));
    this.profile = (await this.store.getMeta<Profile>(META_PROFILE)) ?? null;
    this.shares = (await this.store.getMeta<ShareRecord[]>(META_SHARES)) ?? [];
    for (const s of this.shares) {
      const book = await this.store.getMeta<Uint8Array>(bookKey(s.notebook));
      if (!book) continue;
      try {
        this.crypto.bookLoad(book);
      } catch (e) {
        console.warn("Rusuite Notes sync: stored sharing state unreadable", e);
      }
    }
  }

  /** Creates the device keys on first use → the device id. */
  async ensureDevice(): Promise<string> {
    if (this.device) return this.device;
    const keys = this.crypto.deviceCreate();
    await this.store.setMeta(META_DEVICE_KEYS, keys);
    this.device = this.crypto.deviceLoad(keys);
    return this.device;
  }

  async setProfile(name: string): Promise<void> {
    this.profile = { name: name.trim().slice(0, 80) };
    await this.store.setMeta(META_PROFILE, this.profile);
    this.onChange();
  }

  private async saveShares(): Promise<void> {
    await this.store.setMeta(META_SHARES, this.shares);
  }

  record(localId: string): ShareRecord | undefined {
    return this.shares.find((s) => s.localId === localId && localId !== "");
  }

  engineFor(localId: string): NotebookSync | undefined {
    const r = this.record(localId);
    return r ? this.engines.get(r.notebook) : undefined;
  }

  isShared(localId: string): boolean {
    return !!this.record(localId);
  }

  /** Starts the engines of the shared notebooks that are open (call after the notebooks loaded). */
  async startOpen(open: (localId: string) => boolean): Promise<void> {
    for (const s of this.shares) {
      if (this.engines.has(s.notebook)) continue;
      if (s.localId === "" || open(s.localId)) await this.startEngine(s);
    }
  }

  private async startEngine(rec: ShareRecord): Promise<NotebookSync> {
    const state = (await this.store.getMeta<EngineState>(stateKey(rec.notebook))) ?? emptyState(rec.localId);
    if (!state.localId) state.localId = rec.localId;
    const engine = new NotebookSync(
      rec.notebook,
      this.crypto,
      state,
      this.host,
      this.socket,
      async (st, book) => {
        await this.store.setMeta(stateKey(rec.notebook), st);
        await this.store.setMeta(bookKey(rec.notebook), book);
      },
      {
        status: () => this.onChange(),
        presence: () => this.onChange(),
        joinRequest: (j) => this.onJoinRequest(engine.localId, j),
        adopted: (localId) => {
          rec.localId = localId;
          delete rec.inviter;
          void this.saveShares().then(() => this.onAdopted(rec));
        },
        removed: () => this.onRemoved(engine.localId),
        stopped: () => {
          const owner = engine.status.role === "owner";
          void this.forget(rec.notebook).then(() => this.onStopped(engine.localId, owner));
        },
      },
      this.now,
    );
    this.engines.set(rec.notebook, engine);
    engine.start();
    this.onChange();
    return engine;
  }

  /** Turns sharing on for a local notebook: creates the relay notebook and uploads everything. */
  async share(localId: string): Promise<NotebookSync> {
    const existing = this.engineFor(localId);
    if (existing) return existing;
    await this.ensureDevice();
    const name = this.profile?.name ?? "";
    const { notebook, genesis } = this.crypto.shareCreate(localId, name);
    const rec: ShareRecord = { notebook, localId };
    this.shares = [...this.shares, rec];
    await this.store.setMeta(bookKey(notebook), this.crypto.bookSave(notebook));
    await this.saveShares();
    // The genesis creates the notebook on the relay; everything else follows once subscribed.
    const state = emptyState(localId);
    state.outbox.push({ tag: state.nextTag++, kind: "members", env: genesis, genesis: true });
    await this.store.setMeta(stateKey(notebook), state);
    return this.startEngine(rec);
  }

  /** Opens an invite link: joins (waiting for admission) → the relay notebook id. */
  async join(fragment: string, inviter: string): Promise<string> {
    await this.ensureDevice();
    const { notebook } = this.crypto.joinStart(fragment, Math.floor(this.now() / 1000));
    const known = this.shares.find((s) => s.notebook === notebook);
    if (known) {
      if (!this.engines.has(notebook)) await this.startEngine(known);
      return notebook;
    }
    const rec: ShareRecord = { notebook, localId: "", inviter };
    this.shares = [...this.shares, rec];
    await this.store.setMeta(bookKey(notebook), this.crypto.bookSave(notebook));
    await this.saveShares();
    await this.startEngine(rec);
    return notebook;
  }

  /** Forgets a shared notebook on this device (sharing stopped, joining cancelled). The local copy stays. */
  async forget(notebook: string): Promise<void> {
    const e = this.engines.get(notebook);
    e?.stop();
    this.engines.delete(notebook);
    this.shares = this.shares.filter((s) => s.notebook !== notebook);
    try {
      this.crypto.bookForget(notebook);
    } catch {
      // not loaded
    }
    await this.saveShares();
    await this.store.setMeta(stateKey(notebook), null);
    await this.store.setMeta(bookKey(notebook), null);
    this.onChange();
  }

  /** Owner: deletes the server copy (everybody keeps their local copy). */
  async stopSharing(localId: string): Promise<boolean> {
    const e = this.engineFor(localId);
    if (!e) return false;
    if (!e.stopSharing()) return false;
    return true;
  }

  /** The notebook was closed: its connection goes too. */
  close(localId: string): void {
    const r = this.record(localId);
    const e = r && this.engines.get(r.notebook);
    if (!e) return;
    e.stop();
    this.engines.delete(r.notebook);
    this.onChange();
  }

  /** The local docs changed (persist effects of the core). */
  changed(localId: string, docs: Iterable<string>, blobs: Iterable<string>): void {
    this.engineFor(localId)?.localChanged(docs, blobs);
  }

  setOnline(online: boolean): void {
    for (const e of this.engines.values()) e.setOnline(online);
  }

  views(): Record<string, ShareView> {
    const out: Record<string, ShareView> = {};
    for (const s of this.shares) {
      const e = this.engines.get(s.notebook);
      const st: ShareStatus | null = e?.status ?? null;
      out[s.localId || `joining:${s.notebook}`] = {
        notebook: s.notebook,
        localId: s.localId,
        phase: e?.phase ?? "offline",
        error: e?.error ?? null,
        role: (st?.role as Role | null | undefined) ?? null,
        members: st?.members ?? [],
        names: st?.names ?? {},
        joins: canManage(st?.role) ? (st?.joins ?? []) : [],
        peers: e ? [...e.peers.values()] : [],
        pending: e?.pending ?? 0,
        ...(s.inviter !== undefined ? { inviter: s.inviter } : {}),
      };
    }
    return out;
  }

  stopAll(): void {
    for (const e of this.engines.values()) e.stop();
  }
}
