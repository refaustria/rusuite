# Glossary: Estonian (`et`)

Source: the Estonian (Estonia) localisation of Microsoft Office (Word, Excel, PowerPoint) and its terminology. Translator: P9-L10. Reviewer: P9-LR5 (2026-10-18).

## Register
- Address: informal "sina / sa / sinu / sind / sulle" and 2nd-person singular imperatives ("Vali", "Sisesta", "Klõpsa", "Ava", "Kontrolli"); never "teie / teid / teile" or plural-polite imperatives ("Valige", "Klõpsake").
- Buttons and menu commands: imperative ("Salvesta", "Lisa tabel", "Prindi"), as Estonian Office does; dialog titles and group names as nouns ("Lahtrite vormindamine", "Lõikelaud").
- Ellipsis "…" for commands that open a dialog, as in English.
- Quotation marks: „…“ (low-high pair).
- Ordinals take a full stop ("{n}. taseme lõikude kaupa"); decimal comma in prose ("1,5 rida"); cell values and the formula language stay as in English.
- Keyboard key names in shortcut texts (packages/ui-shared/src/i18n/keyNames.ts): Estonian Office keeps Ctrl = Ctrl, Shift = Shift, Delete = Delete, Enter = Enter (no table entry needed).
- Plural categories: `one / other`. After numerals Estonian uses the partitive singular for both ("1 lehekülg", "2 lehekülge"; for nouns whose partitive is the same, `one` and `other` are identical: "1 sõna", "2 sõna"); no declension is needed after the number.
- Review (P9-LR5): the OOXML *run* is "tekstiosa", never "lõik" (that is the paragraph); Word equations are "võrrandid" (valem = formula); ordinal first in list presets ("1. peatükk", "I artikkel / 1.01 jaotis"); "Select all {count}" drops "all" in `.one` ("Vali {count} esinemine"); inch presets show the German cm values ("Kitsas (1,27 cm)").
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

## Commands as used in the catalogs
The terms the catalogs use after the review (P9-LR5), one row per English command; the key shows where.

| English | Term | Key |
| --- | --- | --- |
| Copy | Kopeeri | `ai.pane.copy` |
| Save | Salvesta | `ai.settings.save` |
| Insert | Lisa | `ai.write.insert` |
| Close | Sule | `backstage.close` |
| New | Uus | `backstage.new` |
| Open… | Ava… | `backstage.open` |
| Options… | Suvandid… | `backstage.options` |
| Print | Prindi | `backstage.print` |
| Save As… | Salvesta nimega… | `backstage.saveAs` |
| Cut | Lõika | `cmd.cut` |
| Delete | Kustuta | `cmd.delete` |
| Find | Otsi | `cmd.find` |
| Paste | Kleebi | `cmd.paste` |
| Redo | Tee uuesti | `cmd.redo` |
| Replace… | Asenda… | `cmd.replaceDots` |
| Undo | Võta tagasi | `cmd.undo` |
| Size | Suurus | `conn.browser.colSize` |
| Rename | Nimeta ümber | `conn.browser.rename` |
| Bold | Paks | `fmt.bold` |
| Borders | Ääred | `fmt.borders` |
| Colors | Värvid | `fmt.colors` |
| Italic | Kaldkiri | `fmt.italic` |
| Strikethrough | Läbikriipsutus | `fmt.strike` |
| Underline | Allakriipsutus | `fmt.underline` |
| Zoom | Suum | `group.zoom` |
| Layout | Küljendus | `print.layoutSection` |
| Margins | Veerised | `print.margins` |
| Normal | Tavaline | `print.margins.normal` |
| Orientation | Suund | `print.orientation` |
| Format | Vorming | `sc.format` |
| Remove Arrows | Eemalda nooled | `calc.audit.removeArrows` |
| Show Formulas | Kuva valemid | `calc.audit.showFormulas` |
| Trace Dependents | Jälgi sõltuvaid lahtreid | `calc.audit.traceDependents` |
| Trace Precedents | Jälgi eelkäijaid | `calc.audit.tracePrecedents` |
| Breaks | Katkestused | `calc.breaks` |
| Fill | Täide | `calc.cf.barFill` |
| Clear | Tühjenda | `calc.cf.clearFormat` |
| Shapes | Kujundid | `calc.cf.iconGroup.shapes` |
| Conditional Formatting | Tingimusvormindus | `calc.cf.menu` |
| Gridlines | Ruudujooned | `calc.chart.ae.gridlines` |
| Chart | Diagramm | `calc.chart.chart` |
| Center | Keskel | `calc.chart.pos.center` |
| Recommended Charts | Soovitatud diagrammid | `calc.chart.recommended` |
| Shape Fill | Kujundi täide | `calc.chart.shapeFill` |
| Shape Outline | Kujundi kontuur | `calc.chart.shapeOutline` |
| New Comment | Uus kommentaar | `calc.comments.new` |
| Comment | Kommentaar | `calc.comments.textLabel` |
| Consolidate | Koonda | `calc.consolidate.button` |
| Delete Cells… | Kustuta lahtrid… | `calc.deleteCellsDots` |
| Remove Duplicates | Eemalda duplikaadid | `calc.dup.button` |
| Columns | Veerud | `calc.dup.columns` |
| Select All | Vali kõik | `calc.dup.selectAll` |
| Data Validation | Andmete valideerimine | `calc.dv.button` |
| Filter | Filter | `calc.filter` |
| Font Color | Fondi värv | `calc.filter.byFontColor` |
| Flash Fill | Välktäide | `calc.flash.button` |
| Effects | Efektid | `calc.fmt.effects` |
| Justify | Rööpjoondus | `calc.fmt.h.justify` |
| Indent | Taane | `calc.fmt.indent` |
| Preview | Eelvaade | `calc.fmt.preview` |
| Subscript | Alaindeks | `calc.fmt.subscript` |
| Superscript | Ülaindeks | `calc.fmt.superscript` |
| Symbol | Sümbol | `calc.fmt.symbol` |
| AutoSum | Automaatsumma | `calc.fn.autoSum` |
| Insert Function | Lisa funktsioon | `calc.fn.insert` |
| Format Painter | Vormingu kopeerija | `calc.formatPainter` |
| Freeze Panes | Külmuta ruudud | `calc.freezePanes` |
| Goal Seek… | Eesmärgi otsimine… | `calc.goal.dots` |
| What-If Analysis | Mis-kui-analüüs | `calc.goal.whatIf` |
| Hide | Peida | `calc.hide` |
| Insert Cells… | Lisa lahtrid… | `calc.insertCellsDots` |
| Link | Link | `calc.link.button` |
| Merge Cells | Ühenda lahtrid | `calc.mergeCells` |
| Merge & Center | Ühenda ja keskenda | `calc.mergeCenter` |
| Move or Copy… | Teisalda või kopeeri… | `calc.moveCopy.dots` |
| Define Name | Defineeri nimi | `calc.names.define` |
| Name Manager | Nimehaldur | `calc.names.manager` |
| Group | Rühmita | `calc.outline.group` |
| Ungroup | Tühista rühmitus | `calc.outline.ungroup` |
| Page Setup | Lehekülje häälestus | `calc.pageSetup` |
| Pictures | Pildid | `calc.picture.button` |
| PivotTable | PivotTable | `calc.pivot.pivotTable` |
| Refresh All | Värskenda kõik | `calc.pivot.refreshAll` |
| Styles | Laadid | `calc.pivot.stylesGallery` |
| Print Area | Prindiala | `calc.printArea` |
| Print Titles | Prindipealkirjad | `calc.printTitles` |
| Sort | Sortida | `calc.protect.allow.sort` |
| Protect Workbook | Kaitse tööraamatut | `calc.protect.bookDots` |
| Protect Sheet… | Kaitse tööleht… | `calc.protect.sheetDots` |
| Paste Special… | Spetsiaalne kleepimine… | `calc.ps.dots` |
| Error Checking | Vigade kontroll | `calc.err.dialogTitle` |
| Previous | Eelmine | `calc.err.previous` |
| Next | Järgmine | `calc.err.next` |
| Evaluate Formula | Hinda valemit | `calc.eval.title` |
| Watch Window | Jälgimisaken | `calc.watch.title` |
| Calculate Now | Arvuta kohe | `calc.calc.now` |
| Sort & Filter | Sordi ja filtreeri | `calc.sortFilter` |
| Subtotal | Vahesumma | `calc.subtotal.button` |
| Properties | Atribuudid | `calc.table.properties` |
| Table | Tabel | `calc.table.table` |
| Unhide | Too nähtavale | `calc.unhide` |
| Text to Columns | Tekst veergudeks | `calc.wizard.ttcButton` |
| Align Left | Joonda vasakule | `write.alignObj.left` |
| Align Right | Joonda paremale | `write.alignObj.right` |
| Align | Joonda | `write.alignObjects` |
| Bookmark | Järjehoidja | `write.bookmark.button` |
| Insert Caption | Lisa pealdis | `write.caption.button` |
| Equation | Võrrand | `write.caption.equation` |
| Position | Asukoht | `write.caption.position` |
| Crop | Kärbi | `write.crop` |
| Spacing | Vahe | `write.font.spacing` |
| Bring Forward | Too ettepoole | `write.order.bringForward` |
| Bring to Front | Too esiplaanile | `write.order.bringToFront` |
| Send Backward | Saada tahapoole | `write.order.sendBackward` |
| Send to Back | Saada tagaplaanile | `write.order.sendToBack` |
| Picture | Pilt | `write.picture` |
| Section | Jaotis | `write.reveal.section` |
| Rotate | Pööra | `write.rotate` |
| Ruler | Joonlaud | `write.ruler` |
| Selection Pane | Valikupaan | `write.selectionPane` |
| Spelling | Õigekiri | `write.spelling` |
| Split Cells | Poolita lahtrid | `write.splitCells` |
| Hyperlink | Hüperlink | `write.styleName.hyperlink` |
| Numbering… | Nummerdus… | `write.styles.format.numbering` |
| Text Box | Tekstikast | `write.textBox` |
| Wrap Text | Teksti murdmine | `write.wrapText` |
| Cross-reference | Ristviide | `write.xref.button` |
| Footnote | Joonealune märkus | `write.xref.footnote` |
| Reset | Lähtesta | `write.notes.sep.reset` |
| Format Background | Vorminda tausta | `show.bg.format` |
| Background Styles | Tausta laadid | `show.bg.styles` |
| Fonts | Fondid | `show.design.fonts` |
| Themes | Teemad | `show.design.themes` |
| Header & Footer… | Päis ja jalus… | `show.hf.titleDots` |
| Slide Master | Slaidimaster | `show.master.tab` |
| Slide Size | Slaidi suurus | `show.size.customTitle` |
| Set Up Slide Show | Häälesta slaidiseanss | `show.setup.titleDots` |
| Guides | Juhised | `show.view.guides` |
| Notes Page | Märkmeleht | `show.view.notesPage` |
| Outline View | Liigendvaade | `show.view.outline` |
| Reading View | Lugemisvaade | `show.view.reading` |
| Slide Sorter | Slaidisorteerija | `show.view.sorter` |
| Edit Points | Redigeeri punkte | `show.editPoints` |
| Fill Color | Täitevärv | `show.fx.fillColor` |
| Animation Painter | Animatsioonikopeerija | `show.animPainter` |
| From Current Slide… | Praegusest slaidist… | `show.recordFromCurrent` |
| From Beginning… | Algusest… | `show.recordFromStart` |

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

## Show effects and transitions
Animation effects (`show.fx.*`) and slide transitions (`show.trans.*`), named as in the PowerPoint localisation where it exists (P9-LR5).

| English | Term | Key |
| --- | --- | --- |
| Appear | Ilmumine | `show.fx.appear` |
| Disappear | Kadumine | `show.fx.disappear` |
| Fade | Tuhmumine | `show.fx.fade` |
| Fly In | Lendamine sisse | `show.fx.flyIn` |
| Fly Out | Lendamine välja | `show.fx.flyOut` |
| Grow/Shrink | Kasvamine/kahanemine | `show.fx.growShrink` |
| Spin | Pöörlemine | `show.fx.spin` |
| Wipe | Pühkimine | `show.fx.wipe` |
| Zoom | Suum | `show.fx.zoom` |
| Cover | Kate | `show.trans.cover` |
| Cut | Lõige | `show.trans.cut` |
| Fade | Tuhmumine | `show.trans.fade` |
| None | Puudub | `show.trans.none` |
| Push | Lükkamine | `show.trans.push` |
| Split | Poolitus | `show.trans.split` |
| Wipe | Pühkimine | `show.trans.wipe` |
| Zoom | Suum | `show.trans.zoom` |
| Morph | Morf | `show.trans.morph` |
| Reveal | Paljastus | `show.trans.reveal` |
| Shred | Purustamine | `show.trans.shred` |
| Fall Over | Ümberkukkumine | `show.trans.fallOver` |
| Drape | Eesriie | `show.trans.drape` |
| Curtains | Kardinad | `show.trans.curtains` |
| Wind | Tuul | `show.trans.wind` |
| Prestige | Prestiiž | `show.trans.prestige` |
| Fracture | Murdumine | `show.trans.fracture` |
| Crush | Muljumine | `show.trans.crush` |
| Peel Off | Mahakoorimine | `show.trans.peelOff` |
| Page Curl | Lehe keeramine | `show.trans.pageCurl` |
| Airplane | Lennuk | `show.trans.airplane` |
| Origami | Origami | `show.trans.origami` |
| Honeycomb | Kärg | `show.trans.honeycomb` |
| Glitter | Sära | `show.trans.glitter` |
| Vortex | Keeris | `show.trans.vortex` |
| Ripple | Lainetus | `show.trans.ripple` |
| Switch | Vahetus | `show.trans.switch` |
| Flip | Pööramine | `show.trans.flip` |
| Gallery | Galerii | `show.trans.gallery` |
| Cube | Kuup | `show.trans.cube` |
| Doors | Uksed | `show.trans.doors` |
| Box | Kast | `show.trans.box` |
| Float In | Hõljumine sisse | `show.fx.float` |
| Float Out | Hõljumine välja | `show.fx.floatOut` |
| Split | Poolitus | `show.fx.split` |
| Shape | Kujund | `show.fx.shape` |
| Circle | Ring | `show.fx.circle` |
| Box | Kast | `show.fx.box` |
| Diamond | Romb | `show.fx.diamond` |
| Plus | Pluss | `show.fx.plus` |
| Wheel | Ratas | `show.fx.wheel` |
| Random Bars | Juhuslikud ribad | `show.fx.randomBars` |
| Grow & Turn | Kasv ja pööre | `show.fx.growTurn` |
| Shrink & Turn | Kahanemine ja pööre | `show.fx.shrinkTurn` |
| Swivel | Keerlemine | `show.fx.swivel` |
| Bounce | Põrge | `show.fx.bounce` |
| Pulse | Pulss | `show.fx.pulse` |
| Color Pulse | Värvipulss | `show.fx.colorPulse` |
| Teeter | Kõikumine | `show.fx.teeter` |
| Desaturate | Küllastuse vähendamine | `show.fx.desaturate` |
| Darken | Tumendamine | `show.fx.darken` |
| Lighten | Heledamaks muutmine | `show.fx.lighten` |
| Transparency | Läbipaistvus | `show.fx.transparency` |
| Object Color | Objekti värv | `show.fx.objectColor` |
| Line Color | Joone värv | `show.fx.lineColor` |
| Fill Color | Täitevärv | `show.fx.fillColor` |
| Brush Color | Pintsli värv | `show.fx.brushColor` |
| Font Color | Fondi värv | `show.fx.fontColor` |
| Underline | Allakriipsutus | `show.fx.underline` |
| Bold Flash | Paksu kirja sähvatus | `show.fx.boldFlash` |
| Bold Reveal | Paksu kirja paljastus | `show.fx.boldReveal` |
| Wave | Laine | `show.fx.wave` |
| Lines | Jooned | `show.fx.pathLines` |
| Arcs | Kaared | `show.fx.pathArcs` |
| Turns | Pöörded | `show.fx.pathTurns` |
| Shapes | Kujundid | `show.fx.pathShapes` |
| Loops | Silmused | `show.fx.pathLoops` |
| Custom Path | Kohandatud tee | `show.fx.pathCustom` |
| Play | Esita | `show.fx.mediaPlay` |
| Pause | Paus | `show.fx.mediaPause` |
| Stop | Peata | `show.fx.mediaStop` |

## More terms
| English | Office term | Note |
| --- | --- | --- |
| Workbook / Worksheet / Cell / Range | Tööraamat / Tööleht / Lahter / Vahemik | Calc |
| Pivot table | PivotTable | PivotChart stays "PivotChart"; case endings with a hyphen |
| Conditional formatting | Tingimusvormindus | |
| Data bars / Color scales / Icon sets | Andmeribad / Värviskaalad / Ikoonikomplektid | |
| Slicer / Sparkline | Viilutaja / Sädejoon | Estonian Excel "Sädejooned" (P9-LR5; was "Sparkline") |
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
