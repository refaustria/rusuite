// Display names of layouts: the presentation's own name when it has one
// (e.g. LibreOffice's), else the standard layout's label, else the custom
// layout's name.

import type { Layout } from "../generated/Layout";
import type { LayoutKind } from "../generated/LayoutKind";
import { t } from "../i18n";

/** The eleven standard layouts in PowerPoint's gallery order. */
export const STANDARD_LAYOUTS: LayoutKind[] = [
  "title", "titleContent", "sectionHeader", "twoContent", "comparison", "titleOnly", "blank",
  "contentWithCaption", "pictureWithCaption", "verticalText", "verticalTitleText",
];

/** The label of a layout kind. */
export function layoutKindLabel(kind: LayoutKind): string {
  if (kind.startsWith("custom:")) return kind.slice(7);
  return t(`show.layout.${kind}`);
}

/** The name a layout is shown with. */
export function layoutName(layout: Pick<Layout, "kind" | "name">): string {
  return layout.name || layoutKindLabel(layout.kind);
}
