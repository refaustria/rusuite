// Remote cursors and selections of a page (P11-N5b): loro-prosemirror's cursor plugin on a `CursorEphemeralStore`
// keyed by the mirror's peer id. Local cursor changes go out as presence (encrypted by the engine, never stored);
// remote states come back here. A remote cursor can point into a container this mirror does not have yet (presence
// and updates travel independently – the spike's "container does not exist" error): such states are held and
// applied after the next import that brings the container.

import { Cursor, EphemeralStore, type LoroEventBatch } from "loro-crdt";
import { CursorEphemeralStore, LoroEphemeralCursorPlugin } from "loro-prosemirror";
import type { PageMirror } from "./mirror";

/** Remote cursor states older than this disappear (the engine re-sends ours every 10 s). */
export const CURSOR_TIMEOUT_MS = 30_000;

type CursorState = { anchor: Uint8Array | null; focus: Uint8Array | null; user: { name: string; color: string } | null };

export class PagePresence {
  readonly store: CursorEphemeralStore;
  /** Mirror peer → sharing device (labels come from the member list, not from the sender's own claim). */
  readonly deviceOf = new Map<string, string>();
  private held: { bytes: Uint8Array; device: string }[] = [];
  private readonly unsubscribe: () => void;
  private readonly unsubscribeDoc: () => void;
  private refresh: ReturnType<typeof setInterval>;

  constructor(
    private readonly mirror: PageMirror,
    /** The local state changed: its encoding (`null` when the cursor left the page). */
    private readonly send: (bytes: Uint8Array | null) => void,
  ) {
    this.store = new CursorEphemeralStore(mirror.doc.peerIdStr, CURSOR_TIMEOUT_MS);
    this.unsubscribe = this.store.subscribeLocalUpdates(() => this.send(this.local()));
    this.unsubscribeDoc = mirror.doc.subscribe((b: LoroEventBatch) => {
      if (b.by === "import" && this.held.length) this.retry();
    });
    // Keep our state fresh at the peers (ephemeral entries time out).
    this.refresh = setInterval(() => {
      const l = this.store.getLocal();
      if (l && (l.anchor || l.focus)) this.store.setLocal(l);
    }, CURSOR_TIMEOUT_MS / 3);
  }

  /** The local state's encoding, or `null`. */
  local(): Uint8Array | null {
    const peer = this.mirror.doc.peerIdStr;
    return this.store.get(peer) ? this.store.encode(peer) : null;
  }

  /** The ProseMirror plugin (`label(peer)` names a remote peer). */
  plugin(user: { name: string; color: string }, label: (peer: string) => { name: string; color: string } | null) {
    return LoroEphemeralCursorPlugin(this.store, {
      user,
      createCursor: (peer) => {
        const who = label(peer) ?? this.claimed(peer);
        const cursor = document.createElement("span");
        cursor.className = "ProseMirror-loro-cursor";
        cursor.style.borderColor = who.color;
        cursor.dataset.testid = "remote-cursor";
        const tag = document.createElement("div");
        tag.style.backgroundColor = who.color;
        tag.textContent = who.name;
        cursor.append("⁠", tag, "⁠");
        return cursor;
      },
      createSelection: (peer) => ({ class: "loro-selection", "data-peer": peer, style: `background-color: ${(label(peer) ?? this.claimed(peer)).color}33` }),
    });
  }

  private claimed(peer: string): { name: string; color: string } {
    const s = this.store.getAll()[peer as `${number}`];
    return { name: s?.user?.name ?? "…", color: s?.user?.color ?? "#888888" };
  }

  /** A remote presence state (from sharing device `device`). */
  apply(bytes: Uint8Array, device: string): void {
    if (!this.ready(bytes, device)) {
      this.held = [...this.held.filter((h) => h.device !== device), { bytes, device }];
      return;
    }
    this.store.apply(bytes);
  }

  /** Every cursor of `bytes` points into a container this mirror has (and the peers are recorded). */
  private ready(bytes: Uint8Array, device: string): boolean {
    const tmp = new EphemeralStore<Record<string, CursorState>>();
    try {
      tmp.apply(bytes);
      for (const [peer, st] of Object.entries(tmp.getAllStates())) {
        if (peer === this.mirror.doc.peerIdStr) return false;
        this.deviceOf.set(peer, device);
        for (const c of [st?.anchor, st?.focus]) {
          if (!c) continue;
          const id = Cursor.decode(c).containerId();
          if (!this.mirror.doc.getContainerById(id)) return false;
        }
      }
      return true;
    } catch {
      return false;
    } finally {
      tmp.destroy?.();
    }
  }

  private retry(): void {
    const held = this.held;
    this.held = [];
    for (const h of held) this.apply(h.bytes, h.device);
  }

  /** Forgets a peer's cursors (it left the page). */
  drop(device: string): void {
    for (const [peer, d] of this.deviceOf) if (d === device) this.store.delete(peer);
    this.held = this.held.filter((h) => h.device !== device);
  }

  dispose(): void {
    clearInterval(this.refresh);
    this.unsubscribe();
    this.unsubscribeDoc();
    this.held = [];
  }
}
