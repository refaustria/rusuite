# Rusuite – Project Status

_Maintained by the PM agent. Read at the start of every session; update after every task._

## Current phase: Phase 1 – Formula Engine (Phase 0 complete)

### Phase 0 milestone – VERIFIED 2026-10-15 on main 6f474a3
- `cargo fmt --all --check` OK; `cargo clippy --workspace --all-targets -- -D warnings` clean; `cargo test --workspace` 61 passed / 0 failed; `pnpm test` 1 passed.
- `scripts/roundtrip.sh testdata` with the real rewriter (`fmt-ooxml` example): 5/5 PASS, 0 LibreOffice warnings. Only regenerated parts differ (`[Content_Types].xml`, `*.rels`): cosmetic (`standalone="yes"`, redundant Override entries dropped).
- ADRs 0001–0003 in docs/adr/. Nothing pushed to origin (owner has not asked for pushes).

### Phase 1 plan (README: lexer/parser, dependency graph, evaluator + types, function registry, reference test suite, parser proptests)
Decision pending owner (see open questions): evaluation-semantics spec written by PM in the P1-2 brief and implemented by Opus, instead of a Fable agent.

## Task board

| ID | Task | Model | State | Branch | Notes |
|---|---|---|---|---|---|
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
| P1-11 | Reference-returning functions (`Function::call_ref`, `A1:INDEX(..)`) + runner skips only planned-but-unimplemented names (UNKNOWNFN rows evaluated) | Opus | in progress | `p1/ref-fns` | brief docs/tasks/P1-11-ref-functions-and-runner.md |
| P1-10 | Unify duplicated civil-date/serial + date-text parsing (datetime/serial.rs ← text/value.rs, text/numfmt.rs) | Sonnet | done (merged) | – | verified: suite counts unchanged, 318 tests; one shared serial/date-text parser; agent self-reported an accidental `git stash`/pop in its own worktree, no damage |
| P1-8 | Engine façade: `Engine` holding cells + graph + evaluator; set value/formula, recalc, get; unify SheetId/CellCoord types | Opus | done (merged) | – | verified: 9 integration tests, coord.rs unifies types, `begin_batch/end_batch` added, `Schedule` with Tarjan cycle grouping; 50k chain 0.9 s build / 0.35 s head change (debug) |
| P1-7 | `examples/repl.rs` as in README + rustdoc `-D warnings` hygiene and CI doc step | Sonnet | in progress | `p1/repl` | brief docs/tasks/P1-7-repl.md (REPL + rustdoc hygiene + CI doc step) |
| P0-1 | Workspace scaffold: Cargo workspace (all crates as stubs), pnpm workspace, fmt/clippy config, `pnpm test` placeholder, CI workflow, .gitignore, LICENSE | Sonnet | done (merged f07e101) | – | verified: fmt/clippy/test/pnpm test all green |
| P0-2 | `fmt-ooxml`: open ZIP package, parse `[Content_Types].xml` + `_rels`, generic XML helpers, write package back byte-stable | Opus | done (merged 6f474a3) | – | verified: 27 tests + testdata roundtrip over 5 files; harness 5/5 PASS with real rewriter |
| P0-3 | `core-model`: run formatting, colors (RGB/theme/auto), font definitions, theme colors, serde derive | Opus | done (merged ab330bb) | – | verified: 18 unit + 6 snapshot tests; brief's black-tint refs corrected by agent (Excel 'Black, Lighter N%' = 0D0D0D/262626/404040/595959/808080) |
| P0-4 | Roundtrip harness: `scripts/roundtrip.sh` + `xtask roundtrip` – read → write → open in headless LibreOffice → count errors/warnings; reports per file | Sonnet | done (merged 42b68e2) | – | verified: 5/5 PASS with real rewriter after P0-2 merge |
| P0-5 | Provisional reference files in `testdata/{docx,xlsx,pptx}` generated with LibreOffice headless | Sonnet | done (merged 42b68e2) | – | 5 PROVISIONAL files from LibreOffice 25.2 (see testdata/README.md); need real-Office files from owner |
| P0-6 | ADRs: 0001 Rust owns the document model, 0002 IPC strategy, 0003 workspace/crate layout | PM | done (28000c6) | – | 0001 model ownership, 0002 IPC, 0003 crate layout |
| P0-7 | `docs/setup.md` – what was installed on the dev server | PM | done (28000c6) | – | |

## Environment (dev server)
- Debian 13, 16 cores, 30 GB RAM
- Installed this session: rustup (stable 1.99, clippy, rustfmt), pnpm 12 (via npm -g), LibreOffice headless, libxml2-utils, shellcheck (apt). Details in `docs/setup.md`.
- Tauri system deps (webkit2gtk-4.1-dev, gtk-3-dev, build-essential, pkg-config) were already present.

## Last decisions
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
- (none new) Suite status on main: 855 passed / 0 failed / 7 skipped (all UNKNOWNFN rows; P1-11 makes them run). All 62 MVP functions implemented.
- **Phase 1 model choice:** the owner's instructions list "the formula engine's evaluation semantics" as a Fable-tier decision. My plan: I write the semantics spec (coercions, error propagation, array/range handling, empty-cell rules) into the P1-2 brief and have Opus implement it. If you prefer a Fable agent for P1-2, say so; otherwise I proceed with the plan.
- **Excel reference values for formulas:** `testdata/formulas/` needs expected results computed in real Excel. I will seed provisional values from LibreOffice Calc; please run the generated `.xlsx` through Excel when you can (I will produce one file with all test formulas in a column, so Excel's recalculated values can be exported).
- Reference files: `testdata/` is empty. I am generating PROVISIONAL files with LibreOffice. Please provide real-Office files when you can: a small `.docx` (headings, bold/italic runs, list, table, image), a `.xlsx` (2 sheets, numbers/text/dates, a few formulas, styled cells), a `.pptx` (3 slides, title/content layouts, shapes, image).
- Git identity (see decision 1).

## Blocked
- none
