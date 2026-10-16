// Calc's Review tab (P8-26), as in Excel 365: Comments (New Comment,
// Delete, Previous/Next Comment, Show Comments) and Notes ▾ (New/Edit
// Note, Previous/Next Note, Show/Hide Note, Show All Notes, Convert to
// Comments); and Insert › Links (Link…, Ctrl+K).

import { RibbonButton, RibbonMenuButton, RibbonStack, type RibbonGroup, type RibbonTab, type TFunction as T } from "@rusuite/ui-shared";
import type { CalcStore } from "../state/store";
import { deleteCommentIcon, linkIcon, newCommentIcon, nextCommentIcon, noteIcon, prevCommentIcon, showCommentsIcon } from "./icons";

export function reviewTab(store: CalcStore, t: T, off: boolean): RibbonTab {
  const c = store.comments;
  const sheet = store.getState().activeSheet;
  const anchor = store.activeAnchor();
  const at = { sheet, ...anchor };
  const lists = c.of(sheet);
  const hasNote = !!c.note(at);
  const done = () => store.focusGrid();
  const run = (fn: () => unknown) => () => {
    void fn();
    done();
  };
  return {
    id: "review",
    label: t("calc.tab.review"),
    groups: [
      {
        label: t("calc.comments.group"),
        items: (
          <>
            <RibbonButton label={t("calc.comments.new")} icon={newCommentIcon()} size="large" shortcut="Mod+Shift+F2" disabled={off} onClick={() => c.newComment()} />
            <RibbonButton label={t("cmd.delete")} icon={deleteCommentIcon()} size="large" tooltip={t("calc.comments.deleteTip")} disabled={off || (lists.threads.length === 0 && lists.notes.length === 0)} onClick={run(() => c.deleteAny())} />
            <RibbonStack>
              <RibbonButton label={t("calc.comments.previous")} icon={prevCommentIcon(16)} showLabel disabled={off || lists.threads.length === 0} onClick={run(() => c.stepComment(-1))} />
              <RibbonButton label={t("calc.comments.next")} icon={nextCommentIcon(16)} showLabel disabled={off || lists.threads.length === 0} onClick={run(() => c.stepComment(1))} />
            </RibbonStack>
            <RibbonButton label={t("calc.comments.show")} icon={showCommentsIcon()} size="large" pressed={c.pane} disabled={off} onClick={() => c.togglePane()} />
          </>
        ),
      },
      {
        label: t("calc.notes.group"),
        items: (
          <RibbonMenuButton
            label={t("calc.notes.menu")}
            icon={noteIcon()}
            size="large"
            disabled={off}
            menu={[
              { id: "newNote", label: hasNote ? t("calc.notes.edit") : t("calc.notes.new"), shortcut: "Shift+F2", onSelect: () => c.editNote() },
              { id: "prevNote", label: t("calc.notes.previous"), disabled: lists.notes.length === 0, onSelect: run(() => c.stepNote(-1)) },
              { id: "nextNote", label: t("calc.notes.next"), disabled: lists.notes.length === 0, onSelect: run(() => c.stepNote(1)) },
              { id: "showHide", label: t("calc.notes.showHide"), disabled: !hasNote, onSelect: run(() => c.toggleNote()) },
              { id: "showAll", label: t("calc.notes.showAll"), checked: c.showAllNotes, onSelect: run(() => c.toggleAllNotes()) },
              { separator: true },
              { id: "convert", label: t("calc.notes.convert"), disabled: lists.notes.length === 0, onSelect: () => c.convertNotes() },
            ]}
          />
        ),
      },
    ],
  };
}

/** Insert › Links. */
export function linksInsertGroup(store: CalcStore, t: T, off: boolean): RibbonGroup {
  return {
    label: t("calc.link.group"),
    items: <RibbonButton label={t("calc.link.button")} icon={linkIcon()} size="large" shortcut="Mod+K" tooltip={t("calc.link.tip")} disabled={off} onClick={() => store.comments.openLinkDialog()} />,
  };
}
