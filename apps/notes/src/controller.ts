// The Notes app state and commands. The core (through `NotesBackend`) owns the documents; this controller keeps
// what the UI shows (open notebooks and their trees, the selection, the open page and its editor mirror), turns
// UI actions into core requests stamped with the UI clock, and hands every resulting persist effect to storage.

import { getSchema } from "@tiptap/core";
import { Node as PMNode } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { createNodeFromLoroObj, updateLoroToPmState, type LoroDocType } from "loro-prosemirror";
import { CoreError, unwrap, type Body, type NotesBackend, type NotesRequest } from "./backend";
import { LoroList, LoroMap } from "loro-crdt";
import { BlobUrls, sniffImage } from "./blobs";
import { ConvertCancelled, decodeFrame, frameJson } from "./convert/loader";
import { exportFileName, importKindOf, isOneNotePackage } from "./convert/formats";
import { frameRecords } from "./effects";
import type { ConvertWarning } from "./generated/ConvertWarning";
import type { ExportFormat } from "./generated/ExportFormat";
import type { ImportPlan } from "./generated/ImportPlan";
import type { DeletedNode } from "./generated/DeletedNode";
import type { HistoryEntry } from "./generated/HistoryEntry";
import type { PageRef } from "./generated/PageRef";
import type { SearchHit } from "./generated/SearchHit";
import type { TagDef } from "./generated/TagDef";
import type { TagKind } from "./generated/TagKind";
import type { TaskEntry } from "./generated/TaskEntry";
import type { TaskFilter } from "./generated/TaskFilter";
import type { VersionPreview } from "./generated/VersionPreview";
import type { LoadWarning } from "./generated/LoadWarning";
import type { NotebookSummary } from "./generated/NotebookSummary";
import type { OpenedPage } from "./generated/OpenedPage";
import type { ResponseBody } from "./generated/ResponseBody";
import type { TreeNode } from "./generated/TreeNode";
import { PageMirror, SHARED_SHIP_DELAY_MS } from "./editor/mirror";
import { notesSchemaExtensions } from "./editor/schema";
import { Persister } from "./persister";
import type { NotesStore } from "./store";
import { allPages, allSections, findNode, flatPages, indentTarget, MAX_PAGE_LEVEL, nextSectionColor, outdentTarget, sectionOf } from "./tree";
import { t } from "./i18n";
import { welcomeContent } from "./welcome";
import type { PersistEffect } from "./effects";
import { canWrite, type JoinInfo, type Role } from "./sync/crypto";
import type { SyncDocHost } from "./sync/engine";
import { parseInviteHash, type Profile, type ShareView, type SyncManager } from "./sync/manager";

export interface KnownNotebook {
  id: string;
  name: string;
  color: string | null;
  /** Open in this browser (loaded at start); closed notebooks stay stored. */
  open: boolean;
  lastOpened: number;
}

export interface RecentPage {
  notebook: string;
  docId: string;
  title: string;
  at: number;
}

export type Theme = "system" | "light" | "dark";

export interface Settings {
  theme: Theme;
  pageWidth: "normal" | "wide";
  zoom: number;
  navWidth: number;
  navOpen: boolean;
  persistHintDismissed: boolean;
}

export const DEFAULT_SETTINGS: Settings = { theme: "system", pageWidth: "normal", zoom: 1, navWidth: 300, navOpen: true, persistHintDismissed: false };

export interface OpenNotebook {
  summary: NotebookSummary;
  tree: TreeNode[];
}

export type StorageStatus = "persisted" | "denied" | "unknown";

/** The result dialog of File › Import (P11-N6b). */
export interface ImportSummary {
  /** Per file: its warnings, or why it was not imported. */
  files: { name: string; warnings: ConvertWarning[]; error?: string }[];
  notebooks: number;
  sections: number;
  pages: number;
  images: number;
  attachments: number;
  /** What "Open" shows: the first imported page (and whether a new notebook / a section was created). */
  open: { notebook: string; page: string | null; kind: "notebook" | "section" | "page" } | null;
  /** Stopped with Cancel: the files after the ones listed were not imported (P11-X1). */
  cancelled?: boolean;
}

/** A long command in progress (import, export, loading the converters): `done` of `total` steps. */
export interface BusyState {
  label: string;
  done: number;
  total: number;
  /** Cancel stops it (a conversion in the web's converter worker, P11-X1). */
  cancellable?: boolean;
}

export interface NotesState {
  phase: "loading" | "ready" | "failed";
  known: KnownNotebook[];
  notebooks: OpenNotebook[];
  notebook: string | null;
  section: string | null;
  /** The open page's tree node id. */
  page: string | null;
  /** The open page (core reply) and its editor mirror. */
  opened: OpenedPage | null;
  mirror: PageMirror | null;
  view: "page" | "recycleBin" | "tasks";
  recycle: DeletedNode[];
  /** Tag definitions per open notebook. */
  tags: Record<string, TagDef[]>;
  /** The tasks view: to-dos across the open notebooks. */
  tasks: TaskEntry[];
  taskFilter: TaskFilter;
  /** Only to-dos with this tag (null = all). */
  taskTag: string | null;
  /** The side panel of the page (View › Page history). */
  panel: "history" | null;
  /** The node to scroll to and highlight once the page shows (tasks view, search). */
  focus: { docId: string; path: number[]; at: number } | null;
  /** Find on page with this query once the page shows (a search result was opened). */
  find: { docId: string; query: string; at: number } | null;
  /** Another tab took over: nothing is written any more. */
  readOnly: boolean;
  recent: RecentPage[];
  settings: Settings;
  storage: StorageStatus;
  warnings: LoadWarning[];
  /** The last error message (a toast). */
  error: string | null;
  canUndo: boolean;
  canRedo: boolean;
  busy: BusyState | null;
  importResult: ImportSummary | null;
  /** Shared notebooks of this device (local notebook id, or `joining:<relay id>` while joining). */
  shares: Record<string, ShareView>;
  /** The display name for sharing (asked on first share / join). */
  profile: Profile | null;
  /** This device's sharing id (hex), once it has keys. */
  device: string | null;
  /** Join requests waiting for this owner's answer (toasts). */
  joinRequests: { localId: string; join: JoinInfo }[];
  /** Sharing notices (removed from a notebook, sharing stopped by the owner) per local notebook. */
  shareNotice: Record<string, "removed" | "stopped">;
}

/** The desktop shell's part (P11-N7, `src/tauri/`); `null` on the web. */
export interface DesktopHost {
  /** Where invite and page links point (the relay's web app, e.g. `https://rusuit.es/notes/`). */
  linkBase: string;
  /** A notebook has (or just got) its folder: the shell records it in its recent list. */
  touch(id: string, name: string): Promise<void>;
}

/** What the open page's editor does for the controller (registered by the page view). */
export interface PageEditorHooks {
  /** Ticks / unticks the to-do at `path` (child indices from the doc); false when there is none. */
  setChecked(path: readonly number[], checked: boolean): boolean;
}

/** The editor's undo/redo (registered by the page view). */
export interface EditorHistory {
  canUndo(): boolean;
  canRedo(): boolean;
  undo(): boolean;
  redo(): boolean;
}

const META_KNOWN = "notebooks";
const META_SELECTION = "selection";
const META_RECENT = "recent";
const META_SETTINGS = "settings";
const META_DEVICE = "deviceId";
export const RECENT_LIMIT = 10;
/** Recycle-bin entries are purged 60 days after deletion (notes-format §3). */
export const RECYCLE_BIN_MS = 60 * 24 * 3600 * 1000;

type Kind = ResponseBody["type"];

/** Requests that are fine on a read-only shared notebook besides `READ_ONLY_OK` (no edit of its docs). */
const SHARE_FREE = new Set<string>(["hello", "createNotebook", "openNotebook", "closeNotebook", "listNotebooks", "exportPage", "exportSection"]);

/** The notebook a request edits (`notebook` field, or the notebook of its `docId`). */
function requestNotebook(r: NotesRequest, notebookOfDoc: (doc: string) => string | null): string | null {
  const o = r as { notebook?: unknown; docId?: unknown };
  if (typeof o.notebook === "string") return o.notebook;
  if (typeof o.docId === "string") return notebookOfDoc(o.docId);
  return null;
}

/** Requests a read-only tab may still make (another tab took over writing). */
const READ_ONLY_OK = new Set<string>(["listNotebooks", "getTree", "recycleBin", "tags", "search", "tasks", "backlinks", "referencedBlobs", "history", "checkoutPreview", "openPage", "closePage", "importContext", "pageExportSource", "sectionExportSource"]);

/** Lets the browser paint (a progress step) before a long synchronous wasm call. */
const paint = () => new Promise<void>((r) => setTimeout(r, 16));

/** A random seed below 2^53 for the page doc ids of an import. */
const randomSeed = () => Math.floor(Math.random() * 2 ** 53);

export class NotesController {
  private state: NotesState = {
    phase: "loading",
    known: [],
    notebooks: [],
    notebook: null,
    section: null,
    page: null,
    opened: null,
    mirror: null,
    view: "page",
    recycle: [],
    tags: {},
    tasks: [],
    taskFilter: "open",
    taskTag: null,
    panel: null,
    focus: null,
    find: null,
    readOnly: false,
    recent: [],
    settings: DEFAULT_SETTINGS,
    storage: "unknown",
    warnings: [],
    error: null,
    canUndo: false,
    canRedo: false,
    busy: null,
    importResult: null,
    shares: {},
    profile: null,
    device: null,
    joinRequests: [],
    shareNotice: {},
  };
  private listeners = new Set<() => void>();
  readonly persister: Persister;
  private queue: Promise<unknown> = Promise.resolve();
  private genesis: Uint8Array | null = null;
  private editor: EditorHistory | null = null;
  /** Times of this session's structural edits (undo picks the newer of these and the last typing). */
  private treeOps: { notebook: string; at: number }[] = [];
  private treeRedo: { notebook: string; at: number }[] = [];
  private lastTextAt = 0;
  private undoneKinds: ("tree" | "text")[] = [];
  private schema = getSchema(notesSchemaExtensions());
  private pageHooks: PageEditorHooks | null = null;
  /** Object URLs of the notebooks' blobs (images, attachments). */
  readonly blobs: BlobUrls;
  /** The open page's cursor presence (diagnostics, e2e). */
  pagePresence: unknown = null;
  /** Sharing (P11-N5b); `null` until `attachSync` (tests without a relay). */
  sync: SyncManager | null = null;
  /** The desktop shell (notebook folders, link base); `null` on the web. */
  desktop: DesktopHost | null = null;
  /** The device id the core uses without sharing keys (`web-…`; its history entries are this device's). */
  private legacyDevice: string | null = null;

  constructor(
    readonly backend: NotesBackend,
    readonly store: NotesStore,
    /** The clock (Unix ms) stamped on every request. */
    private readonly now: () => number = Date.now,
    persister?: Persister,
  ) {
    this.persister = persister ?? new Persister(store);
    this.blobs = new BlobUrls(async (nb, sha) => (await this.store.getBlob(nb, sha)) ?? (await this.sync?.engineFor(nb)?.fetchBlob(sha)));
    const conv = backend.converter as { onLoading?: (loading: boolean) => void } | undefined;
    let before: BusyState | null = null;
    if (conv)
      conv.onLoading = (loading) => {
        if (loading) before = this.state.busy;
        this.set({ busy: loading ? { label: t("notes.convert.loading"), done: before?.done ?? 0, total: before?.total ?? 0 } : before });
      };
  }

  // ---- store --------------------------------------------------------------------------------------------

  getState = (): NotesState => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private set(patch: Partial<NotesState>): void {
    this.state = { ...this.state, ...patch };
    this.state.canUndo = this.computeCanUndo();
    this.state.canRedo = this.treeRedo.length > 0 || !!this.editor?.canRedo();
    for (const l of this.listeners) l();
  }

  /** Re-reads the editor's undo state (the page view calls it after transactions). */
  refreshHistory(): void {
    const canUndo = this.computeCanUndo();
    const canRedo = this.treeRedo.length > 0 || !!this.editor?.canRedo();
    if (canUndo !== this.state.canUndo || canRedo !== this.state.canRedo) this.set({});
  }

  private computeCanUndo(): boolean {
    return this.treeOps.length > 0 || !!this.editor?.canUndo();
  }

  /** Runs commands one after another (UI events may overlap). Errors become the toast. */
  private run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    const next = this.queue.then(fn).catch((e: unknown) => {
      this.fail(e);
      return undefined;
    });
    this.queue = next;
    return next;
  }

  fail(e: unknown): void {
    const message = e instanceof CoreError ? t("notes.error.core", { message: e.message }) : e instanceof Error ? e.message : String(e);
    console.warn("Rusuite Notes:", e);
    this.set({ error: message });
  }

  /** A message in the toast (not an error). */
  notify(message: string): void {
    this.set({ error: message });
  }

  dismissError(): void {
    this.set({ error: null });
  }

  // ---- core calls ---------------------------------------------------------------------------------------

  private async call<K extends Kind>(request: NotesRequest, _kind?: K): Promise<Body<K>> {
    if (this.state.readOnly && !READ_ONLY_OK.has(request.type)) throw new Error(t("notes.lock.readOnly"));
    if (!READ_ONLY_OK.has(request.type) && !SHARE_FREE.has(request.type)) {
      const nb = requestNotebook(request, (doc) => this.notebookOfDoc(doc));
      if (nb && this.sharedReadOnly(nb)) throw new Error(t("notes.share.readOnlyError"));
    }
    const body = unwrap(await this.backend.dispatch({ ...request, now: this.now() }));
    return body as Body<K>;
  }

  /** Moves the core's queued persist effects to storage (and the changed docs of shared notebooks to the relay). */
  private async pump(): Promise<void> {
    const effects = await this.backend.takePersistEffects();
    this.persister.enqueue(effects);
    if (this.sync && effects.length) this.forwardEffects(effects);
  }

  private forwardEffects(effects: readonly PersistEffect[]): void {
    const byNb = new Map<string, { docs: Set<string>; blobs: Set<string> }>();
    for (const e of effects) {
      if (e.kind === "delete") continue;
      let g = byNb.get(e.notebook);
      if (!g) byNb.set(e.notebook, (g = { docs: new Set(), blobs: new Set() }));
      (e.kind === "blob" ? g.blobs : g.docs).add(e.doc);
    }
    for (const [nb, g] of byNb) this.sync!.changed(nb, g.docs, g.blobs);
  }

  private async genesisBytes(): Promise<Uint8Array> {
    this.genesis ??= await this.backend.pageGenesis();
    return this.genesis;
  }

  // ---- start --------------------------------------------------------------------------------------------

  /** Loads the notebooks of this browser; on the very first start creates "My notebook" with a welcome page. */
  start(): Promise<void> {
    return this.run(async () => {
      let device = await this.store.getMeta<string>(META_DEVICE);
      if (!device) {
        device = `web-${Math.random().toString(36).slice(2, 10)}`;
        await this.store.setMeta(META_DEVICE, device);
      }
      this.legacyDevice = device;
      if (this.sync) {
        await this.sync.init();
        // With sharing keys the core records changes under the sharing device id (names in history, last editor).
        if (this.sync.device) device = this.sync.device;
        this.set({ profile: this.sync.profile, device: this.sync.device });
      }
      await this.call({ type: "hello", deviceId: device });
      const settings = { ...DEFAULT_SETTINGS, ...((await this.store.getMeta<Partial<Settings>>(META_SETTINGS)) ?? {}) };
      const known = (await this.store.getMeta<KnownNotebook[]>(META_KNOWN)) ?? [];
      const recent = (await this.store.getMeta<RecentPage[]>(META_RECENT)) ?? [];
      this.set({ settings, known, recent });
      const warnings: LoadWarning[] = [];
      const notebooks: OpenNotebook[] = [];
      for (const k of known.filter((k) => k.open)) {
        try {
          const nb = await this.loadFromStore(k.id, warnings);
          if (nb) notebooks.push(nb);
        } catch (e) {
          this.fail(e);
        }
      }
      this.set({ notebooks, warnings });
      if (known.length === 0) {
        await this.createWelcome();
      } else {
        const sel = await this.store.getMeta<{ notebook: string; section: string | null; page: string | null }>(META_SELECTION);
        const nb = notebooks.find((n) => n.summary.id === sel?.notebook) ?? notebooks[0];
        if (nb) await this.selectIn(nb.summary.id, sel?.notebook === nb.summary.id ? sel.section : null, sel?.notebook === nb.summary.id ? sel.page : null);
      }
      await this.pump();
      this.set({ phase: "ready" });
      void this.requestPersistence();
      if (this.sync) {
        await this.sync.startOpen((id) => this.state.notebooks.some((n) => n.summary.id === id));
        this.refreshShares();
      }
    }).then(() => {
      if (this.state.phase === "loading") this.set({ phase: "failed" });
    });
  }

  /** `navigator.storage.persist()`; denied → the backup hint. */
  private async requestPersistence(): Promise<void> {
    // Desktop: notebooks are folders on disk; nothing can evict them.
    if (this.desktop) return this.set({ storage: "persisted" });
    const s = typeof navigator === "undefined" ? undefined : navigator.storage;
    if (!s?.persist) return this.set({ storage: "denied" });
    try {
      const ok = (await s.persisted?.()) || (await s.persist());
      this.set({ storage: ok ? "persisted" : "denied" });
    } catch {
      this.set({ storage: "denied" });
    }
  }

  /** Loads a stored notebook into the core. `null` when nothing of it is stored. */
  private async loadFromStore(id: string, warnings: LoadWarning[]): Promise<OpenNotebook | null> {
    const docs = await this.store.loadNotebook(id);
    warnings.push(...(this.store.takeWarnings?.() ?? []));
    if (!docs.some((d) => d.doc === id)) return null;
    for (const d of docs) {
      const r = unwrap(await this.backend.loadDoc(id, d.doc, d.snapshot, d.log)) as Body<"loaded">;
      warnings.push(...r.warnings);
    }
    const opened = (await this.call({ type: "openNotebook", id })) as Body<"notebook">;
    await this.loadTags(id);
    if (this.sync?.device) await this.rebind();
    return { summary: normalizeSummary(opened.notebook), tree: opened.tree };
  }

  private async createWelcome(): Promise<void> {
    const nb = (await this.call({ type: "createNotebook", name: t("notes.welcome.notebook") })) as Body<"notebook">;
    const id = nb.notebook.id;
    const section = (await this.call({ type: "createSection", notebook: id, title: t("notes.welcome.section") })) as Body<"created">;
    await this.call({ type: "setColor", notebook: id, node: section.id, color: nextSectionColor(0) });
    const page = (await this.call({ type: "createPage", notebook: id, parent: section.id, title: t("notes.welcome.title") })) as Body<"pageCreated">;
    await this.writeContent(page.page.docId, welcomeContent());
    await this.addKnown(id, nb.notebook.info.name, nb.notebook.info.color);
    await this.refreshNotebook(id);
    await this.selectIn(id, section.id, page.page.node);
  }

  /** Writes ProseMirror JSON into a page doc through a mirror (the binding's own conversion). */
  private async writeContent(docId: string, json: object): Promise<void> {
    const opened = ((await this.call({ type: "openPage", docId })) as Body<"page">).page;
    const mirror = await PageMirror.open(opened, this.mirrorHost());
    const state = EditorState.create({ schema: this.schema, doc: PMNode.fromJSON(this.schema, json) });
    updateLoroToPmState(mirror.doc as unknown as LoroDocType, new Map(), state);
    await mirror.settle();
    mirror.dispose();
    await this.call({ type: "closePage", docId });
  }

  /** A page's content as ProseMirror JSON (read through a mirror and the binding's own conversion). */
  private async readContent(docId: string): Promise<object> {
    await this.genesisBytes();
    const opened = ((await this.call({ type: "openPage", docId })) as Body<"page">).page;
    const mirror = await PageMirror.open(opened, this.mirrorHost());
    const json = createNodeFromLoroObj(this.schema, mirror.doc.getMap("doc") as never, new Map()).toJSON() as object;
    mirror.dispose();
    await this.call({ type: "closePage", docId });
    return json;
  }

  private mirrorHost() {
    const genesis = this.genesis!;
    return {
      genesis,
      exportUpdates: (doc: string, vv: Uint8Array) => this.backend.exportUpdates(doc, vv),
      importUpdates: async (doc: string, bytes: Uint8Array) => {
        unwrap(await this.backend.importUpdates(doc, bytes));
        await this.pump();
      },
    };
  }

  // ---- known notebooks ----------------------------------------------------------------------------------

  private async saveKnown(known: KnownNotebook[]): Promise<void> {
    this.set({ known });
    await this.store.setMeta(META_KNOWN, known);
  }

  private async addKnown(id: string, name: string, color: string | null): Promise<void> {
    const rest = this.state.known.filter((k) => k.id !== id);
    await this.saveKnown([...rest, { id, name, color, open: true, lastOpened: this.now() }]);
    if (this.desktop) {
      // The folder exists once the notebook's first writes landed.
      await this.persister.flush();
      await this.desktop.touch(id, name).catch(() => undefined);
    }
  }

  /** Re-reads a notebook's summary and tree from the core. */
  private async refreshNotebook(id: string): Promise<void> {
    const list = ((await this.call({ type: "listNotebooks" })) as Body<"notebooks">).notebooks.map(normalizeSummary);
    const summary = list.find((s) => s.id === id);
    if (!summary) return;
    const tree = ((await this.call({ type: "getTree", notebook: id })) as Body<"tree">).tree;
    const others = this.state.notebooks.filter((n) => n.summary.id !== id);
    const idx = this.state.notebooks.findIndex((n) => n.summary.id === id);
    const entry = { summary, tree };
    const notebooks = idx < 0 ? [...others, entry] : this.state.notebooks.map((n) => (n.summary.id === id ? entry : n));
    const k = this.state.known.find((x) => x.id === id);
    if (k && (k.name !== summary.info.name || k.color !== summary.info.color)) {
      await this.saveKnown(this.state.known.map((x) => (x.id === id ? { ...x, name: summary.info.name, color: summary.info.color } : x)));
    }
    let patch: Partial<NotesState> = { notebooks };
    if (!this.state.tags[id]) await this.loadTags(id);
    if (this.state.view === "recycleBin" && this.state.notebook === id) patch.recycle = await this.recycleEntries(id);
    // The open page may have been deleted / moved away by an undo.
    if (this.state.notebook === id && this.state.page && !findNode(tree, this.state.page)) {
      patch = { ...patch, ...(await this.closePageState()) };
      this.set(patch);
      await this.selectIn(id, this.state.section && findNode(tree, this.state.section) ? this.state.section : null, null);
      return;
    }
    if (this.state.notebook === id && this.state.section && !findNode(tree, this.state.section)) patch.section = null;
    this.set(patch);
  }

  private async recycleEntries(id: string): Promise<DeletedNode[]> {
    return ((await this.call({ type: "recycleBin", notebook: id })) as Body<"recycleBin">).entries;
  }

  tree(id: string | null = this.state.notebook): TreeNode[] {
    return this.state.notebooks.find((n) => n.summary.id === id)?.tree ?? [];
  }

  // ---- selection ----------------------------------------------------------------------------------------

  private async selectIn(notebook: string, section: string | null, page: string | null): Promise<void> {
    const tree = this.tree(notebook);
    const sec = (section && findNode(tree, section)) || (page && sectionOf(tree, page)) || allSections(tree)[0] || null;
    const pages = flatPages(sec);
    const pg = (page && pages.find((p) => p.node.id === page)?.node) || pages[0]?.node || null;
    await this.openPageNode(notebook, sec?.id ?? null, pg);
  }

  private async closePageState(): Promise<Partial<NotesState>> {
    const { mirror, opened } = this.state;
    if (mirror) {
      await mirror.settle();
      mirror.dispose();
      this.editor = null;
      this.lastTextAt = 0;
      this.undoneKinds = this.undoneKinds.filter((k) => k === "tree");
    }
    if (opened) {
      try {
        await this.call({ type: "closePage", docId: opened.docId });
        await this.pump();
      } catch {
        // The notebook was closed meanwhile.
      }
    }
    return { mirror: null, opened: null, page: null };
  }

  private async openPageNode(notebook: string, section: string | null, page: TreeNode | null): Promise<void> {
    if (this.state.opened && this.state.page === page?.id && this.state.notebook === notebook) {
      this.set({ section, view: "page" });
      return;
    }
    const closed = await this.closePageState();
    if (!page?.pageDoc) {
      this.set({ ...closed, notebook, section, view: "page" });
      await this.saveSelection();
      return;
    }
    await this.genesisBytes();
    const opened = ((await this.call({ type: "openPage", docId: page.pageDoc })) as Body<"page">).page;
    await this.pump();
    const mirror = await PageMirror.open(opened, this.mirrorHost());
    if (this.sync?.isShared(notebook)) mirror.shipDelay = SHARED_SHIP_DELAY_MS;
    mirror.onLocalUpdate = () => {
      this.lastTextAt = this.now();
      if (this.treeRedo.length || this.undoneKinds.length) {
        this.treeRedo = [];
        this.undoneKinds = [];
      }
    };
    this.set({ ...closed, notebook, section, page: page.id, opened, mirror, view: "page" });
    await this.saveSelection();
    await this.addRecent({ notebook, docId: page.pageDoc, title: page.title, at: this.now() });
  }

  private async saveSelection(): Promise<void> {
    const { notebook, section, page } = this.state;
    await this.store.setMeta(META_SELECTION, { notebook, section, page });
  }

  private async addRecent(r: RecentPage): Promise<void> {
    const recent = [r, ...this.state.recent.filter((x) => x.docId !== r.docId)].slice(0, RECENT_LIMIT);
    this.set({ recent });
    await this.store.setMeta(META_RECENT, recent);
  }

  selectNotebook(id: string): Promise<void> {
    return this.run(() => this.selectIn(id, null, null));
  }

  selectSection(id: string): Promise<void> {
    return this.run(async () => {
      if (!this.state.notebook) return;
      await this.selectIn(this.state.notebook, id, null);
    });
  }

  selectPage(id: string): Promise<void> {
    return this.run(async () => {
      const nb = this.state.notebook;
      if (!nb) return;
      const tree = this.tree(nb);
      await this.openPageNode(nb, sectionOf(tree, id)?.id ?? null, findNode(tree, id));
    });
  }

  /** Opens a page by its page doc id (page links, `#page=` links, recent pages). Returns whether it was found. */
  openPageByDoc(docId: string): Promise<boolean> {
    return this.run(async () => {
      for (const nb of this.state.notebooks) {
        const page = allPages(nb.tree).find((p) => p.pageDoc === docId);
        if (page) {
          await this.openPageNode(nb.summary.id, sectionOf(nb.tree, page.id)?.id ?? null, page);
          return true;
        }
      }
      this.set({ error: t("notes.error.pageNotFound") });
      return false;
    }).then((r) => !!r);
  }

  showRecycleBin(show: boolean): Promise<void> {
    return this.run(async () => {
      const nb = this.state.notebook;
      if (!nb) return;
      this.set({ view: show ? "recycleBin" : "page", recycle: show ? await this.recycleEntries(nb) : [] });
    });
  }

  // ---- structure ----------------------------------------------------------------------------------------

  /** A structural edit of `notebook` (one core undo step), then the tree is re-read. */
  private async edit<T>(notebook: string, fn: () => Promise<T>): Promise<T> {
    const out = await fn();
    this.treeOps.push({ notebook, at: this.now() });
    this.treeRedo = [];
    this.undoneKinds = [];
    await this.pump();
    await this.refreshNotebook(notebook);
    return out;
  }

  createNotebook(name: string): Promise<void> {
    return this.run(async () => {
      const nb = (await this.call({ type: "createNotebook", name })) as Body<"notebook">;
      const id = nb.notebook.id;
      const s = (await this.call({ type: "createSection", notebook: id, title: t("notes.newSection") })) as Body<"created">;
      await this.call({ type: "setColor", notebook: id, node: s.id, color: nextSectionColor(0) });
      const p = (await this.call({ type: "createPage", notebook: id, parent: s.id, title: "" })) as Body<"pageCreated">;
      await this.pump();
      await this.addKnown(id, name, null);
      await this.refreshNotebook(id);
      await this.selectIn(id, s.id, p.page.node);
    });
  }

  renameNotebook(id: string, name: string): Promise<void> {
    return this.run(() => this.edit(id, async () => void (await this.call({ type: "renameNotebook", notebook: id, name }))));
  }

  setNotebookColor(id: string, color: string | null): Promise<void> {
    return this.run(() => this.edit(id, async () => void (await this.call({ type: "setNotebookColor", notebook: id, ...(color ? { color } : {}) }))));
  }

  /** Closes a notebook (it stays in this browser and can be opened again). */
  closeNotebook(id: string): Promise<void> {
    return this.run(async () => {
      if (this.state.notebook === id) this.set(await this.closePageState());
      await this.call({ type: "closeNotebook", id });
      await this.pump();
      await this.persister.flush();
      this.sync?.close(id);
      this.treeOps = this.treeOps.filter((o) => o.notebook !== id);
      this.treeRedo = this.treeRedo.filter((o) => o.notebook !== id);
      const notebooks = this.state.notebooks.filter((n) => n.summary.id !== id);
      await this.saveKnown(this.state.known.map((k) => (k.id === id ? { ...k, open: false } : k)));
      this.set({ notebooks });
      if (this.state.notebook === id) {
        const next = notebooks[0];
        if (next) await this.selectIn(next.summary.id, null, null);
        else this.set({ notebook: null, section: null, page: null });
      }
    });
  }

  /** Desktop: a notebook folder the shell opened (File › Open notebook folder…, the recent folders). */
  async openFolderNotebook(id: string, name: string): Promise<void> {
    if (!this.state.known.some((k) => k.id === id)) await this.run(() => this.addKnown(id, name, null));
    await this.openKnown(id);
  }

  /** Opens a notebook stored in this browser (File › Open). */
  openKnown(id: string): Promise<void> {
    return this.run(async () => {
      if (!this.state.notebooks.some((n) => n.summary.id === id)) {
        const warnings: LoadWarning[] = [];
        const nb = await this.loadFromStore(id, warnings);
        if (!nb) throw new Error(t("notes.error.notStored"));
        this.set({ notebooks: [...this.state.notebooks, nb], warnings: [...this.state.warnings, ...warnings] });
        await this.pump();
      }
      const k = this.state.known.find((x) => x.id === id);
      if (k) await this.saveKnown(this.state.known.map((x) => (x.id === id ? { ...x, open: true, lastOpened: this.now() } : x)));
      await this.selectIn(id, null, null);
      await this.sync?.startOpen((x) => x === id);
    });
  }

  createSection(title: string, parent?: string): Promise<void> {
    return this.run(async () => {
      const nb = this.state.notebook;
      if (!nb) return;
      const color = nextSectionColor(allSections(this.tree(nb)).length);
      const id = await this.edit(nb, async () => {
        const s = (await this.call({ type: "createSection", notebook: nb, title, ...(parent ? { parent } : {}) })) as Body<"created">;
        await this.call({ type: "setColor", notebook: nb, node: s.id, color });
        await this.call({ type: "createPage", notebook: nb, parent: s.id, title: "" });
        return s.id;
      });
      await this.selectIn(nb, id, null);
    });
  }

  createGroup(title: string): Promise<void> {
    return this.run(async () => {
      const nb = this.state.notebook;
      if (!nb) return;
      await this.edit(nb, () => this.call({ type: "createGroup", notebook: nb, title }));
    });
  }

  /** A new page at the end of the current section (`sub`: a sub-page of the open page, Ctrl+Alt+Shift+N). */
  createPage(options: { sub?: boolean; section?: string } = {}): Promise<void> {
    return this.run(async () => {
      const nb = this.state.notebook;
      if (!nb) return;
      const tree = this.tree(nb);
      let parent = options.section ?? this.state.section;
      let index: number | undefined;
      if (options.sub && this.state.page) {
        const flat = flatPages(sectionOf(tree, this.state.page));
        const me = flat.find((f) => f.node.id === this.state.page);
        if (me && me.level < MAX_PAGE_LEVEL) parent = me.node.id;
        else if (me) {
          parent = me.parent;
          index = flat.filter((f) => f.parent === me.parent).findIndex((f) => f.node.id === me.node.id) + 1;
        }
      }
      if (!parent) {
        const s = allSections(tree)[0];
        if (!s) throw new Error(t("notes.error.noSection"));
        parent = s.id;
      }
      const created = await this.edit(nb, () => this.call({ type: "createPage", notebook: nb, parent: parent!, title: "", ...(index !== undefined ? { index } : {}) })) as Body<"pageCreated">;
      const node = findNode(this.tree(nb), created.page.node);
      await this.openPageNode(nb, sectionOf(this.tree(nb), created.page.node)?.id ?? null, node);
    });
  }

  rename(node: string, title: string): Promise<void> {
    return this.run(async () => {
      const nb = this.state.notebook;
      if (!nb) return;
      const current = findNode(this.tree(nb), node);
      if (!current || current.title === title) return;
      await this.edit(nb, () => this.call({ type: "rename", notebook: nb, node, title }));
      if (node === this.state.page) await this.state.mirror?.pull();
    });
  }

  setColor(node: string, color: string | null): Promise<void> {
    return this.run(async () => {
      const nb = this.state.notebook;
      if (!nb) return;
      await this.edit(nb, () => this.call({ type: "setColor", notebook: nb, node, ...(color ? { color } : {}) }));
    });
  }

  /** Moves a node inside the current notebook (`parent` null = root, for sections and groups). */
  move(node: string, parent: string | null, index: number): Promise<void> {
    return this.run(async () => {
      const nb = this.state.notebook;
      if (!nb) return;
      await this.edit(nb, () => this.call({ type: "move", notebook: nb, node, index, ...(parent ? { parent } : {}) }));
      if (node === this.state.page || findNode(findNode(this.tree(nb), node)?.children ?? [], this.state.page)) {
        this.set({ section: sectionOf(this.tree(nb), this.state.page!)?.id ?? this.state.section });
      }
    });
  }

  /** Tab / Shift+Tab in the page list: the page one level deeper / higher. */
  indentPage(node: string, outdent = false): Promise<void> {
    const nb = this.state.notebook;
    const flat = flatPages(sectionOf(this.tree(nb), node));
    const target = outdent ? outdentTarget(flat, node) : indentTarget(flat, node);
    return target ? this.move(node, target.parent, target.index) : Promise.resolve();
  }

  /**
   * Moves a page (with its sub-pages) to a section of another open notebook. The core has no cross-notebook move:
   * the pages are copied (their current content into new page docs of the target notebook – the page history stays
   * with the originals, a full-history copy would reuse the core peer's op ids) and the originals go to the source
   * notebook's recycle bin. Page links to the moved pages keep pointing at the originals.
   */
  movePageToNotebook(node: string, target: string, section: string): Promise<void> {
    return this.run(async () => {
      const src = this.state.notebook;
      if (!src || src === target) return;
      const page = findNode(this.tree(src), node);
      if (!page) return;
      if (this.state.page === node || findNode(page.children, this.state.page)) this.set(await this.closePageState());
      const copy = async (p: TreeNode, parent: string): Promise<string> => {
        const created = (await this.call({ type: "createPage", notebook: target, parent, title: p.title })) as Body<"pageCreated">;
        if (p.pageDoc) await this.writeContent(created.page.docId, await this.readContent(p.pageDoc));
        for (const c of p.children) if (c.kind === "page") await copy(c, created.page.node);
        return created.page.node;
      };
      let first = "";
      await this.edit(target, async () => {
        first = await copy(page, section);
      });
      await this.edit(src, () => this.call({ type: "delete", notebook: src, node }));
      await this.selectIn(target, section, first);
    });
  }

  /** Deletes a node to the recycle bin. */
  deleteNode(node: string): Promise<void> {
    return this.run(async () => {
      const nb = this.state.notebook;
      if (!nb) return;
      const tree = this.tree(nb);
      const n = findNode(tree, node);
      if (!n) return;
      // The page to show afterwards: the next one in the list (or the previous).
      let nextPage: string | null = null;
      if (n.kind === "page") {
        const flat = flatPages(sectionOf(tree, node));
        const i = flat.findIndex((f) => f.node.id === node);
        let j = i + 1;
        while (j < flat.length && flat[j]!.level > flat[i]!.level) j++;
        nextPage = flat[j]?.node.id ?? flat[i - 1]?.node.id ?? null;
      }
      const affectsOpen = this.state.page === node || !!findNode(n.children, this.state.page);
      if (affectsOpen) this.set(await this.closePageState());
      await this.edit(nb, () => this.call({ type: "delete", notebook: nb, node }));
      if (affectsOpen || n.kind !== "page") {
        const section = n.kind === "page" ? this.state.section : this.state.section === node ? null : this.state.section;
        await this.selectIn(nb, section, nextPage);
      }
    });
  }

  restore(node: string, to?: string): Promise<void> {
    return this.run(async () => {
      const nb = this.state.notebook;
      if (!nb) return;
      await this.edit(nb, () => this.call({ type: "restoreNode", notebook: nb, node, ...(to ? { to } : {}) }));
    });
  }

  /** Deletes one recycle-bin entry permanently (with its sub-pages). Not undoable. */
  purgeNode(node: string): Promise<void> {
    return this.run(async () => {
      const nb = this.state.notebook;
      if (!nb) return;
      await this.call({ type: "purgeNode", notebook: nb, node });
      await this.pump();
      this.treeOps = this.treeOps.filter((o) => o.notebook !== nb);
      this.treeRedo = [];
      await this.refreshNotebook(nb);
      this.set({ recycle: await this.recycleEntries(nb) });
    });
  }

  /**
   * Deletes everything in the recycle bin permanently. The core only purges entries older than 60 days
   * (`Purge`), so the request carries a clock 60 days ahead (only the purge change gets that timestamp).
   */
  emptyRecycleBin(): Promise<void> {
    return this.run(async () => {
      const nb = this.state.notebook;
      if (!nb) return;
      unwrap(await this.backend.dispatch({ type: "purge", notebook: nb, now: this.now() + RECYCLE_BIN_MS + 1 }));
      await this.pump();
      // A purge is not undoable from the UI.
      this.treeOps = this.treeOps.filter((o) => o.notebook !== nb);
      this.treeRedo = [];
      await this.refreshNotebook(nb);
      this.set({ recycle: await this.recycleEntries(nb) });
    });
  }

  // ---- undo ---------------------------------------------------------------------------------------------

  /** Registers the open page's editor history (null when it goes). */
  setEditorHistory(h: EditorHistory | null): void {
    this.editor = h;
    this.refreshHistory();
  }

  /** Ribbon / top bar Undo: the newer of the last structural edit and the last typing. */
  undo(): Promise<void> {
    return this.run(async () => {
      const tree = this.treeOps[this.treeOps.length - 1];
      const textNewer = this.editor?.canUndo() && (!tree || this.lastTextAt >= tree.at);
      if (textNewer) {
        if (this.editor!.undo()) this.undoneKinds.push("text");
        this.refreshHistory();
        return;
      }
      if (tree) await this.treeUndo(tree.notebook);
    });
  }

  redo(): Promise<void> {
    return this.run(async () => {
      const kind = this.undoneKinds[this.undoneKinds.length - 1];
      if (kind === "text" && this.editor?.canRedo()) {
        this.undoneKinds.pop();
        this.editor.redo();
        this.refreshHistory();
        return;
      }
      const op = this.treeRedo[this.treeRedo.length - 1];
      if (op) await this.treeRedoOp(op.notebook);
      else if (this.editor?.canRedo()) this.editor.redo();
      this.refreshHistory();
    });
  }

  /** Ctrl+Z outside the editor: the notebook's last structural edit. */
  undoStructure(): Promise<void> {
    return this.run(async () => {
      const nb = this.state.notebook;
      const op = [...this.treeOps].reverse().find((o) => o.notebook === nb);
      if (op) await this.treeUndo(op.notebook);
    });
  }

  redoStructure(): Promise<void> {
    return this.run(async () => {
      const op = this.treeRedo[this.treeRedo.length - 1];
      if (op) await this.treeRedoOp(op.notebook);
    });
  }

  private async treeUndo(notebook: string): Promise<void> {
    const i = this.treeOps.map((o) => o.notebook).lastIndexOf(notebook);
    const [op] = this.treeOps.splice(i, 1);
    await this.call({ type: "undo", notebook });
    this.treeRedo.push(op!);
    this.undoneKinds.push("tree");
    await this.pump();
    await this.refreshNotebook(notebook);
  }

  private async treeRedoOp(notebook: string): Promise<void> {
    const op = this.treeRedo.pop()!;
    await this.call({ type: "redo", notebook });
    this.treeOps.push(op);
    const k = this.undoneKinds.lastIndexOf("tree");
    if (k >= 0) this.undoneKinds.splice(k, 1);
    await this.pump();
    await this.refreshNotebook(notebook);
  }

  // ---- tags ---------------------------------------------------------------------------------------------

  private async loadTags(notebook: string): Promise<void> {
    const tags = ((await this.call({ type: "tags", notebook })) as Body<"tags">).tags;
    this.set({ tags: { ...this.state.tags, [notebook]: tags } });
  }

  /** The tag definitions of a notebook (default: the current one). */
  tagDefs(notebook: string | null = this.state.notebook): TagDef[] {
    return (notebook && this.state.tags[notebook]) || [];
  }

  /** Customize tags › New tag. Returns the new tag's id. */
  addTag(label: string, kind: TagKind, icon?: string, color?: string): Promise<string | undefined> {
    return this.run(async () => {
      const nb = this.state.notebook;
      if (!nb) return undefined;
      const id = ((await this.call({ type: "addTag", notebook: nb, label, kind, ...(icon ? { icon } : {}), ...(color ? { color } : {}) })) as Body<"created">).id;
      await this.pump();
      await this.loadTags(nb);
      return id;
    });
  }

  /** Customize tags: rename / recolour / another icon. */
  updateTag(id: string, patch: { label?: string; icon?: string; color?: string }): Promise<void> {
    return this.run(async () => {
      const nb = this.state.notebook;
      if (!nb) return;
      await this.call({ type: "updateTag", notebook: nb, id, ...patch });
      await this.pump();
      await this.loadTags(nb);
    });
  }

  // ---- images and attachments -----------------------------------------------------------------------------

  /** Stores a blob of the current notebook (Blob effect) and returns its id; its object URL is cached. */
  storeBlob(bytes: Uint8Array, mime?: string): Promise<string | undefined> {
    return this.run(async () => {
      const nb = this.state.notebook;
      if (!nb) throw new Error(t("notes.error.noNotebook"));
      const sha = await this.backend.putBlob(nb, bytes);
      this.blobs.remember(nb, sha, bytes, mime);
      await this.pump();
      return sha;
    });
  }

  /** A fresh object URL of a stored blob with a MIME type (attachments: Open / Download). Revoke it after use. */
  async fileUrl(sha: string, type: string): Promise<string | null> {
    const nb = this.state.notebook;
    if (!nb) return null;
    await this.idle();
    const bytes = await this.store.getBlob(nb, sha);
    return bytes ? URL.createObjectURL(new Blob([bytes as BlobPart], { type })) : null;
  }

  /** The object URL of a blob of the current notebook. */
  blobUrl(sha: string): Promise<string | null> {
    const nb = this.state.notebook;
    return nb ? this.blobs.url(nb, sha) : Promise.resolve(null);
  }

  // ---- search ---------------------------------------------------------------------------------------------

  /** Full-text search (results while typing; not queued behind other commands). */
  async search(query: string, notebook?: string | null, limit = 50): Promise<SearchHit[]> {
    if (!query.trim()) return [];
    try {
      return (unwrap(await this.backend.dispatch({ type: "search", query, limit, ...(notebook ? { notebook } : {}) })) as Body<"searchHits">).hits;
    } catch (e) {
      this.fail(e);
      return [];
    }
  }

  /** Opens a search result and highlights `query` on the page. */
  async openHit(hit: SearchHit, query: string): Promise<void> {
    if (await this.openPageByDoc(hit.docId)) this.set({ find: { docId: hit.docId, query, at: this.now() } });
  }

  /** Ctrl+F outside the editor: find on the open page. */
  requestFind(query = ""): void {
    const docId = this.state.opened?.docId;
    if (docId) this.set({ view: "page", find: { docId, query, at: this.now() } });
  }

  consumeFind(): void {
    if (this.state.find) this.set({ find: null });
  }

  // ---- tasks ----------------------------------------------------------------------------------------------

  /** View › Tasks: the to-dos of every open notebook. */
  showTasks(show = true): Promise<void> {
    return this.run(async () => {
      if (!show) {
        this.set({ view: "page" });
        return;
      }
      await this.state.mirror?.settle();
      this.set({ view: "tasks", tasks: await this.taskList() });
    });
  }

  private async taskList(): Promise<TaskEntry[]> {
    return ((await this.call({ type: "tasks", filter: "all" })) as Body<"tasks">).tasks;
  }

  setTaskFilter(filter: TaskFilter, tag: string | null = this.state.taskTag): void {
    this.set({ taskFilter: filter, taskTag: tag });
  }

  /** Re-reads the tasks (after edits). */
  refreshTasks(): Promise<void> {
    return this.run(async () => {
      if (this.state.view === "tasks") this.set({ tasks: await this.taskList() });
    });
  }

  /** Ticks / unticks a to-do from the tasks view: in the open editor, else through a mirror of its page. */
  setTaskChecked(task: TaskEntry, checked: boolean): Promise<void> {
    return this.run(async () => {
      const mirror = this.state.mirror;
      if (mirror && mirror.docId === task.docId) {
        // The open page: through its editor, or (editor not shown, e.g. the tasks view) its mirror – never a second
        // mirror with the same peer id.
        const ok = this.pageHooks ? this.pageHooks.setChecked(task.path, checked) : setCheckedInLoro(mirror.doc.getMap("doc"), task.path, checked);
        if (!ok) throw new Error(t("notes.tasks.gone"));
        if (!this.pageHooks) mirror.doc.commit({ origin: "notes:task" });
        await mirror.settle();
      } else {
        await this.genesisBytes();
        const opened = ((await this.call({ type: "openPage", docId: task.docId })) as Body<"page">).page;
        const mirror = await PageMirror.open(opened, this.mirrorHost());
        try {
          if (!setCheckedInLoro(mirror.doc.getMap("doc"), task.path, checked)) throw new Error(t("notes.tasks.gone"));
          mirror.doc.commit({ origin: "notes:task" });
          await mirror.settle();
        } finally {
          mirror.dispose();
          await this.call({ type: "closePage", docId: task.docId });
        }
      }
      await this.pump();
      if (this.state.view === "tasks") this.set({ tasks: await this.taskList() });
    });
  }

  /** Opens the page of a to-do and highlights it. */
  async openTask(task: TaskEntry): Promise<void> {
    if (await this.openPageByDoc(task.docId)) this.set({ view: "page", focus: { docId: task.docId, path: task.path, at: this.now() } });
  }

  consumeFocus(): void {
    if (this.state.focus) this.set({ focus: null });
  }

  /** The open page's editor hooks (null when it goes). */
  setPageHooks(h: PageEditorHooks | null): void {
    this.pageHooks = h;
  }

  // ---- links, history -------------------------------------------------------------------------------------

  /** Pages linking to page doc `docId` ("Linked from"). */
  async backlinks(docId: string): Promise<PageRef[]> {
    try {
      await this.state.mirror?.settle();
      return (unwrap(await this.backend.dispatch({ type: "backlinks", pageId: docId })) as Body<"pages">).pages;
    } catch {
      return [];
    }
  }

  /** The live title of a page (page doc id); `null` when no open notebook has it (deleted or unknown). */
  pageTitle(docId: string): string | null {
    for (const nb of this.state.notebooks) {
      const p = allPages(nb.tree).find((x) => x.pageDoc === docId);
      if (p) return p.title;
    }
    return null;
  }

  showPanel(panel: "history" | null): void {
    this.set({ panel: this.state.panel === panel ? null : panel });
  }

  /** The versions of a page (newest first; the genesis is hidden by the core). */
  async history(docId: string): Promise<HistoryEntry[]> {
    await this.state.mirror?.settle();
    return ((await this.call({ type: "history", docId })) as Body<"history">).entries.slice().reverse();
  }

  async preview(docId: string, frontiers: string[]): Promise<VersionPreview> {
    return ((await this.call({ type: "checkoutPreview", docId, frontiers })) as Body<"preview">).preview;
  }

  /** Restore: the page goes back to that version with new operations (history only grows). */
  restoreVersion(docId: string, frontiers: string[]): Promise<void> {
    return this.run(async () => {
      await this.state.mirror?.settle();
      await this.call({ type: "restore", docId, frontiers });
      await this.pump();
      if (this.state.opened?.docId === docId) await this.state.mirror?.pull();
      // The title may have changed with the content (meta.title): the tree title is authoritative and stays.
    });
  }

  /** A page's content as ProseMirror JSON (print, section export). */
  pageContent(docId: string): Promise<object> {
    return this.run(async () => {
      if (this.state.opened?.docId === docId && this.state.mirror) {
        return createNodeFromLoroObj(this.schema, this.state.mirror.doc.getMap("doc") as never, new Map()).toJSON() as object;
      }
      return this.readContent(docId);
    }).then((r) => r ?? { type: "doc", content: [] });
  }

  // ---- import and export (P11-N6b) ----------------------------------------------------------------------

  private busy(label: string, done = 0, total = 0, cancellable = false): void {
    this.set({ busy: { label, done, total, ...(cancellable && this.backend.converter.cancellable ? { cancellable: true } : {}) } });
  }

  /** Set by Cancel while an import or export runs. */
  private cancelRequested = false;

  /** The progress card's Cancel: stops the running conversion (the web's converter worker is terminated) and the
   * files after it; what was already imported stays. */
  cancelBusy(): void {
    if (!this.state.busy?.cancellable) return;
    this.cancelRequested = true;
    this.backend.converter.cancel();
  }

  /** File › Import, drag & drop on the navigation pane: OneNote (`.onepkg` → a new notebook, `.one` → a new section
   * of the current notebook), Markdown, HTML and Word files (→ pages of the current section); then the result. */
  importFiles(files: readonly { name: string; bytes: Uint8Array }[]): Promise<void> {
    return this.run(async () => {
      const sum: ImportSummary = { files: [], notebooks: 0, sections: 0, pages: 0, images: 0, attachments: 0, open: null };
      this.cancelRequested = false;
      try {
        for (const [i, f] of files.entries()) {
          if (this.cancelRequested) break;
          this.busy(t("notes.import.busy", { name: f.name }), i, files.length, true);
          await paint();
          try {
            const r = await this.importOne(f);
            sum.notebooks += r.notebook ? 1 : 0;
            sum.sections += r.plan.stats.sections;
            sum.pages += r.plan.stats.pages;
            sum.images += r.plan.stats.images;
            sum.attachments += r.plan.stats.attachments;
            sum.files.push({ name: f.name, warnings: r.warnings });
            sum.open ??= r.open;
          } catch (e) {
            if (e instanceof ConvertCancelled || this.cancelRequested) break;
            console.warn("Rusuite Notes: import", f.name, e);
            sum.files.push({ name: f.name, warnings: [], error: e instanceof Error ? e.message : String(e) });
          }
        }
      } finally {
        this.set({ busy: null });
      }
      if (this.cancelRequested) {
        this.cancelRequested = false;
        // Nothing imported: no result to show.
        if (sum.files.length === 0) return;
        sum.cancelled = true;
      }
      this.set({ importResult: sum });
    });
  }

  private async importOne(f: { name: string; bytes: Uint8Array }): Promise<{ plan: ImportPlan; warnings: ConvertWarning[]; notebook: boolean; open: ImportSummary["open"] }> {
    if (this.state.readOnly) throw new Error(t("notes.lock.readOnly"));
    const kind = importKindOf(f.name);
    if (!kind) throw new Error(t("notes.import.unsupported"));
    const pkg = kind === "oneNote" && isOneNotePackage(f.bytes);
    const nb = this.state.notebook;
    if (!pkg && !nb) throw new Error(t("notes.error.noNotebook"));
    let parent: string | undefined;
    if (kind !== "oneNote") {
      parent = (this.state.section && findNode(this.tree(nb), this.state.section)?.kind === "section" ? this.state.section : null) ?? allSections(this.tree(nb))[0]?.id;
      if (!parent) throw new Error(t("notes.error.noSection"));
    }
    const context = kind === "oneNote" ? undefined : ((await this.call({ type: "importContext", notebook: nb! })) as Body<"importContext">).context;
    const frame = await this.backend.converter.importFile({ kind, fileName: f.name, seed: randomSeed(), ...(context ? { context } : {}) }, f.bytes);
    const plan = JSON.parse(frameJson(frame)) as ImportPlan;
    const request: NotesRequest =
      kind === "oneNote"
        ? { type: "importOneNote", fileName: f.name, ...(pkg ? {} : { notebook: nb! }) }
        : kind === "markdown"
          ? { type: "importMarkdown", fileName: f.name, notebook: nb!, parent: parent! }
          : kind === "html"
            ? { type: "importHtml", fileName: f.name, notebook: nb!, parent: parent! }
            : { type: "importDocx", fileName: f.name, notebook: nb!, parent: parent! };
    await paint();
    const body = unwrap(await this.backend.applyImport({ ...request, now: this.now() }, frame)) as Body<"fileImported">;
    await this.pump();
    await this.persister.flush();
    const id = body.notebook.id;
    if (pkg) {
      await this.addKnown(id, body.notebook.info.name, body.notebook.info.color ?? null);
    } else {
      this.treeOps.push({ notebook: id, at: this.now() });
      this.treeRedo = [];
      this.undoneKinds = [];
    }
    await this.refreshNotebook(id);
    await this.loadTags(id);
    return {
      plan,
      warnings: body.warnings,
      notebook: pkg,
      open: { notebook: id, page: body.pages[0]?.node ?? null, kind: pkg ? "notebook" : kind === "oneNote" ? "section" : "page" },
    };
  }

  /** The result dialog's "Open": the first imported page. */
  openImported(): Promise<void> {
    const open = this.state.importResult?.open;
    this.set({ importResult: null });
    if (!open) return Promise.resolve();
    return this.run(() => this.selectIn(open.notebook, null, open.page));
  }

  dismissImportResult(): void {
    this.set({ importResult: null });
  }

  /** File › Export: a page (`page`: its tree node) or a section (`section`: a section node, or a page with its
   * sub-pages) as Markdown (a section: a zip), HTML or Word – a download. PDF goes through the print path. */
  exportTo(format: ExportFormat, scope: { page?: string; section?: string }): Promise<void> {
    return this.run(async () => {
      const nb = this.state.notebook;
      if (!nb) throw new Error(t("notes.error.noNotebook"));
      const tree = this.tree(nb);
      this.busy(t("notes.export.busy"), 0, 0, true);
      this.cancelRequested = false;
      try {
        await this.state.mirror?.settle();
        await this.pump();
        await this.persister.flush();
        let body: Body<"exportSource">;
        if (scope.section) {
          body = (await this.call({ type: "sectionExportSource", notebook: nb, section: scope.section })) as Body<"exportSource">;
        } else {
          const doc = findNode(tree, scope.page ?? this.state.page)?.pageDoc;
          if (!doc) throw new Error(t("notes.print.noPage"));
          body = (await this.call({ type: "pageExportSource", docId: doc })) as Body<"exportSource">;
        }
        const source = body.source;
        const blobs: Uint8Array[] = [];
        for (const id of source.blobs) {
          const b = await this.store.getBlob(nb, id);
          if (b) blobs.push(b);
        }
        await paint();
        let bytes: Uint8Array;
        try {
          bytes = await this.backend.converter.exportFile(format, source, frameRecords(blobs));
        } catch (e) {
          if (e instanceof ConvertCancelled || this.cancelRequested) return;
          throw e;
        }
        if (this.cancelRequested) return;
        const name = exportFileName(source.title, format, source.section, t("notes.untitled"));
        await this.backend.saveFile(name, bytes);
      } finally {
        this.cancelRequested = false;
        this.set({ busy: null });
      }
    });
  }

  /** Rich paste: HTML from Word or a web page through the core's sanitiser → editor content (a ProseMirror `doc`);
   * its `data:` images become blobs of the notebook, remote images links (never fetched). `null`: not possible. */
  pasteHtml(html: string): Promise<{ content: { type: "doc"; content?: unknown[] }; warnings: ConvertWarning[] } | null> {
    return this.run(async () => {
      const nb = this.state.notebook;
      if (!nb) return null;
      const context = ((await this.call({ type: "importContext", notebook: nb })) as Body<"importContext">).context;
      const frame = await this.backend.converter.pasteHtml(html, context);
      const { json, blobs } = decodeFrame(frame);
      for (const b of blobs) {
        const sha = await this.backend.putBlob(nb, b);
        this.blobs.remember(nb, sha, b, sniffImage(b) ?? undefined);
      }
      await this.pump();
      return JSON.parse(json) as { content: { type: "doc"; content?: unknown[] }; warnings: ConvertWarning[] };
    }).then((r) => r ?? null);
  }

  // ---- single tab ----------------------------------------------------------------------------------------

  /** Another tab took over: flush what is pending and stop writing. */
  async goReadOnly(): Promise<void> {
    await this.state.mirror?.settle().catch(() => undefined);
    await this.pump().catch(() => undefined);
    await this.persister.flush().catch(() => undefined);
    this.set({ readOnly: true });
  }

  // ---- backup and local data ----------------------------------------------------------------------------

  /** The `.rnotes` backup of a notebook (everything in it, blobs included). */
  exportBackup(id: string | null = this.state.notebook): Promise<{ name: string; bytes: Uint8Array } | undefined> {
    return this.run(async () => {
      if (!id) throw new Error(t("notes.error.noNotebook"));
      await this.state.mirror?.settle();
      const blobs = await this.store.blobs(id);
      const bytes = await this.backend.exportBackup(id, blobs);
      await this.pump();
      const name = this.state.notebooks.find((n) => n.summary.id === id)?.summary.info.name ?? "notebook";
      return { name: `${safeFileName(name)}.rnotes`, bytes };
    });
  }

  /** Download backup: the backup as a file. */
  async downloadBackup(id: string | null = this.state.notebook): Promise<void> {
    const b = await this.exportBackup(id);
    if (b) await this.backend.saveFile(b.name, b.bytes).catch((e) => this.fail(e));
  }

  /** Opens a notebook from a backup's bytes (it is stored in this browser). */
  importBackup(bytes: Uint8Array): Promise<void> {
    return this.run(async () => {
      const reply = await this.backend.importBackup(bytes);
      if ("err" in reply && reply.err.code === "notebook_open") throw new Error(t("notes.error.alreadyOpen"));
      const body = unwrap(reply) as Body<"backupImported">;
      await this.pump();
      await this.persister.flush();
      const id = body.notebook.id;
      const summary = normalizeSummary(body.notebook);
      this.set({ notebooks: [...this.state.notebooks.filter((n) => n.summary.id !== id), { summary, tree: body.tree }], warnings: [...this.state.warnings, ...body.warnings] });
      await this.addKnown(id, summary.info.name, summary.info.color);
      await this.selectIn(id, null, null);
    });
  }

  /** File › Open backup: picks a file and opens it. */
  async openBackupFile(): Promise<void> {
    try {
      const f = await this.backend.openFile();
      if (f) await this.importBackup(f.bytes);
    } catch (e) {
      this.fail(e);
    }
  }

  /** ADR 0009 rule 4: removes every notebook and setting of this app from this browser (the open ones close). */
  clearLocalData(): Promise<void> {
    return this.run(async () => {
      this.set(await this.closePageState());
      for (const nb of this.state.notebooks) await this.call({ type: "closeNotebook", id: nb.summary.id });
      await this.backend.takePersistEffects();
      await this.persister.flush();
      this.persister.discard();
      await this.store.clearAll();
      this.blobs.clear();
      this.treeOps = [];
      this.treeRedo = [];
      this.undoneKinds = [];
      this.set({ known: [], notebooks: [], notebook: null, section: null, page: null, recent: [], view: "page", recycle: [], tags: {}, tasks: [], warnings: [], settings: { ...this.state.settings, persistHintDismissed: false } });
    });
  }

  // ---- settings -----------------------------------------------------------------------------------------

  updateSettings(patch: Partial<Settings>): void {
    const settings = { ...this.state.settings, ...patch };
    this.set({ settings });
    void this.store.setMeta(META_SETTINGS, settings).catch((e) => this.fail(e));
  }

  /** This app's URL (desktop: the relay's web app – the shell has no URL of its own). */
  private linkBase(): string {
    if (this.desktop) return this.desktop.linkBase;
    return typeof location === "undefined" ? "" : `${location.origin}${location.pathname}`;
  }

  /** The link that opens a page (`#page=<page doc id>` on this app's URL). */
  pageLink(node: string): string | null {
    const n = findNode(this.tree(), node);
    if (!n?.pageDoc) return null;
    const base = this.linkBase();
    return `${base}#page=${n.pageDoc}`;
  }

  // ---- sharing (P11-N5b) ----------------------------------------------------------------------------------

  /** Connects the sharing manager (main.tsx; before `start`). */
  attachSync(sync: SyncManager): void {
    this.sync = sync;
    sync.onChange = () => this.refreshShares();
    sync.onJoinRequest = (localId, join) => {
      if (this.state.joinRequests.some((j) => j.join.inviteId === join.inviteId)) return;
      this.set({ joinRequests: [...this.state.joinRequests, { localId, join }] });
    };
    sync.onAdopted = () => this.refreshShares();
    sync.onRemoved = (localId) => {
      this.set({ shareNotice: { ...this.state.shareNotice, [localId]: "removed" } });
      this.refreshShares();
    };
    sync.onStopped = (localId, wasOwner) => {
      if (wasOwner) this.notify(t("notes.share.stopped.owner"));
      else if (localId) this.set({ shareNotice: { ...this.state.shareNotice, [localId]: "stopped" } });
      this.refreshShares();
    };
  }

  /** The document-side callbacks of the sync engines. */
  syncHost(): SyncDocHost {
    return {
      localDocs: (localId) => {
        const nb = this.state.notebooks.find((n) => n.summary.id === localId);
        if (!nb) return [];
        return [localId, ...allPages(nb.tree).flatMap((p) => (p.pageDoc ? [p.pageDoc] : []))];
      },
      priorityDocs: (localId) => (this.state.opened?.notebookId === localId ? [this.state.opened.docId] : []),
      hasNotebook: (localId) => !!localId && this.state.notebooks.some((n) => n.summary.id === localId),
      versionVector: (doc) => this.backend.versionVector(doc),
      exportSince: (doc, vv) => this.backend.exportUpdates(doc, vv),
      exportChunks: (doc, vv, max) => this.backend.exportUpdateChunks(doc, vv, max),
      importRemote: (localId, doc, bytes, notebookDoc) => this.importRemote(localId, doc, bytes, notebookDoc),
      adoptNotebook: (localId, updates) => this.adoptNotebook(localId, updates),
      readBlob: async (localId, sha) => {
        await this.persister.flush();
        return this.store.getBlob(localId, sha);
      },
      blobIds: async (localId) => {
        try {
          return ((await this.call({ type: "referencedBlobs", notebook: localId })) as Body<"blobIds">).ids;
        } catch {
          return [];
        }
      },
      storeBlob: async (localId, sha, bytes) => {
        this.persister.enqueue([{ kind: "blob", notebook: localId, doc: sha, bytes }]);
        await this.persister.flush();
      },
      displayName: () => this.state.profile?.name ?? "",
    };
  }

  private treeRefresh = new Map<string, ReturnType<typeof setTimeout>>();

  /** Remote bytes from the relay: into the core (persisted), then into the open page's mirror / the tree. */
  private async importRemote(localId: string, doc: string, bytes: Uint8Array, notebookDoc: boolean): Promise<void> {
    await this.backend.importRemote(localId, doc, bytes);
    await this.pump();
    if (notebookDoc) {
      // Coalesce bursts (catch-up) into one tree refresh, through the command queue.
      if (!this.treeRefresh.has(localId)) {
        this.treeRefresh.set(
          localId,
          setTimeout(() => {
            this.treeRefresh.delete(localId);
            void this.run(async () => {
              await this.refreshNotebook(localId);
              await this.loadTags(localId);
            });
          }, 30),
        );
      }
    } else if (this.state.mirror && this.state.opened?.docId === doc) {
      await this.state.mirror.pull();
    }
  }

  /** Joining: the notebook doc arrived – the notebook is created in this browser and opened. */
  private adoptNotebook(localId: string, updates: Uint8Array[]): Promise<void> {
    return this.run(async () => {
      if (this.state.notebooks.some((n) => n.summary.id === localId)) return;
      unwrap(await this.backend.loadDoc(localId, localId, new Uint8Array(), frameRecords(updates)));
      const opened = (await this.call({ type: "openNotebook", id: localId })) as Body<"notebook">;
      await this.loadTags(localId);
      const summary = normalizeSummary(opened.notebook);
      this.set({ notebooks: [...this.state.notebooks, { summary, tree: opened.tree }] });
      await this.addKnown(localId, summary.info.name, summary.info.color);
      await this.pump();
      await this.selectIn(localId, null, null);
    }).then(() => undefined);
  }

  refreshShares(): void {
    if (!this.sync) return;
    const { mirror, opened } = this.state;
    if (mirror && opened && this.sync.isShared(opened.notebookId)) mirror.shipDelay = SHARED_SHIP_DELAY_MS;
    this.set({ shares: this.sync.views(), profile: this.sync.profile, device: this.sync.device });
  }

  private notebookOfDoc(doc: string): string | null {
    if (this.state.opened?.docId === doc) return this.state.opened.notebookId;
    for (const nb of this.state.notebooks) if (allPages(nb.tree).some((p) => p.pageDoc === doc)) return nb.summary.id;
    return null;
  }

  /** The sharing view of a notebook (default: the current one). */
  share(localId: string | null = this.state.notebook): ShareView | null {
    return (localId && this.state.shares[localId]) || null;
  }

  /** Read-only shared notebook: a read-only member, or this device was removed. */
  sharedReadOnly(localId: string | null = this.state.notebook): boolean {
    if (!localId) return false;
    if (this.state.shareNotice[localId] === "removed") return true;
    const v = this.state.shares[localId];
    return !!v && (v.phase === "removed" || (v.role !== null && !canWrite(v.role)));
  }

  /** A device id → its member's display name (history, last editor, presence). */
  nameOf(device: string | null | undefined): string | null {
    if (!device) return null;
    if (device === this.state.device || device === this.legacyDevice) return this.state.profile?.name || t("notes.share.you");
    for (const v of Object.values(this.state.shares)) {
      const n = v.names[device];
      if (n) return n;
    }
    return null;
  }

  /** Display name for sharing. */
  setDisplayName(name: string): Promise<void> {
    return this.run(async () => {
      if (!this.sync) return;
      await this.sync.setProfile(name);
      this.refreshShares();
    });
  }

  /** First share / join: device keys; the core records further changes under the sharing device id. */
  private async ensureSharingDevice(): Promise<void> {
    if (!this.sync) throw new Error(t("notes.share.unavailable"));
    if (this.sync.device) return;
    const device = await this.sync.ensureDevice();
    await this.rebind();
    this.set({ device });
  }

  /** Records this device's earlier (`web-…`) changes under its sharing id, so the others see its name. */
  private async rebind(): Promise<void> {
    const device = this.sync?.device;
    if (!device) return;
    await this.backend.rebindDevice(this.legacyDevice ?? device, device);
    await this.pump();
  }

  /** Share › Turn on sharing for a notebook (default: the current one). */
  shareNotebook(localId: string | null = this.state.notebook): Promise<void> {
    return this.run(async () => {
      if (!localId || !this.sync) return;
      if (!this.state.profile?.name) throw new Error(t("notes.share.nameFirst"));
      await this.state.mirror?.settle();
      await this.ensureSharingDevice();
      await this.pump();
      await this.persister.flush();
      await this.sync.share(localId);
      this.refreshShares();
    }).then(() => undefined);
  }

  /** An invite link (single use, 7 days) for `role` of the current shared notebook. */
  createInvite(role: Role, localId: string | null = this.state.notebook): string | null {
    const e = localId ? this.sync?.engineFor(localId) : undefined;
    if (!e) return null;
    try {
      const inv = e.invite(role);
      const base = this.linkBase();
      const name = this.state.profile?.name ?? "";
      return `${base}#i=${inv.fragment}${name ? `&n=${encodeURIComponent(name)}` : ""}`;
    } catch (err) {
      this.fail(err);
      return null;
    }
  }

  admitJoin(localId: string, inviteId: string): void {
    try {
      this.sync?.engineFor(localId)?.admit(inviteId);
    } catch (e) {
      this.fail(e);
    }
    this.set({ joinRequests: this.state.joinRequests.filter((j) => j.join.inviteId !== inviteId) });
  }

  declineJoin(localId: string, inviteId: string): void {
    this.sync?.engineFor(localId)?.decline(inviteId);
    this.set({ joinRequests: this.state.joinRequests.filter((j) => j.join.inviteId !== inviteId) });
  }

  removeMember(localId: string, device: string): void {
    try {
      this.sync?.engineFor(localId)?.removeDevice(device);
    } catch (e) {
      this.fail(e);
    }
  }

  setMemberRole(localId: string, device: string, role: Role): void {
    try {
      this.sync?.engineFor(localId)?.setRole(device, role);
    } catch (e) {
      this.fail(e);
    }
  }

  /** Owner: Stop sharing (the relay deletes its copy; everybody keeps theirs). */
  async stopSharing(localId: string | null = this.state.notebook): Promise<void> {
    if (!localId || !this.sync) return;
    if (!(await this.sync.stopSharing(localId))) this.fail(new Error(t("notes.share.offline")));
  }

  /** Opens an invite link (`#i=…`) → whether it was one. */
  async joinFromHash(hash: string): Promise<boolean> {
    const inv = parseInviteHash(hash);
    if (!inv || !this.sync) return false;
    await this.run(async () => {
      await this.ensureSharingDevice();
      await this.sync!.join(inv.fragment, inv.inviter);
      this.refreshShares();
    });
    return true;
  }

  /** Cancels a pending join (or forgets a notebook whose sharing ended) on this device. */
  async forgetShare(notebookHex: string): Promise<void> {
    await this.sync?.forget(notebookHex);
    this.refreshShares();
  }

  /** Clears a sharing notice; a notebook whose sharing stopped becomes an ordinary local notebook. */
  dismissShareNotice(localId: string): void {
    const notice = { ...this.state.shareNotice };
    delete notice[localId];
    this.set({ shareNotice: notice });
  }

  /** This device's place in the open page (presence; the page view reports the cursor). */
  setPresence(cursor: Uint8Array | null): void {
    const o = this.state.opened;
    if (!o) return;
    this.sync?.engineFor(o.notebookId)?.setPresence(o.docId, cursor);
  }

  /** Waits for queued commands and writes (tests, backups, page hide). */
  async idle(): Promise<void> {
    await this.queue;
    await this.state.mirror?.settle();
    await this.pump();
    await this.persister.flush();
  }
}

/** The core's summary (`pages` as number). */
function normalizeSummary(s: NotebookSummary): NotebookSummary {
  return { ...s, info: { ...s.info, color: s.info.color ?? null } };
}

function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").trim() || "notebook";
}

/** Sets `checked` on the node map at `path` (child indices from the `doc` map) of a page mirror. */
export function setCheckedInLoro(doc: LoroMap, path: readonly number[], checked: boolean): boolean {
  let node: LoroMap = doc;
  for (const i of path) {
    const kids = node.get("children");
    if (!(kids instanceof LoroList)) return false;
    const next = kids.get(i);
    if (!(next instanceof LoroMap)) return false;
    node = next;
  }
  if (node === doc) return false;
  const attrs = node.getOrCreateContainer("attributes", new LoroMap());
  attrs.set("checked", checked);
  return true;
}
