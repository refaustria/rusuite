# Glossary: Maltese (`mt`)

Source: the Maltese localisation of Microsoft Office as far as its terms are known to the translator (Microsoft publishes Maltese Language Interface Packs), completed with the Maltese terms of the EU's IATE terminology database where Office has no term (Rusuite-specific features) and established Maltese computing usage (English loan words such as "header", "footer", "bookmark", "slicer", "screenshot", "keyring" are kept where Maltese users say them). Not checked against a running Maltese Office install: the reviewer should confirm the terms marked "doubt" at the end. Translator: P9-L11. Reviewer: –.

## Register
- Address: informal 2nd person singular "int / tiegħek / -ek"; imperatives in the singular ("Agħżel", "Daħħal", "Ħassar", "Ikklikkja", "Ittajpja"), which carry no gender; never the plural "intom / tagħkom / -kom" or plural imperatives ("Agħżlu", "Ikklikkjaw"). Questions to the user use the 2nd person singular imperfect ("Tħassar il-folder …?", "Trid iżżomm …?").
- Buttons and menu commands: bare imperative, as Office does ("Issejvja", "Iftaħ", "Ipprintja", "Agħlaq"); no gendered participles addressed to the user ("li ma jistax jarah", not "li huwa għomja").
- Ellipsis "…" for commands that open a dialog, as in English.
- Keyboard key names in shortcut texts (packages/ui-shared/src/i18n/keyNames.ts): Maltese Office keeps the English key names (Ctrl, Shift, Alt, Delete, Enter, Esc), so no `KEY_NAMES` entry was added.
- Plural categories: `one / two / few / many / other` (current CLDR; the task brief listed `one/few/many/other`, `Intl.PluralRules("mt")` on the build machines returns `two` as well, so every plural key has it). Maltese counts: 1 = singular, 2 = dual/plural, 3–10 = plural, 11–99 = singular again ("11-il ċellula"), 100+ mixed. Hence `one` singular, `two` and `few` plural, `many` and `other` singular ("{count} ċellula").
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

## Doubts for the reviewer
- Office's exact Maltese wording of "Undo" (Annulla), "Paste" (Waħħal), "Wrap Text" (Mgeżwir tat-test), "Sparkline", "Slicer", "Outline" (Skeda/Kontorn) and the PowerPoint transition and effect names (translated descriptively) was not verified in a running Maltese Office.
- Plural forms (`two`, `few`: plural noun; `many`, `other`: singular noun) follow the standard counting rules and should be proof-read.
