#!/usr/bin/env node
// Validates the store listing texts of docs/store (P10-M7): every language has all three apps, every field exists
// and respects the store limits, no placeholder leftovers; release notes (Play, ≤ 500) and review notes exist.
// Usage: node scripts/store/check-listing.mjs [--dir docs/store]   (exit 1 on any problem)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const LANGS = ["bg", "cs", "da", "de", "el", "en", "es", "et", "fi", "fr", "ga", "hr", "hu", "it", "lt", "lv", "mt", "nl", "pl", "pt", "ro", "sk", "sl", "sv"];
export const APPS = ["calc", "write", "show"];
/** Field → max length in characters (Unicode code points). */
export const LIMITS = {
  title: 30,
  shortDescription: 80,
  subtitle: 30,
  fullDescription: 4000,
  description: 4000,
  keywords: 100,
  promotionalText: 170,
  whatsNew: 4000,
  privacyAnswer: 300,
};
export const RELEASE_NOTES_MAX = 500;
const EXT = { calc: ".xlsx", write: ".docx", show: ".pptx" };
const PLACEHOLDERS = [/\{[^}]*\}/, /\{\{|\}\}/, /<[^>]+>/, /\bTODO\b/i, /\bTBD\b/i, /\bFIXME\b/i, /\bXXX+\b/, /lorem ipsum/i, /\bundefined\b/, /\bnull\b/, /\$\{/];

const len = (s) => [...s].length;

/** Problems of one language file's parsed content (array of messages, empty when fine). */
export function checkListing(lang, data) {
  const errs = [];
  if (!data || typeof data !== "object") return [`${lang}: not an object`];
  for (const app of Object.keys(data)) if (!APPS.includes(app)) errs.push(`${lang}: unknown app "${app}"`);
  for (const app of APPS) {
    const a = data[app];
    if (!a || typeof a !== "object") {
      errs.push(`${lang}/${app}: missing`);
      continue;
    }
    for (const [field, max] of Object.entries(LIMITS)) {
      const v = a[field];
      const where = `${lang}/${app}.${field}`;
      if (typeof v !== "string" || v.trim() === "") {
        errs.push(`${where}: missing or empty`);
        continue;
      }
      if (len(v) > max) errs.push(`${where}: ${len(v)} > ${max} characters`);
      if (v !== v.trim()) errs.push(`${where}: leading/trailing whitespace`);
      for (const re of PLACEHOLDERS) if (re.test(v)) errs.push(`${where}: placeholder leftover (${re})`);
    }
    for (const field of Object.keys(a)) if (!(field in LIMITS)) errs.push(`${lang}/${app}: unknown field "${field}"`);
    const name = `Rusuite ${app[0].toUpperCase()}${app.slice(1)}`;
    if (a.title !== name) errs.push(`${lang}/${app}.title: must be exactly "${name}"`);
    if (typeof a.fullDescription === "string") {
      if (!a.fullDescription.includes(name)) errs.push(`${lang}/${app}.fullDescription: product name "${name}" missing`);
      if (!a.fullDescription.includes(EXT[app])) errs.push(`${lang}/${app}.fullDescription: ${EXT[app]} not mentioned`);
    }
    if (typeof a.whatsNew === "string" && !a.whatsNew.includes("3.1415")) errs.push(`${lang}/${app}.whatsNew: version 3.1415 missing`);
    if (typeof a.keywords === "string" && /,\s|\s,/.test(a.keywords)) errs.push(`${lang}/${app}.keywords: no spaces around commas (App Store counts them)`);
  }
  return errs;
}

/** Problems of a release-notes text. */
export function checkReleaseNotes(lang, text) {
  const errs = [];
  if (typeof text !== "string" || text.trim() === "") return [`release-notes/${lang}.txt: missing or empty`];
  const t = text.trimEnd();
  if (len(t) > RELEASE_NOTES_MAX) errs.push(`release-notes/${lang}.txt: ${len(t)} > ${RELEASE_NOTES_MAX} characters`);
  for (const re of PLACEHOLDERS) if (re.test(t)) errs.push(`release-notes/${lang}.txt: placeholder leftover (${re})`);
  return errs;
}

/** Checks the whole `docs/store` folder; returns the list of problems. */
export function checkDir(dir) {
  const errs = [];
  for (const lang of LANGS) {
    const file = path.join(dir, "listing", `${lang}.json`);
    if (!fs.existsSync(file)) {
      errs.push(`listing/${lang}.json: missing`);
    } else {
      try {
        errs.push(...checkListing(lang, JSON.parse(fs.readFileSync(file, "utf8"))));
      } catch (e) {
        errs.push(`listing/${lang}.json: ${e.message}`);
      }
    }
    const rn = path.join(dir, "release-notes", `${lang}.txt`);
    errs.push(...checkReleaseNotes(lang, fs.existsSync(rn) ? fs.readFileSync(rn, "utf8") : undefined));
  }
  const listing = path.join(dir, "listing");
  for (const f of fs.existsSync(listing) ? fs.readdirSync(listing) : []) {
    if (f.endsWith(".json") && !LANGS.includes(f.slice(0, -5))) errs.push(`listing/${f}: not one of the 24 languages`);
  }
  const review = path.join(dir, "review-notes.txt");
  if (!fs.existsSync(review) || fs.readFileSync(review, "utf8").trim() === "") errs.push("review-notes.txt: missing or empty");
  return errs;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf("--dir");
  const dir = path.resolve(i > 0 ? process.argv[i + 1] : path.join(path.dirname(fileURLToPath(import.meta.url)), "../../docs/store"));
  const errs = checkDir(dir);
  if (errs.length) {
    console.error(errs.join("\n"));
    console.error(`\n${errs.length} problem(s)`);
    process.exit(1);
  }
  console.log(`listing OK: ${LANGS.length} languages x ${APPS.length} apps, release notes, review notes`);
}
