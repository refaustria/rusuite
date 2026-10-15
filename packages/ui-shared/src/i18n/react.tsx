// React bindings: `useT()` re-renders the component when the language
// changes; `<I18nProvider>` keeps `<html lang>` in sync (and can force a
// language, e.g. in tests); `LanguageSelect` is the "Language / Sprache"
// picker of the File backstage and the View tab.

import { useLayoutEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { FOCUS_RING } from "../Popover";
import { LOCALES, type Locale, type TFunction } from "./core";
import { getLocale, i18n, setLocale, subscribeLocale } from "./locale";

/** The current UI language (re-renders on change). */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribeLocale, getLocale, getLocale);
}

/** `t` in the current language; the component re-renders when it changes. */
export function useT(): TFunction {
  const locale = useLocale();
  return useMemo(() => i18n.bind(locale), [locale]);
}

/**
 * Root of an app's tree. Without `locale` the detected/persisted language
 * applies; with it, that language is used (not persisted).
 */
export function I18nProvider({ locale, children }: { locale?: Locale; children: ReactNode }) {
  useState(() => {
    if (locale && locale !== getLocale()) setLocale(locale, { persist: false });
    return null;
  });
  useLayoutEffect(() => {
    if (locale) setLocale(locale, { persist: false });
  }, [locale]);
  useLocale();
  return <>{children}</>;
}

/** The language picker ("Language / Sprache": English, Deutsch). */
export function LanguageSelect({ className, compact }: { className?: string; compact?: boolean }) {
  const t = useT();
  const locale = useLocale();
  const label = t("language.label");
  return (
    <label className={`flex items-center gap-2 text-sm ${className ?? ""}`}>
      {!compact && <span>{label}</span>}
      <select
        aria-label={label}
        title={label}
        data-testid="language-select"
        className={`h-7 rounded border border-ui-border bg-ui-bg px-1 text-sm text-ui-fg ${FOCUS_RING}`}
        value={locale}
        onChange={(e) => setLocale(e.target.value as Locale)}
      >
        {LOCALES.map((l) => (
          <option key={l.id} value={l.id} lang={l.id}>
            {l.label}
          </option>
        ))}
      </select>
    </label>
  );
}
