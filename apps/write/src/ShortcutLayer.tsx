// Keyboard shortcuts of Write: one `useShortcuts` map plus the dialogs some
// of them open (Save As, help). B/I/U (Tiptap marks) and Ctrl+Z/Y (SyncPlugin)
// are bound inside the editor; they are listed for the help dialog only.

import { useMemo, useState } from "react";
import type { Editor } from "@tiptap/react";
import { PromptDialog, ShortcutHelp, useShortcuts, withExtension, type HelpRow, type ShortcutMap } from "@rusuite/ui-shared";
import type { Alignment } from "./generated/Alignment";
import { setAlignment, setParagraphStyle, styleOf } from "./sync/editorCommands";
import type { SyncController } from "./sync/SyncPlugin";

const NATIVE_ROWS: HelpRow[] = [
  { combo: "Mod+Z", label: "Undo", group: "Edit" },
  { combo: "Mod+Y", label: "Redo", group: "Edit" },
  { combo: "Mod+Shift+Z", label: "Redo", group: "Edit" },
  { combo: "Mod+B", label: "Bold", group: "Format" },
  { combo: "Mod+I", label: "Italic", group: "Format" },
  { combo: "Mod+U", label: "Underline", group: "Format" },
];

export interface WriteShortcutProps {
  editor: Editor | null;
  ctl: SyncController;
  onOpen: () => void;
  onSave: () => void;
  onSaveAs: (name: string) => void;
  onFind: () => void;
  onExportPdf: () => void;
}

/** Heading level toggle: pressing it again returns to Normal. */
function toggleHeading(editor: Editor, level: number): void {
  const id = `Heading${level}`;
  const { $from } = editor.state.selection;
  let current = "Normal";
  for (let d = $from.depth; d > 0; d--) {
    const n = $from.node(d);
    if (n.type.name === "heading" || n.type.name === "paragraph" || n.type.name === "title") {
      current = styleOf(n);
      break;
    }
  }
  setParagraphStyle(editor, current === id ? "Normal" : id);
}

export function ShortcutLayer({ editor, ctl, onOpen, onSave, onSaveAs, onFind, onExportPdf }: WriteShortcutProps) {
  const [helpOpen, setHelpOpen] = useState(false);
  const [saveAsOpen, setSaveAsOpen] = useState(false);

  const map = useMemo<ShortcutMap>(() => {
    const File = "File";
    const align = (a: Alignment, label: string, key: string): ShortcutMap => ({
      [key]: {
        label,
        group: "Paragraph",
        inField: true,
        run: () => (editor ? void setAlignment(editor, a) : false),
      },
    });
    // Tiptap binds Mod-Alt-1..6 itself and handles them first while the editor has focus;
    // these entries cover the focus being elsewhere (toolbar, status bar).
    const headings: ShortcutMap = {};
    for (const n of [1, 2, 3]) {
      headings[`Mod+Alt+${n}`] = {
        label: `Heading ${n}`,
        group: "Paragraph",
        inField: true,
        run: () => (editor ? void toggleHeading(editor, n) : false),
      };
    }
    return {
      "Mod+N": {
        label: "New document",
        group: File,
        inField: true,
        run: () => {
          if (ctl.getState().dirty && typeof window.confirm === "function" && !window.confirm("Discard unsaved changes?")) return;
          void ctl.newDocument();
        },
      },
      "Mod+O": { label: "Open", group: File, inField: true, run: () => void onOpen() },
      "Mod+S": { label: "Save", group: File, inField: true, run: () => void onSave() },
      "Mod+Shift+S": { label: "Save as", group: File, inField: true, run: () => setSaveAsOpen(true) },
      "Mod+P": { label: "Export PDF…", group: File, inField: true, run: () => onExportPdf() },
      "Mod+/": { label: "Keyboard shortcuts", inField: true, run: () => setHelpOpen(true) },
      "Mod+F": { label: "Find and replace", group: "Edit", inField: true, run: () => onFind() },
      "Mod+H": { label: "Find and replace", group: "Edit", inField: true, run: () => onFind() },
      ...align("center", "Center", "Mod+E"),
      ...align("left", "Align left", "Mod+L"),
      ...align("right", "Align right", "Mod+R"),
      ...align("justify", "Justify", "Mod+J"),
      "Mod+Shift+L": {
        label: "Bulleted list",
        group: "Paragraph",
        inField: true,
        run: () => (editor ? editor.chain().focus().toggleBulletList().run() : false),
      },
      ...headings,
    };
  }, [editor, ctl, onOpen, onSave, onFind, onExportPdf]);

  useShortcuts(map);

  return (
    <>
      <ShortcutHelp open={helpOpen} onClose={() => setHelpOpen(false)} shortcuts={map} extra={NATIVE_ROWS} />
      <PromptDialog
        open={saveAsOpen}
        title="Save as"
        label="File name"
        initial={ctl.getState().name ?? "Document.docx"}
        confirmLabel="Save"
        onClose={() => setSaveAsOpen(false)}
        onSubmit={(name) => {
          setSaveAsOpen(false);
          onSaveAs(withExtension(name, ".docx"));
        }}
      />
    </>
  );
}
