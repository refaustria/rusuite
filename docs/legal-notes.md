# Legal notes: file formats, trademarks, fonts, UI (PM assessment – not legal advice)

Owner question 2026-10-15: "Can we face copyright infringement if we offer pptx/xlsx/docx creation and editing by default?" This note records the assessment and the safeguards applied. For commercial distribution, have a lawyer review it.

## File formats – low risk
- `.docx`, `.xlsx`, `.pptx` are **Office Open XML**, an open standard: ECMA-376 (free to download) and ISO/IEC 29500. Microsoft's **Open Specification Promise** covers its necessary patent claims for implementations of the specification. Independent implementations are common (LibreOffice, Google Docs/Sheets/Slides, Apple iWork, Apache POI, openpyxl, python-docx, docx-rs, calamine, rust_xlsxwriter).
- Rusuite implements the formats from the public specification and from inspecting files; **no Microsoft code was copied**, and no Microsoft libraries are bundled. File formats as such (functional structures) are not copyrightable works; reading and writing them does not infringe copyright.
- Our own dependencies are MIT/Apache-2.0/MPL-compatible (Rust crates, React, Tiptap, Konva, Tailwind, Playwright). LibreOffice is used only as a test tool on the server (not distributed).

## Things to keep right (applied)
1. **Trademarks.** "Microsoft", "Office", "Word", "Excel", "PowerPoint" are Microsoft trademarks. We use them only nominatively ("opens Excel files"), never in product names, logos or domain names, and we state non-affiliation (README, portal footer, privacy page). Our app names are "Rusuite Calc / Write / Show"; note that "Calc" and "Writer" are also LibreOffice component names (The Document Foundation) – our names are always prefixed with "Rusuite" and use distinct logos; consider renaming if a trademark search raises concerns.
2. **Fonts.** Calibri, Calibri Light, Cambria etc. are proprietary Microsoft fonts. We only *name* them in documents (as every OOXML file does); we **do not ship** font files. Rendering uses whatever the OS/browser substitutes. Bundling fonts would require licences (or use of metric-compatible open fonts such as Carlito/Caladea).
3. **Themes and style names.** The default "Office" theme colours/fonts and style names like "Normal", "Heading 1" come from the ECMA-376 examples and are needed for interoperability; they are not expressive works. Fine to keep.
4. **UI look.** Our ribbon is our own implementation (React, hand-drawn icons, own layout). Microsoft's 2007 Office UI licensing programme for the ribbon concept is discontinued and the original ribbon patents date from 2005–2007; residual risk is low but non-zero – do not copy Office icon artwork, screenshots or exact gallery contents. Our icons and logos are hand-made SVGs (P6-1, P7-10).
5. **Preset shape and table style data (P8-32).** Show's preset geometries (outlines, adjust handles,
   connection sites, text rectangles) are ECMA-376 Part 1's `presetShapeDefinitions.xml`, converted
   to a compact line format (`crates/model-show/src/presets/`, generator `gen.py`); the specification
   is freely available and may be used to implement it (Ecma's copyright notice allows copies and
   derivative works that assist in implementing the standard). The 74 built-in table style GUIDs are
   identifiers PowerPoint uses (published by Microsoft); their looks are generated from our own family
   rules, not copied from PowerPoint's definitions.
6. **Reference data.** Test files are generated with LibreOffice; expected formula values are computed by LibreOffice or by us. No Office sample documents are redistributed.
7. **AI and cloud connectors** use the user's own accounts and keys; provider terms apply to the user. Cloud
   connectors v1 (P8-36, WebDAV) add these crates to the desktop shells (through `app-common`'s opt-in
   `tauri-connectors` feature), all permissive: `reqwest` (MIT/Apache-2.0), `rustls`, `hyper-rustls`
   (Apache-2.0/ISC/MIT), `tokio-rustls`, `rustls-pki-types`, `rustls-platform-verifier` (MIT/Apache-2.0),
   `rustls-webpki`, `untrusted` (ISC), `ring` (Apache-2.0 AND ISC – the `ring` provider instead of aws-lc, whose
   OpenSSL-licensed parts we avoid), `keyring`, `dbus-secret-service`, `aes`, `cbc`, `hkdf`, `zeroize`
   (MIT/Apache-2.0), `dbus`/`libdbus-sys` (MIT/Apache-2.0; already used by Tauri). The web apps add no
   dependency (the browser's `fetch`).

8. **Report relay (P8-43).** `services/report-relay` is a server program (not shipped in the apps). New crates, all
   permissive: `axum`, `axum-core` (MIT), `matchit` (MIT AND BSD-3-Clause), `httpdate`, `serde_path_to_error`
   (MIT/Apache-2.0); it also uses `tokio`, `reqwest`, `rustls`/`ring`, `uuid`, `sha2`, `base64` (already listed or
   MIT/Apache-2.0). The apps add `html-to-image` 1.11.13 (MIT) for "Capture this window". Reports are posted publicly
   to GitHub under GitHub's terms; the dialog tells the user before they submit.

## Recommendations before a public release
- Keep the non-affiliation statement in README, portal, about dialogs and store listings.
- Run a trademark search for "Rusuite" and the app names in the target markets.
- ~~Add a NOTICE file listing third-party licences~~ – done (P8-41), see below.

## NOTICE file (P8-41)
`NOTICE` at the repository root lists every third-party component the apps ship, grouped by licence: the Rust crates
(normal dependencies of the workspace crates on every platform – no dev/build dependencies, no proc macros, which run
only at compile time) and the npm production dependencies (React, Tiptap/ProseMirror, Konva, Tauri API, …). It is
generated by `scripts/gen-notice.sh` with `cargo license` (cargo-license 0.7.0) and `pnpm licenses list --prod`
(setup: docs/setup.md); regenerate it after dependency changes and before each release (docs/release.md). It is a
list, not the licence texts: those are in each package's source distribution.

State at 0.1.0-rc.1: 442 crates and 62 npm packages, all permissive (MIT, Apache-2.0, BSD, ISC, Zlib, Unicode-3.0,
0BSD, CC0/MIT-0 options, CDLA-Permissive-2.0 for the `webpki-root-certs` data) except five **MPL-2.0** crates pulled
in by Tauri's HTML handling and `dirs` (`cssparser`, `cssparser-macros`, `dtoa-short`, `selectors`, `option-ext`).
MPL-2.0 is file-level copyleft: using them unmodified in an MIT app is fine; if we ever modify their source files, the
modified files must be offered under MPL-2.0. Two crates are offered under LGPL-2.1-or-later *or* MIT/Apache-2.0
(we take the permissive option). No GPL component. Ship `NOTICE` and `LICENSE` with the release (the release notes
link them).

## Data fixtures from third-party projects (added 2026-10-17, P9-S2)
- `crates/fmt-pptx/src/tablestyle_powerpoint.xml` holds six `a:tblStyle` definitions exactly as PowerPoint writes them
  into `ppt/tableStyles.xml`. They were taken from the extraction published with *Dewiride PPTX Studio* (Apache-2.0),
  cross-checked with LibreOffice's `predefined-table-styles.cxx` (MPL-2.0). The content is PowerPoint's own output
  (format data, not authored code); to be safe the release task (P9-R1) adds a "Data sources" paragraph to
  `scripts/gen-notice.sh` naming both projects with their licences.
