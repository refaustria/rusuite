// Hand-written `Document` fixtures and small builders for the sync tests.

import type { Block } from "../generated/Block";
import type { Document } from "../generated/Document";
import type { Inline } from "../generated/Inline";
import type { LevelKind } from "../generated/LevelKind";
import type { NumberingDef } from "../generated/NumberingDef";
import type { ParagraphProperties } from "../generated/ParagraphProperties";
import type { RunProperties } from "../sync/model";
import template from "./newDocument.json";

export const run = (text: string, props?: RunProperties): Inline => ({ kind: "run", value: props ? { props, text } : { text } });

export function para(id: number, content: string | Inline[] = "", props?: ParagraphProperties): Block {
  const inlines = typeof content === "string" ? (content ? [run(content)] : []) : content;
  return { kind: "paragraph", value: props ? { id, props, inlines } : { id, inlines } };
}

export const li = (id: number, text: string, numId: number, level = 0, props: ParagraphProperties = {}) =>
  para(id, text, { ...props, numbering: { numId, level } });

export function numberingDef(id: number, kinds: LevelKind[]): NumberingDef {
  return {
    id,
    levels: Array.from({ length: 9 }, (_, i) => {
      const kind = kinds[i % kinds.length]!;
      return {
        kind,
        text: kind === "bullet" ? "•" : `%${i + 1}.`,
        start: 1,
        indent: { left: 720 * (i + 1), hanging: 360 },
      };
    }),
  };
}

export const BULLET_DEF = numberingDef(1, ["bullet"]);
export const DECIMAL_DEF = numberingDef(2, ["decimal", "lowerLetter", "lowerRoman"]);

export function makeDoc(body: Block[], defs: NumberingDef[] = [BULLET_DEF, DECIMAL_DEF]): Document {
  const t = structuredClone(template) as unknown as Document;
  return { ...t, body, numbering: { defs }, media: [{ id: 1, contentType: "image/png", data: PNG_1PX }] };
}

/** A 1×1 transparent PNG. */
export const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const bold: RunProperties = { bold: true };

export const FIXTURES: Record<string, Document> = {
  headings: makeDoc([
    para(1, "Document title", { style: "Title" }),
    para(2, "Chapter", { style: "Heading1" }),
    para(3, "Section", { style: "Heading2", alignment: "center" }),
    para(4, "Deep", { style: "Heading6" }),
    para(5, "Body text", { indent: { left: 360, firstLine: 240 }, spacing: { before: 120, line: { kind: "multiple", value: 1.5 } } }),
    para(6, "Quote", { style: "ListParagraph", keepNext: true }),
  ]),
  lists3: makeDoc([
    para(1, "Before"),
    li(2, "one", 1, 0),
    li(3, "one.a", 1, 1),
    li(4, "one.a.i", 1, 2),
    li(5, "two", 1, 0),
    li(6, "first", 2, 0),
    li(7, "first.a", 2, 1),
    li(8, "jump", 2, 3),
    li(9, "second", 2, 0),
    para(10, "Between"),
    li(11, "starts deep", 1, 1),
    li(12, "numbered heading", 2, 0, { style: "Heading1" }),
    para(13, "Not numbered", { numbering: { numId: 0, level: 0 } }),
  ]),
  table: makeDoc([
    para(1, "Above"),
    {
      kind: "table",
      value: {
        id: 2,
        props: {
          colWidths: [4513, 4513],
          borders: { top: { style: "single", width: 10, color: { kind: "auto" } } },
        },
        rows: [
          {
            id: 3,
            props: { header: true },
            cells: [
              { id: 4, props: { shading: { kind: "rgb", value: "FFFF00" } }, blocks: [para(5, "A1", { alignment: "right" })] },
              { id: 6, props: { width: { kind: "twips", value: 4513 }, verticalAlign: "center" }, blocks: [para(7, "B1")] },
            ],
          },
          {
            id: 8,
            cells: [
              { id: 9, blocks: [li(10, "in cell", 1, 0), para(11, "")] },
              { id: 12, blocks: [para(13, [run("x", bold), run("y")])] },
            ],
          },
        ],
      },
    },
    para(14, ""),
  ]),
  image: makeDoc([
    para(1, [
      run("Look: "),
      { kind: "image", value: { media: 1, width: 952500, height: 476250, alt: "logo", name: "Picture 1" } },
      run(" done"),
    ]),
    para(2, [{ kind: "image", value: { media: 1, width: 9525, height: 9525 } }]),
  ]),
  breaks: makeDoc([
    para(1, [run("line one"), { kind: "break", value: "line" }, run("line two"), { kind: "break", value: "page" }, run("next page")]),
    para(2, [{ kind: "break", value: "page" }]),
    para(3, "tab\there"),
  ]),
  marks: makeDoc([
    para(1, [
      run("plain "),
      run("bold", bold),
      run("bolditalic", { bold: true, italic: true }),
      run("u2", { underline: "double" }),
      run("nou", { underline: "none" }),
      run("strike", { strike: true }),
      run("sup", { verticalAlign: "superscript" }),
      run("sub", { verticalAlign: "subscript", size: 800 }),
      run("base", { verticalAlign: "baseline" }),
      run("font", { font: { kind: "named", value: "Georgia" }, size: 1400, color: { kind: "rgb", value: "FF0000" } }),
      run("theme", { font: { kind: "theme", value: "majorLatin" }, color: { kind: "theme", value: { slot: "accent1", tint: -0.25 } } }),
      run("hl", { highlight: { kind: "rgb", value: "FFFF00" } }),
      run("notbold", { bold: false, italic: false, strike: false }),
      run("emoji 😀 é"),
    ]),
    para(2, [run("run defaults")], { runDefaults: { bold: true }, pageBreakBefore: true }),
  ]),
};
