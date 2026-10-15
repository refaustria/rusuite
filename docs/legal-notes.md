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
5. **Reference data.** Test files are generated with LibreOffice; expected formula values are computed by LibreOffice or by us. No Office sample documents are redistributed.
6. **AI and cloud connectors** (planned) use the user's own accounts and keys; provider terms apply to the user.

## Recommendations before a public release
- Keep the non-affiliation statement in README, portal, about dialogs and store listings.
- Run a trademark search for "Rusuite" and the app names in the target markets.
- Add a NOTICE file listing third-party licences (generate from `cargo license`/`pnpm licenses`) – task for the release process.
