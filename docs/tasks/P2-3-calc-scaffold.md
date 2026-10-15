# Task P2-3 – Tauri 2 scaffold for Rusuite Calc

Branch `p2/calc-scaffold`, worktree `/home/bojan/rusuite-wt/p2-calc-scaffold`. Scope: `apps/calc/**`, `Cargo.toml` (add workspace member `apps/calc/src-tauri`), `.gitignore` (tauri `gen/` dirs), `.github/workflows/ci.yml` (Tauri system deps + build the app), `docs/setup.md` (append what you installed), `package.json`/`pnpm-workspace.yaml` only if required. Nothing under `crates/`.

## Goal
`pnpm --filter calc tauri dev` opens a window titled "Rusuite Calc" showing a placeholder page that calls one Tauri command; `cargo build -p app-calc`, `pnpm --filter calc build`, `pnpm test`, clippy for the whole workspace, and CI all pass. This is scaffolding only – no grid, no document logic.

## Stack (from README, pinned exact versions ≥ 2 weeks old)
Tauri 2 (`tauri`, `tauri-build`, `tauri-plugin-dialog` and `tauri-plugin-fs` NOT yet – ROADMAP), `@tauri-apps/api` 2, `@tauri-apps/cli` 2 (dev dep, prebuilt binaries – do not `cargo install tauri-cli`), Vite 6, React 18, TypeScript 5, Tailwind 4 via `@tailwindcss/vite`, Vitest + `@testing-library/react` for one component test. Playwright is NOT installed in this task.

## Layout
```
apps/calc/
  package.json            # "name": "calc", scripts: dev, build, preview, test (vitest run), tauri
  index.html, vite.config.ts (tauri-recommended: clearScreen false, server.port 1420, strictPort, envPrefix TAURI_), tsconfig.json (strict), src/main.tsx, src/App.tsx, src/App.test.tsx, src/styles.css (tailwind import)
  src-tauri/
    Cargo.toml            # package "app-calc", workspace = true for version/edition/lints; deps tauri 2 (features: none beyond default), serde, serde_json; build-dep tauri-build
    build.rs, tauri.conf.json (productName "Rusuite Calc", identifier "dev.rusuite.calc", window 1200x800 min 800x600, frontendDist "../dist", devUrl http://localhost:1420, beforeDevCommand / beforeBuildCommand via pnpm), capabilities/default.json (core:default only), icons/ (generate with `pnpm --filter calc tauri icon <png>` from a 1024×1024 PNG you create with ImageMagick: dark-blue rounded square with a white "C"; commit the generated icons), src/main.rs (`app_calc_lib::run()`), src/lib.rs (tauri::Builder with one command `ping() -> String` returning `format!("Rusuite Calc {}", env!("CARGO_PKG_VERSION"))`).
```
- `App.tsx`: heading "Rusuite Calc", a button that invokes `ping` and shows the result; `App.test.tsx` renders it with `@tauri-apps/api/core` `invoke` mocked (vitest `vi.mock`) and asserts the heading.
- `#![forbid(unsafe_code)]` in the Rust crate; `[lints] workspace = true`. The crate must pass `cargo clippy --workspace --all-targets -- -D warnings` (Tauri's generated code is fine with that; if a lint triggers in `main.rs`'s windows subsystem attribute, keep the standard Tauri template line `#![cgf_attr(...)]` as the template ships it).

## CI
- `rust` job: add an `apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev patchelf` step (Ubuntu) before the cargo steps; `cargo build -p app-calc` is covered by `cargo clippy --workspace --all-targets`.
- `frontend` job: add `pnpm --filter calc build` after `pnpm test`.

## Acceptance (worktree root)
```
pnpm install && pnpm test                       # calc test + ui-shared test pass
pnpm --filter calc build                        # vite production build → apps/calc/dist
cargo fmt --all --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace
pnpm --filter calc tauri build --no-bundle      # release binary; may take several minutes – run it once
sudo apt-get install -y xvfb   (if missing; document it)
timeout 15 xvfb-run -a target/release/app-calc; echo "exit=$?"   # expect 124 (killed by timeout) and no panic/backtrace on stderr
```
Report the binary size and the time `tauri build` took. Commit `pnpm-lock.yaml` changes. Do not commit `apps/calc/dist` or `src-tauri/gen`.
