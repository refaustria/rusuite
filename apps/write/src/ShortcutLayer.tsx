// Keyboard shortcuts of Write: one `useShortcuts` map plus the dialogs some
// of them open (Save As, help). B/I/U (Tiptap marks) and Ctrl+Z/Y (SyncPlugin)
// are bound inside the editor; they are listed for the help dialog only.

import { useMemo, useState } from "react";
import type { Editor } from "@tiptap/react";
import { openBackstage, PromptDialog, ShortcutHelp, useShortcuts, withExtension, type HelpRow, type ShortcutMap } from "@rusuite/ui-shared";
import type { Alignment } from "./generated/Alignment";
import { indent, setAlignment, setParagraphStyle, styleOf } from "./sync/editorCommands";
import { clearFormatting, setLineSpacingRule, toggleSpaceBefore } from "./features/formatting";
import type { WriteFeatures } from "./features/WriteFeatures";
import { insertNote } from "./features/structureCommands";
import type { SyncController } from "./sync/SyncPlugin";
import { useT } from "./i18n";

const nativeRows = (t: (key: string) => string): HelpRow[] => [
  { combo: "Mod+Z", label: t("cmd.undo"), group: t("sc.edit") },
  { combo: "Mod+Y", label: t("cmd.redo"), group: t("sc.edit") },
  { combo: "Mod+Shift+Z", label: t("cmd.redo"), group: t("sc.edit") },
  { combo: "Mod+B", label: t("fmt.bold"), group: t("sc.format") },
  { combo: "Mod+I", label: t("fmt.italic"), group: t("sc.format") },
  { combo: "Mod+U", label: t("fmt.underline"), group: t("sc.format") },
  { combo: "Mod+=", label: t("write.subscript"), group: t("sc.format") },
  { combo: "Mod+Shift+=", label: t("write.superscript"), group: t("sc.format") },
  { combo: "Mod+Space", label: t("write.sc.clearChar"), group: t("sc.format") },
  { combo: "Tab", label: t("write.sc.nextCell"), group: t("write.tables") },
  { combo: "Shift+Tab", label: t("write.sc.prevCell"), group: t("write.tables") },
  { combo: "Enter", label: t("write.sc.findNext"), group: t("sc.edit") },
  { combo: "Escape", label: t("write.sc.stop"), group: t("sc.edit") },
];

export interface WriteShortcutProps {
  editor: Editor | null;
  ctl: SyncController;
  /** New document (asks about unsaved changes first). */
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
  /** Save As under `name` (web: from the name prompt); without one the desktop's save dialog asks. */
  onSaveAs: (name?: string) => void;
  onFind: () => void;
  /** Ctrl+H (default: `onFind`). */
  onReplace?: () => void;
  features?: WriteFeatures;
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

export function ShortcutLayer({ editor, ctl, onNew, onOpen, onSave, onSaveAs, onFind, onReplace, features }: WriteShortcutProps) {
  const t = useT();
  const [helpOpen, setHelpOpen] = useState(false);
  const [saveAsOpen, setSaveAsOpen] = useState(false);

  const map = useMemo<ShortcutMap>(() => {
    const File = t("sc.file");
    const align = (a: Alignment, label: string, key: string): ShortcutMap => ({
      [key]: {
        label,
        group: t("group.paragraph"),
        inField: true,
        run: () => (editor ? void setAlignment(editor, a) : false),
      },
    });
    // Tiptap binds Mod-Alt-1..6 itself and handles them first while the editor has focus;
    // these entries cover the focus being elsewhere (toolbar, status bar).
    const headings: ShortcutMap = {};
    for (const n of [1, 2, 3]) {
      headings[`Mod+Alt+${n}`] = {
        label: t("write.style.heading", { n }),
        group: t("group.paragraph"),
        inField: true,
        run: () => (editor ? void toggleHeading(editor, n) : false),
      };
    }
    return {
      "Mod+N": { label: t("write.sc.newDoc"), group: File, inField: true, run: () => onNew() },
      "Mod+O": { label: t("cmd.open"), group: File, inField: true, run: () => void onOpen() },
      "Mod+S": { label: t("cmd.save"), group: File, inField: true, run: () => void onSave() },
      // Desktop: the native save dialog is the Save As; web: name the download first.
      "Mod+Shift+S": {
        label: t("cmd.saveAs"),
        group: File,
        inField: true,
        run: () => (ctl.api.backend.kind === "tauri" ? onSaveAs() : setSaveAsOpen(true)),
      },
      "Mod+P": { label: t("sc.printTip"), group: File, inField: true, run: () => void openBackstage("print") },
      "Mod+/": { label: t("shortcuts.title"), inField: true, run: () => setHelpOpen(true) },
      "Mod+F": { label: t("cmd.findReplace"), group: t("sc.edit"), inField: true, run: () => onFind() },
      "Mod+H": { label: t("cmd.replace"), group: t("sc.edit"), inField: true, run: () => (onReplace ?? onFind)() },
      "Mod+Shift+C": {
        label: t("write.sc.copyFormat"),
        group: t("sc.format"),
        inField: true,
        run: () => (editor && features ? void features.painter.copy(editor, true) : false),
      },
      "Mod+Shift+V": {
        label: t("write.sc.pasteFormat"),
        group: t("sc.format"),
        inField: true,
        run: () => {
          if (!editor || !features?.painter.active) return false;
          features.painter.paste(editor);
          features.painter.cancel(editor);
        },
      },
      "Mod+1": { label: t("write.sc.single"), group: t("group.paragraph"), inField: true, run: () => (editor ? void setLineSpacingRule(editor, { kind: "multiple", value: 1 }) : false) },
      "Mod+2": { label: t("write.sc.double"), group: t("group.paragraph"), inField: true, run: () => (editor ? void setLineSpacingRule(editor, { kind: "multiple", value: 2 }) : false) },
      "Mod+5": { label: t("write.sc.onePointFive"), group: t("group.paragraph"), inField: true, run: () => (editor ? void setLineSpacingRule(editor, { kind: "multiple", value: 1.5 }) : false) },
      "Mod+0": { label: t("write.sc.space12"), group: t("group.paragraph"), inField: true, run: () => (editor ? void toggleSpaceBefore(editor) : false) },
      "Mod+M": { label: t("list.indent"), group: t("group.paragraph"), inField: true, run: () => (editor ? void indent(editor, 1) : false) },
      "Mod+Shift+M": { label: t("list.outdent"), group: t("group.paragraph"), inField: true, run: () => (editor ? void indent(editor, -1) : false) },
      "Mod+Shift+N": { label: t("write.sc.clearAll"), group: t("sc.format"), inField: true, run: () => (editor ? void clearFormatting(editor, ctl, true) : false) },
      ...align("center", t("write.sc.center"), "Mod+E"),
      ...align("left", t("fmt.alignLeft"), "Mod+L"),
      ...align("right", t("fmt.alignRight"), "Mod+R"),
      ...align("justify", t("write.justify"), "Mod+J"),
      "Mod+Shift+L": {
        label: t("list.bullet"),
        group: t("group.paragraph"),
        inField: true,
        run: () => (editor ? editor.chain().focus().toggleBulletList().run() : false),
      },
      ...headings,
      // Tiptap handles these while the editor has focus; these cover the focus being elsewhere.
      "Mod+Alt+F": {
        label: t("write.insertFootnote"),
        group: t("write.footnotes"),
        inField: true,
        run: () => (editor ? void insertNote(editor, ctl, "foot") : false),
      },
      "Mod+Alt+D": {
        label: t("write.insertEndnote"),
        group: t("write.footnotes"),
        inField: true,
        run: () => (editor ? void insertNote(editor, ctl, "end") : false),
      },
    };
  }, [editor, ctl, onNew, onOpen, onSave, onSaveAs, onFind, onReplace, features, t]);

  useShortcuts(map);

  return (
    <>
      <ShortcutHelp open={helpOpen} onClose={() => setHelpOpen(false)} shortcuts={map} extra={nativeRows(t)} />
      <PromptDialog
        open={saveAsOpen}
        title={t("cmd.saveAs")}
        label={t("saveAs.fileName")}
        initial={ctl.getState().name ?? t("write.defaultName")}
        confirmLabel={t("cmd.save")}
        onClose={() => setSaveAsOpen(false)}
        onSubmit={(name) => {
          setSaveAsOpen(false);
          onSaveAs(withExtension(name, ".docx"));
        }}
      />
    </>
  );
}
