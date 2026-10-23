// Tests of the Downloads page generator (P8-41): `node --test scripts/gen-downloads.test.mjs` (CI frontend job).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { classify, loadCatalog, loadStoreLinks, publicName, render, renderNone, signingOf } from "./gen-downloads.mjs";
import { buildManifest } from "./signing/manifest.mjs";

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

export const fixture = (tag = "v0.1.0-rc.1", names = NAMES) => ({
  tagName: tag,
  name: `Rusuite ${tag}`,
  url: `https://github.com/refaustria/rusuite/releases/tag/${tag}`,
  publishedAt: "2026-10-20T10:00:00Z",
  isDraft: false,
  isPrerelease: tag.includes("-"),
  assets: names.map((name, i) => ({
    name,
    size: 4_000_000 + i,
    url: `https://github.com/refaustria/rusuite/releases/download/${tag}/${name}`,
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
  assert.match(en, /Rusuite 0\.1\.0-rc\.1 for Windows, macOS and Linux/);
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
  for (const html of [render(fixture()), render(signedFixture({ macos: true, windows: true, linux: true }))]) checkNoExternal(html);
});

function checkNoExternal(html) {
  const srcs = [...html.replace(/<link rel="canonical"[^>]*>/, "").matchAll(/\b(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
  for (const s of srcs) {
    const external = /^https?:/.test(s);
    if (external) assert.match(s, /^https:\/\/github\.com\/refaustria\/rusuite\/releases(\/|$)/, s);
  }
  // Scripts and styles are the portal's own files; GitHub links are only anchors.
  for (const m of html.replace(/<link rel="canonical"[^>]*>/, "").matchAll(/<(script|link)\b[^>]*\b(?:src|href)="([^"]+)"/g)) assert.doesNotMatch(m[2], /^https?:/);
}

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

test("publicName drops a trailing .0 patch only (π numbering, docs/versioning.md)", () => {
  assert.equal(publicName("v3.141.0"), "3.141");
  assert.equal(publicName("3.141.0"), "3.141");
  assert.equal(publicName("v3.1415.0"), "3.1415");
  assert.equal(publicName("v3.14159.0"), "3.14159");
  assert.equal(publicName("v3.1415.1"), "3.1415.1");
  assert.equal(publicName("v3.141.1"), "3.141.1");
  assert.equal(publicName("v3.141.10"), "3.141.10");
  assert.equal(publicName("v3.141.0-rc.1"), "3.141.0-rc.1");
  assert.equal(publicName("v0.1.0-rc.1"), "0.1.0-rc.1");
});

test("the 3.141 release shows the public name; tag and file names keep the semver; files grouped by app", () => {
  const names = NAMES.map((n) => n.replace("0.1.0", "3.141.0"));
  const r = fixture("v3.141.0", names);
  for (const locale of ["en", "de"]) {
    const html = render(r, loadCatalog(locale));
    assert.match(html, /data-release="v3\.141\.0" data-version="3\.141"/, locale);
    assert.doesNotMatch(html, /data-i18n="portal\.dl\.prerelease"/, locale);
    assert.equal(html.match(/<a class="button/g).length, 21, locale);
    assert.ok(html.includes("Rusuite.Calc_3.141.0_x64-setup.exe"), locale);
  }
  const en = render(r);
  assert.match(en, /Rusuite 3\.141 for Windows, macOS and Linux/);
  assert.doesNotMatch(en, /Rusuite 3\.141\.0 for/);
  assert.match(render(r, loadCatalog("de")), /Rusuite 3\.141 für Windows, macOS und Linux/);
  // Checksums per OS: Calc, Write, Show in that order, each in the OS's package order.
  const linux = en.slice(en.indexOf('data-os="linux"'));
  const dts = [...linux.matchAll(/<dt data-app="(\w+)">([^<]+)<\/dt>/g)].map((m) => m[2]);
  assert.deepEqual(dts, ["Calc", "Write", "Show"].flatMap((app) => [
    `Rusuite.${app}_3.141.0_amd64.deb`,
    `Rusuite.${app}-3.141.0-1.x86_64.rpm`,
    `Rusuite.${app}_3.141.0_amd64.AppImage`,
  ]));
});

// P10-S1: the release's signing.json decides per OS between "signed" and the Gatekeeper/SmartScreen steps.
const FPR = "0123456789ABCDEF0123456789ABCDEF01234567";
export const signingManifest = ({ macos = false, windows = false, linux = false, notarized = macos } = {}) => ({
  macos: { signed: macos, notarized },
  windows: { signed: windows, method: windows ? "pfx" : null },
  linux: { gpg: linux, fingerprint: linux ? FPR : null },
  sha256sums: linux,
});
/** A release with signing.json and, when GPG-signed, the .asc files and SHA256SUMS(.asc) next to the installers. */
export const signedFixture = (flags) => {
  const r = fixture("v3.1415.0", NAMES.map((n) => n.replace("0.1.0", "3.1415.0")));
  const extra = flags.linux
    ? [...r.assets.filter((a) => classify(a.name)?.os === "linux").map((a) => `${a.name}.asc`), "SHA256SUMS", "SHA256SUMS.asc"]
    : [];
  for (const name of [...extra, "signing.json"]) {
    r.assets.push({ name, size: 900, url: `https://github.com/refaustria/rusuite/releases/download/v3.1415.0/${name}`, digest: null });
  }
  r.signing = signingManifest(flags);
  return r;
};
const section = (html, os) => {
  const start = html.indexOf(`<section class="os" data-os="${os}"`);
  return html.slice(start, html.indexOf("</section>", start));
};

test("signingOf: anything missing or malformed is unsigned; macOS needs notarization", () => {
  assert.deepEqual(signingOf(undefined), { macos: false, windows: false, linux: false, fingerprint: null, sha256sums: false });
  assert.deepEqual(signingOf("nope"), signingOf(undefined));
  assert.equal(signingOf(signingManifest({ macos: true, notarized: false })).macos, false);
  assert.equal(signingOf({ windows: { signed: true, method: "other" } }).windows, false);
  assert.equal(signingOf({ linux: { gpg: true, fingerprint: "<b>" } }).linux, false);
  assert.equal(signingOf(signingManifest({ linux: true })).fingerprint, "0123 4567 89AB CDEF 0123 4567 89AB CDEF 0123 4567");
});

test("signing.json with everything false renders exactly the unsigned page", () => {
  const r = fixture();
  for (const locale of ["en", "de"]) {
    assert.equal(render({ ...r, signing: signingManifest() }, loadCatalog(locale)), render(r, loadCatalog(locale)), locale);
  }
});

test("all signed: no unsigned notice, signed lines instead of the Gatekeeper/SmartScreen steps, GPG + SHA256SUMS", () => {
  for (const locale of ["en", "de"]) {
    const html = render(signedFixture({ macos: true, windows: true, linux: true }), loadCatalog(locale));
    assert.doesNotMatch(html, /class="unsigned"/, locale);
    for (const id of ["windows", "macos15", "macos14"]) assert.doesNotMatch(html, new RegExp(`data-steps="${id}"`), locale);
    assert.match(html, /data-steps="linux"/, "Linux install steps stay");
    for (const os of ["windows", "macos", "linux"]) assert.match(section(html, os), new RegExp(`<p class="steps-block signed" data-signed="${os}"`), locale);
    assert.equal(html.match(/<a class="button/g).length, 21, locale);
    assert.equal(html.match(/<a class="asc" href="https:\/\/github\.com\/refaustria\/rusuite\/releases\/download\/v3\.1415\.0\/Rusuite\.\w+[^"]*\.asc"/g).length, 9, locale);
    assert.match(html, /data-testid="sha256sums"/, locale);
    assert.ok(html.includes('href="https://github.com/refaustria/rusuite/releases/download/v3.1415.0/SHA256SUMS.asc"'), locale);
    assert.ok(html.includes("0123 4567 89AB CDEF 0123 4567 89AB CDEF 0123 4567"), locale);
    assert.doesNotMatch(html, /xattr -dr/, locale);
  }
  const en = render(signedFixture({ macos: true, windows: true, linux: true }));
  assert.match(en, /Signed and notarized by Rusuite \(Apple Developer ID\)/);
  assert.match(en, /Signed with an Authenticode certificate/);
  assert.match(en, /GPG-signed<\/strong> – fingerprint <code>0123 4567/);
  assert.match(en, /<code>gpg --verify &lt;file&gt;\.asc &lt;file&gt;<\/code>/);
  assert.match(en, /<code>sha256sum --check --ignore-missing SHA256SUMS<\/code>/);
  assert.doesNotMatch(section(en, "macos"), /follow the steps for your macOS version/);
  const de = render(signedFixture({ macos: true, windows: true, linux: true }), loadCatalog("de"));
  assert.match(de, /Signiert und notarisiert von Rusuite/);
  assert.match(de, /Mit einem Authenticode-Zertifikat signiert/);
  assert.match(de, /GPG-signiert/);
});

test("macOS and Windows signed, Linux not: the notice names Linux only", () => {
  const html = render(signedFixture({ macos: true, windows: true }));
  assert.match(html, /<aside class="unsigned" role="note" data-unsigned="linux">/);
  assert.match(html, /Not signed yet: Linux/);
  assert.match(html, /The Linux builds are not signed yet/);
  assert.doesNotMatch(html, /These builds are not signed yet/);
  assert.doesNotMatch(html, /data-steps="(windows|macos15|macos14)"/);
  assert.doesNotMatch(html, /data-signed="linux"|class="asc"|data-testid="sha256sums"/);
  assert.match(render(signedFixture({ macos: true, windows: true }), loadCatalog("de")), /Noch nicht signiert: Linux/);
});

test("only Linux GPG-signed: the notice names Windows and macOS, their steps stay", () => {
  const html = render(signedFixture({ linux: true }));
  assert.match(html, /data-unsigned="windows macos"/);
  assert.match(html, /Not signed yet: Windows, macOS/);
  for (const id of ["windows", "macos15", "macos14", "linux"]) assert.match(html, new RegExp(`data-steps="${id}"`));
  assert.match(html, /data-signed="linux"/);
  assert.doesNotMatch(html, /data-signed="(windows|macos)"/);
  assert.match(html, /data-testid="sha256sums"/);
  // Signed but not notarized macOS still meets Gatekeeper: steps shown, macOS named.
  const mac = render(signedFixture({ macos: true, notarized: false, windows: true, linux: true }));
  assert.match(mac, /data-unsigned="macos"/);
  assert.match(mac, /data-steps="macos15"/);
});

test("the generator CLI accepts --release with signing.json (and keeps --in)", async () => {
  const { execFileSync } = await import("node:child_process");
  const os = await import("node:os");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "p10-s1-dl-"));
  fs.writeFileSync(path.join(dir, "release.json"), JSON.stringify(signedFixture({ macos: true, windows: true, linux: true })));
  for (const flag of ["--release", "--in"]) {
    execFileSync("node", [path.join(ROOT, "scripts/gen-downloads.mjs"), flag, path.join(dir, "release.json"), "--out", path.join(dir, "d.html")]);
    assert.match(fs.readFileSync(path.join(dir, "d.html"), "utf8"), /data-signed="macos"/, flag);
  }
});

// P10-R1: signing.json as the real manifest job writes it (scripts/signing/manifest.mjs) drives the page.
test("signingOf reads the real manifest.mjs output: every combination of signed OSes", () => {
  const rec = (os, n, extra = {}) => Array.from({ length: n }, () => ({ os, signed: true, ...extra }));
  const all = [...rec("macos", 6, { notarized: true }), ...rec("windows", 3, { method: "azure" })];
  const full = JSON.parse(JSON.stringify(buildManifest(all, { fingerprint: FPR, linuxResult: "success" })));
  assert.deepEqual(signingOf(full), { macos: true, windows: true, linux: true, fingerprint: "0123 4567 89AB CDEF 0123 4567 89AB CDEF 0123 4567", sha256sums: true });
  // 3.1415 as it may ship: macOS + Linux signed, Windows still unsigned (Azure pending).
  const partial = JSON.parse(JSON.stringify(buildManifest(rec("macos", 6, { notarized: true }), { fingerprint: FPR, linuxResult: "success" })));
  assert.deepEqual(signingOf(partial), { macos: true, windows: false, linux: true, fingerprint: "0123 4567 89AB CDEF 0123 4567 89AB CDEF 0123 4567", sha256sums: true });
  const html = render({ ...signedFixture({ macos: true, linux: true }), signing: partial });
  assert.match(html, /data-unsigned="windows"/);
  assert.match(html, /data-signed="macos"/);
  assert.match(html, /data-signed="linux"/);
  assert.doesNotMatch(html, /data-signed="windows"/);
  // Nothing signed: the manifest of a release without secrets renders the unsigned page.
  const none = JSON.parse(JSON.stringify(buildManifest([], {})));
  assert.deepEqual(signingOf(none), signingOf(undefined));
  // The release version renders as the public name.
  assert.match(render(signedFixture({ macos: true })), /Rusuite 3\.1415 for Windows, macOS and Linux/);
  assert.match(render(signedFixture({ macos: true })), /data-version="3\.1415"/);
});

// P10-R1: "Phones and tablets" from docs/store/links.json; empty strings = coming soon.
const mobileOf = (html) => html.slice(html.indexOf('data-testid="mobile-apps"'), html.indexOf("</section>", html.indexOf('data-testid="mobile-apps"')));
const EMPTY = { calc: { play: "", appstore: "" }, write: { play: "", appstore: "" }, show: { play: "", appstore: "" } };

test("the committed docs/store/links.json has empty strings for all six store links", () => {
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(ROOT, "docs/store/links.json"), "utf8")), EMPTY);
  assert.deepEqual(loadStoreLinks(), EMPTY);
});

test("Phones and tablets without links: 'coming soon' for every store, no store anchors", () => {
  const html = mobileOf(render(fixture("v3.1415.0", NAMES.map((n) => n.replace("0.1.0-rc.1", "3.1415.0"))), loadCatalog(), { links: EMPTY }));
  assert.match(html, /<h2 data-i18n="portal\.dl\.mobile\.title">Phones and tablets<\/h2>/);
  assert.equal([...html.matchAll(/data-soon="true"/g)].length, 6);
  assert.equal([...html.matchAll(/coming soon/g)].length, 6);
  assert.doesNotMatch(html, /<a /);
  const de = mobileOf(render(fixture(), loadCatalog("de"), { links: EMPTY }));
  assert.match(de, /Smartphones und Tablets/);
  assert.match(de, /demnächst/);
});

test("Phones and tablets with links: Play Store and App Store buttons per app; a partial file mixes both states", () => {
  const links = {
    calc: { play: "https://play.google.com/store/apps/details?id=dev.rusuite.calc", appstore: "https://apps.apple.com/app/id1" },
    write: { play: "https://play.google.com/store/apps/details?id=dev.rusuite.write", appstore: "" },
    show: { play: "", appstore: "" },
  };
  const html = mobileOf(render(fixture(), loadCatalog(), { links }));
  assert.match(html, /<li class="dl-app" data-app="calc">[\s\S]*?href="https:\/\/play\.google\.com\/store\/apps\/details\?id=dev\.rusuite\.calc" data-store="play"/);
  assert.match(html, /href="https:\/\/apps\.apple\.com\/app\/id1" data-store="appstore"/);
  assert.equal([...html.matchAll(/<a class=/g)].length, 3);
  assert.equal([...html.matchAll(/data-soon="true"/g)].length, 3);
  const calc = html.slice(html.indexOf('data-app="calc"'), html.indexOf('data-app="write"'));
  assert.doesNotMatch(calc, /data-soon/);
  assert.match(calc, />Google Play</);
  assert.match(calc, />App Store</);
  // The page stays free of other hosts except the store links the visitor clicks (ADR 0009: no request on load).
  assert.doesNotMatch(render(fixture(), loadCatalog(), { links }).replace(/<a [^>]*>/g, ""), /https?:\/\/(play|apps)\./);
});

test("loadStoreLinks accepts https URLs only and survives a missing or broken file", () => {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR || "/tmp"), "p10-r1-links-"));
  const file = path.join(dir, "links.json");
  fs.writeFileSync(file, JSON.stringify({ calc: { play: "https://play.google.com/x", appstore: "javascript:alert(1)" }, write: { play: '"><b>' }, show: 7 }));
  assert.deepEqual(loadStoreLinks(file), { calc: { play: "https://play.google.com/x", appstore: "" }, write: { play: "", appstore: "" }, show: { play: "", appstore: "" } });
  fs.writeFileSync(file, "{ nope");
  assert.deepEqual(loadStoreLinks(file), EMPTY);
  assert.deepEqual(loadStoreLinks(path.join(dir, "missing.json")), EMPTY);
});

test("the generator CLI reads --links and renders the 3.1415 page with the mobile section", async () => {
  const { execFileSync } = await import("node:child_process");
  const os = await import("node:os");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "p10-r1-dl-"));
  fs.writeFileSync(path.join(dir, "release.json"), JSON.stringify(signedFixture({ macos: true, windows: false, linux: true })));
  fs.writeFileSync(path.join(dir, "links.json"), JSON.stringify({ ...EMPTY, calc: { play: "https://play.google.com/store/apps/details?id=dev.rusuite.calc", appstore: "" } }));
  const run = (...extra) => {
    execFileSync("node", [path.join(ROOT, "scripts/gen-downloads.mjs"), "--release", path.join(dir, "release.json"), ...extra, "--out", path.join(dir, "d.html")]);
    return fs.readFileSync(path.join(dir, "d.html"), "utf8");
  };
  const withLinks = run("--links", path.join(dir, "links.json"));
  assert.match(withLinks, /data-version="3\.1415"/);
  assert.match(withLinks, /dev\.rusuite\.calc/);
  assert.match(mobileOf(run()), /data-soon="true"/); // default: the committed (empty) links.json
});
