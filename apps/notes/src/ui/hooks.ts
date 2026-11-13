import { useEffect, useState, useSyncExternalStore } from "react";
import type { Editor } from "@tiptap/core";
import type { NotesController, NotesState } from "../controller";

/** A slice of the controller state (re-renders when it changes). */
export function useNotes<T>(ctl: NotesController, select: (s: NotesState) => T): T {
  return useSyncExternalStore(ctl.subscribe, () => select(ctl.getState()));
}

/** Re-renders on editor transactions, at most every `ms` (ribbon states while typing). */
export function useEditorTick(editor: Editor | null, ms = 80): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!editor) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const on = () => {
      timer ??= setTimeout(() => {
        timer = undefined;
        setN((x) => x + 1);
      }, ms);
    };
    editor.on("transaction", on);
    editor.on("selectionUpdate", on);
    return () => {
      clearTimeout(timer);
      editor.off("transaction", on);
      editor.off("selectionUpdate", on);
    };
  }, [editor, ms]);
  return n;
}
