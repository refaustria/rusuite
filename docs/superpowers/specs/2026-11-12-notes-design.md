# Rusuite Notes – design

- Date: 2026-11-12
- Owner direction (2026-11-12): "Ich hätte gerne dass wir das OneNote nachbauen. Ähnliche Features wie das Original.
  Verbesserungen wo du sie sinnvoll findest, bzw. Features weglassen wenn sie nicht notwendig sind. Verbesserungen
  gewünscht, vor allem wenn an shared notes gearbeitet wird, soll es besser sein als das MS OneNote. Instant und
  sichtbar wer es bearbeitet, statt irgendwelche file refreshes die sporadisch oder nie funktionieren weil ständig
  Konflikte kommen. Integriere die App in unsere Suite wie bisher auch. Gleiches Look & Feel. Web app und dann sys
  apps. iOS und Android machen wir ein andermal."
- Status: owner answers incorporated 2026-11-12; awaiting final approval

## 1. Intent

A fourth Rusuite app, **Notes**, in the spirit of OneNote: notebooks → sections → pages, quick capture, search,
tags/to-dos, sketches. The reason it exists beyond "OneNote parity" is **shared notebooks that just work**: edits from
other people appear instantly, you see who is where and who is typing, and there are never sync conflicts or
"refresh/merge" dialogs. OneNote's file-based sync (sporadic, conflict pages) is the explicit anti-model.

Delivery order: web app (WASM, rusuit.es) first, then the desktop apps (Tauri, Windows/macOS/Linux). iOS/Android
later; the design must not block them (compact layout rules from `docs/mobile.md` apply from day one).

## 2. Goals, non-goals, anti-goals

### Goals (v1)
- **Structure:** notebooks; sections (coloured, groupable into section groups); pages with sub-pages; drag & drop
  reordering and moving of sections and pages, also across notebooks.
- **Page model = flowing block page** (owner choice B): text with formatting, headings, bullet/numbered lists,
  checklists, tables, images (paste/drop), file attachments, links, code blocks, dividers, block drag handles.
  Per page an optional **freeform canvas** mode (owner: "B als Standard, pro Seite freie Fläche zuschaltbar")
  for sketches/ink and freely placed boxes.
- **Ink / sketches** on canvas pages: pen, highlighter, eraser, lasso move; mouse and pen (pointer events, pressure).
- **Tags** (OneNote set: To-do, Important, Question, Idea, …; custom tags) and a cross-notebook **open tasks view**.
- **Instant full-text search** across all local notebooks while typing.
- **Page links** `[[Page]]` with backlinks ("linked from").
- **Page history:** view and restore any earlier version, with who changed what (from the CRDT history).
- **Live collaboration** on shared notebooks (section 4): sub-second propagation, presence (who is in the notebook,
  on which page), remote cursors/selections in each person's colour, last-editor per block, offline editing with
  conflict-free merge on reconnect.
- **Import:** OneNote `.one` (section file) and `.onepkg` (notebook package, CAB) – owner: "nimm das Format mit";
  also Markdown, `.docx` (via `fmt-docx`), HTML.
- **Export:** PDF (print pipeline), Markdown, `.docx` (via `fmt-docx` / `model-text`), printing.
- **Suite integration** exactly like Calc/Write/Show: shared ribbon (File backstage / Home / Insert / Draw / View …),
  `ui-shared` components, 24 EU languages with informal address, shortcuts, autosave/recovery, recent notebooks,
  "Report a problem", AI assistant (desktop only, as in the other apps), portal tile with logo, e2e suite, privacy
  audit.

### Non-goals (deliberately left out)
- Writing the OneNote format (`.one`/`.onepkg` export) – import only.
- Audio/video recording with timestamped notes; ink math recognition; OCR in images; Outlook integration; "dock to
  desktop"; page templates with ruled/grid paper (maybe later); embedded live Calc/Show objects (maybe later).
- User accounts, login, organisations, per-user ACLs (v1 uses capability links, section 4.3).
- Importing via the Microsoft Graph API / the user's Microsoft account (contradicts the privacy line).

### Anti-goals (would be a failure even if it technically works)
- Any conflict dialog, "conflicting changes" page, or manual refresh to see others' edits.
- The server being able to read note content.
- Typing latency noticeably worse than Write; losing offline edits.
- A look that doesn't feel like the rest of Rusuite.

## 3. Constraints
- ADR 0001 (Rust owns the document model), ADR 0003 (crate layout), ADR 0005 (same core as WASM), ADR 0009
  (documents never leave the device) – **0009 is amended by a new ADR** (section 4.5); the README non-goal
  "real-time co-authoring" is lifted **for Notes only** (Write/Calc/Show stay single-writer).
- Core crates stay `wasm32-unknown-unknown` compatible; no threads/fs/system clock in core.
- Strict web CSP: `connect-src 'self'` holds; the relay is same-origin (`wss://rusuit.es/api/notes/…`), like the
  report relay. Desktop apps add only the site origin (or a user-configured self-hosted relay origin).
- German and all languages informal (du/tu/tú …); strings in catalogs; strict i18n gate before release.
- Process: PM orchestrates agents, verifies each branch (typecheck, tests, i18n, privacy, web build, full e2e) before
  `--no-ff` merge; deploy web from main after verified merges; no version bump mid-cycle (`docs/versioning.md`).

## 4. Collaboration design

### 4.1 Approaches considered (owner picked 1 for transport, Loro for the CRDT)
Transport:
1. **End-to-end encrypted relay on rusuit.es** – server forwards and stores only ciphertext; instant; works on the
   web. **Chosen** ("Ja fürs erste schon").
2. Peer-to-peer WebRTC with signalling only – changes arrive only while peers are online together; rejected.
3. User's own cloud (WebDAV) + CRDT – conflict-free but polling, not instant, desktop-only under the CSP; rejected.

CRDT engine:
1. **Loro** (Rust, same crate compiled to WASM in the browser; movable tree, rich text, time travel,
   `loro-prosemirror` binding, ephemeral store for presence). **Chosen** ("Loro it is").
2. Yjs (browser) + yrs (Rust): most proven Tiptap path, but two implementations; history and tree moves self-built.
   **Fallback** if the spike (section 7, N0) fails.
3. Extending Write's single-writer protocol (ADR 0007): impossible with E2E encryption (server can't order/transform).

### 4.2 Data model (local-first)
- One **Loro document per notebook** (hierarchy, section/page metadata, tags index source) plus **one Loro document
  per page** (content). Splitting keeps loading/sync of big notebooks incremental. (Builder may adjust granularity
  after the spike, keep the property: open a page without downloading every page's history.)
- Hierarchy = Loro movable tree (concurrent moves never duplicate or lose a page).
- Page content = Loro rich text / map structure mirrored to ProseMirror (Tiptap) via `loro-prosemirror`; canvas pages
  = Loro list/map of positioned items and ink strokes (points quantised, simplified on stroke end).
- Binary attachments/images: content-addressed blobs (SHA-256), encrypted with the notebook key, stored and synced
  separately from the CRDT; the CRDT holds only references.
- Local storage (owner decided 2026-11-12): **desktop** – each notebook is a real folder on disk chosen by the user
  (snapshots + update logs + blobs; documented format, `docs/notes-format.md`), opened/recent like files in the other
  apps. **Web** – IndexedDB, plus backstage "Download backup" / "Open backup" (single-file archive of the same format)
  and a visible hint that browser storage can be cleared. Same-person multi-device sync = sharing with your own
  devices through the relay (4.3). A notebook that is never shared never talks to the server.
- Rust (`notes-core`) is the document of record: it owns the Loro docs, import/export, search index, tags/tasks
  aggregation, history queries. The editor binds to the same Loro doc in WASM. **Deviation from ADR 0007 to be
  recorded in the new ADR:** Notes does not use the command/patch mapper; edits flow as CRDT operations.
  On desktop the editor still needs a Loro doc in the webview (loro WASM) synced with the Rust side via updates over
  IPC – the spike must confirm this is cheap; otherwise desktop keeps the doc of record in the webview's WASM and Rust
  receives updates for persistence/search.
- Undo/redo: Loro `UndoManager` (local-user-only undo, never undoes others' edits).

### 4.3 Sharing, identity and membership (owner decided 2026-11-12: option b)
- No accounts. On first use each person enters a display name; **each device gets its own keypair** (Ed25519 for
  signing, X25519 for key exchange) stored locally, plus a colour.
- The creator of a notebook is its **owner**. The notebook carries a **member list signed by the owner**: device public
  keys, display names, role (owner / edit / read-only). Every CRDT update is signed by the author's device key; the
  relay accepts an update only if its key is an edit/owner member of the current list, and clients verify the same.
  "Who changed what" (history, last editor per block) is therefore tamper-proof.
- **Invite** = a link `https://rusuit.es/notes/#i=<invite>` carrying a one-time invitation secret in the fragment
  (never sent to the server) and the intended role. Opening it lets the invitee's device present its public key; the
  owner's device (or, if the owner allows it, any editor's device – builder's call, default owner only) admits it,
  adds it to the member list and wraps the current notebook key for that device. Exact handshake: builder, must keep
  the server blind.
- **Remove** a member (owner only): the owner rotates the notebook key, wraps the new key individually for each
  remaining member device, and publishes the new member list. The removed device never receives the new key; it
  keeps what it had already synced, but nothing newer. Only the owner sees member management; others see who is
  present.
- **Own devices:** the owner adds their other devices the same way ("share with myself" – invite link opened on the
  second device). Multiple devices of one person are grouped under one display name in the UI (builder detail).
- Owner transfer and "owner lost all devices" recovery: the owner may promote another member to co-owner (v1: at least
  offer co-owner role so a notebook is not orphaned).
- Presence/cursors travel as encrypted ephemeral messages (not stored).

### 4.4 Relay service
- New Rust service `services/notes-relay` (axum + tokio, alongside `report-relay`), nginx `location /api/notes/`
  with WebSocket upgrade; systemd unit; deployed by the PM.
- Per notebook: an append-only log of encrypted update blobs + encrypted blob store; clients periodically upload an
  encrypted compacted snapshot so the log can be truncated. Server stores only: notebook id, public signing key,
  ciphertext, sizes, timestamps. No names, no content, no IP logs beyond rate limiting.
- Limits: per-notebook storage quota, rate limits, deletion of notebooks inactive for N months (values: builder,
  documented). "Stop sharing" deletes the server copy.
- Self-hostable: same binary, the app accepts a custom relay URL (desktop; web only same-origin).
- Encryption: XChaCha20-Poly1305 (or AES-GCM via WebCrypto) per message with the notebook key; library choice
  builder's, must work identically in WASM and native.

### 4.5 Privacy ADR
New ADR 0010 "Shared notebooks via an end-to-end encrypted relay" amending ADR 0009 for Notes: unshared notebooks stay
fully on the device; shared notebooks leave the device **only as ciphertext**; the server cannot read content or
names; the e2e request audit is extended (no traffic for unshared notebooks; only `/api/notes/` for shared ones);
`scripts/privacy-check.sh` gets the relay client in its allow-list. README non-goal amended ("real-time co-authoring
– except Notes' shared notebooks").

## 5. OneNote import (`fmt-onenote`)
- Read-only crate implementing MS-ONESTORE (revision store) + MS-ONE (OneNote object model) for `.one`, and CAB
  extraction for `.onepkg`. Pure Rust, wasm-compatible (the import runs in the browser too).
- Mapping: section → section, page/sub-page levels → pages, outlines → blocks (text runs/formatting, lists, tables,
  images, attachments, tags, links). Absolutely positioned outlines: flowing page in reading order by default; pages
  with ink or heavy free positioning import as canvas pages. Unsupported elements produce reader warnings (shown as in
  the other apps), never a failed import.
- Test corpus: the owner tests with their own notebooks **when the app is done** (owner 2026-11-12: files are on
  another machine). Build and test against publicly available samples and files constructed per the spec (e.g. from open-source parsers'
  test suites, licence permitting). Prior art to consult: the open-source `onenote.rs` parser (MPL-2.0) – reuse only
  if the licence fits (MIT project; MPL file-level copyleft must be checked by the builder/PM, `docs/legal-notes.md`).
- Old OneNote 2007 format and password-protected sections: out of scope (warning).

## 6. App architecture
```
apps/notes/src (TS, Tiptap + loro-prosemirror, canvas/ink layer) ──► packages/ui-shared (ribbon, backstage, i18n…)
        │  dispatch JSON  +  Loro updates
app-notes (Tauri) | app-notes-wasm
        │
notes-core ──► model-notes (Loro docs, schema, search index, tags) ──► core-model
        │  ├─► fmt-onenote (import)   ├─► fmt-docx / model-text (docx import/export)
        └─► app-common
apps/notes/src/sync ──► relay client (WebSocket, encryption, presence) ── wss ──► services/notes-relay
```
- Ribbon tabs (proposal): File · Home (clipboard, font, paragraph, styles, tags) · Insert (table, image, file, link,
  page link, code, divider, date) · Draw (pens, highlighter, eraser, lasso, canvas toggle) · View (page width,
  zoom, navigation pane, dark mode) · Share (share links, members/presence, history).
- Navigation pane: notebooks / sections (tabs, colours) / pages tree; search box on top; tasks view entry.
- Portal: new tile + logo in the same style; route `/notes/`.

## 7. Build order (for the plan)
- **N0 spike (throwaway):** two browsers, Tiptap + loro-prosemirror, encrypted updates via a minimal relay, remote
  cursors; desktop IPC variant measured. Gate: typing latency, convergence, IME, presence. Fail → switch to Yjs/yrs.
- N1 `model-notes` + `notes-core` (hierarchy, pages, storage, search, tags, history) + wasm/tauri shells.
- N2 Notes web UI (ribbon, navigation, editor blocks, tables, images, attachments, tasks view, page links).
- N3 canvas pages + ink.
- N4 relay service + sharing (links, encryption, signing, presence, offline merge, reset links) + ADR 0010 + privacy
  e2e.
- N5 import/export (Markdown, HTML, docx, PDF/print) — N6 `fmt-onenote` (can run in parallel from N1 on).
- N7 desktop apps (Tauri bundles, signing wiring as for the other apps), i18n 24 languages, strict gate, polish,
  live deploy.

## 8. Decided by the owner
- Build a OneNote-like app integrated into the suite, same look & feel, web first then desktop; mobile later.
- Shared notebooks via an end-to-end encrypted relay on rusuit.es ("fürs erste").
- Flowing block pages, optional freeform canvas per page.
- Include OneNote format import.
- CRDT: Loro.
- Membership with per-device keys, owner role, owner-only removal with key rotation (4.3).
- Notebook storage: folder on desktop, IndexedDB + backup file on the web; own devices via sharing with yourself.
- OneNote import is tested by the owner with real notebooks at the end; `fmt-onenote` is planned as best effort
  against public/constructed samples and must not block the rest of the release.

## 9. PM calls (owner may veto)
- Import only for `.one`/`.onepkg`; no export to OneNote format.
- Feature list in section 2 (including what's left out); tags + cross-notebook tasks view, page links/backlinks and
  page history as improvements over OneNote.
- One Loro doc per notebook + one per page; relay as a Rust service next to `report-relay`, self-hostable.
- App name "Rusuite Notes", route `/notes/`.
- **Rollout:** Notes belongs to the next cycle (3.14159). Until the cycle's release it is deployed to rusuit.es under
  `/notes/` but **not linked from the portal** (preview); the portal tile appears with the release. The public relay
  goes live only after the owner approved this document (which includes ADR 0010's content, section 4.5).
- **History retention:** full history is kept (notes are small; ink strokes are simplified/quantised). The relay's
  compacted snapshots keep the history (no shallow snapshots), bounded by the per-notebook quota; when a notebook
  nears its quota the owner of the notebook is offered "Clean up history older than …" (explicit, never automatic).

## 10. Left to the builder
Exact Loro schema, encryption library, compaction policy and quotas, re-keying procedure details, search index
implementation, ink smoothing, ribbon details per tab, OneNote element coverage beyond the list above (documented in a
`docs/onenote-subset.md` like `ooxml-subset.md`).
