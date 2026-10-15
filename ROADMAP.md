# Roadmap – ideas beyond the README scope

Captured here, **not implemented** unless essential to the current phase. README is the authority on scope.

## Tooling / DX
- `cargo xtask` crate for dev commands (roundtrip, testdata generation) instead of shell scripts – shell is fine for Phase 0.
- Pre-commit hook running `cargo fmt --check` and `clippy`.
- Nightly CI job running the roundtrip harness against LibreOffice (slow; keep out of PR CI).

## Roundtrip harness
- Deterministic `gen-testdata.sh` (normalize zip mtimes) so regenerated provisional files are stable in git.
- PDF page-count / text comparison original vs rewritten as a visual-regression proxy.
- `--json` output for CI; clearer error when the rewriter example is missing.
- Manual validation checklist for real Office on Windows/macOS.

## core-model
- Validating deserializer for `Color::Theme.tint` (reject outside ±1 instead of clamping on resolve).
- proptest: Rgb → hex → Rgb roundtrip.
- TS type generation (ts-rs vs specta, ADR 0002) must handle the `kind`/`value` enum shape.

## fmt-ooxml
- Lenient open mode (fallback content type `application/octet-stream`, keep unparseable `.rels` raw) for real-world files.
- Preserve each part's original compression method; percent-decode relationship targets.
- Part index (HashMap) if packages with thousands of parts become slow.
- `PartName` helper to allocate the next free `/word/media/imageN.png`-style name.

## engine-formula (parser)
- Intersection (space) operator, union operator.
- Sheet-scoped names (`Sheet1!Name`), 3-D refs (`Sheet1:Sheet3!A1`), external workbook refs (`[1]Sheet1!A1`), structured table refs.
- R1C1 notation; `#SPILL!`/`#CALC!` literals and the spilled-range operator `A1#`.
- Per-end `$` flags on whole-column/row ranges (`$A:C` currently loses the `$`).
- Source spans on AST nodes for editor diagnostics.

## engine-formula (reference suite)
- Host-cell cases (`ROW()`, `COLUMN()` without args), implicit-intersection and spill cases once the evaluator exists.
- Second locale pass for `TEXT`/`VALUE`; cases for SUMIFS/COUNTIFS/XLOOKUP if they ever enter scope.
- Deferred functions list lives in `docs/functions.md`.

## Formats
- Compare rewritten files against Open XML SDK validator (Windows/.NET) in addition to LibreOffice – gives real "would Office repair this" signal.

## Later phases (noted while planning Phase 0)
- (none yet)
