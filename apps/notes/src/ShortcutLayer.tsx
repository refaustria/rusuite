// Keyboard shortcuts of Notes (docs/shortcuts.md, "Notes"): one `useShortcuts` map for the app keys; the editor
// binds its own (marks, headings, tags, date/time, Ctrl+K, Ctrl+Z/Y on the mirror's UndoManager) – listed for the
// help dialog only.

import { useMemo, useState } from "react";
import { openBackstage, ShortcutHelp, useShortcuts, type HelpRow, type ShortcutMap } from "@rusuite/ui-shared";
import type { NotesController } from "./controller";
import { BUILTIN_TAGS } from "./tags";
import { useT } from "./i18n";

/** Whether a key event comes from the page editor or a text field (they keep Ctrl+Z / Ctrl+Y). */
const inText = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement | null;
  return !!el?.closest?.(".ProseMirror, input, textarea, select, [role=dialog]");
};

export function NotesShortcuts({ ctl }: { ctl: NotesController }) {
  const t = useT();
  const [help, setHelp] = useState(false);
  const map = useMemo<ShortcutMap>(() => {
    const File = t("sc.file");
    const Pages = t("notes.pages");
    const Edit = t("sc.edit");
    const page = () => ctl.getState().page;
    return {
      "Mod+N": { label: t("notes.page.new"), group: Pages, inField: true, run: () => void ctl.createPage() },
      "Mod+Alt+Shift+N": { label: t("notes.page.newSub"), group: Pages, inField: true, run: () => void ctl.createPage({ sub: true }) },
      "Mod+Alt+]": { label: t("notes.page.indent"), group: Pages, inField: true, run: () => (page() ? void ctl.indentPage(page()!) : false) },
      "Mod+Alt+[": { label: t("notes.page.outdent"), group: Pages, inField: true, run: () => (page() ? void ctl.indentPage(page()!, true) : false) },
      "Mod+O": { label: t("notes.backstage.openNotebook"), group: File, inField: true, run: () => void openBackstage("home") },
      "Mod+S": { label: t("notes.sc.saved"), group: File, inField: true, run: () => void ctl.idle() },
      "Mod+Z": { label: t("notes.sc.undoStructure"), group: Edit, inField: true, when: (e) => !inText(e), run: () => void ctl.undoStructure() },
      "Mod+Y": { label: t("notes.sc.redoStructure"), group: Edit, inField: true, when: (e) => !inText(e), run: () => void ctl.redoStructure() },
      "Mod+Shift+Z": { label: t("notes.sc.redoStructure"), group: Edit, inField: true, when: (e) => !inText(e), run: () => void ctl.redoStructure() },
      "Mod+/": { label: t("shortcuts.title"), inField: true, run: () => setHelp(true) },
    };
  }, [ctl, t]);
  useShortcuts(map);
  const extra = useMemo<HelpRow[]>(() => {
    const Fmt = t("sc.format");
    const Edit = t("sc.edit");
    const Ins = t("tab.insert");
    const Tags = t("notes.tags");
    return [
      { combo: "Mod+Z", label: t("cmd.undo"), group: Edit },
      { combo: "Mod+Y", label: t("cmd.redo"), group: Edit },
      { combo: "Mod+B", label: t("fmt.bold"), group: Fmt },
      { combo: "Mod+I", label: t("fmt.italic"), group: Fmt },
      { combo: "Mod+U", label: t("fmt.underline"), group: Fmt },
      { combo: "Mod+Alt+H", label: t("notes.highlight"), group: Fmt },
      { combo: "Mod+Space", label: t("notes.clearFormatting"), group: Fmt },
      { combo: "Mod+Alt+1", label: t("notes.style.h1"), group: Fmt },
      { combo: "Mod+Alt+2", label: t("notes.style.h2"), group: Fmt },
      { combo: "Mod+Alt+3", label: t("notes.style.h3"), group: Fmt },
      { combo: "Mod+Alt+0", label: t("notes.style.normal"), group: Fmt },
      { combo: "Mod+Shift+8", label: t("list.bullet"), group: Fmt },
      { combo: "Mod+Shift+7", label: t("list.numbered"), group: Fmt },
      { combo: "Mod+Shift+9", label: t("notes.checklist"), group: Fmt },
      { combo: "Tab", label: t("list.indent"), group: Fmt },
      { combo: "Shift+Tab", label: t("list.outdent"), group: Fmt },
      ...BUILTIN_TAGS.filter((x) => x.shortcut).map((x) => ({ combo: x.shortcut!, label: t(`notes.tag.${x.id}`), group: Tags })),
      { combo: "Mod+K", label: t("notes.link"), group: Ins },
      { combo: "[[", label: t("notes.pageLink"), group: Ins },
      { combo: "Alt+Shift+D", label: t("notes.date"), group: Ins },
      { combo: "Alt+Shift+T", label: t("notes.time"), group: Ins },
      { combo: "Alt+Shift+F", label: t("notes.dateTime"), group: Ins },
      { combo: "Shift+Enter", label: t("notes.sc.lineBreak"), group: Ins },
      { combo: "Tab", label: t("notes.sc.pageIndent"), group: t("notes.pages") },
      { combo: "Shift+Tab", label: t("notes.sc.pageOutdent"), group: t("notes.pages") },
      { combo: "F2", label: t("notes.rename"), group: t("notes.pages") },
      { combo: "Delete", label: t("notes.delete"), group: t("notes.pages") },
    ];
  }, [t]);
  return <ShortcutHelp open={help} onClose={() => setHelp(false)} shortcuts={map} extra={extra} />;
}
