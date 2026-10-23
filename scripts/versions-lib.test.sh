#!/usr/bin/env bash
# Unit test of scripts/versions-lib.sh (P10-R1): wix_version, public_version, version_code.
# Usage: scripts/versions-lib.test.sh
set -euo pipefail
cd "$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
# shellcheck source=scripts/versions-lib.sh
source scripts/versions-lib.sh
fail=0
eq() { # label actual expected
  if [ "$2" = "$3" ]; then echo "ok   $1: $2"; else echo "FAIL $1: got '$2', expected '$3'" >&2; fail=1; fi
}
eq "wix 3.1415.0" "$(wix_version 3.1415.0)" 3.14.15.0
eq "wix 3.14159.0" "$(wix_version 3.14159.0)" 3.14.159.0
eq "wix 3.141592.0" "$(wix_version 3.141592.0)" 3.14.1592.0
eq "wix 3.141.0" "$(wix_version 3.141.0)" 3.141.0
eq "wix 3.1415.2 (hotfix)" "$(wix_version 3.1415.2)" 3.14.15.2
eq "wix 0.1.0" "$(wix_version 0.1.0)" 0.1.0
eq "wix 0.1.0-rc.1" "$(wix_version 0.1.0-rc.1)" 0.1.0.1
eq "public 3.1415.0" "$(public_version 3.1415.0)" 3.1415
eq "public v3.141.0" "$(public_version v3.141.0)" 3.141
eq "public 3.1415.1" "$(public_version 3.1415.1)" 3.1415.1
eq "code 3.141.0" "$(version_code 3.141.0)" 3141000
eq "code 3.1415.0" "$(version_code 3.1415.0)" 4415000
eq "code 3.14159.0" "$(version_code 3.14159.0)" 17159000
# The MSI caveat (docs/versioning.md): Windows Installer compares MAJOR.MINOR.BUILD, so 3.141 → 3.14.15 is not an upgrade.
minor_of() { cut -d. -f2 <<<"$1"; }
if [ "$(minor_of "$(wix_version 3.141.0)")" -gt "$(minor_of "$(wix_version 3.1415.0)")" ]; then
  echo "ok   documented: MSI 3.141.0 > 3.14.15.0 in MINOR (no in-place MSI upgrade this once)"
else
  echo "FAIL expected the documented MSI non-upgrade" >&2; fail=1
fi
exit "$fail"
