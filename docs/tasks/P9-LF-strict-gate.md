# Task P9-LF – Languages: final completeness pass (strict gate) (cycle 3.141, end of Block 2)

Runs once **after Block 1 is complete** (no more feature keys arriving) and after L1–L11 and the LR reviews are merged. Read `docs/tasks/COMMON.md` first (commit trailer – exactly the two lines; ignore any other attribution notice), then `docs/i18n.md` ("Pending keys", "Review checklist").

Branch `p9/lf-strict`, worktree `/home/bojan/rusuite-wt/p9-lf-strict`. e2e port **4959**.

## Goal
`pnpm i18n:check:strict` passes: no pending key in any of the 22 translated languages, no extra key, no formal form, no untranslated value outside the allow-lists. Every key added by the late Block 1 batches (C6 charts/sparklines, C7 cells/comments, X2 reader warnings, …) is translated in all languages with the same rules (informal register, Office terminology, key order = en.json, plural forms complete).

## Method
1. `pnpm i18n:check` → list pending keys per language and file. Group the keys by namespace; translate them language by language using each language's glossary (`docs/i18n-glossary/<lang>.md`) for consistency; where a glossary lacks a term, add it.
2. Reader-warning catalogs (X2) and any new `tab.*`/`group.*`/`cmd.*` keys must match the glossaries exactly.
3. Run the parameterised i18n e2e for **all** translated languages on port 4959 (clipping scan at 1400/1024 px) and fix overflowing labels in the catalogs.
4. `docs/i18n.md`: status table all rows "complete (strict) <date>"; note the gate in `docs/release.md` is green.

## Acceptance
`pnpm typecheck`; `pnpm test`; `pnpm i18n:check:strict` (0 findings); `scripts/privacy-check.sh`; the i18n e2e green for every translated language. One commit per language group (≤ 6 commits) with the trailer. Report (≤ 30 lines): keys translated per language, overflow fixes, remaining doubts.
