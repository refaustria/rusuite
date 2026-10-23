# ADR 0005 – Web target: same Rust core compiled to WebAssembly; one core crate and two shells per app

- Status: accepted (owner decision 2026-10-15)
- Date: 2026-10-15

## Context
The owner extended the scope: Rusuite must also run as a **web app**, in addition to the Tauri desktop apps in the README. The README principles still apply: Rust is the source of truth (ADR 0001), commands in / patches out (ADR 0002). Options were a server-side Rust backend (axum, sessions, upload/download, eventually auth and storage) or compiling the same crates to WebAssembly and running them in the browser.

## Decision
1. **WASM in the browser.** All domain crates (`core-model`, `engine-formula`, `model-*`, `fmt-*`, `app-common`) must compile for `wasm32-unknown-unknown`. No server-side document state; the web server only serves static files. Files are opened/saved through the browser (file input / download, File System Access API where available).
2. **One core crate per app, two thin shells.** Each app gets a transport-agnostic crate `apps/<app>/core` (`calc-core`, later `write-core`, `show-core`) that owns the document (`model-*` + `app-common` host: undo/redo, revision, dirty flag), defines the app's `Command`/`Patch`/snapshot types, and exposes `open_bytes`/`save_bytes`. `apps/<app>/src-tauri` wraps it in Tauri commands (plus native dialogs/fs); `apps/<app>/src-wasm` wraps it with `wasm-bindgen`. Shells contain no document logic.
3. **One wire format for both transports.** Commands and patches cross both boundaries as `serde_json` text (`dispatch(command_json) -> patch_json`). TypeScript types are generated from the Rust types with `ts-rs` into `apps/<app>/src/generated/` and `packages/ui-shared/src/generated/` (never hand-written).
4. **Frontend `Backend` abstraction** in `packages/ui-shared/src/backend.ts`: `interface Backend { dispatch(cmd): Promise<Patch>; … }` with `TauriBackend` and `WasmBackend`, chosen at startup by detecting the Tauri runtime. UI code never imports `@tauri-apps/api` directly.
5. **Build & deploy.** Vite builds two targets per app: the Tauri `dist/` and a web `dist-web/` that bundles the `wasm-pack --target web` package. The web builds are deployed from `main` to `https://rusuit.es/{calc,write,show}/` by `scripts/deploy-web.sh` (nginx vhost, static files, TLS via certbot). *History: the site first lived at resuite.inceptum.at, which now redirects to rusuit.es (P8-49).*

## Consequences
- No `std::fs`, threads or system clock in core crates (the engine's clock is already injectable; the wasm shell supplies `js_sys::Date`). CI adds a `cargo check --target wasm32-unknown-unknown` for the core crates.
- Repository structure gains `apps/<app>/core` and `apps/<app>/src-wasm` (README updated).
- Browser constraints: single-threaded, memory-limited; large workbooks are bounded by wasm memory (document in Phase 5 performance work).
- Tauri-only features (native file dialogs, menus) live in the Tauri shell; the web shell provides browser equivalents or omits them.

## Alternatives rejected
- Rust web server with HTTP/WebSocket transport: requires sessions, storage and auth; a second runtime to operate; scope creep relative to a single-user office suite.
- Rewriting the core in TypeScript for the web: duplicates the engine and formats, contradicts ADR 0001.

## Amendment 2026-10-22 – mobile apps are a third shell on the same `Backend` (P10-M1)
- **Same Tauri shell, mobile build.** Android and iOS run the existing `apps/<app>/src-tauri` crates (`tauri android|ios
  build`, projects committed in `gen/android` and `gen/apple`), i.e. the native Rust core as on the desktop – not
  WASM. The frontend is the desktop bundle (`dist/`), unchanged.
- **One `Backend`, a mobile mode.** `TauriBackend` detects a mobile shell (`isMobile()`: the page marker
  `window.__RUSUITE_MOBILE__` set by `tauri-plugin-rusuite-mobile`) and swaps the native file dialogs for the
  platform document pickers: `open_document`, `save_document` (write back to the picked document, otherwise the
  system "save to" picker), `share_document`, `take_launch_document` ("Open with"). The shells keep the binding
  (`DocPath`) with an opaque handle (Android content URI, iOS bookmark) instead of a path, so the core and the
  dispatcher are untouched.
- **Capabilities instead of platform checks in app code.** `Backend.capabilities` (`print`, `saveAs`, `share`) tells
  the UI what to offer; mobile has no print until P10-M6 (`print()` rejects with `UnsupportedError`).
- **Desktop-only features stay desktop-only.** Connections and the AI assistant are absent on mobile (owner rule):
  `TauriBackend` creates neither, and the shells drop the connector commands and the OS keyring
  (`app-common/tauri-connectors` is a desktop-only dependency).
- Native code is limited to one project-local plugin (`crates/tauri-plugin-rusuite-mobile`, Kotlin + Swift) for what
  Tauri's dialog plugin cannot do (persistable write access, export pickers, share sheet, launch intents).
  Details: [docs/mobile.md](../mobile.md).
