// The editor's mirror of a page document (docs/notes-format.md §5, "Editor mirror rules"): a `LoroDoc` in the page,
// seeded from the core's `export_updates(docId, empty)` before the editor binds, with the page's mirror peer id,
// timestamps on and the 10 s change merge interval. Its local updates go to the core (`import_updates`); changes the
// core makes to the page (rename, later relay updates) come back with `pull` – through the IME guard.

import { LoroDoc, LoroList, LoroMap, LoroText, UndoManager, type VersionVector } from "loro-crdt";
import type { OpenedPage } from "../generated/OpenedPage";
import { ImeGuard } from "./ime";

export interface MirrorHost {
  exportUpdates(doc: string, vv: Uint8Array): Promise<Uint8Array>;
  /** Hands local updates to the core (and their persist effects to storage). */
  importUpdates(doc: string, bytes: Uint8Array): Promise<void>;
  /** The core's `page_genesis()` bytes. */
  genesis: Uint8Array;
}

/** Local updates reach the core this long after the first of a batch (≤ the persist delay budget of 250 ms). */
export const SHIP_DELAY_MS = 40;

/** Undo steps of the editor: typing within this many ms is one step. */
export const UNDO_MERGE_MS = 1000;

/** The id of the genesis paragraph's text container (`doc.children[0].children[0]`), if present. */
export function genesisTextId(doc: LoroDoc): string | null {
  const children = doc.getMap("doc").get("children");
  if (!(children instanceof LoroList)) return null;
  const para = children.get(0);
  if (!(para instanceof LoroMap)) return null;
  const kids = para.get("children");
  if (!(kids instanceof LoroList)) return null;
  const text = kids.get(0);
  return text instanceof LoroText ? text.id : null;
}

let genesisIdCache: { bytes: Uint8Array; id: string | null } | null = null;

/** The text container id the genesis bytes create (peer 0, deterministic). */
export function expectedGenesisTextId(genesis: Uint8Array): string | null {
  if (genesisIdCache?.bytes !== genesis) {
    const g = new LoroDoc();
    g.import(genesis);
    genesisIdCache = { bytes: genesis, id: genesisTextId(g) };
  }
  return genesisIdCache.id;
}

export class PageMirror {
  readonly doc: LoroDoc;
  readonly undo: UndoManager;
  readonly ime = new ImeGuard();
  /** Called after each local update (word count, the app's undo stack). */
  onLocalUpdate: (() => void) | null = null;
  private outbox: Uint8Array[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** The mirror's version when its updates were last handed to the core. */
  private shipped: VersionVector;
  private shipping: Promise<void> = Promise.resolve();
  private readonly unsubscribe: () => void;
  private disposed = false;

  private constructor(
    readonly page: OpenedPage,
    seed: Uint8Array,
    private readonly host: MirrorHost,
  ) {
    const doc = new LoroDoc();
    doc.setPeerId(page.mirrorPeer as `${number}`);
    doc.setRecordTimestamp(true);
    doc.setChangeMergeInterval(page.mergeIntervalSecs);
    doc.import(seed);
    // Never let the binding initialise an empty document (spike rule b): a page stored without its genesis gets
    // the shared genesis (identical bytes on every peer, deduplicated by Loro).
    if (doc.getMap("doc").size === 0) {
      doc.import(host.genesis);
      this.ship(host.genesis);
    }
    this.doc = doc;
    this.unsubscribe = doc.subscribeLocalUpdates((bytes) => {
      this.ship(bytes);
      this.onLocalUpdate?.();
    });
    this.undo = new UndoManager(doc, { mergeInterval: UNDO_MERGE_MS, maxUndoSteps: 500 });
    this.shipped = doc.oplogVersion();
  }

  /** Seeds a mirror for an opened page from the core. */
  static async open(page: OpenedPage, host: MirrorHost): Promise<PageMirror> {
    const seed = await host.exportUpdates(page.docId, new Uint8Array());
    return new PageMirror(page, seed, host);
  }

  get docId(): string {
    return this.page.docId;
  }

  /** Whether the mirror still holds the genesis text container the core created (the first keystroke reuses it). */
  hasGenesis(): boolean {
    const id = expectedGenesisTextId(this.host.genesis);
    return id !== null && this.doc.getContainerById(id as never) !== undefined;
  }

  private ship(bytes: Uint8Array): void {
    this.outbox.push(bytes);
    // Shipped in a task of their own, a few keystrokes together (the keystroke's task only commits to the mirror);
    // strictly in order.
    this.timer ??= setTimeout(() => this.drain(), SHIP_DELAY_MS);
  }

  private drain(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const batch = this.outbox;
    this.outbox = [];
    if (batch.length === 0) return;
    // Several local updates go as one: the mirror's updates since the last shipped version (the same operations
    // the `subscribeLocalUpdates` bytes carry, plus core changes pulled meanwhile, which the core skips as known).
    // One import, one log record instead of one per keystroke.
    const bytes = batch.length === 1 ? batch[0]! : this.doc.export({ mode: "update", from: this.shipped });
    this.shipped = this.doc.oplogVersion();
    this.shipping = this.shipping.then(async () => {
      await this.host.importUpdates(this.docId, bytes);
    });
  }

  /** Resolves when every local update has reached the core. */
  async settle(): Promise<void> {
    this.drain();
    await this.shipping;
    if (this.outbox.length) await this.settle();
  }

  /** Brings changes the core has and the mirror lacks into the editor (held during IME composition). */
  async pull(): Promise<void> {
    if (this.disposed) return;
    const bytes = await this.host.exportUpdates(this.docId, this.doc.oplogVersion().encode());
    this.ime.run(() => {
      if (!this.disposed) this.doc.import(bytes);
    });
  }

  dispose(): void {
    this.drain();
    this.disposed = true;
    this.unsubscribe();
    // The UndoManager stays alive until the editor using it is gone (its plugin still reads it while unmounting).
  }
}
