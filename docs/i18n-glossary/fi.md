# Glossary: Finnish (`fi`)

Source: the Finnish (Finland) localisation of Microsoft Office (Word, Excel, PowerPoint) and its terminology. Translator: P9-L4. Reviewer: P9-L-review.

## Register
- Address: informal "sinä / sinun / sinulle", 2nd-person singular imperatives ("Valitse", "Kirjoita", "Napsauta", "Yritä uudelleen", "Tarkista"); never "Te / teidän" or plural/polite "-kaa/-kää" imperatives ("Valitkaa").
- Buttons and menu commands: imperative or noun as Office does ("Tallenna", "Lisää taulukko", "Avaa"); questions in confirmation dialogs use the passive ("Poistetaanko …?") or "Haluatko …?".
- Placeholders are never inflected: phrasing is arranged so that "{name}", "{connection}" stay in the nominative (e.g. "palvelussa {connection}", "Poista {name}").
- Ellipsis "…" for commands that open a dialog, as in English.
- Decimal comma, space as thousands separator, "A–Ö" for sorting; the English "A to Z" becomes "A–Ö".
- Keyboard key names in shortcut texts (packages/ui-shared/src/i18n/keyNames.ts): Ctrl = Ctrl, Shift = Vaihto, Delete = Delete, Enter = Enter.
- Plural categories: `one / other`; after a number Finnish uses the singular, so counts are phrased "{count} sana" / "{count} sanaa" (partitive in `other`).
- Terms: document = "asiakirja" (Word), workbook = "työkirja", presentation = "esitys", slide = "dia"; worksheet and sheet = "taulukko" (as Excel does), Excel table = "taulukko", PivotTable = "pivot-taulukko".

## Ribbon tabs
| English | Office term | Note |
| --- | --- | --- |
| File | Tiedosto | |
| Home | Aloitus | |
| Insert | Lisää | |
| Draw | Piirrä | |
| Design | Rakenne | Word/PowerPoint "Rakenne" |
| Layout (Write: Layout, Calc: Page Layout) | Asettelu / Sivun asettelu | Calc: "Sivun asettelu" |
| References | Viittaukset | Write |
| Mailings | Postitukset | Write |
| Review | Tarkista | |
| View | Näytä | |
| Formulas | Kaavat | Calc |
| Data | Tiedot | Calc |
| Transitions | Siirtymät | Show |
| Animations | Animaatiot | Show |
| Slide Show | Diaesitys | Show |
| Help | Ohje | |
| Picture / Table / Chart / Drawing Tools (contextual) | Kuvatyökalut / Taulukkotyökalut / Kaaviotyökalut / Piirtotyökalut | |

## Ribbon groups
| English | Office term | Note |
| --- | --- | --- |
| Clipboard | Leikepöytä | |
| Font | Fontti | |
| Paragraph | Kappale | |
| Styles | Tyylit | |
| Editing | Muokkaus | |
| Number | Luku | Calc |
| Alignment | Tasaus | Calc |
| Cells | Solut | Calc |
| Slides | Diat | Show |
| Drawing | Piirtäminen | Show |
| Zoom | Zoomaus | |
| Show (View › Show) | Näytä | |
| Language | Kieli | the picker; label "Kieli / Language" |

## Common commands
| English | Office term | Note |
| --- | --- | --- |
| New | Uusi | |
| Open… | Avaa… | |
| Save | Tallenna | |
| Save As… | Tallenna nimellä… | |
| Print | Tulosta | |
| Export PDF… | Vie PDF-muotoon… | |
| Close | Sulje | |
| Options… | Asetukset… | |
| Undo / Redo | Kumoa / Tee uudelleen | |
| Cut / Copy / Paste | Leikkaa / Kopioi / Liitä | |
| Paste Special… | Liitä kohdistetusti… | |
| Format Painter | Muotoilusivellin | |
| Find / Replace… / Go To… | Etsi / Korvaa… / Siirry… | |
| Select All | Valitse kaikki | |
| Bold / Italic / Underline / Strikethrough | Lihavointi / Kursivointi / Alleviivaus / Yliviivaus | |
| Font Color / Highlight / Fill Color | Fontin väri / Tekstin korostusväri / Täyttöväri | |
| Insert Picture / Table / Chart / Shape / Text Box | Lisää kuva / taulukko / kaavio / muoto / tekstiruutu | |
| Bring to Front / Send to Back | Tuo eteen / Vie taakse | |
| Group / Ungroup | Ryhmitä / Pura ryhmitys | |
| Sort / Filter | Lajittele / Suodata | Calc |
| Insert Function | Lisää funktio | Calc |
| New Slide | Uusi dia | Show |
| From Beginning / From Current Slide | Alusta / Nykyisestä diasta | Show |
| Track Changes / Comments | Muutosten jäljitys / Kommentit | Write (the catalog uses "Jäljitys" for the group) |

## Dialog buttons and messages
| English | Office term | Note |
| --- | --- | --- |
| OK | OK | |
| Cancel | Peruuta | |
| Apply | Käytä | |
| Close | Sulje | |
| Yes / No | Kyllä / Ei | |
| Don't Save | Älä tallenna | the unsaved-changes prompt |
| Browse… | Selaa… | |
| Reset | Palauta | |
| Insert / Delete | Lisää / Poista | |
| Back / Next / Finish | Edellinen / Seuraava / Valmis | wizards |
| Recent | Viimeisimmät | backstage |
| Untitled | Nimetön | default document name |
| Saved / Saving… / Unsaved changes | Tallennettu / Tallennetaan… / Tallentamattomat muutokset | status bar |

## File types
| English | Office term | Note |
| --- | --- | --- |
| Excel Workbook | Excel-työkirja | `.xlsx`, the desktop dialog filter name |
| Word Document | Word-asiakirja | `.docx` |
| PowerPoint Presentation | PowerPoint-esitys | `.pptx` |
| Excel Template / Word Template / PowerPoint Template | Excel-malli / Word-malli / PowerPoint-malli | `.xltx` / `.dotx` / `.potx` |
| CSV (Comma delimited) | CSV (pilkuilla eroteltu) | Calc |
| Text Files | Tekstitiedostot | |
| PDF | PDF | |
| Office Theme | Office-teema | `.thmx` |
| All Files | Kaikki tiedostot | |

## More terms
| English | Office term | Note |
| --- | --- | --- |
| PivotTable / PivotChart | Pivot-taulukko / Pivot-kaavio | |
| Slicer | Viipaloija | |
| Flash Fill | Pikatäyttö | |
| Conditional Formatting | Ehdollinen muotoilu | |
| Data Validation | Tietojen kelpoisuuden tarkistus | |
| Slide master | Diamalli | |
| Speaker notes | Esittäjän muistiinpanot | |
| Presenter view | Esittäjänäkymä | |
| Bookmark | Kirjanmerkki | Write |
| Cross-reference | Ristiviittaus | Write |
| Footnote / Endnote | Alaviite / Loppuviite | Write |
| Header / Footer | Ylätunniste / Alatunniste | |
| Style set | Tyylijoukko | Write |
| Defined name / Name Manager | Määritetty nimi / Nimien hallinta | Calc |
| Goal Seek | Tavoitteen haku | Calc |
| Freeze Panes | Lukitse ruudut | Calc |
| Remove Duplicates | Poista kaksoiskappaleet | Calc |
| Text to Columns | Teksti sarakkeisiin | Calc |
| Placeholder (slide) | Paikkamerkki | Show |
| Spill (dynamic array) | Ylivuoto | Calc |
| Ribbon | Valintanauha | |
| Caption | Kuvateksti | Write |
