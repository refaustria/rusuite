# Glossary: Irish (`ga`)

Source: the Irish (Ireland) localisation of Microsoft Office as far as its terms are known to the translator (Microsoft publishes Irish Language Interface Packs for Windows and Office), completed with the national terminology database tearma.ie (Foras na Gaeilge / Dublin City University) and the Irish terms of IATE where Office has no term (Rusuite-specific features). Not checked against a running Irish Office install: terms marked "tearma.ie" are the proposed standard terms and should be confirmed by a native-speaking reviewer. Translator: P9-L11. Reviewer: P9-LR5 (2026-10-18; a second pair of eyes, not a native speaker: the tearma.ie terms are kept, grammar and consistency were checked).

## Register
- Address: informal singular "tú / thú / do / duit / leat / ort"; imperatives in the second person singular ("Roghnaigh", "Cuir isteach", "Scrios", "Cliceáil"); never the plural forms "sibh / bhur" or the plural imperatives ("Roghnaígí", "Cliceáilígí"). Irish has no polite pronoun, so the singular is the normal form for one user.
- Buttons and menu commands: bare imperative, as Office does ("Sábháil", "Oscail", "Priontáil"); dialog questions use "An …?" with the autonomous or 2nd-person verb ("An scriosfaidh tú …?").
- Ellipsis "…" for commands that open a dialog, as in English.
- Keyboard key names in shortcut texts (packages/ui-shared/src/i18n/keyNames.ts): Irish Office keeps the English key names (Ctrl, Shift, Alt, Delete, Enter, Esc), so no `KEY_NAMES` entry was added.
- Plural categories: `one / two / few / many / other`. Irish counts nouns in the singular after a number; the keys use the noun form with the initial mutation a number triggers: `one`, `two` and `few` (1–6: aon, dhá, trí, ceithre, cúig, sé) lenite ("1 chill", "2 chill", "3 chill", "{count} mhír", "{count} Thábla Pivot"), `many` (7–10) eclipses ("7 gcill", "{count} bpiléar", "{count} dTábla Pivot"), `other` (0, 11+) is the radical form ("11 cill"). Where a noun has no visible mutation (l, n, r, s+consonant, vowels) the forms are identical. (P9-LR5 corrected `few`, which used the radical form.)
- Review (P9-LR5): genitives after the article ("an chrutha", "an chló", "an Cholúin"); *Accent* (theme colour) is "Béim" ("Béim 1", "barra béime"), not "Aicearra" (= shortcut); paper sizes keep their names ("Legal", "Letter") and inch presets show the German cm values with a decimal point ("Cumhang (1.27 cm)"); a word that is the same as English is translated where Irish has one ("Corcairghorm", "Seipia", "Beibheal", "Stad").
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
| Clipboard | Gearrthaisce | radical form as a label (P9-LR5; was "Ghearrthaisce") |
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

## Commands as used in the catalogs
The terms the catalogs use after the review (P9-LR5), one row per English command; the key shows where.

| English | Term | Key |
| --- | --- | --- |
| Copy | Cóipeáil | `ai.pane.copy` |
| Save | Sábháil | `ai.settings.save` |
| Insert | Cuir isteach | `ai.write.insert` |
| Close | Dún | `backstage.close` |
| New | Nua | `backstage.new` |
| Open… | Oscail… | `backstage.open` |
| Options… | Roghanna… | `backstage.options` |
| Print | Priontáil | `backstage.print` |
| Save As… | Sábháil Mar… | `backstage.saveAs` |
| Cut | Gearr | `cmd.cut` |
| Delete | Scrios | `cmd.delete` |
| Find | Aimsigh | `cmd.find` |
| Paste | Greamaigh | `cmd.paste` |
| Redo | Athdhéan | `cmd.redo` |
| Replace… | Ionadaigh… | `cmd.replaceDots` |
| Undo | Cealaigh | `cmd.undo` |
| Size | Méid | `conn.browser.colSize` |
| Rename | Athainmnigh | `conn.browser.rename` |
| Bold | Trom | `fmt.bold` |
| Borders | Teorainneacha | `fmt.borders` |
| Colors | Dathanna | `fmt.colors` |
| Italic | Iodálach | `fmt.italic` |
| Strikethrough | Stailc tríd | `fmt.strike` |
| Underline | Folíne | `fmt.underline` |
| Zoom | Zúmáil | `group.zoom` |
| Layout | Leagan Amach | `print.layoutSection` |
| Margins | Corrlaigh | `print.margins` |
| Normal | Gnáth | `print.margins.normal` |
| Orientation | Treoshuíomh | `print.orientation` |
| Format | Formáid | `sc.format` |
| Remove Arrows | Bain Saigheada | `calc.audit.removeArrows` |
| Show Formulas | Taispeáin Foirmlí | `calc.audit.showFormulas` |
| Trace Dependents | Rianaigh Spleácha | `calc.audit.traceDependents` |
| Trace Precedents | Rianaigh Tosaigh | `calc.audit.tracePrecedents` |
| Breaks | Brúnna | `calc.breaks` |
| Fill | Líon | `calc.cf.barFill` |
| Clear | Glan | `calc.cf.clearFormat` |
| Shapes | Cruthanna | `calc.cf.iconGroup.shapes` |
| Conditional Formatting | Formáidiú Coinníollach | `calc.cf.menu` |
| Gridlines | Eangacha | `calc.chart.ae.gridlines` |
| Chart | Cairt | `calc.chart.chart` |
| Center | Lár | `calc.chart.pos.center` |
| Recommended Charts | Cairteanna Molta | `calc.chart.recommended` |
| Shape Fill | Líonadh Cruth | `calc.chart.shapeFill` |
| Shape Outline | Imlíne Chruth | `calc.chart.shapeOutline` |
| New Comment | Nóta Tráchta Nua | `calc.comments.new` |
| Comment | Nóta tráchta | `calc.comments.textLabel` |
| Consolidate | Comhdhlúthaigh | `calc.consolidate.button` |
| Delete Cells… | Scrios Cealla… | `calc.deleteCellsDots` |
| Remove Duplicates | Bain Dúbláin | `calc.dup.button` |
| Columns | Colúin | `calc.dup.columns` |
| Select All | Roghnaigh Gach Rud | `calc.dup.selectAll` |
| Data Validation | Bailíochtú Sonraí | `calc.dv.button` |
| Filter | Scagaire | `calc.filter` |
| Font Color | Dath an Chló | `calc.filter.byFontColor` |
| Flash Fill | Líonadh Splancach | `calc.flash.button` |
| Effects | Maisíochtaí | `calc.fmt.effects` |
| Justify | Réasúnaigh | `calc.fmt.h.justify` |
| Indent | Eang | `calc.fmt.indent` |
| Preview | Réamhamharc | `calc.fmt.preview` |
| Subscript | Fochlib | `calc.fmt.subscript` |
| Superscript | Forscript | `calc.fmt.superscript` |
| Symbol | Siombail | `calc.fmt.symbol` |
| AutoSum | UathSuim | `calc.fn.autoSum` |
| Insert Function | Cuir Feidhm Isteach | `calc.fn.insert` |
| Format Painter | Péintéir Formáide | `calc.formatPainter` |
| Freeze Panes | Reoigh Painéil | `calc.freezePanes` |
| Goal Seek… | Lorg Sprice… | `calc.goal.dots` |
| What-If Analysis | Anailís Cad Má | `calc.goal.whatIf` |
| Hide | Folaigh | `calc.hide` |
| Insert Cells… | Cuir Cealla Isteach… | `calc.insertCellsDots` |
| Link | Nasc | `calc.link.button` |
| Merge Cells | Cumasc Cealla | `calc.mergeCells` |
| Merge & Center | Cumasc & Láraigh | `calc.mergeCenter` |
| Move or Copy… | Bog nó Cóipeáil… | `calc.moveCopy.dots` |
| Define Name | Sainmhínigh Ainm | `calc.names.define` |
| Name Manager | Bainisteoir Ainmneacha | `calc.names.manager` |
| Group | Grúpáil | `calc.outline.group` |
| Ungroup | Díghrúpáil | `calc.outline.ungroup` |
| Page Setup | Socrú Leathanaigh | `calc.pageSetup` |
| Pictures | Pictiúir | `calc.picture.button` |
| PivotTable | Tábla Pivot | `calc.pivot.pivotTable` |
| Refresh All | Athnuaigh Gach Rud | `calc.pivot.refreshAll` |
| Styles | Stíleanna | `calc.pivot.stylesGallery` |
| Print Area | Limistéar Priontála | `calc.printArea` |
| Print Titles | Teidil Priontála | `calc.printTitles` |
| Sort | Sórtáil | `calc.protect.allow.sort` |
| Protect Workbook | Cosain an Leabhar Oibre | `calc.protect.bookDots` |
| Protect Sheet… | Cosain an Bhileog… | `calc.protect.sheetDots` |
| Paste Special… | Greamaigh Speisialta… | `calc.ps.dots` |
| Error Checking | Seiceáil Earráidí | `calc.err.dialogTitle` |
| Previous | An ceann roimhe seo | `calc.err.previous` |
| Next | An chéad cheann eile | `calc.err.next` |
| Evaluate Formula | Meas Foirmle | `calc.eval.title` |
| Watch Window | Fuinneog Faire | `calc.watch.title` |
| Calculate Now | Ríomh Anois | `calc.calc.now` |
| Sort & Filter | Sórtáil & Scag | `calc.sortFilter` |
| Subtotal | Fo-iomlán | `calc.subtotal.button` |
| Properties | Airíonna | `calc.table.properties` |
| Table | Tábla | `calc.table.table` |
| Unhide | Nochtaigh | `calc.unhide` |
| Text to Columns | Téacs go Colúin | `calc.wizard.ttcButton` |
| Align Left | Ailínigh ar Chlé | `write.alignObj.left` |
| Align Right | Ailínigh ar Dheis | `write.alignObj.right` |
| Align | Ailínigh | `write.alignObjects` |
| Bookmark | Leabharmharc | `write.bookmark.button` |
| Insert Caption | Cuir Fotheideal Isteach | `write.caption.button` |
| Equation | Cothromóid | `write.caption.equation` |
| Position | Suíomh | `write.caption.position` |
| Crop | Bearr | `write.crop` |
| Spacing | Spásáil | `write.font.spacing` |
| Bring Forward | Tabhair Ar Aghaidh | `write.order.bringForward` |
| Bring to Front | Tabhair go dtí an Tosach | `write.order.bringToFront` |
| Send Backward | Seol Siar | `write.order.sendBackward` |
| Send to Back | Seol go dtí an Cúl | `write.order.sendToBack` |
| Picture | Pictiúr | `write.picture` |
| Section | Rannóg | `write.reveal.section` |
| Rotate | Rothlaigh | `write.rotate` |
| Ruler | Rialóir | `write.ruler` |
| Selection Pane | Pána Roghnúcháin | `write.selectionPane` |
| Spelling | Litriú | `write.spelling` |
| Split Cells | Roinn Cealla | `write.splitCells` |
| Hyperlink | Hipearnasc | `write.styleName.hyperlink` |
| Numbering… | Uimhriú… | `write.styles.format.numbering` |
| Text Box | Bosca Téacs | `write.textBox` |
| Wrap Text | Timfhill Téacs | `write.wrapText` |
| Cross-reference | Trasthagairt | `write.xref.button` |
| Footnote | Fonóta | `write.xref.footnote` |
| Reset | Athshocraigh | `write.notes.sep.reset` |
| Format Background | Formáidigh an Cúlra | `show.bg.format` |
| Background Styles | Stíleanna Cúlra | `show.bg.styles` |
| Fonts | Clónna | `show.design.fonts` |
| Themes | Téamaí | `show.design.themes` |
| Header & Footer… | Ceanntásc & Buntásc… | `show.hf.titleDots` |
| Slide Master | Máistir Sleamhnán | `show.master.tab` |
| Slide Size | Méid an Tsleamhnáin | `show.size.customTitle` |
| Set Up Slide Show | Socraigh an Taispeántas | `show.setup.titleDots` |
| Guides | Treoracha | `show.view.guides` |
| Notes Page | Leathanach Nótaí | `show.view.notesPage` |
| Outline View | Radharc Imlíne | `show.view.outline` |
| Reading View | Radharc Léitheoireachta | `show.view.reading` |
| Slide Sorter | Sórtálaí Sleamhnán | `show.view.sorter` |
| Edit Points | Cuir Pointí in Eagar | `show.editPoints` |
| Fill Color | Dath an Líonta | `show.fx.fillColor` |
| Animation Painter | Péintéir Beochana | `show.animPainter` |
| From Current Slide… | Ón Sleamhnán Reatha… | `show.recordFromCurrent` |
| From Beginning… | Ón Tús… | `show.recordFromStart` |

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

## Show effects and transitions
Animation effects (`show.fx.*`) and slide transitions (`show.trans.*`), named as in the PowerPoint localisation where it exists (P9-LR5).

| English | Term | Key |
| --- | --- | --- |
| Appear | Le feiceáil | `show.fx.appear` |
| Disappear | Imigh as radharc | `show.fx.disappear` |
| Fade | Céimnigh | `show.fx.fade` |
| Fly In | Eitil Isteach | `show.fx.flyIn` |
| Fly Out | Eitil Amach | `show.fx.flyOut` |
| Grow/Shrink | Fás/Crapadh | `show.fx.growShrink` |
| Spin | Sníomh | `show.fx.spin` |
| Wipe | Scuab | `show.fx.wipe` |
| Zoom | Zúmáil | `show.fx.zoom` |
| Cover | Clúdaigh | `show.trans.cover` |
| Cut | Gearr | `show.trans.cut` |
| Fade | Céimnigh | `show.trans.fade` |
| None | Dada | `show.trans.none` |
| Push | Brúigh | `show.trans.push` |
| Split | Scoilt | `show.trans.split` |
| Wipe | Scuab | `show.trans.wipe` |
| Zoom | Zúmáil | `show.trans.zoom` |
| Morph | Meatamorfóis | `show.trans.morph` |
| Reveal | Nocht | `show.trans.reveal` |
| Shred | Stiallta | `show.trans.shred` |
| Fall Over | Titim Anuas | `show.trans.fallOver` |
| Drape | Brat | `show.trans.drape` |
| Curtains | Cuirtíní | `show.trans.curtains` |
| Wind | Gaoth | `show.trans.wind` |
| Prestige | Gradam | `show.trans.prestige` |
| Fracture | Briseadh | `show.trans.fracture` |
| Crush | Brúite | `show.trans.crush` |
| Peel Off | Bain Anuas | `show.trans.peelOff` |
| Page Curl | Casadh Leathanaigh | `show.trans.pageCurl` |
| Airplane | Eitleán | `show.trans.airplane` |
| Origami | Origami | `show.trans.origami` |
| Honeycomb | Cíor Meala | `show.trans.honeycomb` |
| Glitter | Glioscarnach | `show.trans.glitter` |
| Vortex | Guairneán | `show.trans.vortex` |
| Ripple | Cuilithín | `show.trans.ripple` |
| Switch | Malartú | `show.trans.switch` |
| Flip | Iompaigh | `show.trans.flip` |
| Gallery | Gailearaí | `show.trans.gallery` |
| Cube | Ciúb | `show.trans.cube` |
| Doors | Doirse | `show.trans.doors` |
| Box | Bosca | `show.trans.box` |
| Float In | Snámh Isteach | `show.fx.float` |
| Float Out | Snámh Amach | `show.fx.floatOut` |
| Split | Scoilt | `show.fx.split` |
| Shape | Cruth | `show.fx.shape` |
| Circle | Ciorcal | `show.fx.circle` |
| Box | Bosca | `show.fx.box` |
| Diamond | Diamant | `show.fx.diamond` |
| Plus | Móide | `show.fx.plus` |
| Wheel | Roth | `show.fx.wheel` |
| Random Bars | Barraí Randamacha | `show.fx.randomBars` |
| Grow & Turn | Fás & Cas | `show.fx.growTurn` |
| Shrink & Turn | Crap & Cas | `show.fx.shrinkTurn` |
| Swivel | Casadh | `show.fx.swivel` |
| Bounce | Preabadh | `show.fx.bounce` |
| Pulse | Cuisle | `show.fx.pulse` |
| Color Pulse | Cuisle Datha | `show.fx.colorPulse` |
| Teeter | Tulgadh | `show.fx.teeter` |
| Desaturate | Dísháithigh | `show.fx.desaturate` |
| Darken | Dorchaigh | `show.fx.darken` |
| Lighten | Gealaigh | `show.fx.lighten` |
| Transparency | Trédhearcacht | `show.fx.transparency` |
| Object Color | Dath an Réada | `show.fx.objectColor` |
| Line Color | Dath na Líne | `show.fx.lineColor` |
| Fill Color | Dath an Líonta | `show.fx.fillColor` |
| Brush Color | Dath an Scuaibe | `show.fx.brushColor` |
| Font Color | Dath an Chló | `show.fx.fontColor` |
| Underline | Folíne | `show.fx.underline` |
| Bold Flash | Splanc Trom | `show.fx.boldFlash` |
| Bold Reveal | Nochtadh Trom | `show.fx.boldReveal` |
| Wave | Tonn | `show.fx.wave` |
| Lines | Línte | `show.fx.pathLines` |
| Arcs | Stuaite | `show.fx.pathArcs` |
| Turns | Casanna | `show.fx.pathTurns` |
| Shapes | Cruthanna | `show.fx.pathShapes` |
| Loops | Lúba | `show.fx.pathLoops` |
| Custom Path | Cosán Saincheaptha | `show.fx.pathCustom` |
| Play | Seinn | `show.fx.mediaPlay` |
| Pause | Cuir ar Sos | `show.fx.mediaPause` |
| Stop | Stad | `show.fx.mediaStop` |

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

## Doubts (after the P9-LR5 review)
- "Slicer" is kept as the English product term; "Líne Spréach" (sparkline) and "Lorg Sprice" (Goal Seek) are tearma.ie-style terms.
- The PowerPoint transition names (Show › Transitions) and effect names are translated descriptively, not from a running Irish PowerPoint.
- Plural/mutation forms: checked in P9-LR5 (lenition after 1–6, eclipsis after 7–10); a native speaker should still proof-read the `.other` forms for 11–19 ("aon … déag").
- Terms added by P9-LR5 from tearma.ie: Running Total = "Iomlán Reatha", Grand Total = "Móriomlán", gutter margin = "corrlach ceangail", underscore = "fostríoc", Ripple = "Cuilithín", Switch (transition) = "Malartú".

## Terms added by P9-LF pass 2 (AI settings, reader warnings)
| English | Office term | Note |
| --- | --- | --- |
| Reasoning (AI setting, reasoning_effort) | Réasúnaíocht | Settings › AI, actions (P9-LF pass 2) |
| dropped (reader warnings) | scaoileadh … | `reader.xlsx.*` / `reader.pptx.*`, as in `reader.docx.*` |
| read as (reader warnings) | léadh … mar | reader warnings |
| dangling relationship | caidreamh scaoilte | reader warnings |
| Custom show (PowerPoint) | Taispeántas saincheaptha | `reader.pptx.customShow.*` |
| Pivot cache | taisce Tábla Pivot | `reader.xlsx.pivotCache.*` |

## Touch, compact layout and PDF export (P10-LF, 2026-10-23)

One term per gesture across the five catalogs (cycle 3.1415: ui-shared compact bars and sheets, the touch UI of Calc/Write/Show, PDF export, the portal's signing texts).

| English | Term | Used in |
| --- | --- | --- |
| tap | tapáil ("Tapáil …") | `calc.keys.ref`, `calc.stats.next`, `show.touch.tapToPlay` |
| long press | brú fada | (context menu as a sheet; no catalog text yet) |
| pinch | pinseáil | (zoom; no catalog text yet) |
| swipe | svaidhpeáil | (no catalog text yet) |
| selection handle | hanla | `write.touch.handleStart` / `handleEnd` |
| bottom sheet | painéal (ní "bileog" = worksheet) | `compact.moreSheet`, `compact.closeSheet` (aria labels) |
| fingerprint (GPG) | méarlorg | `portal.dl.signed.linux`, `portal.dl.sums.text` |
| release key | eochair eisiúna | `portal.dl.signed.linux`, `portal.dl.sums.text` |
| notarized (Apple) | nótaraithe | `portal.dl.signed.macos` |
| More | Tuilleadh | `compact.more` |
| More commands | Tuilleadh orduithe | `compact.moreSheet` |
| Fill | Líon | `calc.touch.fill` |
| Fill series | Líon sraith | `calc.touch.fillSeries` |
| Copy cells | Cóipeáil cealla | `calc.touch.copyCells` |
| Ref | Tag. | `calc.keys.refShort` |
| Share as PDF… | Comhroinn mar PDF… | `backstage.sharePdf` |
| Export PDF | Easpórtáil PDF | `print.exportPdf` |
| Multi-select | Ilroghnú | `show.touch.multiSelect` |
