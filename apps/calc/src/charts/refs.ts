// Chart data references (pure): `Sheet1!$B$2:$B$5` ↔ ranges, the text the
// Select Data dialog shows and parses, Switch Row/Column.

import type { Chart } from "../generated/Chart";
import type { DataRef } from "../generated/DataRef";
import type { Series } from "../generated/Series";
import type { TextSource } from "../generated/TextSource";
import { colName, sheetPrefix } from "../grid/address";
import { lettersToCol } from "../formula/refs";

export interface SheetRange {
  /** Sheet name (unquoted); `null` = no sheet in the reference. */
  sheet: string | null;
  r0: number;
  c0: number;
  r1: number;
  c1: number;
}

/** Parses `Sheet!$A$1:$B$4`, `'My sheet'!A1`, `A1:B2` (no whole rows/columns, no unions). */
export function parseRange(formula: string): SheetRange | null {
  const f = formula.trim().replace(/^=/, "");
  const m = /^(?:(?:'((?:[^']|'')+)'|([^'!:]+))!)?\$?([A-Za-z]{1,3})\$?(\d+)(?::\$?([A-Za-z]{1,3})\$?(\d+))?$/.exec(f);
  if (!m) return null;
  const sheet = m[1] !== undefined ? m[1].replace(/''/g, "'") : (m[2] ?? null);
  const c0 = lettersToCol(m[3]!.toUpperCase());
  const r0 = Number(m[4]) - 1;
  const c1 = m[5] ? lettersToCol(m[5].toUpperCase()) : c0;
  const r1 = m[6] ? Number(m[6]) - 1 : r0;
  if (c0 === null || c1 === null || r0 < 0 || r1 < 0) return null;
  return { sheet, r0: Math.min(r0, r1), c0: Math.min(c0, c1), r1: Math.max(r0, r1), c1: Math.max(c0, c1) };
}

/** `Sheet1!$B$2:$B$5` (a single cell without the `:` part). */
export function rangeFormula(r: SheetRange): string {
  const cell = (row: number, col: number) => `$${colName(col)}$${row + 1}`;
  const body = r.r0 === r.r1 && r.c0 === r.c1 ? cell(r.r0, r.c0) : `${cell(r.r0, r.c0)}:${cell(r.r1, r.c1)}`;
  return `${r.sheet ? sheetPrefix(r.sheet) : ""}${body}`;
}

const literalText = (v: unknown) => (typeof v === "string" ? `"${v.replace(/"/g, '""')}"` : v === null ? "" : String(v));

/** Dialog text of a data reference: `=Sheet1!$B$2:$B$5` or `={1,2,3}`. */
export function dataRefText(r: DataRef | undefined | null): string {
  if (!r) return "";
  return r.type === "ref" ? `=${r.formula}` : `={${r.values.map(literalText).join(",")}}`;
}

/** Parses dialog text back: `=ref`, `={…}` / `1,2,3` literals; blank → `null`. */
export function parseDataRef(text: string): DataRef | null {
  const t = text.trim();
  if (!t || t === "=") return null;
  const lit = /^=?\{(.*)\}$/.exec(t) ?? (/^[-+\d.,\s"]+$/.test(t) && !t.startsWith("=") ? [t, t] : null);
  if (lit) {
    const values = lit[1]!.split(",").map((s) => {
      const v = s.trim();
      if (v === "") return null;
      if (/^".*"$/.test(v)) return v.slice(1, -1).replace(/""/g, '"');
      const n = Number(v);
      return Number.isFinite(n) ? n : v;
    });
    return { type: "literal", values };
  }
  return { type: "ref", formula: t.replace(/^=/, "") };
}

/** Dialog text of a series name: `=Sheet1!$B$1` or the literal text. */
export function nameText(n: TextSource | undefined): string {
  if (!n) return "";
  return n.type === "ref" ? `=${n.formula}` : n.text;
}

export function parseName(text: string): TextSource | undefined {
  const t = text.trim();
  if (!t) return undefined;
  return t.startsWith("=") && t.length > 1 ? { type: "ref", formula: t.slice(1) } : { type: "literal", text: text };
}

const refRange = (r: DataRef | TextSource | undefined) => (r && r.type === "ref" ? parseRange(r.formula) : null);

/**
 * Switch Row/Column: series that each cover one column of a block become
 * one series per row (and back). Needs every series as a reference on one
 * sheet, the series side by side; names and categories, when present, must
 * be the header row/column of the block. `null` when the data cannot be
 * switched.
 */
export function switchRowCol(chart: Pick<Chart, "series" | "categories">): { series: Series[]; categories: DataRef | null } | null {
  const list = chart.series;
  if (list.length === 0) return null;
  const vals = list.map((s) => refRange(s.values));
  if (vals.some((v) => !v)) return null;
  const ranges = vals as SheetRange[];
  const sheet = ranges[0]!.sheet;
  if (ranges.some((r) => r.sheet !== sheet)) return null;
  const byCols = ranges.every((r) => r.c0 === r.c1 && r.r0 === ranges[0]!.r0 && r.r1 === ranges[0]!.r1);
  const byRows = ranges.every((r) => r.r0 === r.r1 && r.c0 === ranges[0]!.c0 && r.c1 === ranges[0]!.c1);
  const vertical = list.length === 1 ? ranges[0]!.c0 === ranges[0]!.c1 : byCols;
  if (vertical ? !byCols : !byRows) return null;
  // Positions of the series along the other axis must be consecutive.
  const pos = ranges.map((r) => (vertical ? r.c0 : r.r0));
  for (let i = 1; i < pos.length; i++) if (pos[i] !== pos[0]! + i) return null;
  const first = ranges[0]!;
  const cats = refRange(chart.categories ?? undefined);
  const names = list.map((s) => refRange(s.name));
  const kindOf = (i: number) => list[Math.min(i, list.length - 1)]!;
  const keep = (i: number): Partial<Series> => {
    const s = kindOf(i);
    return { ...(s.kind ? { kind: s.kind } : {}), ...(s.axis ? { axis: s.axis } : {}) };
  };
  const series: Series[] = [];
  let categories: DataRef | null = null;
  if (vertical) {
    // Series are columns c = pos[i], rows first.r0..first.r1 → one series per row.
    const c0 = pos[0]!;
    const c1 = pos[pos.length - 1]!;
    for (let r = first.r0; r <= first.r1; r++) {
      const name = cats && cats.c0 === cats.c1 && cats.r0 === first.r0 && cats.r1 === first.r1 ? { type: "ref" as const, formula: rangeFormula({ sheet: cats.sheet, r0: r, c0: cats.c0, r1: r, c1: cats.c0 }) } : undefined;
      series.push({ ...keep(r - first.r0), ...(name ? { name } : {}), values: { type: "ref", formula: rangeFormula({ sheet, r0: r, c0, r1: r, c1 }) } });
    }
    if (names.every((n) => n && n.r0 === n.r1 && n.c0 === n.c1 && n.r0 === names[0]!.r0) && names.every((n, i) => n!.c0 === pos[i])) {
      categories = { type: "ref", formula: rangeFormula({ sheet: names[0]!.sheet, r0: names[0]!.r0, c0, r1: names[0]!.r0, c1 }) };
    }
  } else {
    const r0 = pos[0]!;
    const r1 = pos[pos.length - 1]!;
    for (let c = first.c0; c <= first.c1; c++) {
      const name = cats && cats.r0 === cats.r1 && cats.c0 === first.c0 && cats.c1 === first.c1 ? { type: "ref" as const, formula: rangeFormula({ sheet: cats.sheet, r0: cats.r0, c0: c, r1: cats.r0, c1: c }) } : undefined;
      series.push({ ...keep(c - first.c0), ...(name ? { name } : {}), values: { type: "ref", formula: rangeFormula({ sheet, r0, c0: c, r1, c1: c }) } });
    }
    if (names.every((n) => n && n.r0 === n.r1 && n.c0 === n.c1 && n.c0 === names[0]!.c0) && names.every((n, i) => n!.r0 === pos[i])) {
      categories = { type: "ref", formula: rangeFormula({ sheet: names[0]!.sheet, r0, c0: names[0]!.c0, r1, c1: names[0]!.c0 }) };
    }
  }
  return { series, categories };
}

/** The block a chart's data covers (series, names and categories), for highlighting / Chart data range. */
export function chartDataRange(chart: Pick<Chart, "series" | "categories">): SheetRange | null {
  const parts = [...chart.series.flatMap((s) => [refRange(s.values), refRange(s.name), refRange(s.categories)]), refRange(chart.categories ?? undefined)].filter(
    (r): r is SheetRange => r !== null,
  );
  if (!parts.length || parts.some((p) => p.sheet !== parts[0]!.sheet)) return null;
  return {
    sheet: parts[0]!.sheet,
    r0: Math.min(...parts.map((p) => p.r0)),
    c0: Math.min(...parts.map((p) => p.c0)),
    r1: Math.max(...parts.map((p) => p.r1)),
    c1: Math.max(...parts.map((p) => p.c1)),
  };
}
