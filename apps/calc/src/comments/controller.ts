// Notes, threaded comments and hyperlinks in the Calc UI (P8-26): the
// per-sheet annotation lists (from `cellAnnotations`, replaced by the
// patches' `annotations`), hover, the in-place note editor, the note box
// drag, the comment composer, the Comments pane, Show All Notes, the
// current user (kept in this browser's local storage only, ADR 0009) and
// every annotation command. It lives on the store (`store.comments`) and
// redraws through the store's version.

import type { CalcCommand } from "../generated/CalcCommand";
import type { Hyperlink } from "../generated/Hyperlink";
import type { LinkTarget } from "../generated/LinkTarget";
import type { Note } from "../generated/Note";
import type { NoteBounds } from "../generated/NoteBounds";
import type { NoteRun } from "../generated/NoteRun";
import type { Person } from "../generated/Person";
import type { SheetAnnotations } from "../generated/SheetAnnotations";
import type { Thread } from "../generated/Thread";
import { cellSelection, normalize, type Range } from "../grid/Selection";
import { t } from "../i18n";
import type { CalcStore } from "../state/store";
import { followAction, initialsOf, isoNow, linkAt, newNoteRuns, normalizeRuns, openExternal, stepCell, type FollowAction, type PxRect } from "./model";

export interface SheetAnnots {
  notes: Note[];
  threads: Thread[];
  hyperlinks: Hyperlink[];
}

export interface CellRef {
  sheet: number;
  row: number;
  col: number;
}

export interface CommentUser {
  name: string;
  initials: string;
}

/** Where the current user's name is remembered (this browser only, ADR 0009). */
export const USER_KEY = "rusuite.user";

const EMPTY: SheetAnnots = { notes: [], threads: [], hyperlinks: [] };
const same = (a: CellRef | null, b: CellRef | null) => !!a && !!b && a.sheet === b.sheet && a.row === b.row && a.col === b.col;

/** Reads the remembered user (`null`: none yet, or storage blocked). */
export function loadUser(storage: Pick<Storage, "getItem"> | null = safeStorage()): CommentUser | null {
  try {
    const raw = storage?.getItem(USER_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<CommentUser>;
    if (typeof v.name !== "string" || v.name.trim() === "") return null;
    return { name: v.name.trim(), initials: typeof v.initials === "string" && v.initials.trim() ? v.initials.trim() : initialsOf(v.name) };
  } catch {
    return null;
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** What the user is about to do once a user name is known. */
export type UserNext = "comment" | "reply" | "note";

export class CommentsController {
  private lists = new Map<number, SheetAnnots>();
  private fetching = new Map<number, Promise<void>>();
  /** The hovered cell when it has a note, a thread or a link (`null`: none). */
  hover: CellRef | null = null;
  /** Review › Show All Notes. */
  showAllNotes = false;
  /** Review › Show Comments: the Comments pane is open. */
  pane = false;
  /** The pane's filter. */
  paneFilter: "all" | "open" | "resolved" = "all";
  /** The note edited in place (`runs`: the text being typed). */
  editing: (CellRef & { runs: NoteRun[] }) | null = null;
  /** The selected (movable) note box. */
  selectedNote: CellRef | null = null;
  /** Drag/resize preview of the selected note box (sheet px). */
  preview: { at: CellRef; rect: PxRect } | null = null;
  /** The New Comment card is open at a cell. */
  composing: CellRef | null = null;
  /** A thread opened (pinned) from the pane or a menu, shown like a hover card. */
  pinned: CellRef | null = null;
  /** Sheet px → grid-root px (set by the grid; `null` before the first frame). */
  screen: ((x: number, y: number) => { x: number; y: number }) | null = null;
  /** Repositions the note overlay (set by the overlay; called by the grid after every frame). */
  positioner: (() => void) | null = null;
  private user: CommentUser | null = loadUser();

  constructor(private readonly store: CalcStore) {}

  private notify(): void {
    this.store.notify();
  }

  /** New document: forget everything. */
  reset(): void {
    this.lists.clear();
    this.fetching.clear();
    this.hover = null;
    this.editing = null;
    this.selectedNote = null;
    this.preview = null;
    this.composing = null;
    this.pinned = null;
  }

  dropSheet(sheet: number): void {
    this.lists.delete(sheet);
    this.fetching.delete(sheet);
    for (const k of ["hover", "editing", "selectedNote", "composing", "pinned"] as const) {
      if (this[k]?.sheet === sheet) this[k] = null;
    }
  }

  // --- lists ------------------------------------------------------------------------------------

  /** The annotations of `sheet` known so far (starts loading them). */
  of(sheet: number): SheetAnnots {
    const l = this.lists.get(sheet);
    // Nothing to ask before the document is there (the first render).
    if (!l && this.store.getState().info) void this.ensure(sheet);
    return l ?? EMPTY;
  }

  /** Loads the annotations of a sheet once. */
  ensure(sheet: number): Promise<void> {
    if (this.lists.has(sheet)) return Promise.resolve();
    let p = this.fetching.get(sheet);
    if (!p) {
      p = this.store.api
        .cellAnnotations(sheet, 0, 0, 1_048_575, 16_383)
        .then((a) => {
          if (this.fetching.get(sheet) !== p) return;
          this.fetching.delete(sheet);
          this.lists.set(sheet, { notes: a.notes, threads: a.threads, hyperlinks: a.hyperlinks });
          this.notify();
        })
        .catch(() => {
          this.fetching.delete(sheet);
        });
      this.fetching.set(sheet, p);
    }
    return p;
  }

  /** A patch's `annotations`: the complete lists of the changed sheets. */
  fromPatch(list: readonly SheetAnnotations[]): void {
    for (const a of list) {
      this.fetching.delete(a.sheet);
      this.lists.set(a.sheet, { notes: a.notes, threads: a.threads, hyperlinks: a.hyperlinks });
    }
    // Annotations that disappeared take their UI with them.
    if (this.editing && !this.note(this.editing) && !this.editingNew) this.editing = null;
    if (this.selectedNote && !this.note(this.selectedNote)) this.selectedNote = null;
    if (this.pinned && !this.thread(this.pinned)) this.pinned = null;
  }

  /** The note being edited was created by New Note (not saved yet). */
  editingNew = false;

  note(at: CellRef): Note | undefined {
    return this.of(at.sheet).notes.find((n) => n.row === at.row && n.col === at.col);
  }

  thread(at: CellRef): Thread | undefined {
    return this.of(at.sheet).threads.find((t) => t.row === at.row && t.col === at.col);
  }

  link(at: CellRef): Hyperlink | undefined {
    return linkAt(this.of(at.sheet).hyperlinks, at.row, at.col);
  }

  /** The notes drawn as boxes on `sheet`: visible ones (all with Show All Notes), the hovered and the edited one. */
  shownNotes(sheet: number): Note[] {
    const notes = this.of(sheet).notes;
    return notes.filter((n) => {
      const at = { sheet, row: n.row, col: n.col };
      return this.showAllNotes || n.visible || same(this.hover, at) || same(this.editing, at) || same(this.selectedNote, at);
    });
  }

  /** The active cell. */
  private active(): CellRef {
    const st = this.store.getState();
    const a = this.store.activeAnchor();
    return { sheet: st.activeSheet, row: a.row, col: a.col };
  }

  private selection(): Range {
    return normalize(this.store.getState().selection);
  }

  // --- hover --------------------------------------------------------------------------------------

  /** The pointer is over `cell` (`null`: off the cells). Only annotated cells count; leaving one clears the hover after a short delay (time to reach its card). */
  hoverAt(cell: { row: number; col: number } | null): void {
    const sheet = this.store.getState().activeSheet;
    const at = cell && { sheet, ...cell };
    const next = at && (this.note(at) || this.thread(at) || this.link(at) || this.store.cache(sheet).cells.get(at.row)?.get(at.col)?.link) ? at : null;
    if (next === null) {
      if (this.hover && !this.hoverTimer && !this.held) this.hoverTimer = setTimeout(() => this.clearHover(), this.hoverDelay);
      return;
    }
    this.cancelHoverTimer();
    if (same(next, this.hover)) return;
    this.hover = next;
    this.notify();
  }

  /** Delay before a hover card disappears, ms. */
  hoverDelay = 350;
  private hoverTimer: ReturnType<typeof setTimeout> | null = null;
  /** The pointer is on a hover card: keep it. */
  private held = false;

  private cancelHoverTimer(): void {
    if (this.hoverTimer) clearTimeout(this.hoverTimer);
    this.hoverTimer = null;
  }

  private clearHover(): void {
    this.hoverTimer = null;
    if (this.held || !this.hover) return;
    this.hover = null;
    this.notify();
  }

  /** The pointer entered (`true`) or left a hover card. */
  holdHover(on: boolean): void {
    this.held = on;
    if (on) this.cancelHoverTimer();
    else if (this.hover && !this.hoverTimer) this.hoverTimer = setTimeout(() => this.clearHover(), this.hoverDelay);
  }

  /** The status bar's text for the hovered note (`null`: none). */
  hoverNote(): Note | undefined {
    return this.hover ? this.note(this.hover) : undefined;
  }

  // --- user ---------------------------------------------------------------------------------------

  currentUser(): CommentUser | null {
    return this.user;
  }

  /** Remembers the user in this browser and records them in the document's person list. */
  setUser(name: string, initials = ""): Promise<void> {
    const u = { name: name.trim(), initials: initials.trim() || initialsOf(name) };
    this.user = u;
    try {
      safeStorage()?.setItem(USER_KEY, JSON.stringify(u));
    } catch {
      // Storage blocked: the name lasts for this session.
    }
    return this.store.apply({ type: "setUser", name: u.name, initials: u.initials });
  }

  private person(): Person {
    const u = this.user!;
    return { name: u.name, initials: u.initials };
  }

  /** Runs `next` once a user name is known (asks for it first). */
  private withUser(next: UserNext, run: () => void): void {
    if (this.user) return run();
    this.store.openDialog({ kind: "userName", next });
    this.afterUser = run;
  }

  /** Continues what was waiting for the user name (the user dialog calls it). */
  afterUser: (() => void) | null = null;

  // --- notes ----------------------------------------------------------------------------------------

  /** Shift+F2 / New Note / Edit Note: opens the note of the active cell in place (a new note asks for the user name first, for its author line). */
  editNote(at: CellRef = this.active()): void {
    if (!this.note(at) && !this.user) return this.withUser("note", () => this.editNote(at));
    const note = this.note(at);
    this.composing = null;
    this.editingNew = !note;
    this.editing = { ...at, runs: note ? note.text.map((r) => ({ ...r })) : newNoteRuns(this.user?.name ?? "") };
    this.selectedNote = null;
    this.notify();
  }

  /** Commits the in-place editor (an empty new note is dropped). */
  async commitNote(runs: NoteRun[]): Promise<void> {
    const e = this.editing;
    if (!e) return;
    this.editing = null;
    this.editingNew = false;
    const text = normalizeRuns(runs);
    const old = this.note(e);
    const unchanged = old && JSON.stringify(normalizeRuns(old.text)) === JSON.stringify(text);
    if (unchanged || (!old && text.every((r) => r.text.trim() === "" || r.text === `${this.user?.name ?? ""}:`))) {
      this.notify();
      return;
    }
    const cmd: CalcCommand = { type: "setNote", sheet: e.sheet, row: e.row, col: e.col, text };
    if (!old && this.user) cmd.author = this.user.name;
    await this.store.apply(cmd);
  }

  cancelNote(): void {
    this.editing = null;
    this.editingNew = false;
    this.notify();
  }

  /** Moves/resizes a note box. */
  setNoteBounds(at: CellRef, bounds: NoteBounds): Promise<void> {
    const note = this.note(at);
    if (!note) return Promise.resolve();
    return this.store.apply({ type: "setNote", sheet: at.sheet, row: at.row, col: at.col, text: note.text, bounds });
  }

  /** Delete Note for the selection (or the active cell). */
  deleteNotes(): Promise<void> {
    const r = this.selection();
    return this.store.apply({ type: "deleteNote", sheet: this.store.getState().activeSheet, ...r });
  }

  /** Show/Hide Note of the active cell. */
  toggleNote(at: CellRef = this.active()): Promise<void> {
    if (!this.note(at)) return Promise.resolve();
    return this.store.apply({ type: "showHideNote", sheet: at.sheet, row: at.row, col: at.col });
  }

  toggleAllNotes(): void {
    this.showAllNotes = !this.showAllNotes;
    this.notify();
  }

  convertNotes(): void {
    this.withUser("comment", () => void this.store.apply({ type: "convertNotesToComments", sheet: this.store.getState().activeSheet, author: this.person(), date: isoNow() }));
  }

  /** Selects the next/previous note (Review › Notes ▾). */
  stepNote(dir: 1 | -1): void {
    this.goTo(stepCell(this.of(this.store.getState().activeSheet).notes, this.active(), dir));
  }

  private goTo(target: { row: number; col: number } | null): void {
    if (!target) return;
    const sheet = this.store.getState().activeSheet;
    this.store.goToRange(sheet, { r0: target.row, c0: target.col, r1: target.row, c1: target.col });
  }

  // --- threads ----------------------------------------------------------------------------------------

  /** Ctrl+Shift+F2 / New Comment: the composer at the active cell (a cell with a thread: reply there). */
  newComment(at: CellRef = this.active()): void {
    this.withUser("comment", () => {
      this.editing = null;
      if (this.thread(at)) this.pinned = at;
      else this.composing = at;
      this.notify();
    });
  }

  cancelCompose(): void {
    this.composing = null;
    this.notify();
  }

  /** Posts the composer's text as a new thread. */
  async postComment(text: string): Promise<void> {
    const at = this.composing;
    if (!at || !text.trim() || !this.user) return;
    this.composing = null;
    this.pinned = at;
    await this.store.apply({ type: "addComment", sheet: at.sheet, row: at.row, col: at.col, text: text.trim(), author: this.person(), date: isoNow() });
  }

  reply(at: CellRef, text: string): void {
    if (!text.trim()) return;
    this.withUser("reply", () => void this.store.apply({ type: "replyComment", sheet: at.sheet, row: at.row, col: at.col, text: text.trim(), author: this.person(), date: isoNow() }));
  }

  editComment(at: CellRef, id: string, text: string): Promise<void> {
    if (!text.trim()) return Promise.resolve();
    return this.store.apply({ type: "editComment", sheet: at.sheet, row: at.row, col: at.col, id, text: text.trim() });
  }

  deleteReply(at: CellRef, id: string): Promise<void> {
    return this.store.apply({ type: "deleteReply", sheet: at.sheet, row: at.row, col: at.col, id });
  }

  /** Deletes the thread at `at` (default: every thread of the selection). */
  deleteThreads(at?: CellRef): Promise<void> {
    if (at) {
      if (same(this.pinned, at)) this.pinned = null;
      return this.store.apply({ type: "deleteThread", sheet: at.sheet, r0: at.row, c0: at.col, r1: at.row, c1: at.col });
    }
    this.pinned = null;
    return this.store.apply({ type: "deleteThread", sheet: this.store.getState().activeSheet, ...this.selection() });
  }

  resolve(at: CellRef, resolved: boolean): Promise<void> {
    return this.store.apply({ type: "resolveThread", sheet: at.sheet, row: at.row, col: at.col, resolved });
  }

  /** Review › Previous/Next Comment: selects the cell and opens its thread. */
  stepComment(dir: 1 | -1): void {
    const sheet = this.store.getState().activeSheet;
    const t = stepCell(this.of(sheet).threads, this.active(), dir);
    if (!t) return;
    this.goTo(t);
    this.pinned = { sheet, row: t.row, col: t.col };
    this.notify();
  }

  /** Opens a thread's card (from the pane). */
  pin(at: CellRef | null): void {
    this.pinned = at;
    if (at) this.store.goToRange(at.sheet, { r0: at.row, c0: at.col, r1: at.row, c1: at.col });
    this.notify();
  }

  togglePane(): void {
    this.pane = !this.pane;
    this.notify();
  }

  /** Delete (Review › Delete): the threads of the selection, else its notes. */
  deleteAny(): Promise<void> {
    const sheet = this.store.getState().activeSheet;
    const r = this.selection();
    const inside = (x: { row: number; col: number }) => x.row >= r.r0 && x.row <= r.r1 && x.col >= r.c0 && x.col <= r.c1;
    if (this.of(sheet).threads.some(inside)) return this.deleteThreads();
    return this.deleteNotes();
  }

  // --- hyperlinks -----------------------------------------------------------------------------------

  /** Insert › Link (Ctrl+K). */
  openLinkDialog(): void {
    this.store.openDialog({ kind: "link" });
  }

  setLink(target: LinkTarget, text: string, tooltip: string): Promise<void> {
    const sheet = this.store.getState().activeSheet;
    const r = this.selection();
    return this.store.apply({ type: "setHyperlink", sheet, ...r, target, ...(text ? { text } : {}), ...(tooltip ? { tooltip } : {}) });
  }

  removeLink(): Promise<void> {
    return this.store.apply({ type: "removeHyperlink", sheet: this.store.getState().activeSheet, ...this.selection() });
  }

  /** Where a click on the cell's link leads (a `HYPERLINK()` cell asks the core). */
  async linkTarget(at: CellRef): Promise<LinkTarget | null> {
    const h = this.link(at);
    if (h) return h.target;
    const cell = this.store.cache(at.sheet).cells.get(at.row)?.get(at.col);
    if (!cell?.link) return null;
    const a = await this.store.api.cellAnnotations(at.sheet, at.row, at.col, at.row, at.col);
    return a.formulaLinks[0]?.target ?? a.hyperlinks[0]?.target ?? null;
  }

  /** Follows the link of a cell (Ctrl+click, Open Hyperlink): a web page / mail in a new tab, a place by selecting it. */
  async follow(at: CellRef, open: (href: string) => void = openExternal): Promise<FollowAction | null> {
    const target = await this.linkTarget(at);
    if (!target) return null;
    const st = this.store.getState();
    const action = followAction(target, st.info?.names ?? [], st.info?.sheets ?? [], at.sheet);
    if (!action) {
      this.store.pushError(new Error(t("calc.link.invalid")));
      return null;
    }
    if (action.kind === "external") open(action.href);
    else this.store.goToRange(action.sheet, action.range);
    return action;
  }

  /** Selects the cell under a link without following it. */
  selectCell(at: CellRef): void {
    this.store.select(cellSelection(at.row, at.col));
  }
}
