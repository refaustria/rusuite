// Tests of scripts/store/signing-wording.mjs (P10-R2): `node --test scripts/store/*.test.mjs`.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { LANGS } from "./lib.mjs";
import { VARIANTS, apply, rewriteText } from "./signing-wording.mjs";
import { WORDING } from "./signing-wording-table.mjs";

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

test("table covers the 24 languages with three distinct variants; none/macLinux never claim Windows signing", () => {
  assert.deepEqual(Object.keys(WORDING).sort(), [...LANGS].sort());
  for (const [l, w] of Object.entries(WORDING)) {
    assert.equal(new Set(VARIANTS.map((v) => w[v])).size, 3, l);
    assert.ok(w.macLinux.includes("macOS") && w.macLinux.includes("GPG") && !/Windows/.test(w.macLinux), l);
    assert.ok(w.all.includes("Windows"), l);
  }
});

test("rewriteText replaces only the bullet line and round-trips", () => {
  const t = `New\n• Export as PDF\n• ${WORDING.de.all}`;
  const m = rewriteText(t, "de", "macLinux");
  assert.equal(m, `New\n• Export as PDF\n• ${WORDING.de.macLinux}`);
  assert.equal(rewriteText(m, "de", "all"), t);
  assert.throws(() => rewriteText(t, "de", "bogus"));
});

test("apply rewrites listings and release notes in a copy; the committed texts match macLinux", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "signing-"));
  for (const d of ["listing", "release-notes"]) fs.cpSync(path.join(repo, "docs/store", d), path.join(tmp, "docs/store", d), { recursive: true });
  const n = apply("all", tmp);
  assert.ok(n >= 24 * 4);
  assert.match(fs.readFileSync(path.join(tmp, "docs/store/release-notes/en.txt"), "utf8"), /Windows, macOS and Linux/);
  apply("none", tmp);
  assert.doesNotMatch(fs.readFileSync(path.join(tmp, "docs/store/listing/de.json"), "utf8"), /Signierte/);
  apply("macLinux", tmp);
  for (const f of ["listing/de.json", "release-notes/en.txt"]) {
    assert.equal(fs.readFileSync(path.join(tmp, "docs/store", f), "utf8"), fs.readFileSync(path.join(repo, "docs/store", f), "utf8"));
  }
  fs.rmSync(tmp, { recursive: true });
});
