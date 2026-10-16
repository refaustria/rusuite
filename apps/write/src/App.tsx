import { memo, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { applyPageRange, AutosaveStatus, useLocale, ConfirmDiscard, DocumentSession, RecoveryBanner, UnsavedGuard, withExtension, type AnySession } from "@rusuite/ui-shared";
import { buildWritePrintDoc, DEFAULT_WRITE_PRINT, type WritePrintOptions } from "./print/writePrintDoc";
import { printWrite, WritePrintPage } from "./print/WritePrintPage";
import { WriteApi, type WriteBackend } from "./backend";
import { writeExtensions } from "./sync/schema";
import { SyncController, SyncExtension, type SyncState } from "./sync/SyncPlugin";
import { WriteFeatures } from "./features/WriteFeatures";
import { floatPage } from "./features/pagination";
import { FindBar } from "./ui/FindBar";
import { EditorContextMenu } from "./ui/EditorContextMenu";
import { WriteDialogs } from "./ui/dialogs";
import { PageFrame, useWriteChrome } from "./ui/PageFrame";
import { ShortcutLayer } from "./ShortcutLayer";
import { Toasts } from "./ui/Toasts";
import { Ruler, rulerReserve } from "./ui/Ruler";
import { LayoutOptions } from "./ui/LayoutOptions";
import { countDocWords, countWords } from "./wordCount";
import { WriteRibbon } from "./ui/WriteToolbar";
import { ApplyStylesBox, NavigationPane, StyleDialogsHost, StylesPane } from "./ui/stylesPane";
import { t, useT } from "./i18n";

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
    const onTransaction = ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (!transaction.docChanged) return;
      clearTimeout(timer);
      timer = setTimeout(update, WORD_COUNT_DEBOUNCE_MS);
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

const StatusBar = memo(function StatusBar({ ctl, editor, backend, session }: { ctl: SyncController; editor: Editor; backend: WriteBackend; session: AnySession }) {
  const { revision, dirty, name, info, warnings } = useThrottledSync(ctl);
  const words = useWordCount(editor);
  const t = useT();
  return (
    <div className="flex items-center gap-4 border-t border-ui-border bg-ui-panel px-3 py-0.5 text-xs text-ui-muted" data-testid="status-bar">
      <span data-testid="doc-name">{name ?? t("doc.untitled")}</span>
      <span data-testid="dirty">{dirty ? t("status.modified") : t("status.saved")}</span>
      <span data-testid="words">{t("write.status.words", { count: words })}</span>
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
  // ctl.page is replaced before the state change that announces it.
  const page = useSync(ctl, () => ctl.page);
  // The frame (first page) uses the first section's page setup.
  const firstPage = useSync(ctl, () => ctl.sections[0]?.page ?? ctl.page);

  useEffect(() => {
    if (editor) void ctl.newDocument();
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
  // File › Export PDF…: the Print pipeline with the current settings, straight to the system dialog ("Save as PDF").
  const exportPdf = useCallback(() => {
    if (!editor) return;
    try {
      const doc = buildWritePrintDoc(editor.view.dom as HTMLElement, ctl.page, printOptions);
      void printWrite(backend, applyPageRange(doc, printOptions.range), pushError);
    } catch (e) {
      pushError(e);
    }
  }, [editor, ctl, backend, printOptions, pushError]);

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
          print={<WritePrintPage editor={editor} page={page} backend={backend} options={printOptions} onChange={setPrintOptions} onError={pushError} />}
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
            <PageFrame page={firstPage} view={chrome.view} pages={chrome.pages} frame={chrome.frame} onEditHeaderFooter={chrome.onEditHeaderFooter}>
              <EditorContent editor={editor} />
            </PageFrame>
          </div>
        </div>
        {editor && <StylesPane editor={editor} ctl={ctl} features={features} />}
      </div>
      {editor && <StatusBar ctl={ctl} editor={editor} backend={backend} session={session} />}
      <FindBar ctl={ctl} editor={editor} ui={features.ui} />
      <WriteDialogs ui={features.ui} ctl={ctl} editor={editor} />
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
