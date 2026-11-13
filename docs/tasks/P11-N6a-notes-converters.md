# Task P11-N6a – Notes converters in Rust: OneNote/Markdown/HTML/.docx import, Markdown/HTML/.docx export

Read `docs/tasks/COMMON.md` (incl. "Cycle 3.14159"), the spec `docs/superpowers/specs/2026-11-12-notes-design.md`
(sections 2 and 5), `docs/notes-format.md` (schema – node/mark names and attrs), `crates/model-notes` (esp.
`PageDoc::append_blocks`, `to_pm_json`, `NotebookDoc` creation API), `apps/notes/core` (dispatch, `PersistEffect`,
blobs), `crates/fmt-onenote` (`OneNotebook`/`OneSection`/`OnePage`, `docs/onenote-subset.md`), `crates/fmt-docx` +
`crates/model-text` (read/write docx).

Branch `p11/n6a-notes-converters`, worktree `/home/bojan/rusuite-wt/p11-n6a-notes-converters`. Model: Opus. No e2e
(UI comes in N6b). Runs in parallel with P11-N2 (UI) – do not touch `apps/notes/src/**` except regenerated TS types in
`apps/notes/src/generated/` (only new files/types; tell the PM which).

## Goal
Pure-Rust conversion between Notes and other formats, reachable through `notes-core` dispatch, wasm-compatible.

## Items
1. **OneNote import** (`fmt-onenote` → `model-notes`): `OneNotebook` → new notebook (section groups, sections with
   colours, pages with sub-page levels, created/modified times); per page: outlines in reading order (top-to-bottom,
   then left-to-right by position) → blocks via `append_blocks` (paragraph styles → heading/quote/code, runs with
   marks incl. font/size/colour/highlight if the schema supports them – extend the schema in notes-format.md only with
   PM-safe additions: `textStyle` mark with `color`, `highlight` mark with `color`; document them), lists, tables,
   tags (map `TagKind` to built-in tag ids, custom tags → notebook tag definitions), images/attachments → blobs.
   **Canvas rule:** a page with ink, or with ≥ 2 outlines whose horizontal ranges do not overlap (side-by-side
   layout), becomes a canvas page (`meta.canvas = true`, positioned items in `"canvas"`, strokes in `"ink"` per the
   model-notes schema) – otherwise a flowing page. Ink inside flowing pages (lifted ink) → append as a canvas-less
   "drawing" block? No: make the page a canvas page. Warnings from `fmt-onenote` pass through plus your own; return
   them with the import result. Command `ImportOneNote { fileName, bytes(binary path) }` – also for single `.one`
   sections (imported into the current notebook as a new section) – and `.onepkg` (new notebook).
2. **Markdown** import/export (CommonMark + GFM tables + task lists; `pulldown-cmark` for import, own writer for
   export): page ↔ `.md`; section export = zip of pages (`<page>.md` + `assets/`); `[[page links]]` round-trip as
   `[[Title]]`; tags exported as `#tag` suffix? – use a plain-text marker ` [To-do]`/` [Important]` and document it.
3. **HTML** import (paste/HTML file, sanitized: allow-list of elements/attributes, no scripts/styles/remote URLs;
   images only from `data:` URIs → blobs) and export (standalone `.html` with embedded images, minimal CSS).
   Also expose the HTML import for the editor's paste path (N6b uses it).
4. **.docx** import (`fmt-docx` → `model-text` → page blocks: headings, lists, tables, images, links; drawings/fields
   dropped with warnings) and export (page or section → `model-text` → `fmt-docx` bytes; one section = one document
   with each page as Heading 1 + page break). LibreOffice must open exported files without warnings (`soffice
   --headless --convert-to pdf`, check stderr) – add a test helper gated on `soffice` presence.
5. dispatch commands + TS types: `ImportOneNote`, `ImportMarkdown`, `ImportHtml`, `ImportDocx`,
   `ExportPage { format: md|html|docx }`, `ExportSection { format }` (binary results through the shell's binary
   path – extend `app-notes-wasm` with `import_file(kind, name, bytes) -> json` and `export(kind, json) -> bytes`).

## Tests (TDD)
- OneNote: the committed corpus (`testdata/onenote/`) imports into a notebook whose tree/page titles/text/tags/images
  match the fmt-onenote corpus expectations; canvas rule cases (synthetic `OnePage`s); warnings propagate.
- Markdown/HTML/docx round trips on a fixture page with every block type; HTML sanitizer rejects `<script>`,
  `on*` attributes, `javascript:` links, remote images (kept as links, not fetched); docx export opens in LibreOffice
  without warnings (if `soffice` present); docx import of 3 files from `testdata/docx/`.
- wasm check of the touched crates.

## In scope
`crates/model-notes/**` (schema additions + converters may live in a new module or a new crate `crates/notes-convert`
– your call, justify), `apps/notes/core/**`, `apps/notes/src-wasm/**`, `apps/notes/src/generated/**` (types only),
workspace `Cargo.toml`/`Cargo.lock` (new deps: `pulldown-cmark`, an HTML parser such as `html5ever`/`scraper` or
`tl` – prefer small, wasm-friendly, permissive licence), `docs/notes-format.md`, `.github/workflows/ci.yml` (wasm
list only), `NOTICE` (new deps).

## Report (≤ 50 lines): commands added, schema additions, what each format keeps/loses, wasm size delta.
