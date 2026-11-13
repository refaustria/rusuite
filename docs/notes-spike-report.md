# P11-N0 – Loro + Tiptap live collaboration through an encrypted relay (spike report)

**Verdict: GO for Loro**, with a short list of binding rules (below). Nothing found requires Yjs/yrs. All 10
questions answered with measurements; `node e2e.mjs` → 159 checks, `ALL CHECKS PASSED`, exit 0; `cargo test` in
`rust/` → 8 tests green. Localhost, shared and loaded dev server, headless Chromium 156.

**Versions that work:** `loro-crdt` 1.17.1 (JS/WASM), `loro` 1.17.1 (Rust), `loro-prosemirror` 0.4.4 **unpatched**,
Tiptap 3.31.3 (`@tiptap/core`, `starter-kit`, `extension-list`, `pm`) = Write's version; pnpm resolves one copy of
prosemirror-model 1.25.13 / -state 1.4.4 / -view 1.42.9 (no duplicate-instance problems). `chacha20poly1305` 0.10.1
(no default features) + wasm-bindgen 0.2.129 for the crypto WASM (29 KB).

## Layout / how to run
`relay.mjs` (Node `ws`, 48 lines, port 5111) · `src/` (Tiptap + binding + transport + crypto) · `e2e.mjs`
(Playwright, two/three browser contexts) · `bench.mjs` (Q9 in WASM) · `rust/` (own `[workspace]`; crypto lib for
WASM + tests `tree_moves`, `interop`, `perf`). `pnpm install && pnpm build:wasm`, `node relay.mjs`, `pnpm dev`, open
`http://localhost:5110/?room=x` twice (or `/two.html?room=x`), `node e2e.mjs`. Screenshot `shots/P11-N0-two-tabs.png`.
Measured numbers: `fixtures/e2e-results.json`; Rust perf: `cargo test --release --test perf -- --nocapture`.

## Answers
1. **Binding.** Works with Tiptap 3 as-is: headings 1/2, paragraphs, bullet/ordered lists, task list + checkbox
   toggled remotely, bold/italic/link marks all round-trip (Q1 checks). **Two required rules, no fork/patch:**
   (a) **disable StarterKit's `trailingNode`** (and never use appendTransaction plugins that edit the doc): the
   binding replays every PM transaction into Loro, including the one that renders a *remote* import, so each peer's
   TrailingNode appends its own paragraph concurrently → duplicated empty paragraphs and characters landing in the
   wrong block. Probe (single writer + passive peer): TrailingNode on **3/3 rounds corrupted**, off **0/3**.
   (b) **Seed every page with a shared genesis** (fixed peer id 0; identical ops dedupe): if two peers let the binding
   initialise an empty doc, both create `doc.children` concurrently, LWW picks one and the other's text vanishes.
   Bind the editor only after replaying the log. Undo must come from `LoroUndoPlugin` (`undoRedo: false`).
2. **Convergence.** 1000 random ops per side in the same paragraph, concurrently (≈850 real key presses + ≈43
   IME-path unique inserts + arrows/Home/End per side) in 5.6 s: frontiers, Loro JSON and PM JSON equal; per-character
   counts exact (no loss, no duplication). 20 concurrent bullet/ordered/task toggles + typing, 30 concurrent
   Enter/Backspace at the same position, 300-op offline burst on both sides then reconnect: all equal, PM docs
   schema-valid, every offline char present exactly once. Late joiner from the log only (2512 updates) converges in
   158 ms.
3. **Presence.** `CursorEphemeralStore` + `LoroEphemeralCursorPlugin`, encrypted like updates, never logged: named,
   coloured remote caret (checked by label). Keystroke → visible on the other page (keydown → MutationObserver):
   **median 7.7 ms, p95 15.5 ms** (XChaCha), 9.1/19.7 ms (AES-GCM); local echo 3.8/8.9 ms; remote caret move
   12.3/14.9 ms. On a 21 000-char page: remote 11.0/18.1 ms, local 5.5/9.6 ms. Under heavier server load in an
   earlier run p95 rose to 57–80 ms (median still < 10 ms).
4. **IME.** Japanese composition (k → か → かん → 漢字) with a remote insert mid-composition: clean. German dead key
   (^ + e) with a remote insert mid-composition: **corrupted without a guard** (`…漢字Xê^`: stray `^`, remote X
   moved; 2 of 3 unguarded runs). Cause: the binding replaces the whole PM doc on import. **Fix (in our transport,
   ~5 lines): hold remote imports while `view.composing`, flush on `compositionend`** → clean in every run.
5. **Undo.** `UndoManager` + `LoroUndoPlugin`: 40× Ctrl+Z on Ana removes exactly Ana's interleaved text
   ("alpha", "gamma") and keeps Ben's ("BETA DELTA"); redo restores step by step. **Caveat:** the first keystroke in an
   empty block also creates its `LoroText`; undoing it deletes the container including a peer's text typed there
   meanwhile (probe: Ben's text lost). Same semantics as y-prosemirror; N2 should create blocks with their empty
   text container and/or exclude container creation from undo.
6. **Encryption.** Each Loro update and presence message = `nonce‖XChaCha20-Poly1305(ct)` (Rust crate → WASM).
   WASM output byte-identical to native Rust (fixed vector). Relay spy: no plaintext (names, text, `nodeName`) in any
   frame. Browser cost: XChaCha 85 B seal/open **14.7/5.9 µs**, 32 KB 392/324 µs; WebCrypto AES-GCM 85 B 25.2/15.3
   µs (async), 32 KB 162/162 µs. Typing latency equal for both.
7. **Rust ↔ JS.** Native `loro` imports the browser snapshot → deep value == browser JSON; Rust prefixes the heading
   text and appends a paragraph with a bold mark in loro-prosemirror's shape (`nodeName/attributes/children`; marks
   = style key → attrs map; styles configured like `configLoroTextStyle`); browser imports and relays it, both PM
   views show it with a bold mark, Loro JSON == Rust's. One implementation is feasible.
8. **Desktop mirror.** Per keystroke: **81–83 B** update (p95 87–93); Rust import 10 µs median / 24 µs p95, Rust
   export-since-VV 5.4 µs; WASM commit+import 0.14 ms mean. Even with ~0.1–0.5 ms Tauri IPC (estimate, not measured)
   this is negligible. **Recommendation: doc of record in Rust** (`notes-core`); the webview holds a mirror `LoroDoc`
   bound to the editor; ship `subscribeLocalUpdates` bytes webview → Rust and remote updates Rust → webview (never
   snapshots per keystroke). Rust owns relay I/O, storage, search. Web: same mirror against `app-notes-wasm`.
9. **Size/perf (10 000 keystrokes, one commit each, 6 % backspace, 2 % Enter, 2 % random inserts).** Rust: full
   snapshot **33.2 KB**, shallow **18.9 KB**, all updates 23.7 KB for 15 KB of JSON; import 0.33 ms, import +
   materialise 1.05 ms → 500 such pages eagerly **≈0.5 s**; typical 1500-keystroke page 5.8 KB, 0.27 ms → 500 pages
   135 ms. WASM (Node): snapshot 21.4 KB, shallow 9.1 KB, import+toJSON 1.24 ms (shallow 0.39) → 500 pages ≈0.6 s.
   Lazy per-page loading is cheap; history ≈2× content. `loro_wasm_bg.wasm` is 3.6 MB (1.2 MB gzip) – biggest cost.
10. **Tree moves (Rust).** Concurrent move of one page to two different sections → one node, one parent, both docs
   equal. Concurrent x→y / y→x → exactly one root, no cycle. Move into a concurrently deleted section → page ends
   up deleted (history must allow restore).

## Recommendations
- **Granularity:** keep spec 4.2 – one notebook doc (LoroTree hierarchy + page metadata) + one doc per page; page
  genesis written once by the page creator (or a deterministic genesis as here).
- **Crypto:** XChaCha20-Poly1305 via RustCrypto `chacha20poly1305` everywhere (one code path native + WASM, sync,
  random 24-byte nonces are safe). AES-GCM WebCrypto also works but is async and a second implementation.
- **Relay protocol** as spiked: durable frames appended to a per-room log with sequence numbers, ephemeral frames
  broadcast only, "log from seq" on (re)connect, client queues while offline; add encrypted compaction snapshots.

## Pitfalls for P11-N1 / N2 / N5
- N2: TrailingNode off, no doc-editing appendTransaction plugins, no initial `content`, `undoRedo: false`; IME
  import guard; bind only after log replay; seed pages via genesis.
- N2: the binding rebuilds the PM doc on every remote import (unchanged nodes cached) – fine at 21 k chars, watch
  very large pages. Selection is restored in a `setTimeout`; keystrokes in that window use PM's mapped selection.
- N2: one page error per run on the passive peer of the Q1 room: `The container does not exist in the doc`. Not
  isolated; suspected presence cursor decoded before the update creating its container arrives (presence and updates
  travel independently). Guard the cursor plugin / apply presence after updates. No data loss observed with it.
- N2: undo of block creation removes peers' text in that block (Q5 caveat).
- N1: the Rust schema must mirror loro-prosemirror's shape exactly (`nodeName`, `attributes` map, `children` list of
  maps/texts; marks = text styles with attrs maps; expand "after" for inclusive marks, "none" for links).
- N1/N4: use frontiers/version vectors to decide "in sync"; op-id dedupe makes re-sending updates safe.
- N5: export from Loro JSON or PM JSON – identical on all peers.

## Not done / limits
No WAN latency simulation; Tauri IPC estimated, not measured; no signatures/key rotation (N4); Chromium only. The
spike's room key is derived from the room name – throwaway only.
