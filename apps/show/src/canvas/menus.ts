// Context menus of the slide editor (right-click on a shape / on the
// slide) and of the slide sorter, as data for ui-shared's `ContextMenu`
// (built from the store's state, so they are unit-testable).

import { formatCombo, withLabel, type ContextMenuItem } from "@rusuite/ui-shared";
import { t } from "../i18n";
import type { LayoutKind } from "../generated/LayoutKind";
import type { NodeId } from "../generated/NodeId";
import type { ShowStore } from "../state/store";
import { singleCell, splitCommand } from "../shapes/tables";
import { layoutName } from "../design/layouts";

export const LAYOUT_LABELS: { id: LayoutKind; readonly label: string }[] = [
  withLabel({ id: "title" as LayoutKind }, "show.layout.title"),
  withLabel({ id: "titleContent" as LayoutKind }, "show.layout.titleContent"),
  withLabel({ id: "blank" as LayoutKind }, "show.layout.blank"),
];

/** The presentation's layouts with their display names (the three basic ones before a presentation is loaded). */
export function layoutEntries(store: ShowStore): { id: LayoutKind; label: string }[] {
  const layouts = store.getState().pres?.layouts;
  return layouts?.length ? layouts.map((l) => ({ id: l.kind, label: layoutName(l) })) : LAYOUT_LABELS;
}

/** Right-click in the Slide Master view (stage and panel). */
export function masterMenu(store: ShowStore): ContextMenuItem[] {
  const mv = store.getState().masterView;
  const layout = mv?.kind === "layout" ? mv.value : null;
  return [
    { id: "insertLayout", label: t("show.master.insertLayout"), onSelect: () => void store.addLayout() },
    { id: "duplicateLayout", label: t("show.master.duplicateLayout"), disabled: layout === null, onSelect: () => void store.duplicateLayout() },
    { id: "deleteLayout", label: t("show.master.deleteLayout"), disabled: layout === null || store.layoutInUse(layout), onSelect: () => void store.deleteLayout() },
    { id: "renameLayout", label: t("show.master.renameDots"), disabled: layout === null, onSelect: () => layout !== null && store.openDialog({ kind: "renameLayout", layout }) },
    { separator: true },
    { id: "formatBackground", label: t("show.bg.formatDots"), onSelect: () => store.toggleBgPane(true) },
    { separator: true },
    { id: "closeMaster", label: t("show.master.close"), onSelect: () => store.closeMasterView() },
  ];
}

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
    { id: "editPoints", label: t("show.editPoints"), disabled: !one || one.kind.kind !== "auto", onSelect: () => store.setEditPoints(true) },
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
    { id: "sizePosition", label: t("show.sizePositionDots"), disabled: none, onSelect: () => store.openFormatPane("size") },
  );
  if (sel.some((s) => s.kind.kind === "auto")) {
    items.push({ id: "textOptions", label: t("show.textOptionsDots"), onSelect: () => store.openFormatPane("text") });
  }
  return items;
}

/** Right-click on an empty part of the slide. */
export function slideMenu(store: ShowStore): ContextMenuItem[] {
  const st = store.getState();
  const slide = store.currentSlide();
  return [
    { id: "paste", label: t("cmd.paste"), shortcut: key("Mod+V"), disabled: st.clipboard === null, onSelect: () => void store.paste() },
    { separator: true },
    ...layoutEntries(store).map((l) => ({
      id: `layout-${l.id}`,
      label: `${t("show.layoutPrefix", { layout: l.label })}${slide?.layout === l.id ? " ✓" : ""}`,
      disabled: !slide,
      onSelect: () => void store.setSlideLayout(l.id),
    })),
    { id: "resetSlide", label: t("show.resetSlide"), disabled: !slide, onSelect: () => void store.resetSlide() },
    { id: "formatBackground", label: t("show.bg.formatDots"), disabled: !slide, onSelect: () => store.toggleBgPane(true) },
    { separator: true },
    { id: "hide", label: slide?.hidden ? t("show.showSlide") : t("show.hideSlide"), disabled: !slide, onSelect: () => void store.toggleHidden() },
    { id: "notes", label: st.notesVisible ? t("show.hideNotes") : t("show.showNotes"), onSelect: () => store.toggleNotes() },
    { separator: true },
    ...gridGuideItems(store),
  ];
}

/** Grid and Guides entries of the slide menu (P8-28). */
export function gridGuideItems(store: ShowStore): ContextMenuItem[] {
  const v = store.viewProps();
  const on = (b: boolean, label: string) => `${label}${b ? " ✓" : ""}`;
  return [
    { id: "guides", label: on(v.showGuides, t("show.view.guides")), shortcut: key("Alt+F9"), onSelect: () => void store.toggleGuides() },
    { id: "gridlines", label: on(v.showGrid, t("show.view.gridlines")), shortcut: key("Shift+F9"), onSelect: () => void store.toggleGrid() },
    { id: "smartGuides", label: on(v.snapToShapes, t("show.view.smartGuides")), onSelect: () => void store.updateView({ snapToShapes: !v.snapToShapes }) },
    { id: "addVGuide", label: t("show.guide.addVertical"), onSelect: () => void store.addGuide("vertical") },
    { id: "addHGuide", label: t("show.guide.addHorizontal"), onSelect: () => void store.addGuide("horizontal") },
    { id: "gridGuidesDialog", label: t("show.view.gridGuidesDots"), onSelect: () => store.openDialog({ kind: "gridGuides" }) },
  ];
}

/** Guide colours of the guide menu. */
export const GUIDE_COLORS: { color: string | null; readonly label: string }[] = [
  withLabel({ color: null }, "show.guide.color.default"),
  withLabel({ color: "E3242B" }, "show.guide.color.red"),
  withLabel({ color: "F28C28" }, "show.guide.color.orange"),
  withLabel({ color: "2E8B57" }, "show.guide.color.green"),
  withLabel({ color: "1E6FD9" }, "show.guide.color.blue"),
];

/** Right-click on drawing guide `index`: add guides, delete it, its colour. */
export function guideMenu(store: ShowStore, index: number): ContextMenuItem[] {
  const g = store.viewProps().guides[index];
  return [
    { id: "addVGuide", label: t("show.guide.addVertical"), onSelect: () => void store.addGuide("vertical") },
    { id: "addHGuide", label: t("show.guide.addHorizontal"), onSelect: () => void store.addGuide("horizontal") },
    { id: "deleteGuide", label: t("show.guide.delete"), disabled: !g, onSelect: () => void store.deleteGuide(index) },
    { separator: true },
    ...GUIDE_COLORS.map((c) => ({
      id: `guideColor-${c.color ?? "default"}`,
      label: `${t("show.guide.colorPrefix", { color: c.label })}${(g?.color ?? null) === c.color ? " ✓" : ""}`,
      disabled: !g,
      onSelect: () => void store.setGuideColor(index, c.color),
    })),
  ];
}

/** Right-click on a slide thumbnail. */
export function thumbnailMenu(store: ShowStore, id: NodeId): ContextMenuItem[] {
  const st = store.getState();
  const slide = st.pres?.slides.find((s) => s.id === id);
  const count = st.pres?.slides.length ?? 0;
  // the sorter's multi-selection when the clicked slide is part of it
  const ids = st.slideSel.includes(id) ? store.selectedSlides() : [id];
  return [
    { id: "newSlide", label: t("show.newSlide"), onSelect: () => void store.addSlide("titleContent") },
    { id: "duplicateSlide", label: t("show.duplicateSlide"), onSelect: () => void store.duplicateSlides(ids) },
    { id: "deleteSlide", label: t("show.deleteSlide"), disabled: count <= ids.length, onSelect: () => void store.deleteSlides(ids) },
    { separator: true },
    { id: "copySlide", label: t("cmd.copy"), shortcut: key("Mod+C"), onSelect: () => store.copySlides(ids) },
    { id: "pasteSlide", label: t("cmd.paste"), shortcut: key("Mod+V"), disabled: st.clipboard === null, onSelect: () => void store.paste() },
    { separator: true },
    ...layoutEntries(store).map((l) => ({
      id: `layout-${l.id}`,
      label: `${t("show.layoutPrefix", { layout: l.label })}${slide?.layout === l.id ? " ✓" : ""}`,
      onSelect: () => void store.setSlideLayout(l.id, [id]),
    })),
    { separator: true },
    { id: "addSection", label: t("show.section.add"), onSelect: () => void store.addSection() },
    { separator: true },
    { id: "hide", label: slide?.hidden ? t("show.showSlide") : t("show.hideSlide"), onSelect: () => void store.toggleHidden(ids) },
  ];
}

/** Right-click inside a selected table: the Layout tab's row, column and cell commands. */
export function tableMenu(store: ShowStore): ContextMenuItem[] {
  const table = store.selectedTable();
  const range = store.cellRange();
  const multi = !!table && !!range && !singleCell(table.table, range);
  const merged = !!table && !!range && splitCommand(table.shape.id, table.table, range.r0, range.c0) !== null;
  const tr = t;
  return [
    { id: "insertAbove", label: tr("show.table.insertAbove"), disabled: !table, onSelect: () => void store.insertRows(false) },
    { id: "insertBelow", label: tr("show.table.insertBelow"), disabled: !table, onSelect: () => void store.insertRows(true) },
    { id: "insertLeft", label: tr("show.table.insertLeft"), disabled: !table, onSelect: () => void store.insertCols(false) },
    { id: "insertRight", label: tr("show.table.insertRight"), disabled: !table, onSelect: () => void store.insertCols(true) },
    { separator: true },
    { id: "deleteRows", label: tr("show.table.deleteRows"), disabled: !table, onSelect: () => void store.deleteRows() },
    { id: "deleteCols", label: tr("show.table.deleteCols"), disabled: !table, onSelect: () => void store.deleteCols() },
    { id: "deleteTable", label: tr("show.table.deleteTable"), disabled: !table, onSelect: () => void store.deleteTable() },
    { separator: true },
    { id: "merge", label: tr("show.table.merge"), disabled: !multi, onSelect: () => void store.mergeCells() },
    { id: "split", label: tr("show.table.split"), disabled: !merged, onSelect: () => void store.splitCell() },
    { id: "splitGrid", label: tr("show.table.splitDots"), disabled: !range, onSelect: () => store.openDialog({ kind: "splitCells" }) },
    { separator: true },
    { id: "format", label: tr("show.formatShapeDots"), disabled: !table, onSelect: () => store.openDialog({ kind: "format" }) },
  ];
}
