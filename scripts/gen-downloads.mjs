#!/usr/bin/env node
// Renders the portal's static Downloads page (apps/portal/downloads.html, P8-41) from a GitHub release.
//
// ADR 0009: the page itself never contacts GitHub (or anything else) – the release data is baked in at deploy time by
// scripts/gen-downloads.sh (`gh release view <tag> --json …` plus the assets' SHA-256 digests from `gh api`). Only a
// click on a download button leaves the site, to the asset's GitHub URL.
//
//   node scripts/gen-downloads.mjs --in release.json --out downloads.html
//   node scripts/gen-downloads.mjs --none --out downloads.html     # no release yet (the committed fallback page)
//
// release.json: { tagName, name, url, publishedAt, isDraft, isPrerelease, assets: [{ name, size, url, digest? }] }
// (`digest` = "sha256:<hex>"). Texts are portal catalog keys (`portal.dl.*`, apps/portal/locales); downloads.js
// formats sizes/dates for the chosen language and puts the visitor's OS first.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The English portal catalog: the page's built-in texts (shown as is without JavaScript). */
export function loadCatalog(locale = "en") {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "apps/portal/locales", `${locale}.json`), "utf8"));
}

export const RELEASES_URL = "https://github.com/refaustria/rusuite/releases";

const APPS = [
  { id: "calc", name: "Rusuite Calc", kind: "portal.calc.kind" },
  { id: "write", name: "Rusuite Write", kind: "portal.write.kind" },
  { id: "show", name: "Rusuite Show", kind: "portal.show.kind" },
];

/** Per OS the package kinds in display order; the first is the main button. */
export const OSES = [
  {
    id: "windows",
    title: "Windows",
    kinds: [
      { id: "nsis", label: "portal.dl.kind.nsis", test: /_x64-setup\.exe$/i },
      { id: "msi", label: "portal.dl.kind.msi", test: /_x64(_[a-z]{2}-[A-Z]{2})?\.msi$/i },
    ],
    verify: 'certutil -hashfile <file> SHA256',
    warning: "portal.dl.warn.windows",
    steps: [{ id: "windows", title: "portal.dl.win.title", items: ["portal.dl.win.1", "portal.dl.win.2"] }],
  },
  {
    id: "macos",
    title: "macOS",
    kinds: [
      { id: "arm64", label: "portal.dl.kind.arm64", test: /_aarch64\.dmg$/i },
      { id: "x64", label: "portal.dl.kind.x64", test: /_x64\.dmg$/i },
    ],
    verify: "shasum -a 256 <file>",
    warning: "portal.dl.warn.macos",
    steps: [
      {
        id: "macos15",
        title: "portal.dl.mac15.title",
        items: ["portal.dl.mac15.1", "portal.dl.mac15.2", "portal.dl.mac15.3", "portal.dl.mac15.4", "portal.dl.mac15.5"],
        terminal: "portal.dl.mac15.terminal",
      },
      { id: "macos14", title: "portal.dl.mac14.title", items: ["portal.dl.mac14.1"] },
    ],
  },
  {
    id: "linux",
    title: "Linux",
    kinds: [
      { id: "deb", label: "portal.dl.kind.deb", test: /_amd64\.deb$/i },
      { id: "rpm", label: "portal.dl.kind.rpm", test: /\.x86_64\.rpm$/i },
      { id: "appimage", label: "portal.dl.kind.appimage", test: /_amd64\.AppImage$/i },
    ],
    verify: "sha256sum <file>",
    warning: "portal.dl.warn.linux",
    steps: [{ id: "linux", title: "portal.dl.linux.title", items: ["portal.dl.linux.1", "portal.dl.linux.2"] }],
  },
];

/** The app, OS and package kind of a release asset, or null (updater archives, signatures, other files). */
export function classify(assetName) {
  const app = /^Rusuite[ ._-](Calc|Write|Show)[_-]/i.exec(assetName)?.[1]?.toLowerCase();
  if (!app) return null;
  for (const os of OSES) {
    const kind = os.kinds.find((k) => k.test.test(assetName));
    if (kind) return { app, os: os.id, kind: kind.id };
  }
  return null;
}

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const attrJson = (o) => esc(JSON.stringify(o));
const interpolate = (msg, params) => msg.replace(/\{(\w+)\}/g, (all, k) => (params && k in params ? String(params[k]) : all));

/** Element attributes + content for catalog text (`html`: the catalog's own markup, never release data). */
function i18n(cat, key, { params, html = false } = {}) {
  if (!(key in cat)) throw new Error(`missing portal catalog key ${key}`);
  const p = params ? ` data-i18n-params="${attrJson(params)}"` : "";
  // Parameters are data: escaped before they go into markup.
  const safe = html && params ? Object.fromEntries(Object.entries(params).map(([k, v]) => [k, esc(v)])) : params;
  const value = interpolate(cat[key], safe);
  return html ? `data-i18n-html="${key}"${p}>${value}` : `data-i18n="${key}"${p}>${esc(value)}`;
}

/** The "how to open it" step lists of one OS (catalog keys); macOS adds a copyable Terminal line per app. */
function stepsHtml(cat, os) {
  const blocks = os.steps.map((st) => {
    const items = st.items.map((k) => `\n            <li ${i18n(cat, k, { html: true })}</li>`).join("");
    const terminal = st.terminal
      ? `
          <p class="term-intro" ${i18n(cat, st.terminal)}</p>
          <ul class="term">${APPS.map((app) => {
            const cmd = `xattr -dr com.apple.quarantine "/Applications/${app.name}.app"`;
            return `
            <li><code>${esc(cmd)}</code><button type="button" class="copy" data-copy="${esc(cmd)}" data-i18n-aria-label="portal.dl.copy.aria" aria-label="${esc(cat["portal.dl.copy.aria"])}" ${i18n(cat, "portal.dl.copy")}</button></li>`;
          }).join("")}
          </ul>`
      : "";
    return `
        <div class="steps-block" data-steps="${st.id}">
          <h3 ${i18n(cat, st.title)}</h3>
          <ol>${items}
          </ol>${terminal}
        </div>`;
  });
  return `<div class="steps">${blocks.join("")}
      </div>`;
}

const sha256Of = (asset) => (/^sha256:([0-9a-f]{64})$/i.exec(asset.digest ?? "")?.[1] ?? "").toLowerCase();

function head(cat) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="light dark" />
    <title ${i18n(cat, "portal.dl.title")}</title>
    <link rel="icon" href="logos/rusuite-mono.svg" type="image/svg+xml" />
    <link rel="canonical" href="https://rusuit.es/downloads.html" />
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body class="downloads">
    <div class="stripe" aria-hidden="true"><span></span><span></span><span></span></div>
    <div class="lang" role="group" data-i18n-aria-label="portal.language" aria-label="${esc(cat["portal.language"])}">
      <button type="button" data-lang="en" lang="en" aria-pressed="true" title="English">EN</button>
      <button type="button" data-lang="de" lang="de" aria-pressed="false" title="Deutsch">DE</button>
    </div>
    <nav class="topnav"><a href="./" ${i18n(cat, "portal.dl.back")}</a></nav>`;
}

function foot(cat) {
  return `
    <footer>
      <p class="meta">
        <a href="${RELEASES_URL}" ${i18n(cat, "portal.dl.all")}</a>
        <span aria-hidden="true">·</span>
        <a href="privacy.html" ${i18n(cat, "portal.privacy")}</a>
        <span aria-hidden="true">·</span>
        <a href="./#soon" ${i18n(cat, "portal.soon.link")}</a>
      </p>
      <p class="note" ${i18n(cat, "portal.dl.privacy")}</p>
      <p class="legal" ${i18n(cat, "portal.legal")}</p>
    </footer>
    <script src="i18n.js"></script>
    <script src="downloads.js"></script>
  </body>
</html>
`;
}

const webLinks = (cat) => `<p class="sub" ${i18n(cat, "portal.dl.web", { html: true })}</p>`;

/** The page when no release is known (no `gh`, no published release yet) – also the committed fallback. */
export function renderNone(cat = loadCatalog()) {
  return `${head(cat)}
    <header class="hero">
      <a class="wordmark" href="./" aria-label="rusuit.es"><span class="wm-a">rusuit</span><span class="wm-b">.es</span></a>
      <h1 ${i18n(cat, "portal.dl.heading")}</h1>
      <p class="lead" ${i18n(cat, "portal.dl.none", { html: true })}</p>
      ${webLinks(cat)}
    </header>
    <main data-testid="downloads" data-release="none"></main>${foot(cat)}`;
}

/** The page for one release. */
export function render(release, cat = loadCatalog()) {
  const tag = String(release.tagName ?? "");
  const date = String(release.publishedAt ?? "").slice(0, 10);
  const assets = (release.assets ?? []).map((a) => ({ ...a, info: classify(a.name) })).filter((a) => a.info);
  const find = (app, os, kind) => assets.find((a) => a.info.app === app && a.info.os === os && a.info.kind === kind);
  const prerelease = Boolean(release.isPrerelease) || tag.includes("-");

  const sections = OSES.map((os) => {
    const rows = APPS.map((app) => {
      const buttons = os.kinds
        .map((kind, i) => {
          const a = find(app.id, os.id, kind.id);
          if (!a) return "";
          return `
              <a class="button${i === 0 ? "" : " secondary"}" href="${esc(a.url)}" data-kind="${kind.id}" title="${esc(a.name)}">
                <span ${i18n(cat, kind.label)}</span>
                <small data-bytes="${Number(a.size) || 0}" ${i18n(cat, "portal.dl.size", { params: { mb: (Number(a.size) / 1e6 || 0).toFixed(1) } })}</small>
              </a>`;
        })
        .join("");
      return `
          <li class="dl-app" data-app="${app.id}">
            <img src="logos/${app.id}.svg" width="40" height="40" alt="" />
            <div class="dl-name"><strong>${esc(app.name)}</strong><span ${i18n(cat, app.kind)}</span></div>
            <div class="dl-buttons">${buttons || `<span class="muted" ${i18n(cat, "portal.dl.missing")}</span>`}
            </div>
          </li>`;
    }).join("");
    const sums = assets
      .filter((a) => a.info.os === os.id)
      .sort((x, y) => x.name.localeCompare(y.name))
      .map((a) => `\n            <dt>${esc(a.name)}</dt><dd><code>${sha256Of(a) || "–"}</code></dd>`)
      .join("");
    return `
      <section class="os" data-os="${os.id}">
        <h2>${os.title}</h2>
        <p class="warn" ${i18n(cat, os.warning, { html: true })}</p>
        ${stepsHtml(cat, os)}
        <ul class="dl-list">${rows}
        </ul>
        <details class="sums">
          <summary ${i18n(cat, "portal.dl.checksums")}</summary>
          <p ${i18n(cat, "portal.dl.verify", { html: true, params: { command: os.verify } })}</p>
          <dl>${sums}
          </dl>
        </details>
      </section>`;
  }).join("");

  return `${head(cat)}
    <header class="hero">
      <a class="wordmark" href="./" aria-label="rusuit.es"><span class="wm-a">rusuit</span><span class="wm-b">.es</span></a>
      <h1 ${i18n(cat, "portal.dl.heading")}</h1>
      <p class="lead" ${i18n(cat, "portal.dl.lead", { params: { tag } })}</p>
      <p class="sub">${prerelease ? `<span class="pill" ${i18n(cat, "portal.dl.prerelease")}</span> ` : ""}${date ? `<span data-date="${esc(date)}" ${i18n(cat, "portal.dl.released", { params: { date } })}</span>` : ""}</p>
      ${webLinks(cat)}
    </header>
    <main data-testid="downloads" data-release="${esc(tag)}">
      <aside class="unsigned" role="note">
        <h2 ${i18n(cat, "portal.dl.unsigned.title")}</h2>
        <p ${i18n(cat, "portal.dl.unsigned.text")}</p>
      </aside>
      <div id="os-list">${sections}
      </div>
      <template id="dl-badge"><span class="badge" ${i18n(cat, "portal.dl.recommended")}</span></template>
    </main>${foot(cat)}`;
}

// --- CLI ---------------------------------------------------------------------------------------------------------

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  const args = process.argv.slice(2);
  const opt = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const out = opt("--out");
  const input = opt("--in");
  if (!out || (!input && !args.includes("--none"))) {
    console.error("usage: gen-downloads.mjs (--in release.json | --none) --out downloads.html");
    process.exit(2);
  }
  const html = input ? render(JSON.parse(fs.readFileSync(input, "utf8"))) : renderNone();
  fs.writeFileSync(out, html);
  console.log(`gen-downloads: wrote ${out}`);
}
