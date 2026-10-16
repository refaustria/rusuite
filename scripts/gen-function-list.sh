#!/usr/bin/env bash
# Generates apps/calc/src/formula/functions.json (name, signature,
# description, category) from the function tables of docs/functions.md, for
# Calc's formula autocomplete, signature tips and the Formulas tab's
# function library (category = the `## Section` the row is in). Re-run
# after editing the doc.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
src="$root/docs/functions.md"
out="$root/apps/calc/src/formula/functions.json"

# Table rows look like: | `SUM` | `SUM(number1, ...)` | Sum of numbers | ... |
awk '
    /^## / {
      h = tolower($0)
      if (h ~ /math/) cat = "math"
      else if (h ~ /logical/) cat = "logical"
      else if (h ~ /information/) cat = "info"
      else if (h ~ /lookup|dynamic/) cat = "lookup"
      else if (h ~ /date/) cat = "datetime"
      else if (h ~ /statistical/) cat = "statistical"
      else if (h ~ /financial/) cat = "financial"
      else if (h ~ /text/) cat = "text"
      else cat = "other"
    }
    /^\| `[A-Z][A-Z0-9.]*` \| `/ { print cat "\t" $0 }
  ' "$src" \
  | LC_ALL=C sort -t'`' -k2,2 \
  | awk -F'\t' '
    function json(s) { gsub(/\\/, "\\\\", s); gsub(/"/, "\\\"", s); return s }
    function strip(s) { gsub(/`/, "", s); sub(/^[| ]+/, "", s); sub(/[ |]+$/, "", s); return s }
    BEGIN { print "[" }
    {
      cat = $1
      n = split($2, f, / \| /)
      name = strip(f[1]); sig = strip(f[2]); desc = strip(f[3])
      printf "%s  { \"name\": \"%s\", \"signature\": \"%s\", \"description\": \"%s\", \"category\": \"%s\" }", (NR > 1 ? ",\n" : ""), json(name), json(sig), json(desc), cat
    }
    END { print "\n]" }
  ' > "$out"

echo "wrote $(grep -c '"name"' "$out") functions to ${out#"$root"/}"
