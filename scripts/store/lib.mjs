// Shared helpers of the store publishing scripts (P10-M8, docs/store/README.md): the app table, the locale maps of
// Google Play and App Store Connect, the docs/store file layout (written by P10-M7), argument parsing and a fetch
// wrapper that retries 429/5xx. Node only, no dependencies. Nothing here logs a credential.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const STORE_DIR = path.join(ROOT, "docs/store");

/** The three apps: Play package name = App Store bundle id. */
export const APPS = {
  calc: { id: "dev.rusuite.calc", name: "Rusuite Calc" },
  write: { id: "dev.rusuite.write", name: "Rusuite Write" },
  show: { id: "dev.rusuite.show", name: "Rusuite Show" },
};

/** Rusuite's 24 UI languages (docs/i18n.md). */
export const LANGS = [
  "bg",
  "cs",
  "da",
  "de",
  "el",
  "en",
  "es",
  "et",
  "fi",
  "fr",
  "ga",
  "hr",
  "hu",
  "it",
  "lt",
  "lv",
  "mt",
  "nl",
  "pl",
  "pt",
  "ro",
  "sk",
  "sl",
  "sv",
];

/**
 * Rusuite language → Google Play listing language (Play Console › Store presence › "Manage translations" list).
 * `null` = Play has no listing language for it (Irish, Maltese): reported and not sent; those users see en-US.
 */
export const PLAY_LOCALES = {
  bg: "bg",
  cs: "cs-CZ",
  da: "da-DK",
  de: "de-DE",
  el: "el-GR",
  en: "en-US",
  es: "es-ES",
  et: "et",
  fi: "fi-FI",
  fr: "fr-FR",
  ga: null,
  hr: "hr",
  hu: "hu-HU",
  it: "it-IT",
  lt: "lt",
  lv: "lv",
  mt: null,
  nl: "nl-NL",
  pl: "pl-PL",
  pt: "pt-PT",
  ro: "ro",
  sk: "sk",
  sl: "sl",
  sv: "sv-SE",
};

/**
 * Rusuite language → App Store Connect locale (the App Store's localizations). `null` = the App Store has no
 * localization for it (Bulgarian, Estonian, Irish, Latvian, Lithuanian, Maltese): reported and not sent; those
 * storefronts show the primary locale (en-US). Slovenian was added to App Store Connect in 2025 (`sl-SI`); if Apple
 * refuses the code the push reports that locale and goes on with the others.
 */
export const ASC_LOCALES = {
  bg: null,
  cs: "cs",
  da: "da",
  de: "de-DE",
  el: "el",
  en: "en-US",
  es: "es-ES",
  et: null,
  fi: "fi",
  fr: "fr-FR",
  ga: null,
  hr: "hr",
  hu: "hu",
  it: "it",
  lt: null,
  lv: null,
  mt: null,
  nl: "nl-NL",
  pl: "pl",
  pt: "pt-PT",
  ro: "ro",
  sk: "sk",
  sl: "sl-SI",
  sv: "sv",
};

export class UsageError extends Error {}

/**
 * `argv` → { _: positional[], opts: { name: value|true } }. Boolean flags are listed in `flags` (without dashes);
 * every other `--name` takes the next argument as its value.
 */
export function parseArgs(argv, flags = []) {
  const out = { _: [], opts: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const [name, inline] = a.slice(2).split(/=(.*)/s, 2);
      if (flags.includes(name)) out.opts[name] = true;
      else {
        const v = inline ?? argv[++i];
        if (v === undefined || (inline === undefined && v.startsWith("--"))) throw new UsageError(`--${name} needs a value`);
        out.opts[name] = v;
      }
    } else out._.push(a);
  }
  return out;
}

export function appOf(name) {
  const app = APPS[name];
  if (!app) throw new UsageError(`--app must be one of ${Object.keys(APPS).join(", ")}`);
  return { key: name, ...app };
}

/** `--langs en,de` → validated list (default: every language). */
export function langsOf(value) {
  if (!value) return [...LANGS];
  const list = String(value)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const bad = list.filter((l) => !LANGS.includes(l));
  if (bad.length) throw new UsageError(`unknown language(s): ${bad.join(", ")} (one of ${LANGS.join(", ")})`);
  return list;
}

/** The listing texts of `app` per language from docs/store/listing/<lang>.json (missing files are skipped). */
export function loadListings(storeDir, app, langs = LANGS) {
  const out = {};
  for (const lang of langs) {
    const file = path.join(storeDir, "listing", `${lang}.json`);
    if (!fs.existsSync(file)) continue;
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    if (data[app]) out[lang] = data[app];
  }
  return out;
}

/** Release notes text for `lang` from docs/store/release-notes/<lang>.txt, falling back to en.txt (or null). */
export function releaseNotes(dir, lang) {
  for (const l of [lang, "en"]) {
    const f = path.join(dir, `${l}.txt`);
    if (fs.existsSync(f)) return fs.readFileSync(f, "utf8").trim();
  }
  return null;
}

const pngs = (dir) =>
  fs.existsSync(dir) && fs.statSync(dir).isDirectory()
    ? fs
        .readdirSync(dir)
        .filter((f) => f.toLowerCase().endsWith(".png"))
        .sort()
        .map((f) => path.join(dir, f))
    : [];

/**
 * Screenshots of `app` for one form factor folder (phone, phone-65, phone-67, tablet-7, tablet-10) and language:
 * `<form>/<lang>/*.png` (P10-M7 writes en/ and de/), else – only with `reuse` – the en/ set, else PNGs directly in
 * `<form>/`. Returns { files, own } (own = the language has its own set).
 */
export function screenshots(storeDir, app, form, lang, { reuse = false } = {}) {
  const base = path.join(storeDir, "screenshots", app, form);
  const own = pngs(path.join(base, lang));
  if (own.length) return { files: own, own: true };
  if (!reuse) return { files: [], own: false };
  const en = pngs(path.join(base, "en"));
  return { files: en.length ? en : pngs(base), own: false };
}

/** Width and height from a PNG's IHDR (null when it is not a PNG). */
export function pngSize(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47 || buf.toString("ascii", 12, 16) !== "IHDR") return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

export const md5 = (buf) => crypto.createHash("md5").update(buf).digest("hex");

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * A fetch that retries 429 and 5xx answers and network errors with exponential backoff (honours Retry-After in
 * seconds). Bodies must be re-sendable (strings/Buffers – every caller here passes those).
 */
export function retryingFetch(fetchImpl, { retries = 4, base = 1000, sleep = defaultSleep, log = () => {} } = {}) {
  return async (url, init) => {
    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        res = await fetchImpl(url, init);
      } catch (e) {
        if (attempt >= retries) throw e;
        log(`network error (${e.message}), retry ${attempt + 1}/${retries}`);
        await sleep(base * 2 ** attempt);
        continue;
      }
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        const after = Number(res.headers?.get?.("retry-after"));
        log(`HTTP ${res.status} from ${new URL(url).host}, retry ${attempt + 1}/${retries}`);
        await sleep(Number.isFinite(after) && after > 0 ? after * 1000 : base * 2 ** attempt);
        continue;
      }
      return res;
    }
  };
}

/** True when this module file is the script node was started with. */
export const isMain = (metaUrl) => process.argv[1] && fileURLToPath(metaUrl) === fs.realpathSync(process.argv[1]);
