#!/usr/bin/env node
// `signing.json`, the release asset that tells the Downloads page per OS whether the builds are signed (P10-S1,
// docs/signing.md). Built by release.yml's `signing-manifest` job from what the jobs actually did: the signing records
// the macOS/Windows build legs write after verifying their signatures (scripts/signing/verify-macos.sh, the Windows
// verify step) and the outputs of `sign-linux`. An OS counts as signed only when every one of its legs reported so.
//
//   node scripts/signing/manifest.mjs --records <dir> [--fingerprint <hex>] [--linux-result success|skipped|failure]
//     --out signing.json
//
// signing.json: { macos: {signed, notarized}, windows: {signed, method: "pfx"|"azure"|null},
//                 linux: {gpg, fingerprint|null}, sha256sums }
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The apps release.yml builds (its `release` matrix; Notes since P11-N7). */
export const APPS = ["calc", "write", "show", "notes"];
/** Build legs per OS in release.yml: apps × (macos-latest, macos-15-intel) and apps × windows-latest. */
export const LEGS = { macos: APPS.length * 2, windows: APPS.length };

export function buildManifest(records, { fingerprint = "", linuxResult = "skipped", legs = LEGS } = {}) {
  const of = (os) => records.filter((r) => r && r.os === os && r.signed === true);
  const mac = of("macos");
  const win = of("windows");
  const methods = [...new Set(win.map((r) => r.method))];
  const macSigned = mac.length === legs.macos;
  const winSigned = win.length === legs.windows && methods.length === 1 && ["pfx", "azure"].includes(methods[0]);
  const fpr = String(fingerprint ?? "").replace(/\s+/g, "").toUpperCase();
  const gpg = linuxResult === "success" && /^[0-9A-F]{40}$/.test(fpr);
  return {
    macos: { signed: macSigned, notarized: macSigned && mac.every((r) => r.notarized === true) },
    windows: { signed: winSigned, method: winSigned ? methods[0] : null },
    linux: { gpg, fingerprint: gpg ? fpr : null },
    sha256sums: gpg,
  };
}

export function readRecords(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir, { recursive: true }).filter((f) => String(f).endsWith(".json"));
  return files.map((f) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(dir, String(f)), "utf8"));
    } catch {
      return null;
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  const args = process.argv.slice(2);
  const opt = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const out = opt("--out");
  if (!out) {
    console.error("usage: manifest.mjs --records <dir> [--fingerprint <hex>] [--linux-result <result>] --out signing.json");
    process.exit(2);
  }
  const manifest = buildManifest(readRecords(opt("--records")), {
    fingerprint: opt("--fingerprint"),
    linuxResult: opt("--linux-result"),
  });
  fs.writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify(manifest));
}
