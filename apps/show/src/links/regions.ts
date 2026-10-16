// Where links are on a slide in the slide show (P8-24): the boxes of
// shapes with a click action and the text fragments of runs with a
// hyperlink, in slide px (top-level shapes; rotation is ignored, the box
// is the unrotated one). The show puts an anchor (web addresses) or a
// button (jumps) over each, so following a link needs no `window.open`.

import type { ThemePalette } from "@rusuite/ui-shared";
import { layoutShapeText } from "../canvas/SlideView";
import type { DeckContext } from "../design/deck";
import { slideNumberOf } from "../design/deck";
import type { Hyperlink } from "../generated/Hyperlink";
import type { NodeId } from "../generated/NodeId";
import type { Slide } from "../generated/Slide";
import { emuToPx } from "../geometry";
import { textRect } from "../shapes/presets";

export interface LinkRegion {
  /** Slide px. */
  x: number;
  y: number;
  w: number;
  h: number;
  link: Hyperlink;
  shape: NodeId;
  /** A text link (drawn over the shape's own action). */
  text: boolean;
}

/** The link regions of `slide`, bottom to top. */
export function linkRegions(deck: DeckContext, slide: Slide, palette: ThemePalette): LinkRegion[] {
  const out: LinkRegion[] = [];
  const ctx = { deck, slide, palette, asMaster: false, slideNumber: slideNumberOf(deck, slide.id) };
  for (const s of slide.shapes) {
    const x = emuToPx(s.transform.x);
    const y = emuToPx(s.transform.y);
    const w = emuToPx(s.transform.w);
    const h = emuToPx(s.transform.h);
    if (s.clickAction && s.kind.kind !== "media") out.push({ x, y, w, h, link: s.clickAction, shape: s.id, text: false });
    if (s.kind.kind !== "auto" || !s.kind.value.text) continue;
    const body = s.kind.value.text;
    if (!body.paragraphs.some((p) => p.runs.some((r) => r.hyperlink))) continue;
    const tr = textRect(s.kind.value.geometry, w, h);
    const lay = layoutShapeText(ctx, s, body, tr.w, tr.h);
    for (const f of lay.fragments) {
      if (!f.link || !f.text.trim()) continue;
      out.push({ x: x + tr.x + f.x, y: y + tr.y + f.y, w: f.width, h: f.fontSize * 1.2, link: f.link, shape: s.id, text: true });
    }
  }
  return out;
}

/** What following a link does in the show. */
export type LinkAction =
  | { kind: "url"; url: string }
  | { kind: "goto"; index: number }
  | { kind: "first" }
  | { kind: "last" }
  | { kind: "next" }
  | { kind: "previous" }
  | { kind: "back" }
  | { kind: "end" }
  | { kind: "none" };

/** The action of `link` in a show of `slides` (ids in show order); links to slides not in the show do nothing. */
export function linkAction(link: Hyperlink, slides: readonly NodeId[]): LinkAction {
  const t = link.target;
  if (t.kind === "url") return { kind: "url", url: t.value };
  if (t.kind === "endShow") return { kind: "end" };
  switch (t.value.kind) {
    case "id": {
      const index = slides.indexOf(t.value.value);
      return index < 0 ? { kind: "none" } : { kind: "goto", index };
    }
    case "first":
      return { kind: "first" };
    case "last":
      return { kind: "last" };
    case "next":
      return { kind: "next" };
    case "previous":
      return { kind: "previous" };
    case "lastViewed":
      return { kind: "back" };
  }
}

/** Whether a URL may be opened from the show (no `javascript:` and the like). */
export const safeUrl = (url: string): boolean => /^(https?:|mailto:|tel:|ftp:)/i.test(url.trim());
