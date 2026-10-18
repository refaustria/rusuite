# Glossary: Slovenian (`sl`)

Source: the Slovenian localisation of Microsoft Office (Word, Excel, PowerPoint) and its terminology. Translator: P9-L6. Reviewer: P9-LR3 (2026-10-18).

## Register
- Address: informal "ti / te / tebi / tvoj", imperatives in the 2nd person singular ("Vnesi", "Izberi", "Preveri", "Poskusi"); never "vi / vas / vam / vaš" or the plural imperative ("Vnesite"). Gendered past forms ("si odprl") are avoided by neutral rewording.
- Buttons and menu commands: imperative singular as Slovenian Office does for commands ("Shrani", "Vstavi tabelo", "Odpri"); noun for tabs and groups.
- Ellipsis "…" for commands that open a dialog, as in English.
- Quotation marks: »…« (Slovenian).
- Keyboard key names in shortcut texts (packages/ui-shared/src/i18n/keyNames.ts): the English names are kept (Ctrl, Shift, Alt, Delete, Enter), as in Slovenian Office.
- "AI" is written "UI" (umetna inteligenca).
- Plural categories: `one / two / few / other`. `one` = 1, 101 (1 celica), `two` = 2, 102 (2 celici), `few` = 3–4 (3 celice), `other` = 5+ and 0 (5 celic).
- Review (P9-LR3): Word field switches stay literal ("(\\n)" in the JSON, shown as (\n)); progress messages keep the Slovenian space before the ellipsis ("Nalaganje …"), commands do not ("Odpri…"); margins in cm.

## Ribbon tabs
| English | Office term | Note |
| --- | --- | --- |
| File | Datoteka | |
| Home | Osnovno | |
| Insert | Vstavljanje | |
| Draw | Risanje | |
| Design | Načrt | |
| Layout (Write: Layout, Calc: Page Layout) | Postavitev | Calc: Postavitev strani |
| References | Sklici | Write |
| Mailings | Pošiljanje | Write |
| Review | Pregled | |
| View | Pogled | ("Ogled" is not the Office tab name) |
| Formulas | Formule | Calc |
| Data | Podatki | Calc |
| Transitions | Prehodi | Show |
| Animations | Animacije | Show |
| Slide Show | Diaprojekcija | Show |
| Help | Pomoč | |
| Picture / Table / Chart / Drawing Tools (contextual) | Orodja za slike / tabele / grafikone / risanje | |

## Ribbon groups
| English | Office term | Note |
| --- | --- | --- |
| Clipboard | Odložišče | |
| Font | Pisava | |
| Paragraph | Odstavek | |
| Styles | Slogi | |
| Editing | Urejanje | |
| Number | Število | Calc |
| Alignment | Poravnava | Calc |
| Cells | Celice | Calc |
| Slides | Diapozitivi | Show |
| Drawing | Risanje | Show |
| Zoom | Povečava | |
| Show (View › Show) | Pokaži | |
| Language | Jezik | the picker; label "Jezik / Language" |

## Common commands
| English | Office term | Note |
| --- | --- | --- |
| New | Novo | |
| Open… | Odpri… | |
| Save | Shrani | |
| Save As… | Shrani kot… | |
| Print | Natisni | |
| Export PDF… | Izvozi v PDF… | |
| Close | Zapri | |
| Options… | Možnosti… | |
| Undo / Redo | Razveljavi / Uveljavi | |
| Cut / Copy / Paste | Izreži / Kopiraj / Prilepi | |
| Paste Special… | Prilepi posebno… | |
| Format Painter | Preslikovalnik oblik | Animation Painter: Preslikovalnik animacij |
| Find / Replace… / Go To… | Najdi / Zamenjaj… / Pojdi na… | |
| Select All | Izberi vse | |
| Bold / Italic / Underline / Strikethrough | Krepko / Ležeče / Podčrtano / Prečrtano | |
| Font Color / Highlight / Fill Color | Barva pisave / Označevanje / Barva polnila | |
| Insert Picture / Table / Chart / Shape / Text Box | Vstavi sliko / tabelo / grafikon / obliko / besedilno polje | |
| Bring to Front / Send to Back | Premakni v ospredje / Premakni v ozadje | |
| Group / Ungroup | Združi / Razdruži | |
| Sort / Filter | Razvrsti / Filter | Calc |
| Insert Function | Vstavi funkcijo | Calc |
| New Slide | Nov diapozitiv | Show |
| From Beginning / From Current Slide | Od začetka / Od trenutnega diapozitiva | Show |
| Track Changes / Comments | Sledenje spremembam / Komentarji | Write |

## Commands as used in the catalogs
The terms the catalogs use after the review (P9-LR3), one row per English command; the key shows where.

| English | Term | Key |
| --- | --- | --- |
| Copy | Kopiraj | `ai.pane.copy` |
| Save | Shrani | `ai.settings.save` |
| Insert | Vstavi | `ai.write.insert` |
| Close | Zapri | `backstage.close` |
| New | Novo | `backstage.new` |
| Open… | Odpri… | `backstage.open` |
| Options… | Možnosti… | `backstage.options` |
| Print | Natisni | `backstage.print` |
| Save As… | Shrani kot… | `backstage.saveAs` |
| Cut | Izreži | `cmd.cut` |
| Delete | Izbriši | `cmd.delete` |
| Find | Najdi | `cmd.find` |
| Paste | Prilepi | `cmd.paste` |
| Redo | Uveljavi | `cmd.redo` |
| Replace… | Zamenjaj… | `cmd.replaceDots` |
| Undo | Razveljavi | `cmd.undo` |
| Size | Velikost | `conn.browser.colSize` |
| Rename | Preimenuj | `conn.browser.rename` |
| Bold | Krepko | `fmt.bold` |
| Borders | Obrobe | `fmt.borders` |
| Colors | Barve | `fmt.colors` |
| Italic | Ležeče | `fmt.italic` |
| Strikethrough | Prečrtano | `fmt.strike` |
| Underline | Podčrtano | `fmt.underline` |
| Zoom | Povečava | `group.zoom` |
| Layout | Postavitev | `print.layoutSection` |
| Margins | Robovi | `print.margins` |
| Normal | Običajni | `print.margins.normal` |
| Orientation | Usmerjenost | `print.orientation` |
| Format | Oblika | `sc.format` |
| Remove Arrows | Odstrani puščice | `calc.audit.removeArrows` |
| Show Formulas | Pokaži formule | `calc.audit.showFormulas` |
| Trace Dependents | Sledi odvisnim celicam | `calc.audit.traceDependents` |
| Trace Precedents | Sledi prednikom | `calc.audit.tracePrecedents` |
| Breaks | Prelomi | `calc.breaks` |
| Fill | Polnilo | `calc.cf.barFill` |
| Clear | Počisti | `calc.cf.clearFormat` |
| Shapes | Oblike | `calc.cf.iconGroup.shapes` |
| Conditional Formatting | Pogojno oblikovanje | `calc.cf.menu` |
| Gridlines | Mrežne črte | `calc.chart.ae.gridlines` |
| Chart | Grafikon | `calc.chart.chart` |
| Center | Sredina | `calc.chart.pos.center` |
| Recommended Charts | Priporočeni grafikoni | `calc.chart.recommended` |
| Shape Fill | Polnilo oblike | `calc.chart.shapeFill` |
| Shape Outline | Oris oblike | `calc.chart.shapeOutline` |
| New Comment | Nov komentar | `calc.comments.new` |
| Comment | Komentar | `calc.comments.textLabel` |
| Consolidate | Konsolidiraj | `calc.consolidate.button` |
| Delete Cells… | Izbriši celice… | `calc.deleteCellsDots` |
| Remove Duplicates | Odstrani dvojnike | `calc.dup.button` |
| Columns | Stolpci | `calc.dup.columns` |
| Select All | Izberi vse | `calc.dup.selectAll` |
| Data Validation | Preverjanje podatkov | `calc.dv.button` |
| Filter | Filter | `calc.filter` |
| Font Color | Barva pisave | `calc.filter.byFontColor` |
| Flash Fill | Hitro zapolnjevanje | `calc.flash.button` |
| Effects | Učinki | `calc.fmt.effects` |
| Justify | Obojestransko | `calc.fmt.h.justify` |
| Indent | Zamik | `calc.fmt.indent` |
| Preview | Predogled | `calc.fmt.preview` |
| Subscript | Podpisano | `calc.fmt.subscript` |
| Superscript | Nadpisano | `calc.fmt.superscript` |
| Symbol | Simbol | `calc.fmt.symbol` |
| AutoSum | Samodejna vsota | `calc.fn.autoSum` |
| Insert Function | Vstavi funkcijo | `calc.fn.insert` |
| Format Painter | Preslikovalnik oblik | `calc.formatPainter` |
| Freeze Panes | Zamrzni podokna | `calc.freezePanes` |
| Goal Seek… | Iskanje cilja… | `calc.goal.dots` |
| What-If Analysis | Analiza možnosti | `calc.goal.whatIf` |
| Hide | Skrij | `calc.hide` |
| Insert Cells… | Vstavi celice… | `calc.insertCellsDots` |
| Link | Povezava | `calc.link.button` |
| Merge Cells | Združi celice | `calc.mergeCells` |
| Merge & Center | Združi in na sredino | `calc.mergeCenter` |
| Move or Copy… | Premakni ali kopiraj… | `calc.moveCopy.dots` |
| Define Name | Določi ime | `calc.names.define` |
| Name Manager | Upravitelj imen | `calc.names.manager` |
| Group | Združi | `calc.outline.group` |
| Ungroup | Razdruži | `calc.outline.ungroup` |
| Page Setup | Priprava strani | `calc.pageSetup` |
| Pictures | Slike | `calc.picture.button` |
| PivotTable | Vrtilna tabela | `calc.pivot.pivotTable` |
| Refresh All | Osveži vse | `calc.pivot.refreshAll` |
| Styles | Slogi | `calc.pivot.stylesGallery` |
| Print Area | Območje tiskanja | `calc.printArea` |
| Print Titles | Naslovi za tiskanje | `calc.printTitles` |
| Sort | Razvrščanje | `calc.protect.allow.sort` |
| Protect Workbook | Zaščiti delovni zvezek | `calc.protect.bookDots` |
| Protect Sheet… | Zaščiti list… | `calc.protect.sheetDots` |
| Paste Special… | Prilepi posebno… | `calc.ps.dots` |
| Error Checking | Preverjanje napak | `calc.err.dialogTitle` |
| Previous | Prejšnja | `calc.err.previous` |
| Next | Naslednja | `calc.err.next` |
| Evaluate Formula | Ovrednoti formulo | `calc.eval.title` |
| Watch Window | Okno za opazovanje | `calc.watch.title` |
| Calculate Now | Izračunaj zdaj | `calc.calc.now` |
| Sort & Filter | Razvrsti in filtriraj | `calc.sortFilter` |
| Subtotal | Delna vsota | `calc.subtotal.button` |
| Properties | Lastnosti | `calc.table.properties` |
| Table | Tabela | `calc.table.table` |
| Unhide | Razkrij | `calc.unhide` |
| Text to Columns | Besedilo v stolpce | `calc.wizard.ttcButton` |
| Align Left | Poravnaj levo | `write.alignObj.left` |
| Align Right | Poravnaj desno | `write.alignObj.right` |
| Align | Poravnaj | `write.alignObjects` |
| Bookmark | Zaznamek | `write.bookmark.button` |
| Insert Caption | Vstavi napis | `write.caption.button` |
| Equation | Enačba | `write.caption.equation` |
| Position | Položaj | `write.caption.position` |
| Crop | Obreži | `write.crop` |
| Spacing | Razmik | `write.font.spacing` |
| Bring Forward | Premakni naprej | `write.order.bringForward` |
| Bring to Front | Premakni v ospredje | `write.order.bringToFront` |
| Send Backward | Premakni nazaj | `write.order.sendBackward` |
| Send to Back | Premakni v ozadje | `write.order.sendToBack` |
| Picture | Slika | `write.picture` |
| Section | Razdelek | `write.reveal.section` |
| Rotate | Zasukaj | `write.rotate` |
| Ruler | Ravnilo | `write.ruler` |
| Selection Pane | Podokno za izbiro | `write.selectionPane` |
| Spelling | Črkovanje | `write.spelling` |
| Split Cells | Razdeli celice | `write.splitCells` |
| Hyperlink | Hiperpovezava | `write.styleName.hyperlink` |
| Numbering… | Oštevilčenje… | `write.styles.format.numbering` |
| Text Box | Besedilno polje | `write.textBox` |
| Wrap Text | Obtekanje besedila | `write.wrapText` |
| Cross-reference | Navzkrižni sklic | `write.xref.button` |
| Footnote | Sprotna opomba | `write.xref.footnote` |
| Reset | Ponastavi | `write.notes.sep.reset` |
| Format Background | Oblikuj ozadje | `show.bg.format` |
| Background Styles | Slogi ozadja | `show.bg.styles` |
| Fonts | Pisave | `show.design.fonts` |
| Themes | Teme | `show.design.themes` |
| Header & Footer… | Glava in noga… | `show.hf.titleDots` |
| Slide Master | Matrica diapozitivov | `show.master.tab` |
| Slide Size | Velikost diapozitiva | `show.size.customTitle` |
| Set Up Slide Show | Nastavi diaprojekcijo | `show.setup.titleDots` |
| Guides | Vodila | `show.view.guides` |
| Notes Page | Stran z opombami | `show.view.notesPage` |
| Outline View | Pogled orisa | `show.view.outline` |
| Reading View | Pogled branja | `show.view.reading` |
| Slide Sorter | Razvrščevalnik diapozitivov | `show.view.sorter` |
| Edit Points | Uredi točke | `show.editPoints` |
| Fill Color | Barva polnila | `show.fx.fillColor` |
| Animation Painter | Preslikovalnik animacij | `show.animPainter` |
| From Current Slide… | Od trenutnega diapozitiva… | `show.recordFromCurrent` |
| From Beginning… | Od začetka… | `show.recordFromStart` |

## Dialog buttons and messages
| English | Office term | Note |
| --- | --- | --- |
| OK | V redu | |
| Cancel | Prekliči | |
| Apply | Uporabi | |
| Close | Zapri | |
| Yes / No | Da / Ne | |
| Don't Save | Ne shrani | the unsaved-changes prompt |
| Browse… | Prebrskaj… | |
| Reset | Ponastavi | |
| Insert / Delete | Vstavi / Izbriši | |
| Back / Next / Finish | < Nazaj / Naprej > / Dokončaj | wizards |
| Recent | Nedavno | backstage |
| Untitled | Brez naslova | default document name |
| Saved / Saving… / Unsaved changes | Shranjeno / Shranjevanje … / Neshranjene spremembe | status bar |

## File types
| English | Office term | Note |
| --- | --- | --- |
| Excel Workbook | Excelov delovni zvezek | `.xlsx`, the desktop dialog filter name |
| Word Document | Wordov dokument | `.docx` |
| PowerPoint Presentation | PowerPointova predstavitev | `.pptx` |
| Excel Template / Word Template / PowerPoint Template | Excelova / Wordova / PowerPointova predloga | `.xltx` / `.dotx` / `.potx` |
| CSV (Comma delimited) | CSV (ločeno z vejicami) | Calc |
| Text Files | Besedilne datoteke | |
| PDF | PDF | |
| Office Theme | Officeova tema | `.thmx` |
| All Files | Vse datoteke | |

## Show effects and transitions
Animation effects (`show.fx.*`) and slide transitions (`show.trans.*`) as the catalogs name them (P9-LR3). Names marked as doubtful in the review report are not verified against a localised PowerPoint.

| English | Term | Key |
| --- | --- | --- |
| Appear | Pojavi se | `show.fx.appear` |
| Disappear | Izgine | `show.fx.disappear` |
| Fade | Zbledi | `show.fx.fade` |
| Fly In | Poleti noter | `show.fx.flyIn` |
| Fly Out | Poleti ven | `show.fx.flyOut` |
| Grow/Shrink | Povečaj/pomanjšaj | `show.fx.growShrink` |
| Spin | Vrtenje | `show.fx.spin` |
| Wipe | Brisanje | `show.fx.wipe` |
| Zoom | Povečava | `show.fx.zoom` |
| Cover | Prekrij | `show.trans.cover` |
| Cut | Rez | `show.trans.cut` |
| Fade | Zbledi | `show.trans.fade` |
| None | Brez | `show.trans.none` |
| Push | Potisni | `show.trans.push` |
| Split | Razdeli | `show.trans.split` |
| Wipe | Brisanje | `show.trans.wipe` |
| Zoom | Povečava | `show.trans.zoom` |
| Morph | Preoblikovanje | `show.trans.morph` |
| Reveal | Razkritje | `show.trans.reveal` |
| Shred | Razrez | `show.trans.shred` |
| Fall Over | Prevrnitev | `show.trans.fallOver` |
| Drape | Zavesa | `show.trans.drape` |
| Curtains | Zavese | `show.trans.curtains` |
| Wind | Veter | `show.trans.wind` |
| Prestige | Prestiž | `show.trans.prestige` |
| Fracture | Zlom | `show.trans.fracture` |
| Crush | Zdrobitev | `show.trans.crush` |
| Peel Off | Odlepitev | `show.trans.peelOff` |
| Page Curl | Zvitje strani | `show.trans.pageCurl` |
| Airplane | Letalo | `show.trans.airplane` |
| Origami | Origami | `show.trans.origami` |
| Honeycomb | Satovje | `show.trans.honeycomb` |
| Glitter | Bleščice | `show.trans.glitter` |
| Vortex | Vrtinec | `show.trans.vortex` |
| Ripple | Valovanje | `show.trans.ripple` |
| Switch | Preklop | `show.trans.switch` |
| Flip | Obrat | `show.trans.flip` |
| Gallery | Galerija | `show.trans.gallery` |
| Cube | Kocka | `show.trans.cube` |
| Doors | Vrata | `show.trans.doors` |
| Box | Škatla | `show.trans.box` |
| Float In | Plavanje noter | `show.fx.float` |
| Float Out | Plavanje ven | `show.fx.floatOut` |
| Split | Razdeli | `show.fx.split` |
| Shape | Oblika | `show.fx.shape` |
| Circle | Krog | `show.fx.circle` |
| Box | Škatla | `show.fx.box` |
| Diamond | Romb | `show.fx.diamond` |
| Plus | Plus | `show.fx.plus` |
| Wheel | Kolo | `show.fx.wheel` |
| Random Bars | Naključni trakovi | `show.fx.randomBars` |
| Grow & Turn | Povečaj in zavrti | `show.fx.growTurn` |
| Shrink & Turn | Pomanjšaj in zavrti | `show.fx.shrinkTurn` |
| Swivel | Obračanje | `show.fx.swivel` |
| Bounce | Poskakovanje | `show.fx.bounce` |
| Pulse | Utripanje | `show.fx.pulse` |
| Color Pulse | Barvno utripanje | `show.fx.colorPulse` |
| Teeter | Majanje | `show.fx.teeter` |
| Desaturate | Zmanjšaj nasičenost | `show.fx.desaturate` |
| Darken | Potemni | `show.fx.darken` |
| Lighten | Posvetli | `show.fx.lighten` |
| Transparency | Prosojnost | `show.fx.transparency` |
| Object Color | Barva objekta | `show.fx.objectColor` |
| Line Color | Barva črte | `show.fx.lineColor` |
| Fill Color | Barva polnila | `show.fx.fillColor` |
| Brush Color | Barva čopiča | `show.fx.brushColor` |
| Font Color | Barva pisave | `show.fx.fontColor` |
| Underline | Podčrtanje | `show.fx.underline` |
| Bold Flash | Krepki blisk | `show.fx.boldFlash` |
| Bold Reveal | Krepko razkritje | `show.fx.boldReveal` |
| Wave | Val | `show.fx.wave` |
| Lines | Črte | `show.fx.pathLines` |
| Arcs | Loki | `show.fx.pathArcs` |
| Turns | Zavoji | `show.fx.pathTurns` |
| Shapes | Oblike | `show.fx.pathShapes` |
| Loops | Zanke | `show.fx.pathLoops` |
| Custom Path | Pot po meri | `show.fx.pathCustom` |
| Play | Predvajaj | `show.fx.mediaPlay` |
| Pause | Začasno ustavi | `show.fx.mediaPause` |
| Stop | Ustavi | `show.fx.mediaStop` |

## More terms
| English | Office term | Note |
| --- | --- | --- |
| PivotTable | Vrtilna tabela | Calc |
| Slicer | Rezalnik | Calc |
| Goal Seek | Iskanje cilja | Calc |
| What-If Analysis | Analiza možnosti | Calc |
| Flash Fill | Hitro zapolnjevanje | Calc |
| Freeze Panes | Zamrzni podokna | Calc |
| Name Box | Polje z imenom | Calc |
| Conditional Formatting | Pogojno oblikovanje | Calc |
| Data Bars / Color Scales / Icon Sets | Podatkovne vrstice / Barvne lestvice / Nabori ikon | Calc |
| Data Validation | Preverjanje podatkov | Calc |
| Remove Duplicates | Odstrani dvojnike | Calc |
| Watch Window | Okno za opazovanje | Calc |
| Worksheet / Workbook | List / Delovni zvezek | Calc |
| Slide / Slide Master | Diapozitiv / Matrica diapozitivov | Show |
| Speaker notes / Presenter view | Govorčeve opombe / Pogled predavatelja | Show |
| Slide Sorter | Razvrščevalnik diapozitivov | Show |
| Rehearse Timings | Vadi časovne omejitve | Show |
| Footnote / Endnote | Sprotna opomba / Končna opomba | Write |
| Caption / Cross-reference | Napis / Navzkrižni sklic | Write |
| Bookmark | Zaznamek | Write |
| Style Set / Reveal Formatting | Nabor slogov / Razkrij oblikovanje | Write |
| Navigation Pane / Selection Pane | Podokno za krmarjenje / Podokno za izbiro | Write |
| Table of contents | Kazalo vsebine | Write |
| Sparkline | Minigrafikon | Calc |
| Split (View) | Razdeli | Calc (P9-LF) |
| Go To Special… / Special… | Pojdi na posebno… / Posebno… | Calc |
| Picture Format / Alt Text | Oblika slike / Nadomestno besedilo | Calc |
| Mention someone | Omeni nekoga | Calc comments |
| Reasoning (AI setting, reasoning_effort) | Razmišljanje | Settings › AI, actions (P9-LF pass 2) |
| dropped (reader warnings) | izpuščen(a/o/i/e) | `reader.xlsx.*` / `reader.pptx.*`, as in `reader.docx.*` |
| read as (reader warnings) | prebran(a/o) kot | reader warnings |
| dangling relationship | viseči odnos | reader warnings |
| Custom show (PowerPoint) | Projekcija po meri | `reader.pptx.customShow.*` |
| Pivot cache | predpomnilnik vrtilne tabele | `reader.xlsx.pivotCache.*` |
