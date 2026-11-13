// The page: title field (the tree title, renamed through the core), created date, and the Tiptap editor bound to
// the page's Loro mirror. Also the recycle bin view and the empty states.

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { canRedo, canUndo } from "loro-prosemirror";
import { FOCUS_RING, getLocale, RibbonIcon } from "@rusuite/ui-shared";
import type { NotesController } from "../controller";
import type { OpenedPage } from "../generated/OpenedPage";
import { LoroBinding, editorRedo, editorUndo } from "../editor/binding";
import { applyLink } from "../editor/commands";
import { NotesKeys } from "../editor/keys";
import type { PageMirror } from "../editor/mirror";
import { notesSchemaExtensions } from "../editor/schema";
import { findNode } from "../tree";
import { canvasExtension, CanvasView, InkHiddenNotice, useCanvasMode } from "../canvas";
import { useT } from "../i18n";
import { useDialog, type DialogSpec } from "./dialogs";
import { useNotes } from "./hooks";

/** The link dialog for the editor's selection. */
export function linkDialog(editor: Editor): DialogSpec {
  return { kind: "link", initial: (editor.getAttributes("link").href as string | undefined) ?? "", onSubmit: (href, text) => void applyLink(editor, href, text) };
}

/** The page picker inserting a `[[page link]]` at the selection. */
export function pageLinkDialog(editor: Editor): DialogSpec {
  return { kind: "pagePicker", onPick: (p) => void editor.chain().focus().insertPageLink({ pageId: p.docId, title: p.title }).run() };
}

export function PageArea({ ctl, onEditor }: { ctl: NotesController; onEditor: (e: Editor | null) => void }) {
  const t = useT();
  const view = useNotes(ctl, (s) => s.view);
  const mirror = useNotes(ctl, (s) => s.mirror);
  const opened = useNotes(ctl, (s) => s.opened);
  const notebook = useNotes(ctl, (s) => s.notebook);
  const phase = useNotes(ctl, (s) => s.phase);
  const settings = useNotes(ctl, (s) => s.settings);
  useEffect(() => {
    if (!mirror) onEditor(null);
  }, [mirror, onEditor]);
  const canvas = useCanvasMode(mirror);
  if (view === "recycleBin") return <RecycleBin ctl={ctl} />;
  const style: CSSProperties = { maxWidth: settings.pageWidth === "wide" ? 1100 : 760, ...(settings.zoom !== 1 ? { zoom: settings.zoom } : {}) };
  // Canvas pages (P11-N4) scroll and zoom inside their own surface; the same elements keep the editor mounted.
  return (
    <div className={canvas ? "flex min-h-0 min-w-0 flex-1 bg-ui-bg" : "notes-scroll min-h-0 min-w-0 flex-1 overflow-auto bg-ui-bg"} data-testid="page-scroll">
      <div className={canvas ? "flex min-h-0 min-w-0 flex-1" : "notes-page mx-auto px-10 pb-24 pt-8"} style={canvas ? undefined : style} data-width={settings.pageWidth}>
        {mirror && opened ? (
          <PageEditor key={mirror.docId} ctl={ctl} mirror={mirror} opened={opened} onEditor={onEditor} />
        ) : phase === "loading" ? (
          <p className="text-ui-muted">{t("notes.loading")}</p>
        ) : notebook ? (
          <EmptySection ctl={ctl} />
        ) : (
          <NoNotebook ctl={ctl} />
        )}
      </div>
    </div>
  );
}

function EmptySection({ ctl }: { ctl: NotesController }) {
  const t = useT();
  return (
    <div className="flex flex-col items-start gap-3 text-ui-muted" data-testid="empty-section">
      <p>{t("notes.page.empty")}</p>
      <button type="button" className={`flex items-center gap-2 rounded border border-ui-border px-3 py-1.5 text-ui-fg hover:bg-ui-hover ${FOCUS_RING}`} onClick={() => void ctl.createPage()}>
        <RibbonIcon name="plus" />
        {t("notes.page.new")}
      </button>
    </div>
  );
}

function NoNotebook({ ctl }: { ctl: NotesController }) {
  const t = useT();
  const open = useDialog();
  return (
    <div className="flex flex-col items-start gap-3" data-testid="no-notebook">
      <h1 className="text-2xl font-semibold">{t("notes.empty.title")}</h1>
      <p className="text-ui-muted">{t("notes.empty.text")}</p>
      <div className="flex gap-2">
        <button
          type="button"
          className={`rounded bg-[var(--notes-accent)] px-3 py-1.5 text-white hover:brightness-110 ${FOCUS_RING}`}
          onClick={() => open({ kind: "prompt", title: t("notes.notebook.new"), label: t("notes.notebook.name"), initial: t("notes.notebook.defaultName"), confirm: t("notes.create"), onSubmit: (v) => void ctl.createNotebook(v) })}
        >
          {t("notes.notebook.new")}
        </button>
        <button type="button" className={`rounded border border-ui-border px-3 py-1.5 hover:bg-ui-hover ${FOCUS_RING}`} onClick={() => void ctl.openBackupFile()}>
          {t("notes.backup.open")}
        </button>
      </div>
    </div>
  );
}

/** Commits the title 600 ms after the last key, on blur and on Enter. */
const TITLE_DEBOUNCE_MS = 600;

function PageEditor({ ctl, mirror, opened, onEditor }: { ctl: NotesController; mirror: PageMirror; opened: OpenedPage; onEditor: (e: Editor | null) => void }) {
  const t = useT();
  const dialog = useDialog();
  const node = useNotes(ctl, (s) => findNode(s.notebooks.find((n) => n.summary.id === s.notebook)?.tree ?? [], s.page));
  const extensions = useMemo(
    () => [
      ...notesSchemaExtensions({ onOpenPage: (docId) => void ctl.openPageByDoc(docId), taskLabel: (text) => t("notes.task.checkbox", { text }) }),
      LoroBinding(mirror),
      canvasExtension(mirror),
      NotesKeys.configure({
        onLink: () => editorRef.current && dialog(linkDialog(editorRef.current)),
        onPageLinkPicker: () => editorRef.current && dialog(pageLinkDialog(editorRef.current)),
        dragLabel: t("notes.dragBlock"),
      }),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mirror],
  );
  const editorRef = useRef<Editor | null>(null);
  const editor = useEditor(
    {
      extensions,
      editorProps: { attributes: { class: "notes-content", "data-testid": "page-editor", "aria-label": t("notes.page.body"), spellcheck: "true" } },
    },
    [mirror],
  );
  editorRef.current = editor;

  useEffect(() => {
    if (!editor) return;
    onEditor(editor);
    const detach = mirror.ime.attach(editor.view.dom as HTMLElement, () => editor.view.composing);
    ctl.setEditorHistory({
      canUndo: () => !editor.isDestroyed && canUndo(editor.state),
      canRedo: () => !editor.isDestroyed && canRedo(editor.state),
      undo: () => !editor.isDestroyed && editorUndo(editor.state, editor.view.dispatch),
      redo: () => !editor.isDestroyed && editorRedo(editor.state, editor.view.dispatch),
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onTx = () => {
      timer ??= setTimeout(() => {
        timer = undefined;
        ctl.refreshHistory();
      }, 100);
    };
    editor.on("transaction", onTx);
    return () => {
      clearTimeout(timer);
      editor.off("transaction", onTx);
      detach();
      ctl.setEditorHistory(null);
      onEditor(null);
    };
  }, [editor, mirror, ctl, onEditor]);

  const canvas = useCanvasMode(mirror);
  const header = (
    <>
      <TitleField ctl={ctl} nodeId={node?.id ?? null} title={node?.title ?? opened.title} onEnter={() => editor?.commands.focus("start")} />
      <p className="mb-6 mt-1 text-xs text-ui-muted" data-testid="page-created">
        {node ? formatCreated(node.created) : ""}
      </p>
    </>
  );
  if (canvas && editor)
    return (
      <article data-testid="page" data-doc={opened.docId} data-canvas="" className="flex min-h-0 min-w-0 flex-1">
        <CanvasView ctl={ctl} editor={editor} mirror={mirror} notebook={opened.notebookId} header={header}>
          <EditorContent editor={editor} className="notes-editor relative" />
        </CanvasView>
      </article>
    );
  return (
    <article data-testid="page" data-doc={opened.docId}>
      {header}
      <InkHiddenNotice mirror={mirror} />
      <EditorContent editor={editor} className="notes-editor relative" />
    </article>
  );
}

function formatCreated(ms: number): string {
  const d = new Date(ms);
  const locale = getLocale();
  return `${d.toLocaleDateString(locale, { weekday: "long", year: "numeric", month: "long", day: "numeric" })}  ${d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}`;
}

function TitleField({ ctl, nodeId, title, onEnter }: { ctl: NotesController; nodeId: string | null; title: string; onEnter: () => void }) {
  const t = useT();
  const [value, setValue] = useState(title);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setValue(title);
  }, [title]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const commit = (v: string) => {
    clearTimeout(timer.current);
    timer.current = undefined;
    if (nodeId && v !== title) void ctl.rename(nodeId, v);
  };
  return (
    <input
      className="notes-title w-full border-b border-ui-border bg-transparent pb-1 text-3xl font-semibold outline-none placeholder:text-ui-muted focus:border-[var(--notes-accent)]"
      data-testid="page-title"
      aria-label={t("notes.page.title")}
      placeholder={t("notes.untitled")}
      value={value}
      onFocus={() => (editing.current = true)}
      onChange={(e) => {
        const v = e.target.value;
        setValue(v);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => commit(v), TITLE_DEBOUNCE_MS);
      }}
      onBlur={() => {
        editing.current = false;
        commit(value);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit(value);
          onEnter();
        }
      }}
    />
  );
}

function RecycleBin({ ctl }: { ctl: NotesController }) {
  const t = useT();
  const open = useDialog();
  const entries = useNotes(ctl, (s) => s.recycle);
  const section = useNotes(ctl, (s) => s.section);
  const locale = getLocale();
  return (
    <div className="min-h-0 min-w-0 flex-1 overflow-auto bg-ui-bg" data-testid="recycle-bin">
      <div className="mx-auto max-w-3xl px-10 pb-24 pt-8">
        <div className="mb-2 flex items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold">{t("notes.recycleBin")}</h1>
          <span className="flex gap-2">
            <button
              type="button"
              disabled={entries.length === 0}
              data-testid="empty-recycle-bin"
              className={`rounded border border-ui-border px-3 py-1 text-sm hover:bg-ui-hover disabled:opacity-40 ${FOCUS_RING}`}
              onClick={() => open({ kind: "confirm", title: t("notes.recycle.empty"), message: t("notes.recycle.emptyConfirm"), confirm: t("notes.recycle.deleteForever"), onConfirm: () => void ctl.emptyRecycleBin() })}
            >
              {t("notes.recycle.empty")}
            </button>
            <button type="button" className={`rounded border border-ui-border px-3 py-1 text-sm hover:bg-ui-hover ${FOCUS_RING}`} onClick={() => void ctl.showRecycleBin(false)}>
              {t("notes.close")}
            </button>
          </span>
        </div>
        <p className="mb-4 text-sm text-ui-muted">{t("notes.recycle.note")}</p>
        {entries.length === 0 && <p className="text-ui-muted" data-testid="recycle-empty">{t("notes.recycle.none")}</p>}
        <ul className="flex flex-col divide-y divide-ui-border">
          {entries.map((e) => {
            const needsTarget = e.parentDeleted;
            const target = needsTarget && e.node.kind === "page" ? section : undefined;
            return (
              <li key={e.node.id} className="flex items-center gap-3 py-2" data-testid="recycle-entry">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium">{e.node.title || (e.node.kind === "page" ? t("notes.untitled") : t("notes.untitledSection"))}</span>
                  <span className="text-xs text-ui-muted">
                    {t(`notes.kind.${e.node.kind}`)} · {t("notes.recycle.deletedAt", { when: new Date(e.deleted).toLocaleString(locale) })}
                  </span>
                </span>
                <button
                  type="button"
                  disabled={needsTarget && !target}
                  title={needsTarget ? t("notes.recycle.restoreHere") : undefined}
                  className={`rounded border border-ui-border px-3 py-1 text-sm hover:bg-ui-hover disabled:opacity-40 ${FOCUS_RING}`}
                  onClick={() => void ctl.restore(e.node.id, target ?? undefined)}
                >
                  {t("notes.recycle.restore")}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
