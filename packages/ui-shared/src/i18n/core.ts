// UI translations (P7-11): flat message catalogs per locale
// (`locales/en.json`, `locales/de.json` in every package) with `{name}`
// interpolation and simple plurals (`key.one` / `key.other`, chosen by
// `params.count`). No runtime dependency: a catalog is a plain JSON object.

/** The UI languages. More may follow: add a catalog per package and an entry here. */
export type Locale = "en" | "de";

/** The language choices, each named in its own language. */
export const LOCALES: { id: Locale; label: string }[] = [
  { id: "en", label: "English" }, // i18n-ignore: each language in its own language
  { id: "de", label: "Deutsch" }, // i18n-ignore
];

export const DEFAULT_LOCALE: Locale = "en";

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

/** `one` for exactly 1 (English and German), else `other`. */
export function pluralForm(count: number): "one" | "other" {
  return count === 1 ? "one" : "other";
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
      const plural = table[`${key}.${pluralForm(params.count)}`] ?? table[`${key}.other`];
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
