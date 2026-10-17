// Flash Fill (P9-C2, Data › Flash Fill, Ctrl+E): learns how the typed
// examples of a column come from the other columns of their rows and
// fills the rest. A program is a concatenation of segments – literal
// text, a whole source value, a token (split on any punctuation / space
// or on one delimiter, counted from the start or the end), a token's
// initial, a fixed substring – each with a case change (as is, UPPER,
// lower, Proper), or a source number in a number format (the core's
// formatter). The search is best-first over partial programs, pruned by
// every example's text, so the simplest program explaining all examples
// wins (Excel's common cases: names split / joined, initials, e-mail
// parts, codes, case changes, dates reordered or reformatted).

export type FlashCase = "keep" | "upper" | "lower" | "proper";

export type FlashSeg =
  | { kind: "lit"; text: string }
  | { kind: "field"; col: number; case: FlashCase }
  /** Token `index` (negative: from the end) of the value split on `delim` (`null`: any run of non-letters/digits). */
  | { kind: "token"; col: number; index: number; delim: string | null; case: FlashCase }
  | { kind: "initial"; col: number; index: number; case: FlashCase }
  /** Characters `start .. end` (`end` exclusive; negative: from the end). */
  | { kind: "substr"; col: number; start: number; end: number; case: FlashCase }
  | { kind: "format"; col: number; code: string };

export interface FlashProgram {
  segs: FlashSeg[];
}

/** One example: the row's source values and the typed result. */
export interface FlashExample {
  sources: string[];
  target: string;
}

const CASES: FlashCase[] = ["keep", "upper", "lower", "proper"];

export function applyCase(s: string, c: FlashCase): string {
  switch (c) {
    case "keep":
      return s;
    case "upper":
      return s.toUpperCase();
    case "lower":
      return s.toLowerCase();
    case "proper":
      return s.toLowerCase().replace(/(^|[^\p{L}\p{N}'])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase());
  }
}

/** Tokens of `s`: runs of letters/digits (`delim` null) or the parts between `delim`. */
export function tokens(s: string, delim: string | null): string[] {
  if (delim === null) return s.match(/[\p{L}\p{N}]+/gu) ?? [];
  return s.split(delim);
}

const at = <T,>(list: readonly T[], i: number): T | undefined => (i >= 0 ? list[i] : list[list.length + i]);

/** The text of a segment for a row (`null`: the segment does not apply, e.g. a missing token). */
export function runSeg(seg: FlashSeg, sources: readonly string[], format?: (col: number, code: string) => string | null): string | null {
  if (seg.kind === "lit") return seg.text;
  const src = sources[seg.col];
  if (src === undefined || src === "") return null;
  switch (seg.kind) {
    case "field":
      return applyCase(src, seg.case);
    case "token": {
      const t = at(tokens(src, seg.delim), seg.index);
      return t === undefined || t === "" ? null : applyCase(t, seg.case);
    }
    case "initial": {
      const t = at(tokens(src, null), seg.index);
      return t ? applyCase(t[0]!, seg.case) : null;
    }
    case "substr": {
      const n = src.length;
      const a = seg.start < 0 ? n + seg.start : seg.start;
      const b = seg.end <= 0 ? n + seg.end : seg.end;
      if (a < 0 || b > n || a >= b) return null;
      return applyCase(src.slice(a, b), seg.case);
    }
    case "format":
      return format ? format(seg.col, seg.code) : null;
  }
}

/** The program's result for a row, `null` when a segment does not apply. */
export function runProgram(p: FlashProgram, sources: readonly string[], format?: (col: number, code: string) => string | null): string | null {
  let out = "";
  for (const s of p.segs) {
    const v = runSeg(s, sources, format);
    if (v === null) return null;
    out += v;
  }
  return out;
}

/** The delimiters worth splitting on: the punctuation and spaces of the sources. */
function delimiters(sources: readonly string[]): string[] {
  const out = new Set<string>();
  for (const s of sources) for (const ch of s) if (!/[\p{L}\p{N}]/u.test(ch)) out.add(ch);
  return [...out];
}

/** Every extraction producing exactly `text` from `sources`. */
function candidates(text: string, sources: readonly string[]): FlashSeg[] {
  const out: FlashSeg[] = [];
  const caseOf = (s: string): FlashCase | null => CASES.find((c) => applyCase(s, c) === text) ?? null;
  const delims = delimiters(sources);
  sources.forEach((src, col) => {
    if (!src) return;
    const fc = caseOf(src);
    if (fc) out.push({ kind: "field", col, case: fc });
    for (const delim of [null, ...delims]) {
      const toks = tokens(src, delim);
      if (toks.length < 2 && delim !== null) continue;
      toks.forEach((tok, k) => {
        const c = tok ? caseOf(tok) : null;
        if (!c || tok === src) return;
        out.push({ kind: "token", col, index: k, delim, case: c });
        out.push({ kind: "token", col, index: k - toks.length, delim, case: c });
      });
    }
    if (text.length === 1) {
      tokens(src, null).forEach((tok, k, all) => {
        const c = caseOf(tok[0]!);
        if (!c) return;
        out.push({ kind: "initial", col, index: k, case: c });
        out.push({ kind: "initial", col, index: k - all.length, case: c });
      });
    }
    // Fixed positions (codes): every occurrence, from the start and from the end.
    const lower = src.toLowerCase();
    const want = text.toLowerCase();
    for (let p = lower.indexOf(want); p >= 0 && want; p = lower.indexOf(want, p + 1)) {
      const c = caseOf(src.slice(p, p + want.length));
      if (!c) continue;
      out.push({ kind: "substr", col, start: p, end: p + want.length, case: c });
      if (p + want.length < src.length) out.push({ kind: "substr", col, start: p - src.length, end: p + want.length - src.length, case: c });
      else out.push({ kind: "substr", col, start: p - src.length, end: 0, case: c });
    }
  });
  return out;
}

function segCost(s: FlashSeg): number {
  switch (s.kind) {
    case "lit":
      // Separators are cheap literals; letters and digits should come from the data.
      return /^[^\p{L}\p{N}]+$/u.test(s.text) ? 1 : 4 * s.text.length;
    case "field":
      return 1;
    case "token":
      return 1.2 + (s.delim === null ? 0 : 0.1) + (s.index < 0 ? 0.05 : 0) + (s.case === "keep" ? 0 : 0.2);
    case "initial":
      return 1.3 + (s.case === "keep" ? 0 : 0.2);
    case "substr":
      return 2 + (s.case === "keep" ? 0 : 0.2);
    case "format":
      return 1;
  }
}

interface Partial {
  pos: number;
  cost: number;
  segs: FlashSeg[];
  /** Per other example, how much of its target is produced. */
  done: number[];
}

/**
 * The simplest program producing every example's target from its
 * sources (`null`: none found). `budget` bounds the search.
 */
export function inferProgram(examples: readonly FlashExample[], budget = 20000): FlashProgram | null {
  const first = examples[0];
  if (!first || first.target === "") return null;
  const rest = examples.slice(1);
  const target = first.target;
  const n = target.length;
  // Edges of the first example: i → j with the segments producing target[i..j].
  const edges: FlashSeg[][][] = [];
  for (let i = 0; i < n; i++) {
    edges[i] = [];
    for (let j = i + 1; j <= n; j++) {
      const piece = target.slice(i, j);
      const segs = candidates(piece, first.sources);
      if (j - i <= 3 || /^[^\p{L}\p{N}]+$/u.test(piece)) segs.push({ kind: "lit", text: piece });
      edges[i]![j] = segs;
    }
  }
  const queue: Partial[] = [{ pos: 0, cost: 0, segs: [], done: rest.map(() => 0) }];
  let steps = 0;
  while (queue.length && steps++ < budget) {
    // Cheapest first (the queue is small; a sort keeps it simple).
    queue.sort((a, b) => a.cost - b.cost || b.pos - a.pos);
    const cur = queue.shift()!;
    if (cur.pos === n) {
      if (cur.done.every((d, k) => d === rest[k]!.target.length)) return { segs: merge(cur.segs) };
      continue;
    }
    for (let j = n; j > cur.pos; j--) {
      for (const seg of edges[cur.pos]![j] ?? []) {
        const done: number[] = [];
        let ok = true;
        for (let k = 0; k < rest.length && ok; k++) {
          const ex = rest[k]!;
          const v = runSeg(seg, ex.sources);
          if (v === null || !ex.target.startsWith(v, cur.done[k]!)) ok = false;
          else done.push(cur.done[k]! + v.length);
        }
        if (!ok) continue;
        queue.push({ pos: j, cost: cur.cost + segCost(seg), segs: [...cur.segs, seg], done });
      }
    }
  }
  return null;
}

/** Adjacent literals as one. */
function merge(segs: FlashSeg[]): FlashSeg[] {
  const out: FlashSeg[] = [];
  for (const s of segs) {
    const last = out[out.length - 1];
    if (s.kind === "lit" && last?.kind === "lit") out[out.length - 1] = { kind: "lit", text: last.text + s.text };
    else out.push(s);
  }
  return out;
}

/** The number formats tried for numbers and dates (Excel's common reformattings). */
export const FLASH_FORMATS = [
  "yyyy-mm-dd", "dd.mm.yyyy", "d.m.yyyy", "mm/dd/yyyy", "m/d/yyyy", "dd/mm/yyyy", "d mmm yyyy", "d mmmm yyyy", "mmmm d, yyyy", "mmm d, yyyy",
  "dddd", "ddd", "mmmm", "mmm", "yyyy", "mmm yyyy", "mmmm yyyy", "0.00", "#,##0", "#,##0.00", "0%", "0.0%", "h:mm", "hh:mm:ss",
];

/**
 * A number-format program (`format` of one source number) when the text
 * search found none: the first code turning each example's number into
 * its target. `format(value, code)` is the core's formatter.
 */
export async function inferFormat(
  examples: readonly { numbers: readonly (number | null)[]; target: string }[],
  format: (value: number, code: string) => Promise<string>,
): Promise<FlashProgram | null> {
  const first = examples[0];
  if (!first) return null;
  for (let col = 0; col < first.numbers.length; col++) {
    if (examples.some((e) => e.numbers[col] === null || e.numbers[col] === undefined)) continue;
    for (const code of FLASH_FORMATS) {
      let ok = true;
      for (const e of examples) {
        if ((await format(e.numbers[col]!, code)) !== e.target) {
          ok = false;
          break;
        }
      }
      if (ok) return { segs: [{ kind: "format", col, code }] };
    }
  }
  return null;
}

/** A column of the grid as Flash Fill sees it: the region's rows with the source columns and the target cell. */
export interface FlashRow {
  row: number;
  sources: string[];
  numbers: (number | null)[];
  target: string;
}

/**
 * The suggestions for the empty target cells of `rows` (`row → text`),
 * learning from the filled ones; the first row is dropped as a header
 * when the program does not explain it. `null`: no program.
 */
export async function flashFill(
  rows: readonly FlashRow[],
  format: (value: number, code: string) => Promise<string>,
): Promise<{ program: FlashProgram; cells: { row: number; input: string }[] } | null> {
  const filled = rows.filter((r) => r.target !== "");
  if (!filled.length) return null;
  const learn = async (ex: readonly FlashRow[]) => inferProgram(ex.map((r) => ({ sources: r.sources, target: r.target }))) ?? (await inferFormat(ex, format));
  let examples = filled;
  let program = await learn(examples);
  let header: number | null = null;
  if (!program && filled.length > 1 && filled[0] === rows[0]) {
    header = filled[0]!.row;
    examples = filled.slice(1);
    program = await learn(examples);
  }
  if (!program) return null;
  const cells: { row: number; input: string }[] = [];
  for (const r of rows) {
    if (r.target !== "" || r.row === header || r.sources.every((s) => s === "")) continue;
    let value: string | null;
    const seg = program.segs[0];
    if (program.segs.length === 1 && seg?.kind === "format") {
      const n = r.numbers[seg.col];
      value = n === null || n === undefined ? null : await format(n, seg.code);
    } else value = runProgram(program, r.sources);
    if (value !== null && value !== "") cells.push({ row: r.row, input: value });
  }
  return { program, cells };
}

/** The input that keeps a suggestion as text (`'0123`, `'1/2`); plain text stays as it is. */
export function textInput(s: string): string {
  return /^[=+\-@']/.test(s) || /^[\d.,\s/:%$€£-]+$/.test(s) || /^(true|false)$/i.test(s) ? `'${s}` : s;
}
