# Glossary: Czech (`cs`)

Source: the Czech localisation of Microsoft Office (Word, Excel, PowerPoint) and its terminology. Translator: P9-L5. Reviewer: P9-LR3 (2026-10-18).

## Register
- Address: informal "ty / tě / tvůj / tvá / tvé" (singular; "Tvé dokumenty", "tvůj počítač"); imperatives in the 2nd person singular ("Zadej", "Vyber", "Klikni", "Zkontroluj", "Ulož"); never vykání ("Vyberte", "Zadejte", "Vy", "Vám", "Váš") and no polite "prosím".
- Buttons and menu commands: infinitive, as Office does ("Uložit", "Otevřít", "Vložit tabulku"); dialog titles as verbal nouns ("Vložení hypertextového odkazu", "Formát buněk" as Office names it).
- Gender-neutral wording: avoid masculine past forms addressed to the user ("jsi přidal", "abys mohl") – use imperatives, passives or impersonal forms ("přidané servery", "Pro jistotu, že…").
- Ellipsis "…" for commands that open a dialog, as in English.
- Quotation marks: „…“ (Czech low-high pair).
- Keyboard key names in shortcut texts (packages/ui-shared/src/i18n/keyNames.ts): Czech Office keeps Ctrl = Ctrl, Shift = Shift, Delete = Delete, Enter = Enter (no table entry needed).
- Plural categories: `one / few / many / other`. `one` = 1; `few` = 2–4; `many` = fractions ("1,5 řádku", genitive singular); `other` = 0 and 5+ (genitive plural: "5 řádků"). Where the noun would need declension a neutral pattern is used ("… ({count})", "Kontingenční tabulky vyžadující aktualizaci: {count}"). Unit abbreviations ("před {count} min") are identical in all four forms.
- Review (P9-LR3): `.many` is the fraction form (genitive singular: "Vloženo 1,5 snímku"), `.other` covers 0 and 5+; ".one" reads naturally for 1 ("Vybrat {count} výskyt", not "všech"); *spacing* is "mezery", *line spacing* "řádkování".
- Sparklines: Minigrafy (group), Minigraf (tab), Spojnicový / Sloupcový / Vzestup/pokles, Nástroje minigrafu; Error Bars: Chybové úsečky; High-Low Lines: Spojnice extrémů.
- Arrange: Přenést do popředí / Přenést blíž / Přesunout dál / Přesunout do pozadí; Solid fill: Souvislá výplň; margins in cm.

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

| Save | Uložit | `ai.settings.save` |
| Insert | Vložit | `ai.write.insert` |
| New | Nový | `backstage.new` |
| Open… | Otevřít… | `backstage.open` |
| Options… | Možnosti… | `backstage.options` |
| Save As… | Uložit jako… | `backstage.saveAs` |
| Cut | Vyjmout | `cmd.cut` |
| Delete | Odstranit | `cmd.delete` |
| Paste | Vložit | `cmd.paste` |
| Replace… | Nahradit… | `cmd.replaceDots` |
| Undo | Zpět | `cmd.undo` |
| Size | Velikost | `conn.browser.colSize` |
| Rename | Přejmenovat | `conn.browser.rename` |
| Bold | Tučné | `fmt.bold` |
| Colors | Barvy | `fmt.colors` |
| Italic | Kurzíva | `fmt.italic` |
| Strikethrough | Přeškrtnuté | `fmt.strike` |
| Underline | Podtržené | `fmt.underline` |
| Zoom | Lupa | `group.zoom` |
| Layout | Rozložení | `print.layoutSection` |
| Margins | Okraje | `print.margins` |
| Normal | Normální | `print.margins.normal` |
| Orientation | Orientace | `print.orientation` |
| Format | Formát | `sc.format` |
| Remove Arrows | Odebrat šipky | `calc.audit.removeArrows` |
| Show Formulas | Zobrazit vzorce | `calc.audit.showFormulas` |
| Trace Dependents | Vyhledat závislé buňky | `calc.audit.traceDependents` |
| Breaks | Konce stránek | `calc.breaks` |
| Fill | Výplň | `calc.cf.barFill` |
| Clear | Vymazat | `calc.cf.clearFormat` |
| Shapes | Tvary | `calc.cf.iconGroup.shapes` |
| Gridlines | Mřížka | `calc.chart.ae.gridlines` |
| Chart | Graf | `calc.chart.chart` |
| Center | Na střed | `calc.chart.pos.center` |
| Recommended Charts | Doporučené grafy | `calc.chart.recommended` |
| Shape Fill | Výplň tvaru | `calc.chart.shapeFill` |
| Shape Outline | Obrys tvaru | `calc.chart.shapeOutline` |
| New Comment | Nový komentář | `calc.comments.new` |
| Comment | Komentář | `calc.comments.textLabel` |
| Consolidate | Konsolidovat | `calc.consolidate.button` |
| Delete Cells… | Odstranit buňky… | `calc.deleteCellsDots` |
| Columns | Sloupce | `calc.dup.columns` |
| Select All | Vybrat vše | `calc.dup.selectAll` |
| Filter | Filtrovat | `calc.filter` |
| Font Color | Barva písma | `calc.filter.byFontColor` |
| Effects | Efekty | `calc.fmt.effects` |
| Justify | Do bloku | `calc.fmt.h.justify` |
| Indent | Odsazení | `calc.fmt.indent` |
| Preview | Náhled | `calc.fmt.preview` |
| Subscript | Dolní index | `calc.fmt.subscript` |
| Superscript | Horní index | `calc.fmt.superscript` |
| Symbol | Symbol | `calc.fmt.symbol` |
| AutoSum | Automatický součet | `calc.fn.autoSum` |
| Insert Function | Vložit funkci | `calc.fn.insert` |
| Format Painter | Kopírovat formát | `calc.formatPainter` |
| Insert Cells… | Vložit buňky… | `calc.insertCellsDots` |
| Link | Odkaz | `calc.link.button` |
| Merge Cells | Sloučit buňky | `calc.mergeCells` |
| Move or Copy… | Přesunout nebo kopírovat… | `calc.moveCopy.dots` |
| Define Name | Definovat název | `calc.names.define` |
| Group | Seskupit | `calc.outline.group` |
| Ungroup | Zrušit seskupení | `calc.outline.ungroup` |
| Page Setup | Vzhled stránky | `calc.pageSetup` |
| Pictures | Obrázky | `calc.picture.button` |
| Refresh All | Aktualizovat vše | `calc.pivot.refreshAll` |
| Styles | Styly | `calc.pivot.stylesGallery` |
| Print Titles | Tisk nadpisů | `calc.printTitles` |
| Sort | Řazení | `calc.protect.allow.sort` |
| Protect Workbook | Zamknout sešit | `calc.protect.bookDots` |
| Paste Special… | Vložit jinak… | `calc.ps.dots` |
| Previous | Předchozí | `calc.err.previous` |
| Next | Další | `calc.err.next` |
| Calculate Now | Přepočítat nyní | `calc.calc.now` |
| Sort & Filter | Seřadit a filtrovat | `calc.sortFilter` |
| Properties | Vlastnosti | `calc.table.properties` |
| Table | Tabulka | `calc.table.table` |
| Unhide | Zobrazit | `calc.unhide` |
| Align Left | Zarovnat vlevo | `write.alignObj.left` |
| Align Right | Zarovnat vpravo | `write.alignObj.right` |
| Align | Zarovnat | `write.alignObjects` |
| Equation | Rovnice | `write.caption.equation` |
| Position | Pozice | `write.caption.position` |
| Crop | Oříznout | `write.crop` |
| Spacing | Mezery | `write.font.spacing` |
| Bring Forward | Přenést blíž | `write.order.bringForward` |
| Bring to Front | Přenést do popředí | `write.order.bringToFront` |
| Send Backward | Přesunout dál | `write.order.sendBackward` |
| Send to Back | Přesunout do pozadí | `write.order.sendToBack` |
| Picture | Obrázek | `write.picture` |
| Section | Oddíl | `write.reveal.section` |
| Rotate | Otočit | `write.rotate` |
| Ruler | Pravítko | `write.ruler` |
| Hyperlink | Hypertextový odkaz | `write.styleName.hyperlink` |
| Numbering… | Číslování… | `write.styles.format.numbering` |
| Text Box | Textové pole | `write.textBox` |
| Reset | Obnovit | `write.notes.sep.reset` |
| Format Background | Formát pozadí | `show.bg.format` |
| Background Styles | Styly pozadí | `show.bg.styles` |
| Fonts | Písma | `show.design.fonts` |
| Themes | Motivy | `show.design.themes` |
| Header & Footer… | Záhlaví a zápatí… | `show.hf.titleDots` |
| Guides | Vodítka | `show.view.guides` |
| Notes Page | Stránka poznámek | `show.view.notesPage` |
| Fill Color | Barva výplně | `show.fx.fillColor` |
| From Current Slide… | Od aktuálního snímku… | `show.recordFromCurrent` |
| From Beginning… | Od začátku… | `show.recordFromStart` |
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

## Show effects and transitions
Animation effects (`show.fx.*`) and slide transitions (`show.trans.*`) as the catalogs name them (P9-LR3). Names marked as doubtful in the review report are not verified against a localised PowerPoint.

| English | Term | Key |
| --- | --- | --- |
| Appear | Zobrazení | `show.fx.appear` |
| Disappear | Zmizení | `show.fx.disappear` |
| Fade | Vyblednutí | `show.fx.fade` |
| Fly In | Přiletět | `show.fx.flyIn` |
| Fly Out | Odletět | `show.fx.flyOut` |
| Grow/Shrink | Zvětšit/zmenšit | `show.fx.growShrink` |
| Spin | Roztočit | `show.fx.spin` |
| Wipe | Setření | `show.fx.wipe` |
| Zoom | Zoom | `show.fx.zoom` |
| Cover | Zakrýt | `show.trans.cover` |
| Cut | Střih | `show.trans.cut` |
| Fade | Prolnutí | `show.trans.fade` |
| None | Žádný | `show.trans.none` |
| Push | Posunout | `show.trans.push` |
| Split | Rozdělit | `show.trans.split` |
| Wipe | Setření | `show.trans.wipe` |
| Zoom | Zoom | `show.trans.zoom` |
| Morph | Morf | `show.trans.morph` |
| Reveal | Odhalení | `show.trans.reveal` |
| Shred | Rozstříhání | `show.trans.shred` |
| Fall Over | Převrácení | `show.trans.fallOver` |
| Drape | Záclona | `show.trans.drape` |
| Curtains | Závěsy | `show.trans.curtains` |
| Wind | Vítr | `show.trans.wind` |
| Prestige | Prestiž | `show.trans.prestige` |
| Fracture | Roztříštění | `show.trans.fracture` |
| Crush | Rozdrcení | `show.trans.crush` |
| Peel Off | Odlepení | `show.trans.peelOff` |
| Page Curl | Zvlnění stránky | `show.trans.pageCurl` |
| Airplane | Letadlo | `show.trans.airplane` |
| Origami | Origami | `show.trans.origami` |
| Honeycomb | Plástev | `show.trans.honeycomb` |
| Glitter | Třpyt | `show.trans.glitter` |
| Vortex | Vír | `show.trans.vortex` |
| Ripple | Vlnění | `show.trans.ripple` |
| Switch | Přepínač | `show.trans.switch` |
| Flip | Překlopení | `show.trans.flip` |
| Gallery | Galerie | `show.trans.gallery` |
| Cube | Krychle | `show.trans.cube` |
| Doors | Dveře | `show.trans.doors` |
| Box | Krabice | `show.trans.box` |
| Float In | Plovoucí vstup | `show.fx.float` |
| Float Out | Plovoucí odchod | `show.fx.floatOut` |
| Split | Rozdělit | `show.fx.split` |
| Shape | Tvar | `show.fx.shape` |
| Circle | Kruh | `show.fx.circle` |
| Box | Krabice | `show.fx.box` |
| Diamond | Kosočtverec | `show.fx.diamond` |
| Plus | Plus | `show.fx.plus` |
| Wheel | Kolo | `show.fx.wheel` |
| Random Bars | Náhodné pruhy | `show.fx.randomBars` |
| Grow & Turn | Zvětšit a otočit | `show.fx.growTurn` |
| Shrink & Turn | Zmenšit a otočit | `show.fx.shrinkTurn` |
| Swivel | Kývání | `show.fx.swivel` |
| Bounce | Poskakování | `show.fx.bounce` |
| Pulse | Pulzování | `show.fx.pulse` |
| Color Pulse | Barevné pulzování | `show.fx.colorPulse` |
| Teeter | Houpání | `show.fx.teeter` |
| Desaturate | Snížit sytost | `show.fx.desaturate` |
| Darken | Ztmavit | `show.fx.darken` |
| Lighten | Zesvětlit | `show.fx.lighten` |
| Transparency | Průhlednost | `show.fx.transparency` |
| Object Color | Barva objektu | `show.fx.objectColor` |
| Line Color | Barva čáry | `show.fx.lineColor` |
| Fill Color | Barva výplně | `show.fx.fillColor` |
| Brush Color | Barva štětce | `show.fx.brushColor` |
| Font Color | Barva písma | `show.fx.fontColor` |
| Underline | Podtržení | `show.fx.underline` |
| Bold Flash | Tučné zablesknutí | `show.fx.boldFlash` |
| Bold Reveal | Tučné odhalení | `show.fx.boldReveal` |
| Wave | Vlna | `show.fx.wave` |
| Lines | Čáry | `show.fx.pathLines` |
| Arcs | Oblouky | `show.fx.pathArcs` |
| Turns | Zatáčky | `show.fx.pathTurns` |
| Shapes | Tvary | `show.fx.pathShapes` |
| Loops | Smyčky | `show.fx.pathLoops` |
| Custom Path | Vlastní cesta | `show.fx.pathCustom` |
| Play | Přehrát | `show.fx.mediaPlay` |
| Pause | Pozastavit | `show.fx.mediaPause` |
| Stop | Zastavit | `show.fx.mediaStop` |

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
| Split (View) | Rozdělit | Calc (P9-LF) |
| Go To Special… / Special… | Přejít na – jinak… / Jinak… | Calc |
| Picture Format / Alt Text | Formát obrázku / Alternativní text | Calc |
| Mention someone | Zmínit někoho | Calc comments |
| Reasoning (AI setting, reasoning_effort) | Uvažování | Settings › AI, actions (P9-LF pass 2) |
| dropped (reader warnings) | vynechán(a/o/y) | `reader.xlsx.*` / `reader.pptx.*`, as in `reader.docx.*` |
| read as (reader warnings) | načten(a/o) jako | reader warnings |
| dangling relationship | neplatná relace | reader warnings |
| Custom show (PowerPoint) | Vlastní prezentace | `reader.pptx.customShow.*` |
| Pivot cache | mezipaměť kontingenční tabulky | `reader.xlsx.pivotCache.*` |

## Touch, compact layout and PDF export (P10-LF, 2026-10-23)

One term per gesture across the five catalogs (cycle 3.1415: ui-shared compact bars and sheets, the touch UI of Calc/Write/Show, PDF export, the portal's signing texts).

| English | Term | Used in |
| --- | --- | --- |
| tap | klepnout („Klepnutím …“) | `calc.keys.ref`, `calc.stats.next`, `show.touch.tapToPlay` |
| long press | dlouhé stisknutí | (context menu as a sheet; no catalog text yet) |
| pinch | sevření prstů | (zoom; no catalog text yet) |
| swipe | přejetí prstem | (no catalog text yet) |
| selection handle | úchyt | `write.touch.handleStart` / `handleEnd` |
| bottom sheet | panel (ne „list“ = worksheet) | `compact.moreSheet`, `compact.closeSheet` (aria labels) |
| fingerprint (GPG) | otisk | `portal.dl.signed.linux`, `portal.dl.sums.text` |
| release key | klíč pro vydání | `portal.dl.signed.linux`, `portal.dl.sums.text` |
| notarized (Apple) | notarizováno | `portal.dl.signed.macos` |
| More | Další | `compact.more` |
| More commands | Další příkazy | `compact.moreSheet` |
| Fill | Vyplnit | `calc.touch.fill` |
| Fill series | Vyplnit řady | `calc.touch.fillSeries` |
| Copy cells | Kopírovat buňky | `calc.touch.copyCells` |
| Ref | Odk. | `calc.keys.refShort` |
| Share as PDF… | Sdílet jako PDF… | `backstage.sharePdf` |
| Export PDF | Exportovat do PDF | `print.exportPdf` |
| Multi-select | Vícenásobný výběr | `show.touch.multiSelect` |
