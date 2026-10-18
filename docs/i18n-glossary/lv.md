# Glossary: Latvian (`lv`)

Source: the Latvian (Latvia) localisation of Microsoft Office (Word, Excel, PowerPoint) and its terminology. Translator: P9-L10. Reviewer: P9-LR5 (2026-10-18).

## Register
- Address: informal "tu / tev / tavs / tava" and 2nd-person singular imperatives ("Izvēlies", "Ievadi", "Noklikšķini", "Atver", "Pārbaudi"); never "jūs / jūsu / jums" or "-iet" imperatives ("Izvēlieties", "Noklikšķiniet").
- Buttons and menu commands: infinitive or noun, as Office does ("Saglabāt", "Ievietot tabulu", "Drukāt"); messages to the user are in the informal imperative or a neutral statement.
- Gender-neutral wording: past-tense 2nd-person forms with gender endings are avoided ("tu esi bezsaistē", imperatives instead).
- Ellipsis "…" for commands that open a dialog, as in English.
- Quotation marks: „…” (low-high pair).
- Ordinals take a full stop ("{n}. slaids", "{page}. lappuse no {count}"); decimal comma in prose ("1,5 rindas"), thousands separator and cell values stay as in English.
- Keyboard key names in shortcut texts (packages/ui-shared/src/i18n/keyNames.ts): Latvian Office keeps Ctrl = Ctrl, Shift = Shift, Delete = Delete, Enter = Enter (no table entry needed).
- Plural categories: `zero / one / other`. `one` = 1, 21, 31 …; `zero` = 0, 10–20, 30 … (genitive plural: "0 lappušu", "11 slaidu"); `other` = 2–9, 22–29 … (nominative plural: "2 lappuses"). Every plural key has a `.zero` form. Messages with a verb or participle use the nominative plural in `zero` as well ("Aizstātas {count} šūnas", "Ievietoti {count} slaidi"): the genitive is kept for bare counts ("{count} vārdu"). `one` also covers 21, 31 …, so its text keeps `{count}`; "Select all {count}" drops "all" in `one` ("Atlasīt {count} gadījumu").
- Review (P9-LR5): no gender-marked "your own" ("tavs paša" → "tavs personīgais konts"); "trūkst" takes the genitive ("kājenes daļas {part} trūkst"); parenthetical "iespējams," between commas; inch presets show the German cm values ("Šaurs (1,27 cm)").

## Ribbon tabs
| English | Office term | Note |
| --- | --- | --- |
| File | Fails | |
| Home | Sākums | |
| Insert | Ievietošana | |
| Draw | Zīmēšana | |
| Design | Noformējums | |
| Layout (Write: Layout, Calc: Page Layout) | Izkārtojums / Lappuses izkārtojums | Write: "Izkārtojums", Calc: "Lappuses izkārtojums" |
| References | Atsauces | Write |
| Mailings | Sūtījumi | Write |
| Review | Pārskatīšana | |
| View | Skats | |
| Formulas | Formulas | Calc |
| Data | Dati | Calc |
| Transitions | Pārejas | Show |
| Animations | Animācijas | Show |
| Slide Show | Slaidrāde | Show |
| Help | Palīdzība | |
| Picture / Table / Chart / Drawing Tools (contextual) | Attēlu / Tabulas / Diagrammas / Zīmēšanas rīki | |

## Ribbon groups
| English | Office term | Note |
| --- | --- | --- |
| Clipboard | Starpliktuve | |
| Font | Fonts | |
| Paragraph | Rindkopa | |
| Styles | Stili | |
| Editing | Rediģēšana | |
| Number | Skaitlis | Calc |
| Alignment | Līdzinājums | Calc |
| Cells | Šūnas | Calc |
| Slides | Slaidi | Show |
| Drawing | Zīmēšana | Show |
| Zoom | Tālummaiņa | |
| Show (View › Show) | Rādīt | |
| Language | Valoda | the picker; label "Valoda / Language" |

## Common commands
| English | Office term | Note |
| --- | --- | --- |
| New | Jauns | |
| Open… | Atvērt… | |
| Save | Saglabāt | |
| Save As… | Saglabāt kā… | |
| Print | Drukāt | |
| Export PDF… | Eksportēt PDF… | |
| Close | Aizvērt | |
| Options… | Opcijas… | |
| Undo / Redo | Atsaukt / Atkārtot | |
| Cut / Copy / Paste | Izgriezt / Kopēt / Ielīmēt | |
| Paste Special… | Īpašā ielīmēšana… | |
| Format Painter | Formāta kopētājs | |
| Find / Replace… / Go To… | Meklēt / Aizstāt… / Doties uz… | |
| Select All | Atlasīt visu | |
| Bold / Italic / Underline / Strikethrough | Treknraksts / Slīpraksts / Pasvītrojums / Pārsvītrojums | |
| Font Color / Highlight / Fill Color | Fonta krāsa / Teksta izcēluma krāsa / Aizpildījuma krāsa | |
| Insert Picture / Table / Chart / Shape / Text Box | Ievietot attēlu / tabulu / diagrammu / formu / teksta lodziņu | |
| Bring to Front / Send to Back | Pārvietot uz priekšplānu / uz aizmugures plānu | |
| Group / Ungroup | Grupēt / Atgrupēt | |
| Sort / Filter | Kārtot / Filtrs | Calc |
| Insert Function | Ievietot funkciju | Calc |
| New Slide | Jauns slaids | Show |
| From Beginning / From Current Slide | No sākuma / No pašreizējā slaida | Show |
| Track Changes / Comments | Izmaiņu izsekošana / Komentāri | Write |

## Commands as used in the catalogs
The terms the catalogs use after the review (P9-LR5), one row per English command; the key shows where.

| English | Term | Key |
| --- | --- | --- |
| Copy | Kopēt | `ai.pane.copy` |
| Save | Saglabāt | `ai.settings.save` |
| Insert | Ievietot | `ai.write.insert` |
| Close | Aizvērt | `backstage.close` |
| New | Jauns | `backstage.new` |
| Open… | Atvērt… | `backstage.open` |
| Options… | Opcijas… | `backstage.options` |
| Print | Drukāt | `backstage.print` |
| Save As… | Saglabāt kā… | `backstage.saveAs` |
| Cut | Izgriezt | `cmd.cut` |
| Delete | Dzēst | `cmd.delete` |
| Find | Meklēt | `cmd.find` |
| Paste | Ielīmēt | `cmd.paste` |
| Redo | Atkārtot | `cmd.redo` |
| Replace… | Aizstāt… | `cmd.replaceDots` |
| Undo | Atsaukt | `cmd.undo` |
| Size | Lielums | `conn.browser.colSize` |
| Rename | Pārdēvēt | `conn.browser.rename` |
| Bold | Treknraksts | `fmt.bold` |
| Borders | Apmales | `fmt.borders` |
| Colors | Krāsas | `fmt.colors` |
| Italic | Slīpraksts | `fmt.italic` |
| Strikethrough | Pārsvītrojums | `fmt.strike` |
| Underline | Pasvītrojums | `fmt.underline` |
| Zoom | Tālummaiņa | `group.zoom` |
| Layout | Izkārtojums | `print.layoutSection` |
| Margins | Piemales | `print.margins` |
| Normal | Parasts | `print.margins.normal` |
| Orientation | Orientācija | `print.orientation` |
| Format | Formāts | `sc.format` |
| Remove Arrows | Noņemt bultiņas | `calc.audit.removeArrows` |
| Show Formulas | Rādīt formulas | `calc.audit.showFormulas` |
| Trace Dependents | Izsekot atkarīgajām šūnām | `calc.audit.traceDependents` |
| Trace Precedents | Izsekot priekštečiem | `calc.audit.tracePrecedents` |
| Breaks | Pārtraukumi | `calc.breaks` |
| Fill | Aizpildījums | `calc.cf.barFill` |
| Clear | Notīrīt | `calc.cf.clearFormat` |
| Shapes | Formas | `calc.cf.iconGroup.shapes` |
| Conditional Formatting | Nosacītā formatēšana | `calc.cf.menu` |
| Gridlines | Režģlīnijas | `calc.chart.ae.gridlines` |
| Chart | Diagramma | `calc.chart.chart` |
| Center | Centrā | `calc.chart.pos.center` |
| Recommended Charts | Ieteiktās diagrammas | `calc.chart.recommended` |
| Shape Fill | Formas aizpildījums | `calc.chart.shapeFill` |
| Shape Outline | Formas kontūra | `calc.chart.shapeOutline` |
| New Comment | Jauns komentārs | `calc.comments.new` |
| Comment | Komentārs | `calc.comments.textLabel` |
| Consolidate | Konsolidēt | `calc.consolidate.button` |
| Delete Cells… | Dzēst šūnas… | `calc.deleteCellsDots` |
| Remove Duplicates | Noņemt dublikātus | `calc.dup.button` |
| Columns | Kolonnas | `calc.dup.columns` |
| Select All | Atlasīt visu | `calc.dup.selectAll` |
| Data Validation | Datu pārbaude | `calc.dv.button` |
| Filter | Filtrs | `calc.filter` |
| Font Color | Fonta krāsa | `calc.filter.byFontColor` |
| Flash Fill | Zibenīgā aizpilde | `calc.flash.button` |
| Effects | Efekti | `calc.fmt.effects` |
| Justify | Abpusēji | `calc.fmt.h.justify` |
| Indent | Atkāpe | `calc.fmt.indent` |
| Preview | Priekšskatījums | `calc.fmt.preview` |
| Subscript | Apakšraksts | `calc.fmt.subscript` |
| Superscript | Augšraksts | `calc.fmt.superscript` |
| Symbol | Simbols | `calc.fmt.symbol` |
| AutoSum | Automātiskā summa | `calc.fn.autoSum` |
| Insert Function | Ievietot funkciju | `calc.fn.insert` |
| Format Painter | Formāta kopētājs | `calc.formatPainter` |
| Freeze Panes | Sasaldēt rūtis | `calc.freezePanes` |
| Goal Seek… | Mērķa meklēšana… | `calc.goal.dots` |
| What-If Analysis | Ja-tad analīze | `calc.goal.whatIf` |
| Hide | Paslēpt | `calc.hide` |
| Insert Cells… | Ievietot šūnas… | `calc.insertCellsDots` |
| Link | Saite | `calc.link.button` |
| Merge Cells | Apvienot šūnas | `calc.mergeCells` |
| Merge & Center | Apvienot un centrēt | `calc.mergeCenter` |
| Move or Copy… | Pārvietot vai kopēt… | `calc.moveCopy.dots` |
| Define Name | Definēt nosaukumu | `calc.names.define` |
| Name Manager | Nosaukumu pārvaldnieks | `calc.names.manager` |
| Group | Grupēt | `calc.outline.group` |
| Ungroup | Atgrupēt | `calc.outline.ungroup` |
| Page Setup | Lapas iestatīšana | `calc.pageSetup` |
| Pictures | Attēli | `calc.picture.button` |
| PivotTable | Rakurstabula | `calc.pivot.pivotTable` |
| Refresh All | Atsvaidzināt visu | `calc.pivot.refreshAll` |
| Styles | Stili | `calc.pivot.stylesGallery` |
| Print Area | Drukas apgabals | `calc.printArea` |
| Print Titles | Drukājamie virsraksti | `calc.printTitles` |
| Sort | Kārtot | `calc.protect.allow.sort` |
| Protect Workbook | Aizsargāt darbgrāmatu | `calc.protect.bookDots` |
| Protect Sheet… | Aizsargāt lapu… | `calc.protect.sheetDots` |
| Paste Special… | Īpašā ielīmēšana… | `calc.ps.dots` |
| Error Checking | Kļūdu pārbaude | `calc.err.dialogTitle` |
| Previous | Iepriekšējā | `calc.err.previous` |
| Next | Nākamā | `calc.err.next` |
| Evaluate Formula | Izvērtēt formulu | `calc.eval.title` |
| Watch Window | Uzraudzības logs | `calc.watch.title` |
| Calculate Now | Aprēķināt tūlīt | `calc.calc.now` |
| Sort & Filter | Kārtot un filtrēt | `calc.sortFilter` |
| Subtotal | Starpsumma | `calc.subtotal.button` |
| Properties | Rekvizīti | `calc.table.properties` |
| Table | Tabula | `calc.table.table` |
| Unhide | Parādīt | `calc.unhide` |
| Text to Columns | Teksts kolonnās | `calc.wizard.ttcButton` |
| Align Left | Līdzināt pa kreisi | `write.alignObj.left` |
| Align Right | Līdzināt pa labi | `write.alignObj.right` |
| Align | Līdzināt | `write.alignObjects` |
| Bookmark | Grāmatzīme | `write.bookmark.button` |
| Insert Caption | Ievietot parakstu | `write.caption.button` |
| Equation | Vienādojums | `write.caption.equation` |
| Position | Pozīcija | `write.caption.position` |
| Crop | Apgriezt | `write.crop` |
| Spacing | Atstarpe | `write.font.spacing` |
| Bring Forward | Pārvietot vienu līmeni uz priekšu | `write.order.bringForward` |
| Bring to Front | Pārvietot uz priekšplānu | `write.order.bringToFront` |
| Send Backward | Pārvietot vienu līmeni atpakaļ | `write.order.sendBackward` |
| Send to Back | Pārvietot uz aizmugures plānu | `write.order.sendToBack` |
| Picture | Attēls | `write.picture` |
| Section | Sadaļa | `write.reveal.section` |
| Rotate | Pagriezt | `write.rotate` |
| Ruler | Lineāls | `write.ruler` |
| Selection Pane | Atlases rūts | `write.selectionPane` |
| Spelling | Pareizrakstība | `write.spelling` |
| Split Cells | Sadalīt šūnas | `write.splitCells` |
| Hyperlink | Hipersaite | `write.styleName.hyperlink` |
| Numbering… | Numerācija… | `write.styles.format.numbering` |
| Text Box | Teksta lodziņš | `write.textBox` |
| Wrap Text | Teksta aplaušana | `write.wrapText` |
| Cross-reference | Savstarpēja atsauce | `write.xref.button` |
| Footnote | Vēre | `write.xref.footnote` |
| Reset | Atiestatīt | `write.notes.sep.reset` |
| Format Background | Fona formatēšana | `show.bg.format` |
| Background Styles | Fona stili | `show.bg.styles` |
| Fonts | Fonti | `show.design.fonts` |
| Themes | Motīvi | `show.design.themes` |
| Header & Footer… | Galvene un kājene… | `show.hf.titleDots` |
| Slide Master | Slaidu paraugs | `show.master.tab` |
| Slide Size | Slaida izmērs | `show.size.customTitle` |
| Set Up Slide Show | Iestatīt slaidrādi | `show.setup.titleDots` |
| Guides | Palīglīnijas | `show.view.guides` |
| Notes Page | Piezīmju lapa | `show.view.notesPage` |
| Outline View | Struktūras skats | `show.view.outline` |
| Reading View | Lasīšanas skats | `show.view.reading` |
| Slide Sorter | Slaidu kārtotājs | `show.view.sorter` |
| Edit Points | Rediģēt punktus | `show.editPoints` |
| Fill Color | Aizpildījuma krāsa | `show.fx.fillColor` |
| Animation Painter | Animācijas kopētājs | `show.animPainter` |
| From Current Slide… | No pašreizējā slaida… | `show.recordFromCurrent` |
| From Beginning… | No sākuma… | `show.recordFromStart` |

## Dialog buttons and messages
| English | Office term | Note |
| --- | --- | --- |
| OK | Labi | |
| Cancel | Atcelt | |
| Apply | Lietot | |
| Close | Aizvērt | |
| Yes / No | Jā / Nē | |
| Don't Save | Nesaglabāt | the unsaved-changes prompt |
| Browse… | Pārlūkot… | |
| Reset | Atiestatīt | |
| Insert / Delete | Ievietot / Dzēst | |
| Back / Next / Finish | Atpakaļ / Tālāk / Pabeigt | wizards |
| Recent | Nesen izmantotie | backstage |
| Untitled | Bez nosaukuma | default document name |
| Saved / Saving… / Unsaved changes | Saglabāts / Notiek saglabāšana… / Nesaglabātas izmaiņas | status bar |

## File types
| English | Office term | Note |
| --- | --- | --- |
| Excel Workbook | Excel darbgrāmata | `.xlsx`, the desktop dialog filter name |
| Word Document | Word dokuments | `.docx` |
| PowerPoint Presentation | PowerPoint prezentācija | `.pptx` |
| Excel Template / Word Template / PowerPoint Template | Excel / Word / PowerPoint veidne | `.xltx` / `.dotx` / `.potx` |
| CSV (Comma delimited) | CSV (atdalīts ar komatiem) | Calc |
| Text Files | Teksta faili | |
| PDF | PDF | |
| Office Theme | Office motīvs | `.thmx` |
| All Files | Visi faili | |

## Show effects and transitions
Animation effects (`show.fx.*`) and slide transitions (`show.trans.*`), named as in the PowerPoint localisation where it exists (P9-LR5).

| English | Term | Key |
| --- | --- | --- |
| Appear | Parādīšanās | `show.fx.appear` |
| Disappear | Pazušana | `show.fx.disappear` |
| Fade | Izbalēšana | `show.fx.fade` |
| Fly In | Ielidošana | `show.fx.flyIn` |
| Fly Out | Izlidošana | `show.fx.flyOut` |
| Grow/Shrink | Palielināšana/samazināšana | `show.fx.growShrink` |
| Spin | Griešanās | `show.fx.spin` |
| Wipe | Slaucīšana | `show.fx.wipe` |
| Zoom | Tālummaiņa | `show.fx.zoom` |
| Cover | Pārsegšana | `show.trans.cover` |
| Cut | Izgriešana | `show.trans.cut` |
| Fade | Izbalēšana | `show.trans.fade` |
| None | Nav | `show.trans.none` |
| Push | Stumšana | `show.trans.push` |
| Split | Sadalīšana | `show.trans.split` |
| Wipe | Slaucīšana | `show.trans.wipe` |
| Zoom | Tālummaiņa | `show.trans.zoom` |
| Morph | Pārveidošana | `show.trans.morph` |
| Reveal | Atklāšana | `show.trans.reveal` |
| Shred | Sasmalcināšana | `show.trans.shred` |
| Fall Over | Apgāšanās | `show.trans.fallOver` |
| Drape | Aizkars | `show.trans.drape` |
| Curtains | Aizkari | `show.trans.curtains` |
| Wind | Vējš | `show.trans.wind` |
| Prestige | Prestižs | `show.trans.prestige` |
| Fracture | Sadrumstalošana | `show.trans.fracture` |
| Crush | Saspiešana | `show.trans.crush` |
| Peel Off | Nolobīšana | `show.trans.peelOff` |
| Page Curl | Lapas pagriešana | `show.trans.pageCurl` |
| Airplane | Lidmašīna | `show.trans.airplane` |
| Origami | Origami | `show.trans.origami` |
| Honeycomb | Medus šūnas | `show.trans.honeycomb` |
| Glitter | Mirdzums | `show.trans.glitter` |
| Vortex | Virpulis | `show.trans.vortex` |
| Ripple | Viļņošanās | `show.trans.ripple` |
| Switch | Pārslēgšana | `show.trans.switch` |
| Flip | Apvēršana | `show.trans.flip` |
| Gallery | Galerija | `show.trans.gallery` |
| Cube | Kubs | `show.trans.cube` |
| Doors | Durvis | `show.trans.doors` |
| Box | Kaste | `show.trans.box` |
| Float In | Iepeldēšana | `show.fx.float` |
| Float Out | Izpeldēšana | `show.fx.floatOut` |
| Split | Sadalīšana | `show.fx.split` |
| Shape | Forma | `show.fx.shape` |
| Circle | Aplis | `show.fx.circle` |
| Box | Kaste | `show.fx.box` |
| Diamond | Rombs | `show.fx.diamond` |
| Plus | Plus | `show.fx.plus` |
| Wheel | Ritenis | `show.fx.wheel` |
| Random Bars | Nejaušas joslas | `show.fx.randomBars` |
| Grow & Turn | Palielināšana un pagriešana | `show.fx.growTurn` |
| Shrink & Turn | Samazināšana un pagriešana | `show.fx.shrinkTurn` |
| Swivel | Pagriešanās ap asi | `show.fx.swivel` |
| Bounce | Atlēkšana | `show.fx.bounce` |
| Pulse | Pulsēšana | `show.fx.pulse` |
| Color Pulse | Krāsu pulsēšana | `show.fx.colorPulse` |
| Teeter | Grīļošanās | `show.fx.teeter` |
| Desaturate | Atkrāsošana | `show.fx.desaturate` |
| Darken | Aptumšošana | `show.fx.darken` |
| Lighten | Izgaismošana | `show.fx.lighten` |
| Transparency | Caurspīdīgums | `show.fx.transparency` |
| Object Color | Objekta krāsa | `show.fx.objectColor` |
| Line Color | Līnijas krāsa | `show.fx.lineColor` |
| Fill Color | Aizpildījuma krāsa | `show.fx.fillColor` |
| Brush Color | Otas krāsa | `show.fx.brushColor` |
| Font Color | Fonta krāsa | `show.fx.fontColor` |
| Underline | Pasvītrojums | `show.fx.underline` |
| Bold Flash | Treknraksta uzplaiksnījums | `show.fx.boldFlash` |
| Bold Reveal | Treknraksta atklāšana | `show.fx.boldReveal` |
| Wave | Vilnis | `show.fx.wave` |
| Lines | Līnijas | `show.fx.pathLines` |
| Arcs | Loki | `show.fx.pathArcs` |
| Turns | Pagriezieni | `show.fx.pathTurns` |
| Shapes | Formas | `show.fx.pathShapes` |
| Loops | Cilpas | `show.fx.pathLoops` |
| Custom Path | Pielāgots ceļš | `show.fx.pathCustom` |
| Play | Atskaņot | `show.fx.mediaPlay` |
| Pause | Pauze | `show.fx.mediaPause` |
| Stop | Apturēt | `show.fx.mediaStop` |

## More terms
| English | Office term | Note |
| --- | --- | --- |
| Workbook / Worksheet / Cell / Range | Darbgrāmata / Darblapa (lapa) / Šūna / Diapazons | Calc |
| Pivot table | Rakurstabula | PivotChart = Rakursdiagramma |
| Conditional formatting | Nosacītā formatēšana | |
| Data bars / Color scales / Icon sets | Datu joslas / Krāsu skalas / Ikonu kopas | |
| Slicer / Sparkline | Griezums / Sparklīnija | |
| Flash Fill | Zibenīgā aizpilde | |
| Goal Seek / What-If Analysis | Mērķa meklēšana / Ja-tad analīze | |
| Paragraph / Heading | Rindkopa / Virsraksts | |
| Footnote / Endnote | Vēre / Beigu vēre | |
| Header / Footer | Galvene / Kājene | |
| Bookmark / Cross-reference | Grāmatzīme / Savstarpēja atsauce | |
| Caption / Table of contents | Paraksts / Satura rādītājs | |
| Table of figures | Ilustrāciju saraksts | |
| Slide / Slide master / Layout | Slaids / Slaidu paraugs (paraugslaids) / Izkārtojums | |
| Speaker notes / Presenter view | Referenta piezīmes / Prezentētāja skats | |
| Entrance / Emphasis / Exit (effects) | Ienākšana / Izcelšana / Iziešana | Show |
| Transition names | Pārveidošana (Morph), Izbalēšana (Fade), Stumšana (Push), Sadalīšana (Split), Slaucīšana (Wipe) | Show |
| Placeholder | Vietturis | |
| Gridlines / Guides | Režģlīnijas / Palīglīnijas | |
| Comment / Note (Calc) | Komentārs / Piezīme | |
| Hyperlink / ScreenTip | Hipersaite / Ekrāna padoms | |
