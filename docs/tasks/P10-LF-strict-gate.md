# Task P10-LF – Languages: completeness pass for the 3.1415 keys (strict gate)

Runs after the last feature batch of the cycle (P10-M6) is merged. Read `docs/tasks/COMMON.md` first (incl. "Cycle 3.1415"; commit trailer – exactly the two lines), then `docs/i18n.md` ("Pending keys", "Review checklist", tone rule: informal address in every language), `docs/tasks/P9-LF-strict-gate.md` (the previous pass, same method).

Branch `p10/lf-strict`, worktree `/home/bojan/rusuite-wt/p10-lf-strict`. e2e port **5029**. Model: Opus.

## Goal
`pnpm i18n:check:strict` passes: every key added in cycle 3.1415 (ui-shared compact layout and bottom sheets, Calc/Write/Show touch, PDF export, mobile shells' messages, the portal's signing/Downloads texts) is translated in all 22 translated languages and the portal catalogs, with the same rules as before (informal register, Office terminology from `docs/i18n-glossary/<lang>.md`, key order = en.json, plural forms complete, no untranslated values outside the allow-lists).

## Method
1. `pnpm i18n:check` → pending keys per language and file (ui-shared, the three apps, `apps/portal/locales`). Translate language by language with the glossary; add missing glossary terms (touch vocabulary: tap, long press, pinch, handle, sheet, swipe – decide one term per language and record it).
2. Run the parameterised i18n e2e (`packages/e2e/tests/i18n.spec.ts`) for all translated languages on port 5029, and additionally the `compact` project at 412 px for **every** language (extend the clipping scan to the compact top/command bars and one sheet – short labels under the 44 px buttons must not clip; shorten translations or add a shorter `*.short` variant only if the UI already supports one – otherwise shorten the label itself and say so).
3. `docs/i18n.md`: status table rows "complete (strict) <date>"; `docs/release.md` gate note.

## Acceptance
`pnpm typecheck`; `pnpm test`; `pnpm i18n:check:strict` (0 findings); `scripts/privacy-check.sh`; the i18n e2e green for every translated language; the compact scan green for every language at 412 px. One commit per language group (≤ 6 commits) with the trailer. Report (≤ 30 lines): keys translated per language, label shortenings, remaining doubts (mt/ga/et/lv especially – the store texts of P10-M7 had the same note).
