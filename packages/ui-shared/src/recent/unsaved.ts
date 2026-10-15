// Unsaved-changes safety (P7-6): before a command replaces or closes the
// document (New, Open, a recent file, Restore, Close, closing the window),
// `ensureSaved` asks "Save changes to <name>?" with Save / Don't save /
// Cancel, as Office does. Save runs the app's save flow (Save As when the
// document is untitled) and the command only proceeds when the file was
// written.
//
// `UnsavedGuard` is the per-window controller: it owns the pending
// question (rendered by `ConfirmDiscard`), runs guarded commands one at a
// time, and protects closing the window – web: the browser's native
// `beforeunload` prompt; desktop: the shell holds the close request while
// the document is dirty and the guard asks the same question.

import type { Backend } from "../backend";
import { tauriCloseHooks, type CloseHooks } from "./closeGuard";

export type SaveChoice = "save" | "discard" | "cancel";
export type EnsureResult = "proceed" | "cancel";

/** What the guard needs to know about (and do with) the open document. */
export interface DocState {
  /** Unsaved changes? */
  dirty(): boolean;
  /** File name; `null` = untitled (never saved or opened). */
  name(): string | null;
  /** The Save As name offered for an untitled document (e.g. `Workbook.xlsx`). */
  defaultName: string;
  /**
   * The app's save flow (`asName`: Save As under that name). Resolves
   * `true` only when the file was written; `false`/rejection = not saved.
   */
  save(asName?: string): Promise<boolean>;
}

/** The questions `ensureSaved` asks. */
export interface SavePrompts {
  /** "Save changes to <name>?" */
  askSave(name: string): Promise<SaveChoice>;
  /**
   * Save As file name for an untitled document; `null` = cancelled.
   * Absent: the shell's own save dialog is the Save As (desktop).
   */
  askName?(initial: string): Promise<string | null>;
}

/**
 * Asks before the document is replaced or closed. A clean document
 * proceeds at once; Don't save proceeds; Cancel, a cancelled Save As and
 * a failed save cancel.
 */
export async function ensureSaved(prompts: SavePrompts, doc: DocState): Promise<EnsureResult> {
  if (!doc.dirty()) return "proceed";
  const name = doc.name();
  const choice = await prompts.askSave(name ?? "Untitled");
  if (choice === "cancel") return "cancel";
  if (choice === "discard") return "proceed";
  let asName: string | undefined;
  if (name === null && prompts.askName) {
    const picked = await prompts.askName(doc.defaultName);
    if (picked === null) return "cancel";
    asName = picked;
  }
  let saved: boolean;
  try {
    saved = await doc.save(asName);
  } catch {
    saved = false;
  }
  return saved && !doc.dirty() ? "proceed" : "cancel";
}

/** The question on screen (`ConfirmDiscard` renders it). */
export type UnsavedPrompt = { kind: "save"; name: string } | { kind: "name"; initial: string } | null;

export interface WindowGuardOptions {
  /** Desktop close hooks; default the Tauri shell's (`kind: "tauri"` only). */
  hooks?: CloseHooks;
  /** Target of the web `beforeunload` listener; default `window`. */
  target?: Pick<Window, "addEventListener" | "removeEventListener"> | null;
}

export class UnsavedGuard {
  private prompt: UnsavedPrompt = null;
  private settle: ((v: SaveChoice | string | null) => void) | null = null;
  private listeners = new Set<() => void>();
  private running: Promise<EnsureResult> | null = null;
  private hooks: CloseHooks | null = null;
  private guarded: boolean | null = null;

  constructor(
    private readonly backend: Pick<Backend, "kind">,
    readonly doc: DocState,
  ) {}

  // --- store plumbing -------------------------------------------------------

  getState = (): UnsavedPrompt => this.prompt;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private show(prompt: UnsavedPrompt): Promise<SaveChoice | string | null> {
    // A question still open is answered "cancel" first.
    this.settle?.(this.prompt?.kind === "name" ? null : "cancel");
    this.prompt = prompt;
    for (const fn of this.listeners) fn();
    return new Promise((resolve) => {
      this.settle = (v) => {
        this.settle = null;
        this.prompt = null;
        for (const fn of this.listeners) fn();
        resolve(v);
      };
    });
  }

  /** Answers the three-button question (the dialog's buttons; Esc = cancel). */
  choose(choice: SaveChoice): void {
    if (this.prompt?.kind === "save") this.settle?.(choice);
  }

  /** Answers the Save As name question; `null` = cancelled. */
  submitName(name: string | null): void {
    if (this.prompt?.kind === "name") this.settle?.(name);
  }

  readonly prompts: SavePrompts = {
    askSave: async (name) => (await this.show({ kind: "save", name })) as SaveChoice,
    askName: async (initial) => {
      const v = await this.show({ kind: "name", initial });
      return typeof v === "string" ? v : null;
    },
  };

  // --- guarded commands -----------------------------------------------------

  /**
   * `ensureSaved` for this window's document. In the browser an untitled
   * document is named first (the download has no dialog); on the desktop
   * the native save dialog is the Save As. While a question is open,
   * further calls cancel at once.
   */
  ensureSaved(): Promise<EnsureResult> {
    if (this.running) return Promise.resolve("cancel");
    const prompts: SavePrompts =
      this.backend.kind === "wasm" ? this.prompts : { askSave: this.prompts.askSave };
    const run = ensureSaved(prompts, this.doc).finally(() => {
      this.running = null;
    });
    this.running = run;
    return run;
  }

  /** Runs `action` once `ensureSaved` proceeded; resolves whether it ran. */
  async run(action: () => unknown): Promise<boolean> {
    if ((await this.ensureSaved()) === "cancel") return false;
    await action();
    return true;
  }

  // --- closing the window ---------------------------------------------------

  private onBeforeUnload = (e: BeforeUnloadEvent) => {
    if (!this.doc.dirty()) return;
    e.preventDefault();
    // Older engines need `returnValue` set to show the prompt.
    e.returnValue = "";
  };

  /**
   * Protects closing the window while the document is dirty. Web: the
   * browser's `beforeunload` prompt. Desktop: the shell holds the close
   * request (see `syncDirty`) and this guard asks; after Save / Don't save
   * it lifts the shell's guard and closes. Returns the cleanup.
   */
  watchWindow(options: WindowGuardOptions = {}): () => void {
    if (this.backend.kind === "tauri" || options.hooks) {
      const hooks = options.hooks ?? tauriCloseHooks();
      this.hooks = hooks;
      this.guarded = null;
      this.syncDirty();
      let unlisten: (() => void) | null = null;
      let disposed = false;
      void hooks
        .listen(() => void this.closeRequested())
        .then((u) => {
          if (disposed) u();
          else unlisten = u;
        })
        .catch(() => undefined);
      return () => {
        disposed = true;
        unlisten?.();
        if (this.hooks === hooks) this.hooks = null;
      };
    }
    const target = options.target === undefined ? (typeof window === "undefined" ? null : window) : options.target;
    if (!target) return () => {};
    target.addEventListener("beforeunload", this.onBeforeUnload as EventListener);
    return () => target.removeEventListener("beforeunload", this.onBeforeUnload as EventListener);
  }

  /** Tells the desktop shell whether to hold close requests (call when the dirty flag changes). */
  syncDirty(): void {
    const hooks = this.hooks;
    if (!hooks) return;
    const dirty = this.doc.dirty();
    if (dirty === this.guarded) return;
    this.guarded = dirty;
    void hooks.setGuard(dirty).catch(() => undefined);
  }

  /** A held close request (desktop): ask, then close for real unless cancelled. */
  async closeRequested(): Promise<boolean> {
    const hooks = this.hooks;
    if (!hooks) return false;
    if ((await this.ensureSaved()) === "cancel") return false;
    this.guarded = false;
    await hooks.setGuard(false);
    await hooks.close();
    return true;
  }
}
