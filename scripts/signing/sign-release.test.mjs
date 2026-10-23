// Test of the `sign-linux` job's script (P10-S1) with a throwaway GPG key and a fake `gh` (no GitHub, no real key):
// `node --test scripts/signing/*.test.mjs`. Skipped when gpg is not installed.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const hasGpg = spawnSync("gpg", ["--version"]).status === 0;

const FAKE_GH = `#!/usr/bin/env bash
# fake gh: release download <tag> --dir D [--pattern P]... | release upload <tag> --clobber FILES...
set -euo pipefail
[ "$1 $2" = "release download" ] && {
  shift 3; dir=""; pats=()
  while [ $# -gt 0 ]; do case "$1" in --dir) dir="$2"; shift 2 ;; --pattern) pats+=("$2"); shift 2 ;; *) shift ;; esac; done
  shopt -s nullglob; cd "$FAKE_ASSETS"
  for p in "\${pats[@]}"; do for f in $p; do cp "$f" "$dir/"; done; done; exit 0; }
[ "$1 $2" = "release upload" ] && { shift 3; for f in "$@"; do [ "$f" = --clobber ] || cp "$f" "$FAKE_UPLOADS/"; done; exit 0; }
echo "fake gh: unexpected $*" >&2; exit 1
`;

test("sign-release signs the Linux packages, writes and signs SHA256SUMS over all installers", { skip: !hasGpg && "gpg missing" }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "p10-s1-gpg-"));
  const keyHome = path.join(dir, "keyhome");
  fs.mkdirSync(keyHome, { mode: 0o700 });
  const gpg = (...args) => execFileSync("gpg", ["--homedir", keyHome, "--batch", ...args], { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] });
  gpg("--pinentry-mode", "loopback", "--passphrase", "test-pass", "--quick-gen-key", "Test key <test@example.invalid>", "ed25519", "sign", "1d");
  const secret = gpg("--pinentry-mode", "loopback", "--passphrase", "test-pass", "--armor", "--export-secret-keys");
  const fpr = gpg("--with-colons", "--list-secret-keys").split("\n").find((l) => l.startsWith("fpr:")).split(":")[9];

  const assets = path.join(dir, "assets");
  const uploads = path.join(dir, "uploads");
  const bin = path.join(dir, "bin");
  for (const d of [assets, uploads, bin]) fs.mkdirSync(d);
  const names = ["Rusuite.Calc_3.141.0_amd64.deb", "Rusuite.Calc-3.141.0-1.x86_64.rpm", "Rusuite.Calc_3.141.0_amd64.AppImage",
    "Rusuite.Calc_3.141.0_x64_en-US.msi", "Rusuite.Calc_3.141.0_x64-setup.exe", "Rusuite.Calc_3.141.0_aarch64.dmg", "Rusuite.Calc_aarch64.app.tar.gz"];
  for (const n of names) fs.writeFileSync(path.join(assets, n), `content of ${n}\n`);
  fs.writeFileSync(path.join(bin, "gh"), FAKE_GH, { mode: 0o755 });
  const out = path.join(dir, "github_output");
  fs.writeFileSync(out, "");

  const r = spawnSync("bash", [path.join(HERE, "sign-release.sh"), "v3.141.0"], {
    encoding: "utf8",
    env: { PATH: `${bin}:${process.env.PATH}`, HOME: dir, FAKE_ASSETS: assets, FAKE_UPLOADS: uploads, GITHUB_OUTPUT: out,
      GPG_PRIVATE_KEY: secret, GPG_PASSPHRASE: "test-pass" },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!(r.stdout + r.stderr).includes("test-pass") && !(r.stdout + r.stderr).includes("PRIVATE KEY"), "no secret in the log");
  assert.equal(fs.readFileSync(out, "utf8"), `fingerprint=${fpr}\n`);
  const uploaded = fs.readdirSync(uploads).sort();
  assert.deepEqual(uploaded, [...names.slice(0, 3).map((n) => `${n}.asc`), "SHA256SUMS", "SHA256SUMS.asc"].sort());
  const sums = fs.readFileSync(path.join(uploads, "SHA256SUMS"), "utf8").trim().split("\n");
  assert.equal(sums.length, 6, "every installer, not the updater archive");
  for (const line of sums) assert.match(line, /^[0-9a-f]{64} {2}Rusuite\.Calc\S+$/);
  // A visitor's check: gpg --verify with the public key, sha256sum -c.
  for (const n of names.slice(0, 3)) gpg("--verify", path.join(uploads, `${n}.asc`), path.join(assets, n));
  gpg("--verify", path.join(uploads, "SHA256SUMS.asc"), path.join(uploads, "SHA256SUMS"));
  execFileSync("sha256sum", ["-c", path.join(uploads, "SHA256SUMS")], { cwd: assets });
  spawnSync("gpgconf", ["--homedir", keyHome, "--kill", "all"]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("sign-release without a key fails naming the secret", () => {
  const r = spawnSync("bash", [path.join(HERE, "sign-release.sh"), "v1"], { encoding: "utf8", env: { PATH: process.env.PATH } });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /GPG_PRIVATE_KEY is empty/);
});
