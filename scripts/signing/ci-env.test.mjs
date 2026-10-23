// Tests of the release workflow's signing helpers (P10-S1): `node --test scripts/signing/*.test.mjs`.
// Fake material only – no certificate, key or network is involved.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Parses $GITHUB_ENV (NAME=value and NAME<<DELIM … DELIM forms) into an object. */
export function parseGithubEnv(text) {
  const out = {};
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const heredoc = /^([A-Za-z_][A-Za-z0-9_]*)<<(.+)$/.exec(lines[i]);
    if (heredoc) {
      const body = [];
      while (lines[++i] !== heredoc[2]) body.push(lines[i]);
      out[heredoc[1]] = body.join("\n");
    } else if (lines[i].includes("=")) {
      const at = lines[i].indexOf("=");
      out[lines[i].slice(0, at)] = lines[i].slice(at + 1);
    }
  }
  return out;
}

const runMacos = (env) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "p10-s1-env-"));
  const files = { GITHUB_ENV: path.join(dir, "env"), GITHUB_OUTPUT: path.join(dir, "out") };
  for (const f of Object.values(files)) fs.writeFileSync(f, "");
  const r = spawnSync("bash", [path.join(HERE, "ci-macos-env.sh")], {
    env: { PATH: process.env.PATH, RUNNER_TEMP: dir, ...files, ...env },
    encoding: "utf8",
  });
  return {
    ...r,
    dir,
    env: parseGithubEnv(fs.readFileSync(files.GITHUB_ENV, "utf8")),
    out: parseGithubEnv(fs.readFileSync(files.GITHUB_OUTPUT, "utf8")),
  };
};

const CERT = {
  APPLE_CERTIFICATE: "TUlJ\nQUJD\r\nREVG",
  APPLE_CERTIFICATE_PASSWORD: "pa$$ word\nwith=lines",
  APPLE_SIGNING_IDENTITY: "Developer ID Application: Test Person (PM7LTV7M72)",
  APPLE_TEAM_ID: "PM7LTV7M72",
};

test("macOS: certificate only – signing env set, no notarization", () => {
  const r = runMacos(CERT);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.env.APPLE_CERTIFICATE, "TUlJQUJDREVG", "base64 without line breaks");
  assert.equal(r.env.APPLE_CERTIFICATE_PASSWORD, CERT.APPLE_CERTIFICATE_PASSWORD, "multi-line safe");
  assert.equal(r.env.APPLE_SIGNING_IDENTITY, CERT.APPLE_SIGNING_IDENTITY);
  assert.equal(r.env.APPLE_TEAM_ID, "PM7LTV7M72");
  assert.equal(r.env.APPLE_API_KEY, undefined, "no empty notarization variables (Tauri would try to notarize)");
  assert.equal(r.out.notarize, "false");
  assert.ok(!fs.existsSync(path.join(r.dir, "AuthKey.p8")));
  for (const v of Object.values(CERT)) assert.ok(!(r.stdout + r.stderr).includes(v), "no secret in the log");
});

test("macOS: with the API key – .p8 written privately, notarization env set", () => {
  const p8 = "-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----";
  const r = runMacos({ ...CERT, APPLE_API_ISSUER: "issuer-uuid", APPLE_API_KEY: "KEYID12345", APPLE_API_KEY_CONTENT: p8 });
  assert.equal(r.status, 0, r.stderr);
  const key = path.join(r.dir, "AuthKey.p8");
  assert.equal(fs.readFileSync(key, "utf8"), `${p8}\n`);
  assert.equal(fs.statSync(key).mode & 0o777, 0o600);
  assert.deepEqual([r.env.APPLE_API_ISSUER, r.env.APPLE_API_KEY, r.env.APPLE_API_KEY_PATH], ["issuer-uuid", "KEYID12345", key]);
  assert.equal(r.out.notarize, "true");
  assert.ok(!(r.stdout + r.stderr).includes("FAKE"));
});

test("macOS: a missing secret fails naming the variable, not a value", () => {
  const r = runMacos({ ...CERT, APPLE_SIGNING_IDENTITY: "" });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /APPLE_SIGNING_IDENTITY is empty/);
  const r2 = runMacos({ ...CERT, APPLE_API_KEY_CONTENT: "x" });
  assert.notEqual(r2.status, 0);
  assert.match(r2.stderr, /APPLE_API_ISSUER is empty/);
});
