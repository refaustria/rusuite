# ADR 0006 – `model-text`: a block/inline model that mirrors both WordprocessingML and the Tiptap schema

- Status: accepted
- Date: 2026-10-15

## Context
Write keeps the document in Rust (ADR 0001) while Tiptap/ProseMirror does layout and editing in the webview. Both sides need to agree on structure; `.docx` is the persistence format. A model that follows WordprocessingML's block/inline shape (paragraphs with runs; tables of cells of paragraphs; inline images) maps 1:1 to a ProseMirror schema (`doc > (paragraph | heading | list | table)+`, `paragraph > (text | image | hardBreak)*`, marks for run formatting) and to `document.xml`.

## Decision
- **Blocks and inlines.** `Document.body: Vec<Block>`; `Block = Paragraph | Table`; `Paragraph.inlines: Vec<Inline>`; `Inline = Run | Image | Break`. Lists are paragraphs with a numbering reference (as in docx), not nested list containers; the Tiptap mapping layer converts between the flat numbered paragraphs and ProseMirror's nested `bulletList/orderedList/listItem` nodes. Headings are paragraphs with a heading style, not a separate block type.
- **Stable ids.** Every `Paragraph`, `Table`, `TableRow` and `TableCell` carries a document-unique `NodeId` (u64, monotonic per document, persisted in snapshots, not written to docx). Commands and patches address blocks by id and inline positions by (id, char offset). This is what the Tiptap↔Rust sync (ADR 0007, Phase 3) relies on.
- **Formatting reuse.** Run formatting is `core_model::RunProperties` (ADR 0003/0004). Paragraph and run properties are layered exactly as in Word: document defaults → style chain (`based_on`) → direct formatting; `model-text` provides `resolve_*` helpers that compute the effective properties.
- **Units.** Layout values use twips (1/20 pt) as in docx; image extents use EMU. `core_model::units` provides `Twips`, `Emu`, `Pt` newtypes with exact conversions (added in Phase 3).
- **Numbering.** One `NumberingDef` per docx `num` id with its resolved levels (abstractNum + overrides flattened on read; written back as one abstractNum per num).
- **Media.** Binary parts live in `MediaStore` keyed by `MediaId`; the model never holds file paths.

## Consequences
- Tiptap schema and `model-text` evolve together; every new block/inline type needs: model variant, docx read/write, schema node, and sync mapping.
- Find/replace, undo/redo, and style application are implemented once in Rust (`write-core`), not in ProseMirror plugins.

## Alternatives rejected
- Storing the ProseMirror JSON document in Rust: ties the model to one editor library and makes docx mapping two-step.
- Nested list containers in the model: faithful to HTML, but loses docx's per-paragraph numbering and complicates roundtrips.
