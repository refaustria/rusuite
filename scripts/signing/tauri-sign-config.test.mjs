// Tests of the Windows signing config (P10-S1): `node --test scripts/signing/*.test.mjs`.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { azureConfig, pfxConfig } from "./tauri-sign-config.mjs";

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "tauri-sign-config.mjs");

test("pfx: thumbprint, sha256 and the DigiCert timestamp server", () => {
  assert.deepEqual(pfxConfig("a1 b1a2b2a3b3a4b4a5b5a6b6a7b7a8b8a9b9a0b0"), {
    bundle: {
      windows: {
        certificateThumbprint: "A1B1A2B2A3B3A4B4A5B5A6B6A7B7A8B8A9B9A0B0",
        digestAlgorithm: "sha256",
        timestampUrl: "http://timestamp.digicert.com",
      },
    },
  });
  assert.throws(() => pfxConfig(""), /40 hex/);
  assert.throws(() => pfxConfig("xyz"), /40 hex/);
});

test("azure: signCommand with artifact-signing-cli, no credentials in the config", () => {
  const c = azureConfig("https://weu.codesigning.azure.net", "Rusuite Calc");
  assert.deepEqual(c.bundle.windows.signCommand, {
    cmd: "artifact-signing-cli",
    args: ["-e", "https://weu.codesigning.azure.net", "-d", "Rusuite Calc", "%1"],
  });
  assert.equal(c.bundle.windows.certificateThumbprint, undefined);
  assert.doesNotMatch(JSON.stringify(c), /AZURE_|client|tenant|secret/i);
  assert.throws(() => azureConfig("http://evil.example", "x"), /codesigning\.azure\.net/);
  assert.throws(() => azureConfig("https://weu.codesigning.azure.net", " "), /description/);
});

test("CLI writes the file Tauri merges with --config", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "p10-s1-cfg-"));
  const out = path.join(dir, "tauri.sign.json");
  const r = spawnSync("node", [SCRIPT, "pfx", "--thumbprint", "ab".repeat(20), "--out", out], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(fs.readFileSync(out, "utf8")).bundle.windows.certificateThumbprint, "AB".repeat(20));
  const bad = spawnSync("node", [SCRIPT, "nope", "--out", out], { encoding: "utf8" });
  assert.equal(bad.status, 2);
});
