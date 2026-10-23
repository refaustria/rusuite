# Glossary: Croatian (`hr`)

Source: the Croatian (Hrvatska) localisation of Microsoft Office (Word, Excel, PowerPoint) and its terminology. Translator: P9-L7. Reviewer: P9-LR4 (2026-10-18).

## Register
- Address: informal "ti / te / tvoj", imperatives in the 2nd person singular ("Odaberi", "Unesi", "Klikni", "Provjeri"); never "Vi / Vas / Vam / Vaš" or "-ite" imperatives ("Odaberite"). Office's "Kliknite" becomes "Klikni".
- Gender-neutral wording: past participles and adjectives that show the user's gender ("odabrao", "unio", "konfigurirao", "Kako bi opisao", "Da bi bio siguran") are avoided: passive or impersonal forms instead ("Unesena lozinka", "nisu odabrani", "Kako opisati…", "Da provjeriš…").
- Plural `one` also covers 21, 31, 101 …: keep `{count}` in the `.one` text ("{count} oporavljeni dokument"), never a bare singular.
- Buttons and menu commands: imperative, as Croatian Office does ("Spremi", "Otvori", "Zalijepi"); ribbon group names and dialog titles are nouns ("Međuspremnik", "Oblikovanje ćelija").
- Ellipsis "…" for commands that open a dialog, as in English.
- Quotation marks: „…” (low-high), decimal comma in numbers shown by the UI chrome ("29,7 × 42 cm"); shortcut digits and formula syntax stay as in English.
- Keyboard key names in shortcut texts (packages/ui-shared/src/i18n/keyNames.ts): Ctrl = Ctrl, Shift = Shift, Delete = Delete, Enter = Enter (Croatian Office keeps the English key names; no entry in `KEY_NAMES`).
- Plural categories: `one / few / other` (1 stavka, 2–4 stavke, 5+ stavki; 11–14 → other).
- Slides are "slajd" (PowerPoint hr); "Transitions" = "Prijelazi", "Slide show" = "Prezentacija".

## Ribbon tabs
| English | Office term | Note |
| --- | --- | --- |
| File | Datoteka | |
| Home | Polazno | `tab.home`; the backstage "Home" is "Početna" |
| Insert | Umetanje | |
| Draw | Crtanje | |
| Design | Dizajn | |
| Layout (Write: Layout, Calc: Page Layout) | Raspored / Raspored stranice | Write: "Raspored", Calc: "Raspored stranice" |
| References | Reference | Write |
| Mailings | Slanje pošte | not used (no mailings tab) |
| Review | Pregled | |
| View | Prikaz | |
| Formulas | Formule | Calc |
| Data | Podaci | Calc |
| Transitions | Prijelazi | Show |
| Animations | Animacije | Show |
| Slide Show | Prezentacija | Show |
| Help | Pomoć | |
| Picture / Table / Chart / Drawing Tools (contextual) | Alati za slike / tablice / grafikone / crtanje | |

## Ribbon groups
| English | Office term | Note |
| --- | --- | --- |
| Clipboard | Međuspremnik | |
| Font | Font | |
| Paragraph | Odlomak | |
| Styles | Stilovi | |
| Editing | Uređivanje | |
| Number | Broj | Calc |
| Alignment | Poravnanje | Calc |
| Cells | Ćelije | Calc |
| Slides | Slajdovi | Show |
| Drawing | Crtanje | Show |
| Zoom | Zumiranje | |
| Show (View › Show) | Prikaži | |
| Language | Jezik | the picker; label "Jezik / Language" |

## Common commands
| English | Office term | Note |
| --- | --- | --- |
| New | Novo | |
| Open… | Otvori… | |
| Save | Spremi | |
| Save As… | Spremi kao… | |
| Print | Ispis | |
| Export PDF… | Izvezi PDF… | |
| Close | Zatvori | |
| Options… | Mogućnosti… | |
| Undo / Redo | Poništi / Ponovi | |
| Cut / Copy / Paste | Izreži / Kopiraj / Zalijepi | |
| Paste Special… | Posebno lijepljenje… | |
| Format Painter | Prenositelj oblikovanja | |
| Find / Replace… / Go To… | Traži / Zamijeni… / Idi na… | |
| Select All | Odaberi sve | |
| Bold / Italic / Underline / Strikethrough | Podebljano / Kurziv / Podcrtano / Precrtano | |
| Font Color / Highlight / Fill Color | Boja fonta / Isticanje / Boja ispune | |
| Insert Picture / Table / Chart / Shape / Text Box | Umetni sliku / tablicu / grafikon / oblik / tekstni okvir | |
| Bring to Front / Send to Back | Postavi u prvi plan / Postavi u pozadinu | |
| Group / Ungroup | Grupiraj / Razgrupiraj | |
| Sort / Filter | Sortiraj / Filtar | Calc |
| Insert Function | Umetni funkciju | Calc |
| New Slide | Novi slajd | Show |
| From Beginning / From Current Slide | Od početka / Od trenutnog slajda | Show |
| Track Changes / Comments | Praćenje promjena / Komentari | Write |

## Commands as used in the catalogs
The terms the catalogs use after the review (P9-LR4), one row per English command; the key shows where.

| English | Term | Key |
| --- | --- | --- |
| Copy | Kopiraj | `ai.pane.copy` |
| Save | Spremi | `ai.settings.save` |
| Insert | Umetni | `ai.write.insert` |
| Close | Zatvori | `backstage.close` |
| New | Novo | `backstage.new` |
| Open… | Otvori… | `backstage.open` |
| Options… | Mogućnosti… | `backstage.options` |
| Print | Ispis | `backstage.print` |
| Save As… | Spremi kao… | `backstage.saveAs` |
| Cut | Izreži | `cmd.cut` |
| Delete | Izbriši | `cmd.delete` |
| Find | Traži | `cmd.find` |
| Paste | Zalijepi | `cmd.paste` |
| Redo | Ponovi | `cmd.redo` |
| Replace… | Zamijeni… | `cmd.replaceDots` |
| Undo | Poništi | `cmd.undo` |
| Size | Veličina | `conn.browser.colSize` |
| Rename | Preimenuj | `conn.browser.rename` |
| Bold | Podebljano | `fmt.bold` |
| Borders | Obrubi | `fmt.borders` |
| Colors | Boje | `fmt.colors` |
| Italic | Kurziv | `fmt.italic` |
| Strikethrough | Precrtano | `fmt.strike` |
| Underline | Podcrtano | `fmt.underline` |
| Zoom | Zumiranje | `group.zoom` |
| Layout | Raspored | `print.layoutSection` |
| Margins | Margine | `print.margins` |
| Normal | Normalne | `print.margins.normal` |
| Orientation | Orijentacija | `print.orientation` |
| Format | Oblikovanje | `sc.format` |
| Remove Arrows | Ukloni strelice | `calc.audit.removeArrows` |
| Show Formulas | Prikaži formule | `calc.audit.showFormulas` |
| Trace Dependents | Prati zavisne ćelije | `calc.audit.traceDependents` |
| Trace Precedents | Prati prethodne ćelije | `calc.audit.tracePrecedents` |
| Breaks | Prijelomi | `calc.breaks` |
| Fill | Ispuna | `calc.cf.barFill` |
| Clear | Očisti | `calc.cf.clearFormat` |
| Shapes | Oblici | `calc.cf.iconGroup.shapes` |
| Conditional Formatting | Uvjetno oblikovanje | `calc.cf.menu` |
| Gridlines | Crte mreže | `calc.chart.ae.gridlines` |
| Chart | Grafikon | `calc.chart.chart` |
| Center | Sredina | `calc.chart.pos.center` |
| Recommended Charts | Preporučeni grafikoni | `calc.chart.recommended` |
| Shape Fill | Ispuna oblika | `calc.chart.shapeFill` |
| Shape Outline | Obris oblika | `calc.chart.shapeOutline` |
| New Comment | Novi komentar | `calc.comments.new` |
| Comment | Komentar | `calc.comments.textLabel` |
| Consolidate | Konsolidiraj | `calc.consolidate.button` |
| Delete Cells… | Izbriši ćelije… | `calc.deleteCellsDots` |
| Remove Duplicates | Ukloni duplikate | `calc.dup.button` |
| Columns | Stupci | `calc.dup.columns` |
| Select All | Odaberi sve | `calc.dup.selectAll` |
| Data Validation | Provjera valjanosti podataka | `calc.dv.button` |
| Filter | Filtar | `calc.filter` |
| Font Color | Boja fonta | `calc.filter.byFontColor` |
| Flash Fill | Brzo popunjavanje | `calc.flash.button` |
| Effects | Efekti | `calc.fmt.effects` |
| Justify | Obostrano | `calc.fmt.h.justify` |
| Indent | Uvlaka | `calc.fmt.indent` |
| Preview | Pretpregled | `calc.fmt.preview` |
| Subscript | Indeks | `calc.fmt.subscript` |
| Superscript | Eksponent | `calc.fmt.superscript` |
| Symbol | Simbol | `calc.fmt.symbol` |
| AutoSum | Automatski zbroj | `calc.fn.autoSum` |
| Insert Function | Umetni funkciju | `calc.fn.insert` |
| Format Painter | Prenositelj oblikovanja | `calc.formatPainter` |
| Freeze Panes | Zamrzni okna | `calc.freezePanes` |
| Goal Seek… | Traženje cilja… | `calc.goal.dots` |
| What-If Analysis | Analiza što-ako | `calc.goal.whatIf` |
| Hide | Sakrij | `calc.hide` |
| Insert Cells… | Umetni ćelije… | `calc.insertCellsDots` |
| Link | Veza | `calc.link.button` |
| Merge Cells | Spoji ćelije | `calc.mergeCells` |
| Merge & Center | Spoji i centriraj | `calc.mergeCenter` |
| Move or Copy… | Premjesti ili kopiraj… | `calc.moveCopy.dots` |
| Define Name | Definiraj naziv | `calc.names.define` |
| Name Manager | Upravitelj naziva | `calc.names.manager` |
| Group | Grupiraj | `calc.outline.group` |
| Ungroup | Razgrupiraj | `calc.outline.ungroup` |
| Page Setup | Postavljanje stranice | `calc.pageSetup` |
| Pictures | Slike | `calc.picture.button` |
| PivotTable | Zaokretna tablica | `calc.pivot.pivotTable` |
| Refresh All | Osvježi sve | `calc.pivot.refreshAll` |
| Styles | Stilovi | `calc.pivot.stylesGallery` |
| Print Area | Područje ispisa | `calc.printArea` |
| Print Titles | Naslovi za ispis | `calc.printTitles` |
| Sort | Sortiraju | `calc.protect.allow.sort` |
| Protect Workbook | Zaštiti radnu knjigu | `calc.protect.bookDots` |
| Protect Sheet… | Zaštiti list… | `calc.protect.sheetDots` |
| Paste Special… | Posebno lijepljenje… | `calc.ps.dots` |
| Error Checking | Provjera pogrešaka | `calc.err.dialogTitle` |
| Previous | Prethodno | `calc.err.previous` |
| Next | Sljedeće | `calc.err.next` |
| Evaluate Formula | Procjena formule | `calc.eval.title` |
| Watch Window | Prozor nadzora | `calc.watch.title` |
| Calculate Now | Izračunaj sada | `calc.calc.now` |
| Sort & Filter | Sortiranje i filtriranje | `calc.sortFilter` |
| Subtotal | Međuzbroj | `calc.subtotal.button` |
| Properties | Svojstva | `calc.table.properties` |
| Table | Tablica | `calc.table.table` |
| Unhide | Prikaži | `calc.unhide` |
| Text to Columns | Tekst u stupce | `calc.wizard.ttcButton` |
| Align Left | Poravnaj ulijevo | `write.alignObj.left` |
| Align Right | Poravnaj udesno | `write.alignObj.right` |
| Align | Poravnaj | `write.alignObjects` |
| Bookmark | Knjižna oznaka | `write.bookmark.button` |
| Insert Caption | Umetni opisni natpis | `write.caption.button` |
| Equation | Jednadžba | `write.caption.equation` |
| Position | Položaj | `write.caption.position` |
| Crop | Obreži | `write.crop` |
| Spacing | Razmak | `write.font.spacing` |
| Bring Forward | Pomakni naprijed | `write.order.bringForward` |
| Bring to Front | Postavi u prvi plan | `write.order.bringToFront` |
| Send Backward | Pomakni natrag | `write.order.sendBackward` |
| Send to Back | Postavi u pozadinu | `write.order.sendToBack` |
| Picture | Slika | `write.picture` |
| Section | Odjeljak | `write.reveal.section` |
| Rotate | Zakreni | `write.rotate` |
| Ruler | Ravnalo | `write.ruler` |
| Selection Pane | Okno za odabir | `write.selectionPane` |
| Spelling | Pravopis | `write.spelling` |
| Split Cells | Podijeli ćelije | `write.splitCells` |
| Hyperlink | Hiperveza | `write.styleName.hyperlink` |
| Numbering… | Numeriranje… | `write.styles.format.numbering` |
| Text Box | Tekstni okvir | `write.textBox` |
| Wrap Text | Prelamanje teksta | `write.wrapText` |
| Cross-reference | Unakrsna referenca | `write.xref.button` |
| Footnote | Fusnota | `write.xref.footnote` |
| Reset | Ponovno postavi | `write.notes.sep.reset` |
| Format Background | Oblikovanje pozadine | `show.bg.format` |
| Background Styles | Stilovi pozadine | `show.bg.styles` |
| Fonts | Fontovi | `show.design.fonts` |
| Themes | Teme | `show.design.themes` |
| Header & Footer… | Zaglavlje i podnožje… | `show.hf.titleDots` |
| Slide Master | Glavni slajd | `show.master.tab` |
| Slide Size | Veličina slajda | `show.size.customTitle` |
| Set Up Slide Show | Postavljanje prezentacije | `show.setup.titleDots` |
| Guides | Vodilice | `show.view.guides` |
| Notes Page | Stranica bilješki | `show.view.notesPage` |
| Outline View | Prikaz strukture | `show.view.outline` |
| Reading View | Prikaz čitanja | `show.view.reading` |
| Slide Sorter | Razvrstavanje slajdova | `show.view.sorter` |
| Edit Points | Uredi točke | `show.editPoints` |
| Fill Color | Boja ispune | `show.fx.fillColor` |
| Animation Painter | Slikar animacije | `show.animPainter` |
| From Current Slide… | Od trenutnog slajda… | `show.recordFromCurrent` |
| From Beginning… | Od početka… | `show.recordFromStart` |

## Dialog buttons and messages
| English | Office term | Note |
| --- | --- | --- |
| OK | U redu | |
| Cancel | Odustani | |
| Apply | Primijeni | |
| Close | Zatvori | |
| Yes / No | Da / Ne | |
| Don't Save | Ne spremaj | the unsaved-changes prompt |
| Browse… | Pregledaj… | |
| Reset | Ponovno postavi | |
| Insert / Delete | Umetni / Izbriši | |
| Back / Next / Finish | Natrag / Dalje / Završi | wizards |
| Recent | Nedavno | backstage |
| Untitled | Bez naslova | default document name |
| Saved / Saving… / Unsaved changes | Spremljeno / Spremanje… / Nespremljene promjene | status bar |

## File types
| English | Office term | Note |
| --- | --- | --- |
| Excel Workbook | Excel radna knjiga | `.xlsx`, the desktop dialog filter name |
| Word Document | Word dokument | `.docx` |
| PowerPoint Presentation | PowerPoint prezentacija | `.pptx` |
| Excel Template / Word Template / PowerPoint Template | Excel / Word / PowerPoint predložak | `.xltx` / `.dotx` / `.potx` |
| CSV (Comma delimited) | CSV (razdvojeno zarezom) | Calc |
| Text Files | Tekstne datoteke | |
| PDF | PDF | |
| Office Theme | Office tema | `.thmx` |
| All Files | Sve datoteke | |

## Show effects and transitions
Animation effects (`show.fx.*`) and slide transitions (`show.trans.*`), named as in the PowerPoint localisation (P9-LR4).

| English | Term | Key |
| --- | --- | --- |
| Appear | Pojavljivanje | `show.fx.appear` |
| Disappear | Nestajanje | `show.fx.disappear` |
| Fade | Pretapanje | `show.fx.fade` |
| Fly In | Uletavanje | `show.fx.flyIn` |
| Fly Out | Izlijetanje | `show.fx.flyOut` |
| Grow/Shrink | Povećavanje/smanjivanje | `show.fx.growShrink` |
| Spin | Vrtnja | `show.fx.spin` |
| Wipe | Brisanje | `show.fx.wipe` |
| Zoom | Zumiranje | `show.fx.zoom` |
| Cover | Prekrivanje | `show.trans.cover` |
| Cut | Rez | `show.trans.cut` |
| Fade | Pretapanje | `show.trans.fade` |
| None | Nema | `show.trans.none` |
| Push | Guranje | `show.trans.push` |
| Split | Razdvajanje | `show.trans.split` |
| Wipe | Brisanje | `show.trans.wipe` |
| Zoom | Zumiranje | `show.trans.zoom` |
| Morph | Morf | `show.trans.morph` |
| Reveal | Otkrivanje | `show.trans.reveal` |
| Shred | Usitnjavanje | `show.trans.shred` |
| Fall Over | Prevrtanje | `show.trans.fallOver` |
| Drape | Draperija | `show.trans.drape` |
| Curtains | Zavjese | `show.trans.curtains` |
| Wind | Vjetar | `show.trans.wind` |
| Prestige | Prestiž | `show.trans.prestige` |
| Fracture | Lom | `show.trans.fracture` |
| Crush | Drobljenje | `show.trans.crush` |
| Peel Off | Guljenje | `show.trans.peelOff` |
| Page Curl | Uvijanje stranice | `show.trans.pageCurl` |
| Airplane | Avion | `show.trans.airplane` |
| Origami | Origami | `show.trans.origami` |
| Honeycomb | Saće | `show.trans.honeycomb` |
| Glitter | Svjetlucanje | `show.trans.glitter` |
| Vortex | Vrtlog | `show.trans.vortex` |
| Ripple | Mreškanje | `show.trans.ripple` |
| Switch | Prekidač | `show.trans.switch` |
| Flip | Okretanje | `show.trans.flip` |
| Gallery | Galerija | `show.trans.gallery` |
| Cube | Kocka | `show.trans.cube` |
| Doors | Vrata | `show.trans.doors` |
| Box | Kutija | `show.trans.box` |
| Float In | Lebdeći ulaz | `show.fx.float` |
| Float Out | Lebdeći izlaz | `show.fx.floatOut` |
| Split | Razdvajanje | `show.fx.split` |
| Shape | Oblik | `show.fx.shape` |
| Circle | Krug | `show.fx.circle` |
| Box | Kutija | `show.fx.box` |
| Diamond | Romb | `show.fx.diamond` |
| Plus | Plus | `show.fx.plus` |
| Wheel | Kotač | `show.fx.wheel` |
| Random Bars | Nasumične trake | `show.fx.randomBars` |
| Grow & Turn | Rast i okretanje | `show.fx.growTurn` |
| Shrink & Turn | Smanjivanje i okretanje | `show.fx.shrinkTurn` |
| Swivel | Vrtnja oko osi | `show.fx.swivel` |
| Bounce | Poskakivanje | `show.fx.bounce` |
| Pulse | Pulsiranje | `show.fx.pulse` |
| Color Pulse | Pulsiranje boje | `show.fx.colorPulse` |
| Teeter | Ljuljanje | `show.fx.teeter` |
| Desaturate | Smanjenje zasićenosti | `show.fx.desaturate` |
| Darken | Zatamnjivanje | `show.fx.darken` |
| Lighten | Posvjetljivanje | `show.fx.lighten` |
| Transparency | Prozirnost | `show.fx.transparency` |
| Object Color | Boja objekta | `show.fx.objectColor` |
| Line Color | Boja crte | `show.fx.lineColor` |
| Fill Color | Boja ispune | `show.fx.fillColor` |
| Brush Color | Boja kista | `show.fx.brushColor` |
| Font Color | Boja fonta | `show.fx.fontColor` |
| Underline | Podcrtavanje | `show.fx.underline` |
| Bold Flash | Podebljani bljesak | `show.fx.boldFlash` |
| Bold Reveal | Podebljano otkrivanje | `show.fx.boldReveal` |
| Wave | Val | `show.fx.wave` |
| Lines | Crte | `show.fx.pathLines` |
| Arcs | Lukovi | `show.fx.pathArcs` |
| Turns | Zavoji | `show.fx.pathTurns` |
| Shapes | Oblici | `show.fx.pathShapes` |
| Loops | Petlje | `show.fx.pathLoops` |
| Custom Path | Prilagođena putanja | `show.fx.pathCustom` |
| Play | Reproduciraj | `show.fx.mediaPlay` |
| Pause | Pauziraj | `show.fx.mediaPause` |
| Stop | Zaustavi | `show.fx.mediaStop` |

## More terms
| English | Office term | Note |
| --- | --- | --- |
| Workbook / Worksheet / Sheet | Radna knjiga / Radni list / List | Calc |
| Cell / Range | Ćelija / Raspon | Calc |
| PivotTable / PivotChart | Zaokretna tablica / Zaokretni grafikon | Calc |
| Slicer / Sparkline | Rezač / Minigrafikon | Calc |
| Conditional Formatting | Uvjetno oblikovanje | Calc; Data Bars = Trake podataka, Color Scales = Ljestvice boja, Icon Sets = Skupovi ikona |
| Data Validation | Provjera valjanosti podataka | Calc |
| Goal Seek / What-If Analysis | Traženje cilja / Analiza što-ako | Calc |
| Name Manager | Upravitelj naziva | Calc |
| Flash Fill | Brzo popunjavanje | Calc |
| Text to Columns | Tekst u stupce | Calc |
| Protect Sheet | Zaštiti list | Calc |
| Freeze Panes | Zamrzni okna | Calc |
| Slide / Section | Slajd / Odjeljak | Show |
| Slide Master | Glavni slajd | Show |
| Layout (slide) | Izgled | Show |
| Presenter view | Prikaz izlagača | Show |
| Speaker notes | Bilješke izlagača | Show |
| Entrance / Emphasis / Exit | Ulaz / Isticanje / Izlaz | Show animations |
| Appear / Disappear / Fade / Fly In / Fly Out / Wipe | Pojavljivanje / Nestajanje / Pretapanje / Uletavanje / Izlijetanje / Brisanje | Show effects |
| Morph / Reveal / Honeycomb / Page Curl | Morf / Otkrivanje / Saće / Uvijanje stranice | Show transitions |
| Footnote / Endnote | Fusnota / Završna bilješka | Write |
| Bookmark | Knjižna oznaka | Write |
| Cross-reference | Unakrsna referenca | Write |
| Table of contents | Sadržaj | Write |
| Header / Footer | Zaglavlje / Podnožje | |
| Hyperlink | Hiperveza | |
| Margins / Orientation / Paper size | Margine / Orijentacija / Veličina papira | |
| Autosave | Automatsko spremanje | |
| Alt text | Alternativni tekst | |
| Wrap Text (Write, picture layout) | Prelamanje teksta | Calc cell option: "Prelomi tekst" |
| Presets (borders, columns) | Unaprijed postavljeno | |
| Chart title / Axis / Legend / Trendline | Naslov grafikona / Os / Legenda / Linija trenda | |
| Column / Bar / Pie / Doughnut / Scatter chart | Stupčasti / Trakasti / Tortni / Prstenasti / Raspršeni grafikon | |
| Split (View) | Podijeli | Calc (P9-LF) |
| Go To Special… / Special… | Idi na posebno… / Posebno… | Calc |
| Picture Format / Alt Text | Oblikovanje slike / Alternativni tekst | Calc |
| Mention someone | Spomeni nekoga | Calc comments |
| Reasoning (AI setting, reasoning_effort) | Razmišljanje | Settings › AI, actions (P9-LF pass 2) |
| dropped (reader warnings) | izostavljen(a/o/i/e) | `reader.xlsx.*` / `reader.pptx.*`, as in `reader.docx.*` |
| read as (reader warnings) | pročitan(a/o) kao | reader warnings |
| dangling relationship | nepostojeća veza | reader warnings |
| Custom show (PowerPoint) | Prilagođena prezentacija | `reader.pptx.customShow.*` |
| Pivot cache | predmemorija zaokretne tablice | `reader.xlsx.pivotCache.*` |

## Touch, compact layout and PDF export (P10-LF, 2026-10-23)

One term per gesture across the five catalogs (cycle 3.1415: ui-shared compact bars and sheets, the touch UI of Calc/Write/Show, PDF export, the portal's signing texts).

| English | Term | Used in |
| --- | --- | --- |
| tap | dodirnuti („Dodirni …”) | `calc.keys.ref`, `calc.stats.next`, `show.touch.tapToPlay` |
| long press | dugi pritisak | (context menu as a sheet; no catalog text yet) |
| pinch | štipanje | (zoom; no catalog text yet) |
| swipe | povlačenje prstom | (no catalog text yet) |
| selection handle | hvatište | `write.touch.handleStart` / `handleEnd` |
| bottom sheet | ploča (ne „list” = worksheet) | `compact.moreSheet`, `compact.closeSheet` (aria labels) |
| fingerprint (GPG) | otisak | `portal.dl.signed.linux`, `portal.dl.sums.text` |
| release key | ključ za izdanja | `portal.dl.signed.linux`, `portal.dl.sums.text` |
| notarized (Apple) | notarizirano | `portal.dl.signed.macos` |
| More | Više | `compact.more` |
| More commands | Više naredbi | `compact.moreSheet` |
| Fill | Ispuna | `calc.touch.fill` |
| Fill series | Popuni niz | `calc.touch.fillSeries` |
| Copy cells | Kopiraj ćelije | `calc.touch.copyCells` |
| Ref | Ref. | `calc.keys.refShort` |
| Share as PDF… | Podijeli kao PDF… | `backstage.sharePdf` |
| Export PDF | Izvezi PDF | `print.exportPdf` |
| Multi-select | Višestruki odabir | `show.touch.multiSelect` |
