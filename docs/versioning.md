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
- **Known constraint for the release after 3.141:** the MSI (WiX) version limits MINOR to 255, so `3.1415.0` cannot be
  used verbatim as `bundle.windows.wix.version`. The release task of that cycle maps it (for example `3.1.4159.0`:
  MAJOR.MINOR.BUILD with BUILD ≤ 65535 – `3.141592` then needs a different mapping). `scripts/versions-lib.sh
  wix_version` is the single place to change.
- `scripts/set-version.sh 3.141.0` sets every version string; `scripts/check-versions.sh` (CI) verifies them.
