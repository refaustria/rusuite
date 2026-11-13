# Plan 3.14159 – Rusuite Notes (owner direction 2026-11-12)

**Owner direction (2026-11-12):** rebuild OneNote inside the suite, same look & feel, web first then desktop (mobile
later); shared notebooks must update instantly with visible editors and never conflict. "Setze jetzt alles um. Triff
eigenständig die Entscheidungen außer sie sind essenziell, dann parke und mache was geht weiter."

**Spec (approved 2026-11-12):** [`docs/superpowers/specs/2026-11-12-notes-design.md`](superpowers/specs/2026-11-12-notes-design.md)
– every brief implicitly includes it. Version at the end of the cycle: **3.14159** (`3.14159.0`). Working mode as
before: PM briefs → agent in a worktree → PM verifies → `--no-ff` merge → deploy web from `main`. Max **2** agents in
parallel (disk: ~25 GB free). Task ids `P11-*`, e2e ports `511n` (Notes), `512n` (relay/sharing), `513n` (import/
export), `514n` (languages/polish). Briefs in `docs/tasks/P11-*.md`.

## Global constraints (from the spec)
- Rust owns the document model; one Loro implementation (Rust crate `loro`, in the browser the same crate via WASM).
  Fallback Yjs/yrs only if N0 fails.
- Core crates `wasm32-unknown-unknown` compatible; `#![forbid(unsafe_code)]`; `thiserror`.
- Web CSP stays `connect-src 'self'`; the relay is same-origin `/api/notes/` (WebSocket).
- The relay never sees plaintext or display names; unshared notebooks never contact the server.
- Write/Calc/Show stay single-writer; ADR 0007 untouched for Write.
- `/notes/` is deployed but not linked from the portal until the release.
- All UI text in catalogs, en + de in feature tasks (informal "du"), 22 other languages in P11-L1.
- No version bump until P11-R1.

## Review focus (failure modes no single feature test covers – each owned by a task below)
1. Two people type in the same paragraph at the same time, one goes offline for an hour and edits the same
   paragraph → both texts survive, no duplicate/lost characters, no dialog (N0 gate, N5 e2e "offline merge").
2. Two people move the same page into different sections at the same time → the page exists once (N1 tree test).
3. Browser storage cleared / private window → the user is warned before the only copy is gone; backup restores
   everything incl. images (N2 e2e "backup round trip").
4. A removed member keeps editing offline and reconnects → their new edits are rejected visibly on their device,
   never applied for others (N5 test "revoked device").
5. Large notebook (500 pages, 200 images, long history) → opening a page stays < 300 ms, search < 100 ms
   (N3 perf test, N5 lazy page sync).

## Block N – Notes app
| Task | Content | Model | Depends |
|---|---|---|---|
| **P11-N0** | Spike (throwaway, branch never merged): Tiptap 3 + `loro-prosemirror` on a Loro doc from the WASM build of `loro`; two browsers via a minimal relay forwarding XChaCha20-Poly1305 ciphertext; remote cursors (Loro `EphemeralStore`); IME; desktop variant (Rust Loro doc ↔ webview Loro doc over Tauri IPC) latency; go/no-go report with numbers | Opus | – |
| **P11-O1** | `fmt-onenote` crate: `.one` + `.onepkg` → intermediate `OneNotebook` tree using `onenote_parser` (MPL-2.0, unmodified dependency); wasm check; reader warnings; test corpus from public samples; `docs/onenote-subset.md`; licence entry in NOTICE / legal-notes | Opus | – (parallel to N0) |
| **P11-N0** result | **GO for Loro** (2026-11-13, `docs/notes-spike-report.md`): loro 1.17.1 + loro-prosemirror 0.4.4 unpatched on Tiptap 3.31.3; median 7.7 ms keystroke→remote; rules: no `trailingNode`, page genesis, hold remote updates during IME composition | – | – |
| **P11-N1** | `crates/model-notes` (notebook doc: movable tree of section groups/sections/pages + metadata; page doc: block content, canvas items, ink; blob refs; tags; schema version), `apps/notes/core` (`notes-core`: dispatch, storage abstraction with web IndexedDB and desktop folder backends behind a trait, search index, tags/tasks aggregation, history list/checkout/restore, backup archive), shells `src-wasm` + `src-tauri`, `docs/notes-format.md` | Opus | N0 go |
| **P11-N2** | `apps/notes` UI: Vite app with ui-shared ribbon (File/Home/Insert/Draw/View/Share), navigation pane (notebooks, coloured section tabs, page tree with drag & drop), Tiptap editor bound to the page Loro doc (text, headings, lists, checklists, links, code, dividers, block drag handles), backstage (new/open/recent/backup/options), autosave, shortcuts, en/de, e2e suite `notes.spec.ts`; route `/notes/` in the web build and deploy script (not in the portal) | Opus | N1 |
| **P11-N3** | Rich content: tables, images (paste/drop, resize), file attachments, tags UI + tasks view, `[[page links]]` + backlinks, search UI, page history UI (view/restore/who), print + PDF export; perf test (500 pages) | Opus | N2 |
| **P11-N4** | Canvas pages + ink: per-page canvas toggle, positioned boxes (text/image), pen/highlighter/eraser/lasso, pressure, stroke simplification, Draw tab | Opus | N2 (∥ N3 if disk allows) |
| **P11-N5a** | `crates/notes-sync` (crypto, per-device keys, member list, invite/admit/remove, envelopes) + `services/notes-relay` + protocol doc + deploy files – runs parallel to N1 (opaque payloads) | Opus | N0 go |
| **P11-N5b** | Collaboration in the app: `services/notes-relay` (axum WebSocket, encrypted log + blobs + snapshots, quotas, rate limits, signature check against the owner-signed member list), client sync (encryption, per-device keys, invite/admit/remove/rotate, co-owner, own devices), presence (people bar, remote cursors, last editor per block), offline queue, "Stop sharing"; ADR 0010 + README non-goal amendment + privacy-check/e2e request audit; nginx/systemd config files under `deploy/` (PM applies) | Opus | N3 |
| **P11-N6** | Import/export: Markdown, HTML, `.docx` (via `fmt-docx`/`model-text`) import + export; OneNote import UI on top of P11-O1 (`OneNotebook` → `model-notes`, canvas pages for ink-heavy pages, warnings dialog) | Opus | N3, O1 |
| **P11-N7** | Desktop: Tauri shell with folder notebooks (open/create folder, recent, file watcher not needed – sync via relay), relay URL setting (self-hosted), `release.yml`/signing/bundles include Notes, Downloads page entry, AI assistant panel (desktop only, like the other apps), portal tile + logo (hidden flag until R1) | Opus | N5, N6 |
| **P11-L1** | 22 more languages for the Notes catalog (from the glossaries), strict i18n gate green | Sonnet | N7 |
| **P11-X1** | Polish + e2e stability pass after an owner-style walkthrough (screenshots), compact layout sanity (no touch work – mobile later) | Opus | L1 |
| **P11-R1** | Release prep 3.14159: versions, notes, portal tile visible, CHANGELOG | Sonnet | X1 |

## Order
N0 ∥ O1 → N1 ∥ N5a → N2 → N3 ∥ N4 → N5 → N6 → N7 → L1 → X1 → R1 → owner checks (OneNote import with real notebooks,
two-person sharing test) → release.

## Parked for the owner (essential only)
_none yet_
