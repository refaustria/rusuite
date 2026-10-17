// React bindings: `useT()` re-renders the component when the language
// changes; `<I18nProvider>` keeps `<html lang>` in sync (and can force a
// language, e.g. in tests); `LanguageSelect` is the "Language / Sprache"
// picker of the File backstage and the View tab, `LanguageList` the
// searchable list of File › Options › Language.

import { useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";
import { FOCUS_RING } from "../Popover";
import { pickerGroups, type Locale, type LocaleInfo, type TFunction } from "./core";
import { getLocale, hasCatalog, i18n, isLocaleReady, setLocale, subscribeLocale } from "./locale";

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
 * applies; with it, that language is used (not persisted). Renders nothing
 * while the first language's catalogs load (a language other than English
 * and German at start-up), so the UI does not flash in English.
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
  const ready = useSyncExternalStore(subscribeLocale, isLocaleReady, isLocaleReady);
  return ready ? <>{children}</> : null;
}

/** The option text of a language: its own name, plus a note while it has no catalogs. */
const optionLabel = (t: TFunction, l: LocaleInfo) => (hasCatalog(l.id) ? l.label : t("language.pending", { name: l.label }));

/**
 * The language picker ("Language / Sprache"): the current language first, then every language by its own name,
 * grouped A–Z (type a letter to jump, as in any list box).
 */
export function LanguageSelect({ className, compact }: { className?: string; compact?: boolean }) {
  const t = useT();
  const locale = useLocale();
  const label = t("language.label");
  const { current, groups } = pickerGroups(locale);
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
        {current && (
          <optgroup label={t("language.current")}>
            <option value={current.id} lang={current.id}>
              {current.label}
            </option>
          </optgroup>
        )}
        {groups.map((g) => (
          <optgroup key={g.letter} label={g.letter}>
            {g.items.map((l) => (
              <option key={l.id} value={l.id} lang={l.id}>
                {optionLabel(t, l)}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}

/** File › Options › Language: a search field over a list of all languages (own and English names), current first. */
export function LanguageList({ onPick }: { onPick?: (l: Locale) => void }) {
  const t = useT();
  const locale = useLocale();
  const [query, setQuery] = useState("");
  const list = useRef<HTMLUListElement>(null);
  const { current, groups } = pickerGroups(locale, query);
  const pick = (l: Locale) => {
    setLocale(l);
    onPick?.(l);
  };
  const options = () => [...(list.current?.querySelectorAll<HTMLElement>("[role=option]") ?? [])];
  const move = (e: KeyboardEvent, delta: number | "first" | "last") => {
    const all = options();
    if (all.length === 0) return;
    e.preventDefault();
    const at = all.indexOf(document.activeElement as HTMLElement);
    const next = delta === "first" ? 0 : delta === "last" ? all.length - 1 : Math.max(0, Math.min(all.length - 1, at + delta));
    all[next]?.focus();
  };
  const onKey = (e: KeyboardEvent, l: Locale) => {
    if (e.key === "ArrowDown") move(e, 1);
    else if (e.key === "ArrowUp") move(e, -1);
    else if (e.key === "Home") move(e, "first");
    else if (e.key === "End") move(e, "last");
    else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      pick(l);
    }
  };
  const item = (l: LocaleInfo, first: boolean) => (
    <li
      key={l.id}
      role="option"
      aria-selected={l.id === locale}
      tabIndex={first ? 0 : -1}
      data-locale={l.id}
      className={`flex cursor-pointer items-baseline justify-between gap-3 rounded px-2 py-1 text-sm hover:bg-ui-hover aria-selected:bg-ui-active ${FOCUS_RING}`}
      onClick={() => pick(l.id)}
      onKeyDown={(e) => onKey(e, l.id)}
    >
      <span lang={l.id}>{l.label}</span>
      <span className="text-xs text-ui-muted">{hasCatalog(l.id) ? l.english : t("language.pending", { name: l.english })}</span>
    </li>
  );
  const empty = !current && groups.length === 0;
  return (
    <div className="flex w-[32rem] max-w-[calc(100vw-3rem)] flex-col gap-2" data-testid="language-list">
      <p className="text-sm">{t("language.optionsText")}</p>
      <input
        type="search"
        value={query}
        aria-label={t("language.search")}
        placeholder={t("language.search")}
        className={`h-8 rounded border border-ui-border bg-ui-bg px-2 text-sm text-ui-fg ${FOCUS_RING}`}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") move(e, "first");
          else if (e.key === "Enter" && options()[0]) {
            e.preventDefault();
            pick(options()[0]!.dataset.locale as Locale);
          }
        }}
      />
      {empty ? (
        <p className="text-sm text-ui-muted">{t("language.none")}</p>
      ) : (
        <ul ref={list} role="listbox" aria-label={t("language.label")} className="max-h-72 overflow-auto rounded border border-ui-border p-1">
          {current && (
            <li role="presentation">
              <ul role="group" aria-label={t("language.current")}>
                <li role="presentation" className="px-2 pt-1 text-xs font-semibold text-ui-muted">
                  {t("language.current")}
                </li>
                {item(current, true)}
              </ul>
            </li>
          )}
          {groups.map((g, i) => (
            <li key={g.letter} role="presentation">
              <ul role="group" aria-label={g.letter}>
                <li role="presentation" className="px-2 pt-1 text-xs font-semibold text-ui-muted">
                  {g.letter}
                </li>
                {g.items.map((l, j) => item(l, !current && i === 0 && j === 0))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
