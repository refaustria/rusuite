// A small presentation for tests (shaped like the core's JSON).

import type { BuiltinTheme } from "../generated/BuiltinTheme";
import type { Layout } from "../generated/Layout";
import type { SlideMaster } from "../generated/SlideMaster";
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

const OFFICE_COLORS = ["000000", "FFFFFF", "44546A", "E7E6E6", "4472C4", "ED7D31", "A5A5A5", "FFC000", "5B9BD5", "70AD47", "0563C1", "954F72"];
const HARBOR_COLORS = ["1B2A3A", "FFFFFF", "1F4E79", "DCE6F0", "0F6E8C", "E07A1F", "6B8E23", "C0392B", "7D5BA6", "2E8B57", "0F6E8C", "7D5BA6"];

const fonts = (name: string, major: string, minor: string) => ({
  name, majorLatin: major, minorLatin: minor, majorEastAsian: "", minorEastAsian: "", majorComplexScript: "", minorComplexScript: "",
});

/** Two built-in themes like the core's `getThemes` (Office, Harbor with a gradient background style). */
export const FAKE_THEMES: BuiltinTheme[] = [
  {
    id: "office",
    theme: { name: "Office", colors: { name: "Office", colors: OFFICE_COLORS }, fonts: fonts("Office", "Calibri Light", "Calibri") },
    background: { kind: "style", value: { index: 1001, color: { kind: "theme", value: { slot: "light1", tint: 0 } } } },
  },
  {
    id: "harbor",
    theme: {
      name: "Harbor",
      colors: { name: "Harbor", colors: HARBOR_COLORS },
      fonts: fonts("Harbor", "Georgia", "Verdana"),
      format: {
        name: "Harbor",
        fillStyles: [{ kind: "solid", value: { base: { kind: "placeholder" } } }],
        lineStyles: [],
        effectStyles: [],
        bgFillStyles: [
          { kind: "solid", value: { base: { kind: "placeholder" } } },
          { kind: "solid", value: { base: { kind: "placeholder" }, mods: [{ kind: "tint", value: 95000 }] } },
          {
            kind: "gradient",
            value: {
              stops: [
                { pos: 0, color: { base: { kind: "placeholder" }, mods: [{ kind: "tint", value: 80000 }] } },
                { pos: 1, color: { base: { kind: "placeholder" }, mods: [{ kind: "shade", value: 60000 }] } },
              ],
              angleDeg: 90,
              shape: "linear",
              rotateWithShape: true,
            },
          },
        ],
      },
    },
    background: { kind: "style", value: { index: 1001, color: { kind: "theme", value: { slot: "light2", tint: 0 } } } },
  },
];

const hfDef = (kind: "dateTime" | "footer" | "slideNumber", x: number, idx: number) => ({
  kind, idx, transform: { x, y: 6356350, w: 2743200, h: 365125 }, bodyDefaults: bp("middle"), runDefaults: { size: 1200, color: { kind: "theme" as const, value: { slot: "dark1" as const, tint: 0.5 } } }, paragraphDefaults: {},
});

/** The master of the design tests: white background, a decorative accent bar, title/body/footer placeholders. */
export function master(): SlideMaster {
  const level = (pt: number) => ({ run: bodyFont(pt), paragraph: { bullet: { kind: "char" as const, value: "•" } } });
  return {
    background: { kind: "style", value: { index: 1001, color: { kind: "theme", value: { slot: "light1", tint: 0 } } } },
    placeholders: [
      { kind: "title", transform: { x: 838200, y: 365125, w: 10515600, h: 1325563 }, bodyDefaults: bp("middle"), runDefaults: { ...titleFont(44), color: { kind: "theme", value: { slot: "dark1", tint: 0 } } }, paragraphDefaults: { alignment: "left" } },
      { kind: "body", idx: 1, transform: { x: 838200, y: 1825625, w: 10515600, h: 4351338 }, bodyDefaults: bp("top"), runDefaults: bodyFont(28), paragraphDefaults: { bullet: { kind: "char", value: "•" } } },
      hfDef("dateTime", 838200, 10),
      hfDef("footer", 4038600, 11),
      hfDef("slideNumber", 8610600, 12),
    ],
    shapes: [{ ...rect(900, 0, 0), name: "Accent bar", transform: { x: 0, y: 6705600, w: 12192000, h: 152400 } }],
    textStyles: { title: [{ run: titleFont(44) }], body: [level(28), level(24), level(20)], other: [{ run: bodyFont(18) }] },
    colorMap: { bg1: "light1", tx1: "dark1", bg2: "light2", tx2: "dark2" },
    headerFooter: {},
  };
}

/** The fixture with a master, a Two Content layout, footer placeholders on the layouts, a picture slide and two sections. */
export function designFixture(): Presentation {
  const p = fixture();
  p.master = master();
  const footers = [hfDef("dateTime", 838200, 10), hfDef("footer", 4038600, 11), hfDef("slideNumber", 8610600, 12)];
  p.layouts = [
    ...LAYOUTS.map((l) => ({ ...l, placeholders: [...l.placeholders, ...footers] })),
    {
      kind: "twoContent",
      placeholders: [
        LAYOUTS[1].placeholders[0]!,
        { ...LAYOUTS[1].placeholders[1]!, idx: 1, transform: { x: 838200, y: 1825625, w: 5181600, h: 4351338 } },
        { ...LAYOUTS[1].placeholders[1]!, idx: 2, transform: { x: 6172200, y: 1825625, w: 5181600, h: 4351338 } },
        ...footers,
      ],
    },
  ];
  p.media = [{ id: 1, contentType: "image/png", data: "iVBORw0KGgo=" }];
  p.slides.push({
    id: 20,
    layout: "blank",
    shapes: [{
      id: 21, name: "Picture 1", transform: { x: 914400, y: 914400, w: 3657600, h: 2743200 },
      kind: { kind: "picture", value: { media: 1 } }, fill: { kind: "none" }, line: { fill: { kind: "none" }, width: 12700, dash: "solid" },
    }],
  });
  p.sections = [
    { name: "Intro", slideIds: [1, 4] },
    { name: "Body", slideIds: [7, 20] },
  ];
  return p;
}
