// Keyboard shortcuts of Write: one `useShortcuts` map plus the dialogs some
// of them open (Save As, help). B/I/U (Tiptap marks) and Ctrl+Z/Y (SyncPlugin)
// are bound inside the editor; they are listed for the help dialog only.

import { useMemo, useState } from "react";
import type { Editor } from "@tiptap/react";
import { PromptDialog, ShortcutHelp, useShortcuts, withExtension, type HelpRow, type ShortcutMap } from "@rusuite/ui-shared";
import type { Alignment } from "./generated/Alignment";
import { indent, setAlignment, setParagraphStyle, styleOf } from "./sync/editorCommands";
import { clearFormatting, setLineSpacingRule, toggleSpaceBefore } from "./features/formatting";
import type { WriteFeatures } from "./features/WriteFeatures";
import type { SyncController } from "./sync/SyncPlugin";

const NATIVE_ROWS: HelpRow[] = [
  { combo: "Mod+Z", label: "Undo", group: "Edit" },
  { combo: "Mod+Y", label: "Redo", group: "Edit" },
  { combo: "Mod+Shift+Z", label: "Redo", group: "Edit" },
  { combo: "Mod+B", label: "Bold", group: "Format" },
  { combo: "Mod+I", label: "Italic", group: "Format" },
  { combo: "Mod+U", label: "Underline", group: "Format" },
  { combo: "Mod+=", label: "Subscript", group: "Format" },
  { combo: "Mod+Shift+=", label: "Superscript", group: "Format" },
  { combo: "Mod+Space", label: "Clear character formatting", group: "Format" },
  { combo: "Tab", label: "Table: next cell (in the last cell: new row)", group: "Tables" },
  { combo: "Shift+Tab", label: "Table: previous cell", group: "Tables" },
  { combo: "Enter", label: "Find bar: next match (Shift+Enter: previous)", group: "Edit" },
  { combo: "Escape", label: "Stop the format painter / close the find bar", group: "Edit" },
];

export interface WriteShortcutProps {
  editor: Editor | null;
  ctl: SyncController;
  /** New document (asks about unsaved changes first). */
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
  onSaveAs: (name: string) => void;
  onFind: () => void;
  /** Ctrl+H (default: `onFind`). */
  onReplace?: () => void;
  features?: WriteFeatures;
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

export function ShortcutLayer({ editor, ctl, onNew, onOpen, onSave, onSaveAs, onFind, onReplace, features, onExportPdf }: WriteShortcutProps) {
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
      "Mod+N": { label: "New document", group: File, inField: true, run: () => onNew() },
      "Mod+O": { label: "Open", group: File, inField: true, run: () => void onOpen() },
      "Mod+S": { label: "Save", group: File, inField: true, run: () => void onSave() },
      "Mod+Shift+S": { label: "Save as", group: File, inField: true, run: () => setSaveAsOpen(true) },
      "Mod+P": { label: "Export PDF…", group: File, inField: true, run: () => onExportPdf() },
      "Mod+/": { label: "Keyboard shortcuts", inField: true, run: () => setHelpOpen(true) },
      "Mod+F": { label: "Find and replace", group: "Edit", inField: true, run: () => onFind() },
      "Mod+H": { label: "Replace", group: "Edit", inField: true, run: () => (onReplace ?? onFind)() },
      "Mod+Shift+C": {
        label: "Copy formatting (format painter)",
        group: "Format",
        inField: true,
        run: () => (editor && features ? void features.painter.copy(editor, true) : false),
      },
      "Mod+Shift+V": {
        label: "Paste formatting",
        group: "Format",
        inField: true,
        run: () => {
          if (!editor || !features?.painter.active) return false;
          features.painter.paste(editor);
          features.painter.cancel(editor);
        },
      },
      "Mod+1": { label: "Single line spacing", group: "Paragraph", inField: true, run: () => (editor ? void setLineSpacingRule(editor, { kind: "multiple", value: 1 }) : false) },
      "Mod+2": { label: "Double line spacing", group: "Paragraph", inField: true, run: () => (editor ? void setLineSpacingRule(editor, { kind: "multiple", value: 2 }) : false) },
      "Mod+5": { label: "1.5 line spacing", group: "Paragraph", inField: true, run: () => (editor ? void setLineSpacingRule(editor, { kind: "multiple", value: 1.5 }) : false) },
      "Mod+0": { label: "Add/remove 12 pt space before", group: "Paragraph", inField: true, run: () => (editor ? void toggleSpaceBefore(editor) : false) },
      "Mod+M": { label: "Increase indent", group: "Paragraph", inField: true, run: () => (editor ? void indent(editor, 1) : false) },
      "Mod+Shift+M": { label: "Decrease indent", group: "Paragraph", inField: true, run: () => (editor ? void indent(editor, -1) : false) },
      "Mod+Shift+N": { label: "Clear all formatting (Normal)", group: "Format", inField: true, run: () => (editor ? void clearFormatting(editor, ctl, true) : false) },
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
  }, [editor, ctl, onNew, onOpen, onSave, onFind, onReplace, features, onExportPdf]);

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
