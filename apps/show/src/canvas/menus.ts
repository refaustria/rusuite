// Context menus of the slide editor (right-click on a shape / on the
// slide) and of the slide sorter, as data for ui-shared's `ContextMenu`
// (built from the store's state, so they are unit-testable).

import { formatCombo, withLabel, type ContextMenuItem } from "@rusuite/ui-shared";
import { t } from "../i18n";
import type { LayoutKind } from "../generated/LayoutKind";
import type { NodeId } from "../generated/NodeId";
import type { ShowStore } from "../state/store";

export const LAYOUT_LABELS: { id: LayoutKind; readonly label: string }[] = [
  withLabel({ id: "title" as LayoutKind }, "show.layout.title"),
  withLabel({ id: "titleContent" as LayoutKind }, "show.layout.titleContent"),
  withLabel({ id: "blank" as LayoutKind }, "show.layout.blank"),
];

const key = (spec: string) => formatCombo(spec);

/** Right-click on shapes (the selection). */
export function shapeMenu(store: ShowStore): ContextMenuItem[] {
  const st = store.getState();
  const sel = store.selectedShapes();
  const one = sel.length === 1 ? sel[0]! : null;
  const none = sel.length === 0;
  const canEditText = !!one && one.kind.kind === "auto" && one.kind.value.geometry !== "line";
  const picture = !!one && one.kind.kind === "picture";
  const items: ContextMenuItem[] = [
    { id: "cut", label: t("cmd.cut"), shortcut: key("Mod+X"), disabled: none, onSelect: () => void store.cut() },
    { id: "copy", label: t("cmd.copy"), shortcut: key("Mod+C"), disabled: none, onSelect: () => void store.copy() },
    { id: "paste", label: t("cmd.paste"), shortcut: key("Mod+V"), disabled: st.clipboard === null, onSelect: () => void store.paste() },
    { id: "duplicate", label: t("show.duplicate"), shortcut: key("Mod+D"), disabled: none, onSelect: () => void store.duplicateSelection() },
    { id: "delete", label: t("cmd.delete"), shortcut: "Del", disabled: none, onSelect: () => void store.deleteSelection() },
    { separator: true },
    { id: "editText", label: t("show.editText"), shortcut: "F2", disabled: !canEditText, onSelect: () => one && store.startEdit(one.id) },
    { separator: true },
    { id: "bringToFront", label: t("show.order.bringToFront"), shortcut: key("Mod+Shift+]"), disabled: none, onSelect: () => void store.zOrder("bringToFront") },
    { id: "bringForward", label: t("show.order.bringForward"), shortcut: key("Mod+]"), disabled: none, onSelect: () => void store.zOrder("bringForward") },
    { id: "sendBackward", label: t("show.order.sendBackward"), shortcut: key("Mod+["), disabled: none, onSelect: () => void store.zOrder("sendBackward") },
    { id: "sendToBack", label: t("show.order.sendToBack"), shortcut: key("Mod+Shift+["), disabled: none, onSelect: () => void store.zOrder("sendToBack") },
    { separator: true },
    { id: "group", label: t("show.group"), shortcut: key("Mod+G"), disabled: sel.length < 2, onSelect: () => void store.group() },
    { id: "ungroup", label: t("show.ungroup"), shortcut: key("Mod+Shift+G"), disabled: !sel.some((s) => s.kind.kind === "group"), onSelect: () => void store.ungroup() },
    { separator: true },
  ];
  if (picture) {
    items.push(
      { id: "replacePicture", label: t("show.changePictureDots"), onSelect: () => store.openDialog({ kind: "replacePicture", shape: one.id }) },
      { id: "resetSize", label: t("show.resetPictureSize"), onSelect: () => void store.resetPictureSize() },
    );
  }
  items.push(
    { id: "alt", label: t("show.editAltDots"), disabled: !one, onSelect: () => one && store.openDialog({ kind: "alt", shape: one.id }) },
    { id: "format", label: t("show.formatShapeDots"), disabled: none, onSelect: () => store.openDialog({ kind: "format" }) },
  );
  return items;
}

/** Right-click on an empty part of the slide. */
export function slideMenu(store: ShowStore): ContextMenuItem[] {
  const st = store.getState();
  const slide = store.currentSlide();
  return [
    { id: "paste", label: t("cmd.paste"), shortcut: key("Mod+V"), disabled: st.clipboard === null, onSelect: () => void store.paste() },
    { separator: true },
    ...LAYOUT_LABELS.map((l) => ({
      id: `layout-${l.id}`,
      label: `${t("show.layoutPrefix", { layout: l.label })}${slide?.layout === l.id ? " ✓" : ""}`,
      disabled: !slide,
      onSelect: () => void store.setSlideLayout(l.id),
    })),
    { separator: true },
    { id: "hide", label: slide?.hidden ? t("show.showSlide") : t("show.hideSlide"), disabled: !slide, onSelect: () => void store.toggleHidden() },
    { id: "notes", label: st.notesVisible ? t("show.hideNotes") : t("show.showNotes"), onSelect: () => store.toggleNotes() },
  ];
}

/** Right-click on a slide thumbnail. */
export function thumbnailMenu(store: ShowStore, id: NodeId): ContextMenuItem[] {
  const st = store.getState();
  const slide = st.pres?.slides.find((s) => s.id === id);
  const count = st.pres?.slides.length ?? 0;
  return [
    { id: "newSlide", label: t("show.newSlide"), onSelect: () => void store.addSlide("titleContent") },
    { id: "duplicateSlide", label: t("show.duplicateSlide"), onSelect: () => void store.duplicateSlide(id) },
    { id: "deleteSlide", label: t("show.deleteSlide"), disabled: count <= 1, onSelect: () => void store.deleteSlides([id]) },
    { separator: true },
    { id: "copySlide", label: t("cmd.copy"), shortcut: key("Mod+C"), onSelect: () => store.copySlides([id]) },
    { id: "pasteSlide", label: t("cmd.paste"), shortcut: key("Mod+V"), disabled: st.clipboard === null, onSelect: () => void store.paste() },
    { separator: true },
    ...LAYOUT_LABELS.map((l) => ({
      id: `layout-${l.id}`,
      label: `${t("show.layoutPrefix", { layout: l.label })}${slide?.layout === l.id ? " ✓" : ""}`,
      onSelect: () => void store.setSlideLayout(l.id, [id]),
    })),
    { separator: true },
    { id: "hide", label: slide?.hidden ? t("show.showSlide") : t("show.hideSlide"), onSelect: () => void store.toggleHidden([id]) },
  ];
}
