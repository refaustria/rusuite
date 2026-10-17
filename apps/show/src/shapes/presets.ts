// The shape library of Insert › Shapes (PowerPoint's groups), the shapes
// a gallery choice inserts, the adjust defaults of the presets (the core's
// `Preset::adjust_defaults`, generated) and the text rectangle inside a
// shape (from the core's outline).

import type { ArrowEnd } from "../generated/ArrowEnd";
import type { ConnectorKind } from "../generated/ConnectorKind";
import type { Preset } from "../generated/Preset";
import type { Shape } from "../generated/Shape";
import type { TextBody } from "../generated/TextBody";
import type { Transform } from "../generated/Transform";
import type { Hyperlink } from "../generated/Hyperlink";
import { EMU_PER_PT } from "../geometry";
import presetInfo from "../generated/presetInfo.json";
import { pathCache, pathQueryOf } from "./paths";

/** Every preset's default name and adjust values (written by `cargo test -p show-core`). */
const PRESET_INFO = presetInfo as Record<string, { name: string; adjust: Record<string, number> }>;

/** A named preset (every `Preset` but `custom`). */
export type NamedPreset = Exclude<Preset, { custom: unknown }>;

/** What a gallery item inserts: a preset auto shape, a text box or a connector. */
export type ShapeChoice =
  | { kind: "preset"; preset: NamedPreset }
  | { kind: "textBox" }
  | { kind: "connector"; connector: ConnectorKind; head: boolean; tail: boolean };

export type ShapeGroupId =
  | "recent"
  | "lines"
  | "rectangles"
  | "basic"
  | "arrows"
  | "equation"
  | "flowchart"
  | "stars"
  | "callouts"
  | "actionButtons";

/** Gallery ids of the connector choices. */
const CONNECTORS: Record<string, ShapeChoice> = {
  line: { kind: "connector", connector: "straight", head: false, tail: false },
  lineArrow: { kind: "connector", connector: "straight", head: false, tail: true },
  lineDoubleArrow: { kind: "connector", connector: "straight", head: true, tail: true },
  elbow: { kind: "connector", connector: "elbow", head: false, tail: false },
  elbowArrow: { kind: "connector", connector: "elbow", head: false, tail: true },
  curved: { kind: "connector", connector: "curved", head: false, tail: false },
  curvedArrow: { kind: "connector", connector: "curved", head: false, tail: true },
};

/** The gallery groups in PowerPoint's order (without Recently Used) and their item ids. */
export const SHAPE_GROUPS: { id: Exclude<ShapeGroupId, "recent">; items: string[] }[] = [
  { id: "lines", items: ["line", "lineArrow", "lineDoubleArrow", "elbow", "elbowArrow", "curved", "curvedArrow"] },
  { id: "rectangles", items: ["rect", "roundRect", "snip1Rect", "snip2SameRect", "round1Rect", "round2SameRect"] },
  {
    id: "basic",
    items: [
      "textBox", "ellipse", "triangle", "rtTriangle", "parallelogram", "trapezoid", "diamond", "pentagon", "hexagon", "octagon",
      "pie", "chord", "teardrop", "frame", "halfFrame", "corner", "diagStripe", "plus", "can", "cube", "bevel", "donut", "noSmoking",
      "blockArc", "foldedCorner", "smileyFace", "heart", "lightningBolt", "sun", "moon", "cloud",
    ],
  },
  {
    id: "arrows",
    items: ["rightArrow", "leftArrow", "upArrow", "downArrow", "leftRightArrow", "upDownArrow", "quadArrow", "leftRightUpArrow", "bentArrow", "uturnArrow", "homePlate", "chevron"],
  },
  { id: "equation", items: ["mathPlus", "mathMinus", "mathMultiply", "mathDivide", "mathEqual", "mathNotEqual"] },
  {
    id: "flowchart",
    items: [
      "flowChartProcess", "flowChartAlternateProcess", "flowChartDecision", "flowChartInputOutput", "flowChartPredefinedProcess",
      "flowChartInternalStorage", "flowChartDocument", "flowChartMultidocument", "flowChartTerminator", "flowChartPreparation",
      "flowChartManualInput", "flowChartManualOperation", "flowChartConnector", "flowChartOffpageConnector", "flowChartPunchedCard",
      "flowChartPunchedTape", "flowChartSummingJunction", "flowChartOr", "flowChartCollate", "flowChartSort", "flowChartExtract",
      "flowChartMerge", "flowChartOnlineStorage", "flowChartDelay", "flowChartMagneticTape", "flowChartMagneticDisk",
      "flowChartMagneticDrum", "flowChartDisplay", "flowChartOfflineStorage",
    ],
  },
  { id: "stars", items: ["star4", "star5", "star6", "star8", "ribbon2", "ribbon", "wave", "doubleWave"] },
  { id: "callouts", items: ["wedgeRectCallout", "wedgeRoundRectCallout", "wedgeEllipseCallout", "cloudCallout", "borderCallout1", "borderCallout2"] },
  {
    id: "actionButtons",
    items: [
      "actionButtonBackPrevious", "actionButtonForwardNext", "actionButtonBeginning", "actionButtonEnd", "actionButtonHome", "actionButtonInformation",
      "actionButtonReturn", "actionButtonMovie", "actionButtonDocument", "actionButtonSound", "actionButtonHelp", "actionButtonBlank",
    ],
  },
];

/** The click action PowerPoint gives a new action button (mirror of `Preset::default_action`). */
export function defaultAction(p: Preset): Hyperlink | undefined {
  const to = (kind: "first" | "last" | "next" | "previous" | "lastViewed"): Hyperlink => ({ target: { kind: "slide", value: { kind } } });
  switch (p) {
    case "actionButtonHome":
    case "actionButtonBeginning":
      return to("first");
    case "actionButtonEnd":
      return to("last");
    case "actionButtonBackPrevious":
      return to("previous");
    case "actionButtonForwardNext":
      return to("next");
    case "actionButtonReturn":
      return to("lastViewed");
    default:
      return undefined;
  }
}

/** Whether a preset is one of the twelve action buttons. */
export const isActionButton = (p: Preset): boolean => typeof p === "string" && p.startsWith("actionButton");

/** Every named preset (the gallery's plus `line`). */
export const NAMED_PRESETS: NamedPreset[] = [
  ...SHAPE_GROUPS.flatMap((g) => g.items.filter((i) => !(i in CONNECTORS) && i !== "textBox")),
  "line",
] as NamedPreset[];

/** The choice of a gallery id (`null` for unknown ids). */
export function choiceOf(id: string): ShapeChoice | null {
  if (id in CONNECTORS) return CONNECTORS[id]!;
  if (id === "textBox") return { kind: "textBox" };
  return (NAMED_PRESETS as string[]).includes(id) && id !== "line" ? { kind: "preset", preset: id as NamedPreset } : null;
}

/** Catalog key of a gallery id's label. */
export const choiceLabelKey = (id: string): string => `show.shape.${id}`;

/** Most recently used gallery ids, newest first (at most `max`). */
export function pushRecent(list: readonly string[], id: string, max = 10): string[] {
  return [id, ...list.filter((x) => x !== id)].slice(0, max);
}

/** Adjust values a preset has, with defaults (100000 = 100 %; ECMA-376 `a:avLst`, generated by the core). */
export function adjustDefaults(p: Preset): Record<string, number> {
  if (typeof p !== "string") return {};
  return { ...(PRESET_INFO[p]?.adjust ?? {}) };
}

/** Default size of a shape inserted by a click (PowerPoint: 1 inch; text box and lines wider). */
export const DEFAULT_SHAPE_EMU = 914400;

export const ACCENT = { kind: "theme", value: { slot: "accent1", tint: 0 } } as const;
export const LIGHT1 = { kind: "theme", value: { slot: "light1", tint: 0 } } as const;
export const ACCENT_DARK = { kind: "theme", value: { slot: "accent1", tint: -0.25 } } as const;

const body = (anchor: "top" | "middle", centred: boolean): TextBody => ({
  props: { anchor, wrap: true, insets: { left: 91440, top: 45720, right: 91440, bottom: 45720 }, autofit: "none" },
  paragraphs: [centred ? { props: { alignment: "center" }, runs: [] } : { runs: [] }],
});

/** The arrowhead a connector choice puts at an end. */
const arrow = (on: boolean): ArrowEnd | undefined => (on ? { kind: "triangle", width: "medium", length: "medium" } : undefined);

/** PowerPoint's width of a text box inserted by a click (2.5 cm). */
export const TEXT_BOX_CLICK_W = 900000;
/** The height of a one-line text box (18 pt with its insets; `spAutoFit` corrects it to the text). */
export const TEXT_BOX_LINE_H = 369332;

/**
 * The shape a gallery choice inserts in `transform`, with temporary id
 * `id`. A text box resizes to fit its text (`spAutoFit`, PowerPoint's
 * default); one inserted by a click (`click`) does not wrap, so it grows
 * in width while typing, a dragged one wraps at the dragged width.
 */
export function choiceShape(choice: ShapeChoice, transform: Transform, id: number, click = false): Shape {
  const base = { id, name: "", transform };
  switch (choice.kind) {
    case "textBox": {
      const text = body("top", false);
      text.props = { ...text.props, autofit: "resize", wrap: !click };
      return {
        ...base,
        kind: { kind: "auto", value: { geometry: "rect", text } },
        fill: { kind: "none" },
        line: { fill: { kind: "none" }, width: EMU_PER_PT, dash: "solid" },
      };
    }
    case "connector": {
      const c = choice.connector;
      return {
        ...base,
        kind: {
          kind: "connector",
          value: { kind: c, ...(c === "straight" ? {} : { bends: 2 }), ...(choice.head ? { head: arrow(true) } : {}), ...(choice.tail ? { tail: arrow(true) } : {}) },
        },
        fill: { kind: "none" },
        line: { fill: { kind: "solid", value: ACCENT }, width: EMU_PER_PT, dash: "solid" },
      };
    }
    case "preset": {
      const action = defaultAction(choice.preset);
      return {
        ...base,
        kind: { kind: "auto", value: { geometry: choice.preset, text: body("middle", true) } },
        fill: { kind: "solid", value: ACCENT },
        // the shape style's text colour (`p:style/a:fontRef`): white on the accent fill, as in PowerPoint
        textColor: LIGHT1,
        line: { fill: { kind: "solid", value: ACCENT_DARK }, width: EMU_PER_PT, dash: "solid" },
        ...(action ? { clickAction: action } : {}),
      };
    }
  }
}

/** The box a click (no drag) at `x`, `y` inserts for a choice (top-left at the click like PowerPoint). */
export function clickBox(choice: ShapeChoice, x: number, y: number): Transform {
  if (choice.kind === "connector") return { x: Math.round(x), y: Math.round(y), w: DEFAULT_SHAPE_EMU, h: 0, rotationDeg: 0 };
  if (choice.kind === "textBox") return { x: Math.round(x), y: Math.round(y), w: TEXT_BOX_CLICK_W, h: TEXT_BOX_LINE_H, rotationDeg: 0 };
  return { x: Math.round(x), y: Math.round(y), w: DEFAULT_SHAPE_EMU, h: DEFAULT_SHAPE_EMU, rotationDeg: 0 };
}

/** A rectangle `x`, `y`, `w`, `h` (px or EMU, as the input). */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The text rectangle of a shape in a `w` × `h` box (px or EMU): the
 * preset's `a:rect` from the core's outline (`shapePaths`), scaled to the
 * box; the whole box until the outline is cached (and for custom
 * geometry, pictures and other shapes).
 */
export function textRect(shape: Shape, w: number, h: number): Box {
  const q = shape.kind.kind === "auto" ? pathQueryOf(shape) : null;
  const r = q ? pathCache.peek(q)?.textRect : undefined;
  const tw = shape.transform.w;
  const th = shape.transform.h;
  if (!r || tw <= 0 || th <= 0) return { x: 0, y: 0, w, h };
  const sx = w / tw;
  const sy = h / th;
  return { x: r.l * sx, y: r.t * sy, w: Math.max(0, (r.r - r.l) * sx), h: Math.max(0, (r.b - r.t) * sy) };
}
