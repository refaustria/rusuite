// The sync engine of one shared notebook (P11-N5b, docs/notes-sync-protocol.md §6–7): one connection to the relay,
// the subscription (notebook doc and the open page first, every other doc in the background), the relay's
// per-doc sequence markers, the outbox (persisted; flushed on every (re)connect with exponential backoff), key
// rotations (queued envelopes re-encrypted), compaction snapshots, blobs and presence.
//
// What goes out is decided by version vectors, not by effects: per local doc the engine keeps `known`, the
// operations the relay has (received from it or queued for it). After the core changed a doc (its persist
// effects), the updates the core has beyond `known` are sealed and queued; remote updates add their end version.
// Re-sending is harmless (Loro dedupes by op id), losing is not – so `known` only grows with what was queued.

import { decodeImportBlobMeta, VersionVector, type PeerID } from "loro-crdt";
import { frameRecords, splitRecords } from "../effects";
import { canWrite, NOTEBOOK_DOC, type JoinInfo, type RelayEvent, type ShareStatus, type SyncCrypto } from "./crypto";

export type SyncPhase = "connecting" | "syncing" | "synced" | "offline" | "waiting" | "error" | "removed" | "stopped";

/** A relay log longer than this (entries after the last snapshot) is compacted (spec: 500). */
export const COMPACT_AFTER = 500;
/** Presence: at most this often (10 Hz) … */
export const PRESENCE_MIN_MS = 100;
/** … and at least this often (heartbeat); peers not heard for `PRESENCE_TTL_MS` are gone. */
export const PRESENCE_HEARTBEAT_MS = 10_000;
export const PRESENCE_TTL_MS = 30_000;
/** At most one batch of document updates per this many ms (with presence well under the relay's 50 messages/s). */
export const FLUSH_MIN_MS = 30;
/** Reconnect delays (ms), the last one repeats. */
export const BACKOFF_MS = [500, 1000, 2000, 4000, 8000, 15000, 30000];

export interface SocketLike {
  binaryType?: string;
  readonly readyState: number;
  send(data: Uint8Array): void;
  close(): void;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
}

export type SocketFactory = () => SocketLike;

/** What the engine needs from the app (the controller and its store). */
export interface SyncDocHost {
  /** Local ids of the notebook's docs: its notebook doc and every page doc (empty when it is not open). */
  localDocs(localId: string): string[];
  /** Page docs to sync first (the open page). */
  priorityDocs(localId: string): string[];
  hasNotebook(localId: string): boolean;
  versionVector(doc: string): Promise<Uint8Array>;
  exportSince(doc: string, vv: Uint8Array): Promise<Uint8Array>;
  /** Remote Loro bytes for an open notebook's doc. */
  importRemote(localId: string, doc: string, bytes: Uint8Array, notebookDoc: boolean): Promise<void>;
  /** Joining: the notebook doc arrived – create the local notebook from these updates. */
  adoptNotebook(localId: string, updates: Uint8Array[]): Promise<void>;
  readBlob(localId: string, sha: string): Promise<Uint8Array | undefined>;
  blobIds(localId: string): Promise<string[]>;
  storeBlob(localId: string, sha: string, bytes: Uint8Array): Promise<void>;
  /** The display name this device joins with. */
  displayName(): string;
}

export interface SyncListener {
  status?(): void;
  presence?(): void;
  joinRequest?(join: JoinInfo): void;
  /** The notebook arrived for the first time (joining). */
  adopted?(localId: string): void;
  removed?(): void;
  stopped?(): void;
}

/** What the engine persists per notebook (IndexedDB meta). */
export interface EngineState {
  localId: string;
  /** Relay sequence number applied, per relay doc id. */
  markers: Record<string, number>;
  /** Per local doc: the version (peer → end counter) the relay has or will get from the outbox. */
  known: Record<string, [string, number][]>;
  /** The last snapshot's `covers` per relay doc. */
  snapshots: Record<string, number>;
  outbox: OutEntry[];
  /** Blobs already uploaded (SHA-256 hex). */
  sentBlobs: string[];
  requested: boolean;
  removed: boolean;
  nextTag: number;
}

export interface OutEntry {
  tag: number;
  kind: "update" | "snapshot" | "blob" | "members" | "join";
  env: Uint8Array;
  /** Relay doc id (updates, snapshots). */
  doc?: string;
  covers?: number;
  sha?: string;
  /** The genesis member list: it creates the notebook on the relay, so it goes before the subscription. */
  genesis?: boolean;
}

export interface Peer {
  device: string;
  /** The page doc the peer has open (`null`: none). */
  page: string | null;
  /** Encoded cursor ephemeral-store bytes for that page. */
  cursor: Uint8Array | null;
  at: number;
}

export const emptyState = (localId: string): EngineState => ({ localId, markers: {}, known: {}, snapshots: {}, outbox: [], sentBlobs: [], requested: false, removed: false, nextTag: 1 });

type VV = Map<string, number>;

const vvOf = (entries: [string, number][] | undefined): VV => new Map(entries ?? []);
const vvEntries = (vv: VV): [string, number][] => [...vv];
const encodeVV = (vv: VV): Uint8Array => (vv.size === 0 ? new Uint8Array() : new VersionVector(new Map([...vv].map(([p, c]) => [p as PeerID, c]))).encode());

function merge(into: VV, add: Map<string, number>): void {
  for (const [p, c] of add) if ((into.get(p) ?? 0) < c) into.set(p, c);
}

function ahead(core: Map<string, number>, known: VV): boolean {
  for (const [p, c] of core) if (c > (known.get(p) ?? 0)) return true;
  return false;
}

const utf8 = new TextEncoder();
const fromUtf8 = new TextDecoder();

export class NotebookSync {
  phase: SyncPhase = "connecting";
  /** The last error code (quota, removed …), shown with `phase` "error". */
  error: string | null = null;
  status: ShareStatus;
  readonly peers = new Map<string, Peer>();
  /** Keystroke → visible numbers of the e2e suite read these timestamps. */
  lastRemoteAt = 0;

  private ws: SocketLike | null = null;
  private attempt = 0;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private subscribedDocs = new Set<string>();
  private catchingUp = new Set<string>();
  private member = false;
  private dirty = new Set<string>();
  private dirtyBlobs = new Set<string>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private buffered: { doc: string; local: string; bytes: Uint8Array; notebookDoc: boolean }[] = [];
  private compacting = new Set<string>();
  private blobWaiters = new Map<string, ((b: Uint8Array | undefined) => void)[]>();
  private presence: { page: string | null; cursor: Uint8Array | null } = { page: null, cursor: null };
  private presenceTimer: ReturnType<typeof setTimeout> | null = null;
  private presenceSent = 0;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private sentOnThisSocket = new Set<number>();

  constructor(
    readonly notebook: string,
    private readonly crypto: SyncCrypto,
    readonly state: EngineState,
    private readonly host: SyncDocHost,
    private readonly socket: SocketFactory,
    private readonly save: (state: EngineState, book: Uint8Array) => Promise<void>,
    readonly listener: SyncListener = {},
    private readonly now: () => number = Date.now,
  ) {
    this.status = crypto.status(notebook);
    if (state.removed) this.phase = "removed";
  }

  get localId(): string {
    return this.state.localId;
  }

  get role() {
    return this.status.role ?? null;
  }

  /** Unacknowledged envelopes (shown as "Syncing"). */
  get pending(): number {
    return this.state.outbox.length;
  }

  // ---- connection -------------------------------------------------------------------------------------------

  start(): void {
    this.closed = false;
    if (this.state.removed) {
      this.setPhase("removed");
      return;
    }
    this.heartbeat ??= setInterval(() => this.tick(), 5000);
    this.connect();
  }

  /** Closes the connection for good (notebook closed, sharing stopped, page unload). */
  stop(): void {
    this.closed = true;
    if (this.retry) clearTimeout(this.retry);
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    this.retry = null;
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onclose = ws.onmessage = ws.onerror = null;
      ws.close();
    }
    void this.persistNow();
  }

  /** The browser went offline / online (or a test toggled it). */
  setOnline(online: boolean): void {
    if (this.closed || this.state.removed) return;
    if (!online) {
      const ws = this.ws;
      this.ws = null;
      if (ws) {
        ws.onclose = ws.onmessage = ws.onerror = null;
        ws.close();
      }
      this.member = false;
      this.setPhase("offline");
    } else if (!this.ws) {
      if (this.retry) clearTimeout(this.retry);
      this.retry = null;
      this.attempt = 0;
      this.connect();
    }
  }

  private connect(): void {
    if (this.closed || this.ws) return;
    let ws: SocketLike;
    try {
      ws = this.socket();
    } catch {
      this.scheduleReconnect();
      return;
    }
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    this.subscribedDocs.clear();
    this.catchingUp.clear();
    this.sentOnThisSocket.clear();
    this.member = false;
    if (this.phase !== "offline") this.setPhase("connecting");
    ws.onmessage = (ev) => this.onFrame(ev.data);
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.member = false;
      if (!this.closed && this.phase !== "removed" && this.phase !== "stopped") {
        this.setPhase("offline");
        this.scheduleReconnect();
      }
    };
    ws.onerror = () => undefined;
  }

  private scheduleReconnect(): void {
    if (this.closed || this.retry) return;
    const delay = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)]!;
    this.attempt++;
    this.retry = setTimeout(() => {
      this.retry = null;
      this.connect();
    }, delay);
  }

  private send(frame: Uint8Array): boolean {
    const ws = this.ws;
    if (!ws || ws.readyState !== 1) return false;
    ws.send(frame);
    return true;
  }

  private setPhase(phase: SyncPhase, error: string | null = this.error): void {
    if (phase === this.phase && error === this.error) return;
    this.phase = phase;
    this.error = error;
    this.listener.status?.();
  }

  private refreshPhase(): void {
    if (this.state.removed || this.phase === "stopped") return;
    if (!this.ws) return this.setPhase("offline");
    if (!this.member) return this.setPhase(this.status.member ? "connecting" : "waiting");
    if (this.error) return this.setPhase("error");
    this.setPhase(this.catchingUp.size > 0 || this.state.outbox.length > 0 ? "syncing" : "synced");
  }

  private nowSecs(): number {
    return Math.floor(this.now() / 1000);
  }

  // ---- relay frames -----------------------------------------------------------------------------------------

  private onFrame(data: unknown): void {
    const frame = data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBuffer);
    const ev = this.crypto.handle(this.notebook, frame, this.nowSecs());
    const payload = ev.type === "deliver" || ev.type === "blob" || ev.type === "presence" ? this.crypto.takePayload() : null;
    this.onEvent(ev, payload);
  }

  private onEvent(ev: RelayEvent, payload: Uint8Array | null): void {
    switch (ev.type) {
      case "challenge":
        this.attempt = 0;
        this.status = this.crypto.status(this.notebook);
        for (const o of this.state.outbox) if (o.genesis) this.sendEntry(o);
        if (this.status.member) this.subscribeFirst();
        else this.send(this.crypto.subscribe(this.notebook, []));
        this.refreshPhase();
        return;
      case "pending":
        this.member = false;
        if (!this.status.joining) {
          // Listed before but not now and not removed: nothing to do but wait.
          this.setPhase("waiting");
          return;
        }
        if (!this.state.requested) this.sendJoinRequest();
        this.setPhase("waiting");
        return;
      case "admitted":
        this.subscribeFirst();
        return;
      case "subscribed":
        this.onSubscribed(ev.docs, ev.newJoins);
        return;
      case "revoked":
        this.onRemoved();
        return;
      case "deleted":
        this.onStopped();
        return;
      case "deliver":
        this.onDeliver(ev, payload!);
        return;
      case "caughtUp":
        this.enqueue(async () => {
          this.state.markers[ev.doc] = Math.max(this.state.markers[ev.doc] ?? 0, ev.last);
          if (ev.doc === NOTEBOOK_DOC && !this.host.hasNotebook(this.localId)) await this.adopt();
          this.catchingUp.delete(ev.doc);
          if (ev.doc === NOTEBOOK_DOC) this.subscribeRest();
          this.persist();
          this.refreshPhase();
        });
        return;
      case "presence":
        this.onPresence(ev.author, payload!);
        return;
      case "members":
        this.refreshStatus();
        if (!this.status.member && this.status.removed) this.onRemoved();
        return;
      case "keys":
        this.refreshStatus();
        this.reencryptQueued();
        void this.enqueue(async () => this.resync());
        return;
      case "joinRequest":
        this.refreshStatus();
        this.listener.joinRequest?.(ev.join);
        return;
      case "blob":
        this.enqueue(async () => {
          await this.host.storeBlob(this.localId, ev.sha, payload!);
          if (!this.state.sentBlobs.includes(ev.sha)) this.state.sentBlobs.push(ev.sha);
          this.resolveBlob(ev.sha, payload!);
        });
        return;
      case "blobMissing":
        for (const sha of [...this.blobWaiters.keys()]) {
          if (this.crypto.blobDocId(this.notebook, sha) === ev.blob) this.resolveBlob(sha, undefined);
        }
        return;
      case "accepted":
        this.onAccepted(ev.tag, ev.seq);
        return;
      case "rejected":
        this.onRejected(ev.tag, ev.code);
        return;
      case "error":
        if (ev.code === "NotFound") this.onStopped();
        else if (ev.code === "BadSignature" || ev.code === "Internal") this.setPhase("error", ev.code);
        return;
      case "dropped":
        // Delivered before this device had the key (admission: the key wrap follows the member list): fetched again
        // once the key is here. Anything else that does not verify or decrypt is refused for good.
        if (ev.doc && ev.seq && /no key for epoch|no notebook key/.test(ev.reason)) {
          this.needKey.set(ev.doc, Math.min(this.needKey.get(ev.doc) ?? Infinity, ev.seq - 1));
          return;
        }
        console.warn("Rusuite Notes sync: dropped an envelope", ev.reason);
        return;
      case "invalid":
        console.warn("Rusuite Notes sync: invalid relay message", ev.reason);
        if (/do not extend/.test(ev.reason)) this.setPhase("error", "MemberList");
        return;
      case "ignored":
        return;
    }
  }

  private refreshStatus(): void {
    this.status = this.crypto.status(this.notebook);
    this.persist();
    this.listener.status?.();
  }

  private sendJoinRequest(): void {
    const env = this.crypto.joinRequest(this.notebook, this.host.displayName(), this.nowSecs());
    const tag = this.state.nextTag++;
    this.state.outbox = this.state.outbox.filter((o) => o.kind !== "join");
    this.state.outbox.push({ tag, kind: "join", env });
    this.send(this.crypto.publish(tag, env));
    this.persist();
  }

  private docHex(local: string): string {
    return this.crypto.docId(this.notebook, local);
  }

  /** Subscribes the notebook doc and the open page(s) first. */
  private subscribeFirst(): void {
    const docs = [NOTEBOOK_DOC];
    if (this.host.hasNotebook(this.localId)) for (const d of this.host.priorityDocs(this.localId)) docs.push(this.docHex(d));
    this.subscribeDocs(docs);
  }

  private subscribeDocs(hexes: string[]): void {
    const fresh = [...new Set(hexes)].filter((d) => !this.subscribedDocs.has(d));
    if (fresh.length === 0 || !this.ws) return;
    for (const d of fresh) {
      this.subscribedDocs.add(d);
      this.catchingUp.add(d);
    }
    this.send(this.crypto.subscribe(this.notebook, fresh.map((d) => [d, this.state.markers[d] ?? 0])));
  }

  private relayDocs: string[] = [];
  /** Docs with deliveries that came before the key: relay doc → the sequence number to fetch again after. */
  private needKey = new Map<string, number>();

  /** The key arrived: what could not be opened before is fetched again. */
  private resync(): void {
    if (!this.status.hasKey || this.needKey.size === 0 || !this.ws) return;
    const docs: [string, number][] = [];
    for (const [doc, after] of this.needKey) {
      this.state.markers[doc] = Math.min(this.state.markers[doc] ?? 0, after);
      this.catchingUp.add(doc);
      this.subscribedDocs.add(doc);
      docs.push([doc, this.state.markers[doc]!]);
    }
    this.needKey.clear();
    this.send(this.crypto.subscribe(this.notebook, docs));
    this.persist();
    this.refreshPhase();
  }

  /** Every other doc: the relay's directory and the pages of the local tree (low priority, after the first ones). */
  private subscribeRest(): void {
    if (!this.host.hasNotebook(this.localId)) return;
    const local = this.host.localDocs(this.localId).filter((d) => d !== this.localId).map((d) => this.docHex(d));
    this.subscribeDocs([...this.relayDocs, ...local]);
  }

  private onSubscribed(docs: [string, number][], joins: JoinInfo[]): void {
    const wasMember = this.member;
    this.member = true;
    this.attempt = 0;
    this.relayDocs = docs.map(([d]) => d);
    const before = this.status;
    this.status = this.crypto.status(this.notebook);
    if (!this.status.member) {
      this.member = false;
      if (this.status.removed) this.onRemoved();
      return;
    }
    // A new connection: one-off refusals (a forged or oversized envelope) are history; a full quota is not.
    if (this.error !== "QuotaExceeded" && this.error !== "TooManyRequests") this.error = null;
    if (before.epoch !== undefined && this.status.epoch !== undefined && this.status.epoch > before.epoch) this.reencryptQueued();
    for (const j of joins) this.listener.joinRequest?.(j);
    if (!this.subscribedDocs.has(NOTEBOOK_DOC)) this.subscribeFirst();
    void this.enqueue(async () => this.resync());
    this.state.outbox = this.state.outbox.filter((o) => o.kind !== "join");
    if (!wasMember) {
      // Everything queued goes out again (the relay or Loro drops what it already has).
      for (const o of this.state.outbox) if (!this.sentOnThisSocket.has(o.tag)) this.sendEntry(o);
      if (this.host.hasNotebook(this.localId)) {
        if (!this.catchingUp.has(NOTEBOOK_DOC)) this.subscribeRest();
        this.markAllDirty();
      }
    }
    this.persist();
    this.listener.status?.();
    this.refreshPhase();
  }

  private sendEntry(o: OutEntry): void {
    if (o.doc && o.doc !== NOTEBOOK_DOC) this.subscribeDocs([o.doc]);
    if (this.send(this.crypto.publish(o.tag, o.env))) this.sentOnThisSocket.add(o.tag);
  }

  private onDeliver(ev: Extract<RelayEvent, { type: "deliver" }>, bytes: Uint8Array): void {
    this.lastRemoteAt = this.now();
    this.enqueue(async () => {
      if (ev.target === "notebook" && !this.state.localId) {
        this.state.localId = ev.id;
        this.crypto.setLocalId(this.notebook, ev.id);
      }
      if (ev.kind === "snapshot") this.state.snapshots[ev.doc] = ev.seq;
      const notebookDoc = ev.target === "notebook";
      if (!this.host.hasNotebook(this.localId)) {
        this.buffered.push({ doc: ev.doc, local: ev.id, bytes, notebookDoc });
      } else {
        await this.host.importRemote(this.localId, ev.id, bytes, notebookDoc);
        this.noteRemote(ev.id, bytes);
      }
      this.state.markers[ev.doc] = Math.max(this.state.markers[ev.doc] ?? 0, ev.seq);
      this.maybeCompact(ev.doc, ev.id);
      this.persist();
      // New pages in the tree: subscribe them.
      if (notebookDoc && !this.catchingUp.has(NOTEBOOK_DOC)) this.subscribeRest();
    });
  }

  /** The relay has these operations now. */
  private noteRemote(local: string, bytes: Uint8Array): void {
    try {
      const end = decodeImportBlobMeta(bytes, false).partialEndVersionVector.toJSON() as Map<string, number>;
      const known = vvOf(this.state.known[local]);
      merge(known, end);
      this.state.known[local] = vvEntries(known);
    } catch {
      // Not decodable: the next flush re-sends (harmless).
    }
  }

  private async adopt(): Promise<void> {
    const nb = this.buffered.filter((b) => b.notebookDoc);
    if (nb.length === 0 || !this.localId) return;
    await this.host.adoptNotebook(this.localId, nb.map((b) => b.bytes));
    for (const b of nb) this.noteRemote(b.local, b.bytes);
    const rest = this.buffered.filter((b) => !b.notebookDoc);
    this.buffered = [];
    for (const b of rest) {
      await this.host.importRemote(this.localId, b.local, b.bytes, false);
      this.noteRemote(b.local, b.bytes);
    }
    this.listener.adopted?.(this.localId);
  }

  private onAccepted(tag: number, seq: number): void {
    const i = this.state.outbox.findIndex((o) => o.tag === tag);
    if (i < 0) return;
    const [o] = this.state.outbox.splice(i, 1);
    if (o!.kind === "join") this.state.requested = true;
    if (o!.kind === "update" && o!.doc) this.state.markers[o!.doc] = Math.max(this.state.markers[o!.doc] ?? 0, seq);
    if (o!.kind === "snapshot" && o!.doc) {
      this.state.snapshots[o!.doc] = o!.covers ?? seq;
      this.compacting.delete(o!.doc);
    }
    if (o!.kind === "blob" && o!.sha && !this.state.sentBlobs.includes(o!.sha)) this.state.sentBlobs.push(o!.sha);
    if (o!.kind === "members") this.refreshStatus();
    if (this.error && o!.kind !== "join") this.error = null;
    if (o!.kind === "update" && o!.doc) {
      const local = o!.doc === NOTEBOOK_DOC ? this.localId : this.localOf(o!.doc);
      if (local) this.maybeCompact(o!.doc, local);
    }
    this.persist();
    this.refreshPhase();
  }

  private localOf(hex: string): string | null {
    if (!this.host.hasNotebook(this.localId)) return null;
    for (const d of this.host.localDocs(this.localId)) if (this.docHex(d) === hex) return d;
    return null;
  }

  private onRejected(tag: number, code: string): void {
    const i = this.state.outbox.findIndex((o) => o.tag === tag);
    const o = i >= 0 ? this.state.outbox[i]! : null;
    const drop = () => {
      if (i >= 0) this.state.outbox.splice(this.state.outbox.indexOf(o!), 1);
    };
    switch (code) {
      case "StaleEpoch":
      case "WrongEpoch":
        this.reencryptQueued(true);
        return;
      case "NotMember":
        if (o?.kind === "join") break;
        this.refreshStatus();
        if (this.status.removed || !this.status.member) this.onRemoved();
        return;
      case "InviteUsed":
        drop();
        if (this.state.requested) return;
        this.setPhase("error", "InviteUsed");
        return;
      case "Outdated":
        drop();
        if (o?.doc) this.compacting.delete(o.doc);
        break;
      case "MemberList":
        drop();
        this.refreshStatus();
        break;
      case "QuotaExceeded":
      case "TooManyRequests":
        // Kept: the next connection retries (compaction or a cleanup frees space).
        this.setPhase("error", code);
        return;
      case "RateLimited":
        // Sent again after a short pause.
        setTimeout(() => o && this.state.outbox.includes(o) && this.sendEntry(o), 1000);
        return;
      default:
        // Forbidden (read-only), TooLarge, BadSignature, Malformed …: never accepted, so not kept.
        drop();
        this.setPhase("error", code);
        this.persist();
        return;
    }
    this.persist();
    this.refreshPhase();
  }

  /** Queued content envelopes of an older epoch get the current key (own envelopes only), then go out again. */
  private reencryptQueued(resend = false): void {
    const epoch = this.crypto.status(this.notebook).epoch ?? 0;
    let changed = false;
    for (const o of this.state.outbox) {
      if (o.kind !== "update" && o.kind !== "snapshot" && o.kind !== "blob") continue;
      if (this.crypto.envelopeEpoch(o.env) >= epoch) {
        if (resend) this.sendEntry(o);
        continue;
      }
      try {
        o.env = this.crypto.reencrypt(this.notebook, o.env);
        changed = true;
        if (this.member) this.sendEntry(o);
      } catch (e) {
        console.warn("Rusuite Notes sync: re-encrypt failed", e);
      }
    }
    if (changed) this.persist();
  }

  private onRemoved(): void {
    this.state.removed = true;
    this.member = false;
    this.persistNow();
    this.setPhase("removed", "Removed");
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onclose = ws.onmessage = null;
      ws.close();
    }
    this.closed = true;
    this.listener.removed?.();
  }

  private onStopped(): void {
    this.closed = true;
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onclose = ws.onmessage = null;
      ws.close();
    }
    this.setPhase("stopped");
    this.listener.stopped?.();
  }

  // ---- outgoing changes ---------------------------------------------------------------------------------------

  /** Runs async work in order with the inbound imports (version bookkeeping must not interleave). */
  private enqueue(fn: () => Promise<void>): Promise<void> {
    const next = this.chain.then(fn).catch((e: unknown) => console.warn("Rusuite Notes sync:", e));
    this.chain = next;
    return next;
  }

  /** Waits for queued imports and exports (tests, e2e). */
  idle(): Promise<unknown> {
    return this.chain;
  }

  private markAllDirty(): void {
    for (const d of this.host.localDocs(this.localId)) this.dirty.add(d);
    void this.host.blobIds(this.localId).then((ids) => {
      for (const sha of ids) if (!this.state.sentBlobs.includes(sha)) this.dirtyBlobs.add(sha);
      this.scheduleFlush();
    });
    this.scheduleFlush();
  }

  /** The core changed these docs of the notebook (from its persist effects). */
  localChanged(docs: Iterable<string>, blobs: Iterable<string> = []): void {
    for (const d of docs) this.dirty.add(d);
    for (const b of blobs) if (!this.state.sentBlobs.includes(b)) this.dirtyBlobs.add(b);
    this.scheduleFlush();
  }

  private lastFlush = 0;

  private scheduleFlush(): void {
    const wait = Math.max(0, this.lastFlush + FLUSH_MIN_MS - this.now());
    this.flushTimer ??= setTimeout(() => {
      this.flushTimer = null;
      this.lastFlush = this.now();
      void this.enqueue(() => this.flush());
    }, wait);
  }

  private async flush(): Promise<void> {
    if (!this.host.hasNotebook(this.localId) || this.state.removed || this.phase === "stopped") return;
    if (!canWrite(this.status.role)) {
      // Read-only members keep their changes local (the relay would refuse them).
      this.dirty.clear();
      this.dirtyBlobs.clear();
      return;
    }
    const docs = [...this.dirty];
    this.dirty.clear();
    let queued = false;
    for (const doc of docs) {
      const known = vvOf(this.state.known[doc]);
      let core: Map<string, number>;
      try {
        core = VersionVector.decode(await this.host.versionVector(doc)).toJSON() as Map<string, number>;
      } catch {
        continue; // not open / unknown
      }
      if (!ahead(core, known)) continue;
      const bytes = await this.host.exportSince(doc, encodeVV(known));
      const env = this.crypto.sealDoc(this.notebook, doc, 0, bytes);
      merge(known, core);
      this.state.known[doc] = vvEntries(known);
      const o: OutEntry = { tag: this.state.nextTag++, kind: "update", env, doc: this.docHex(doc) };
      this.state.outbox.push(o);
      if (this.member) this.sendEntry(o);
      queued = true;
    }
    for (const sha of [...this.dirtyBlobs]) {
      this.dirtyBlobs.delete(sha);
      if (this.state.sentBlobs.includes(sha) || this.state.outbox.some((o) => o.sha === sha)) continue;
      const bytes = await this.host.readBlob(this.localId, sha);
      if (!bytes) continue;
      const o: OutEntry = { tag: this.state.nextTag++, kind: "blob", env: this.crypto.sealBlob(this.notebook, sha, bytes), sha };
      this.state.outbox.push(o);
      if (this.member) this.sendEntry(o);
      queued = true;
    }
    if (queued) {
      this.persist();
      this.refreshPhase();
    }
  }

  /** Membership envelopes (admit, remove, role change) go out in order. */
  private queueMembers(envs: Uint8Array[]): void {
    for (const env of envs) {
      const o: OutEntry = { tag: this.state.nextTag++, kind: "members", env };
      this.state.outbox.push(o);
      if (this.member) this.sendEntry(o);
    }
    this.refreshStatus();
    this.refreshPhase();
  }

  admit(inviteId: string): void {
    this.queueMembers(this.crypto.admit(this.notebook, inviteId));
  }

  decline(inviteId: string): void {
    this.crypto.decline(this.notebook, inviteId);
    this.refreshStatus();
  }

  removeDevice(device: string): void {
    this.queueMembers(this.crypto.remove(this.notebook, device));
  }

  setRole(device: string, role: Parameters<SyncCrypto["setRole"]>[2]): void {
    this.queueMembers([this.crypto.setRole(this.notebook, device, role)]);
  }

  invite(role: Parameters<SyncCrypto["inviteCreate"]>[1]): { fragment: string; inviteId: string; expiresAt: number } {
    const inv = this.crypto.inviteCreate(this.notebook, role, "", this.nowSecs());
    this.persistNow();
    return inv;
  }

  /** Owner: deletes the relay's copy. Resolves when the relay confirmed (or failed). */
  stopSharing(): boolean {
    return this.send(this.crypto.stopSharing(this.notebook, this.nowSecs()));
  }

  // ---- compaction ---------------------------------------------------------------------------------------------

  private maybeCompact(hex: string, local: string): void {
    const marker = this.state.markers[hex] ?? 0;
    if (marker - (this.state.snapshots[hex] ?? 0) <= COMPACT_AFTER || this.compacting.has(hex)) return;
    if (!canWrite(this.status.role) || !this.lowestOnlineEditor()) return;
    this.compacting.add(hex);
    void this.enqueue(async () => {
      const bytes = await this.host.exportSince(local, new Uint8Array());
      const covers = this.state.markers[hex] ?? marker;
      const o: OutEntry = { tag: this.state.nextTag++, kind: "snapshot", env: this.crypto.sealDoc(this.notebook, local, covers, bytes), doc: hex, covers };
      this.state.outbox.push(o);
      if (this.member) this.sendEntry(o);
      this.persist();
    });
  }

  /** Whether this device has the lowest id among the online editors (it uploads the compaction snapshot). */
  lowestOnlineEditor(): boolean {
    const me = this.status.members?.find((m) => m.me)?.device;
    if (!me) return false;
    const editors = new Set((this.status.members ?? []).filter((m) => canWrite(m.role)).map((m) => m.device));
    const cutoff = this.now() - PRESENCE_TTL_MS;
    for (const p of this.peers.values()) if (p.at >= cutoff && editors.has(p.device) && p.device < me) return false;
    return true;
  }

  // ---- blobs ------------------------------------------------------------------------------------------------

  /** Fetches a blob another member uploaded (`undefined`: the relay does not have it). */
  fetchBlob(sha: string): Promise<Uint8Array | undefined> {
    if (!this.member) return Promise.resolve(undefined);
    return new Promise((resolve) => {
      const list = this.blobWaiters.get(sha) ?? [];
      list.push(resolve);
      this.blobWaiters.set(sha, list);
      if (list.length === 1 && !this.send(this.crypto.fetchBlob(this.notebook, sha))) this.resolveBlob(sha, undefined);
      setTimeout(() => this.resolveBlob(sha, undefined), 30_000);
    });
  }

  private resolveBlob(sha: string, bytes: Uint8Array | undefined): void {
    const list = this.blobWaiters.get(sha);
    if (!list) return;
    this.blobWaiters.delete(sha);
    for (const r of list) r(bytes);
  }

  // ---- presence -----------------------------------------------------------------------------------------------

  /** This device's page and cursor (sent at most every 100 ms, at least every 10 s). */
  setPresence(page: string | null, cursor: Uint8Array | null): void {
    this.presence = { page, cursor };
    if (this.presenceTimer) return;
    const wait = Math.max(0, this.presenceSent + PRESENCE_MIN_MS - this.now());
    this.presenceTimer = setTimeout(() => {
      this.presenceTimer = null;
      this.sendPresence();
    }, wait);
  }

  private sendPresence(): void {
    if (!this.member) return;
    this.presenceSent = this.now();
    const json = utf8.encode(JSON.stringify({ page: this.presence.page }));
    const data = frameRecords([json, this.presence.cursor ?? new Uint8Array()]);
    try {
      this.send(this.crypto.publish(0, this.crypto.sealPresence(this.notebook, data)));
    } catch {
      // No key yet.
    }
  }

  private onPresence(author: string, payload: Uint8Array): void {
    const [json, cursor] = splitRecords(payload);
    let page: string | null = null;
    try {
      page = (JSON.parse(fromUtf8.decode(json ?? new Uint8Array())) as { page?: string | null }).page ?? null;
    } catch {
      return;
    }
    const known = this.peers.has(author);
    this.peers.set(author, { device: author, page, cursor: cursor && cursor.length ? cursor : null, at: this.now() });
    // A newcomer learns where we are right away.
    if (!known) this.setPresence(this.presence.page, this.presence.cursor);
    this.listener.presence?.();
  }

  private tick(): void {
    const cutoff = this.now() - PRESENCE_TTL_MS;
    let gone = false;
    for (const [d, p] of this.peers) {
      if (p.at < cutoff) {
        this.peers.delete(d);
        gone = true;
      }
    }
    if (gone) this.listener.presence?.();
    if (this.member && this.now() - this.presenceSent >= PRESENCE_HEARTBEAT_MS) this.sendPresence();
  }

  // ---- persistence --------------------------------------------------------------------------------------------

  private persist(): void {
    this.saveTimer ??= setTimeout(() => {
      this.saveTimer = null;
      void this.persistNow();
    }, 200);
  }

  persistNow(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    let book: Uint8Array;
    try {
      book = this.crypto.bookSave(this.notebook);
    } catch {
      return Promise.resolve();
    }
    return this.save(structuredClone(this.state), book).catch((e: unknown) => console.warn("Rusuite Notes sync: save failed", e));
  }
}
