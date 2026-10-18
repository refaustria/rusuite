# Glossary: Greek (`el`)

Source: the Greek (Greece) localisation of Microsoft Office (Word, Excel, PowerPoint) and its terminology. Translator: P9-L9. Reviewer: –.

## Register
- Address: informal singular "εσύ / σου / σε", imperatives in the 2nd-person singular ("Επίλεξε", "Κάνε κλικ", "Εισήγαγε", "Πληκτρολόγησε", "Άνοιξε"); never the plural-polite "-στε" imperatives ("Επιλέξτε", "Κάντε κλικ") or "σας" as an address. The one "σας" in the catalogs is the verbatim Windows SmartScreen message ("Τα Windows προστάτευσαν τον υπολογιστή σας", `portal.dl.win.1`), allow-listed with that reason.
- Buttons and menu commands: nouns of action ("Αποθήκευση", "Εισαγωγή πίνακα", "Διαγραφή"), as Greek Office does; messages to the user are in the singular imperative or a neutral statement; yes/no questions use "Να …;" ("Να διαγραφεί το «{name}»;") or "Θέλεις να …;".
- Ellipsis "…" for commands that open a dialog, as in English.
- Typography: Greek question mark ";" for "?", quotation marks « » for quoted names, decimal comma and "εκ." / "ίν." / "στ." (points) for units in values that show measurements; the formula language, `#REF!` and function names stay English.
- Keyboard key names in shortcut texts (packages/ui-shared/src/i18n/keyNames.ts): Greek Office keeps the English names (Ctrl, Shift, Alt, Delete, Enter), so no `el` entry was added.
- Plural categories: `one / other` (as English).

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
