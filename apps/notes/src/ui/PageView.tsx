// The page: title field (the tree title, renamed through the core), created date, and the Tiptap editor bound to
// the page's Loro mirror. Also the recycle bin view and the empty states.

import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import { canRedo, canUndo } from "loro-prosemirror";
import { ContextMenu, FOCUS_RING, getLocale, RibbonIcon, type ContextMenuItem } from "@rusuite/ui-shared";
import type { NotesController } from "../controller";
import type { OpenedPage } from "../generated/OpenedPage";
import type { PageRef } from "../generated/PageRef";
import { LoroBinding, editorRedo, editorUndo } from "../editor/binding";
import { applyLink, selectedImage, setCheckedAt, setImageAttrs } from "../editor/commands";
import { flashPath, posOfPath, refreshTags } from "../editor/decorations";
import { tableCommand, type TableCommand } from "../editor/tables";
import { insertFiles, insertSize } from "../insert";
import { useEditorEnv } from "./editorEnv";
import { attachmentAction } from "./editorEnv";
import { FindBar } from "./FindBar";
import { HistoryPanel, VersionPreviewView, type VersionView } from "./HistoryPanel";
import { TasksView } from "./TasksView";
import { NotesKeys } from "../editor/keys";
import type { PageMirror } from "../editor/mirror";
import { notesSchemaExtensions } from "../editor/schema";
import { findNode } from "../tree";
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
  const panel = useNotes(ctl, (s) => s.panel);
  const [version, setVersion] = useState<VersionView | null>(null);
  useEffect(() => {
    if (!mirror) onEditor(null);
  }, [mirror, onEditor]);
  useEffect(() => setVersion(null), [opened?.docId, panel]);
  if (view === "recycleBin") return <RecycleBin ctl={ctl} />;
  if (view === "tasks") return <TasksView ctl={ctl} />;
  const style: CSSProperties = { maxWidth: settings.pageWidth === "wide" ? 1100 : 760, ...(settings.zoom !== 1 ? { zoom: settings.zoom } : {}) };
  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className="notes-scroll relative min-h-0 min-w-0 flex-1 overflow-auto bg-ui-bg" data-testid="page-scroll">
        {version && opened && <VersionPreviewView ctl={ctl} version={version} onBack={() => setVersion(null)} />}
        <div className="notes-page mx-auto px-10 pb-24 pt-8" style={{ ...style, ...(version ? { display: "none" } : {}) }} data-width={settings.pageWidth}>
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
      {panel === "history" && opened && <HistoryPanel ctl={ctl} docId={opened.docId} selected={version?.entry ?? null} onSelect={setVersion} />}
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
  const notebooks = useNotes(ctl, (s) => s.notebooks);
  const tagDefs = useNotes(ctl, (s) => (s.notebook ? s.tags[s.notebook] : undefined));
  const focus = useNotes(ctl, (s) => s.focus);
  const findReq = useNotes(ctl, (s) => s.find);
  const readOnly = useNotes(ctl, (s) => s.readOnly);
  const { env, live } = useEditorEnv(ctl);
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; label: string; items: ContextMenuItem[] } | null>(null);
  const [find, setFindOpen] = useState<{ query: string; n: number } | null>(null);
  const extensions = useMemo(
    () => [
      ...notesSchemaExtensions({ onOpenPage: (docId) => void ctl.openPageByDoc(docId), taskLabel: (text) => t("notes.task.checkbox", { text }), env, live }),
      LoroBinding(mirror),
      NotesKeys.configure({
        onLink: () => editorRef.current && dialog(linkDialog(editorRef.current)),
        onPageLinkPicker: () => editorRef.current && dialog(pageLinkDialog(editorRef.current)),
        onFind: () => setFindOpen((f) => ({ query: f?.query ?? selectedText(editorRef.current), n: (f?.n ?? 0) + 1 })),
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
      editable: !readOnly,
      editorProps: {
        attributes: { class: "notes-content", "data-testid": "page-editor", "aria-label": t("notes.page.body"), spellcheck: "true" },
        handlePaste: (_view, event) => {
          const files = Array.from(event.clipboardData?.files ?? []);
          if (files.length === 0 || !editorRef.current) return false;
          event.preventDefault();
          void insertFiles(ctl, editorRef.current, files);
          return true;
        },
        handleDrop: (view, event, _slice, moved) => {
          const files = Array.from((event as DragEvent).dataTransfer?.files ?? []);
          if (moved || files.length === 0 || !editorRef.current) return false;
          event.preventDefault();
          const pos = view.posAtCoords({ left: event.clientX, top: event.clientY });
          const at = pos ? dropPos(view.state.doc, pos.pos) : undefined;
          void insertFiles(ctl, editorRef.current, files, { pos: at });
          return true;
        },
      },
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
    ctl.setPageHooks({
      setChecked: (path, checked) => {
        if (editor.isDestroyed) return false;
        const pos = posOfPath(editor.state.doc, path);
        return pos !== null && setCheckedAt(editor, pos, checked);
      },
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
      ctl.setPageHooks(null);
      onEditor(null);
    };
  }, [editor, mirror, ctl, onEditor]);

  // Live page titles (renames, deletes) and tag definitions.
  useEffect(() => live.refresh(), [live, notebooks]);
  useEffect(() => {
    if (editor && !editor.isDestroyed) refreshTags(editor.view);
  }, [editor, tagDefs]);
  useEffect(() => {
    if (editor && !editor.isDestroyed && editor.isEditable === readOnly) editor.setEditable(!readOnly);
  }, [editor, readOnly]);
  // A task / search result jumped here.
  const flashTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  useEffect(() => () => clearInterval(flashTimer.current), []);
  useEffect(() => {
    if (!editor || editor.isDestroyed || !focus || focus.docId !== opened.docId) return;
    const path = focus.path;
    ctl.consumeFocus();
    // The binding fills a new editor on its next task: retry until the block is there (≤ 2 s).
    let tries = 0;
    clearInterval(flashTimer.current);
    flashTimer.current = setInterval(() => {
      if (editor.isDestroyed || flashPath(editor.view, path) || ++tries > 40) clearInterval(flashTimer.current);
    }, 50);
  }, [editor, focus, opened.docId, ctl]);
  useEffect(() => {
    if (!findReq || findReq.docId !== opened.docId) return;
    ctl.consumeFind();
    setFindOpen((f) => ({ query: findReq.query, n: (f?.n ?? 0) + 1 }));
  }, [findReq, opened.docId, ctl]);

  const onContextMenu = (e: ReactMouseEvent) => {
    if (!editor || editor.isDestroyed) return;
    const items = editorMenu(ctl, editor, e.target as HTMLElement, dialog, t);
    if (!items) return;
    e.preventDefault();
    setMenu({ at: { x: e.clientX, y: e.clientY }, label: t("notes.menu.editor"), items });
  };

  return (
    <article data-testid="page" data-doc={opened.docId}>
      {find && editor && <FindBar key={find.n} editor={editor} initial={find.query} onClose={() => setFindOpen(null)} />}
      <TitleField ctl={ctl} nodeId={node?.id ?? null} title={node?.title ?? opened.title} onEnter={() => editor?.commands.focus("start")} />
      <p className="mb-6 mt-1 text-xs text-ui-muted" data-testid="page-created">
        {node ? formatCreated(node.created) : ""}
      </p>
      <div onContextMenu={onContextMenu}>
        <EditorContent editor={editor} className="notes-editor relative" />
      </div>
      <LinkedFrom ctl={ctl} docId={opened.docId} />
      <ContextMenu at={menu?.at ?? null} label={menu?.label ?? ""} items={menu?.items ?? []} onClose={() => setMenu(null)} />
    </article>
  );
}

/** The selection's text as the initial find query (one line only). */
function selectedText(editor: Editor | null): string {
  if (!editor || editor.isDestroyed) return "";
  const { from, to } = editor.state.selection;
  const s = editor.state.doc.textBetween(from, to, " ");
  return s.includes("\n") || s.length > 100 ? "" : s;
}

/** A drop position between blocks: the end of the top-level block under the pointer. */
function dropPos(doc: PMNode, pos: number): number {
  const $p = doc.resolve(Math.min(pos, doc.content.size));
  return $p.depth === 0 ? pos : $p.after(1);
}

/** The editor's context menu for a table cell, a picture or an attachment (`null`: the browser's own). */
function editorMenu(ctl: NotesController, editor: Editor, target: HTMLElement, dialog: (d: DialogSpec | null) => void, t: (k: string, p?: Record<string, string | number>) => string): ContextMenuItem[] | null {
  const view = editor.view;
  const figure = target.closest<HTMLElement>("figure.notes-image");
  const card = target.closest<HTMLElement>(".notes-attachment");
  const atom = figure ?? card;
  if (atom) {
    const pos = view.posAtDOM(atom, 0);
    const at = view.state.doc.nodeAt(pos)?.isAtom ? pos : Math.max(0, pos - 1);
    editor.chain().setNodeSelection(at).run();
    const node = view.state.doc.nodeAt(at);
    if (!node) return null;
    if (node.type.name === "image") {
      return [
        { id: "alt", label: t("notes.image.altDots"), onSelect: () => dialog(altTextDialog(editor, t)) },
        { id: "left", label: t("notes.image.alignLeft"), onSelect: () => void setImageAttrs(editor, { align: null }) },
        { id: "center", label: t("notes.image.alignCenter"), onSelect: () => void setImageAttrs(editor, { align: "center" }) },
        { id: "reset", label: t("notes.image.resetSize"), onSelect: () => void resetImageSize(editor) },
        { separator: true },
        { id: "delete", label: t("notes.delete"), onSelect: () => void editor.chain().focus().deleteSelection().run() },
      ];
    }
    const a = { blob: String(node.attrs.blob ?? ""), name: String(node.attrs.name ?? ""), size: Number(node.attrs.size ?? 0) };
    return [
      { id: "open", label: t("notes.attachment.open"), onSelect: () => void attachmentAction(ctl, "open", a) },
      { id: "download", label: t("notes.attachment.download"), onSelect: () => void attachmentAction(ctl, "download", a) },
      { separator: true },
      { id: "delete", label: t("notes.delete"), onSelect: () => void editor.chain().focus().deleteSelection().run() },
    ];
  }
  if (target.closest("td, th")) {
    // Right-click inside a cell: put the caret there unless a cell selection covers it.
    const pos = view.posAtCoords(target.getBoundingClientRect() ? { left: target.getBoundingClientRect().left + 2, top: target.getBoundingClientRect().top + 2 } : { left: 0, top: 0 });
    if (pos && !(editor.state.selection as { $anchorCell?: unknown }).$anchorCell) editor.commands.setTextSelection(pos.pos);
    return tableMenu(editor, t);
  }
  return null;
}

export function tableMenu(editor: Editor, t: (k: string) => string): ContextMenuItem[] {
  const item = (cmd: TableCommand): ContextMenuItem => ({ id: cmd, label: t(`notes.table.${cmd}`), disabled: !tableCommand(editor, cmd, true), onSelect: () => void tableCommand(editor, cmd) });
  return [item("rowBefore"), item("rowAfter"), item("colBefore"), item("colAfter"), { separator: true }, item("deleteRow"), item("deleteCol"), item("deleteTable"), { separator: true }, item("merge"), item("split"), item("headerRow"), item("headerCol")];
}

export function altTextDialog(editor: Editor, t: (k: string) => string): DialogSpec {
  const img = selectedImage(editor);
  return { kind: "prompt", title: t("notes.image.altTitle"), label: t("notes.image.altLabel"), initial: String(img?.attrs.alt ?? ""), confirm: t("notes.ok"), onSubmit: (v) => void setImageAttrs(editor, { alt: v || null }) };
}

/** The picture back to its natural size (fitted to the page width). */
export function resetImageSize(editor: Editor): boolean {
  const img = selectedImage(editor);
  if (!img) return false;
  const el = editor.view.nodeDOM(img.pos) as HTMLElement | null;
  const i = el?.querySelector("img");
  if (!i?.naturalWidth) return setImageAttrs(editor, { width: null, height: null });
  return setImageAttrs(editor, insertSize(i.naturalWidth, i.naturalHeight));
}

/** "Linked from": the pages linking here (live titles; refreshed when notebooks change). */
function LinkedFrom({ ctl, docId }: { ctl: NotesController; docId: string }) {
  const t = useT();
  const notebooks = useNotes(ctl, (s) => s.notebooks);
  const [pages, setPages] = useState<PageRef[]>([]);
  useEffect(() => {
    let live = true;
    const id = setTimeout(() => void ctl.backlinks(docId).then((p) => live && setPages(p)), 150);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [ctl, docId, notebooks]);
  if (pages.length === 0) return null;
  return (
    <footer className="mt-10 border-t border-ui-border pt-3 text-sm" data-testid="linked-from" aria-label={t("notes.linkedFrom")}>
      <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ui-muted">{t("notes.linkedFrom")}</h2>
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {pages.map((p) => (
          <li key={p.docId}>
            <button type="button" className={`text-[var(--ui-focus)] hover:underline ${FOCUS_RING}`} data-testid="backlink" onClick={() => void ctl.openPageByDoc(p.docId)}>
              {ctl.pageTitle(p.docId) || p.title || t("notes.untitled")}
            </button>
          </li>
        ))}
      </ul>
    </footer>
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
                <button
                  type="button"
                  data-testid="purge-entry"
                  className={`rounded border border-ui-border px-3 py-1 text-sm hover:bg-ui-hover ${FOCUS_RING}`}
                  onClick={() =>
                    open({
                      kind: "confirm",
                      title: t("notes.recycle.deleteForever"),
                      message: t("notes.recycle.purgeConfirm", { name: e.node.title || t("notes.untitled") }),
                      confirm: t("notes.recycle.deleteForever"),
                      onConfirm: () => void ctl.purgeNode(e.node.id),
                    })
                  }
                >
                  {t("notes.recycle.deleteForever")}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
