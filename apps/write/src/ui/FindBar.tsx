// Find and replace bar (Ctrl+F / Ctrl+H), non-modal so that the
// highlighted matches stay visible: typing highlights every match in the
// editor, Enter / Shift+Enter (or the arrows) move to the next / previous
// one. "Replace" replaces the current match through an editor transaction
// (→ `ReplaceText`); "Replace all" is the Rust `FindReplace` command.

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Editor } from "@tiptap/react";
import { findState, findStep, replaceCurrent, setFindQuery } from "../features/find";
import type { WriteUi } from "../features/WriteFeatures";
import type { SyncController } from "../sync/SyncPlugin";

const INPUT = "h-7 w-full rounded border border-ui-border bg-ui-bg px-2 text-sm text-ui-fg";
const BUTTON = "h-7 rounded border border-ui-border bg-ui-bg px-2 text-sm text-ui-fg hover:bg-ui-hover disabled:opacity-40";

/** "3 of 12" / "No results" for the match counter. */
export function matchLabel(current: number, total: number, query: string): string {
  if (!query) return "";
  if (!total) return "No results";
  return current >= 0 ? `${current + 1} of ${total}` : `${total} results`;
}

export function FindBar({ ctl, editor, ui }: { ctl: SyncController; editor: Editor | null; ui: WriteUi }) {
  const find = useSyncExternalStore(ui.subscribe, () => ui.getState().find);
  const [text, setText] = useState("");
  const [replace, setReplace] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [showReplace, setShowReplace] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  // Opening (Ctrl+F / Ctrl+H): seed with the selected text, focus the field.
  useEffect(() => {
    if (!find.open) return;
    setShowReplace((r) => r || find.replace);
    setResult(null);
    if (editor) {
      const { from, to, empty } = editor.state.selection;
      const sel = empty ? "" : editor.state.doc.textBetween(from, to, " ");
      if (sel && !sel.includes("\n") && sel.length < 200) setText(sel);
    }
    setTimeout(() => {
      input.current?.focus();
      input.current?.select();
    }, 0);
  }, [find.open, find.seed, find.replace, editor]);

  // Highlighting follows the query; closing clears it.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    setFindQuery(editor.view, find.open && text ? { text, matchCase, wholeWord } : null);
  }, [editor, find.open, text, matchCase, wholeWord]);

  // Re-render the counter on editor changes.
  useEffect(() => {
    if (!editor || !find.open) return;
    const on = () => setTick((t) => t + 1);
    editor.on("transaction", on);
    return () => {
      editor.off("transaction", on);
    };
  }, [editor, find.open]);

  if (!find.open) return null;
  const st = editor && !editor.isDestroyed ? findState(editor.state) : null;
  const total = st?.matches.length ?? 0;
  const close = () => {
    ui.closeFind();
    editor?.commands.focus();
  };
  const step = (dir: 1 | -1) => {
    if (editor) findStep(editor.view, dir);
  };
  const replaceAll = async () => {
    setResult(null);
    await ctl.run({ type: "findReplace", find: text, replace, matchCase, wholeWord, all: true });
    setResult(ctl.getState().info);
  };

  return (
    <div
      role="dialog"
      aria-label="Find and replace"
      className="fixed right-6 top-[100px] z-30 flex w-80 flex-col gap-2 rounded-lg border border-ui-border bg-ui-panel p-3 text-sm text-ui-fg shadow-xl"
      data-testid="find-bar"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          close();
        }
      }}
    >
      <div className="flex items-center gap-1">
        <input
          ref={input}
          aria-label="Find"
          className={INPUT}
          placeholder="Search for text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              step(e.shiftKey ? -1 : 1);
            }
          }}
        />
        <button type="button" className={BUTTON} aria-label="Previous match" title="Previous (Shift+Enter)" disabled={!total} onClick={() => step(-1)}>
          ↑
        </button>
        <button type="button" className={BUTTON} aria-label="Next match" title="Next (Enter)" disabled={!total} onClick={() => step(1)}>
          ↓
        </button>
      </div>
      <div className="flex items-center justify-between text-xs text-ui-muted">
        <span data-testid="match-count">{matchLabel(st?.current ?? -1, total, text)}</span>
        <span className="flex gap-3">
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} /> Match case
          </label>
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={wholeWord} onChange={(e) => setWholeWord(e.target.checked)} /> Whole words
          </label>
        </span>
      </div>
      {showReplace ? (
        <>
          <input aria-label="Replace with" className={INPUT} placeholder="Replace with" value={replace} onChange={(e) => setReplace(e.target.value)} />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className={BUTTON}
              disabled={!text || !total}
              onClick={() => {
                if (editor) replaceCurrent(editor.view, replace);
              }}
            >
              Replace
            </button>
            <button type="button" className={BUTTON} disabled={!text} onClick={() => void replaceAll()}>
              Replace all
            </button>
            <button type="button" className={BUTTON} onClick={close}>
              Close
            </button>
          </div>
        </>
      ) : (
        <div className="flex justify-end gap-2">
          <button type="button" className={BUTTON} onClick={() => setShowReplace(true)}>
            Replace…
          </button>
          <button type="button" className={BUTTON} onClick={close}>
            Close
          </button>
        </div>
      )}
      <p role="status" className="min-h-4 text-xs text-ui-muted">
        {result}
      </p>
    </div>
  );
}
