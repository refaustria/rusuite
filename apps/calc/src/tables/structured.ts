// Structured references on the UI side (P8-35): what a `Table1[...]`
// token means (for the reference colours in the formula editor), and the
// autocomplete of column names and special items after `[`. The core
// (engine-formula `structured`) is the authority; this is a reader for
// display only.

import type { Range } from "../grid/Selection";
import type { Table } from "../generated/Table";
import { dataRows } from "./styles";
import { escapeColumn, needsBrackets } from "./controller";

export interface StructSpec {
  /** The table as written; `null` = the table holding the formula. */
  table: string | null;
  items: string[];
  columns: [string, string | null] | null;
  thisRow: boolean;
}

const KEYWORDS = ["#All", "#Data", "#Headers", "#Totals", "#This Row"];

/** Splits `[a],[b]:[c]` into bracket contents (`'` escapes) and `:` markers. */
function parts(s: string): (string | ":")[] | null {
  const out: (string | ":")[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i]!;
    if (c === "[") {
      let name = "";
      i++;
      while (i < s.length && s[i] !== "]") {
        if (s[i] === "'") i++;
        name += s[i] ?? "";
        i++;
      }
      if (s[i] !== "]") return null;
      out.push(name);
      i++;
    } else if (c === ":") {
      out.push(":");
      i++;
    } else if (c === "," || c === " ") i++;
    else return null;
  }
  return out;
}

const unescape = (s: string) => s.replace(/'(.)/g, "$1");

/** Reads a structured reference token's text (`Table1[[#Headers],[Qty]]`, `[@Qty]`); `null` when malformed. */
export function parseStruct(text: string): StructSpec | null {
  const open = text.indexOf("[");
  if (open < 0 || !text.endsWith("]")) return null;
  const table = open > 0 ? text.slice(0, open) : null;
  const inner = text.slice(open + 1, -1).trim();
  const spec: StructSpec = { table, items: [], columns: null, thisRow: false };
  if (inner === "") return spec;
  if (inner.startsWith("@")) {
    spec.thisRow = true;
    const rest = inner.slice(1).trim();
    if (rest === "") return spec;
    if (rest.startsWith("[")) {
      const p = parts(rest);
      if (!p || typeof p[0] !== "string") return null;
      spec.columns = [p[0], p[1] === ":" && typeof p[2] === "string" ? p[2] : null];
    } else spec.columns = [unescape(rest), null];
    return spec;
  }
  if (!inner.startsWith("[")) {
    if (inner.startsWith("#")) spec.items.push(inner);
    else spec.columns = [unescape(inner), null];
    return spec;
  }
  const p = parts(inner);
  if (!p) return null;
  const cols: (string | ":")[] = [];
  for (const x of p) {
    if (typeof x === "string" && x.startsWith("#")) spec.items.push(x);
    else cols.push(x);
  }
  if (cols.length === 1 && typeof cols[0] === "string") spec.columns = [cols[0], null];
  else if (cols.length === 3 && cols[1] === ":" && typeof cols[0] === "string" && typeof cols[2] === "string") spec.columns = [cols[0], cols[2]];
  else if (cols.length) return null;
  if (spec.items.some((i) => i.toLowerCase().replace(/\s+/g, " ") === "#this row")) spec.thisRow = true;
  return spec;
}

/** The cells `spec` means in table `t` for a formula on row `row` (`null`: unknown column, missing part). */
export function structRange(t: Table, spec: StructSpec, row: number): Range | null {
  const col = (name: string) => {
    const i = t.columns.findIndex((c) => c.name.toLowerCase() === name.toLowerCase());
    return i < 0 ? null : t.c0 + i;
  };
  let c0 = t.c0, c1 = t.c1;
  if (spec.columns) {
    const a = col(spec.columns[0]);
    const b = spec.columns[1] === null ? a : col(spec.columns[1]);
    if (a === null || b === null) return null;
    [c0, c1] = [Math.min(a, b), Math.max(a, b)];
  }
  const [d0, d1] = dataRows(t);
  if (spec.thisRow) return row >= d0 && row <= d1 ? { r0: row, c0, r1: row, c1 } : null;
  const has = (k: string) => spec.items.some((i) => i.toLowerCase() === k.toLowerCase());
  if (has("#All")) return { r0: t.r0, c0, r1: t.r1, c1 };
  const data = spec.items.length === 0 || has("#Data");
  const head = has("#Headers");
  const tot = has("#Totals");
  if ((head && !t.headerRow) || (tot && !t.totalsRow)) return null;
  const r0 = head ? t.r0 : data ? d0 : t.r1;
  const r1 = tot ? t.r1 : data ? d1 : t.r0;
  return { r0, c0, r1, c1 };
}

/** An open `[` before the caret: the table (as written, or `null`), whether `@` follows, and the typed prefix. */
export function structCompletion(text: string, caret: number): { table: string | null; thisRow: boolean; prefix: string; start: number; end: number } | null {
  const before = text.slice(0, caret);
  const m = /([\p{L}_\\][\p{L}\p{N}_.\\?]*)?\[(?:\[)?(@\[?)?([^[\]]*)$/u.exec(before);
  if (!m || !before.startsWith("=")) return null;
  // Not inside a string literal.
  if ((before.slice(0, m.index).match(/"/g)?.length ?? 0) % 2 === 1) return null;
  const prefix = m[3] ?? "";
  return { table: m[1] ?? null, thisRow: !!m[2], prefix, start: caret - prefix.length, end: caret };
}

/** The entries of the `[` autocomplete: the columns (and, outside `@`, the special items) matching `prefix`. */
export function structItems(columns: readonly string[], prefix: string, thisRow: boolean): string[] {
  const p = prefix.toLowerCase();
  const cols = columns.filter((c) => c.toLowerCase().startsWith(p));
  return thisRow ? cols : [...cols, ...KEYWORDS.filter((k) => k.toLowerCase().startsWith(p))];
}

/** The text an accepted entry inserts (the closing bracket included). */
export function structInsert(entry: string, thisRow: boolean, insideInner: boolean): string {
  if (entry.startsWith("#")) return `${entry}]`;
  if (thisRow && !insideInner && needsBrackets(entry)) return `[${escapeColumn(entry)}]]`;
  return `${escapeColumn(entry)}]`;
}
