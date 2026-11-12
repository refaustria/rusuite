# Task P11-O1 – `fmt-onenote`: read OneNote `.one` / `.onepkg` into an intermediate tree

Read `docs/tasks/COMMON.md` (incl. "Cycle 3.14159"), the spec `docs/superpowers/specs/2026-11-12-notes-design.md`
(sections 2 and 5), `docs/architecture.md`, `docs/legal-notes.md`, `NOTICE`, and one existing reader for style
(`crates/fmt-docx/src/lib.rs`: reader warnings, `read_with_context`).

Branch `p11/o1-fmt-onenote`, worktree `/home/bojan/rusuite-wt/p11-o1-fmt-onenote`. Model: Opus. No e2e port needed.

## Goal
A new crate `crates/fmt-onenote` that turns bytes of a OneNote 2010+ section file (`.one`) or a notebook package
(`.onepkg`, a CAB archive) into a plain, serde-serialisable intermediate tree, so P11-N6 can later map it onto
`model-notes` (which does not exist yet – do **not** depend on it). Runs in the browser (wasm32) too.

## Decisions already taken (PM)
- Use the crate **`onenote_parser` 2.1.x (MPL-2.0) as an unmodified dependency** – MPL is file-level copyleft; using it
  unmodified from crates.io in our MIT project is fine. Record it in `NOTICE` and `docs/legal-notes.md` (licence,
  source URL, "unmodified"). If it cannot parse from bytes or does not build for `wasm32-unknown-unknown`, check its
  API first (it may expose a parser over a `Read`/byte slice); only if impossible: vendor nothing, report, and
  implement a thin byte-based entry point around it (feature-gate the fs path). Never copy MPL code into our files.
- `.onepkg` is a CAB archive: use a pure-Rust CAB reader (`cab` crate, MIT/Apache) – state the version in the report.
- Old OneNote 2007 format and password-protected sections: return a clear warning/error, never panic.

## Public API (target – adjust names only with a reason in the report)
```rust
pub fn read_section(bytes: &[u8], file_name: &str) -> Result<Imported<OneSection>, OneNoteError>;
pub fn read_package(bytes: &[u8]) -> Result<Imported<OneNotebook>, OneNoteError>; // .onepkg
pub struct Imported<T> { pub value: T, pub warnings: Vec<ImportWarning> }
pub struct OneNotebook { pub name: String, pub items: Vec<NotebookItem> }      // sections and section groups in order
pub enum NotebookItem { Section(OneSection), Group { name: String, items: Vec<NotebookItem> } }
pub struct OneSection { pub name: String, pub color: Option<Rgb>, pub pages: Vec<OnePage> }
pub struct OnePage { pub title: String, pub level: u8 /* sub-page depth */, pub created: Option<i64>, pub modified: Option<i64>, pub contents: Vec<PageItem> }
pub enum PageItem {                       // with absolute position/size in points when OneNote stores one
  Outline { pos: Option<Rect>, blocks: Vec<Block> },
  Image { pos: Option<Rect>, data: Vec<u8>, mime: String, alt: Option<String> },
  Attachment { pos: Option<Rect>, file_name: String, data: Vec<u8> },
  Ink { pos: Option<Rect>, strokes: Vec<InkStroke> },
}
pub enum Block { Paragraph { runs: Vec<Run>, list: Option<ListInfo>, tags: Vec<Tag>, level: u8 }, Table { rows: Vec<Vec<Vec<Block>>> }, Image{..}, Attachment{..} }
pub struct Run { pub text: String, pub bold: bool, pub italic: bool, pub underline: bool, pub strike: bool, pub sup: bool, pub sub: bool, pub font: Option<String>, pub size_pt: Option<f32>, pub color: Option<Rgb>, pub highlight: Option<Rgb>, pub link: Option<String> }
pub struct Tag { pub kind: TagKind /* ToDo, Important, Question, Idea, Critical, Contact, Address, Phone, Remember, Definition, Highlight, Custom(String) */, pub label: String, pub checked: Option<bool> }
pub struct InkStroke { pub points: Vec<(f32, f32, Option<f32> /* pressure */)>, pub color: Rgb, pub width_pt: f32, pub highlighter: bool }
```
Heading levels: map OneNote's built-in paragraph styles (Heading 1–6, Title, Citation, Quote, Code) into
`Paragraph { style: Option<String> }` – add the field.

## Tests
- Corpus: find publicly available `.one`/`.onepkg` files with a licence that allows committing them (e.g. the
  `onenote_parser` repo's test files – check their licence; if MPL, they may be committed as-is under
  `testdata/onenote/` with their licence noted in a README there). If none can be committed, document where to get
  them and gate those tests behind the presence of the files (skip with a message) – the owner tests with real
  notebooks at the end of the cycle.
- Unit tests on the mapping layer with synthetic `onenote_parser` structures where its API allows constructing them;
  otherwise integration tests per corpus file asserting page titles, a known paragraph text, list/table/tag/image/ink
  presence counts.
- Robustness: truncated file, random bytes, `.one` renamed `.onepkg` → `Err`/warnings, never a panic (a small
  proptest or a loop over mutated bytes, 200 cases).
- `cargo check -p fmt-onenote --target wasm32-unknown-unknown` passes.

## In scope
`crates/fmt-onenote/**`, workspace `Cargo.toml` members/deps, `Cargo.lock`, `testdata/onenote/**`,
`docs/onenote-subset.md` (what is read, what becomes a warning), `NOTICE`, `docs/legal-notes.md`, the CI wasm-check
list if there is one (`.github/workflows/*` – only add the crate to an existing list).

## Verification
Definition of done from COMMON.md + the wasm check. Report: coverage table (element → read/warn), corpus used, crate
versions, anything `onenote_parser` cannot do (e.g. ink, tags, embedded files), wasm binary size impact estimate.
