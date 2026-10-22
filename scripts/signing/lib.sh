# shellcheck shell=bash
# Shared helpers of the release workflow's signing steps (P10-S1, docs/signing.md). Sourced, not executed.
# Nothing here prints a secret: values only go to $GITHUB_ENV / files, never to stdout or stderr.

# put NAME VALUE – append NAME=VALUE to $GITHUB_ENV (multi-line safe: heredoc form with a random delimiter).
put() {
  local name="$1" value="$2" delim
  [ -n "${GITHUB_ENV:-}" ] || { echo "signing: GITHUB_ENV is not set" >&2; return 1; }
  delim="RUSUITE_$(od -An -N12 -tx1 /dev/urandom | tr -d ' \n')"
  case "$value" in *"$delim"*) echo "signing: value of $name contains the delimiter" >&2; return 1 ;; esac
  printf '%s<<%s\n%s\n%s\n' "$name" "$delim" "$value" "$delim" >>"$GITHUB_ENV"
}

# need NAME... – fail (naming the variable, not its value) when one of them is empty.
need() {
  local n missing=0
  for n in "$@"; do
    if [ -z "${!n:-}" ]; then echo "signing: $n is empty (repository secret missing?)" >&2; missing=1; fi
  done
  return "$missing"
}
