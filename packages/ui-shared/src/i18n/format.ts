// Numbers and dates of the UI chrome (status bars, dialogs, the recent
// list) in the UI language. Cell values, formulas and slide/document
// content are NOT formatted here: their display stays en-US (see
// docs/i18n.md).

import type { Locale } from "./core";
import { localeInfo } from "./locales";
import { getLocale } from "./locale";

/** The BCP 47 tag used for `Intl` in `locale` (default: the current UI language): `de-DE`, `fr-FR`, `pt-PT` … */
export function intlLocale(locale: Locale = getLocale()): string {
  return localeInfo(locale).tag;
}

export function formatNumber(n: number, options?: Intl.NumberFormatOptions, locale?: Locale): string {
  return new Intl.NumberFormat(intlLocale(locale), options).format(n);
}

export function formatDate(d: Date | number, options?: Intl.DateTimeFormatOptions, locale?: Locale): string {
  return new Intl.DateTimeFormat(intlLocale(locale), options).format(d);
}
