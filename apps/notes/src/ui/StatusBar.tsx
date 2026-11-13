import { useEffect, useState, useSyncExternalStore } from "react";
import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { FOCUS_RING } from "@rusuite/ui-shared";
import type { NotesController } from "../controller";
import { useT } from "../i18n";
import { useNotes } from "./hooks";

/** The status bar recounts 250 ms after the last edit (a keystroke never waits for it). */
export const WORD_COUNT_DEBOUNCE_MS = 250;

/** Whitespace-separated words of the page (top-level blocks cached: an edit re-reads one block). */
const cache = new WeakMap<PMNode, number>();
export function countWords(doc: PMNode): number {
  let total = 0;
  doc.forEach((child) => {
    let n = cache.get(child);
    if (n === undefined) {
      const text = child.textBetween(0, child.content.size, " ", (leaf) => (leaf.type.name === "pageLink" ? String(leaf.attrs.title ?? "") : " ")).trim();
      n = text ? text.split(/\s+/).length : 0;
      cache.set(child, n);
    }
    total += n;
  });
  return total;
}

function useWordCount(editor: Editor | null): number | null {
  const [words, setWords] = useState<number | null>(null);
  useEffect(() => {
    if (!editor) {
      setWords(null);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => !editor.isDestroyed && setWords(countWords(editor.state.doc));
    const onTx = ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (!transaction.docChanged) return;
      clearTimeout(timer);
      timer = setTimeout(update, WORD_COUNT_DEBOUNCE_MS);
    };
    // The binding fills the editor on the next task.
    timer = setTimeout(update, 0);
    editor.on("transaction", onTx);
    return () => {
      clearTimeout(timer);
      editor.off("transaction", onTx);
    };
  }, [editor]);
  return words;
}

export function StatusBar({ ctl, editor }: { ctl: NotesController; editor: Editor | null }) {
  const t = useT();
  const save = useSyncExternalStore(ctl.persister.subscribe, ctl.persister.getState);
  const words = useWordCount(editor);
  const warnings = useNotes(ctl, (s) => s.warnings);
  return (
    <div className="flex items-center gap-4 border-t border-ui-border bg-ui-panel px-3 py-0.5 text-xs text-ui-muted" data-testid="status-bar">
      <span data-testid="save-state" data-state={save}>
        {save === "saved" ? t("notes.status.saved") : save === "saving" ? t("notes.status.saving") : t("notes.status.error")}
      </span>
      {words !== null && <span data-testid="words">{t("notes.status.words", { count: words })}</span>}
      {warnings.length > 0 && (
        <span data-testid="warnings" className="truncate text-amber-600" title={warnings.map((w) => `${w.doc}: ${w.message}`).join("\n")}>
          {t("status.warnings", { count: warnings.length, first: warnings[0]!.message })}
        </span>
      )}
      <span className="ml-auto" data-testid="backend-kind">
        {ctl.backend.kind}
      </span>
    </div>
  );
}

/** "Your notes are stored only in this browser …" when persistent storage was not granted (dismissable). */
export function PersistHint({ ctl }: { ctl: NotesController }) {
  const t = useT();
  const storage = useNotes(ctl, (s) => s.storage);
  const dismissed = useNotes(ctl, (s) => s.settings.persistHintDismissed);
  const hasNotebook = useNotes(ctl, (s) => s.notebook !== null);
  if (storage !== "denied" || dismissed || !hasNotebook) return null;
  return (
    <div role="note" className="flex items-center gap-3 border-b border-amber-300 bg-amber-50 px-3 py-1.5 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100" data-testid="persist-hint">
      <span className="flex-1">{t("notes.persist.hint")}</span>
      <button type="button" className={`rounded border border-current px-2 py-0.5 ${FOCUS_RING}`} data-testid="persist-hint-backup" onClick={() => void ctl.downloadBackup()}>
        {t("notes.backup.download")}
      </button>
      <button type="button" aria-label={t("cmd.dismiss")} className={`rounded px-2 py-0.5 hover:bg-black/10 ${FOCUS_RING}`} data-testid="persist-hint-dismiss" onClick={() => ctl.updateSettings({ persistHintDismissed: true })}>
        ✕
      </button>
    </div>
  );
}

/** The last error (core refusals, storage failures). */
export function Toast({ ctl }: { ctl: NotesController }) {
  const t = useT();
  const error = useNotes(ctl, (s) => s.error);
  useEffect(() => {
    if (!error) return;
    const id = setTimeout(() => ctl.dismissError(), 8000);
    return () => clearTimeout(id);
  }, [ctl, error]);
  if (!error) return null;
  return (
    <div role="alert" className="fixed bottom-8 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded bg-ui-fg px-4 py-2 text-sm text-ui-bg shadow-lg" data-testid="toast">
      <span>{error}</span>
      <button type="button" aria-label={t("cmd.dismiss")} className={`rounded px-1 ${FOCUS_RING}`} onClick={() => ctl.dismissError()}>
        ✕
      </button>
    </div>
  );
}
