// The release version (docs/versioning.md): the semver in the package files (`3.141.0`, set by
// scripts/set-version.sh) and the public name the apps show ("3.141").

import pkg from "../package.json";

/** The semver of this build, e.g. `3.141.0` (all package.json files carry the same one, scripts/check-versions.sh). */
export const RUSUITE_VERSION: string = pkg.version;

/**
 * The public name of a version (π numbering): a trailing `.0` patch is dropped (`3.141.0` → `3.141`); hotfixes and
 * pre-releases are kept as they are (`3.141.1`, `3.141.0-rc.1`). A leading `v` (a tag) is removed. Tags and file
 * names keep the full semver; the same rule is in scripts/gen-downloads.mjs, apps/portal/version.js and
 * .github/workflows/release.yml.
 */
export function publicVersion(semver: string): string {
  const v = semver.trim().replace(/^v/, "");
  const m = /^(\d+\.\d+)\.0$/.exec(v);
  return m ? m[1] : v;
}
