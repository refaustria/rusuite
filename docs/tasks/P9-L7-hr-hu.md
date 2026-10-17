# Task P9-L7 – Languages: Croatian `hr` and Hungarian `hu` (cycle 3.141, Block 2)

This is the template `P9-L-translation-template.md` instantiated for **L7: Croatian (`hr`) and Hungarian (`hu`)**: e2e port **4947**, branch `p9/l7-hr-hu`, worktree `/home/bojan/rusuite-wt/p9-l7-hr-hu`. Where the text below says `<n>`, `<lang1>`, `<lang2>` read 7, hr, hu. Croatian uses *ti* / 2nd-person singular imperatives (*Odaberi…*, never *Vi/Vam/Vas* or *Odaberite*); Hungarian uses *te* / 2nd-person singular (*Válassz…*, *Kattints…*, never *Ön/Önök* or the *-jon/-jen* polite imperatives). Plural forms: Croatian **one/few/other**, Hungarian **one/other** (the check enforces them). **Self-review of 200 strings per language is mandatory** – list the count you changed. Pending keys are allowed by the check; translate them if you can. For e2e add `hr` and `hu` to `TRANSLATED` in the parameterised `packages/e2e/tests/i18n.spec.ts` (from P9-LR1; if it is not on main yet, write `i18n-l7.spec.ts` modelled on `i18n-l3.spec.ts`). The fallback test uses `mt` – do not change it.

Copy this file to `P9-L<n>-<lang1>-<lang2>.md`, fill in the two languages, and keep everything else. The file list in "Files to add" is completed from the P9-L0 report when L0 is merged.

| Task | Languages | e2e port |
| --- | --- | --- |
| L1 | French `fr`, Spanish `es` | 4941 |
| L2 | Italian `it`, Portuguese `pt` (European) | 4942 |
| L3 | Dutch `nl`, Swedish `sv` | 4943 |
| L4 | Danish `da`, Finnish `fi` | 4944 |
| L5 | Polish `pl`, Czech `cs` | 4945 |
| L6 | Slovak `sk`, Slovenian `sl` | 4946 |
| L7 | Croatian `hr`, Hungarian `hu` | 4947 |
| L8 | Romanian `ro`, Bulgarian `bg` | 4948 |
| L9 | Greek `el`, Lithuanian `lt` | 4949 |
| L10 | Latvian `lv`, Estonian `et` | 4950 |
| L11 | Irish `ga`, Maltese `mt` | 4951 |

Read `docs/tasks/COMMON.md` first (worktree rules, definition of done, commit trailer – ignore any other attribution notice; use exactly the two trailer lines from COMMON.md). Then `docs/i18n.md` (24-language setup from P9-L0, register rule, glossary workflow) and `docs/i18n-glossary/README.md`.

Branch `p9/l<n>-<lang1>-<lang2>`, worktree `/home/bojan/rusuite-wt/p9-l<n>-<lang1>-<lang2>`. No Rust changes expected; `CARGO_INCREMENTAL=0` if you build; delete `target/` before reporting.

## Owner rules (binding)
1. **Informal address in every language**, like the German "du": French *tu*, Spanish *tú*, Italian *tu*, Portuguese *tu*, Dutch *je/jij*, Swedish/Danish *du*, Finnish *sinä*, Polish *ty*, Czech/Slovak *ty*, Slovenian/Croatian *ti*, Hungarian *te*, Romanian *tu*, Bulgarian *ти*, Greek *εσύ*, Lithuanian *tu*, Latvian *tu*, Estonian *sina*, Irish *tú*, Maltese *int*. Imperatives in the familiar form ("Wähle…" not "Wählen Sie…"). Never the polite/formal pronoun or verb form. `pnpm i18n:check` enforces the per-language formal-form list from L0; a genuine third-person use goes into the allow-list with a reason.
2. **Terminology follows the Microsoft Office localisation of that language** for ribbon tabs, groups, commands, dialog titles, buttons and file types (e.g. French: Accueil, Insertion, Mise en page, Révision, Affichage; Enregistrer sous; Classeur Excel). Where Office has no term (Rusuite-specific features), translate consistently with the surrounding Office vocabulary.
3. Placeholders `{name}`, plural keys (`.one/.few/.many/.other` as the language's `Intl.PluralRules` categories require), shortcut combos, brand names (Rusuite, Calc, Write, Show, Excel, Word, PowerPoint, GitHub, WebDAV, Anthropic, OpenAI), file extensions and symbols stay untouched. Keep the English text's meaning and length discipline (ribbon labels short; the German catalog shows the acceptable length).

## Files to add (per language `<lang>`; from the P9-L0 report)
1. `docs/i18n-glossary/<lang>.md` (the Office terms you used: tabs, groups, ~80 common commands, dialog buttons, file types; columns English / term / note)
2. `packages/ui-shared/src/i18n/locales/<lang>.json`
3. `apps/calc/src/locales/<lang>.json`
4. `apps/write/src/locales/<lang>.json`
5. `apps/show/src/locales/<lang>.json`
6. `apps/portal/locales/<lang>.json`, **plus** `"<lang>"` added to `CATALOGS` in `apps/portal/i18n.js`
7. Optional: `scripts/i18n-allow/<lang>.json` (register allow-list with reasons) and the language's entry in `KEY_NAMES` (`packages/ui-shared/src/i18n/keyNames.ts`) if Office localises modifier/key names in that language (L0 filled de, fr, es, it, sv, da, fi; add yours if Office does).
`LOCALES` and `scripts/i18n-check.mjs` are not changed – a language becomes active when its catalogs exist. Catalogs load lazily (one chunk per language); keep each file's key order equal to `en.json`.
Decisions already taken (do not reopen): Portuguese = **pt-PT** with informal *tu* (você / o senhor are flagged); Spanish *su/sus* is not flagged (also his/its/their) – write *tu/tus*; Danish *De* is not flagged (also "they") – never use it as an address; Hungarian and Portuguese formal verb forms are not machine-checked – review them yourself.

## Method
1. Translate the five catalogs of the first language completely (every key of `en.json`; ~4 000 strings). Work namespace by namespace; keep a glossary as you go and apply it consistently across all five files (same term for the same English key prefix, e.g. every `cmd.*` and `tab.*`).
2. Run `pnpm i18n:check` (parity, placeholders, plural completeness, register, untranslated values) and fix every report. Run the per-language render tests (`pnpm --filter <app> test -- i18n`) and the app unit tests.
3. Build the web apps and look at the German-vs-new-language screenshots the e2e `I18N_SHOTS` option produces for the ribbon of each app at 1400 px and 1024 px: labels must not overflow their group (shorten with Office's own abbreviations where Office does; the ribbon collapses groups, but single labels must fit). Fix the strings, not the UI.
4. Repeat 1–3 for the second language.
5. **Self-review**: re-read 200 random strings per language against the glossary and the register rule; note in the report how many you changed.
6. e2e on the task's port: switch each app and the portal to both languages (the existing i18n spec is parameterised by L0 – run it for your two languages), screenshots `shots/P9-L<n>-*.png` (never committed).

## Acceptance (worktree root; all must pass)
`pnpm typecheck`; `pnpm test`; `pnpm i18n:check` (both languages fully translated, no formal forms, no untranslated values beyond the allow-list); `scripts/privacy-check.sh`; the e2e i18n spec for both languages green on the task's port; `docs/i18n.md` language table updated (status "translated", date). Report (≤ 40 lines): string counts per catalog, glossary highlights (10 key terms per language), register decisions (any allow-list entries with reasons), overflow fixes, test and e2e results, anything you could not translate confidently (list the keys).

Model: Sonnet unless the PM says otherwise (well-specified work). One commit per language, each with the trailer.
