// IME guard (spike finding Q4): loro-prosemirror rebuilds the ProseMirror document on every import; doing that
// during an IME composition corrupts it (a stray dead-key "^", moved text). Imports of remote or core updates are
// therefore held while the editor composes and applied, in order, right after `compositionend`. There are no
// remote peers before P11-N5b, but core-side changes of the open page (title, history restore) take this path too.

export class ImeGuard {
  private held: (() => void)[] = [];
  private detach: (() => void) | null = null;

  constructor(private composing: () => boolean = () => false) {}

  /** Runs `fn` now, or after the current composition ends. */
  run(fn: () => void): void {
    if (this.composing() || this.held.length > 0) this.held.push(fn);
    else fn();
  }

  /** Number of held imports (tests). */
  get pending(): number {
    return this.held.length;
  }

  /** Applies everything held (unless a new composition started). */
  flush(): void {
    if (this.composing()) return;
    const held = this.held;
    this.held = [];
    for (const fn of held) fn();
  }

  /** Watches an editor DOM node: `composing` comes from the view, the queue drains after `compositionend`. */
  attach(dom: HTMLElement, composing: () => boolean): () => void {
    this.detach?.();
    this.composing = composing;
    // The view clears `composing` after the event: drain on the next task.
    const onEnd = () => setTimeout(() => this.flush(), 0);
    dom.addEventListener("compositionend", onEnd);
    this.detach = () => dom.removeEventListener("compositionend", onEnd);
    return () => {
      this.detach?.();
      this.detach = null;
      this.composing = () => false;
      this.flush();
    };
  }
}
