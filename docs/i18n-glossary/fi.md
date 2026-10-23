# Glossary: Finnish (`fi`)

Source: the Finnish (Finland) localisation of Microsoft Office (Word, Excel, PowerPoint) and its terminology. Translator: P9-L4. Reviewer: P9-LR2 (2026-10-18).

## Register
- Address: informal "sinä / sinun / sinulle", 2nd-person singular imperatives ("Valitse", "Kirjoita", "Napsauta", "Yritä uudelleen", "Tarkista"); never "Te / teidän" or plural/polite "-kaa/-kää" imperatives ("Valitkaa").
- Buttons and menu commands: imperative or noun as Office does ("Tallenna", "Lisää taulukko", "Avaa"); questions in confirmation dialogs use the passive ("Poistetaanko …?") or "Haluatko …?".
- Placeholders are never inflected: phrasing is arranged so that "{name}", "{connection}" stay in the nominative (e.g. "palvelussa {connection}", "Poista {name}").
- Ellipsis "…" for commands that open a dialog, as in English.
- Decimal comma, space as thousands separator, "A–Ö" for sorting; the English "A to Z" becomes "A–Ö".
- Keyboard key names in shortcut texts (packages/ui-shared/src/i18n/keyNames.ts): Ctrl = Ctrl, Shift = Vaihto, Delete = Delete, Enter = Enter.
- Plural categories: `one / other`; after a number Finnish uses the singular, so counts are phrased "{count} sana" / "{count} sanaa" (partitive in `other`).
- Terms: document = "asiakirja" (Word), workbook = "työkirja", presentation = "esitys", slide = "dia"; worksheet and sheet = "taulukko" (as Excel does), Excel table = "taulukko", PivotTable = "pivot-taulukko".

## Ribbon tabs
| English | Office term | Note |
| --- | --- | --- |
| File | Tiedosto | |
| Home | Aloitus | |
| Insert | Lisää | |
| Draw | Piirrä | |
| Design | Rakenne | Word/PowerPoint "Rakenne" |
| Layout (Write: Layout, Calc: Page Layout) | Asettelu / Sivun asettelu | Calc: "Sivun asettelu" |
| References | Viittaukset | Write |
| Mailings | Postitukset | Write |
| Review | Tarkista | |
| View | Näytä | |
| Formulas | Kaavat | Calc |
| Data | Tiedot | Calc |
| Transitions | Siirtymät | Show |
| Animations | Animaatiot | Show |
| Slide Show | Diaesitys | Show |
| Help | Ohje | |
| Picture / Table / Chart / Drawing Tools (contextual) | Kuvatyökalut / Taulukkotyökalut / Kaaviotyökalut / Piirtotyökalut | |

## Ribbon groups
| English | Office term | Note |
| --- | --- | --- |
| Clipboard | Leikepöytä | |
| Font | Fontti | |
| Paragraph | Kappale | |
| Styles | Tyylit | |
| Editing | Muokkaus | |
| Number | Luku | Calc |
| Alignment | Tasaus | Calc |
| Cells | Solut | Calc |
| Slides | Diat | Show |
| Drawing | Piirtäminen | Show |
| Zoom | Zoomaus | |
| Show (View › Show) | Näytä | |
| Language | Kieli | the picker; label "Kieli / Language" |

## Common commands
| English | Office term | Note |
| --- | --- | --- |
| New | Uusi | |
| Open… | Avaa… | |
| Save | Tallenna | |
| Save As… | Tallenna nimellä… | |
| Print | Tulosta | |
| Export PDF… | Vie PDF-muotoon… | |
| Close | Sulje | |
| Options… | Asetukset… | |
| Undo / Redo | Kumoa / Tee uudelleen | |
| Cut / Copy / Paste | Leikkaa / Kopioi / Liitä | |
| Paste Special… | Liitä kohdistetusti… | |
| Format Painter | Muotoilusivellin | |
| Find / Replace… / Go To… | Etsi / Korvaa… / Siirry… | |
| Select All | Valitse kaikki | |
| Bold / Italic / Underline / Strikethrough | Lihavointi / Kursivointi / Alleviivaus / Yliviivaus | |
| Font Color / Highlight / Fill Color | Fontin väri / Tekstin korostusväri / Täyttöväri | |
| Insert Picture / Table / Chart / Shape / Text Box | Lisää kuva / taulukko / kaavio / muoto / tekstiruutu | |
| Bring to Front / Send to Back | Tuo eteen / Vie taakse | |
| Group / Ungroup | Ryhmitä / Pura ryhmitys | |
| Sort / Filter | Lajittele / Suodata | Calc |
| Insert Function | Lisää funktio | Calc |
| New Slide | Uusi dia | Show |
| From Beginning / From Current Slide | Alusta / Nykyisestä diasta | Show |
| Track Changes / Comments | Muutosten jäljitys / Kommentit | Write (the catalog uses "Jäljitys" for the group) |

## Commands as used in the catalogs
The terms the catalogs use after the review (P9-LR2), one row per English command; the key shows where.

| English | Term | Key |
| --- | --- | --- |
| Copy | Kopioi | `ai.pane.copy` |
| Save | Tallenna | `ai.settings.save` |
| Insert | Lisää | `ai.write.insert` |
| Close | Sulje | `backstage.close` |
| New | Uusi | `backstage.new` |
| Open… | Avaa… | `backstage.open` |
| Options… | Asetukset… | `backstage.options` |
| Print | Tulosta | `backstage.print` |
| Save As… | Tallenna nimellä… | `backstage.saveAs` |
| Cut | Leikkaa | `cmd.cut` |
| Delete | Poista | `cmd.delete` |
| Find | Etsi | `cmd.find` |
| Paste | Liitä | `cmd.paste` |
| Redo | Tee uudelleen | `cmd.redo` |
| Replace… | Korvaa… | `cmd.replaceDots` |
| Undo | Kumoa | `cmd.undo` |
| Size | Koko | `conn.browser.colSize` |
| Rename | Nimeä uudelleen | `conn.browser.rename` |
| Bold | Lihavointi | `fmt.bold` |
| Borders | Reunukset | `fmt.borders` |
| Colors | Värit | `fmt.colors` |
| Italic | Kursivointi | `fmt.italic` |
| Strikethrough | Yliviivaus | `fmt.strike` |
| Underline | Alleviivaus | `fmt.underline` |
| Zoom | Zoomaus | `group.zoom` |
| Layout | Asettelu | `print.layoutSection` |
| Margins | Marginaalit | `print.margins` |
| Normal | Normaali | `print.margins.normal` |
| Orientation | Suunta | `print.orientation` |
| Format | Muotoile | `sc.format` |
| Remove Arrows | Poista nuolet | `calc.audit.removeArrows` |
| Show Formulas | Näytä kaavat | `calc.audit.showFormulas` |
| Trace Dependents | Jäljitä seuraajat | `calc.audit.traceDependents` |
| Trace Precedents | Jäljitä edeltäjät | `calc.audit.tracePrecedents` |
| Breaks | Sivunvaihdot | `calc.breaks` |
| Fill | Täyttö | `calc.cf.barFill` |
| Clear | Tyhjennä | `calc.cf.clearFormat` |
| Shapes | Muodot | `calc.cf.iconGroup.shapes` |
| Conditional Formatting | Ehdollinen muotoilu | `calc.cf.menu` |
| Gridlines | Ruudukko | `calc.chart.ae.gridlines` |
| Chart | Kaavio | `calc.chart.chart` |
| Center | Keskellä | `calc.chart.pos.center` |
| Recommended Charts | Suositellut kaaviot | `calc.chart.recommended` |
| Shape Fill | Muodon täyttö | `calc.chart.shapeFill` |
| Shape Outline | Muodon ääriviiva | `calc.chart.shapeOutline` |
| New Comment | Uusi kommentti | `calc.comments.new` |
| Comment | Kommentti | `calc.comments.textLabel` |
| Consolidate | Yhdistä | `calc.consolidate.button` |
| Delete Cells… | Poista solut… | `calc.deleteCellsDots` |
| Remove Duplicates | Poista kaksoiskappaleet | `calc.dup.button` |
| Columns | Sarakkeet | `calc.dup.columns` |
| Select All | Valitse kaikki | `calc.dup.selectAll` |
| Data Validation | Tietojen kelpoisuuden tarkistus | `calc.dv.button` |
| Filter | Suodata | `calc.filter` |
| Font Color | Fontin väri | `calc.filter.byFontColor` |
| Flash Fill | Pikatäyttö | `calc.flash.button` |
| Effects | Tehosteet | `calc.fmt.effects` |
| Justify | Tasaa molemmat reunat | `calc.fmt.h.justify` |
| Indent | Sisennys | `calc.fmt.indent` |
| Preview | Esikatselu | `calc.fmt.preview` |
| Subscript | Alaindeksi | `calc.fmt.subscript` |
| Superscript | Yläindeksi | `calc.fmt.superscript` |
| Symbol | Symboli | `calc.fmt.symbol` |
| AutoSum | Automaattinen summa | `calc.fn.autoSum` |
| Insert Function | Lisää funktio | `calc.fn.insert` |
| Format Painter | Muotoilusivellin | `calc.formatPainter` |
| Freeze Panes | Lukitse ruudut | `calc.freezePanes` |
| Goal Seek… | Tavoitteen haku… | `calc.goal.dots` |
| What-If Analysis | Entä jos -analyysi | `calc.goal.whatIf` |
| Hide | Piilota | `calc.hide` |
| Insert Cells… | Lisää solut… | `calc.insertCellsDots` |
| Link | Linkki | `calc.link.button` |
| Merge Cells | Yhdistä solut | `calc.mergeCells` |
| Merge & Center | Yhdistä ja keskitä | `calc.mergeCenter` |
| Move or Copy… | Siirrä tai kopioi… | `calc.moveCopy.dots` |
| Define Name | Määritä nimi | `calc.names.define` |
| Name Manager | Nimien hallinta | `calc.names.manager` |
| Group | Ryhmitä | `calc.outline.group` |
| Ungroup | Pura ryhmitys | `calc.outline.ungroup` |
| Page Setup | Sivun asetukset | `calc.pageSetup` |
| Pictures | Kuvat | `calc.picture.button` |
| PivotTable | Pivot-taulukko | `calc.pivot.pivotTable` |
| Refresh All | Päivitä kaikki | `calc.pivot.refreshAll` |
| Styles | Tyylit | `calc.pivot.stylesGallery` |
| Print Area | Tulostusalue | `calc.printArea` |
| Print Titles | Tulosta otsikot | `calc.printTitles` |
| Sort | Lajitella | `calc.protect.allow.sort` |
| Protect Workbook | Suojaa työkirja | `calc.protect.bookDots` |
| Protect Sheet… | Suojaa taulukko… | `calc.protect.sheetDots` |
| Paste Special… | Liitä kohdistetusti… | `calc.ps.dots` |
| Error Checking | Virheentarkistus | `calc.err.dialogTitle` |
| Previous | Edellinen | `calc.err.previous` |
| Next | Seuraava | `calc.err.next` |
| Evaluate Formula | Laske kaava | `calc.eval.title` |
| Watch Window | Tarkkailuikkuna | `calc.watch.title` |
| Calculate Now | Laske nyt | `calc.calc.now` |
| Sort & Filter | Lajittele ja suodata | `calc.sortFilter` |
| Subtotal | Välisumma | `calc.subtotal.button` |
| Properties | Ominaisuudet | `calc.table.properties` |
| Table | Taulukko | `calc.table.table` |
| Unhide | Näytä | `calc.unhide` |
| Text to Columns | Teksti sarakkeisiin | `calc.wizard.ttcButton` |
| Align Left | Tasaa vasemmalle | `write.alignObj.left` |
| Align Right | Tasaa oikealle | `write.alignObj.right` |
| Align | Tasaa | `write.alignObjects` |
| Bookmark | Kirjanmerkki | `write.bookmark.button` |
| Insert Caption | Lisää kuvateksti | `write.caption.button` |
| Equation | Yhtälö | `write.caption.equation` |
| Position | Sijainti | `write.caption.position` |
| Crop | Rajaa | `write.crop` |
| Spacing | Väli | `write.font.spacing` |
| Bring Forward | Tuo eteenpäin | `write.order.bringForward` |
| Bring to Front | Tuo eteen | `write.order.bringToFront` |
| Send Backward | Vie taaksepäin | `write.order.sendBackward` |
| Send to Back | Vie taakse | `write.order.sendToBack` |
| Picture | Kuva | `write.picture` |
| Section | Osa | `write.reveal.section` |
| Rotate | Kierrä | `write.rotate` |
| Ruler | Viivain | `write.ruler` |
| Selection Pane | Valintaruutu | `write.selectionPane` |
| Spelling | Oikoluku | `write.spelling` |
| Split Cells | Jaa solut | `write.splitCells` |
| Hyperlink | Hyperlinkki | `write.styleName.hyperlink` |
| Numbering… | Numerointi… | `write.styles.format.numbering` |
| Text Box | Tekstiruutu | `write.textBox` |
| Wrap Text | Tekstin rivitys | `write.wrapText` |
| Cross-reference | Ristiviittaus | `write.xref.button` |
| Footnote | Alaviite | `write.xref.footnote` |
| Reset | Palauta | `write.notes.sep.reset` |
| Format Background | Muotoile tausta | `show.bg.format` |
| Background Styles | Taustatyylit | `show.bg.styles` |
| Fonts | Fontit | `show.design.fonts` |
| Themes | Teemat | `show.design.themes` |
| Header & Footer… | Ylä- ja alatunniste… | `show.hf.titleDots` |
| Slide Master | Diamalli | `show.master.tab` |
| Slide Size | Dian koko | `show.size.customTitle` |
| Set Up Slide Show | Määritä diaesitys | `show.setup.titleDots` |
| Guides | Apuviivat | `show.view.guides` |
| Notes Page | Muistiinpanosivu | `show.view.notesPage` |
| Outline View | Jäsennysnäkymä | `show.view.outline` |
| Reading View | Lukunäkymä | `show.view.reading` |
| Slide Sorter | Diajärjestelijä | `show.view.sorter` |
| Edit Points | Muokkaa pisteitä | `show.editPoints` |
| Fill Color | Täyttöväri | `show.fx.fillColor` |
| Animation Painter | Animaatiosivellin | `show.animPainter` |
| From Current Slide… | Nykyisestä diasta… | `show.recordFromCurrent` |
| From Beginning… | Alusta… | `show.recordFromStart` |

## Dialog buttons and messages
| English | Office term | Note |
| --- | --- | --- |
| OK | OK | |
| Cancel | Peruuta | |
| Apply | Käytä | |
| Close | Sulje | |
| Yes / No | Kyllä / Ei | |
| Don't Save | Älä tallenna | the unsaved-changes prompt |
| Browse… | Selaa… | |
| Reset | Palauta | |
| Insert / Delete | Lisää / Poista | |
| Back / Next / Finish | Edellinen / Seuraava / Valmis | wizards |
| Recent | Viimeisimmät | backstage |
| Untitled | Nimetön | default document name |
| Saved / Saving… / Unsaved changes | Tallennettu / Tallennetaan… / Tallentamattomat muutokset | status bar |

## File types
| English | Office term | Note |
| --- | --- | --- |
| Excel Workbook | Excel-työkirja | `.xlsx`, the desktop dialog filter name |
| Word Document | Word-asiakirja | `.docx` |
| PowerPoint Presentation | PowerPoint-esitys | `.pptx` |
| Excel Template / Word Template / PowerPoint Template | Excel-malli / Word-malli / PowerPoint-malli | `.xltx` / `.dotx` / `.potx` |
| CSV (Comma delimited) | CSV (pilkuilla eroteltu) | Calc |
| Text Files | Tekstitiedostot | |
| PDF | PDF | |
| Office Theme | Office-teema | `.thmx` |
| All Files | Kaikki tiedostot | |

## Show effects and transitions
Animation effects (`show.fx.*`) and slide transitions (`show.trans.*`), named as in the PowerPoint localisation.

| English | Term | Key |
| --- | --- | --- |
| Appear | Ilmesty | `show.fx.appear` |
| Disappear | Katoa | `show.fx.disappear` |
| Fade | Häivytys | `show.fx.fade` |
| Fly In | Lennä sisään | `show.fx.flyIn` |
| Fly Out | Lennä ulos | `show.fx.flyOut` |
| Grow/Shrink | Suurenna/pienennä | `show.fx.growShrink` |
| Spin | Pyöritä | `show.fx.spin` |
| Wipe | Pyyhkäisy | `show.fx.wipe` |
| Zoom | Zoomaus | `show.fx.zoom` |
| Cover | Peitä | `show.trans.cover` |
| Cut | Leikkaus | `show.trans.cut` |
| Fade | Häivytys | `show.trans.fade` |
| None | Ei mitään | `show.trans.none` |
| Push | Työntö | `show.trans.push` |
| Split | Jako | `show.trans.split` |
| Wipe | Pyyhkäisy | `show.trans.wipe` |
| Zoom | Zoomaus | `show.trans.zoom` |
| Morph | Muodonmuutos | `show.trans.morph` |
| Reveal | Paljastus | `show.trans.reveal` |
| Shred | Silppuri | `show.trans.shred` |
| Fall Over | Kaatuminen | `show.trans.fallOver` |
| Drape | Verho | `show.trans.drape` |
| Curtains | Esirippu | `show.trans.curtains` |
| Wind | Tuuli | `show.trans.wind` |
| Prestige | Prestige | `show.trans.prestige` |
| Fracture | Murtuma | `show.trans.fracture` |
| Crush | Murskaus | `show.trans.crush` |
| Peel Off | Kuoriminen | `show.trans.peelOff` |
| Page Curl | Sivun kääntö | `show.trans.pageCurl` |
| Airplane | Lentokone | `show.trans.airplane` |
| Origami | Origami | `show.trans.origami` |
| Honeycomb | Hunajakenno | `show.trans.honeycomb` |
| Glitter | Kimallus | `show.trans.glitter` |
| Vortex | Pyörre | `show.trans.vortex` |
| Ripple | Väreily | `show.trans.ripple` |
| Switch | Vaihto | `show.trans.switch` |
| Flip | Käännös | `show.trans.flip` |
| Gallery | Galleria | `show.trans.gallery` |
| Cube | Kuutio | `show.trans.cube` |
| Doors | Ovet | `show.trans.doors` |
| Box | Laatikko | `show.trans.box` |
| Float In | Leiju sisään | `show.fx.float` |
| Float Out | Leiju ulos | `show.fx.floatOut` |
| Split | Jako | `show.fx.split` |
| Shape | Muoto | `show.fx.shape` |
| Circle | Ympyrä | `show.fx.circle` |
| Box | Laatikko | `show.fx.box` |
| Diamond | Vinoneliö | `show.fx.diamond` |
| Plus | Plus | `show.fx.plus` |
| Wheel | Pyörä | `show.fx.wheel` |
| Random Bars | Satunnaiset palkit | `show.fx.randomBars` |
| Grow & Turn | Kasvata ja käännä | `show.fx.growTurn` |
| Shrink & Turn | Kutista ja käännä | `show.fx.shrinkTurn` |
| Swivel | Kääntö | `show.fx.swivel` |
| Bounce | Pomppu | `show.fx.bounce` |
| Pulse | Sykäys | `show.fx.pulse` |
| Color Pulse | Värisykäys | `show.fx.colorPulse` |
| Teeter | Huojunta | `show.fx.teeter` |
| Desaturate | Vähennä kylläisyyttä | `show.fx.desaturate` |
| Darken | Tummenna | `show.fx.darken` |
| Lighten | Vaalenna | `show.fx.lighten` |
| Transparency | Läpinäkyvyys | `show.fx.transparency` |
| Object Color | Objektin väri | `show.fx.objectColor` |
| Line Color | Viivan väri | `show.fx.lineColor` |
| Fill Color | Täyttöväri | `show.fx.fillColor` |
| Brush Color | Siveltimen väri | `show.fx.brushColor` |
| Font Color | Fontin väri | `show.fx.fontColor` |
| Underline | Alleviivaus | `show.fx.underline` |
| Bold Flash | Lihavoitu välähdys | `show.fx.boldFlash` |
| Bold Reveal | Lihavoitu paljastus | `show.fx.boldReveal` |
| Wave | Aalto | `show.fx.wave` |
| Lines | Viivat | `show.fx.pathLines` |
| Arcs | Kaaret | `show.fx.pathArcs` |
| Turns | Käännökset | `show.fx.pathTurns` |
| Shapes | Muodot | `show.fx.pathShapes` |
| Loops | Silmukat | `show.fx.pathLoops` |
| Custom Path | Mukautettu polku | `show.fx.pathCustom` |
| Play | Toista | `show.fx.mediaPlay` |
| Pause | Keskeytä | `show.fx.mediaPause` |
| Stop | Pysäytä | `show.fx.mediaStop` |

## More terms
| English | Office term | Note |
| --- | --- | --- |
| PivotTable / PivotChart | Pivot-taulukko / Pivot-kaavio | |
| Slicer | Viipaloija | |
| Flash Fill | Pikatäyttö | |
| Conditional Formatting | Ehdollinen muotoilu | |
| Data Validation | Tietojen kelpoisuuden tarkistus | |
| Slide master | Diamalli | |
| Speaker notes | Esittäjän muistiinpanot | |
| Presenter view | Esittäjänäkymä | |
| Bookmark | Kirjanmerkki | Write |
| Cross-reference | Ristiviittaus | Write |
| Footnote / Endnote | Alaviite / Loppuviite | Write |
| Header / Footer | Ylätunniste / Alatunniste | |
| Style set | Tyylijoukko | Write |
| Defined name / Name Manager | Määritetty nimi / Nimien hallinta | Calc |
| Goal Seek | Tavoitteen haku | Calc |
| Freeze Panes | Lukitse ruudut | Calc |
| Remove Duplicates | Poista kaksoiskappaleet | Calc |
| Text to Columns | Teksti sarakkeisiin | Calc |
| Placeholder (slide) | Paikkamerkki | Show |
| Spill (dynamic array) | Ylivuoto | Calc |
| Ribbon | Valintanauha | |
| Caption | Kuvateksti | Write |
| Callout (shape) | Huomioteksti | |
| Morph | Muodonmuutos | transition |
| Poster Frame | Julistekehys | PowerPoint media |
| Clip (media) | Leike | |
| Double (line, underline, spacing) | Kaksinkertainen | |
| Split (View) | Jaa | Calc (P9-LF); the transition is Jako |
| Go To Special… / Special… | Siirry määräten… / Määräten… | Calc |
| Picture Format / Alt Text | Kuvan muotoilu / Vaihtoehtoinen teksti | Calc |
| Mention someone | Mainitse joku | Calc comments |
| Reasoning (AI setting, reasoning_effort) | Päättely | Settings › AI, actions (P9-LF pass 2) |
| dropped (reader warnings) | jätetty pois | `reader.xlsx.*` / `reader.pptx.*`, as in `reader.docx.*` |
| read as (reader warnings) | luettu …na | reader warnings |
| dangling relationship | irrallinen suhde | reader warnings |
| Custom show (PowerPoint) | Mukautettu esitys | `reader.pptx.customShow.*` |
| Pivot cache | pivot-välimuisti | `reader.xlsx.pivotCache.*` |

## Touch, compact layout and PDF export (P10-LF, 2026-10-23)

One term per gesture across the five catalogs (cycle 3.1415: ui-shared compact bars and sheets, the touch UI of Calc/Write/Show, PDF export, the portal's signing texts).

| English | Term | Used in |
| --- | --- | --- |
| tap | napauttaa ("Napauta …") | `calc.keys.ref`, `calc.stats.next`, `show.touch.tapToPlay` |
| long press | pitkä painallus | (context menu as a sheet; no catalog text yet) |
| pinch | nipistää | (zoom; no catalog text yet) |
| swipe | pyyhkäistä | (no catalog text yet) |
| selection handle | kahva | `write.touch.handleStart` / `handleEnd` |
| bottom sheet | paneeli (ei "taulukko" = worksheet) | `compact.moreSheet`, `compact.closeSheet` (aria labels) |
| fingerprint (GPG) | sormenjälki | `portal.dl.signed.linux`, `portal.dl.sums.text` |
| release key | julkaisuavain | `portal.dl.signed.linux`, `portal.dl.sums.text` |
| notarized (Apple) | notarisoitu | `portal.dl.signed.macos` |
| More | Lisää | `compact.more` |
| More commands | Lisää komentoja | `compact.moreSheet` |
| Fill | Täyttö | `calc.touch.fill` |
| Fill series | Täytä sarja | `calc.touch.fillSeries` |
| Copy cells | Kopioi solut | `calc.touch.copyCells` |
| Ref | Viit. | `calc.keys.refShort` |
| Share as PDF… | Jaa PDF-tiedostona… | `backstage.sharePdf` |
| Export PDF | Vie PDF-muotoon | `print.exportPdf` |
| Multi-select | Monivalinta | `show.touch.multiSelect` |
