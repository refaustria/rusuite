#!/usr/bin/env bash
# release.yml job `sign-linux` (P10-S1, docs/signing.md), only when the GPG_PRIVATE_KEY secret exists: downloads the
# installers of the draft release, writes a detached ASCII signature `<asset>.asc` for each Linux package (.deb, .rpm,
# .AppImage) and `SHA256SUMS` (sha256sum format) over every installer of every OS plus its signature `SHA256SUMS.asc`,
# checks all signatures and uploads them to the draft. Prints the key's fingerprint as `fingerprint=` on $GITHUB_OUTPUT.
#
# Usage: sign-release.sh <tag>
# Env:   GPG_PRIVATE_KEY (ASCII-armored secret key), GPG_PASSPHRASE (may be empty), GH_TOKEN/GH_REPO for `gh`.
#        SIGN_RELEASE_WORK (optional) – working directory to keep (tests); default a temp dir removed at exit.
set -euo pipefail
# shellcheck source=scripts/signing/lib.sh
source "$(dirname "$0")/lib.sh"

tag="${1:?usage: sign-release.sh <tag>}"
need GPG_PRIVATE_KEY

work="${SIGN_RELEASE_WORK:-$(mktemp -d)}"
[ -n "${SIGN_RELEASE_WORK:-}" ] || trap 'gpgconf --kill all >/dev/null 2>&1 || true; rm -rf "$work"' EXIT
export GNUPGHOME="$work/gnupg"
mkdir -p "$GNUPGHOME" "$work/assets" "$work/out"
chmod 700 "$GNUPGHOME"

printf '%s\n' "$GPG_PRIVATE_KEY" | gpg --batch --quiet --import 2>/dev/null
fpr="$(gpg --batch --with-colons --list-secret-keys | awk -F: '$1 == "fpr" { print $10; exit }')"
[ -n "$fpr" ] || { echo "sign-release: GPG_PRIVATE_KEY holds no secret key" >&2; exit 1; }

sign() { # sign <file> <signature>
  printf '%s' "${GPG_PASSPHRASE:-}" | gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-fd 0 \
    --local-user "$fpr" --armor --detach-sign --output "$2" "$1"
}

# Installers only: not the updater archives, older signatures or the manifests.
gh release download "$tag" --dir "$work/assets" --clobber \
  --pattern '*.deb' --pattern '*.rpm' --pattern '*.AppImage' --pattern '*.msi' --pattern '*-setup.exe' --pattern '*.dmg'

shopt -s nullglob
cd "$work/assets"
linux=(*.deb *.rpm *.AppImage)
all=(*)
[ "${#linux[@]}" -gt 0 ] || { echo "sign-release: no Linux packages in release $tag" >&2; exit 1; }
for f in "${linux[@]}"; do sign "$f" "$work/out/$f.asc"; done
printf '%s\n' "${all[@]}" | LC_ALL=C sort | while IFS= read -r f; do sha256sum -- "$f"; done >"$work/out/SHA256SUMS"
sign "$work/out/SHA256SUMS" "$work/out/SHA256SUMS.asc"

# Check what we are about to publish.
sha256sum --check --quiet "$work/out/SHA256SUMS"
for f in "${linux[@]}"; do gpg --batch --quiet --verify "$work/out/$f.asc" "$f" 2>/dev/null; done
gpg --batch --quiet --verify "$work/out/SHA256SUMS.asc" "$work/out/SHA256SUMS" 2>/dev/null

cd "$work/out"
gh release upload "$tag" --clobber ./*.asc SHA256SUMS
echo "fingerprint=$fpr" >>"${GITHUB_OUTPUT:-/dev/null}"
echo "sign-release: ${#linux[@]} Linux package(s) signed, SHA256SUMS over ${#all[@]} installer(s), key $fpr"
