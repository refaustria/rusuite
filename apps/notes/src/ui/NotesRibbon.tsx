// The ribbon of Notes: File (backstage) · Home · Insert · View. Draw and Share come later (P11-N4, P11-N5).

import type { ReactNode } from "react";
import type { Editor } from "@tiptap/core";
import {
  ColorPicker, cssColor, OFFICE_THEME, ParagraphStyleSelect, Ribbon, RibbonButton, RibbonMenuButton, RibbonRow, RibbonSplitButton, RibbonStack,
  type Color, type RibbonMenuItem, type RibbonTab,
} from "@rusuite/ui-shared";
import { Icon } from "@rusuite/ui-shared";
import type { NotesController } from "../controller";
import type { TreeNode } from "../generated/TreeNode";
import { findNode } from "../tree";
import { blockTags, clearFormatting, clearTags, currentStyle, insertDateTime, PARAGRAPH_STYLES, setStyle, toggleTag, type ParagraphStyle } from "../editor/commands";
import { BUILTIN_TAGS } from "../tags";
import { useT } from "../i18n";
import { BackstageHome } from "./BackstageHome";
import { useDialog } from "./dialogs";
import { useEditorTick, useNotes } from "./hooks";
import { NotesIcon } from "./icons";
import { linkDialog, pageLinkDialog } from "./PageView";

export const NOTES_ACCENT = "#7719AA";

const HIGHLIGHTS = ["#FFF59D", "#C8E6C9", "#B3E5FC", "#F8BBD0", "#FFE0B2"];

export const ZOOM_STEPS = [0.75, 0.9, 1, 1.1, 1.25, 1.5, 2];

export function NotesRibbon({ ctl, editor, rightSlot }: { ctl: NotesController; editor: Editor | null; rightSlot?: ReactNode }) {
  const t = useT();
  const open = useDialog();
  useEditorTick(editor);
  const canUndo = useNotes(ctl, (s) => s.canUndo);
  const canRedo = useNotes(ctl, (s) => s.canRedo);
  const settings = useNotes(ctl, (s) => s.settings);
  const notebook = useNotes(ctl, (s) => s.notebook);
  const title = useNotes(ctl, (s) => s.opened?.title);
  const pageTitle = useNotes(ctl, (s) => {
    const nb = s.notebooks.find((n) => n.summary.id === s.notebook);
    return nb ? findTitle(nb.tree, s.page) : null;
  });
  const off = !editor || editor.isDestroyed;
  const e = editor!;
  const active = (name: string, attrs?: Record<string, unknown>) => !off && e.isActive(name, attrs);
  const run = (fn: (ed: Editor) => unknown) => () => {
    if (!off) fn(e);
  };
  const chain = () => e.chain().focus();

  const tags = off ? [] : blockTags(e);
  const tagMenu: RibbonMenuItem[] = [
    ...BUILTIN_TAGS.map((tag) => ({
      id: tag.id,
      label: t(`notes.tag.${tag.id}`),
      shortcut: tag.shortcut,
      checked: tags.includes(tag.id),
      onSelect: run((ed) => toggleTag(ed, tag.id, tag.kind === "toDo")),
    })),
    { separator: true as const },
    { id: "remove", label: t("notes.tag.remove"), onSelect: run((ed) => clearTags(ed)) },
  ];

  const home: RibbonTab = {
    id: "home",
    label: t("tab.home"),
    groups: [
      {
        label: t("group.undo"),
        items: (
          <RibbonStack>
            <RibbonButton label={t("cmd.undo")} icon="undo" shortcut="Mod+Z" disabled={!canUndo} onClick={() => void ctl.undo()} />
            <RibbonButton label={t("cmd.redo")} icon="redo" shortcut="Mod+Y" disabled={!canRedo} onClick={() => void ctl.redo()} />
          </RibbonStack>
        ),
      },
      {
        label: t("group.clipboard"),
        collapsePriority: 2,
        items: (
          <>
            <RibbonButton size="large" label={t("cmd.paste")} icon="paste" shortcut="Mod+V" disabled={off} onClick={run((ed) => void pasteText(ed))} />
            <RibbonStack>
              <RibbonButton label={t("cmd.cut")} icon="cut" shortcut="Mod+X" disabled={off} onClick={run((ed) => clipboardCommand(ed, "cut"))} />
              <RibbonButton label={t("cmd.copy")} icon="copy" shortcut="Mod+C" disabled={off} onClick={run((ed) => clipboardCommand(ed, "copy"))} />
            </RibbonStack>
          </>
        ),
      },
      {
        label: t("group.font"),
        items: (
          <RibbonStack>
            <RibbonRow>
              <RibbonButton label={t("fmt.bold")} icon={<Icon name="bold" />} shortcut="Mod+B" pressed={active("bold")} disabled={off} onClick={() => chain().toggleBold().run()} />
              <RibbonButton label={t("fmt.italic")} icon={<Icon name="italic" />} shortcut="Mod+I" pressed={active("italic")} disabled={off} onClick={() => chain().toggleItalic().run()} />
              <RibbonButton label={t("fmt.underline")} icon={<Icon name="underline" />} shortcut="Mod+U" pressed={active("underline")} disabled={off} onClick={() => chain().toggleUnderline().run()} />
              <RibbonButton label={t("fmt.strike")} icon={<Icon name="strike" />} pressed={active("strike")} disabled={off} onClick={() => chain().toggleStrike().run()} />
            </RibbonRow>
            <RibbonRow>
              <RibbonSplitButton
                label={t("notes.highlight")}
                icon={<NotesIcon name="highlight" />}
                shortcut="Mod+Alt+H"
                disabled={off}
                onClick={() => (active("highlight") ? chain().unsetHighlight().run() : chain().setHighlight(null).run())}
                menu={[
                  ...HIGHLIGHTS.map((c, i) => ({ id: c, label: t(`notes.highlight.c${i + 1}`), icon: <span className="inline-block h-3 w-3 rounded-sm" style={{ background: c }} />, onSelect: () => void chain().setHighlight(c).run() })),
                  { separator: true as const },
                  { id: "none", label: t("notes.highlight.none"), onSelect: () => void chain().unsetHighlight().run() },
                ]}
              />
              <ColorPicker
                label={t("fmt.textColor")}
                kind="text"
                disabled={off}
                value={textColor(e, off)}
                onSelect={(c) => void chain().setTextColor(c ? (cssColor(c, OFFICE_THEME) ?? null) : null).run()}
              />
              <RibbonButton label={t("notes.clearFormatting")} icon={<NotesIcon name="clearFormat" />} shortcut="Mod+Space" disabled={off} onClick={run((ed) => clearFormatting(ed))} />
            </RibbonRow>
          </RibbonStack>
        ),
      },
      {
        label: t("group.paragraph"),
        items: (
          <RibbonStack>
            <RibbonRow>
              <RibbonButton label={t("list.bullet")} icon={<NotesIcon name="bullets" />} shortcut="Mod+Shift+8" pressed={active("bulletList")} disabled={off} onClick={() => chain().toggleBulletList().run()} />
              <RibbonButton label={t("list.numbered")} icon={<NotesIcon name="numbers" />} shortcut="Mod+Shift+7" pressed={active("orderedList")} disabled={off} onClick={() => chain().toggleOrderedList().run()} />
              <RibbonButton label={t("notes.checklist")} icon={<NotesIcon name="checklist" />} shortcut="Mod+Shift+9" pressed={active("taskList")} disabled={off} onClick={() => chain().toggleTaskList().run()} />
            </RibbonRow>
            <RibbonRow>
              <RibbonButton label={t("list.outdent")} icon={<NotesIcon name="outdent" />} shortcut="Shift+Tab" disabled={off} onClick={() => liftItem(e)} />
              <RibbonButton label={t("list.indent")} icon={<NotesIcon name="indent" />} shortcut="Tab" disabled={off} onClick={() => sinkItem(e)} />
            </RibbonRow>
          </RibbonStack>
        ),
      },
      {
        label: t("notes.styles"),
        items: (
          <ParagraphStyleSelect
            value={off ? "normal" : currentStyle(e)}
            disabled={off}
            styles={PARAGRAPH_STYLES.map((id) => ({ id, label: t(`notes.style.${id}`) }))}
            onChange={(id) => !off && setStyle(e, id as ParagraphStyle)}
          />
        ),
      },
      {
        label: t("notes.tags"),
        items: (
          <>
            <RibbonButton size="large" label={t("notes.tag.todo")} icon={<NotesIcon name="checklist" size={22} />} shortcut="Mod+1" pressed={tags.includes("todo")} disabled={off} onClick={run((ed) => toggleTag(ed, "todo", true))} />
            <RibbonMenuButton size="large" label={t("notes.tags")} icon={<NotesIcon name="tag" size={22} />} disabled={off} menu={tagMenu} />
          </>
        ),
      },
    ],
  };

  const insert: RibbonTab = {
    id: "insert",
    label: t("tab.insert"),
    groups: [
      {
        label: t("notes.links"),
        items: (
          <>
            <RibbonButton size="large" label={t("notes.link")} icon={<NotesIcon name="link" size={22} />} shortcut="Mod+K" disabled={off} onClick={() => !off && open(linkDialog(e))} />
            <RibbonButton size="large" label={t("notes.pageLink")} icon={<NotesIcon name="pageLink" size={22} />} tooltip={t("notes.pageLink.tip")} disabled={off} onClick={() => !off && open(pageLinkDialog(e))} />
          </>
        ),
      },
      {
        label: t("notes.blocks"),
        items: (
          <>
            <RibbonButton size="large" label={t("notes.divider")} icon={<NotesIcon name="divider" size={22} />} disabled={off} onClick={() => chain().setHorizontalRule().run()} />
            <RibbonButton size="large" label={t("notes.codeBlock")} icon={<NotesIcon name="code" size={22} />} pressed={active("codeBlock")} disabled={off} onClick={() => chain().toggleCodeBlock().run()} />
          </>
        ),
      },
      {
        label: t("notes.timeStamp"),
        items: (
          <RibbonStack>
            <RibbonButton label={t("notes.date")} icon={<NotesIcon name="date" />} showLabel shortcut="Alt+Shift+D" disabled={off} onClick={run((ed) => insertDateTime(ed, "date"))} />
            <RibbonButton label={t("notes.time")} icon={<NotesIcon name="time" />} showLabel shortcut="Alt+Shift+T" disabled={off} onClick={run((ed) => insertDateTime(ed, "time"))} />
            <RibbonButton label={t("notes.dateTime")} icon={<NotesIcon name="date" />} showLabel shortcut="Alt+Shift+F" disabled={off} onClick={run((ed) => insertDateTime(ed, "both"))} />
          </RibbonStack>
        ),
      },
    ],
  };

  const zoomIdx = ZOOM_STEPS.indexOf(settings.zoom);
  const view: RibbonTab = {
    id: "view",
    label: t("tab.view"),
    groups: [
      {
        label: t("group.show"),
        items: <RibbonButton size="large" label={t("notes.view.nav")} icon={<NotesIcon name="nav" size={22} />} pressed={settings.navOpen} onClick={() => ctl.updateSettings({ navOpen: !settings.navOpen })} />,
      },
      {
        label: t("notes.view.pageWidth"),
        items: (
          <RibbonStack>
            <RibbonButton label={t("notes.view.width.normal")} showLabel pressed={settings.pageWidth === "normal"} onClick={() => ctl.updateSettings({ pageWidth: "normal" })} />
            <RibbonButton label={t("notes.view.width.wide")} showLabel pressed={settings.pageWidth === "wide"} onClick={() => ctl.updateSettings({ pageWidth: "wide" })} />
          </RibbonStack>
        ),
      },
      {
        label: t("group.zoom"),
        items: (
          <RibbonStack>
            <RibbonRow>
              <RibbonButton label={t("notes.zoomOut")} icon={<NotesIcon name="zoomOut" />} disabled={zoomIdx === 0} onClick={() => ctl.updateSettings({ zoom: ZOOM_STEPS[Math.max(0, (zoomIdx < 0 ? 2 : zoomIdx) - 1)]! })} />
              <span className="min-w-10 text-center text-xs tabular-nums" data-testid="zoom-level">
                {Math.round(settings.zoom * 100)} %
              </span>
              <RibbonButton label={t("notes.zoomIn")} icon={<NotesIcon name="zoomIn" />} disabled={zoomIdx === ZOOM_STEPS.length - 1} onClick={() => ctl.updateSettings({ zoom: ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, (zoomIdx < 0 ? 2 : zoomIdx) + 1)]! })} />
            </RibbonRow>
            <RibbonButton label={t("cmd.zoomTo100")} showLabel onClick={() => ctl.updateSettings({ zoom: 1 })} />
          </RibbonStack>
        ),
      },
      {
        label: t("notes.view.theme"),
        items: (
          <RibbonMenuButton
            size="large"
            label={t("notes.view.darkMode")}
            icon={<NotesIcon name="moon" size={22} />}
            menu={(["system", "light", "dark"] as const).map((th) => ({ id: th, label: t(`notes.view.theme.${th}`), checked: settings.theme === th, onSelect: () => ctl.updateSettings({ theme: th }) }))}
          />
        ),
      },
    ],
  };

  const newNotebook = () =>
    open({ kind: "prompt", title: t("notes.notebook.new"), label: t("notes.notebook.name"), initial: t("notes.notebook.defaultName"), confirm: t("notes.create"), onSubmit: (v) => void ctl.createNotebook(v) });

  return (
    <Ribbon
      tabs={[home, insert, view]}
      appName="Notes"
      documentTitle={pageTitle ?? title ?? undefined}
      accent={NOTES_ACCENT}
      rightSlot={rightSlot}
      undo={{ canUndo, canRedo, onUndo: () => void ctl.undo(), onRedo: () => void ctl.redo() }}
      backstage={{
        onNew: newNotebook,
        onCloseDocument: notebook ? () => void ctl.closeNotebook(notebook) : undefined,
        onOptions: () => open({ kind: "options" }),
        reportHost: ctl.backend,
        commands: [
          { id: "downloadBackup", label: t("notes.backup.download"), icon: "save", disabled: !notebook, onSelect: () => void ctl.downloadBackup() },
          { id: "openBackup", label: t("notes.backup.openDots"), icon: "open", onSelect: () => void ctl.openBackupFile() },
          { id: "about", label: t("notes.about.menu"), icon: "sparkle", footer: true, onSelect: () => open({ kind: "about" }) },
        ],
        info: <BackstageHome ctl={ctl} />,
      }}
    />
  );
}

function findTitle(tree: readonly TreeNode[], id: string | null): string | null {
  return findNode(tree, id)?.title ?? null;
}

function textColor(e: Editor, off: boolean): Color | undefined {
  if (off) return undefined;
  const c = e.getAttributes("textStyle").color as string | undefined;
  return c && /^#[0-9a-f]{6}$/i.test(c) ? { kind: "rgb", value: c.slice(1).toUpperCase() } : undefined;
}

function sinkItem(e: Editor): void {
  if (!e || e.isDestroyed) return;
  const c = e.chain().focus();
  if (e.can().sinkListItem("taskItem")) c.sinkListItem("taskItem").run();
  else c.sinkListItem("listItem").run();
}

function liftItem(e: Editor): void {
  if (!e || e.isDestroyed) return;
  const c = e.chain().focus();
  if (e.can().liftListItem("taskItem")) c.liftListItem("taskItem").run();
  else c.liftListItem("listItem").run();
}

function clipboardCommand(e: Editor, cmd: "cut" | "copy"): void {
  e.commands.focus();
  document.execCommand(cmd);
}

async function pasteText(e: Editor): Promise<void> {
  const text = await navigator.clipboard?.readText?.().catch(() => "");
  if (text) e.chain().focus().insertContent(text).run();
}
