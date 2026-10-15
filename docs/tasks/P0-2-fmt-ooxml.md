# Task P0-2 – `fmt-ooxml`: OPC package reader/writer

Branch: `p0/fmt-ooxml` (worktree `/home/bojan/rusuite-wt/p0-fmt-ooxml`). In scope: `crates/fmt-ooxml/**` only.

## Goal
`fmt-ooxml` can open any `.docx`/`.xlsx`/`.pptx` (an OPC ZIP package), expose its parts, content types and relationships, and write the package back such that (a) every non-generated part is byte-identical, (b) `[Content_Types].xml` and all `.rels` are regenerated semantically equal, and (c) LibreOffice opens the rewritten file. No format-specific knowledge (no Word/Excel/PowerPoint element names) belongs in this crate.

## Public API (design freedom inside these constraints; keep it small)
- `PartName`: newtype for an absolute OPC part name (`/word/document.xml`). Validated on construction (leading `/`, no empty segments, no `.`/`..`, no trailing `/`). Equality/ordering/hash are ASCII-case-insensitive per OPC; Display shows the original. `extension()`, `parent_dir()`, `rels_part_name()` (`/word/_rels/document.xml.rels`), `resolve(&self, relative_target: &str) -> Result<PartName>` for relationship targets (handles `../`, leading `/`, URL-decoding of `%20` is NOT required).
- `Part { content_type: String, data: Vec<u8> }`.
- `Package`: `open(impl Read + Seek)`, `open_path`, `write(impl Write + Seek)`, `write_path`, `parts()` iterator in stable original order, `part(&PartName) -> Option<&Part>`, `part_mut`, `insert_part(name, content_type, data)` (appends at end of order), `remove_part`, `content_type_of`, `relationships(&PartName) -> Option<&Relationships>` (for the source part, i.e. the `.rels` are parsed into a sidecar structure, NOT exposed as raw parts), `relationships_mut`, `package_relationships()` (from `/_rels/.rels`), `main_document_part() -> Option<PartName>` (target of the `http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument` relationship), `related_part(source, rel_type) -> Option<PartName>`.
- `Relationships { Vec<Relationship> }` with `Relationship { id: String, rel_type: String, target: String, target_mode: TargetMode::{Internal, External} }`, lookup by id and by type, `add(rel_type, target) -> &Relationship` generating the next free `rIdN`.
- `ContentTypes`: `Default` (extension → type) and `Override` entries; on write, regenerate: keep original Defaults (always include `rels` and `xml`), add Override for every part whose extension has no matching Default. Extensions compare case-insensitively.
- `Error` enum (thiserror): Zip, Xml, InvalidPartName, MissingContentTypes, MissingContentType(PartName), Io, etc.
- `xml` module, tiny: `fn local_name(qname) -> &[u8]`, `fn attr_local(el, name) -> Option<Cow<str>>`, a function returning the standard declaration `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n`, and an `escape_attr`/`escape_text` passthrough from quick-xml. Nothing more; format crates get their own XML code later.
- Writing: entries use forward slashes with no leading `/`; `[Content_Types].xml` first, then `/_rels/.rels`, then parts in original order with each part's `.rels` written directly after it; Deflate for everything; `last_modified_time` fixed to a constant (deterministic output: writing the same Package twice gives identical bytes – test this).
- An example binary `crates/fmt-ooxml/examples/rewrite.rs`: `cargo run -q -p fmt-ooxml --example rewrite -- <in> <out>` opens and writes. Exit code non-zero with the error on stderr on failure. The roundtrip harness (another task) will call exactly this command.

## Tests (required)
- Unit tests for `PartName` validation/normalization/resolve (include `/word/_rels/document.xml.rels` ↔ source mapping, `../media/image1.png` from `/word/document.xml`, absolute targets, case-insensitive equality).
- Unit tests for content types (Default vs Override precedence, regeneration) and relationships parsing/writing (preserve `TargetMode="External"`, preserve ids).
- An in-memory fixture builder in `tests/` that assembles a minimal valid package (content types, root rels, one `/word/document.xml` with rels to a `/word/media/x.png`) using the `zip` crate directly; test open → inspect → write → open again → part-by-part byte equality for non-generated parts; semantic equality of rels; deterministic write.
- `tests/testdata_roundtrip.rs`: for every file under `../../testdata/{docx,xlsx,pptx}/*.{docx,xlsx,pptx}` (glob by hand with `std::fs`, the directories may be empty right now – another task is populating them; the test must pass with 0 files and must print how many files it processed), open → write → reopen and assert: same set of part names, byte-identical data for every part except `[Content_Types].xml` and `*.rels`, same content type for every part, same relationship set (id, type, target, mode) per source part.
- Malformed input: a ZIP without `[Content_Types].xml` → `Error::MissingContentTypes`; non-ZIP bytes → `Error::Zip`.

## Non-goals here
No streaming/lazy part loading (load everything into memory). No digital signatures, no interleaved pieces, no core-properties parsing. Don't add a `Document` abstraction.

## Dependencies
Already declared: zip 9, quick-xml 0.42, serde, thiserror. You may add `tempfile` as a dev-dependency. Nothing else.
