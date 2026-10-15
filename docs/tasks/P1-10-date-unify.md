# Task P1-10 – unify the duplicated date/serial code in `engine-formula`

Branch `p1/date-unify`, worktree `/home/bojan/rusuite-wt/p1-date-unify`. Scope: `crates/engine-formula/src/functions/datetime/serial.rs`, `functions/text/value.rs`, `functions/text/numfmt.rs`, and whatever `functions/datetime/*.rs` / `functions/text/*.rs` files import the moved items. Nothing under `functions/lookup/**`, `functions/math/**`, `eval.rs`, `coord.rs`, `engine.rs`, `graph.rs`, `functions/mod.rs` (other agents are active there).

## Goal
Exactly ONE implementation of: civil date ↔ Excel serial (1900 system with the Lotus 1900-02-29 quirk), and text → date/time parsing. Today there are three: `datetime/serial.rs` (`ymd_to_serial`, `serial_to_ymd`, `parse_date_text`), a private `days_from_civil` + date/time parser in `text/value.rs` (VALUE), and another civil-date copy in `text/numfmt.rs` (TEXT date formats).

## Steps
1. Make `functions/datetime/serial.rs` the single source: keep its public API, and add whatever `text/value.rs` and `numfmt.rs` need (e.g. `serial_to_ymd_hms(f64) -> Option<(i32,u32,u32,u32,u32,u32)>`, `parse_time_text(&str) -> Option<f64>`, and extend `parse_date_text` so it accepts every form VALUE currently accepts – `yyyy-mm-dd`, `yyyy/mm/dd`, `m/d/yyyy`, optional time separated by a space or `T`, `hh:mm[:ss]` alone → fraction of a day). Document the accepted grammar in the module doc comment.
2. Replace the private copies in `text/value.rs` and `text/numfmt.rs` with calls into `crate::functions::datetime::serial` (make the module `pub(crate)` if needed; do not change `functions/mod.rs`).
3. Behaviour must not change: run the full reference suite before and after; the per-file counts must be identical (`text passed=166`, `datetime passed=96`, `info 51`, `logical 71`, `math 179`, overall `failed=0`). Keep all existing unit tests; move the tests of the deleted private functions onto the shared ones rather than deleting them.
4. `cargo fmt`, `clippy -D warnings`, `cargo test --workspace`, `RUSTDOCFLAGS="-D warnings" cargo doc -p engine-formula --no-deps` all green.

## Report
Lines removed vs added; any accepted-input difference between the three parsers that you had to reconcile (e.g. one accepted two-digit years, another did not) and which way you went (Excel behaviour wins; `docs/functions.md` VALUE row is the reference).
