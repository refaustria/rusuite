# Glossary: Hungarian (`hu`)

Source: the Hungarian (Magyarország) localisation of Microsoft Office (Word, Excel, PowerPoint) and its terminology. Translator: P9-L7. Reviewer: P9-LR4 (2026-10-18).

## Register
- Address: informal "te", with the possessive suffix on the noun ("a dokumentumaid", "a nevedet") and imperatives in the 2nd person singular ("Válassz", "Kattints", "Add meg", "Jelölj ki", "Próbáld újra"); never "Ön / Önök", "Maga" or the polite 3rd-person imperatives ("Válassza", "Kattintson", "Adja meg"). Office's "Kattintson" becomes "Kattints".
- Descriptions of the program or of a third thing use the 3rd person ("az alkalmazás tárolja", "a modell"), not an address.
- Buttons and menu commands: verbal nouns as Hungarian Office does ("Mentés", "Megnyitás", "Beillesztés"); sentences to the user are in the informal imperative.
- Ellipsis "…" for commands that open a dialog, as in English.
- Quotation marks: „…” (low-high); decimal comma ("29,7 × 42 cm"); numbers followed by a unit have a space; percent without space ("25%") as in Hungarian Office lists.
- Articles before placeholders: "a(z) {name}" so the article fits both vowel and consonant starts.
- Keyboard key names in shortcut texts (packages/ui-shared/src/i18n/keyNames.ts): Hungarian Office keeps the English key names (Ctrl, Shift, Alt, Delete, Enter) – no entry in `KEY_NAMES`.
- Plural categories: `one / other`; after a number the noun stays singular ("3 megjegyzés"), so both forms read the same.
- Slides are "dia" (PowerPoint hu), "Slide Show" = "Diavetítés".

## Ribbon tabs
| English | Office term | Note |
| --- | --- | --- |
| File | Fájl | |
| Home | Kezdőlap | |
| Insert | Beszúrás | |
| Draw | Rajz | |
| Design | Tervezés | |
| Layout (Write: Layout, Calc: Page Layout) | Elrendezés / Lapelrendezés | Write: "Elrendezés", Calc: "Lapelrendezés" |
| References | Hivatkozások | Write |
| Mailings | Levelek | not used (no mailings tab) |
| Review | Véleményezés | |
| View | Nézet | |
| Formulas | Képletek | Calc |
| Data | Adatok | Calc |
| Transitions | Átmenetek | Show |
| Animations | Animációk | Show |
| Slide Show | Diavetítés | Show |
| Help | Súgó | |
| Picture / Table / Chart / Drawing Tools (contextual) | Képeszközök / Táblázateszközök / Diagrameszközök / Rajzeszközök | |

## Ribbon groups
| English | Office term | Note |
| --- | --- | --- |
| Clipboard | Vágólap | |
| Font | Betűtípus | |
| Paragraph | Bekezdés | |
| Styles | Stílusok | |
| Editing | Szerkesztés | |
| Number | Szám | Calc |
| Alignment | Igazítás | Calc |
| Cells | Cellák | Calc |
| Slides | Diák | Show |
| Drawing | Rajzolás | Show |
| Zoom | Nagyítás | |
| Show (View › Show) | Megjelenítés | |
| Language | Nyelv | the picker; label "Nyelv / Language" |

## Common commands
| English | Office term | Note |
| --- | --- | --- |
| New | Új | |
| Open… | Megnyitás… | |
| Save | Mentés | |
| Save As… | Mentés másként… | |
| Print | Nyomtatás | |
| Export PDF… | Exportálás PDF-be… | |
| Close | Bezárás | |
| Options… | Beállítások… | |
| Undo / Redo | Visszavonás / Újra | |
| Cut / Copy / Paste | Kivágás / Másolás / Beillesztés | |
| Paste Special… | Irányított beillesztés… | |
| Format Painter | Formátummásoló | |
| Find / Replace… / Go To… | Keresés / Csere… / Ugrás… | |
| Select All | Az összes kijelölése | |
| Bold / Italic / Underline / Strikethrough | Félkövér / Dőlt / Aláhúzott / Áthúzott | |
| Font Color / Highlight / Fill Color | Betűszín / Kiemelés / Kitöltőszín | |
| Insert Picture / Table / Chart / Shape / Text Box | Kép / Táblázat / Diagram / Alakzat / Szövegdoboz beszúrása | |
| Bring to Front / Send to Back | Előtérbe hozás / Hátraküldés | |
| Group / Ungroup | Csoportosítás / Csoport felbontása | |
| Sort / Filter | Rendezés / Szűrő | Calc |
| Insert Function | Függvény beszúrása | Calc |
| New Slide | Új dia | Show |
| From Beginning / From Current Slide | Az elejétől / Az aktuális diától | Show |
| Track Changes / Comments | Változások követése / Megjegyzések | Write |

## Commands as used in the catalogs
The terms the catalogs use after the review (P9-LR4), one row per English command; the key shows where.

| English | Term | Key |
| --- | --- | --- |
| Copy | Másolás | `ai.pane.copy` |
| Save | Mentés | `ai.settings.save` |
| Insert | Beszúrás | `ai.write.insert` |
| Close | Bezárás | `backstage.close` |
| New | Új | `backstage.new` |
| Open… | Megnyitás… | `backstage.open` |
| Options… | Beállítások… | `backstage.options` |
| Print | Nyomtatás | `backstage.print` |
| Save As… | Mentés másként… | `backstage.saveAs` |
| Cut | Kivágás | `cmd.cut` |
| Delete | Törlés | `cmd.delete` |
| Find | Keresés | `cmd.find` |
| Paste | Beillesztés | `cmd.paste` |
| Redo | Újra | `cmd.redo` |
| Replace… | Csere… | `cmd.replaceDots` |
| Undo | Visszavonás | `cmd.undo` |
| Size | Méret | `conn.browser.colSize` |
| Rename | Átnevezés | `conn.browser.rename` |
| Bold | Félkövér | `fmt.bold` |
| Borders | Szegélyek | `fmt.borders` |
| Colors | Színek | `fmt.colors` |
| Italic | Dőlt | `fmt.italic` |
| Strikethrough | Áthúzott | `fmt.strike` |
| Underline | Aláhúzott | `fmt.underline` |
| Zoom | Nagyítás | `group.zoom` |
| Layout | Elrendezés | `print.layoutSection` |
| Margins | Margók | `print.margins` |
| Normal | Normál | `print.margins.normal` |
| Orientation | Tájolás | `print.orientation` |
| Format | Formátum | `sc.format` |
| Remove Arrows | Nyilak eltávolítása | `calc.audit.removeArrows` |
| Show Formulas | Képletek megjelenítése | `calc.audit.showFormulas` |
| Trace Dependents | Függőségek nyomkövetése | `calc.audit.traceDependents` |
| Trace Precedents | Előzmények nyomkövetése | `calc.audit.tracePrecedents` |
| Breaks | Törések | `calc.breaks` |
| Fill | Kitöltés | `calc.cf.barFill` |
| Clear | Törlés | `calc.cf.clearFormat` |
| Shapes | Alakzatok | `calc.cf.iconGroup.shapes` |
| Conditional Formatting | Feltételes formázás | `calc.cf.menu` |
| Gridlines | Rácsvonalak | `calc.chart.ae.gridlines` |
| Chart | Diagram | `calc.chart.chart` |
| Center | Középen | `calc.chart.pos.center` |
| Recommended Charts | Javasolt diagramok | `calc.chart.recommended` |
| Shape Fill | Alakzat kitöltése | `calc.chart.shapeFill` |
| Shape Outline | Alakzat körvonala | `calc.chart.shapeOutline` |
| New Comment | Új megjegyzés | `calc.comments.new` |
| Comment | Megjegyzés | `calc.comments.textLabel` |
| Consolidate | Konszolidálás | `calc.consolidate.button` |
| Delete Cells… | Cellák törlése… | `calc.deleteCellsDots` |
| Remove Duplicates | Ismétlődések eltávolítása | `calc.dup.button` |
| Columns | Oszlopok | `calc.dup.columns` |
| Select All | Összes kijelölése | `calc.dup.selectAll` |
| Data Validation | Adatérvényesítés | `calc.dv.button` |
| Filter | Szűrő | `calc.filter` |
| Font Color | Betűszín | `calc.filter.byFontColor` |
| Flash Fill | Gyorskitöltés | `calc.flash.button` |
| Effects | Effektusok | `calc.fmt.effects` |
| Justify | Sorkizárt | `calc.fmt.h.justify` |
| Indent | Behúzás | `calc.fmt.indent` |
| Preview | Előnézet | `calc.fmt.preview` |
| Subscript | Alsó index | `calc.fmt.subscript` |
| Superscript | Felső index | `calc.fmt.superscript` |
| Symbol | Szimbólum | `calc.fmt.symbol` |
| AutoSum | Automatikus összegzés | `calc.fn.autoSum` |
| Insert Function | Függvény beszúrása | `calc.fn.insert` |
| Format Painter | Formátummásoló | `calc.formatPainter` |
| Freeze Panes | Ablaktáblák rögzítése | `calc.freezePanes` |
| Goal Seek… | Célérték keresése… | `calc.goal.dots` |
| What-If Analysis | Mi lenne, ha elemzés | `calc.goal.whatIf` |
| Hide | Elrejtés | `calc.hide` |
| Insert Cells… | Cellák beszúrása… | `calc.insertCellsDots` |
| Link | Hivatkozás | `calc.link.button` |
| Merge Cells | Cellák egyesítése | `calc.mergeCells` |
| Merge & Center | Egyesítés és középre igazítás | `calc.mergeCenter` |
| Move or Copy… | Áthelyezés vagy másolás… | `calc.moveCopy.dots` |
| Define Name | Név megadása | `calc.names.define` |
| Name Manager | Névkezelő | `calc.names.manager` |
| Group | Csoportosítás | `calc.outline.group` |
| Ungroup | Csoport felbontása | `calc.outline.ungroup` |
| Page Setup | Oldalbeállítás | `calc.pageSetup` |
| Pictures | Képek | `calc.picture.button` |
| PivotTable | Kimutatás | `calc.pivot.pivotTable` |
| Refresh All | Összes frissítése | `calc.pivot.refreshAll` |
| Styles | Stílusok | `calc.pivot.stylesGallery` |
| Print Area | Nyomtatási terület | `calc.printArea` |
| Print Titles | Nyomtatási címek | `calc.printTitles` |
| Sort | Rendezés | `calc.protect.allow.sort` |
| Protect Workbook | Munkafüzet védelme | `calc.protect.bookDots` |
| Protect Sheet… | Munkalap védelme… | `calc.protect.sheetDots` |
| Paste Special… | Irányított beillesztés… | `calc.ps.dots` |
| Error Checking | Hibaellenőrzés | `calc.err.dialogTitle` |
| Previous | Előző | `calc.err.previous` |
| Next | Következő | `calc.err.next` |
| Evaluate Formula | Képletkiértékelés | `calc.eval.title` |
| Watch Window | Figyelőablak | `calc.watch.title` |
| Calculate Now | Számítás most | `calc.calc.now` |
| Sort & Filter | Rendezés és szűrés | `calc.sortFilter` |
| Subtotal | Részösszeg | `calc.subtotal.button` |
| Properties | Tulajdonságok | `calc.table.properties` |
| Table | Táblázat | `calc.table.table` |
| Unhide | Felfedés | `calc.unhide` |
| Text to Columns | Szövegből oszlopok | `calc.wizard.ttcButton` |
| Align Left | Balra igazítás | `write.alignObj.left` |
| Align Right | Jobbra igazítás | `write.alignObj.right` |
| Align | Igazítás | `write.alignObjects` |
| Bookmark | Könyvjelző | `write.bookmark.button` |
| Insert Caption | Képaláírás beszúrása | `write.caption.button` |
| Equation | Egyenlet | `write.caption.equation` |
| Position | Pozíció | `write.caption.position` |
| Crop | Körülvágás | `write.crop` |
| Spacing | Térköz | `write.font.spacing` |
| Bring Forward | Előrehozás | `write.order.bringForward` |
| Bring to Front | Előtérbe hozás | `write.order.bringToFront` |
| Send Backward | Hátrébb küldés | `write.order.sendBackward` |
| Send to Back | Hátraküldés | `write.order.sendToBack` |
| Picture | Kép | `write.picture` |
| Section | Szakasz | `write.reveal.section` |
| Rotate | Elforgatás | `write.rotate` |
| Ruler | Vonalzó | `write.ruler` |
| Selection Pane | Kijelölési ablaktábla | `write.selectionPane` |
| Spelling | Helyesírás | `write.spelling` |
| Split Cells | Cellák felosztása | `write.splitCells` |
| Hyperlink | Hiperhivatkozás | `write.styleName.hyperlink` |
| Numbering… | Számozás… | `write.styles.format.numbering` |
| Text Box | Szövegdoboz | `write.textBox` |
| Wrap Text | Szövegkörbefuttatás | `write.wrapText` |
| Cross-reference | Kereszthivatkozás | `write.xref.button` |
| Footnote | Lábjegyzet | `write.xref.footnote` |
| Reset | Alaphelyzet | `write.notes.sep.reset` |
| Format Background | Háttér formázása | `show.bg.format` |
| Background Styles | Háttérstílusok | `show.bg.styles` |
| Fonts | Betűtípusok | `show.design.fonts` |
| Themes | Témák | `show.design.themes` |
| Header & Footer… | Élőfej és élőláb… | `show.hf.titleDots` |
| Slide Master | Diaminta | `show.master.tab` |
| Slide Size | Diaméret | `show.size.customTitle` |
| Set Up Slide Show | Diavetítés beállítása | `show.setup.titleDots` |
| Guides | Vezetők | `show.view.guides` |
| Notes Page | Jegyzetoldal | `show.view.notesPage` |
| Outline View | Vázlatnézet | `show.view.outline` |
| Reading View | Olvasónézet | `show.view.reading` |
| Slide Sorter | Diarendező | `show.view.sorter` |
| Edit Points | Pontok szerkesztése | `show.editPoints` |
| Fill Color | Kitöltőszín | `show.fx.fillColor` |
| Animation Painter | Animációfestő | `show.animPainter` |
| From Current Slide… | Az aktuális diától… | `show.recordFromCurrent` |
| From Beginning… | Az elejétől… | `show.recordFromStart` |

## Dialog buttons and messages
| English | Office term | Note |
| --- | --- | --- |
| OK | OK | |
| Cancel | Mégse | |
| Apply | Alkalmaz | |
| Close | Bezárás | |
| Yes / No | Igen / Nem | |
| Don't Save | Ne mentsd | the unsaved-changes prompt (informal imperative; Office: "Nem menti") |
| Browse… | Tallózás… | |
| Reset | Alaphelyzet | |
| Insert / Delete | Beszúrás / Törlés | |
| Back / Next / Finish | Vissza / Tovább / Befejezés | wizards |
| Recent | Legutóbbi | backstage |
| Untitled | Névtelen | default document name |
| Saved / Saving… / Unsaved changes | Mentve / Mentés… / Nem mentett módosítások | status bar |

## File types
| English | Office term | Note |
| --- | --- | --- |
| Excel Workbook | Excel-munkafüzet | `.xlsx`, the desktop dialog filter name |
| Word Document | Word-dokumentum | `.docx` |
| PowerPoint Presentation | PowerPoint-bemutató | `.pptx` |
| Excel Template / Word Template / PowerPoint Template | Excel- / Word- / PowerPoint-sablon | `.xltx` / `.dotx` / `.potx` |
| CSV (Comma delimited) | CSV (vesszővel tagolt) | Calc |
| Text Files | Szövegfájlok | |
| PDF | PDF | |
| Office Theme | Office-téma | `.thmx` |
| All Files | Minden fájl | |

## Show effects and transitions
Animation effects (`show.fx.*`) and slide transitions (`show.trans.*`), named as in the PowerPoint localisation (P9-LR4).

| English | Term | Key |
| --- | --- | --- |
| Appear | Megjelenés | `show.fx.appear` |
| Disappear | Eltűnés | `show.fx.disappear` |
| Fade | Elhalványulás | `show.fx.fade` |
| Fly In | Berepülés | `show.fx.flyIn` |
| Fly Out | Kirepülés | `show.fx.flyOut` |
| Grow/Shrink | Nagyítás/kicsinyítés | `show.fx.growShrink` |
| Spin | Pörgetés | `show.fx.spin` |
| Wipe | Letörlés | `show.fx.wipe` |
| Zoom | Nagyítás | `show.fx.zoom` |
| Cover | Takarás | `show.trans.cover` |
| Cut | Vágás | `show.trans.cut` |
| Fade | Elhalványulás | `show.trans.fade` |
| None | Nincs | `show.trans.none` |
| Push | Lökés | `show.trans.push` |
| Split | Felosztás | `show.trans.split` |
| Wipe | Letörlés | `show.trans.wipe` |
| Zoom | Nagyítás | `show.trans.zoom` |
| Morph | Alakváltás | `show.trans.morph` |
| Reveal | Felfedés | `show.trans.reveal` |
| Shred | Aprítás | `show.trans.shred` |
| Fall Over | Eldőlés | `show.trans.fallOver` |
| Drape | Terítő | `show.trans.drape` |
| Curtains | Függönyök | `show.trans.curtains` |
| Wind | Szél | `show.trans.wind` |
| Prestige | Presztízs | `show.trans.prestige` |
| Fracture | Törés | `show.trans.fracture` |
| Crush | Összetörés | `show.trans.crush` |
| Peel Off | Lehámlás | `show.trans.peelOff` |
| Page Curl | Lapozás | `show.trans.pageCurl` |
| Airplane | Repülőgép | `show.trans.airplane` |
| Origami | Origami | `show.trans.origami` |
| Honeycomb | Méhsejt | `show.trans.honeycomb` |
| Glitter | Csillogás | `show.trans.glitter` |
| Vortex | Örvény | `show.trans.vortex` |
| Ripple | Hullámzás | `show.trans.ripple` |
| Switch | Kapcsoló | `show.trans.switch` |
| Flip | Átfordítás | `show.trans.flip` |
| Gallery | Galéria | `show.trans.gallery` |
| Cube | Kocka | `show.trans.cube` |
| Doors | Ajtók | `show.trans.doors` |
| Box | Doboz | `show.trans.box` |
| Float In | Beúszás | `show.fx.float` |
| Float Out | Kiúszás | `show.fx.floatOut` |
| Split | Felosztás | `show.fx.split` |
| Shape | Alakzat | `show.fx.shape` |
| Circle | Kör | `show.fx.circle` |
| Box | Doboz | `show.fx.box` |
| Diamond | Rombusz | `show.fx.diamond` |
| Plus | Pluszjel | `show.fx.plus` |
| Wheel | Kerék | `show.fx.wheel` |
| Random Bars | Véletlenszerű sávok | `show.fx.randomBars` |
| Grow & Turn | Növekedés és fordulás | `show.fx.growTurn` |
| Shrink & Turn | Zsugorodás és fordulás | `show.fx.shrinkTurn` |
| Swivel | Forgás tengely körül | `show.fx.swivel` |
| Bounce | Pattogás | `show.fx.bounce` |
| Pulse | Pulzálás | `show.fx.pulse` |
| Color Pulse | Színpulzálás | `show.fx.colorPulse` |
| Teeter | Billegés | `show.fx.teeter` |
| Desaturate | Színtelenítés | `show.fx.desaturate` |
| Darken | Sötétítés | `show.fx.darken` |
| Lighten | Világosítás | `show.fx.lighten` |
| Transparency | Átlátszóság | `show.fx.transparency` |
| Object Color | Objektum színe | `show.fx.objectColor` |
| Line Color | Vonalszín | `show.fx.lineColor` |
| Fill Color | Kitöltőszín | `show.fx.fillColor` |
| Brush Color | Ecsetszín | `show.fx.brushColor` |
| Font Color | Betűszín | `show.fx.fontColor` |
| Underline | Aláhúzás | `show.fx.underline` |
| Bold Flash | Félkövér villanás | `show.fx.boldFlash` |
| Bold Reveal | Félkövér felfedés | `show.fx.boldReveal` |
| Wave | Hullám | `show.fx.wave` |
| Lines | Vonalak | `show.fx.pathLines` |
| Arcs | Ívek | `show.fx.pathArcs` |
| Turns | Fordulók | `show.fx.pathTurns` |
| Shapes | Alakzatok | `show.fx.pathShapes` |
| Loops | Hurkok | `show.fx.pathLoops` |
| Custom Path | Egyéni útvonal | `show.fx.pathCustom` |
| Play | Lejátszás | `show.fx.mediaPlay` |
| Pause | Szünet | `show.fx.mediaPause` |
| Stop | Leállítás | `show.fx.mediaStop` |

## More terms
| English | Office term | Note |
| --- | --- | --- |
| Workbook / Worksheet | Munkafüzet / Munkalap | Calc |
| Cell / Range | Cella / Tartomány | Calc |
| PivotTable / PivotChart | Kimutatás / Kimutatásdiagram | Calc |
| Slicer / Sparkline | Szeletelő / Értékgörbe | Calc |
| Conditional Formatting | Feltételes formázás | Calc; Data Bars = Adatsávok, Color Scales = Színskálák, Icon Sets = Ikonkészletek |
| Data Validation | Adatérvényesítés | Calc |
| Goal Seek / What-If Analysis | Célérték keresése / Mi lenne, ha elemzés | Calc |
| Name Manager | Névkezelő | Calc |
| Flash Fill | Gyorskitöltés | Calc |
| Text to Columns | Szövegből oszlopok | Calc |
| Protect Sheet | Munkalap védelme | Calc |
| Freeze Panes | Ablaktáblák rögzítése | Calc |
| Slide / Section | Dia / Szakasz | Show |
| Slide Master | Diaminta | Show |
| Layout (slide) | Elrendezés | Show |
| Presenter view | Előadói nézet | Show |
| Speaker notes | Előadói jegyzetek | Show |
| Entrance / Emphasis / Exit | Bevezető / Hangsúlyozó / Kilépő | Show animations |
| Appear / Disappear / Fade / Fly In / Fly Out / Wipe | Megjelenés / Eltűnés / Elhalványulás / Berepülés / Kirepülés / Letörlés | Show effects |
| Morph / Reveal / Honeycomb / Page Curl | Alakváltás / Felfedés / Méhsejt / Lapozás | Show transitions |
| Footnote / Endnote | Lábjegyzet / Végjegyzet | Write |
| Bookmark | Könyvjelző | Write |
| Cross-reference | Kereszthivatkozás | Write |
| Table of contents | Tartalomjegyzék | Write |
| Header / Footer | Élőfej / Élőláb | |
| Hyperlink | Hiperhivatkozás | |
| Margins / Orientation / Paper size | Margók / Tájolás / Papírméret | |
| Autosave | Automatikus mentés | |
| Alt text | Alternatív szöveg | |
| Bring in Front of Text / Send Behind Text | Szöveg elé hozás / Szöveg mögé küldés | Write |
| Red (colour) | Piros | Office colour name, not "Vörös" |
| Chart title / Axis / Legend / Trendline | Diagramcím / Tengely / Jelmagyarázat / Trendvonal | |
| Column / Bar / Pie / Doughnut / Scatter chart | Oszlop- / Sáv- / Kör- / Perec- / Pontdiagram | |
| Split (View) | Felosztás | Calc (P9-LF) |
| Go To Special… / Special… | Irányított kijelölés… / Irányított… | Calc |
| Picture Format / Alt Text | Képformátum / Alternatív szöveg | Calc |
| Mention someone | Valaki megemlítése | Calc comments |
| Reasoning (AI setting, reasoning_effort) | Gondolkodás | Settings › AI, actions (P9-LF pass 2) |
| dropped (reader warnings) | elhagyva | `reader.xlsx.*` / `reader.pptx.*`, as in `reader.docx.*` |
| read as (reader warnings) | …ként olvasva | reader warnings |
| dangling relationship | érvénytelen kapcsolat | reader warnings |
| Custom show (PowerPoint) | Egyéni vetítés | `reader.pptx.customShow.*` |
| Pivot cache | kimutatás-gyorsítótár | `reader.xlsx.pivotCache.*` |
