# Task P11-D1 – Desktop: open files from Finder/Explorer, drag & drop, recents (Calc, Write, Show; macOS first)

**Owner bug (2026-11-26, macOS Apple Silicon, installed 3.1415 builds):** `.xlsx` set to "always open with" Calc,
`.docx` with Write, `.pptx` with Show. Double-click in Finder → the app starts but shows an empty document, not the
file. Dragging a file onto the window (or the Dock icon) does not open it either. Only File › Open (path dialog)
works. The recent files list is not shown/empty.

Read `docs/tasks/COMMON.md`, `apps/{calc,write,show}/src-tauri/**` (lib.rs, tauri.conf.json, capabilities, the
mobile `take_launch_document` path), `packages/ui-shared/src/backend.ts` (`take_launch_document` is `null` on desktop
today), `packages/ui-shared/src/recent/**` (`TauriDocStorage`), each app's startup/open code, `docs/signing.md`,
`.github/workflows/release.yml` (bundle config), and Notes' shell (`apps/notes/src-tauri`) for consistency.

Branch `p11/d1-desktop-open-files`, worktree `/home/bojan/rusuite-wt/p11-d1-desktop-open-files`. Model: Opus.
**Do NOT spawn sub-agents.** e2e port 5151.

## Findings so far (PM)
- No `bundle.fileAssociations` in any `tauri.conf.json` → macOS Info.plist has no `CFBundleDocumentTypes`; Finder
  can still be forced to "open with", but the app must handle the open-documents Apple Event.
- No `RunEvent::Opened { urls }` handling (macOS delivers Finder opens as this event, not as argv) and no argv
  handling for Windows/Linux.
- No drag & drop handling of files from the OS (Tauri `DragDrop` window event / `onDragDropEvent`).
- Recents: find out why the list is empty/hidden on desktop (storage path, capability, or UI never fed by the desktop
  open path) – reproduce in a Linux build first.

## Items
1. **File associations** in the three `tauri.conf.json` (`bundle.fileAssociations`): Calc xlsx/xls?/ods/csv (only
   what the app can read), Write docx/odt/rtf?/txt?/md?, Show pptx/odp – check each app's readers; role Editor, rank
   Alternate (don't steal defaults) – the owner sets defaults in Finder themselves. Notes: `.rnotes` backup + `.one`/
   `.onepkg` → Import (rank Alternate).
2. **Launch / open events** (one shared implementation in a common crate if the shells share code, else the same
   code in each): macOS `RunEvent::Opened` (cold start: queue until the frontend is ready; warm: open in the running
   app – new window if the current document is not empty, else replace the untitled one, matching how File › Open
   behaves today); Windows/Linux argv on first start + `tauri-plugin-single-instance` forwarding the second launch's
   argv to the running instance (check licence MIT/Apache, workspace deps). Frontend: desktop `take_launch_document`
   returns the queued file(s), plus an event `open-document` for warm opens. Read access to that exact path must be
   granted the same way the File › Open dialog grants it (fs scope).
3. **Drag & drop** of files onto the window (and onto the Dock icon on macOS = `Opened`): supported extensions open;
   others show the existing "can't open" message. Keep in-document drops (images into Write/Show) working: OS file
   drops of images onto a document insert them where that already exists for web drops – don't break it.
4. **Recents**: every desktop open path (dialog, launch, drop, recent) records the file; the list shows on the
   backstage/start page; fix the root cause, test it.
5. Linux: verify end to end locally (`tauri build --no-bundle`, start under Xvfb with a file argument, check the
   document title/contents via the existing smoke hook `scripts/desktop-smoke.sh` – extend it with an "open with a
   file" check). macOS: the PM builds and tests on a Mac (Apple Silicon) after your report – write the exact build +
   manual test steps for the Mac into your report (`pnpm --filter <app> tauri build --bundles app` etc.), plus a
   minimal script that checks the built `.app`'s Info.plist contains the document types.

## Tests
Rust unit tests for the path/extension routing and the launch queue; Vitest for the frontend launch/open-document
handling with a mocked `invoke`/event; e2e (web) stays green (web has none of this – no regressions).

## Acceptance
`pnpm typecheck`; `pnpm test`; `pnpm i18n:check --strict` (new texts in all 24 languages, informal); clippy/tests/
`cargo check` for the 4 shells; `cargo fmt --all --check`; Linux build + Xvfb open-with-file smoke for Calc, Write,
Show; full e2e on 5151 (own serve.mjs, kill by real PID). Commit with the COMMON.md trailer. Don't push, merge or tag.

## Report (≤ 50 lines): root causes (open, drop, recents), what changed per app, Mac build/test steps, test results.
