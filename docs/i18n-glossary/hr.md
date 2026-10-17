# Glossary: Croatian (`hr`)

Source: the Croatian (Hrvatska) localisation of Microsoft Office (Word, Excel, PowerPoint) and its terminology. Translator: P9-L7. Reviewer: –.

## Register
- Address: informal "ti / te / tvoj", imperatives in the 2nd person singular ("Odaberi", "Unesi", "Klikni", "Provjeri"); never "Vi / Vas / Vam / Vaš" or "-ite" imperatives ("Odaberite"). Office's "Kliknite" becomes "Klikni".
- Gender-neutral wording: past participles that show the user's gender ("odabrao", "dodao") are avoided ("koje su dodane", "Što želiš napraviti?").
- Buttons and menu commands: imperative, as Croatian Office does ("Spremi", "Otvori", "Zalijepi"); ribbon group names and dialog titles are nouns ("Međuspremnik", "Oblikovanje ćelija").
- Ellipsis "…" for commands that open a dialog, as in English.
- Quotation marks: „…” (low-high), decimal comma in numbers shown by the UI chrome ("29,7 × 42 cm"); shortcut digits and formula syntax stay as in English.
- Keyboard key names in shortcut texts (packages/ui-shared/src/i18n/keyNames.ts): Ctrl = Ctrl, Shift = Shift, Delete = Delete, Enter = Enter (Croatian Office keeps the English key names; no entry in `KEY_NAMES`).
- Plural categories: `one / few / other` (1 stavka, 2–4 stavke, 5+ stavki; 11–14 → other).
- Slides are "slajd" (PowerPoint hr); "Transitions" = "Prijelazi", "Slide show" = "Prezentacija".

## Ribbon tabs
| English | Office term | Note |
| --- | --- | --- |
| File | Datoteka | |
| Home | Polazno | `tab.home`; the backstage "Home" is "Početna" |
| Insert | Umetanje | |
| Draw | Crtanje | |
| Design | Dizajn | |
| Layout (Write: Layout, Calc: Page Layout) | Raspored / Raspored stranice | Write: "Raspored", Calc: "Raspored stranice" |
| References | Reference | Write |
| Mailings | Slanje pošte | not used (no mailings tab) |
| Review | Pregled | |
| View | Prikaz | |
| Formulas | Formule | Calc |
| Data | Podaci | Calc |
| Transitions | Prijelazi | Show |
| Animations | Animacije | Show |
| Slide Show | Prezentacija | Show |
| Help | Pomoć | |
| Picture / Table / Chart / Drawing Tools (contextual) | Alati za slike / tablice / grafikone / crtanje | |

## Ribbon groups
| English | Office term | Note |
| --- | --- | --- |
| Clipboard | Međuspremnik | |
| Font | Font | |
| Paragraph | Odlomak | |
| Styles | Stilovi | |
| Editing | Uređivanje | |
| Number | Broj | Calc |
| Alignment | Poravnanje | Calc |
| Cells | Ćelije | Calc |
| Slides | Slajdovi | Show |
| Drawing | Crtanje | Show |
| Zoom | Zumiranje | |
| Show (View › Show) | Prikaži | |
| Language | Jezik | the picker; label "Jezik / Language" |

## Common commands
| English | Office term | Note |
| --- | --- | --- |
| New | Novo | |
| Open… | Otvori… | |
| Save | Spremi | |
| Save As… | Spremi kao… | |
| Print | Ispis | |
| Export PDF… | Izvezi PDF… | |
| Close | Zatvori | |
| Options… | Mogućnosti… | |
| Undo / Redo | Poništi / Ponovi | |
| Cut / Copy / Paste | Izreži / Kopiraj / Zalijepi | |
| Paste Special… | Posebno lijepljenje… | |
| Format Painter | Prenositelj oblikovanja | |
| Find / Replace… / Go To… | Traži / Zamijeni… / Idi na… | |
| Select All | Odaberi sve | |
| Bold / Italic / Underline / Strikethrough | Podebljano / Kurziv / Podcrtano / Precrtano | |
| Font Color / Highlight / Fill Color | Boja fonta / Isticanje / Boja ispune | |
| Insert Picture / Table / Chart / Shape / Text Box | Umetni sliku / tablicu / grafikon / oblik / tekstni okvir | |
| Bring to Front / Send to Back | Postavi u prvi plan / Postavi u pozadinu | |
| Group / Ungroup | Grupiraj / Razgrupiraj | |
| Sort / Filter | Sortiraj / Filtar | Calc |
| Insert Function | Umetni funkciju | Calc |
| New Slide | Novi slajd | Show |
| From Beginning / From Current Slide | Od početka / Od trenutnog slajda | Show |
| Track Changes / Comments | Praćenje promjena / Komentari | Write |

## Dialog buttons and messages
| English | Office term | Note |
| --- | --- | --- |
| OK | U redu | |
| Cancel | Odustani | |
| Apply | Primijeni | |
| Close | Zatvori | |
| Yes / No | Da / Ne | |
| Don't Save | Ne spremaj | the unsaved-changes prompt |
| Browse… | Pregledaj… | |
| Reset | Ponovno postavi | |
| Insert / Delete | Umetni / Izbriši | |
| Back / Next / Finish | Natrag / Dalje / Završi | wizards |
| Recent | Nedavno | backstage |
| Untitled | Bez naslova | default document name |
| Saved / Saving… / Unsaved changes | Spremljeno / Spremanje… / Nespremljene promjene | status bar |

## File types
| English | Office term | Note |
| --- | --- | --- |
| Excel Workbook | Excel radna knjiga | `.xlsx`, the desktop dialog filter name |
| Word Document | Word dokument | `.docx` |
| PowerPoint Presentation | PowerPoint prezentacija | `.pptx` |
| Excel Template / Word Template / PowerPoint Template | Excel / Word / PowerPoint predložak | `.xltx` / `.dotx` / `.potx` |
| CSV (Comma delimited) | CSV (razdvojeno zarezom) | Calc |
| Text Files | Tekstne datoteke | |
| PDF | PDF | |
| Office Theme | Office tema | `.thmx` |
| All Files | Sve datoteke | |

## More terms
| English | Office term | Note |
| --- | --- | --- |
| Workbook / Worksheet / Sheet | Radna knjiga / Radni list / List | Calc |
| Cell / Range | Ćelija / Raspon | Calc |
| PivotTable / PivotChart | Zaokretna tablica / Zaokretni grafikon | Calc |
| Slicer / Sparkline | Rezač / Minigrafikon | Calc |
| Conditional Formatting | Uvjetno oblikovanje | Calc; Data Bars = Trake podataka, Color Scales = Ljestvice boja, Icon Sets = Skupovi ikona |
| Data Validation | Provjera valjanosti podataka | Calc |
| Goal Seek / What-If Analysis | Traženje cilja / Analiza što-ako | Calc |
| Name Manager | Upravitelj naziva | Calc |
| Flash Fill | Brzo popunjavanje | Calc |
| Text to Columns | Tekst u stupce | Calc |
| Protect Sheet | Zaštiti list | Calc |
| Freeze Panes | Zamrzni okna | Calc |
| Slide / Section | Slajd / Odjeljak | Show |
| Slide Master | Glavni slajd | Show |
| Layout (slide) | Izgled | Show |
| Presenter view | Prikaz izlagača | Show |
| Speaker notes | Bilješke izlagača | Show |
| Entrance / Emphasis / Exit | Ulaz / Isticanje / Izlaz | Show animations |
| Appear / Disappear / Fade / Fly In / Fly Out / Wipe | Pojavljivanje / Nestajanje / Pretapanje / Ulet / Izlet / Brisanje | Show effects |
| Morph / Reveal / Honeycomb / Page Curl | Morf / Otkrivanje / Saće / Uvijanje stranice | Show transitions |
| Footnote / Endnote | Fusnota / Završna bilješka | Write |
| Bookmark | Knjižna oznaka | Write |
| Cross-reference | Unakrsna referenca | Write |
| Table of contents | Sadržaj | Write |
| Header / Footer | Zaglavlje / Podnožje | |
| Hyperlink | Hiperveza | |
| Margins / Orientation / Paper size | Margine / Orijentacija / Veličina papira | |
| Autosave | Automatsko spremanje | |
| Alt text | Alternativni tekst | |
| Chart title / Axis / Legend / Trendline | Naslov grafikona / Os / Legenda / Linija trenda | |
| Column / Bar / Pie / Doughnut / Scatter chart | Stupčasti / Trakasti / Tortni / Prstenasti / Raspršeni grafikon | |
