#!/usr/bin/env bash
# PM helper (P10-S1, docs/signing.md): creates the release signing key "Rusuite release key <release@rusuit.es>"
# (ed25519, valid 3 years) in its own keyring <dir>/gnupg, exports the public key to keys/rusuite-release-key.asc
# (committed) and the secret key to <dir>/rusuite-release-key.secret.asc (mode 600, for the GPG_PRIVATE_KEY secret),
# prints the fingerprint. The passphrase comes from GPG_PASSPHRASE (never an argument, never printed).
# Usage: GPG_PASSPHRASE=… gpg-key.sh [dir]     (default ~/rusuite-signing; KEYS_DIR overrides keys/, for tests)
set -euo pipefail
cd "$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
dir="${1:-$HOME/rusuite-signing}"
uid="Rusuite release key <release@rusuit.es>"
[ -n "${GPG_PASSPHRASE:-}" ] || { echo "gpg-key: set GPG_PASSPHRASE" >&2; exit 2; }
export GNUPGHOME="$dir/gnupg"
mkdir -p "$GNUPGHOME"
chmod 700 "$dir" "$GNUPGHOME"
if gpg --batch --list-secret-keys "=$uid" >/dev/null 2>&1; then
  echo "gpg-key: $GNUPGHOME already holds \"$uid\" – re-exporting it" >&2
else
  printf '%s' "$GPG_PASSPHRASE" | gpg --batch --quiet --pinentry-mode loopback --passphrase-fd 0 \
    --quick-generate-key "$uid" ed25519 sign 3y
fi
fpr="$(gpg --batch --with-colons --list-secret-keys "=$uid" | awk -F: '$1 == "fpr" { print $10; exit }')"
keys="${KEYS_DIR:-keys}"
mkdir -p "$keys"
gpg --batch --armor --export "$fpr" >"$keys/rusuite-release-key.asc"
(umask 077 && printf '%s' "$GPG_PASSPHRASE" | gpg --batch --quiet --pinentry-mode loopback --passphrase-fd 0 \
  --armor --export-secret-keys "$fpr" >"$dir/rusuite-release-key.secret.asc")
echo "gpg-key: public key $keys/rusuite-release-key.asc, secret key $dir/rusuite-release-key.secret.asc"
echo "fingerprint: $fpr"
gpg --batch --list-keys "$fpr" | head -n1
