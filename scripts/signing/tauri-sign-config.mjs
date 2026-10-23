#!/usr/bin/env node
// The Windows Authenticode part of the Tauri config, merged into the build with `tauri build --config <file>` by
// release.yml only when signing secrets exist (P10-S1, docs/signing.md); tauri.conf.json itself stays unsigned.
// Tauri then signs the app .exe, the NSIS installer (and its uninstaller) and the MSI.
//
//   node scripts/signing/tauri-sign-config.mjs pfx --thumbprint <sha1 hex> --out <file>
//   node scripts/signing/tauri-sign-config.mjs azure --endpoint <https://…codesigning.azure.net> --description <text> --out <file>
//
// pfx:   the certificate imported into Cert:\CurrentUser\My, signtool with sha256 + DigiCert's RFC 3161-less timestamp.
// azure: Azure Trusted (Artifact) Signing through `artifact-signing-cli` (account, profile and the AZURE_* credentials
//        come from the environment, never from this file).
import fs from "node:fs";
import { fileURLToPath } from "node:url";

export const TIMESTAMP_URL = "http://timestamp.digicert.com";
export const AZURE_SIGN_CLI = "artifact-signing-cli";

export function pfxConfig(thumbprint) {
  const t = String(thumbprint ?? "").replace(/\s+/g, "").toUpperCase();
  if (!/^[0-9A-F]{40}$/.test(t)) throw new Error("thumbprint must be 40 hex digits (SHA-1 of the certificate)");
  return { bundle: { windows: { certificateThumbprint: t, digestAlgorithm: "sha256", timestampUrl: TIMESTAMP_URL } } };
}

export function azureConfig(endpoint, description) {
  const e = String(endpoint ?? "").trim();
  if (!/^https:\/\/[a-z0-9.-]+\.codesigning\.azure\.net\/?$/i.test(e)) {
    throw new Error("endpoint must look like https://<region>.codesigning.azure.net");
  }
  const d = String(description ?? "").trim();
  if (!d) throw new Error("description missing");
  return { bundle: { windows: { signCommand: { cmd: AZURE_SIGN_CLI, args: ["-e", e, "-d", d, "%1"] } } } };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  const [mode, ...rest] = process.argv.slice(2);
  const opt = (name) => {
    const i = rest.indexOf(name);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  const out = opt("--out");
  try {
    if (!out) throw new Error("--out missing");
    const config =
      mode === "pfx" ? pfxConfig(opt("--thumbprint")) : mode === "azure" ? azureConfig(opt("--endpoint"), opt("--description")) : null;
    if (!config) throw new Error("mode must be pfx or azure");
    fs.writeFileSync(out, `${JSON.stringify(config, null, 2)}\n`);
    console.log(`tauri-sign-config: ${mode} config written to ${out}`);
  } catch (e) {
    console.error(`tauri-sign-config: ${e.message}`);
    console.error("usage: tauri-sign-config.mjs pfx --thumbprint <hex> --out <file> | azure --endpoint <url> --description <text> --out <file>");
    process.exit(2);
  }
}
