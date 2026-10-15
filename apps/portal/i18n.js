// Portal translations (P7-11): the page is written in English; this script
// switches it to the language of the user's choice (the EN/DE buttons,
// stored under the same `localStorage` key as the apps' choice, so the
// apps open in it too) or of the browser (de* → German). Elements name
// their message with `data-i18n` (text), `data-i18n-html` (markup from the
// catalog), `data-i18n-alt`, `data-i18n-content`, `data-i18n-aria-label`.
(() => {
  const KEY = "rusuite.locale";
  const LOCALES = ["en", "de"];
  const stored = () => {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  };
  const initial = () => {
    const s = stored();
    if (LOCALES.includes(s)) return s;
    return /^de\b/i.test(navigator.language || "") ? "de" : "en";
  };
  const catalogs = {};
  const load = (locale) => (catalogs[locale] ??= fetch(`locales/${locale}.json`).then((r) => (r.ok ? r.json() : Promise.reject(r.status))));
  const interpolate = (msg, params) => msg.replace(/\{(\w+)\}/g, (all, k) => (params && k in params ? String(params[k]) : all));

  // Until a catalog has loaded (or if it cannot be), the page's own English texts.
  const FALLBACK = { "portal.versionUnknown": "Version unknown", "portal.build": "Build {commit}", "portal.built": "Built {date}" };
  let messages = {};
  const t = (key, params) => interpolate(messages[key] ?? FALLBACK[key] ?? key, params);
  window.rusuiteI18n = { locale: "en", t };

  const ATTRS = [
    ["data-i18n-alt", "alt"],
    ["data-i18n-content", "content"],
    ["data-i18n-aria-label", "aria-label"],
  ];

  async function apply(locale) {
    try {
      messages = await load(locale);
    } catch {
      return; // the page stays as it is (English)
    }
    document.documentElement.lang = locale;
    for (const el of document.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n);
    // Markup from our own static catalogs (code/strong tags), never user input.
    for (const el of document.querySelectorAll("[data-i18n-html]")) el.innerHTML = t(el.dataset.i18nHtml);
    for (const [data, attr] of ATTRS) for (const el of document.querySelectorAll(`[${data}]`)) el.setAttribute(attr, t(el.getAttribute(data)));
    for (const b of document.querySelectorAll("[data-lang]")) b.setAttribute("aria-pressed", String(b.dataset.lang === locale));
    window.rusuiteI18n = { locale, t };
    window.dispatchEvent(new CustomEvent("rusuite:locale", { detail: locale }));
  }

  for (const b of document.querySelectorAll("[data-lang]")) {
    b.addEventListener("click", () => {
      try {
        localStorage.setItem(KEY, b.dataset.lang);
      } catch {
        // blocked storage: the choice lasts for this page
      }
      void apply(b.dataset.lang);
    });
  }
  void apply(initial());
})();
