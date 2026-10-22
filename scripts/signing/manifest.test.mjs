// Tests of signing.json (P10-S1): `node --test scripts/signing/*.test.mjs`.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildManifest, readRecords } from "./manifest.mjs";

const FPR = "0123456789ABCDEF0123456789ABCDEF01234567";
const mac = (notarized = true) => Array.from({ length: 6 }, () => ({ os: "macos", signed: true, notarized }));
const win = (method = "pfx") => Array.from({ length: 3 }, () => ({ os: "windows", signed: true, method }));

test("no records, no sign-linux: everything unsigned (the 3.141 state)", () => {
  assert.deepEqual(buildManifest([]), {
    macos: { signed: false, notarized: false },
    windows: { signed: false, method: null },
    linux: { gpg: false, fingerprint: null },
    sha256sums: false,
  });
});

test("all legs signed + GPG: everything signed", () => {
  assert.deepEqual(buildManifest([...mac(), ...win("azure")], { fingerprint: FPR.toLowerCase(), linuxResult: "success" }), {
    macos: { signed: true, notarized: true },
    windows: { signed: true, method: "azure" },
    linux: { gpg: true, fingerprint: FPR },
    sha256sums: true,
  });
});

test("a missing leg, a mixed method or a failed sign-linux counts as unsigned", () => {
  const m = buildManifest([...mac().slice(1), ...win().slice(1), { os: "windows", signed: true, method: "azure" }], {
    fingerprint: FPR,
    linuxResult: "failure",
  });
  assert.equal(m.macos.signed, false);
  assert.equal(m.windows.signed, false);
  assert.equal(m.linux.gpg, false);
  assert.equal(buildManifest([...mac(false)]).macos.notarized, false, "signed without the API key: not notarized");
  assert.equal(buildManifest([...mac(false)]).macos.signed, true);
  assert.equal(buildManifest([], { fingerprint: "nope", linuxResult: "success" }).linux.gpg, false);
});

test("records are read from the downloaded artifacts", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "p10-s1-rec-"));
  fs.mkdirSync(path.join(dir, "a"));
  fs.writeFileSync(path.join(dir, "a", "calc-windows-latest.json"), JSON.stringify(win()[0]));
  fs.writeFileSync(path.join(dir, "broken.json"), "{");
  const recs = readRecords(dir);
  assert.equal(recs.length, 2);
  assert.deepEqual(recs.filter(Boolean), [win()[0]]);
  assert.deepEqual(readRecords(path.join(dir, "missing")), []);
});
