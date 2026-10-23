#!/usr/bin/env bash
# PM helper (P10-S1, docs/signing.md): bundles an Apple certificate (.cer, DER as App Store Connect delivers it, or
# PEM) with its private key into a .p12 for the APPLE_CERTIFICATE secret. The password comes from P12_PASSWORD (never
# an argument, never printed). 3DES/SHA-1 PBE + SHA-1 MAC, the encryption macOS `security import` reads on every
# runner image (OpenSSL 3's AES default is not imported by older macOS keychains).
# Usage: P12_PASSWORD=… p12.sh <cer> <key> <out.p12>
#   then: base64 -w0 <out.p12>  → APPLE_CERTIFICATE (docs/signing.md shows the `gh secret set` line)
set -euo pipefail
[ $# -eq 3 ] || { echo "usage: P12_PASSWORD=… $0 <cer> <key> <out.p12>" >&2; exit 2; }
cer="$1" key="$2" out="$3"
[ -n "${P12_PASSWORD:-}" ] || { echo "p12: set P12_PASSWORD" >&2; exit 2; }
[ ! -e "$out" ] || { echo "p12: $out exists – not overwriting" >&2; exit 1; }
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
if grep -q -- '-----BEGIN CERTIFICATE-----' "$cer" 2>/dev/null; then cp "$cer" "$tmp/cert.pem"; else openssl x509 -inform DER -in "$cer" -out "$tmp/cert.pem"; fi
# The certificate must belong to the key.
[ "$(openssl x509 -in "$tmp/cert.pem" -noout -pubkey | openssl sha256)" = "$(openssl pkey -in "$key" -pubout | openssl sha256)" ] ||
  { echo "p12: $cer does not match the key $key" >&2; exit 1; }
name="$(openssl x509 -in "$tmp/cert.pem" -noout -subject -nameopt multiline | sed -n 's/^ *commonName *= *//p' | head -n1)"
(umask 077 && openssl pkcs12 -export -inkey "$key" -in "$tmp/cert.pem" -out "$out" -name "${name:-Rusuite}" \
  -passout env:P12_PASSWORD -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1)
echo "p12: wrote $out for \"${name:-Rusuite}\" (expires $(openssl x509 -in "$tmp/cert.pem" -noout -enddate | cut -d= -f2))"
