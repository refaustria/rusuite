// R1C1 reference style (P9-C4, File › Options › Formulas): display and
// entry only. The core stores A1 formulas; the editor and the formula bar
// show `toR1C1(input, row, col)` and a committed entry goes through
// `fromR1C1` (a port of `engine-formula/src/r1c1.rs`). `R2C3` is `$C$2`,
// `R[-1]C` the cell above, `R1` / `C[1]` whole rows / columns.

import { colName } from "../grid/address";
import { findRefs, MAX_COL, MAX_ROW, type Atom } from "../formula/refs";

function part(letter: "R" | "C", v: number, abs: boolean, here: number): string {
  if (abs) return `${letter}${v + 1}`;
  const d = v - here;
  return d === 0 ? letter : `${letter}[${d}]`;
}

function cellText(a: Extract<Atom, { kind: "cell" }>, row: number, col: number): string {
  return part("R", a.row, a.rowAbs, row) + part("C", a.col, a.colAbs, col);
}

function lineText(a: Atom, row: number, col: number): string {
  if (a.kind === "row") return part("R", Number(a.digits) - 1, a.abs, row);
  if (a.kind === "col") {
    let n = 0;
    for (const ch of a.letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
    return part("C", n - 1, a.abs, col);
  }
  return cellText(a, row, col);
}

/** An A1 formula as Excel shows it in R1C1 style, seen from `(row, col)` (non-formulas unchanged). */
export function toR1C1(input: string, row: number, col: number): string {
  if (!input.startsWith("=")) return input;
  let out = "";
  let at = 0;
  for (const ref of findRefs(input)) {
    out += input.slice(at, ref.start) + ref.prefix;
    if (ref.kind === "cell" || ref.kind === "area") {
      out += cellText(ref.a as Extract<Atom, { kind: "cell" }>, row, col);
      if (ref.b) out += ref.middle + cellText(ref.b as Extract<Atom, { kind: "cell" }>, row, col);
    } else {
      const x = lineText(ref.a, row, col);
      const y = ref.b ? lineText(ref.b, row, col) : x;
      out += x === y ? x : `${x}${ref.middle}${y}`;
    }
    if (ref.spill) out += "#";
    at = ref.end;
  }
  return out + input.slice(at);
}

const identContinue = (c: string | undefined) => c !== undefined && /^[\p{L}\p{N}_.\\?]$/u.test(c);

type Part = { abs: true; v: number } | { abs: false; d: number };

function readPart(s: string, i: number): { p: Part; end: number } | null {
  if (s[i] === "[") {
    const close = s.indexOf("]", i);
    if (close < 0) return null;
    const n = Number(s.slice(i + 1, close).trim());
    if (!Number.isInteger(n)) return null;
    return { p: { abs: false, d: n }, end: close + 1 };
  }
  let j = i;
  while (j < s.length && s[j] >= "0" && s[j] <= "9") j++;
  if (j === i) return { p: { abs: false, d: 0 }, end: i };
  const n = Number(s.slice(i, j));
  if (n < 1 || n > MAX_ROW + 1) return null;
  return { p: { abs: true, v: n - 1 }, end: j };
}

type R1C1Tok = { kind: "cell"; r: Part; c: Part } | { kind: "row"; r: Part } | { kind: "col"; c: Part };

function tokenAt(s: string, i: number): { tok: R1C1Tok; end: number } | null {
  const ch = s[i]?.toUpperCase();
  let tok: R1C1Tok;
  let end: number;
  if (ch === "R") {
    const r = readPart(s, i + 1);
    if (!r) return null;
    if (s[r.end]?.toUpperCase() === "C") {
      const c = readPart(s, r.end + 1);
      if (!c) return null;
      tok = { kind: "cell", r: r.p, c: c.p };
      end = c.end;
    } else {
      tok = { kind: "row", r: r.p };
      end = r.end;
    }
  } else if (ch === "C") {
    const c = readPart(s, i + 1);
    if (!c) return null;
    tok = { kind: "col", c: c.p };
    end = c.end;
  } else return null;
  const next = s[end];
  if (identContinue(next) || next === "(" || next === "[") return null;
  return { tok, end };
}

function resolve(p: Part, here: number, max: number): { v: number; abs: boolean } {
  if (p.abs) {
    if (p.v > max) throw new RangeError("reference out of range");
    return { v: p.v, abs: true };
  }
  const v = here + p.d;
  if (v < 0 || v > max) throw new RangeError("reference leaves the sheet");
  return { v, abs: false };
}

const dollar = (abs: boolean) => (abs ? "$" : "");

function lineA1(t: R1C1Tok, row: number, col: number): string {
  if (t.kind === "row") {
    const r = resolve(t.r, row, MAX_ROW);
    return `${dollar(r.abs)}${r.v + 1}`;
  }
  if (t.kind === "col") {
    const c = resolve(t.c, col, MAX_COL);
    return `${dollar(c.abs)}${colName(c.v)}`;
  }
  throw new Error("rows and columns only");
}

/**
 * R1C1 formula text entered in `(row, col)` as A1 text; `null` when a
 * reference leaves the sheet. A1 references in the text stay as they
 * are; strings, quoted sheet names and structured references are copied.
 */
export function fromR1C1(text: string, row: number, col: number): string | null {
  if (!text.startsWith("=")) return text;
  let out = "";
  let i = 0;
  let prev: string | undefined;
  try {
    while (i < text.length) {
      const c = text[i];
      if (c === '"' || c === "'") {
        let j = i + 1;
        for (;;) {
          const k = text.indexOf(c, j);
          if (k < 0) {
            j = text.length;
            break;
          }
          j = k + 1;
          if (text[j] === c) {
            j++;
            continue;
          }
          break;
        }
        out += text.slice(i, j);
        prev = c;
        i = j;
        continue;
      }
      if (c === "[") {
        let depth = 0;
        let j = i;
        for (; j < text.length; j++) {
          if (text[j] === "[") depth++;
          else if (text[j] === "]" && --depth === 0) {
            j++;
            break;
          }
        }
        out += text.slice(i, j);
        prev = "]";
        i = j;
        continue;
      }
      const boundary = !identContinue(prev);
      if (boundary) {
        const hit = tokenAt(text, i);
        if (hit) {
          const t = hit.tok;
          if (t.kind === "cell") {
            const r = resolve(t.r, row, MAX_ROW);
            const k = resolve(t.c, col, MAX_COL);
            out += `${dollar(k.abs)}${colName(k.v)}${dollar(r.abs)}${r.v + 1}`;
            i = hit.end;
          } else {
            // A pair `R1:R3` / `C1:C2`, else that one row / column.
            const pair = text[hit.end] === ":" ? tokenAt(text, hit.end + 1) : null;
            const second = pair && pair.tok.kind === t.kind ? pair : null;
            out += `${lineA1(t, row, col)}:${lineA1(second ? second.tok : t, row, col)}`;
            i = second ? second.end : hit.end;
          }
          prev = "1";
          continue;
        }
        if (/^[\p{L}_\\]$/u.test(c)) {
          let j = i;
          while (j < text.length && identContinue(text[j])) j++;
          out += text.slice(i, j);
          prev = text[j - 1];
          i = j;
          continue;
        }
      }
      out += c;
      prev = c;
      i++;
    }
  } catch {
    return null;
  }
  return out;
}
