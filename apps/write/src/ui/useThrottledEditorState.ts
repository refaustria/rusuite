// Selection-dependent UI state (toolbar) derived from the editor, kept out of
// the typing path: transactions that change the document update it at most
// every `THROTTLE_MS` (trailing); selection/mark-only transactions (a click,
// arrow keys, a toolbar command) update it at once. Only a changed value
// re-renders the component.

import { useEffect, useRef, useSyncExternalStore } from "react";
import type { Editor } from "@tiptap/react";

export const THROTTLE_MS = 60;

interface Options<T> {
  editor: Editor;
  selector: (ctx: { editor: Editor }) => T;
  throttleMs?: number;
}

export function useThrottledEditorState<T>({ editor, selector, throttleMs = THROTTLE_MS }: Options<T>): T {
  const selectorRef = useRef(selector);
  selectorRef.current = selector;
  const store = useRef<{ value: T; key: string; listeners: Set<() => void> } | null>(null);
  if (!store.current) {
    const value = selector({ editor });
    store.current = { value, key: JSON.stringify(value), listeners: new Set() };
  }
  const st = store.current;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      timer = undefined;
      const value = selectorRef.current({ editor });
      const key = JSON.stringify(value);
      if (key === st.key) return;
      st.value = value;
      st.key = key;
      st.listeners.forEach((l) => l());
    };
    const onTransaction = ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (!transaction.docChanged) {
        clearTimeout(timer);
        refresh();
      } else if (timer === undefined) {
        timer = setTimeout(refresh, throttleMs);
      }
    };
    refresh();
    editor.on("transaction", onTransaction);
    return () => {
      clearTimeout(timer);
      editor.off("transaction", onTransaction);
    };
  }, [editor, st, throttleMs]);

  return useSyncExternalStore(
    (l) => {
      st.listeners.add(l);
      return () => st.listeners.delete(l);
    },
    () => st.value,
  );
}
