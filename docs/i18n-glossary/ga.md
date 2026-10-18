# Glossary: Irish (`ga`)

Source: the Irish (Ireland) localisation of Microsoft Office as far as its terms are known to the translator (Microsoft publishes Irish Language Interface Packs for Windows and Office), completed with the national terminology database tearma.ie (Foras na Gaeilge / Dublin City University) and the Irish terms of IATE where Office has no term (Rusuite-specific features). Not checked against a running Irish Office install: terms marked "tearma.ie" are the proposed standard terms and should be confirmed by a native-speaking reviewer. Translator: P9-L11. Reviewer: –.

## Register
- Address: informal singular "tú / thú / do / duit / leat / ort"; imperatives in the second person singular ("Roghnaigh", "Cuir isteach", "Scrios", "Cliceáil"); never the plural forms "sibh / bhur" or the plural imperatives ("Roghnaígí", "Cliceáilígí"). Irish has no polite pronoun, so the singular is the normal form for one user.
- Buttons and menu commands: bare imperative, as Office does ("Sábháil", "Oscail", "Priontáil"); dialog questions use "An …?" with the autonomous or 2nd-person verb ("An scriosfaidh tú …?").
- Ellipsis "…" for commands that open a dialog, as in English.
- Keyboard key names in shortcut texts (packages/ui-shared/src/i18n/keyNames.ts): Irish Office keeps the English key names (Ctrl, Shift, Alt, Delete, Enter, Esc), so no `KEY_NAMES` entry was added.
- Plural categories: `one / two / few / many / other`. Irish counts nouns in the singular after a number; the keys use the noun form with the initial mutation a number triggers: `one`/`two` lenite ("1 chill", "2 chill", "{count} mhír"), `few` (3–6) uses the radical form ("3 cill"), `many` (7–10) eclipses ("7 gcill"), `other` is the radical form again ("11 cill"). Where a noun has no visible mutation (vowel or already-mutated initial) all five forms are identical.
- Capitalisation: Office-style initial capitals for tab, group and command names where the English has title case (a loose imitation of the Irish Office style); sentence case for sentences.
- Not translated: function names, formula syntax, brand names, file extensions, field switches (`\h`, `\n` …).

## Ribbon tabs
| English | Office term | Note |
| --- | --- | --- |
| File | Comhad | |
| Home | Baile | |
| Insert | Cuir Isteach | |
| Draw | Líníocht | |
| Design | Dearadh | |
| Layout (Write: Layout, Calc: Page Layout) | Leagan Amach (Calc: Leagan Amach an Leathanaigh) | |
| References | Tagairtí | Write |
| Mailings | Postálacha | Write |
| Review | Athbhreithniú | |
| View | Amharc | |
| Formulas | Foirmlí | Calc |
| Data | Sonraí | Calc |
| Transitions | Aistrithe | Show |
| Animations | Beochan | Show |
| Slide Show | Taispeántas Sleamhnán | Show |
| Help | Cabhair | |
| Picture / Table / Chart / Drawing Tools (contextual) | Uirlisí Pictiúir / Tábla / Cairte / Líníochta | |

## Ribbon groups
| English | Office term | Note |
| --- | --- | --- |
| Clipboard | Ghearrthaisce | |
| Font | Cló | |
| Paragraph | Mír | |
| Styles | Stíleanna | |
| Editing | Eagarthóireacht | |
| Number | Uimhir | Calc |
| Alignment | Ailíniú | Calc |
| Cells | Cealla | Calc |
| Slides | Sleamhnáin | Show |
| Drawing | Líníocht | Show |
| Zoom | Zúmáil | |
| Show (View › Show) | Taispeáin | |
| Language | Teanga | the picker; label "Teanga / Language" |

## Common commands
| English | Office term | Note |
| --- | --- | --- |
| New | Nua | |
| Open… | Oscail… | |
| Save | Sábháil | |
| Save As… | Sábháil Mar… | |
| Print | Priontáil | |
| Export PDF… | Easpórtáil PDF… | |
| Close | Dún | |
| Options… | Roghanna… | |
| Undo / Redo | Cealaigh / Athdhéan | Office also uses "Cealaigh" for Cancel |
| Cut / Copy / Paste | Gearr / Cóipeáil / Greamaigh | |
| Paste Special… | Greamaigh Speisialta… | |
| Format Painter | Péintéir Formáide | |
| Find / Replace… / Go To… | Aimsigh / Ionadaigh… / Téigh Go… | |
| Select All | Roghnaigh Gach Rud | |
| Bold / Italic / Underline / Strikethrough | Trom / Iodálach / Folíne / Stailc tríd | |
| Font Color / Highlight / Fill Color | Dath cló / Aibhsigh / Dath líonta | |
| Insert Picture / Table / Chart / Shape / Text Box | Cuir pictiúr / tábla / cairt / cruth / bosca téacs isteach | |
| Bring to Front / Send to Back | Tabhair go dtí an Tosach / Seol go dtí an Cúl | |
| Group / Ungroup | Grúpáil / Díghrúpáil | |
| Sort / Filter | Sórtáil / Scagaire | Calc |
| Insert Function | Cuir Feidhm Isteach | Calc |
| New Slide | Sleamhnán nua | Show |
| From Beginning / From Current Slide | Ón tús / Ón sleamhnán reatha | Show |
| Track Changes / Comments | Rianú / Nótaí Tráchta | Write |

## Dialog buttons and messages
| English | Office term | Note |
| --- | --- | --- |
| OK | OK | |
| Cancel | Cealaigh | |
| Apply | Cuir i bhfeidhm | |
| Close | Dún | |
| Yes / No | Tá / Níl | |
| Don't Save | Ná sábháil | the unsaved-changes prompt |
| Browse… | Brabhsáil… | |
| Reset | Athshocraigh | |
| Insert / Delete | Cuir isteach / Scrios | |
| Back / Next / Finish | Ar ais / Ar aghaidh / Críochnaigh | wizards |
| Recent | Le Déanaí | backstage |
| Untitled | Gan Teideal | default document name |
| Saved / Saving… / Unsaved changes | Sábháilte / Ag sábháil… / Athruithe gan sábháil | status bar |

## File types
| English | Office term | Note |
| --- | --- | --- |
| Excel Workbook | Leabhar oibre Excel | `.xlsx`, the desktop dialog filter name |
| Word Document | Doiciméad Word | `.docx` |
| PowerPoint Presentation | Taispeántas PowerPoint | `.pptx` |
| Excel Template / Word Template / PowerPoint Template | Teimpléad Excel / Word / PowerPoint | `.xltx` / `.dotx` / `.potx` |
| CSV (Comma delimited) | CSV (teormharcáilte le camóga) | Calc |
| Text Files | Comhaid Téacs | |
| PDF | PDF | |
| Office Theme | Téama Office | `.thmx` |
| All Files | Gach Comhad | |

## More terms
| English | Term | Note |
| --- | --- | --- |
| Slide | sleamhnán | PowerPoint term, everywhere in Show; masculine |
| Presentation | taispeántas | |
| Slide master / Layout | Máistir sleamhnán / Leagan Amach | |
| Speaker notes | nótaí cainteora | |
| Worksheet / Workbook | Bileog oibre / Leabhar oibre | |
| Cell / Row / Column | Cill / Sraith / Colún | |
| Formula / Function | Foirmle / Feidhm | |
| PivotTable | Tábla Pivot | |
| Conditional Formatting | Formáidiú Coinníollach | |
| Data Bars / Color Scales / Icon Sets | Barraí Sonraí / Scálaí Dath / Tacair Deilbhíní | |
| Sparkline | Líne Spréach | |
| Slicer | Slicer | not localised |
| Flash Fill | Líonadh Splancach | |
| Goal Seek | Lorg Sprice | |
| Data Validation | Bailíochtú Sonraí | |
| Comment (Write/Calc thread) / Note | Nóta Tráchta / Nóta | |
| Footnote / Endnote | Fonóta / Iarnóta | |
| Header / Footer | Ceanntásc / Buntásc | genitive: ceanntáisc / buntáisc |
| Bookmark | Leabharmharc | genitive: leabharmhairc |
| Table of contents | Clár ábhair | |
| Caption | Fotheideal | |
| Cross-reference | Trasthagairt | |
| Hyperlink | Hipearnasc | |
| Theme / Style / Style set | Téama / Stíl / Tacar stíle | |
| Margins / Indent | Corrlaigh / Eangú | |
| Border / Shading / Fill | Teorainn / Scáthú / Líonadh | |
| Transition / Animation | Aistriú / Beochan | |
| Provider / API key / Model / Token | Soláthraí / Eochair API / Samhail / Comhartha | AI assistant |
| Connection / Server | Nasc / Freastalaí | WebDAV |
| Autosave | Uathshábháil | |
| Recovered document | Doiciméad aisghafa | |
| Report a problem | Tuairiscigh fadhb | |
| Privacy | Príobháideacht | |

## Doubts for the reviewer
- "Slicer" is kept as the English product term; "Líne Spréach" (sparkline) and "Lorg Sprice" (Goal Seek) are tearma.ie-style terms.
- The PowerPoint transition names (Show › Transitions) and effect names are translated descriptively, not from a running Irish PowerPoint.
- Plural/mutation forms in the `.one/.two/.few/.many` keys follow the standard rules (lenition after 1 and 2, eclipsis after 7–10) and should be proof-read.
