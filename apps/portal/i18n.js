// Portal translations (P7-11, P9-L0): the page is written in English; this
// script switches it to the language of the user's choice (the language
// list at the top right, stored under the same `localStorage` key as the
// apps' choice, so the apps open in it too) or of the browser (best match
// of `navigator.languages`: de-AT → de, pt-BR → pt). Catalogs
// (`locales/<lang>.json`) are fetched when their language is shown; a
// language without one yet (not in CATALOGS) shows English. Elements name
// their message with `data-i18n` (text), `data-i18n-html` (markup from the
// catalog), `data-i18n-alt`, `data-i18n-content`, `data-i18n-aria-label`;
// `data-i18n-params` (JSON) fills `{name}` placeholders (escaped in markup).
(() => {
  const KEY = "rusuite.locale";
  /** The 24 UI languages, each in its own language (as packages/ui-shared/src/i18n/locales.ts). */
  const LOCALES = [
    ["bg", "Български"], ["cs", "Čeština"], ["da", "Dansk"], ["de", "Deutsch"], ["el", "Ελληνικά"], ["en", "English"],
    ["es", "Español"], ["et", "Eesti"], ["fi", "Suomi"], ["fr", "Français"], ["ga", "Gaeilge"], ["hr", "Hrvatski"],
    ["hu", "Magyar"], ["it", "Italiano"], ["lt", "Lietuvių"], ["lv", "Latviešu"], ["mt", "Malti"], ["nl", "Nederlands"],
    ["pl", "Polski"], ["pt", "Português"], ["ro", "Română"], ["sk", "Slovenčina"], ["sl", "Slovenščina"], ["sv", "Svenska"],
  ];
  /** Languages with a portal catalog in `locales/` (pnpm i18n:check keeps this in sync with the files). */
  const CATALOGS = ["cs", "da", "de", "en", "es", "fi", "fr", "it", "nl", "pl", "pt", "sv"];
  const IDS = LOCALES.map(([id]) => id);
  const stored = () => {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  };
  const match = (langs) => {
    for (const l of langs) {
      const primary = String(l || "").toLowerCase().split(/[-_]/)[0];
      if (IDS.includes(primary)) return primary;
    }
    return "en";
  };
  const initial = () => {
    const s = stored();
    if (IDS.includes(s)) return s;
    return match(navigator.languages?.length ? navigator.languages : [navigator.language]);
  };
  const catalogs = {};
  const load = (locale) => (catalogs[locale] ??= fetch(`locales/${locale}.json`).then((r) => (r.ok ? r.json() : Promise.reject(r.status))));
  const interpolate = (msg, params) => msg.replace(/\{(\w+)\}/g, (all, k) => (params && k in params ? String(params[k]) : all));

  // Until a catalog has loaded (or if it cannot be), the page's own English texts.
  const FALLBACK = { "portal.versionUnknown": "Version unknown", "portal.build": "Build {commit}", "portal.built": "Built {date}" };
  let messages = {};
  const t = (key, params) => interpolate(messages[key] ?? FALLBACK[key] ?? key, params);
  window.rusuiteI18n = { locale: "en", t };

  const escapeHtml = (v) => String(v).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const params = (el, map = (v) => v) => {
    if (!el.dataset.i18nParams) return undefined;
    try {
      return Object.fromEntries(Object.entries(JSON.parse(el.dataset.i18nParams)).map(([k, v]) => [k, map(v)]));
    } catch {
      return undefined;
    }
  };

  const ATTRS = [
    ["data-i18n-alt", "alt"],
    ["data-i18n-content", "content"],
    ["data-i18n-aria-label", "aria-label"],
  ];

  // The language list replaces the pages' static EN/DE buttons (their no-script fallback). Current language first,
  // then all by their own name; a language without a portal catalog yet says so.
  const select = document.createElement("select");
  select.dataset.testid = "portal-language";
  select.dataset.i18nAriaLabel = "portal.language";
  for (const group of document.querySelectorAll(".lang")) {
    select.setAttribute("aria-label", group.getAttribute("aria-label") || "Language / Sprache");
    group.replaceChildren(select);
    break;
  }
  const collator = new Intl.Collator("en");
  const fillSelect = (locale) => {
    const option = ([id, name]) => {
      const o = document.createElement("option");
      o.value = id;
      o.lang = id;
      o.textContent = CATALOGS.includes(id) ? name : t("portal.languagePending", { name });
      return o;
    };
    const cur = LOCALES.find(([id]) => id === locale);
    const rest = LOCALES.filter(([id]) => id !== locale).sort((a, b) => collator.compare(a[1], b[1]));
    select.replaceChildren(option(cur), ...rest.map(option));
    select.value = locale;
  };

  async function apply(locale) {
    const shown = CATALOGS.includes(locale) ? locale : "en";
    if (shown !== locale) console.info(`rusuite: no "${locale}" portal translation yet – showing English`);
    try {
      messages = await load(shown);
    } catch {
      fillSelect("en");
      return; // the page stays as it is (English)
    }
    document.documentElement.lang = shown;
    document.documentElement.dir = "ltr";
    for (const el of document.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n, params(el));
    // Markup from our own static catalogs (code/strong tags), never user input; parameters are escaped.
    for (const el of document.querySelectorAll("[data-i18n-html]")) el.innerHTML = t(el.dataset.i18nHtml, params(el, escapeHtml));
    for (const [data, attr] of ATTRS) for (const el of document.querySelectorAll(`[${data}]`)) el.setAttribute(attr, t(el.getAttribute(data)));
    fillSelect(shown);
    window.rusuiteI18n = { locale: shown, t };
    window.dispatchEvent(new CustomEvent("rusuite:locale", { detail: shown }));
  }

  select.addEventListener("change", () => {
    try {
      localStorage.setItem(KEY, select.value);
    } catch {
      // blocked storage: the choice lasts for this page
    }
    void apply(select.value);
  });
  fillSelect("en");
  void apply(initial());
})();
