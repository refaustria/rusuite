# Glossary: Hungarian (`hu`)

Source: the Hungarian (Magyarország) localisation of Microsoft Office (Word, Excel, PowerPoint) and its terminology. Translator: P9-L7. Reviewer: –.

## Register
- Address: informal "te", with the possessive suffix on the noun ("a dokumentumaid", "a nevedet") and imperatives in the 2nd person singular ("Válassz", "Kattints", "Add meg", "Jelölj ki", "Próbáld újra"); never "Ön / Önök", "Maga" or the polite 3rd-person imperatives ("Válassza", "Kattintson", "Adja meg"). Office's "Kattintson" becomes "Kattints".
- Descriptions of the program or of a third thing use the 3rd person ("az alkalmazás tárolja", "a modell"), not an address.
- Buttons and menu commands: verbal nouns as Hungarian Office does ("Mentés", "Megnyitás", "Beillesztés"); sentences to the user are in the informal imperative.
- Ellipsis "…" for commands that open a dialog, as in English.
- Quotation marks: „…” (low-high); decimal comma ("29,7 × 42 cm"); numbers followed by a unit have a space; percent without space ("25%") as in Hungarian Office lists.
- Articles before placeholders: "a(z) {name}" so the article fits both vowel and consonant starts.
- Keyboard key names in shortcut texts (packages/ui-shared/src/i18n/keyNames.ts): Hungarian Office keeps the English key names (Ctrl, Shift, Alt, Delete, Enter) – no entry in `KEY_NAMES`.
- Plural categories: `one / other`; after a number the noun stays singular ("3 megjegyzés"), so both forms read the same.
- Slides are "dia" (PowerPoint hu), "Slide Show" = "Diavetítés".

## Ribbon tabs
| English | Office term | Note |
| --- | --- | --- |
| File | Fájl | |
| Home | Kezdőlap | |
| Insert | Beszúrás | |
| Draw | Rajz | |
| Design | Tervezés | |
| Layout (Write: Layout, Calc: Page Layout) | Elrendezés / Lapelrendezés | Write: "Elrendezés", Calc: "Lapelrendezés" |
| References | Hivatkozások | Write |
| Mailings | Levelek | not used (no mailings tab) |
| Review | Véleményezés | |
| View | Nézet | |
| Formulas | Képletek | Calc |
| Data | Adatok | Calc |
| Transitions | Átmenetek | Show |
| Animations | Animációk | Show |
| Slide Show | Diavetítés | Show |
| Help | Súgó | |
| Picture / Table / Chart / Drawing Tools (contextual) | Képeszközök / Táblázateszközök / Diagrameszközök / Rajzeszközök | |

## Ribbon groups
| English | Office term | Note |
| --- | --- | --- |
| Clipboard | Vágólap | |
| Font | Betűtípus | |
| Paragraph | Bekezdés | |
| Styles | Stílusok | |
| Editing | Szerkesztés | |
| Number | Szám | Calc |
| Alignment | Igazítás | Calc |
| Cells | Cellák | Calc |
| Slides | Diák | Show |
| Drawing | Rajzolás | Show |
| Zoom | Nagyítás | |
| Show (View › Show) | Megjelenítés | |
| Language | Nyelv | the picker; label "Nyelv / Language" |

## Common commands
| English | Office term | Note |
| --- | --- | --- |
| New | Új | |
| Open… | Megnyitás… | |
| Save | Mentés | |
| Save As… | Mentés másként… | |
| Print | Nyomtatás | |
| Export PDF… | Exportálás PDF-be… | |
| Close | Bezárás | |
| Options… | Beállítások… | |
| Undo / Redo | Visszavonás / Újra | |
| Cut / Copy / Paste | Kivágás / Másolás / Beillesztés | |
| Paste Special… | Irányított beillesztés… | |
| Format Painter | Formátummásoló | |
| Find / Replace… / Go To… | Keresés / Csere… / Ugrás… | |
| Select All | Az összes kijelölése | |
| Bold / Italic / Underline / Strikethrough | Félkövér / Dőlt / Aláhúzott / Áthúzott | |
| Font Color / Highlight / Fill Color | Betűszín / Kiemelés / Kitöltőszín | |
| Insert Picture / Table / Chart / Shape / Text Box | Kép / Táblázat / Diagram / Alakzat / Szövegdoboz beszúrása | |
| Bring to Front / Send to Back | Előtérbe hozás / Hátraküldés | |
| Group / Ungroup | Csoportosítás / Csoport felbontása | |
| Sort / Filter | Rendezés / Szűrő | Calc |
| Insert Function | Függvény beszúrása | Calc |
| New Slide | Új dia | Show |
| From Beginning / From Current Slide | Az elejétől / Az aktuális diától | Show |
| Track Changes / Comments | Változások követése / Megjegyzések | Write |

## Dialog buttons and messages
| English | Office term | Note |
| --- | --- | --- |
| OK | OK | |
| Cancel | Mégse | |
| Apply | Alkalmaz | |
| Close | Bezárás | |
| Yes / No | Igen / Nem | |
| Don't Save | Ne mentsd | the unsaved-changes prompt (informal imperative; Office: "Nem menti") |
| Browse… | Tallózás… | |
| Reset | Alaphelyzet | |
| Insert / Delete | Beszúrás / Törlés | |
| Back / Next / Finish | Vissza / Tovább / Befejezés | wizards |
| Recent | Legutóbbi | backstage |
| Untitled | Névtelen | default document name |
| Saved / Saving… / Unsaved changes | Mentve / Mentés… / Nem mentett módosítások | status bar |

## File types
| English | Office term | Note |
| --- | --- | --- |
| Excel Workbook | Excel-munkafüzet | `.xlsx`, the desktop dialog filter name |
| Word Document | Word-dokumentum | `.docx` |
| PowerPoint Presentation | PowerPoint-bemutató | `.pptx` |
| Excel Template / Word Template / PowerPoint Template | Excel- / Word- / PowerPoint-sablon | `.xltx` / `.dotx` / `.potx` |
| CSV (Comma delimited) | CSV (vesszővel tagolt) | Calc |
| Text Files | Szövegfájlok | |
| PDF | PDF | |
| Office Theme | Office-téma | `.thmx` |
| All Files | Minden fájl | |

## More terms
| English | Office term | Note |
| --- | --- | --- |
| Workbook / Worksheet | Munkafüzet / Munkalap | Calc |
| Cell / Range | Cella / Tartomány | Calc |
| PivotTable / PivotChart | Kimutatás / Kimutatásdiagram | Calc |
| Slicer / Sparkline | Szeletelő / Értékgörbe | Calc |
| Conditional Formatting | Feltételes formázás | Calc; Data Bars = Adatsávok, Color Scales = Színskálák, Icon Sets = Ikonkészletek |
| Data Validation | Adatérvényesítés | Calc |
| Goal Seek / What-If Analysis | Célérték keresése / Mi lenne, ha elemzés | Calc |
| Name Manager | Névkezelő | Calc |
| Flash Fill | Gyorskitöltés | Calc |
| Text to Columns | Szövegből oszlopok | Calc |
| Protect Sheet | Munkalap védelme | Calc |
| Freeze Panes | Ablaktáblák rögzítése | Calc |
| Slide / Section | Dia / Szakasz | Show |
| Slide Master | Diaminta | Show |
| Layout (slide) | Elrendezés | Show |
| Presenter view | Előadói nézet | Show |
| Speaker notes | Előadói jegyzetek | Show |
| Entrance / Emphasis / Exit | Bevezető / Hangsúlyozó / Kilépő | Show animations |
| Appear / Disappear / Fade / Fly In / Fly Out / Wipe | Megjelenés / Eltűnés / Elhalványulás / Berepülés / Kirepülés / Letörlés | Show effects |
| Morph / Reveal / Honeycomb / Page Curl | Áttűnés / Felfedés / Méhsejt / Lapozás | Show transitions |
| Footnote / Endnote | Lábjegyzet / Végjegyzet | Write |
| Bookmark | Könyvjelző | Write |
| Cross-reference | Kereszthivatkozás | Write |
| Table of contents | Tartalomjegyzék | Write |
| Header / Footer | Élőfej / Élőláb | |
| Hyperlink | Hiperhivatkozás | |
| Margins / Orientation / Paper size | Margók / Tájolás / Papírméret | |
| Autosave | Automatikus mentés | |
| Alt text | Alternatív szöveg | |
| Chart title / Axis / Legend / Trendline | Diagramcím / Tengely / Jelmagyarázat / Trendvonal | |
| Column / Bar / Pie / Doughnut / Scatter chart | Oszlop- / Sáv- / Kör- / Perec- / Pontdiagram | |
