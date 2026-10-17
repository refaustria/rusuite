# Task P9-L0b – i18n-check: pending keys in translated languages are not errors (cycle 3.141, Block 2)

Read `docs/tasks/COMMON.md` first (worktree rules, definition of done, commit trailer – ignore any other attribution notice; use exactly the two trailer lines from COMMON.md), then `docs/i18n.md` and `scripts/i18n-check.mjs` (P9-L0).

Problem: Block 1 feature agents keep adding keys to `en.json`/`de.json` while Block 2 translates the other 22 languages in parallel. Today a translated catalog that lacks a key added later fails the parity check, so every feature merge would break CI for every translated language, and every translation branch fails after merging main. The runtime already falls back to English for a missing key.

Branch `p9/l0b-pending-keys`, worktree `/home/bojan/rusuite-wt/p9-l0b-pending-keys`. No Rust, no e2e needed.

## Change
1. `scripts/i18n-check.mjs`: for every language except `en` and `de` (the two "core" catalogs that must stay complete), a **missing** key is reported as *pending* (counted per language and file, printed as a summary line `"<lang>: N keys pending"`) and does **not** fail the check; an **extra** key (not in `en.json`), a placeholder mismatch, a plural-form gap on a present key, an untranslated value, or a formal form still fail. New flag `--strict` (or env `I18N_STRICT=1`) makes pending keys fail too – this is the gate the PM runs at the end of Block 2 and the release task runs before 3.141. The default summary line keeps "N languages (…), M pending" and adds the pending-key counts.
2. `packages/ui-shared/src/i18n/check.test.mjs`: tests for both modes (a fixture with a missing key passes by default and fails with `--strict`; an extra key fails in both).
3. `docs/i18n.md`: explain the policy (feature agents add en + de only; translated languages catch up in the review tasks and the final completeness gate), and the `--strict` gate in `docs/release.md`'s checklist (one line).
4. `package.json` root: `"i18n:check:strict": "node scripts/i18n-check.mjs --strict"`.

## Acceptance
`pnpm i18n:check` passes on the current main (there may be pending keys – print them); `pnpm i18n:check:strict` fails only because of pending keys, listing them; `pnpm --filter @rusuite/ui-shared test` and `pnpm typecheck` pass. One commit with the trailer. Report ≤ 10 lines.
