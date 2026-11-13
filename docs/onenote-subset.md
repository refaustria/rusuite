# OneNote import subset (`fmt-onenote`)

`crates/fmt-onenote` reads OneNote 2010+ section files (`.one`) and notebook packages (`.onepkg`) into an
intermediate tree (`OneSection` / `OneNotebook`, serde-serialisable). P11-N6 maps that tree onto `model-notes`.
Spec: `docs/superpowers/specs/2026-11-12-notes-design.md`, section 5.

The file format itself (MS-ONESTORE revision store, MS-FSSHTTPB packaging of OneDrive downloads, MS-ONE object
model) is parsed by [`onenote_parser`](https://github.com/msiemens/onenote.rs) 2.1 (MPL-2.0, unmodified, see
`docs/legal-notes.md` item 9); `.onepkg` CAB extraction is its `onepkg` feature (the `cab` crate, MSZIP and LZX;
Quantum-compressed cabinets are not supported). Its file-system backend is off: both entry points take bytes and
compile for `wasm32-unknown-unknown`.

```rust
fmt_onenote::read_section(bytes, "Work.one")      -> Result<Imported<OneSection>, OneNoteError>
fmt_onenote::read_package(bytes, "Notes.onepkg")  -> Result<Imported<OneNotebook>, OneNoteError>
```

Units: positions and sizes in points relative to the page's top-left corner (OneNote stores half inches; ink is
0.01 mm), times in Unix seconds (UTC).

## What is read

| Element | Result |
| --- | --- |
| Notebook (`.onepkg`) | `OneNotebook { name (package file name), color, items }`; sections and section groups in the order of the `.onetoc2` (files the toc does not list are ignored, the recycle bin is skipped) |
| Section group | `NotebookItem::Group { name, items }`, nested |
| Section | `OneSection { name, color, pages }` |
| Page / sub-page | `OnePage { title, level 0–2, created, modified, contents }`; sub-pages follow their parent |
| Page title | plain text of the title outline (`""` when the page has none) |
| Outline (text box) | `PageItem::Outline { pos, blocks }` – position, width and (max) height when stored |
| Paragraph | `Block::Paragraph { runs, list, tags, level, style }`; `level` = outline indentation |
| Text formatting | bold, italic, underline, strike-through, superscript, subscript, font, size, colour, highlight; unset values inherit from the paragraph style |
| Hyperlinks | `Run::link` (web or `onenote:` target as stored); the hidden `HYPERLINK "…"` marker text is removed |
| Built-in paragraph styles | `style`: `heading1`–`heading6`, `title`, `citation`, `quote`, `code`; normal text `None` |
| Bulleted / numbered lists | `ListInfo { ordered, bullet, number_format (decimal, roman, letter, other), restart }` |
| Note tags | `Tag { kind, label, checked }`: kind by English default label, else by icon (localised labels), else `Custom(label)`; `checked` for check-box / task tags |
| Tables | `Block::Table { rows: [row][cell] -> blocks }` (nested content of cells included) |
| Pictures | in text: `Block::Image { data, mime, alt, width, height }`; on the page: `PageItem::Image { pos, … }`; media type from the stored extension, else the magic bytes |
| Attached files | `Block::Attachment` / `PageItem::Attachment { file_name, data }` (audio/video recordings too) |
| Ink (drawings) | `PageItem::Ink { pos, strokes }`; points relative to the drawing's corner, colour, width, highlighter (translucent or rectangular tip) |
| Ink inside a text box or paragraph (handwriting) | lifted out as a separate `PageItem::Ink` with `pos: None` (warning) |

## What becomes a warning

Warnings have the shape of the other readers' (`code`, `params`, English `text`, `count`; repeats merged).

| Code | When |
| --- | --- |
| `onenote.parser.warning`, `onenote.parser.pageWarning` | a non-fatal problem reported by the parser (e.g. a section of a package that failed to load, an embedded file without data); `{message}`, `{page}` |
| `onenote.page.unknownObject` | an object on a page the parser does not know |
| `onenote.outline.unknownObject` | an object inside a text box the parser does not know |
| `onenote.outline.tooDeep` | outline nesting deeper than 64 levels (rest dropped) |
| `onenote.ink.inOutline` | a drawing inside a text box (lifted out, position lost) |
| `onenote.ink.inText` | handwriting inside a paragraph (lifted out, position lost) |
| `onenote.math` | an equation: its linear text is kept, the math structure is not |
| `onenote.table.tags` | note tags on a table |
| `onenote.image.tags`, `onenote.attachment.tags` | note tags on a picture or file |
| `onenote.image.link` | a hyperlink on a picture |
| `onenote.image.missing` | a picture without image data (dropped) |
| `onenote.attachment.missing` | an attached file without data (dropped); `{name}` |

Dropped without a warning (no place in the target model yet): paragraph alignment and spacing, outline/table
column widths, cell background colours, table borders, page height, author, picture OCR text and background flag,
file icons, ink recognition text, pen pressure (the parser does not expose it), embedded web videos (iframes).

## What is an error (`OneNoteError`)

| Error | When |
| --- | --- |
| `NotOneNote` | not a OneNote file of the expected kind (random bytes, a `.docx`, an empty file, a desktop `.onetoc2` given as a package) |
| `SectionNotPackage` | a `.one` given to `read_package` (e.g. renamed to `.onepkg`; also a OneDrive-format `.onetoc2`, which has the section header) |
| `NotASection { found }` | a `.onetoc2` or `.onepkg` given to `read_section` |
| `Legacy2007` | OneNote 2007 or older: unknown file format GUID, or a desktop section written by pre-2010 code that fails to parse ("open it in OneNote 2010+ and save it again") |
| `PasswordProtected` | the parser reports encrypted objects (password-protected section) |
| `BadPackage` | not a valid cabinet, or no `.onetoc2` in it |
| `Malformed` | damaged or truncated files; on native targets also a caught parser panic (none known, see robustness tests) |

Robustness: random bytes, truncations and byte mutations of real sections give `Ok` or `Err`
(`tests/robustness.rs`, 2 × 200 proptest cases). The parser relies on wrapping arithmetic in some size checks
of damaged files; the workspace turns off overflow checks for `onenote_parser` in dev/test builds so tests see the
same behaviour as release builds (an `Err`).

## Test corpus

`testdata/onenote/` (sources and licences in its `README.md`): sample sections and a notebook from the
`onenote_parser` repository (MPL-2.0) and one desktop section from Microsoft's Interop-TestSuites (MIT).
The `.onepkg` tests build the cabinet from those files at test time. Further local files (e.g. the owner's
notebooks, or the AGPL-licensed Joplin samples that are not committed) can be checked with
`ONENOTE_EXTRA=/path/a.one,/path/b.onepkg cargo test -p fmt-onenote --test corpus extra -- --nocapture`.
