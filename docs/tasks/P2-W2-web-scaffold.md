# Task P2-W2 – web (WASM) scaffold for Calc + `Backend` abstraction

Branch `p2/web-scaffold`, worktree `/home/bojan/rusuite-wt/p2-web-scaffold`. Scope: `apps/calc/src-wasm/**` (new crate `app-calc-wasm`, workspace member), `apps/calc/{package.json,vite.config.ts,index.html,src/App.tsx,src/App.test.tsx,src/main.tsx}`, `packages/ui-shared/{package.json,src/backend.ts,src/backend.test.ts,src/index.ts}`, root `Cargo.toml` (member), `.gitignore`, `.github/workflows/ci.yml`, `docs/setup.md`. Not: `apps/calc/core` (parallel task), `crates/`.

Read first: ADR 0005, `apps/calc/src-tauri/src/lib.rs`, `apps/calc/vite.config.ts`, `apps/calc/package.json`, `packages/ui-shared/*`.

## Goal
`pnpm --filter calc build:web` produces `apps/calc/dist-web/` – a static site (base path `/calc/`) that loads the Rust core as WebAssembly and shows the same placeholder page as the Tauri app, calling `ping` through a `Backend` abstraction; `pnpm --filter calc dev:web` serves it locally. The Tauri build keeps working unchanged.

## Steps
1. Toolchain: `rustup target add wasm32-unknown-unknown`; install `wasm-pack` (`cargo install wasm-pack --locked`, or the npm `wasm-pack` package as a devDependency – prefer the npm package so CI gets it via `pnpm install`; pin the version ≥ 2 weeks old). Document in `docs/setup.md`.
2. Crate `apps/calc/src-wasm` (package `app-calc-wasm`, `crate-type = ["cdylib", "rlib"]`, deps `wasm-bindgen` (pinned), `serde`, `serde_json`; `[lints] workspace = true`; `#![forbid(unsafe_code)]`). Exports: `#[wasm_bindgen] pub fn ping() -> String` (same text as the Tauri `ping`) and `#[wasm_bindgen] pub fn dispatch(request_json: &str) -> String` that for now returns `{"ok":{"pong":"…"}}` for `{"type":"ping"}` and `{"err":{"code":"unknown_request","message":…}}` otherwise – the real dispatcher (calc-core) is plugged in by the wiring task. The crate must also build on the host (`cargo clippy --workspace --all-targets` compiles it natively) – wasm-bindgen supports that.
3. `packages/ui-shared/src/backend.ts`:
   ```ts
   export interface Backend { readonly kind: 'tauri' | 'wasm'; ping(): Promise<string>; dispatch<T = unknown>(request: unknown): Promise<T>; }
   export class TauriBackend implements Backend { … invoke('ping'), invoke('dispatch', { request: JSON.stringify(request) }) … }
   export class WasmBackend implements Backend { constructor(module: { ping(): string; dispatch(json: string): string }) … }
   export function isTauri(): boolean  // '__TAURI_INTERNALS__' in window
   export async function createBackend(loadWasm: () => Promise<WasmModule>): Promise<Backend>
   ```
   `ui-shared` depends on `@tauri-apps/api` (pinned like the app). Unit tests (vitest): `isTauri` detection, `WasmBackend.dispatch` JSON roundtrip with a fake module, `TauriBackend` with `vi.mock('@tauri-apps/api/core')`. Also add the Tauri `dispatch` command (`#[tauri::command] fn dispatch(request: String) -> String`) to `apps/calc/src-tauri/src/lib.rs` with the same placeholder behaviour – this is the only edit allowed in `src-tauri`.
4. Vite: `vite.config.ts` reads `mode === 'web'` → `base: '/calc/'`, `build.outDir: 'dist-web'`, and the app imports the wasm package from `./src-wasm/pkg/` (gitignored, produced by `wasm-pack build src-wasm --target web --release --out-dir pkg`) via a dynamic `import()` only in web mode (`import.meta.env.MODE === 'web'`), so the Tauri bundle never includes wasm. Scripts in `apps/calc/package.json`: `build:wasm`, `build:web` (= build:wasm + `vite build --mode web`), `dev:web` (= build:wasm + `vite --mode web`). `App.tsx` shows `backend.kind` next to the ping result.
5. CI: in the `frontend` job add `rustup target add wasm32-unknown-unknown` (use `dtolnay/rust-toolchain@stable` with `targets: wasm32-unknown-unknown`) and `pnpm --filter calc build:web`. In the `rust` job add `cargo check --target wasm32-unknown-unknown -p core-model -p engine-formula -p model-sheet -p fmt-ooxml -p app-common` (install the target in that job too) – fix nothing in crates/; if a crate fails the wasm check, report it (expected to pass).
6. `.gitignore`: `apps/*/src-wasm/pkg/`, `apps/*/dist-web/`.

## Acceptance
```
pnpm install && pnpm test                                   # ui-shared backend tests + calc test
pnpm --filter calc build && pnpm --filter calc build:web   # both targets
ls apps/calc/dist-web/assets/*.wasm                         # wasm present
cargo fmt --all --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace
cargo check --target wasm32-unknown-unknown -p core-model -p engine-formula -p model-sheet -p fmt-ooxml -p app-common -p app-calc-wasm
```
Then a smoke test in a real browser engine: `npx --yes playwright@1.47.0 install chromium` is NOT wanted (keep it light) – instead serve `dist-web` with `python3 -m http.server` under `/calc/` (e.g. a temp dir with `calc/ -> dist-web`), fetch `/calc/index.html` and the `.wasm` with curl and check HTTP 200 and `Content-Type` sanity. Report sizes of the `.wasm` (release) and JS bundle.
