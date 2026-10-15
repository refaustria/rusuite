#!/usr/bin/env bash
# Generate the PROVISIONAL formula reference suite (testdata/formulas/) with headless LibreOffice.
#   gen-formula-suite.sh                  build workbook, recalc with LibreOffice, write TSVs + xlsx
#   gen-formula-suite.sh --verify         check function coverage, TSV shape, source consistency
#   gen-formula-suite.sh --from-xlsx F    rewrite the TSVs from an Excel-recalculated copy F
#   gen-formula-suite.sh --force          regenerate even over TSVs that are no longer PROVISIONAL
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PY="$ROOT/scripts/testdata-src/formulas.py"
OUT="$ROOT/testdata/formulas"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

generate() {
  local force="$1"
  if [[ "$force" != 1 ]] && [[ -f "$OUT/math.tsv" ]] && ! head -n1 "$OUT/math.tsv" | grep -q PROVISIONAL; then
    echo "testdata/formulas holds non-provisional (Excel) values; use --force to overwrite" >&2
    exit 1
  fi
  mkdir -p "$TMP/in" "$TMP/out" "$OUT"
  python3 -I "$PY" build "$TMP/in/formula-suite.xlsx"
  # LibreOffice recalculates every formula cell without a cached value on load and writes the results on export.
  timeout 180 soffice --headless --norestore "-env:UserInstallation=file://$TMP/profile" \
    --convert-to "xlsx:Calc MS Excel 2007 XML" --outdir "$TMP/out" "$TMP/in/formula-suite.xlsx" \
    >"$TMP/soffice.log" 2>&1 || { cat "$TMP/soffice.log" >&2; exit 1; }
  local version
  version="$(soffice --headless "-env:UserInstallation=file://$TMP/profile" --version | head -n1 | awk '{print $1, $2}')"
  python3 -I "$PY" extract "$TMP/out/formula-suite.xlsx" "$OUT" --provisional "$version"
  cp "$TMP/out/formula-suite.xlsx" "$OUT/formula-suite.xlsx"
  cp "$ROOT/scripts/testdata-src/formulas.fixture.tsv" "$OUT/fixture.tsv"
  echo "wrote $OUT (${version})"
}

from_xlsx() {
  [[ -f "$1" ]] || { echo "no such file: $1" >&2; exit 2; }
  python3 -I "$PY" extract "$1" "$OUT"
  cp "$1" "$OUT/formula-suite.xlsx"
  cp "$ROOT/scripts/testdata-src/formulas.fixture.tsv" "$OUT/fixture.tsv"
}

case "${1:-}" in
  --verify) python3 -I "$PY" verify "$ROOT" ;;
  --from-xlsx) from_xlsx "${2:?usage: $0 --from-xlsx FILE}" ;;
  --force) generate 1 ;;
  "") generate 0 ;;
  *) echo "usage: $0 [--verify | --from-xlsx FILE | --force]" >&2; exit 2 ;;
esac
