// Reference recognition on top of the tokenizer, following the reference
// rules of `engine-formula/src/parser.rs` (`atom`, `second_atom`,
// `reference`): `A1`, `$A$1`, `A1:B2`, `A:C`, `2:4`, each optionally
// `Sheet!` / `'My Sheet'!` qualified, and the spilled-range reference
// `A1#` (the spill range of the array formula in A1).

import { colName } from "../grid/address";
import type { Range } from "../grid/Selection";
import { nameSpans } from "../names/names";
import { tokenize, type LexError, type Tok } from "./tokenize";

export const MAX_COL = 16_383;
export const MAX_ROW = 1_048_575;

export type Atom =
  | { kind: "cell"; col: number; row: number; colAbs: boolean; rowAbs: boolean }
  | { kind: "col"; letters: string; abs: boolean }
  | { kind: "row"; digits: string; abs: boolean };

export interface AtomAt {
  atom: Atom;
  /** Index of the token after the atom. */
  next: number;
}

/** `"A"` → 0; `null` for anything that is not 1+ ASCII letters. */
export function lettersToCol(s: string): number | null {
  if (!/^[A-Za-z]+$/.test(s)) return null;
  let n = 0;
  for (const ch of s.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** 1-based row text → 0-based row, `null` when out of range. */
export function parseRow(digits: string): number | null {
  if (!/^[0-9]+$/.test(digits)) return null;
  const n = Number(digits);
  return n === 0 || n > MAX_ROW + 1 ? null : n - 1;
}

const adjacent = (toks: Tok[], i: number) => i > 0 && i < toks.length && toks[i - 1].end === toks[i].start;

/**
 * Reads a cell/column/row atom at token `i` (as `Parser::atom`). Throws a
 * `LexError`-shaped object for an out-of-range cell, like the parser.
 */
export function atomAt(toks: Tok[], i: number): AtomAt | null {
  let j = i;
  const firstAbs = toks[j]?.kind === "dollar";
  if (firstAbs) {
    j++;
    if (!adjacent(toks, j)) return null;
  }
  const t = toks[j];
  if (!t) return null;
  if (t.kind === "ident") {
    const m = /^[A-Za-z]*/.exec(t.text)![0];
    const rest = t.text.slice(m.length);
    if (m.length === 0 || m.length > 3) return null;
    if (rest === "") {
      const d = toks[j + 1];
      const n = toks[j + 2];
      if (d?.kind === "dollar" && adjacent(toks, j + 1) && n?.kind === "number" && adjacent(toks, j + 2) && /^[0-9]+$/.test(n.text)) {
        return { atom: cell(m, n.text, firstAbs, true, t.start), next: j + 3 };
      }
      if (d?.kind === "lparen") return null;
      return { atom: { kind: "col", letters: m, abs: firstAbs }, next: j + 1 };
    }
    if (!/^[0-9]+$/.test(rest) || toks[j + 1]?.kind === "lparen") return null;
    return { atom: cell(m, rest, firstAbs, false, t.start), next: j + 1 };
  }
  if (t.kind === "number" && /^[0-9]+$/.test(t.text)) {
    return { atom: { kind: "row", digits: t.text, abs: firstAbs }, next: j + 1 };
  }
  return null;
}

function cell(letters: string, digits: string, colAbs: boolean, rowAbs: boolean, pos: number): Atom {
  const col = lettersToCol(letters);
  if (col === null || col > MAX_COL) throw { pos, message: `column \`${letters}\` out of range` } satisfies LexError;
  const row = parseRow(digits);
  if (row === null) throw { pos, message: `row \`${digits}\` out of range` } satisfies LexError;
  return { kind: "cell", col, row, colAbs, rowAbs };
}

export interface RefSpan {
  /** `[start, end)` in the formula text, sheet prefix included. */
  start: number;
  end: number;
  /** Sheet name as written (unquoted), `null` = the formula's own sheet. */
  sheet: string | null;
  kind: "cell" | "area" | "cols" | "rows";
  /** Covered cells (whole columns/rows span the sheet). */
  range: Range;
  a: Atom;
  b: Atom | null;
  /** Source text before the first atom (the sheet prefix) and between the atoms (`:` …). */
  prefix: string;
  middle: string;
  /** Index of the first token after the reference. */
  nextTok: number;
  /** A spilled-range reference `A1#` (`range` is A1 itself until resolved, see `colorRefs`). */
  spill?: boolean;
  /** A defined name (`colorRefs` with a resolver): the name as written; `range` is what it refers to. */
  name?: string;
}

/**
 * Tries to read a whole reference at token `i` (`Parser::reference`, with
 * an optional `sheet` already consumed before `i`). Returns `null` when the
 * tokens do not form a reference; throws `LexError` objects for the
 * parser's hard errors.
 */
export function referenceAt(text: string, toks: Tok[], i: number, sheet: string | null, start: number): RefSpan | null {
  const first = atomAt(toks, i);
  if (!first) return null;
  let second: AtomAt | null = null;
  let secondIdx = -1;
  if (toks[first.next]?.kind === "colon") {
    let k = first.next + 1;
    let ok = true;
    const s2 = toks[k];
    if (s2?.kind === "sheet") {
      if (sheet === null) ok = false;
      else if (sheet.toLowerCase() !== s2.text.toLowerCase()) {
        throw { pos: s2.start, message: "ranges spanning different sheets are not supported" } satisfies LexError;
      } else if (toks[k + 1]?.kind !== "bang") ok = false;
      else k += 2;
    }
    if (ok) {
      second = atomAt(toks, k);
      secondIdx = k;
    }
  }
  const a = first.atom;
  const b = second?.atom;
  let kind: RefSpan["kind"];
  let range: Range;
  let end = first.next;
  if (a.kind === "cell" && b?.kind === "cell") {
    kind = "area";
    range = { r0: Math.min(a.row, b.row), c0: Math.min(a.col, b.col), r1: Math.max(a.row, b.row), c1: Math.max(a.col, b.col) };
    end = second!.next;
  } else if (a.kind === "cell") {
    kind = "cell";
    range = { r0: a.row, c0: a.col, r1: a.row, c1: a.col };
  } else if (a.kind === "col" && b?.kind === "col") {
    const c1 = lettersToCol(a.letters);
    const c2 = lettersToCol(b.letters);
    if (c1 === null || c1 > MAX_COL) throw { pos: toks[i].start, message: `column \`${a.letters}\` out of range` } satisfies LexError;
    if (c2 === null || c2 > MAX_COL) throw { pos: toks[second!.next - 1].start, message: `column \`${b.letters}\` out of range` } satisfies LexError;
    kind = "cols";
    range = { r0: 0, c0: Math.min(c1, c2), r1: MAX_ROW, c1: Math.max(c1, c2) };
    end = second!.next;
  } else if (a.kind === "row" && b?.kind === "row") {
    const r1 = parseRow(a.digits);
    const r2 = parseRow(b.digits);
    if (r1 === null) throw { pos: toks[i].start, message: `row \`${a.digits}\` out of range` } satisfies LexError;
    if (r2 === null) throw { pos: toks[second!.next - 1].start, message: `row \`${b.digits}\` out of range` } satisfies LexError;
    kind = "rows";
    range = { r0: Math.min(r1, r2), c0: 0, r1: Math.max(r1, r2), c1: MAX_COL };
    end = second!.next;
  } else {
    if (sheet !== null) throw { pos: start, message: "expected a cell, column or row reference" } satisfies LexError;
    return null;
  }
  const atomStart = toks[i].start;
  const lastAtomEnd = toks[first.next - 1].end;
  const twoAtoms = kind !== "cell";
  return {
    start,
    end: toks[end - 1].end,
    sheet,
    kind,
    range,
    a,
    b: twoAtoms ? b! : null,
    prefix: text.slice(start, atomStart),
    // `:` plus a repeated sheet prefix, if any.
    middle: twoAtoms ? text.slice(lastAtomEnd, toks[secondIdx].start) : "",
    nextTok: end,
  };
}

/** All references of a formula, left to right (best effort on broken text). */
export function findRefs(text: string): RefSpan[] {
  const { tokens } = tokenize(text);
  const out: RefSpan[] = [];
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    let j = i;
    let sheet: string | null = null;
    if (t.kind === "sheet" && tokens[i + 1]?.kind === "bang") {
      sheet = t.text;
      j = i + 2;
    }
    let ref: RefSpan | null = null;
    try {
      ref = referenceAt(text, tokens, j, sheet, t.start);
    } catch {
      ref = null;
    }
    if (ref) {
      const hash = tokens[ref.nextTok];
      if (ref.kind === "cell" && hash?.kind === "hash" && hash.start === ref.end) {
        ref = { ...ref, end: hash.end, nextTok: ref.nextTok + 1, spill: true };
      }
      out.push(ref);
      i = ref.nextTok;
    } else i++;
  }
  return out;
}

/** Text of an atom with the given anchoring. */
export function atomText(a: Atom): string {
  switch (a.kind) {
    case "cell":
      return `${a.colAbs ? "$" : ""}${colName(a.col)}${a.rowAbs ? "$" : ""}${a.row + 1}`;
    case "col":
      return `${a.abs ? "$" : ""}${a.letters}`;
    case "row":
      return `${a.abs ? "$" : ""}${a.digits}`;
  }
}

/** Reference text for a range: `A1`, `A1:B3`, `A:C`, `2:4` (relative). */
export function rangeText(r: Range): string {
  if (r.r0 === 0 && r.r1 === MAX_ROW) return `${colName(r.c0)}:${colName(r.c1)}`;
  if (r.c0 === 0 && r.c1 === MAX_COL) return `${r.r0 + 1}:${r.r1 + 1}`;
  const a = `${colName(r.c0)}${r.r0 + 1}`;
  return r.r0 === r.r1 && r.c0 === r.c1 ? a : `${a}:${colName(r.c1)}${r.r1 + 1}`;
}

/** Excel's reference colours, in order of first appearance. */
export const REF_COLORS = ["#2a62d6", "#d8352a", "#8a3fbf", "#2b8a3e", "#c26a00", "#0f8b8d", "#c2185b", "#6d4c41"];

export interface ColoredRef extends RefSpan {
  color: string;
}

/**
 * References with colours: equal references (same sheet and range) share a
 * colour. `spillRange` resolves a spilled-range reference `A1#` to the
 * spill range of A1's array formula (unresolved: A1 alone).
 */
export function colorRefs(
  text: string,
  spillRange?: (ref: RefSpan) => Range | null,
  resolveName?: (name: string, sheet: string | null) => { sheet: string | null; range: Range } | null,
): ColoredRef[] {
  const keys: string[] = [];
  const found: RefSpan[] = findRefs(text);
  if (resolveName) {
    // Defined names are coloured like references, over the range they refer to.
    for (const n of nameSpans(text)) {
      const hit = resolveName(n.name, n.sheet);
      if (!hit) continue;
      const { r0, c0, r1, c1 } = hit.range;
      const cellAtom = (row: number, col: number): Atom => ({ kind: "cell", row, col, colAbs: true, rowAbs: true });
      const single = r0 === r1 && c0 === c1;
      found.push({
        start: n.start, end: n.end, sheet: hit.sheet, kind: single ? "cell" : "area", range: { ...hit.range },
        a: cellAtom(r0, c0), b: single ? null : cellAtom(r1, c1), prefix: "", middle: ":", nextTok: -1, name: n.name,
      });
    }
    found.sort((a, b) => a.start - b.start);
  }
  return found.map((f) => {
    const resolved = f.spill ? spillRange?.(f) : null;
    const r = resolved ? { ...f, range: { ...resolved } } : f;
    const key = `${(r.sheet ?? "").toLowerCase()}|${r.range.r0},${r.range.c0},${r.range.r1},${r.range.c1}`;
    let k = keys.indexOf(key);
    if (k < 0) k = keys.push(key) - 1;
    return { ...r, color: REF_COLORS[k % REF_COLORS.length] };
  });
}

/**
 * F4: cycles the anchoring of the reference at the caret
 * (`A1` → `$A$1` → `A$1` → `$A1` → `A1`; whole columns/rows toggle).
 */
export function cycleAnchor(text: string, caret: number): { text: string; caret: number } | null {
  const ref = findRefs(text).find((r) => r.start <= caret && caret <= r.end);
  if (!ref) return null;
  const step = (a: Atom, state: number): Atom => {
    if (a.kind !== "cell") return { ...a, abs: !(a.abs) };
    const flags = [[false, false], [true, true], [false, true], [true, false]][state];
    return { ...a, colAbs: flags[0], rowAbs: flags[1] };
  };
  const a = ref.a;
  const cur = a.kind === "cell" ? (a.colAbs ? (a.rowAbs ? 1 : 3) : a.rowAbs ? 2 : 0) : 0;
  const next = (cur + 1) % 4;
  let body = ref.prefix + atomText(step(a, next));
  if (ref.b) body += ref.middle + atomText(step(ref.b, next));
  if (ref.spill) body += "#";
  return { text: text.slice(0, ref.start) + body + text.slice(ref.end), caret: ref.start + body.length };
}
