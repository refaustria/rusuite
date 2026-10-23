#!/usr/bin/env bash
# PM helper (P10-S1, docs/signing.md): a 2048-bit RSA key + certificate signing request (CN "Rusuite", C AT) for the
# Apple certificates (Developer ID Application, iOS/Apple Distribution) – upload the CSR with
# `asc.mjs certificates create --csr …`. The key never leaves the directory (mode 600); nothing secret is printed.
# Usage: make-csr.sh [dir] [name]     (default ~/rusuite-signing, name "rusuite-apple")
set -euo pipefail
dir="${1:-$HOME/rusuite-signing}"
name="${2:-rusuite-apple}"
key="$dir/$name.key"
csr="$dir/$name.csr"
mkdir -p "$dir"
chmod 700 "$dir"
[ ! -e "$key" ] || { echo "make-csr: $key exists – not overwriting a signing key (pick another name)" >&2; exit 1; }
(umask 077 && openssl genrsa -out "$key" 2048 2>/dev/null)
openssl req -new -key "$key" -out "$csr" -subj "/CN=Rusuite/C=AT"
echo "make-csr: key $key (keep private), CSR $csr"
openssl req -in "$csr" -noout -subject
