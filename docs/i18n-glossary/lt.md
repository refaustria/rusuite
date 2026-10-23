# Glossary: Lithuanian (`lt`)

Source: the Lithuanian localisation of Microsoft Office (Word, Excel, PowerPoint) and its terminology. Translator: P9-L9. Reviewer: P9-LR5 (2026-10-18).

## Register
- Address: informal singular "tu / tave / tau / tavo", imperatives in the 2nd-person singular ("Pasirink", "Spustelėk", "Įvesk", "Atidaryk", "Patikrink"); never "jūs / jūsų / jums" or the plural-polite "-ite/-kite" imperatives ("Pasirinkite", "Spustelėkite"). Purpose clauses use "Kad … -tum" ("Kad tęstum, įvesk …") instead of the gender-marked "Norėdamas/Norėdama".
- Buttons and menu commands: infinitive ("Įrašyti", "Atidaryti", "Įterpti lentelę"), as Lithuanian Office does; messages to the user are in the singular imperative or a neutral statement. Messages about a missing connection avoid gender-marked participles ("Nėra ryšio su internetu" instead of "Esi neprisijungęs").
- Ellipsis "…" for commands that open a dialog, as in English.
- Typography: quotation marks „…“ for quoted names and brand names ("„Windows“", "„Excel“"), decimal comma, "cm" / "pt" for units, "col." for inches, "%" with a no-break-free space before it ("25 %").
- Keyboard key names in shortcut texts (packages/ui-shared/src/i18n/keyNames.ts): Lithuanian Office keeps the English names (Ctrl, Shift, Alt, Delete, Enter), so no `lt` entry was added.
- Plural categories: `one / few / many / other` – one: 1, 21, 31 … (not 11); few: 2–9, 22–29 …; many: fractions; other: 0, 10–20, 30 …. Count messages put the noun in the matching form: "{count} puslapis / puslapiai / puslapio / puslapių". Where a placeholder could be any number and no plural group exists in English, the message is built as "Įspėjimai ({count}): …" or "lygių: {n}" so no declension is needed. Because `one` also covers 21, 31 …, every `.one` text keeps `{count}` ("{count} atkurtas dokumentas"); "Select all {count}" drops "all" in `.one` ("Žymėti {count} atvejį").
- Review (P9-LR5): no gender-marked forms addressed to the user – also not "tavo paties" (masculine "your own"): "tavo nuosavas / nuosava" agrees with the noun ("tavo nuosavame įrenginyje"); passive impersonal instead of participles ("slaptažodžio bus klausiama", not "būsi klausiamas"; "proporcijos išlaikomos", not "išlaikydamas"). Inch presets show the German cm values ("Siauros (1,27 cm)"). Ordinal-first word order in list presets ("1 skyrius", "I straipsnis / 1.01 skirsnis").

## Ribbon tabs
| English | Office term | Note |
| --- | --- | --- |
| File | Failas | |
| Home | Pagrindinis | |
| Insert | Įterpimas | |
| Draw | Piešimas | no Draw tab in Rusuite yet |
| Design | Dizainas | |
| Layout (Write: Layout, Calc: Page Layout) | Maketas / Puslapio maketas | Calc: "Puslapio maketas" |
| References | Nuorodos | Write |
| Mailings | Siuntimas | Write |
| Review | Peržiūra | |
| View | Rodymas | |
| Formulas | Formulės | Calc |
| Data | Duomenys | Calc |
| Transitions | Perėjimai | Show |
| Animations | Animacijos | Show |
| Slide Show | Skaidrių demonstravimas | Show |
| Help | Žinynas | |
| Picture / Table / Chart / Drawing Tools (contextual) | Paveikslėlio / Lentelės / Diagramos / Piešimo įrankiai | |

## Ribbon groups
| English | Office term | Note |
| --- | --- | --- |
| Clipboard | Mainų sritis | |
| Font | Šriftas | |
| Paragraph | Pastraipa | |
| Styles | Stiliai | |
| Editing | Redagavimas | |
| Number | Skaičius | Calc |
| Alignment | Lygiavimas | Calc |
| Cells | Langeliai | Calc |
| Slides | Skaidrės | Show |
| Drawing | Piešimas | Show |
| Zoom | Mastelis | |
| Show (View › Show) | Rodyti | |
| Language | Kalba | the picker; label "Kalba / Language" |

## Common commands
| English | Office term | Note |
| --- | --- | --- |
| New | Naujas | |
| Open… | Atidaryti… | |
| Save | Įrašyti | |
| Save As… | Įrašyti kaip… | |
| Print | Spausdinti | |
| Export PDF… | Eksportuoti į PDF… | |
| Close | Uždaryti | |
| Options… | Parinktys… | |
| Undo / Redo | Anuliuoti / Perdaryti | |
| Cut / Copy / Paste | Iškirpti / Kopijuoti / Įklijuoti | |
| Paste Special… | Specialusis įklijavimas… | |
| Format Painter | Formato kopijavimas | |
| Find / Replace… / Go To… | Rasti / Pakeisti… / Eiti į… | |
| Select All | Žymėti viską | |
| Bold / Italic / Underline / Strikethrough | Pusjuodis / Kursyvas / Pabraukimas / Perbraukimas | |
| Font Color / Highlight / Fill Color | Šrifto spalva / Teksto paryškinimo spalva / Užpildo spalva | |
| Insert Picture / Table / Chart / Shape / Text Box | Įterpti paveikslėlį / lentelę / diagramą / figūrą / teksto lauką | |
| Bring to Front / Send to Back | Perkelti į priekį / Perkelti į pačią apačią | |
| Group / Ungroup | Grupuoti / Išgrupuoti | |
| Sort / Filter | Rikiuoti / Filtras | Calc |
| Insert Function | Įterpti funkciją | Calc |
| New Slide | Nauja skaidrė | Show |
| From Beginning / From Current Slide | Nuo pradžių / Nuo dabartinės skaidrės | Show |
| Track Changes / Comments | Sekimas / Komentarai | Write |

## Commands as used in the catalogs
The terms the catalogs use after the review (P9-LR5), one row per English command; the key shows where.

| English | Term | Key |
| --- | --- | --- |
| Copy | Kopijuoti | `ai.pane.copy` |
| Save | Įrašyti | `ai.settings.save` |
| Insert | Įterpti | `ai.write.insert` |
| Close | Uždaryti | `backstage.close` |
| New | Naujas | `backstage.new` |
| Open… | Atidaryti… | `backstage.open` |
| Options… | Parinktys… | `backstage.options` |
| Print | Spausdinti | `backstage.print` |
| Save As… | Įrašyti kaip… | `backstage.saveAs` |
| Cut | Iškirpti | `cmd.cut` |
| Delete | Naikinti | `cmd.delete` |
| Find | Rasti | `cmd.find` |
| Paste | Įklijuoti | `cmd.paste` |
| Redo | Perdaryti | `cmd.redo` |
| Replace… | Pakeisti… | `cmd.replaceDots` |
| Undo | Anuliuoti | `cmd.undo` |
| Size | Dydis | `conn.browser.colSize` |
| Rename | Pervardyti | `conn.browser.rename` |
| Bold | Pusjuodis | `fmt.bold` |
| Borders | Kraštinės | `fmt.borders` |
| Colors | Spalvos | `fmt.colors` |
| Italic | Kursyvas | `fmt.italic` |
| Strikethrough | Perbraukimas | `fmt.strike` |
| Underline | Pabraukimas | `fmt.underline` |
| Zoom | Mastelis | `group.zoom` |
| Layout | Maketas | `print.layoutSection` |
| Margins | Paraštės | `print.margins` |
| Normal | Įprastos | `print.margins.normal` |
| Orientation | Padėtis | `print.orientation` |
| Format | Formatas | `sc.format` |
| Remove Arrows | Šalinti rodykles | `calc.audit.removeArrows` |
| Show Formulas | Rodyti formules | `calc.audit.showFormulas` |
| Trace Dependents | Sekti priklausomuosius | `calc.audit.traceDependents` |
| Trace Precedents | Sekti pirmtakus | `calc.audit.tracePrecedents` |
| Breaks | Lūžiai | `calc.breaks` |
| Fill | Užpildas | `calc.cf.barFill` |
| Clear | Valyti | `calc.cf.clearFormat` |
| Shapes | Figūros | `calc.cf.iconGroup.shapes` |
| Conditional Formatting | Sąlyginis formatavimas | `calc.cf.menu` |
| Gridlines | Tinklelis | `calc.chart.ae.gridlines` |
| Chart | Diagrama | `calc.chart.chart` |
| Center | Centre | `calc.chart.pos.center` |
| Recommended Charts | Rekomenduojamos diagramos | `calc.chart.recommended` |
| Shape Fill | Figūros užpildas | `calc.chart.shapeFill` |
| Shape Outline | Figūros kontūras | `calc.chart.shapeOutline` |
| New Comment | Naujas komentaras | `calc.comments.new` |
| Comment | Komentaras | `calc.comments.textLabel` |
| Consolidate | Konsoliduoti | `calc.consolidate.button` |
| Delete Cells… | Naikinti langelius… | `calc.deleteCellsDots` |
| Remove Duplicates | Šalinti dublikatus | `calc.dup.button` |
| Columns | Stulpeliai | `calc.dup.columns` |
| Select All | Žymėti viską | `calc.dup.selectAll` |
| Data Validation | Duomenų tikrinimas | `calc.dv.button` |
| Filter | Filtras | `calc.filter` |
| Font Color | Šrifto spalva | `calc.filter.byFontColor` |
| Flash Fill | Akimirksniu užpildymas | `calc.flash.button` |
| Effects | Efektai | `calc.fmt.effects` |
| Justify | Abipusis | `calc.fmt.h.justify` |
| Indent | Įtrauka | `calc.fmt.indent` |
| Preview | Peržiūra | `calc.fmt.preview` |
| Subscript | Apatinis indeksas | `calc.fmt.subscript` |
| Superscript | Viršutinis indeksas | `calc.fmt.superscript` |
| Symbol | Simbolis | `calc.fmt.symbol` |
| AutoSum | Automatinė suma | `calc.fn.autoSum` |
| Insert Function | Įterpti funkciją | `calc.fn.insert` |
| Format Painter | Formato kopijavimas | `calc.formatPainter` |
| Freeze Panes | Užfiksuoti sritis | `calc.freezePanes` |
| Goal Seek… | Tikslo siekis… | `calc.goal.dots` |
| What-If Analysis | Jei–tai analizė | `calc.goal.whatIf` |
| Hide | Slėpti | `calc.hide` |
| Insert Cells… | Įterpti langelius… | `calc.insertCellsDots` |
| Link | Saitas | `calc.link.button` |
| Merge Cells | Sujungti langelius | `calc.mergeCells` |
| Merge & Center | Sujungti ir centruoti | `calc.mergeCenter` |
| Move or Copy… | Perkelti arba kopijuoti… | `calc.moveCopy.dots` |
| Define Name | Apibrėžti vardą | `calc.names.define` |
| Name Manager | Vardų tvarkyklė | `calc.names.manager` |
| Group | Grupuoti | `calc.outline.group` |
| Ungroup | Išgrupuoti | `calc.outline.ungroup` |
| Page Setup | Puslapio sąranka | `calc.pageSetup` |
| Pictures | Paveikslėliai | `calc.picture.button` |
| PivotTable | Suvestinė | `calc.pivot.pivotTable` |
| Refresh All | Atnaujinti viską | `calc.pivot.refreshAll` |
| Styles | Stiliai | `calc.pivot.stylesGallery` |
| Print Area | Spausdinimo sritis | `calc.printArea` |
| Print Titles | Spausdinti pavadinimus | `calc.printTitles` |
| Sort | Rikiuoti | `calc.protect.allow.sort` |
| Protect Workbook | Apsaugoti sąsiuvinį | `calc.protect.bookDots` |
| Protect Sheet… | Apsaugoti lapą… | `calc.protect.sheetDots` |
| Paste Special… | Specialusis įklijavimas… | `calc.ps.dots` |
| Error Checking | Klaidų tikrinimas | `calc.err.dialogTitle` |
| Previous | Ankstesnis | `calc.err.previous` |
| Next | Kitas | `calc.err.next` |
| Evaluate Formula | Įvertinti formulę | `calc.eval.title` |
| Watch Window | Stebėjimo langas | `calc.watch.title` |
| Calculate Now | Skaičiuoti dabar | `calc.calc.now` |
| Sort & Filter | Rikiavimas ir filtravimas | `calc.sortFilter` |
| Subtotal | Tarpinė suma | `calc.subtotal.button` |
| Properties | Savybės | `calc.table.properties` |
| Table | Lentelė | `calc.table.table` |
| Unhide | Rodyti | `calc.unhide` |
| Text to Columns | Tekstas į stulpelius | `calc.wizard.ttcButton` |
| Align Left | Lygiuoti kairėje | `write.alignObj.left` |
| Align Right | Lygiuoti dešinėje | `write.alignObj.right` |
| Align | Lygiuoti | `write.alignObjects` |
| Bookmark | Žymė | `write.bookmark.button` |
| Insert Caption | Įterpti užrašą | `write.caption.button` |
| Equation | Lygtis | `write.caption.equation` |
| Position | Padėtis | `write.caption.position` |
| Crop | Apkarpyti | `write.crop` |
| Spacing | Intervalas | `write.font.spacing` |
| Bring Forward | Perkelti pirmyn | `write.order.bringForward` |
| Bring to Front | Perkelti į priekį | `write.order.bringToFront` |
| Send Backward | Perkelti atgal | `write.order.sendBackward` |
| Send to Back | Perkelti į pačią apačią | `write.order.sendToBack` |
| Picture | Paveikslėlis | `write.picture` |
| Section | Skirsnis | `write.reveal.section` |
| Rotate | Sukti | `write.rotate` |
| Ruler | Liniuotė | `write.ruler` |
| Selection Pane | Žymėjimo sritis | `write.selectionPane` |
| Spelling | Rašyba | `write.spelling` |
| Split Cells | Skaidyti langelius | `write.splitCells` |
| Hyperlink | Hipersaitas | `write.styleName.hyperlink` |
| Numbering… | Numeravimas… | `write.styles.format.numbering` |
| Text Box | Teksto laukas | `write.textBox` |
| Wrap Text | Vynioti tekstą | `write.wrapText` |
| Cross-reference | Kryžminė nuoroda | `write.xref.button` |
| Footnote | Išnaša | `write.xref.footnote` |
| Reset | Atkurti | `write.notes.sep.reset` |
| Format Background | Formatuoti foną | `show.bg.format` |
| Background Styles | Fono stiliai | `show.bg.styles` |
| Fonts | Šriftai | `show.design.fonts` |
| Themes | Temos | `show.design.themes` |
| Header & Footer… | Antraštė ir poraštė… | `show.hf.titleDots` |
| Slide Master | Skaidrių ruošinys | `show.master.tab` |
| Slide Size | Skaidrės dydis | `show.size.customTitle` |
| Set Up Slide Show | Demonstravimo sąranka | `show.setup.titleDots` |
| Guides | Kreiptuvai | `show.view.guides` |
| Notes Page | Pastabų puslapis | `show.view.notesPage` |
| Outline View | Struktūros rodinys | `show.view.outline` |
| Reading View | Skaitymo rodinys | `show.view.reading` |
| Slide Sorter | Skaidrių rūšiuoklis | `show.view.sorter` |
| Edit Points | Redaguoti taškus | `show.editPoints` |
| Fill Color | Užpildo spalva | `show.fx.fillColor` |
| Animation Painter | Animacijos kopijavimas | `show.animPainter` |
| From Current Slide… | Nuo dabartinės skaidrės… | `show.recordFromCurrent` |
| From Beginning… | Nuo pradžios… | `show.recordFromStart` |

## Dialog buttons and messages
| English | Office term | Note |
| --- | --- | --- |
| OK | Gerai | |
| Cancel | Atšaukti | |
| Apply | Taikyti | |
| Close | Uždaryti | |
| Yes / No | Taip / Ne | |
| Don't Save | Neįrašyti | the unsaved-changes prompt |
| Browse… | Naršyti… | |
| Reset | Atkurti | |
| Insert / Delete | Įterpti / Naikinti | |
| Back / Next / Finish | Atgal / Kitas / Baigti | wizards |
| Recent | Neseniai naudoti | backstage |
| Untitled | Be pavadinimo | default document name |
| Saved / Saving… / Unsaved changes | Įrašyta / Įrašoma… / Neįrašyti pakeitimai | status bar |

## File types
| English | Office term | Note |
| --- | --- | --- |
| Excel Workbook | „Excel“ sąsiuvinis | `.xlsx`, the desktop dialog filter name |
| Word Document | „Word“ dokumentas | `.docx` |
| PowerPoint Presentation | „PowerPoint“ pateiktis | `.pptx` |
| Excel Template / Word Template / PowerPoint Template | „Excel“ / „Word“ / „PowerPoint“ šablonas | `.xltx` / `.dotx` / `.potx` |
| CSV (Comma delimited) | CSV (atskirta kableliais) | Calc |
| Text Files | Tekstiniai failai | |
| PDF | PDF | |
| Office Theme | „Office“ tema | `.thmx` |
| All Files | Visi failai | |

## Show effects and transitions
Animation effects (`show.fx.*`) and slide transitions (`show.trans.*`), named as in the PowerPoint localisation where it exists (P9-LR5).

| English | Term | Key |
| --- | --- | --- |
| Appear | Atsiradimas | `show.fx.appear` |
| Disappear | Išnykimas | `show.fx.disappear` |
| Fade | Išblukimas | `show.fx.fade` |
| Fly In | Įskridimas | `show.fx.flyIn` |
| Fly Out | Išskridimas | `show.fx.flyOut` |
| Grow/Shrink | Didėjimas / mažėjimas | `show.fx.growShrink` |
| Spin | Sukimasis | `show.fx.spin` |
| Wipe | Nuvalymas | `show.fx.wipe` |
| Zoom | Didinimas | `show.fx.zoom` |
| Cover | Dengimas | `show.trans.cover` |
| Cut | Iškirpimas | `show.trans.cut` |
| Fade | Išblukimas | `show.trans.fade` |
| None | Nėra | `show.trans.none` |
| Push | Stūmimas | `show.trans.push` |
| Split | Skaidymas | `show.trans.split` |
| Wipe | Nuvalymas | `show.trans.wipe` |
| Zoom | Didinimas | `show.trans.zoom` |
| Morph | Transformacija | `show.trans.morph` |
| Reveal | Atidengimas | `show.trans.reveal` |
| Shred | Susmulkinimas | `show.trans.shred` |
| Fall Over | Apvirtimas | `show.trans.fallOver` |
| Drape | Uždanga | `show.trans.drape` |
| Curtains | Užuolaidos | `show.trans.curtains` |
| Wind | Vėjas | `show.trans.wind` |
| Prestige | Prestižas | `show.trans.prestige` |
| Fracture | Skilimas | `show.trans.fracture` |
| Crush | Sutraiškymas | `show.trans.crush` |
| Peel Off | Nulupimas | `show.trans.peelOff` |
| Page Curl | Puslapio užlenkimas | `show.trans.pageCurl` |
| Airplane | Lėktuvas | `show.trans.airplane` |
| Origami | Origamis | `show.trans.origami` |
| Honeycomb | Koriai | `show.trans.honeycomb` |
| Glitter | Blizgučiai | `show.trans.glitter` |
| Vortex | Sūkurys | `show.trans.vortex` |
| Ripple | Bangavimas | `show.trans.ripple` |
| Switch | Perjungimas | `show.trans.switch` |
| Flip | Apvertimas | `show.trans.flip` |
| Gallery | Galerija | `show.trans.gallery` |
| Cube | Kubas | `show.trans.cube` |
| Doors | Durys | `show.trans.doors` |
| Box | Dėžė | `show.trans.box` |
| Float In | Plūduriavimas į vidų | `show.fx.float` |
| Float Out | Plūduriavimas į išorę | `show.fx.floatOut` |
| Split | Skaidymas | `show.fx.split` |
| Shape | Figūra | `show.fx.shape` |
| Circle | Apskritimas | `show.fx.circle` |
| Box | Dėžė | `show.fx.box` |
| Diamond | Rombas | `show.fx.diamond` |
| Plus | Pliusas | `show.fx.plus` |
| Wheel | Ratas | `show.fx.wheel` |
| Random Bars | Atsitiktinės juostos | `show.fx.randomBars` |
| Grow & Turn | Didėjimas ir sukimas | `show.fx.growTurn` |
| Shrink & Turn | Mažėjimas ir sukimas | `show.fx.shrinkTurn` |
| Swivel | Sukimasis aplink ašį | `show.fx.swivel` |
| Bounce | Šokinėjimas | `show.fx.bounce` |
| Pulse | Pulsavimas | `show.fx.pulse` |
| Color Pulse | Spalvos pulsavimas | `show.fx.colorPulse` |
| Teeter | Siūbavimas | `show.fx.teeter` |
| Desaturate | Spalvų blukinimas | `show.fx.desaturate` |
| Darken | Patamsinimas | `show.fx.darken` |
| Lighten | Pašviesinimas | `show.fx.lighten` |
| Transparency | Skaidrumas | `show.fx.transparency` |
| Object Color | Objekto spalva | `show.fx.objectColor` |
| Line Color | Linijos spalva | `show.fx.lineColor` |
| Fill Color | Užpildo spalva | `show.fx.fillColor` |
| Brush Color | Teptuko spalva | `show.fx.brushColor` |
| Font Color | Šrifto spalva | `show.fx.fontColor` |
| Underline | Pabraukimas | `show.fx.underline` |
| Bold Flash | Ryškus blyksnis | `show.fx.boldFlash` |
| Bold Reveal | Ryškus atidengimas | `show.fx.boldReveal` |
| Wave | Banga | `show.fx.wave` |
| Lines | Linijos | `show.fx.pathLines` |
| Arcs | Lankai | `show.fx.pathArcs` |
| Turns | Posūkiai | `show.fx.pathTurns` |
| Shapes | Figūros | `show.fx.pathShapes` |
| Loops | Kilpos | `show.fx.pathLoops` |
| Custom Path | Pasirinktinis kelias | `show.fx.pathCustom` |
| Play | Paleisti | `show.fx.mediaPlay` |
| Pause | Pristabdyti | `show.fx.mediaPause` |
| Stop | Stabdyti | `show.fx.mediaStop` |

## More terms
| English | Office term | Note |
| --- | --- | --- |
| Worksheet / Workbook | Lapas / Sąsiuvinis | Calc |
| PivotTable / PivotChart | Suvestinė / Suvestinės diagrama | Calc |
| Conditional Formatting | Sąlyginis formatavimas | Calc |
| Data Validation | Duomenų tikrinimas | Calc |
| Freeze Panes | Užfiksuoti sritis | Calc |
| Name Manager | Vardų tvarkyklė | Calc |
| Remove Duplicates | Šalinti dublikatus | Calc |
| Flash Fill | Akimirksniu užpildymas | Calc |
| Slicer / Sparkline | Duomenų filtras / Miniatiūrinė diagrama | Calc |
| Goal Seek / What-If Analysis | Tikslo siekis / Jei–tai analizė | Calc |
| Slide / Slide master / Layout | Skaidrė / Skaidrių ruošinys / Maketas | Show |
| Speaker notes / Presenter view | Pranešėjo pastabos / Pranešėjo rodinys | Show |
| Fly In / Fade / Wipe / Appear | Įskridimas / Išblukimas / Nuvalymas / Atsiradimas | Show |
| Morph / Reveal / Shred | Transformacija / Atidengimas / Susmulkinimas | Show transitions |
| Bookmark | Žymė | Write |
| Caption | Užrašas | Write (doubt: Office may say "Antraštė") |
| Footnote / Endnote | Išnaša / Galinė išnaša | Write |
| Cross-reference | Kryžminė nuoroda | Write |
| Header / Footer (page) | Viršutinė antraštė / Apatinė antraštė | Office: "Viršutinė ir apatinė antraštė"; Heading = "Antraštė" |
| Alt text | Alternatyvusis tekstas | |
| Hyperlink | Hipersaitas | |
| Margins | Paraštės | |
| Reasoning (AI setting, reasoning_effort) | Samprotavimas | Settings › AI, actions (P9-LF pass 2) |
| dropped (reader warnings) | pašalintas/a/i/os | `reader.xlsx.*` / `reader.pptx.*`, as in `reader.docx.*` |
| read as (reader warnings) | nuskaitytas/a kaip | reader warnings |
| dangling relationship | nutrūkęs ryšys | reader warnings |
| Custom show (PowerPoint) | Pasirinktinis demonstravimas | `reader.pptx.customShow.*` |
| Pivot cache | suvestinės talpykla | `reader.xlsx.pivotCache.*` |

## Touch, compact layout and PDF export (P10-LF, 2026-10-23)

One term per gesture across the five catalogs (cycle 3.1415: ui-shared compact bars and sheets, the touch UI of Calc/Write/Show, PDF export, the portal's signing texts).

| English | Term | Used in |
| --- | --- | --- |
| tap | bakstelėti („Bakstelėk …“) | `calc.keys.ref`, `calc.stats.next`, `show.touch.tapToPlay` |
| long press | ilgas paspaudimas | (context menu as a sheet; no catalog text yet) |
| pinch | suėmimas pirštais | (zoom; no catalog text yet) |
| swipe | perbraukimas | (no catalog text yet) |
| selection handle | rankenėlė | `write.touch.handleStart` / `handleEnd` |
| bottom sheet | skydelis (ne „lapas“ = worksheet) | `compact.moreSheet`, `compact.closeSheet` (aria labels) |
| fingerprint (GPG) | piršto atspaudas | `portal.dl.signed.linux`, `portal.dl.sums.text` |
| release key | leidimų raktas | `portal.dl.signed.linux`, `portal.dl.sums.text` |
| notarized (Apple) | notarizuota | `portal.dl.signed.macos` |
| More | Daugiau | `compact.more` |
| More commands | Daugiau komandų | `compact.moreSheet` |
| Fill | Užpildyti | `calc.touch.fill` |
| Fill series | Užpildyti seką | `calc.touch.fillSeries` |
| Copy cells | Kopijuoti langelius | `calc.touch.copyCells` |
| Ref | Nuor. | `calc.keys.refShort` |
| Share as PDF… | Bendrinti kaip PDF… | `backstage.sharePdf` |
| Export PDF | Eksportuoti į PDF | `print.exportPdf` |
| Multi-select | Kelių elementų žymėjimas | `show.touch.multiSelect` |
