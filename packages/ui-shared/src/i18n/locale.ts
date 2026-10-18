// The window's UI language: detected from the browser languages
// (`navigator.languages`, best match among the 24 UI languages) unless the
// user picked one (File backstage, View › Language, Options), which is
// persisted in `localStorage` – in the desktop shells that is the webview's
// storage in the app data directory. Changing it loads the language's
// catalogs (English and German are bundled, the others are fetched once,
// one chunk per package and language), then notifies subscribers (React
// re-renders through `useT`) and updates `<html lang>`. A language
// without catalogs yet shows English (a console note says so).

import { createI18n, type I18n, type Messages, type Params } from "./core";
import { DEFAULT_LOCALE, LOCALES, isLocale, localeInfo, matchLocale, type Locale } from "./locales";
import de from "./locales/de.json";
import en from "./locales/en.json";

/** `localStorage` key of the user's choice (shared by all apps and the portal: same origin on the web). */
export const LOCALE_STORAGE_KEY = "rusuite.locale";

/** Every catalog of this window: the shared one plus the app's (`addCatalogs`). */
export const i18n: I18n = createI18n({ locales: { en, de }, fallback: DEFAULT_LOCALE });

/** Lazily loaded catalogs of one package: language → a loader of `locales/<lang>.json` (a module or the object). */
export type CatalogLoaders = Partial<Record<Locale, () => Promise<unknown>>>;

/** Turns Vite's `import.meta.glob("./locales/*.json")` result into loaders by language (other file names are ignored). */
export function catalogLoaders(glob: Record<string, () => Promise<unknown>>): CatalogLoaders {
  const out: CatalogLoaders = {};
  for (const [file, load] of Object.entries(glob)) {
    const id = /(?:^|\/)([a-z]{2})\.json$/.exec(file)?.[1];
    if (isLocale(id)) out[id] = load;
  }
  return out;
}

interface Source {
  /** Languages whose messages are in `i18n` already. */
  loaded: Set<Locale>;
  lazy: CatalogLoaders;
  loading: Map<Locale, Promise<void>>;
}
const sources: Source[] = [];

const messagesOf = (mod: unknown): Messages =>
  (mod !== null && typeof mod === "object" && "default" in mod ? (mod as { default: Messages }).default : mod) as Messages;

function loadInto(src: Source, l: Locale): Promise<void> {
  const load = src.lazy[l];
  if (src.loaded.has(l) || !load) return Promise.resolve();
  let p = src.loading.get(l);
  if (!p) {
    p = load().then((mod) => {
      i18n.extend({ [l]: messagesOf(mod) });
      src.loaded.add(l);
    });
    src.loading.set(l, p);
    p.catch(() => src.loading.delete(l)); // a failed fetch is tried again next time
  }
  return p;
}

const loadedEverywhere = (l: Locale) => sources.every((s) => s.loaded.has(l) || !s.lazy[l]);

/**
 * Test-only hook (docs/i18n.md "Fallback tests"): once all 24 languages have catalogs, the "(not translated yet)"
 * fallback is still tested by declaring a registered language catalog-less: `globalThis.__rusuiteNoCatalog = ["mt"]`
 * (unit tests) or `page.addInitScript` before the app loads (e2e). Nothing sets it in the product.
 */
function declaredCatalogless(l: Locale): boolean {
  const list = (globalThis as { __rusuiteNoCatalog?: unknown }).__rusuiteNoCatalog;
  return Array.isArray(list) && list.includes(l);
}

/** Whether `l` has catalogs (a translation adds them to every package at once; a missing key falls back to English). */
export function hasCatalog(l: Locale): boolean {
  if (l === DEFAULT_LOCALE) return true;
  if (declaredCatalogless(l)) return false;
  return sources.some((s) => s.loaded.has(l) || !!s.lazy[l]);
}

/** The languages with catalogs, in `LOCALES` order. */
export function availableLocales(): Locale[] {
  return LOCALES.map((l) => l.id).filter(hasCatalog);
}

/** Loads the catalogs of `l` of every package (once); `false` when the language has none yet. */
export async function loadLocale(l: Locale): Promise<boolean> {
  if (!hasCatalog(l)) return false;
  // A package registering its catalogs meanwhile is loaded too.
  while (!loadedEverywhere(l)) await Promise.all(sources.map((s) => loadInto(s, l)));
  return true;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** The persisted choice, if any. */
export function storedLocale(): Locale | null {
  try {
    const v = storage()?.getItem(LOCALE_STORAGE_KEY);
    return isLocale(v) ? v : null;
  } catch {
    return null;
  }
}

/** Best UI language for a browser language (`de-AT` → `de`, `pt-BR` → `pt`, unknown → `en`). */
export function localeFromLanguage(lang: string | readonly string[] | undefined | null): Locale {
  return matchLocale(lang);
}

/** The stored choice, else the best match of the browser languages. */
export function detectLocale(): Locale {
  const nav = typeof navigator === "undefined" ? null : navigator;
  return storedLocale() ?? matchLocale(nav?.languages?.length ? nav.languages : [nav?.language]);
}

/** The language asked for (stored, detected or set) – may lack catalogs, unlike `getLocale()`. */
let requested: Locale = detectLocale();
/** The language shown. */
let current: Locale = DEFAULT_LOCALE;
/** Until the first language is shown (its catalogs may still be loading): `I18nProvider` renders nothing. */
let booting = true;
const listeners = new Set<() => void>();
const notify = () => {
  for (const fn of listeners) fn();
};

function applyHtmlLang(): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = current;
  document.documentElement.dir = "ltr"; // no right-to-left language among the 24
}

const noted = new Set<Locale>();
/** `l`, or English when `l` has no catalogs yet (noted once on the console). */
function shown(l: Locale): Locale {
  if (hasCatalog(l)) return l;
  if (!noted.has(l)) {
    noted.add(l);
    console.info(`rusuite: no ${localeInfo(l).english} (${l}) translation yet – showing English`);
  }
  return DEFAULT_LOCALE;
}

function apply(l: Locale): void {
  const changed = l !== current || booting;
  booting = false;
  current = l;
  applyHtmlLang();
  if (changed) notify();
}

function switchTo(target: Locale, asked: Locale): Promise<void> {
  if (loadedEverywhere(target)) {
    apply(target);
    return Promise.resolve();
  }
  return loadLocale(target).then(
    () => {
      if (requested === asked) apply(target);
    },
    (e: unknown) => {
      console.warn(`rusuite: could not load the ${localeInfo(target).english} catalogs – showing English`, e);
      if (requested === asked) apply(DEFAULT_LOCALE);
    },
  );
}

/**
 * Adds a package's catalogs: `bundled` (at least English) now, `lazy` ones when their language is chosen. The shared
 * catalogs come first; each app adds its own in `src/i18n.ts`.
 */
export function addCatalogs(bundled: Partial<Record<Locale, Messages>>, lazy: CatalogLoaders = {}): void {
  i18n.extend(bundled);
  const src: Source = { loaded: new Set(Object.keys(bundled) as Locale[]), lazy, loading: new Map() };
  sources.push(src);
  // The language on screen needs this package's messages too.
  if (!booting && !src.loaded.has(current) && lazy[current]) void loadInto(src, current).then(notify, () => {});
}

/** Adds an app's bundled catalogs to the window's translations. */
export function addMessages(locales: Partial<Record<Locale, Messages>>): void {
  addCatalogs(locales);
}

// The shared catalogs: English and German bundled, every other language its own chunk.
// @ts-ignore -- Vite's import.meta.glob (typed by vite/client in the apps)
addCatalogs({ en, de }, catalogLoaders(import.meta.glob(["./locales/*.json", "!./locales/en.json", "!./locales/de.json"])));
void switchTo(shown(requested), requested);

export function getLocale(): Locale {
  return current;
}

/** Whether the first language is on screen (false only while its catalogs load at start-up). */
export function isLocaleReady(): boolean {
  return !booting;
}

/**
 * Switches the UI language (persisted unless `persist: false`). Resolves once the language is shown: at once when
 * its catalogs are loaded, else after loading them; a language without catalogs shows English.
 */
export function switchLocale(locale: Locale, { persist = true }: { persist?: boolean } = {}): Promise<void> {
  if (persist) {
    try {
      storage()?.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
      // Private mode / blocked storage: the choice lasts for this page.
    }
  }
  requested = locale;
  return switchTo(shown(locale), locale);
}

/** `switchLocale` without waiting (a loaded language switches synchronously, e.g. inside `act()` in tests). */
export function setLocale(locale: Locale, options: { persist?: boolean } = {}): void {
  void switchLocale(locale, options);
}

export function subscribeLocale(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Translates in the current language (outside React, or inside a component that called `useT`). */
export function t(key: string, params?: Params): string {
  return i18n.translate(current, key, params);
}
