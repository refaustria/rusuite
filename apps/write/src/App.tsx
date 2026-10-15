import { memo, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { DocumentSession, RecoveryBanner } from "@rusuite/ui-shared";
import { writePrintCss } from "./print/printCss";
import { WriteApi, type WriteBackend } from "./backend";
import { writeExtensions } from "./sync/schema";
import { SyncController, SyncExtension, type SyncState } from "./sync/SyncPlugin";
import { WriteFeatures } from "./features/WriteFeatures";
import { FindBar } from "./ui/FindBar";
import { EditorContextMenu } from "./ui/EditorContextMenu";
import { WriteDialogs } from "./ui/dialogs";
import { PageFrame, useWriteChrome } from "./ui/PageFrame";
import { ShortcutLayer } from "./ShortcutLayer";
import { Toasts } from "./ui/Toasts";
import { countDocWords, countWords } from "./wordCount";
import { WriteRibbon } from "./ui/WriteToolbar";

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
function TitleSync({ ctl, backend }: { ctl: SyncController; backend: WriteBackend }) {
  const dirty = useSync(ctl, (s) => s.dirty);
  const name = useSync(ctl, (s) => s.name);
  const revision = useSync(ctl, (s) => s.revision);
  useEffect(() => {
    void backend.setTitle(`${dirty ? "• " : ""}${name ?? "Untitled"} – Rusuite Write`).catch(() => undefined);
  }, [backend, dirty, name, revision]);
  return null;
}

const StatusBar = memo(function StatusBar({ ctl, editor, backend }: { ctl: SyncController; editor: Editor; backend: WriteBackend }) {
  const { revision, dirty, name, info, warnings } = useThrottledSync(ctl);
  const words = useWordCount(editor);
  return (
    <div className="flex items-center gap-4 border-t border-ui-border bg-ui-panel px-3 py-0.5 text-xs text-ui-muted" data-testid="status-bar">
      <span data-testid="doc-name">{name ?? "Untitled"}</span>
      <span data-testid="dirty">{dirty ? "Modified" : "Saved"}</span>
      <span data-testid="words">{words} words</span>
      <span data-testid="revision">rev {revision}</span>
      {info && <span data-testid="info">{info}</span>}
      {warnings.length > 0 && (
        <span data-testid="warnings" title={warnings.join("\n")} className="truncate text-amber-600">
          {warnings.length} warning{warnings.length === 1 ? "" : "s"}: {warnings[0]}
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
      extensions: [...writeExtensions({ resolveMedia: ctl.media.resolve }), SyncExtension(ctl), features.extension()],
      editorProps: { attributes: () => features.editorAttributes() },
    },
    [ctl],
  );
  const chrome = useWriteChrome(features, editor);
  // ctl.page is replaced before the state change that announces it.
  const page = useSync(ctl, () => ctl.page);

  useEffect(() => {
    if (editor) void ctl.newDocument();
  }, [editor, ctl]);

  const open = useCallback(async () => {
    try {
      const file = await backend.openFile();
      if (file) await ctl.openDocx(file.bytesBase64, file.name);
    } catch (e) {
      ctl.pushError(e);
    }
  }, [backend, ctl]);

  const save = useCallback(async () => {
    await ctl.saveDocx((n, bytes) => backend.saveFile(n, bytes));
  }, [backend, ctl]);

  useEffect(() => {
    session.attach({
      restore: (json, name) => ctl.restoreRecovery(json, name),
      openFile: (file) => ctl.openDocx(file.bytesBase64, file.name),
      onError: (e) => ctl.pushError(e),
    });
    void session.start();
    return () => session.stop();
  }, [session, ctl]);

  const saveAs = useCallback(
    async (name: string) => {
      await ctl.saveDocx((_n, bytes) => backend.saveFile(name, bytes), name);
    },
    [backend, ctl],
  );

  const exportPdf = useCallback(() => void backend.print().catch((e) => ctl.pushError(e)), [backend, ctl]);

  return (
    <main className="flex h-screen flex-col bg-ui-bg text-ui-fg">
      <TitleSync ctl={ctl} backend={backend} />
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
          zoom={zoom}
          onZoom={setZoom}
        />
      )}
      <style>{`${writePrintCss(page)}\n@media print { .write-zoom { zoom: 1 !important; } }`}</style>
      <div className="write-scroll min-h-0 flex-1 overflow-auto bg-ui-panel p-6">
        <div className="write-zoom" data-testid="write-zoom" style={zoom !== 1 ? { zoom } : undefined}>
          <PageFrame page={page} view={chrome.view} pages={chrome.pages} onEditHeaderFooter={chrome.onEditHeaderFooter}>
            <EditorContent editor={editor} />
          </PageFrame>
        </div>
      </div>
      {editor && <StatusBar ctl={ctl} editor={editor} backend={backend} />}
      <FindBar ctl={ctl} editor={editor} ui={features.ui} />
      <WriteDialogs ui={features.ui} ctl={ctl} editor={editor} />
      <EditorContextMenu editor={editor} ctl={ctl} features={features} />
      <Toasts ctl={ctl} />
      <ShortcutLayer editor={editor} ctl={ctl} onOpen={() => void open()} onSave={() => void save()} onSaveAs={(n) => void saveAs(n)} onFind={chrome.onFind} onReplace={chrome.onReplace} features={features} onExportPdf={exportPdf} />
    </main>
  );
}
