// The Notes app state and commands. The core (through `NotesBackend`) owns the documents; this controller keeps
// what the UI shows (open notebooks and their trees, the selection, the open page and its editor mirror), turns
// UI actions into core requests stamped with the UI clock, and hands every resulting persist effect to storage.

import { getSchema } from "@tiptap/core";
import { Node as PMNode } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { createNodeFromLoroObj, updateLoroToPmState, type LoroDocType } from "loro-prosemirror";
import { CoreError, unwrap, type Body, type NotesBackend, type NotesRequest } from "./backend";
import type { DeletedNode } from "./generated/DeletedNode";
import type { LoadWarning } from "./generated/LoadWarning";
import type { NotebookSummary } from "./generated/NotebookSummary";
import type { OpenedPage } from "./generated/OpenedPage";
import type { ResponseBody } from "./generated/ResponseBody";
import type { TreeNode } from "./generated/TreeNode";
import { PageMirror } from "./editor/mirror";
import { notesSchemaExtensions } from "./editor/schema";
import { Persister } from "./persister";
import type { NotesStore } from "./store";
import { allPages, allSections, findNode, flatPages, indentTarget, MAX_PAGE_LEVEL, nextSectionColor, outdentTarget, sectionOf } from "./tree";
import { t } from "./i18n";
import { welcomeContent } from "./welcome";

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
  view: "page" | "recycleBin";
  recycle: DeletedNode[];
  recent: RecentPage[];
  settings: Settings;
  storage: StorageStatus;
  warnings: LoadWarning[];
  /** The last error message (a toast). */
  error: string | null;
  canUndo: boolean;
  canRedo: boolean;
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
    recent: [],
    settings: DEFAULT_SETTINGS,
    storage: "unknown",
    warnings: [],
    error: null,
    canUndo: false,
    canRedo: false,
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

  constructor(
    readonly backend: NotesBackend,
    readonly store: NotesStore,
    /** The clock (Unix ms) stamped on every request. */
    private readonly now: () => number = Date.now,
    persister?: Persister,
  ) {
    this.persister = persister ?? new Persister(store);
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

  dismissError(): void {
    this.set({ error: null });
  }

  // ---- core calls ---------------------------------------------------------------------------------------

  private async call<K extends Kind>(request: NotesRequest, _kind?: K): Promise<Body<K>> {
    const body = unwrap(await this.backend.dispatch({ ...request, now: this.now() }));
    return body as Body<K>;
  }

  /** Moves the core's queued persist effects to storage. */
  private async pump(): Promise<void> {
    this.persister.enqueue(await this.backend.takePersistEffects());
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
    }).then(() => {
      if (this.state.phase === "loading") this.set({ phase: "failed" });
    });
  }

  /** `navigator.storage.persist()`; denied → the backup hint. */
  private async requestPersistence(): Promise<void> {
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
    if (!docs.some((d) => d.doc === id)) return null;
    for (const d of docs) {
      const r = unwrap(await this.backend.loadDoc(id, d.doc, d.snapshot, d.log)) as Body<"loaded">;
      warnings.push(...r.warnings);
    }
    const opened = (await this.call({ type: "openNotebook", id })) as Body<"notebook">;
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
      this.treeOps = [];
      this.treeRedo = [];
      this.undoneKinds = [];
      this.set({ known: [], notebooks: [], notebook: null, section: null, page: null, recent: [], view: "page", recycle: [], warnings: [], settings: { ...this.state.settings, persistHintDismissed: false } });
    });
  }

  // ---- settings -----------------------------------------------------------------------------------------

  updateSettings(patch: Partial<Settings>): void {
    const settings = { ...this.state.settings, ...patch };
    this.set({ settings });
    void this.store.setMeta(META_SETTINGS, settings).catch((e) => this.fail(e));
  }

  /** The link that opens a page (`#page=<page doc id>` on this app's URL). */
  pageLink(node: string): string | null {
    const n = findNode(this.tree(), node);
    if (!n?.pageDoc) return null;
    const base = typeof location === "undefined" ? "" : `${location.origin}${location.pathname}`;
    return `${base}#page=${n.pageDoc}`;
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
