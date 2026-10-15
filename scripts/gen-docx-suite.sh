#!/usr/bin/env bash
# Generate the 50 PROVISIONAL docx reference files (testdata/docx/provisional-NN-*.docx) with headless
# LibreOffice, plus testdata/docx/manifest.json describing their contents (docs/docx-suite.md).
#   gen-docx-suite.sh            generate (flat ODT from scripts/testdata-src/docx/gen.py -> docx)
#   gen-docx-suite.sh --verify   check the committed files against the manifest
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GEN="$ROOT/scripts/testdata-src/docx/gen.py"
OUT="$ROOT/testdata/docx"
MAX_BYTES=61440

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Run soffice with a private profile. Args: outdir convert-to-spec input...
lo_convert() {
  local outdir="$1" spec="$2"
  shift 2
  timeout 300 soffice --headless --norestore \
    "-env:UserInstallation=file://$TMP/profile" \
    --convert-to "$spec" --outdir "$outdir" "$@" >"$TMP/soffice.log" 2>&1 || {
    cat "$TMP/soffice.log" >&2
    return 1
  }
}

# Check every manifest entry in $1 (directory holding the docx files and manifest.json).
verify_dir() {
  local dir="$1" fail=0 f pdf n
  mkdir -p "$TMP/pdf"
  n="$(python3 -I -c 'import json,sys; print(len(json.load(open(sys.argv[1]))))' "$dir/manifest.json")"
  if [[ "$n" != 50 ]]; then echo "FAIL manifest has $n entries, expected 50"; fail=1; fi
  while IFS= read -r f; do
    if [[ ! -s "$dir/$f" ]]; then echo "FAIL $f: missing"; fail=1; continue; fi
    if ! unzip -l "$dir/$f" | grep -q '\[Content_Types\].xml'; then echo "FAIL $f: no [Content_Types].xml"; fail=1; continue; fi
    if (($(stat -c %s "$dir/$f") >= MAX_BYTES)); then echo "FAIL $f: 60 KB or larger"; fail=1; continue; fi
    if ! lo_convert "$TMP/pdf" pdf "$dir/$f"; then echo "FAIL $f: soffice failed"; fail=1; continue; fi
    pdf="$TMP/pdf/${f%.docx}.pdf"
    if [[ ! -s "$pdf" ]]; then echo "FAIL $f: empty PDF"; fail=1; continue; fi
    echo "OK   $f"
  done < <(python3 -I -c 'import json,sys; print("\n".join(e["file"] for e in json.load(open(sys.argv[1]))))' "$dir/manifest.json")
  python3 -I "$GEN" check "$dir/manifest.json" "$dir" || fail=1
  return "$fail"
}

generate() {
  mkdir -p "$TMP/src" "$TMP/png" "$TMP/out" "$OUT"
  convert -size 48x48 gradient:'#2060d0-#f0c030' "$TMP/png/img0.png"
  convert -size 48x48 pattern:checkerboard "$TMP/png/img1.png"
  convert -size 48x48 -seed 7 plasma:fractal -colors 16 "$TMP/png/img2.png"
  python3 -I "$GEN" emit "$TMP/src" "$TMP/png"
  lo_convert "$TMP/out" "docx:MS Word 2007 XML" "$TMP"/src/provisional-*.fodt
  cp "$TMP/src/manifest.json" "$TMP/out/manifest.json"
  verify_dir "$TMP/out"
  cp "$TMP"/out/provisional-*.docx "$TMP/out/manifest.json" "$OUT/"
  echo "wrote $(find "$OUT" -name 'provisional-[0-9]*.docx' | wc -l) files to testdata/docx/"
}

case "${1:-}" in
  --verify) verify_dir "$OUT" ;;
  "") generate ;;
  *) echo "usage: $0 [--verify]" >&2; exit 2 ;;
esac
