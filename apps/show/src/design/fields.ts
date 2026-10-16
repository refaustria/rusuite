// Text fields (`TextRun.field`) as the UI shows them: the slide number of
// the slide being drawn and today's date / time in PowerPoint's
// `datetimeN` formats, written in the app's locale (the core's
// `date_format_pattern` gives the US English patterns; here they become
// `Intl.DateTimeFormat` options so German shows "16. Oktober 2026").

import { getLocale } from "@rusuite/ui-shared";
import type { TextField } from "../generated/TextField";

/** The `datetimeN` formats of Insert › Date & Time / Header & Footer, in PowerPoint's order. */
export const DATE_FORMATS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] as const;

const D = (o: Intl.DateTimeFormatOptions) => o;

/** `Intl` options of format `n` (0 and unknown = 1); `null` for the custom-joined short forms. */
function options(n: number): Intl.DateTimeFormatOptions | null {
  switch (n) {
    case 2: return D({ weekday: "long", year: "numeric", month: "long", day: "numeric" });
    case 3:
    case 4: return D({ year: "numeric", month: "long", day: "numeric" });
    case 5:
    case 7: return null;
    case 6: return D({ year: "2-digit", month: "long" });
    case 8: return D({ year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });
    case 9: return D({ year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" });
    case 10: return D({ hour: "numeric", minute: "2-digit", hourCycle: "h23" });
    case 11: return D({ hour: "numeric", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
    case 12: return D({ hour: "numeric", minute: "2-digit", hour12: true });
    case 13: return D({ hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true });
    default: return D({ year: "numeric", month: "numeric", day: "numeric" });
  }
}

const tag = (locale: string) => (locale === "de" ? "de-DE" : "en-US");

/** `date` in `datetimeN` format `n` for `locale` (default: the app's). */
export function formatDate(n: number, date: Date = new Date(), locale: string = getLocale()): string {
  const loc = tag(locale);
  const o = options(n);
  if (o) {
    // "3": day before month ("16 October 2026"); German puts the day first anyway
    if (n === 3 && loc === "en-US") {
      const p = new Intl.DateTimeFormat(loc, o).formatToParts(date);
      const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
      return `${get("day")} ${get("month")} ${get("year")}`;
    }
    return new Intl.DateTimeFormat(loc, o).format(date);
  }
  // 5: d-MMM-yy, 7: MMM-yy
  const month = new Intl.DateTimeFormat(loc, { month: "short" }).format(date).replace(/\.$/, "");
  const yy = String(date.getFullYear() % 100).padStart(2, "0");
  return n === 5 ? `${date.getDate()}-${month}-${yy}` : `${month}-${yy}`;
}

/** What a field shows on slide `slideNumber` (1-based; `null` = unknown, e.g. on a layout: `‹#›`). */
export function fieldText(field: TextField, slideNumber: number | null, fallback: string, date: Date = new Date()): string {
  switch (field.kind) {
    case "slideNumber": return slideNumber === null ? "‹#›" : String(slideNumber);
    case "dateTime": return formatDate(field.value.format, date);
    default: return fallback;
  }
}
