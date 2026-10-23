#!/usr/bin/env bash
# Builds the "rusuite-office-check" pack (P8-41): files written by Rusuite's own writers, for the owner's check in
# real Microsoft Office before a release (docs/testing.md › Before tagging). Every file must open in Excel / Word /
# PowerPoint without a repair dialog and look like the original.
# Usage: scripts/office-check-pack.sh [out-dir]     (default: target/office-check) → rusuite-office-check-<version>.zip
# Contents: every testdata/xlsx workbook and the feature-rich testdata/docx documents (47–67 and the .dotx template,
# plus basic/image) read and written back by fmt-xlsx / fmt-docx (examples/rewrite), a slicer workbook built by
# fmt-xlsx's tests, every testdata/pptx deck written back by fmt-pptx, the decks the fmt-pptx examples build in code
# (10 slides, animations, charts, design, links, shapes) and the Harbor theme (.thmx). README.txt lists what each
# file checks. 3.1415 has no new file features (it is about phones, signing and PDF): the pack re-validates the files of
# 3.141, whose features stay listed first.
set -euo pipefail
export PATH="$HOME/.cargo/bin:$PATH"
cd "$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
# shellcheck source=scripts/versions-lib.sh
source scripts/versions-lib.sh

out="${1:-target/office-check}"
version="$(workspace_version)"
pack="$out/rusuite-office-check-$version"
rm -rf "$pack"
mkdir -p "$pack/excel" "$pack/word" "$pack/powerpoint"

# Each format crate has its own `rewrite` example (same binary name), so each runs through cargo.
for f in testdata/xlsx/*.xlsx; do cargo run -q --release -p fmt-xlsx --example rewrite -- "$f" "$pack/excel/$(basename "$f")"; done
for f in testdata/docx/provisional-{4[7-9],5[0-9],6[0-9]}-*.docx testdata/docx/provisional-64-*.dotx testdata/docx/provisional-basic.docx testdata/docx/provisional-image.docx; do
  [ -f "$f" ] && cargo run -q --release -p fmt-docx --example rewrite -- "$f" "$pack/word/$(basename "$f")"
done
for f in testdata/pptx/*.pptx; do cargo run -q --release -p fmt-pptx --example rewrite -- "$f" "$pack/powerpoint/$(basename "$f")"; done
for ex in build_deck anim_deck charts_deck design_deck links_deck shapes_deck; do
  cargo run -q --release -p fmt-pptx --example "$ex" -- "$pack/powerpoint/rusuite-$ex.pptx"
done
cargo run -q --release -p fmt-pptx --example theme_file -- "$pack/powerpoint/rusuite-harbor.thmx"
# Slicers on a table and a PivotTable (no LibreOffice-made reference exists; the test builds the workbook).
RUSUITE_SLICER_OUT="$(realpath "$pack/excel")" cargo test -q --release -p fmt-xlsx --test tables_c2 table_and_pivot_slicers_round_trip >/dev/null
cat >"$pack/README.txt" <<TXT
Rusuite $(public_version "$version") ($version) – Office check pack
Every file here was written by Rusuite. Open each one in Microsoft Excel, Word or PowerPoint (Windows or macOS):
- no "We found a problem with some content" / repair dialog,
- content, formatting, charts, pivots, comments, animations as in the source (testdata/ in the repository),
- save it in Office and reopen it in Rusuite (https://rusuit.es/) without warnings.
Report problems with the file name and a screenshot.

3.1415 adds no new file features and changes no file format: the Calc, Write and Show writers are the ones of 3.141.
This pack therefore re-validates 3.141's files with the 3.1415 build. Nothing in it is specific to phones, signing
or PDF export (look at PDF export separately: File › Export PDF in the apps, open the PDF in any viewer).

Features of 3.141 – please look at these first:
Excel
- excel/provisional-protection.xlsx: sheet and workbook protection – try editing a locked cell, then Review ›
  Unprotect Sheet with password "test" (both sheets: the legacy and the SHA-512 hash) and Protect Workbook with "wb".
- excel/rusuite-slicers.xlsx: two slicers, one on a table and one on a PivotTable, with selections (West;
  East + North). Click the slicer buttons: the table and the pivot must filter.
- excel/provisional-charts-c6.xlsx: sparklines (Insert › Sparklines look, colours), new chart elements – chart and
  plot area fills/borders/shadows, rotated labels, error bars, data tables, up/down bars, high-low lines, per-point
  labels and labels from cells, manual layouts, a chart sheet.
- excel/provisional-pivot-c3.xlsx: pivot grouping (dates by years/quarters/months, numbers), calculated fields and
  items, label/value/Top 10 filters, Distinct Count, Show Values As, a PivotChart.
- excel/provisional-condfmt-c5.xlsx: "A Date Occurring", above/below average with σ, Excel 2010 data bars (solid,
  border, negative colour, axis), cross-sheet validation lists.
- excel/provisional-cells-c7.xlsx: threaded comments with @mentions, split panes and the saved top-left cell,
  pictures with crop/border, hyperlink colours.
- excel/provisional-tables.xlsx: custom table styles.
PowerPoint
- powerpoint/rusuite-shapes_deck.pptx: tables with PowerPoint table styles, a freeform (the same kind of shape the
  presenter's kept ink becomes), presets and glued connectors.
- powerpoint/provisional-29-table.pptx: table styles, merged cells (compare with the source in testdata/pptx).
- powerpoint/rusuite-anim_deck.pptx: slides 8 and later – Float In/Split and the other new entrance/exit/emphasis
  effects, motion paths, by-paragraph builds, triggers, the PowerPoint 2010+ transitions.
- powerpoint/provisional-35-animations2.pptx: animations round 2 (media trim, bookmarks, fades).
- powerpoint/provisional-34-views-design.pptx: custom shows, gradient/pattern backgrounds, effects, guides, zoom.
- powerpoint/rusuite-harbor.thmx: Design › Browse for Themes in PowerPoint – the theme, its master and the custom
  layout "Quote" must apply.
Word
- word/provisional-51-multilevel-legal-numbering.docx and the lists in word/provisional-47-report.docx: lists,
  List Paragraph spacing, numbering (Home › Numbering/Multilevel List show the levels).
- word/provisional-66-tables-2-columns-symbols.docx: split/floating tables, borders, unequal columns, symbols.
- word/provisional-67-comments-notes-fields-2.docx: formatted comments, @mentions, comments in footnotes, fields
  (SECTIONPAGES, STYLEREF, SEQ, REF) – press F9 in Word: the values must stay.
- word/provisional-65-drawings-floating-2.docx: grouped shapes, linked text boxes, cropping, wrapping.
- word/provisional-64-template-memo.dotx: opens as a template (File › New from it in Word).
TXT
(cd "$out" && rm -f "rusuite-office-check-$version.zip" && python3 -I -m zipfile -c "rusuite-office-check-$version.zip" "rusuite-office-check-$version")
echo "office-check-pack: $out/rusuite-office-check-$version.zip ($(find "$pack" -name '*.*x' | wc -l) files)"
