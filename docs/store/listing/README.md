# Store listing texts (P10-M7)

One file per language (`<lang>.json`, the 24 UI languages) with the keys `calc`, `write`, `show`; each holds
`title`, `shortDescription` (Play, ≤ 80), `subtitle` (App Store, ≤ 30), `fullDescription` (Play, ≤ 4000), `description`
(App Store, ≤ 4000, same text), `keywords` (App Store, ≤ 100, comma-separated without spaces), `promotionalText`
(≤ 170), `whatsNew` and `privacyAnswer`. `../release-notes/<lang>.txt` is the Play release note (≤ 500) and equals
`whatsNew`. `node scripts/store/check-listing.mjs` validates all of it.

- Register: informal in every language (docs/i18n.md), terms from `docs/i18n-glossary/<lang>.md`; "Rusuite Calc/Write/Show"
  stay untranslated.
- "New in 3.1415" lists four bullets in this order: phone and tablet apps, touch editing, **PDF export**, signed
  desktop apps. The PDF bullet is the third line of `whatsNew` (and of the end of `fullDescription`/`description`):
  remove that line from all files (and the release notes) if P10-M6 is not part of the release.
- The texts are generated from short per-language sources; edit the JSON files directly from now on.
