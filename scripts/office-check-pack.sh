#!/usr/bin/env bash
# Builds the "rusuite-office-check" pack (P8-41): files written by Rusuite's own writers, for the owner's check in
# real Microsoft Office before a release (docs/testing.md › Before tagging). Every file must open in Excel / Word /
# PowerPoint without a repair dialog and look like the original.
# Usage: scripts/office-check-pack.sh [out-dir]     (default: target/office-check) → rusuite-office-check-<version>.zip
# Contents: every testdata/xlsx workbook and the feature-rich testdata/docx documents (47–64, plus basic/image) read
# and written back by fmt-xlsx / fmt-docx (examples/rewrite), every testdata/pptx deck written back by fmt-pptx, and
# the decks the fmt-pptx examples build in code (10 slides, animations, charts, design, links, shapes).
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
for f in testdata/docx/provisional-{4[7-9],5[0-9],6[0-4]}-*.docx testdata/docx/provisional-basic.docx testdata/docx/provisional-image.docx; do
  [ -f "$f" ] && cargo run -q --release -p fmt-docx --example rewrite -- "$f" "$pack/word/$(basename "$f")"
done
for f in testdata/pptx/*.pptx; do cargo run -q --release -p fmt-pptx --example rewrite -- "$f" "$pack/powerpoint/$(basename "$f")"; done
for ex in build_deck anim_deck charts_deck design_deck links_deck shapes_deck; do
  cargo run -q --release -p fmt-pptx --example "$ex" -- "$pack/powerpoint/rusuite-$ex.pptx"
done
cat >"$pack/README.txt" <<TXT
Rusuite $version – Office check pack
Every file here was written by Rusuite. Open each one in Microsoft Excel, Word or PowerPoint (Windows or macOS):
- no "We found a problem with some content" / repair dialog,
- content, formatting, charts, pivots, comments, animations as in the source (testdata/ in the repository),
- save it in Office and reopen it in Rusuite (https://resuite.inceptum.at/) without warnings.
Report problems with the file name and a screenshot.
TXT
(cd "$out" && rm -f "rusuite-office-check-$version.zip" && python3 -I -m zipfile -c "rusuite-office-check-$version.zip" "rusuite-office-check-$version")
echo "office-check-pack: $out/rusuite-office-check-$version.zip ($(find "$pack" -name '*.*x' | wc -l) files)"
