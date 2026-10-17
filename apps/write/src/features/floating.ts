// Floating pictures (Word's "Wrap Text" / "Position" / Layout Options):
// the `Anchor` of an image built like Rust's `Anchor::new`, the nine
// position presets, moving by drag, and the CSS placement the image node
// view and the print layout use. Text flows around Square / Tight
// (a CSS float, one side) and Top and Bottom (a block on its own lines);
// Behind / In Front of Text are positioned outside the flow (relative to
// the anchor paragraph). Positions relative to the margin or the page
// resolve horizontally against the page and vertically against the
// anchor paragraph's page in print layout (P8-31; draft view: at the
// paragraph); offsets from the paragraph or line are honoured.

import type { EditorView } from "@tiptap/pm/view";
import type { Anchor } from "../generated/Anchor";
import type { HAlign } from "../generated/HAlign";
import type { VAlignPos } from "../generated/VAlignPos";
import type { WrapKind } from "../generated/WrapKind";

/** EMU per CSS pixel (96 dpi). */
const EMU_PER_PX = 9525;

/** Wrap Text choices: inline with the text, or one of the floating kinds. */
export type WrapChoice = "inline" | WrapKind;
export const WRAP_CHOICES: WrapChoice[] = ["inline", "square", "tight", "through", "topAndBottom", "behind", "inFront"];

/** Wrapping kinds whose text flows around the sides (Square, Tight and Through: the bounding box). */
export const SIDE_WRAPS: readonly WrapKind[] = ["square", "tight", "through"];

/** The narrowest text area (px) Word fills beside a picture on both sides. */
export const MIN_SIDE_GAP = 72;

/** Rust's `Anchor::new(wrap)`: offset 0 from the column and the paragraph, Word's distances for square/tight. */
export function newAnchor(wrap: WrapKind): Anchor {
  const side = SIDE_WRAPS.includes(wrap);
  return {
    h: { relativeTo: "column", place: { kind: "offset", value: 0 } },
    v: { relativeTo: "paragraph", place: { kind: "offset", value: 0 } },
    wrap,
    distance: { top: 0, bottom: 0, left: side ? 114300 : 0, right: side ? 114300 : 0 },
    allowOverlap: true,
  };
}

export const wrapOf = (anchor: Anchor | null | undefined): WrapChoice => anchor?.wrap ?? "inline";

/** `SetImageWrap` (inline → `null`): an existing anchor keeps its position. */
export function withWrap(anchor: Anchor | null | undefined, wrap: WrapChoice): Anchor | null {
  if (wrap === "inline") return null;
  return anchor ? { ...anchor, wrap } : newAnchor(wrap);
}

export type VPreset = "top" | "middle" | "bottom";
export type HPreset = "left" | "center" | "right";
export type PositionPreset = `${VPreset}-${HPreset}`;
export const POSITION_PRESETS: PositionPreset[] = (["top", "middle", "bottom"] as const).flatMap((v) =>
  (["left", "center", "right"] as const).map((h) => `${v}-${h}` as PositionPreset),
);

const V_ALIGN: Record<VPreset, VAlignPos> = { top: "top", middle: "center", bottom: "bottom" };

/** Word's Position ▾ presets: aligned to the margin, square wrapping ("With Text Wrapping"). */
export function presetAnchor(anchor: Anchor | null | undefined, preset: PositionPreset): Anchor {
  const [v, h] = preset.split("-") as [VPreset, HPreset];
  const base = anchor && anchor.wrap !== "behind" && anchor.wrap !== "inFront" ? anchor : newAnchor("square");
  return {
    ...base,
    wrap: base.wrap,
    h: { relativeTo: "margin", place: { kind: "align", value: h as HAlign } },
    v: { relativeTo: "margin", place: { kind: "align", value: V_ALIGN[v] } },
  };
}

/** The preset an anchor matches, or null. */
export function presetOf(anchor: Anchor | null | undefined): PositionPreset | null {
  if (!anchor || anchor.h.relativeTo !== "margin" || anchor.v.relativeTo !== "margin") return null;
  if (anchor.h.place.kind !== "align" || anchor.v.place.kind !== "align") return null;
  const v = (Object.keys(V_ALIGN) as VPreset[]).find((k) => V_ALIGN[k] === anchor.v.place.value);
  return v ? (`${v}-${anchor.h.place.value}` as PositionPreset) : null;
}

/**
 * The anchor after dragging the picture from its rendered position
 * (`x`, `y` px from the column's left edge and the paragraph's top) by
 * (`dx`, `dy`) px: offsets from the column and the paragraph, like Word
 * after a manual move.
 */
export function movedAnchor(anchor: Anchor, x: number, y: number, dx: number, dy: number): Anchor {
  return {
    ...anchor,
    h: { relativeTo: "column", place: { kind: "offset", value: Math.round((x + dx) * EMU_PER_PX) } },
    v: { relativeTo: "paragraph", place: { kind: "offset", value: Math.round((y + dy) * EMU_PER_PX) } },
  };
}

/** What the placement depends on besides the anchor (CSS px). */
export interface FloatContext {
  /** Picture size. */
  width: number;
  height: number;
  /** Left / right indent of the anchor paragraph. */
  indentLeft: number;
  indentRight: number;
  /** Width of the text column (null = unknown: offsets float left). */
  columnWidth: number | null;
  /** Page width and left margin (page-relative positions); null = treat the page like the column. */
  page: { width: number; marginLeft: number } | null;
  /** The anchor paragraph's page (vertical page / margin positions; print layout only). */
  vpage?: VerticalPage | null;
  /** The top of the line holding the anchor (px from the paragraph's top; `line`-relative positions). */
  lineTop?: number;
}

/** CSS placement of a floating picture inside its paragraph. */
export interface FloatPlacement {
  /**
   * `float-left` / `float-right` (square, tight, through: text on one side), `both` (out of the flow; text on both
   * sides through the per-line exclusions of `wrapBoth.ts`), `block` (top and bottom), `behind` / `front` (out of
   * the flow).
   */
  mode: "float-left" | "float-right" | "both" | "block" | "behind" | "front";
  /** CSS declarations for the picture's wrapper. */
  css: Record<string, string>;
}

const px = (n: number) => `${Math.round(n * 100) / 100}px`;

/**
 * The horizontal position of the picture's left edge from the column's
 * left edge: a number (px), or a CSS `calc()` over the paragraph width
 * (`100%`) for alignments.
 */
export function horizontalPos(anchor: Anchor, ctx: FloatContext): { value: number | null; css: string } {
  const ind = ctx.indentLeft + ctx.indentRight;
  const rel = anchor.h.relativeTo;
  const place = anchor.h.place;
  const page = ctx.page;
  // The reference span (px from the column's left edge) when it is known.
  const col = ctx.columnWidth ?? (page ? null : null);
  const span = ((): [number, number] | null => {
    if (rel === "page") return page ? [-page.marginLeft, page.width - page.marginLeft] : null;
    if (rel === "leftMargin" || rel === "insideMargin") return page ? [-page.marginLeft, 0] : null;
    if (rel === "rightMargin" || rel === "outsideMargin") return page && col != null ? [col, page.width - page.marginLeft] : null;
    return col != null ? [0, col] : null;
  })();
  if (place.kind === "offset") {
    const start = span && rel !== "margin" && rel !== "column" && rel !== "character" ? span[0] : 0;
    const v = place.value / EMU_PER_PX + start;
    return { value: v, css: px(v) };
  }
  if (place.kind === "percent") {
    const v = span ? span[0] + (place.value / 100000) * (span[1] - span[0]) : 0;
    return { value: v, css: px(v) };
  }
  if (span && rel !== "margin" && rel !== "column" && rel !== "character") {
    const v = place.value === "left" ? span[0] : place.value === "right" ? span[1] - ctx.width : (span[0] + span[1] - ctx.width) / 2;
    return { value: v, css: px(v) };
  }
  if (place.value === "left") return { value: 0, css: "0px" };
  if (place.value === "right") return { value: null, css: `calc(100% + ${px(ind)} - ${px(ctx.width)})` };
  return { value: null, css: `calc((100% + ${px(ind)} - ${px(ctx.width)}) / 2)` };
}

/** The anchor paragraph on its page (print layout, px): the paragraph's top from the sheet top, the sheet height, the body box. */
export interface VerticalPage {
  paraTop: number;
  height: number;
  bodyTop: number;
  bodyBottom: number;
}

/**
 * Vertical offset from the paragraph's top (px): offsets from the paragraph
 * or line; positions relative to the page or the margin are resolved
 * against the anchor paragraph's page in print layout (P8-31), else 0.
 */
export function verticalPos(anchor: Anchor, page: VerticalPage | null = null, height = 0, lineTop = 0): number {
  const place = anchor.v.place;
  const rel = anchor.v.relativeTo;
  const offset = place.kind === "offset" ? place.value / EMU_PER_PX : 0;
  if (rel === "paragraph") return offset;
  if (rel === "line") {
    // Offsets from the line's top; aligned: top/centre/bottom of the line (Word: top = the line's top).
    return lineTop + offset;
  }
  if (!page) return 0;
  const [top, bottom] =
    rel === "page"
      ? [0, page.height]
      : rel === "topMargin" || rel === "insideMargin"
        ? [0, page.bodyTop]
        : rel === "bottomMargin" || rel === "outsideMargin"
          ? [page.bodyBottom, page.height]
          : [page.bodyTop, page.bodyBottom];
  const y =
    place.kind === "offset"
      ? top + offset
      : place.kind === "percent"
        ? top + (place.value / 100000) * (bottom - top)
        : place.value === "top"
          ? top
          : place.value === "bottom"
            ? bottom - height
            : (top + bottom - height) / 2;
  return y - page.paraTop;
}

/**
 * CSS `z-index` of a floating object out of the flow: its z-order
 * (`relativeHeight`, Bring Forward / Send Backward) among the objects in
 * front of the text (above 3) or behind it (negative, under the text).
 */
export function zIndex(anchor: Anchor): string {
  // Word's values start at 251658240 (its first object); others (LibreOffice) at 0.
  const z = anchor.z ?? 0;
  const rank = Math.min(z >= 251_658_240 ? z - 251_658_240 : z, 900_000_000);
  return anchor.wrap === "behind" ? String(-1_000_000_000 + rank) : String(3 + rank);
}

/** Whether the object is hidden (Selection Pane). */
export const hiddenCss = (hidden: boolean | undefined): string => (hidden ? "visibility: hidden" : "");

/** The CSS placement of a floating picture (see the module comment). */
export function floatPlacement(anchor: Anchor, ctx: FloatContext): FloatPlacement {
  const d = anchor.distance;
  const dist = { t: d.top / EMU_PER_PX, b: d.bottom / EMU_PER_PX, l: d.left / EMU_PER_PX, r: d.right / EMU_PER_PX };
  const x = horizontalPos(anchor, ctx);
  const y = verticalPos(anchor, ctx.vpage ?? null, ctx.height, ctx.lineTop ?? 0);
  // Relative to the paragraph's content box: subtract the left indent.
  const left = x.value != null ? px(x.value - ctx.indentLeft) : `calc(${x.css} - ${px(ctx.indentLeft)})`;
  if (anchor.wrap === "behind" || anchor.wrap === "inFront") {
    return {
      mode: anchor.wrap === "behind" ? "behind" : "front",
      css: { position: "absolute", left, top: px(y), "z-index": zIndex(anchor) },
    };
  }
  const vertical = { "margin-top": px((ctx.vpage ? y : Math.max(0, y)) + dist.t), "margin-bottom": px(dist.b) };
  if (anchor.wrap === "topAndBottom") {
    return { mode: "block", css: { display: "block", "margin-left": left, ...vertical } };
  }
  // Square / tight / through: text on both sides when both text areas are wide enough (Word), out of the flow with
  // per-line exclusions; else a float on the side that leaves the wider text area.
  const place = anchor.h.place;
  const side = anchor.wrapSide ?? "both";
  const col = ctx.columnWidth;
  const xNum = x.value ?? (col != null && place.kind === "align" ? (place.value === "left" ? 0 : place.value === "right" ? col - ctx.width : (col - ctx.width) / 2) : null);
  if (side === "both" && xNum != null && ctx.columnWidth != null) {
    const leftGap = xNum - dist.l - ctx.indentLeft;
    const rightGap = ctx.columnWidth - ctx.indentRight - (xNum + ctx.width + dist.r);
    if (leftGap >= MIN_SIDE_GAP && rightGap >= MIN_SIDE_GAP) {
      return { mode: "both", css: { position: "absolute", left: px(xNum - ctx.indentLeft), top: px(y), "z-index": zIndex(anchor) } };
    }
  }
  const right =
    side === "left" ||
    (side !== "right" &&
      (place.kind === "align" ? place.value === "right" : ctx.columnWidth != null && (x.value ?? 0) + ctx.width / 2 > ctx.columnWidth / 2));
  if (right) {
    const mr = x.value != null && ctx.columnWidth != null ? ctx.columnWidth - x.value - ctx.width - ctx.indentRight : -ctx.indentRight;
    return { mode: "float-right", css: { float: "right", "margin-right": px(mr), "margin-left": px(dist.l), ...vertical } };
  }
  return { mode: "float-left", css: { float: "left", "margin-left": left, "margin-right": px(dist.r), ...vertical } };
}

/** `floatPlacement`'s declarations as a style string. */
export const placementStyle = (p: FloatPlacement): string =>
  Object.entries(p.css)
    .map(([k, v]) => `${k}: ${v}`)
    .join("; ");

/** The zoom of an element (CSS `zoom` on an ancestor): rendered width / layout width. */
export const zoomOf = (el: HTMLElement): number => (el.offsetWidth ? el.getBoundingClientRect().width / el.offsetWidth || 1 : 1);

/**
 * Where a floating object's wrapper is drawn: px from its paragraph's
 * column edge (the paragraph's left edge minus its left indent) and top —
 * the values `movedAnchor` takes — with the zoom.
 */
export function renderedOffset(wrap: HTMLElement, indentLeft: number): { x: number; y: number; zoom: number } {
  const para = wrap.closest("p, h1, h2, h3, h4, h5, h6") as HTMLElement | null;
  const z = zoomOf(wrap);
  const r0 = wrap.getBoundingClientRect();
  const p0 = para?.getBoundingClientRect() ?? r0;
  return { x: (r0.left - p0.left) / z + indentLeft, y: (r0.top - p0.top) / z, zoom: z };
}

/**
 * The top of the line holding the object at `pos` (px from its paragraph's
 * top; `line`-relative vertical positions): the line of the text right
 * after the object (the object itself is out of the line), 0 without one.
 */
export function lineTopAt(view: EditorView, pos: number | undefined, wrap: HTMLElement): number {
  if (pos === undefined) return 0;
  const para = wrap.closest("p, h1, h2, h3, h4, h5, h6") as HTMLElement | null;
  if (!para) return 0;
  try {
    const node = view.state.doc.nodeAt(pos);
    const after = pos + (node?.nodeSize ?? 1);
    const c = view.coordsAtPos(Math.min(after, view.state.doc.content.size), 1);
    const z = zoomOf(para);
    return Math.max(0, (c.top - para.getBoundingClientRect().top) / z);
  } catch {
    return 0;
  }
}
