// C-23 (P8-44): typing a number into a column of default width widens the
// column to fit it, as Excel does (only columns nobody sized, only numbers,
// never narrower; wrapped and merged cells and formulas are left alone).

import { CELL_PADDING } from "../grid/render";

export interface WidenInput {
  /** The committed text was a constant (not a formula). */
  constant: boolean;
  kind: string;
  /** The displayed text's width in px. */
  textPx: number;
  /** The column's current width in px. */
  colPx: number;
  /** The column has an explicit width (set by the user or the file). */
  explicitWidth: boolean;
  wrap: boolean;
  merged: boolean;
}

/** The column width (px) the entry needs, or `null` when the column stays. */
export function widenedPx(i: WidenInput): number | null {
  if (!i.constant || i.kind !== "number" || i.explicitWidth || i.wrap || i.merged) return null;
  const need = Math.ceil(i.textPx + 2 * CELL_PADDING + 3);
  return need > i.colPx ? need : null;
}
