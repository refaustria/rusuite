// P9-L0: the 24-language registry, browser matching, plural categories, lazy catalogs with the English fallback,
// localized key names and the pickers.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import {
  LOCALES, LOCALE_STORAGE_KEY, LanguageList, LanguageSelect, addCatalogs, availableLocales, catalogLoaders, createI18n, formatCombo,
  formatNumber, getLocale, hasCatalog, intlLocale, isLocale, localeGroup, localeInfo, matchLocale, pickerGroups, pluralCategories,
  pluralForm, setLocale, switchLocale, t, I18nProvider,
} from "../index";

afterEach(() => {
  cleanup();
  act(() => setLocale("en"));
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("registry", () => {
  it("lists the 24 official EU languages once each, by code", () => {
    const ids = LOCALES.map((l) => l.id);
    expect(ids).toHaveLength(24);
    expect(new Set(ids).size).toBe(24);
    expect([...ids].sort()).toEqual(ids);
    expect(ids).toEqual(["bg", "cs", "da", "de", "el", "en", "es", "et", "fi", "fr", "ga", "hr", "hu", "it", "lt", "lv", "mt", "nl", "pl", "pt", "ro", "sk", "sl", "sv"]);
  });

  it("names every language in its own language and in English", () => {
    expect(localeInfo("fr")).toMatchObject({ label: "Français", english: "French" });
    expect(localeInfo("el").label).toBe("Ελληνικά");
    expect(localeInfo("bg").label).toBe("Български");
    expect(localeInfo("sl").label).toBe("Slovenščina");
    for (const l of LOCALES) expect(l.label.length, l.id).toBeGreaterThan(2);
  });

  it("has a valid BCP 47 tag per language for Intl (pt is European Portuguese)", () => {
    for (const l of LOCALES) {
      expect(Intl.getCanonicalLocales(l.tag)[0], l.id).toBe(l.tag);
      expect(l.tag.startsWith(`${l.id}-`)).toBe(true);
    }
    expect(intlLocale("pt")).toBe("pt-PT");
    expect(intlLocale("sl")).toBe("sl-SI");
  });

  it("isLocale accepts the codes only", () => {
    expect(isLocale("ga")).toBe(true);
    expect(isLocale("GA")).toBe(false);
    expect(isLocale("no")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });
});

describe("matchLocale", () => {
  it("maps regional variants to the language", () => {
    expect(matchLocale("pt-BR")).toBe("pt");
    expect(matchLocale("de-AT")).toBe("de");
    expect(matchLocale("en-GB")).toBe("en");
    expect(matchLocale("fr-CA")).toBe("fr");
    expect(matchLocale("sv_SE")).toBe("sv");
    expect(matchLocale("EL")).toBe("el");
  });

  it("falls back to English for unknown or missing languages", () => {
    expect(matchLocale("ja-JP")).toBe("en");
    expect(matchLocale("no")).toBe("en");
    expect(matchLocale("")).toBe("en");
    expect(matchLocale(undefined)).toBe("en");
    expect(matchLocale([])).toBe("en");
  });

  it("takes the first supported language of a preference list", () => {
    expect(matchLocale(["ja", "ru-RU", "pl-PL", "de"])).toBe("pl");
    expect(matchLocale([null, "hr"])).toBe("hr");
  });
});

describe("plurals", () => {
  it("knows the categories per language", () => {
    expect(pluralCategories("en").sort()).toEqual(["one", "other"]);
    expect(pluralCategories("de").sort()).toEqual(["one", "other"]);
    expect(pluralCategories("pl").sort()).toEqual(["few", "many", "one", "other"]);
    expect(pluralCategories("ga").sort()).toEqual(["few", "many", "one", "other", "two"]);
    expect(pluralCategories("lv")).toContain("zero");
  });

  it.each([
    ["pl", [[1, "one"], [2, "few"], [5, "many"], [22, "few"], [25, "many"]]],
    ["cs", [[1, "one"], [3, "few"], [5, "other"], [1.5, "many"]]],
    ["lt", [[1, "one"], [2, "few"], [10, "other"], [21, "one"], [0.5, "many"]]],
    ["ga", [[1, "one"], [2, "two"], [3, "few"], [7, "many"], [11, "other"]]],
    ["mt", [[1, "one"], [3, "few"], [11, "many"], [20, "other"]]],
    ["ro", [[1, "one"], [2, "few"], [20, "other"], [101, "few"]]],
    ["sl", [[1, "one"], [2, "two"], [3, "few"], [5, "other"], [101, "one"], [102, "two"]]],
  ] as const)("%s picks the CLDR category", (lang, cases) => {
    for (const [n, cat] of cases) expect(pluralForm(n, lang), `${lang} ${n}`).toBe(cat);
  });

  it("t() chooses the key of the category and falls back to .other", () => {
    const i18n = createI18n({
      locales: {
        en: { "files.one": "{count} file", "files.other": "{count} files" },
        pl: { "files.one": "{count} plik", "files.few": "{count} pliki", "files.many": "{count} plików", "files.other": "{count} pliku" },
        cs: { "files.one": "{count} soubor", "files.other": "{count} souborů" },
      },
    });
    const pl = i18n.bind("pl");
    expect(pl("files", { count: 1 })).toBe("1 plik");
    expect(pl("files", { count: 3 })).toBe("3 pliki");
    expect(pl("files", { count: 12 })).toBe("12 plików");
    expect(pl("files", { count: 1.5 })).toBe("1.5 pliku");
    expect(i18n.translate("cs", "files", { count: 3 })).toBe("3 souborů"); // no .few: .other
    expect(i18n.translate("ga", "files", { count: 2 })).toBe("2 files"); // no catalog: English
  });
});

describe("lazy catalogs", () => {
  it("maps Vite glob keys to languages", () => {
    const load = () => Promise.resolve({});
    expect(Object.keys(catalogLoaders({ "./locales/fr.json": load, "./locales/xx.json": load, "./locales/notes.json": load }))).toEqual(["fr"]);
  });

  it("English and German are there; languages without catalogs are not", () => {
    expect(hasCatalog("en")).toBe(true);
    expect(hasCatalog("de")).toBe(true);
    expect(hasCatalog("sv")).toBe(false);
    expect(availableLocales()).toEqual(expect.arrayContaining(["de", "en"]));
    expect(availableLocales()).not.toContain("sv");
  });

  it("loads a language when it is chosen, once, then switches", async () => {
    const fr = vi.fn(() => Promise.resolve({ default: { "backstage.save": "Enregistrer", "test.hello": "Salut {name}" } }));
    addCatalogs({ en: { "test.hello": "Hello {name}", "test.onlyEnglish": "Only English" } }, { fr });
    expect(hasCatalog("fr")).toBe(true);
    const switching = switchLocale("fr");
    expect(getLocale()).toBe("en"); // until the catalog is there
    await act(() => switching);
    expect(getLocale()).toBe("fr");
    expect(document.documentElement.lang).toBe("fr");
    expect(document.documentElement.dir).toBe("ltr");
    expect(t("test.hello", { name: "Ana" })).toBe("Salut Ana");
    expect(t("test.onlyEnglish")).toBe("Only English"); // missing key: English
    await act(() => switchLocale("en"));
    await act(() => switchLocale("fr"));
    expect(fr).toHaveBeenCalledTimes(1);
  });

  it("a language without catalogs shows English, says so once, and keeps the choice", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await act(() => switchLocale("sv"));
    expect(getLocale()).toBe("en");
    expect(document.documentElement.lang).toBe("en");
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("sv");
    await act(() => switchLocale("sv"));
    expect(info).toHaveBeenCalledTimes(1);
    expect(String(info.mock.calls[0]?.[0])).toMatch(/Swedish \(sv\)/);
  });

  it("a catalog that fails to load shows English and is tried again next time", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const load = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ "test.hello": "Ciao {name}" });
    addCatalogs({ en: {} }, { it: load });
    await act(() => switchLocale("it"));
    expect(getLocale()).toBe("en");
    await act(() => switchLocale("it"));
    expect(getLocale()).toBe("it");
    expect(t("test.hello", { name: "Ana" })).toBe("Ciao Ana");
  });

  it("an app catalog added while a lazy language is shown loads too", async () => {
    addCatalogs({ en: {} }, { nl: () => Promise.resolve({ "test.a": "Hallo" }) });
    await act(() => switchLocale("nl"));
    let resolve: (v: unknown) => void = () => {};
    addCatalogs({ en: { "test.b": "Goodbye" } }, { nl: () => new Promise((r) => (resolve = r)) });
    expect(t("test.b")).toBe("Goodbye");
    await act(async () => resolve({ "test.b": "Tot ziens" }));
    expect(t("test.b")).toBe("Tot ziens");
  });

  it("the last choice wins when loads overlap", async () => {
    let resolve: (v: unknown) => void = () => {};
    addCatalogs({ en: {} }, { pl: () => new Promise((r) => (resolve = r)) });
    const slow = switchLocale("pl");
    await act(() => switchLocale("de"));
    resolve({ "test.a": "Cześć" });
    await act(() => slow);
    expect(getLocale()).toBe("de");
  });
});

describe("formats and key names", () => {
  it("formats numbers in the UI language", () => {
    expect(formatNumber(1234.5, undefined, "fr")).toMatch(/^1\s234,5$/);
    expect(formatNumber(1234.5, undefined, "de")).toBe("1.234,5");
    expect(formatNumber(1234.5, undefined, "en")).toBe("1,234.5");
  });

  it("names keys as the Office of the language does", () => {
    expect(formatCombo("Mod+Shift+S", false, "de")).toBe("Strg+Umschalt+S");
    expect(formatCombo("Ctrl+Delete", false, "de")).toBe("Strg+Entf");
    expect(formatCombo("Shift+Enter", false, "de")).toBe("Umschalt+Eingabe");
    expect(formatCombo("Mod+Shift+S", false, "fr")).toBe("Ctrl+Maj+S");
    expect(formatCombo("Del", false, "fr")).toBe("Suppr");
    expect(formatCombo("Mod+Shift+Delete", false, "es")).toBe("Ctrl+Mayús+Supr");
    expect(formatCombo("Shift+Delete", false, "it")).toBe("Maiusc+Canc");
    expect(formatCombo("Mod+Shift+S", false, "sv")).toBe("Ctrl+Skift+S");
    expect(formatCombo("Mod+Shift+S", false, "fi")).toBe("Ctrl+Vaihto+S");
  });

  it("keeps the English names where Office does, and the Mac symbols", () => {
    expect(formatCombo("Mod+Shift+Delete", false, "pl")).toBe("Ctrl+Shift+Delete");
    expect(formatCombo("Alt+F4", false, "cs")).toBe("Alt+F4");
    expect(formatCombo("Mod+Alt+S", true, "de")).toBe("⌘+⌥+S");
    expect(formatCombo("Ctrl+Plus", false, "en")).toBe("Ctrl++");
  });
});

describe("pickers", () => {
  it("groups by own name A–Z with the current language first", () => {
    const { current, groups } = pickerGroups("de");
    expect(current?.id).toBe("de");
    const letters = groups.map((g) => g.letter);
    expect(letters.slice(0, 3)).toEqual(["C", "D", "E"]);
    expect(groups.find((g) => g.letter === "C")?.items.map((l) => l.id)).toEqual(["cs"]);
    expect(groups.find((g) => g.letter === "D")?.items.map((l) => l.id)).toEqual(["da"]);
    expect(groups.flatMap((g) => g.items)).toHaveLength(23);
    expect(localeGroup(localeInfo("el"))).toBe("Ε");
  });

  it("filters by own name, English name or code, ignoring accents", () => {
    expect(pickerGroups("en", "german").groups.flatMap((g) => g.items.map((l) => l.id))).toEqual(["de"]);
    expect(pickerGroups("en", "cestina").groups.flatMap((g) => g.items.map((l) => l.id))).toEqual(["cs"]);
    expect(pickerGroups("en", "slov").groups.flatMap((g) => g.items.map((l) => l.id)).sort()).toEqual(["sk", "sl"]);
    expect(pickerGroups("en", "zzz")).toEqual({ current: null, groups: [] });
  });

  it("LanguageSelect lists all 24 languages, marks those without catalogs and falls back cleanly", () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    render(
      <I18nProvider>
        <LanguageSelect />
      </I18nProvider>,
    );
    const select = screen.getByRole("combobox", { name: "Language / Sprache" });
    expect(within(select).getAllByRole("option")).toHaveLength(24);
    expect(within(select).getAllByRole("option")[0]?.textContent).toBe("English");
    expect(within(select).getByRole("option", { name: "Svenska (not translated yet)" })).toBeTruthy();
    fireEvent.change(select, { target: { value: "sv" } });
    expect(getLocale()).toBe("en");
    fireEvent.change(select, { target: { value: "de" } });
    expect(within(select).getAllByRole("option")[0]?.textContent).toBe("Deutsch");
    expect(within(select).getByRole("option", { name: "Svenska (noch nicht übersetzt)" })).toBeTruthy();
  });

  it("LanguageList searches and picks with the keyboard", () => {
    render(
      <I18nProvider>
        <LanguageList />
      </I18nProvider>,
    );
    const list = screen.getByRole("listbox", { name: "Language / Sprache" });
    expect(within(list).getAllByRole("option")).toHaveLength(24);
    expect(within(list).getAllByRole("option")[0]?.getAttribute("aria-selected")).toBe("true");
    const search = screen.getByRole("searchbox", { name: "Search languages" });
    fireEvent.change(search, { target: { value: "deut" } });
    expect(within(screen.getByRole("listbox")).getAllByRole("option").map((o) => o.dataset.locale)).toEqual(["de"]);
    fireEvent.keyDown(search, { key: "Enter" });
    expect(getLocale()).toBe("de");
    expect(screen.getByRole("searchbox", { name: "Sprachen durchsuchen" })).toBeTruthy();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } });
    const options = within(screen.getByRole("listbox")).getAllByRole("option");
    options[0]!.focus();
    fireEvent.keyDown(options[0]!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(options[1]);
    fireEvent.keyDown(options[1]!, { key: "Enter" });
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe(options[1]!.dataset.locale);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "klingon" } });
    expect(screen.getByText(/Keine Sprache gefunden|No language matches/)).toBeTruthy();
  });
});
