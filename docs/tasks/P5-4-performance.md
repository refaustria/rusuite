# Task P5-4 – Performance targets: 1M cells, 200-page document, 100 slides

Branch `p5/perf`, worktree `/home/bojan/rusuite-wt/p5-perf`. Scope: `crates/engine-formula/benches/**`, `crates/model-sheet/benches/**`, `apps/*/core/benches/**` (criterion is NOT wanted – use `#[bench]`-free plain `examples/bench_*.rs` binaries printing timings, plus `cargo test --release -- --ignored` perf tests with generous asserts), `scripts/perf.sh` (runs them all and writes `docs/perf.md`), targeted fixes in the crates/apps the measurements point at (list every file in the report), `docs/perf.md`. README Phase 5: "Performance: 1M cells, 200-page document, 100 slides".

## Measure first (release builds; report numbers in `docs/perf.md` with machine info)
1. Calc core: build a 1000×1000 sheet (1M cells: 70 % numbers, 20 % text, 10 % formulas `=A1*2`/`SUM` over small ranges) through `Engine::set_input` inside `begin_batch/end_batch`; measure load time, `recalc_all`, a single edit at the head of a 10k-cell dependency chain, `RegionSnapshot` of a 64×32 block, `save_xlsx` and `open_xlsx` of the result, peak RSS (`/proc/self/status` VmHWM). Also the wasm build: `node` script driving the nodejs wasm package with the same workbook – record memory via `WebAssembly.Memory` growth and whether the 4 GB limit is approached.
2. Write core: a 200-page document (~100k words, 4000 paragraphs with mixed runs, 20 tables, 20 images): `Load`, `InsertText` in the middle, `FindReplace` all, `save_docx`/`open_docx`, `GetDocument` JSON size and serialisation time; frontend: time for `toPM` of that document and first render (headless Chromium, `performance.now()` around editor mount; measure typing latency = time from keydown to patch applied, p50/p95 over 200 keystrokes).
3. Show core: 100 slides × 20 shapes with text: `Load`, `getPresentation` size, `SetTransform`, `DuplicateSlide`, `save_pptx`/`open_pptx`; frontend: sidebar thumbnail render time, slide switch time, presenter paging.
Targets (MVP acceptance; record actual): Calc load 1M cells < 10 s native / < 30 s wasm, edit at chain head < 100 ms, snapshot block < 5 ms, RSS < 1.5 GB; Write load + first render < 3 s, typing p95 < 30 ms, save < 2 s; Show load < 2 s, slide switch < 50 ms, save < 2 s.

## Fix the worst offenders (only what the measurements justify; separate commits per fix, each with its before/after numbers)
Likely candidates (verify, do not assume): `Workbook::used_range` scanning styled cells per call (cache it), `cells_in` scanning the whole area, per-keystroke whole-table replace in Write tables, `GetDocument` with inline media (add `includeMedia:false`), `Recalc.changed` sorting, Konva thumbnail re-renders, `RegionSnapshot` building `CellView.display` via number formatting for every cell.

## Acceptance
All existing tests green; `scripts/perf.sh` runs end-to-end on this server and `docs/perf.md` contains the tables; targets met or the shortfall explained with a proposed follow-up in the report.
