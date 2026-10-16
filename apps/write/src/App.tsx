import { memo, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { applyPageRange, AutosaveStatus, useLocale, ConfirmDiscard, DocumentSession, RecoveryBanner, UnsavedGuard, withExtension, type AnySession } from "@rusuite/ui-shared";
import { buildWritePrintDoc, DEFAULT_WRITE_PRINT, type WritePrintOptions } from "./print/writePrintDoc";
import { printWrite, WritePrintPage } from "./print/WritePrintPage";
import { WriteApi, type WriteBackend } from "./backend";
import { writeExtensions } from "./sync/schema";
import { SYNC_META, SyncController, SyncExtension, type SyncState } from "./sync/SyncPlugin";
import { WriteFeatures } from "./features/WriteFeatures";
import { currentLayout, floatPage, pageIndexAt, remeasurePages } from "./features/pagination";
import type { Node as PMNode } from "@tiptap/pm/model";
import { FindBar } from "./ui/FindBar";
import { EditorContextMenu } from "./ui/EditorContextMenu";
import { WriteDialogs } from "./ui/dialogs";
import { ReferenceDialogs } from "./ui/referenceDialogs";
import { InfoPanel } from "./ui/InfoPanel";
import { PageFrame, useWriteChrome } from "./ui/PageFrame";
import { ShortcutLayer } from "./ShortcutLayer";
import { Toasts } from "./ui/Toasts";
import { Ruler, rulerReserve } from "./ui/Ruler";
import { LayoutOptions } from "./ui/LayoutOptions";
import { countDocWords, countWords } from "./wordCount";
import { WriteRibbon } from "./ui/WriteToolbar";
import { ApplyStylesBox, NavigationPane, StyleDialogsHost, StylesPane } from "./ui/stylesPane";
import { t, useT } from "./i18n";
import { CommentsFrame, CommentsPane, UserNameDialog } from "./comments/CommentsUi";
import { loadUser } from "./comments/model";

function useSync<T>(ctl: SyncController, select: (s: SyncState) => T): T {
  return useSyncExternalStore(ctl.subscribe, () => select(ctl.getState()));
}

export { countWords };

/**
 * The controller state shown in the status bar, re-rendered at most every
 * 60 ms (each keystroke's patch changes `revision`; the bar need not follow
 * at keystroke rate).
 */
function useThrottledSync(ctl: SyncController): SyncState {
  const [state, setState] = useState(ctl.getState);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      timer = undefined;
      setState(ctl.getState());
    };
    const unsubscribe = ctl.subscribe(() => {
      timer ??= setTimeout(flush, STATUS_THROTTLE_MS);
    });
    flush();
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [ctl]);
  return state;
}

/** The status bar updates at most this often while typing, so a keystroke never waits on it. */
export const WORD_COUNT_DEBOUNCE_MS = 250;
const STATUS_THROTTLE_MS = 60;

/** Incremental word count of the editor document, recomputed 250 ms after the last edit. */
function useWordCount(editor: Editor): number {
  const [words, setWords] = useState(() => countDocWords(editor.state.doc));
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => setWords(countDocWords(editor.state.doc));
    const onTransaction = ({ transaction }: { transaction: { docChanged: boolean; getMeta: (key: string) => unknown } }) => {
      if (!transaction.docChanged) return;
      clearTimeout(timer);
      // Changes from Rust (open, undo, a re-wrapped column section) are not typing: count at once.
      if (transaction.getMeta(SYNC_META) === "remote") update();
      else timer = setTimeout(update, WORD_COUNT_DEBOUNCE_MS);
    };
    update();
    editor.on("transaction", onTransaction);
    return () => {
      clearTimeout(timer);
      editor.off("transaction", onTransaction);
    };
  }, [editor]);
  return words;
}

/** Keeps the window title in sync; a component of its own so that revision/dirty changes do not re-render the App. */
function TitleSync({ ctl, backend, guard }: { ctl: SyncController; backend: WriteBackend; guard: UnsavedGuard }) {
  const dirty = useSync(ctl, (s) => s.dirty);
  const name = useSync(ctl, (s) => s.name);
  const revision = useSync(ctl, (s) => s.revision);
  const locale = useLocale();
  useEffect(() => {
    void backend.setTitle(`${dirty ? "• " : ""}${name ?? t("doc.untitled")} – Rusuite Write`).catch(() => undefined);
    guard.syncDirty();
  }, [backend, guard, dirty, name, revision, locale]);
  return null;
}

/** "Page X of Y" in print layout: the caret's page from the pagination (updated at most every 100 ms). */
function PageStatus({ editor, features }: { editor: Editor; features: WriteFeatures }) {
  const t = useT();
  const layout = useSyncExternalStore(features.ui.subscribe, () => features.ui.getState().layout);
  const [head, setHead] = useState(() => editor.state.selection.head);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onSel = () => {
      timer ??= setTimeout(() => {
        timer = undefined;
        if (!editor.isDestroyed) setHead(editor.state.selection.head);
      }, 100);
    };
    editor.on("selectionUpdate", onSel);
    editor.on("transaction", onSel);
    return () => {
      clearTimeout(timer);
      editor.off("selectionUpdate", onSel);
      editor.off("transaction", onSel);
    };
  }, [editor]);
  if (!layout) return null;
  const n = Math.min(layout.pages.length, pageIndexAt(layout, head) + 1);
  return <span data-testid="page-status">{t("write.status.page", { n, total: layout.pages.length })}</span>;
}

const StatusBar = memo(function StatusBar({ ctl, editor, backend, session, features }: { ctl: SyncController; editor: Editor; backend: WriteBackend; session: AnySession; features: WriteFeatures }) {
  const { revision, dirty, name, info, warnings } = useThrottledSync(ctl);
  const words = useWordCount(editor);
  const comments = useSyncExternalStore(ctl.subscribe, () => ctl.comments.length);
  const t = useT();
  return (
    <div className="flex items-center gap-4 border-t border-ui-border bg-ui-panel px-3 py-0.5 text-xs text-ui-muted" data-testid="status-bar">
      <span data-testid="doc-name">{name ?? t("doc.untitled")}</span>
      <PageStatus editor={editor} features={features} />
      <span data-testid="dirty">{dirty ? t("status.modified") : t("status.saved")}</span>
      <span data-testid="words">{t("write.status.words", { count: words })}</span>
      {comments > 0 && <span data-testid="comment-count">{t("write.status.comments", { count: comments })}</span>}
      <span data-testid="revision">rev {revision}</span>
      <AutosaveStatus session={session} />
      {info && <span data-testid="info">{info}</span>}
      {warnings.length > 0 && (
        <span data-testid="warnings" title={warnings.join("\n")} className="truncate text-amber-600">
          {t("status.warnings", { count: warnings.length, first: warnings[0] ?? "" })}
        </span>
      )}
      <span className="ml-auto" data-testid="backend-kind">
        {backend.kind}
      </span>
    </div>
  );
});

export default function App({ backend }: { backend: WriteBackend }) {
  // Recent files, autosave, crash recovery: the controller talks through the session's backend.
  const session = useMemo(() => new DocumentSession(backend), [backend]);
  const ctl = useMemo(() => new SyncController(new WriteApi(session.backend)), [session]);
  const features = useMemo(() => new WriteFeatures(ctl), [ctl]);
  const [zoom, setZoom] = useState(1);
  const editor = useEditor(
    {
      extensions: [...writeExtensions({ resolveMedia: ctl.media.resolve, page: () => floatPage(ctl.page) }), SyncExtension(ctl), features.extension()],
      editorProps: { attributes: () => features.editorAttributes() },
    },
    [ctl],
  );
  const chrome = useWriteChrome(features, editor);
  // The sticky ruler covers the top of the scroll container: ProseMirror's scrollIntoView keeps the caret below it.
  const reserve = rulerReserve(chrome.ruler, zoom);
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const margin = { top: reserve, bottom: 8, left: 8, right: 8 };
    editor.setOptions({ editorProps: { ...editor.options.editorProps, scrollMargin: margin, scrollThreshold: margin } });
    // The ruler just appeared (or the zoom changed): bring the caret out from under it.
    if (!reserve) return;
    const frame = requestAnimationFrame(() => {
      if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.scrollIntoView().setMeta("addToHistory", false));
    });
    return () => cancelAnimationFrame(frame);
  }, [editor, reserve]);
  // A new zoom lays the pages out again (60 ms debounce).
  useEffect(() => {
    if (!editor) return;
    const timer = setTimeout(() => {
      if (!editor.isDestroyed) remeasurePages(editor.view);
    }, 60);
    return () => clearTimeout(timer);
  }, [editor, zoom]);
  // ctl.page is replaced before the state change that announces it.
  const page = useSync(ctl, () => ctl.page);
  const comments = useSync(ctl, () => ctl.comments);
  // The frame (first page) uses the first section's page setup.
  const firstPage = useSync(ctl, () => ctl.sections[0]?.page ?? ctl.page);

  useEffect(() => {
    if (!editor) return;
    void ctl.newDocument().then(() => {
      // The comment author remembered in this browser (ADR 0009: never leaves it).
      const user = loadUser();
      if (user && !ctl.user) void ctl.setUser(user.name, user.initials);
    });
  }, [editor, ctl]);

  // Unsaved-changes question before New / Open / recent / Restore / Close and closing the window (P7-6).
  const guard = useMemo(
    () =>
      new UnsavedGuard(backend, {
        dirty: () => ctl.getState().dirty,
        name: () => ctl.getState().name,
        get defaultName() {
          return t("write.defaultName");
        },
        save: (asName) => {
          const name = asName === undefined ? undefined : withExtension(asName, ".docx");
          return ctl.saveDocx((n, bytes) => backend.saveFile(name ?? n, bytes), name);
        },
      }),
    [backend, ctl],
  );
  useEffect(() => guard.watchWindow(), [guard]);

  const open = useCallback(async () => {
    try {
      if ((await guard.ensureSaved()) === "cancel") return;
      const file = await backend.openFile();
      if (file) await ctl.openDocx(file.bytesBase64, file.name);
    } catch (e) {
      ctl.pushError(e);
    }
  }, [backend, ctl, guard]);

  const newDocument = useCallback(() => void guard.run(() => ctl.newDocument()), [guard, ctl]);

  const save = useCallback(async () => {
    await ctl.saveDocx((n, bytes) => backend.saveFile(n, bytes));
  }, [backend, ctl]);

  useEffect(() => {
    session.attach({
      restore: (json, name) => ctl.restoreRecovery(json, name),
      openFile: (file) => ctl.openDocx(file.bytesBase64, file.name),
      onError: (e) => ctl.pushError(e),
      confirmReplace: async () => (await guard.ensureSaved()) === "proceed",
      // File › Save As › a connection (P8-36): the app's Save As under the chosen name.
      saveAs: (name) => guard.doc.save(name),
    });
    void session.start();
    return () => session.stop();
  }, [session, ctl, guard]);

  // Save As: `name` from the web's name prompt; the desktop asks in its native dialog.
  const saveAs = useCallback(
    async (name?: string) => {
      await ctl.saveDocx((n, bytes) => backend.saveFile(name ?? n, bytes, { saveAs: true }), name);
    },
    [backend, ctl],
  );

  const [printOptions, setPrintOptions] = useState<WritePrintOptions>(DEFAULT_WRITE_PRINT);
  const pushError = useCallback((e: unknown) => ctl.pushError(e), [ctl]);
  const flowOf = useCallback((node: PMNode) => features.flow(node), [features]);
  // File › Export PDF…: the Print pipeline with the current settings, straight to the system dialog ("Save as PDF").
  const exportPdf = useCallback(() => {
    if (!editor) return;
    try {
      const doc = buildWritePrintDoc(editor.view.dom as HTMLElement, ctl.page, printOptions, ctl.comments, currentLayout(editor.state), flowOf);
      void printWrite(backend, applyPageRange(doc, printOptions.range), pushError);
    } catch (e) {
      pushError(e);
    }
  }, [editor, ctl, backend, printOptions, pushError, flowOf]);

  return (
    <main className="flex h-screen flex-col bg-ui-bg text-ui-fg">
      <TitleSync ctl={ctl} backend={backend} guard={guard} />
      <RecoveryBanner session={session} />
      {editor && (
        <WriteRibbon
          editor={editor}
          ctl={ctl}
          session={session}
          page={page}
          onOpen={() => void open()}
          onSave={() => void save()}
          features={features}
          onFind={chrome.onFind}
          onReplace={chrome.onReplace}
          onExportPdf={exportPdf}
          print={
            <WritePrintPage editor={editor} page={page} backend={backend} options={printOptions} onChange={setPrintOptions} onError={pushError} comments={comments} layout={chrome.layout} flow={flowOf} />
          }
          infoPage={<InfoPanel ctl={ctl} editor={editor} pages={chrome.view === "print" ? chrome.pages : null} />}
          zoom={zoom}
          onZoom={setZoom}
        />
      )}
      <div className="flex min-h-0 flex-1">
        {editor && <NavigationPane editor={editor} ctl={ctl} features={features} />}
        <div
          className="write-scroll min-h-0 min-w-0 flex-1 overflow-auto bg-ui-panel p-6"
          data-testid="write-scroll"
          // No scroll anchoring: showing / hiding the ruler must not shift the text under it.
          style={{ scrollPaddingTop: `${rulerReserve(!!editor && chrome.ruler, zoom)}px`, overflowAnchor: "none" }}
        >
          <div className="write-zoom" data-testid="write-zoom" style={zoom !== 1 ? { zoom } : undefined}>
            {editor && chrome.ruler && <Ruler editor={editor} ctl={ctl} features={features} page={firstPage} />}
            <CommentsFrame editor={editor} ctl={ctl} features={features} zoom={zoom}>
              <PageFrame
                page={firstPage}
                view={chrome.view}
                pages={chrome.pages}
                frame={chrome.frame}
                onEditHeaderFooter={chrome.onEditHeaderFooter}
                layout={chrome.layout}
                editor={editor}
                onToggleWhiteSpace={chrome.onToggleWhiteSpace}
              >
                <EditorContent editor={editor} />
              </PageFrame>
            </CommentsFrame>
          </div>
        </div>
        {editor && <StylesPane editor={editor} ctl={ctl} features={features} />}
        {editor && <CommentsPane editor={editor} ctl={ctl} features={features} />}
      </div>
      {editor && <StatusBar ctl={ctl} editor={editor} backend={backend} session={session} features={features} />}
      <FindBar ctl={ctl} editor={editor} ui={features.ui} />
      <WriteDialogs ui={features.ui} ctl={ctl} editor={editor} />
      <ReferenceDialogs ui={features.ui} ctl={ctl} editor={editor} />
      <UserNameDialog ctl={ctl} features={features} />
      {editor && <StyleDialogsHost editor={editor} ctl={ctl} features={features} />}
      {editor && <ApplyStylesBox editor={editor} ctl={ctl} features={features} />}
      <EditorContextMenu editor={editor} ctl={ctl} features={features} />
      <LayoutOptions editor={editor} />
      <Toasts ctl={ctl} />
      <ShortcutLayer editor={editor} ctl={ctl} onNew={newDocument} onOpen={() => void open()} onSave={() => void save()} onSaveAs={(n) => void saveAs(n)} onFind={chrome.onFind} onReplace={chrome.onReplace} features={features} />
      <ConfirmDiscard guard={guard} />
    </main>
  );
}
