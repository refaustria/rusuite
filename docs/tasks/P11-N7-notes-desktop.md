# Task P11-N7 – Notes desktop app (Tauri), logo, portal tile (hidden), release wiring

Read `docs/tasks/COMMON.md` (incl. "Cycle 3.14159"), the spec (desktop: notebook = folder; relay URL configurable;
AI assistant desktop only), ADR 0009/0010, `docs/notes-format.md` (folder layout, `FolderStore` feature `fs`),
`docs/setup.md` (Notes relay), how the other desktop shells work (`apps/write/src-tauri/**`: commands, capabilities,
CSP, keyring/secret commands, recent files, recovery, print/PDF, AI, connectors), `packages/ui-shared/src/backend.ts`,
`.github/workflows/release.yml` + `ci.yml` + `mobile.yml` (do **not** add Notes to mobile), `docs/signing.md`,
`scripts/gen-downloads.*`, `apps/portal/**` (logos, tiles), `docs/release.md`, `scripts/set-version.sh`/`check-versions.sh`.

Branch `p11/n7-notes-desktop`, worktree `/home/bojan/rusuite-wt/p11-n7-notes-desktop`. Model: Opus. e2e port 5117.

## Items
1. **Tauri shell `apps/notes/src-tauri` (`app-notes`)**: same structure/capabilities/CSP approach as Write's shell;
   `notes-core` with `fs` + `convert` features; commands for dispatch, binary update paths, blobs, import/export.
   Window title "Rusuite Notes", identifier `dev.rusuite.notes`, icons from the new logo.
2. **Folder notebooks**: File › New notebook asks for a folder (native dialog) or uses a default
   `~/Documents/Rusuite Notes/<name>`; Open notebook = pick a folder with `notebook.json`; recent notebooks (shared
   recent mechanism); crash safety per notes-format (append log, truncated record ignored). The web IndexedDB backend
   stays for the web; a `NotesBackend` Tauri implementation persists `PersistEffect`s through the shell into the
   folder. Backup export/import also available. Migration: "Import from browser backup (.rnotes)".
3. **Sharing on desktop**: relay URL setting (File › Options › Sharing): default `https://rusuit.es` (WebSocket
   `wss://rusuit.es/api/notes/ws`), or a self-hosted URL (validated, https only unless the user allows a LAN http
   URL – same rule as the WebDAV connector). The desktop CSP allows exactly the configured relay origin. Device keys in
   the OS keyring via the shells' existing secret commands (fallback: app-data file with a warning, as the AI key
   does). Invite links open in the desktop app if it registers the `rusuite-notes://` scheme? – no deep-link work in
   v1: the share dialog offers "Copy link" and the desktop app has "Join with link…" (paste) – PM decision.
4. **AI assistant** (desktop only, like the other apps): the existing ui-shared AI panel wired for Notes (summarise
   page, rewrite selection, extract tasks into a checklist, ask about the page); off by default; hidden on the web.
5. **Logo + portal tile**: Notes logo in the same style as the other three (`apps/portal/logos/`, SVG + PNG sizes for
   Tauri icons). Portal tile for Notes behind a flag that keeps it **hidden until P11-R1** (e.g. `data-release`
   attribute or a constant in `apps/portal/i18n.js`/`index.html` that R1 flips – document the switch in
   `docs/release.md`). Privacy page: Notes paragraph from ADR 0010 (en/de; other languages pending → L1).
6. **Release wiring** (no version bump, no tag): `release.yml` builds and signs Notes like the other desktop apps
   (Windows NSIS/MSI, macOS dmg, Linux deb/AppImage/rpm as the others), smoke job, `signing.json`/Downloads page
   include Notes (Downloads entry hidden until R1 together with the tile); `ci.yml` builds the Notes desktop shell
   check (`cargo check -p app-notes`) and the frontend tests; `check-versions.sh`/`set-version.sh` include the new
   package/Tauri config versions.
7. Linux local build: `pnpm --filter notes tauri build --no-bundle` succeeds; run under Xvfb for 20 s without panic
   (as the PM did for Calc).

## Tests
- Rust: shell command tests (folder create/open/persist/reopen, corrupted tail, backup import), CSP builder for the
  relay origin, relay URL validation.
- Vitest: Tauri backend adapter with a mocked `invoke`.
- e2e (web, port 5117): the portal tile is NOT visible yet; the AI/Join-with-link entries are hidden on the web; the
  full suite stays green.
- `docs/ui.md` Notes desktop section; `docs/setup.md` if build deps change.

## Verification
`pnpm typecheck`; `pnpm test`; `pnpm i18n:check`; `scripts/privacy-check.sh` (desktop relay client allowed only in
the Notes shell's configured origin); `cargo fmt --all --check`; clippy/tests per touched package; the local
`tauri build --no-bundle`; full e2e with `BASE_URL=http://127.0.0.1:5117` and your own serve.mjs. Do not run the
release workflow; you may push your branch to `origin` **only** if you need CI for macOS/Windows build checks of the
new shell (`git push -u origin p11/n7-notes-desktop`), never `main` or tags.

**Servers:** when you start a server in the background, record the PID of the actual process (`ss -ltnp | grep
:<port>`) and kill that PID; verify the port is free before reporting.

## In scope
`apps/notes/src-tauri/**` (new), `apps/notes/src/**` (backend adapter, options, AI wiring, join-with-link),
`apps/portal/**` (logo, hidden tile, privacy text), `.github/workflows/{release,ci}.yml`, `scripts/` (versions,
downloads, privacy-check), workspace `Cargo.toml`/lock, `pnpm` files, `docs/{ui,release,setup,signing}.md`.

## Report (≤ 50 lines): what works per OS (what you could only check in CI), binary size, deviations, rough edges.
