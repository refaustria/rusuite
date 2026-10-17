# Glossary: Romanian (`ro`)

Source: the Romanian (Romania) localisation of Microsoft Office (Word, Excel, PowerPoint) and its terminology. Translator: P9-L8. Reviewer: –.

## Register
- Address: informal "tu / te / tău", 2nd-person singular imperatives in instructions and messages ("Introdu", "Alege", "Fă clic", "Apasă", "Verifică"); never "dumneavoastră / dumneata / dvs." or the plural-polite "-ați / -ați" imperatives ("Alegeți"). 2nd-person singular indicative ("trimiți", "uiți") is fine.
- Buttons and menu commands: the verbal noun, as Office does ("Salvare", "Inserare", "Lipire", "Aplicare", "Ștergere"); messages and hints use the informal imperative.
- Ellipsis "…" for commands that open a dialog, as in English.
- Diacritics with comma below only (ș, ț), never the cedilla forms (ş, ţ). Quotes „…”.
- Keyboard key names in shortcut texts (packages/ui-shared/src/i18n/keyNames.ts): Romanian Office keeps Ctrl = Ctrl, Shift = Shift, Delete = Delete, Enter = Enter (no `KEY_NAMES` entry).
- Plural categories: `one / few / other`. `few` is 0 and 2–19 ("{count} diapozitive"), `other` is 20+ and puts "de" before the noun ("{count} de diapozitive"); unit abbreviations ("acum {count} h") are the same in all three.

## Ribbon tabs
| English | Office term | Note |
| --- | --- | --- |
| File | Fișier | |
| Home | Pornire | |
| Insert | Inserare | |
| Draw | Desen | |
| Design | Proiectare | Word/PowerPoint "Proiectare" |
| Layout (Write: Layout, Calc: Page Layout) | Aspect (Calc: Aspect pagină) | |
| References | Referințe | Write |
| Mailings | Corespondență | Write |
| Review | Revizuire | |
| View | Vizualizare | |
| Formulas | Formule | Calc |
| Data | Date | Calc |
| Transitions | Tranziții | Show |
| Animations | Animații | Show |
| Slide Show | Expunere diapozitive | Show |
| Help | Ajutor | |
| Picture / Table / Chart / Drawing Tools (contextual) | Instrumente imagine / tabel / grafic / desen | |

## Ribbon groups
| English | Office term | Note |
| --- | --- | --- |
| Clipboard | Clipboard | |
| Font | Font | |
| Paragraph | Paragraf | |
| Styles | Stiluri | |
| Editing | Editare | |
| Number | Număr | Calc |
| Alignment | Aliniere | Calc |
| Cells | Celule | Calc |
| Slides | Diapozitive | Show |
| Drawing | Desen | Show |
| Zoom | Panoramare | Office ro "Panoramare" |
| Show (View › Show) | Afișare | |
| Language | Limbă | the picker; label "Limbă / Language" |

## Common commands
| English | Office term | Note |
| --- | --- | --- |
| New | Nou | |
| Open… | Deschidere… | |
| Save | Salvare | |
| Save As… | Salvare ca… | |
| Print | Imprimare | |
| Export PDF… | Exportare PDF… | |
| Close | Închidere | |
| Options… | Opțiuni… | |
| Undo / Redo | Anulare / Refacere | |
| Cut / Copy / Paste | Decupare / Copiere / Lipire | |
| Paste Special… | Lipire specială… | |
| Format Painter | Descriptor de formate | |
| Find / Replace… / Go To… | Găsire / Înlocuire… / Salt la… | |
| Select All | Selectare totală | |
| Bold / Italic / Underline / Strikethrough | Aldin / Cursiv / Subliniat / Tăiere cu o linie | |
| Font Color / Highlight / Fill Color | Culoare font / Evidențiere / Culoare de umplere | |
| Insert Picture / Table / Chart / Shape / Text Box | Inserare imagine / tabel / grafic / formă / casetă text | |
| Bring to Front / Send to Back | Aducere în prim-plan / Trimitere în plan secundar | |
| Group / Ungroup | Grupare / Anulare grupare | |
| Sort / Filter | Sortare / Filtrare | Calc |
| Insert Function | Inserare funcție | Calc |
| New Slide | Diapozitiv nou | Show |
| From Beginning / From Current Slide | De la început / De la diapozitivul curent | Show |
| Track Changes / Comments | Urmărire modificări / Comentarii | Write |

## Dialog buttons and messages
| English | Office term | Note |
| --- | --- | --- |
| OK | OK | |
| Cancel | Revocare | Office ro: "Revocare" (while Undo = "Anulare") |
| Apply | Aplicare | |
| Close | Închidere | |
| Yes / No | Da / Nu | |
| Don't Save | Nu salva | the unsaved-changes prompt |
| Browse… | Răsfoire… | |
| Reset | Resetare | |
| Insert / Delete | Inserare / Ștergere | |
| Back / Next / Finish | Înapoi / Următorul / Terminare | wizards |
| Recent | Recente | backstage |
| Untitled | Fără titlu | default document name |
| Saved / Saving… / Unsaved changes | Salvat / Se salvează… / Modificări nesalvate | status bar |

## File types
| English | Office term | Note |
| --- | --- | --- |
| Excel Workbook | Registru de lucru Excel | `.xlsx`, the desktop dialog filter name |
| Word Document | Document Word | `.docx` |
| PowerPoint Presentation | Prezentare PowerPoint | `.pptx` |
| Excel Template / Word Template / PowerPoint Template | Șablon Excel / Șablon Word / Șablon PowerPoint | `.xltx` / `.dotx` / `.potx` |
| CSV (Comma delimited) | CSV (delimitat prin virgulă) | Calc |
| Text Files | Fișiere text | |
| PDF | PDF | |
| Office Theme | Temă Office | `.thmx` |
| All Files | Toate fișierele | |

## More terms
| English | Office term | Note |
| --- | --- | --- |
| Workbook / Worksheet | Registru de lucru / Foaie de lucru | Calc |
| PivotTable / PivotChart | PivotTable / PivotChart | kept as in Office ro |
| Conditional Formatting | Formatare condiționată | |
| Data Bars / Color Scales / Icon Sets | Bare de date / Scale de culori / Seturi de pictograme | |
| Goal Seek | Căutare țintă | |
| Flash Fill | Umplere rapidă | |
| Slicer | Feliator | |
| Sparklines | Minigrafice | |
| Remove Duplicates | Eliminare dubluri | |
| Data Validation | Validare date | |
| Freeze Panes | Înghețare panouri | |
| Name Manager | Manager nume | |
| Slide / Slide Master / Layout | Diapozitiv / Model diapozitive / Machetă | Show |
| Speaker notes | Note pentru vorbitor | |
| Presenter view | Vizualizare prezentator | |
| Footnote / Endnote | Notă de subsol / Notă de final | Write |
| Bookmark / Cross-reference | Marcaj / Referință încrucișată | Write |
| Header / Footer | Antet / Subsol | |
| Table of contents | Cuprins | |
| Comment thread / Resolve | Conversație de comentarii / Rezolvare | |
| Text box | Casetă text | |
| Wrap Text | Încadrare text | |
| AI assistant | Asistent AI | |
