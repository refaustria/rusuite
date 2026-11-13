// Find on page (Ctrl+F): a bar above the page – every match highlighted, Enter / ↓ next, Shift+Enter / ↑ previous,
// Esc closes (and clears the highlights). Opening a search result opens it with the search query.

import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import { FOCUS_RING, RibbonIcon } from "@rusuite/ui-shared";
import { findKey, findStep, revealCurrent, setFind, type FindState } from "../editor/decorations";
import { useT } from "../i18n";

export function FindBar({ editor, initial, onClose }: { editor: Editor; initial: string; onClose: () => void }) {
  const t = useT();
  const [query, setQuery] = useState(initial);
  const [st, setSt] = useState<FindState | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  useEffect(() => {
    if (editor.isDestroyed) return;
    const next = setFind(editor.view, query);
    setSt(next);
    if (next.current >= 0 && initial && query === initial) revealCurrent(editor.view);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, query]);
  // Edits change the matches.
  useEffect(() => {
    const on = () => !editor.isDestroyed && setSt(findKey.getState(editor.state) ?? null);
    editor.on("transaction", on);
    return () => void editor.off("transaction", on);
  }, [editor]);
  const close = () => {
    if (!editor.isDestroyed) setFind(editor.view, "");
    onClose();
    editor.commands.focus();
  };
  const step = (dir: 1 | -1) => {
    if (!editor.isDestroyed) setSt(findStep(editor.view, dir));
  };
  const count = st?.matches.length ?? 0;
  const BTN = `inline-flex h-7 w-7 items-center justify-center rounded hover:bg-ui-hover disabled:opacity-40 ${FOCUS_RING}`;
  return (
    <div role="search" aria-label={t("notes.find.label")} className="sticky top-0 z-20 -mx-2 mb-3 flex items-center gap-2 rounded border border-ui-border bg-ui-panel px-2 py-1 text-sm shadow" data-testid="find-bar">
      <RibbonIcon name="find" />
      <input
        ref={input}
        type="search"
        className="h-7 min-w-0 flex-1 rounded border border-ui-border bg-ui-bg px-2"
        aria-label={t("notes.find.label")}
        placeholder={t("notes.find.placeholder")}
        value={query}
        data-testid="find-input"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === "ArrowDown") {
            e.preventDefault();
            step(e.shiftKey && e.key === "Enter" ? -1 : 1);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            step(-1);
          } else if (e.key === "Escape") {
            e.preventDefault();
            close();
          }
        }}
      />
      <span className="min-w-20 text-xs tabular-nums text-ui-muted" aria-live="polite" data-testid="find-count">
        {query.trim() ? (count ? t("notes.find.count", { n: (st?.current ?? 0) + 1, total: count }) : t("notes.find.none")) : ""}
      </span>
      <button type="button" className={BTN} aria-label={t("notes.find.prev")} title={t("notes.find.prev")} disabled={!count} onClick={() => step(-1)} data-testid="find-prev">
        <RibbonIcon name="chevronUp" />
      </button>
      <button type="button" className={BTN} aria-label={t("notes.find.next")} title={t("notes.find.next")} disabled={!count} onClick={() => step(1)} data-testid="find-next">
        <RibbonIcon name="chevronDown" />
      </button>
      <button type="button" className={BTN} aria-label={t("notes.close")} onClick={close} data-testid="find-close">
        ✕
      </button>
    </div>
  );
}
