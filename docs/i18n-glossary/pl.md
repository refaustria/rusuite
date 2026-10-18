# Glossary: Polish (`pl`)

Source: the Polish (Poland) localisation of Microsoft Office (Word, Excel, PowerPoint) and its terminology. Translator: P9-L5. Reviewer: P9-LR3 (2026-10-18).

## Register
- Address: informal "ty / ci / cię / twój / twoja / twoje" (capitalised mid-sentence: "Twoje pliki", "Cię", as in letters); imperatives in the 2nd person singular ("Wpisz", "Wybierz", "Kliknij", "Zaznacz"); never "pan / pani / państwo", "Proszę wybrać" or 3rd-person polite forms ("Niech pan…").
- Buttons and menu commands: imperative or noun, as Office does ("Zapisz", "Otwórz", "Wstaw tabelę", but dialog titles as gerund nouns: "Wstawianie hiperłącza", "Formatowanie komórek").
- Gender-neutral wording: avoid past-tense 2nd-person forms ("czego oczekiwałeś") – use imperatives or impersonal forms instead.
- Ellipsis "…" for commands that open a dialog, as in English.
- Quotation marks: „…” (Polish low-high pair).
- Keyboard key names in shortcut texts (packages/ui-shared/src/i18n/keyNames.ts): Polish Office keeps Ctrl = Ctrl, Shift = Shift, Delete = Delete, Enter = Enter (no table entry needed).
- Plural categories: `one / few / many / other`. `one` = 1; `few` = 2–4 (not 12–14); `many` = 0, 5–21, 25–31 …; `other` = fractions (genitive singular: "1,5 wiersza"). Where the noun would need declension, a neutral pattern is used ("Tabele przestawne wymagające odświeżenia: {count}", "… ({count})"). Unit abbreviations ("{count} min temu") are identical in all four forms.
- Review (P9-LR3): gendered conditionals addressed to the user ("Jak opisałbyś…") are rewritten with an infinitive ("Jak opisać…"); `.other` is the fraction form (genitive singular: "1,5 strony"), `.many` covers 0 and 5+; ".one" reads naturally for 1 ("Zaznacz {count} wystąpienie", not "wszystkie").
- Sparklines: Wykresy przebiegu w czasie (group), Wykres przebiegu w czasie (tab, single), Liniowy / Kolumnowy / Zysk/strata; Error Bars: Słupki błędów; Up/Down Bars: Słupki wzrostu/spadku; High-Low Lines: Linie maksimum-minimum.
- Arrange: Przenieś na wierzch / Przesuń do przodu / Przesuń do tyłu / Przenieś na spód; fill/line pane: Brak wypełnienia, Wypełnienie pełne, Wypełnienie gradientowe, Wypełnienie obrazem, Brak linii; margins in cm (Office PL shows cm).

## Ribbon tabs
| English | Office term | Note |
| --- | --- | --- |
| File | Plik | |
| Home | Narzędzia główne | Word/Excel/PowerPoint ribbon tab; the backstage "Home" page is "Strona główna" |
| Insert | Wstawianie | |
| Draw | Rysowanie | |
| Design | Projektowanie | |
| Layout (Write: Layout, Calc: Page Layout) | Układ / Układ strony | Calc: "Układ strony" |
| References | Odwołania | Write |
| Mailings | Korespondencja | Write |
| Review | Recenzja | |
| View | Widok | |
| Formulas | Formuły | Calc |
| Data | Dane | Calc |
| Transitions | Przejścia | Show |
| Animations | Animacje | Show |
| Slide Show | Pokaz slajdów | Show |
| Help | Pomoc | |
| Picture / Table / Chart / Drawing Tools (contextual) | Narzędzia obrazów / tabel / wykresów / rysowania | |

## Ribbon groups
| English | Office term | Note |
| --- | --- | --- |
| Clipboard | Schowek | |
| Font | Czcionka | |
| Paragraph | Akapit | |
| Styles | Style | |
| Editing | Edytowanie | |
| Number | Liczba | Calc |
| Alignment | Wyrównanie | Calc |
| Cells | Komórki | Calc |
| Slides | Slajdy | Show |
| Drawing | Rysowanie | Show |
| Zoom | Powiększenie | |
| Show (View › Show) | Pokazywanie | |
| Language | Język | the picker; label "Język / Language" |

## Common commands
| English | Office term | Note |
| --- | --- | --- |
| New | Nowy | |
| Open… | Otwórz… | |
| Save | Zapisz | |
| Save As… | Zapisz jako… | |
| Print | Drukuj | |
| Export PDF… | Eksportuj do PDF… | |
| Close | Zamknij | |
| Options… | Opcje… | |
| Undo / Redo | Cofnij / Ponów | |
| Cut / Copy / Paste | Wytnij / Kopiuj / Wklej | |
| Paste Special… | Wklej specjalnie… | |
| Format Painter | Malarz formatów | |
| Find / Replace… / Go To… | Znajdź / Zamień… / Przejdź do… | |
| Select All | Zaznacz wszystko | |
| Bold / Italic / Underline / Strikethrough | Pogrubienie / Kursywa / Podkreślenie / Przekreślenie | |
| Font Color / Highlight / Fill Color | Kolor czcionki / Kolor wyróżnienia tekstu / Kolor wypełnienia | |
| Insert Picture / Table / Chart / Shape / Text Box | Wstaw obraz / tabelę / wykres / kształty / pole tekstowe | |
| Bring to Front / Send to Back | Przenieś na wierzch / Przenieś na spód | |
| Group / Ungroup | Grupuj / Rozgrupuj | |
| Sort / Filter | Sortuj / Filtruj | Calc |
| Insert Function | Wstaw funkcję | Calc |
| New Slide | Nowy slajd | Show |
| From Beginning / From Current Slide | Od początku / Od bieżącego slajdu | Show |
| Track Changes / Comments | Śledzenie zmian / Komentarze | Write |

## Commands as used in the catalogs
| English | Term | Key |
| --- | --- | --- |
| Copy | Kopiuj | `ai.pane.copy` |
| Close | Zamknij | `backstage.close` |
| Print | Drukuj | `backstage.print` |
| Find | Znajdź | `cmd.find` |
| Redo | Ponów | `cmd.redo` |
| Borders (Calc) | Krawędzie | `calc.borders.all` |
| Borders (Write/Show) | Obramowania | `write.borders` |
| Conditional Formatting | Formatowanie warunkowe | `calc.cf.menu` |
| Data Bars / Color Scales / Icon Sets | Paski danych / Skale kolorów / Zestawy ikon | `calc.cf.dataBars` |
| Remove Duplicates | Usuń duplikaty | `calc.dup.button` |
| Data Validation | Poprawność danych | `calc.dv.button` |
| Flash Fill | Wypełnianie błyskawiczne | `calc.flash.button` |
| Freeze Panes | Zablokuj okienka | `calc.freezePanes` |
| Goal Seek… | Szukaj wyniku… | `calc.goal.dots` |
| What-If Analysis | Analiza warunkowa | `calc.goal.whatIf` |
| Hide / Unhide | Ukryj / Odkryj | `calc.hide` |
| Merge & Center | Scal i wyśrodkuj | `calc.mergeCenter` |
| Name Manager | Menedżer nazw | `calc.names.manager` |
| PivotTable | Tabela przestawna | `calc.pivot.pivotTable` |
| PivotChart | Wykres przestawny | `calc.pivot.pivotChart` |
| Slicer | Fragmentator | `calc.slicer.slicer` |
| Print Area | Obszar wydruku | `calc.printArea` |
| Protect Sheet… | Chroń arkusz… | `calc.protect.sheetDots` |
| Error Checking | Sprawdzanie błędów | `calc.err.dialogTitle` |
| Evaluate Formula | Szacowanie formuły | `calc.eval.title` |
| Watch Window | Okno czujki | `calc.watch.title` |
| Subtotal | Suma częściowa | `calc.subtotal.button` |
| Text to Columns | Tekst jako kolumny | `calc.wizard.ttcButton` |
| Trace Precedents / Dependents | Śledź precedensy / zależności | `calc.audit.tracePrecedents` |
| Bookmark | Zakładka | `write.bookmark.button` |
| Insert Caption | Wstaw podpis | `write.caption.button` |
| Cross-reference | Odwołanie | `write.xref.button` |
| Footnote / Endnote | Przypis dolny / końcowy | `write.xref.footnote` |
| Table of contents | Spis treści | `write.tableOfContents` |
| Wrap Text | Zawijanie tekstu | `write.wrapText` |
| Selection Pane | Okienko zaznaczenia | `write.selectionPane` |
| Navigation Pane | Okienko nawigacji | `write.navigationPane` |
| Style Inspector | Inspektor stylów | `write.styles.inspector` |
| Reveal Formatting | Pokaż formatowanie | `write.reveal.button` |
| Spelling | Pisownia | `write.spelling` |
| Split Cells | Podziel komórki | `write.splitCells` |
| Header & Footer | Nagłówek i stopka | `show.hf.title` |
| Slide Master | Wzorzec slajdów | `show.master.tab` |
| Slide Size | Rozmiar slajdu | `show.size.customTitle` |
| Set Up Slide Show | Konfiguruj pokaz slajdów | `show.setup.titleDots` |
| Presenter view | Widok prezentera | `show.presenterView` |
| Speaker notes | Notatki prelegenta | `show.speakerNotes` |
| Slide Sorter | Sortownik slajdów | `show.view.sorter` |
| Reading View | Widok czytania | `show.view.reading` |
| Outline View | Widok konspektu | `show.view.outline` |
| Rehearse Timings | Próba czasowa | `show.rehearse` |
| Reuse Slides… | Użyj ponownie slajdów… | `show.reuse.menu` |
| Animation Painter | Malarz animacji | `show.animPainter` |
| Edit Points | Edytuj punkty | `show.editPoints` |
| Custom Slide Show | Niestandardowy pokaz slajdów | `show.custom.menu` |
| Office Theme | Motyw pakietu Office | `show.design.themeFilter` |

| Save | Zapisz | `ai.settings.save` |
| Insert | Wstaw | `ai.write.insert` |
| New | Nowy | `backstage.new` |
| Open… | Otwórz… | `backstage.open` |
| Options… | Opcje… | `backstage.options` |
| Save As… | Zapisz jako… | `backstage.saveAs` |
| Cut | Wytnij | `cmd.cut` |
| Delete | Usuń | `cmd.delete` |
| Paste | Wklej | `cmd.paste` |
| Replace… | Zamień… | `cmd.replaceDots` |
| Undo | Cofnij | `cmd.undo` |
| Size | Rozmiar | `conn.browser.colSize` |
| Rename | Zmień nazwę | `conn.browser.rename` |
| Bold | Pogrubienie | `fmt.bold` |
| Borders | Obramowania | `fmt.borders` |
| Colors | Kolory | `fmt.colors` |
| Italic | Kursywa | `fmt.italic` |
| Strikethrough | Przekreślenie | `fmt.strike` |
| Underline | Podkreślenie | `fmt.underline` |
| Zoom | Powiększenie | `group.zoom` |
| Layout | Układ | `print.layoutSection` |
| Margins | Marginesy | `print.margins` |
| Normal | Normalne | `print.margins.normal` |
| Orientation | Orientacja | `print.orientation` |
| Format | Format | `sc.format` |
| Remove Arrows | Usuń strzałki | `calc.audit.removeArrows` |
| Show Formulas | Pokaż formuły | `calc.audit.showFormulas` |
| Trace Dependents | Śledź zależności | `calc.audit.traceDependents` |
| Breaks | Podziały | `calc.breaks` |
| Fill | Wypełnienie | `calc.cf.barFill` |
| Clear | Wyczyść | `calc.cf.clearFormat` |
| Shapes | Kształty | `calc.cf.iconGroup.shapes` |
| Gridlines | Linie siatki | `calc.chart.ae.gridlines` |
| Chart | Wykres | `calc.chart.chart` |
| Center | Środek | `calc.chart.pos.center` |
| Recommended Charts | Polecane wykresy | `calc.chart.recommended` |
| Shape Fill | Wypełnienie kształtu | `calc.chart.shapeFill` |
| Shape Outline | Kontur kształtu | `calc.chart.shapeOutline` |
| New Comment | Nowy komentarz | `calc.comments.new` |
| Comment | Komentarz | `calc.comments.textLabel` |
| Consolidate | Konsoliduj | `calc.consolidate.button` |
| Delete Cells… | Usuń komórki… | `calc.deleteCellsDots` |
| Columns | Kolumny | `calc.dup.columns` |
| Select All | Zaznacz wszystko | `calc.dup.selectAll` |
| Filter | Filtruj | `calc.filter` |
| Font Color | Kolor czcionki | `calc.filter.byFontColor` |
| Effects | Efekty | `calc.fmt.effects` |
| Justify | Wyjustuj | `calc.fmt.h.justify` |
| Indent | Wcięcie | `calc.fmt.indent` |
| Preview | Podgląd | `calc.fmt.preview` |
| Subscript | Indeks dolny | `calc.fmt.subscript` |
| Superscript | Indeks górny | `calc.fmt.superscript` |
| Symbol | Symbol | `calc.fmt.symbol` |
| AutoSum | Autosumowanie | `calc.fn.autoSum` |
| Insert Function | Wstaw funkcję | `calc.fn.insert` |
| Format Painter | Malarz formatów | `calc.formatPainter` |
| Insert Cells… | Wstaw komórki… | `calc.insertCellsDots` |
| Link | Łącze | `calc.link.button` |
| Merge Cells | Scal komórki | `calc.mergeCells` |
| Move or Copy… | Przenieś lub kopiuj… | `calc.moveCopy.dots` |
| Define Name | Definiuj nazwę | `calc.names.define` |
| Group | Grupuj | `calc.outline.group` |
| Ungroup | Rozgrupuj | `calc.outline.ungroup` |
| Page Setup | Ustawienia strony | `calc.pageSetup` |
| Pictures | Obrazy | `calc.picture.button` |
| Refresh All | Odśwież wszystko | `calc.pivot.refreshAll` |
| Styles | Style | `calc.pivot.stylesGallery` |
| Print Titles | Tytuły wydruku | `calc.printTitles` |
| Sort | Sortowanie | `calc.protect.allow.sort` |
| Protect Workbook | Chroń skoroszyt | `calc.protect.bookDots` |
| Paste Special… | Wklej specjalnie… | `calc.ps.dots` |
| Previous | Wstecz | `calc.err.previous` |
| Next | Dalej | `calc.err.next` |
| Calculate Now | Przelicz teraz | `calc.calc.now` |
| Sort & Filter | Sortuj i filtruj | `calc.sortFilter` |
| Properties | Właściwości | `calc.table.properties` |
| Table | Tabela | `calc.table.table` |
| Unhide | Odkryj | `calc.unhide` |
| Align Left | Wyrównaj do lewej | `write.alignObj.left` |
| Align Right | Wyrównaj do prawej | `write.alignObj.right` |
| Align | Wyrównaj | `write.alignObjects` |
| Equation | Równanie | `write.caption.equation` |
| Position | Położenie | `write.caption.position` |
| Crop | Przytnij | `write.crop` |
| Spacing | Odstępy | `write.font.spacing` |
| Bring Forward | Przesuń do przodu | `write.order.bringForward` |
| Bring to Front | Przenieś na wierzch | `write.order.bringToFront` |
| Send Backward | Przesuń do tyłu | `write.order.sendBackward` |
| Send to Back | Przenieś na spód | `write.order.sendToBack` |
| Picture | Obraz | `write.picture` |
| Section | Sekcja | `write.reveal.section` |
| Rotate | Obróć | `write.rotate` |
| Ruler | Linijka | `write.ruler` |
| Hyperlink | Hiperłącze | `write.styleName.hyperlink` |
| Numbering… | Numerowanie… | `write.styles.format.numbering` |
| Text Box | Pole tekstowe | `write.textBox` |
| Reset | Resetuj | `write.notes.sep.reset` |
| Format Background | Formatuj tło | `show.bg.format` |
| Background Styles | Style tła | `show.bg.styles` |
| Fonts | Czcionki | `show.design.fonts` |
| Themes | Motywy | `show.design.themes` |
| Header & Footer… | Nagłówek i stopka… | `show.hf.titleDots` |
| Guides | Prowadnice | `show.view.guides` |
| Notes Page | Strona notatek | `show.view.notesPage` |
| Fill Color | Kolor wypełnienia | `show.fx.fillColor` |
| From Current Slide… | Od bieżącego slajdu… | `show.recordFromCurrent` |
| From Beginning… | Od początku… | `show.recordFromStart` |
## Dialog buttons and messages
| English | Office term | Note |
| --- | --- | --- |
| OK | OK | |
| Cancel | Anuluj | |
| Apply | Zastosuj | |
| Close | Zamknij | |
| Yes / No | Tak / Nie | |
| Don't Save | Nie zapisuj | the unsaved-changes prompt |
| Browse… | Przeglądaj… | |
| Reset | Resetuj | |
| Insert / Delete | Wstaw / Usuń | |
| Back / Next / Finish | Wstecz / Dalej / Zakończ | wizards |
| Recent | Ostatnie | backstage |
| Untitled | Bez tytułu | default document name |
| Saved / Saving… / Unsaved changes | Zapisano / Zapisywanie… / Niezapisane zmiany | status bar |

## File types
| English | Office term | Note |
| --- | --- | --- |
| Excel Workbook | Skoroszyt programu Excel | `.xlsx`, the desktop dialog filter name |
| Word Document | Dokument programu Word | `.docx` |
| PowerPoint Presentation | Prezentacja programu PowerPoint | `.pptx` |
| Excel Template / Word Template / PowerPoint Template | Szablon programu Excel / Word / PowerPoint | `.xltx` / `.dotx` / `.potx` |
| CSV (Comma delimited) | CSV (rozdzielany przecinkami) | Calc: label stays "CSV / TXT" |
| Text Files | Pliki tekstowe | |
| PDF | PDF | |
| Office Theme | Motyw pakietu Office | `.thmx` |
| All Files | Wszystkie pliki | |

## Show effects and transitions
Animation effects (`show.fx.*`) and slide transitions (`show.trans.*`) as the catalogs name them (P9-LR3). Names marked as doubtful in the review report are not verified against a localised PowerPoint.

| English | Term | Key |
| --- | --- | --- |
| Appear | Pojawianie się | `show.fx.appear` |
| Disappear | Znikanie | `show.fx.disappear` |
| Fade | Zanikanie | `show.fx.fade` |
| Fly In | Wlatywanie | `show.fx.flyIn` |
| Fly Out | Wylatywanie | `show.fx.flyOut` |
| Grow/Shrink | Powiększanie/zmniejszanie | `show.fx.growShrink` |
| Spin | Wirowanie | `show.fx.spin` |
| Wipe | Wytarcie | `show.fx.wipe` |
| Zoom | Powiększenie | `show.fx.zoom` |
| Cover | Zakrywanie | `show.trans.cover` |
| Cut | Cięcie | `show.trans.cut` |
| Fade | Przenikanie | `show.trans.fade` |
| None | Brak | `show.trans.none` |
| Push | Wypychanie | `show.trans.push` |
| Split | Podział | `show.trans.split` |
| Wipe | Wytarcie | `show.trans.wipe` |
| Zoom | Powiększenie | `show.trans.zoom` |
| Morph | Przekształcenie | `show.trans.morph` |
| Reveal | Odkrywanie | `show.trans.reveal` |
| Shred | Rozdrabnianie | `show.trans.shred` |
| Fall Over | Przewracanie | `show.trans.fallOver` |
| Drape | Draperia | `show.trans.drape` |
| Curtains | Kurtyny | `show.trans.curtains` |
| Wind | Wiatr | `show.trans.wind` |
| Prestige | Prestiż | `show.trans.prestige` |
| Fracture | Pęknięcie | `show.trans.fracture` |
| Crush | Zgniatanie | `show.trans.crush` |
| Peel Off | Odklejanie | `show.trans.peelOff` |
| Page Curl | Zwijanie strony | `show.trans.pageCurl` |
| Airplane | Samolot | `show.trans.airplane` |
| Origami | Origami | `show.trans.origami` |
| Honeycomb | Plaster miodu | `show.trans.honeycomb` |
| Glitter | Brokat | `show.trans.glitter` |
| Vortex | Wir | `show.trans.vortex` |
| Ripple | Fale | `show.trans.ripple` |
| Switch | Przełącznik | `show.trans.switch` |
| Flip | Obrót | `show.trans.flip` |
| Gallery | Galeria | `show.trans.gallery` |
| Cube | Sześcian | `show.trans.cube` |
| Doors | Drzwi | `show.trans.doors` |
| Box | Pudełko | `show.trans.box` |
| Float In | Unoszenie | `show.fx.float` |
| Float Out | Unoszenie – wyjście | `show.fx.floatOut` |
| Split | Podział | `show.fx.split` |
| Shape | Kształt | `show.fx.shape` |
| Circle | Koło | `show.fx.circle` |
| Box | Pudełko | `show.fx.box` |
| Diamond | Romb | `show.fx.diamond` |
| Plus | Plus | `show.fx.plus` |
| Wheel | Koło szprychowe | `show.fx.wheel` |
| Random Bars | Losowe paski | `show.fx.randomBars` |
| Grow & Turn | Powiększanie i obrót | `show.fx.growTurn` |
| Shrink & Turn | Zmniejszanie i obrót | `show.fx.shrinkTurn` |
| Swivel | Obrót wahadłowy | `show.fx.swivel` |
| Bounce | Podskok | `show.fx.bounce` |
| Pulse | Pulsowanie | `show.fx.pulse` |
| Color Pulse | Pulsowanie kolorem | `show.fx.colorPulse` |
| Teeter | Chybotanie | `show.fx.teeter` |
| Desaturate | Zmniejszenie nasycenia | `show.fx.desaturate` |
| Darken | Przyciemnienie | `show.fx.darken` |
| Lighten | Rozjaśnienie | `show.fx.lighten` |
| Transparency | Przezroczystość | `show.fx.transparency` |
| Object Color | Kolor obiektu | `show.fx.objectColor` |
| Line Color | Kolor linii | `show.fx.lineColor` |
| Fill Color | Kolor wypełnienia | `show.fx.fillColor` |
| Brush Color | Kolor pędzla | `show.fx.brushColor` |
| Font Color | Kolor czcionki | `show.fx.fontColor` |
| Underline | Podkreślenie | `show.fx.underline` |
| Bold Flash | Pogrubione mignięcie | `show.fx.boldFlash` |
| Bold Reveal | Pogrubione odsłonięcie | `show.fx.boldReveal` |
| Wave | Fala | `show.fx.wave` |
| Lines | Linie | `show.fx.pathLines` |
| Arcs | Łuki | `show.fx.pathArcs` |
| Turns | Zakręty | `show.fx.pathTurns` |
| Shapes | Kształty | `show.fx.pathShapes` |
| Loops | Pętle | `show.fx.pathLoops` |
| Custom Path | Ścieżka niestandardowa | `show.fx.pathCustom` |
| Play | Odtwórz | `show.fx.mediaPlay` |
| Pause | Wstrzymaj | `show.fx.mediaPause` |
| Stop | Zatrzymaj | `show.fx.mediaStop` |

## More terms
| English | Office term | Note |
| --- | --- | --- |
| Slide | Slajd | PowerPoint PL |
| Transition names (Morph, Reveal, Shred …) | Przekształcenie, Odkrywanie, Rozdrabnianie … | newer PowerPoint effects: translated by analogy, not verified against the Polish UI |
| Fade (transition / entrance) | Przenikanie / Zanikanie | |
| Appear / Disappear / Fly In / Fly Out | Pojawianie się / Znikanie / Wlatywanie / Wylatywanie | |
| Banded rows / columns | Wiersze / Kolumny naprzemienne | |
| Header row / Total row | Wiersz nagłówka / Wiersz sumy | |
| Widow/Orphan control | Kontrola wdów i sierot | |
| Gridlines | Linie siatki | |
| Dialog title (gerund) | Formatowanie komórek, Wstawianie funkcji … | |
