# Glossary: Romanian (`ro`)

Source: the Romanian (Romania) localisation of Microsoft Office (Word, Excel, PowerPoint) and its terminology. Translator: P9-L8. Reviewer: P9-LR4 (2026-10-18).

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

## Commands as used in the catalogs
The terms the catalogs use after the review (P9-LR4), one row per English command; the key shows where.

| English | Term | Key |
| --- | --- | --- |
| Copy | Copiere | `ai.pane.copy` |
| Save | Salvare | `ai.settings.save` |
| Insert | Inserare | `ai.write.insert` |
| Close | Închidere | `backstage.close` |
| New | Nou | `backstage.new` |
| Open… | Deschidere… | `backstage.open` |
| Options… | Opțiuni… | `backstage.options` |
| Print | Imprimare | `backstage.print` |
| Save As… | Salvare ca… | `backstage.saveAs` |
| Cut | Decupare | `cmd.cut` |
| Delete | Ștergere | `cmd.delete` |
| Find | Găsire | `cmd.find` |
| Paste | Lipire | `cmd.paste` |
| Redo | Refacere | `cmd.redo` |
| Replace… | Înlocuire… | `cmd.replaceDots` |
| Undo | Anulare | `cmd.undo` |
| Size | Dimensiune | `conn.browser.colSize` |
| Rename | Redenumire | `conn.browser.rename` |
| Bold | Aldin | `fmt.bold` |
| Borders | Borduri | `fmt.borders` |
| Colors | Culori | `fmt.colors` |
| Italic | Cursiv | `fmt.italic` |
| Strikethrough | Tăiere cu o linie | `fmt.strike` |
| Underline | Subliniat | `fmt.underline` |
| Zoom | Panoramare | `group.zoom` |
| Layout | Aspect | `print.layoutSection` |
| Margins | Margini | `print.margins` |
| Normal | Normale | `print.margins.normal` |
| Orientation | Orientare | `print.orientation` |
| Format | Format | `sc.format` |
| Remove Arrows | Eliminare săgeți | `calc.audit.removeArrows` |
| Show Formulas | Afișare formule | `calc.audit.showFormulas` |
| Trace Dependents | Urmărire dependenți | `calc.audit.traceDependents` |
| Trace Precedents | Urmărire precedenți | `calc.audit.tracePrecedents` |
| Breaks | Întreruperi | `calc.breaks` |
| Fill | Umplere | `calc.cf.barFill` |
| Clear | Golire | `calc.cf.clearFormat` |
| Shapes | Forme | `calc.cf.iconGroup.shapes` |
| Conditional Formatting | Formatare condiționată | `calc.cf.menu` |
| Gridlines | Linii de grilă | `calc.chart.ae.gridlines` |
| Chart | Grafic | `calc.chart.chart` |
| Center | Centru | `calc.chart.pos.center` |
| Recommended Charts | Grafice recomandate | `calc.chart.recommended` |
| Shape Fill | Umplere formă | `calc.chart.shapeFill` |
| Shape Outline | Contur formă | `calc.chart.shapeOutline` |
| New Comment | Comentariu nou | `calc.comments.new` |
| Comment | Comentariu | `calc.comments.textLabel` |
| Consolidate | Consolidare | `calc.consolidate.button` |
| Delete Cells… | Ștergere celule… | `calc.deleteCellsDots` |
| Remove Duplicates | Eliminare dubluri | `calc.dup.button` |
| Columns | Coloane | `calc.dup.columns` |
| Select All | Selectare totală | `calc.dup.selectAll` |
| Data Validation | Validare date | `calc.dv.button` |
| Filter | Filtrare | `calc.filter` |
| Font Color | Culoare font | `calc.filter.byFontColor` |
| Flash Fill | Umplere rapidă | `calc.flash.button` |
| Effects | Efecte | `calc.fmt.effects` |
| Justify | Stânga-dreapta | `calc.fmt.h.justify` |
| Indent | Indentare | `calc.fmt.indent` |
| Preview | Examinare | `calc.fmt.preview` |
| Subscript | Indice | `calc.fmt.subscript` |
| Superscript | Exponent | `calc.fmt.superscript` |
| Symbol | Simbol | `calc.fmt.symbol` |
| AutoSum | Însumare automată | `calc.fn.autoSum` |
| Insert Function | Inserare funcție | `calc.fn.insert` |
| Format Painter | Descriptor de formate | `calc.formatPainter` |
| Freeze Panes | Înghețare panouri | `calc.freezePanes` |
| Goal Seek… | Căutare țintă… | `calc.goal.dots` |
| What-If Analysis | Analiză What-If | `calc.goal.whatIf` |
| Hide | Ascundere | `calc.hide` |
| Insert Cells… | Inserare celule… | `calc.insertCellsDots` |
| Link | Legătură | `calc.link.button` |
| Merge Cells | Îmbinare celule | `calc.mergeCells` |
| Merge & Center | Îmbinare și centrare | `calc.mergeCenter` |
| Move or Copy… | Mutare sau copiere… | `calc.moveCopy.dots` |
| Define Name | Definire nume | `calc.names.define` |
| Name Manager | Manager nume | `calc.names.manager` |
| Group | Grupare | `calc.outline.group` |
| Ungroup | Anulare grupare | `calc.outline.ungroup` |
| Page Setup | Inițializare pagină | `calc.pageSetup` |
| Pictures | Imagini | `calc.picture.button` |
| PivotTable | PivotTable | `calc.pivot.pivotTable` |
| Refresh All | Reîmprospătare totală | `calc.pivot.refreshAll` |
| Styles | Stiluri | `calc.pivot.stylesGallery` |
| Print Area | Zonă de imprimare | `calc.printArea` |
| Print Titles | Imprimare titluri | `calc.printTitles` |
| Sort | Sorteze | `calc.protect.allow.sort` |
| Protect Workbook | Protejare registru de lucru | `calc.protect.bookDots` |
| Protect Sheet… | Protejare foaie… | `calc.protect.sheetDots` |
| Paste Special… | Lipire specială… | `calc.ps.dots` |
| Error Checking | Verificare erori | `calc.err.dialogTitle` |
| Previous | Anterior | `calc.err.previous` |
| Next | Următor | `calc.err.next` |
| Evaluate Formula | Evaluare formulă | `calc.eval.title` |
| Watch Window | Fereastră de inspecție | `calc.watch.title` |
| Calculate Now | Calculare acum | `calc.calc.now` |
| Sort & Filter | Sortare și filtrare | `calc.sortFilter` |
| Subtotal | Subtotal | `calc.subtotal.button` |
| Properties | Proprietăți | `calc.table.properties` |
| Table | Tabel | `calc.table.table` |
| Unhide | Reafișare | `calc.unhide` |
| Text to Columns | Text în coloane | `calc.wizard.ttcButton` |
| Align Left | Aliniere la stânga | `write.alignObj.left` |
| Align Right | Aliniere la dreapta | `write.alignObj.right` |
| Align | Aliniere | `write.alignObjects` |
| Bookmark | Marcaj | `write.bookmark.button` |
| Insert Caption | Inserare legendă | `write.caption.button` |
| Equation | Ecuație | `write.caption.equation` |
| Position | Poziție | `write.caption.position` |
| Crop | Decupare | `write.crop` |
| Spacing | Spațiere | `write.font.spacing` |
| Bring Forward | Aducere mai în față | `write.order.bringForward` |
| Bring to Front | Aducere în prim-plan | `write.order.bringToFront` |
| Send Backward | Trimitere mai în spate | `write.order.sendBackward` |
| Send to Back | Trimitere în plan secundar | `write.order.sendToBack` |
| Picture | Imagine | `write.picture` |
| Section | Secțiune | `write.reveal.section` |
| Rotate | Rotire | `write.rotate` |
| Ruler | Riglă | `write.ruler` |
| Selection Pane | Panou de selecție | `write.selectionPane` |
| Spelling | Ortografie | `write.spelling` |
| Split Cells | Divizare celule | `write.splitCells` |
| Hyperlink | Hyperlink | `write.styleName.hyperlink` |
| Numbering… | Numerotare… | `write.styles.format.numbering` |
| Text Box | Casetă text | `write.textBox` |
| Wrap Text | Încadrare text | `write.wrapText` |
| Cross-reference | Referință încrucișată | `write.xref.button` |
| Footnote | Notă de subsol | `write.xref.footnote` |
| Reset | Resetare | `write.notes.sep.reset` |
| Format Background | Formatare fundal | `show.bg.format` |
| Background Styles | Stiluri de fundal | `show.bg.styles` |
| Fonts | Fonturi | `show.design.fonts` |
| Themes | Teme | `show.design.themes` |
| Header & Footer… | Antet și subsol… | `show.hf.titleDots` |
| Slide Master | Model diapozitive | `show.master.tab` |
| Slide Size | Dimensiune diapozitiv | `show.size.customTitle` |
| Set Up Slide Show | Configurare expunere | `show.setup.titleDots` |
| Guides | Ghidaje | `show.view.guides` |
| Notes Page | Pagină de note | `show.view.notesPage` |
| Outline View | Vizualizare schiță | `show.view.outline` |
| Reading View | Vizualizare citire | `show.view.reading` |
| Slide Sorter | Sortare diapozitive | `show.view.sorter` |
| Edit Points | Editare puncte | `show.editPoints` |
| Fill Color | Culoare umplere | `show.fx.fillColor` |
| Animation Painter | Pensulă de animație | `show.animPainter` |
| From Current Slide… | De la diapozitivul curent… | `show.recordFromCurrent` |
| From Beginning… | De la început… | `show.recordFromStart` |

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

## Show effects and transitions
Animation effects (`show.fx.*`) and slide transitions (`show.trans.*`), named as in the PowerPoint localisation (P9-LR4).

| English | Term | Key |
| --- | --- | --- |
| Appear | Apariție | `show.fx.appear` |
| Disappear | Dispariție | `show.fx.disappear` |
| Fade | Estompare | `show.fx.fade` |
| Fly In | Zbor spre interior | `show.fx.flyIn` |
| Fly Out | Zbor spre exterior | `show.fx.flyOut` |
| Grow/Shrink | Mărire/micșorare | `show.fx.growShrink` |
| Spin | Rotire | `show.fx.spin` |
| Wipe | Ștergere | `show.fx.wipe` |
| Zoom | Panoramare | `show.fx.zoom` |
| Cover | Acoperire | `show.trans.cover` |
| Cut | Tăiere | `show.trans.cut` |
| Fade | Estompare | `show.trans.fade` |
| None | Fără | `show.trans.none` |
| Push | Împingere | `show.trans.push` |
| Split | Divizare | `show.trans.split` |
| Wipe | Ștergere | `show.trans.wipe` |
| Zoom | Panoramare | `show.trans.zoom` |
| Morph | Transformare | `show.trans.morph` |
| Reveal | Dezvăluire | `show.trans.reveal` |
| Shred | Mărunțire | `show.trans.shred` |
| Fall Over | Cădere | `show.trans.fallOver` |
| Drape | Draperie | `show.trans.drape` |
| Curtains | Perdele | `show.trans.curtains` |
| Wind | Vânt | `show.trans.wind` |
| Prestige | Prestigiu | `show.trans.prestige` |
| Fracture | Fractură | `show.trans.fracture` |
| Crush | Zdrobire | `show.trans.crush` |
| Peel Off | Dezlipire | `show.trans.peelOff` |
| Page Curl | Răsucire pagină | `show.trans.pageCurl` |
| Airplane | Avion | `show.trans.airplane` |
| Origami | Origami | `show.trans.origami` |
| Honeycomb | Fagure | `show.trans.honeycomb` |
| Glitter | Sclipici | `show.trans.glitter` |
| Vortex | Vârtej | `show.trans.vortex` |
| Ripple | Ondulare | `show.trans.ripple` |
| Switch | Comutare | `show.trans.switch` |
| Flip | Răsturnare | `show.trans.flip` |
| Gallery | Galerie | `show.trans.gallery` |
| Cube | Cub | `show.trans.cube` |
| Doors | Uși | `show.trans.doors` |
| Box | Casetă | `show.trans.box` |
| Float In | Intrare plutitoare | `show.fx.float` |
| Float Out | Ieșire plutitoare | `show.fx.floatOut` |
| Split | Divizare | `show.fx.split` |
| Shape | Formă | `show.fx.shape` |
| Circle | Cerc | `show.fx.circle` |
| Box | Casetă | `show.fx.box` |
| Diamond | Romb | `show.fx.diamond` |
| Plus | Plus | `show.fx.plus` |
| Wheel | Roată | `show.fx.wheel` |
| Random Bars | Bare aleatorii | `show.fx.randomBars` |
| Grow & Turn | Mărire și întoarcere | `show.fx.growTurn` |
| Shrink & Turn | Micșorare și întoarcere | `show.fx.shrinkTurn` |
| Swivel | Pivotare | `show.fx.swivel` |
| Bounce | Săritură | `show.fx.bounce` |
| Pulse | Puls | `show.fx.pulse` |
| Color Pulse | Puls de culoare | `show.fx.colorPulse` |
| Teeter | Legănare | `show.fx.teeter` |
| Desaturate | Desaturare | `show.fx.desaturate` |
| Darken | Întunecare | `show.fx.darken` |
| Lighten | Luminare | `show.fx.lighten` |
| Transparency | Transparență | `show.fx.transparency` |
| Object Color | Culoare obiect | `show.fx.objectColor` |
| Line Color | Culoare linie | `show.fx.lineColor` |
| Fill Color | Culoare umplere | `show.fx.fillColor` |
| Brush Color | Culoare pensulă | `show.fx.brushColor` |
| Font Color | Culoare font | `show.fx.fontColor` |
| Underline | Subliniere | `show.fx.underline` |
| Bold Flash | Sclipire aldină | `show.fx.boldFlash` |
| Bold Reveal | Dezvăluire aldină | `show.fx.boldReveal` |
| Wave | Undă | `show.fx.wave` |
| Lines | Linii | `show.fx.pathLines` |
| Arcs | Arce | `show.fx.pathArcs` |
| Turns | Viraje | `show.fx.pathTurns` |
| Shapes | Forme | `show.fx.pathShapes` |
| Loops | Bucle | `show.fx.pathLoops` |
| Custom Path | Cale particularizată | `show.fx.pathCustom` |
| Play | Redare | `show.fx.mediaPlay` |
| Pause | Pauză | `show.fx.mediaPause` |
| Stop | Oprire | `show.fx.mediaStop` |

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
| Flowchart (shapes) | Schemă logică | "Organigramă" is the org chart |
| Zoom (effect, transition, group) | Panoramare | |
