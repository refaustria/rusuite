# Task P11-N5b – Notes: live sharing in the app (sync client, invites, presence, offline merge)

Read `docs/tasks/COMMON.md` (incl. "Cycle 3.14159"), the spec (section 4), **ADR 0010**, `docs/notes-sync-protocol.md`,
`crates/notes-sync` (API), `services/notes-relay` (endpoints, limits), `docs/notes-spike-report.md` (IME guard,
"container does not exist" pitfall, latency numbers), `docs/notes-format.md`, and the app: `apps/notes/src/**`
(editor mirror + core shipping, persistence, IME queue), `apps/notes/core`, `apps/notes/src-wasm`.

Branch `p11/n5b-notes-sharing`, worktree `/home/bojan/rusuite-wt/p11-n5b-notes-sharing`. Model: Opus. e2e port 5125,
relay for tests on 5126 (start `notes-relay` from your worktree build with a temp storage dir; stop by PID).

## Goal (the reason this app exists)
Two or more people work in the same notebook and see each other's edits instantly, see who is where, never get a
conflict dialog, and keep working offline with automatic merge. The server reads nothing.

## Architecture (PM decisions)
- `notes-sync` is compiled into `app-notes-wasm` (new exports: device keys create/load, envelope seal/open, member
  list ops, invite create/accept/admit, key wrap/unwrap, reencrypt). Device keys live in IndexedDB (`meta` store);
  on desktop later in the OS keyring (N7).
- **Sync engine in TS** (`apps/notes/src/sync/**`): one WebSocket per open shared notebook to the same-origin
  `/api/notes/ws` (relay URL configurable for desktop/self-hosting later; web = same origin only). Subscribes to the
  notebook doc and to page docs that are open, plus the rest lazily in the background (low priority) so search/
  tasks stay complete; tracks per-doc relay sequence markers in IndexedDB; outbox persisted in IndexedDB (offline
  queue) and flushed on reconnect with exponential backoff; on epoch change re-encrypts queued envelopes
  (`reencrypt`). Local updates come from the core's `PersistEffect`s (Append) – the same bytes go to the relay.
  Remote updates → `notes-core` `import_updates` → mirror (respect the IME queue; buffer presence until the doc it
  refers to has the container – the spike's "container does not exist" error must not appear).
- Periodic compaction: when a doc's relay log exceeds 500 envelopes, the client with the lowest device id among the
  online editors uploads a `Snapshot` envelope (full history – no shallow snapshots).
- Blobs (images/attachments) upload as `Blob` envelopes, fetched on demand when a page needs them.

## UI (en + de)
1. **Share tab** in the ribbon + "Share" button top right: dialog "Share notebook" – turn sharing on (creates the
   relay notebook with the owner member list), invite links for **Edit** and **Read only** (single use, 7 days, copy
   button, "Create another link"), members list with role, device count, online dot; owner/co-owner actions:
   change role, remove (with a clear explanation that the person keeps what they had), make co-owner; "Stop sharing"
   (deletes the server copy, everybody keeps local copies); a hint recommending a co-owner.
2. **Open an invite link** (`/notes/#i=…`): asks for the display name (first time), shows "Waiting for <owner> to
   let you in…" until an owner/co-owner device admits (owner side: toast "Anna wants to join – Admit / Decline", also
   in the Share dialog); then the notebook syncs and opens. "Add my other device" in the Share dialog creates a link
   for yourself (same flow; your other device appears grouped under your name).
3. **Presence**: people bar (avatars with initials + colour) in the title area; per page in the navigation, small
   dots for who is on that page; in the editor remote cursors + selections with name label (`loro-prosemirror`
   cursor plugin, encrypted presence envelopes, 10 Hz max); last editor per block on hover (subtle gutter colour +
   tooltip "Edited by Anna, 2 min ago" from the CRDT history/peer→device→member name).
4. **Status**: sync indicator (Synced / Syncing / Offline – changes will sync / Error with reason, e.g. quota,
   removed from notebook). Removed device: notebook turns read-only with a banner "You were removed from this
   notebook. Your copy stays on this device." – never applies further edits; its unsent edits are kept locally and can
   be copied out (review focus 4 visible side).
5. History panel (N3) shows display names now.

## Deploy (PM does it after merge; prepare only)
`deploy/notes-relay.service` and `deploy/nginx/notes-relay.conf` exist (N5a). Add to `scripts/deploy-web.sh`
nothing – the PM installs the relay manually; document the steps in `docs/setup.md` (Notes relay section).

## Tests
- Unit: sync engine state machine (subscribe, catch-up, outbox, reconnect, epoch change, compaction trigger).
- e2e with a real relay on 5126 and two/three browser contexts (`notes-sharing.spec.ts`):
  share → invite → admit → both edit the same paragraph concurrently → identical; remote cursor visible with name;
  latency keystroke → visible on the other context (report median/p95); one context offline (Playwright
  `context.setOffline(true)`) edits for a while + the other edits the same paragraph → reconnect → both identical,
  no lost characters, no dialog (**review focus 1**); concurrent move of the same page to different sections → one
  page (**review focus 2** in the UI); read-only member cannot type (editor not editable) and forged updates are
  rejected; remove a member → their next edit is rejected and their UI shows the banner, others never see it
  (**review focus 4**); late joiner gets full history; images sync; stop sharing; IME composition during a remote edit
  (German dead key simulation from the spike) → clean.
- Privacy: request audit – unshared notebook: zero requests to `/api/notes/`; shared: only `/api/notes/ws`; the
  relay storage dir contains no plaintext marker after the e2e run. Update `scripts/privacy-check.sh` allow-list for
  the one WebSocket.

## Verification
`pnpm typecheck`; `pnpm test`; `pnpm i18n:check`; `scripts/privacy-check.sh`; fmt/clippy/tests for Rust touched
(`app-notes-wasm`, maybe `notes-sync`/`notes-core`); wasm check; `pnpm --filter notes build:web`; full e2e (all
projects) with `BASE_URL=http://127.0.0.1:5125` + your own serve.mjs and relay – extend `serve.mjs` to proxy
`/api/notes/` to a relay port given in `NOTES_RELAY_PORT` (WebSocket upgrade) if needed; screenshots
`shots/P11-N5b-*.png` (share dialog, two windows with cursors, offline banner, removed banner).

## In scope
`apps/notes/src/**`, `apps/notes/src-wasm/**`, small changes in `apps/notes/core/**` / `crates/notes-sync/**` /
`services/notes-relay/**` (bug fixes or missing endpoints – explain), `packages/e2e/**` (sharing specs, serve.mjs
proxy, privacy audit), `scripts/privacy-check.sh`, `docs/setup.md`, `docs/ui.md`.

## Report (≤ 50 lines): what works, latency numbers, deviations, rough edges, deploy notes for the PM.
