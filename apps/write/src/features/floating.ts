// Floating pictures (Word's "Wrap Text" / "Position" / Layout Options):
// the `Anchor` of an image built like Rust's `Anchor::new`, the nine
// position presets, moving by drag, and the CSS placement the image node
// view and the print layout use. Text flows around Square / Tight
// (a CSS float, one side) and Top and Bottom (a block on its own lines);
// Behind / In Front of Text are positioned outside the flow (relative to
// the anchor paragraph). Positions relative to the margin or the page
// are horizontal only: vertically the picture stays at its paragraph
// (the editor has no fixed page boxes), offsets from the paragraph or
// line are honoured.

import type { Anchor } from "../generated/Anchor";
import type { HAlign } from "../generated/HAlign";
import type { VAlignPos } from "../generated/VAlignPos";
import type { WrapKind } from "../generated/WrapKind";

/** EMU per CSS pixel (96 dpi). */
const EMU_PER_PX = 9525;

/** Wrap Text choices: inline with the text, or one of the floating kinds. */
export type WrapChoice = "inline" | WrapKind;
export const WRAP_CHOICES: WrapChoice[] = ["inline", "square", "tight", "topAndBottom", "behind", "inFront"];

/** Rust's `Anchor::new(wrap)`: offset 0 from the column and the paragraph, Word's distances for square/tight. */
export function newAnchor(wrap: WrapKind): Anchor {
  const side = wrap === "square" || wrap === "tight";
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
}

/** CSS placement of a floating picture inside its paragraph. */
export interface FloatPlacement {
  /** `float-left` / `float-right` (square, tight), `block` (top and bottom), `behind` / `front` (out of the flow). */
  mode: "float-left" | "float-right" | "block" | "behind" | "front";
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
  const page = anchor.h.relativeTo === "page" ? ctx.page : null;
  const place = anchor.h.place;
  if (place.kind === "offset") {
    const v = place.value / EMU_PER_PX - (page ? page.marginLeft : 0);
    return { value: v, css: px(v) };
  }
  if (page) {
    const v = place.value === "left" ? -page.marginLeft : place.value === "right" ? page.width - page.marginLeft - ctx.width : (page.width - ctx.width) / 2 - page.marginLeft;
    return { value: v, css: px(v) };
  }
  if (place.value === "left") return { value: 0, css: "0px" };
  if (place.value === "right") return { value: null, css: `calc(100% + ${px(ind)} - ${px(ctx.width)})` };
  return { value: null, css: `calc((100% + ${px(ind)} - ${px(ctx.width)}) / 2)` };
}

/** Vertical offset from the paragraph's top (px): offsets from the paragraph or line, else 0. */
export function verticalPos(anchor: Anchor): number {
  const place = anchor.v.place;
  if (place.kind === "offset" && (anchor.v.relativeTo === "paragraph" || anchor.v.relativeTo === "line")) return place.value / EMU_PER_PX;
  return 0;
}

/** The CSS placement of a floating picture (see the module comment). */
export function floatPlacement(anchor: Anchor, ctx: FloatContext): FloatPlacement {
  const d = anchor.distance;
  const dist = { t: d.top / EMU_PER_PX, b: d.bottom / EMU_PER_PX, l: d.left / EMU_PER_PX, r: d.right / EMU_PER_PX };
  const x = horizontalPos(anchor, ctx);
  const y = verticalPos(anchor);
  // Relative to the paragraph's content box: subtract the left indent.
  const left = x.value != null ? px(x.value - ctx.indentLeft) : `calc(${x.css} - ${px(ctx.indentLeft)})`;
  if (anchor.wrap === "behind" || anchor.wrap === "inFront") {
    return {
      mode: anchor.wrap === "behind" ? "behind" : "front",
      css: { position: "absolute", left, top: px(y), "z-index": anchor.wrap === "behind" ? "-1" : "3" },
    };
  }
  const vertical = { "margin-top": px(Math.max(0, y) + dist.t), "margin-bottom": px(dist.b) };
  if (anchor.wrap === "topAndBottom") {
    return { mode: "block", css: { display: "block", "margin-left": left, ...vertical } };
  }
  // Square / tight: float on the side that leaves the wider text area (Word flows on both sides; CSS on one).
  const place = anchor.h.place;
  const side = anchor.wrapSide ?? "both";
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
