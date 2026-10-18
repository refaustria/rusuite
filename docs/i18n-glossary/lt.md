# Glossary: Lithuanian (`lt`)

Source: the Lithuanian localisation of Microsoft Office (Word, Excel, PowerPoint) and its terminology. Translator: P9-L9. Reviewer: –.

## Register
- Address: informal singular "tu / tave / tau / tavo", imperatives in the 2nd-person singular ("Pasirink", "Spustelėk", "Įvesk", "Atidaryk", "Patikrink"); never "jūs / jūsų / jums" or the plural-polite "-ite/-kite" imperatives ("Pasirinkite", "Spustelėkite"). Purpose clauses use "Kad … -tum" ("Kad tęstum, įvesk …") instead of the gender-marked "Norėdamas/Norėdama".
- Buttons and menu commands: infinitive ("Įrašyti", "Atidaryti", "Įterpti lentelę"), as Lithuanian Office does; messages to the user are in the singular imperative or a neutral statement. Messages about a missing connection avoid gender-marked participles ("Nėra ryšio su internetu" instead of "Esi neprisijungęs").
- Ellipsis "…" for commands that open a dialog, as in English.
- Typography: quotation marks „…“ for quoted names and brand names ("„Windows“", "„Excel“"), decimal comma, "cm" / "pt" for units, "col." for inches, "%" with a no-break-free space before it ("25 %").
- Keyboard key names in shortcut texts (packages/ui-shared/src/i18n/keyNames.ts): Lithuanian Office keeps the English names (Ctrl, Shift, Alt, Delete, Enter), so no `lt` entry was added.
- Plural categories: `one / few / many / other` – one: 1, 21, 31 … (not 11); few: 2–9, 22–29 …; many: fractions; other: 0, 10–20, 30 …. Count messages put the noun in the matching form: "{count} puslapis / puslapiai / puslapio / puslapių". Where a placeholder could be any number and no plural group exists in English, the message is built as "Įspėjimai ({count}): …" or "lygių: {n}" so no declension is needed.

## Ribbon tabs
| English | Office term | Note |
| --- | --- | --- |
| File | Failas | |
| Home | Pagrindinis | |
| Insert | Įterpimas | |
| Draw | Piešimas | no Draw tab in Rusuite yet |
| Design | Dizainas | |
| Layout (Write: Layout, Calc: Page Layout) | Maketas / Puslapio maketas | Calc: "Puslapio maketas" |
| References | Nuorodos | Write |
| Mailings | Siuntimas | Write |
| Review | Peržiūra | |
| View | Rodymas | |
| Formulas | Formulės | Calc |
| Data | Duomenys | Calc |
| Transitions | Perėjimai | Show |
| Animations | Animacijos | Show |
| Slide Show | Skaidrių demonstravimas | Show |
| Help | Žinynas | |
| Picture / Table / Chart / Drawing Tools (contextual) | Paveikslėlio / Lentelės / Diagramos / Piešimo įrankiai | |

## Ribbon groups
| English | Office term | Note |
| --- | --- | --- |
| Clipboard | Mainų sritis | |
| Font | Šriftas | |
| Paragraph | Pastraipa | |
| Styles | Stiliai | |
| Editing | Redagavimas | |
| Number | Skaičius | Calc |
| Alignment | Lygiavimas | Calc |
| Cells | Langeliai | Calc |
| Slides | Skaidrės | Show |
| Drawing | Piešimas | Show |
| Zoom | Mastelis | |
| Show (View › Show) | Rodyti | |
| Language | Kalba | the picker; label "Kalba / Language" |

## Common commands
| English | Office term | Note |
| --- | --- | --- |
| New | Naujas | |
| Open… | Atidaryti… | |
| Save | Įrašyti | |
| Save As… | Įrašyti kaip… | |
| Print | Spausdinti | |
| Export PDF… | Eksportuoti į PDF… | |
| Close | Uždaryti | |
| Options… | Parinktys… | |
| Undo / Redo | Anuliuoti / Perdaryti | |
| Cut / Copy / Paste | Iškirpti / Kopijuoti / Įklijuoti | |
| Paste Special… | Specialusis įklijavimas… | |
| Format Painter | Formato kopijavimas | |
| Find / Replace… / Go To… | Rasti / Pakeisti… / Eiti į… | |
| Select All | Žymėti viską | |
| Bold / Italic / Underline / Strikethrough | Pusjuodis / Kursyvas / Pabraukimas / Perbraukimas | |
| Font Color / Highlight / Fill Color | Šrifto spalva / Teksto paryškinimo spalva / Užpildo spalva | |
| Insert Picture / Table / Chart / Shape / Text Box | Įterpti paveikslėlį / lentelę / diagramą / figūrą / teksto lauką | |
| Bring to Front / Send to Back | Perkelti į priekį / Perkelti į pačią apačią | |
| Group / Ungroup | Grupuoti / Išgrupuoti | |
| Sort / Filter | Rikiuoti / Filtras | Calc |
| Insert Function | Įterpti funkciją | Calc |
| New Slide | Nauja skaidrė | Show |
| From Beginning / From Current Slide | Nuo pradžių / Nuo dabartinės skaidrės | Show |
| Track Changes / Comments | Sekimas / Komentarai | Write |

## Dialog buttons and messages
| English | Office term | Note |
| --- | --- | --- |
| OK | Gerai | |
| Cancel | Atšaukti | |
| Apply | Taikyti | |
| Close | Uždaryti | |
| Yes / No | Taip / Ne | |
| Don't Save | Neįrašyti | the unsaved-changes prompt |
| Browse… | Naršyti… | |
| Reset | Atkurti | |
| Insert / Delete | Įterpti / Naikinti | |
| Back / Next / Finish | Atgal / Kitas / Baigti | wizards |
| Recent | Neseniai naudoti | backstage |
| Untitled | Be pavadinimo | default document name |
| Saved / Saving… / Unsaved changes | Įrašyta / Įrašoma… / Neįrašyti pakeitimai | status bar |

## File types
| English | Office term | Note |
| --- | --- | --- |
| Excel Workbook | „Excel“ sąsiuvinis | `.xlsx`, the desktop dialog filter name |
| Word Document | „Word“ dokumentas | `.docx` |
| PowerPoint Presentation | „PowerPoint“ pateiktis | `.pptx` |
| Excel Template / Word Template / PowerPoint Template | „Excel“ / „Word“ / „PowerPoint“ šablonas | `.xltx` / `.dotx` / `.potx` |
| CSV (Comma delimited) | CSV (atskirta kableliais) | Calc |
| Text Files | Tekstiniai failai | |
| PDF | PDF | |
| Office Theme | „Office“ tema | `.thmx` |
| All Files | Visi failai | |

## More terms
| English | Office term | Note |
| --- | --- | --- |
| Worksheet / Workbook | Lapas / Sąsiuvinis | Calc |
| PivotTable / PivotChart | Suvestinė / Suvestinės diagrama | Calc |
| Conditional Formatting | Sąlyginis formatavimas | Calc |
| Data Validation | Duomenų tikrinimas | Calc |
| Freeze Panes | Užfiksuoti sritis | Calc |
| Name Manager | Vardų tvarkyklė | Calc |
| Remove Duplicates | Šalinti dublikatus | Calc |
| Flash Fill | Akimirksniu užpildymas | Calc |
| Slicer / Sparkline | Duomenų filtras / Miniatiūrinė diagrama | Calc |
| Goal Seek / What-If Analysis | Tikslo siekis / Jei–tai analizė | Calc |
| Slide / Slide master / Layout | Skaidrė / Skaidrių ruošinys / Maketas | Show |
| Speaker notes / Presenter view | Pranešėjo pastabos / Pranešėjo rodinys | Show |
| Fly In / Fade / Wipe / Appear | Įskridimas / Išblukimas / Nuvalymas / Atsiradimas | Show |
| Morph / Reveal / Shred | Transformacija / Atidengimas / Susmulkinimas | Show transitions |
| Bookmark | Žymė | Write |
| Caption | Užrašas | Write (doubt: Office may say "Antraštė") |
| Footnote / Endnote | Išnaša / Galinė išnaša | Write |
| Cross-reference | Kryžminė nuoroda | Write |
| Header / Footer (page) | Viršutinė antraštė / Apatinė antraštė | Office: "Viršutinė ir apatinė antraštė"; Heading = "Antraštė" |
| Alt text | Alternatyvusis tekstas | |
| Hyperlink | Hipersaitas | |
| Margins | Paraštės | |
