# Versioning – π numbering (owner decision 2026-10-17)

From the cycle after v0.1.0 on, Rusuite versions follow the digits of **π**. Each development cycle ends with one
release whose public name has one more digit than the previous one:

| Cycle | Public name | Semver used in the files | Git tag |
| --- | --- | --- | --- |
| first "π" cycle (this one) | **3.141** | `3.141.0` | `v3.141.0` |
| next | 3.1415 | `3.1415.0` | `v3.1415.0` |
| then | 3.14159 | `3.14159.0` | `v3.14159.0` |

- **Why a semver behind the name:** Cargo, Tauri and npm require `MAJOR.MINOR.PATCH`. The digits after "3." form the
  MINOR number, which grows monotonically (141 < 1415 < 14159), so dependency ordering and `check-versions.sh` keep
  working. The PATCH is `0` for the cycle release; a hotfix inside a cycle bumps it (`3.141.1`, shown as "3.141.1").
- **Public name:** the release title, the portal Downloads page, the About/backstage version and the release notes show
  the name without the trailing `.0` ("Rusuite 3.141"). `scripts/gen-downloads.*` and the shells' version display strip
  it; tags and file names keep the full semver.
- **Build only at the end of a cycle:** no version bump, tag or installer build until every block of the cycle is
  merged and verified (owner rule). CI keeps running on every merge; the web at rusuit.es is deployed from `main` after
  each verified merge as before (each merged task is complete on its own).
- **MSI (WiX) mapping:** WiX limits MINOR to 255, so `3.1415.0` cannot be used verbatim as `bundle.windows.wix.version`.
  `scripts/versions-lib.sh wix_version` maps MINOR > 255 to `MAJOR.<first two digits>.<remaining digits>.PATCH`:
  `3.1415.0` → `3.14.15.0`, `3.14159.0` → `3.14.159.0`, `3.141592.0` → `3.14.1592.0`; `3.141.0` stays. Windows Installer
  compares MAJOR.MINOR.BUILD, so the MSI of 3.1415 (MINOR 14) is **not** an upgrade of the MSI of 3.141 (MINOR 141):
  accepted once (PM decision); the NSIS `.exe` installer upgrades fine, MSI users uninstall 3.141 first.
- Android `versionCode` and the iOS build number use `major·10⁶ + minor·10³ + patch` (3.141.0 → 3141000, 3.1415.0 →
  4415000) and stay monotonic; `scripts/check-versions.sh` asserts it against the earlier releases' notes.
- `scripts/set-version.sh 3.141.0` sets every version string; `scripts/check-versions.sh` (CI) verifies them.
