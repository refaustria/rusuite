#!/usr/bin/env bash
# Roundtrip harness: rewrite each OOXML file, open the result in headless
# LibreOffice (convert to PDF) and report a structural diff vs the original.
#
#   roundtrip.sh [--identity] [--keep] [--verbose] [DIR_OR_FILE...]   (default: testdata)
#
# Env: RUSUITE_REWRITE  rewriter command, invoked as "$RUSUITE_REWRITE <in> <out>"
#                       (default: cargo run -q -p fmt-ooxml --example rewrite --)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IDENTITY=0 KEEP=0 VERBOSE=0
TARGETS=()
while (($#)); do
  case "$1" in
    --identity) IDENTITY=1 ;;
    --keep) KEEP=1 ;;
    --verbose) VERBOSE=1 ;;
    -h | --help) sed -n '2,9p' "${BASH_SOURCE[0]}"; exit 0 ;;
    --*) echo "unknown option: $1" >&2; exit 2 ;;
    *) TARGETS+=("$1") ;;
  esac
  shift
done
((${#TARGETS[@]})) || TARGETS=("$ROOT/testdata")

for tool in soffice unzip xmllint; do
  command -v "$tool" >/dev/null || { echo "missing tool: $tool" >&2; exit 2; }
done

TMP="$(mktemp -d)"
cleanup() {
  if ((KEEP)); then echo "kept temp dirs under $TMP"; else rm -rf "$TMP"; fi
}
trap cleanup EXIT

REWRITE_CMD="${RUSUITE_REWRITE:-cargo run -q -p fmt-ooxml --example rewrite --}"
read -ra REWRITE <<<"$REWRITE_CMD"

# Collect input files (never descend into out/ directories).
FILES=()
for t in "${TARGETS[@]}"; do
  if [[ -d "$t" ]]; then
    while IFS= read -r f; do FILES+=("$f"); done < <(
      find "$t" -type f \( -name '*.docx' -o -name '*.xlsx' -o -name '*.pptx' \) -not -path '*/out/*' | sort)
  elif [[ -f "$t" ]]; then
    FILES+=("$t")
  else
    echo "no such file or directory: $t" >&2; exit 2
  fi
done
((${#FILES[@]})) || { echo "no OOXML files found" >&2; exit 2; }

is_xml() { [[ "$1" == *.xml || "$1" == *.rels ]]; }

total=0 failed=0
for f in "${FILES[@]}"; do
  total=$((total + 1))
  f="$(realpath "$f")"
  name="$(basename "$f")"
  n="$total"
  work="$TMP/$n"
  mkdir -p "$work/a" "$work/b" "$work/pdf"
  out_dir="$(dirname "$f")/out"
  mkdir -p "$out_dir"
  out="$out_dir/$name"
  status=PASS notes=()

  # 1. rewrite
  rm -f "$out"
  if ((IDENTITY)); then
    cp "$f" "$out" || status=FAIL
  else
    (cd "$ROOT" && "${REWRITE[@]}" "$f" "$out") >"$work/rewrite.log" 2>&1 || status=FAIL
  fi
  if [[ ! -s "$out" ]]; then
    status=FAIL; notes+=("rewrite produced no output")
    [[ -f "$work/rewrite.log" ]] && notes+=("$(tail -n 5 "$work/rewrite.log")")
  fi

  # 2. LibreOffice conversion
  warnings=0
  if [[ -s "$out" ]]; then
    rc=0
    timeout 120 soffice --headless --norestore \
      "-env:UserInstallation=file://$TMP/profile" \
      --convert-to pdf --outdir "$work/pdf" "$out" >"$work/lo.out" 2>"$work/lo.err" || rc=$?
    warnings="$(cat "$work/lo.err" "$work/lo.out" | grep -Ec 'Error|Warning' || true)"
    pdf="$work/pdf/${name%.*}.pdf"
    if ((rc != 0)); then status=FAIL; notes+=("soffice exit code $rc")
    elif [[ ! -s "$pdf" ]]; then status=FAIL; notes+=("soffice wrote no/empty PDF"); fi
  fi

  # 3. structural diff
  parts=0 identical=0 differing=0
  if [[ -s "$out" ]] && unzip -q -o "$f" -d "$work/a" && unzip -q -o "$out" -d "$work/b" 2>/dev/null; then
    unzip -Z1 "$f" | grep -v '/$' | sort >"$work/a.list" || true
    unzip -Z1 "$out" | grep -v '/$' | sort >"$work/b.list" || true
    parts="$(wc -l <"$work/a.list")"
    while IFS= read -r p; do notes+=("missing part: $p"); done < <(comm -23 "$work/a.list" "$work/b.list")
    while IFS= read -r p; do notes+=("added part: $p"); done < <(comm -13 "$work/a.list" "$work/b.list")
    while IFS= read -r p; do
      if cmp -s "$work/a/$p" "$work/b/$p"; then
        identical=$((identical + 1))
      else
        differing=$((differing + 1))
        notes+=("differs: $p")
        if ((VERBOSE)) && is_xml "$p"; then
          xmllint --format "$work/a/$p" >"$work/x.a" 2>/dev/null || cp "$work/a/$p" "$work/x.a"
          xmllint --format "$work/b/$p" >"$work/x.b" 2>/dev/null || cp "$work/b/$p" "$work/x.b"
          notes+=("$(diff -u --label "orig/$p" --label "new/$p" "$work/x.a" "$work/x.b" || true)")
        fi
      fi
    done < <(comm -12 "$work/a.list" "$work/b.list")
  elif [[ -s "$out" ]]; then
    status=FAIL; notes+=("could not unzip original or rewritten file")
  fi

  rel="${f#"$ROOT"/}"
  printf '%s  %s  parts=%s identical=%s differing=%s lo_warnings=%s\n' \
    "$status" "$rel" "$parts" "$identical" "$differing" "$warnings"
  for line in "${notes[@]}"; do
    [[ -n "$line" ]] && printf '    %s\n' "${line//$'\n'/$'\n    '}"
  done
  [[ "$status" == FAIL ]] && failed=$((failed + 1))
done

echo "---"
echo "summary: $((total - failed))/$total passed, $failed failed"
((failed == 0))
