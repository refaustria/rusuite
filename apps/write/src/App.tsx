import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import { WriteApi, type WriteBackend } from "./backend";
import { writeExtensions, TWIPS_PER_PX } from "./sync/schema";
import { SyncController, SyncExtension, type SyncState } from "./sync/SyncPlugin";
import { FindReplaceDialog } from "./ui/FindReplaceDialog";
import { Toasts } from "./ui/Toasts";
import { WriteToolbar } from "./ui/WriteToolbar";

function useSync<T>(ctl: SyncController, select: (s: SyncState) => T): T {
  return useSyncExternalStore(ctl.subscribe, () => select(ctl.getState()));
}

export function countWords(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

function StatusBar({ ctl, editor, backend }: { ctl: SyncController; editor: Editor; backend: WriteBackend }) {
  const revision = useSync(ctl, (s) => s.revision);
  const dirty = useSync(ctl, (s) => s.dirty);
  const name = useSync(ctl, (s) => s.name);
  const info = useSync(ctl, (s) => s.info);
  const warnings = useSync(ctl, (s) => s.warnings);
  const words = useEditorState({
    editor,
    selector: ({ editor: e }) => countWords(e.state.doc.textBetween(0, e.state.doc.content.size, " ", " ")),
  });
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
}

export default function App({ backend }: { backend: WriteBackend }) {
  const ctl = useMemo(() => new SyncController(new WriteApi(backend)), [backend]);
  const [findOpen, setFindOpen] = useState(false);
  const editor = useEditor(
    {
      extensions: [...writeExtensions({ resolveMedia: ctl.media.resolve }), SyncExtension(ctl)],
      editorProps: { attributes: { "data-testid": "editor", class: "tiptap-content min-h-full outline-none" } },
    },
    [ctl],
  );
  const ready = useSync(ctl, (s) => s.ready);
  const dirty = useSync(ctl, (s) => s.dirty);
  const name = useSync(ctl, (s) => s.name);
  const revision = useSync(ctl, (s) => s.revision);
  const page = ready ? ctl.page : null;

  useEffect(() => {
    if (editor) void ctl.newDocument();
  }, [editor, ctl]);

  useEffect(() => {
    void backend.setTitle(`${dirty ? "• " : ""}${name ?? "Untitled"} – Rusuite Write`).catch(() => undefined);
  }, [backend, dirty, name, revision]);

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
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "o") {
        e.preventDefault();
        void open();
      } else if (k === "s") {
        e.preventDefault();
        void save();
      } else if (k === "h") {
        e.preventDefault();
        setFindOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, save]);

  const m = page?.margins;
  const px = (twips: number | undefined, fallback: number) => (twips === undefined ? fallback : twips / TWIPS_PER_PX);

  return (
    <main className="flex h-screen flex-col bg-ui-bg text-ui-fg">
      {editor && (
        <WriteToolbar editor={editor} ctl={ctl} onOpen={() => void open()} onSave={() => void save()} onFind={() => setFindOpen(true)} />
      )}
      <div className="min-h-0 flex-1 overflow-auto bg-ui-panel p-6">
        <div
          className="write-page mx-auto bg-white text-black shadow"
          style={{
            width: px(page?.width, 794),
            maxWidth: "100%",
            padding: `${px(m?.top, 96)}px ${px(m?.right, 96)}px ${px(m?.bottom, 96)}px ${px(m?.left, 96)}px`,
          }}
        >
          <EditorContent editor={editor} />
        </div>
      </div>
      {editor && <StatusBar ctl={ctl} editor={editor} backend={backend} />}
      <FindReplaceDialog ctl={ctl} open={findOpen} onClose={() => setFindOpen(false)} />
      <Toasts ctl={ctl} />
    </main>
  );
}
