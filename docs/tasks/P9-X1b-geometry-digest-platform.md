# Task P9-X1b – Geometry equivalence digests must be platform-independent (cycle 3.141, fix)

Read `docs/tasks/COMMON.md` first (commit trailer – exactly the two lines; ignore any other attribution notice). CI on `main` fails in `crates/core-model/tests/geometry_equivalence.rs` (`preset_geometry_is_unchanged`): the digests of `cloud`, `star5` and `cloudCallout` differ on the GitHub runner from the committed snapshot while they pass on the dev server – these presets use trigonometry, and the digest hashes exact `f64` output, so libm/FMA differences change it. Run 39093518835 shows the diff.

Branch `p9/x1b-geometry-digest`, worktree `/home/bojan/rusuite-wt/p9-x1b-geometry-digest`. `CARGO_INCREMENTAL=0`; delete `target/` before reporting.

## In scope
`crates/core-model/tests/geometry_equivalence.rs`, `crates/model-show/tests/geometry_equivalence.rs`, `apps/show/core/tests/geometry_equivalence.rs`, `apps/write/core/tests/geometry_equivalence.rs` and their `snapshots/`; `docs/testing.md` (one paragraph). Nothing else – do not change the geometry code itself.

## Change
1. Quantise every coordinate/number that goes into a digest to a platform-stable value before hashing: round to the nearest integer EMU (or, for normalised 0–1 values, to 1e-6) and format that; keep everything else in the digest as is. The property the tests protect (the move in P9-X1 changed nothing) still holds because both the recorded and the computed side go through the same quantisation.
2. Regenerate the four snapshots on this machine (`cargo insta test --accept` or `INSTA_UPDATE=always`), check them in, and run each test once with `CI=true` locally.
3. `docs/testing.md`: a sentence under the snapshot guidance – digests of floating-point geometry must be quantised; why.

## Acceptance
`cargo fmt --all --check`; `cargo clippy --workspace --all-targets -- -D warnings`; `cargo test -p core-model -p model-show -p show-core -p write-core` with `CI=true`; one commit with the trailer. Report ≤ 10 lines, naming the quantisation you chose.
