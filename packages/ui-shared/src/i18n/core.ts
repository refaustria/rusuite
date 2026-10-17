// UI translations (P7-11, P9-L0): flat message catalogs per locale
// (`locales/<lang>.json` in every package) with `{name}` interpolation and
// plurals chosen by `Intl.PluralRules` of the language (`key.one`,
// `key.few`, `key.many`, `key.other` …, picked by `params.count`). No
// runtime dependency: a catalog is a plain JSON object.

import { DEFAULT_LOCALE, localeInfo, type Locale } from "./locales";

export { DEFAULT_LOCALE, LOCALES, isLocale, localeGroup, localeInfo, matchLocale, pickerGroups, type Locale, type LocaleInfo } from "./locales";

/** One catalog: namespaced keys (`ribbon.file`, `dialog.saveAs.title`) to messages. */
export type Messages = Record<string, string>;

/** Interpolation values; `count` also picks the plural form. */
export type Params = Record<string, string | number>;

export type TFunction = (key: string, params?: Params) => string;

export interface I18nOptions {
  locales: Partial<Record<Locale, Messages>> & { en: Messages };
  /** Locale used for keys missing in the requested one (default `en`). */
  fallback?: Locale;
}

export interface I18n {
  readonly fallback: Locale;
  /** Translates `key` in `locale`; unknown keys come back as the key itself. */
  translate(locale: Locale, key: string, params?: Params): string;
  /** A `t` bound to `locale`. */
  bind(locale: Locale): TFunction;
  /** Whether `key` (or its plural forms) exists in `locale`. */
  has(locale: Locale, key: string): boolean;
  /** Adds (or overrides) messages, e.g. an app's catalog on top of the shared one. */
  extend(locales: Partial<Record<Locale, Messages>>): void;
}

/** Replaces `{name}` by `params.name`; unknown placeholders stay as written. */
export function interpolate(message: string, params?: Params): string {
  if (!params) return message;
  return message.replace(/\{(\w+)\}/g, (all, name: string) => (name in params ? String(params[name]) : all));
}

/** A CLDR plural category: the suffix of a plural key (`files.few`). */
export type PluralCategory = "zero" | "one" | "two" | "few" | "many" | "other";

const pluralRules = new Map<Locale, Intl.PluralRules>();
const rulesOf = (locale: Locale): Intl.PluralRules => {
  let r = pluralRules.get(locale);
  if (!r) pluralRules.set(locale, (r = new Intl.PluralRules(localeInfo(locale).tag)));
  return r;
};

/** The plural category of `count` in `locale` (English and German: `one` for 1, else `other`; Polish 2–4: `few` …). */
export function pluralForm(count: number, locale: Locale = DEFAULT_LOCALE): PluralCategory {
  return rulesOf(locale).select(count) as PluralCategory;
}

/** The plural categories `locale` distinguishes (the keys a plural message needs in its catalog). */
export function pluralCategories(locale: Locale): PluralCategory[] {
  return rulesOf(locale).resolvedOptions().pluralCategories as PluralCategory[];
}

export function createI18n({ locales, fallback = DEFAULT_LOCALE }: I18nOptions): I18n {
  const tables: Partial<Record<Locale, Messages>> = {};
  const extend = (more: Partial<Record<Locale, Messages>>) => {
    for (const [l, m] of Object.entries(more) as [Locale, Messages][]) tables[l] = { ...tables[l], ...m };
  };
  extend(locales);
  const lookup = (locale: Locale, key: string, params?: Params): string | undefined => {
    const table = tables[locale];
    if (!table) return undefined;
    if (params && typeof params.count === "number") {
      const plural = table[`${key}.${pluralForm(params.count, locale)}`] ?? table[`${key}.other`];
      if (plural !== undefined) return plural;
    }
    return table[key];
  };
  const translate = (locale: Locale, key: string, params?: Params) => {
    const m = lookup(locale, key, params) ?? lookup(fallback, key, params);
    return m === undefined ? key : interpolate(m, params);
  };
  return {
    fallback,
    translate,
    bind: (locale) => (key, params) => translate(locale, key, params),
    has: (locale, key) => {
      const table = tables[locale] ?? {};
      return key in table || `${key}.other` in table;
    },
    extend,
  };
}
