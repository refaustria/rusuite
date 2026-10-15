# Task P2-7 – shells: wire `calc_core::dispatch` + open/save into Tauri and WASM

Branch `p2/wiring`, worktree `/home/bojan/rusuite-wt/p2-wiring`. Scope: `apps/calc/src-tauri/**`, `apps/calc/src-wasm/**`, `apps/calc/core/src/**` (open/save additions only), `packages/ui-shared/src/backend.ts` + its test, `apps/calc/src/main.tsx` ONLY for backend construction (the grid task owns the rest of `apps/calc/src/**` in parallel – coordinate by touching nothing else there), `docs/adr/0002-ipc-strategy.md` (append the file-IO section). Read: ADR 0002 (incl. amendment), 0005; `apps/calc/core/src/lib.rs` (`dispatch`, `CalcHost`), `crates/fmt-xlsx/src/lib.rs` (`read_with_context`, `write_with_context`, `XlsxContext`), `apps/calc/src-tauri/src/lib.rs`, `apps/calc/src-wasm/src/lib.rs`, `packages/ui-shared/src/backend.ts`.

## calc-core additions
- `CalcDocument` gains `xlsx_context: Option<fmt_xlsx::XlsxContext>` and `source_name: Option<String>`; `CalcDocument::open_xlsx(bytes: &[u8], name: &str) -> Result<(Self, Vec<String> /*warnings*/), CalcError>` and `save_xlsx(&self) -> Result<Vec<u8>, CalcError>`.
- New `Request` variants: `OpenXlsx { bytes_base64: String, name: String }` → `ResponseBody::Opened { info: WorkbookInfo, warnings: Vec<String>, envelope }` (resets the host: `host.replace(doc)`, undo cleared, revision bumped); `SaveXlsx` → `ResponseBody::Saved { bytes_base64: String, suggested_name: String }` and marks saved; `MarkSaved`; `DocumentState` → `{ dirty, revision, name }`. Base64 keeps the JSON transport uniform across Tauri and wasm (binary-safe); add the `base64` crate (pinned) to calc-core. Regenerate the ts-rs types (run `cargo test -p calc-core`) and commit them.
- Tests: open `testdata/xlsx/provisional-basic.xlsx` via `dispatch` → info has sheets `Data`/`Summary`; `SetInput` then `SaveXlsx` → bytes re-open with the edit present; `DocumentState.dirty` toggles correctly around save.

## Tauri shell (`apps/calc/src-tauri`)
- App state: `Mutex<CalcHost>` managed by Tauri; `#[tauri::command] dispatch(request: String, state) -> String` calls `calc_core::dispatch`. Remove the placeholder.
- Native file commands (Tauri-only, not part of `dispatch`): `open_file_dialog() -> Option<{ path, name, bytes_base64 }>` and `save_file_dialog(suggested_name, bytes_base64) -> Option<path>` using `tauri-plugin-dialog` (blocking file picker in a spawned thread or the async API) and `std::fs` (no fs plugin needed when Rust reads the file itself). Register the plugin, add the capability permissions (`dialog:default`), pin the plugin version (≥ 2 weeks old). Window title shows `name – Rusuite Calc` with a `•` when dirty: command `set_title(title)`? – simpler: the frontend sets `getCurrentWindow().setTitle` via the Backend (Tauri only; web sets `document.title`).
- Unit test for `dispatch` through the Tauri state type (plain Rust test, no window).

## WASM shell (`apps/calc/src-wasm`)
- `thread_local! { static HOST: RefCell<CalcHost> }` created on first use with a `js_sys::Date::now()`-based clock installed via `engine_mut().set_now(..)` (Excel serial = days since 1899-12-30 incl. the local timezone offset – use `Date::new_0().get_timezone_offset()`); `#[wasm_bindgen] pub fn dispatch(request: &str) -> String`. Keep `ping`. Add `js-sys` (pinned). Remove the placeholder dispatcher. A `wasm-bindgen-test`? Not required; keep the host-side unit test that `dispatch("{\"type\":\"info\"}")` works.

## `Backend` (ui-shared)
```ts
export interface Backend {
  kind: 'tauri' | 'wasm';
  dispatch<T = unknown>(request: Request): Promise<Response<T>>;   // typed with the generated Request/Response types (import from the generated dir)
  openFile(): Promise<{ name: string; bytesBase64: string } | null>;   // Tauri: open_file_dialog; web: hidden <input type=file accept=.xlsx>, FileReader → base64
  saveFile(suggestedName: string, bytesBase64: string): Promise<boolean>; // Tauri: save_file_dialog; web: Blob + <a download> (File System Access API optional, ROADMAP)
  setTitle(title: string): Promise<void>;
}
```
Update `TauriBackend`/`WasmBackend` and tests (mock `@tauri-apps/api/core` and `@tauri-apps/api/window`; jsdom for the web file flows). `main.tsx`: construct the backend exactly as today, no UI changes.

## Acceptance
fmt/clippy/`cargo test --workspace`/rustdoc; `pnpm test`; `pnpm --filter calc build && pnpm --filter calc build:web`; `cargo check --target wasm32-unknown-unknown -p app-calc-wasm -p calc-core`; the generated TS is unchanged after `cargo test` (git status clean); `timeout 15 xvfb-run -a cargo run -q -p app-calc` after `pnpm --filter calc build` exits 124 without panic. In the report: the final `Request`/`Response` TS unions.
