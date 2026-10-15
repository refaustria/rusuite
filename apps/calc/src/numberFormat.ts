// Format Cells → Number (pure): the categories of the dialog, the format
// code each choice produces and the reverse mapping that preselects the
// dialog from a cell's current code.

import { withLabel } from "@rusuite/ui-shared";
import "./i18n";

export type FormatCategory = "general" | "number" | "currency" | "percentage" | "date" | "time" | "text" | "custom";

export const CATEGORIES: { id: FormatCategory; readonly label: string }[] = [
  withLabel({ id: "general" as FormatCategory }, "calc.cat.general"),
  withLabel({ id: "number" as FormatCategory }, "calc.cat.number"),
  withLabel({ id: "currency" as FormatCategory }, "calc.cat.currency"),
  withLabel({ id: "percentage" as FormatCategory }, "calc.cat.percentage"),
  withLabel({ id: "date" as FormatCategory }, "calc.cat.date"),
  withLabel({ id: "time" as FormatCategory }, "calc.cat.time"),
  withLabel({ id: "text" as FormatCategory }, "calc.cat.text"),
  withLabel({ id: "custom" as FormatCategory }, "calc.cat.custom"),
];

export type CurrencySymbol = "€" | "$" | "£";
export const SYMBOLS: CurrencySymbol[] = ["€", "$", "£"];

/** Date formats offered (the engine's format support decides the list). */
export const DATE_CODES = ["yyyy-mm-dd", "dd.mm.yyyy", "m/d/yyyy", "d-mmm-yy", "mmmm d, yyyy"];
/** Time formats offered (12-hour clock and elapsed time included). */
export const TIME_CODES = ["h:mm", "h:mm:ss", "hh:mm:ss", "mm:ss", "h:mm AM/PM", "h:mm:ss AM/PM", "[h]:mm:ss", "[mm]:ss"];

export interface FormatChoice {
  category: FormatCategory;
  decimals: number;
  thousands: boolean;
  symbol: CurrencySymbol;
  date: string;
  time: string;
  custom: string;
}

export const DEFAULT_CHOICE: FormatChoice = {
  category: "general", decimals: 2, thousands: false, symbol: "€", date: DATE_CODES[0]!, time: TIME_CODES[0]!, custom: "General",
};

const decimalsPart = (n: number) => (n > 0 ? `.${"0".repeat(Math.min(30, n))}` : "");

/** The number format code of a dialog choice. */
export function buildCode(c: FormatChoice): string {
  const dec = decimalsPart(c.decimals);
  switch (c.category) {
    case "general":
      return "General";
    case "number":
      return `${c.thousands ? "#,##0" : "0"}${dec}`;
    case "currency":
      return c.symbol === "$" ? `$#,##0${dec}` : c.symbol === "£" ? `"£"#,##0${dec}` : `#,##0${dec} "€"`;
    case "percentage":
      return `0${dec}%`;
    case "date":
      return c.date;
    case "time":
      return c.time;
    case "text":
      return "@";
    case "custom":
      return c.custom.trim() === "" ? "General" : c.custom;
  }
}

/** The dialog state that produces `code` (unknown codes open as Custom). */
export function parseCode(code: string | null | undefined): FormatChoice {
  const base = { ...DEFAULT_CHOICE, custom: code ?? "General" };
  if (!code || code.toLowerCase() === "general") return base;
  if (code === "@") return { ...base, category: "text" };
  if (DATE_CODES.includes(code)) return { ...base, category: "date", date: code };
  if (TIME_CODES.includes(code)) return { ...base, category: "time", time: code };
  const decimals = (s: string | undefined) => (s ? s.length - 1 : 0);
  let m = /^(#,##0|0)(\.0+)?$/.exec(code);
  if (m) return { ...base, category: "number", thousands: m[1] === "#,##0", decimals: decimals(m[2]) };
  m = /^0(\.0+)?%$/.exec(code);
  if (m) return { ...base, category: "percentage", decimals: decimals(m[1]) };
  m = /^\$#,##0(\.0+)?$/.exec(code);
  if (m) return { ...base, category: "currency", symbol: "$", decimals: decimals(m[1]) };
  m = /^"£"#,##0(\.0+)?$/.exec(code);
  if (m) return { ...base, category: "currency", symbol: "£", decimals: decimals(m[1]) };
  m = /^#,##0(\.0+)? "€"$/.exec(code);
  if (m) return { ...base, category: "currency", symbol: "€", decimals: decimals(m[1]) };
  return { ...base, category: "custom" };
}

/** Sample value for the preview when the active cell holds no number. */
export const SAMPLE_VALUE = 1234.5678;

/**
 * The number the preview formats: the active cell's constant, or its
 * displayed number when it is a plain number; `null` for text cells
 * (the preview then shows the text as is).
 */
export function previewValue(cell: { input: string; display: string; kind: string } | undefined): number | null {
  if (!cell || cell.kind === "empty") return SAMPLE_VALUE;
  if (cell.kind !== "number") return null;
  for (const t of [cell.input, cell.display]) {
    const n = Number(t);
    if (t.trim() !== "" && Number.isFinite(n)) return n;
  }
  return SAMPLE_VALUE;
}
