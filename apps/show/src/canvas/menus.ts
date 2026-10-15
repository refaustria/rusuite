// Context menus of the slide editor (right-click on a shape / on the
// slide) and of the slide sorter, as data for ui-shared's `ContextMenu`
// (built from the store's state, so they are unit-testable).

import { formatCombo, type ContextMenuItem } from "@rusuite/ui-shared";
import type { LayoutKind } from "../generated/LayoutKind";
import type { NodeId } from "../generated/NodeId";
import type { ShowStore } from "../state/store";

export const LAYOUT_LABELS: { id: LayoutKind; label: string }[] = [
  { id: "title", label: "Title slide" },
  { id: "titleContent", label: "Title and content" },
  { id: "blank", label: "Blank" },
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
    { id: "cut", label: "Cut", shortcut: key("Mod+X"), disabled: none, onSelect: () => void store.cut() },
    { id: "copy", label: "Copy", shortcut: key("Mod+C"), disabled: none, onSelect: () => void store.copy() },
    { id: "paste", label: "Paste", shortcut: key("Mod+V"), disabled: st.clipboard === null, onSelect: () => void store.paste() },
    { id: "duplicate", label: "Duplicate", shortcut: key("Mod+D"), disabled: none, onSelect: () => void store.duplicateSelection() },
    { id: "delete", label: "Delete", shortcut: "Del", disabled: none, onSelect: () => void store.deleteSelection() },
    { separator: true },
    { id: "editText", label: "Edit text", shortcut: "F2", disabled: !canEditText, onSelect: () => one && store.startEdit(one.id) },
    { separator: true },
    { id: "bringToFront", label: "Bring to front", shortcut: key("Mod+Shift+]"), disabled: none, onSelect: () => void store.zOrder("bringToFront") },
    { id: "bringForward", label: "Bring forward", shortcut: key("Mod+]"), disabled: none, onSelect: () => void store.zOrder("bringForward") },
    { id: "sendBackward", label: "Send backward", shortcut: key("Mod+["), disabled: none, onSelect: () => void store.zOrder("sendBackward") },
    { id: "sendToBack", label: "Send to back", shortcut: key("Mod+Shift+["), disabled: none, onSelect: () => void store.zOrder("sendToBack") },
    { separator: true },
    { id: "group", label: "Group", shortcut: key("Mod+G"), disabled: sel.length < 2, onSelect: () => void store.group() },
    { id: "ungroup", label: "Ungroup", shortcut: key("Mod+Shift+G"), disabled: !sel.some((s) => s.kind.kind === "group"), onSelect: () => void store.ungroup() },
    { separator: true },
  ];
  if (picture) {
    items.push(
      { id: "replacePicture", label: "Change picture…", onSelect: () => store.openDialog({ kind: "replacePicture", shape: one.id }) },
      { id: "resetSize", label: "Reset picture size", onSelect: () => void store.resetPictureSize() },
    );
  }
  items.push(
    { id: "alt", label: "Edit alt text…", disabled: !one, onSelect: () => one && store.openDialog({ kind: "alt", shape: one.id }) },
    { id: "format", label: "Format shape…", disabled: none, onSelect: () => store.openDialog({ kind: "format" }) },
  );
  return items;
}

/** Right-click on an empty part of the slide. */
export function slideMenu(store: ShowStore): ContextMenuItem[] {
  const st = store.getState();
  const slide = store.currentSlide();
  return [
    { id: "paste", label: "Paste", shortcut: key("Mod+V"), disabled: st.clipboard === null, onSelect: () => void store.paste() },
    { separator: true },
    ...LAYOUT_LABELS.map((l) => ({
      id: `layout-${l.id}`,
      label: `Layout: ${l.label}${slide?.layout === l.id ? " ✓" : ""}`,
      disabled: !slide,
      onSelect: () => void store.setSlideLayout(l.id),
    })),
    { separator: true },
    { id: "hide", label: slide?.hidden ? "Show slide" : "Hide slide", disabled: !slide, onSelect: () => void store.toggleHidden() },
    { id: "notes", label: st.notesVisible ? "Hide notes" : "Show notes", onSelect: () => store.toggleNotes() },
  ];
}

/** Right-click on a slide thumbnail. */
export function thumbnailMenu(store: ShowStore, id: NodeId): ContextMenuItem[] {
  const st = store.getState();
  const slide = st.pres?.slides.find((s) => s.id === id);
  const count = st.pres?.slides.length ?? 0;
  return [
    { id: "newSlide", label: "New slide", onSelect: () => void store.addSlide("titleContent") },
    { id: "duplicateSlide", label: "Duplicate slide", onSelect: () => void store.duplicateSlide(id) },
    { id: "deleteSlide", label: "Delete slide", disabled: count <= 1, onSelect: () => void store.deleteSlides([id]) },
    { separator: true },
    { id: "copySlide", label: "Copy", shortcut: key("Mod+C"), onSelect: () => store.copySlides([id]) },
    { id: "pasteSlide", label: "Paste", shortcut: key("Mod+V"), disabled: st.clipboard === null, onSelect: () => void store.paste() },
    { separator: true },
    ...LAYOUT_LABELS.map((l) => ({
      id: `layout-${l.id}`,
      label: `Layout: ${l.label}${slide?.layout === l.id ? " ✓" : ""}`,
      onSelect: () => void store.setSlideLayout(l.id, [id]),
    })),
    { separator: true },
    { id: "hide", label: slide?.hidden ? "Show slide" : "Hide slide", onSelect: () => void store.toggleHidden([id]) },
  ];
}
