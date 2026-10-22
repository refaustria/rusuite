// Tests of the PM's signing helpers (P10-S1) with throwaway material only: make-csr.sh, p12.sh, gpg-key.sh.
// `node --test scripts/signing/*.test.mjs`; the gpg test is skipped without gpg.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), `p10-s1-${p}-`));
const sh = (script, args, env = {}) =>
  spawnSync("bash", [path.join(HERE, script), ...args], { encoding: "utf8", env: { PATH: process.env.PATH, HOME: os.tmpdir(), ...env } });

test("make-csr.sh: private key + CSR with CN=Rusuite, C=AT; never overwrites a key", () => {
  const dir = path.join(tmp("csr"), "signing");
  const r = sh("make-csr.sh", [dir]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.statSync(path.join(dir, "rusuite-apple.key")).mode & 0o777, 0o600);
  assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
  const subject = execFileSync("openssl", ["req", "-in", path.join(dir, "rusuite-apple.csr"), "-noout", "-subject"], { encoding: "utf8" });
  assert.match(subject, /CN\s*=\s*Rusuite, C\s*=\s*AT/);
  assert.match(execFileSync("openssl", ["req", "-in", path.join(dir, "rusuite-apple.csr"), "-noout", "-text"], { encoding: "utf8" }), /Public-Key: \(2048 bit\)/);
  assert.ok(!r.stdout.includes("PRIVATE KEY"));
  const again = sh("make-csr.sh", [dir]);
  assert.notEqual(again.status, 0);
  assert.match(again.stderr, /not overwriting/);
});

test("p12.sh: DER certificate + key → password-protected .p12; refuses a mismatching key", () => {
  const dir = tmp("p12");
  assert.equal(sh("make-csr.sh", [dir, "a"]).status, 0);
  const key = path.join(dir, "a.key");
  // Stand-in for Apple's certificate: self-signed from the CSR key, DER like App Store Connect delivers it.
  execFileSync("openssl", ["req", "-x509", "-key", key, "-subj", "/CN=Developer ID Application: Test (PM7LTV7M72)", "-days", "2", "-outform", "DER", "-out", path.join(dir, "a.cer")]);
  const out = path.join(dir, "a.p12");
  const r = sh("p12.sh", [path.join(dir, "a.cer"), key, out], { P12_PASSWORD: "p12-test-pass" });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!(r.stdout + r.stderr).includes("p12-test-pass"));
  assert.match(r.stdout, /Developer ID Application: Test \(PM7LTV7M72\)/);
  const info = execFileSync("openssl", ["pkcs12", "-in", out, "-info", "-nokeys", "-passin", "env:P", "-legacy"], { encoding: "utf8", env: { ...process.env, P: "p12-test-pass" }, stdio: ["pipe", "pipe", "pipe"] });
  assert.match(info, /friendlyName: Developer ID Application: Test \(PM7LTV7M72\)/);
  assert.notEqual(spawnSync("openssl", ["pkcs12", "-in", out, "-info", "-nokeys", "-passin", "pass:wrong", "-legacy"]).status, 0);
  assert.equal(sh("p12.sh", [path.join(dir, "a.cer"), key, path.join(dir, "b.p12")]).status, 2, "no password");
  assert.equal(sh("make-csr.sh", [dir, "other"]).status, 0);
  const mismatch = sh("p12.sh", [path.join(dir, "a.cer"), path.join(dir, "other.key"), path.join(dir, "c.p12")], { P12_PASSWORD: "x" });
  assert.notEqual(mismatch.status, 0);
  assert.match(mismatch.stderr, /does not match/);
});

test("gpg-key.sh: release key, public key exported, secret export protected, fingerprint printed", { skip: spawnSync("gpg", ["--version"]).status !== 0 && "gpg missing" }, () => {
  const dir = tmp("gpgkey");
  const keys = path.join(dir, "keys");
  const r = sh("gpg-key.sh", [path.join(dir, "signing")], { GPG_PASSPHRASE: "gpg-test-pass", KEYS_DIR: keys });
  assert.equal(r.status, 0, r.stderr);
  const fpr = /fingerprint: ([0-9A-F]{40})/.exec(r.stdout)?.[1];
  assert.ok(fpr, r.stdout);
  assert.match(fs.readFileSync(path.join(keys, "rusuite-release-key.asc"), "utf8"), /^-----BEGIN PGP PUBLIC KEY BLOCK-----/);
  const secret = path.join(dir, "signing", "rusuite-release-key.secret.asc");
  assert.equal(fs.statSync(secret).mode & 0o777, 0o600);
  assert.ok(!(r.stdout + r.stderr).includes("gpg-test-pass"));
  const listed = execFileSync("gpg", ["--homedir", path.join(dir, "signing", "gnupg"), "--batch", "--list-keys", fpr], { encoding: "utf8" });
  assert.match(listed, /Rusuite release key <release@rusuit\.es>/);
  assert.match(listed, /ed25519/);
  spawnSync("gpgconf", ["--homedir", path.join(dir, "signing", "gnupg"), "--kill", "all"]);
  fs.rmSync(dir, { recursive: true, force: true });
});
