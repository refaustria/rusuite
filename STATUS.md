# Rusuite – Project Status

_Maintained by the PM agent. Read at the start of every session; update after every task._

## Current phase: Phase 5 – Polish + Phase 6 – Usability (owner feedback 2026-10-15)

**Owner feedback 2026-10-15 (after trying the web apps):** push to GitHub and build installers; expected Office-like **ribbons/menus (File, Home, …)**; expected **more functionality** – e.g. Calc formula editing must support clicking cells to insert references and must never discard an incomplete formula; "stripped" ≠ bare basics. Decision: a Phase 6 "Usability" track is added within the README feature scope: ribbon in ui-shared (P6-1), Calc formula editing like Excel (P6-2), then further ergonomics batches (see below). `main` is now pushed to github.com/refaustria/rusuite (owner's instruction).

### Phase 6 plan – Usability (owner-requested; README features, Office-like ergonomics)
- P6-1 Ribbon (File backstage / Home / Insert / View; Layout for Write) in ui-shared, all apps.
- P6-2 Calc formula editing: point mode (mouse/keyboard reference insertion), never-lose-text with inline parse errors, reference colouring, function autocomplete + signature tips, F4 anchoring.
- Proposed next batches (owner to confirm/re-order): **Calc**: fill handle + drag-fill series, copy/paste with reference adjustment, cut/paste, context menus (rows/cols/cells), wrap text + text overflow + `####`, number-format dialog, column autofit all, find/replace, multi-sheet print. **Write**: table context menu (rows/cols, cell shading), image resize handles + alignment, headers/footers, page view with page boundaries, find highlighting, spell-check via browser. **Show**: shape context menu, text in groups, slide thumbnails drag reorder polish, shape gallery, align guides/snap, speaker notes.

### Phase 4 milestone – verified by the PM 2026-10-15 on main 1fd33d8
- fmt/clippy/rustdoc clean; `cargo test --workspace` 727 passed; `pnpm test` 34 + 41 + 56 + 45 passed; wasm checks for all Show crates.
- `fmt-pptx` suite: all 26 reference decks read with manifest features found, write→read equal; harness with our writer 26/26 PASS, `lo_warnings=0`.
- **10-slide deck** written by `cargo run -p fmt-pptx --example build_deck` (all layouts, shapes, group, picture, bullets, rotation/flip, background): LibreOffice converts it to a 10-page PDF with no warnings; harness PASS 40/40 identical parts. File sent to the owner for the PowerPoint check (the README milestone's "open in PowerPoint without errors" can only be confirmed by the owner).
- **Live end-to-end at https://resuite.inceptum.at/show/ (headless Chromium):** opened the 6-slide pitch deck via the file picker, inserted a rectangle (status Modified), Save → download (status Saved) → our reader opens it, slide 1 has 3 shapes (was 2), harness PASS 31/31 identical, 0 LibreOffice warnings, no console errors. The UI agent's deck-building check against the real core: 18 commands, 0 id/patch issues.

### Phase 5 plan – Polish (README: shortcut parity, PDF export via webview print, recent files/autosave/crash recovery, installers for all three platforms, performance 1M cells / 200-page doc / 100 slides)
- P5-2 PDF export ∥ P5-3 recent/autosave/recovery ∥ P5-5 shortcuts + hygiene → P5-4 performance benchmarks + fixes → P5-1 installers (needs a decision: GitHub Actions `tauri-action` bundles for Windows/macOS/Linux require pushing the repo to GitHub – the owner has not asked for pushes; Linux `.deb`/AppImage can be built here).

### Phase 3 milestone – verified by the PM 2026-10-15 on main aeff1a3

- fmt/clippy/rustdoc clean; `cargo test --workspace` 603 passed; `pnpm test` 34 + 56 + 45 passed; wasm check for all Write crates.
- **Roundtrip of the 50 reference documents (+2 older):** `fmt-docx` suite test asserts every manifest feature after read and equality after write→read; harness with our writer 52/52 PASS, `lo_warnings=0` for every file; LibreOffice text export identical for all 50 (agent check).
- **Live end-to-end at https://resuite.inceptum.at/write/ (headless Chromium):** opened `provisional-47-report.docx` through the file picker (title, headings, list, table, image rendered; 78 words; 3 reader warnings shown), typed an edit, Save → downloaded `.docx` → our reader opens it, harness PASS 11/11 identical parts, LibreOffice text export contains the edit. 0 sync mismatches in the agent's typing check (36 commands).
- **Not verifiable here:** the 50 documents are LibreOffice-made (PROVISIONAL); Word is not available. Owner: open one of your own `.docx` at the URL above, edit, Save, reopen in Word.

### Phase 4 plan – Show (README: model-show + fmt-pptx; Konva canvas; slide sidebar; presentation mode; milestone: build a 10-slide presentation and open it in PowerPoint without errors)
Order: P4-1 model-show (ADR 0008) ∥ P4-3 Show scaffold (Konva) ∥ P4-6 pptx reference files → P4-2 fmt-pptx ∥ P4-4 show-core commands/patches → P4-5 Show UI (Konva object model, selection, transforms, text overlay editor, sidebar, presentation mode) → P4-7 wiring/open-save → P4-8 milestone (10-slide deck built through the UI, harness + owner's PowerPoint check).

### Phase 2 milestone – reached on the server 2026-10-15 (main 670ccda); owner's Excel check pending

### Phase 2 milestone – verification run by the PM
- Checks on main: fmt/clippy/rustdoc clean; `cargo test --workspace` 466 passed; `pnpm test` 29 + 45 passed; wasm `cargo check` for 8 crates OK.
- Harness with the `fmt-xlsx` writer: `testdata/xlsx` 2/2 PASS (LibreOffice opens our output).
- **End-to-end in the browser against https://resuite.inceptum.at/calc/ (headless Chromium):** typed `=SUM(1,2,3)*2` → 12; opened `provisional-basic.xlsx` via the file picker (sheets Data/Summary, styles rendered); edited Qty B2 → 99; Save downloaded a 5 KB `.xlsx`; that file has B2=99 with recalculated cached values (D2 247.5, D7 698.37); LibreOffice headless converts it (values correct); harness PASS with 11/11 identical parts through our writer. No console errors. Screenshots in the PM scratchpad (`e2e/live-*.png`).
- Desktop: `pnpm --filter calc tauri build --no-bundle` OK (1m22s, release binary); runs under Xvfb for 25 s with no panic; a visual check needs a real desktop session (Xvfb screenshots came out blank without a window manager) – owner, when convenient: `pnpm --filter calc tauri dev`.
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
| P3-1 | `model-text` document model + `core_model::units`; ADR 0006 | Opus | done (merged) | – | verified: 499 tests total, wasm check, 3 insta snapshots; bullets stored as readable chars (fmt-docx maps to Symbol PUA); `Document.theme` missing (ROADMAP/fmt-docx context) |
| P3-3 | Write app scaffold: `apps/write` core/src-tauri/src-wasm/Tiptap UI, deployed at /write/ | Sonnet | done (merged) | – | verified: LIVE https://resuite.inceptum.at/write/ (Tiptap 3.31.3 placeholder editor), tauri build runs under xvfb, deploy script covers calc+write |
| P3-6 | 50 provisional reference .docx files + manifest + docs/docx-suite.md | Sonnet | done (merged) | – | verified: 50 files + manifest, 52/52 harness PASS, structural spot-checks OK; LibreOffice writes highlights as `w:shd` (reader must accept both) |
| P3-2 | `fmt-docx` read/write ↔ model-text (document/styles/numbering/media/sectPr) + roundtrip tests over the manifest | Opus | done (merged) | – | verified: 595 tests, harness 52/52 PASS with our writer (lo_warnings=0), wasm check; tint math follows Word (`99`→0.4, brief's test line was wrong); manifest erratum file 46 (claims 4 highlights, file has 2) allow-listed |
| P3-4 | `write-core`: commands/patches, Tiptap↔Rust sync protocol (ADR 0007), find/replace, undo | Opus | done (merged) | – | verified: 572 tests; `dispatch_with(&mut WriteHost, json)` is the real entry (shells switch in P3-7); re-inserted ids appear in deleted+inserted (UI must handle); model-text got a `ts` feature |
| P3-5 | Write UI: Tiptap schema mapping, transaction → command sync, toolbar from ui-shared | Opus | done (merged aeff1a3) | – | verified: 56 Write tests, 0 sync mismatches against the real core, Open/Save, Find/Replace; ui-shared gained ParagraphStyleSelect/ListButtons and `createBackend` accept/mime option |
| P3-7 | Wiring: docx open/save both shells; deploy | Opus | done (merged) | – | verified: 52 manifest files open+save via dispatch, node-driven wasm check, deploy OK; UI Open/Save + `.docx` accept handed to P3-5 |
| P3-8 | Milestone verification | PM | done on server; Word check pending owner | – | see milestone section |
| P4-1 | `model-show` + move `MediaStore` to core-model; ADR 0008 | Opus | done (merged) | – | verified: 625 tests, wasm check; MediaStore now in core-model; group children stored relative at scale 1 (fmt-pptx must renormalise chOff/chExt; group resize scales children in show-core) |
| P4-3 | Show app scaffold (Tauri + WASM + Konva), deployed at /show/ | Sonnet | done (merged) | – | verified: LIVE https://resuite.inceptum.at/show/ (konva 10.7, react-konva 18.2.16 placeholder stage + Present mode), tauri build runs under xvfb |
| P4-6 | 25 provisional reference .pptx files + manifest | Sonnet | done (merged) | – | verified: 25 decks + manifest, 26/26 harness PASS; LibreOffice export quirks documented (title ph type, bare body ph, lines as p:sp, txBox rects) |
| P4-2 | `fmt-pptx` read/write | Opus | done (merged) | – | verified: 720 tests, harness 26/26 PASS (lo_warnings=0), `examples/build_deck` → 10-slide deck PASS 40/40 parts; deck sent to owner for PowerPoint check |
| P4-4 | `show-core` commands/patches/dispatch | Opus | done (merged) | – | verified: 692 tests; whole-slide patches/inverses; `TextParagraphPatch` (null = inherit); 42 generated TS files; wiring must add show-core to CI generated-diff/wasm checks and delete ping dispatch |
| P4-5 | Show UI: Konva object model, selection/transform, text editing, sidebar, presentation mode | Opus | done (merged) | – | verified: 41 Show tests; 3-slide deck built via UI against the real core (18 commands, 0 id issues); rich-text layout engine on Konva; Open/Save enable once the core answers |
| P4-7 | Wiring: pptx open/save both shells; deploy | Opus | done (merged 1fd33d8) | – | verified: 727 tests; 26 decks open/save via dispatch; live /show/ open→edit→save verified by PM; CI checks show-core generated types |
| P4-8 | Milestone verification | PM | done on server; PowerPoint check pending owner | – | see milestone section |
| P5-2 | PDF export via webview print (all apps) | Sonnet | done (merged) | – | verified: PDFs rendered (Write 5 pp A4, Calc 3 pp table w/ header, Show 3 slide pages); Ctrl+P via ShortcutLayer; `window.print()` (Tauri 2.12 has no webview print API) – desktop webviews unverified |
| P5-3 | Recent files, autosave, crash recovery (app-common + shells + IndexedDB on web) | Opus | done (merged) | – | verified: 749 tests; `app_common::session`, `recoverySnapshot`/`restoreRecovery` in all cores, Tauri app-data JSON / web IndexedDB, 30 s autosave, recovery banner; crash-recovery browser check by agent |
| P5-5 | Shortcut parity + hygiene (generated-types CI for write, favicons, show api.ts cleanup, chunk splitting) | Sonnet | done (merged) | – | verified: 234 frontend tests, `useShortcuts` + help dialog (Ctrl+/), Save As prompt, docs/shortcuts.md; tiptap/konva chunks split; CI diffs write generated types |
| P5-4 | Performance: 1M cells / 200-page doc / 100 slides benchmarks + fixes | Opus | done (merged) | – | verified: 750 tests; docs/perf.md – Calc 1M cells load 1.5 s native / 4.7 s wasm, edit 17 ms, RSS 332 MB; Write open 0.8 s, typing p95 65 ms (target 30 → P5-6); Show 100 slides open 1.1 s, switch 22 ms; engine graph tiles + model-sheet used-range fixes |
| P5-6 | Write typing latency: incremental word count + throttled toolbar state | Sonnet | done (merged) | – | typing p50/p95 27/32 ms (target 30; 2 ms short, machine shared); incremental word count, throttled toolbar state |
| P5-1 | GitHub: CI green on runners + release workflow (deb/AppImage, msi/nsis, dmg) via tauri-action | Sonnet | done (squash-merged 23a5262) | – | CI green on main (run 38741498629); Release workflow verified 12/12 jobs; tag `v0.1.0-alpha.1` pushed → draft prerelease with deb/rpm/AppImage, msi/exe, dmg (aarch64 + x64) for all three apps; unsigned |
| P6-3 | Calc editing batch: paste w/ reference adjustment, fill handle, context menus, wrap/overflow/####, number-format dialog, find/replace | Opus | in progress | `p6/calc-batch` | brief docs/tasks/P6-3-calc-editing-batch.md |
| P6-1 | Ribbon in ui-shared + all apps | Opus | in progress | `p6/ribbon` | brief docs/tasks/P6-1-ribbon.md |
| P6-2 | Calc formula editing like Excel (point mode, inline errors, colouring, autocomplete, F4) | Opus | done (merged) | – | verified: 112 Calc tests; point mode (mouse/keyboard/sheet tabs), inline parse errors keep text, blur never discards, reference colouring, autocomplete + signature tips, F4 |
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
17. 2026-10-15: First prerelease tag `v0.1.0-alpha.1` pushed (owner asked for GitHub builds); releases are draft+prerelease, unsigned (signing/notarization → ROADMAP). Stale `macos-13` runs on GitHub must be cancelled by the owner in the web UI (token cannot cancel).
16. 2026-10-15: Owner instruction: push to GitHub + build installers (done: main pushed; P5-1 builds the workflows). Owner feedback adds a Usability track (Phase 6): ribbon UI and Office-like editing ergonomics are in scope; feature scope of the README unchanged.
15. 2026-10-15: Phase 3 closed on the server (Word check delegated to the owner). ADR 0008 fixes the Show model (fixed built-in layouts, DrawingML-shaped text reusing RunProperties, MediaStore moved to core-model). Phase 4 started.
14. 2026-10-15: ADR 0007 fixes the Tiptap↔Rust sync: optimistic ProseMirror apply + authoritative block-level `WritePatch`, block ids in the PM schema with temp-id mapping, fine-grained commands plus `ReplaceBlocks` fallback, lists mapped in TS between nested PM lists and docx numbering, undo/find-replace in Rust, full-document snapshot on load (no regions in Write for MVP).
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
- **Usability batches after P6-1/P6-2:** see the proposed Calc/Write/Show lists in the Phase 6 plan – tell me which to prioritise, otherwise I go Calc → Write → Show in the listed order.
- **PowerPoint check (Phase 4 milestone):** `testdata/pptx/out/rusuite-10-slides.pptx` (sent via the session; regenerate with `cargo run -p fmt-pptx --example build_deck`) – please open it in PowerPoint and report any repair dialog or visual problem.
- Testdata caveat: `provisional-basic.xlsx` has a stale LibreOffice cached value for `Data!C7` (27.028; the stored inputs give 27.128, which our engine computes). Harmless (we ignore cached values) but another reason to replace provisional files with Excel-authored ones.
- FYI (not caused by us): `https://url.inceptum.at/` answers 502 (its upstream on 127.0.0.1:3002 seems down); gitai/ssh answer 401 (auth). We did not touch those vhosts.
- (none new) Suite status on main: 855 passed / 0 failed / 7 skipped (all UNKNOWNFN rows; P1-11 makes them run). All 62 MVP functions implemented.
- **Phase 1 model choice:** the owner's instructions list "the formula engine's evaluation semantics" as a Fable-tier decision. My plan: I write the semantics spec (coercions, error propagation, array/range handling, empty-cell rules) into the P1-2 brief and have Opus implement it. If you prefer a Fable agent for P1-2, say so; otherwise I proceed with the plan.
- **Excel reference values for formulas:** `testdata/formulas/` needs expected results computed in real Excel. I will seed provisional values from LibreOffice Calc; please run the generated `.xlsx` through Excel when you can (I will produce one file with all test formulas in a column, so Excel's recalculated values can be exported).
- Reference files: `testdata/` is empty. I am generating PROVISIONAL files with LibreOffice. Please provide real-Office files when you can: a small `.docx` (headings, bold/italic runs, list, table, image), a `.xlsx` (2 sheets, numbers/text/dates, a few formulas, styled cells), a `.pptx` (3 slides, title/content layouts, shapes, image).
- Git identity (see decision 1).

## Blocked
- none
