#!/usr/bin/env bash
# Generates apps/calc/src/formula/functions.json (name, signature,
# description) from the function tables of docs/functions.md, for Calc's
# formula autocomplete and signature tips. Re-run after editing the doc.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
src="$root/docs/functions.md"
out="$root/apps/calc/src/formula/functions.json"

# Table rows look like: | `SUM` | `SUM(number1, ...)` | Sum of numbers | ... |
grep -E '^\| `[A-Z][A-Z0-9.]*` \| `' "$src" \
  | LC_ALL=C sort -t'`' -k2,2 \
  | awk -F' \\| ' '
    function json(s) { gsub(/\\/, "\\\\", s); gsub(/"/, "\\\"", s); return s }
    function strip(s) { gsub(/`/, "", s); sub(/^[| ]+/, "", s); sub(/[ |]+$/, "", s); return s }
    BEGIN { print "[" }
    {
      name = strip($1); sig = strip($2); desc = strip($3)
      printf "%s  { \"name\": \"%s\", \"signature\": \"%s\", \"description\": \"%s\" }", (NR > 1 ? ",\n" : ""), json(name), json(sig), json(desc)
    }
    END { print "\n]" }
  ' > "$out"

echo "wrote $(grep -c '"name"' "$out") functions to ${out#"$root"/}"
