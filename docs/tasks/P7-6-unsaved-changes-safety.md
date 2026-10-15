# Task P7-6 – Unsaved-changes safety across the apps (Office behaviour)

Branch `p7/unsaved-safety`, worktree `/home/bojan/rusuite-wt/p7-unsaved-safety`. Scope: `packages/ui-shared/src/{Dialog.tsx,recent/*,shortcuts/*}` + a new `ConfirmDiscard` dialog, `apps/*/src/**` (File actions: New, Open, Recent, Restore recovery, window/tab close), `apps/*/src-tauri/src/lib.rs` (close-requested handling), `packages/e2e/tests/*`, `docs/ui.md`. Up to 3 commits.
1. **One shared flow**: `ensureSaved(backend, docState) -> 'proceed' | 'cancel'`: if dirty, show a three-button dialog "Save changes to <name>?" (Save / Don't save / Cancel) like Office; Save runs the app's save flow (Save As when untitled) and proceeds only if the write succeeded. Used by New (replaces `window.confirm`), Open, Recent entries, Restore (recovery banner), and backstage Close.
2. **Window close**: web: `beforeunload` prompt while dirty (browser-native); Tauri: intercept `onCloseRequested`, run the same dialog (prevent default, close after the choice) – needs the `core:window:allow-close` permission; test the Rust side with a unit test of the state flag and the TS side with a fake backend.
3. **Recovery entries age limit** (7 days) and a "Discard all" in the banner when several exist.
4. **Autosave status**: status bar shows "Autosaved HH:MM" after each autosave.
Tests: ≥ 15 unit tests (dialog, ensureSaved outcomes incl. cancelled Save As, each entry point) + 3 e2e (New on dirty shows the dialog and Cancel keeps the doc; Don't save proceeds; Open on dirty then Save proceeds with a download).
