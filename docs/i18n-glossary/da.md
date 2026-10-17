# Glossary: Danish (`da`)

Source: the Danish (Denmark) localisation of Microsoft Office (Word, Excel, PowerPoint) and its terminology. Translator: P9-L4. Reviewer: P9-LR2 (2026-10-18).

## Register
- Address: informal "du / dig / din / dit / dine", imperatives in the familiar form ("Angiv", "Vælg", "Klik", "Prøv igen"); never "De / Dem / Deres" as an address (the pronoun "de" = "they" is not used in the UI).
- Buttons and menu commands: imperative / noun as Office does ("Gem", "Indsæt tabel", "Åbn"); messages to the user in the informal imperative or a neutral statement.
- Ellipsis "…" for commands that open a dialog, as in English.
- Decimal comma and thousands point (8,5 × 14 tommer; "Brug 1000-separator (.)").
- Keyboard key names in shortcut texts (packages/ui-shared/src/i18n/keyNames.ts): Ctrl = Ctrl, Shift = Skift, Delete = Delete, Enter = Enter.
- Plural categories: `one / other`.
- Slide = "dias" as in Danish PowerPoint (neuter: et dias / diaset, plural dias / diassene); "Diasshow", "Diasmaster", "Diassortering". Section = "sektion" (Word and PowerPoint); "afsnit" is the paragraph.

## Ribbon tabs
| English | Office term | Note |
| --- | --- | --- |
| File | Filer | |
| Home | Hjem | Office 2013 and later ("Startside" was Office 2010) |
| Insert | Indsæt | |
| Draw | Tegn | |
| Design | Design | |
| Layout (Write: Layout, Calc: Page Layout) | Layout / Sidelayout | Calc: "Sidelayout" |
| References | Referencer | Write |
| Mailings | Forsendelser | Write |
| Review | Gennemse | |
| View | Vis | |
| Formulas | Formler | Calc |
| Data | Data | Calc |
| Transitions | Overgange | Show |
| Animations | Animationer | Show |
| Slide Show | Diasshow | Show |
| Help | Hjælp | |
| Picture / Table / Chart / Drawing Tools (contextual) | Billedværktøjer / Tabelværktøjer / Diagramværktøjer / Tegneværktøjer | |

## Ribbon groups
| English | Office term | Note |
| --- | --- | --- |
| Clipboard | Udklipsholder | |
| Font | Skrifttype | |
| Paragraph | Afsnit | |
| Styles | Typografier | |
| Editing | Redigering | |
| Number | Tal | Calc |
| Alignment | Justering | Calc |
| Cells | Celler | Calc |
| Slides | Dias | Show |
| Drawing | Tegning | Show |
| Zoom | Zoom | |
| Show (View › Show) | Vis | |
| Language | Sprog | the picker; label "Sprog / Language" |

## Common commands
| English | Office term | Note |
| --- | --- | --- |
| New | Ny | |
| Open… | Åbn… | |
| Save | Gem | |
| Save As… | Gem som… | |
| Print | Udskriv | |
| Export PDF… | Eksportér PDF… | |
| Close | Luk | |
| Options… | Indstillinger… | |
| Undo / Redo | Fortryd / Gentag | |
| Cut / Copy / Paste | Klip / Kopiér / Sæt ind | |
| Paste Special… | Indsæt specielt… | Excel/Word wording |
| Format Painter | Formatpensel | |
| Find / Replace… / Go To… | Søg / Erstat… / Gå til… | |
| Select All | Markér alt | |
| Bold / Italic / Underline / Strikethrough | Fed / Kursiv / Understreget / Gennemstreget | |
| Font Color / Highlight / Fill Color | Skriftfarve / Fremhævning / Fyldfarve | |
| Insert Picture / Table / Chart / Shape / Text Box | Indsæt billede / tabel / diagram / figur / tekstboks | |
| Bring to Front / Send to Back | Placér forrest / Placér bagest | |
| Group / Ungroup | Grupper / Opdel gruppe | |
| Sort / Filter | Sortér / Filtrer | Calc |
| Insert Function | Indsæt funktion | Calc |
| New Slide | Nyt dias | Show |
| From Beginning / From Current Slide | Fra start / Fra aktuelt dias | Show |
| Track Changes / Comments | Registrer ændringer / Kommentarer | Write |

## Commands as used in the catalogs
The terms the catalogs use after the review (P9-LR2), one row per English command; the key shows where.

| English | Term | Key |
| --- | --- | --- |
| Copy | Kopiér | `ai.pane.copy` |
| Save | Gem | `ai.settings.save` |
| Insert | Indsæt | `ai.write.insert` |
| Close | Luk | `backstage.close` |
| New | Ny | `backstage.new` |
| Open… | Åbn… | `backstage.open` |
| Options… | Indstillinger… | `backstage.options` |
| Print | Udskriv | `backstage.print` |
| Save As… | Gem som… | `backstage.saveAs` |
| Cut | Klip | `cmd.cut` |
| Delete | Slet | `cmd.delete` |
| Find | Søg | `cmd.find` |
| Paste | Sæt ind | `cmd.paste` |
| Redo | Gentag | `cmd.redo` |
| Replace… | Erstat… | `cmd.replaceDots` |
| Undo | Fortryd | `cmd.undo` |
| Size | Størrelse | `conn.browser.colSize` |
| Rename | Omdøb | `conn.browser.rename` |
| Bold | Fed | `fmt.bold` |
| Borders | Kantlinjer | `fmt.borders` |
| Colors | Farver | `fmt.colors` |
| Italic | Kursiv | `fmt.italic` |
| Strikethrough | Gennemstreget | `fmt.strike` |
| Underline | Understreget | `fmt.underline` |
| Zoom | Zoom | `group.zoom` |
| Layout | Layout | `print.layoutSection` |
| Margins | Margener | `print.margins` |
| Normal | Normal | `print.margins.normal` |
| Orientation | Papirretning | `print.orientation` |
| Format | Formatér | `sc.format` |
| Remove Arrows | Fjern pile | `calc.audit.removeArrows` |
| Show Formulas | Vis formler | `calc.audit.showFormulas` |
| Trace Dependents | Spor efterfølgere | `calc.audit.traceDependents` |
| Trace Precedents | Spor forudgående | `calc.audit.tracePrecedents` |
| Breaks | Sideskift | `calc.breaks` |
| Fill | Udfyldning | `calc.cf.barFill` |
| Clear | Ryd | `calc.cf.clearFormat` |
| Shapes | Figurer | `calc.cf.iconGroup.shapes` |
| Conditional Formatting | Betinget formatering | `calc.cf.menu` |
| Gridlines | Gitterlinjer | `calc.chart.ae.gridlines` |
| Chart | Diagram | `calc.chart.chart` |
| Center | Centreret | `calc.chart.pos.center` |
| Recommended Charts | Anbefalede diagrammer | `calc.chart.recommended` |
| Shape Fill | Figurudfyldning | `calc.chart.shapeFill` |
| Shape Outline | Figurkontur | `calc.chart.shapeOutline` |
| New Comment | Ny kommentar | `calc.comments.new` |
| Comment | Kommentar | `calc.comments.textLabel` |
| Consolidate | Konsolidér | `calc.consolidate.button` |
| Delete Cells… | Slet celler… | `calc.deleteCellsDots` |
| Remove Duplicates | Fjern dubletter | `calc.dup.button` |
| Columns | Kolonner | `calc.dup.columns` |
| Select All | Markér alle | `calc.dup.selectAll` |
| Data Validation | Datavalidering | `calc.dv.button` |
| Filter | Filtrer | `calc.filter` |
| Font Color | Skriftfarve | `calc.filter.byFontColor` |
| Flash Fill | Lynudfyldning | `calc.flash.button` |
| Effects | Effekter | `calc.fmt.effects` |
| Justify | Justeret | `calc.fmt.h.justify` |
| Indent | Indrykning | `calc.fmt.indent` |
| Preview | Eksempel | `calc.fmt.preview` |
| Subscript | Sænket skrift | `calc.fmt.subscript` |
| Superscript | Hævet skrift | `calc.fmt.superscript` |
| Symbol | Symbol | `calc.fmt.symbol` |
| AutoSum | Autosum | `calc.fn.autoSum` |
| Insert Function | Indsæt funktion | `calc.fn.insert` |
| Format Painter | Formatpensel | `calc.formatPainter` |
| Freeze Panes | Frys ruder | `calc.freezePanes` |
| Goal Seek… | Målsøgning… | `calc.goal.dots` |
| What-If Analysis | Hvad-nu-hvis-analyse | `calc.goal.whatIf` |
| Hide | Skjul | `calc.hide` |
| Insert Cells… | Indsæt celler… | `calc.insertCellsDots` |
| Link | Link | `calc.link.button` |
| Merge Cells | Flet celler | `calc.mergeCells` |
| Merge & Center | Flet og centrer | `calc.mergeCenter` |
| Move or Copy… | Flyt eller kopiér… | `calc.moveCopy.dots` |
| Define Name | Definér navn | `calc.names.define` |
| Name Manager | Navnestyring | `calc.names.manager` |
| Group | Grupper | `calc.outline.group` |
| Ungroup | Opdel gruppe | `calc.outline.ungroup` |
| Page Setup | Sideopsætning | `calc.pageSetup` |
| Pictures | Billeder | `calc.picture.button` |
| PivotTable | Pivottabel | `calc.pivot.pivotTable` |
| Refresh All | Opdater alle | `calc.pivot.refreshAll` |
| Styles | Typografier | `calc.pivot.stylesGallery` |
| Print Area | Udskriftsområde | `calc.printArea` |
| Print Titles | Udskriv titler | `calc.printTitles` |
| Sort | Sortere | `calc.protect.allow.sort` |
| Protect Workbook | Beskyt projektmappe | `calc.protect.bookDots` |
| Protect Sheet… | Beskyt ark… | `calc.protect.sheetDots` |
| Paste Special… | Indsæt specielt… | `calc.ps.dots` |
| Error Checking | Fejlkontrol | `calc.err.dialogTitle` |
| Previous | Forrige | `calc.err.previous` |
| Next | Næste | `calc.err.next` |
| Evaluate Formula | Evaluer formel | `calc.eval.title` |
| Watch Window | Overvågningsvindue | `calc.watch.title` |
| Calculate Now | Beregn nu | `calc.calc.now` |
| Sort & Filter | Sortér og filtrer | `calc.sortFilter` |
| Subtotal | Subtotal | `calc.subtotal.button` |
| Properties | Egenskaber | `calc.table.properties` |
| Table | Tabel | `calc.table.table` |
| Unhide | Vis | `calc.unhide` |
| Text to Columns | Tekst til kolonner | `calc.wizard.ttcButton` |
| Align Left | Venstrejuster | `write.alignObj.left` |
| Align Right | Højrejuster | `write.alignObj.right` |
| Align | Juster | `write.alignObjects` |
| Bookmark | Bogmærke | `write.bookmark.button` |
| Insert Caption | Indsæt billedtekst | `write.caption.button` |
| Equation | Ligning | `write.caption.equation` |
| Position | Placering | `write.caption.position` |
| Crop | Beskær | `write.crop` |
| Spacing | Afstand | `write.font.spacing` |
| Bring Forward | Flyt et lag frem | `write.order.bringForward` |
| Bring to Front | Placér forrest | `write.order.bringToFront` |
| Send Backward | Flyt et lag tilbage | `write.order.sendBackward` |
| Send to Back | Placér bagest | `write.order.sendToBack` |
| Picture | Billede | `write.picture` |
| Section | Sektion | `write.reveal.section` |
| Rotate | Roter | `write.rotate` |
| Ruler | Lineal | `write.ruler` |
| Selection Pane | Markeringsrude | `write.selectionPane` |
| Spelling | Stavning | `write.spelling` |
| Split Cells | Del celler | `write.splitCells` |
| Hyperlink | Hyperlink | `write.styleName.hyperlink` |
| Numbering… | Nummerering… | `write.styles.format.numbering` |
| Text Box | Tekstboks | `write.textBox` |
| Wrap Text | Ombryd tekst | `write.wrapText` |
| Cross-reference | Krydshenvisning | `write.xref.button` |
| Footnote | Fodnote | `write.xref.footnote` |
| Reset | Nulstil | `write.notes.sep.reset` |
| Format Background | Formatér baggrund | `show.bg.format` |
| Background Styles | Baggrundstypografier | `show.bg.styles` |
| Fonts | Skrifttyper | `show.design.fonts` |
| Themes | Temaer | `show.design.themes` |
| Header & Footer… | Sidehoved og sidefod… | `show.hf.titleDots` |
| Slide Master | Diasmaster | `show.master.tab` |
| Slide Size | Diasstørrelse | `show.size.customTitle` |
| Set Up Slide Show | Konfigurer diasshow | `show.setup.titleDots` |
| Guides | Hjælpelinjer | `show.view.guides` |
| Notes Page | Notesside | `show.view.notesPage` |
| Outline View | Dispositionsvisning | `show.view.outline` |
| Reading View | Læsevisning | `show.view.reading` |
| Slide Sorter | Diassortering | `show.view.sorter` |
| Edit Points | Rediger punkter | `show.editPoints` |
| Fill Color | Fyldfarve | `show.fx.fillColor` |
| Animation Painter | Animationspensel | `show.animPainter` |
| From Current Slide… | Fra aktuelt dias… | `show.recordFromCurrent` |
| From Beginning… | Fra start… | `show.recordFromStart` |

## Dialog buttons and messages
| English | Office term | Note |
| --- | --- | --- |
| OK | OK | |
| Cancel | Annuller | |
| Apply | Anvend | |
| Close | Luk | |
| Yes / No | Ja / Nej | |
| Don't Save | Gem ikke | the unsaved-changes prompt |
| Browse… | Gennemse… | |
| Reset | Nulstil | |
| Insert / Delete | Indsæt / Slet | |
| Back / Next / Finish | Tilbage / Næste / Udfør | wizards |
| Recent | Seneste | backstage |
| Untitled | Unavngivet | default document name |
| Saved / Saving… / Unsaved changes | Gemt / Gemmer… / Ikke-gemte ændringer | status bar |

## File types
| English | Office term | Note |
| --- | --- | --- |
| Excel Workbook | Excel-projektmappe | `.xlsx`, the desktop dialog filter name |
| Word Document | Word-dokument | `.docx` |
| PowerPoint Presentation | PowerPoint-præsentation | `.pptx` |
| Excel Template / Word Template / PowerPoint Template | Excel-skabelon / Word-skabelon / PowerPoint-skabelon | `.xltx` / `.dotx` / `.potx` |
| CSV (Comma delimited) | CSV (kommasepareret) | Calc |
| Text Files | Tekstfiler | |
| PDF | PDF | |
| Office Theme | Office-tema | `.thmx` |
| All Files | Alle filer | |

## Show effects and transitions
Animation effects (`show.fx.*`) and slide transitions (`show.trans.*`), named as in the PowerPoint localisation.

| English | Term | Key |
| --- | --- | --- |
| Appear | Vis | `show.fx.appear` |
| Disappear | Forsvind | `show.fx.disappear` |
| Fade | Udtoning | `show.fx.fade` |
| Fly In | Flyv ind | `show.fx.flyIn` |
| Fly Out | Flyv ud | `show.fx.flyOut` |
| Grow/Shrink | Forstør/formindsk | `show.fx.growShrink` |
| Spin | Drej | `show.fx.spin` |
| Wipe | Visk ud | `show.fx.wipe` |
| Zoom | Zoom | `show.fx.zoom` |
| Cover | Dæk | `show.trans.cover` |
| Cut | Klip | `show.trans.cut` |
| Fade | Udtoning | `show.trans.fade` |
| None | Ingen | `show.trans.none` |
| Push | Skub | `show.trans.push` |
| Split | Opdel | `show.trans.split` |
| Wipe | Visk ud | `show.trans.wipe` |
| Zoom | Zoom | `show.trans.zoom` |
| Morph | Morph | `show.trans.morph` |
| Reveal | Afslør | `show.trans.reveal` |
| Shred | Strimler | `show.trans.shred` |
| Fall Over | Vælt | `show.trans.fallOver` |
| Drape | Draperi | `show.trans.drape` |
| Curtains | Gardiner | `show.trans.curtains` |
| Wind | Vind | `show.trans.wind` |
| Prestige | Prestige | `show.trans.prestige` |
| Fracture | Brud | `show.trans.fracture` |
| Crush | Knus | `show.trans.crush` |
| Peel Off | Skræl af | `show.trans.peelOff` |
| Page Curl | Sidekrøl | `show.trans.pageCurl` |
| Airplane | Flyvemaskine | `show.trans.airplane` |
| Origami | Origami | `show.trans.origami` |
| Honeycomb | Bikube | `show.trans.honeycomb` |
| Glitter | Glimmer | `show.trans.glitter` |
| Vortex | Hvirvel | `show.trans.vortex` |
| Ripple | Bølger | `show.trans.ripple` |
| Switch | Skift | `show.trans.switch` |
| Flip | Vend | `show.trans.flip` |
| Gallery | Galleri | `show.trans.gallery` |
| Cube | Terning | `show.trans.cube` |
| Doors | Døre | `show.trans.doors` |
| Box | Boks | `show.trans.box` |
| Float In | Svæv ind | `show.fx.float` |
| Float Out | Svæv ud | `show.fx.floatOut` |
| Split | Opdel | `show.fx.split` |
| Shape | Figur | `show.fx.shape` |
| Circle | Cirkel | `show.fx.circle` |
| Box | Boks | `show.fx.box` |
| Diamond | Rombe | `show.fx.diamond` |
| Plus | Plus | `show.fx.plus` |
| Wheel | Hjul | `show.fx.wheel` |
| Random Bars | Tilfældige streger | `show.fx.randomBars` |
| Grow & Turn | Vokse og dreje | `show.fx.growTurn` |
| Shrink & Turn | Skrumpe og dreje | `show.fx.shrinkTurn` |
| Swivel | Drej rundt | `show.fx.swivel` |
| Bounce | Hop | `show.fx.bounce` |
| Pulse | Puls | `show.fx.pulse` |
| Color Pulse | Farvepuls | `show.fx.colorPulse` |
| Teeter | Vippe | `show.fx.teeter` |
| Desaturate | Mindsk farvemætning | `show.fx.desaturate` |
| Darken | Gør mørkere | `show.fx.darken` |
| Lighten | Gør lysere | `show.fx.lighten` |
| Transparency | Gennemsigtighed | `show.fx.transparency` |
| Object Color | Objektfarve | `show.fx.objectColor` |
| Line Color | Linjefarve | `show.fx.lineColor` |
| Fill Color | Fyldfarve | `show.fx.fillColor` |
| Brush Color | Penselfarve | `show.fx.brushColor` |
| Font Color | Skriftfarve | `show.fx.fontColor` |
| Underline | Understreg | `show.fx.underline` |
| Bold Flash | Fed blink | `show.fx.boldFlash` |
| Bold Reveal | Fed afsløring | `show.fx.boldReveal` |
| Wave | Bølge | `show.fx.wave` |
| Lines | Linjer | `show.fx.pathLines` |
| Arcs | Buer | `show.fx.pathArcs` |
| Turns | Sving | `show.fx.pathTurns` |
| Shapes | Figurer | `show.fx.pathShapes` |
| Loops | Løkker | `show.fx.pathLoops` |
| Custom Path | Brugerdefineret bane | `show.fx.pathCustom` |
| Play | Afspil | `show.fx.mediaPlay` |
| Pause | Pause | `show.fx.mediaPause` |
| Stop | Stop | `show.fx.mediaStop` |

## More terms
| English | Office term | Note |
| --- | --- | --- |
| PivotTable / PivotChart | Pivottabel / Pivotdiagram | |
| Slicer | Udsnitsværktøj | |
| Flash Fill | Lynudfyldning | |
| Conditional Formatting | Betinget formatering | |
| Data Validation | Datavalidering | |
| Slide master | Diasmaster | |
| Speaker notes | Talenoter | |
| Presenter view | Oplægsholdervisning | |
| Bookmark | Bogmærke | Write |
| Cross-reference | Krydshenvisning | Write |
| Footnote / Endnote | Fodnote / Slutnote | Write |
| Header / Footer | Sidehoved / Sidefod | |
| Style set | Typografisæt | Write |
| Defined name / Name Manager | Defineret navn / Navnestyring | Calc |
| Goal Seek | Målsøgning | Calc |
| Freeze Panes | Frys ruder | Calc |
| Remove Duplicates | Fjern dubletter | Calc |
| Text to Columns | Tekst til kolonner | Calc |
| Placeholder (slide) | Pladsholder | Show |
| Spill (dynamic array) | Spild | Calc |
| Ribbon | Bånd | |
| Caption | Billedtekst | Write |
| Callout (shape) | Billedforklaring | |
| Handouts | Uddelingskopier | print |
| Poster Frame | Plakatramme | PowerPoint media |
| Fade / Wipe / Split | Udtoning / Visk ud / Opdel | animation and transition |
