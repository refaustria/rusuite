// Tiptap ↔ Rust synchronisation (ADR 0007 §1–§2, §5).
//
// * `idTaggerPlugin` gives every new block node (Enter, paste, list or
//   table edits) a temporary negative id; duplicated ids (a split copies
//   the attributes) are re-tagged on the later node.
// * `SyncController` turns every local transaction into a `WriteCommand`
//   (`transactionMapper`), sends the commands strictly in order, rewrites
//   temporary ids from each patch's `idMap`, and reconciles the patch:
//   every reported block is compared with the local node and only replaced
//   on mismatch (selection kept by block id and char offset). Stale
//   revisions are discarded; an `err` reply reloads the whole document.
//   Undo/redo (Ctrl+Z / Ctrl+Y) are Rust requests whose patches are applied
//   the same way.

import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { base64ToBytes } from "@rusuite/ui-shared";
import { WriteApiError, type EditRequest, type PatchEnvelope, type WriteApi } from "../backend";
import type { Block } from "../generated/Block";
import type { Document } from "../generated/Document";
import type { Numbering } from "../generated/Numbering";
import type { PageSetup } from "../generated/PageSetup";
import type { StyleSheet } from "../generated/StyleSheet";
import type { WriteCommand } from "../generated/WriteCommand";
import type { WritePatch } from "../generated/WritePatch";
import { blockAt } from "./fromPM";
import { blockKey, stableStringify, substituteBlock } from "./model";
import { ID_NODE_TYPES, LIST_TYPES } from "./schema";
import { blocksToPM, toPM } from "./toPM";
import { mapDocChange, topBlocks, type MapperOptions, type MapResult } from "./transactionMapper";

/** Transaction meta key: `"remote"` marks changes that come from Rust. */
export const SYNC_META = "rusuiteSync";

let tempSeq = 0;
/** A fresh temporary (negative) node id. */
export const nextTempId = (): number => --tempSeq;

// ----- id tagging ------------------------------------------------------------

export const idTaggerKey = new PluginKey("rusuiteIdTagger");

/** Tags id-less and duplicated block nodes with temporary ids. */
export function idTaggerPlugin(): Plugin {
  return new Plugin({
    key: idTaggerKey,
    appendTransaction(trs, _old, state) {
      if (!trs.some((t) => t.docChanged && t.getMeta(SYNC_META) !== "remote")) return null;
      const seen = new Set<number>();
      let tr: Transaction | null = null;
      state.doc.descendants((node, pos) => {
        if (node.isTextblock || ID_NODE_TYPES.has(node.type.name)) {
          if (ID_NODE_TYPES.has(node.type.name)) {
            const id = node.attrs.id as number | null;
            if (id == null || seen.has(id)) {
              tr ??= state.tr;
              const t = nextTempId();
              tr.setNodeAttribute(pos, "id", t);
              seen.add(t);
            } else seen.add(id);
          }
        }
        return !node.isTextblock;
      });
      return tr;
    },
  });
}

// ----- positions: PM ↔ (block id, char offset) ---------------------------------

/** Char offset (Unicode scalars; atoms count 1) of PM offset `pmOffset` inside textblock `block`. */
export function charOffsetOf(block: PMNode, pmOffset: number): number {
  let pm = 0;
  let chars = 0;
  for (let i = 0; i < block.childCount && pm < pmOffset; i++) {
    const child = block.child(i);
    if (child.isText) {
      const text = child.text!.slice(0, Math.max(0, pmOffset - pm));
      chars += [...text].length;
      pm += child.nodeSize;
    } else {
      chars += 1;
      pm += child.nodeSize;
    }
  }
  return chars;
}

/** PM offset inside textblock `block` of char offset `chars`. */
export function pmOffsetOf(block: PMNode, chars: number): number {
  let pm = 0;
  let left = chars;
  for (let i = 0; i < block.childCount && left > 0; i++) {
    const child = block.child(i);
    if (child.isText) {
      let units = 0;
      for (const ch of child.text!) {
        if (left === 0) break;
        units += ch.length;
        left--;
      }
      pm += units;
    } else {
      pm += child.nodeSize;
      left--;
    }
  }
  return pm;
}

type Point = { id: number; offset: number; pos: number };

function pointAt(doc: PMNode, pos: number): Point {
  const $p = doc.resolve(pos);
  const id = $p.parent.isTextblock ? ($p.parent.attrs.id as number | null) : null;
  return { id: id ?? NaN, offset: id == null ? 0 : charOffsetOf($p.parent, $p.parentOffset), pos };
}

/** Position of the node with block id `id`, or -1. */
export function findPos(doc: PMNode, id: number): number {
  let found = -1;
  doc.descendants((node, pos) => {
    if (found >= 0) return false;
    if (ID_NODE_TYPES.has(node.type.name) && node.attrs.id === id) {
      found = pos;
      return false;
    }
    return !node.isTextblock;
  });
  return found;
}

function resolvePoint(doc: PMNode, p: Point, fallback: number): number {
  if (!Number.isNaN(p.id)) {
    const pos = findPos(doc, p.id);
    const node = pos >= 0 ? doc.nodeAt(pos) : null;
    if (node?.isTextblock) return pos + 1 + Math.min(pmOffsetOf(node, p.offset), node.content.size);
  }
  return Math.max(0, Math.min(fallback, doc.content.size));
}

// ----- media -----------------------------------------------------------------

/** `GetMedia` results as object URLs (data URLs where blobs are unavailable). */
export class MediaCache {
  private urls = new Map<number, Promise<string>>();
  constructor(private readonly api: WriteApi) {}

  resolve = (id: number): Promise<string> => {
    let url = this.urls.get(id);
    if (!url) {
      url = this.api.getMedia(id).then((m) => {
        if (typeof URL.createObjectURL === "function") {
          return URL.createObjectURL(new Blob([base64ToBytes(m.bytesBase64) as BlobPart], { type: m.contentType }));
        }
        return `data:${m.contentType};base64,${m.bytesBase64}`;
      });
      url.catch(() => this.urls.delete(id));
      this.urls.set(id, url);
    }
    return url;
  };

  clear(): void {
    for (const u of this.urls.values()) {
      u.then((s) => s.startsWith("blob:") && URL.revokeObjectURL(s)).catch(() => undefined);
    }
    this.urls.clear();
  }
}

// ----- controller --------------------------------------------------------------

export interface Toast {
  id: number;
  message: string;
}

export interface SyncState {
  ready: boolean;
  revision: number;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** Document file name (`null` = new document). */
  name: string | null;
  /** Last `info` message of a patch (e.g. "3 replacements"). */
  info: string | null;
  /** Reader warnings of the last opened file. */
  warnings: string[];
  toasts: Toast[];
}

/** Dev statistics (exposed as `window.__rusuiteWriteSync` in dev builds). */
export interface SyncStats {
  sent: number;
  /** Optimistic edits whose patch differed from the local node (node replaced). */
  mismatches: number;
  /** Patches applied that the editor did not have yet (undo/redo, Rust-first commands). */
  applied: number;
  /** Local lists updated with the numbering id Rust allocated (not a mismatch). */
  listIdUpdates: number;
  reloads: number;
  stale: number;
}

interface Pending {
  request: EditRequest;
  /** `optimistic`: the editor already shows the change; `remote`: Rust-first. */
  kind: "optimistic" | "remote";
  followUp?: MapResult["followUp"];
}

const ID_KEYS = new Set(["block", "blocks", "ids", "after", "parent", "id", "table", "cells"]);

/** Every number under an id key (for remapping and skip sets). */
function mapIds(value: unknown, f: (n: number) => number): unknown {
  if (Array.isArray(value)) return value.map((v) => mapIds(v, f));
  if (typeof value !== "object" || value === null) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (ID_KEYS.has(k) && typeof v === "number") out[k] = f(v);
    else if (ID_KEYS.has(k) && Array.isArray(v) && v.every((x) => typeof x === "number")) out[k] = v.map(f);
    else out[k] = mapIds(v, f);
  }
  return out;
}

export class SyncController {
  private view: EditorView | null = null;
  readonly media: MediaCache;
  numbering: Numbering = { defs: [] };
  styles: StyleSheet | null = null;
  page: PageSetup | null = null;
  readonly stats: SyncStats = { sent: 0, mismatches: 0, applied: 0, listIdUpdates: 0, reloads: 0, stale: 0 };
  private queue: Pending[] = [];
  private busy = false;
  private idleWaiters: (() => void)[] = [];
  private tempMap = new Map<number, number>();
  private remote = 0;
  private toastSeq = 0;
  private state: SyncState = {
    ready: false, revision: 0, dirty: false, canUndo: false, canRedo: false, name: null, info: null, warnings: [], toasts: [],
  };
  private listeners = new Set<() => void>();

  constructor(readonly api: WriteApi) {
    this.media = new MediaCache(api);
    if (import.meta.env?.DEV && typeof window !== "undefined") {
      (window as unknown as { __rusuiteWriteSync?: SyncStats }).__rusuiteWriteSync = this.stats;
    }
  }

  // --- store plumbing ---

  getState = (): SyncState => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private set(partial: Partial<SyncState>): void {
    this.state = { ...this.state, ...partial };
    for (const fn of this.listeners) fn();
  }

  pushError(e: unknown): void {
    const message = e instanceof WriteApiError ? `${e.code}: ${e.message}` : e instanceof Error ? e.message : String(e);
    const id = ++this.toastSeq;
    this.set({ toasts: [...this.state.toasts, { id, message }] });
  }

  dismissToast(id: number): void {
    this.set({ toasts: this.state.toasts.filter((t) => t.id !== id) });
  }

  // --- editor wiring ---

  attach(view: EditorView): void {
    this.view = view;
  }

  detach(): void {
    this.view = null;
  }

  get editorView(): EditorView | null {
    return this.view;
  }

  /** Resolves when every queued request has been answered. */
  idle(): Promise<void> {
    if (!this.busy && this.queue.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  mapperOptions(): MapperOptions {
    const def = this.styles?.styles.find((s) => s.kind === "paragraph" && s.isDefault);
    return {
      defaultStyle: def?.id ?? "Normal",
      listKindOf: (numId) => {
        const d = this.numbering.defs.find((x) => x.id === numId);
        if (!d) return null;
        return d.levels[0]?.kind === "bullet" ? "bullet" : "decimal";
      },
    };
  }

  /** Dispatches a transaction that must not be mapped back to a command. */
  private dispatchRemote(tr: Transaction): void {
    if (!this.view) return;
    tr.setMeta(SYNC_META, "remote").setMeta("addToHistory", false);
    this.remote++;
    try {
      this.view.dispatch(tr);
    } finally {
      this.remote--;
    }
  }

  /** Called by the sync plugin after every state update. */
  onUpdate(view: EditorView, prev: EditorState): void {
    if (this.remote > 0 || !this.state.ready || prev.doc === view.state.doc) return;
    let result: MapResult | null;
    try {
      result = mapDocChange(prev.doc, view.state.doc, this.mapperOptions());
    } catch (e) {
      this.pushError(e);
      void this.reload();
      return;
    }
    if (result) this.enqueue({ request: { type: "apply", command: result.command }, kind: "optimistic", followUp: result.followUp });
  }

  // --- documents ---

  /** Shows `doc`; `keepSelection` (reloads) keeps the cursor by block id, else it goes to the start. */
  private setDocument(doc: Document, env: PatchEnvelope, name: string | null = this.state.name, keepSelection = false): void {
    this.numbering = doc.numbering;
    this.styles = doc.styles;
    this.page = doc.page;
    this.tempMap.clear();
    const view = this.view;
    if (view) {
      const pm = toPM(doc, view.state.schema);
      const { anchor, head } = view.state.selection;
      const pa = pointAt(view.state.doc, anchor);
      const ph = pointAt(view.state.doc, head);
      const tr = view.state.tr.replaceWith(0, view.state.doc.content.size, pm.content);
      const a = keepSelection ? resolvePoint(tr.doc, pa, anchor) : 1;
      const h = keepSelection ? resolvePoint(tr.doc, ph, head) : 1;
      tr.setSelection(TextSelection.between(tr.doc.resolve(a), tr.doc.resolve(h)));
      this.dispatchRemote(tr);
    }
    this.set({
      ready: true, revision: env.revision, dirty: env.dirty, canUndo: env.canUndo, canRedo: env.canRedo, name,
    });
  }

  async newDocument(): Promise<void> {
    await this.idle();
    try {
      const body = await this.api.newDocument();
      this.media.clear();
      this.setDocument(body.doc, body.envelope, null);
      this.set({ warnings: [], info: null });
    } catch (e) {
      this.pushError(e);
    }
  }

  async load(doc: Document, name: string | null = null): Promise<void> {
    await this.idle();
    try {
      const body = await this.api.load(doc);
      this.media.clear();
      this.setDocument(body.doc, body.envelope, name);
    } catch (e) {
      this.pushError(e);
    }
  }

  /** Opens a `.docx` file (`OpenDocx`); reader warnings go to the state. */
  async openDocx(bytesBase64: string, name: string): Promise<boolean> {
    await this.idle();
    try {
      const body = await this.api.openDocx(bytesBase64, name);
      this.media.clear();
      this.setDocument(body.doc, body.envelope, name);
      this.set({ warnings: body.warnings, info: null });
      return true;
    } catch (e) {
      this.pushError(e);
      return false;
    }
  }

  /**
   * Saves as `.docx`: `SaveDocx`, then `save(name, bytes)` (the shell's
   * file dialog / download); only when that succeeds, `MarkSaved`. `asName`
   * (Save As) replaces the suggested name.
   */
  async saveDocx(save: (suggestedName: string, bytesBase64: string) => Promise<boolean>, asName?: string): Promise<boolean> {
    await this.idle();
    try {
      const file = await this.api.saveDocx();
      const name = asName ?? file.suggestedName;
      if (!(await save(name, file.bytesBase64))) return false;
      const st = await this.api.markSaved(name);
      this.set({ dirty: st.dirty, name: st.name, revision: Math.max(this.state.revision, st.revision) });
      return true;
    } catch (e) {
      this.pushError(e);
      return false;
    }
  }

  /** Replaces the editor content by Rust's document (after an error). */
  async reload(): Promise<void> {
    this.stats.reloads++;
    try {
      const body = await this.api.getDocument();
      this.setDocument(body.doc, body.envelope, this.state.name, true);
    } catch (e) {
      this.pushError(e);
    }
  }

  // --- requests ---

  undo(): void {
    this.enqueue({ request: { type: "undo" }, kind: "remote" });
  }

  redo(): void {
    this.enqueue({ request: { type: "redo" }, kind: "remote" });
  }

  /** A Rust-first command (image/table insertion, find/replace, …): the patch updates the editor. */
  run(command: WriteCommand): Promise<void> {
    this.enqueue({ request: { type: "apply", command }, kind: "remote" });
    return this.idle();
  }

  private enqueue(p: Pending): void {
    this.queue.push(p);
    void this.pump();
  }

  private async pump(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      while (this.queue.length) await this.process(this.queue.shift()!);
    } finally {
      this.busy = false;
      const waiters = this.idleWaiters;
      this.idleWaiters = [];
      waiters.forEach((w) => w());
    }
  }

  private realId = (n: number): number => (n < 0 ? (this.tempMap.get(n) ?? n) : n);

  private async process(p: Pending): Promise<void> {
    const request = mapIds(p.request, this.realId) as EditRequest;
    this.stats.sent++;
    let env: PatchEnvelope;
    try {
      env = await this.api.send(request);
    } catch (e) {
      this.pushError(e);
      // Later commands were computed against the rejected state.
      this.queue = [];
      await this.reload();
      return;
    }
    if (env.revision < this.state.revision) {
      this.stats.stale++;
      return;
    }
    const patch = env.patch;
    for (const [t, r] of patch.idMap) this.tempMap.set(t, r);
    if (patch.numbering) this.numbering = patch.numbering;
    if (patch.styles) this.styles = patch.styles;
    if (patch.page) this.page = patch.page;
    this.set({
      revision: env.revision, dirty: env.dirty, canUndo: env.canUndo, canRedo: env.canRedo, info: patch.info ?? this.state.info,
    });
    this.renameIds(patch.idMap);
    try {
      this.reconcile(patch, p.kind);
    } catch (e) {
      this.pushError(e);
      this.queue = [];
      await this.reload();
      return;
    }
    if (p.followUp) {
      this.queue.unshift({
        request: { type: "apply", command: { type: "applyList", blocks: p.followUp.ids, kind: p.followUp.kind } },
        kind: "remote",
      });
    }
  }

  /** Rewrites temporary ids to the real ids of an `idMap`. */
  private renameIds(idMap: WritePatch["idMap"]): void {
    const view = this.view;
    if (!view || idMap.length === 0) return;
    const map = new Map(idMap);
    const tr = view.state.tr;
    view.state.doc.descendants((node, pos) => {
      if (ID_NODE_TYPES.has(node.type.name) && map.has(node.attrs.id)) tr.setNodeAttribute(pos, "id", map.get(node.attrs.id));
      return !node.isTextblock;
    });
    if (tr.docChanged) this.dispatchRemote(tr);
  }

  /** Ids that queued (not yet answered) requests will touch again. */
  private pendingIds(): Set<number> {
    const ids = new Set<number>();
    for (const p of this.queue) {
      mapIds(p.request, (n) => {
        ids.add(n);
        ids.add(this.realId(n));
        return n;
      });
    }
    return ids;
  }

  /**
   * Compares every block of the patch with the editor and fixes the
   * differences (ADR 0007 §1).
   */
  private reconcile(patch: WritePatch, kind: Pending["kind"]): void {
    const view = this.view;
    if (!view) return;
    const doc = view.state.doc;
    const skip = this.pendingIds();
    const oldBody: Block[] = [];
    doc.forEach((n) => oldBody.push(...topBlocks(n)));
    const topIndex = new Map(oldBody.map((b, i) => [b.value.id, i]));
    const insertedIds = new Set(patch.inserted.map((i) => i.block.value.id));

    let body: Block[] | null = null;
    let mismatch = false;
    let listIdsOnly = true;
    const adopted: [number, number, number][] = [];
    const edit = (): Block[] => (body ??= structuredClone(oldBody));
    const localBlock = (id: number): Block | null => {
      const pos = findPos(doc, id);
      return pos < 0 ? null : blockAt(doc, pos);
    };
    const compare = (local: Block, remote: Block): "equal" | "lists" | "differ" => {
      if (blockKey(local) === blockKey(remote)) return "equal";
      return blockKey(withRemoteListIds(local, remote)) === blockKey(remote) ? "lists" : "differ";
    };
    const removeTop = (b: Block[], id: number) => {
      const i = b.findIndex((x) => x.value.id === id);
      if (i >= 0) b.splice(i, 1);
      return i >= 0;
    };

    for (const id of patch.deleted) {
      if (insertedIds.has(id) || skip.has(id)) continue;
      if (topIndex.has(id)) {
        removeTop(edit(), id);
        mismatch = true;
        listIdsOnly = false;
      }
    }
    for (const ins of patch.inserted) {
      const id = ins.block.value.id;
      if (skip.has(id)) continue;
      const local = localBlock(id);
      const i = topIndex.get(id);
      const prev = i === undefined ? undefined : i > 0 ? oldBody[i - 1]!.value.id : null;
      const placed = ins.parent != null || (local !== null && prev === ins.after);
      const cmp = local ? compare(local, ins.block) : "differ";
      if (placed && cmp === "equal") continue;
      mismatch = true;
      if (cmp !== "lists" || !placed) listIdsOnly = false;
      else adopted.push([id, numIdOf(local!)!, numIdOf(ins.block)!]);
      const b = edit();
      if (placed) {
        substituteBlock(b, id, ins.block);
        continue;
      }
      removeTop(b, id);
      const at = ins.after == null ? 0 : b.findIndex((x) => x.value.id === ins.after) + 1;
      if (at === 0 && ins.after != null) throw new Error(`patch inserts after unknown block ${ins.after}`);
      b.splice(at, 0, ins.block);
    }
    for (const block of patch.replaced) {
      const id = block.value.id;
      if (skip.has(id)) continue;
      const local = localBlock(id);
      if (!local) throw new Error(`patch replaces unknown block ${id}`);
      const cmp = compare(local, block);
      if (cmp === "equal") continue;
      mismatch = true;
      if (cmp !== "lists") listIdsOnly = false;
      else adopted.push([id, (local.value as { props: { numbering: { numId: number } } }).props.numbering.numId, numIdOf(block)!]);
      substituteBlock(edit(), id, block);
    }
    if (!mismatch || !body) return;
    // The other items of a new list take over the real numbering id too.
    for (const [id, synthetic, real] of adopted) adoptListId(body, id, synthetic, real);
    if (kind === "remote") this.stats.applied++;
    else if (listIdsOnly) this.stats.listIdUpdates++;
    else {
      this.stats.mismatches++;
      if (import.meta.env?.DEV) {
        console.warn(`[write-sync] patch mismatch → node replaced (#${this.stats.mismatches})`, patch);
      }
    }
    this.rerender(oldBody, body);
  }

  /** Re-renders the top-level nodes covering the difference `oldBody → newBody`. */
  private rerender(oldBody: Block[], newBody: Block[]): void {
    const view = this.view!;
    const doc = view.state.doc;
    let a = 0;
    while (a < oldBody.length && a < newBody.length && blockKey(oldBody[a]!) === blockKey(newBody[a]!)) a++;
    let z = 0;
    while (
      z < oldBody.length - a &&
      z < newBody.length - a &&
      blockKey(oldBody[oldBody.length - 1 - z]!) === blockKey(newBody[newBody.length - 1 - z]!)
    ) z++;
    if (a === oldBody.length && a === newBody.length) return;
    // Model index → top-level node index.
    const counts: number[] = [];
    const nodes: PMNode[] = [];
    doc.forEach((n) => {
      nodes.push(n);
      counts.push(topBlocks(n).length);
    });
    const starts: number[] = [];
    counts.reduce((s, c, i) => ((starts[i] = s), s + c), 0);
    const nodeOf = (m: number) => {
      for (let i = counts.length - 1; i >= 0; i--) if (starts[i]! <= m && counts[i]! > 0) return i;
      return 0;
    };
    const last = counts.length - 1;
    let s0 = a >= oldBody.length ? last : nodeOf(a);
    let e0 = Math.max(s0, nodeOf(Math.max(a, oldBody.length - z - 1)));
    e0 = Math.min(e0, last);
    // Lists may merge with or split from their neighbours.
    if (s0 > 0 && LIST_TYPES.has(nodes[s0 - 1]!.type.name)) s0--;
    if (e0 < last && LIST_TYPES.has(nodes[e0 + 1]!.type.name)) e0++;
    const mStart = starts[s0]!;
    const mEndOld = starts[e0]! + counts[e0]!;
    const mEndNew = mEndOld + (newBody.length - oldBody.length);
    let from = 0;
    for (let i = 0; i < s0; i++) from += nodes[i]!.nodeSize;
    let to = from;
    for (let i = s0; i <= e0; i++) to += nodes[i]!.nodeSize;
    const fresh = blocksToPM({ schema: view.state.schema, numbering: this.numbering }, newBody.slice(mStart, mEndNew));
    const { anchor, head } = view.state.selection;
    const pa = pointAt(doc, anchor);
    const ph = pointAt(doc, head);
    const tr = view.state.tr.replaceWith(from, to, fresh);
    const an = resolvePoint(tr.doc, pa, tr.mapping.map(anchor));
    const hd = resolvePoint(tr.doc, ph, tr.mapping.map(head));
    try {
      tr.setSelection(TextSelection.between(tr.doc.resolve(an), tr.doc.resolve(hd)));
    } catch {
      // Keep the mapped selection.
    }
    this.dispatchRemote(tr);
  }
}

const numIdOf = (b: Block): number | undefined => (b.kind === "paragraph" ? b.value.props?.numbering?.numId : undefined);

/** Sets `real` on the numbered paragraphs around `id` that still carry the `synthetic` id. */
function adoptListId(body: Block[], id: number, synthetic: number, real: number): void {
  const at = body.findIndex((b) => b.value.id === id);
  if (at < 0) return;
  const fix = (i: number) => {
    const b = body[i];
    if (b?.kind !== "paragraph" || !b.value.props?.numbering || b.value.props.numbering.numId === 0) return false;
    if (b.value.props.numbering.numId === synthetic) {
      body[i] = { kind: "paragraph", value: { ...b.value, props: { ...b.value.props, numbering: { ...b.value.props.numbering, numId: real } } } };
    }
    return true;
  };
  for (let i = at - 1; fix(i); i--);
  for (let i = at + 1; fix(i); i++);
}

/** `local` with the numbering ids of `remote` where the local ids are synthetic (new lists). */
function withRemoteListIds(local: Block, remote: Block): Block {
  if (local.kind !== "paragraph" || remote.kind !== "paragraph") return local;
  const ln = local.value.props?.numbering;
  const rn = remote.value.props?.numbering;
  if (!ln || !rn || ln.numId >= 0) return local;
  return { kind: "paragraph", value: { ...local.value, props: { ...local.value.props, numbering: { ...ln, numId: rn.numId } } } };
}

// ----- Tiptap extension ----------------------------------------------------------

export const syncKey = new PluginKey("rusuiteSync");

/** Id tagging, transaction → command sync and Rust undo/redo for one controller. */
export function SyncExtension(controller: SyncController) {
  return Extension.create({
    name: "rusuiteSync",
    addKeyboardShortcuts() {
      const undo = () => (controller.undo(), true);
      const redo = () => (controller.redo(), true);
      return { "Mod-z": undo, "Mod-y": redo, "Shift-Mod-z": redo };
    },
    addProseMirrorPlugins() {
      return [
        idTaggerPlugin(),
        new Plugin({
          key: syncKey,
          view(view) {
            controller.attach(view);
            return {
              update: (v, prev) => controller.onUpdate(v, prev),
              destroy: () => controller.detach(),
            };
          },
        }),
      ];
    },
  });
}

/** Stable JSON of a command (tests, logs). */
export const commandKey = (c: WriteCommand): string => stableStringify(c);
