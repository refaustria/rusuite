// The window's UI language: detected from `navigator.language` (de* →
// German, else English) unless the user picked one (File backstage or
// View › Language), which is persisted in `localStorage` – in the desktop
// shells that is the webview's storage in the app data directory. Changing
// it notifies subscribers (React re-renders through `useT`) and updates
// `<html lang>`.

import { createI18n, DEFAULT_LOCALE, LOCALES, type I18n, type Locale, type Messages, type Params } from "./core";
import de from "./locales/de.json";
import en from "./locales/en.json";

/** `localStorage` key of the user's choice (shared by all apps and the portal: same origin on the web). */
export const LOCALE_STORAGE_KEY = "rusuite.locale";

/** Every catalog of this window: the shared one plus the app's (`addMessages`). */
export const i18n: I18n = createI18n({ locales: { en, de }, fallback: DEFAULT_LOCALE });

const isLocale = (v: unknown): v is Locale => LOCALES.some((l) => l.id === v);

/** `de`, `de-AT`, … → `de`; anything else → `en`. */
export function localeFromLanguage(lang: string | undefined | null): Locale {
  return lang && /^de\b/i.test(lang) ? "de" : "en";
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

/** The stored choice, else the browser language. */
export function detectLocale(): Locale {
  return storedLocale() ?? localeFromLanguage(typeof navigator === "undefined" ? null : navigator.language);
}

let current: Locale = detectLocale();
const listeners = new Set<() => void>();

function applyHtmlLang(): void {
  if (typeof document !== "undefined") document.documentElement.lang = current;
}
applyHtmlLang();

export function getLocale(): Locale {
  return current;
}

/** Switches the UI language (persisted unless `persist: false`). */
export function setLocale(locale: Locale, { persist = true }: { persist?: boolean } = {}): void {
  if (persist) {
    try {
      storage()?.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
      // Private mode / blocked storage: the choice lasts for this page.
    }
  }
  if (locale === current) return;
  current = locale;
  applyHtmlLang();
  for (const fn of listeners) fn();
}

export function subscribeLocale(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Adds an app's catalogs to the window's translations. */
export function addMessages(locales: Partial<Record<Locale, Messages>>): void {
  i18n.extend(locales);
}

/** Translates in the current language (outside React, or inside a component that called `useT`). */
export function t(key: string, params?: Params): string {
  return i18n.translate(current, key, params);
}
