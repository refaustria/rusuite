#!/usr/bin/env bash
# Generate the 31 PROVISIONAL pptx reference files (testdata/pptx/provisional-NN-*.pptx) with headless
# LibreOffice, plus testdata/pptx/manifest.json describing their contents (docs/pptx-suite.md).
#   gen-pptx-suite.sh            generate (flat ODP from scripts/testdata-src/pptx/gen.py -> pptx)
#   gen-pptx-suite.sh --verify   check the committed files against the manifest
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GEN="$ROOT/scripts/testdata-src/pptx/gen.py"
OUT="$ROOT/testdata/pptx"
MAX_BYTES=81920

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

# Check every manifest entry in $1 (directory holding the pptx files and manifest.json).
verify_dir() {
  local dir="$1" fail=0 f pdf n
  mkdir -p "$TMP/pdf"
  n="$(python3 -I -c 'import json,sys; print(len(json.load(open(sys.argv[1]))))' "$dir/manifest.json")"
  if [[ "$n" != 31 ]]; then echo "FAIL manifest has $n entries, expected 31"; fail=1; fi
  while IFS= read -r f; do
    if [[ ! -s "$dir/$f" ]]; then echo "FAIL $f: missing"; fail=1; continue; fi
    if ! unzip -Z1 "$dir/$f" >"$TMP/zip.lst" 2>/dev/null || ! grep -qF '[Content_Types].xml' "$TMP/zip.lst"; then echo "FAIL $f: no [Content_Types].xml"; fail=1; continue; fi
    if (($(stat -c %s "$dir/$f") >= MAX_BYTES)); then echo "FAIL $f: 80 KB or larger"; fail=1; continue; fi
    if ! lo_convert "$TMP/pdf" pdf "$dir/$f"; then echo "FAIL $f: soffice failed"; fail=1; continue; fi
    pdf="$TMP/pdf/${f%.pptx}.pdf"
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
  lo_convert "$TMP/out" "pptx:Impress MS PowerPoint 2007 XML" "$TMP"/src/provisional-*.fodp
  python3 -I "$GEN" post "$TMP/out"
  cp "$TMP/src/manifest.json" "$TMP/out/manifest.json"
  verify_dir "$TMP/out"
  cp "$TMP"/out/provisional-*.pptx "$TMP/out/manifest.json" "$OUT/"
  echo "wrote $(find "$OUT" -name 'provisional-[0-9]*.pptx' | wc -l) files to testdata/pptx/"
}

case "${1:-}" in
  --verify) verify_dir "$OUT" ;;
  "") generate ;;
  *) echo "usage: $0 [--verify]" >&2; exit 2 ;;
esac
