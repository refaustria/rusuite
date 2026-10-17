# Glossary: Slovak (`sk`)

Source: the Slovak (Slovakia) localisation of Microsoft Office (Word, Excel, PowerPoint) and its terminology. Translator: P9-L6. Reviewer: P9-LR3 (2026-10-18).

## Register
- Address: informal "ty / ťa / ti / tvoj", imperatives in the 2nd person singular ("Zadaj", "Vyber", "Skontroluj", "Skús"); never "vy / vás / vám / váš" or the plural imperative ("Zadajte"). Gendered past forms ("si otvoril") are avoided: the sentences are reworded neutrally ("od jeho otvorenia").
- Buttons and menu commands: infinitive ("Uložiť", "Vložiť tabuľku"), as Office does; messages to the user are in the informal imperative or a neutral statement.
- Ellipsis "…" for commands that open a dialog, as in English.
- Quotation marks: „…“ (Slovak low-high).
- Keyboard key names in shortcut texts (packages/ui-shared/src/i18n/keyNames.ts): the English names are kept (Ctrl, Shift, Alt, Delete, Enter), as in Slovak Office.
- Plural categories: `one / few / many / other`. `one` = 1 (1 bunka), `few` = 2–4 (2 bunky), `other` = 5+ (5 buniek), `many` = fractions, genitive singular (1,5 bunky; not used for whole counts).
- Review (P9-LR3): gendered adjectives addressed to the user ("Ak si chceš byť istý") are reworded ("Ak si chceš overiť"); `.many` (fractions) uses a neuter participle and the genitive singular ("Nahradené 1,5 bunky"); *snímka* is feminine ("žiadna snímka", "Vložená 1 snímka"); GitHub is declined ("na GitHube", "z GitHubu").

## Ribbon tabs
| English | Office term | Note |
| --- | --- | --- |
| File | Súbor | |
| Home | Domov | |
| Insert | Vložiť | |
| Draw | Kresliť | |
| Design | Návrh | |
| Layout (Write: Layout, Calc: Page Layout) | Rozloženie | Calc: Rozloženie strany |
| References | Referencie | Write |
| Mailings | Korešpondencia | Write |
| Review | Revízia | |
| View | Zobraziť | |
| Formulas | Vzorce | Calc |
| Data | Údaje | Calc |
| Transitions | Prechody | Show |
| Animations | Animácie | Show |
| Slide Show | Prezentácia | Show |
| Help | Pomocník | |
| Picture / Table / Chart / Drawing Tools (contextual) | Nástroje obrázka / tabuľky / grafu / kreslenia | |

## Ribbon groups
| English | Office term | Note |
| --- | --- | --- |
| Clipboard | Schránka | |
| Font | Písmo | |
| Paragraph | Odsek | |
| Styles | Štýly | |
| Editing | Úpravy | |
| Number | Číslo | Calc |
| Alignment | Zarovnanie | Calc |
| Cells | Bunky | Calc |
| Slides | Snímky | Show |
| Drawing | Kreslenie | Show |
| Zoom | Lupa | |
| Show (View › Show) | Zobraziť | as Slovak Office (same word as the View tab) |
| Language | Jazyk | the picker; label "Jazyk / Language" |

## Common commands
| English | Office term | Note |
| --- | --- | --- |
| New | Nový | |
| Open… | Otvoriť… | |
| Save | Uložiť | |
| Save As… | Uložiť ako… | |
| Print | Tlačiť | |
| Export PDF… | Exportovať do PDF… | |
| Close | Zavrieť | |
| Options… | Možnosti… | |
| Undo / Redo | Späť / Znova | |
| Cut / Copy / Paste | Vystrihnúť / Kopírovať / Prilepiť | |
| Paste Special… | Prilepiť inak… | |
| Format Painter | Kopírovať formát | |
| Find / Replace… / Go To… | Nájsť / Nahradiť… / Prejsť na… | "Hľadať" only as the field label in the Find dialog |
| Select All | Vybrať všetko | |
| Bold / Italic / Underline / Strikethrough | Tučné / Kurzíva / Podčiarknuté / Prečiarknuté | |
| Font Color / Highlight / Fill Color | Farba písma / Zvýraznenie / Farba výplne | |
| Insert Picture / Table / Chart / Shape / Text Box | Vložiť obrázok / tabuľku / graf / tvar / textové pole | |
| Bring to Front / Send to Back | Presunúť do popredia / Presunúť do pozadia | |
| Group / Ungroup | Zoskupiť / Zrušiť zoskupenie | |
| Sort / Filter | Zoradiť / Filter | Calc |
| Insert Function | Vložiť funkciu | Calc |
| New Slide | Nová snímka | Show |
| From Beginning / From Current Slide | Od začiatku / Od aktuálnej snímky | Show |
| Track Changes / Comments | Sledovanie zmien / Komentáre | Write |

## Commands as used in the catalogs
The terms the catalogs use after the review (P9-LR3), one row per English command; the key shows where.

| English | Term | Key |
| --- | --- | --- |
| Copy | Kopírovať | `ai.pane.copy` |
| Save | Uložiť | `ai.settings.save` |
| Insert | Vložiť | `ai.write.insert` |
| Close | Zavrieť | `backstage.close` |
| New | Nový | `backstage.new` |
| Open… | Otvoriť… | `backstage.open` |
| Options… | Možnosti… | `backstage.options` |
| Print | Tlačiť | `backstage.print` |
| Save As… | Uložiť ako… | `backstage.saveAs` |
| Cut | Vystrihnúť | `cmd.cut` |
| Delete | Odstrániť | `cmd.delete` |
| Find | Nájsť | `cmd.find` |
| Paste | Prilepiť | `cmd.paste` |
| Redo | Znova | `cmd.redo` |
| Replace… | Nahradiť… | `cmd.replaceDots` |
| Undo | Späť | `cmd.undo` |
| Size | Veľkosť | `conn.browser.colSize` |
| Rename | Premenovať | `conn.browser.rename` |
| Bold | Tučné | `fmt.bold` |
| Borders | Orámovanie | `fmt.borders` |
| Colors | Farby | `fmt.colors` |
| Italic | Kurzíva | `fmt.italic` |
| Strikethrough | Prečiarknuté | `fmt.strike` |
| Underline | Podčiarknuté | `fmt.underline` |
| Zoom | Lupa | `group.zoom` |
| Layout | Rozloženie | `print.layoutSection` |
| Margins | Okraje | `print.margins` |
| Normal | Normálne | `print.margins.normal` |
| Orientation | Orientácia | `print.orientation` |
| Format | Formát | `sc.format` |
| Remove Arrows | Odstrániť šípky | `calc.audit.removeArrows` |
| Show Formulas | Zobraziť vzorce | `calc.audit.showFormulas` |
| Trace Dependents | Určiť nasledovníkov | `calc.audit.traceDependents` |
| Trace Precedents | Určiť predchodcov | `calc.audit.tracePrecedents` |
| Breaks | Zlomy | `calc.breaks` |
| Fill | Výplň | `calc.cf.barFill` |
| Clear | Vymazať | `calc.cf.clearFormat` |
| Shapes | Tvary | `calc.cf.iconGroup.shapes` |
| Conditional Formatting | Podmienené formátovanie | `calc.cf.menu` |
| Gridlines | Mriežky | `calc.chart.ae.gridlines` |
| Chart | Graf | `calc.chart.chart` |
| Center | Na stred | `calc.chart.pos.center` |
| Recommended Charts | Odporúčané grafy | `calc.chart.recommended` |
| Shape Fill | Výplň tvaru | `calc.chart.shapeFill` |
| Shape Outline | Obrys tvaru | `calc.chart.shapeOutline` |
| New Comment | Nový komentár | `calc.comments.new` |
| Comment | Komentár | `calc.comments.textLabel` |
| Consolidate | Konsolidovať | `calc.consolidate.button` |
| Delete Cells… | Odstrániť bunky… | `calc.deleteCellsDots` |
| Remove Duplicates | Odstrániť duplicity | `calc.dup.button` |
| Columns | Stĺpce | `calc.dup.columns` |
| Select All | Vybrať všetko | `calc.dup.selectAll` |
| Data Validation | Overenie údajov | `calc.dv.button` |
| Filter | Filter | `calc.filter` |
| Font Color | Farba písma | `calc.filter.byFontColor` |
| Flash Fill | Bleskové dopĺňanie | `calc.flash.button` |
| Effects | Efekty | `calc.fmt.effects` |
| Justify | Do bloku | `calc.fmt.h.justify` |
| Indent | Odsadenie | `calc.fmt.indent` |
| Preview | Ukážka | `calc.fmt.preview` |
| Subscript | Dolný index | `calc.fmt.subscript` |
| Superscript | Horný index | `calc.fmt.superscript` |
| Symbol | Symbol | `calc.fmt.symbol` |
| AutoSum | Automatický súčet | `calc.fn.autoSum` |
| Insert Function | Vložiť funkciu | `calc.fn.insert` |
| Format Painter | Kopírovať formát | `calc.formatPainter` |
| Freeze Panes | Ukotviť priečky | `calc.freezePanes` |
| Goal Seek… | Hľadanie riešenia… | `calc.goal.dots` |
| What-If Analysis | Analýza hypotéz | `calc.goal.whatIf` |
| Hide | Skryť | `calc.hide` |
| Insert Cells… | Vložiť bunky… | `calc.insertCellsDots` |
| Link | Prepojenie | `calc.link.button` |
| Merge Cells | Zlúčiť bunky | `calc.mergeCells` |
| Merge & Center | Zlúčiť a zarovnať na stred | `calc.mergeCenter` |
| Move or Copy… | Presunúť alebo kopírovať… | `calc.moveCopy.dots` |
| Define Name | Definovať názov | `calc.names.define` |
| Name Manager | Správca názvov | `calc.names.manager` |
| Group | Zoskupiť | `calc.outline.group` |
| Ungroup | Zrušiť zoskupenie | `calc.outline.ungroup` |
| Page Setup | Nastavenie strany | `calc.pageSetup` |
| Pictures | Obrázky | `calc.picture.button` |
| PivotTable | Kontingenčná tabuľka | `calc.pivot.pivotTable` |
| Refresh All | Obnoviť všetko | `calc.pivot.refreshAll` |
| Styles | Štýly | `calc.pivot.stylesGallery` |
| Print Area | Oblasť tlače | `calc.printArea` |
| Print Titles | Tlačiť nadpisy | `calc.printTitles` |
| Sort | Zoradiť | `calc.protect.allow.sort` |
| Protect Workbook | Zabezpečiť zošit | `calc.protect.bookDots` |
| Protect Sheet… | Zabezpečiť hárok… | `calc.protect.sheetDots` |
| Paste Special… | Prilepiť inak… | `calc.ps.dots` |
| Error Checking | Kontrola chýb | `calc.err.dialogTitle` |
| Previous | Predchádzajúca | `calc.err.previous` |
| Next | Ďalej | `calc.err.next` |
| Evaluate Formula | Vyhodnotiť vzorec | `calc.eval.title` |
| Watch Window | Okno kukátka | `calc.watch.title` |
| Calculate Now | Prepočítať teraz | `calc.calc.now` |
| Sort & Filter | Zoradiť a filtrovať | `calc.sortFilter` |
| Subtotal | Medzisúčet | `calc.subtotal.button` |
| Properties | Vlastnosti | `calc.table.properties` |
| Table | Tabuľka | `calc.table.table` |
| Unhide | Odkryť | `calc.unhide` |
| Text to Columns | Text na stĺpce | `calc.wizard.ttcButton` |
| Align Left | Zarovnať vľavo | `write.alignObj.left` |
| Align Right | Zarovnať vpravo | `write.alignObj.right` |
| Align | Zarovnať | `write.alignObjects` |
| Bookmark | Záložka | `write.bookmark.button` |
| Insert Caption | Vložiť titulok | `write.caption.button` |
| Equation | Rovnica | `write.caption.equation` |
| Position | Poloha | `write.caption.position` |
| Crop | Orezať | `write.crop` |
| Spacing | Rozstup | `write.font.spacing` |
| Bring Forward | Presunúť dopredu | `write.order.bringForward` |
| Bring to Front | Presunúť do popredia | `write.order.bringToFront` |
| Send Backward | Presunúť dozadu | `write.order.sendBackward` |
| Send to Back | Presunúť do pozadia | `write.order.sendToBack` |
| Picture | Obrázok | `write.picture` |
| Section | Oddiel | `write.reveal.section` |
| Rotate | Otočiť | `write.rotate` |
| Ruler | Pravítko | `write.ruler` |
| Selection Pane | Výberové okno | `write.selectionPane` |
| Spelling | Pravopis | `write.spelling` |
| Split Cells | Rozdeliť bunky | `write.splitCells` |
| Hyperlink | Hypertextový odkaz | `write.styleName.hyperlink` |
| Numbering… | Číslovanie… | `write.styles.format.numbering` |
| Text Box | Textové pole | `write.textBox` |
| Wrap Text | Obtekanie textu | `write.wrapText` |
| Cross-reference | Krížový odkaz | `write.xref.button` |
| Footnote | Poznámka pod čiarou | `write.xref.footnote` |
| Reset | Obnoviť | `write.notes.sep.reset` |
| Format Background | Formát pozadia | `show.bg.format` |
| Background Styles | Štýly pozadia | `show.bg.styles` |
| Fonts | Písma | `show.design.fonts` |
| Themes | Motívy | `show.design.themes` |
| Header & Footer… | Hlavička a päta… | `show.hf.titleDots` |
| Slide Master | Predloha snímok | `show.master.tab` |
| Slide Size | Veľkosť snímky | `show.size.customTitle` |
| Set Up Slide Show | Nastaviť prezentáciu | `show.setup.titleDots` |
| Guides | Vodiace čiary | `show.view.guides` |
| Notes Page | Stránka poznámok | `show.view.notesPage` |
| Outline View | Zobrazenie osnovy | `show.view.outline` |
| Reading View | Zobrazenie na čítanie | `show.view.reading` |
| Slide Sorter | Triedič snímok | `show.view.sorter` |
| Edit Points | Upraviť body | `show.editPoints` |
| Fill Color | Farba výplne | `show.fx.fillColor` |
| Animation Painter | Kopírovať animáciu | `show.animPainter` |
| From Current Slide… | Od aktuálnej snímky… | `show.recordFromCurrent` |
| From Beginning… | Od začiatku… | `show.recordFromStart` |

## Dialog buttons and messages
| English | Office term | Note |
| --- | --- | --- |
| OK | OK | |
| Cancel | Zrušiť | |
| Apply | Použiť | |
| Close | Zavrieť | |
| Yes / No | Áno / Nie | |
| Don't Save | Neukladať | the unsaved-changes prompt |
| Browse… | Prehľadávať… | |
| Reset | Obnoviť | |
| Insert / Delete | Vložiť / Odstrániť | |
| Back / Next / Finish | < Späť / Ďalej > / Dokončiť | wizards |
| Recent | Nedávne | backstage |
| Untitled | Bez názvu | default document name |
| Saved / Saving… / Unsaved changes | Uložené / Ukladá sa… / Neuložené zmeny | status bar |

## File types
| English | Office term | Note |
| --- | --- | --- |
| Excel Workbook | Zošit programu Excel | `.xlsx`, the desktop dialog filter name |
| Word Document | Dokument programu Word | `.docx` |
| PowerPoint Presentation | Prezentácia programu PowerPoint | `.pptx` |
| Excel Template / Word Template / PowerPoint Template | Šablóna programu Excel / Word / PowerPoint | `.xltx` / `.dotx` / `.potx` |
| CSV (Comma delimited) | CSV (oddelený čiarkami) | Calc |
| Text Files | Textové súbory | |
| PDF | PDF | |
| Office Theme | Motív Office | `.thmx` |
| All Files | Všetky súbory | |

## Show effects and transitions
Animation effects (`show.fx.*`) and slide transitions (`show.trans.*`) as the catalogs name them (P9-LR3). Names marked as doubtful in the review report are not verified against a localised PowerPoint.

| English | Term | Key |
| --- | --- | --- |
| Appear | Zobrazenie | `show.fx.appear` |
| Disappear | Zmiznutie | `show.fx.disappear` |
| Fade | Vyblednutie | `show.fx.fade` |
| Fly In | Priletieť | `show.fx.flyIn` |
| Fly Out | Odletieť | `show.fx.flyOut` |
| Grow/Shrink | Zväčšiť/zmenšiť | `show.fx.growShrink` |
| Spin | Otočenie | `show.fx.spin` |
| Wipe | Stieranie | `show.fx.wipe` |
| Zoom | Lupa | `show.fx.zoom` |
| Cover | Zakrytie | `show.trans.cover` |
| Cut | Strih | `show.trans.cut` |
| Fade | Vyblednutie | `show.trans.fade` |
| None | Žiadny | `show.trans.none` |
| Push | Posunutie | `show.trans.push` |
| Split | Rozdelenie | `show.trans.split` |
| Wipe | Stieranie | `show.trans.wipe` |
| Zoom | Lupa | `show.trans.zoom` |
| Morph | Morfovanie | `show.trans.morph` |
| Reveal | Odhalenie | `show.trans.reveal` |
| Shred | Rozstrapkanie | `show.trans.shred` |
| Fall Over | Prevalenie | `show.trans.fallOver` |
| Drape | Záves | `show.trans.drape` |
| Curtains | Opony | `show.trans.curtains` |
| Wind | Vietor | `show.trans.wind` |
| Prestige | Prestíž | `show.trans.prestige` |
| Fracture | Zlomenie | `show.trans.fracture` |
| Crush | Rozdrvenie | `show.trans.crush` |
| Peel Off | Odlepenie | `show.trans.peelOff` |
| Page Curl | Zvinutie strany | `show.trans.pageCurl` |
| Airplane | Lietadlo | `show.trans.airplane` |
| Origami | Origami | `show.trans.origami` |
| Honeycomb | Plást medu | `show.trans.honeycomb` |
| Glitter | Trblietky | `show.trans.glitter` |
| Vortex | Vír | `show.trans.vortex` |
| Ripple | Vlnenie | `show.trans.ripple` |
| Switch | Prepnutie | `show.trans.switch` |
| Flip | Otočenie karty | `show.trans.flip` |
| Gallery | Galéria | `show.trans.gallery` |
| Cube | Kocka | `show.trans.cube` |
| Doors | Dvere | `show.trans.doors` |
| Box | Škatuľa | `show.trans.box` |
| Float In | Vznášanie dovnútra | `show.fx.float` |
| Float Out | Vznášanie von | `show.fx.floatOut` |
| Split | Rozdelenie | `show.fx.split` |
| Shape | Tvar | `show.fx.shape` |
| Circle | Kruh | `show.fx.circle` |
| Box | Škatuľa | `show.fx.box` |
| Diamond | Kosoštvorec | `show.fx.diamond` |
| Plus | Plus | `show.fx.plus` |
| Wheel | Koleso | `show.fx.wheel` |
| Random Bars | Náhodné pruhy | `show.fx.randomBars` |
| Grow & Turn | Zväčšiť a otočiť | `show.fx.growTurn` |
| Shrink & Turn | Zmenšiť a otočiť | `show.fx.shrinkTurn` |
| Swivel | Otáčanie | `show.fx.swivel` |
| Bounce | Poskakovanie | `show.fx.bounce` |
| Pulse | Pulzovanie | `show.fx.pulse` |
| Color Pulse | Farebný pulz | `show.fx.colorPulse` |
| Teeter | Kolísanie | `show.fx.teeter` |
| Desaturate | Znížiť sýtosť | `show.fx.desaturate` |
| Darken | Stmaviť | `show.fx.darken` |
| Lighten | Zosvetliť | `show.fx.lighten` |
| Transparency | Priehľadnosť | `show.fx.transparency` |
| Object Color | Farba objektu | `show.fx.objectColor` |
| Line Color | Farba čiary | `show.fx.lineColor` |
| Fill Color | Farba výplne | `show.fx.fillColor` |
| Brush Color | Farba štetca | `show.fx.brushColor` |
| Font Color | Farba písma | `show.fx.fontColor` |
| Underline | Podčiarknutie | `show.fx.underline` |
| Bold Flash | Tučný záblesk | `show.fx.boldFlash` |
| Bold Reveal | Tučné odhalenie | `show.fx.boldReveal` |
| Wave | Vlna | `show.fx.wave` |
| Lines | Čiary | `show.fx.pathLines` |
| Arcs | Oblúky | `show.fx.pathArcs` |
| Turns | Zákruty | `show.fx.pathTurns` |
| Shapes | Tvary | `show.fx.pathShapes` |
| Loops | Slučky | `show.fx.pathLoops` |
| Custom Path | Vlastná cesta | `show.fx.pathCustom` |
| Play | Prehrať | `show.fx.mediaPlay` |
| Pause | Pozastaviť | `show.fx.mediaPause` |
| Stop | Zastaviť | `show.fx.mediaStop` |

## More terms
| English | Office term | Note |
| --- | --- | --- |
| PivotTable | Kontingenčná tabuľka | Calc, Excel SK |
| Slicer | Prierez | Calc |
| Goal Seek | Hľadanie riešenia | Calc |
| What-If Analysis | Analýza hypotéz | Calc |
| Flash Fill | Bleskové dopĺňanie | Calc |
| Freeze Panes | Ukotviť priečky | Calc |
| Name Box | Pole názvu | Calc |
| Conditional Formatting | Podmienené formátovanie | Calc |
| Data Bars / Color Scales / Icon Sets | Dátové pruhy / Farebné škály / Množiny ikon | Calc |
| Data Validation | Overenie údajov | Calc |
| Remove Duplicates | Odstrániť duplicity | Calc |
| Watch Window | Okno kukátka | Calc |
| Slide / Slide Master | Snímka / Predloha snímok | Show |
| Speaker notes / Presenter view | Poznámky prednášajúceho / Zobrazenie prezentujúceho | Show |
| Slide Sorter | Triedič snímok | Show |
| Rehearse Timings | Nacvičiť časovanie | Show |
| Footnote / Endnote | Poznámka pod čiarou / Vysvetlivka | Write |
| Caption / Cross-reference | Titulok / Krížový odkaz | Write |
| Style Set / Reveal Formatting | Sada štýlov / Odhaliť formátovanie | Write |
| Navigation Pane / Selection Pane | Navigačné okno / Výberové okno | Write |
| Table of contents | Obsah | Write |
| Entrance / Emphasis / Exit (animations) | Úvodné / Zvýraznenie / Koncové | Show |
| Sparkline | Miniatúrny graf | Calc |
