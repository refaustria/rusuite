# Changelog

All notable changes to Rusuite are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [Semantic Versioning](https://semver.org/). One section per app; the GitHub release text is
[docs/release-notes/](docs/release-notes/).

## [Unreleased]

### In progress
- **Report a problem** (all apps, in progress): a dialog that sends a problem report – your text, screenshots you choose and
  diagnostics you can read before sending, never the document – to Rusuite's public issue tracker on GitHub, only when you
  press Send.
- **Show quality pass** (in progress): exploratory testing of every Show feature against PowerPoint, with fixes.

## [0.1.0-rc.1] – untagged

First release candidate: Rusuite Calc, Write and Show as desktop apps for Windows, macOS and Linux and as web apps in the
browser at <https://resuite.inceptum.at/>. They open and save real `.xlsx`, `.docx` and `.pptx` files.

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
- Start page at <https://resuite.inceptum.at/> listing the three apps, a privacy page and a **Downloads** page with the
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

[Unreleased]: https://github.com/refaustria/rusuite/compare/v0.1.0-rc.1...HEAD
[0.1.0-rc.1]: https://github.com/refaustria/rusuite/releases/tag/v0.1.0-rc.1
