# Task P9-LR2 – Languages: review Dutch, Swedish, Danish, Finnish (cycle 3.141, Block 2)

Read `docs/tasks/COMMON.md` first (worktree rules, definition of done, commit trailer – ignore any other attribution notice; use exactly the two trailer lines from COMMON.md). Then `docs/i18n.md`, `docs/i18n-glossary/{nl,sv,da,fi}.md`, and the translation template `docs/tasks/P9-L-translation-template.md` (the rules the translators had). The four languages were translated by Sonnet agents (P9-L3, P9-L4) that self-reviewed 200 strings per language and flagged areas they were unsure about (Swedish "bild" for slide and picture, Dutch "Morfologie"/"Presentatorweergave", "Hämta format", "Utsnitt", Finnish length). You are the second pair of eyes the plan requires.

Branch `p9/lr2-review`, worktree `/home/bojan/rusuite-wt/p9-lr2-review`. e2e port **4954**, screenshots `shots/P9-LR2-*.png` (never committed). No Rust.

## In scope
`packages/ui-shared/src/i18n/locales/{nl,sv,da,fi}.json`, `apps/{calc,write,show}/src/locales/{nl,sv,da,fi}.json`, `apps/portal/locales/{nl,sv,da,fi}.json`, `scripts/i18n-allow/{nl,sv,da,fi}.json`, `docs/i18n-glossary/{nl,sv,da,fi}.md`, `packages/e2e/tests/i18n*.spec.ts` + `packages/e2e/support/**` (the parameterised spec), `docs/i18n.md`. **Do not touch** English/German catalogs, other languages (later translation tasks run in parallel), `scripts/i18n-check.mjs`, `LOCALES`, app code.

## Items (one commit per language + one for the spec; trailers)
1. **Systematic review per language, 200+ strings**: take every 20th key of each catalog (that is > 250 strings per language across the five files) plus **all** keys in the areas the translators flagged: `show.fx.*`, `show.trans.*` (PowerPoint animation/transition names – use the real localised PowerPoint names), `calc.pivot.showAs.*`, `write.listPreset.*`, `show.setup.*`, media options, `reader.*` warnings, `ai.*`, every `tab.*`/`group.*`/`cmd.*`. Check: meaning, Office terminology (glossary), **informal register** (tu/tú/tu/tu – also hidden formal forms: French "veuillez", Spanish "haga/seleccione/introduzca", Italian "selezioni/inserisca" (Lei imperatives), Portuguese "clique/seleccione/introduza" (3rd person imperatives), possessives "votre/su/Suo/seu" used as address), grammar/agreement, placeholders intact, length (ribbon labels ≤ German length +15 %), consistency of the same English term across the five files. Fix in place; count your changes per category in the report.
2. **Glossaries**: complete each `docs/i18n-glossary/<lang>.md` to the template's columns (tabs, groups, ~80 common commands, dialog buttons, file types) with the terms actually used after your review; correct the catalog where it disagrees with the glossary.
3. **Plural `.many`**: nl/sv/da/fi have one/other only – verify no spurious `.many`/`.few` keys exist and that `.one` is used for 1 in every plural key.
4. **Parameterised e2e**: add nl/sv/da/fi to the parameterised spec from P9-LR1 (or, if it has not landed, to the per-language specs `i18n-l3.spec.ts`/`i18n-l4.spec.ts`) and remove duplicated per-language specs once the parameterised one covers them; the clipping scan at 1400/1024 px matters most for Finnish and Dutch.
5. **Docs**: `docs/i18n.md` status table rows for nl/sv/da/fi "reviewed <date>"; extend the review checklist from LR1 with anything new you learned.

## Acceptance (worktree root; all must pass)
`pnpm typecheck`; `pnpm test`; `pnpm i18n:check`; `scripts/privacy-check.sh`; the parameterised i18n spec green for de/nl/sv/da/fi on port 4954 (build the web apps first). Report (≤ 40 lines): strings reviewed and changed per language and category, remaining doubts (keys), spec coverage, screenshots list.

Additional item: translate every key `pnpm i18n:check` reports as *pending* for the four languages so that `pnpm i18n:check:strict` passes for nl/sv/da/fi at the end.
