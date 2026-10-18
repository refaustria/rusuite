# Glossary: Maltese (`mt`)

Source: the Maltese localisation of Microsoft Office as far as its terms are known to the translator (Microsoft publishes Maltese Language Interface Packs), completed with the Maltese terms of the EU's IATE terminology database where Office has no term (Rusuite-specific features) and established Maltese computing usage (English loan words such as "header", "footer", "bookmark", "slicer", "screenshot", "keyring" are kept where Maltese users say them). Not checked against a running Maltese Office install: the reviewer should confirm the terms marked "doubt" at the end. Translator: P9-L11. Reviewer: P9-LR5 (2026-10-18; a second pair of eyes, not a native speaker: grammar, register and consistency were checked, the loan-word choices kept).

## Register
- Address: informal 2nd person singular "int / tiegħek / -ek"; imperatives in the singular ("Agħżel", "Daħħal", "Ħassar", "Ikklikkja", "Ittajpja"), which carry no gender; never the plural "intom / tagħkom / -kom" or plural imperatives ("Agħżlu", "Ikklikkjaw"). Questions to the user use the 2nd person singular imperfect ("Tħassar il-folder …?", "Trid iżżomm …?").
- Buttons and menu commands: bare imperative, as Office does ("Issejvja", "Iftaħ", "Ipprintja", "Agħlaq"); no gendered participles addressed to the user ("li ma jistax jarah", not "li huwa għomja").
- Ellipsis "…" for commands that open a dialog, as in English.
- Keyboard key names in shortcut texts (packages/ui-shared/src/i18n/keyNames.ts): Maltese Office keeps the English key names (Ctrl, Shift, Alt, Delete, Enter, Esc), so no `KEY_NAMES` entry was added.
- Plural categories: `one / two / few / many / other` (current CLDR; the task brief listed `one/few/many/other`, `Intl.PluralRules("mt")` on the build machines returns `two` as well, so every plural key has it). Maltese counts: 1 = singular, 2 = dual/plural, 3–10 = plural, 11–99 = singular again ("11-il ċellula"), 100+ mixed. Hence `one` singular, `two` and `few` plural, `many` and `other` singular ("{count} ċellula").
- Review (P9-LR5): the number comes first in every plural form ("{count} paġna", not "paġna {count}", which reads as *page 1*); "Select all {count}" drops "all" in `one` ("Agħżel {count} okkorrenza"). No gendered predicate addressed to the user ("Kun żgur" → "Iċċekkja li …", "Biex tkun żgur" → "Biex tivverifika") and no 2nd-person plural verb ("fthuh" → "ftaħtu"). Verb agreement with the noun's gender ("jitpoġġa l-grafiku"). Inch presets show the German cm values with a decimal point ("Dojoq (1.27 cm)").
- Typography: apostrophes in elisions are the ASCII `'` (Office-style); letters ċ ġ ħ ż and għ are written as in the standard orthography.
- Not translated: function names, formula syntax, brand names, file extensions, field switches (`\h`, `\n` …). Where Maltese conjunction "u" replaces "&" in titles ("Data u Ħin"), the ampersand is dropped on purpose.

## Ribbon tabs
| English | Office term | Note |
| --- | --- | --- |
| File | Fajl | |
| Home | Dar | |
| Insert | Daħħal | |
| Draw | Tpinġija | |
| Design | Disinn | |
| Layout (Write: Layout, Calc: Page Layout) | Tqassim (Calc: Tqassim tal-Paġna) | |
| References | Referenzi | Write |
| Mailings | Korrispondenza | Write |
| Review | Rieżami | |
| View | Veduta | |
| Formulas | Formuli | Calc |
| Data | Dejta | Calc |
| Transitions | Tranżizzjonijiet | Show |
| Animations | Animazzjonijiet | Show |
| Slide Show | Preżentazzjoni bis-Slajds | Show |
| Help | Għajnuna | |
| Picture / Table / Chart / Drawing Tools (contextual) | Għodod tal-Istampi / tat-Tabella / tal-Grafiku / tat-Tpinġija | |

## Ribbon groups
| English | Office term | Note |
| --- | --- | --- |
| Clipboard | Clipboard | loan word |
| Font | Tipa | |
| Paragraph | Paragrafu | |
| Styles | Stili | |
| Editing | Editjar | |
| Number | Numru | Calc |
| Alignment | Allinjament | Calc |
| Cells | Ċelloli | Calc |
| Slides | Slajds | Show |
| Drawing | Tpinġija | Show |
| Zoom | Zoom | |
| Show (View › Show) | Uri | |
| Language | Lingwa | the picker; label "Lingwa / Language" |

## Common commands
| English | Office term | Note |
| --- | --- | --- |
| New | Ġdid | |
| Open… | Iftaħ… | |
| Save | Issejvja | |
| Save As… | Issejvja Bħala… | |
| Print | Ipprintja | |
| Export PDF… | Esporta PDF… | |
| Close | Agħlaq | |
| Options… | Għażliet… | |
| Undo / Redo | Annulla / Erġa' agħmel | |
| Cut / Copy / Paste | Aqta' / Ikkopja / Waħħal | |
| Paste Special… | Waħħal Speċjali… | |
| Format Painter | Pinzell tal-Format | |
| Find / Replace… / Go To… | Sib / Ibdel… / Mur Għal… | |
| Select All | Agħżel kollox | |
| Bold / Italic / Underline / Strikethrough | Grassett / Korsiv / Sottolinja / Strike through | |
| Font Color / Highlight / Fill Color | Kulur tat-tipa / Enfasizza / Kulur tal-mili | |
| Insert Picture / Table / Chart / Shape / Text Box | Daħħal stampa / tabella / grafiku / forma / kaxxa tat-test | |
| Bring to Front / Send to Back | Ersaq quddiem kollox / Ibgħat wara kollox | |
| Group / Ungroup | Igruppa / Neħħi l-Grupp | |
| Sort / Filter | Ordna / Filtru | Calc |
| Insert Function | Daħħal Funzjoni | Calc |
| New Slide | Slajd ġdid | Show |
| From Beginning / From Current Slide | Mill-bidu / Mis-slajd attwali | Show |
| Track Changes / Comments | Traċċar / Kummenti | Write |

## Commands as used in the catalogs
The terms the catalogs use after the review (P9-LR5), one row per English command; the key shows where.

| English | Term | Key |
| --- | --- | --- |
| Copy | Ikkopja | `ai.pane.copy` |
| Save | Issejvja | `ai.settings.save` |
| Insert | Daħħal | `ai.write.insert` |
| Close | Agħlaq | `backstage.close` |
| New | Ġdid | `backstage.new` |
| Open… | Iftaħ… | `backstage.open` |
| Options… | Għażliet… | `backstage.options` |
| Print | Ipprintja | `backstage.print` |
| Save As… | Issejvja Bħala… | `backstage.saveAs` |
| Cut | Aqta' | `cmd.cut` |
| Delete | Ħassar | `cmd.delete` |
| Find | Sib | `cmd.find` |
| Paste | Waħħal | `cmd.paste` |
| Redo | Erġa' agħmel | `cmd.redo` |
| Replace… | Ibdel… | `cmd.replaceDots` |
| Undo | Annulla | `cmd.undo` |
| Size | Daqs | `conn.browser.colSize` |
| Rename | Semmi mill-ġdid | `conn.browser.rename` |
| Bold | Grassett | `fmt.bold` |
| Borders | Bordi | `fmt.borders` |
| Colors | Kuluri | `fmt.colors` |
| Italic | Korsiv | `fmt.italic` |
| Strikethrough | Strike through | `fmt.strike` |
| Underline | Sottolinja | `fmt.underline` |
| Zoom | Zoom | `group.zoom` |
| Layout | Tqassim | `print.layoutSection` |
| Margins | Marġni | `print.margins` |
| Normal | Normali | `print.margins.normal` |
| Orientation | Orjentazzjoni | `print.orientation` |
| Format | Format | `sc.format` |
| Remove Arrows | Neħħi l-Vleġeġ | `calc.audit.removeArrows` |
| Show Formulas | Uri l-Formuli | `calc.audit.showFormulas` |
| Trace Dependents | Itraċċa d-Dipendenti | `calc.audit.traceDependents` |
| Trace Precedents | Itraċċa l-Preċedenti | `calc.audit.tracePrecedents` |
| Breaks | Qasmiet | `calc.breaks` |
| Fill | Mili | `calc.cf.barFill` |
| Clear | Naddaf | `calc.cf.clearFormat` |
| Shapes | Forom | `calc.cf.iconGroup.shapes` |
| Conditional Formatting | Formattjar Kondizzjonali | `calc.cf.menu` |
| Gridlines | Linji tal-Griglia | `calc.chart.ae.gridlines` |
| Chart | Grafiku | `calc.chart.chart` |
| Center | Ċentru | `calc.chart.pos.center` |
| Recommended Charts | Grafiki Rakkomandati | `calc.chart.recommended` |
| Shape Fill | Mili tal-Forma | `calc.chart.shapeFill` |
| Shape Outline | Kontorn tal-Forma | `calc.chart.shapeOutline` |
| New Comment | Kumment Ġdid | `calc.comments.new` |
| Comment | Kumment | `calc.comments.textLabel` |
| Consolidate | Ikkonsolida | `calc.consolidate.button` |
| Delete Cells… | Ħassar Ċelloli… | `calc.deleteCellsDots` |
| Remove Duplicates | Neħħi d-Duplikati | `calc.dup.button` |
| Columns | Kolonni | `calc.dup.columns` |
| Select All | Agħżel Kollox | `calc.dup.selectAll` |
| Data Validation | Validazzjoni tad-Dejta | `calc.dv.button` |
| Filter | Filtru | `calc.filter` |
| Font Color | Kulur tat-Tipa | `calc.filter.byFontColor` |
| Flash Fill | Mili Flash | `calc.flash.button` |
| Effects | Effetti | `calc.fmt.effects` |
| Justify | Iġġustifika | `calc.fmt.h.justify` |
| Indent | Indentazzjoni | `calc.fmt.indent` |
| Preview | Previżjoni | `calc.fmt.preview` |
| Subscript | Subskript | `calc.fmt.subscript` |
| Superscript | Superskript | `calc.fmt.superscript` |
| Symbol | Simbolu | `calc.fmt.symbol` |
| AutoSum | AutoSomma | `calc.fn.autoSum` |
| Insert Function | Daħħal Funzjoni | `calc.fn.insert` |
| Format Painter | Pinzell tal-Format | `calc.formatPainter` |
| Freeze Panes | Iffriża l-Pannelli | `calc.freezePanes` |
| Goal Seek… | Fittex l-Għan… | `calc.goal.dots` |
| What-If Analysis | Analiżi X'Jiġri Jekk | `calc.goal.whatIf` |
| Hide | Aħbi | `calc.hide` |
| Insert Cells… | Daħħal Ċelloli… | `calc.insertCellsDots` |
| Link | Ħolqa | `calc.link.button` |
| Merge Cells | Għaqqad iċ-Ċelloli | `calc.mergeCells` |
| Merge & Center | Għaqqad u Ċentra | `calc.mergeCenter` |
| Move or Copy… | Mexxi jew Ikkopja… | `calc.moveCopy.dots` |
| Define Name | Iddefinixxi Isem | `calc.names.define` |
| Name Manager | Maniġer tal-Ismijiet | `calc.names.manager` |
| Group | Igruppa | `calc.outline.group` |
| Ungroup | Neħħi l-Grupp | `calc.outline.ungroup` |
| Page Setup | Twaqqif tal-Paġna | `calc.pageSetup` |
| Pictures | Stampi | `calc.picture.button` |
| PivotTable | PivotTable | `calc.pivot.pivotTable` |
| Refresh All | Aġġorna Kollox | `calc.pivot.refreshAll` |
| Styles | Stili | `calc.pivot.stylesGallery` |
| Print Area | Żona tal-Istampar | `calc.printArea` |
| Print Titles | Titli tal-Istampar | `calc.printTitles` |
| Sort | Ordna | `calc.protect.allow.sort` |
| Protect Workbook | Ipproteġi l-Ktieb tax-Xogħol | `calc.protect.bookDots` |
| Protect Sheet… | Ipproteġi l-Folja… | `calc.protect.sheetDots` |
| Paste Special… | Waħħal Speċjali… | `calc.ps.dots` |
| Error Checking | Kontroll tal-Iżbalji | `calc.err.dialogTitle` |
| Previous | Preċedenti | `calc.err.previous` |
| Next | Li jmiss | `calc.err.next` |
| Evaluate Formula | Evalwa l-Formula | `calc.eval.title` |
| Watch Window | Tieqa tal-Ħarsien | `calc.watch.title` |
| Calculate Now | Ikkalkula Issa | `calc.calc.now` |
| Sort & Filter | Ordna u Iffiltra | `calc.sortFilter` |
| Subtotal | Subtotal | `calc.subtotal.button` |
| Properties | Proprjetajiet | `calc.table.properties` |
| Table | Tabella | `calc.table.table` |
| Unhide | Uri | `calc.unhide` |
| Text to Columns | Test għal Kolonni | `calc.wizard.ttcButton` |
| Align Left | Alinja fuq ix-Xellug | `write.alignObj.left` |
| Align Right | Alinja fuq il-Lemin | `write.alignObj.right` |
| Align | Alinja | `write.alignObjects` |
| Bookmark | Bookmark | `write.bookmark.button` |
| Insert Caption | Daħħal Didaskalija | `write.caption.button` |
| Equation | Ekwazzjoni | `write.caption.equation` |
| Position | Pożizzjoni | `write.caption.position` |
| Crop | Aqta' | `write.crop` |
| Spacing | Spazjar | `write.font.spacing` |
| Bring Forward | Ersaq 'l Quddiem | `write.order.bringForward` |
| Bring to Front | Ersaq quddiem kollox | `write.order.bringToFront` |
| Send Backward | Ibgħat 'l Wara | `write.order.sendBackward` |
| Send to Back | Ibgħat wara kollox | `write.order.sendToBack` |
| Picture | Stampa | `write.picture` |
| Section | Taqsima | `write.reveal.section` |
| Rotate | Dawwar | `write.rotate` |
| Ruler | Riga | `write.ruler` |
| Selection Pane | Pannell tal-Għażla | `write.selectionPane` |
| Spelling | Ortografija | `write.spelling` |
| Split Cells | Aqsam iċ-Ċelloli | `write.splitCells` |
| Hyperlink | Ħolqa | `write.styleName.hyperlink` |
| Numbering… | Numerazzjoni… | `write.styles.format.numbering` |
| Text Box | Kaxxa tat-Test | `write.textBox` |
| Wrap Text | Mgeżwir tat-Test | `write.wrapText` |
| Cross-reference | Referenza inkroċjata | `write.xref.button` |
| Footnote | Nota ta' qiegħ il-paġna | `write.xref.footnote` |
| Reset | Erġa' ssettja | `write.notes.sep.reset` |
| Format Background | Iffurmatja l-Isfond | `show.bg.format` |
| Background Styles | Stili tal-Isfond | `show.bg.styles` |
| Fonts | Tipi | `show.design.fonts` |
| Themes | Temi | `show.design.themes` |
| Header & Footer… | Header u Footer… | `show.hf.titleDots` |
| Slide Master | Master tas-Slajds | `show.master.tab` |
| Slide Size | Daqs tas-Slajd | `show.size.customTitle` |
| Set Up Slide Show | Issettja l-Preżentazzjoni | `show.setup.titleDots` |
| Guides | Gwidi | `show.view.guides` |
| Notes Page | Paġna tan-Noti | `show.view.notesPage` |
| Outline View | Veduta tal-Kontorn | `show.view.outline` |
| Reading View | Veduta tal-Qari | `show.view.reading` |
| Slide Sorter | Ordnatur tas-Slajds | `show.view.sorter` |
| Edit Points | Editja l-Punti | `show.editPoints` |
| Fill Color | Kulur tal-Mili | `show.fx.fillColor` |
| Animation Painter | Pinzell tal-Animazzjoni | `show.animPainter` |
| From Current Slide… | Mis-Slajd Attwali… | `show.recordFromCurrent` |
| From Beginning… | Mill-Bidu… | `show.recordFromStart` |

## Dialog buttons and messages
| English | Office term | Note |
| --- | --- | --- |
| OK | OK | |
| Cancel | Ikkanċella | |
| Apply | Applika | |
| Close | Agħlaq | |
| Yes / No | Iva / Le | |
| Don't Save | Tissejvjax | the unsaved-changes prompt |
| Browse… | Ibbrawżja… | |
| Reset | Erġa' ssettja | |
| Insert / Delete | Daħħal / Ħassar | |
| Back / Next / Finish | Lura / Li jmiss / Spiċċa | wizards |
| Recent | Reċenti | backstage |
| Untitled | Mingħajr Titlu | default document name |
| Saved / Saving… / Unsaved changes | Issejvjat / Qed jissejvja… / Bidliet mhux issejvjati | status bar |

## File types
| English | Office term | Note |
| --- | --- | --- |
| Excel Workbook | Ktieb tax-xogħol tal-Excel | `.xlsx`, the desktop dialog filter name |
| Word Document | Dokument tal-Word | `.docx` |
| PowerPoint Presentation | Preżentazzjoni tal-PowerPoint | `.pptx` |
| Excel Template / Word Template / PowerPoint Template | Mudell tal-Excel / Word / PowerPoint | `.xltx` / `.dotx` / `.potx` |
| CSV (Comma delimited) | CSV (delimitat bil-virgola) | Calc |
| Text Files | Fajls tat-Test | |
| PDF | PDF | |
| Office Theme | Tema ta' Office | `.thmx` |
| All Files | Il-Fajls Kollha | |

## Show effects and transitions
Animation effects (`show.fx.*`) and slide transitions (`show.trans.*`), named as in the PowerPoint localisation where it exists (P9-LR5).

| English | Term | Key |
| --- | --- | --- |
| Appear | Dehra | `show.fx.appear` |
| Disappear | Għajbien | `show.fx.disappear` |
| Fade | Tbaxxija | `show.fx.fade` |
| Fly In | Dħul bit-Titjir | `show.fx.flyIn` |
| Fly Out | Ħruġ bit-Titjir | `show.fx.flyOut` |
| Grow/Shrink | Kabbar/Ċekken | `show.fx.growShrink` |
| Spin | Dawra | `show.fx.spin` |
| Wipe | Tindif | `show.fx.wipe` |
| Zoom | Zoom | `show.fx.zoom` |
| Cover | Għatti | `show.trans.cover` |
| Cut | Aqta' | `show.trans.cut` |
| Fade | Tbaxxija | `show.trans.fade` |
| None | L-ebda | `show.trans.none` |
| Push | Imbotta | `show.trans.push` |
| Split | Aqsam | `show.trans.split` |
| Wipe | Tindif | `show.trans.wipe` |
| Zoom | Zoom | `show.trans.zoom` |
| Morph | Morph | `show.trans.morph` |
| Reveal | Żvela | `show.trans.reveal` |
| Shred | Frak | `show.trans.shred` |
| Fall Over | Waqgħa | `show.trans.fallOver` |
| Drape | Purtiera | `show.trans.drape` |
| Curtains | Purtieri | `show.trans.curtains` |
| Wind | Riħ | `show.trans.wind` |
| Prestige | Prestiġju | `show.trans.prestige` |
| Fracture | Ksur | `show.trans.fracture` |
| Crush | Tgħaffiġ | `show.trans.crush` |
| Peel Off | Tqaxxir | `show.trans.peelOff` |
| Page Curl | Tidwir tal-Paġna | `show.trans.pageCurl` |
| Airplane | Ajruplan | `show.trans.airplane` |
| Origami | Origami | `show.trans.origami` |
| Honeycomb | Xehda | `show.trans.honeycomb` |
| Glitter | Glitter | `show.trans.glitter` |
| Vortex | Vortiċi | `show.trans.vortex` |
| Ripple | Mewġ | `show.trans.ripple` |
| Switch | Bdil | `show.trans.switch` |
| Flip | Aqleb | `show.trans.flip` |
| Gallery | Galleria | `show.trans.gallery` |
| Cube | Kubu | `show.trans.cube` |
| Doors | Bibien | `show.trans.doors` |
| Box | Kaxxa | `show.trans.box` |
| Float In | Għum 'l Ġewwa | `show.fx.float` |
| Float Out | Għum 'l Barra | `show.fx.floatOut` |
| Split | Qasma | `show.fx.split` |
| Shape | Forma | `show.fx.shape` |
| Circle | Ċirku | `show.fx.circle` |
| Box | Kaxxa | `show.fx.box` |
| Diamond | Djamant | `show.fx.diamond` |
| Plus | Plus | `show.fx.plus` |
| Wheel | Rota | `show.fx.wheel` |
| Random Bars | Bars Każwali | `show.fx.randomBars` |
| Grow & Turn | Kabbar u Dawwar | `show.fx.growTurn` |
| Shrink & Turn | Ċekken u Dawwar | `show.fx.shrinkTurn` |
| Swivel | Dawran | `show.fx.swivel` |
| Bounce | Qbiż | `show.fx.bounce` |
| Pulse | Polz | `show.fx.pulse` |
| Color Pulse | Polz tal-Kulur | `show.fx.colorPulse` |
| Teeter | Tixxengil | `show.fx.teeter` |
| Desaturate | Neħħi s-Saturazzjoni | `show.fx.desaturate` |
| Darken | Dallam | `show.fx.darken` |
| Lighten | Illumina | `show.fx.lighten` |
| Transparency | Trasparenza | `show.fx.transparency` |
| Object Color | Kulur tal-Oġġett | `show.fx.objectColor` |
| Line Color | Kulur tal-Linja | `show.fx.lineColor` |
| Fill Color | Kulur tal-Mili | `show.fx.fillColor` |
| Brush Color | Kulur tal-Pinzell | `show.fx.brushColor` |
| Font Color | Kulur tat-Tipa | `show.fx.fontColor` |
| Underline | Sottolinja | `show.fx.underline` |
| Bold Flash | Flash Grassett | `show.fx.boldFlash` |
| Bold Reveal | Wiri Grassett | `show.fx.boldReveal` |
| Wave | Mewġa | `show.fx.wave` |
| Lines | Linji | `show.fx.pathLines` |
| Arcs | Arkati | `show.fx.pathArcs` |
| Turns | Dawriet | `show.fx.pathTurns` |
| Shapes | Forom | `show.fx.pathShapes` |
| Loops | Linji Ċirkolari | `show.fx.pathLoops` |
| Custom Path | Mogħdija Personalizzata | `show.fx.pathCustom` |
| Play | Ħaddem | `show.fx.mediaPlay` |
| Pause | Pawża | `show.fx.mediaPause` |
| Stop | Waqqaf | `show.fx.mediaStop` |

## More terms
| English | Term | Note |
| --- | --- | --- |
| Slide | slajd | PowerPoint term, everywhere in Show |
| Presentation | preżentazzjoni | |
| Slide master / Layout | Master tas-slajds / Tqassim | |
| Speaker notes | noti tal-kelliem | |
| Worksheet / Workbook | Folja tax-xogħol / Ktieb tax-xogħol | |
| Cell / Row / Column | Ċellula / Ringiela / Kolonna | |
| Formula / Function | Formula / Funzjoni | |
| PivotTable | PivotTable | not localised |
| Conditional Formatting | Formattjar Kondizzjonali | |
| Data Bars / Color Scales / Icon Sets | Strixxi tad-Dejta / Skali tal-Kuluri / Settijiet ta' Ikoni | |
| Sparkline / Slicer | Sparkline / Slicer | not localised |
| Flash Fill | Mili Flash | |
| Goal Seek | Fittex l-Għan | |
| Data Validation | Validazzjoni tad-Dejta | |
| Comment / Note | Kumment / Nota | |
| Footnote / Endnote | Nota ta' qiegħ il-paġna / Nota tat-tmiem | |
| Header / Footer | Header / Footer | loan words |
| Bookmark | Bookmark | |
| Hyperlink | Ħolqa | |
| Table of contents | Werrej | |
| Caption | Didaskalija | |
| Cross-reference | Referenza inkroċjata | |
| Stacked (charts) | Impilat | |
| Wrap text | Mgeżwir tat-test | |
| Margins / Indent | Marġni / Indentazzjoni | |
| Border / Shading / Fill | Bordura / Ombrejjar / Mili | |
| Provider / API key / Model / Token | Fornitur / Ċavetta tal-API / Mudell / Token | AI assistant |
| Connection / Server | Konnessjoni / Server | WebDAV |
| Autosave | Sejvjar awtomatiku | |
| Recovered document | Dokument irkuprat | |
| Report a problem | Irrapporta problema | |
| Privacy | Privatezza | |

## Doubts (after the P9-LR5 review)
- Office's exact Maltese wording of "Undo" (Annulla), "Paste" (Waħħal), "Wrap Text" (Mgeżwir tat-test), "Sparkline", "Slicer", "Outline" (Skeda/Kontorn) and the PowerPoint transition and effect names (translated descriptively) was not verified in a running Maltese Office.
- Plural forms (`two`, `few`: plural noun; `many`, `other`: singular noun) follow the standard counting rules and were checked in P9-LR5 (the number before the noun in `one`).
- Transition names corrected by P9-LR5 (nouns, not verb forms or wrong words): Fall Over = "Waqgħa" (was "Waqa'"), Peel Off = "Tqaxxir" (was "Qala'"), Honeycomb = "Xehda" (was "Għasel" = honey), Switch = "Bdil", Page Curl = "Tidwir tal-Paġna"; effects Grow/Shrink = "Kabbar/Ċekken", Teeter = "Tixxengil". Still unverified against a Maltese PowerPoint.
