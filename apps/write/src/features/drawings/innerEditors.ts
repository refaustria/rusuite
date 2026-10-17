// The nested editors of text boxes and shapes: which one has the caret,
// so that Home › Font and the Font dialog format the text inside a text
// box like Word (the main editor otherwise).

import type { Editor } from "@tiptap/core";

class InnerEditors {
  private all = new Map<Editor, () => number | undefined>();
  private members = new Map<Editor, number>();
  private focused: Editor | null = null;
  /** When a nested editor took the caret and when the main editor last selected an object (the later one is the target). */
  private focusedAt = 0;
  private mainAt = 0;
  private listeners = new Set<() => void>();

  /** `member`: the node id of the group member whose text `editor` edits. */
  register(editor: Editor, pos: () => number | undefined, member?: number): void {
    this.all.set(editor, pos);
    if (member !== undefined) this.members.set(editor, member);
    editor.on("focus", () => this.setFocused(editor));
    editor.on("blur", () => {
      // Clicks on the ribbon blur the editor: keep it as the target until another editor takes the caret.
    });
  }

  unregister(editor: Editor): void {
    this.all.delete(editor);
    this.members.delete(editor);
    if (this.focused === editor) this.setFocused(null);
  }

  /** The nested editor that had the caret last, or null (the main editor is the target). */
  active = (): Editor | null => {
    const e = this.focused;
    return e && !e.isDestroyed ? e : null;
  };

  /** The PM position (in the main document) of the drawing holding `editor`. */
  hostPos(editor: Editor): number | undefined {
    return this.all.get(editor)?.();
  }

  /** The group member (node id) whose text `editor` edits, if any. */
  memberOf(editor: Editor): number | undefined {
    return this.members.get(editor);
  }

  /** The main editor took the caret back (a click in the text). */
  release(): void {
    this.setFocused(null);
  }

  /** The main editor selected an object (a picture, a shape) itself. */
  mainSelected(): void {
    this.mainAt = ++this.clock;
  }

  /** Whether the active nested editor took the caret after the main editor's last object selection. */
  newerThanMain(): boolean {
    return this.focusedAt > this.mainAt;
  }

  private clock = 0;

  private setFocused(e: Editor | null): void {
    if (e) this.focusedAt = ++this.clock;
    if (this.focused === e) return;
    this.focused = e;
    for (const fn of this.listeners) fn();
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
}

export const innerEditors = new InnerEditors();
