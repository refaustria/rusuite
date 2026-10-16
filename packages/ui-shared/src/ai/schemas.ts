// The structured results of the actions: one strict JSON schema each (Anthropic tool / OpenAI response format) and
// a parser that validates what came back again (a model may still send something else; nothing invalid is applied).

import type { AiTool, JsonSchema } from "./types";
import { AiError } from "./types";

const obj = (properties: Record<string, JsonSchema>): JsonSchema => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const strArr = (description?: string): JsonSchema => ({ type: "array", items: { type: "string" }, ...(description ? { description } : {}) });

const bad = (what: string): never => {
  throw new AiError("badResponse", `The model's answer is not a valid ${what}`);
};
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown, what: string, allowEmpty = true): string => {
  if (typeof v !== "string" || (!allowEmpty && !v.trim())) bad(what);
  return v as string;
};
const strings = (v: unknown, what: string): string[] => {
  if (!Array.isArray(v) || !v.every((s) => typeof s === "string")) bad(what);
  return v as string[];
};

// --- Calc ----------------------------------------------------------------------

export interface FormulaResult {
  formula: string;
  explanation: string;
}

export const FORMULA_TOOL: AiTool = {
  name: "insert_formula",
  description: "A spreadsheet formula for the active cell and a short explanation of it.",
  schema: obj({
    formula: { type: "string", description: "The formula, starting with =, in English function names with comma separators and A1 references (e.g. =SUM(B2:B10))." },
    explanation: { type: "string", description: "One or two sentences explaining what the formula does." },
  }),
};

export function parseFormula(v: unknown): FormulaResult {
  if (!isObj(v)) bad("formula");
  const o = v as Record<string, unknown>;
  let formula = text(o.formula, "formula", false).trim();
  if (!formula.startsWith("=")) formula = `=${formula}`;
  return { formula, explanation: text(o.explanation ?? "", "formula") };
}

export interface RangeResult {
  /** Rows of cell inputs: text, numbers as text, formulas starting with `=`; `""` leaves the cell empty. */
  values: string[][];
  explanation: string;
}

export const MAX_RANGE_CELLS = 10_000;

export const RANGE_TOOL: AiTool = {
  name: "write_range",
  description: "The transformed cells as rows of cell inputs.",
  schema: obj({
    values: {
      type: "array",
      description: "Rows of cells, top to bottom. Each cell is its input: plain text, a number written as text (e.g. 12.5), or a formula starting with =. Use an empty string for an empty cell.",
      items: strArr(),
    },
    explanation: { type: "string", description: "One sentence describing the change." },
  }),
};

export function parseRange(v: unknown): RangeResult {
  if (!isObj(v)) bad("range");
  const o = v as Record<string, unknown>;
  if (!Array.isArray(o.values) || o.values.length === 0) bad("range");
  const values = (o.values as unknown[]).map((row) => {
    if (!Array.isArray(row)) bad("range");
    return (row as unknown[]).map((c) =>
      c === null ? "" : typeof c === "boolean" ? (c ? "TRUE" : "FALSE") : typeof c === "number" ? String(c) : text(c, "range"),
    );
  });
  const cells = values.reduce((n, r) => n + r.length, 0);
  if (cells === 0) bad("range");
  if (cells > MAX_RANGE_CELLS) throw new AiError("badResponse", `The answer has ${cells} cells; at most ${MAX_RANGE_CELLS} are applied`);
  return { values, explanation: text(o.explanation ?? "", "range") };
}

export interface ChartResult {
  preset: string;
  /** The data range in A1 notation (`A1:C7`). */
  range: string;
  title: string;
  reason: string;
}

export function chartTool(presets: readonly string[]): AiTool {
  return {
    name: "suggest_chart",
    description: "The chart that fits the data best.",
    schema: obj({
      preset: { type: "string", enum: [...presets], description: "Chart type." },
      range: { type: "string", description: "The data range including headers, in A1 notation (e.g. A1:C7), without the sheet name." },
      title: { type: "string", description: "A short chart title." },
      reason: { type: "string", description: "One sentence why this chart fits." },
    }),
  };
}

export function parseChart(v: unknown, presets: readonly string[]): ChartResult {
  if (!isObj(v)) bad("chart suggestion");
  const o = v as Record<string, unknown>;
  const preset = text(o.preset, "chart suggestion");
  if (!presets.includes(preset)) bad("chart type");
  const range = text(o.range, "chart suggestion", false).trim().replace(/^=/, "").replace(/\$/g, "").toUpperCase();
  if (!/^[A-Z]{1,3}\d+(:[A-Z]{1,3}\d+)?$/.test(range)) bad("chart range");
  return { preset, range, title: text(o.title ?? "", "chart suggestion"), reason: text(o.reason ?? "", "chart suggestion") };
}

// --- Show ----------------------------------------------------------------------

export interface OutlineSlide {
  title: string;
  bullets: string[];
  notes: string;
}

export const MAX_SLIDES = 40;

export const SLIDES_TOOL: AiTool = {
  name: "create_slides",
  description: "Slides to add to the presentation.",
  schema: obj({
    slides: {
      type: "array",
      description: "The slides in order.",
      items: obj({
        title: { type: "string", description: "Slide title, plain text." },
        bullets: strArr("Bullet points, plain text without list markers (3 to 6 short lines)."),
        notes: { type: "string", description: "Speaker notes for the slide (plain text, may be empty)." },
      }),
    },
  }),
};

export function parseSlides(v: unknown): OutlineSlide[] {
  if (!isObj(v) || !Array.isArray((v as Record<string, unknown>).slides)) bad("slide outline");
  const slides = ((v as Record<string, unknown>).slides as unknown[]).map((s) => {
    if (!isObj(s)) bad("slide");
    const o = s as Record<string, unknown>;
    return {
      title: text(o.title, "slide title").trim(),
      bullets: strings(o.bullets ?? [], "bullet list").map((b) => b.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim()).filter(Boolean),
      notes: text(o.notes ?? "", "speaker notes").trim(),
    };
  });
  if (!slides.length) bad("slide outline");
  if (slides.length > MAX_SLIDES) throw new AiError("badResponse", `The answer has ${slides.length} slides; at most ${MAX_SLIDES} are added`);
  return slides;
}

export interface LayoutResult {
  layout: string;
  reason: string;
}

export function layoutTool(layouts: readonly { id: string; name: string }[]): AiTool {
  return {
    name: "choose_layout",
    description: "The slide layout of this presentation that fits the slide's content best.",
    schema: obj({
      layout: { type: "string", enum: layouts.map((l) => l.id), description: `One of: ${layouts.map((l) => `${l.id} (${l.name})`).join(", ")}.` },
      reason: { type: "string", description: "One sentence why." },
    }),
  };
}

export function parseLayout(v: unknown, layouts: readonly { id: string }[]): LayoutResult {
  if (!isObj(v)) bad("layout");
  const o = v as Record<string, unknown>;
  const layout = text(o.layout, "layout");
  if (!layouts.some((l) => l.id === layout)) bad("layout of this presentation");
  return { layout, reason: text(o.reason ?? "", "layout") };
}

// --- Write ---------------------------------------------------------------------

export interface TableResult {
  /** Rows of cell texts; the first row is the header when `header`. */
  rows: string[][];
  header: boolean;
}

export const MAX_TABLE_CELLS = 2_000;

export const TABLE_TOOL: AiTool = {
  name: "insert_table",
  description: "A table built from the text.",
  schema: obj({
    header: { type: "boolean", description: "Whether the first row holds column headings." },
    rows: { type: "array", description: "Rows of cell texts (plain text), all with the same number of cells.", items: strArr() },
  }),
};

export function parseTable(v: unknown): TableResult {
  if (!isObj(v)) bad("table");
  const o = v as Record<string, unknown>;
  if (!Array.isArray(o.rows) || o.rows.length === 0) bad("table");
  const rows = (o.rows as unknown[]).map((r) => strings(r, "table row").map((c) => c.trim()));
  const cols = Math.max(...rows.map((r) => r.length));
  if (cols === 0) bad("table");
  if (rows.length * cols > MAX_TABLE_CELLS) throw new AiError("badResponse", `The table has ${rows.length * cols} cells; at most ${MAX_TABLE_CELLS} are inserted`);
  return { rows: rows.map((r) => [...r, ...Array<string>(cols - r.length).fill("")]), header: o.header === true };
}

export type DraftBlock = { kind: "heading"; level: number; text: string } | { kind: "paragraph"; text: string };

export const MAX_DRAFT_BLOCKS = 200;

export const DRAFT_TOOL: AiTool = {
  name: "insert_draft",
  description: "The drafted section as headings and paragraphs.",
  schema: obj({
    blocks: {
      type: "array",
      description: "The draft in order: headings (level 1 to 3) and paragraphs, plain text without Markdown.",
      items: obj({
        kind: { type: "string", enum: ["heading", "paragraph"] },
        level: { type: "integer", description: "Heading level 1-3 (ignored for paragraphs; use 0)." },
        text: { type: "string" },
      }),
    },
  }),
};

export function parseDraft(v: unknown): DraftBlock[] {
  if (!isObj(v) || !Array.isArray((v as Record<string, unknown>).blocks)) bad("draft");
  const blocks = ((v as Record<string, unknown>).blocks as unknown[]).flatMap((b): DraftBlock[] => {
    if (!isObj(b)) bad("draft");
    const o = b as Record<string, unknown>;
    const t = text(o.text, "draft").trim();
    if (!t) return [];
    if (o.kind === "heading") {
      const level = typeof o.level === "number" ? Math.min(3, Math.max(1, Math.round(o.level))) : 1;
      return [{ kind: "heading", level, text: t }];
    }
    return [{ kind: "paragraph", text: t }];
  });
  if (!blocks.length) bad("draft");
  if (blocks.length > MAX_DRAFT_BLOCKS) throw new AiError("badResponse", `The draft has ${blocks.length} blocks; at most ${MAX_DRAFT_BLOCKS} are inserted`);
  return blocks;
}
