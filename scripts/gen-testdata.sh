#!/usr/bin/env bash
# Generate PROVISIONAL OOXML reference files with headless LibreOffice.
#   gen-testdata.sh            generate into testdata/{docx,xlsx,pptx}/
#   gen-testdata.sh --verify   check the generated files
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/scripts/testdata-src"
OUT="$ROOT/testdata"

# name | source file | filter/extension | destination
FILES=(
  "docx/provisional-basic.docx|basic.fodt|docx:MS Word 2007 XML"
  "docx/provisional-image.docx|image.fodt|docx:MS Word 2007 XML"
  "xlsx/provisional-basic.xlsx|basic.fods|xlsx:Calc MS Excel 2007 XML"
  "xlsx/provisional-types.xlsx|types.fods|xlsx:Calc MS Excel 2007 XML"
  "pptx/provisional-basic.pptx|basic.fodp|pptx:Impress MS PowerPoint 2007 XML"
)

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Run soffice with a private profile. Args: outdir convert-to-spec input
lo_convert() {
  timeout 120 soffice --headless --norestore \
    "-env:UserInstallation=file://$TMP/profile" \
    --convert-to "$2" --outdir "$1" "$3" >"$TMP/soffice.log" 2>&1 || {
    cat "$TMP/soffice.log" >&2
    return 1
  }
}

generate() {
  mkdir -p "$TMP/src" "$TMP/out"
  convert -size 64x64 gradient:'#2060d0-#f0c030' "$TMP/pic.png"
  local b64
  b64="$(base64 -w0 "$TMP/pic.png")"
  local entry rel src spec base ext
  for entry in "${FILES[@]}"; do
    IFS='|' read -r rel src spec <<<"$entry"
    base="$(basename "$rel")"
    ext="${base##*.}"
    sed "s|@PNG_BASE64@|$b64|" "$SRC/$src" >"$TMP/src/${src}"
    lo_convert "$TMP/out" "$spec" "$TMP/src/$src"
    mkdir -p "$OUT/$(dirname "$rel")"
    cp "$TMP/out/${src%.*}.$ext" "$OUT/$rel"
    echo "generated $rel ($(stat -c %s "$OUT/$rel") bytes)"
  done
}

verify() {
  local fail=0 entry rel f pdf
  mkdir -p "$TMP/pdf"
  for entry in "${FILES[@]}"; do
    IFS='|' read -r rel _ <<<"$entry"
    f="$OUT/$rel"
    if [[ ! -s "$f" ]]; then echo "FAIL $rel: missing"; fail=1; continue; fi
    if ! unzip -l "$f" | grep -q '\[Content_Types\].xml'; then
      echo "FAIL $rel: no [Content_Types].xml"; fail=1; continue
    fi
    if (($(stat -c %s "$f") > 102400)); then echo "FAIL $rel: larger than 100 KB"; fail=1; continue; fi
    if ! lo_convert "$TMP/pdf" pdf "$f"; then echo "FAIL $rel: soffice failed"; fail=1; continue; fi
    pdf="$TMP/pdf/$(basename "${rel%.*}").pdf"
    if [[ ! -s "$pdf" ]]; then echo "FAIL $rel: empty PDF"; fail=1; continue; fi
    if [[ "$rel" == xlsx/* ]]; then
      if (($(unzip -p "$f" xl/worksheets/sheet1.xml | grep -c '<f[ >]') < 1)); then
        echo "FAIL $rel: no formulas in sheet1.xml"; fail=1; continue
      fi
    fi
    echo "OK   $rel"
  done
  return "$fail"
}

case "${1:-}" in
  --verify) verify ;;
  "") generate ;;
  *) echo "usage: $0 [--verify]" >&2; exit 2 ;;
esac
