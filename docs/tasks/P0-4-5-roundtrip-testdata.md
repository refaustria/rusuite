# Task P0-4 + P0-5 – Roundtrip harness and provisional reference files

Branch: `p0/roundtrip` (worktree `/home/bojan/rusuite-wt/p0-roundtrip`). In scope: `scripts/roundtrip.sh`, `scripts/gen-testdata.sh` (and any helper input files under `scripts/testdata-src/`), `testdata/docx/*`, `testdata/xlsx/*`, `testdata/pptx/*`, `testdata/README.md`, `docs/roundtrip.md`. Nothing under `crates/`.

## Goal
1. A harness that, for every OOXML file in `testdata/`, runs our rewriter, opens the result in headless LibreOffice, and reports pass/fail per file plus a structural diff versus the original.
2. A first set of PROVISIONAL reference files generated with LibreOffice headless, so the harness and the format crates have something to chew on until real-Office files arrive.

## Harness: `scripts/roundtrip.sh [DIR_OR_FILE...]` (default: `testdata`)
- Bash, `set -euo pipefail`, runs from any cwd (resolve repo root via `git rev-parse --show-toplevel` or the script's own location).
- Rewriter command: env `RUSUITE_REWRITE` (default `cargo run -q -p fmt-ooxml --example rewrite --`), invoked as `$RUSUITE_REWRITE <in> <out>`. `--identity` flag makes the harness use `cp` instead (lets the harness be tested before the rewriter exists – the fmt-ooxml example is being built by another agent in parallel and may not exist yet; your acceptance run uses `--identity`).
- For each input `testdata/<fmt>/<name>.<ext>`:
  1. rewrite into `testdata/<fmt>/out/<name>.<ext>` (`out/` is git-ignored already),
  2. convert the rewritten file with LibreOffice to PDF into a temp dir: `soffice --headless --norestore -env:UserInstallation=file://<private tmp profile dir> --convert-to pdf --outdir <tmp> <file>`; wrap with `timeout 120`; a run FAILS if soffice exits non-zero, writes nothing, or writes a 0-byte PDF; capture stderr and grep it for `Error`/`Warning` lines and count them,
  3. structural diff: unzip both original and rewritten into temp dirs; compare the sorted entry lists (report added/missing parts); for each common entry compare bytes; for XML entries that differ, show a `diff` of each after normalizing with `xmllint --format` (install `libxml2-utils` via apt if missing and document it in your report); report counts of identical/different parts,
  4. print one line per file: `PASS|FAIL  <path>  parts=<n> identical=<n> differing=<n> lo_warnings=<n>` and a final summary; exit code 1 if any file failed.
- Use a fresh private LibreOffice profile dir per run so parallel invocations do not collide; clean up temp dirs with a trap.
- `--keep` keeps temp dirs and prints their paths; `--verbose` prints the xmllint diffs.
- `docs/roundtrip.md`: how it works, how to interpret output, limitations (headless LibreOffice does not surface the "repair" dialog; a failed/empty conversion is our proxy; real Office validation is a manual step).

## Provisional reference files: `scripts/gen-testdata.sh`
Generate with LibreOffice headless (`soffice --headless --convert-to <ext>`) from source inputs you write under `scripts/testdata-src/` (HTML, flat ODF XML `.fodt/.fods/.fodp`, or CSV – your choice, pick what reliably yields the required content). Output into `testdata/<fmt>/` with the `provisional-` filename prefix. Required content:
- `testdata/docx/provisional-basic.docx`: Title, Heading 1, Heading 2, three body paragraphs with bold/italic/underline runs and one colored run, a bulleted list (3 items), a numbered list (3 items), a 3×3 table with a header row, one centered paragraph, one right-aligned paragraph.
- `testdata/docx/provisional-image.docx`: one paragraph + one inline PNG image (generate a small PNG with ImageMagick `convert` if available, otherwise write a minimal valid PNG via Python's `zlib`+`struct` – no PIL needed).
- `testdata/xlsx/provisional-basic.xlsx`: two sheets named `Data` and `Summary`. `Data`: header row (bold) with columns Item/Qty/Price/Total; 5 data rows with text, integers, decimals; `Total` column = `Qty*Price` formulas; a date cell; a boolean cell; a row with `=SUM(D2:D6)`, `=AVERAGE(C2:C6)`, `=IF(D7>100,"big","small")`. `Summary`: a cross-sheet formula `=Data!D7` and a text cell. At least one cell with fill color, one with a border, one with a number format `0.00`, one with `#,##0`.
- `testdata/xlsx/provisional-types.xlsx`: one sheet exercising value types: empty, integer, negative, decimal, large (1e15), text, text that looks like a number ('0123), TRUE/FALSE, date, time, percentage format, error `=1/0`.
- `testdata/pptx/provisional-basic.pptx`: 3 slides: title slide (title + subtitle), title+content slide with a bulleted list, blank slide with a rectangle, an ellipse and a text box (if your source format cannot express shapes, do as much as possible and list what is missing in the report).
- `testdata/README.md`: table of every file, origin (`LibreOffice 25.2 headless – PROVISIONAL, replace with real Office file`), and what it contains. State clearly that provisional files are not authoritative for "opens in MS Office" claims.
- Verify every generated file: `unzip -l` lists `[Content_Types].xml`; convert it back to PDF with soffice and check the PDF is non-empty; for xlsx additionally `unzip -p file xl/worksheets/sheet1.xml | grep -c '<f>'` must be ≥ 1 (formulas present as formulas, not just values). Put these checks into `gen-testdata.sh --verify`.
- The script must be idempotent and re-runnable; keep generated files small (< 100 KB each).

## Acceptance (run from the worktree root, paste tails)
```
bash scripts/gen-testdata.sh && bash scripts/gen-testdata.sh --verify
bash scripts/roundtrip.sh --identity testdata        # all PASS, exit 0
shellcheck scripts/*.sh                                # install via apt if missing; zero findings
cargo fmt --all --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace   # unchanged, must still pass
```
Commit the generated testdata files together with the scripts (one commit).
