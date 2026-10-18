# Glossary: Greek (`el`)

Source: the Greek (Greece) localisation of Microsoft Office (Word, Excel, PowerPoint) and its terminology. Translator: P9-L9. Reviewer: P9-LR5 (2026-10-18).

## Register
- Address: informal singular "εσύ / σου / σε", imperatives in the 2nd-person singular ("Επίλεξε", "Κάνε κλικ", "Εισήγαγε", "Πληκτρολόγησε", "Άνοιξε"); never the plural-polite "-στε" imperatives ("Επιλέξτε", "Κάντε κλικ") or "σας" as an address. The one "σας" in the catalogs is the verbatim Windows SmartScreen message ("Τα Windows προστάτευσαν τον υπολογιστή σας", `portal.dl.win.1`), allow-listed with that reason.
- Buttons and menu commands: nouns of action ("Αποθήκευση", "Εισαγωγή πίνακα", "Διαγραφή"), as Greek Office does; messages to the user are in the singular imperative or a neutral statement; yes/no questions use "Να …;" ("Να διαγραφεί το «{name}»;") or "Θέλεις να …;".
- Ellipsis "…" for commands that open a dialog, as in English.
- Typography: Greek question mark ";" for "?", quotation marks « » for quoted names, decimal comma and "εκ." / "ίν." / "στ." (points) for units in values that show measurements; the formula language, `#REF!` and function names stay English.
- Keyboard key names in shortcut texts (packages/ui-shared/src/i18n/keyNames.ts): Greek Office keeps the English names (Ctrl, Shift, Alt, Delete, Enter), so no `el` entry was added.
- Plural categories: `one / other` (as English); "Select all {count}" messages drop "all" in `.one` ("Επιλογή {count} εμφάνισης").
- Review (P9-LR5): numbering samples in list presets use the Latin letters the numbering produces ("I. / A. / 1.", "1) a) i)"), not Greek look-alikes; margin and paper presets that show inches in English show the German cm values ("Στενά (1,27 εκ.)").

## Ribbon tabs
| English | Office term | Note |
| --- | --- | --- |
| File | Αρχείο | |
| Home | Κεντρική | |
| Insert | Εισαγωγή | |
| Draw | Σχέδιο | no Draw tab in Rusuite yet |
| Design | Σχεδίαση | Word/PowerPoint "Σχεδίαση" (also the Drawing group) |
| Layout (Write: Layout, Calc: Page Layout) | Διάταξη / Διάταξη σελίδας | Calc: "Διάταξη σελίδας" |
| References | Αναφορές | Write |
| Mailings | Αλληλογραφία | Write |
| Review | Αναθεώρηση | |
| View | Προβολή | |
| Formulas | Τύποι | Calc |
| Data | Δεδομένα | Calc |
| Transitions | Μεταβάσεις | Show |
| Animations | Κινήσεις | Show |
| Slide Show | Προβολή παρουσίασης | Show |
| Help | Βοήθεια | |
| Picture / Table / Chart / Drawing Tools (contextual) | Εργαλεία εικόνας / πίνακα / γραφήματος / σχεδίασης | |

## Ribbon groups
| English | Office term | Note |
| --- | --- | --- |
| Clipboard | Πρόχειρο | |
| Font | Γραμματοσειρά | |
| Paragraph | Παράγραφος | |
| Styles | Στυλ | |
| Editing | Επεξεργασία | |
| Number | Αριθμός | Calc |
| Alignment | Στοίχιση | Calc |
| Cells | Κελιά | Calc |
| Slides | Διαφάνειες | Show |
| Drawing | Σχεδίαση | Show |
| Zoom | Ζουμ | |
| Show (View › Show) | Εμφάνιση | |
| Language | Γλώσσα | the picker; label "Γλώσσα / Language" |

## Common commands
| English | Office term | Note |
| --- | --- | --- |
| New | Δημιουργία | backstage "Δημιουργία" (Office: "Δημιουργία") |
| Open… | Άνοιγμα… | |
| Save | Αποθήκευση | |
| Save As… | Αποθήκευση ως… | |
| Print | Εκτύπωση | |
| Export PDF… | Εξαγωγή σε PDF… | |
| Close | Κλείσιμο | |
| Options… | Επιλογές… | |
| Undo / Redo | Αναίρεση / Επανάληψη | |
| Cut / Copy / Paste | Αποκοπή / Αντιγραφή / Επικόλληση | |
| Paste Special… | Ειδική επικόλληση… | |
| Format Painter | Πινέλο μορφοποίησης | |
| Find / Replace… / Go To… | Εύρεση / Αντικατάσταση… / Μετάβαση σε… | |
| Select All | Επιλογή όλων | |
| Bold / Italic / Underline / Strikethrough | Έντονα / Πλάγια / Υπογράμμιση / Διακριτή διαγραφή | |
| Font Color / Highlight / Fill Color | Χρώμα γραμματοσειράς / Χρώμα επισήμανσης κειμένου / Χρώμα γεμίσματος | |
| Insert Picture / Table / Chart / Shape / Text Box | Εισαγωγή εικόνας / πίνακα / γραφήματος / σχήματος / πλαισίου κειμένου | |
| Bring to Front / Send to Back | Μεταφορά στο προσκήνιο / στο παρασκήνιο | |
| Group / Ungroup | Ομαδοποίηση / Κατάργηση ομαδοποίησης | |
| Sort / Filter | Ταξινόμηση / Φίλτρο | Calc |
| Insert Function | Εισαγωγή συνάρτησης | Calc |
| New Slide | Νέα διαφάνεια | Show |
| From Beginning / From Current Slide | Από την αρχή / Από την τρέχουσα διαφάνεια | Show |
| Track Changes / Comments | Παρακολούθηση αλλαγών / Σχόλια | Write |

## Commands as used in the catalogs
The terms the catalogs use after the review (P9-LR5), one row per English command; the key shows where.

| English | Term | Key |
| --- | --- | --- |
| Copy | Αντιγραφή | `ai.pane.copy` |
| Save | Αποθήκευση | `ai.settings.save` |
| Insert | Εισαγωγή | `ai.write.insert` |
| Close | Κλείσιμο | `backstage.close` |
| New | Δημιουργία | `backstage.new` |
| Open… | Άνοιγμα… | `backstage.open` |
| Options… | Επιλογές… | `backstage.options` |
| Print | Εκτύπωση | `backstage.print` |
| Save As… | Αποθήκευση ως… | `backstage.saveAs` |
| Cut | Αποκοπή | `cmd.cut` |
| Delete | Διαγραφή | `cmd.delete` |
| Find | Εύρεση | `cmd.find` |
| Paste | Επικόλληση | `cmd.paste` |
| Redo | Επανάληψη | `cmd.redo` |
| Replace… | Αντικατάσταση… | `cmd.replaceDots` |
| Undo | Αναίρεση | `cmd.undo` |
| Size | Μέγεθος | `conn.browser.colSize` |
| Rename | Μετονομασία | `conn.browser.rename` |
| Bold | Έντονα | `fmt.bold` |
| Borders | Περιγράμματα | `fmt.borders` |
| Colors | Χρώματα | `fmt.colors` |
| Italic | Πλάγια | `fmt.italic` |
| Strikethrough | Διακριτή διαγραφή | `fmt.strike` |
| Underline | Υπογράμμιση | `fmt.underline` |
| Zoom | Ζουμ | `group.zoom` |
| Layout | Διάταξη | `print.layoutSection` |
| Margins | Περιθώρια | `print.margins` |
| Normal | Κανονικά | `print.margins.normal` |
| Orientation | Προσανατολισμός | `print.orientation` |
| Format | Μορφή | `sc.format` |
| Remove Arrows | Κατάργηση βελών | `calc.audit.removeArrows` |
| Show Formulas | Εμφάνιση τύπων | `calc.audit.showFormulas` |
| Trace Dependents | Ανίχνευση εξαρτημένων | `calc.audit.traceDependents` |
| Trace Precedents | Ανίχνευση προηγούμενων | `calc.audit.tracePrecedents` |
| Breaks | Αλλαγές | `calc.breaks` |
| Fill | Γέμισμα | `calc.cf.barFill` |
| Clear | Απαλοιφή | `calc.cf.clearFormat` |
| Shapes | Σχήματα | `calc.cf.iconGroup.shapes` |
| Conditional Formatting | Μορφοποίηση υπό όρους | `calc.cf.menu` |
| Gridlines | Γραμμές πλέγματος | `calc.chart.ae.gridlines` |
| Chart | Γράφημα | `calc.chart.chart` |
| Center | Στο κέντρο | `calc.chart.pos.center` |
| Recommended Charts | Προτεινόμενα γραφήματα | `calc.chart.recommended` |
| Shape Fill | Γέμισμα σχήματος | `calc.chart.shapeFill` |
| Shape Outline | Περίγραμμα σχήματος | `calc.chart.shapeOutline` |
| New Comment | Νέο σχόλιο | `calc.comments.new` |
| Comment | Σχόλιο | `calc.comments.textLabel` |
| Consolidate | Ενοποίηση | `calc.consolidate.button` |
| Delete Cells… | Διαγραφή κελιών… | `calc.deleteCellsDots` |
| Remove Duplicates | Κατάργηση διπλότυπων | `calc.dup.button` |
| Columns | Στήλες | `calc.dup.columns` |
| Select All | Επιλογή όλων | `calc.dup.selectAll` |
| Data Validation | Επικύρωση δεδομένων | `calc.dv.button` |
| Filter | Φίλτρο | `calc.filter` |
| Font Color | Χρώμα γραμματοσειράς | `calc.filter.byFontColor` |
| Flash Fill | Άμεσο γέμισμα | `calc.flash.button` |
| Effects | Εφέ | `calc.fmt.effects` |
| Justify | Πλήρης στοίχιση | `calc.fmt.h.justify` |
| Indent | Εσοχή | `calc.fmt.indent` |
| Preview | Προεπισκόπηση | `calc.fmt.preview` |
| Subscript | Δείκτης | `calc.fmt.subscript` |
| Superscript | Εκθέτης | `calc.fmt.superscript` |
| Symbol | Σύμβολο | `calc.fmt.symbol` |
| AutoSum | Αυτόματο άθροισμα | `calc.fn.autoSum` |
| Insert Function | Εισαγωγή συνάρτησης | `calc.fn.insert` |
| Format Painter | Πινέλο μορφοποίησης | `calc.formatPainter` |
| Freeze Panes | Δέσμευση παραθύρων | `calc.freezePanes` |
| Goal Seek… | Αναζήτηση στόχου… | `calc.goal.dots` |
| What-If Analysis | Ανάλυση υποθέσεων | `calc.goal.whatIf` |
| Hide | Απόκρυψη | `calc.hide` |
| Insert Cells… | Εισαγωγή κελιών… | `calc.insertCellsDots` |
| Link | Σύνδεσμος | `calc.link.button` |
| Merge Cells | Συγχώνευση κελιών | `calc.mergeCells` |
| Merge & Center | Συγχώνευση και κεντράρισμα | `calc.mergeCenter` |
| Move or Copy… | Μετακίνηση ή αντιγραφή… | `calc.moveCopy.dots` |
| Define Name | Ορισμός ονόματος | `calc.names.define` |
| Name Manager | Διαχείριση ονομάτων | `calc.names.manager` |
| Group | Ομαδοποίηση | `calc.outline.group` |
| Ungroup | Κατάργηση ομαδοποίησης | `calc.outline.ungroup` |
| Page Setup | Διαμόρφωση σελίδας | `calc.pageSetup` |
| Pictures | Εικόνες | `calc.picture.button` |
| PivotTable | Συγκεντρωτικός πίνακας | `calc.pivot.pivotTable` |
| Refresh All | Ανανέωση όλων | `calc.pivot.refreshAll` |
| Styles | Στυλ | `calc.pivot.stylesGallery` |
| Print Area | Περιοχή εκτύπωσης | `calc.printArea` |
| Print Titles | Εκτύπωση τίτλων | `calc.printTitles` |
| Sort | Ταξινόμηση | `calc.protect.allow.sort` |
| Protect Workbook | Προστασία βιβλίου | `calc.protect.bookDots` |
| Protect Sheet… | Προστασία φύλλου… | `calc.protect.sheetDots` |
| Paste Special… | Ειδική επικόλληση… | `calc.ps.dots` |
| Error Checking | Έλεγχος σφαλμάτων | `calc.err.dialogTitle` |
| Previous | Προηγούμενο | `calc.err.previous` |
| Next | Επόμενο | `calc.err.next` |
| Evaluate Formula | Αξιολόγηση τύπου | `calc.eval.title` |
| Watch Window | Παράθυρο παρακολούθησης | `calc.watch.title` |
| Calculate Now | Υπολογισμός τώρα | `calc.calc.now` |
| Sort & Filter | Ταξινόμηση και φιλτράρισμα | `calc.sortFilter` |
| Subtotal | Υποσύνολο | `calc.subtotal.button` |
| Properties | Ιδιότητες | `calc.table.properties` |
| Table | Πίνακας | `calc.table.table` |
| Unhide | Επαναφορά εμφάνισης | `calc.unhide` |
| Text to Columns | Κείμενο σε στήλες | `calc.wizard.ttcButton` |
| Align Left | Στοίχιση αριστερά | `write.alignObj.left` |
| Align Right | Στοίχιση δεξιά | `write.alignObj.right` |
| Align | Στοίχιση | `write.alignObjects` |
| Bookmark | Σελιδοδείκτης | `write.bookmark.button` |
| Insert Caption | Εισαγωγή λεζάντας | `write.caption.button` |
| Equation | Εξίσωση | `write.caption.equation` |
| Position | Θέση | `write.caption.position` |
| Crop | Περικοπή | `write.crop` |
| Spacing | Διάστημα | `write.font.spacing` |
| Bring Forward | Μεταφορά προς τα εμπρός | `write.order.bringForward` |
| Bring to Front | Μεταφορά στο προσκήνιο | `write.order.bringToFront` |
| Send Backward | Μεταφορά προς τα πίσω | `write.order.sendBackward` |
| Send to Back | Μεταφορά στο παρασκήνιο | `write.order.sendToBack` |
| Picture | Εικόνα | `write.picture` |
| Section | Ενότητα | `write.reveal.section` |
| Rotate | Περιστροφή | `write.rotate` |
| Ruler | Χάρακας | `write.ruler` |
| Selection Pane | Παράθυρο επιλογής | `write.selectionPane` |
| Spelling | Ορθογραφία | `write.spelling` |
| Split Cells | Διαίρεση κελιών | `write.splitCells` |
| Hyperlink | Υπερσύνδεση | `write.styleName.hyperlink` |
| Numbering… | Αρίθμηση… | `write.styles.format.numbering` |
| Text Box | Πλαίσιο κειμένου | `write.textBox` |
| Wrap Text | Αναδίπλωση κειμένου | `write.wrapText` |
| Cross-reference | Παραπομπή | `write.xref.button` |
| Footnote | Υποσημείωση | `write.xref.footnote` |
| Reset | Επαναφορά | `write.notes.sep.reset` |
| Format Background | Μορφοποίηση φόντου | `show.bg.format` |
| Background Styles | Στυλ φόντου | `show.bg.styles` |
| Fonts | Γραμματοσειρές | `show.design.fonts` |
| Themes | Θέματα | `show.design.themes` |
| Header & Footer… | Κεφαλίδα και υποσέλιδο… | `show.hf.titleDots` |
| Slide Master | Υπόδειγμα διαφανειών | `show.master.tab` |
| Slide Size | Μέγεθος διαφάνειας | `show.size.customTitle` |
| Set Up Slide Show | Ρύθμιση προβολής | `show.setup.titleDots` |
| Guides | Οδηγοί | `show.view.guides` |
| Notes Page | Σελίδα σημειώσεων | `show.view.notesPage` |
| Outline View | Προβολή διάρθρωσης | `show.view.outline` |
| Reading View | Προβολή ανάγνωσης | `show.view.reading` |
| Slide Sorter | Ταξινόμηση διαφανειών | `show.view.sorter` |
| Edit Points | Επεξεργασία σημείων | `show.editPoints` |
| Fill Color | Χρώμα γεμίσματος | `show.fx.fillColor` |
| Animation Painter | Πινέλο κίνησης | `show.animPainter` |
| From Current Slide… | Από την τρέχουσα διαφάνεια… | `show.recordFromCurrent` |
| From Beginning… | Από την αρχή… | `show.recordFromStart` |

## Dialog buttons and messages
| English | Office term | Note |
| --- | --- | --- |
| OK | OK | |
| Cancel | Άκυρο | |
| Apply | Εφαρμογή | |
| Close | Κλείσιμο | |
| Yes / No | Ναι / Όχι | |
| Don't Save | Να μην γίνει αποθήκευση | the unsaved-changes prompt |
| Browse… | Αναζήτηση… | |
| Reset | Επαναφορά | |
| Insert / Delete | Εισαγωγή / Διαγραφή | |
| Back / Next / Finish | Πίσω / Επόμενο / Τέλος | wizards |
| Recent | Πρόσφατα | backstage |
| Untitled | Χωρίς τίτλο | default document name |
| Saved / Saving… / Unsaved changes | Αποθηκεύτηκε / Αποθήκευση… / Μη αποθηκευμένες αλλαγές | status bar |

## File types
| English | Office term | Note |
| --- | --- | --- |
| Excel Workbook | Βιβλίο εργασίας Excel | `.xlsx`, the desktop dialog filter name |
| Word Document | Έγγραφο Word | `.docx` |
| PowerPoint Presentation | Παρουσίαση PowerPoint | `.pptx` |
| Excel Template / Word Template / PowerPoint Template | Πρότυπο Excel / Word / PowerPoint | `.xltx` / `.dotx` / `.potx` |
| CSV (Comma delimited) | CSV (οριοθετημένο με κόμμα) | Calc |
| Text Files | Αρχεία κειμένου | |
| PDF | PDF | |
| Office Theme | Θέμα του Office | `.thmx` |
| All Files | Όλα τα αρχεία | |

## Show effects and transitions
Animation effects (`show.fx.*`) and slide transitions (`show.trans.*`), named as in the PowerPoint localisation where it exists (P9-LR5).

| English | Term | Key |
| --- | --- | --- |
| Appear | Εμφάνιση | `show.fx.appear` |
| Disappear | Εξαφάνιση | `show.fx.disappear` |
| Fade | Ξεθώριασμα | `show.fx.fade` |
| Fly In | Πέταγμα προς τα μέσα | `show.fx.flyIn` |
| Fly Out | Πέταγμα προς τα έξω | `show.fx.flyOut` |
| Grow/Shrink | Μεγέθυνση/Σμίκρυνση | `show.fx.growShrink` |
| Spin | Περιστροφή | `show.fx.spin` |
| Wipe | Σκούπισμα | `show.fx.wipe` |
| Zoom | Ζουμ | `show.fx.zoom` |
| Cover | Κάλυψη | `show.trans.cover` |
| Cut | Αποκοπή | `show.trans.cut` |
| Fade | Ξεθώριασμα | `show.trans.fade` |
| None | Καμία | `show.trans.none` |
| Push | Ώθηση | `show.trans.push` |
| Split | Διαίρεση | `show.trans.split` |
| Wipe | Σκούπισμα | `show.trans.wipe` |
| Zoom | Ζουμ | `show.trans.zoom` |
| Morph | Μετασχηματισμός | `show.trans.morph` |
| Reveal | Αποκάλυψη | `show.trans.reveal` |
| Shred | Τεμαχισμός | `show.trans.shred` |
| Fall Over | Πτώση | `show.trans.fallOver` |
| Drape | Πέπλο | `show.trans.drape` |
| Curtains | Κουρτίνες | `show.trans.curtains` |
| Wind | Άνεμος | `show.trans.wind` |
| Prestige | Κύρος | `show.trans.prestige` |
| Fracture | Θραύση | `show.trans.fracture` |
| Crush | Σύνθλιψη | `show.trans.crush` |
| Peel Off | Ξεφλούδισμα | `show.trans.peelOff` |
| Page Curl | Γύρισμα σελίδας | `show.trans.pageCurl` |
| Airplane | Αεροπλάνο | `show.trans.airplane` |
| Origami | Οριγκάμι | `show.trans.origami` |
| Honeycomb | Κηρήθρα | `show.trans.honeycomb` |
| Glitter | Λαμπύρισμα | `show.trans.glitter` |
| Vortex | Δίνη | `show.trans.vortex` |
| Ripple | Κυματισμός | `show.trans.ripple` |
| Switch | Εναλλαγή | `show.trans.switch` |
| Flip | Αναστροφή | `show.trans.flip` |
| Gallery | Συλλογή | `show.trans.gallery` |
| Cube | Κύβος | `show.trans.cube` |
| Doors | Πόρτες | `show.trans.doors` |
| Box | Κουτί | `show.trans.box` |
| Float In | Αιώρηση προς τα μέσα | `show.fx.float` |
| Float Out | Αιώρηση προς τα έξω | `show.fx.floatOut` |
| Split | Διαίρεση | `show.fx.split` |
| Shape | Σχήμα | `show.fx.shape` |
| Circle | Κύκλος | `show.fx.circle` |
| Box | Κουτί | `show.fx.box` |
| Diamond | Ρόμβος | `show.fx.diamond` |
| Plus | Συν | `show.fx.plus` |
| Wheel | Τροχός | `show.fx.wheel` |
| Random Bars | Τυχαίες γραμμές | `show.fx.randomBars` |
| Grow & Turn | Μεγέθυνση και στροφή | `show.fx.growTurn` |
| Shrink & Turn | Σμίκρυνση και στροφή | `show.fx.shrinkTurn` |
| Swivel | Περιστροφή άξονα | `show.fx.swivel` |
| Bounce | Αναπήδηση | `show.fx.bounce` |
| Pulse | Παλμός | `show.fx.pulse` |
| Color Pulse | Παλμός χρώματος | `show.fx.colorPulse` |
| Teeter | Ταλάντευση | `show.fx.teeter` |
| Desaturate | Αποκορεσμός | `show.fx.desaturate` |
| Darken | Σκουρότερο | `show.fx.darken` |
| Lighten | Φωτεινότερο | `show.fx.lighten` |
| Transparency | Διαφάνεια | `show.fx.transparency` |
| Object Color | Χρώμα αντικειμένου | `show.fx.objectColor` |
| Line Color | Χρώμα γραμμής | `show.fx.lineColor` |
| Fill Color | Χρώμα γεμίσματος | `show.fx.fillColor` |
| Brush Color | Χρώμα πινέλου | `show.fx.brushColor` |
| Font Color | Χρώμα γραμματοσειράς | `show.fx.fontColor` |
| Underline | Υπογράμμιση | `show.fx.underline` |
| Bold Flash | Έντονη λάμψη | `show.fx.boldFlash` |
| Bold Reveal | Έντονη αποκάλυψη | `show.fx.boldReveal` |
| Wave | Κύμα | `show.fx.wave` |
| Lines | Γραμμές | `show.fx.pathLines` |
| Arcs | Τόξα | `show.fx.pathArcs` |
| Turns | Στροφές | `show.fx.pathTurns` |
| Shapes | Σχήματα | `show.fx.pathShapes` |
| Loops | Βρόχοι | `show.fx.pathLoops` |
| Custom Path | Προσαρμοσμένη διαδρομή | `show.fx.pathCustom` |
| Play | Αναπαραγωγή | `show.fx.mediaPlay` |
| Pause | Παύση | `show.fx.mediaPause` |
| Stop | Διακοπή | `show.fx.mediaStop` |

## More terms
| English | Office term | Note |
| --- | --- | --- |
| Worksheet / Workbook | Φύλλο εργασίας / Βιβλίο εργασίας | Calc |
| PivotTable / PivotChart | Συγκεντρωτικός πίνακας / Συγκεντρωτικό γράφημα | Calc |
| Conditional Formatting | Μορφοποίηση υπό όρους | Calc |
| Data Validation | Επικύρωση δεδομένων | Calc |
| Freeze Panes | Δέσμευση παραθύρων | Calc |
| Name Manager | Διαχείριση ονομάτων | Calc |
| Remove Duplicates | Κατάργηση διπλότυπων | Calc |
| Flash Fill | Άμεσο γέμισμα | Calc |
| Slicer / Sparkline | Αναλυτής δεδομένων / Μικρογράφημα | Calc |
| Goal Seek / What-If Analysis | Αναζήτηση στόχου / Ανάλυση υποθέσεων | Calc |
| Slide / Slide master / Layout | Διαφάνεια / Υπόδειγμα διαφανειών / Διάταξη | Show |
| Speaker notes | Σημειώσεις ομιλητή | Show |
| Presenter view | Προβολή παρουσιαστή | Show |
| Fly In / Fade / Wipe / Appear | Πέταγμα προς τα μέσα / Ξεθώριασμα / Σκούπισμα / Εμφάνιση | Show |
| Morph / Reveal / Shred | Μετασχηματισμός / Αποκάλυψη / Τεμαχισμός | Show transitions |
| Bookmark | Σελιδοδείκτης | Write |
| Caption | Λεζάντα | Write |
| Footnote / Endnote | Υποσημείωση / Σημείωση τέλους | Write |
| Cross-reference | Παραπομπή | Write |
| Header / Footer | Κεφαλίδα / Υποσέλιδο | |
| Alt text | Εναλλακτικό κείμενο | |
| Hyperlink | Υπερσύνδεση | |
| Margins | Περιθώρια | |
| Reasoning (AI setting, reasoning_effort) | Συλλογισμός | Settings › AI, actions (P9-LF pass 2) |
| dropped (reader warnings) | αφαιρέθηκε/αφαιρέθηκαν | `reader.xlsx.*` / `reader.pptx.*`, as in `reader.docx.*` |
| read as (reader warnings) | διαβάστηκε ως | reader warnings |
| dangling relationship | ανύπαρκτη σχέση | reader warnings |
| Custom show (PowerPoint) | Προσαρμοσμένη προβολή | `reader.pptx.customShow.*` |
| Pivot cache | κρυφή μνήμη συγκεντρωτικού πίνακα | `reader.xlsx.pivotCache.*` |
