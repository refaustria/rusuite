// Tests of the Downloads page generator (P8-41): `node --test scripts/gen-downloads.test.mjs` (CI frontend job).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { classify, loadCatalog, render, renderNone } from "./gen-downloads.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// The asset names of v0.1.0-alpha.3 (tauri-action's naming).
const NAMES = ["Calc", "Write", "Show"].flatMap((app) => [
  `Rusuite.${app}-0.1.0-1.x86_64.rpm`,
  `Rusuite.${app}_0.1.0_aarch64.dmg`,
  `Rusuite.${app}_0.1.0_amd64.AppImage`,
  `Rusuite.${app}_0.1.0_amd64.deb`,
  `Rusuite.${app}_0.1.0_x64-setup.exe`,
  `Rusuite.${app}_0.1.0_x64.dmg`,
  `Rusuite.${app}_0.1.0_x64_en-US.msi`,
  `Rusuite.${app}_aarch64.app.tar.gz`,
  `Rusuite.${app}_x64.app.tar.gz`,
]);

export const fixture = () => ({
  tagName: "v0.1.0-rc.1",
  name: "Rusuite v0.1.0-rc.1",
  url: "https://github.com/refaustria/rusuite/releases/tag/v0.1.0-rc.1",
  publishedAt: "2026-10-20T10:00:00Z",
  isDraft: false,
  isPrerelease: true,
  assets: NAMES.map((name, i) => ({
    name,
    size: 4_000_000 + i,
    url: `https://github.com/refaustria/rusuite/releases/download/v0.1.0-rc.1/${name}`,
    digest: `sha256:${i.toString(16).padStart(2, "0").repeat(32)}`,
  })),
});

test("classify maps tauri-action's bundle names and skips updater archives", () => {
  assert.deepEqual(classify("Rusuite.Calc_0.1.0_x64_en-US.msi"), { app: "calc", os: "windows", kind: "msi" });
  assert.deepEqual(classify("Rusuite.Write_0.1.0-rc.1_x64-setup.exe"), { app: "write", os: "windows", kind: "nsis" });
  assert.deepEqual(classify("Rusuite.Show_0.1.0_aarch64.dmg"), { app: "show", os: "macos", kind: "arm64" });
  assert.deepEqual(classify("Rusuite.Show_0.1.0_x64.dmg"), { app: "show", os: "macos", kind: "x64" });
  assert.deepEqual(classify("Rusuite.Calc_0.1.0_amd64.deb"), { app: "calc", os: "linux", kind: "deb" });
  assert.deepEqual(classify("Rusuite.Calc-0.1.0~rc.1-1.x86_64.rpm"), { app: "calc", os: "linux", kind: "rpm" });
  assert.deepEqual(classify("Rusuite.Calc_0.1.0_amd64.AppImage"), { app: "calc", os: "linux", kind: "appimage" });
  assert.equal(classify("Rusuite.Calc_aarch64.app.tar.gz"), null);
  assert.equal(classify("Rusuite.Calc_0.1.0_amd64.AppImage.sig"), null);
  assert.equal(classify("NOTICE"), null);
  assert.equal(NAMES.filter((n) => classify(n)).length, 21);
});

test("the page lists every installer with its size and SHA-256, in English and German", () => {
  for (const locale of ["en", "de"]) {
    const html = render(fixture(), loadCatalog(locale));
    assert.equal(html.match(/<a class="button/g).length, 21, locale);
    assert.equal(html.match(/<dd><code>[0-9a-f]{64}<\/code><\/dd>/g).length, 21, locale);
    for (const os of ["windows", "macos", "linux"]) assert.match(html, new RegExp(`<section class="os" data-os="${os}"`));
    assert.match(html, /data-release="v0\.1\.0-rc\.1"/);
    assert.match(html, /data-i18n="portal\.dl\.prerelease"/);
  }
  const en = render(fixture());
  assert.match(en, /These builds are not signed yet – your system will warn once/);
  assert.match(en, /Rusuite v0\.1\.0-rc\.1 for Windows, macOS and Linux/);
  assert.match(en, /<code>certutil -hashfile &lt;file&gt; SHA256<\/code>/);
  assert.match(render(fixture(), loadCatalog("de")), /Diese Versionen sind noch nicht signiert/);
});

test("the page explains Gatekeeper and SmartScreen next to the buttons, in English and German", () => {
  const en = render(fixture());
  assert.match(en, /These builds are not signed yet – your system will warn once/);
  assert.ok(en.indexOf('class="unsigned"') < en.indexOf('class="dl-list"'), "notice above the buttons");
  for (const id of ["windows", "macos15", "macos14", "linux"]) assert.match(en, new RegExp(`data-steps="${id}"`));
  assert.match(en, /macOS 15 Sequoia and later/);
  assert.match(en, /click <strong>Done<\/strong> \(not “Move to Bin”\)/);
  assert.match(en, /<strong>Open Anyway<\/strong>/);
  assert.match(en, /macOS 14 and earlier/);
  assert.match(en, /<strong>Run anyway<\/strong>/);
  assert.match(en, /chmod \+x/);
  for (const app of ["Calc", "Write", "Show"]) {
    const cmd = `xattr -dr com.apple.quarantine &quot;/Applications/Rusuite ${app}.app&quot;`;
    assert.ok(en.includes(`<code>${cmd}</code>`), app);
    assert.ok(en.includes(`data-copy="${cmd}"`), app);
  }
  assert.equal(en.match(/class="copy"/g).length, 3);
  assert.equal(en.match(/<dd><code>/g).length, 21, "checksum table kept");
  const de = render(fixture(), loadCatalog("de"));
  assert.match(de, /macOS 15 Sequoia und neuer/);
  assert.match(de, /Dennoch öffnen/);
  assert.match(de, /Trotzdem ausführen/);
});

test("the page loads nothing from other sites (ADR 0009)", () => {
  const html = render(fixture());
  const srcs = [...html.replace(/<link rel="canonical"[^>]*>/, "").matchAll(/\b(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
  for (const s of srcs) {
    const external = /^https?:/.test(s);
    if (external) assert.match(s, /^https:\/\/github\.com\/refaustria\/rusuite\/releases(\/|$)/, s);
  }
  // Scripts and styles are the portal's own files; GitHub links are only anchors.
  for (const m of html.replace(/<link rel="canonical"[^>]*>/, "").matchAll(/<(script|link)\b[^>]*\b(?:src|href)="([^"]+)"/g)) assert.doesNotMatch(m[2], /^https?:/);
});

test("release data is escaped; missing assets and digests are handled", () => {
  const r = fixture();
  r.tagName = 'v1<script>"';
  r.assets = r.assets.filter((a) => !a.name.startsWith("Rusuite.Show")).map((a) => ({ ...a, digest: undefined }));
  r.assets[0].url = 'https://github.com/refaustria/rusuite/releases/download/x/"><b>';
  const html = render(r);
  assert.doesNotMatch(html, /<script>"/);
  assert.doesNotMatch(html, /"><b>/);
  assert.match(html, /data-i18n="portal\.dl\.missing"/);
  assert.match(html, /<dd><code>–<\/code><\/dd>/);
});

test("the committed apps/portal/downloads.html is the generator's no-release page", () => {
  const committed = fs.readFileSync(path.join(ROOT, "apps/portal/downloads.html"), "utf8");
  assert.equal(committed, renderNone(), "regenerate: node scripts/gen-downloads.mjs --none --out apps/portal/downloads.html");
  assert.match(renderNone(loadCatalog("de")), /noch keine Desktop-Version/);
});
