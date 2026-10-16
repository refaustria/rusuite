// What a slide inherits from the design (ADR 0008 amendment, P8-19):
// placeholder geometry and text defaults slide → layout → master
// (`Layout::find` semantics), the text style levels of the master, the
// background (slide → layout → master) and the decorative shapes of the
// master and layout drawn below the slide (`showMasterShapes`).

import type { TableStyleDef } from "../generated/TableStyleDef";
import type { RunProperties } from "../../../../packages/ui-shared/src/generated/RunProperties";
import type { Layout } from "../generated/Layout";
import type { LayoutKind } from "../generated/LayoutKind";
import type { NodeId } from "../generated/NodeId";
import type { PlaceholderDef } from "../generated/PlaceholderDef";
import type { PlaceholderKind } from "../generated/PlaceholderKind";
import type { Presentation } from "../generated/Presentation";
import type { ResolvedFill } from "../generated/ResolvedFill";
import type { Section } from "../generated/Section";
import type { Shape } from "../generated/Shape";
import type { Slide } from "../generated/Slide";
import type { SlideMaster } from "../generated/SlideMaster";
import type { SlideSize } from "../generated/SlideSize";
import type { TextParagraphProps } from "../generated/TextParagraphProps";
import type { Theme } from "../generated/Theme";
import { mergeDefined } from "../model";
import { resolveBackground } from "./color";

/** What a slide needs from the presentation besides the slide itself. */
export interface DeckContext {
  slideSize: SlideSize;
  layouts: Layout[];
  theme: Theme;
  /** The slide master (absent in old snapshots / tests: no master graphics, white background). */
  master?: SlideMaster;
  /** All slide ids in order (slide numbers); absent = numbers unknown. */
  order?: NodeId[];
  sections?: Section[];
  /** The presentation's own table styles (built-ins need none). */
  tableStyles?: TableStyleDef[];
}

/** The deck context of a presentation. */
export function deckOf(pres: Presentation): DeckContext {
  return {
    slideSize: pres.slideSize,
    layouts: pres.layouts,
    theme: pres.theme,
    master: pres.master,
    order: pres.slides.map((s) => s.id),
    sections: pres.sections,
    tableStyles: pres.tableStyles,
  };
}

/** The layout `kind` of the deck. */
export const layoutOf = (deck: Pick<DeckContext, "layouts">, kind: LayoutKind): Layout | undefined => deck.layouts.find((l) => l.kind === kind);

export type TextClass = "title" | "body" | "other";

const HEADER_FOOTER: PlaceholderKind[] = ["dateTime", "footer", "slideNumber"];

/** The text class of a placeholder kind (titles; subtitle/body/picture; the rest). */
export function textClass(kind: PlaceholderKind | null | undefined): TextClass {
  if (kind === "title" || kind === "centeredTitle") return "title";
  if (kind === "subtitle" || kind === "body" || kind === "picture") return "body";
  return "other";
}

/** Placeholders of the same class inherit from each other; header/footer kinds only from their own kind. */
export function sameClass(a: PlaceholderKind, b: PlaceholderKind): boolean {
  if (HEADER_FOOTER.includes(a) || HEADER_FOOTER.includes(b)) return a === b;
  return textClass(a) === textClass(b);
}

/** `Layout::find`: same `idx` (compatible kind), else the first of the kind, else the first of the class. */
export function findPlaceholder(defs: readonly PlaceholderDef[], kind: PlaceholderKind, idx?: number | null): PlaceholderDef | undefined {
  return (
    (idx ? defs.find((d) => (d.idx ?? 0) === idx && sameClass(d.kind, kind)) : undefined) ??
    defs.find((d) => d.kind === kind) ??
    defs.find((d) => sameClass(d.kind, kind))
  );
}

/** The placeholder a shape of `slide` fills (`asMaster`: the master's own placeholders). */
export function placeholderFor(deck: DeckContext, layout: LayoutKind, shape: Shape, asMaster = false): PlaceholderDef | undefined {
  if (!shape.placeholder) return undefined;
  const defs = asMaster ? deck.master?.placeholders : layoutOf(deck, layout)?.placeholders;
  return defs ? findPlaceholder(defs, shape.placeholder, shape.placeholderIdx) : undefined;
}

/**
 * Text defaults of outline level `level` (0-based) of a placeholder:
 * level 1 is the placeholder's own (effective) defaults; deeper levels of
 * body placeholders take the master's body text style for that level
 * (bullet, size, spacing) over the placeholder's run defaults.
 */
export function levelDefaults(
  deck: Pick<DeckContext, "master">,
  def: PlaceholderDef | undefined,
  level: number,
): { run: RunProperties; paragraph: TextParagraphProps } {
  const run = mergeDefined<RunProperties>({}, def?.runDefaults);
  const paragraph = mergeDefined<TextParagraphProps>({}, def?.paragraphDefaults);
  if (!def || level <= 0 || def.kind === "subtitle") return { run, paragraph };
  const cls = textClass(def.kind);
  const list = deck.master?.textStyles[cls] ?? [];
  const st = list[Math.min(level, list.length - 1)];
  if (!st) return { run, paragraph };
  return { run: mergeDefined(run, st.run), paragraph: mergeDefined(paragraph, { ...(st.paragraph ?? {}), level: undefined }) };
}

const WHITE: ResolvedFill = { kind: "solid", value: { color: "FFFFFF", alpha: 1 } };

/** The background a slide shows: its own fill, else its layout's, else the master's. */
export function slideBackground(deck: DeckContext, slide: Pick<Slide, "background" | "layout">): ResolvedFill {
  if (slide.background) return resolveBackground(deck.theme, slide.background);
  const l = layoutOf(deck, slide.layout);
  if (l?.background) return resolveBackground(deck.theme, l.background);
  if (deck.master) return resolveBackground(deck.theme, deck.master.background);
  return WHITE;
}

/** The background of a design target in the master view (the master, or a layout over it). */
export function designBackground(deck: DeckContext, layout: LayoutKind | null): ResolvedFill {
  const l = layout === null ? undefined : layoutOf(deck, layout);
  if (l?.background) return resolveBackground(deck.theme, l.background);
  if (deck.master) return resolveBackground(deck.theme, deck.master.background);
  return WHITE;
}

/** The master's and layout's decorative shapes drawn below a slide (none when the slide hides background graphics). */
export function backdropShapes(deck: DeckContext, slide: Pick<Slide, "layout" | "showMasterShapes">): Shape[] {
  if (slide.showMasterShapes === false) return [];
  return designShapes(deck, slide.layout);
}

/** The decorative shapes of a layout (with the master's unless it hides them), or of the master (`null`). */
export function designShapes(deck: DeckContext, layout: LayoutKind | null): Shape[] {
  const master = deck.master?.shapes ?? [];
  if (layout === null) return master;
  const l = layoutOf(deck, layout);
  return [...(l?.showMasterShapes === false ? [] : master), ...(l?.shapes ?? [])];
}

/** 1-based number of `slide` in the deck (`null` when unknown). */
export function slideNumberOf(deck: DeckContext, slide: NodeId): number | null {
  const i = deck.order?.indexOf(slide) ?? -1;
  return i >= 0 ? i + 1 : null;
}

let lastDeck: DeckContext | null = null;
let lastKey = "";

/**
 * [`deckOf`] that returns the previous object while nothing the slides
 * inherit changed (stable for memoized thumbnails across slide patches).
 */
export function stableDeck(pres: Presentation): DeckContext {
  const key = pres.slides.map((s) => s.id).join(",");
  const d = lastDeck;
  if (
    d && key === lastKey && d.slideSize === pres.slideSize && d.layouts === pres.layouts && d.theme === pres.theme &&
    d.master === pres.master && d.sections === pres.sections
  ) {
    return d;
  }
  lastKey = key;
  lastDeck = deckOf(pres);
  return lastDeck;
}

/** Every decorative shape of the master and the layouts (to fetch their outlines with the slides'). */
export function allDesignShapes(deck: DeckContext): Shape[] {
  return [...(deck.master?.shapes ?? []), ...deck.layouts.flatMap((l) => l.shapes ?? [])];
}

/** The slides plus one pseudo slide holding the design shapes, for `slideQueries`. */
export function withDesignShapes(deck: DeckContext, slides: readonly Slide[]): Slide[] {
  const shapes = allDesignShapes(deck);
  return shapes.length ? [...slides, { id: -1, layout: "blank", shapes }] : [...slides];
}
