#!/usr/bin/env node
// Rewrites the "desktop apps" bullet of the store texts in all 24 languages (P10-R2).
// Usage: node scripts/store/signing-wording.mjs macLinux|all|none
//   all       macOS, Windows and Linux signed
//   macLinux  macOS (notarized) and Linux (GPG) signed, Windows not yet (default for 3.1415)
//   none      nothing signed
// Touches docs/store/listing/<lang>.json (whatsNew, fullDescription, description of every app) and
// docs/store/release-notes/<lang>.txt.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WORDING } from "./signing-wording-table.mjs";

export const VARIANTS = ["all", "macLinux", "none"];
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Replaces every bullet line carrying any known variant of `lang` by the `variant` wording. */
export function rewriteText(text, lang, variant) {
  const w = WORDING[lang];
  if (!w || !VARIANTS.includes(variant)) throw new Error(`unknown lang/variant: ${lang}/${variant}`);
  const known = new Set(VARIANTS.map((v) => `• ${w[v]}`));
  return text
    .split("\n")
    .map((line) => (known.has(line) ? `• ${w[variant]}` : line))
    .join("\n");
}

export function apply(variant, dir = root) {
  let changed = 0;
  for (const lang of Object.keys(WORDING)) {
    const jf = join(dir, "docs/store/listing", `${lang}.json`);
    const data = JSON.parse(readFileSync(jf, "utf8"));
    for (const app of Object.values(data)) {
      for (const key of ["whatsNew", "fullDescription", "description"]) {
        if (typeof app[key] !== "string") continue;
        const next = rewriteText(app[key], lang, variant);
        if (next !== app[key]) { app[key] = next; changed++; }
      }
    }
    writeFileSync(jf, JSON.stringify(data, null, 2) + "\n");
    const tf = join(dir, "docs/store/release-notes", `${lang}.txt`);
    const t = readFileSync(tf, "utf8");
    const n = rewriteText(t, lang, variant);
    if (n !== t) { writeFileSync(tf, n); changed++; }
  }
  return changed;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const variant = process.argv[2];
  if (!VARIANTS.includes(variant)) {
    console.error(`usage: signing-wording.mjs ${VARIANTS.join("|")}`);
    process.exit(2);
  }
  console.log(`${variant}: ${apply(variant)} text(s) changed; run node scripts/store/check-listing.mjs`);
}
