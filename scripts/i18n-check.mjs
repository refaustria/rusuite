#!/usr/bin/env node
// i18n lint (P7-11, P9-L0; `pnpm i18n:check`): every user-visible string of
// the UI comes from a catalog, and every catalog is complete and informal.
//
// 1. Catalogs: every `<lang>.json` next to `en.json` in each locales dir
//    (ui-shared, calc, write, show, portal) has exactly the keys of
//    `en.json` and the same `{placeholders}`. Plural groups (`key.one` +
//    `key.other` in English) instead need one key per plural category of
//    the language (`Intl.PluralRules(lang)`: Polish `one/few/many/other`,
//    Irish `one/two/few/many/other` …), each using only the placeholders
//    of the English group. A file whose name is not one of LANGUAGES is
//    reported, and so is a language present in only some locales dirs.
// 2. Informal register: every language addresses the user informally (the
//    German "du"). REGISTER below lists the formal pronouns per language; a
//    value containing one fails unless the allow-list of the language
//    names it (a genuine third-person use).
// 3. Untranslated values: a value of a non-English catalog identical to
//    English with two or more words fails (single words such as "Layout"
//    or "Status" are often the same), unless it consists of brand and
//    technical names only (BRANDS) or the allow-list names it.
// 4. No literal UI text in the sources (`packages/ui-shared/src`,
//    `apps/{calc,write,show}/src`, tests and generated code excluded):
//    JSX text, the attributes `aria-label`, `title`, `placeholder`, `alt`
//    and the label-like props (`label`, `tooltip`, `confirmLabel`,
//    `menuLabel`, `fillLabel`, `label:` in objects) must not be string
//    literals with words in them. Allowed: brand names, file extensions,
//    `fx`, shortcut combos and other entries of ALLOW below; a line can
//    opt out with a trailing `// i18n-ignore` comment.
// 5. Every literal key passed to `t("…")` exists in the package's catalog
//    (or the shared one).
// 6. Portal: every `data-i18n*="key"` of the pages in apps/portal
//    (index, privacy, downloads) exists in its catalog.
//
// Allow-lists: `scripts/i18n-allow/<lang>.json` (optional) –
//   { "register": { "<locales dir>:<key>": "reason" }, "untranslated": { "<locales dir>:<key>": "reason" } }
// Entries that no longer match are reported as stale. Exit code 1 with a
// list of findings, else 0. The rule functions are exported for the tests
// (packages/ui-shared/src/i18n/check.test.mjs).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** The UI languages (the 24 official EU languages; keep in sync with packages/ui-shared/src/i18n/locales.ts). */
export const LANGUAGES = ["bg", "cs", "da", "de", "el", "en", "es", "et", "fi", "fr", "ga", "hr", "hu", "it", "lt", "lv", "mt", "nl", "pl", "pt", "ro", "sk", "sl", "sv"];

export const PACKAGES = [
  { name: "ui-shared", src: "packages/ui-shared/src", locales: "packages/ui-shared/src/i18n/locales" },
  { name: "calc", src: "apps/calc/src", locales: "apps/calc/src/locales" },
  { name: "write", src: "apps/write/src", locales: "apps/write/src/locales" },
  { name: "show", src: "apps/show/src", locales: "apps/show/src/locales" },
];
export const PORTAL = { name: "portal", dir: "apps/portal", locales: "apps/portal/locales" };

/**
 * German values that may contain a capitalised "Sie"/"Ihr…" because it is a third-person pronoun, not the formal
 * address ("Sie werden geleert" = "they are cleared"). Key: `<locales dir>:<catalog key>`, value: the reason.
 * Prefer rewording (lower-case after a colon, "Die Zellen …") over an entry here. Stale entries are reported.
 * (Kept for German; every language – German too – can also use `scripts/i18n-allow/<lang>.json`.)
 */
const FORMAL_ALLOW = {};

/** A whole word (Unicode-aware, so it also works next to "é", "ő", "ž", Greek and Cyrillic letters). */
const words = (alternatives, flags = "") => new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives})(?![\\p{L}\\p{N}])`, `u${flags}`);

/**
 * Formal forms of address per language (docs/i18n.md "Tone"). `re` fails a value; `informal` names the forms to use
 * instead (shown in the finding). Pronouns only: formal verb forms (Hungarian and Portuguese third-person imperatives)
 * cannot be told apart from third-person statements and are left to the review against the glossary.
 */
export const REGISTER = {
  bg: { re: words("Вие|Вас|Ви|Вам|Ваш|Ваша|Ваше|Ваши|Вашия|Вашият|Вашата|Вашето|Вашите"), informal: "ти / теб / твой" },
  cs: { re: words("vy|vás|vám|vámi|váš|vaše|vašeho|vašemu|vaši|vašich|vašim|vašimi", "i"), informal: "ty / tě / tvůj" },
  da: { re: words("Dem|Deres"), informal: "du / dig / din" },
  de: { re: /\b(Sie|Ihnen|Ihre?[mnrs]?)\b/, informal: "du / dich / dir / dein" },
  el: { re: words("σας|εσείς", "i"), informal: "εσύ / σου / σε" },
  en: null,
  es: { re: words("usted|ustedes|Ud\\.|Uds\\.|Vd\\.|Vds\\.", "i"), informal: "tú / te / tu" },
  et: { re: words("teie|teid|teile|teil|teilt|teiega", "i"), informal: "sina / sa / sinu" },
  fi: { re: words("Te|Teidän|Teitä|Teille|Teistä|Teihin|Teillä|Teiltä"), informal: "sinä / sinun / sinua" },
  fr: { re: words("vous|votre|vos", "i"), informal: "tu / te / ton / ta / tes" },
  ga: { re: words("sibh|bhur", "i"), informal: "tú / thú / do (singular)" },
  hr: { re: words("vi|vas|vam|vama|vaš|vaša|vaše|vaši|vašeg|vašem|vašu|vašoj|vaših|vašim", "i"), informal: "ti / te / tvoj" },
  hu: { re: words("Ön|Önt|Önnek|Öné|Önnel|Önről|Öntől|Önhöz|Önben|Önre|Önök|Önöket|Önöknek|Maga|Magát|Magának"), informal: "te / téged / a … -d" },
  it: { re: words("Lei|Suo|Sua|Suoi|Sue|La preghiamo"), informal: "tu / ti / tuo" },
  lt: { re: words("jūs|jūsų|jums|jus|jumis", "i"), informal: "tu / tavo / tau" },
  lv: { re: words("jūs|jūsu|jums|jūsos", "i"), informal: "tu / tavs / tev" },
  mt: { re: words("intom|tagħkom", "i"), informal: "int / tiegħek (singular)" },
  nl: { re: words("u|uw|uwe", "i"), informal: "je / jij / jouw" },
  pl: { re: words("pan|pana|panu|panem|pani|panią|państwo|państwa|państwu|państwem", "i"), informal: "ty / cię / twój" },
  pt: { re: words("você|vocês|o senhor|a senhora|V\\. ?Ex\\.?ª?", "i"), informal: "tu / te / teu (pt-PT)" },
  ro: { re: words("dumneavoastră|dumneata|dvs\\.?|dv\\.", "i"), informal: "tu / te / tău" },
  sk: { re: words("vy|vás|vám|vami|váš|vaša|vaše|vášho|vášmu|vaši|vašich|vašim|vašimi", "i"), informal: "ty / ťa / tvoj" },
  sl: { re: words("vi|vas|vam|vami|vaš|vaša|vaše|vaši|vašega|vašemu|vašo|vaših|vašim", "i"), informal: "ti / te / tvoj" },
  sv: { re: words("Ni|Er|Ert|Era|Eder|Edra"), informal: "du / dig / din" },
};

/** Words that stay as they are in every language (brands, products, encodings, platforms). */
const BRANDS = new Set(
  "Rusuite Calc Write Show Excel Word PowerPoint Office Microsoft OpenAI Anthropic Claude Ollama Mistral Gemini Unicode UTF BE LE ASCII ANSI PDF CSV TXT TSV XLSX DOCX PPTX ODS ODT ODP SVG PNG JPEG GIF WebDAV Nextcloud ownCloud DMG EXE MSI DEB RPM GitHub Apple Silicon Intel Debian Ubuntu Fedora openSUSE Windows macOS Linux SmartScreen AppImage OK URL API HTTP HTTPS RGB HSL HEX ID ISO".split(
    " ",
  ),
);

/** Units of measure in values ("Width (cm)"); they do not count as words for the untranslated check. */
const UNITS = new Set(["cm", "mm", "in", "pt", "px", "pc", "em", "ms", "KB", "MB", "GB", "dpi"]);

const PLACEHOLDER_RE = /\{(\w+)\}/g;
export const placeholders = (s) => [...String(s).matchAll(PLACEHOLDER_RE)].map((m) => m[1]).sort();
const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
/** The text a reader sees: no `{placeholders}`, no markup. */
const visible = (s) => String(s).replace(PLACEHOLDER_RE, " ").replace(/<[^>]*>/g, " ");

const pluralCache = new Map();
/** CLDR plural categories of `lang` (`["few", "many", "one", "other"]` for Polish). */
export function pluralCategories(lang) {
  if (!pluralCache.has(lang)) pluralCache.set(lang, new Intl.PluralRules(lang).resolvedOptions().pluralCategories.slice().sort());
  return pluralCache.get(lang);
}

const PLURAL_SUFFIX = /\.(zero|one|two|few|many|other)$/;
/**
 * Plural groups of an English catalog: base key → its English variants (`files` → { one, other }). A group needs
 * `.one` and `.other` (a lone `conn.err.other` is an ordinary key: "Other error").
 */
export function pluralGroups(en) {
  const groups = new Map();
  for (const k of Object.keys(en)) {
    const m = PLURAL_SUFFIX.exec(k);
    if (m && `${k.slice(0, m.index)}.other` in en && `${k.slice(0, m.index)}.one` in en) {
      const base = k.slice(0, m.index);
      if (!groups.has(base)) groups.set(base, {});
      groups.get(base)[m[1]] = en[k];
    }
  }
  return groups;
}

/** The formal pronoun in `value` (for the finding), or null. */
export function registerHit(lang, value) {
  const rule = REGISTER[lang];
  if (!rule) return null;
  const m = rule.re.exec(visible(value));
  return m ? m[0] : null;
}

/** Whether `value` looks untranslated: identical to English, two or more words, not only brand names. */
export function looksUntranslated(enValue, value) {
  if (value !== enValue) return false;
  // Units ("Horizontal (cm)") are not words: such a value is a single word, the same in many languages.
  const ws = (visible(value).match(/\p{L}[\p{L}\p{N}'’]*/gu) ?? []).filter((w) => w.length >= 2 && !UNITS.has(w));
  if (ws.length < 2) return false;
  return !ws.every((w) => BRANDS.has(w) || BRANDS.has(w.toUpperCase()));
}

/**
 * Checks the catalog `msgs` of `lang` against `en` (plain objects). `dir` names the locales dir in findings and
 * allow-list ids; `allow` is `{ register, untranslated }` (maps of `<dir>:<key>` → reason). Returns the findings and
 * the allow-list entries that matched (`register:<id>`, `untranslated:<id>`).
 */
export function checkCatalog({ dir, lang, en, msgs, allow = {} }) {
  const findings = [];
  const used = new Set();
  const file = `${dir}/${lang}.json`;
  const groups = pluralGroups(en);
  const cats = pluralCategories(lang);
  const inGroup = (k) => {
    const m = PLURAL_SUFFIX.exec(k);
    return m && groups.has(k.slice(0, m.index)) ? { base: k.slice(0, m.index), cat: m[1] } : null;
  };
  for (const k of Object.keys(en)) {
    if (inGroup(k)) continue;
    if (!(k in msgs)) findings.push(`${file}: missing key "${k}"`);
    else if (!sameList(placeholders(en[k]), placeholders(msgs[k]))) findings.push(`${file}: "${k}" has other placeholders than en.json`);
  }
  for (const [base, variants] of groups) {
    const names = new Set(Object.values(variants).flatMap(placeholders));
    for (const cat of cats) {
      const k = `${base}.${cat}`;
      if (!(k in msgs)) findings.push(`${file}: missing plural form "${k}" (${lang}: ${cats.join("/")})`);
      else if (placeholders(msgs[k]).some((p) => !names.has(p))) findings.push(`${file}: "${k}" has other placeholders than en.json`);
    }
  }
  for (const k of Object.keys(msgs)) {
    const g = inGroup(k);
    if (g && !cats.includes(g.cat)) findings.push(`${file}: extra key "${k}" (${lang} has no plural category "${g.cat}")`);
    else if (!g && !(k in en)) findings.push(`${file}: extra key "${k}" (not in en.json)`);
  }
  if (lang === "en") return { findings, used };
  const register = { ...(lang === "de" ? FORMAL_ALLOW : {}), ...(allow.register ?? {}) };
  const untranslated = allow.untranslated ?? {};
  for (const [k, v] of Object.entries(msgs)) {
    const id = `${dir}:${k}`;
    const hit = registerHit(lang, v);
    if (hit) {
      if (id in register) used.add(`register:${id}`);
      else findings.push(`${file}: "${k}" uses the formal "${hit}" – address the user informally (${REGISTER[lang].informal}; docs/i18n.md, allow-list scripts/i18n-allow/${lang}.json)`);
    }
    const g = inGroup(k);
    const enValue = g ? (en[k] ?? en[`${g.base}.other`]) : en[k];
    if (enValue !== undefined && looksUntranslated(enValue, v)) {
      if (id in untranslated) used.add(`untranslated:${id}`);
      else findings.push(`${file}: "${k}" is identical to English – untranslated? (allow-list scripts/i18n-allow/${lang}.json)`);
    }
  }
  return { findings, used };
}

/** Allow-list entries of `lang` that matched nothing (`used`: the union of checkCatalog's `used` over every dir). */
export function staleEntries(lang, allow, used) {
  const out = [];
  const register = { ...(lang === "de" ? FORMAL_ALLOW : {}), ...(allow.register ?? {}) };
  for (const id of Object.keys(register)) if (!used.has(`register:${id}`)) out.push(`scripts/i18n-allow/${lang}.json: stale register entry "${id}"`);
  for (const id of Object.keys(allow.untranslated ?? {})) {
    if (!used.has(`untranslated:${id}`)) out.push(`scripts/i18n-allow/${lang}.json: stale untranslated entry "${id}"`);
  }
  return out;
}

// --- literal strings ----------------------------------------------------------

/** Literal texts that are not translated. */
const ALLOW = [
  /^Rusuite( (Calc|Write|Show))?$/, // brand names
  /^\.?[a-z0-9]{2,5}(,\s*\.?[a-z0-9]{2,5})*$/i, // file extensions (xlsx, .docx)
  /^fx$/,
  /^(Mod|Ctrl|Shift|Alt|Meta)(\+\S+)+$/, // shortcut combos
  /^(F\d{1,2}|Esc|Tab|Enter|Del|Delete|Backspace|Home|End|PageUp|PageDown)$/,
  /^RRGGBB$/,
  /^[A-Z]\d+$/, // cell references (A1)
  /^OK$/,
];
/** Removes `${…}` interpolations (nested braces included); text left with an unbalanced `${` is dynamic. */
const stripTemplates = (text) => {
  let s = text;
  for (let prev = ""; prev !== s; ) {
    prev = s;
    s = s.replace(/\$?\{[^{}]*\}/g, "");
  }
  return s.includes("${") ? "" : s;
};
const allowed = (raw) => {
  const s = stripTemplates(raw).trim();
  if (/^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9]+)+$/.test(s)) return true; // a catalog key
  if (!/[A-Za-zÀ-ž]{2,}/.test(s.replace(/Rusuite( (Calc|Write|Show))?/g, ""))) return true; // brand names and symbols only
  if (!/[A-Za-zÀ-ž]{2,}/.test(s)) return true; // no words: symbols, numbers, "×", "+"
  return ALLOW.some((re) => re.test(s));
};

const ATTRS = ["aria-label", "title", "placeholder", "alt", "label", "tooltip", "confirmLabel", "menuLabel", "fillLabel", "documentTitle", "appName"];
const ATTR_RE = new RegExp(`\\b(${ATTRS.join("|")})=(?:"([^"]*)"|\\{\\s*"([^"]*)"\\s*\\}|\\{\\s*\`([^\`]*)\`\\s*\\})`, "g");
const OBJ_LABEL_RE = /\b(label|tooltip|title|placeholder|message):\s*(?:"([^"\n]*)"|`([^`\n]*)`)/g;
const JSX_TEXT_RE = />([^<>{}]*?)</g;
/** Sentence-like literals in conditional expressions (`hidden ? "Hidden slide" : undefined`). */
const TERNARY_RE = /(?:\?|\s:)\s*"([A-Z][a-z]+(?: [^"\n]+|…))"/g;
const T_KEY_RE = /\b(?:t|tr|translate)\(\s*"([^"]+)"/g;

// `formula/`: Calc's formula diagnostics describe the formula language, which stays English for now (as the
// core's parse errors; docs/i18n.md). `dev/`, `test/`: developer tools and fixtures.
const SKIP_DIR = new Set(["generated", "node_modules", "test", "dev", "locales", "formula"]);
function sources(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIR.has(e.name)) out.push(...sources(p));
    } else if (/\.(tsx?|mjs)$/.test(e.name) && !/\.test\.(tsx?|mjs)$/.test(e.name) && !/\.d\.ts$/.test(e.name)) out.push(p);
  }
  return out;
}

const lineOf = (src, index) => src.slice(0, index).split("\n").length;
const ignored = (src, index) => {
  const start = src.lastIndexOf("\n", index) + 1;
  const end = src.indexOf("\n", index);
  return /\/\/\s*i18n-ignore/.test(src.slice(start, end < 0 ? undefined : end));
};
/** Strips comments (keeps offsets: replaced by spaces). */
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\/|(^|[^:"'`\\])\/\/[^\n]*/g, (m, pre = "") => pre + m.slice(pre.length).replace(/[^\n]/g, " "));

// --- main -----------------------------------------------------------------------

/** Runs every check on the repository at `root`: `{ findings, languages: { <lang>: number of locales dirs } }`. */
export function run(root) {
  const rel = (p) => path.relative(root, p);
  const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
  const findings = [];
  const allowFiles = new Map();
  const allowOf = (lang) => {
    if (!allowFiles.has(lang)) {
      const p = path.join(root, "scripts/i18n-allow", `${lang}.json`);
      allowFiles.set(lang, fs.existsSync(p) ? readJson(p) : {});
    }
    return allowFiles.get(lang);
  };
  const used = new Map();
  const languages = {};

  /** Checks every catalog of `dir`; returns the English one. */
  const catalogs = (dir) => {
    const en = readJson(path.join(root, dir, "en.json"));
    for (const f of fs.readdirSync(path.join(root, dir)).filter((n) => n.endsWith(".json")).sort()) {
      const lang = f.slice(0, -".json".length);
      if (!LANGUAGES.includes(lang)) {
        findings.push(`${dir}/${f}: not a UI language (${LANGUAGES.join(", ")})`);
        continue;
      }
      languages[lang] = (languages[lang] ?? 0) + 1;
      const r = checkCatalog({ dir, lang, en, msgs: lang === "en" ? en : readJson(path.join(root, dir, f)), allow: allowOf(lang) });
      findings.push(...r.findings);
      if (!used.has(lang)) used.set(lang, new Set());
      for (const u of r.used) used.get(lang).add(u);
    }
    return en;
  };

  const shared = catalogs(PACKAGES[0].locales);

  for (const pkg of PACKAGES) {
    const own = pkg === PACKAGES[0] ? shared : catalogs(pkg.locales);
    for (const file of sources(path.join(root, pkg.src))) {
      const raw = fs.readFileSync(file, "utf8");
      const src = stripComments(raw);
      const report = (index, what, text) => {
        if (!ignored(raw, index)) findings.push(`${rel(file)}:${lineOf(src, index)}: ${what} "${text.trim().replace(/\s+/g, " ")}"`);
      };
      for (const m of src.matchAll(ATTR_RE)) {
        const text = m[2] ?? m[3] ?? m[4] ?? "";
        if (!allowed(text)) report(m.index, `literal ${m[1]}`, text);
      }
      for (const m of src.matchAll(OBJ_LABEL_RE)) {
        const text = m[2] ?? m[3] ?? "";
        if (!allowed(text)) report(m.index, `literal ${m[1]}:`, text);
      }
      for (const m of src.matchAll(TERNARY_RE)) {
        if (!allowed(m[1])) report(m.index, "literal in a condition", m[1]);
      }
      if (file.endsWith(".tsx")) {
        for (const m of src.matchAll(JSX_TEXT_RE)) {
          const text = m[1];
          // JSX text sits between a tag end and a tag start; skip TS (generics, comparisons, arrows).
          const before = src[m.index - 1];
          const after = src[m.index + m[0].length];
          if (before === "=" || before === "-" || !/[A-Za-z/]/.test(after ?? "")) continue;
          if (/[=;()&|]|\?\s|:\s/.test(text)) continue;
          if (!allowed(text)) report(m.index, "JSX text", text);
        }
      }
      for (const m of src.matchAll(T_KEY_RE)) {
        if (!(m[1] in own) && !(m[1] in shared) && !(`${m[1]}.other` in own) && !(`${m[1]}.other` in shared)) {
          findings.push(`${rel(file)}:${lineOf(src, m.index)}: unknown key t("${m[1]}")`);
        }
      }
    }
  }

  // Portal: every data-i18n key exists; i18n.js lists exactly the languages with a portal catalog.
  {
    const en = catalogs(PORTAL.locales);
    const js = fs.readFileSync(path.join(root, PORTAL.dir, "i18n.js"), "utf8");
    const listed = (/const CATALOGS = \[([^\]]*)\]/.exec(js)?.[1] ?? "").match(/[a-z]{2}/g) ?? [];
    const files = fs.readdirSync(path.join(root, PORTAL.locales)).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));
    if (listed.slice().sort().join() !== files.slice().sort().join()) {
      findings.push(`${PORTAL.dir}/i18n.js: CATALOGS [${listed.join(", ")}] must list the portal catalogs [${files.sort().join(", ")}]`);
    }
    for (const page of fs.readdirSync(path.join(root, PORTAL.dir)).filter((f) => f.endsWith(".html"))) {
      const file = `${PORTAL.dir}/${page}`;
      const html = fs.readFileSync(path.join(root, file), "utf8");
      for (const m of html.matchAll(/data-i18n(?:-(?!params)[a-z]+)?="([^"]+)"/g)) {
        if (!(m[1] in en)) findings.push(`${file}:${lineOf(html, m.index)}: unknown key "${m[1]}"`);
      }
    }
  }

  for (const lang of new Set([...allowFiles.keys(), "de"])) findings.push(...staleEntries(lang, allowOf(lang), used.get(lang) ?? new Set()));
  const dirs = PACKAGES.length + 1;
  for (const [lang, n] of Object.entries(languages)) {
    if (n !== dirs) findings.push(`${lang}: catalogs in ${n} of ${dirs} locales dirs – a language adds all of them at once (docs/i18n.md)`);
  }
  return { findings, languages };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { findings, languages } = run(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
  if (findings.length > 0) {
    console.error(`i18n-check: ${findings.length} finding(s)\n${findings.map((f) => `  ${f}`).join("\n")}`);
    process.exit(1);
  }
  const done = Object.keys(languages).sort();
  console.log(`i18n-check: catalogs in sync, no literal UI strings – ${done.length} languages (${done.join(", ")}), ${LANGUAGES.length - done.length} pending`);
}
