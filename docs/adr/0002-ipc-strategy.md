# ADR 0002 – IPC strategy between webview and Rust

- Status: accepted
- Date: 2026-10-15

## Context
Tauri 2 offers `invoke` commands (request/response) and events (backend → frontend push). We need a predictable way for the UI to send edits and receive model changes (ADR 0001).

## Decision
1. **Commands in, patches out.** The frontend calls a single generic `apply(doc_id, Command)` Tauri command plus a handful of query commands (`open`, `save`, `snapshot(region)`, `undo`, `redo`). `Command` is a serde-tagged enum defined per app in Rust (`app-common` holds the shared envelope and document-id types). Rust replies synchronously with a `Patch` describing what changed (list of changed cells / paragraphs / shapes, plus new undo/redo availability).
2. **Region snapshots, not whole documents.** `snapshot` returns only the requested region (sheet viewport, paragraph range, slide). Opening a document returns metadata and a first region.
3. **Events only for unsolicited changes.** Tauri events are used for things the UI did not ask for: recalculation finished asynchronously, file changed on disk, autosave status. Everything triggered by the UI comes back as the `invoke` reply.
4. **Wire format** is `serde_json` via Tauri's default serializer. All IPC types live in Rust and TS types are generated from them (tool chosen in Phase 2; candidates `ts-rs`, `specta`). No hand-maintained duplicate type definitions.
5. **Versioning.** Every `Patch` carries a monotonically increasing `revision`; the frontend discards out-of-order replies.

## Consequences
- The frontend never computes document state itself; it renders patches.
- IPC types are a public, tested surface of the Rust crates (`app-common`).
- Binary payloads (images) are not sent through JSON; they are served to the webview via a Tauri asset protocol handler (decided in Phase 3 when images arrive).

## Alternatives rejected
- One Tauri command per operation: large surface, hard to version, unfriendly to undo/redo.
- Streaming full document JSON after every edit: simple but fails the 100k-cell / 200-page targets.
