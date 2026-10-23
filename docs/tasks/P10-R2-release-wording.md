# Task P10-R2 – Release wording keyed to the real signing status; small release follow-ups

Read `docs/tasks/COMMON.md` first (incl. "Cycle 3.1415"), then the P10-R1 report notes in STATUS.md, `docs/release-notes/3.1415.md`, `docs/store/listing/*.json` + `release-notes/*.txt` + `scripts/store/check-listing.mjs`, `scripts/gen-downloads.mjs` (the Downloads page headings), `scripts/versions-lib.test.sh`, `.github/workflows/ci.yml`.

Branch `p10/r2-release-wording`, worktree `/home/bojan/rusuite-wt/p10-r2-release-wording`. Model: Sonnet. e2e port 5032.

## Items (one commit each)
1. **Store texts must not claim what is not signed.** Today `whatsNew`, `fullDescription`/`description` and `release-notes/<lang>.txt` say "Signed desktop apps for Windows, macOS and Linux" in all 24 languages. Replace that bullet in every language with a wording that is true for the release as the PM will ship it: **the PM tells you the status when you start** (default assumption if no word: macOS signed and notarized, Linux GPG-signed, Windows not yet signed) → "Signed desktop apps for macOS (notarized) and Linux (GPG)" and nothing about Windows; keep every language's register and the glossary terms; `check-listing.mjs` stays green. Make the bullet easy to change later: add `scripts/store/signing-wording.mjs` that rewrites this one bullet in all 24 languages from a small table (`{ lang: { all: "…", macLinux: "…", none: "…" } }`) so that the PM can switch it with one command when Windows signing arrives (`node scripts/store/signing-wording.mjs macLinux|all|none`); unit test.
2. **Release notes trimming by `signing.json`.** `docs/release-notes/3.1415.md` keeps one line per OS; add to `docs/release.md` the exact PM step ("after the release run: open `signing.json` from the draft, delete the OS lines that say unsigned, keep the Gatekeeper/SmartScreen hint for them").
3. **Downloads page**: the "Desktop downloads" heading becomes "Downloads" (en/de keys; the other 22 via the pending policy – no: all 24 must stay strict-green, so translate the single key in every language yourself with the glossary); the mobile section title stays.
4. **CI**: `scripts/versions-lib.test.sh` runs in the `frontend` job (or a tiny `scripts` job) of `ci.yml`.

## Verification
`pnpm typecheck`; `pnpm test`; `pnpm i18n:check:strict` (0 findings); `node --test scripts/store/*.test.mjs scripts/gen-downloads.test.mjs`; `node scripts/store/check-listing.mjs`; `scripts/privacy-check.sh`; YAML parse of ci.yml; e2e `portal.spec.ts` on port 5032. Report (≤ 20 lines).
