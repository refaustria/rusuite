// Defined names in the UI (pure): validation (a port of
// `engine_formula::ast::is_valid_name`), lookup by scope, the Name Box /
// Go To parsing, the reference text of a selection, the Name Manager's
// filter and the name spans of formula text (autocomplete, colouring).

import type { NameInfo } from "../generated/NameInfo";
import type { SheetInfo } from "../generated/SheetInfo";
import type { Range } from "../grid/Selection";
import { rangeFormula } from "../charts/refs";
import { lettersToCol, MAX_COL, MAX_ROW, parseRow } from "../formula/refs";
import { tokenize } from "../formula/tokenize";

/** `true` when `s` reads as an A1 cell reference (`B7`, `$A$1`, `xfd1048576`). */
export function isCellReference(s: string): boolean {
  const m = /^\$?([A-Za-z]{1,3})\$?([0-9]+)$/.exec(s);
  if (!m) return false;
  const col = lettersToCol(m[1]!);
  return col !== null && col <= MAX_COL && parseRow(m[2]!) !== null;
}

/** Why `name` cannot be a defined name (an i18n key), or `null` when it can. */
export function nameProblem(name: string): string | null {
  if (name.length === 0) return "calc.names.err.empty";
  if ([...name].length > 255) return "calc.names.err.long";
  if (/\s/u.test(name)) return "calc.names.err.space";
  if (!/^[\p{L}_\\]/u.test(name)) return "calc.names.err.start";
  if (!/^[\p{L}_\\][\p{L}\p{N}_.\\?]*$/u.test(name)) return "calc.names.err.chars";
  const upper = name.toUpperCase();
  if (upper === "TRUE" || upper === "FALSE") return "calc.names.err.reserved";
  if (isCellReference(name) || upper === "R" || upper === "C" || /^R[0-9]*C?[0-9]*$/.test(upper) || /^C[0-9]+$/.test(upper)) {
    return "calc.names.err.reference";
  }
  return null;
}

export const isValidName = (name: string) => nameProblem(name) === null;

const fold = (s: string) => s.toLowerCase();

/** The name `name` as a formula on `sheet` sees it: the sheet's own name first, then the workbook's. */
export function resolveName(names: readonly NameInfo[], name: string, sheet: number): NameInfo | undefined {
  const n = fold(name);
  return names.find((x) => x.sheet === sheet && fold(x.name) === n) ?? names.find((x) => x.sheet === undefined && fold(x.name) === n);
}

/** The name of exactly that scope (`sheet` undefined = workbook). */
export function findName(names: readonly NameInfo[], name: string, sheet: number | undefined): NameInfo | undefined {
  const n = fold(name);
  return names.find((x) => x.sheet === sheet && fold(x.name) === n);
}

/** The names the Name Box lists on `sheet`: visible ones with a range, workbook names and the sheet's own, sorted. */
export function nameBoxNames(names: readonly NameInfo[], sheet: number): NameInfo[] {
  return names
    .filter((n) => !n.hidden && n.range && (n.sheet === undefined || n.sheet === sheet))
    .sort((a, b) => fold(a.name).localeCompare(fold(b.name)));
}

/** The names a formula on `sheet` can use (autocomplete, Use in Formula): visible, the sheet's own shadowing the workbook's. */
export function formulaNames(names: readonly NameInfo[], sheet: number): NameInfo[] {
  const own = names.filter((n) => !n.hidden && n.sheet === sheet);
  const global = names.filter((n) => !n.hidden && n.sheet === undefined && !own.some((o) => fold(o.name) === fold(n.name)));
  return [...own, ...global].sort((a, b) => fold(a.name).localeCompare(fold(b.name)));
}

export interface GoToTarget {
  sheet: number;
  range: Range;
}

/**
 * What the Name Box / Go To navigates to for `text`: a name (the
 * sheet's own first), a cell or range reference (`B7`, `A1:C3`, `A:A`,
 * `3:5`, `Sheet2!B2`). `null` when `text` is neither.
 */
export function goToTarget(text: string, names: readonly NameInfo[], sheets: readonly SheetInfo[], activeSheet: number): GoToTarget | null {
  const t = text.trim().replace(/^=/, "");
  if (t === "") return null;
  const named = resolveName(names, t, activeSheet);
  if (named?.range) return { sheet: named.range.sheet, range: { r0: named.range.r0, c0: named.range.c0, r1: named.range.r1, c1: named.range.c1 } };
  let sheet = activeSheet;
  let body = t;
  const bang = /^(?:'((?:[^']|'')+)'|([^'!]+))!(.+)$/.exec(t);
  if (bang) {
    const name = bang[1] !== undefined ? bang[1].replace(/''/g, "'") : bang[2]!;
    const s = sheets.find((x) => fold(x.name) === fold(name));
    if (!s) return null;
    sheet = s.id;
    body = bang[3]!;
    const local = findName(names, body, s.id);
    if (local?.range) return { sheet: local.range.sheet, range: { r0: local.range.r0, c0: local.range.c0, r1: local.range.r1, c1: local.range.c1 } };
  }
  const plain = body.replace(/\$/g, "");
  const area = /^([A-Za-z]{1,3})([0-9]+)(?::([A-Za-z]{1,3})([0-9]+))?$/.exec(plain);
  if (area) {
    const c0 = lettersToCol(area[1]!);
    const r0 = parseRow(area[2]!);
    const c1 = area[3] ? lettersToCol(area[3]) : c0;
    const r1 = area[4] ? parseRow(area[4]) : r0;
    if (c0 === null || c1 === null || r0 === null || r1 === null || c0 > MAX_COL || c1 > MAX_COL) return null;
    return { sheet, range: { r0: Math.min(r0, r1), c0: Math.min(c0, c1), r1: Math.max(r0, r1), c1: Math.max(c0, c1) } };
  }
  const cols = /^([A-Za-z]{1,3}):([A-Za-z]{1,3})$/.exec(plain);
  if (cols) {
    const a = lettersToCol(cols[1]!);
    const b = lettersToCol(cols[2]!);
    if (a === null || b === null || a > MAX_COL || b > MAX_COL) return null;
    return { sheet, range: { r0: 0, c0: Math.min(a, b), r1: MAX_ROW, c1: Math.max(a, b) } };
  }
  const rows = /^([0-9]+):([0-9]+)$/.exec(plain);
  if (rows) {
    const a = parseRow(rows[1]!);
    const b = parseRow(rows[2]!);
    if (a === null || b === null) return null;
    return { sheet, range: { r0: Math.min(a, b), c0: 0, r1: Math.max(a, b), c1: MAX_COL } };
  }
  return null;
}

/** `=Sheet1!$A$1:$B$4` for a range of the named sheet (the Define Name dialog's default). */
export function refersToText(sheetName: string, r: Range): string {
  return `=${rangeFormula({ sheet: sheetName, r0: r.r0, c0: r.c0, r1: r.r1, c1: r.c1 })}`;
}

export type NameFilter = "all" | "workbook" | "sheet" | "errors" | "noErrors" | "defined" | "table";

/** The Name Manager's Filter ▾: names scoped to the workbook / a worksheet, with / without errors. */
export function filterNames<T extends { sheet?: number; value: string; builtin?: unknown }>(rows: readonly T[], filter: NameFilter): T[] {
  const isError = (v: string) => /^#[A-Z/0!?]+[!?A]?$/.test(v) || v.startsWith("#");
  switch (filter) {
    case "workbook":
      return rows.filter((r) => r.sheet === undefined);
    case "sheet":
      return rows.filter((r) => r.sheet !== undefined);
    case "errors":
      return rows.filter((r) => isError(r.value));
    case "noErrors":
      return rows.filter((r) => !isError(r.value));
    case "defined":
      return rows.filter((r) => !r.builtin);
    default:
      return [...rows];
  }
}

export interface NameSpan {
  start: number;
  end: number;
  /** The qualifying sheet (`Sheet1!Tax`), `null` = none. */
  sheet: string | null;
  name: string;
}

/**
 * The identifiers of a formula that can be defined names: not function
 * calls, not references, not `TRUE`/`FALSE`, optionally sheet-qualified.
 */
export function nameSpans(text: string): NameSpan[] {
  const { tokens } = tokenize(text);
  const out: NameSpan[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.kind !== "ident") continue;
    if (tokens[i + 1]?.kind === "lparen" || /^(TRUE|FALSE)$/i.test(t.text) || !isValidName(t.text)) continue;
    // A column letter run (`A` in `A:C`) is not a name.
    if (tokens[i + 1]?.kind === "colon" || tokens[i - 1]?.kind === "colon" || tokens[i - 1]?.kind === "dollar") continue;
    const q = tokens[i - 1]?.kind === "bang" && tokens[i - 2]?.kind === "sheet" ? tokens[i - 2]! : null;
    out.push({ start: q ? q.start : t.start, end: t.end, sheet: q ? q.text : null, name: t.text });
  }
  return out;
}
