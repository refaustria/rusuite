// The ruler's drag math (P9-W5): Word's indent markers (first-line
// triangle on top, hanging triangle and left-indent box at the bottom,
// right-indent triangle), the table column markers and the scale in cm or
// inches. Pure functions on twips; `ui/Ruler.tsx` wires the pointer events,
// a live preview of the paragraph while dragging and one command on release.

import type { Indent } from "../generated/Indent";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { TWIPS_PER_PX } from "../sync/schema";
import { TWIPS_PER_UNIT, type RulerUnit } from "./writeOptions";

export type IndentMarker = "firstLine" | "hanging" | "left" | "right";

/** Normalized indents: left, right and the first line relative to the left indent (negative = hanging). */
export interface Indents {
  left: number;
  right: number;
  first: number;
}

export const indentsOf = (i: Indent | null | undefined): Indents => ({
  left: i?.left ?? 0,
  right: i?.right ?? 0,
  first: i?.firstLine != null && i.firstLine !== 0 ? i.firstLine : -(i?.hanging ?? 0),
});

/** The model's indent for `v` (first line or hanging, never both). */
export const indentFrom = (v: Indents): Indent => ({
  left: v.left,
  right: v.right,
  firstLine: v.first > 0 ? v.first : null,
  hanging: v.first < 0 ? -v.first : null,
});

/** Ruler positions (twips from the column's left edge) of the markers. */
export function markerPositions(v: Indents, width: number): Record<IndentMarker, number> {
  return { firstLine: v.left + v.first, hanging: v.left, left: v.left, right: width - v.right };
}

/** Least text width Word keeps between the indents. */
export const MIN_TEXT = 360;

/**
 * The indents after dragging `marker` from the indents `start` to ruler position `x` (twips from the column's left
 * edge, already snapped) in a column `width` twips wide, as in Word: the first-line triangle moves only the first
 * line; the hanging triangle moves the left indent of the other lines while the first line stays; the box moves
 * both; the right triangle moves the right indent. The text keeps at least `MIN_TEXT` between the indents.
 */
export function dragIndent(start: Indents, marker: IndentMarker, x: number, width: number): Indents {
  const v = { ...start };
  const maxLeft = width - v.right - MIN_TEXT;
  switch (marker) {
    case "firstLine": {
      const abs = Math.min(Math.max(x, -v.left - 1440 * 10), maxLeft);
      v.first = abs - v.left;
      break;
    }
    case "hanging": {
      const firstAbs = v.left + v.first;
      v.left = Math.min(x, maxLeft);
      v.first = firstAbs - v.left;
      break;
    }
    case "left":
      v.left = Math.min(x, maxLeft - Math.max(0, v.first));
      break;
    case "right":
      v.right = Math.min(width - x, width - Math.max(v.left, v.left + v.first) - MIN_TEXT);
      break;
  }
  return v;
}

/** Snap to the ruler grid of a unit: 1/8 inch or 0.25 cm (Word without Alt). */
export function snapTo(unit: RulerUnit, tw: number): number {
  const step = unit === "in" ? 180 : TWIPS_PER_UNIT.cm / 4;
  return Math.round(Math.round(tw / step) * step);
}

/** The ruler's ticks over `width` px: positions (px), kind (number / half / minor) and the label of numbered ticks. */
export function rulerTicks(width: number, unit: RulerUnit): { x: number; kind: "major" | "half" | "minor"; label?: number }[] {
  const pxPerUnit = TWIPS_PER_UNIT[unit] / TWIPS_PER_PX;
  const sub = unit === "in" ? 8 : 4;
  const out: { x: number; kind: "major" | "half" | "minor"; label?: number }[] = [];
  const n = Math.floor((width / pxPerUnit) * sub + 1e-6);
  for (let i = 0; i <= n; i++) {
    const x = (i * pxPerUnit) / sub;
    if (i % sub === 0) out.push(i === 0 ? { x, kind: "major" } : { x, kind: "major", label: i / sub });
    else out.push({ x, kind: i % (sub / 2) === 0 ? "half" : "minor" });
  }
  return out;
}

/** A position (twips) as the ruler's tooltips show it: "2.5 cm" / "1.25"". */
export function formatLength(tw: number, unit: RulerUnit): string {
  const v = Math.round((tw / TWIPS_PER_UNIT[unit]) * 100) / 100;
  return unit === "in" ? `${v}"` : `${v} cm`;
}

/** Table column boundaries on the ruler (twips from the table's left edge): the right edge of every grid column. */
export function columnMarkers(widths: number[]): number[] {
  const out: number[] = [];
  let x = 0;
  for (const w of widths) out.push((x += w));
  return out;
}

// ----- live preview ---------------------------------------------------------------------

export const rulerPreviewKey = new PluginKey<DecorationSet>("rusuiteRulerPreview");

interface Preview {
  ids: number[];
  indent: Indents;
}

/** While a marker is dragged: the paragraphs `ids` shown with `indent` (one command follows on release). */
export function rulerPreviewPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: rulerPreviewKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, old, _o, state) {
        const meta = tr.getMeta(rulerPreviewKey) as Preview | null | undefined;
        if (meta === undefined) return old.map(tr.mapping, tr.doc);
        if (meta === null) return DecorationSet.empty;
        const px = (tw: number) => `${(tw / TWIPS_PER_PX).toFixed(1)}px`;
        const style = `margin-left: ${px(meta.indent.left)}; margin-right: ${px(meta.indent.right)}; text-indent: ${px(meta.indent.first)}`;
        const ids = new Set(meta.ids);
        const decos: Decoration[] = [];
        state.doc.descendants((n, pos) => {
          if (n.isTextblock && ids.has(n.attrs.id as number)) decos.push(Decoration.node(pos, pos + n.nodeSize, { style, "data-ruler-preview": "" }));
          return !n.isTextblock;
        });
        return DecorationSet.create(state.doc, decos);
      },
    },
    props: { decorations: (state) => rulerPreviewKey.getState(state) },
  });
}

export function setRulerPreview(view: EditorView, preview: Preview | null): void {
  view.dispatch(view.state.tr.setMeta(rulerPreviewKey, preview).setMeta("addToHistory", false));
}
