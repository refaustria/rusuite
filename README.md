# Rusuite

<p>
  <img src="apps/portal/logos/rusuite.svg" width="56" height="56" alt="Rusuite logo" />&nbsp;
  <img src="apps/portal/logos/calc.svg" width="56" height="56" alt="Rusuite Calc logo" />
  <img src="apps/portal/logos/write.svg" width="56" height="56" alt="Rusuite Write logo" />
  <img src="apps/portal/logos/show.svg" width="56" height="56" alt="Rusuite Show logo" />
</p>

> A stripped-down but fully working office suite with a Rust backend and a web frontend via Tauri – and the same apps running in the browser via WebAssembly. Three apps: **Rusuite Write** (documents), **Rusuite Calc** (spreadsheets), **Rusuite Show** (presentations). Not an MS Office replacement, but a cleanly architected minimum that can read and write real `.docx`, `.xlsx` and `.pptx` files.

**Status:** 0.1.0 release candidate (alpha quality) – all three apps run on the desktop (Windows, macOS, Linux; Tauri)
and in the browser (WebAssembly) at <https://resuite.inceptum.at/>. See [Install](#install) and [CHANGELOG.md](CHANGELOG.md).

| | What works | Known gaps (top) |
|---|---|---|
| **Calc** | Excel-compatible engine with 221 functions and dynamic arrays; formula editing by pointing, F4, autocomplete; fill series, paste with reference adjustment, Paste Special; formats incl. the full number-format language, conditional formatting, data validation; sort, AutoFilter, Excel tables, structured references, named ranges; PivotTables; charts; notes, threaded comments, hyperlinks; freeze panes, merged cells, hidden sheets; print with headers/footers | Format Cells has the Number tab only; no "shift cells" insert/delete; no intersection operator; English separators only |
| **Write** | Styles (pane, Modify/Create, inspector), character and paragraph formatting, multilevel lists; tables with merges and styles; inline and floating pictures, shapes, text boxes; print layout with real pagination, sections, columns, headers/footers, footnotes; TOC, captions, cross-references, bookmarks, fields; comments; find/replace with wildcards | Mixed portrait/landscape pages drawn at one width; List Paragraph spacing; some Word shortcuts |
| **Show** | Layouts, themes, Slide Master, 110 shapes with handles, connectors, tables, charts, pictures with crop, audio/video; transitions and animations; Outline/Sorter/Notes/Reading views, guides; slide show with presenter view; handouts and notes printing | No freeform drawing; simpler connector routing; transitions not in PDF |
| **All apps** | Office-style ribbon (English and German), undo/redo, shortcuts, recent files, autosave and crash recovery, PDF export and printing; desktop: native file dialogs, WebDAV connections and an AI assistant with your own key | Unsigned installers, no auto-update |

Files written by Rusuite open in LibreOffice without warnings for every reference file in `testdata/`; the supported
OOXML subset is listed in [docs/ooxml-subset.md](docs/ooxml-subset.md). Documents never leave your device (ADR 0009).

---

## Goals and Non-Goals

### Goals
- Three desktop apps (Write, Calc, Show) sharing a common Rust core
- Read and write OOXML (`.docx`, `.xlsx`, `.pptx`) for a clearly defined subset of features
- Files we write must open in Microsoft Office and LibreOffice without a repair dialog
- Cross-platform (Windows, macOS, Linux) from a single codebase
- Also runs as a web app: the same Rust core compiled to WebAssembly, served as static files (see ADR 0005)
- Small binaries, fast startup, low memory footprint

### Non-Goals (deliberately excluded)
- Legacy binary formats (`.doc`, `.xls`, `.ppt`)
- Macros / VBA / scripting
- Track changes, real-time co-authoring (comments and notes are supported)
- Pixel-perfect reproduction of Office layout
- Power Query, data connections (pivot tables are supported)
- Pixel-exact print layout (printing goes through the webview's print pipeline with our own previews and options; see docs/ui.md)

If a feature isn't on the list, it isn't in. Scope discipline is the only reason this project has a chance.

---

## Architecture

```
┌────────────────────────────────────────────────────────────┐
│  Frontend (TypeScript, runs in the Tauri webview)          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                  │
│  │ write-ui │  │ calc-ui  │  │ show-ui  │  ← one per app   │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘                  │
│       └─────────────┼─────────────┘                        │
│                ui-shared (components, ribbon, dialogs)     │
└──────────────────────────┬─────────────────────────────────┘
                           │ Tauri IPC (commands + events, serde)
┌──────────────────────────┴─────────────────────────────────┐
│  Backend (Rust, Cargo workspace)                           │
│                                                            │
│   app-write       app-calc        app-show     ← Tauri apps│
│       │               │               │                    │
│   model-text    engine-formula    model-show    ← domain   │
│       │               │               │                    │
│   ──────────── core-model (shared document model) ──────── │
│       │               │               │                    │
│   fmt-docx        fmt-xlsx        fmt-pptx     ← OOXML I/O │
│       └───────────────┴───────────────┘                    │
│                   fmt-ooxml (ZIP, relationships, XML)      │
└────────────────────────────────────────────────────────────┘
```

### Core Principles

**Rust is the source of truth.** The document lives in the Rust backend. The frontend is a view that sends changes as commands and receives a diff/snapshot back. This makes undo/redo, saving and testing trivial because everything lives in one place.

**The browser does the text layout.** We do not write our own layout engine. Write uses a ProseMirror-based editor in the frontend; Rust only knows about paragraphs, runs and formatting. This is by far the biggest complexity saver in the project.

**The formula engine is pure Rust.** Parser, dependency graph and evaluator run entirely in the backend with no UI dependency. It is usable as a standalone crate and tested against a reference suite.

**One shared document model.** Text runs, font formatting, colors, styles and images are identical across all three apps (`core-model`). Write, Calc and Show only add their own containers on top.

---

## Tech Stack

| Area | Choice | Rationale |
|---|---|---|
| App shell (desktop) | [Tauri 2](https://tauri.app) | Rust backend, system webview, small binaries |
| App shell (web) | `wasm-bindgen` + `wasm-pack`, static hosting | Same Rust core in the browser, no server state |
| Backend | Rust (stable), Cargo workspace | – |
| XML | `quick-xml` + `serde` | Fast, streaming, no DOM needed |
| ZIP | `zip` | OOXML is ZIP + XML |
| IPC serialization | `serde` / `serde_json` | Tauri standard |
| Frontend | TypeScript + React + Vite | Wide choice of editor libraries |
| Text editor | Tiptap (ProseMirror) | Mature, extensible, schema-based |
| Spreadsheet grid | Custom canvas implementation | Virtualization for 100k+ cells |
| Slide canvas | Konva.js | 2D canvas with object model, drag/resize |
| Styling | Tailwind | – |
| Rust tests | `cargo test`, `insta` (snapshots), `proptest` | – |
| Frontend tests | Vitest + Playwright | – |

> **Alternatives considered:** Dioxus/Leptos (full-Rust frontend) would be more elegant, but the ecosystem for rich-text editing and canvas object models is far more mature on the JS side. `egui` is fast, but we'd have to write text layout ourselves – exactly what we want to avoid.

---

## Repository Structure

```
rusuite/
├── Cargo.toml                 # Workspace
├── package.json               # pnpm workspace
├── crates/
│   ├── core-model/            # Shared document model (runs, styles, colors, images)
│   ├── fmt-ooxml/             # ZIP container, [Content_Types], relationships, shared utils
│   ├── fmt-docx/              # .docx read/write → model-text
│   ├── fmt-xlsx/              # .xlsx read/write → model-sheet
│   ├── fmt-pptx/              # .pptx read/write → model-show
│   ├── model-text/            # Write document model (paragraphs, lists, tables)
│   ├── model-sheet/           # Workbook, sheets, cells, formatting
│   ├── engine-formula/        # Lexer, parser, dependency graph, evaluator, functions
│   ├── model-show/            # Slides, shapes, layouts
│   └── app-common/            # Undo/redo, document state, IPC types
├── apps/
│   ├── write/                 # Tauri app: src-tauri/ (Rust) + src/ (TS)
│   ├── calc/                  # core/ (calc-core, transport-agnostic) + src-tauri/ + src-wasm/ + src/ (TS)
│   ├── show/
│   └── portal/                # Static landing page at / + the logo set (logos/*.svg, *.png)
├── packages/
│   └── ui-shared/             # Ribbon, dialogs, color picker, font picker
├── testdata/
│   ├── docx/                  # Reference files created in real Office
│   ├── xlsx/
│   ├── pptx/
│   └── formulas/              # Formula test suite (input → expected result)
├── docs/
│   ├── architecture.md
│   ├── ooxml-subset.md        # Which XML elements we support
│   └── adr/                   # Architecture Decision Records
└── scripts/
    └── roundtrip.sh           # Read → write → diff against original
```

---

## MVP Feature Scope

### Rusuite Calc (first)
- Multiple worksheets, cells with text/number/bool/date
- Formulas: arithmetic, comparisons, cell references (relative/absolute), ranges, cross-sheet references
- ~60 functions: `SUM`, `AVERAGE`, `MIN`, `MAX`, `COUNT`, `IF`, `AND`, `OR`, `NOT`, `VLOOKUP`, `INDEX`, `MATCH`, `ROUND`, `CONCAT`, `LEFT`, `RIGHT`, `LEN`, `TODAY`, `DATE`, … (full list in `docs/functions.md`)
- Error values (`#DIV/0!`, `#REF!`, `#NAME?`, `#VALUE!`), circular reference detection
- Cell formatting: font, bold/italic, colors, borders, alignment, number formats (basic)
- Insert/delete rows and columns, width/height
- Copy/paste with reference adjustment
- Undo/redo

### Rusuite Write
- Paragraphs, headings (H1–H6), lists (numbered/bulleted)
- Character formatting: font, size, bold/italic/underline, color, highlight
- Paragraph formatting: alignment, indentation, spacing
- Styles (Normal, Heading 1–3, Title)
- Simple tables (no merged cells)
- Images (inline)
- Page margins, page size
- Undo/redo, find/replace

### Rusuite Show
- Slides with layouts (Title, Title + Content, Blank)
- Shapes: text box, rectangle, ellipse, line, image
- Text formatting as in Write
- Z-order, align, group (basic)
- Duplicate and reorder slides
- Presentation mode (fullscreen, arrow keys)
- Undo/redo

---

## Approach / Roadmap

The order is deliberate: first what can be tested without a UI, then what produces the most shared infrastructure. Phases 0–5 are done (the Office checks of the milestones are part of the release checklist in [docs/testing.md](docs/testing.md)); later work – usability, Office parity, quality passes – is tracked in STATUS.md, ROADMAP.md and [CHANGELOG.md](CHANGELOG.md).

### Phase 0 – Foundation (2–3 weeks)
- [x] Workspace, CI (`cargo clippy`, `cargo test`, `pnpm test`), formatters
- [x] `fmt-ooxml`: open ZIP, parse `[Content_Types].xml` and `_rels`, generic XML helpers
- [x] `core-model`: run formatting, colors, font definitions, theme colors
- [x] Roundtrip harness: read file → write → open in headless LibreOffice → count errors
- [x] Write the first ADRs (document model ownership, IPC strategy)

### Phase 1 – Formula Engine (4–6 weeks)
- [x] Lexer + parser (Pratt parser, A1 references, ranges, named ranges optional)
- [x] Dependency graph with incremental recalculation
- [x] Evaluator with type system (number, text, bool, error, array)
- [x] Function library via registry pattern (one function = one file)
- [x] Test suite in `testdata/formulas/` – every function checked against Excel reference values
- [x] Property tests for the parser (roundtrip formula → AST → formula)

### Phase 2 – Calc (6–8 weeks)
- [x] `model-sheet` + `fmt-xlsx` (shared strings, styles, worksheets)
- [x] Tauri app with canvas grid, virtualization, cell editing
- [x] Formatting toolbar from `ui-shared`
- [x] Undo/redo stack in `app-common` (command pattern)
- [x] **Milestone:** open a file created in Excel, edit it, save it, reopen it in Excel

### Phase 3 – Write (6–8 weeks)
- [x] `model-text` + `fmt-docx` (document.xml, styles.xml, numbering.xml, media)
- [x] Tiptap schema that maps 1:1 to `model-text`
- [x] Bidirectional sync: Tiptap transaction → Rust command → confirmed model
- [x] Images, tables, lists
- [x] **Milestone:** roundtrip 50 reference documents without losing any supported feature

### Phase 4 – Show (5–7 weeks)
- [x] `model-show` + `fmt-pptx` (slides, layouts, minimal masters, shapes, media)
- [x] Konva canvas with object model, selection, transforms
- [x] Slide sidebar, presentation mode
- [x] **Milestone:** build a 10-slide presentation and open it in PowerPoint without errors

### Phase 5 – Polish (ongoing)
- [x] Keyboard shortcut parity with Office for the basics
- [x] PDF export (webview print)
- [x] Recent files, auto-save, crash recovery
- [x] Installers for all three platforms
- [x] Performance: 1M cells, 200-page document, 100 slides

**Rough overall estimate:** 6–8 months for one person full-time through the end of Phase 4; 3–4 months for a team of three working on the apps in parallel once Phases 0 and 1 are done. The estimate assumes the scope does not grow.

---

## Install

- **Web:** nothing to install – open <https://resuite.inceptum.at/> (Chrome, Edge, Firefox or Safari).
- **Desktop:** installers for Windows (`.exe`, `.msi`), macOS (Apple Silicon and Intel `.dmg`) and Linux (`.deb`, `.rpm`,
  `.AppImage`) are on the [Downloads page](https://resuite.inceptum.at/downloads.html), with SHA-256 checksums, and on
  [GitHub Releases](https://github.com/refaustria/rusuite/releases). The builds are **not code-signed** yet: on Windows
  choose *More info › Run anyway* in the SmartScreen dialog; on macOS right-click the app › *Open* the first time. On
  Linux install the `.deb` with `sudo apt install ./<file>.deb`, or make the `.AppImage` executable and run it.
- **From source:** see [Development](#development). Releasing: [docs/release.md](docs/release.md).

## Development

### Prerequisites
- Rust ≥ 1.80 (stable) via [rustup](https://rustup.rs)
- Node ≥ 20 and [pnpm](https://pnpm.io)
- Tauri system dependencies: see [tauri.app/start/prerequisites](https://tauri.app/start/prerequisites/)
- Optional: LibreOffice (for the headless roundtrip test)

### Setup
```bash
git clone https://github.com/<you>/rusuite.git
cd rusuite
pnpm install
cargo build
```

### Run a single app
```bash
pnpm --filter calc tauri dev      # desktop (Tauri)
pnpm --filter calc dev:web       # browser (WASM) – requires `rustup target add wasm32-unknown-unknown` and wasm-pack
pnpm --filter write tauri dev
pnpm --filter show tauri dev
```

### Tests
```bash
cargo test --workspace           # Rust unit and snapshot tests
pnpm test                        # Frontend
./scripts/roundtrip.sh testdata  # File compatibility (requires LibreOffice)
```

### Try the formula engine on its own
```bash
cargo run -p engine-formula --example repl
> =SUM(1,2,3)*2
12
```

---

## Contributing

The project is intentionally kept small. Before proposing a feature, check whether it is in the scope above. If not, open an issue with the `scope-discussion` label first.

- Rust: `cargo fmt` and `cargo clippy -- -D warnings` must pass
- Every OOXML change needs a reference file in `testdata/` and a roundtrip test
- Every new formula function needs test cases with Excel reference values
- Architecture decisions go into `docs/adr/` as ADRs

---

## Trademarks

Microsoft, Office, Word, Excel and PowerPoint are trademarks of Microsoft Corporation. Rusuite is an independent project, not affiliated with or endorsed by Microsoft; the file formats are implemented from the public ECMA-376 / ISO/IEC 29500 specification. See `docs/legal-notes.md`.

## License

MIT – see [LICENSE](./LICENSE).

---

## Related Projects

Anyone working in this space should know these projects – partly as inspiration, partly as a pointer to what is already solved:

- [calamine](https://github.com/tafia/calamine) – Rust reader for Excel files
- [rust_xlsxwriter](https://github.com/jmcnamara/rust_xlsxwriter) – Rust writer for `.xlsx`
- [docx-rs](https://github.com/bokuweb/docx-rs) – read/write `.docx` in Rust
- [Tiptap](https://tiptap.dev) / [ProseMirror](https://prosemirror.net) – editor foundation
- [OnlyOffice](https://github.com/ONLYOFFICE/DocumentServer) – complete suite in JS, good reference for OOXML edge cases
- [LibreOffice](https://www.libreoffice.org) – the reference for "how does this actually open"
