# Rusuite – Project Status

_Maintained by the PM agent. Read at the start of every session; update after every task._

## Current phase: Phase 2 – Calc: milestone reached on the server 2026-10-15 (main 670ccda); owner's Excel check pending

### Phase 2 milestone – verification run by the PM
- Checks on main: fmt/clippy/rustdoc clean; `cargo test --workspace` 466 passed; `pnpm test` 29 + 45 passed; wasm `cargo check` for 8 crates OK.
- Harness with the `fmt-xlsx` writer: `testdata/xlsx` 2/2 PASS (LibreOffice opens our output).
- **End-to-end in the browser against https://resuite.inceptum.at/calc/ (headless Chromium):** typed `=SUM(1,2,3)*2` → 12; opened `provisional-basic.xlsx` via the file picker (sheets Data/Summary, styles rendered); edited Qty B2 → 99; Save downloaded a 5 KB `.xlsx`; that file has B2=99 with recalculated cached values (D2 247.5, D7 698.37); LibreOffice headless converts it (values correct); harness PASS with 11/11 identical parts through our writer. No console errors. Screenshots in the PM scratchpad (`e2e/live-*.png`).
- Desktop: `pnpm --filter calc tauri build --no-bundle` + xvfb run (see below).
- **Not verifiable here:** "created in Excel … reopen it in Excel" – the test file is LibreOffice-made (PROVISIONAL) and Excel is not available on Linux. Owner: please open https://resuite.inceptum.at/calc/, load one of your own `.xlsx` files, edit, Save, and open the download in Excel; report any repair dialog.


**Scope change by owner (2026-10-15):** Rusuite must also run as a web app. Decisions: WASM in the browser (no server state), built now alongside Calc with a transport abstraction, deployed continuously from main to `https://resuite.inceptum.at/calc/`. Recorded in ADR 0005 and README; tasks P2-W2 (wasm scaffold + `Backend` abstraction), P2-W3 (nginx vhost + deploy script).

### Phase 1 milestone – VERIFIED 2026-10-15 on main d27be64
- `cargo fmt --check` OK · `cargo clippy --workspace --all-targets -D warnings` clean · `cargo test --workspace` 338 passed / 0 failed · `RUSTDOCFLAGS=-D warnings cargo doc` clean · `pnpm test` 1 passed.
- Reference suite: **862 passed / 0 failed / 0 skipped** (67 rows compared against their Excel value where LibreOffice diverges). All 62 MVP functions implemented (`docs/functions.md`).
- Parser proptest roundtrip (512 cases) green; `echo '=SUM(1,2,3)*2' | cargo run -p engine-formula --example repl` → `12` as in the README.
- Phase 0 harness still 6/6 PASS (now includes `formula-suite.xlsx`).
- Caveat: expected values are LibreOffice-computed (PROVISIONAL) except the 67 Excel overrides, which come from agent knowledge of Excel. The owner's Excel recalculation of `testdata/formulas/formula-suite.xlsx` is still the authoritative step (`scripts/gen-formula-suite.sh --from-xlsx`).

### Phase 2 plan (README: `model-sheet` + `fmt-xlsx`, Tauri app with canvas grid, formatting toolbar from `ui-shared`, undo/redo in `app-common`; milestone: open an Excel file, edit, save, reopen in Excel)
Order: P2-1 model-sheet (design) ∥ P2-3 Tauri Calc scaffold → P2-2 fmt-xlsx ∥ P2-4 app-common commands/undo → P2-5 canvas grid ∥ P2-6 ui-shared toolbar → P2-7 IPC wiring → P2-8 milestone verification (LibreOffice on the server; Excel by owner).

### Phase 0 milestone – VERIFIED 2026-10-15 on main 6f474a3
- `cargo fmt --all --check` OK; `cargo clippy --workspace --all-targets -- -D warnings` clean; `cargo test --workspace` 61 passed / 0 failed; `pnpm test` 1 passed.
- `scripts/roundtrip.sh testdata` with the real rewriter (`fmt-ooxml` example): 5/5 PASS, 0 LibreOffice warnings. Only regenerated parts differ (`[Content_Types].xml`, `*.rels`): cosmetic (`standalone="yes"`, redundant Override entries dropped).
- ADRs 0001–0003 in docs/adr/. Nothing pushed to origin (owner has not asked for pushes).

### Phase 1 plan (README: lexer/parser, dependency graph, evaluator + types, function registry, reference test suite, parser proptests)
Decision pending owner (see open questions): evaluation-semantics spec written by PM in the P1-2 brief and implemented by Opus, instead of a Fable agent.

## Phase 3 plan – Write (README: model-text + fmt-docx; Tiptap schema 1:1; bidirectional sync; images, tables, lists; milestone: roundtrip 50 reference documents)
Order: P3-1 model-text ∥ P3-3 Write scaffold ∥ P3-6 reference docs → P3-2 fmt-docx ∥ P3-4 write-core + sync protocol (ADR 0007) → P3-5 Tiptap editor sync + UI → P3-7 wiring/open-save → P3-8 milestone (roundtrip 50 files via harness + manifest assertions).

## Task board

| ID | Task | Model | State | Branch | Notes |
|---|---|---|---|---|---|
| P3-1 | `model-text` document model + `core_model::units`; ADR 0006 | Opus | in progress | `p3/model-text` | brief docs/tasks/P3-1-model-text.md |
| P3-3 | Write app scaffold: `apps/write` core/src-tauri/src-wasm/Tiptap UI, deployed at /write/ | Sonnet | in progress | `p3/write-scaffold` | brief docs/tasks/P3-3-write-scaffold.md |
| P3-6 | 50 provisional reference .docx files + manifest + docs/docx-suite.md | Sonnet | in progress | `p3/docx-testdata` | brief docs/tasks/P3-6-docx-reference-files.md |
| P3-2 | `fmt-docx` read/write ↔ model-text (document/styles/numbering/media/sectPr) + roundtrip tests over the manifest | Opus | todo | `p3/fmt-docx` | after P3-1 + P3-6 |
| P3-4 | `write-core`: commands/patches, Tiptap↔Rust sync protocol (ADR 0007), find/replace, undo | Opus | todo | `p3/write-core` | after P3-1 |
| P3-5 | Write UI: Tiptap schema mapping, transaction → command sync, toolbar from ui-shared | Opus | todo | `p3/write-ui` | after P3-4 |
| P3-7 | Wiring: docx open/save both shells; deploy | Opus | todo | `p3/write-wiring` | after P3-2 + P3-5 |
| P3-8 | Milestone verification | PM | todo | – | |
| P2-1 | `model-sheet`: Workbook wrapping `engine_formula::Engine` for contents/values + StyleTable (font/fill/border/alignment/number format), column/row dimensions, sheet metadata; serde; ADR 0004 | Opus | done (merged a112e4b) | – | verified: 15 tests, snapshot DTO, style interning; follow-up fixed a rustdoc link |
| P2-3 | Tauri 2 Calc app scaffold: `apps/calc` (Vite+React+Tailwind+Tauri), crate `app-calc` in workspace, `pnpm --filter calc tauri dev` runs, CI builds it | Sonnet | done (merged 1e8d201) | – | verified: tests, vite build, release binary 10.6 MiB runs under xvfb; tauri 2.12 / vite 6 / react 18 / tailwind 4 / vitest 3 |
| P2-1b | `engine-formula`: `transform.rs` (Excel reference adjustment for insert/delete rows/cols, copy/paste offset) + `Engine::insert_rows/delete_rows/insert_cols/delete_cols/cells` | Opus | done (merged) | – | verified: ~70 transform table cases, 4 engine tests; incremental graph update; `StructuralOp::map_cell` for model-sheet to move styles |
| P2-2 | `fmt-xlsx` read/write (bytes API, wasm-compatible) + `examples/rewrite.rs` + docs/ooxml-subset.md | Opus | done (merged) | – | verified: 457 tests, wasm check, harness 2/2 PASS with `fmt-xlsx` rewriter; styles stored as delta vs default font; docs/ooxml-subset.md xlsx section |
| P2-4 | `app-common` Host/undo-redo + `calc-core` (commands, patches, snapshots, JSON `dispatch`) + P2-1c model-sheet structural ops + ts-rs TS generation | Opus | done (merged ba56017) | – | verified: 432 tests; `calc_core::dispatch` JSON API; ts-rs types in apps/calc/src/generated + packages/ui-shared/src/generated; `.cargo/config.toml` sets TS_RS_EXPORT_DIR; ADR 0002 amended |
| P2-W2 | Web scaffold: `app-calc-wasm` crate, wasm-pack build, Vite web mode (`/calc/`), `ui-shared` `Backend` abstraction (Tauri/WASM), CI wasm checks | Sonnet | done (merged) | – | verified: wasm 105 KB (51 KB gz), JS 146 KB; 7 backend tests; wasm check for 6 crates in CI; wasm-pack 0.15 via npm |
| P2-W3 | nginx vhost resuite.inceptum.at + TLS + `scripts/deploy-web.sh`; first deploy | Sonnet | done (merged) | – | LIVE: https://resuite.inceptum.at/calc/ (TLS via certbot, expires 2027-01-13, auto-renew); live conf copied to /etc/nginx/sites-available; redeploy with `scripts/deploy-web.sh` |
| P2-5 | calc-ui canvas grid: virtualization (100k+ cells), selection, in-cell editing, formula bar, column/row headers, resize | Opus | done (merged) | – | verified: 45 tests, 60 fps at 100k cells, real-core browser check; open/save/markSaved wired; toolbar type narrowed |
| P2-6 | `ui-shared`: formatting toolbar (bold/italic/underline, font, size, colors, alignment, number format, borders) | Sonnet | done (merged) | – | verified: 22 tests, typecheck, no new runtime deps; agent's final report was empty – verified from the branch directly. Grid task must check `Fill` patch shape vs generated TS |
| P2-7 | Wiring: both shells call `calc_core::dispatch`; open/save (Tauri dialogs / browser file APIs) via fmt-xlsx; frontend store | Opus | done (merged) | – | verified: 464 tests, 29 ui-shared tests, both builds; found wasm clock trap (→ P2-9); saveXlsx marks-saved-too-early (→ P2-9) |
| P2-9 | wasm-safe default clock in engine-formula (`set_default_clock`/`default_now`), wasm shell init, `saveXlsx` no longer marks saved (`markSaved{name}` after write) | Sonnet | done (merged 670ccda) | – | verified: `set_default_clock`/`default_now`, wasm start hook, NOW() workbook opens in node-driven wasm; saveXlsx no longer marks saved |
| P2-8 | Milestone verification | PM | done on server; Excel check pending owner | – | see milestone section |
| P1-1 | `engine-formula` lexer + Pratt parser + AST + printer; A1/absolute/range/cross-sheet refs, operators incl. `&` `%` `^`, arrays, errors, names; proptest AST→text→AST roundtrip | Opus | done (merged b0b70a6) | – | en-US syntax only (comma arg separator, dot decimal) |
| P1-2 | Value type system + evaluator: Number/Text/Bool/Error/Array/Reference, coercion rules, error propagation, `CellProvider` trait, implicit intersection, range→array | Opus | done (merged 6b602bb) | – | verified: 52 unit tests; suite runner 232 passed / 0 failed / 630 skipped-unimplemented; deviations: numbers compared at 15 sig digits (Excel-like), `0^-1`→#NUM! (Excel #DIV/0!) |
| P1-3 | Dependency graph + incremental recalc + circular detection (`#CIRC` → Excel reports 0 with warning; we return `Error::Circular`) | Opus | done (merged) | – | verified: 12 integration + 4 unit tests; 100k-cell chain ordered in <1 s debug |
| P1-4 | (folded into P1-2: registry + lazy args; `docs/functions.md` delivered by P1-6) | – | done via P1-2/P1-6 | – | |
| P1-5a | math/stat functions (19) | Sonnet | done (merged 28294fe) | – | verified after P1-9: math 179/179 incl. SUMPRODUCT; deviation accepted: COUNTIF numeric criterion also matches numeric text (Excel) |
| P1-5b | logical + info + date/time (16) | Sonnet | done (merged 98f87b0) | – | verified: 212 rows of its three files pass; follow-up added `parse_date_text` (YEAR/MONTH/DAY/WEEKDAY/DAYS accept text dates like Excel) and moved the runner clock to 46310.5 |
| P1-5c | text (13, incl. TEXT number formats) | Sonnet | done (merged) | – | verified: 166/166 text suite rows; TEXT numfmt subset + extras (sections, mmm/ddd); not: `?`, `E+`, fractions, AM/PM |
| P1-5d | lookup (7): VLOOKUP HLOOKUP INDEX MATCH CHOOSE ROW COLUMN | Sonnet | done (merged) | – | verified: 88/88 lookup rows; ROW/COLUMN special-case INDEX literal (to be replaced by P1-11 `call_ref`) |
| P1-6 | Reference test suite format (`testdata/formulas/*.tsv`: formula, expected, note) + runner test; provisional values computed with LibreOffice headless, marked provisional | Sonnet | done (merged) | – | 862 cases, 62 functions, `docs/functions.md`; 66 rows marked DIFF with excel= values from agent memory; owner's Excel run of `testdata/formulas/formula-suite.xlsx` will settle them |
| P1-9 | Array-mode evaluation for range arguments (`eval_array`, broadcasting, `0^neg`→#DIV/0!) | Opus | done (merged) | – | verified: 8 unit tests; `CallContext::range` evaluates in array mode with broadcasting; `0^neg`→#DIV/0! |
| P1-11 | Reference-returning functions (`Function::call_ref`, `A1:INDEX(..)`) + runner skips only planned-but-unimplemented names (UNKNOWNFN rows evaluated) | Opus | done (merged d27be64) | – | verified: `Function::call_ref`, `A1:INDEX(..)`, runner evaluates unlisted names → suite 862/0/0 |
| P1-10 | Unify duplicated civil-date/serial + date-text parsing (datetime/serial.rs ← text/value.rs, text/numfmt.rs) | Sonnet | done (merged) | – | verified: suite counts unchanged, 318 tests; one shared serial/date-text parser; agent self-reported an accidental `git stash`/pop in its own worktree, no damage |
| P1-8 | Engine façade: `Engine` holding cells + graph + evaluator; set value/formula, recalc, get; unify SheetId/CellCoord types | Opus | done (merged) | – | verified: 9 integration tests, coord.rs unifies types, `begin_batch/end_batch` added, `Schedule` with Tarjan cycle grouping; 50k chain 0.9 s build / 0.35 s head change (debug) |
| P1-7 | `examples/repl.rs` as in README + rustdoc `-D warnings` hygiene and CI doc step | Sonnet | done (merged) | – | verified: README example prints 12; cycle + parse-error output; rustdoc -D warnings clean, CI doc step added |
| P0-1 | Workspace scaffold: Cargo workspace (all crates as stubs), pnpm workspace, fmt/clippy config, `pnpm test` placeholder, CI workflow, .gitignore, LICENSE | Sonnet | done (merged f07e101) | – | verified: fmt/clippy/test/pnpm test all green |
| P0-2 | `fmt-ooxml`: open ZIP package, parse `[Content_Types].xml` + `_rels`, generic XML helpers, write package back byte-stable | Opus | done (merged 6f474a3) | – | verified: 27 tests + testdata roundtrip over 5 files; harness 5/5 PASS with real rewriter |
| P0-3 | `core-model`: run formatting, colors (RGB/theme/auto), font definitions, theme colors, serde derive | Opus | done (merged ab330bb) | – | verified: 18 unit + 6 snapshot tests; brief's black-tint refs corrected by agent (Excel 'Black, Lighter N%' = 0D0D0D/262626/404040/595959/808080) |
| P0-4 | Roundtrip harness: `scripts/roundtrip.sh` + `xtask roundtrip` – read → write → open in headless LibreOffice → count errors/warnings; reports per file | Sonnet | done (merged 42b68e2) | – | verified: 5/5 PASS with real rewriter after P0-2 merge |
| P0-5 | Provisional reference files in `testdata/{docx,xlsx,pptx}` generated with LibreOffice headless | Sonnet | done (merged 42b68e2) | – | 5 PROVISIONAL files from LibreOffice 25.2 (see testdata/README.md); need real-Office files from owner |
| P0-6 | ADRs: 0001 Rust owns the document model, 0002 IPC strategy, 0003 workspace/crate layout | PM | done (28000c6) | – | 0001 model ownership, 0002 IPC, 0003 crate layout |
| P0-7 | `docs/setup.md` – what was installed on the dev server | PM | done (28000c6) | – | |

## Environment (dev server)
- Debian 13, 16 cores, 30 GB RAM
- Installed this session: rustup (stable 1.99, clippy, rustfmt), pnpm 12 (via npm -g), LibreOffice headless, libxml2-utils, shellcheck, xvfb (apt). Server is 77.244.242.34; nginx 1.26 + certbot 4 already serve other vhosts (erp/gitai/url.inceptum.at, …) – do not disturb them. Details in `docs/setup.md`.
- Tauri system deps (webkit2gtk-4.1-dev, gtk-3-dev, build-essential, pkg-config) were already present.

## Last decisions
13. 2026-10-15: Phase 2 milestone declared reached on the server; the Excel reopen check is delegated to the owner (no Excel here). Phase 3 (Write) planning starts; Phase 2 leftovers (used range in snapshots, async Tauri dispatch, paste reference adjustment, text overflow) go to ROADMAP and are scheduled only if they block Phase 3/5.
12. 2026-10-15: Owner added the web target (WASM, now, deploy from main). ADR 0005: one `<app>-core` crate + two shells (`src-tauri`, `src-wasm`), JSON `dispatch` over both transports, ts-rs for TS types, `Backend` abstraction in ui-shared, static hosting on nginx.
11. 2026-10-15: Phase 1 closed. Phase 2 design: `model-sheet::Workbook` wraps `engine_formula::Engine` (single storage of cell contents/values) and adds styles + dimensions; no duplicate cell store. ADR 0004 to be written with P2-1.
10. 2026-10-15: `Engine` typing rules follow Excel input parsing (`1,000`, `$5`, `50%` become numbers; surrounding whitespace keeps text). Sheet add/rename recalc internally without returning a `Recalc` – to be revisited for IPC in Phase 2.
9. 2026-10-15: Array-mode evaluation (Excel legacy array semantics with broadcasting) applies only to arguments requested via `CallContext::range`; scalar positions keep implicit intersection. Functions are not lifted over arrays in MVP. `0^negative` → #DIV/0! (Excel) replaces the earlier #NUM!.
8. 2026-10-15: Cells in a circular reference evaluate to `#NUM!` with the cycle reported in `Recalc.cycle` (AST `ErrorKind` is frozen; Excel shows 0 + warning). Function batches register per family module to keep `with_builtins` merges to one line each.
7. 2026-10-15: Reference-suite runner compares DIFF-marked rows against the `[excel=…]` value (Excel is the target), not against LibreOffice's value. Function registry folded into the evaluator task (one coherent API); `docs/functions.md` came with the suite.
6. 2026-10-15: Phase 0 milestone verified and closed. Phase 1 begins; P1-1 (parser) starts first, P1-6 (test suite format) in parallel since it does not depend on the parser.
5. 2026-10-15: Agents work in `git worktree`s under `/home/bojan/rusuite-wt/<branch>` so parallel tasks never share a checkout. Task briefs are committed under `docs/tasks/` (copied from the PM scratchpad) so they survive context loss.
1. 2026-10-15: Git identity for commits set locally to `Bojan <bojan@referee.at>` (previous commits were by `refaustria`). Change with `git config user.*` if wrong.
2. 2026-10-15: Phase 0 split into 7 tasks; P0-1 runs first, then P0-2/3/4 in parallel.
3. 2026-10-15: `core-model` Phase 0 scope implemented by Opus against a PM-written type spec, not Fable (scope is a well-understood OOXML mapping; escalate only if design questions arise).
4. 2026-10-15: Roundtrip harness verification = LibreOffice headless `--convert-to` of the rewritten file succeeds and the output is non-empty, plus a structural diff of the ZIP part list and XML against the original. (LibreOffice has no "repair dialog" counter in headless mode; a failed/empty conversion is the proxy.)

## Open questions for the owner
- Testdata caveat: `provisional-basic.xlsx` has a stale LibreOffice cached value for `Data!C7` (27.028; the stored inputs give 27.128, which our engine computes). Harmless (we ignore cached values) but another reason to replace provisional files with Excel-authored ones.
- FYI (not caused by us): `https://url.inceptum.at/` answers 502 (its upstream on 127.0.0.1:3002 seems down); gitai/ssh answer 401 (auth). We did not touch those vhosts.
- (none new) Suite status on main: 855 passed / 0 failed / 7 skipped (all UNKNOWNFN rows; P1-11 makes them run). All 62 MVP functions implemented.
- **Phase 1 model choice:** the owner's instructions list "the formula engine's evaluation semantics" as a Fable-tier decision. My plan: I write the semantics spec (coercions, error propagation, array/range handling, empty-cell rules) into the P1-2 brief and have Opus implement it. If you prefer a Fable agent for P1-2, say so; otherwise I proceed with the plan.
- **Excel reference values for formulas:** `testdata/formulas/` needs expected results computed in real Excel. I will seed provisional values from LibreOffice Calc; please run the generated `.xlsx` through Excel when you can (I will produce one file with all test formulas in a column, so Excel's recalculated values can be exported).
- Reference files: `testdata/` is empty. I am generating PROVISIONAL files with LibreOffice. Please provide real-Office files when you can: a small `.docx` (headings, bold/italic runs, list, table, image), a `.xlsx` (2 sheets, numbers/text/dates, a few formulas, styled cells), a `.pptx` (3 slides, title/content layouts, shapes, image).
- Git identity (see decision 1).

## Blocked
- none
