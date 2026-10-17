// The UI languages (P9-L0): the 24 official languages of the EU, each with
// its own name, its English name and the BCP 47 tag used for `Intl`
// (plural rules, numbers and dates of the UI chrome). A language without
// catalogs yet is listed all the same; choosing it shows English until its
// catalogs land (docs/i18n.md "Adding a language").

/** A UI language: the ISO 639-1 code, also used for `<html lang>` and the catalog file names (`locales/fr.json`). */
export type Locale =
  | "bg" | "cs" | "da" | "de" | "el" | "en" | "es" | "et" | "fi" | "fr" | "ga" | "hr"
  | "hu" | "it" | "lt" | "lv" | "mt" | "nl" | "pl" | "pt" | "ro" | "sk" | "sl" | "sv";

export interface LocaleInfo {
  id: Locale;
  /** The language's name in that language ("Français"), shown in the pickers. */
  label: string;
  /** The English name ("French"): search in the pickers, docs, reports. */
  english: string;
  /** BCP 47 tag for `Intl` ("fr-FR"). */
  tag: string;
}

/** The language choices, by code. */
export const LOCALES: readonly LocaleInfo[] = [
  { id: "bg", label: "Български", english: "Bulgarian", tag: "bg-BG" }, // i18n-ignore: each language names itself
  { id: "cs", label: "Čeština", english: "Czech", tag: "cs-CZ" }, // i18n-ignore: each language names itself
  { id: "da", label: "Dansk", english: "Danish", tag: "da-DK" }, // i18n-ignore: each language names itself
  { id: "de", label: "Deutsch", english: "German", tag: "de-DE" }, // i18n-ignore: each language names itself
  { id: "el", label: "Ελληνικά", english: "Greek", tag: "el-GR" }, // i18n-ignore: each language names itself
  { id: "en", label: "English", english: "English", tag: "en-US" }, // i18n-ignore: each language names itself
  { id: "es", label: "Español", english: "Spanish", tag: "es-ES" }, // i18n-ignore: each language names itself
  { id: "et", label: "Eesti", english: "Estonian", tag: "et-EE" }, // i18n-ignore: each language names itself
  { id: "fi", label: "Suomi", english: "Finnish", tag: "fi-FI" }, // i18n-ignore: each language names itself
  { id: "fr", label: "Français", english: "French", tag: "fr-FR" }, // i18n-ignore: each language names itself
  { id: "ga", label: "Gaeilge", english: "Irish", tag: "ga-IE" }, // i18n-ignore: each language names itself
  { id: "hr", label: "Hrvatski", english: "Croatian", tag: "hr-HR" }, // i18n-ignore: each language names itself
  { id: "hu", label: "Magyar", english: "Hungarian", tag: "hu-HU" }, // i18n-ignore: each language names itself
  { id: "it", label: "Italiano", english: "Italian", tag: "it-IT" }, // i18n-ignore: each language names itself
  { id: "lt", label: "Lietuvių", english: "Lithuanian", tag: "lt-LT" }, // i18n-ignore: each language names itself
  { id: "lv", label: "Latviešu", english: "Latvian", tag: "lv-LV" }, // i18n-ignore: each language names itself
  { id: "mt", label: "Malti", english: "Maltese", tag: "mt-MT" }, // i18n-ignore: each language names itself
  { id: "nl", label: "Nederlands", english: "Dutch", tag: "nl-NL" }, // i18n-ignore: each language names itself
  { id: "pl", label: "Polski", english: "Polish", tag: "pl-PL" }, // i18n-ignore: each language names itself
  { id: "pt", label: "Português", english: "Portuguese", tag: "pt-PT" }, // i18n-ignore: each language names itself
  { id: "ro", label: "Română", english: "Romanian", tag: "ro-RO" }, // i18n-ignore: each language names itself
  { id: "sk", label: "Slovenčina", english: "Slovak", tag: "sk-SK" }, // i18n-ignore: each language names itself
  { id: "sl", label: "Slovenščina", english: "Slovenian", tag: "sl-SI" }, // i18n-ignore: each language names itself
  { id: "sv", label: "Svenska", english: "Swedish", tag: "sv-SE" }, // i18n-ignore: each language names itself
];

export const DEFAULT_LOCALE: Locale = "en";

const BY_ID = new Map(LOCALES.map((l) => [l.id, l]));

export const isLocale = (v: unknown): v is Locale => typeof v === "string" && BY_ID.has(v as Locale);

/** The registry entry of `id`. */
export function localeInfo(id: Locale): LocaleInfo {
  return BY_ID.get(id) ?? BY_ID.get(DEFAULT_LOCALE)!;
}

/**
 * The best UI language for a browser language or a list of them (`navigator.languages`, most preferred first):
 * the first whose primary subtag is one of ours (`pt-BR` → `pt`, `de-AT` → `de`, `en-GB` → `en`); unknown → English.
 */
export function matchLocale(langs: string | readonly (string | null | undefined)[] | undefined | null): Locale {
  const list = typeof langs === "string" ? [langs] : (langs ?? []);
  for (const lang of list) {
    if (!lang) continue;
    const primary = lang.trim().toLowerCase().split(/[-_]/)[0] ?? "";
    if (isLocale(primary)) return primary;
  }
  return DEFAULT_LOCALE;
}

/** The first letter a picker groups `info` under (accents removed: "Čeština" → "C"; Greek and Cyrillic keep theirs). */
export function localeGroup(info: LocaleInfo): string {
  return info.label.normalize("NFD").replace(/\p{M}/gu, "").charAt(0).toUpperCase();
}

/**
 * The languages for a picker: `current` first, then all others by their own name (Latin letters A–Z, then Greek and
 * Cyrillic), grouped by first letter. `query` filters by own name, English name or code (accents ignored).
 */
export function pickerGroups(current: Locale, query = ""): { current: LocaleInfo | null; groups: { letter: string; items: LocaleInfo[] }[] } {
  const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const q = fold(query.trim());
  const match = (l: LocaleInfo) => !q || fold(l.label).includes(q) || fold(l.english).includes(q) || l.id === q;
  const collator = new Intl.Collator("en");
  const others = LOCALES.filter((l) => l.id !== current && match(l)).sort((a, b) => collator.compare(a.label, b.label));
  const groups: { letter: string; items: LocaleInfo[] }[] = [];
  for (const l of others) {
    const letter = localeGroup(l);
    const last = groups[groups.length - 1];
    if (last && last.letter === letter) last.items.push(l);
    else groups.push({ letter, items: [l] });
  }
  const cur = localeInfo(current);
  return { current: match(cur) ? cur : null, groups };
}
