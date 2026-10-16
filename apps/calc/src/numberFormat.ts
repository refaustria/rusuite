// Format Cells → Number (pure): Excel's categories, the format code each
// choice produces, the reverse mapping that preselects the dialog from a
// cell's code, the Custom list, the ribbon's Number Format box and the
// Increase / Decrease Decimal edit. Formatting itself happens in Rust
// (`engine_formula::numfmt`, through the core).

import { withLabel } from "@rusuite/ui-shared";
import "./i18n";

export type FormatCategory =
  | "general" | "number" | "currency" | "accounting" | "date" | "time" | "percentage" | "fraction" | "scientific" | "text" | "custom";

export const CATEGORIES: { id: FormatCategory; readonly label: string }[] = [
  withLabel({ id: "general" as FormatCategory }, "calc.cat.general"),
  withLabel({ id: "number" as FormatCategory }, "calc.cat.number"),
  withLabel({ id: "currency" as FormatCategory }, "calc.cat.currency"),
  withLabel({ id: "accounting" as FormatCategory }, "calc.cat.accounting"),
  withLabel({ id: "date" as FormatCategory }, "calc.cat.date"),
  withLabel({ id: "time" as FormatCategory }, "calc.cat.time"),
  withLabel({ id: "percentage" as FormatCategory }, "calc.cat.percentage"),
  withLabel({ id: "fraction" as FormatCategory }, "calc.cat.fraction"),
  withLabel({ id: "scientific" as FormatCategory }, "calc.cat.scientific"),
  withLabel({ id: "text" as FormatCategory }, "calc.cat.text"),
  withLabel({ id: "custom" as FormatCategory }, "calc.cat.custom"),
];

export type CurrencySymbol = "€" | "$" | "£" | "¥" | "";
export const SYMBOLS: CurrencySymbol[] = ["€", "$", "£", "¥", ""];

/** How negative numbers show (Number and Currency): `-1234.10`, red, `(1234.10)`, red in parentheses. */
export type NegativeStyle = "minus" | "red" | "paren" | "redParen";
export const NEGATIVE_STYLES: NegativeStyle[] = ["minus", "red", "paren", "redParen"];

/** Date formats offered (Excel's Type list, plus ISO and the German style). */
export const DATE_CODES = [
  "m/d/yyyy", "dddd, mmmm d, yyyy", "m/d/yy", "mm/dd/yy", "d-mmm", "d-mmm-yy", "dd-mmm-yy", "mmm-yy", "mmmm-yy", "mmmm d, yyyy",
  "m/d/yy h:mm AM/PM", "m/d/yy h:mm", "mmmmm", "mmmmm-yy", "d-mmm-yyyy", "yyyy-mm-dd", "dd.mm.yyyy", "[$-407]dddd, d. mmmm yyyy",
];
/** Time formats offered (12-hour clock and elapsed time included). */
export const TIME_CODES = ["h:mm", "h:mm AM/PM", "h:mm:ss", "h:mm:ss AM/PM", "hh:mm:ss", "mm:ss", "mm:ss.0", "[h]:mm:ss", "[mm]:ss", "m/d/yy h:mm"];
/** Fraction types: up to one/two/three digits, halves … hundredths. */
export const FRACTION_CODES = ["# ?/?", "# ??/??", "# ???/???", "# ?/2", "# ?/4", "# ?/8", "# ??/16", "# ?/10", "# ??/100"];

/** Excel's Custom list (en-US built-ins, ids 0–49). */
export const BUILTIN_CODES = [
  "General", "0", "0.00", "#,##0", "#,##0.00",
  "#,##0_);(#,##0)", "#,##0_);[Red](#,##0)", "#,##0.00_);(#,##0.00)", "#,##0.00_);[Red](#,##0.00)",
  '"$"#,##0_);\\("$"#,##0\\)', '"$"#,##0_);[Red]\\("$"#,##0\\)', '"$"#,##0.00_);\\("$"#,##0.00\\)', '"$"#,##0.00_);[Red]\\("$"#,##0.00\\)',
  "0%", "0.00%", "0.00E+00", "##0.0E+0", "# ?/?", "# ??/??",
  "m/d/yyyy", "d-mmm-yy", "d-mmm", "mmm-yy", "h:mm AM/PM", "h:mm:ss AM/PM", "h:mm", "h:mm:ss", "m/d/yyyy h:mm", "mm:ss", "mm:ss.0", "@", "[h]:mm:ss",
  '_(* #,##0_);_(* \\(#,##0\\);_(* "-"_);_(@_)',
  '_("$"* #,##0_);_("$"* \\(#,##0\\);_("$"* "-"_);_(@_)',
  '_(* #,##0.00_);_(* \\(#,##0.00\\);_(* "-"??_);_(@_)',
  '_("$"* #,##0.00_);_("$"* \\(#,##0.00\\);_("$"* "-"??_);_(@_)',
];

/** The Custom list: the built-ins, then the workbook's own codes (in style order, no duplicates). */
export function customCodes(styles: readonly { numberFormat?: string | null }[]): string[] {
  const out = [...BUILTIN_CODES];
  for (const s of styles) {
    const c = s.numberFormat;
    if (c && !out.includes(c) && c.toLowerCase() !== "general") out.push(c);
  }
  return out;
}

export interface FormatChoice {
  category: FormatCategory;
  decimals: number;
  thousands: boolean;
  symbol: CurrencySymbol;
  negative: NegativeStyle;
  date: string;
  time: string;
  fraction: string;
  custom: string;
}

export const DEFAULT_CHOICE: FormatChoice = {
  category: "general", decimals: 2, thousands: false, symbol: "€", negative: "minus", date: DATE_CODES[0]!, time: TIME_CODES[0]!, fraction: FRACTION_CODES[0]!, custom: "General",
};

const decimalsPart = (n: number) => (n > 0 ? `.${"0".repeat(Math.min(30, n))}` : "");

/** `base` with Excel's negative-number variant. */
function withNegative(base: string, neg: NegativeStyle): string {
  switch (neg) {
    case "minus":
      return base;
    case "red":
      return `${base};[Red]${base}`;
    case "paren":
      return `${base}_);(${base})`;
    case "redParen":
      return `${base}_);[Red](${base})`;
  }
}

/** Currency body for a symbol: `$#,##0.00`, `"£"#,##0.00`, `#,##0.00 "€"`. */
function currencyBody(symbol: CurrencySymbol, dec: string): string {
  switch (symbol) {
    case "$":
      return `$#,##0${dec}`;
    case "£":
      return `"£"#,##0${dec}`;
    case "¥":
      return `"¥"#,##0${dec}`;
    case "":
      return `#,##0${dec}`;
    default:
      return `#,##0${dec} "€"`;
  }
}

/** The accounting format of a symbol (Excel's: the symbol at the left edge, the number aligned, `-` for zero). */
export function accountingCode(symbol: CurrencySymbol, decimals: number): string {
  const dec = decimalsPart(decimals);
  const zero = decimals > 0 ? `"-"${"?".repeat(decimals)}` : `"-"`;
  if (symbol === "€") return `_-* #,##0${dec} "€"_-;-* #,##0${dec} "€"_-;_-* ${zero} "€"_-;_-@_-`;
  const s = symbol === "" ? "" : `"${symbol}"`;
  return `_(${s}* #,##0${dec}_);_(${s}* \\(#,##0${dec}\\);_(${s}* ${zero}_);_(@_)`;
}

/** The number format code of a dialog choice. */
export function buildCode(c: FormatChoice): string {
  const dec = decimalsPart(c.decimals);
  switch (c.category) {
    case "general":
      return "General";
    case "number":
      return withNegative(`${c.thousands ? "#,##0" : "0"}${dec}`, c.negative);
    case "currency":
      return withNegative(currencyBody(c.symbol, dec), c.negative);
    case "accounting":
      return accountingCode(c.symbol, c.decimals);
    case "percentage":
      return `0${dec}%`;
    case "scientific":
      return `0${dec}E+00`;
    case "fraction":
      return c.fraction;
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
  if (FRACTION_CODES.includes(code)) return { ...base, category: "fraction", fraction: code };
  const decimals = (s: string | undefined) => (s ? s.length - 1 : 0);
  let m = /^0(\.0+)?%$/.exec(code);
  if (m) return { ...base, category: "percentage", decimals: decimals(m[1]) };
  m = /^0(\.0+)?E\+00$/.exec(code);
  if (m) return { ...base, category: "scientific", decimals: decimals(m[1]) };
  for (const symbol of SYMBOLS) {
    for (let d = 0; d <= 10; d++) {
      if (accountingCode(symbol, d) === code) return { ...base, category: "accounting", symbol, decimals: d };
    }
  }
  // Number / currency with a negative variant.
  const sections = code.split(";");
  let neg: NegativeStyle = "minus";
  let body = code;
  if (sections.length === 2) {
    const [a, b] = sections as [string, string];
    if (b === `[Red]${a}`) [neg, body] = ["red", a];
    else if (a.endsWith("_)") && b === `(${a.slice(0, -2)})`) [neg, body] = ["paren", a.slice(0, -2)];
    else if (a.endsWith("_)") && b === `[Red](${a.slice(0, -2)})`) [neg, body] = ["redParen", a.slice(0, -2)];
    else return { ...base, category: "custom" };
  } else if (sections.length > 2) return { ...base, category: "custom" };
  m = /^(#,##0|0)(\.0+)?$/.exec(body);
  if (m) return { ...base, category: "number", thousands: m[1] === "#,##0", decimals: decimals(m[2]), negative: neg };
  for (const symbol of SYMBOLS) {
    for (let d = 0; d <= 10; d++) {
      if (symbol !== "" && currencyBody(symbol, decimalsPart(d)) === body) return { ...base, category: "currency", symbol, decimals: d, negative: neg };
    }
  }
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

/** The ribbon's Number Format box: Excel's eleven entries. */
export type QuickFormat = "general" | "number" | "currency" | "accounting" | "shortDate" | "longDate" | "time" | "percentage" | "fraction" | "scientific" | "text";
export const QUICK_FORMATS: QuickFormat[] = ["general", "number", "currency", "accounting", "shortDate", "longDate", "time", "percentage", "fraction", "scientific", "text"];

/** The code of a quick format; `symbol` is the UI language's currency. */
export function quickCode(q: QuickFormat, symbol: CurrencySymbol, german: boolean): string {
  switch (q) {
    case "general":
      return "General";
    case "number":
      return "0.00";
    case "currency":
      return currencyBody(symbol, ".00");
    case "accounting":
      return accountingCode(symbol, 2);
    case "shortDate":
      return german ? "dd.mm.yyyy" : "m/d/yyyy";
    case "longDate":
      return german ? "[$-407]dddd, d. mmmm yyyy" : "dddd, mmmm d, yyyy";
    case "time":
      return german ? "hh:mm:ss" : "h:mm:ss AM/PM";
    case "percentage":
      return "0.00%";
    case "fraction":
      return "# ?/?";
    case "scientific":
      return "0.00E+00";
    case "text":
      return "@";
  }
}

/** Which quick format `code` is (`null`: none of the eleven). */
export function quickOf(code: string | null | undefined, symbol: CurrencySymbol, german: boolean): QuickFormat | null {
  const c = code ?? "General";
  return QUICK_FORMATS.find((q) => quickCode(q, symbol, german) === c || (q === "general" && c.toLowerCase() === "general")) ?? null;
}

/** Positions of `section` inside quotes, brackets and after `\` / `_` / `*` (not format tokens). */
function literalMask(section: string): boolean[] {
  const mask: boolean[] = Array.from({ length: section.length }, () => false);
  for (let i = 0; i < section.length; i++) {
    const c = section[i]!;
    if (c === '"' || c === "[") {
      const end = section.indexOf(c === '"' ? '"' : "]", i + 1);
      const stop = end < 0 ? section.length - 1 : end;
      for (let k = i; k <= stop; k++) mask[k] = true;
      i = stop;
    } else if (c === "\\" || c === "_" || c === "*") {
      mask[i] = true;
      if (i + 1 < section.length) mask[i + 1] = true;
      i++;
    }
  }
  return mask;
}

/** Splits a code at `;` outside quotes and brackets. */
function splitSections(code: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote = false;
  let bracket = false;
  for (let i = 0; i < code.length; i++) {
    const c = code[i]!;
    if (c === "\\" && !quote && !bracket && i + 1 < code.length) {
      cur += c + code[++i];
      continue;
    }
    if (c === '"' && !bracket) quote = !quote;
    else if (c === "[" && !quote) bracket = true;
    else if (c === "]" && !quote) bracket = false;
    if (c === ";" && !quote && !bracket) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

/**
 * Adds (`delta` 1) or removes (-1) one decimal place in every section of a
 * number format code, for every family with digits: `General`/`0` →
 * `0.0`, `#,##0.00` → `#,##0.0`, `0.00E+00` (the mantissa), `0%`,
 * accounting and currency codes. Dates, times, fractions and text are
 * unchanged.
 */
export function changeDecimals(code: string, delta: 1 | -1): string {
  const base = code === "General" || code === "" ? "0" : code;
  return splitSections(base)
    .map((section) => {
      const mask = literalMask(section);
      const plain = [...section].map((c, i) => (mask[i] ? " " : c)).join("");
      const noExp = plain.replace(/E[+-]/gi, "  ");
      if (/[ymdhs]/i.test(noExp) || plain.includes("/") || plain.includes("@") || /general/i.test(plain)) return section;
      // The mantissa ends at an exponent.
      const exp = plain.search(/E[+-]/i);
      const end = exp < 0 ? plain.length : exp;
      const re = /[0#?][0#?,]*(?:\.[0#?]*)?/g;
      let last: RegExpExecArray | null = null;
      for (let m = re.exec(plain); m && m.index < end; m = re.exec(plain)) last = m;
      if (!last) return section;
      const run = last[0];
      // The zero section of accounting codes (`"-"??`): one `?` per decimal.
      if (/^\?+$/.test(run)) {
        return section.slice(0, last.index) + "?".repeat(Math.max(0, run.length + delta)) + section.slice(last.index + run.length);
      }
      const dot = run.indexOf(".");
      const intPart = dot < 0 ? run : run.slice(0, dot);
      const places = dot < 0 ? 0 : run.length - dot - 1;
      const next = Math.max(0, Math.min(30, places + delta));
      const digits = next > 0 ? `${intPart}.${"0".repeat(next)}` : intPart;
      return section.slice(0, last.index) + digits + section.slice(last.index + run.length);
    })
    .join(";");
}
