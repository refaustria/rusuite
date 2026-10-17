import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { compareCatalogs, createI18n, formatCombo, formatNumber, getLocale, I18nProvider, LanguageSelect, LOCALE_STORAGE_KEY, localeFromLanguage, setLocale, t, useT, withLabel } from "../index";
import { Backstage } from "../ribbon/Backstage";
import de from "./locales/de.json";
import en from "./locales/en.json";

afterEach(() => {
  cleanup();
  act(() => setLocale("en"));
  localStorage.clear();
});

describe("createI18n", () => {
  const i18n = createI18n({
    locales: {
      en: { hello: "Hello {name}", "files.one": "{count} file", "files.other": "{count} files", onlyEn: "English" },
      de: { hello: "Hallo {name}", "files.one": "{count} Datei", "files.other": "{count} Dateien" },
    },
  });

  it("interpolates and falls back to English and to the key", () => {
    expect(i18n.translate("de", "hello", { name: "Ana" })).toBe("Hallo Ana");
    expect(i18n.translate("de", "onlyEn")).toBe("English");
    expect(i18n.translate("de", "missing.key")).toBe("missing.key");
    expect(i18n.translate("en", "hello")).toBe("Hello {name}");
  });

  it("picks plural forms by count", () => {
    const tde = i18n.bind("de");
    expect(tde("files", { count: 1 })).toBe("1 Datei");
    expect(tde("files", { count: 0 })).toBe("0 Dateien");
    expect(i18n.bind("en")("files", { count: 3 })).toBe("3 files");
  });
});

describe("catalogs", () => {
  it("de.json has exactly the keys of en.json", () => {
    expect(compareCatalogs(en, de)).toEqual({ missing: [], extra: [] });
  });

  it("keeps the placeholders of every message", () => {
    const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const [k, v] of Object.entries(en)) expect(names((de as Record<string, string>)[k] ?? ""), k).toEqual(names(v));
  });
});

describe("locale", () => {
  it("maps browser languages to the best UI language", () => {
    expect(localeFromLanguage("de-AT")).toBe("de");
    expect(localeFromLanguage("de")).toBe("de");
    expect(localeFromLanguage("en-US")).toBe("en");
    expect(localeFromLanguage("fr")).toBe("fr");
    expect(localeFromLanguage("ja-JP")).toBe("en");
    expect(localeFromLanguage(undefined)).toBe("en");
  });

  it("switches, persists and updates <html lang>", () => {
    act(() => setLocale("de"));
    expect(getLocale()).toBe("de");
    expect(document.documentElement.lang).toBe("de");
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("de");
    expect(t("backstage.save")).toBe("Speichern");
  });

  it("re-renders components without a reload", () => {
    function Label() {
      const tr = useT();
      return <span>{tr("backstage.open")}</span>;
    }
    render(
      <I18nProvider>
        <Label />
        <LanguageSelect />
      </I18nProvider>,
    );
    expect(screen.getByText("Open…")).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox", { name: "Language / Sprache" }), { target: { value: "de" } });
    expect(screen.getByText("Öffnen…")).toBeTruthy();
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("de");
  });

  it("I18nProvider can force a language without persisting it", () => {
    render(
      <I18nProvider locale="de">
        <Backstage open onClose={() => {}} appName="Rusuite Calc" onSave={() => {}} onNew={() => {}} />
      </I18nProvider>,
    );
    expect(screen.getByRole("button", { name: /^Speichern/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Unbenannt" })).toBeTruthy();
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBeNull();
  });

  it("labels of constant lists follow the language", () => {
    const item = withLabel({ value: "x" }, "print.portrait");
    expect(item.label).toBe("Portrait");
    act(() => setLocale("de"));
    expect(item.label).toBe("Hochformat");
  });

  it("shows Strg for Ctrl in German and formats numbers", () => {
    expect(formatCombo("Mod+Shift+S", false, "de")).toBe("Strg+Umschalt+S");
    expect(formatCombo("Ctrl+C", false, "de")).toBe("Strg+C");
    expect(formatCombo("Ctrl+C", false, "en")).toBe("Ctrl+C");
    expect(formatNumber(1234.5, undefined, "de")).toBe("1.234,5");
    expect(formatNumber(1234.5, undefined, "en")).toBe("1,234.5");
  });
});
