# Changelog

All notable changes to Rusuite are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [Semantic Versioning](https://semver.org/). One section per app; the GitHub release text is
[docs/release-notes/](docs/release-notes/).

## [Unreleased]

## [3.1415] – tag `v3.1415.0`

Second release with π version numbers (docs/versioning.md): public name **3.1415**, semver `3.1415.0`. Release text:
[docs/release-notes/3.1415.md](docs/release-notes/3.1415.md). No new file features: the cycle is about phones, tablets
and signed builds.

### Phones and tablets (Android, iOS)
- Tauri 2 shells for Calc, Write and Show (`dev.rusuite.<app>`; Android 8.0+, iOS 15+): document picker, write-back to
  the opened document, export and share through the system sheet, "Open with" for `.xlsx`, `.docx`, `.pptx`.
- **Compact layout** below 900 px: top bar and bottom command bar built from the ribbon definitions, bottom-sheet
  dialogs and menus, 44 px targets, safe areas, soft-keyboard handling (also in the web app on a phone).
- **Touch editing:** Calc – selection handles, pan versus select, pinch zoom, fill handle, formula keyboard row with
  reference picking; Write – fit-width page, long-press selection with floating bar and handles, picture and table
  handles; Show – thumbnail strip, pinch/twist transforms, same-window presentation with swipe, Timing sheet.
- **PDF:** export, print and share as PDF on Android and iOS; Linux desktop writes the PDF without the print dialog
  (Windows and macOS desktop still use the print dialog). "Report a problem" is hidden on mobile.
- **Stores:** listings in 24 languages (Play accepts 22, the App Store 18), release notes, screenshots, graphics,
  review notes; `scripts/store/play.mjs` and `asc.mjs`; `mobile-release.yml` uploads signed AABs to the Play internal
  track and IPAs to TestFlight on tags.

### Signing (desktop)
- macOS Developer ID signing and notarization, Windows Authenticode (PFX or Azure Trusted Signing), Linux GPG
  signatures (`.asc`, `SHA256SUMS(.asc)`), each switched on by its repository secrets; `signing.json` records what was
  signed and the Downloads page shows it (docs/signing.md).

### All apps
- The interface texts of the compact layout, touch and PDF in all 24 languages (strict i18n gate green).
- Downloads page: a "Phones and tablets" block with Play Store / App Store badges (`docs/store/links.json`); the
  portal's "New in 3.1415" and "Coming soon" sections.

### Versioning and release
- `wix_version` maps MINOR > 255 (`3.1415.0` → MSI `3.14.15.0`); the MSI of 3.1415 does not upgrade 3.141 (NSIS
  installer does). `check-versions.sh` asserts the Android `versionCode` / iOS build number (4415000) is above the
  earlier releases'.

## [3.141] – 2026-10-18, tag `v3.141.0`

First release with π version numbers (docs/versioning.md): public name **3.141**, semver `3.141.0`. Release text:
[docs/release-notes/3.141.md](docs/release-notes/3.141.md).

### Calc (spreadsheets)
- **Protection:** protect sheets and the workbook (Review tab, 15 permissions, password), locked and hidden cells
  honoured, hidden formulas, a padlock on protected sheets.
- **Formatting and sheets:** Borders menu with 11 presets, accounting underlines, 17 pattern fills, rotated text and
  diagonal borders in print, Move or Copy sheet, unhide several sheets at once, tab colours, the active sheet is saved;
  conditional formatting, validation and pivot sources follow inserted and deleted cells.
- **Tables and data tools:** deleting or renaming a table column updates structured references, custom table styles,
  **slicers** for tables and PivotTables, **Flash Fill** (Ctrl+E), Consolidate, Auto Outline, print titles for columns
  and rows, several print areas, `.csv`/`.txt` in the desktop Open dialog.
- **PivotTables:** group dates (years, quarters, months) and numbers, calculated fields and items, label/value/date and
  Top 10 filters, sort by value, Distinct Count and seven Show Values As modes, blank rows, Report Filter Pages,
  Recommended PivotTables and **PivotCharts**.
- **Formulas:** the space (intersection) and union operators, 3-D references across sheets, R1C1 references, LET and
  LAMBDA (with MAP, REDUCE, SCAN, BYROW, BYCOL, MAKEARRAY), TAKE, DROP, VSTACK, HSTACK, CHOOSECOLS, CHOOSEROWS, EXPAND,
  TOCOL, TOROW, WRAPROWS, WRAPCOLS, MMULT, MINVERSE, MDETERM, AGGREGATE and more – 247 functions; manual calculation
  (F9), Apply Names and Paste Names (F3), **Error Checking** with green triangles, **Evaluate Formula**, Watch Window,
  trace arrows that follow edits.
- **Conditional formatting and sorting:** "A Date Occurring", above/below average with standard deviations, Excel 2010
  data bars (solid fill, border, negative colour, axis), Format Painter, rules that move with paste, cut and sort,
  Circle Invalid Data, sort and filter by cell colour, font colour and icon, custom lists, left-to-right sort, date
  groups in the filter list.
- **Charts:** fills, borders, shadows and rounded corners for the chart and plot area, text formats on every element,
  rotated category labels, error bars, data tables, up/down bars, high-low lines, per-point labels and labels from
  cells, manual layouts by dragging, chart sheets, `=SERIES()` in the formula bar.
- **Sparklines:** line, column and win/loss sparklines in cells and in print, with the Sparkline tab and 36 styles.
- **Cells and comments:** text overflow, `####` and wrap like Excel (also in print), split panes and the saved scroll
  position, Go To Special, a Comments pane across all sheets with @mentions, picture cropping and the Picture Format
  tab, pictures, notes and comments in print, faster printing.

### Write (documents)
- **Lists:** List Paragraph style and contextual spacing, Backspace at the start of a list item like Word, list levels
  from real indents, bullet, numbering and multilevel galleries, Define New Number Format and Bullet, Set Numbering
  Value, heading numbers in the table of contents and Navigation pane.
- **Shortcuts:** Word's grow/shrink font, small caps, all caps, double underline, Ctrl+T, Ctrl+Q, Shift+F3, underline
  words only (Ctrl+Shift+W) and the special-character shortcuts.
- **Pages:** mixed portrait and landscape pages each at their own size (also in print and PDF), editable footnote
  continuations, footnote and endnote numbering per section, endnotes at the end of a section, nested tables that split
  across pages, faster pagination.
- **Styles and templates:** Word's bold/italic toggle rule, Font › Advanced, Manage Styles, the Design tab with 10 style
  sets and paragraph spacing, numbering in Modify Style, Reveal Formatting (Shift+F1), **`.dotx` templates** (File › New
  with Blank, Report, Letter, Memo and Minutes), more document properties and fields.
- **Drawings:** grouped shapes, linked text boxes, drag-to-draw, rotation handles, crop to shape/aspect/fill/fit, soft
  edges and bevels, text wrapping on both sides, hyperlinks on shapes and pictures, drawing canvases, Align/Distribute,
  the Selection pane (Alt+F10) and the Position dialog.
- **Tables:** split and merge tables, convert text to table and back, AutoFit, floating tables, Table Properties,
  Borders and Shading, Border Styles and the Border Painter, View › Gridlines, drag indent and column markers on the
  ruler, unequal columns, basic AutoCorrect, units cm/in in File › Options.
- **Comments, notes and fields:** bold/italic/underline and links in comments, @mentions, comments in footnotes and
  endnotes, Display for Review (Simple Markup, No Markup, Original), Print Markup, convert footnotes and endnotes,
  separators, SECTIONPAGES, STYLEREF, SEQ and REF switches, field locking, field codes view (Alt+F9), update fields
  (F9), Insert › Field.

### Show (presentations)
- **Text:** rich in-place editing with levels, bullets and run formatting while typing, Shift+Enter, autofit (shrink
  text or resize shape), formatted prompt text, editing text directly on the slide master and layouts, levels 2–9,
  rename layouts and add placeholders, Insert › Text Box by click or drag.
- **Tables and shapes:** table styles that match PowerPoint's own definitions with a Best Match gallery, diagonal
  borders, cell text direction, Draw Borders, custom cell margins, Format Shape for cells; **Freeform and Scribble**
  with Edit Points; 177 preset shapes (was 110), adjust handles by keyboard.
- **Views and design:** Outline view with formatting, custom shows, Set Up Show, Format Background with gradients,
  patterns and picture offsets, Design › Effects, Slide Size scales masters and layouts, guides on masters and layouts,
  zoom and pane sizes saved with the file, print ranges with sections.
- **Animations and transitions:** 16 entrance/exit and 18 emphasis effects, motion paths including custom paths with
  vertex editing, text by paragraph, word or letter, triggers, Animation Painter, the Timing dialog, 24 PowerPoint 2010+
  transitions, transition sounds, media trimming, fades and bookmarks, Play Across Slides.
- **Presenting and reuse:** a presenter console with editable notes, timers, a white screen, See All Slides, zoom,
  pen, highlighter, laser and eraser shown on the audience screen (keep your ink as drawings), monitor choice, Record
  Slide Show (timings) and Play Narrations, several slide masters in one deck, Reuse Slides with the source formatting, Browse for
  Themes (`.thmx`/`.potx`/`.pptx`) and Save Current Theme.

### All apps
- **24 languages:** Bulgarian, Croatian, Czech, Danish, Dutch, English, Estonian, Finnish, French, German, Greek,
  Hungarian, Irish, Italian, Latvian, Lithuanian, Maltese, Polish, Portuguese, Romanian, Slovak, Slovenian, Spanish and
  Swedish – picked from a list with native names, or matched to your browser's language. Every language follows the
  Microsoft Office terms of that language and addresses you informally.
- **AI assistant** (desktop only, with your own Anthropic or OpenAI-compatible key): the whole document is cached so
  follow-up actions are faster and cheaper, a reasoning-effort choice (Off/Low/Medium/High), attach a picture (Write,
  Show), describe a picture as alt text, explain a chart, answers in the UI or document language, a model and
  reasoning setting per action, save or copy a conversation as Markdown, and a guide for local models (Ollama, LM
  Studio).
- Shared shape geometry for Show and Write (one set of 177 presets, adjust and rotation handles alike in both apps).
- Warnings when opening `.xlsx` and `.pptx` files are shown in your language; **F12** is Save As in all three apps.
- The File view shows the version ("Rusuite Calc 3.141").
- **Website** (rusuit.es): in all 24 languages, a "New in 3.141" section, the release and build in the footer, and a
  Downloads page that explains the macOS Gatekeeper and Windows SmartScreen warnings step by step.
- Dialogs return the keyboard focus reliably, and several timing problems found by the automated tests are fixed.

### Upgrade notes
- None expected: documents stay standard `.xlsx`, `.docx` and `.pptx` files; settings, recent files and autosave
  copies are kept.

### Known limitations
- **Calc:** protection options "select locked/unlocked cells" do not restrict the selection yet, and Allow Edit Ranges
  is missing; stacked vertical text; slicers are not printed or copied with Duplicate Sheet, and timelines are missing;
  calculated pivot items are not included in subtotals and grand totals, no automatic date grouping, no PivotChart field
  buttons; ignored error-checking warnings are not saved; colour filters for tables and custom icon sets are missing;
  some chart details (custom label text, pattern fills, glow/soft edge/3-D effects, drop lines) are lost on save;
  sparkline colours are not yet confirmed against Excel; Calc's slicer and protection files have been checked against
  the specification only, not yet in Excel.
- **Write:** lists inside comments and comments in text boxes; wrap polygons (Tight/Through, Edit Wrap Points); resize
  handles on group members; diagonal table cell borders; a table's continuation page has no top border; dialogs still
  measure in cm; picture bullets and Define New Multilevel List are missing; Word's style sets are approximated.
- **Show:** per-letter/per-word animation is approximated, triggers are not mirrored in the presenter view; the Slide
  Master view edits the main design only; presenter ink is saved as drawings, not as PowerPoint ink; Paragraph dialog
  and ruler markers for indents are missing; recording narrations is missing; compound lines on shapes; the new
  animation, outline and theme files have not yet been checked in PowerPoint.
- **AI assistant:** exporting a conversation in the desktop Calc and Write saves through a download instead of the
  system dialog.
- **Languages:** the translations were reviewed against Office terminology, not yet by native speakers – proof-reading
  of Irish and Maltese is especially welcome; some long labels may be shortened in narrow windows; a few messages
  (error details inside file warnings) stay in English.
- **Desktop:** unsigned builds and no automatic updates; saving overwrites the file directly (no temporary file) and
  does not warn when the file changed on disk.
- **Files:** compatibility is tested against LibreOffice and generated reference files; checks with files made in
  Microsoft Office are done by hand before each release (docs/testing.md).

## [0.1.0] – 2026-10-16

The release candidate below, released as 0.1.0 (docs/release-notes/0.1.0.md), plus:
- **Portal** (rusuit.es): wordmark, a "free, open source, and it stays that way" statement and an Open source section.
- **Report a problem** (all apps): a dialog that sends a problem report – your text, screenshots you choose and
  diagnostics you can read before sending, never the document – to Rusuite's public issue tracker on GitHub, only when
  you press Send.
- **Show quality pass:** exploratory testing of every Show feature against PowerPoint, with fixes.

## [0.1.0-rc.1] – untagged

First release candidate: Rusuite Calc, Write and Show as desktop apps for Windows, macOS and Linux and as web apps in the
browser at <https://rusuit.es/>. They open and save real `.xlsx`, `.docx` and `.pptx` files.

### Calc (spreadsheets)
- Formula engine compatible with Excel: 221 functions (maths, statistics, text, dates, lookup incl. XLOOKUP, logic,
  financial, information, INDIRECT/OFFSET), dynamic arrays that spill (`SORT`, `FILTER`, `UNIQUE`, `SEQUENCE`, `A1#`,
  `#SPILL!`), named ranges with the Name Manager, structured references to tables, circular-reference warnings.
- Formula editing like Excel: click or arrow to insert references, coloured references, function autocomplete with
  argument tips, F4 to toggle `$`, an unfinished formula is never thrown away.
- Typing recognises numbers, dates, times, percentages, currency and fractions and gives the cell a matching format.
- Fill handle with series (numbers, dates, weekdays, months), copy/cut/paste with reference adjustment, Paste Special,
  Ctrl+D / Ctrl+R, Ctrl+Enter into a selection.
- Formatting: fonts, colours, borders, alignment, wrap text, merge cells, the full Excel number-format language with the
  Format Cells › Number dialog, conditional formatting (highlight rules, top/bottom, data bars, colour scales, icon sets)
  and data validation with dropdown lists.
- Sheets: insert, delete, rename, duplicate, move, colour, hide; freeze panes, zoom, gridlines; insert/delete rows and
  columns, hide/unhide, autofit.
- Data: sort (several keys), AutoFilter (values, text/number filters, top 10), Excel tables, Remove Duplicates, Text to
  Columns, Goal Seek, outline/grouping with Subtotal, CSV import, find and replace.
- PivotTables with a Fields pane (drag fields into areas), value settings, layouts, styles, filters, expand/collapse and
  GETPIVOTDATA.
- Charts (column, bar, line, area, pie, scatter, combo and more) with Chart Design/Format tools and Select Data.
- Notes, threaded comments and cell hyperlinks; pictures in sheets; page break preview and Page Layout settings.
- Printing with preview: sheet, workbook or selection, scaling, repeated rows, headers and footers; PDF export.

### Write (documents)
- Paragraph and character formatting (13 font effects incl. small caps, strikethrough, superscript, Change Case), the Font
  and Paragraph dialogs, borders and shading, tab stops on the ruler.
- Full style management: quick styles, Styles pane, Modify/Create Style, Apply Styles box, Style Inspector, Navigation
  pane.
- Lists: bullets, numbering and multilevel lists with Word's numbering.
- Tables with merged cells, table styles and the Table Design/Layout tabs; pictures (inline and floating with text
  wrapping, crop, borders, styles); shapes and text boxes.
- Print layout with real pages: page breaks per line, headers and footers (first/odd/even), sections with their own page
  setup and columns, footnotes and endnotes at the page foot, widow control and keep-with-next.
- References: table of contents, captions, cross-references, bookmarks, hyperlinks, fields (page numbers, dates).
- Comments with replies and resolve, the Review tab and print markup.
- Find and replace with formatting and wildcards; spell check through the system/browser; typing is one undo step.
- Document properties (File › Info), Symbol dialog, printing with page ranges, PDF export.

### Show (presentations)
- Slide editor with layouts, placeholders, text formatting, shapes (110 preset shapes with adjust handles), connectors that
  stay glued, pictures with crop and adjustments, groups, tables with styles, charts with their own data, audio and video.
- Themes (8 built-in designs, variants, theme fonts and colours), backgrounds, slide size, Slide Master view with editable
  layouts, headers and footers, sections.
- Transitions and animations with the Animations pane and playback in the slide show.
- Views: Normal, Outline, Slide Sorter, Notes Page and Reading view; rulers, grid, guides and smart guides; Selection pane.
- Slide show with presenter view (notes, next slide, timer), pen tools, rehearse timings, hidden slides.
- Copy/paste of shapes and slides, Reuse Slides from another deck, hyperlinks and action buttons, alt text.
- Printing of slides, handouts and notes pages; PDF export.

### All apps
- Office-style ribbon (File backstage, tabs, galleries, contextual tabs) that collapses groups on narrow windows, keyboard
  access with Alt, shortcuts like Office (Ctrl+/ lists them).
- English and German user interface, switchable at any time.
- Undo/redo, recent files, autosave every 30 seconds with crash recovery, Save/Don't save/Cancel before anything that would
  discard changes.
- Desktop only: open and save on your own WebDAV server (Nextcloud, ownCloud, a NAS) and an optional AI assistant with your
  own Anthropic or OpenAI-compatible API key – both off until you set them up.

### Portal (website)
- Start page at <https://rusuit.es/> listing the three apps, a privacy page and a **Downloads** page with the
  installers for each operating system and their SHA-256 checksums; English and German.

### Desktop
- Installers for Windows (`.exe`, `.msi`), macOS (Apple Silicon and Intel `.dmg`) and Linux (`.deb`, `.rpm`,
  `.AppImage`). The builds are **not code-signed**: Windows SmartScreen and macOS Gatekeeper warn before the first start.
- Save writes to the file you opened without asking again; Save As uses the system dialog; native printing.

### Privacy
- Your documents never leave your device. The website stores nothing on the server: no upload, no account, no tracking,
  no analytics; a strict security policy lets the web apps talk only to their own site. Autosave copies and recent files
  stay in your browser or, on the desktop, in your user account's app folder, and can be removed in File › Privacy.
  Cloud connections and the AI assistant exist only in the desktop apps, only with your own accounts, and only contact
  the server you configured when you use them.

### Known limitations
- **Calc:** Format Cells has only the Number tab (alignment, font, border and fill are on the ribbon); Insert/Delete
  cells cannot shift cells (whole rows or columns only); the space intersection operator is not supported; a circular
  reference shows `#NUM!` instead of 0; German decimal commas are not accepted as input (formulas and numbers use
  English separators).
- **Write:** documents mixing portrait and landscape pages show all pages at the widest width; new lists keep the Normal
  style's spacing (no List Paragraph); Backspace at the start of a list item also removes its indent; reader warnings stay
  English in the German UI; some Word shortcuts are missing (grow/shrink font, Ctrl+T, Ctrl+Q, Shift+F3).
- **Show:** no freeform/scribble drawing tool; connectors route with simpler detours than PowerPoint; theme effects beyond
  outer shadows survive only while the theme is unchanged; Reuse Slides with "keep source formatting" copies layouts but
  not the source master; transitions are not drawn in PDF export.
- **Desktop:** unsigned builds and no automatic updates; saving overwrites the file directly (no temporary file) and does
  not warn when the file changed on disk.
- **Files:** compatibility is tested against LibreOffice and generated reference files; checks with files made in
  Microsoft Office are done by hand before each release (docs/testing.md).

[Unreleased]: https://github.com/refaustria/rusuite/compare/v3.141.0...HEAD
[3.141]: https://github.com/refaustria/rusuite/releases/tag/v3.141.0
[0.1.0]: https://github.com/refaustria/rusuite/releases/tag/v0.1.0
[0.1.0-rc.1]: https://github.com/refaustria/rusuite/releases/tag/v0.1.0-rc.1
