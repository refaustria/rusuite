# Task P1-7 – `cargo run -p engine-formula --example repl`
Branch `p1/repl`, worktree `/home/bojan/rusuite-wt/p1-repl`. Scope: `crates/engine-formula/examples/repl.rs`, a short "Try the engine" section in `docs/architecture.md` (replace the Phase 1 placeholder sentence only), nothing else. Depends on `Engine` from P1-8 being on main.

## Behaviour
- Reads lines from stdin, prints one result per line, exits on EOF or `:q`. Prompt `> ` only when stdin is a TTY (so `echo '=SUM(1,2,3)*2' | cargo run -q -p engine-formula --example repl` prints just `12`).
- A line starting with `=` is evaluated in the context of cell `Sheet1!A1`... no: in the context of a scratch cell `Sheet1!ZZ1` that is never assigned, so `ROW()` is 1.
- `A1 = 5`, `B2 = =A1*2`, `Sheet2!C3 = hello` assign a cell through `Engine::set_input` (the text right of the first `=` is passed verbatim, trimmed); print the cell's new value and, if other cells changed, `(also: B2=10, C1=...)`.
- `:sheet Name` adds a sheet; `:show` prints all non-empty cells sorted; `:help`.
- Values print like Excel's General format (`Value::to_text` / `format_general`), errors as `#DIV/0!`, booleans `TRUE`/`FALSE`, a cycle as `#NUM! (circular: A1 -> B1 -> A1)`.
- Parse errors print `error: <message> at <pos>` with a caret line under the input.

## Acceptance
- `printf '=SUM(1,2,3)*2\nA1 = 5\nB1 = =A1*2\n=B1+1\n' | cargo run -q -p engine-formula --example repl` prints `12`, `5`, `10`, `11` on four lines.
- `cargo clippy --workspace --all-targets -- -D warnings` (examples are included by `--all-targets`).
- No new dependencies (no rustyline).

## Part B – rustdoc hygiene (added by PM)
`RUSTDOCFLAGS="-D warnings" cargo doc --workspace --no-deps` must pass. Currently 5 intra-doc links from public docs to private items fail in `eval.rs:238`, `functions/logical/and.rs:8`, `functions/logical/or.rs:8`, `functions/text/text_.rs:9`, `graph.rs:11` – replace each `[`name`]` link with plain backticks (no code changes). Add the doc command to `.github/workflows/ci.yml` as a step in the `rust` job after `cargo test`. Rerun the command for the whole workspace and fix anything else it reports in the same way.
