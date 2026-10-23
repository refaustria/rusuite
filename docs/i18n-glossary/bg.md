# Glossary: Bulgarian (`bg`)

Source: the Bulgarian localisation of Microsoft Office (Word, Excel, PowerPoint) and its terminology. Translator: P9-L8. Reviewer: P9-LR4 (2026-10-18).

## Register
- Address: informal "ти / теб / твой", 2nd-person singular imperatives in instructions and messages ("Въведи", "Избери", "Щракни", "Натисни", "Провери"); never "Вие / Вас / Ви / Ваш…" or the plural-polite "-ете" imperatives ("Изберете").
- Gender-neutral wording where the user would have to be gendered ("добавени от теб", not "добавил/добавила"; "тези данни не са избрани", not "не си избрал").
- Buttons and menu commands: as Office does – the verbal noun for most commands ("Копиране", "Поставяне", "Вмъкване", "Изтриване"), the imperative "Запиши" / "Запиши като…" / "Отвори" for file commands; messages and hints use the informal imperative.
- Ellipsis "…" for commands that open a dialog, as in English.
- Quotes „…“. Count form after numerals: "{count} слайда", "{count} абзаца" (plural `other`); `one` is the singular ("{count} слайд").
- Keyboard key names in shortcut texts (packages/ui-shared/src/i18n/keyNames.ts): Bulgarian Office keeps Ctrl = Ctrl, Shift = Shift, Delete = Delete, Enter = Enter (no `KEY_NAMES` entry).
- Plural categories: `one / other`.

## Ribbon tabs
| English | Office term | Note |
| --- | --- | --- |
| File | Файл | |
| Home | Начало | |
| Insert | Вмъкване | |
| Draw | Рисуване | |
| Design | Дизайн | |
| Layout (Write: Layout, Calc: Page Layout) | Оформление (Calc: Оформление на страница) | |
| References | Препратки | Write |
| Mailings | Кореспонденция | Write |
| Review | Преглед | |
| View | Изглед | |
| Formulas | Формули | Calc |
| Data | Данни | Calc |
| Transitions | Преходи | Show |
| Animations | Анимации | Show |
| Slide Show | Слайдшоу | Show |
| Help | Помощ | |
| Picture / Table / Chart / Drawing Tools (contextual) | Инструменти за картини / таблици / диаграми / рисуване | |

## Ribbon groups
| English | Office term | Note |
| --- | --- | --- |
| Clipboard | Клипборд | |
| Font | Шрифт | |
| Paragraph | Абзац | |
| Styles | Стилове | |
| Editing | Редактиране | |
| Number | Число | Calc |
| Alignment | Подравняване | Calc |
| Cells | Клетки | Calc |
| Slides | Слайдове | Show |
| Drawing | Рисуване | Show |
| Zoom | Мащаб | |
| Show (View › Show) | Показване | |
| Language | Език | the picker; label "Език / Language" |

## Common commands
| English | Office term | Note |
| --- | --- | --- |
| New | Нов | |
| Open… | Отвори… | |
| Save | Запиши | |
| Save As… | Запиши като… | |
| Print | Печат | |
| Export PDF… | Експортирай като PDF… | |
| Close | Затвори | |
| Options… | Опции… | |
| Undo / Redo | Отмяна / Повтаряне | |
| Cut / Copy / Paste | Изрязване / Копиране / Поставяне | |
| Paste Special… | Специално поставяне… | |
| Format Painter | Формат по образец | |
| Find / Replace… / Go To… | Търсене / Замяна… / Отиди на… | |
| Select All | Избери всичко | |
| Bold / Italic / Underline / Strikethrough | Удебелен / Курсив / Подчертан / Зачертан | |
| Font Color / Highlight / Fill Color | Цвят на шрифта / Осветяване / Цвят на запълване | |
| Insert Picture / Table / Chart / Shape / Text Box | Вмъкване на картина / таблица / диаграма / фигура / текстово поле | |
| Bring to Front / Send to Back | Изнасяне най-отпред / Изпращане най-отзад | |
| Group / Ungroup | Групиране / Разгрупиране | |
| Sort / Filter | Сортиране / Филтър | Calc |
| Insert Function | Вмъкване на функция | Calc |
| New Slide | Нов слайд | Show |
| From Beginning / From Current Slide | От началото / От текущия слайд | Show |
| Track Changes / Comments | Проследяване на промените / Коментари | Write |

## Commands as used in the catalogs
The terms the catalogs use after the review (P9-LR4), one row per English command; the key shows where.

| English | Term | Key |
| --- | --- | --- |
| Copy | Копиране | `ai.pane.copy` |
| Save | Запиши | `ai.settings.save` |
| Insert | Вмъкни | `ai.write.insert` |
| Close | Затвори | `backstage.close` |
| New | Нов | `backstage.new` |
| Open… | Отвори… | `backstage.open` |
| Options… | Опции… | `backstage.options` |
| Print | Печат | `backstage.print` |
| Save As… | Запиши като… | `backstage.saveAs` |
| Cut | Изрязване | `cmd.cut` |
| Delete | Изтриване | `cmd.delete` |
| Find | Търсене | `cmd.find` |
| Paste | Поставяне | `cmd.paste` |
| Redo | Повтаряне | `cmd.redo` |
| Replace… | Замяна… | `cmd.replaceDots` |
| Undo | Отмяна | `cmd.undo` |
| Size | Размер | `conn.browser.colSize` |
| Rename | Преименуване | `conn.browser.rename` |
| Bold | Удебелен | `fmt.bold` |
| Borders | Граници | `fmt.borders` |
| Colors | Цветове | `fmt.colors` |
| Italic | Курсив | `fmt.italic` |
| Strikethrough | Зачертан | `fmt.strike` |
| Underline | Подчертан | `fmt.underline` |
| Zoom | Мащаб | `group.zoom` |
| Layout | Оформление | `print.layoutSection` |
| Margins | Полета | `print.margins` |
| Normal | Нормални | `print.margins.normal` |
| Orientation | Ориентация | `print.orientation` |
| Format | Формат | `sc.format` |
| Remove Arrows | Премахване на стрелките | `calc.audit.removeArrows` |
| Show Formulas | Показване на формулите | `calc.audit.showFormulas` |
| Trace Dependents | Проследяване на зависимите | `calc.audit.traceDependents` |
| Trace Precedents | Проследяване на предходните | `calc.audit.tracePrecedents` |
| Breaks | Прекъсвания | `calc.breaks` |
| Fill | Запълване | `calc.cf.barFill` |
| Clear | Изчистване | `calc.cf.clearFormat` |
| Shapes | Фигури | `calc.cf.iconGroup.shapes` |
| Conditional Formatting | Условно форматиране | `calc.cf.menu` |
| Gridlines | Мрежови линии | `calc.chart.ae.gridlines` |
| Chart | Диаграма | `calc.chart.chart` |
| Center | Център | `calc.chart.pos.center` |
| Recommended Charts | Препоръчани диаграми | `calc.chart.recommended` |
| Shape Fill | Запълване на фигура | `calc.chart.shapeFill` |
| Shape Outline | Контур на фигура | `calc.chart.shapeOutline` |
| New Comment | Нов коментар | `calc.comments.new` |
| Comment | Коментар | `calc.comments.textLabel` |
| Consolidate | Консолидиране | `calc.consolidate.button` |
| Delete Cells… | Изтриване на клетки… | `calc.deleteCellsDots` |
| Remove Duplicates | Премахване на дубликати | `calc.dup.button` |
| Columns | Колони | `calc.dup.columns` |
| Select All | Избери всички | `calc.dup.selectAll` |
| Data Validation | Проверка на данни | `calc.dv.button` |
| Filter | Филтър | `calc.filter` |
| Font Color | Цвят на шрифта | `calc.filter.byFontColor` |
| Flash Fill | Бързо попълване | `calc.flash.button` |
| Effects | Ефекти | `calc.fmt.effects` |
| Justify | Двустранно | `calc.fmt.h.justify` |
| Indent | Отстъп | `calc.fmt.indent` |
| Preview | Визуализация | `calc.fmt.preview` |
| Subscript | Долен индекс | `calc.fmt.subscript` |
| Superscript | Горен индекс | `calc.fmt.superscript` |
| Symbol | Символ | `calc.fmt.symbol` |
| AutoSum | Автоматична сума | `calc.fn.autoSum` |
| Insert Function | Вмъкване на функция | `calc.fn.insert` |
| Format Painter | Формат по образец | `calc.formatPainter` |
| Freeze Panes | Замразяване на екрани | `calc.freezePanes` |
| Goal Seek… | Търсене на цел… | `calc.goal.dots` |
| What-If Analysis | Анализ „какво-ако“ | `calc.goal.whatIf` |
| Hide | Скриване | `calc.hide` |
| Insert Cells… | Вмъкване на клетки… | `calc.insertCellsDots` |
| Link | Връзка | `calc.link.button` |
| Merge Cells | Сливане на клетките | `calc.mergeCells` |
| Merge & Center | Сливане и центриране | `calc.mergeCenter` |
| Move or Copy… | Преместване или копиране… | `calc.moveCopy.dots` |
| Define Name | Дефиниране на име | `calc.names.define` |
| Name Manager | Диспечер на имена | `calc.names.manager` |
| Group | Групиране | `calc.outline.group` |
| Ungroup | Разгрупиране | `calc.outline.ungroup` |
| Page Setup | Настройка на страниците | `calc.pageSetup` |
| Pictures | Картини | `calc.picture.button` |
| PivotTable | Обобщена таблица | `calc.pivot.pivotTable` |
| Refresh All | Обновяване на всички | `calc.pivot.refreshAll` |
| Styles | Стилове | `calc.pivot.stylesGallery` |
| Print Area | Област за печат | `calc.printArea` |
| Print Titles | Печат на заглавия | `calc.printTitles` |
| Sort | Сортират | `calc.protect.allow.sort` |
| Protect Workbook | Защита на книгата | `calc.protect.bookDots` |
| Protect Sheet… | Защита на листа… | `calc.protect.sheetDots` |
| Paste Special… | Специално поставяне… | `calc.ps.dots` |
| Error Checking | Проверка за грешки | `calc.err.dialogTitle` |
| Previous | Предишна | `calc.err.previous` |
| Next | Следваща | `calc.err.next` |
| Evaluate Formula | Оценка на формула | `calc.eval.title` |
| Watch Window | Наблюдателен прозорец | `calc.watch.title` |
| Calculate Now | Изчисли сега | `calc.calc.now` |
| Sort & Filter | Сортиране и филтриране | `calc.sortFilter` |
| Subtotal | Междинна сума | `calc.subtotal.button` |
| Properties | Свойства | `calc.table.properties` |
| Table | Таблица | `calc.table.table` |
| Unhide | Показване | `calc.unhide` |
| Text to Columns | Текст в колони | `calc.wizard.ttcButton` |
| Align Left | Подравняване отляво | `write.alignObj.left` |
| Align Right | Подравняване отдясно | `write.alignObj.right` |
| Align | Подравняване | `write.alignObjects` |
| Bookmark | Отметка | `write.bookmark.button` |
| Insert Caption | Вмъкване на надпис | `write.caption.button` |
| Equation | Уравнение | `write.caption.equation` |
| Position | Позиция | `write.caption.position` |
| Crop | Изрязване | `write.crop` |
| Spacing | Разстояние | `write.font.spacing` |
| Bring Forward | Преместване напред | `write.order.bringForward` |
| Bring to Front | Изнасяне най-отпред | `write.order.bringToFront` |
| Send Backward | Преместване назад | `write.order.sendBackward` |
| Send to Back | Изпращане най-отзад | `write.order.sendToBack` |
| Picture | Картина | `write.picture` |
| Section | Раздел | `write.reveal.section` |
| Rotate | Завъртане | `write.rotate` |
| Ruler | Линийка | `write.ruler` |
| Selection Pane | Екран за селекция | `write.selectionPane` |
| Spelling | Правопис | `write.spelling` |
| Split Cells | Разделяне на клетки | `write.splitCells` |
| Hyperlink | Хипервръзка | `write.styleName.hyperlink` |
| Numbering… | Номериране… | `write.styles.format.numbering` |
| Text Box | Текстово поле | `write.textBox` |
| Wrap Text | Обтичане на текста | `write.wrapText` |
| Cross-reference | Кръстосана препратка | `write.xref.button` |
| Footnote | Бележка под линия | `write.xref.footnote` |
| Reset | Нулиране | `write.notes.sep.reset` |
| Format Background | Форматиране на фона | `show.bg.format` |
| Background Styles | Стилове на фона | `show.bg.styles` |
| Fonts | Шрифтове | `show.design.fonts` |
| Themes | Теми | `show.design.themes` |
| Header & Footer… | Горен и долен колонтитул… | `show.hf.titleDots` |
| Slide Master | Образец на слайда | `show.master.tab` |
| Slide Size | Размер на слайда | `show.size.customTitle` |
| Set Up Slide Show | Настройка на слайдшоуто | `show.setup.titleDots` |
| Guides | Водачи | `show.view.guides` |
| Notes Page | Страница с бележки | `show.view.notesPage` |
| Outline View | Изглед „План“ | `show.view.outline` |
| Reading View | Изглед „Четене“ | `show.view.reading` |
| Slide Sorter | Сортиране на слайдове | `show.view.sorter` |
| Edit Points | Редактиране на точките | `show.editPoints` |
| Fill Color | Цвят на запълването | `show.fx.fillColor` |
| Animation Painter | Четка за анимации | `show.animPainter` |
| From Current Slide… | От текущия слайд… | `show.recordFromCurrent` |
| From Beginning… | От началото… | `show.recordFromStart` |

## Dialog buttons and messages
| English | Office term | Note |
| --- | --- | --- |
| OK | OK | |
| Cancel | Отказ | |
| Apply | Приложи | |
| Close | Затвори | |
| Yes / No | Да / Не | |
| Don't Save | Не записвай | the unsaved-changes prompt |
| Browse… | Преглед… | |
| Reset | Нулиране | |
| Insert / Delete | Вмъкване / Изтриване | |
| Back / Next / Finish | Назад / Напред / Готово | wizards |
| Recent | Последни | backstage |
| Untitled | Без заглавие | default document name |
| Saved / Saving… / Unsaved changes | Записан / Записва се… / Незаписани промени | status bar |

## File types
| English | Office term | Note |
| --- | --- | --- |
| Excel Workbook | Работна книга на Excel | `.xlsx`, the desktop dialog filter name |
| Word Document | Документ на Word | `.docx` |
| PowerPoint Presentation | Презентация на PowerPoint | `.pptx` |
| Excel Template / Word Template / PowerPoint Template | Шаблон на Excel / Word / PowerPoint | `.xltx` / `.dotx` / `.potx` |
| CSV (Comma delimited) | CSV (с разделител запетая) | Calc |
| Text Files | Текстови файлове | |
| PDF | PDF | |
| Office Theme | Тема на Office | `.thmx` |
| All Files | Всички файлове | |

## Show effects and transitions
Animation effects (`show.fx.*`) and slide transitions (`show.trans.*`), named as in the PowerPoint localisation (P9-LR4).

| English | Term | Key |
| --- | --- | --- |
| Appear | Появяване | `show.fx.appear` |
| Disappear | Изчезване | `show.fx.disappear` |
| Fade | Избледняване | `show.fx.fade` |
| Fly In | Влитане | `show.fx.flyIn` |
| Fly Out | Излитане | `show.fx.flyOut` |
| Grow/Shrink | Уголемяване/смаляване | `show.fx.growShrink` |
| Spin | Въртене | `show.fx.spin` |
| Wipe | Избърсване | `show.fx.wipe` |
| Zoom | Увеличение | `show.fx.zoom` |
| Cover | Покриване | `show.trans.cover` |
| Cut | Рязане | `show.trans.cut` |
| Fade | Избледняване | `show.trans.fade` |
| None | Няма | `show.trans.none` |
| Push | Избутване | `show.trans.push` |
| Split | Разделяне | `show.trans.split` |
| Wipe | Избърсване | `show.trans.wipe` |
| Zoom | Увеличение | `show.trans.zoom` |
| Morph | Преобразуване | `show.trans.morph` |
| Reveal | Разкриване | `show.trans.reveal` |
| Shred | Нарязване | `show.trans.shred` |
| Fall Over | Преобръщане | `show.trans.fallOver` |
| Drape | Драпиране | `show.trans.drape` |
| Curtains | Завеси | `show.trans.curtains` |
| Wind | Вятър | `show.trans.wind` |
| Prestige | Престиж | `show.trans.prestige` |
| Fracture | Разцепване | `show.trans.fracture` |
| Crush | Смачкване | `show.trans.crush` |
| Peel Off | Отлепване | `show.trans.peelOff` |
| Page Curl | Завиване на страница | `show.trans.pageCurl` |
| Airplane | Самолет | `show.trans.airplane` |
| Origami | Оригами | `show.trans.origami` |
| Honeycomb | Пчелна пита | `show.trans.honeycomb` |
| Glitter | Блясък | `show.trans.glitter` |
| Vortex | Вихър | `show.trans.vortex` |
| Ripple | Вълнички | `show.trans.ripple` |
| Switch | Превключване | `show.trans.switch` |
| Flip | Обръщане | `show.trans.flip` |
| Gallery | Галерия | `show.trans.gallery` |
| Cube | Куб | `show.trans.cube` |
| Doors | Врати | `show.trans.doors` |
| Box | Кутия | `show.trans.box` |
| Float In | Плаване навътре | `show.fx.float` |
| Float Out | Плаване навън | `show.fx.floatOut` |
| Split | Разделяне | `show.fx.split` |
| Shape | Фигура | `show.fx.shape` |
| Circle | Кръг | `show.fx.circle` |
| Box | Кутия | `show.fx.box` |
| Diamond | Ромб | `show.fx.diamond` |
| Plus | Плюс | `show.fx.plus` |
| Wheel | Колело | `show.fx.wheel` |
| Random Bars | Случайни ленти | `show.fx.randomBars` |
| Grow & Turn | Уголемяване и завъртане | `show.fx.growTurn` |
| Shrink & Turn | Смаляване и завъртане | `show.fx.shrinkTurn` |
| Swivel | Завъртане около оста | `show.fx.swivel` |
| Bounce | Подскачане | `show.fx.bounce` |
| Pulse | Пулсиране | `show.fx.pulse` |
| Color Pulse | Цветно пулсиране | `show.fx.colorPulse` |
| Teeter | Клатушкане | `show.fx.teeter` |
| Desaturate | Обезцветяване | `show.fx.desaturate` |
| Darken | Потъмняване | `show.fx.darken` |
| Lighten | Изсветляване | `show.fx.lighten` |
| Transparency | Прозрачност | `show.fx.transparency` |
| Object Color | Цвят на обекта | `show.fx.objectColor` |
| Line Color | Цвят на линията | `show.fx.lineColor` |
| Fill Color | Цвят на запълването | `show.fx.fillColor` |
| Brush Color | Цвят на четката | `show.fx.brushColor` |
| Font Color | Цвят на шрифта | `show.fx.fontColor` |
| Underline | Подчертаване | `show.fx.underline` |
| Bold Flash | Удебелено проблясване | `show.fx.boldFlash` |
| Bold Reveal | Удебелено разкриване | `show.fx.boldReveal` |
| Wave | Вълна | `show.fx.wave` |
| Lines | Линии | `show.fx.pathLines` |
| Arcs | Дъги | `show.fx.pathArcs` |
| Turns | Завои | `show.fx.pathTurns` |
| Shapes | Фигури | `show.fx.pathShapes` |
| Loops | Бримки | `show.fx.pathLoops` |
| Custom Path | Персонализиран път | `show.fx.pathCustom` |
| Play | Възпроизвеждане | `show.fx.mediaPlay` |
| Pause | Пауза | `show.fx.mediaPause` |
| Stop | Стоп | `show.fx.mediaStop` |

## More terms
| English | Office term | Note |
| --- | --- | --- |
| Workbook / Worksheet | Работна книга / Работен лист | Calc |
| PivotTable / PivotChart | Обобщена таблица / Обобщена диаграма | |
| Conditional Formatting | Условно форматиране | |
| Data Bars / Color Scales / Icon Sets | Ленти с данни / Цветови скали / Набори от икони | |
| Goal Seek | Търсене на цел | |
| Flash Fill | Бързо попълване | |
| Slicer | Срез | |
| Sparklines | Миниграфики | |
| Remove Duplicates | Премахване на дубликати | |
| Data Validation | Проверка на данни | |
| Freeze Panes | Замразяване на екрани | |
| Name Manager | Диспечер на имена | |
| Slide / Slide Master / Layout | Слайд / Образец на слайда / Оформление | Show |
| Speaker notes | Бележки на лектора | |
| Presenter view | Изглед за лектора | |
| Footnote / Endnote | Бележка под линия / Крайна бележка | Write |
| Bookmark / Cross-reference | Отметка / Кръстосана препратка | Write, Show (media) |
| Pointer | Показалец | Show |
| Header / Footer | Горен колонтитул / Долен колонтитул | |
| Table of contents | Съдържание | |
| Text box | Текстово поле | |
| Wrap Text | Пренасяне на текста (Write: обтичане на текста около обект) | |
| AI assistant | AI асистент | |
| Entrance / Emphasis / Exit | Влизане / Акцентиране / Излизане | Show animations; "Подчертаване" is Underline |
| Diagonal (pattern) | диагонал (m.): "Светъл низходящ диагонал" | |
| Split (View) | Разделяне | Calc (P9-LF) |
| Go To Special… / Special… | Отиване на специални… / Специални… | Calc |
| Picture Format / Alt Text | Формат на картината / Алтернативен текст | Calc |
| Mention someone | Споменаване на някого | Calc comments |
| Reasoning (AI setting, reasoning_effort) | Разсъждение | Settings › AI, actions (P9-LF pass 2) |
| dropped (reader warnings) | … е пропуснат(а/о/и) | `reader.xlsx.*` / `reader.pptx.*`, as in `reader.docx.*` |
| read as (reader warnings) | прочетен(а/о) като | reader warnings |
| dangling relationship | невалидна релация | reader warnings |
| Custom show (PowerPoint) | Персонализирано шоу | `reader.pptx.customShow.*` |
| Pivot cache | кеш на обобщена таблица | `reader.xlsx.pivotCache.*` |

## Touch, compact layout and PDF export (P10-LF, 2026-10-23)

One term per gesture across the five catalogs (cycle 3.1415: ui-shared compact bars and sheets, the touch UI of Calc/Write/Show, PDF export, the portal's signing texts).

| English | Term | Used in |
| --- | --- | --- |
| tap | докосване („Докосни …“) | `calc.keys.ref`, `calc.stats.next`, `show.touch.tapToPlay` |
| long press | продължително натискане | (context menu as a sheet; no catalog text yet) |
| pinch | щипване | (zoom; no catalog text yet) |
| swipe | плъзгане | (no catalog text yet) |
| selection handle | манипулатор | `write.touch.handleStart` / `handleEnd` |
| bottom sheet | панел (не „лист“ = worksheet) | `compact.moreSheet`, `compact.closeSheet` (aria labels) |
| fingerprint (GPG) | отпечатък | `portal.dl.signed.linux`, `portal.dl.sums.text` |
| release key | ключ за издания | `portal.dl.signed.linux`, `portal.dl.sums.text` |
| notarized (Apple) | нотаризирано | `portal.dl.signed.macos` |
| More | Още | `compact.more` |
| More commands | Още команди | `compact.moreSheet` |
| Fill | Попълване | `calc.touch.fill` |
| Fill series | Попълване на серия | `calc.touch.fillSeries` |
| Copy cells | Копиране на клетки | `calc.touch.copyCells` |
| Ref | Преп. | `calc.keys.refShort` |
| Share as PDF… | Сподели като PDF… | `backstage.sharePdf` |
| Export PDF | Експортирай като PDF | `print.exportPdf` |
| Multi-select | Множествена селекция | `show.touch.multiSelect` |
