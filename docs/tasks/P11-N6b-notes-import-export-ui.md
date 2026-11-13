# Task P11-N6b – Notes: import/export UI, lazy converter module, HTML paste

Read `docs/tasks/COMMON.md` (incl. "Cycle 3.14159"), the spec, `docs/notes-format.md` (§7), `crates/notes-convert`,
`apps/notes/core` (commands `importOneNote`, `importMarkdown`, `importHtml`, `importDocx`, `pasteHtml`, `exportPage`,
`exportSection`, result `fileImported`), `apps/notes/src-wasm` (`import_file`, `export`), `docs/onenote-subset.md`,
the app `apps/notes/src/**` (backstage, navigation, editor, blobs, print).

Branch `p11/n6b-notes-import-export-ui`, worktree `/home/bojan/rusuite-wt/p11-n6b-notes-import-export-ui`. Model: Opus.
e2e port 5136. P11-N5b (sharing) runs in parallel in `apps/notes/src/sync/**`, the Share tab and presence UI – do not
touch those; expect small merges in the ribbon/backstage.

## Items
1. **Lazy converter module (PM decision):** the converters added +3.9 MB raw to `app-notes-wasm`. Split: move the
   converter entry points (`import_file`, `export`, `pasteHtml` path) into a second wasm crate
   `apps/notes/src-wasm-convert` (`app-notes-convert-wasm`) that depends on `notes-convert` and works on the PM JSON
   / blobs the main module hands over (or on page/notebook update bytes – choose the cleanest seam, keep
   `notes-core` the owner of docs: the convert module returns PM JSON/tree descriptions or bytes, the main core
   applies them). Loaded with dynamic `import()` on first use with a progress indicator. Report main and convert
   module sizes (raw + gzip) before/after; the main module must shrink back near the N1 size.
2. **Import UI:** File › Import… (backstage page) with OneNote (`.one` → new section in the current notebook,
   `.onepkg` → new notebook), Markdown (`.md`, multiple files → pages in the current section), HTML (`.html/.htm`),
   Word (`.docx`). Also drag & drop of these files onto the navigation pane. Progress for large packages, then a
   result dialog: counts (sections/pages/images) and the warnings list grouped (as Write shows reader warnings),
   "Open imported notebook/section".
3. **Export UI:** File › Export: this page or this section as Markdown (section = zip), HTML, Word (`.docx`), PDF
   (existing print path); also in the page/section context menus. Downloads through the existing ui-shared save path.
4. **HTML paste:** pasting HTML into the editor goes through the core's sanitizer (`pasteHtml`) – rich paste from
   Word/web pages keeps headings, lists, tables, links, images from `data:` URIs; remote images become links
   (privacy: never fetched); plain-text paste unchanged. Test with HTML fixtures copied from Word and a web page.
5. **Notes for the owner's OneNote test:** a short section in `docs/ui.md` "Importing from OneNote" (how to export a
   notebook as `.onepkg` from OneNote desktop: File › Export › Notebook › OneNote Package; what is kept/lost, link to
   `docs/onenote-subset.md`).

## Tests
- Vitest for the lazy loader (loads once, error path when the module fails to load shows a message).
- e2e `notes-import-export.spec.ts`: import `testdata/onenote/notebook/*.one` (each section) and a `.onepkg` built
  from them at test time (or the fixture the Rust tests build – reuse), check tree/page titles/an image/ink canvas page;
  import `.md`, `.html`, `.docx` (`testdata/docx/` file) → pages with expected headings/text; export each format and
  re-import → same text; HTML paste fixture; request audit during import/export: no network besides loading the
  convert module from the same origin; the convert module is not loaded on a normal page open (check network log).

## Verification
`pnpm typecheck`; `pnpm test`; `pnpm i18n:check` (en/de); `scripts/privacy-check.sh`; fmt/clippy/tests for touched
Rust + wasm check for both notes wasm crates (add the new one to CI's list); `pnpm --filter notes build:web`
(and `scripts/deploy-web.sh` builds the second module via the notes `build:wasm` script); full e2e on 5136
(`BASE_URL` + your own serve.mjs); screenshots `shots/P11-N6b-*.png`.

## In scope
`apps/notes/src/**` except `sync/**` and share/presence UI, `apps/notes/src-wasm/**`, new
`apps/notes/src-wasm-convert/**`, `apps/notes/package.json`, small `apps/notes/core` changes (explain), workspace
`Cargo.toml`/lock, `.github/workflows/ci.yml` (wasm list), `packages/e2e/tests/notes-import-export.spec.ts`,
`docs/ui.md`.

## Report (≤ 50 lines): module sizes before/after, what works, deviations, rough edges.
