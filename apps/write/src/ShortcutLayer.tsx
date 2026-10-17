// Keyboard shortcuts of Write: one `useShortcuts` map plus the dialogs some
// of them open (Save As, help). B/I/U (Tiptap marks) and Ctrl+Z/Y (SyncPlugin)
// are bound inside the editor; they are listed for the help dialog only.

import { useMemo, useState } from "react";
import type { Editor } from "@tiptap/react";
import { openBackstage, ShortcutHelp, useShortcuts, type HelpRow, type ShortcutMap } from "@rusuite/ui-shared";
import { SaveAsDialog } from "./ui/templatesUi";
import type { Alignment } from "./generated/Alignment";
import { indent, setAlignment, setParagraphStyle, toggleHeading } from "./sync/editorCommands";
import { setLineSpacingRule, toggleSpaceBefore } from "./features/formatting";
import type { WriteFeatures } from "./features/WriteFeatures";
import { insertNote } from "./features/structureCommands";
import { formatTarget } from "./features/runFormat";
import { cycleCaseCommand, growFont, removeParagraphFormatting, stepHangingIndent, toggleChar, wordUnderline, type CharToggle } from "./features/wordKeys";
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
  { combo: "Mod+Enter", label: t("write.pageBreak"), group: t("sc.edit") },
  { combo: "Shift+Enter", label: t("write.lineBreak"), group: t("sc.edit") },
  { combo: "Tab", label: t("write.sc.nextCell"), group: t("write.tables") },
  { combo: "Shift+Tab", label: t("write.sc.prevCell"), group: t("write.tables") },
  { combo: "Mod+Shift+Enter", label: t("write.w5.splitTable"), group: t("write.tables") },
  { combo: "Mod+Alt+-", label: t("write.special.emDash"), group: t("write.w5.specialChars") },
  { combo: "Mod+Num -", label: t("write.special.enDash"), group: t("write.w5.specialChars") },
  { combo: "Mod+Shift+Space", label: t("write.special.nbSpace"), group: t("write.w5.specialChars") },
  { combo: "Mod+Shift+-", label: t("write.special.nbHyphen"), group: t("write.w5.specialChars") },
  { combo: "Mod+-", label: t("write.special.softHyphen"), group: t("write.w5.specialChars") },
  { combo: "Mod+Alt+C", label: t("write.special.copyright"), group: t("write.w5.specialChars") },
  { combo: "Mod+Alt+R", label: t("write.special.registered"), group: t("write.w5.specialChars") },
  { combo: "Mod+Alt+T", label: t("write.special.trademark"), group: t("write.w5.specialChars") },
  { combo: "Mod+Alt+.", label: t("write.special.ellipsis"), group: t("write.w5.specialChars") },
  { combo: "Enter", label: t("write.sc.findNext"), group: t("sc.edit") },
  { combo: "Escape", label: t("write.sc.stop"), group: t("sc.edit") },
  { combo: "Mod+K", label: t("write.link.title"), group: t("write.links") },
  { combo: "Mod+G", label: t("write.goTo.title"), group: t("write.links") },
  { combo: "F5", label: t("write.goTo.title"), group: t("write.links") },
  { combo: "F9", label: t("write.updateFields"), group: t("write.links") },
  { combo: "Alt+F9", label: t("write.fields.toggleAllCodes"), group: t("write.links") },
  { combo: "Shift+F9", label: t("write.fields.toggleCodes"), group: t("write.links") },
  { combo: "Mod+F11", label: t("write.fields.lock"), group: t("write.links") },
  { combo: "Mod+Shift+F11", label: t("write.fields.unlock"), group: t("write.links") },
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
    // The editor's own keymap (WriteFeatures) binds Mod-Alt-1..3 to the same toggle before Tiptap's heading keys;
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
    // Word's extra character and paragraph keys (W-30); run formatting goes to the text box with the caret.
    const Fmt = t("sc.format");
    const font = (label: string, how: "point" | "list", dir: 1 | -1) => ({
      label,
      group: Fmt,
      inField: true,
      run: () => (editor ? void growFont(formatTarget(editor), ctl.styles, how, dir) : false),
    });
    const char = (label: string, kind: CharToggle) => ({
      label,
      group: Fmt,
      inField: true,
      run: () => (editor ? void toggleChar(formatTarget(editor), ctl.styles, kind) : false),
    });
    const para = t("group.paragraph");
    const word: ShortcutMap = {
      "Mod+]": font(t("write.sc.growFont1"), "point", 1),
      "Mod+[": font(t("write.sc.shrinkFont1"), "point", -1),
      "Mod+Shift+>": font(t("write.sc.growFont"), "list", 1),
      "Mod+Shift+<": font(t("write.sc.shrinkFont"), "list", -1),
      "Mod+Shift+K": char(t("write.sc.smallCaps"), "smallCaps"),
      "Mod+Shift+A": char(t("write.sc.allCaps"), "allCaps"),
      "Mod+Shift+D": char(t("write.sc.doubleUnderline"), "doubleUnderline"),
      "Mod+Shift+W": {
        label: t("write.sc.wordUnderline"),
        group: Fmt,
        inField: true,
        run: () => (editor ? void wordUnderline(formatTarget(editor), ctl.styles) : false),
      },
      "Shift+F3": {
        label: t("write.sc.cycleCase"),
        group: Fmt,
        inField: true,
        run: () => {
          const cmd = editor ? cycleCaseCommand(editor) : null;
          if (!cmd) return false;
          void ctl.run(cmd);
        },
      },
      "Mod+T": { label: t("write.sc.hanging"), group: para, inField: true, run: () => (editor ? void stepHangingIndent(editor, ctl.styles, 1) : false) },
      "Mod+Shift+T": { label: t("write.sc.reduceHanging"), group: para, inField: true, run: () => (editor ? void stepHangingIndent(editor, ctl.styles, -1) : false) },
      "Mod+Q": { label: t("write.sc.removeParagraph"), group: para, inField: true, run: () => (editor ? void removeParagraphFormatting(editor) : false) },
      "Mod+Shift+N": { label: t("write.sc.normalStyle"), group: t("write.styles"), inField: true, run: () => (editor ? void setParagraphStyle(editor, "Normal") : false) },
    };
    return {
      ...word,
      "Mod+N": { label: t("write.sc.newDoc"), group: File, inField: true, run: () => onNew() },
      "Mod+O": { label: t("cmd.open"), group: File, inField: true, run: () => void onOpen() },
      "Mod+S": { label: t("cmd.save"), group: File, inField: true, run: () => void onSave() },
      // Word: F12 is Save As (Ctrl+Shift+S is Apply Styles). Desktop: the native save dialog; web: name the download first.
      F12: {
        label: t("cmd.saveAs"),
        group: File,
        inField: true,
        run: () => (ctl.api.backend.kind === "tauri" ? onSaveAs() : setSaveAsOpen(true)),
      },
      "Mod+Shift+S": {
        label: t("write.styles.applyStyles"),
        group: t("write.styles"),
        inField: true,
        run: () => (features ? features.ui.set({ applyStyles: true }) : false),
      },
      "Mod+Alt+Shift+S": {
        label: t("write.styles.pane"),
        group: t("write.styles"),
        inField: true,
        run: () => (features ? features.ui.set({ stylesPane: !features.ui.getState().stylesPane }) : false),
      },
      "Shift+F1": {
        label: t("write.reveal.title"),
        group: t("write.styles"),
        inField: true,
        run: () => (features ? features.ui.set({ revealFormatting: !features.ui.getState().revealFormatting }) : false),
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
      "Mod+Alt+M": {
        label: t("write.comments.new"),
        group: t("write.comments.title"),
        run: () => (features ? void features.newComment() : false),
      },
    };
  }, [editor, ctl, onNew, onOpen, onSave, onSaveAs, onFind, onReplace, features, t]);

  useShortcuts(map);

  return (
    <>
      <ShortcutHelp open={helpOpen} onClose={() => setHelpOpen(false)} shortcuts={map} extra={nativeRows(t)} />
      <SaveAsDialog
        open={saveAsOpen}
        initial={ctl.getState().name ?? t("write.defaultName")}
        onClose={() => setSaveAsOpen(false)}
        onSubmit={(name) => {
          setSaveAsOpen(false);
          onSaveAs(name);
        }}
      />
    </>
  );
}
