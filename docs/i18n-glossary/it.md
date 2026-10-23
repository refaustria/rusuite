# Glossary: Italian (`it`)

Source: Microsoft Office Italian localisation (Word, Excel, PowerPoint 365 ribbon, dialogs and Microsoft's terminology portal). Translator: P9-L2. Reviewer: P9-LR1 (2026-10-17).

## Register
- Address: informal "tu / ti / tuo"; never "Lei / La / Suo" and no "La preghiamo". Imperatives in the familiar form ("Scegli", "Inserisci", "Digita", "Riprova").
- Buttons and menu commands: infinitive/imperative as Office does ("Salva", "Apri", "Inserisci", "Elimina"); ribbon group labels are nouns.
- Ellipsis "…" for commands that open a dialog, as in English.
- Keyboard key names (packages/ui-shared/src/i18n/keyNames.ts): Ctrl = Ctrl, Shift = Maiusc, Delete = Canc, Enter = Invio.
- Formula language stays English (SUM, TRUE, `#REF!`); only prose around it is translated.
- Plural categories: `one / many / other`; `many` (millions) puts "di" before the noun ("{count} di pagine" = "1.000.000 di pagine"); unit abbreviations ("{count} h fa") stay as in `other`.

## Ribbon tabs
| English | Office term | Note |
| --- | --- | --- |
| File | File | |
| Home | Home | |
| Insert | Inserisci | |
| Draw | Disegna | |
| Design | Progettazione | Word/PowerPoint/Excel table and chart tools |
| Layout | Layout | Calc: Layout di pagina |
| References | Riferimenti | Write |
| Mailings | Lettere | Write |
| Review | Revisione | |
| View | Visualizza | |
| Formulas | Formule | Calc |
| Data | Dati | Calc |
| Transitions | Transizioni | Show |
| Animations | Animazioni | Show |
| Slide Show | Presentazione | Show |
| Help | Guida | |
| Picture / Table / Chart / Drawing Tools | Strumenti immagine / tabella / grafico / di disegno | contextual |

## Ribbon groups
| English | Office term | Note |
| --- | --- | --- |
| Clipboard | Appunti | |
| Font | Carattere | |
| Paragraph | Paragrafo | |
| Styles | Stili | |
| Editing | Modifica | |
| Number | Numero | Calc |
| Alignment | Allineamento | Calc |
| Cells | Celle | Calc |
| Slides | Diapositive | Show |
| Drawing | Disegno | Show |
| Zoom | Zoom | |
| Show (View › Show) | Mostra | |
| Language | Lingua / Language | picker label |

## Common commands
| English | Office term | Note |
| --- | --- | --- |
| New | Nuovo | |
| Open… | Apri… | |
| Save | Salva | |
| Save As… | Salva con nome… | |
| Print | Stampa | |
| Export PDF… | Esporta PDF… | |
| Close | Chiudi | |
| Options… | Opzioni… | |
| Undo / Redo | Annulla / Ripristina | Office Italian |
| Cut / Copy / Paste | Taglia / Copia / Incolla | |
| Paste Special… | Incolla speciale… | |
| Format Painter | Copia formato | |
| Find / Replace… / Go To… | Trova / Sostituisci… / Vai a… | |
| Select All | Seleziona tutto | |
| Bold / Italic / Underline / Strikethrough | Grassetto / Corsivo / Sottolineato / Barrato | |
| Font Color / Highlight / Fill Color | Colore carattere / Evidenzia / Colore riempimento | |
| Insert Picture / Table / Chart / Shape / Text Box | Immagine / Tabella / Grafico / Forma / Casella di testo | |
| Bring to Front / Send to Back | Porta in primo piano / Porta in secondo piano | |
| Group / Ungroup | Raggruppa / Separa | Office uses "Separa" for ungroup |
| Sort / Filter | Ordina / Filtro | Calc |
| Insert Function | Inserisci funzione | Calc |
| New Slide | Nuova diapositiva | Show |
| From Beginning / From Current Slide | Dall'inizio / Dalla diapositiva corrente | Show |
| Track Changes / Comments | Revisioni / Commenti | Write |
| Paste Values | Incolla valori | |
| Merge & Center | Unisci e centra | |
| Freeze Panes | Blocca riquadri | |
| Conditional Formatting | Formattazione condizionale | |
| Data Validation | Convalida dati | |
| Flash Fill | Riempimento veloce | |
| Goal Seek | Ricerca obiettivo | |
| PivotTable / PivotChart | Tabella pivot / Grafico pivot | |
| Slicer | Filtro dati | |
| Header & Footer | Intestazione e piè di pagina | |
| Table of Contents | Sommario | |
| Footnote / Endnote | Nota a piè di pagina / Nota di chiusura | |
| Cross-reference | Riferimento incrociato | |
| Bookmark | Segnalibro | |
| Hyperlink | Collegamento ipertestuale | |
| Page Setup | Imposta pagina | |
| Print Preview | Anteprima di stampa | |
| Speaker notes | Note del relatore | |
| Presenter view | Visualizzazione relatore | |
| Slide Master | Schema diapositiva | |
| Slide Sorter | Sequenza diapositive | |
| Section | Sezione | |
| Report a problem… | Segnala un problema… | |

## Commands as used in the catalogs
The terms the catalogs use after the review (P9-LR1), one row per English command; the key shows where.

| English | Term | Key |
| --- | --- | --- |
| Copy | Copia | `ai.pane.copy` |
| Save | Salva | `ai.settings.save` |
| Insert | Inserisci | `ai.write.insert` |
| Close | Chiudi | `backstage.close` |
| New | Nuovo | `backstage.new` |
| Open… | Apri… | `backstage.open` |
| Options… | Opzioni… | `backstage.options` |
| Print | Stampa | `backstage.print` |
| Save As… | Salva con nome… | `backstage.saveAs` |
| Cut | Taglia | `cmd.cut` |
| Delete | Elimina | `cmd.delete` |
| Find | Trova | `cmd.find` |
| Paste | Incolla | `cmd.paste` |
| Redo | Ripristina | `cmd.redo` |
| Replace… | Sostituisci… | `cmd.replaceDots` |
| Undo | Annulla | `cmd.undo` |
| Size | Dimensioni | `conn.browser.colSize` |
| Rename | Rinomina | `conn.browser.rename` |
| Bold | Grassetto | `fmt.bold` |
| Borders | Bordi | `fmt.borders` |
| Colors | Colori | `fmt.colors` |
| Italic | Corsivo | `fmt.italic` |
| Strikethrough | Barrato | `fmt.strike` |
| Underline | Sottolineato | `fmt.underline` |
| Zoom | Zoom | `group.zoom` |
| Layout | Layout | `print.layoutSection` |
| Margins | Margini | `print.margins` |
| Normal | Normali | `print.margins.normal` |
| Orientation | Orientamento | `print.orientation` |
| Format | Formato | `sc.format` |
| Remove Arrows | Rimuovi frecce | `calc.audit.removeArrows` |
| Show Formulas | Mostra formule | `calc.audit.showFormulas` |
| Trace Dependents | Individua dipendenti | `calc.audit.traceDependents` |
| Trace Precedents | Individua precedenti | `calc.audit.tracePrecedents` |
| Breaks | Interruzioni | `calc.breaks` |
| Fill | Riempimento | `calc.cf.barFill` |
| Clear | Cancella | `calc.cf.clearFormat` |
| Shapes | Forme | `calc.cf.iconGroup.shapes` |
| Conditional Formatting | Formattazione condizionale | `calc.cf.menu` |
| Gridlines | Griglia | `calc.chart.ae.gridlines` |
| Chart | Grafico | `calc.chart.chart` |
| Center | Al centro | `calc.chart.pos.center` |
| Recommended Charts | Grafici consigliati | `calc.chart.recommended` |
| Shape Fill | Riempimento forma | `calc.chart.shapeFill` |
| Shape Outline | Contorno forma | `calc.chart.shapeOutline` |
| New Comment | Nuovo commento | `calc.comments.new` |
| Comment | Commento | `calc.comments.textLabel` |
| Consolidate | Consolida | `calc.consolidate.button` |
| Delete Cells… | Elimina celle… | `calc.deleteCellsDots` |
| Remove Duplicates | Rimuovi duplicati | `calc.dup.button` |
| Columns | Colonne | `calc.dup.columns` |
| Select All | Seleziona tutto | `calc.dup.selectAll` |
| Data Validation | Convalida dati | `calc.dv.button` |
| Filter | Filtro | `calc.filter` |
| Font Color | Colore carattere | `calc.filter.byFontColor` |
| Flash Fill | Riempimento veloce | `calc.flash.button` |
| Effects | Effetti | `calc.fmt.effects` |
| Justify | Giustificato | `calc.fmt.h.justify` |
| Indent | Rientro | `calc.fmt.indent` |
| Preview | Anteprima | `calc.fmt.preview` |
| Subscript | Pedice | `calc.fmt.subscript` |
| Superscript | Apice | `calc.fmt.superscript` |
| Symbol | Simbolo | `calc.fmt.symbol` |
| AutoSum | Somma automatica | `calc.fn.autoSum` |
| Insert Function | Inserisci funzione | `calc.fn.insert` |
| Format Painter | Copia formato | `calc.formatPainter` |
| Freeze Panes | Blocca riquadri | `calc.freezePanes` |
| Goal Seek… | Ricerca obiettivo… | `calc.goal.dots` |
| What-If Analysis | Analisi di simulazione | `calc.goal.whatIf` |
| Hide | Nascondi | `calc.hide` |
| Insert Cells… | Inserisci celle… | `calc.insertCellsDots` |
| Link | Collegamento | `calc.link.button` |
| Merge Cells | Unisci celle | `calc.mergeCells` |
| Merge & Center | Unisci e centra | `calc.mergeCenter` |
| Move or Copy… | Sposta o copia… | `calc.moveCopy.dots` |
| Define Name | Definisci nome | `calc.names.define` |
| Name Manager | Gestione nomi | `calc.names.manager` |
| Group | Raggruppa | `calc.outline.group` |
| Ungroup | Separa | `calc.outline.ungroup` |
| Page Setup | Imposta pagina | `calc.pageSetup` |
| Pictures | Immagini | `calc.picture.button` |
| PivotTable | Tabella pivot | `calc.pivot.pivotTable` |
| Refresh All | Aggiorna tutto | `calc.pivot.refreshAll` |
| Styles | Stili | `calc.pivot.stylesGallery` |
| Print Area | Area di stampa | `calc.printArea` |
| Print Titles | Stampa titoli | `calc.printTitles` |
| Sort | Ordinare | `calc.protect.allow.sort` |
| Protect Workbook | Proteggi cartella di lavoro | `calc.protect.bookDots` |
| Protect Sheet… | Proteggi foglio… | `calc.protect.sheetDots` |
| Paste Special… | Incolla speciale… | `calc.ps.dots` |
| Error Checking | Controllo errori | `calc.err.dialogTitle` |
| Previous | Indietro | `calc.err.previous` |
| Next | Avanti | `calc.err.next` |
| Evaluate Formula | Valuta formula | `calc.eval.title` |
| Watch Window | Controlla finestra | `calc.watch.title` |
| Calculate Now | Calcola ora | `calc.calc.now` |
| Sort & Filter | Ordina e filtra | `calc.sortFilter` |
| Subtotal | Subtotale | `calc.subtotal.button` |
| Properties | Proprietà | `calc.table.properties` |
| Table | Tabella | `calc.table.table` |
| Unhide | Scopri | `calc.unhide` |
| Text to Columns | Testo in colonne | `calc.wizard.ttcButton` |
| Align Left | Allinea a sinistra | `write.alignObj.left` |
| Align Right | Allinea a destra | `write.alignObj.right` |
| Align | Allinea | `write.alignObjects` |
| Bookmark | Segnalibro | `write.bookmark.button` |
| Insert Caption | Inserisci didascalia | `write.caption.button` |
| Equation | Equazione | `write.caption.equation` |
| Position | Posizione | `write.caption.position` |
| Crop | Ritaglia | `write.crop` |
| Spacing | Spaziatura | `write.font.spacing` |
| Bring Forward | Porta avanti | `write.order.bringForward` |
| Bring to Front | Porta in primo piano | `write.order.bringToFront` |
| Send Backward | Porta indietro | `write.order.sendBackward` |
| Send to Back | Porta in secondo piano | `write.order.sendToBack` |
| Picture | Immagine | `write.picture` |
| Section | Sezione | `write.reveal.section` |
| Rotate | Ruota | `write.rotate` |
| Ruler | Righello | `write.ruler` |
| Selection Pane | Riquadro di selezione | `write.selectionPane` |
| Spelling | Controllo ortografia | `write.spelling` |
| Split Cells | Dividi celle | `write.splitCells` |
| Hyperlink | Collegamento ipertestuale | `write.styleName.hyperlink` |
| Numbering… | Numerazione… | `write.styles.format.numbering` |
| Text Box | Casella di testo | `write.textBox` |
| Wrap Text | Disposizione testo | `write.wrapText` |
| Cross-reference | Riferimento incrociato | `write.xref.button` |
| Footnote | Nota a piè di pagina | `write.xref.footnote` |
| Reset | Reimposta | `write.notes.sep.reset` |
| Format Background | Formato sfondo | `show.bg.format` |
| Background Styles | Stili sfondo | `show.bg.styles` |
| Fonts | Caratteri | `show.design.fonts` |
| Themes | Temi | `show.design.themes` |
| Header & Footer… | Intestazione e piè di pagina… | `show.hf.titleDots` |
| Slide Master | Schema diapositiva | `show.master.tab` |
| Slide Size | Dimensioni diapositiva | `show.size.customTitle` |
| Set Up Slide Show | Imposta presentazione | `show.setup.titleDots` |
| Guides | Guide | `show.view.guides` |
| Notes Page | Pagina note | `show.view.notesPage` |
| Outline View | Visualizzazione struttura | `show.view.outline` |
| Reading View | Visualizzazione lettura | `show.view.reading` |
| Slide Sorter | Sequenza diapositive | `show.view.sorter` |
| Edit Points | Modifica punti | `show.editPoints` |
| Fill Color | Colore riempimento | `show.fx.fillColor` |
| Animation Painter | Copia animazione | `show.animPainter` |
| From Current Slide… | Dalla diapositiva corrente… | `show.recordFromCurrent` |
| From Beginning… | Dall'inizio… | `show.recordFromStart` |

## Dialog buttons and messages
| English | Office term | Note |
| --- | --- | --- |
| OK | OK | |
| Cancel | Annulla | |
| Apply | Applica | |
| Close | Chiudi | |
| Yes / No | Sì / No | |
| Don't Save | Non salvare | |
| Browse… | Sfoglia… | |
| Reset | Reimposta | |
| Insert / Delete | Inserisci / Elimina | |
| Back / Next / Finish | Indietro / Avanti / Fine | wizards |
| Recent | Recenti | |
| Untitled | Senza titolo | |
| Saved / Saving… / Unsaved changes | Salvato / Salvataggio… / Modifiche non salvate | |

## File types
| English | Office term | Note |
| --- | --- | --- |
| Excel Workbook | Cartella di lavoro di Excel | `.xlsx` |
| Word Document | Documento di Word | `.docx` |
| PowerPoint Presentation | Presentazione di PowerPoint | `.pptx` |
| Excel / Word / PowerPoint Template | Modello di Excel / Word / PowerPoint | |
| CSV (Comma delimited) | CSV (delimitato dal separatore di elenco) | |
| Text Files | File di testo | |
| PDF | PDF | |
| Office Theme | Tema di Office | `.thmx` |
| All Files | Tutti i file | |

## Show effects and transitions
Animation effects (`show.fx.*`) and slide transitions (`show.trans.*`), named as in the PowerPoint localisation.

| English | Term | Key |
| --- | --- | --- |
| Appear | Comparsa | `show.fx.appear` |
| Disappear | Scomparsa | `show.fx.disappear` |
| Fade | Dissolvenza | `show.fx.fade` |
| Fly In | Entrata veloce | `show.fx.flyIn` |
| Fly Out | Uscita veloce | `show.fx.flyOut` |
| Grow/Shrink | Ingrandisci/Riduci | `show.fx.growShrink` |
| Spin | Rotazione | `show.fx.spin` |
| Wipe | Apparizione | `show.fx.wipe` |
| Zoom | Zoom | `show.fx.zoom` |
| Cover | Copertura | `show.trans.cover` |
| Cut | Taglio | `show.trans.cut` |
| Fade | Dissolvenza | `show.trans.fade` |
| None | Nessuna | `show.trans.none` |
| Push | Spinta | `show.trans.push` |
| Split | Divisione | `show.trans.split` |
| Wipe | Apparizione | `show.trans.wipe` |
| Zoom | Zoom | `show.trans.zoom` |
| Morph | Trasformazione | `show.trans.morph` |
| Reveal | Rivelazione | `show.trans.reveal` |
| Shred | Frantumazione | `show.trans.shred` |
| Fall Over | Caduta | `show.trans.fallOver` |
| Drape | Drappeggio | `show.trans.drape` |
| Curtains | Tende | `show.trans.curtains` |
| Wind | Vento | `show.trans.wind` |
| Prestige | Prestigio | `show.trans.prestige` |
| Fracture | Frattura | `show.trans.fracture` |
| Crush | Schiacciamento | `show.trans.crush` |
| Peel Off | Distacco | `show.trans.peelOff` |
| Page Curl | Angolo di pagina | `show.trans.pageCurl` |
| Airplane | Aeroplano | `show.trans.airplane` |
| Origami | Origami | `show.trans.origami` |
| Honeycomb | Nido d'ape | `show.trans.honeycomb` |
| Glitter | Glitter | `show.trans.glitter` |
| Vortex | Vortice | `show.trans.vortex` |
| Ripple | Increspatura | `show.trans.ripple` |
| Switch | Interruttore | `show.trans.switch` |
| Flip | Capovolgimento | `show.trans.flip` |
| Gallery | Galleria | `show.trans.gallery` |
| Cube | Cubo | `show.trans.cube` |
| Doors | Porte | `show.trans.doors` |
| Box | Scatola | `show.trans.box` |
| Float In | Fluttuazione in ingresso | `show.fx.float` |
| Float Out | Fluttuazione in uscita | `show.fx.floatOut` |
| Split | Divisione | `show.fx.split` |
| Shape | Forma | `show.fx.shape` |
| Circle | Cerchio | `show.fx.circle` |
| Box | Riquadro | `show.fx.box` |
| Diamond | Rombo | `show.fx.diamond` |
| Plus | Più | `show.fx.plus` |
| Wheel | Ruota | `show.fx.wheel` |
| Random Bars | Barre casuali | `show.fx.randomBars` |
| Grow & Turn | Ingrandisci e ruota | `show.fx.growTurn` |
| Shrink & Turn | Riduci e ruota | `show.fx.shrinkTurn` |
| Swivel | Rotazione su perno | `show.fx.swivel` |
| Bounce | Rimbalzo | `show.fx.bounce` |
| Pulse | Impulso | `show.fx.pulse` |
| Color Pulse | Impulso colore | `show.fx.colorPulse` |
| Teeter | Oscillazione | `show.fx.teeter` |
| Desaturate | Desatura | `show.fx.desaturate` |
| Darken | Scurisci | `show.fx.darken` |
| Lighten | Schiarisci | `show.fx.lighten` |
| Transparency | Trasparenza | `show.fx.transparency` |
| Object Color | Colore oggetto | `show.fx.objectColor` |
| Line Color | Colore linea | `show.fx.lineColor` |
| Fill Color | Colore riempimento | `show.fx.fillColor` |
| Brush Color | Colore pennello | `show.fx.brushColor` |
| Font Color | Colore carattere | `show.fx.fontColor` |
| Underline | Sottolineato | `show.fx.underline` |
| Bold Flash | Lampeggiamento in grassetto | `show.fx.boldFlash` |
| Bold Reveal | Rivelazione in grassetto | `show.fx.boldReveal` |
| Wave | Onda | `show.fx.wave` |
| Lines | Linee | `show.fx.pathLines` |
| Arcs | Archi | `show.fx.pathArcs` |
| Turns | Curve | `show.fx.pathTurns` |
| Shapes | Forme | `show.fx.pathShapes` |
| Loops | Cicli | `show.fx.pathLoops` |
| Custom Path | Percorso personalizzato | `show.fx.pathCustom` |
| Play | Riproduci | `show.fx.mediaPlay` |
| Pause | Pausa | `show.fx.mediaPause` |
| Stop | Interrompi | `show.fx.mediaStop` |

## More terms
| English | Office term | Note |
| --- | --- | --- |
| Ribbon | Barra multifunzione | |
| Worksheet / Sheet | Foglio di lavoro / Foglio | |
| Workbook | Cartella di lavoro | |
| Spill | Riversamento | dynamic arrays |
| Named range / Name Manager | Nome definito / Gestione nomi | |
| Alt text | Testo alternativo | |
| Text box | Casella di testo | |
| Placeholder (slide) | Segnaposto | |
| Layout (slide) | Layout | |
| Transition | Transizione | |
| Morph | Trasformazione | |
| Comment thread | Thread di commenti | |
| AI | IA | not "AI" |
| Provider | Provider | AI provider, kept |
| Token | Token | |
| Connection | Connessione | WebDAV |
| Autosave | Salvataggio automatico | |
| Sparkline / Sparklines (Insert group) | Sparkline / Grafici sparkline | Calc (P9-LF) |
| Line / Column / Win/Loss (sparkline types) | Linee / Istogramma / Positivi/Negativi | Calc |
| Error Bars / Data Table | Barre di errore / Tabella dati | Calc charts |
| High-Low Lines / Up/Down Bars | Linee di massimo e minimo / Barre crescenti/decrescenti | Calc charts |
| Go To Special… | Vai a formato speciale… | Calc |
| Picture Format / Alt Text | Formato immagine / Testo alternativo | Calc |
| Reasoning (AI setting, reasoning_effort) | Ragionamento | Settings › AI, actions (P9-LF pass 2) |
| dropped (reader warnings) | eliminato/a/i/e | `reader.xlsx.*` / `reader.pptx.*`, as in `reader.docx.*` |
| read as (reader warnings) | letto/a come | reader warnings |
| dangling relationship | relazione non valida | reader warnings |
| Custom show (PowerPoint) | Presentazione personalizzata | `reader.pptx.customShow.*` |
| Pivot cache | cache pivot | `reader.xlsx.pivotCache.*` |

## Touch, compact layout and PDF export (P10-LF, 2026-10-23)

One term per gesture across the five catalogs (cycle 3.1415: ui-shared compact bars and sheets, the touch UI of Calc/Write/Show, PDF export, the portal's signing texts).

| English | Term | Used in |
| --- | --- | --- |
| tap | toccare ("Tocca …") | `calc.keys.ref`, `calc.stats.next`, `show.touch.tapToPlay` |
| long press | tocco prolungato | (context menu as a sheet; no catalog text yet) |
| pinch | pizzicare | (zoom; no catalog text yet) |
| swipe | scorrere | (no catalog text yet) |
| selection handle | quadratino di selezione | `write.touch.handleStart` / `handleEnd` |
| bottom sheet | pannello (mai "foglio" = worksheet) | `compact.moreSheet`, `compact.closeSheet` (aria labels) |
| fingerprint (GPG) | impronta digitale | `portal.dl.signed.linux`, `portal.dl.sums.text` |
| release key | chiave di rilascio | `portal.dl.signed.linux`, `portal.dl.sums.text` |
| notarized (Apple) | notarizzata | `portal.dl.signed.macos` |
| More | Altro | `compact.more` |
| More commands | Altri comandi | `compact.moreSheet` |
| Fill | Riempimento | `calc.touch.fill` |
| Fill series | Riempi serie | `calc.touch.fillSeries` |
| Copy cells | Copia celle | `calc.touch.copyCells` |
| Ref | Rif. | `calc.keys.refShort` |
| Share as PDF… | Condividi come PDF… | `backstage.sharePdf` |
| Export PDF | Esporta PDF | `print.exportPdf` |
| Multi-select | Selezione multipla | `show.touch.multiSelect` |
