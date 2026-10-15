# ADR 0001 – Rust owns the document model

- Status: accepted
- Date: 2026-10-15

## Context
Rusuite has three apps with a TypeScript frontend (Tauri webview) and a Rust backend. The document could live in either place. The README states "Rust is the source of truth" as a core principle; this ADR records the consequences.

## Decision
The authoritative in-memory document (`model-text`, `model-sheet`, `model-show`, all on top of `core-model`) lives in the Rust process. The frontend holds a *view model* derived from snapshots/diffs and never mutates the document directly. Every edit is expressed as a command (serde-serializable, replayable) applied in Rust. Undo/redo, dirty tracking, autosave and file I/O therefore have exactly one implementation, in `app-common`.

The frontend may keep transient editing state (caret, selection, in-progress IME composition, uncommitted cell input) locally; this state is not part of the document.

## Consequences
- Every editor interaction becomes: UI event → command → Rust applies → confirmed model change → UI reconciles. Latency must stay low; commands must be small and batched where needed (see ADR 0002).
- Tests for document semantics (formatting, formulas, OOXML roundtrip) need no UI; `cargo test` covers them.
- Tiptap/ProseMirror in Write owns text *layout* and its own transaction model, so the Write sync layer must map ProseMirror transactions to model commands and vice versa (Phase 3 ADR).
- Large documents are never serialized whole on each change; the IPC layer sends diffs or region snapshots (ADR 0002).

## Alternatives rejected
- Frontend-owned document with Rust only for file I/O: simpler at first, but duplicates model logic in TS, makes undo/redo app-specific and leaves the formula engine without an authoritative cell store.
- Shared CRDT: solves a co-authoring problem that is an explicit non-goal.
