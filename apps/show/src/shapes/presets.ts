// The shape library of Insert › Shapes (PowerPoint's groups), the shapes
// a gallery choice inserts, the adjust defaults of the presets (mirror of
// `Preset::adjust_defaults`) and the text rectangle inside a preset.

import type { ArrowEnd } from "../generated/ArrowEnd";
import type { ConnectorKind } from "../generated/ConnectorKind";
import type { Preset } from "../generated/Preset";
import type { Shape } from "../generated/Shape";
import type { TextBody } from "../generated/TextBody";
import type { Transform } from "../generated/Transform";
import { EMU_PER_PT } from "../geometry";

/** A named preset (every `Preset` but `custom`). */
export type NamedPreset = Exclude<Preset, { custom: unknown }>;

/** What a gallery item inserts: a preset auto shape, a text box or a connector. */
export type ShapeChoice =
  | { kind: "preset"; preset: NamedPreset }
  | { kind: "textBox" }
  | { kind: "connector"; connector: ConnectorKind; head: boolean; tail: boolean };

export type ShapeGroupId = "recent" | "lines" | "rectangles" | "basic" | "arrows" | "flowchart" | "stars" | "callouts";

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
    items: ["textBox", "ellipse", "triangle", "rtTriangle", "parallelogram", "trapezoid", "diamond", "pentagon", "hexagon", "octagon", "heart", "cloud"],
  },
  { id: "arrows", items: ["rightArrow", "leftArrow", "upArrow", "downArrow", "leftRightArrow", "upDownArrow", "homePlate", "chevron"] },
  {
    id: "flowchart",
    items: ["flowChartProcess", "flowChartDecision", "flowChartInputOutput", "flowChartTerminator", "flowChartDocument", "flowChartConnector"],
  },
  { id: "stars", items: ["star4", "star5", "star6", "star8"] },
  { id: "callouts", items: ["wedgeRectCallout", "wedgeRoundRectCallout", "wedgeEllipseCallout"] },
];

/** Every named preset (the 38 of the gallery plus `line`). */
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

/** Adjust values a preset has, with defaults (100000 = 100 %). */
export function adjustDefaults(p: Preset): Record<string, number> {
  switch (p) {
    case "roundRect":
    case "snip1Rect":
    case "round1Rect":
      return { adj: 16667 };
    case "snip2SameRect":
    case "round2SameRect":
      return { adj1: 16667, adj2: 0 };
    case "triangle":
    case "chevron":
    case "homePlate":
      return { adj: 50000 };
    case "parallelogram":
    case "trapezoid":
      return { adj: 25000 };
    case "pentagon":
      return { hf: 105146, vf: 110557 };
    case "hexagon":
      return { adj: 25000, vf: 115470 };
    case "octagon":
      return { adj: 29289 };
    case "rightArrow":
    case "leftArrow":
    case "upArrow":
    case "downArrow":
    case "leftRightArrow":
    case "upDownArrow":
      return { adj1: 50000, adj2: 50000 };
    case "star4":
      return { adj: 12500 };
    case "star5":
      return { adj: 19098, hf: 105146, vf: 110557 };
    case "star6":
      return { adj: 28868, hf: 115470 };
    case "star8":
      return { adj: 38250 };
    case "wedgeRectCallout":
    case "wedgeEllipseCallout":
      return { adj1: -20833, adj2: 62500 };
    case "wedgeRoundRectCallout":
      return { adj1: -20833, adj2: 62500, adj3: 16667 };
    default:
      return {};
  }
}

/** Default size of a shape inserted by a click (PowerPoint: 1 inch; text box and lines wider). */
export const DEFAULT_SHAPE_EMU = 914400;

export const ACCENT = { kind: "theme", value: { slot: "accent1", tint: 0 } } as const;
export const ACCENT_DARK = { kind: "theme", value: { slot: "accent1", tint: -0.25 } } as const;

const body = (anchor: "top" | "middle", centred: boolean): TextBody => ({
  props: { anchor, wrap: true, insets: { left: 91440, top: 45720, right: 91440, bottom: 45720 }, autofit: "none" },
  paragraphs: [centred ? { props: { alignment: "center" }, runs: [] } : { runs: [] }],
});

/** The arrowhead a connector choice puts at an end. */
const arrow = (on: boolean): ArrowEnd | undefined => (on ? { kind: "triangle", width: "medium", length: "medium" } : undefined);

/** The shape a gallery choice inserts in `transform`, with temporary id `id`. */
export function choiceShape(choice: ShapeChoice, transform: Transform, id: number): Shape {
  const base = { id, name: "", transform };
  switch (choice.kind) {
    case "textBox":
      return {
        ...base,
        kind: { kind: "auto", value: { geometry: "rect", text: body("top", false) } },
        fill: { kind: "none" },
        line: { fill: { kind: "none" }, width: EMU_PER_PT, dash: "solid" },
      };
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
    case "preset":
      return {
        ...base,
        kind: { kind: "auto", value: { geometry: choice.preset, text: body("middle", true) } },
        fill: { kind: "solid", value: ACCENT },
        line: { fill: { kind: "solid", value: ACCENT_DARK }, width: EMU_PER_PT, dash: "solid" },
      };
  }
}

/** The box a click (no drag) at `x`, `y` inserts for a choice (top-left at the click like PowerPoint). */
export function clickBox(choice: ShapeChoice, x: number, y: number): Transform {
  if (choice.kind === "connector") return { x: Math.round(x), y: Math.round(y), w: DEFAULT_SHAPE_EMU, h: 0, rotationDeg: 0 };
  if (choice.kind === "textBox") return { x: Math.round(x), y: Math.round(y), w: 2743200, h: 369332, rotationDeg: 0 };
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
 * The text rectangle of a preset in a `w` × `h` box (approximating the
 * presets' `a:rect`): ellipses and round shapes use the inscribed
 * rectangle, diamonds the middle half, triangles the lower middle part,
 * stars their inner area, callouts and arrows their body.
 */
export function textRect(p: Preset, w: number, h: number): Box {
  const inset = (fx: number, fy: number): Box => ({ x: w * fx, y: h * fy, w: w * (1 - 2 * fx), h: h * (1 - 2 * fy) });
  switch (p) {
    case "ellipse":
    case "flowChartConnector":
    case "wedgeEllipseCallout":
      return inset(0.1464, 0.1464);
    case "diamond":
    case "flowChartDecision":
      return inset(0.25, 0.25);
    case "triangle":
      return { x: w / 4, y: h / 2, w: w / 2, h: h / 2 };
    case "rtTriangle":
      return { x: w / 12, y: (h * 7) / 12, w: w / 2, h: (h * 5) / 12 };
    case "heart":
      return inset(0.2, 0.18);
    case "cloud":
      return inset(0.15, 0.17);
    case "star4":
    case "star5":
    case "star6":
    case "star8":
      return inset(0.3, 0.3);
    case "pentagon":
    case "hexagon":
    case "octagon":
      return inset(0.15, 0.15);
    case "parallelogram":
    case "trapezoid":
    case "flowChartInputOutput":
      return inset(0.2, 0.08);
    case "rightArrow":
    case "leftArrow":
    case "leftRightArrow":
      return inset(0.12, 0.25);
    case "upArrow":
    case "downArrow":
    case "upDownArrow":
      return inset(0.25, 0.12);
    case "flowChartDocument":
      return { x: 0, y: 0, w, h: h * 0.83 };
    default:
      return { x: 0, y: 0, w, h };
  }
}
