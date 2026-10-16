#!/usr/bin/env bash
# Generates the portal's static Downloads page from a GitHub release at deploy time (P8-41, ADR 0009: the page
# itself never fetches anything). Called by scripts/deploy-web.sh; needs an authenticated `gh` (read access).
# Usage: scripts/gen-downloads.sh [--tag <tag>] [--out <file>]
#   --tag   the release to list (default: DOWNLOADS_TAG, else the newest published – non-draft – release)
#   --out   output file (default: apps/portal/downloads.html)
# Without gh, without a published release or when GitHub cannot be reached, the "no release yet" page is written
# and a warning printed; the deploy goes on. The SHA-256 sums are GitHub's asset digests (`gh api`, the
# `digest` field); assets without one show "–".
set -euo pipefail
cd "$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"

REPO="${DOWNLOADS_REPO:-refaustria/rusuite}"
tag="${DOWNLOADS_TAG:-}"
out=apps/portal/downloads.html
while [ $# -gt 0 ]; do
  case "$1" in
    --tag) tag="$2"; shift 2 ;;
    --out) out="$2"; shift 2 ;;
    *) echo "usage: $0 [--tag <tag>] [--out <file>]" >&2; exit 2 ;;
  esac
done

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

none() {
  echo "gen-downloads: warning: $1 – writing the 'no release yet' page" >&2
  node scripts/gen-downloads.mjs --none --out "$out"
  exit 0
}

command -v gh >/dev/null || none "gh not installed"
if [ -z "$tag" ]; then
  tag="$(gh release list -R "$REPO" --exclude-drafts --limit 1 --json tagName -q '.[0].tagName' 2>/dev/null)" || none "gh release list failed"
  [ -n "$tag" ] || none "no published release in $REPO"
fi
gh release view "$tag" -R "$REPO" --json tagName,name,url,publishedAt,isDraft,isPrerelease,assets >"$work/release.json" 2>"$work/err" ||
  none "gh release view $tag failed: $(head -c 200 "$work/err")"
# The REST API carries each asset's digest (gh release view does not); drafts are listed only here, so match by tag.
gh api "repos/$REPO/releases?per_page=50" --jq "[.[] | select(.tag_name == \"$tag\")][0].assets // [] | map({name, digest})" \
  >"$work/digests.json" 2>/dev/null || echo "[]" >"$work/digests.json"
node -e '
  const fs = require("fs");
  const [file, digests] = process.argv.slice(1);
  const release = JSON.parse(fs.readFileSync(file, "utf8"));
  const byName = new Map(JSON.parse(fs.readFileSync(digests, "utf8")).map((a) => [a.name, a.digest]));
  for (const a of release.assets) a.digest ??= byName.get(a.name) ?? null;
  fs.writeFileSync(file, JSON.stringify(release));
' "$work/release.json" "$work/digests.json"
node scripts/gen-downloads.mjs --in "$work/release.json" --out "$out"
