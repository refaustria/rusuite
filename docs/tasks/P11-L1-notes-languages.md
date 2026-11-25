# Task P11-L1 – Notes: 22 more languages + translated converter warnings

Read `docs/tasks/COMMON.md` (incl. "Cycle 3.14159"), `docs/i18n.md`, `docs/i18n-glossary/README.md` and the existing
glossaries `docs/i18n-glossary/<lang>.md`, and **`docs/tasks/P9-L-translation-template.md`** – its "Owner rules
(binding)" (informal address in every language, Microsoft Office terminology – here OneNote's localisation for
Notes-specific terms: notebook, section, section group, page, subpage, tag, To Do, Draw, ink, pen, highlighter,
lasso, recycle bin, page history …, placeholders/plurals/brands untouched) and the "decisions already taken" apply
unchanged.

Branch `p11/l1-notes-languages`, worktree `/home/bojan/rusuite-wt/p11-l1-notes-languages`. Model: Sonnet. e2e port 5141.

## Items
1. **Catalogs:** for each of the 22 languages (bg, cs, da, el, es, et, fi, fr, ga, hr, hu, it, lt, lv, mt, nl, pl,
   pt, ro, sk, sl, sv) translate every pending key: `apps/notes/src/locales/<lang>.json` (~480 keys) and the new
   portal keys in `apps/portal/locales/<lang>.json` (~6, Notes tile/privacy/downloads). Key order equal to `en.json`.
   Add the Notes/OneNote terms you use to each `docs/i18n-glossary/<lang>.md` (section "Notes").
2. **Converter warnings (small code change):** `crates/notes-convert` warnings carry a stable `code` + `params`
   (`ConvertWarning`, `warn.rs`) and an English `text`. Collect every code the converters emit (grep the `warn(`
   call sites incl. codes built from variables), add catalog keys `notes.convertWarning.<code>` (en + de + 22) with
   the same placeholders as the params, and make `apps/notes/src/ui/ImportExport.tsx` render the translated key with
   the params (and the ` (Nx)` count via a plural key), falling back to the English `text` for an unknown code. A
   Vitest test: known code → translated, unknown code → English text. No Rust changes unless a code is not stable –
   then say so.
3. `pnpm i18n:check --strict` must be green (0 pending in all 24 languages) – this is the cycle's language gate.

## Method
Work language by language (one commit per 2–4 languages is fine, each with the trailer). Self-review 50 random
strings per language against the glossary and the register rule; report how many you changed. Check ribbon fit for the
Notes ribbon (Home, Insert, Draw, View, Share) at 1400 px and 1024 px with the e2e `I18N_SHOTS` option for at least
fr, de, fi, hu, el (long-word languages) – fix strings, not the UI.

## Acceptance (worktree root)
`pnpm typecheck`; `pnpm test`; `pnpm i18n:check --strict`; `scripts/privacy-check.sh`; full e2e with
`BASE_URL=http://127.0.0.1:5141` and your own `E2E_PORT=5141 node packages/e2e/serve.mjs` (build `notes` web first:
`pnpm --filter notes build:web`); `docs/i18n.md` table mentions Notes translated (date). Stop servers by real PID.

## In scope
`apps/notes/src/locales/**`, `apps/portal/locales/**`, `apps/notes/src/ui/ImportExport.tsx` (+ its test),
`docs/i18n-glossary/**`, `docs/i18n.md`, `scripts/i18n-allow/**` (with reasons).

## Report (≤ 40 lines): keys per language, warning codes covered, self-review changes, overflow fixes, test/e2e results,
keys you could not translate confidently.
