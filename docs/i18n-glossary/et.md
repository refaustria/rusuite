# Glossary: Estonian (`et`)

Source: the Estonian (Estonia) localisation of Microsoft Office (Word, Excel, PowerPoint) and its terminology. Translator: P9-L10. Reviewer: –.

## Register
- Address: informal "sina / sa / sinu / sind / sulle" and 2nd-person singular imperatives ("Vali", "Sisesta", "Klõpsa", "Ava", "Kontrolli"); never "teie / teid / teile" or plural-polite imperatives ("Valige", "Klõpsake").
- Buttons and menu commands: imperative ("Salvesta", "Lisa tabel", "Prindi"), as Estonian Office does; dialog titles and group names as nouns ("Lahtrite vormindamine", "Lõikelaud").
- Ellipsis "…" for commands that open a dialog, as in English.
- Quotation marks: „…“ (low-high pair).
- Ordinals take a full stop ("{n}. taseme lõikude kaupa"); decimal comma in prose ("1,5 rida"); cell values and the formula language stay as in English.
- Keyboard key names in shortcut texts (packages/ui-shared/src/i18n/keyNames.ts): Estonian Office keeps Ctrl = Ctrl, Shift = Shift, Delete = Delete, Enter = Enter (no table entry needed).
- Plural categories: `one / other`. After numerals Estonian uses the partitive singular for both ("1 lehekülg", "2 lehekülge"; for nouns whose partitive is the same, `one` and `other` are identical: "1 sõna", "2 sõna"); no declension is needed after the number.
- Case endings of borrowed names are attached with an apostrophe or hyphen ("Write'i", "PivotTable-i", "Office'i").

## Ribbon tabs
| English | Office term | Note |
| --- | --- | --- |
| File | Fail | |
| Home | Avaleht | |
| Insert | Lisa | |
| Draw | Joonistamine | |
| Design | Kujundus | |
| Layout (Write: Layout, Calc: Page Layout) | Küljendus / Lehekülje küljendus | Write: "Küljendus", Calc: "Lehekülje küljendus" |
| References | Viited | Write |
| Mailings | Kirjad | Write |
| Review | Läbivaatus | |
| View | Vaade | |
| Formulas | Valemid | Calc |
| Data | Andmed | Calc |
| Transitions | Üleminekud | Show |
| Animations | Animatsioonid | Show |
| Slide Show | Slaidiseanss | Show |
| Help | Spikker | |
| Picture / Table / Chart / Drawing Tools (contextual) | Pildi- / Tabeli- / Diagrammi- / Joonistustööriistad | |

## Ribbon groups
| English | Office term | Note |
| --- | --- | --- |
| Clipboard | Lõikelaud | |
| Font | Font | |
| Paragraph | Lõik | |
| Styles | Laadid | |
| Editing | Redigeerimine | |
| Number | Arv | Calc |
| Alignment | Joondus | Calc |
| Cells | Lahtrid | Calc |
| Slides | Slaidid | Show |
| Drawing | Joonistamine | Show |
| Zoom | Suum | |
| Show (View › Show) | Kuva | |
| Language | Keel | the picker; label "Keel / Language" |

## Common commands
| English | Office term | Note |
| --- | --- | --- |
| New | Uus | |
| Open… | Ava… | |
| Save | Salvesta | |
| Save As… | Salvesta nimega… | |
| Print | Prindi | |
| Export PDF… | Ekspordi PDF… | |
| Close | Sule | |
| Options… | Suvandid… | |
| Undo / Redo | Võta tagasi / Tee uuesti | |
| Cut / Copy / Paste | Lõika / Kopeeri / Kleebi | |
| Paste Special… | Spetsiaalne kleepimine… | |
| Format Painter | Vormingu kopeerija | |
| Find / Replace… / Go To… | Otsi / Asenda… / Mine… | |
| Select All | Vali kõik | |
| Bold / Italic / Underline / Strikethrough | Paks / Kaldkiri / Allakriipsutus / Läbikriipsutus | |
| Font Color / Highlight / Fill Color | Fondi värv / Esiletõstuvärv / Täitevärv | |
| Insert Picture / Table / Chart / Shape / Text Box | Lisa pilt / tabel / diagramm / kujund / tekstikast | |
| Bring to Front / Send to Back | Too esiplaanile / Saada tagaplaanile | |
| Group / Ungroup | Rühmita / Tühista rühmitus | |
| Sort / Filter | Sordi / Filter | Calc |
| Insert Function | Lisa funktsioon | Calc |
| New Slide | Uus slaid | Show |
| From Beginning / From Current Slide | Algusest / Praegusest slaidist | Show |
| Track Changes / Comments | Jälgi muudatusi / Kommentaarid | Write |

## Dialog buttons and messages
| English | Office term | Note |
| --- | --- | --- |
| OK | OK | |
| Cancel | Loobu | |
| Apply | Rakenda | |
| Close | Sule | |
| Yes / No | Jah / Ei | |
| Don't Save | Ära salvesta | the unsaved-changes prompt |
| Browse… | Sirvi… | |
| Reset | Lähtesta | |
| Insert / Delete | Lisa / Kustuta | |
| Back / Next / Finish | Tagasi / Edasi / Lõpeta | wizards |
| Recent | Viimatised | backstage |
| Untitled | Nimetu | default document name |
| Saved / Saving… / Unsaved changes | Salvestatud / Salvestamine… / Salvestamata muudatused | status bar |

## File types
| English | Office term | Note |
| --- | --- | --- |
| Excel Workbook | Exceli tööraamat | `.xlsx`, the desktop dialog filter name |
| Word Document | Wordi dokument | `.docx` |
| PowerPoint Presentation | PowerPointi esitlus | `.pptx` |
| Excel Template / Word Template / PowerPoint Template | Exceli / Wordi / PowerPointi mall | `.xltx` / `.dotx` / `.potx` |
| CSV (Comma delimited) | CSV (komaga eraldatud) | Calc |
| Text Files | Tekstifailid | |
| PDF | PDF | |
| Office Theme | Office'i teema | `.thmx` |
| All Files | Kõik failid | |

## More terms
| English | Office term | Note |
| --- | --- | --- |
| Workbook / Worksheet / Cell / Range | Tööraamat / Tööleht / Lahter / Vahemik | Calc |
| Pivot table | PivotTable | PivotChart stays "PivotChart"; case endings with a hyphen |
| Conditional formatting | Tingimusvormindus | |
| Data bars / Color scales / Icon sets | Andmeribad / Värviskaalad / Ikoonikomplektid | |
| Slicer / Sparkline | Viilutaja / Sparkline | |
| Flash Fill | Välktäide | |
| Goal Seek / What-If Analysis | Eesmärgi otsimine / Mis-kui-analüüs | |
| Paragraph / Heading | Lõik / Pealkiri | |
| Footnote / Endnote | Joonealune märkus / Lõpumärkus | |
| Header / Footer | Päis / Jalus | |
| Bookmark / Cross-reference | Järjehoidja / Ristviide | |
| Caption / Table of contents | Pealdis / Sisukord | |
| Table of figures | Jooniste loend | |
| Slide / Slide master / Layout | Slaid / Slaidimaster / Küljendus | |
| Speaker notes / Presenter view | Kõneleja märkmed / Esitaja vaade | |
| Entrance / Emphasis / Exit (effects) | Sisenemine / Rõhutus / Väljumine | Show |
| Transition names | Morf (Morph), Tuhmumine (Fade), Lükkamine (Push), Poolitus (Split), Pühkimine (Wipe) | Show |
| Placeholder | Kohatäide | |
| Gridlines / Guides | Ruudujooned / Juhised | |
| Comment / Note (Calc) | Kommentaar / Märge | |
| Hyperlink / ScreenTip | Hüperlink / Ekraanivihje | |
