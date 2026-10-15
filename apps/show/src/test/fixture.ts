// A small presentation for tests (shaped like the core's JSON).

import type { Layout } from "../generated/Layout";
import type { Presentation } from "../generated/Presentation";
import type { Shape } from "../generated/Shape";
import type { TextBody } from "../generated/TextBody";

export const INSETS = { left: 91440, top: 45720, right: 91440, bottom: 45720 };

export function body(...paras: string[]): TextBody {
  return {
    props: { anchor: "top", wrap: true, insets: INSETS, autofit: "none" },
    paragraphs: paras.map((t) => ({ runs: t ? [{ text: t }] : [] })),
  };
}

export function textShape(id: number, text: string[], extra: Partial<Shape> = {}): Shape {
  return {
    id,
    name: `TextBox ${id}`,
    transform: { x: 914400, y: 914400, w: 4572000, h: 914400, rotationDeg: 0 },
    kind: { kind: "auto", value: { geometry: "rect", text: body(...text) } },
    fill: { kind: "none" },
    line: { fill: { kind: "none" }, width: 12700, dash: "solid" },
    ...extra,
  };
}

export function rect(id: number, x: number, y: number, geometry: "rect" | "ellipse" = "rect"): Shape {
  return {
    id,
    name: `Shape ${id}`,
    transform: { x, y, w: 1828800, h: 1371600, rotationDeg: 0 },
    kind: { kind: "auto", value: { geometry, text: null } },
    fill: { kind: "solid", value: { kind: "rgb", value: "4472C4" } },
    line: { fill: { kind: "none" }, width: 12700, dash: "solid" },
  };
}

const titleFont = (pt: number) => ({ font: { kind: "theme" as const, value: "majorLatin" as const }, size: pt * 100 });
const bodyFont = (pt: number) => ({ font: { kind: "theme" as const, value: "minorLatin" as const }, size: pt * 100 });
const bp = (anchor: "top" | "middle" | "bottom") => ({ anchor, wrap: true, insets: INSETS, autofit: "shrink" as const });

export const LAYOUTS: [Layout, Layout, Layout] = [
  {
    kind: "title",
    placeholders: [
      { kind: "centeredTitle", transform: { x: 1524000, y: 1122363, w: 9144000, h: 2387600 }, bodyDefaults: bp("bottom"), runDefaults: titleFont(60), paragraphDefaults: { alignment: "center" } },
      { kind: "subtitle", transform: { x: 1524000, y: 3602038, w: 9144000, h: 1655762 }, bodyDefaults: bp("top"), runDefaults: bodyFont(24), paragraphDefaults: { alignment: "center", bullet: { kind: "none" } } },
    ],
  },
  {
    kind: "titleContent",
    placeholders: [
      { kind: "title", transform: { x: 838200, y: 365125, w: 10515600, h: 1325563 }, bodyDefaults: bp("middle"), runDefaults: titleFont(44), paragraphDefaults: { alignment: "left" } },
      { kind: "body", transform: { x: 838200, y: 1825625, w: 10515600, h: 4351338 }, bodyDefaults: bp("top"), runDefaults: bodyFont(28), paragraphDefaults: { alignment: "left", bullet: { kind: "char", value: "•" } } },
    ],
  },
  { kind: "blank", placeholders: [] },
];

/** Three slides: title (ids 2–3), title+content (5–6), blank with a rectangle and an ellipse (8–9). */
export function fixture(): Presentation {
  return {
    slideSize: { width: 12192000, height: 6858000 },
    slides: [
      {
        id: 1,
        layout: "title",
        shapes: [
          textShape(2, ["Welcome to Rusuite Show"], { placeholder: "centeredTitle", name: "Title 1" }),
          textShape(3, [""], { placeholder: "subtitle", name: "Subtitle 2" }),
        ],
      },
      {
        id: 4,
        layout: "titleContent",
        shapes: [
          textShape(5, ["Slide two"], { placeholder: "title" }),
          textShape(6, ["First point", "Second point"], { placeholder: "body" }),
        ],
      },
      { id: 7, layout: "blank", shapes: [rect(8, 914400, 914400), rect(9, 6096000, 2743200, "ellipse")] },
    ],
    layouts: LAYOUTS,
    theme: {
      name: "Office Theme",
      colors: {
        name: "Office",
        colors: ["000000", "FFFFFF", "44546A", "E7E6E6", "4472C4", "ED7D31", "A5A5A5", "FFC000", "5B9BD5", "70AD47", "0563C1", "954F72"],
      },
      fonts: {
        name: "Office", majorLatin: "Calibri Light", minorLatin: "Calibri",
        majorEastAsian: "", minorEastAsian: "", majorComplexScript: "", minorComplexScript: "",
      },
    },
    media: [],
  };
}
