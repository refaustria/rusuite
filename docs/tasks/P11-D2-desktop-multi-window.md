# Task P11-D2 – Desktop: one window per document (Calc, Write, Show; macOS first)

**Owner request (2026-11-26):** like Office, every opened file gets its own window. Today each shell holds exactly
one document per process (one `SessionState`/core/doc path/undo/close guard), so a second open replaces the first
(P11-D1 behaviour).

Read `docs/tasks/COMMON.md`, `docs/tasks/P11-D1-desktop-open-files.md` + the merged D1 code
(`crates/app-common/src/launch.rs`, `apps/{calc,write,show}/src-tauri/src/{lib,launch}.rs`, capabilities,
`tauri.*.conf.json`), `packages/ui-shared/src/backend.ts`, `DocumentSession` (launch open, close guard, recents),
the native menus, recovery/autosave, print/PDF, AI panel, connectors code in the shells, `scripts/desktop-smoke.sh`.

Branch `p11/d2-desktop-multi-window`, worktree `/home/bojan/rusuite-wt/p11-d2-desktop-multi-window`. Model: Opus.
**Do NOT spawn sub-agents.** e2e port 5152.

## Behaviour (PM decisions, Office/macOS conventions)
1. **Per-window document state** in the shells: everything that is per document today (core/doc, path binding,
   dirty flag, undo, recovery/autosave file, close guard, print job, fs scope grant) is keyed by the window label.
   Shared across windows: settings, recents, AI key/config, connectors, single-instance.
2. **Opening** (dialog, Finder/Explorer, drop on window or Dock, recent, second launch): if the focused window holds an
   untitled, unmodified, empty document → open there; else create a new window (cascade offset 24 px from the
   focused one, same size). Several files at once → one window each. A file already open in a window → focus that
   window (no second copy).
3. **File › New** (Cmd/Ctrl+N) opens a new window. **Close window** (Cmd/Ctrl+W) closes only that window with its
   own unsaved-changes question. Quit (Cmd+Q / last window on Windows/Linux) asks per dirty window (macOS: like
   Pages – one question per dirty document, in turn).
4. **macOS:** the app keeps running when the last window closes (menu bar stays; Dock click or File › New opens a new
   untitled window – `RunEvent::Reopen`); a **Window** menu lists open documents (with the standard Minimize/Zoom/
   Bring All to Front). Window title = file name (+ "Edited" marker as the app does today); `set_represented_filename`
   / proxy icon if Tauri exposes it cheaply, else skip and say so.
5. **Windows/Linux:** closing the last window quits the app (as today). Taskbar shows one entry per window.
6. Notes stays single-window (out of scope; don't break it).

## Tests
Rust unit tests for the window registry (route an open: reuse empty / new window / focus existing; close; last
window rules per OS). Vitest for the frontend's per-window session wiring with a mocked `invoke` (window label).
Extend `scripts/desktop-smoke.sh` (Linux, Xvfb): open two files → two windows with the right titles; second
open of the same file focuses; close one window → the other stays and keeps its document; dirty-window close guard.

## Acceptance
`pnpm typecheck`; `pnpm test`; `pnpm i18n:check --strict` (new texts in all 24 languages, informal); clippy/tests/
`cargo check` for the 4 shells + app-common; `cargo fmt --all --check`; Linux `tauri build --no-bundle` + extended
smoke for Calc, Write, Show; full WebDriver smoke still green; full e2e on 5152 (own serve.mjs, kill by real PID).
Commit with the COMMON.md trailer. Don't push, merge or tag. The PM then builds and tests on the Mac Studio.

## Report (≤ 50 lines): design (state keying, window registry), what changed per app, what you could not do in Tauri,
Mac manual test steps (two files, same file twice, close/quit with dirty windows, Dock reopen, Window menu), results.
