# Glossary: Polish (`pl`)

Source: the Polish (Poland) localisation of Microsoft Office (Word, Excel, PowerPoint) and its terminology. Translator: P9-L5. Reviewer: –.

## Register
- Address: informal "ty / ci / cię / twój / twoja / twoje" (capitalised mid-sentence: "Twoje pliki", "Cię", as in letters); imperatives in the 2nd person singular ("Wpisz", "Wybierz", "Kliknij", "Zaznacz"); never "pan / pani / państwo", "Proszę wybrać" or 3rd-person polite forms ("Niech pan…").
- Buttons and menu commands: imperative or noun, as Office does ("Zapisz", "Otwórz", "Wstaw tabelę", but dialog titles as gerund nouns: "Wstawianie hiperłącza", "Formatowanie komórek").
- Gender-neutral wording: avoid past-tense 2nd-person forms ("czego oczekiwałeś") – use imperatives or impersonal forms instead.
- Ellipsis "…" for commands that open a dialog, as in English.
- Quotation marks: „…” (Polish low-high pair).
- Keyboard key names in shortcut texts (packages/ui-shared/src/i18n/keyNames.ts): Polish Office keeps Ctrl = Ctrl, Shift = Shift, Delete = Delete, Enter = Enter (no table entry needed).
- Plural categories: `one / few / many / other`. `one` = 1; `few` = 2–4 (not 12–14); `many` = 0, 5–21, 25–31 …; `other` = fractions (genitive singular: "1,5 wiersza"). Where the noun would need declension, a neutral pattern is used ("Tabele przestawne wymagające odświeżenia: {count}", "… ({count})"). Unit abbreviations ("{count} min temu") are identical in all four forms.

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

## More terms
| English | Office term | Note |
| --- | --- | --- |
| Slide | Slajd | PowerPoint PL |
| Transition names (Morph, Reveal, Shred …) | Przekształcenie, Odkrywanie, Rozdrabnianie … | newer PowerPoint effects: translated by analogy, not verified against the Polish UI |
| Fade (transition / entrance) | Przenikanie / Zanikanie | |
| Appear / Disappear / Fly In / Fly Out | Pojawianie się / Znikanie / Wlot / Wylot | |
| Banded rows / columns | Wiersze / Kolumny naprzemienne | |
| Header row / Total row | Wiersz nagłówka / Wiersz sumy | |
| Widow/Orphan control | Kontrola wdów i sierot | |
| Gridlines | Linie siatki | |
| Dialog title (gerund) | Formatowanie komórek, Wstawianie funkcji … | |
