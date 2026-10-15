#!/usr/bin/env node
// i18n lint (P7-11, `pnpm i18n:check`): every user-visible string of the
// UI comes from a catalog.
//
// 1. Catalog parity: each `locales/de.json` has exactly the keys of its
//    `en.json` (ui-shared, calc, write, show, portal).
// 2. No literal UI text in the sources (`packages/ui-shared/src`,
//    `apps/{calc,write,show}/src`, tests and generated code excluded):
//    JSX text, the attributes `aria-label`, `title`, `placeholder`, `alt`
//    and the label-like props (`label`, `tooltip`, `confirmLabel`,
//    `menuLabel`, `fillLabel`, `label:` in objects) must not be string
//    literals with words in them. Allowed: brand names, file extensions,
//    `fx`, shortcut combos and other entries of ALLOW below; a line can
//    opt out with a trailing `// i18n-ignore` comment.
// 3. Every literal key passed to `t("…")` exists in the package's catalog
//    (or the shared one).
// 4. Portal: every `data-i18n*="key"` of apps/portal/index.html exists in
//    its catalog.
//
// Exit code 1 with a list of findings, else 0.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rel = (p) => path.relative(root, p);
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const findings = [];

const PACKAGES = [
  { name: "ui-shared", src: "packages/ui-shared/src", locales: "packages/ui-shared/src/i18n/locales" },
  { name: "calc", src: "apps/calc/src", locales: "apps/calc/src/locales" },
  { name: "write", src: "apps/write/src", locales: "apps/write/src/locales" },
  { name: "show", src: "apps/show/src", locales: "apps/show/src/locales" },
];
const PORTAL = { name: "portal", html: "apps/portal/index.html", locales: "apps/portal/locales" };

// --- 1. parity --------------------------------------------------------------

function catalogs(dir) {
  const en = readJson(path.join(root, dir, "en.json"));
  const de = readJson(path.join(root, dir, "de.json"));
  for (const k of Object.keys(en)) if (!(k in de)) findings.push(`${dir}/de.json: missing key "${k}"`);
  for (const k of Object.keys(de)) if (!(k in en)) findings.push(`${dir}/de.json: extra key "${k}" (not in en.json)`);
  for (const [k, v] of Object.entries(en)) {
    const names = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
    if (k in de && names(v) !== names(de[k])) findings.push(`${dir}/de.json: "${k}" has other placeholders than en.json`);
  }
  return en;
}

const shared = catalogs(PACKAGES[0].locales);

// --- 2. literal strings -----------------------------------------------------

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
    } else if (/\.(tsx?|mjs)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && !/\.d\.ts$/.test(e.name)) out.push(p);
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

// --- 4. portal ----------------------------------------------------------------

{
  const en = catalogs(PORTAL.locales);
  const html = fs.readFileSync(path.join(root, PORTAL.html), "utf8");
  for (const m of html.matchAll(/data-i18n(?:-[a-z]+)?="([^"]+)"/g)) {
    if (!(m[1] in en)) findings.push(`${PORTAL.html}:${lineOf(html, m.index)}: unknown key "${m[1]}"`);
  }
}

if (findings.length > 0) {
  console.error(`i18n-check: ${findings.length} finding(s)\n${findings.map((f) => `  ${f}`).join("\n")}`);
  process.exit(1);
}
console.log("i18n-check: catalogs in sync, no literal UI strings");
