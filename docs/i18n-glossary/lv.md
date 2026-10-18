# Glossary: Latvian (`lv`)

Source: the Latvian (Latvia) localisation of Microsoft Office (Word, Excel, PowerPoint) and its terminology. Translator: P9-L10. Reviewer: –.

## Register
- Address: informal "tu / tev / tavs / tava" and 2nd-person singular imperatives ("Izvēlies", "Ievadi", "Noklikšķini", "Atver", "Pārbaudi"); never "jūs / jūsu / jums" or "-iet" imperatives ("Izvēlieties", "Noklikšķiniet").
- Buttons and menu commands: infinitive or noun, as Office does ("Saglabāt", "Ievietot tabulu", "Drukāt"); messages to the user are in the informal imperative or a neutral statement.
- Gender-neutral wording: past-tense 2nd-person forms with gender endings are avoided ("tu esi bezsaistē", imperatives instead).
- Ellipsis "…" for commands that open a dialog, as in English.
- Quotation marks: „…” (low-high pair).
- Ordinals take a full stop ("{n}. slaids", "{page}. lappuse no {count}"); decimal comma in prose ("1,5 rindas"), thousands separator and cell values stay as in English.
- Keyboard key names in shortcut texts (packages/ui-shared/src/i18n/keyNames.ts): Latvian Office keeps Ctrl = Ctrl, Shift = Shift, Delete = Delete, Enter = Enter (no table entry needed).
- Plural categories: `zero / one / other`. `one` = 1, 21, 31 …; `zero` = 0, 10–20, 30 … (genitive plural: "0 lappušu", "11 slaidu"); `other` = 2–9, 22–29 … (nominative plural: "2 lappuses"). Every plural key has a `.zero` form.

## Ribbon tabs
| English | Office term | Note |
| --- | --- | --- |
| File | Fails | |
| Home | Sākums | |
| Insert | Ievietošana | |
| Draw | Zīmēšana | |
| Design | Noformējums | |
| Layout (Write: Layout, Calc: Page Layout) | Izkārtojums / Lappuses izkārtojums | Write: "Izkārtojums", Calc: "Lappuses izkārtojums" |
| References | Atsauces | Write |
| Mailings | Sūtījumi | Write |
| Review | Pārskatīšana | |
| View | Skats | |
| Formulas | Formulas | Calc |
| Data | Dati | Calc |
| Transitions | Pārejas | Show |
| Animations | Animācijas | Show |
| Slide Show | Slaidrāde | Show |
| Help | Palīdzība | |
| Picture / Table / Chart / Drawing Tools (contextual) | Attēlu / Tabulas / Diagrammas / Zīmēšanas rīki | |

## Ribbon groups
| English | Office term | Note |
| --- | --- | --- |
| Clipboard | Starpliktuve | |
| Font | Fonts | |
| Paragraph | Rindkopa | |
| Styles | Stili | |
| Editing | Rediģēšana | |
| Number | Skaitlis | Calc |
| Alignment | Līdzinājums | Calc |
| Cells | Šūnas | Calc |
| Slides | Slaidi | Show |
| Drawing | Zīmēšana | Show |
| Zoom | Tālummaiņa | |
| Show (View › Show) | Rādīt | |
| Language | Valoda | the picker; label "Valoda / Language" |

## Common commands
| English | Office term | Note |
| --- | --- | --- |
| New | Jauns | |
| Open… | Atvērt… | |
| Save | Saglabāt | |
| Save As… | Saglabāt kā… | |
| Print | Drukāt | |
| Export PDF… | Eksportēt PDF… | |
| Close | Aizvērt | |
| Options… | Opcijas… | |
| Undo / Redo | Atsaukt / Atkārtot | |
| Cut / Copy / Paste | Izgriezt / Kopēt / Ielīmēt | |
| Paste Special… | Īpašā ielīmēšana… | |
| Format Painter | Formāta kopētājs | |
| Find / Replace… / Go To… | Meklēt / Aizstāt… / Doties uz… | |
| Select All | Atlasīt visu | |
| Bold / Italic / Underline / Strikethrough | Treknraksts / Slīpraksts / Pasvītrojums / Pārsvītrojums | |
| Font Color / Highlight / Fill Color | Fonta krāsa / Teksta izcēluma krāsa / Aizpildījuma krāsa | |
| Insert Picture / Table / Chart / Shape / Text Box | Ievietot attēlu / tabulu / diagrammu / formu / teksta lodziņu | |
| Bring to Front / Send to Back | Pārvietot uz priekšplānu / uz aizmugures plānu | |
| Group / Ungroup | Grupēt / Atgrupēt | |
| Sort / Filter | Kārtot / Filtrs | Calc |
| Insert Function | Ievietot funkciju | Calc |
| New Slide | Jauns slaids | Show |
| From Beginning / From Current Slide | No sākuma / No pašreizējā slaida | Show |
| Track Changes / Comments | Izmaiņu izsekošana / Komentāri | Write |

## Dialog buttons and messages
| English | Office term | Note |
| --- | --- | --- |
| OK | Labi | |
| Cancel | Atcelt | |
| Apply | Lietot | |
| Close | Aizvērt | |
| Yes / No | Jā / Nē | |
| Don't Save | Nesaglabāt | the unsaved-changes prompt |
| Browse… | Pārlūkot… | |
| Reset | Atiestatīt | |
| Insert / Delete | Ievietot / Dzēst | |
| Back / Next / Finish | Atpakaļ / Tālāk / Pabeigt | wizards |
| Recent | Nesen izmantotie | backstage |
| Untitled | Bez nosaukuma | default document name |
| Saved / Saving… / Unsaved changes | Saglabāts / Notiek saglabāšana… / Nesaglabātas izmaiņas | status bar |

## File types
| English | Office term | Note |
| --- | --- | --- |
| Excel Workbook | Excel darbgrāmata | `.xlsx`, the desktop dialog filter name |
| Word Document | Word dokuments | `.docx` |
| PowerPoint Presentation | PowerPoint prezentācija | `.pptx` |
| Excel Template / Word Template / PowerPoint Template | Excel / Word / PowerPoint veidne | `.xltx` / `.dotx` / `.potx` |
| CSV (Comma delimited) | CSV (atdalīts ar komatiem) | Calc |
| Text Files | Teksta faili | |
| PDF | PDF | |
| Office Theme | Office motīvs | `.thmx` |
| All Files | Visi faili | |

## More terms
| English | Office term | Note |
| --- | --- | --- |
| Workbook / Worksheet / Cell / Range | Darbgrāmata / Darblapa (lapa) / Šūna / Diapazons | Calc |
| Pivot table | Rakurstabula | PivotChart = Rakursdiagramma |
| Conditional formatting | Nosacītā formatēšana | |
| Data bars / Color scales / Icon sets | Datu joslas / Krāsu skalas / Ikonu kopas | |
| Slicer / Sparkline | Griezums / Sparklīnija | |
| Flash Fill | Zibenīgā aizpilde | |
| Goal Seek / What-If Analysis | Mērķa meklēšana / Ja-tad analīze | |
| Paragraph / Heading | Rindkopa / Virsraksts | |
| Footnote / Endnote | Vēre / Beigu vēre | |
| Header / Footer | Galvene / Kājene | |
| Bookmark / Cross-reference | Grāmatzīme / Savstarpēja atsauce | |
| Caption / Table of contents | Paraksts / Satura rādītājs | |
| Table of figures | Ilustrāciju saraksts | |
| Slide / Slide master / Layout | Slaids / Slaidu paraugs (paraugslaids) / Izkārtojums | |
| Speaker notes / Presenter view | Referenta piezīmes / Prezentētāja skats | |
| Entrance / Emphasis / Exit (effects) | Ienākšana / Izcelšana / Iziešana | Show |
| Transition names | Pārveidošana (Morph), Izbalēšana (Fade), Stumšana (Push), Sadalīšana (Split), Slaucīšana (Wipe) | Show |
| Placeholder | Vietturis | |
| Gridlines / Guides | Režģlīnijas / Palīglīnijas | |
| Comment / Note (Calc) | Komentārs / Piezīme | |
| Hyperlink / ScreenTip | Hipersaite / Ekrāna padoms | |
