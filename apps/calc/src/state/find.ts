// Find & replace helpers (pure): stepping through the core's matches and
// rewriting an input.

import type { FoundCell } from "../generated/FoundCell";

export interface FindOptions {
  query: string;
  matchCase: boolean;
  /** Match the entire cell content. */
  wholeCell: boolean;
  /** Search every sheet (`false`: the active sheet). */
  allSheets: boolean;
}

export interface CellPos {
  sheet: number;
  row: number;
  col: number;
}

/**
 * The match after (or, `backwards`, before) `from` in search order —
 * sheets in tab order (`sheetOrder`), then rows, then columns —
 * wrapping around. `null` without matches.
 */
export function findStep(found: FoundCell[], sheetOrder: number[], from: CellPos, backwards: boolean): FoundCell | null {
  if (found.length === 0) return null;
  const key = (c: CellPos): [number, number, number] => [sheetOrder.indexOf(c.sheet), c.row, c.col];
  const cmp = (a: CellPos, b: CellPos) => {
    const [x, y] = [key(a), key(b)];
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
  };
  const sorted = [...found].sort(cmp);
  if (backwards) {
    for (let i = sorted.length - 1; i >= 0; i--) if (cmp(sorted[i]!, from) < 0) return sorted[i]!;
    return sorted[sorted.length - 1]!;
  }
  return sorted.find((c) => cmp(c, from) > 0) ?? sorted[0]!;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * `input` with every occurrence of `query` replaced by `replacement`
 * (`wholeCell`: the whole input when it equals `query`), or `null` when
 * the input does not contain it (a cell found through its displayed
 * value only is not replaced).
 */
export function replaceInInput(input: string, query: string, replacement: string, matchCase: boolean, wholeCell: boolean): string | null {
  if (query === "") return null;
  if (wholeCell) {
    const same = matchCase ? input === query : input.toLowerCase() === query.toLowerCase();
    return same ? replacement : null;
  }
  const re = new RegExp(escape(query), matchCase ? "g" : "gi");
  if (!re.test(input)) return null;
  re.lastIndex = 0;
  return input.replace(re, () => replacement);
}
