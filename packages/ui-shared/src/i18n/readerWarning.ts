// File reader warnings in the UI language (W-26). The Rust readers report
// a stable code, the values of its `{name}` placeholders and the English
// text; the shared catalog holds `reader.<code>` in every language, so the
// status bar shows the warning translated, falling back to the reader's
// English text for codes without a message (or plain strings).

import type { Locale } from "./core";
import { getLocale, i18n } from "./locale";

/** A reader warning as the cores send it (`ReaderWarning` of write-core); a plain string is an untranslated one. */
export interface ReaderWarningLike {
  code?: string;
  params?: Record<string, string>;
  text: string;
  count?: number;
}

/** The catalog key of a reader warning code. */
export const readerWarningKey = (code: string): string => `reader.${code}`;

/** The warning in `locale` (default: the UI language), with "(N×)" for repeats. */
export function readerWarningText(w: ReaderWarningLike | string, locale: Locale = getLocale()): string {
  if (typeof w === "string") return w;
  const key = w.code ? readerWarningKey(w.code) : null;
  const text = key && i18n.has(locale, key) ? i18n.translate(locale, key, w.params) : w.text;
  return (w.count ?? 1) > 1 ? `${text} (${w.count}×)` : text;
}
