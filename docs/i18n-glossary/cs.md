# Glossary: Czech (`cs`)

Source: the Czech localisation of Microsoft Office (Word, Excel, PowerPoint) and its terminology. Translator: P9-L5. Reviewer: –.

## Register
- Address: informal "ty / tě / tvůj / tvá / tvé" (singular; "Tvé dokumenty", "tvůj počítač"); imperatives in the 2nd person singular ("Zadej", "Vyber", "Klikni", "Zkontroluj", "Ulož"); never vykání ("Vyberte", "Zadejte", "Vy", "Vám", "Váš") and no polite "prosím".
- Buttons and menu commands: infinitive, as Office does ("Uložit", "Otevřít", "Vložit tabulku"); dialog titles as verbal nouns ("Vložení hypertextového odkazu", "Formát buněk" as Office names it).
- Gender-neutral wording: avoid masculine past forms addressed to the user ("jsi přidal", "abys mohl") – use imperatives, passives or impersonal forms ("přidané servery", "Pro jistotu, že…").
- Ellipsis "…" for commands that open a dialog, as in English.
- Quotation marks: „…“ (Czech low-high pair).
- Keyboard key names in shortcut texts (packages/ui-shared/src/i18n/keyNames.ts): Czech Office keeps Ctrl = Ctrl, Shift = Shift, Delete = Delete, Enter = Enter (no table entry needed).
- Plural categories: `one / few / many / other`. `one` = 1; `few` = 2–4; `many` = fractions ("1,5 řádku", genitive singular); `other` = 0 and 5+ (genitive plural: "5 řádků"). Where the noun would need declension a neutral pattern is used ("… ({count})", "Kontingenční tabulky vyžadující aktualizaci: {count}"). Unit abbreviations ("před {count} min") are identical in all four forms.

## Ribbon tabs
| English | Office term | Note |
| --- | --- | --- |
| File | Soubor | |
| Home | Domů | ribbon tab and backstage page |
| Insert | Vložení | |
| Draw | Kreslení | |
| Design | Návrh | |
| Layout (Write: Layout, Calc: Page Layout) | Rozložení / Rozložení stránky | Calc: "Rozložení stránky" |
| References | Reference | Write |
| Mailings | Korespondence | Write |
| Review | Revize | |
| View | Zobrazení | |
| Formulas | Vzorce | Calc |
| Data | Data | Calc |
| Transitions | Přechody | Show |
| Animations | Animace | Show |
| Slide Show | Prezentace | Show |
| Help | Nápověda | |
| Picture / Table / Chart / Drawing Tools (contextual) | Nástroje obrázku / tabulky / grafu / kresby | |

## Ribbon groups
| English | Office term | Note |
| --- | --- | --- |
| Clipboard | Schránka | |
| Font | Písmo | |
| Paragraph | Odstavec | |
| Styles | Styly | |
| Editing | Úpravy | |
| Number | Číslo | Calc |
| Alignment | Zarovnání | Calc |
| Cells | Buňky | Calc |
| Slides | Snímky | Show |
| Drawing | Kreslení | Show |
| Zoom | Lupa | |
| Show (View › Show) | Zobrazit | |
| Language | Jazyk | the picker; label "Jazyk / Language" |

## Common commands
| English | Office term | Note |
| --- | --- | --- |
| New | Nový | |
| Open… | Otevřít… | |
| Save | Uložit | |
| Save As… | Uložit jako… | |
| Print | Tisk | |
| Export PDF… | Exportovat do PDF… | |
| Close | Zavřít | |
| Options… | Možnosti… | |
| Undo / Redo | Zpět / Znovu | |
| Cut / Copy / Paste | Vyjmout / Kopírovat / Vložit | |
| Paste Special… | Vložit jinak… | |
| Format Painter | Kopírovat formát | |
| Find / Replace… / Go To… | Najít / Nahradit… / Přejít na… | |
| Select All | Vybrat vše | |
| Bold / Italic / Underline / Strikethrough | Tučné / Kurzíva / Podtržené / Přeškrtnuté | |
| Font Color / Highlight / Fill Color | Barva písma / Barva zvýraznění textu / Barva výplně | |
| Insert Picture / Table / Chart / Shape / Text Box | Vložit obrázek / tabulku / graf / tvary / textové pole | |
| Bring to Front / Send to Back | Přenést do popředí / Přenést do pozadí | |
| Group / Ungroup | Seskupit / Zrušit seskupení | |
| Sort / Filter | Seřadit / Filtrovat | Calc |
| Insert Function | Vložit funkci | Calc |
| New Slide | Nový snímek | Show |
| From Beginning / From Current Slide | Od začátku / Od aktuálního snímku | Show |
| Track Changes / Comments | Sledování změn / Komentáře | Write |

## Commands as used in the catalogs
| English | Term | Key |
| --- | --- | --- |
| Copy | Kopírovat | `ai.pane.copy` |
| Close | Zavřít | `backstage.close` |
| Print | Tisk | `backstage.print` |
| Find | Najít | `cmd.find` |
| Redo | Znovu | `cmd.redo` |
| Borders | Ohraničení | `fmt.borders` |
| Conditional Formatting | Podmíněné formátování | `calc.cf.menu` |
| Data Bars / Color Scales / Icon Sets | Datové čáry / Barevné škály / Sady ikon | `calc.cf.dataBars` |
| Remove Duplicates | Odebrat duplicity | `calc.dup.button` |
| Data Validation | Ověření dat | `calc.dv.button` |
| Flash Fill | Rychlé vyplnění | `calc.flash.button` |
| Freeze Panes | Ukotvit příčky | `calc.freezePanes` |
| Goal Seek… | Hledání řešení… | `calc.goal.dots` |
| What-If Analysis | Analýza hypotéz | `calc.goal.whatIf` |
| Hide / Unhide | Skrýt / Zobrazit | `calc.hide` |
| Merge & Center | Sloučit a zarovnat na střed | `calc.mergeCenter` |
| Name Manager | Správce názvů | `calc.names.manager` |
| PivotTable | Kontingenční tabulka | `calc.pivot.pivotTable` |
| PivotChart | Kontingenční graf | `calc.pivot.pivotChart` |
| Slicer | Průřez | `calc.slicer.slicer` |
| Print Area | Oblast tisku | `calc.printArea` |
| Protect Sheet… | Zamknout list… | `calc.protect.sheetDots` |
| Error Checking | Kontrola chyb | `calc.err.dialogTitle` |
| Evaluate Formula | Vyhodnotit vzorec | `calc.eval.title` |
| Watch Window | Okno kukátka | `calc.watch.title` |
| Subtotal | Souhrn | `calc.subtotal.button` |
| Text to Columns | Text do sloupců | `calc.wizard.ttcButton` |
| Trace Precedents / Dependents | Vyhledat předchůdce / závislé buňky | `calc.audit.tracePrecedents` |
| Bookmark | Záložka | `write.bookmark.button` |
| Insert Caption | Vložit titulek | `write.caption.button` |
| Cross-reference | Křížový odkaz | `write.xref.button` |
| Footnote / Endnote | Poznámka pod čarou / Vysvětlivka | `write.xref.footnote` |
| Table of contents | Obsah | `write.tableOfContents` |
| Wrap Text | Obtékání textu | `write.wrapText` |
| Selection Pane | Podokno výběru | `write.selectionPane` |
| Navigation Pane | Navigační podokno | `write.navigationPane` |
| Style Inspector | Inspektor stylů | `write.styles.inspector` |
| Reveal Formatting | Odhalit formátování | `write.reveal.button` |
| Spelling | Pravopis | `write.spelling` |
| Split Cells | Rozdělit buňky | `write.splitCells` |
| Header & Footer | Záhlaví a zápatí | `show.hf.title` |
| Slide Master | Předloha snímků | `show.master.tab` |
| Slide Size | Velikost snímku | `show.size.customTitle` |
| Set Up Slide Show | Nastavit prezentaci | `show.setup.titleDots` |
| Presenter view | Zobrazení řečníka | `show.presenterView` |
| Speaker notes | Poznámky řečníka | `show.speakerNotes` |
| Slide Sorter | Řazení snímků | `show.view.sorter` |
| Reading View | Čtecí zobrazení | `show.view.reading` |
| Outline View | Zobrazení osnovy | `show.view.outline` |
| Rehearse Timings | Zkouška načasování | `show.rehearse` |
| Reuse Slides… | Znovu použít snímky… | `show.reuse.menu` |
| Animation Painter | Kopírovat animaci | `show.animPainter` |
| Edit Points | Upravit body | `show.editPoints` |
| Custom Slide Show | Vlastní prezentace | `show.custom.menu` |
| Office Theme | Motiv Office | `show.design.themeFilter` |

## Dialog buttons and messages
| English | Office term | Note |
| --- | --- | --- |
| OK | OK | |
| Cancel | Storno | Office uses "Storno" on buttons |
| Apply | Použít | |
| Close | Zavřít | |
| Yes / No | Ano / Ne | |
| Don't Save | Neukládat | the unsaved-changes prompt |
| Browse… | Procházet… | |
| Reset | Obnovit | |
| Insert / Delete | Vložit / Odstranit | |
| Back / Next / Finish | Zpět / Další / Dokončit | wizards |
| Recent | Nedávné | backstage |
| Untitled | Bez názvu | default document name |
| Saved / Saving… / Unsaved changes | Uloženo / Ukládání… / Neuložené změny | status bar |

## File types
| English | Office term | Note |
| --- | --- | --- |
| Excel Workbook | Excelový sešit | `.xlsx`, the desktop dialog filter name |
| Word Document | Dokument Wordu | `.docx` |
| PowerPoint Presentation | Prezentace PowerPointu | `.pptx` |
| Excel Template / Word Template / PowerPoint Template | Šablona Excelu / Wordu / PowerPointu | `.xltx` / `.dotx` / `.potx` |
| CSV (Comma delimited) | CSV (oddělený čárkami) | Calc: label stays "CSV / TXT" |
| Text Files | Textové soubory | |
| PDF | PDF | |
| Office Theme | Motiv Office | `.thmx` |
| All Files | Všechny soubory | |

## More terms
| English | Office term | Note |
| --- | --- | --- |
| Slide | Snímek | PowerPoint CZ |
| Transition names (Morph, Reveal, Shred …) | Morf, Odhalení, Rozstříhání … | newer PowerPoint effects: translated by analogy, not verified against the Czech UI |
| Float In / Float Out | Plovoucí vstup / Plovoucí odchod | translated by analogy |
| Appear / Disappear / Fly In / Fly Out | Zobrazení / Zmizení / Vlet / Odlet | |
| Banded rows / columns | Pruhované řádky / sloupce | |
| Header row / Total row | Řádek záhlaví / Řádek souhrnu | |
| Widow/Orphan control | Ovládání osiřelých a ovdovělých řádků | |
| Gridlines | Mřížka | |
| Spill (error) | Přetečení | |
| Dialog title (verbal noun) | Vložení funkce, Ověření dat … | |
