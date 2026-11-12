# Task P11-N0 – Spike: Loro + Tiptap live collaboration through an encrypted relay (THROWAWAY)

Read `docs/tasks/COMMON.md` (incl. "Cycle 3.14159"), then the spec `docs/superpowers/specs/2026-11-12-notes-design.md`
(sections 4 and 7), `docs/adr/0001`, `0005`, `0007`, `docs/architecture.md`, and how Write wires Tiptap
(`apps/write/src`, `apps/write/package.json`, Tiptap 3.31.3) and builds WASM (`apps/write/src-wasm`, `build:wasm`).

Branch `p11/n0-loro-spike`, worktree `/home/bojan/rusuite-wt/p11-n0-loro-spike`. Model: Opus. Port 5110 (+5111 relay).
**This branch is never merged.** Spike rules: minimal tests, no polish, no i18n, no ribbon. Put everything under
`spikes/notes-loro/` (a self-contained pnpm package + a tiny Rust crate) so nothing in the workspace changes except
adding the spike crate to the workspace members if needed (or keep it out of the workspace with its own `Cargo.toml`
and `[workspace]` – preferred).

## Questions the spike must answer (go/no-go for Loro)
1. **Editor binding:** Tiptap 3 (same version as Write) bound to a `LoroDoc` through `loro-prosemirror` (npm 0.4.x,
   `loro-crdt` 1.17.x): paragraphs, headings, bullet/ordered lists, a checklist, bold/italic/links. Does it work with
   Tiptap 3 / ProseMirror versions Write uses, or does it need a fork/patch? What is broken?
2. **Convergence:** two browser contexts (Playwright, two pages) editing the same page concurrently via the relay:
   random interleaved typing in the same paragraph (1000 ops each), list toggles, Enter/Backspace at the same spot,
   one side offline for a burst of edits then reconnecting. Final docs equal (`doc.export snapshot` / JSON equal),
   ProseMirror docs equal, no lost/duplicated characters versus a model of each side's intended inserts.
3. **Presence:** remote cursor + selection with name/colour via `loro-prosemirror` cursor plugin / `EphemeralStore`,
   transmitted encrypted. Latency end-to-end on localhost (median/p95 keystroke → visible on the other page).
4. **IME:** composition (Playwright `insertText` + `compositionstart/end` simulation, e.g. German dead keys/Japanese)
   while a remote edit arrives in the same paragraph – no corruption.
5. **Undo:** Loro `UndoManager` undoes only the local user's edits while remote edits interleave.
6. **Encryption:** XChaCha20-Poly1305 (Rust `chacha20poly1305` crate compiled to WASM, or WebCrypto AES-GCM – measure
   both if cheap) wrapping each Loro update; relay = ~100 lines (Node `ws` or Rust axum, your choice) that only
   broadcasts + appends ciphertext to a log and serves the log to late joiners. Joiner from log only → converges.
7. **Rust ↔ JS:** a Rust test that imports the browser's exported updates with the `loro` crate 1.17 (native) and gets
   the same document; and vice versa (Rust edits → browser). This proves "Rust owns the model" is feasible with one
   implementation.
8. **Desktop variant (measure only, no Tauri app needed):** cost of mirroring updates between a Rust `LoroDoc` and the
   webview's `LoroDoc` per keystroke (update size in bytes, encode/import time); recommend whether the desktop doc of
   record lives in Rust or in the webview WASM.
9. **Size/perf:** history growth for 10 000 keystrokes (snapshot bytes with full history, shallow snapshot bytes),
   time to import a 500-page notebook-worth of page docs lazily (estimate from 1 page × n).
10. **Tree moves:** `LoroTree` concurrent move of the same node to two parents → one node, no duplicate (Rust test).

## Deliverables
- `spikes/notes-loro/` with the demo (open two tabs on `http://localhost:5110/?room=x` and type), the relay, the
  Playwright script(s) and the Rust tests.
- Report `spikes/notes-loro/REPORT.md` (≤ 120 lines): answers 1–10 with numbers, **verdict GO/NO-GO for Loro**, the
  versions that work, any patches needed to `loro-prosemirror`, recommended doc granularity (notebook doc + page
  docs?), recommended crypto library, pitfalls for P11-N1/N2/N5. Screenshot `shots/P11-N0-two-tabs.png`.
- One commit on the branch. Then `cargo clean` in the worktree.

## Verification
`node`/Playwright script exits 0 with the convergence assertions; `cargo test` in the spike crate green. Workspace
checks are not required (spike is outside the workspace) – but do not break them: `cargo fmt --all --check` and
`pnpm typecheck` still pass on the branch.
