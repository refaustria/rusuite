# Task P2-9 – wasm-safe default clock; `saveXlsx` must not mark the document saved

Branch `p2/wasm-clock`, worktree `/home/bojan/rusuite-wt/p2-wasm-clock`. Scope: `crates/engine-formula/src/{eval.rs,engine.rs,lib.rs}` (clock only), `apps/calc/src-wasm/src/lib.rs`, `apps/calc/core/src/dispatch.rs` (+ its tests, `tests/xlsx.rs`), `docs/adr/0002-ipc-strategy.md` (fix the file-IO paragraph). Nothing under `apps/calc/src/**` (grid agent is working there).

## Problem A – `system_now` traps on wasm32
`engine_formula::eval::system_now` uses `std::time::SystemTime`, which panics with `unreachable` on `wasm32-unknown-unknown`. `fmt_xlsx::read_*` recalculates while loading, before any shell could call `Engine::set_now`, so opening a workbook containing `NOW()`/`TODAY()` crashes the web build.
Fix: add a process-wide default clock to engine-formula:
```rust
pub fn set_default_clock(f: fn() -> f64);     // stores into a `static DEFAULT_CLOCK: AtomicPtr`/`OnceLock<RwLock<fn()->f64>>`-style cell (no new deps; `std::sync::atomic::AtomicPtr<()>` with a transmute is NOT acceptable – use `std::sync::RwLock<fn() -> f64>` in a `static` via `LazyLock`, MSRV 1.80 has `LazyLock`)
pub fn default_now() -> f64;                   // the installed clock, or the fallback
```
- `system_now` becomes the native fallback (`#[cfg(not(target_arch = "wasm32"))]`), and on wasm32 the fallback returns `0.0` (1899-12-30, never traps). `Engine::new`/`with_registry`/`EvalContext::new` use `default_now` (calling the current default at evaluation time, i.e. `now: default_now` as the fn pointer), so a clock installed later is picked up without `set_now`.
- `apps/calc/src-wasm`: install the `js_sys::Date`-based clock once via `#[wasm_bindgen(start)] fn init()` (and keep the per-request install only if still needed – remove it if not), and add a host-side unit test that `Engine::new()` after `set_default_clock(|| 45306.5)` evaluates `=TODAY()` to 45306.
- Test the crash is gone: `tests` in calc-core: build an xlsx with `=NOW()` via `save_xlsx`, re-open it via `open_xlsx` → no panic, value > 0 with the clock installed. (Cannot run wasm tests natively – reason about it, and additionally run `node` against the built wasm package as the wiring agent did: `pnpm --filter calc build:wasm`, then a small node script importing `apps/calc/src-wasm/pkg` with `--target web`? If the web target cannot be loaded in node easily, build once with `wasm-pack build apps/calc/src-wasm --target nodejs --out-dir /tmp/.../pkg-node` and drive `dispatch` with `openXlsx` of the NOW() file. Report the result.)

## Problem B – save marks clean before the file is written
`Request::SaveXlsx` currently calls `mark_saved`. Change: `SaveXlsx` returns the bytes WITHOUT marking; the frontend calls `MarkSaved` after a successful `saveFile`. Update the dispatch tests and the ADR 0002 file-IO paragraph accordingly. Also make `MarkSaved { name: Option<String> }` optional-name so a "save as" can rename the document (`source_name`), and return `documentState`.

## Acceptance
fmt/clippy/`cargo test --workspace`/rustdoc; `cargo check --target wasm32-unknown-unknown -p engine-formula -p calc-core -p app-calc-wasm`; generated TS unchanged or regenerated and committed (`cargo test -p calc-core`); `pnpm --filter calc build:web`; the node-driven wasm check opening a NOW() workbook succeeds.
