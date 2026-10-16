// The nested editors of text boxes and shapes: which one has the caret,
// so that Home › Font and the Font dialog format the text inside a text
// box like Word (the main editor otherwise).

import type { Editor } from "@tiptap/core";

class InnerEditors {
  private all = new Map<Editor, () => number | undefined>();
  private focused: Editor | null = null;
  private listeners = new Set<() => void>();

  register(editor: Editor, pos: () => number | undefined): void {
    this.all.set(editor, pos);
    editor.on("focus", () => this.setFocused(editor));
    editor.on("blur", () => {
      // Clicks on the ribbon blur the editor: keep it as the target until another editor takes the caret.
    });
  }

  unregister(editor: Editor): void {
    this.all.delete(editor);
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

  /** The main editor took the caret back (a click in the text). */
  release(): void {
    this.setFocused(null);
  }

  private setFocused(e: Editor | null): void {
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
