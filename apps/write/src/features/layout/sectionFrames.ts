// Mixed page sizes in print layout (W-18): every sheet has its own
// section's width and height and is centred in a frame as wide as the
// widest page (Word). The editor stays one flow at the first section's text
// width; the blocks of a section with another width are moved and widened
// to that section's text column (see `sectionWidthPlugin`).

import type { PageSetup } from "../../generated/PageSetup";
import type { Section } from "../../generated/Section";
import { pageGeometry, type PageGeometry } from "../pagination";

export interface SectionFrame {
  geo: PageGeometry;
  /** The sheet's left edge in the frame (px). */
  x: number;
  /** The text column: its left edge in the frame and its width (px). */
  textLeft: number;
  textWidth: number;
  /** How far the section's text column is from the editor's (the first section's): moved by `dx`, `extra` wider. */
  dx: number;
  extra: number;
}

export interface Frames {
  /** The frame width: the widest page. */
  width: number;
  /** Whether the pages differ in width (the frame then draws each sheet on its own). */
  mixed: boolean;
  /** The editor's text column (the first section's): padding of the frame. */
  padLeft: number;
  padRight: number;
  sections: SectionFrame[];
  /** The sheet's left edge for a page of width `w`. */
  sheetX(w: number): number;
}

/** The frame of the print layout for `sections` (none: the document's page setup). */
export function sectionFrames(sections: Section[], page: PageSetup | null | undefined): Frames {
  const geos = (sections.length ? sections.map((s) => s.page ?? page) : [page]).map((p) => pageGeometry(p));
  const width = Math.max(...geos.map((g) => g.width));
  const sheetX = (w: number) => (width - w) / 2;
  const g0 = geos[0]!;
  const left0 = sheetX(g0.width) + g0.left;
  const w0 = g0.width - g0.left - g0.right;
  const frames = geos.map((geo) => {
    const x = sheetX(geo.width);
    const textLeft = x + geo.left;
    const textWidth = geo.width - geo.left - geo.right;
    return { geo, x, textLeft, textWidth, dx: textLeft - left0, extra: textWidth - w0 };
  });
  return {
    width,
    mixed: geos.some((g) => Math.abs(g.width - width) > 0.5),
    padLeft: left0,
    padRight: width - left0 - w0,
    sections: frames,
    sheetX,
  };
}

/** The CSS that moves a top-level block into its section's text column (null: already there). */
export function blockShiftCss(kind: "text" | "table" | "other", f: Pick<SectionFrame, "dx" | "extra">, indent: { left: number; right: number } = { left: 0, right: 0 }, align?: string | null): string | null {
  if (Math.abs(f.dx) < 0.01 && Math.abs(f.extra) < 0.01) return null;
  const px = (v: number) => `${v.toFixed(2)}px`;
  if (kind === "table") {
    // Tables keep their width: centred / right-aligned ones move with the column's centre / right edge.
    const shift = f.dx + (align === "center" ? f.extra / 2 : align === "right" ? f.extra : 0);
    return `position: relative; left: ${px(shift)}`;
  }
  return `margin-left: ${px(indent.left + f.dx)}; margin-right: ${px(indent.right - f.extra - f.dx)}`;
}
