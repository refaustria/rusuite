# Architecture

Rusuite is three apps (Calc, Write, Show) over one Rust core. The document lives in Rust
([ADR 0001](adr/0001-rust-owns-the-document-model.md)); the TypeScript frontends render it and send
commands. The same core runs natively behind Tauri and as WebAssembly in the browser
([ADR 0005](adr/0005-web-target-via-wasm.md)). This page is the map; the ADRs hold the decisions and
[`ooxml-subset.md`](ooxml-subset.md) the file-format details.

## Crate graph

Dependency direction is strict ([ADR 0003](adr/0003-workspace-and-crate-layout.md)); arrows point at
dependencies, only normal (non-dev) dependencies are shown.

```
apps/<app>/src (TS) ──► packages/ui-shared   Backend = TauriBackend | WasmBackend
        │  dispatch(request JSON) → response JSON
app-<app> (Tauri)  |  app-<app>-wasm          thin shells: transport, dialogs, clock
        │
<app>-core  (calc-core | write-core | show-core) ───────────────► app-common
        │                         │
fmt-xlsx | fmt-docx | fmt-pptx ──► model-sheet | model-text | model-show ──► core-model
        │                          (model-sheet ──► engine-formula)
        └──► fmt-ooxml ──► core-model
```

| Crate | Depends on (project-internal) | Role |
|---|---|---|
| `core-model` | – | Shared vocabulary: `RunProperties`, `Color`, `Theme`/`ColorScheme`/`FontScheme`, units (`Twips`, `Emu`, `Pt`), `MediaStore`. |
| `engine-formula` | – | Lexer, parser, dependency graph, evaluator, functions; usable standalone. |
| `model-sheet` | `core-model`, `engine-formula` | `Workbook` owns the `Engine`; adds styles, dimensions, metadata ([ADR 0004](adr/0004-model-sheet-wraps-the-engine.md)). |
| `model-text` | `core-model` (+ `app-common` with feature `ts`) | Block/inline document with stable `NodeId`s ([ADR 0006](adr/0006-model-text-block-inline-model.md)). |
| `model-show` | `core-model` (+ `app-common` with feature `ts`) | Slides, shapes, DrawingML-shaped text ([ADR 0008](adr/0008-model-show-shapes-and-text.md)). |
| `fmt-ooxml` | `core-model` | OPC package (ZIP, `[Content_Types].xml`, relationships, part names); relationship/content-type constants (`rel`, `ct`); XML helpers (`xml`: small DOM `El`, writer `XmlOut`, scalar parsers); the DrawingML theme part (`theme`). |
| `fmt-xlsx`, `fmt-docx`, `fmt-pptx` | `fmt-ooxml`, `core-model`, their model (`fmt-xlsx` also `engine-formula`) | Bytes ↔ model. `read_with_context`/`write_with_context` carry file-level parts (theme, settings) to the next save. Format crates never depend on each other. |
| `app-common` | – | `Document` trait, undo/redo `Host`, `Envelope`, `DispatchError`, recent files and crash recovery (`Session`). |
| `calc-core`, `write-core`, `show-core` | `app-common`, the app's model and format crate | Transport-agnostic app core: commands, patches, snapshots, `dispatch`. |
| `app-calc`/`app-write`/`app-show`, `app-*-wasm` | the app core | Shells. No document logic. |

Two edges go beyond ADR 0003 as written: `fmt-xlsx → engine-formula` (formula text and cell values,
ADR 0004) and, since P7-3, `fmt-ooxml → core-model` (the theme part all three formats share parses into
`core_model::Theme`).

Everything below the Tauri shells compiles for `wasm32-unknown-unknown`: no `std::fs`, threads or system
clock in core crates (the engine clock is injectable). CI runs the wasm check.

## Dispatch and transport

One function per app core is the whole IPC surface, identical for both shells
([ADR 0002](adr/0002-ipc-strategy.md) and its amendments, ADR 0005):

```
calc_core::dispatch(&mut CalcHost, request_json: &str) -> String
write_core::dispatch_with(&mut WriteHost, request_json: &str) -> String
show_core::dispatch_with(&mut ShowHost, request_json: &str) -> String
```

- **Request** `{"type": ...}`: `apply {command}`, `undo`, `redo`, snapshot and query requests,
  `newDocument` (`newPresentation` in Show), `open* {bytesBase64, name}`, `save*`, `markSaved {name?}`, `documentState`.
- **Response** `{"ok": body}` or `{"err": {code, message}}`. Mutations answer with
  `Envelope { revision, patch, canUndo, canRedo, dirty }`; the frontend discards replies older than the
  newest revision it has seen.
- **Undo** lives in `app_common::Host`: every command returns its inverse; the document is clean while the
  undo depth equals the depth at the last save.
- **Bytes** (files, images) cross the wire as base64 strings in the JSON. The core never touches the file
  system; the shell picks and writes files (`open_file_dialog`/`save_file_dialog` in Tauri, a file input and
  `<a download>` on the web).
- **Types** are generated with `ts-rs` into `apps/<app>/src/generated/` and
  `packages/ui-shared/src/generated/`; `cargo test` regenerates them and CI fails when they drift.
- **Frontend:** `packages/ui-shared/src/backend.ts` defines `Backend` with `TauriBackend` and
  `WasmBackend`, picked at startup. UI code never imports Tauri APIs directly.
- **Write** ([ADR 0007](adr/0007-tiptap-rust-sync-protocol.md)): Tiptap applies a transaction
  optimistically; `apps/write/src/sync` maps it to a `WriteCommand` (or the always-correct `ReplaceBlocks`
  fallback); Rust confirms with a `WritePatch` and the sync plugin reconciles the changed blocks.
- **Calc** draws a canvas grid from region snapshots; **Show** renders shapes with Konva and edits text in
  an overlay that submits a whole `TextBody`.

## Data flow

**Open.** The shell reads the file → `open* {bytesBase64, name}` → the core decodes it →
`fmt_*::read_with_context(&bytes)`: `fmt_ooxml::Package::open` (ZIP, content types, relationships) → main
part via the `officeDocument` relationship → parts parsed into the model (`fmt_ooxml::xml::parse` DOM for
small parts, streaming `quick_xml::Reader` for worksheets; theme via `fmt_ooxml::theme`) →
`ReadOutput { model, context, warnings }`. The host replaces its document (undo cleared, clean, revision
bumped) and answers `opened { …, warnings, envelope }`. Warnings list dropped or approximated content.

**Edit.** UI event → command JSON → `apply` → `Document::apply` validates and mutates the model and returns
`Applied { patch, inverse }` → the host stores the inverse and bumps the revision → `Envelope` → the
frontend applies the patch (Calc: changed cells and styles, or a re-snapshot after structural edits; Write:
blocks by `NodeId`; Show: whole shapes or slides). A failed command leaves the model unchanged.

**Save.** `save*` → `fmt_*::write_with_context(&model, &context)` regenerates every part with
`fmt_ooxml::xml::XmlOut` (only the theme part, and Write's settings part, may come verbatim from the
context) → `Package::write` → base64 → `saved {bytesBase64, suggestedName}` → the shell writes the file →
only after success `markSaved` clears the dirty flag. Output is deterministic for the same model and
context. Autosave/crash recovery stores model snapshot JSON through `app_common::Session` (desktop: app
data directory; web: IndexedDB).

## Test strategy

| Layer | Where | What |
|---|---|---|
| Unit | next to the code (`#[cfg(test)]`) | Parsers, mappers, model invariants, XML helpers. |
| Integration | `crates/<name>/tests/`, `apps/<app>/core/tests/` | Public API: read/write round trips, `dispatch` end to end, crash recovery. |
| Snapshots (`insta`) | `tests/snapshots/` | Model JSON (IPC payloads), parser output, written XML of fixed inputs. A changed snapshot is a review item and needs a reason. |
| Properties (`proptest`) | `engine-formula/tests/roundtrip.rs` | Formula print → parse round trips over generated expressions. |
| Reference suites | `testdata/` + manifests | `testdata/formulas/*.tsv` with Excel reference values ([formula-suite.md](formula-suite.md)); 52 `.docx` and 26 `.pptx` files with `manifest.json`: every manifest feature found after read, write → read equal ([docx-suite.md](docx-suite.md), [pptx-suite.md](pptx-suite.md)); `.xlsx` samples. |
| Harness | `scripts/roundtrip.sh` ([roundtrip.md](roundtrip.md)) | Rewrite each file with a crate's `examples/rewrite` (`RUSUITE_REWRITE=…`), convert to PDF in headless LibreOffice, count errors/warnings, diff the parts. Baseline: xlsx 2/2, docx 52/52, pptx 26/26 PASS, `lo_warnings=0`. |
| Frontend unit | `apps/*/src/**/*.test.ts(x)`, `packages/ui-shared` (Vitest) | Sync mapping, state, components, shortcuts. |
| End to end | `packages/e2e` (Playwright, [testing.md](testing.md)) | The three real web builds with their wasm cores; files from `testdata/`; downloads unzipped and inspected. |
| Performance | `scripts/perf.sh` ([perf.md](perf.md)) | Load/edit/save timings native, wasm and in the browser against the MVP targets. |

CI (`.github/workflows/ci.yml`): `cargo fmt --check`, `clippy -D warnings`, `cargo test --workspace`,
the wasm check and `cargo doc`; then frontend tests and builds; then the e2e suite against the web builds.

## Where to add a feature

1. **Scope.** Is it in the README's MVP scope? If not, open a `scope-discussion` issue first.
2. **Model.** Shared by all apps (formatting, colors, media)? → `core-model`. Otherwise the app's model
   crate. Serde derives; extend the model's snapshot tests.
3. **File format.** Map it in the one `fmt-*` crate, read and write. Use `fmt_ooxml` for package, XML,
   theme and the `rel`/`ct` constants; shared OOXML plumbing goes there, never copied between format
   crates. Add a reference file in `testdata/` (and a manifest entry), a round-trip test, and update
   `ooxml-subset.md`. Content the reader cannot keep produces a warning, not silence.
4. **Command.** Add the command and its inverse to the app core (`apply` leaves the model unchanged on
   error; undo restores it exactly), extend the patch, test through `dispatch`.
5. **Wire types.** `cargo test -p <app>-core` regenerates the TypeScript types; commit them.
6. **Frontend.** Implement against `Backend.dispatch` only; Vitest tests, and a Playwright spec in
   `packages/e2e` for user-visible flows.
7. **Check.** `cargo fmt --all --check`, `cargo clippy --workspace --all-targets -- -D warnings`,
   `cargo test --workspace`, the wasm check, `pnpm test`, and the roundtrip harness for the touched format.
8. **Decision?** Changing a boundary above (crate graph, wire format, sync protocol) needs an ADR or an
   amendment in `docs/adr/`.

## Try the engine

The formula engine has a small REPL (no UI needed):

```bash
printf '=SUM(1,2,3)*2\nA1 = 5\nB1 = =A1*2\n=B1+1\n' | cargo run -q -p engine-formula --example repl
```

prints `12`, `5`, `10`, `11`. `=...` evaluates a formula in a scratch cell, `A1 = 5` / `B2 = =A1*2` / `Sheet2!C3 = hello` assign cells (dependents are recalculated and listed as `(also: ...)`), `:sheet Name` adds a sheet, `:show` lists all assigned cells, `:help` and `:q` do what they say.
