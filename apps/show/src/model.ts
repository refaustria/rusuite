// Read-only helpers over the generated model mirrors (ADR 0008).

import { cssColor, type ThemePalette } from "@rusuite/ui-shared";
import type { Color } from "../../../packages/ui-shared/src/generated/Color";
import type { FontFace } from "../../../packages/ui-shared/src/generated/FontFace";
import type { RunProperties } from "../../../packages/ui-shared/src/generated/RunProperties";
import type { ThemeColorSlot } from "../../../packages/ui-shared/src/generated/ThemeColorSlot";
import type { Fill } from "./generated/Fill";
import type { NodeId } from "./generated/NodeId";
import type { PlaceholderDef } from "./generated/PlaceholderDef";
import type { Presentation } from "./generated/Presentation";
import type { Shape } from "./generated/Shape";
import type { Slide } from "./generated/Slide";
import type { TextBody } from "./generated/TextBody";
import type { TextParagraph } from "./generated/TextParagraph";
import type { TextParagraphProps } from "./generated/TextParagraphProps";
import type { Theme } from "./generated/Theme";
import { findPlaceholder } from "./design/deck";

export type { Color, RunProperties };

/** The shape `id` anywhere in `shapes` (also inside groups) and its top-level ancestor. */
export function findShape(shapes: Shape[], id: NodeId): { shape: Shape; top: Shape; parents: Shape[] } | null {
  const walk = (list: Shape[], parents: Shape[]): { shape: Shape; parents: Shape[] } | null => {
    for (const s of list) {
      if (s.id === id) return { shape: s, parents };
      if (s.kind.kind === "group") {
        const hit = walk(s.kind.value.children, [...parents, s]);
        if (hit) return hit;
      }
    }
    return null;
  };
  const hit = walk(shapes, []);
  return hit ? { ...hit, top: hit.parents[0] ?? hit.shape } : null;
}

/** The text body of an auto shape, if any. */
export function textOf(shape: Shape): TextBody | null {
  return shape.kind.kind === "auto" ? (shape.kind.value.text ?? null) : null;
}

/** Number of positions (Unicode scalar values) of `s`, as the core counts them. */
export const charLen = (s: string): number => Array.from(s).length;

export const paragraphText = (p: TextParagraph): string => p.runs.map((r) => r.text).join("");

/** The text of a body, paragraphs joined by `\n`. */
export const bodyText = (b: TextBody): string => b.paragraphs.map(paragraphText).join("\n");

/** Theme slot names in the order of `ColorScheme.colors`. */
export const SCHEME_SLOTS: ThemeColorSlot[] = [
  "dark1", "light1", "dark2", "light2",
  "accent1", "accent2", "accent3", "accent4", "accent5", "accent6",
  "hyperlink", "followedHyperlink",
];

/** The theme's colors as a palette for `cssColor`. */
export function themePalette(theme: Theme | undefined): ThemePalette {
  const out: ThemePalette = {};
  theme?.colors.colors.forEach((hex, i) => {
    const slot = SCHEME_SLOTS[i];
    if (slot) out[slot] = hex.replace(/^#/, "").toUpperCase();
  });
  return out;
}

/** CSS color of a model color (`undefined` for auto). */
export function css(color: Color | null | undefined, palette: ThemePalette): string | undefined {
  return cssColor(color ?? undefined, palette);
}

/** CSS color of a fill (`undefined` for no fill). */
export function fillCss(fill: Fill | null | undefined, palette: ThemePalette): string | undefined {
  return fill && fill.kind === "solid" ? css(fill.value, palette) : undefined;
}

const quote = (name: string) => (/^[\w-]+$/.test(name) ? name : `"${name.replace(/"/g, "")}"`);

/** CSS font-family list of a font face (theme fonts resolved). */
export function fontFamily(face: FontFace | null | undefined, theme: Theme | undefined): string {
  let name = "Calibri";
  if (face?.kind === "named") name = face.value;
  else if (face?.kind === "theme") {
    const f = theme?.fonts;
    const slot = face.value;
    name = (f && f[slot]) || (slot.startsWith("major") ? "Calibri Light" : "Calibri"); // i18n-ignore: a font name
  } else if (theme?.fonts.minorLatin) name = theme.fonts.minorLatin;
  const fallback = /^calibri/i.test(name) ? ", Carlito" : "";
  return `${quote(name)}${fallback}, sans-serif`;
}

/** The layout placeholder a shape fills on its slide. */
export function placeholderDef(pres: Presentation, slide: Slide, shape: Shape): PlaceholderDef | undefined {
  if (!shape.placeholder) return undefined;
  const layout = pres.layouts.find((l) => l.kind === slide.layout);
  return layout ? findPlaceholder(layout.placeholders, shape.placeholder, shape.placeholderIdx) : undefined;
}

/** Merges the set (non-null) fields of `over` into `base`. */
export function mergeDefined<T extends object>(base: T | undefined, over: T | null | undefined): T {
  const out = { ...(base ?? {}) } as Record<string, unknown>;
  for (const [k, v] of Object.entries(over ?? {})) if (v !== null && v !== undefined) out[k] = v;
  return out as T;
}

/** Default size of text outside placeholders (PowerPoint: 18 pt), in hundredths of a point. */
export const DEFAULT_TEXT_SIZE = 1800;

/** Effective run formatting: placeholder defaults, then the run's own. */
export function effectiveRun(def: PlaceholderDef | undefined, props: RunProperties | undefined): RunProperties {
  return mergeDefined<RunProperties>({ size: DEFAULT_TEXT_SIZE, ...(def ? mergeDefined({}, def.runDefaults) : {}) }, props);
}

/** Effective paragraph formatting: placeholder defaults, then the paragraph's own. */
export function effectiveParagraph(def: PlaceholderDef | undefined, props: TextParagraphProps | undefined): TextParagraphProps {
  return mergeDefined<TextParagraphProps>(def?.paragraphDefaults, props);
}

/** Every top-level shape id of a slide. */
export const shapeIds = (slide: Slide | null | undefined): NodeId[] => slide?.shapes.map((s) => s.id) ?? [];
