// The page editor's own keys (docs/shortcuts.md, Notes) and the block drag handle (⋮⋮ left of the block under the
// pointer; dragging it moves the block with ProseMirror's own drop handling).

import { Extension, InputRule } from "@tiptap/core";
import { NodeSelection, Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { BUILTIN_TAGS } from "../tags";
import { clearFormatting, insertDateTime, toggleTag } from "./commands";

export interface NotesKeysOptions {
  /** Ctrl+K: the link dialog. */
  onLink: () => void;
  /** `[[` typed: the page picker. */
  onPageLinkPicker: () => void;
  /** Label of the drag handle (aria / tooltip). */
  dragLabel: string;
}

export const NotesKeys = Extension.create<NotesKeysOptions>({
  name: "notesKeys",
  addOptions: () => ({ onLink: () => undefined, onPageLinkPicker: () => undefined, dragLabel: "" }),
  addKeyboardShortcuts() {
    return {
      ...Object.fromEntries(
        BUILTIN_TAGS.filter((tag) => tag.shortcut).map((tag) => [tag.shortcut!.replace("Mod+", "Mod-"), () => toggleTag(this.editor, tag.id, tag.kind === "toDo")]),
      ),
      "Mod-Space": () => clearFormatting(this.editor),
      "Mod-Alt-h": () => this.editor.commands.toggleMark("highlight"),
      "Alt-Shift-d": () => insertDateTime(this.editor, "date"),
      "Alt-Shift-t": () => insertDateTime(this.editor, "time"),
      "Alt-Shift-f": () => insertDateTime(this.editor, "both"),
      "Mod-k": () => {
        this.options.onLink();
        return true;
      },
    };
  },
  addInputRules() {
    return [
      new InputRule({
        find: /\[\[$/,
        handler: ({ range, chain }) => {
          chain().deleteRange(range).run();
          setTimeout(() => this.options.onPageLinkPicker(), 0);
        },
      }),
    ];
  },
  addProseMirrorPlugins() {
    return [dragHandle(this.options.dragLabel)];
  },
});

const dragKey = new PluginKey("notesDragHandle");

/** The top-level block DOM node at viewport height `y`, with its document position. */
function blockAt(view: EditorView, y: number): { dom: HTMLElement; pos: number } | null {
  for (const child of Array.from(view.dom.children) as HTMLElement[]) {
    const r = child.getBoundingClientRect();
    if (y >= r.top && y <= r.bottom) {
      const inside = view.posAtDOM(child, 0);
      const $pos = view.state.doc.resolve(Math.min(inside, view.state.doc.content.size));
      const pos = $pos.depth > 0 ? $pos.before(1) : inside;
      return { dom: child, pos };
    }
  }
  return null;
}

function dragHandle(label: string): Plugin {
  return new Plugin({
    key: dragKey,
    view(view) {
      const handle = document.createElement("div");
      handle.className = "notes-drag-handle";
      handle.textContent = "⋮⋮";
      handle.draggable = true;
      handle.title = label;
      handle.setAttribute("aria-hidden", "true");
      handle.setAttribute("data-testid", "drag-handle");
      handle.contentEditable = "false";
      handle.style.display = "none";
      const host = view.dom.parentElement;
      host?.appendChild(handle);
      let current: { dom: HTMLElement; pos: number } | null = null;

      const place = (e: MouseEvent) => {
        if (!view.editable) return;
        const b = blockAt(view, e.clientY);
        if (!b || !host) return;
        current = b;
        const hr = host.getBoundingClientRect();
        const br = b.dom.getBoundingClientRect();
        handle.style.display = "";
        handle.style.top = `${br.top - hr.top + host.scrollTop}px`;
        handle.style.left = `${br.left - hr.left - 22}px`;
      };
      const hide = (e: MouseEvent) => {
        if (e.relatedTarget === handle) return;
        handle.style.display = "none";
      };
      const onDragStart = (e: DragEvent) => {
        if (!current) return;
        const sel = NodeSelection.create(view.state.doc, current.pos);
        view.dispatch(view.state.tr.setSelection(sel));
        const slice = sel.content();
        // ProseMirror's drop handler moves the dragged slice (and deletes the original) when `move` is set.
        (view as unknown as { dragging: unknown }).dragging = { slice, move: true, node: sel };
        e.dataTransfer?.setData("text/plain", current.dom.textContent ?? "");
        e.dataTransfer?.setDragImage(current.dom, 0, 0);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
      };
      const onDragEnd = () => {
        handle.style.display = "none";
        current = null;
      };
      view.dom.addEventListener("mousemove", place);
      view.dom.addEventListener("mouseleave", hide);
      handle.addEventListener("dragstart", onDragStart);
      handle.addEventListener("dragend", onDragEnd);
      return {
        destroy() {
          view.dom.removeEventListener("mousemove", place);
          view.dom.removeEventListener("mouseleave", hide);
          handle.remove();
        },
      };
    },
  });
}
