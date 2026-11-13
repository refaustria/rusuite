// Writes the core's persist effects to the store in batches: at most `delay` ms (≤ 250) after the first queued
// effect, one transaction per batch, and at once when the page is hidden or unloaded.

import type { PersistEffect } from "./effects";
import type { NotesStore } from "./store";

export type SaveState = "saved" | "saving" | "error";

export const PERSIST_DELAY_MS = 200;

export class Persister {
  private queue: PersistEffect[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private writing: Promise<void> = Promise.resolve();
  private state: SaveState = "saved";
  private error: unknown = null;
  private listeners = new Set<() => void>();

  constructor(
    private store: NotesStore,
    private readonly delay = PERSIST_DELAY_MS,
  ) {}

  /** Points at another store (Remove local data replaces nothing, but tests swap stores). */
  setStore(store: NotesStore): void {
    this.store = store;
  }

  getState = (): SaveState => this.state;
  getError = (): unknown => this.error;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private set(state: SaveState): void {
    if (state === this.state) return;
    this.state = state;
    for (const l of this.listeners) l();
  }

  /** Queues effects; they are written within `delay` ms. */
  enqueue(effects: readonly PersistEffect[]): void {
    if (effects.length === 0) return;
    this.queue.push(...effects);
    this.set("saving");
    this.timer ??= setTimeout(() => void this.flush(), this.delay);
  }

  /** Whether effects are waiting or being written. */
  pending(): boolean {
    return this.queue.length > 0 || this.state === "saving";
  }

  /** Writes everything queued now; resolves when it is stored. */
  flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const batch = this.queue;
    this.queue = [];
    this.writing = this.writing.then(async () => {
      if (batch.length === 0) return;
      try {
        await this.store.apply(batch);
        this.error = null;
      } catch (e) {
        this.error = e;
        // Keep the batch: the next flush retries it before newer effects.
        this.queue = [...batch, ...this.queue];
        this.set("error");
        return;
      }
    });
    return this.writing.then(() => {
      if (this.queue.length === 0 && this.state !== "error") this.set("saved");
      else if (this.state !== "error") this.set("saving");
    });
  }

  /** Drops queued effects (Remove local data). */
  discard(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.queue = [];
    this.set("saved");
  }

  /** Flushes on `visibilitychange` (hidden) and `pagehide`; returns the uninstaller. */
  installPageHooks(target: { addEventListener: Document["addEventListener"]; removeEventListener: Document["removeEventListener"] } = document, win: Window = window): () => void {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") void this.flush();
    };
    const onHide = () => void this.flush();
    target.addEventListener("visibilitychange", onVisibility);
    win.addEventListener("pagehide", onHide);
    return () => {
      target.removeEventListener("visibilitychange", onVisibility);
      win.removeEventListener("pagehide", onHide);
    };
  }
}
