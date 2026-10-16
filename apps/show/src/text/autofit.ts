// Text autofit (P8-28): what "Shrink text on overflow" stores. PowerPoint
// keeps the scale it applied in `a:normAutofit/@fontScale` and
// `@lnSpcReduction` (1/1000 %), so a file shows the same in every reader;
// the editor computes it (`shrinkFit`: line spacing first, then the font)
// whenever the text, the box or the setting changes and sends it with the
// command, so it round-trips through the pptx.

import type { BodyProps } from "../generated/BodyProps";
import type { Presentation } from "../generated/Presentation";
import type { Shape } from "../generated/Shape";
import type { Slide } from "../generated/Slide";
import type { TextBody } from "../generated/TextBody";
import type { Transform } from "../generated/Transform";
import { EMU_PER_PX, emuToPx } from "../geometry";
import { themePalette } from "../model";
import { slideNumberOf, stableDeck } from "../design/deck";
import { shapeTextOptions } from "../canvas/SlideView";
import { textRect } from "../shapes/presets";
import { layoutText, shrinkFit, type LayoutOptions } from "./layout";

/** 1/1000 % of a fraction (0.625 → 62500). */
export const toThousandths = (f: number): number => Math.round(f * 100000);

/** `props` with the scale of a shrink step (the fields are left out at 100 % / 0). */
export function withScale(props: BodyProps, step: { fontScale: number; lineReduction: number }): BodyProps {
  const out: BodyProps = { ...props };
  delete out.fontScale;
  delete out.lineReduction;
  if (props.autofit !== "shrink") return out;
  const fs = toThousandths(step.fontScale);
  const lr = toThousandths(step.lineReduction);
  if (fs !== 100000) out.fontScale = fs;
  if (lr !== 0) out.lineReduction = lr;
  return out;
}

/** The shrink step `body` needs in the layout `o` (100 % unless autofit is Shrink). */
export function shrinkStep(body: TextBody, o: LayoutOptions): { fontScale: number; lineReduction: number } {
  if (body.props.autofit !== "shrink") return { fontScale: 1, lineReduction: 0 };
  const plain = { ...body, props: { ...body.props } };
  delete plain.props.fontScale;
  delete plain.props.lineReduction;
  return shrinkFit(plain, o);
}

/** Layout options of `shape`'s text on `slide` with the box `transform` (default: the shape's). */
function optionsFor(pres: Presentation, slide: Slide, shape: Shape, transform: Transform = shape.transform): LayoutOptions | null {
  if (shape.kind.kind !== "auto") return null;
  const w = emuToPx(transform.w);
  const h = emuToPx(transform.h);
  const tr = textRect(shape, w, h);
  const deck = stableDeck(pres);
  return shapeTextOptions({ deck, slide, palette: themePalette(pres.theme), asMaster: false, slideNumber: slideNumberOf(deck, slide.id) }, shape, tr.w, tr.h);
}

/**
 * The body props to store for `body` in `shape` (box `transform`): the
 * shrink scale recomputed when autofit is Shrink; `null` when nothing
 * changes.
 */
export function autofitProps(pres: Presentation, slide: Slide, shape: Shape, body: TextBody, transform?: Transform): BodyProps | null {
  if (body.props.autofit !== "shrink") return null;
  const o = optionsFor(pres, slide, shape, transform);
  if (!o) return null;
  const next = withScale(body.props, shrinkStep(body, o));
  return (next.fontScale ?? 100000) === (body.props.fontScale ?? 100000) && (next.lineReduction ?? 0) === (body.props.lineReduction ?? 0) ? null : next;
}

/** Whether `shape`'s text overflows its box (the AutoFit Options button). */
export function overflows(pres: Presentation, slide: Slide, shape: Shape): boolean {
  const body = shape.kind.kind === "auto" ? shape.kind.value.text : null;
  if (!body) return false;
  const o = optionsFor(pres, slide, shape);
  return o ? !!layoutText(body, o).overflow : false;
}

/** "Resize shape to fit text": the box height (EMU) that holds `body` (horizontal text; `null` for other shapes). */
export function fitHeight(pres: Presentation, slide: Slide, shape: Shape, body: TextBody): number | null {
  if ((body.props.vert ?? "horizontal") !== "horizontal") return null;
  const o = optionsFor(pres, slide, shape);
  if (!o) return null;
  const lay = layoutText({ ...body, props: { ...body.props, autofit: "none" } }, o);
  // the text rectangle may be smaller than the box (ellipses, diamonds …)
  const ratio = emuToPx(shape.transform.h) / Math.max(1, o.height);
  return Math.max(EMU_PER_PX * 4, Math.round(lay.height * ratio * EMU_PER_PX));
}
