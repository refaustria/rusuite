# UI: the ribbon

All three apps use the same Office-style ribbon from `packages/ui-shared/src/ribbon` (P6-1): a tab strip with the app name and
document title on the left, **File** + the app's tabs, a right slot (Show: Present) and the collapse toggle, over the active
tab's groups. Expanded it is ≤ 96 px tall (28 px strip + 64 px groups, so at most two rows of small controls per stack);
collapsed it is the strip only. On a narrow window the groups that do not fit collapse from the right, each into one button
with the group's name and ▾ whose popup shows the group as in the ribbon (a command closes it; P8-38).


## Contents

Calc's and Show's ribbon tabs are described under [Tabs per app](#tabs-per-app); the sections below add the details.

- [Write](#write)
  - [Write additions (P6-4)](#write-additions-p6-4)
  - [Write structure (P8-10)](#write-structure-p8-10)
  - [Write tables, pictures, paragraph borders and tabs (P8-17)](#write-tables-pictures-paragraph-borders-and-tabs-p8-17)
  - [Write styles (P8-21)](#write-styles-p8-21)
  - [Write comments (P8-25)](#write-comments-p8-25)
  - [Write links, references, columns, properties (P8-27)](#write-links-references-columns-properties-p8-27)
  - [Write print layout: true pagination (P8-31)](#write-print-layout-true-pagination-p8-31)
  - [Write shapes, text boxes, picture formatting, character formatting (P8-34)](#write-shapes-text-boxes-picture-formatting-character-formatting-p8-34)
  - [Write quality pass (P8-38)](#write-quality-pass-p8-38)
  - [Write pagination round 3 (P9-W2)](#write-pagination-round-3-p9-w2)
  - [Write styles round 2, templates and properties (P9-W3)](#write-styles-round-2-templates-and-properties-p9-w3)
  - [Write drawings, pictures and floating objects round 2 (P9-W4)](#write-drawings-pictures-and-floating-objects-round-2-p9-w4)
- [Building blocks (@rusuite/ui-shared)](#building-blocks-rusuiteui-shared)
- [Keyboard](#keyboard)
- [Tabs per app](#tabs-per-app)
- [Cloud connections (P8-36)](#cloud-connections-p8-36)
- [AI assistant (P8-37)](#ai-assistant-p8-37)
- [Save and Save As on the desktop (P7-7)](#save-and-save-as-on-the-desktop-p7-7)
- [Unsaved changes (P7-6)](#unsaved-changes-p7-6)
- [Show: slide show and presenter view (P7-8)](#show-slide-show-and-presenter-view-p7-8)
- [Show: shape library, connectors and tables (P8-16)](#show-shape-library-connectors-and-tables-p8-16)
- [Show: transitions and animations (P8-8)](#show-transitions-and-animations-p8-8)
- [Show: themes, layouts, master view, footers, sections, pictures (P8-22)](#show-themes-layouts-master-view-footers-sections-pictures-p8-22)
- [Show: master and layout editing, picture backgrounds, table styles, preset data (P8-32)](#show-master-and-layout-editing-picture-backgrounds-table-styles-preset-data-p8-32)
- [Show: charts, links, action buttons, audio/video, Reuse Slides (P8-24)](#show-charts-links-action-buttons-audiovideo-reuse-slides-p8-24)
- [Show: views, rulers, guides, Selection pane, text options, slide-show tools (P8-28)](#show-views-rulers-guides-selection-pane-text-options-slide-show-tools-p8-28)
- [Show: rich in-place text, autofit text boxes, master text levels (P9-S1)](#show-rich-in-place-text-autofit-text-boxes-master-text-levels-p9-s1)
- [Show: tables and shapes round 2 (P9-S2)](#show-tables-and-shapes-round-2-p9-s2)
- [Printing (P7-9)](#printing-p7-9)
- [Logos and the portal (P7-10)](#logos-and-the-portal-p7-10)
- [Privacy (P7-12, ADR 0009)](#privacy-p7-12-adr-0009)

## Write

### Write additions (P6-4)
Contextual **Table** tab (insert/delete rows and columns, shading, borders, header row, row height), contextual **Picture Format** tab (alt text, align, size, reset, delete), **Print layout** view with page gaps, greyed headers/footers (double-click to edit) and Draft view, non-modal find bar with highlighted matches, Paragraph dialog, format painter, highlight/font colour menus, View › Spelling.

### Write structure (P8-10)
- **References** tab: Table of contents ▾ (automatic table with 3, 2 or 1 levels → `InsertToc`, before the caret's block when the
  caret is at its start, else after it), Update table (`UpdateToc` with the page of every heading from the print-layout
  pagination); Footnotes: Insert footnote / endnote, Next / Previous footnote.
- **Insert**: Footnotes group (Insert footnote Ctrl+Alt+F, Insert endnote Ctrl+Alt+D → `InsertFootnote` at the caret; the caret
  moves into the new note), Text › Field ▾ (Page, Number of pages, Date, Time, File name, Author → `InsertField` with the
  current value as its cached result), Page number ▾ adds *Current position* (a page field) and *Format page numbers…*
  (format 1/i/I/a/A, continue or start at N → `SetSection`).
- **Layout**: Margins / Orientation / Size act on the caret's section (`SetSection { page }`; `SetPage` for documents without
  sections); Breaks ▾ (Page break; section breaks Next page / Continuous / Even page / Odd page → `SplitParagraph` +
  `InsertSectionBreak`).
- **Home › Paragraph › Multilevel list** ▾: Word's list library (see "Write lists, numbering and Word shortcuts (P9-W1)"
  below); right-click in a list: **Restart at 1** (`RestartList`) / **Continue numbering** (`ContinueList`) / **Set
  Numbering Value…**.
- **Header and footer** dialog: Different first page (`titlePage`), Different odd & even pages, one text per slot; each
  changed slot is stored as blocks of the caret's section (`SetHeaderFooter`, `{PAGE}` → a page field).
- **Rendering**: fields are grey-shaded with their cached result, or the live value (page numbers from the pagination, date,
  time, file name); note references are superscript numbers in reference order (footnotes 1, 2…, endnotes i, ii…); the notes
  area after the body holds the editable notes (footnotes, then endnotes; double-click a reference to jump to its note and the
  note's number to jump back); in print layout the footnotes sit at the bottom of their page instead (P8-31). A table of contents is a
  non-editable block (click an entry to go to the heading). List labels come from Rust (`listLabel`). A section end shows a
  dotted "Section break (Next page)" line; in print layout a new section starts a new page with its own page size, margins,
  headers/footers (first-page / even) and page numbering. Saving first sends `UpdateFields` for fields whose live value
  differs from the cached one.

### Write tables, pictures, paragraph borders and tabs (P8-17)
- **Sync**: merged cells map to ProseMirror `colspan` / `rowspan` (`gridSpan`; a `vMerge` region's first cell gets the rowspan
  and keeps the covered `continue` cells in its `continues` attribute, restored by `tableFromPM` — a row of continue cells only
  is an empty row); `InlineImage.anchor` is an image attribute (a change → `SetImageAnchor`); paragraph `borders` / `shading` /
  `tabs` travel in the paragraph's `extra`. Table commands use grid coordinates (`TableMap`); a cell selection grows to whole
  merged cells.
- **Table Design** tab: Table Style Options (Header Row, First Column, Total Row, Last Column, Banded Rows, Banded Columns →
  `look`), table styles gallery with previews (Table Grid, Plain Table 1, List Table 3, Grid Table 4 Accent 1–3 and the
  document's own table styles; ▾ also Clear; a table without a look gets Word's default look with its first style), Shading ▾
  and Borders ▾ (bottom/top/left/right, none, all, outside, inside, inside horizontal/vertical) for the selected cells
  (`SetCellProps`).
- **Table Layout** tab: Select ▾ (cell, column, row, table), Properties… (alignment, indent, automatic resize, allow row to
  break across pages, repeat header row), Delete ▾ / Insert above/below/left/right, Merge Cells, Split Cells… (columns × rows;
  rows must divide a merged region), Cell Size (row height / column width in cm, Distribute Rows / Columns, Row height…),
  Alignment 9-grid (cell vertical alignment + paragraph alignment) and Cell Margins…, Header row. The context menu adds Merge
  Cells, Split Cells…, Table Properties….
- **Rendering**: every cell gets its resolved formatting (`features/tableStyles.ts`, a mirror of
  `Document::resolve_cell_props`: style along `basedOn`, conditional formats by look, direct props; edges, fill, padding,
  vertical alignment, the style's text colour/bold) as a node decoration; table width, alignment and indent on the table.
  Borders "none" show as light gridlines on screen.
- **Picture Format › Arrange**: Position ▾ (In Line with Text; nine "With Text Wrapping" presets aligned to the margin) and Wrap
  Text ▾ (In Line, Square, Tight, Top and Bottom, Behind Text, In Front of Text); the **Layout Options** button next to a
  selected picture offers the same wrap choices. A selected floating picture is moved by dragging (offsets from the column and
  the paragraph). Square/Tight float (one side: the side with more room, `wrapSide` respected), Top and Bottom is a block,
  Behind / In Front are positioned outside the flow relative to the anchor paragraph (z-order below / above the text).
  Vertical positions relative to the margin or page are resolved against the anchor paragraph's page in print layout
  (P8-31; draft view: at the paragraph).
- **Home › Paragraph**: Shading ▾ (fill), Borders ▾ (bottom/top/left/right toggle, no border, all, outside, inside = between,
  Borders and Shading… with setting, style, colour, width, sides and shading), Tabs… (position, alignment, leader, Set /
  Clear / Clear All). Paragraphs with equal borders form one box (top above the first, bottom below the last, "between"
  lines, the spacing inside); left/right borders sit in the indent like Word's.
- **Ruler** (View › Show › Ruler): the caret paragraph's column (a table cell's own), indents, tab stops; click adds a stop of
  the corner selector's kind, drag moves, drag off removes. Tab characters are laid out from the stops in effect (style chain +
  direct, `clear` entries; Word's default every 1.27 cm): left, centre, right, decimal, with dot / hyphen / underscore leaders.
  Tab outside tables and lists types a tab character.
- Print and Export PDF print the print layout's pages (P8-31), so they show all of it.

### Write styles (P8-21)
- **Styles gallery** (Home › Styles): the document's quick styles (`qFormat`, Word's order by `uiPriority`; Heading *N* ≥ 3
  appears once Heading *N*−1 is used, semi-hidden styles once used) with live previews (font, size scaled down, colour,
  weight as the style resolves). Click applies (paragraph styles through the editor → `SetStyle`; character styles and a
  linked style on part of one paragraph → `ApplyCharacterStyle`). Right-click: Update *X* to Match Selection
  (`UpdateStyleFromSelection`), Modify…, Select All *n* Instances (`blocksWithStyle`; consecutive paragraphs become the
  selection, otherwise the caret goes to the first and the next style applied goes to all of them), Rename…, Remove from /
  Add to Style Gallery. The ▾ adds Create a Style…, Clear Formatting, Apply Styles…; the Styles pane button (Mod+Alt+Shift+S)
  toggles the pane.
- **Styles pane** (right of the page): every style with its preview text (Show Preview), kind glyph (¶ paragraph, a
  character, ¶a linked), the caret's styles highlighted; Show: Recommended (priority < 99, user styles, styles in use; by
  priority) / In use / All styles (alphabetical; hidden styles and the `… Char` halves of linked styles never). Disable Linked
  Styles makes linked styles act as paragraph styles. A ▾ per style (always visible, no hover-only control) with the gallery
  menu plus Delete *X*… (user styles only; paragraphs go back to Normal, runs lose the character style). New Style opens
  Create New Style from Formatting; Style Inspector shows the paragraph style + direct paragraph formatting and the
  character style + direct character formatting, each with Clear; Clear All = Clear All Formatting.
- **Modify Style / Create New Style from Formatting**: name, style type (read-only when modifying), based on, style for
  the following paragraph, a formatting toolbar (font incl. +Body / +Headings theme fonts, size, B/I/U, colour, alignment,
  line spacing 1 / 1.5 / 2, space before/after, indent), a preview with Word's description line, Add to the Styles gallery,
  Automatically update (stored as `autoRedefine`), Format ▾ › Font… / Paragraph… (the Paragraph dialog) / Border… (Borders and
  Shading) / Numbering… (one of the document's lists). OK sends only what changed (`UpdateStyle` / `AddStyle`).
- **Create a Style** (gallery ▾): a name and a preview of the selection's formatting → `AddStyle` + `UpdateStyleFromSelection`
  in one undo step; Modify… opens the full dialog.
- **Apply Styles** box (Mod+Shift+S): style name with autocomplete; Reapply / New Style, Modify…, Styles pane.
- **Rendering**: the style sheet becomes one `<style>` element (`features/styleCss.ts`: resolved paragraph styles on
  `p[data-style]`, `h1…h6`, `.doc-title` and unstyled paragraphs; character styles on `span[data-cstyle]` from the
  `charStyle` mark); a modified style restyles every paragraph at once. Direct formatting stays inline and wins.
- **Navigation pane** (View › Show › Navigation Pane, left of the page): Heading 1–3 paragraphs (and styles based on them),
  click to go.
- **Find and Replace › More ▾**: Use wildcards (`?`, `*`, `[a-z]`, `[!…]`, `{n}`, `{n,}`, `{n,m}`, `@`, `<`, `>`; always
  case-sensitive), Find All (count), Format ▾ for the Find and the Replace field (Font… with every field "not set" by
  default, Paragraph…, Style…, Highlight → Not Highlight → none), No Formatting; the formats show under the fields. With
  formatting or wildcards the matches come from Rust (`find` request → block id + char offsets, mapped to the editor), so
  the highlighted matches are exactly what Replace all (`FindReplace` with `format` / `replaceFormat`, one undo step)
  changes; an empty Find with a format finds formatted stretches, an empty Replace with a replace format only reformats.

### Write comments (P8-25)
- **Review tab**: New Comment (Ctrl+Alt+M; also in the right-click menu) — on the selection, or on the word at the caret
  when nothing is selected (Word); Delete ▾ (Delete the selected comment / Delete All Comments in Document / Delete All
  Resolved Comments); Previous / Next (select the commented text, wrapping around); Resolve / Reopen for the selected
  thread; Show Comments (balloons vs. margin indicators); Comments Pane (the list at any width).
- **New Comment** opens a draft card (the range highlighted) with the user's avatar; Post (Ctrl+Enter) sends `AddComment`
  with the UI's clock (ISO date), Esc / Cancel drops it. The first comment asks for the **user name** (name + initials,
  initials derived from the name); File › Options… sets it too. It is remembered in this browser / app only
  (`localStorage` `rusuite.write.user`, ADR 0009) and sent to the core with `setUser` after start (not an edit, not dirty).
- **Balloons** (window ≥ 1200 px): a 264 px margin right of the page (the page stays centered under the ruler), one card per thread next to its text (Word's layout:
  anchor order, pushed down to avoid overlaps; the selected balloon stays at its anchor and the ones above move up), a
  dashed connector from the selected / hovered comment's text to its balloon. A card: author initials avatar (colour per
  author), author, relative date ("Just now", "5 min ago", "3 h ago", then the date; full date as tooltip), text, replies;
  when selected: Edit (own comments only: author = the user), Delete thread / Delete reply, an inline reply box (Ctrl+Enter
  posts). Resolve ✓ / Reopen in the header; resolved threads are dimmed and labelled.
- **Highlight**: the commented text in the author's light colour (CSS `color-mix` of the palette colour), the selected or
  hovered thread darker; clicking into commented text selects its (innermost) thread.
- **Show Comments off**: no balloons, a narrow margin with one comment icon per thread (author colour); clicking one shows
  the comments again with that thread selected. Only the selected thread stays highlighted.
- **Comments pane** (windows < 1200 px, or Review › Comments Pane): all threads in document order, filter All / Open /
  Resolved, the draft on top, the same cards.
- **Status bar**: "N comments" when there are any.
- **Print**: File › Print › Print markup — `[AB1]` marks after each commented range and the threads (with replies, author,
  date, resolved) as a list after the text.
- **Editing**: the range markers are invisible atoms; arrow keys step over them; an edit deleting one marker of a range
  keeps it at the edit (the range shrinks; ends before typed text, starts after it — as the core does); deleting the whole
  range deletes the comment; pasted text never carries comments.

### Write links, references, columns, properties (P8-27)
- **Hyperlinks**: a link is an attribute of its text runs (`Run.link`: web page, a place in this document = a bookmark,
  e-mail with subject; ScreenTip) → the ProseMirror `link` mark (not inclusive: typing at a link's end does not extend it,
  typing inside does; `InsertText { link }`). Insert › Link (Ctrl+K): Text to display (fixed for a selection over
  paragraphs), Link to Web page or file / Place in this document (Top of the document, the headings, the bookmarks — a
  heading gets a hidden `_Ref` bookmark) / E-mail address (address, subject), ScreenTip; on a link the dialog edits it and
  offers Remove Link → `SetHyperlink` (`Hyperlink` character style) / `RemoveHyperlink`. Links render as anchors with
  Word's tooltip ("Ctrl+Click to follow link"); Ctrl+click follows (internal: the caret goes to the bookmark; external: a
  new tab through an anchor element, no `window.open`); right-click: Edit Link…, Open Link, Remove Link.
- **Bookmarks**: zero-width markers like the comment markers (`BookmarkStart`/`BookmarkEnd`, invisible atoms; a lone
  marker survives a partial deletion, deleting the whole range removes the bookmark). Insert › Bookmark: name (Word's
  rules), the list sorted by name or location, Hidden bookmarks, Add (an existing name moves) / Delete / Go To.
  Go To (Ctrl+G, F5): Page (print layout), Bookmark, Heading.
- **Fields**: `REF`, `PAGEREF`, `NOTEREF`, `SEQ`, `TITLE`, `AUTHOR` join the field model. PAGEREF shows the live page of
  its bookmark like PAGE (saved with the current value); REF / NOTEREF / SEQ keep their result until Update Fields (F9 on
  the selection, Ctrl+A F9 all; References › Update Fields; right-click Update Field) → `UpdateFields { refresh: { pages,
  blocks } }`: the core computes SEQ per label in document order, REF (bookmark text, or the list number with `\n`),
  PAGEREF (from the UI's page per paragraph), NOTEREF, TITLE/AUTHOR (the properties); a missing bookmark gives Word's
  "Error! Reference source not found.".
- **Captions**: References › Insert Caption: the caption box shows "Figure 1" (the number it will get) and the text after it,
  Label (Figure / Table / Equation, New Label…), Position (above / below the selected item: the caret's table, else its
  paragraph) → `InsertCaption` (a `Caption` paragraph "Label N" + text with a `SEQ` field; every sequence is renumbered).
  Insert Table of Figures ▾ (Figure, Table, Equation) → `InsertToc { caption }` (a TOC block over the captions, `TOC \h \z
  \c "Figure"`). Cross-reference (Insert and References): Reference type (Numbered item, Heading, Bookmark, Footnote,
  Endnote, the caption labels), Insert reference to (text / paragraph number / page; notes: number, formatted number, page;
  captions: entire caption, only label and number, page), Insert as hyperlink, For which → `InsertCrossReference` (hidden
  `_Ref` bookmarks created and reused by the core); the dialog stays open (Word).
- **Columns**: `Section.columns` (count, spacing, equal width or per-column widths, line between) ↔ `w:cols`. Layout ›
  Columns ▾ One / Two / Three / Left / Right (a narrow column of about a third and a wide one) acts on the caret's section;
  More Columns…: presets, number, width and spacing per column (equal width: all follow), line between, Apply to this
  section / this point forward (a continuous section break at the caret, the part after gets the columns) / whole
  document, preview. Breaks ▾ › Column inserts `Break(column)`. The editor wraps a multi-column section's blocks in a
  `columns` box (a display node built from the sections like the list containers, flattened by `fromPM`, re-wrapped after
  section changes) rendered with CSS columns (balanced; a column break ends its column, an empty section-end paragraph
  spans the columns); print layout flows the box over pages (P8-31); a column break outside multi-column sections
  ends the page. The ruler shows the section's columns (white) and the gaps.
- **Document properties**: File › Info (a generic Info page of the shared backstage): Title, Subject, Author, Tags,
  Categories, Comments (commit on blur / Enter → `SetProperties`, an empty field clears) and read-only Created, Last
  modified, Last modified by, Words, Pages. Saving stamps modified (UI clock), created when unset, last modified by (the
  user name), the page count and revision + 1 (`saveDocx { modified, user, pages }`, not an edit); `app.xml` names
  "Rusuite Write" with words and pages.
- **Symbols**: Insert › Symbol ▾: 20 symbols (recently used first, this browser only, then Word's common set), More
  Symbols…: Subset (Basic Latin, Latin-1, Greek, Currency, Arrows, Mathematical Operators, Box Drawing, Geometric Shapes,
  Dingbats and Emoji), Search by name, the character's name, Character code (hex, both ways), Recently used symbols,
  Insert (double-click inserts too; the dialog stays open); Special Characters tab: em/en dash, nonbreaking hyphen (U+2011
  ↔ `w:noBreakHyphen`), optional hyphen (U+00AD ↔ `w:softHyphen`), em/en/¼ em space, nonbreaking space, ©, ®, ™, §, ¶,
  …, single/double quotes, with Word's shortcuts listed. Insert › Date & Time: Word's formats in the UI language,
  Update automatically → a `DATE` / `TIME` field with the picture, else the text.
- **Paragraph flow**: the Paragraph dialog's Line and Page Breaks tab: Widow/Orphan control, Keep with next, Keep lines
  together, Page break before, Suppress line numbers (stored), Don't hyphenate (effective values, changes sent as direct
  formatting). Print layout honours all four (P8-31). Layout › Hyphenation ▾ None / Automatic → `SetSettings { autoHyphenation }`
  (`w:autoHyphenation`): CSS `hyphens: auto` with the UI language as `lang`; "Don't hyphenate" paragraphs (style or direct)
  stay `hyphens: manual`.
- **Font box**: Home › Font shows the font and size in effect at the caret — direct formatting, the character style, the
  paragraph style chain, the defaults; theme fonts by name (+Headings Calibri Light, +Body Calibri) — updating on caret moves
  and style changes; the Style Inspector shows the same ("In effect: Calibri Light, 16 pt").

### Write print layout: true pagination (P8-31)
The algorithm is in `docs/write-layout.md`.
- **Pages break between lines**: a paragraph continues on the next page; widow/orphan control (two lines, Word's
  default on), keep lines together, keep with next (the last lines of the paragraph go along), page break before, page
  breaks, section breaks (next page / even / odd with a blank page) per Word. Headers and footers are measured: a tall
  header pushes the body down.
- **Tables** break between rows; rows marked Header row (`w:tblHeader`) are repeated at the top of every page the table
  continues on (drawn copies), never left alone at a page bottom; a row taller than a page continues its cells on the next
  page at line boundaries unless "Allow row to break across pages" is off.
- **Columns**: a multi-column section fills column 1, then column 2… and continues on the next page; its last page is
  balanced; column breaks start the next column; the line between columns is drawn per page.
- **Footnotes** are at the bottom of the page of their reference (separator line), editable there (the notes area keeps
  only the endnotes in print layout; draft view keeps the notes area); a footnote too long for its page continues on the
  next one (full-width continuation separator; since P9-W2 the continuation is the editable note itself).
- **Page gaps**: a grey band between sheets; hovering it shows "Page N"; double-click hides / shows the white space
  between pages (Word's Hide White Space: the margins, headers and footers disappear, a thin line separates the pages).
  A click in the margins of a gap puts the caret on the nearest line (the last line above, the first line below). The
  caret moves across gaps with the arrow keys; PageDown / PageUp move it by one page (same place on the next / previous
  page; with Shift the selection grows); selections and drag-selection run across pages.
- **Status bar**: "Page X of Y" (the caret's page) in print layout. Page and NUMPAGES fields, PAGEREF, the TOC page
  numbers, Go To › Page and the saved page count come from the same layout.
- **One layout for every surface**: File › Print's preview and Export PDF print the editor's pages as they are (the same
  lines on the same pages) with the document's page setup at 100 %; other paper, margins, scale or Print markup lay the
  document out again at the printed width with the same rules.
- Zoom and window resizes lay the pages out again (60 ms); long documents re-measure only changed blocks, resume the
  pagination at the page before the first change and draw only the pages near the viewport (docs/perf.md).

### Write shapes, text boxes, picture formatting, character formatting (P8-34)
- **Insert › Shapes** (`ui/drawingTabs.tsx`): Word's groups (Lines, Rectangles, Basic Shapes with the text box, Block
  Arrows, Flowchart, Stars, Callouts); icons are the presets' outlines from the core (`shapePaths`, the same ECMA-376
  preset geometry as Show). A choice inserts the shape at the caret at Word's default size (2.5 cm; arrows 3.5 × 1.8 cm)
  with Word's look (accent 1 fill, darker 1 pt outline, white centred text) and selects it. **Insert › Text Box ▾**:
  Simple Text Box (inline, white, black 0.75 pt outline, 5 × 2.5 cm) and Text Box with Text Wrapping (floating, square).
- **Drawings in the text** (`features/drawings/`): an inline atom; the outline is SVG (rectangle until the core's path
  arrives), the text a nested editor (the Write schema; Enter, Backspace, Ctrl+B/I/U, Tab, Ctrl+Z/Y; Escape selects the
  shape). Double-click a shape to edit its text; a click in a text box's text puts the caret there. Selected: eight
  resize handles (corners free, Shift keeps the proportions), a rotation handle above (Shift snaps to 15°), the preset's
  yellow adjust handles (touch-sized hit areas that grow outwards only); a floating drawing moves by dragging. Inline drawings take part in the measurement like
  pictures (one box per drawing; the text inside is not part of the page's lines); floating ones are placed like
  floating pictures (square/tight float, top and bottom, behind / in front; page and margin positions follow the print
  layout) and the page cover never hides what hangs below the last line. Prints and exports to PDF as shown.
- **Shape Format tab** (Drawing Tools; also while the text of a shape is edited): Insert Shapes (Shapes ▾, Text Box ▾,
  Change Shape ▾), Shape Styles (18 presets: colored fill / light fill / colored outline × accents 1–6), Shape Fill,
  Shape Outline colour, Outline weight and dashes ▾ (No Outline, 0.25–6 pt, seven dash styles), Text: Align Text ▾
  (top / middle / bottom), Resize shape to fit text; Alt text; Arrange: Position ▾, Wrap Text ▾ (as for pictures),
  Align ▾ (left / center / right / top / middle / bottom on the margin; an inline shape starts floating), Rotate ▾ (right / left 90°, flip vertical / horizontal); Size (height, width in cm). Each change is one
  `SetDrawingProps` (the text blocks stay in Rust); typing in the text sends the ordinary text commands for the paragraphs
  inside (`InsertText`, `SplitParagraph`, …, addressed by their ids), anything else one `SetDrawingText`.
- **Picture Format** (P8-34 additions): Adjust: Corrections ▾ (brightness × contrast −40…+40 %, 25 previews), Color ▾
  (No Recolor, Grayscale, Sepia, Washout, Black and White), Reset Picture (all formatting off); Picture Styles ▾ (10:
  simple frame white / black, thick matte black, drop shadow rectangle, rounded rectangle (+ shadow), oval, oval frame,
  metal frame, snip corner), Picture Border colour and weight/dashes ▾; Size › Crop: crop mode with Word's black handles
  on the sides and corners (the whole image shown dimmed, the crop window outlined; Enter, Escape or a click elsewhere ends it;
  the picture keeps its scale, the box follows the visible part). Rendering: crop as a window over the image, border as
  an outline, shadow, rounded / oval outline shapes, corrections and recolouring as CSS filters. Insert › Link with a
  picture selected links the picture (`SetImageLink`); Remove Link removes it.
- **Character formatting**: Home › Font gains Change Case ▾ (Sentence case., lowercase, UPPERCASE, Capitalize Each Word,
  tOGGLE cASE — `ChangeCase` per paragraph, the formatting kept; a caret changes its word), Text Effects ▾ (Outline,
  Shadow, Emboss, Engrave, No Effects) and Font… (**Ctrl+D**): the Font tab (font, style, size, colour, underline and the
  effects Strikethrough, Double strikethrough, Superscript, Subscript, Small caps, All caps, Hidden, Outline, Shadow,
  Emboss, Engrave — exclusive pairs as in Word) and the Advanced tab (Scale %, Spacing pt (+ expanded / − condensed),
  Position pt (+ raised / − lowered), Kerning for fonts of N pt and above). Inside a text box the Font group and the
  dialog format the text box's text. Small caps, all caps, spacing and position are exact; outline, shadow, emboss and
  engrave are approximations; scale widens the letter spacing. Hidden text is not shown (and not printed);
  **View › Hidden text** shows it with a dotted underline. Subtle / Intense Reference and Book Title have Word's small
  caps and spacing; the style gallery, the Styles pane and the style CSS show the effects.
- **Lists and styles**: Home › Multilevel list sends one `ApplyNumbering` (the core allocates the list); Create a Style
  makes a linked pair ("Name" + "Name Char"). Table Layout › Insert left / right and Delete column respect merged cells
  (a cell spanning the column grows / shrinks). References › Footnotes › Endnotes ▾ (end of the document / of each
  section) and Layout › Hyphenation ▾ › Hyphenation zone (0.63 / 0.75 / 1.27 cm) are document settings.

### Write quality pass (P8-38)
Corrections from the exploratory test (docs/qa/write-2026-10.md):
- **Undo** steps follow Word: characters typed in a row at one place (and Backspaces / Deletes in a row) are one step;
  Enter, a caret move or any other command starts the next (`write-core` groups the host's entries per step).
- **Paste** of plain text: one paragraph per line, empty lines kept, the destination paragraph's formatting; inside a list
  each line is a list item. Home › Paste inserts the clipboard text the same way (never as HTML).
- **Insert › Table**: a "Table Grid" table (no direct borders; compact cell paragraphs), the caret in its first cell.
- **Pictures** stay selected after a move, resize or crop. **Breaks** › section breaks put the caret into the new section.
- **Paragraph dialog** and Layout › Paragraph show the values in effect (style chain + direct); OK sends only what changed.
  The Font dialog shows the font and size in effect.
- **Table of contents** / table of figures: inserted with their page numbers (an Update Table after the layout).
- **Multilevel list** with the caret in a list (no selection) applies to the whole list.
- **Highlight** is a split button: the button applies the last colour (yellow at first), ▾ chooses one.
- **Ctrl+Enter** inserts a page break (Shift+Enter a line break).
- **Print layout** keeps the page width on narrow windows and next to the panes (the view scrolls sideways); draft view
  wraps to the window. Picture Format › Size holds Crop, Height, Width.

### Write pre-release fixes (P8-46)
The deferred items of docs/qa/write-2026-10.md:
- **Lists (W-03)**: Bullets, Numbering and Multilevel list give Normal paragraphs Word's **List Paragraph** style (added to
  documents that lack it); its `w:contextualSpacing` ("Don't add space between paragraphs of the same style",
  `ParagraphProperties.contextualSpacing`, read and written by fmt-docx) removes the space between the items. In the
  editor a node decoration drops the margins between paragraphs of one style with the option, so the pagination (which
  measures the DOM) and the print clones lose the same space. A list item is placed by its list level, not by the style's
  indent. Turning bullets off keeps List Paragraph (and its 1.27 cm indent), as in Word.
- **Backspace at a list item's start (W-28)**: the first press removes the number or bullet and keeps the text at the
  level's indent (`ListBackspace`: a direct left indent, no first-line outdent; the saved file has Word's values); the
  paragraph is then an ordinary one (P9-W1: the next Backspace outdents it, the third joins it). The approximate CSS
  list rendering of this round was replaced by the level indents in P9-W1.
- **Captions (W-22)**: the Caption box of Insert Caption starts empty after "Figure 1"; the separator is typed by the user
  (Word), a caption without text is exactly "Figure 1".
- **Shortcuts (W-30)**: Ctrl+] / Ctrl+[ (font size ±1 pt, each run from its own size), Ctrl+Shift+> / < (Word's size
  list), Ctrl+Shift+K / A / D (small caps, all caps, double underline), Shift+F3 (lowercase → Capitalize Each Word →
  UPPERCASE), Ctrl+T / Ctrl+Shift+T (hanging indent), Ctrl+Q (remove paragraph formatting), Ctrl+Shift+N (Normal style);
  docs/shortcuts.md and the in-app help (Ctrl+/) list them.
- **Reader warnings in the UI language (W-26)**: fmt-docx reports every warning as a stable code (`docx.numbering.levelStyleLink`)
  with named parameters and the English text; the shared catalog has `reader.<code>` in English and German
  (`readerWarningText` in `@rusuite/ui-shared`), the status bar and its tooltip show them translated; an unknown code
  shows the English text. Calc and Show (fmt-xlsx / fmt-pptx) still send English strings, which the helper passes through.
- **Mixed page sizes (W-18)**: in print layout every sheet has its own section's width and height and is centred in a
  frame as wide as the widest page (the view scrolls sideways to it); the blocks of a section with another text width
  are moved and widened into its text column (node decorations), so a landscape section's lines are as long as on paper.
  File › Print and Export PDF still used the first section's paper size for every page (each page has its own since P9-W2).

### Write lists, numbering and Word shortcuts (P9-W1)
- **List placement like Word**: a list paragraph sits at its numbering level's real indent (`w:ind` left / hanging of
  the level, overlaid by the paragraph's own direct indent) instead of a fixed CSS step per nesting level; the label hangs
  at the first-line position, the tab after it (the level's `w:suff`: tab / space / nothing) reaches the text, and the
  label is aligned left, centred or right at that position (`w:lvlJc`, `Level.alignment`). Node decorations
  (`features/listIndent.ts`: `--li-left`, `--li-hang`; the list nodes lose the browser padding) give the editor, the
  measured pagination and the print clones the same geometry. Paragraphs numbered through their style (heading
  numbering) are placed the same way. New lists keep Word's List Paragraph style with contextual spacing (P8-46).
- **Backspace at a list item's start** in Word's three steps: the number goes (indent kept, `ListBackspace`), the
  second press moves the paragraph to the margin (left and first-line indent 0; 0 written explicitly where the style
  indents, e.g. List Paragraph), the third joins it. Tab / Shift+Tab change the level.
- **Galleries** (Home › Paragraph, next to the list buttons): **Bullet library ▾** (•, ○, ■, ➢, ✓, ◆, –, None,
  Define New Bullet…), **Numbering library ▾** (1. 1) I. A. a) a. i., None, Define New Number Format…, Set Numbering
  Value…) and **Multilevel list ▾** with Word's seven list-library presets: 1) a) i); 1. 1.1. 1.1.1.; ➢ ■ •; and the
  four linked to Heading 1–9: Article I. / Section 1.01 / (a); 1 / 1.1 / 1.1.1; I. / A. / 1.; Chapter 1. Each choice is
  one `ApplyNumbering` with a preset id (`ListPreset`, the levels are defined once in model-text) or an explicit level
  `format`; a single-level choice replaces the caret's level of the current list (keeping its indent), a multilevel
  one makes a new list; with the caret in a list (no selection) the whole list changes (W-27). None removes the
  numbering (`ApplyList` none).
- **Define New Number Format…**: number style (1, I, i, A, a, 1st, 01, none), the format text with `%1` for the number
  ("Part %1:"; OK needs the `%1` unless the style is none), font, alignment, a preview. **Define New Bullet…**: a symbol
  from a small table and a font (picture bullets are not offered). Both send `ApplyNumbering { format }`; `%1` becomes
  the level's own token.
- **Set Numbering Value…** (Numbering ▾ and the list item's context menu): Start new list + Set value to → `RestartList
  { start }` (saved as `w:lvlOverride/w:startOverride`); Continue from previous list → `ContinueList`.
- **Heading numbering**: the linked presets number the heading styles (`Level.style` ↔ `w:lvl/w:pStyle`; the style's
  `numbering` points to its level) — every Heading N paragraph shows its number, a paragraph on a linked level gets the
  style, a heading keeps its own. Table of contents entries start with the heading's number ("1.1 Scope", the core's
  `build_toc`; bullets are left out), and the Navigation pane lists numbered headings with their numbers.
- **Outline levels**: `ParagraphProperties.outlineLevel` (`w:outlineLvl`, 0–8, 9 = Body Text; the built-in Heading
  styles carry Word's values) is read and written by fmt-docx; a paragraph with an outline level is in the Navigation
  pane and the TOC, Body Text takes a heading out. Paragraph dialog › Outline level sets it.
- **Word shortcuts (W-30, rest)**: Ctrl+Shift+W (word underline: the words underlined, not the spaces; the model has no
  `words` underline kind, so the file holds underlined words), Shift+F3 with Sentence case for a selection that ends a
  sentence and the word before the caret right after a period, Ctrl+Alt+1..3 bound in the editor's own keymap to the same
  Heading style toggle as the shortcut map (one `SetStyle`, the paragraph keeps its id). The others (Ctrl+Shift+> / <,
  Ctrl+] / [, Ctrl+Shift+K / A / D, Ctrl+T / Ctrl+Shift+T, Ctrl+M / Ctrl+Shift+M, Ctrl+Q, Ctrl+Space, Ctrl+Shift+N,
  Ctrl+E / L / R / J, Ctrl+1 / 2 / 5, Ctrl+0) were bound in P8-46 / earlier and are covered by tests now.

### Write pagination round 3 (P9-W2)
The algorithm is in `docs/write-layout.md`; the numbers in docs/perf.md.
- **Sections with their own paper**: every section lays out at its own text width (size, margins, orientation,
  columns) in print layout and in File › Print / Export PDF: each printed page has its own section's sheet size
  (portrait and landscape pages in one PDF) and text column. A continuous section break starts the next section below
  the break on the same page (its columns too); to other paper (size or orientation) it starts a new page, like Word.
  Changing a section (Layout › Orientation, Margins, Columns …) re-measures only the blocks whose width changed and lays
  the pages out again from that section on.
- **Footnotes** are at the bottom of the page of their reference in the editor and in print / PDF (never at the end,
  never twice); a note too long for its page continues on the next page below the full-width continuation separator.
  The continuation is the note itself (one editable note shown in two page footers): click into it and type, the text
  goes to the single note.
- **Endnotes at the end of each section**: References › Footnotes › Endnotes ▾ (end of document / of each section) or
  the new **Footnote and Endnote…** dialog (Location: Footnotes – Bottom of page, Endnotes – End of document / End of
  section; Format: Number format 1, 2, 3 / a, b, c / A, B, C / i, ii, iii / I, II, III, Start at, Numbering Continuous /
  Restart each section / Restart each page (footnotes); Apply changes to: Whole document / This section; Insert applies
  and inserts a note of the chosen kind, Apply only applies). With End of section the endnotes of a section stand after
  its last paragraph (separator line above them), before the next section; they are editable there.
- **Note numbers per section**: the format, start and restart of the dialog (`Section.footnoteNumbering` /
  `endnoteNumbering`, `SetSection { footnoteNumbering | endnoteNumbering }`) number the references and notes in the
  editor and in print; "Restart each page" follows the pages of print layout (draft view numbers on).
- **Tables across pages**: a row that does not fit the rest of a page breaks there ("Allow row to break across pages"
  on, Word's default): each cell continues at its own line on the next page and the cell borders stay open at the cut
  (no horizontal border at the bottom of the part or the top of the continuation); rows of nested tables split the same
  way inside their parent row; a nested row with "Allow row to break" off moves whole, a nested header row stays with
  the next row (Word does not repeat header rows of nested tables). A row that can not break and is taller than a page
  is clipped at the page bottom (its start on the page, as Word); the following content starts on the next page.
- **Speed**: after a keystroke only the edited block is measured and built again; the pages before it are kept and the
  pages after it are taken over as soon as the breaks meet the previous ones again (a keystroke on page 100 of 200 lays
  out in a few milliseconds).

### Write styles round 2, templates and properties (P9-W3)
- **Toggle properties like Word**: bold, italic, caps, small caps, strikethrough, double strikethrough, outline, shadow,
  emboss, engrave and hidden *switch* where a character style turns them on over a paragraph style that has them
  (Strong in a bold heading is not bold; `model_text::apply_character_style`, mirrored in the editor's CSS). Ctrl+B /
  Ctrl+I / Ctrl+U and Home › Bold / Italic / Underline / Strikethrough work relative to the style: in a bold heading
  Bold is pressed, and pressing it writes `w:b w:val="0"`; pressing it again removes the direct value. Small caps /
  all caps (Ctrl+Shift+K / A) and the double underline (Ctrl+Shift+D) follow the same rule.
- **Words-only underline**: `Underline::Words` (`w:u w:val="words"`); Ctrl+Shift+W sets it, the Font dialog lists it
  with Word's other underline styles (single, double, dotted, dashed, wave). The editor underlines each word, not the
  spaces between them.
- **Font › Advanced** as in Word: Scale, Spacing Normal / Expanded / Condensed *by* n pt, Position Normal / Raised /
  Lowered *by* n pt, Kerning for fonts of n points and above.
- **Manage Styles** (Styles pane › Manage Styles…): *Edit* – the styles sorted Alphabetical / As Recommended / Font /
  Based on / By type, shown Recommended / In use / All (All includes hidden styles, marked "(Hide)"); Modify…, Delete
  (user styles), New Style…; double-click modifies. *Recommend* – Show, Hide until used, Hide (`w:hidden`,
  `w:semiHidden`) and Assign Value (`w:uiPriority`). *Set Defaults* – font, size, space before / after and line
  spacing of the document defaults (`SetStyleDefaults` → `w:docDefaults`; what Normal and every style without its own
  value use).
- **Design tab** (between Insert and Layout): *Style Sets* gallery with the built-in sets Word, Basic, Black & White,
  Casual, Centered, Elegant, Lines, Minimalist, Modern and Shaded (`StyleSet::builtin`; previews of Title, Heading 1 and
  body text; the set the document matches is marked) and the user's own sets; ▾ › Reset to the Default Style Set, Save
  as a New Style Set… (the current defaults + Normal, Title, Subtitle, Heading 1–3, kept on this device, ADR 0009).
  Applying a set is one undo step (`ApplyStyleSet`): the document keeps it as ordinary style definitions (and
  `w:latentStyles` travel along). *Paragraph Spacing* ▾: No Paragraph Space, Compact, Tight, Open, Relaxed, Double (the
  defaults' spacing). *Set as Default*: new blank documents on this device start with the current set (`newDocument
  { styleSet }`).
- **Modify Style › Format › Numbering…**: the list (with its labels) and the *list level* the style's paragraphs get
  (Word's heading numbering: Heading N on level N).
- **Reveal Formatting** pane (Shift+F1, or Styles pane › Reveal Formatting): Font (font, size, bold / italic /
  underline, colour, highlight, effects, spacing, scale, position, kerning), Paragraph (style, alignment, indentation,
  spacing, outline level, keep with next, numbering level) and Section (margins, paper, orientation) of the selection
  start; "Distinguish style source" names where each value comes from (direct formatting, a style, the document
  defaults).
- **Home › Font boxes** show the resolved font and size (direct → character style → paragraph style chain → defaults,
  theme fonts by name) – unchanged since P8-27, now with the toggle rules.
- **File › New** shows Word's template gallery: Blank document, Report, Letter, Memo, Minutes (shipped as `.dotx` in
  `apps/write/public/templates/`, English and German, written by write-core's `templates` module). A template opens as
  a new untitled, unmodified document with its styles, numbering, page setup, headers / footers and placeholder
  content (`newFromTemplate`); Ctrl+N still makes a blank document at once.
- **Templates**: File › Open accepts `.dotx` (it opens the template itself, like Word; saving keeps the template
  content type). Save As (F12) on the web has Word's *Save as type*: Word Document (*.docx) / Word Template (*.dotx);
  on the desktop the native dialog offers both extensions and a `.dotx` name writes a template.
- **File › Info**: Title, Subject, Author, Tags (keywords), Categories, Company (`docProps/app.xml`), Comments; Created,
  Last Modified, Last Modified By; statistics: words, pages, characters with and without spaces, paragraphs (the
  core's `statistics`, also written to `app.xml`); the file type (document / template).
- **Fields from the properties**: Insert › Field has Subject, Keywords, Comments, Company (`DOCPROPERTY Company`),
  Last saved by and Save date besides Author and Title; F9 / the save update them, the save stamps Last saved by and
  Save date first.
- **Comments** without a user name are written by the document's author (File › Info › Author) instead of asking for
  a name; with neither, the User Name dialog asks as before.

### Write drawings, pictures and floating objects round 2 (P9-W4)
- **Drawing shapes** (`features/drawings/drawTool.ts`): Insert › Shapes and Text Box › Draw Text Box arm the drawing tool
  (crosshair, `data-draw-tool` on the editor): a click on the page inserts the shape at Word's default size, a drag at the
  drawn size, Shift keeps it square (lines at 45° steps); Enter inserts it at the caret (keyboard), Esc cancels. Drawn
  shapes float In Front of Text (text boxes: Square), anchored to the paragraph at the drawn top edge; drawn on a drawing
  canvas, the shape becomes one of its members. Insert › Shapes › New Drawing Canvas inserts an inline canvas (15 × 6 cm).
- **Handles** rotate with the shape (a frame with the eight resize handles and the rotation handle); a drag keeps the
  opposite handle in place and the resize cursors point along the rotated frame. The yellow adjust handles are the
  presets' `a:ahXY` / `a:ahPolar` handles from the core (`shapePaths` `handles`, the same `core_model::geometry` Show
  uses; P9-X1); they turn and flip with the shape and a drag is inverted through its rotation and flips. With one shape
  selected, Tab / Shift+Tab focus its adjust handles in turn (a blue ring; after the last one the shape again), the
  arrow keys move the focused handle in screen directions (1 px, Shift: 10 px) and Esc leaves it – as in Show. The
  handle math (positions, drag inversion, nudging, resize/rotation handles, cursors, hit testing) is shared with Show:
  `packages/ui-shared/src/geometry/handles.ts`. Moving snaps the object's edges and centre to the column's edges and centre and the
  paragraph's top (5 px); Alt moves freely. Arrow keys nudge the selected floating objects by Word's grid (0.13 in),
  Ctrl+arrows by one pixel.
- **Several objects**: Shift/Ctrl+click adds floating pictures and shapes to the selection (drawn with an outline);
  Arrange › Group ▾ (Shape Format, Picture Format, Layout) groups them (`wpg:wgp`; pictures become picture members),
  Ungroup puts the members back as floating objects at their places, Regroup groups the last ungrouped objects again.
  A click on a member of the selected group selects the member (Shape Format edits it; fill/outline/text colour of the
  whole group go to all its shapes); dragging a selected member moves it inside the group (the group's frame follows).
  Resizing a group scales its members; grouped text boxes keep their editable text.
- **Linked text boxes**: Shape Format › Text › Create Link, then a click on an empty text box links it (Word's rules:
  the target must be empty and unlinked, the source must not link onward; messages otherwise); the story flows into the
  next box (`textChain.ts`); Break Link ends the chain after the selected box.
- **Pictures**: crop mode shows the cut-off parts dimmed (a mask around the crop window); Crop ▾ (split button) offers
  Crop to Shape (any preset, a clip path from the core's outline), Aspect Ratio (1:1 … 16:10), Fill and Fit; Picture
  Effects ▾ adds Shadow, Soft Edges (1–50 pt, a feathered CSS mask) and Bevel (Word's twelve presets, an inset light and
  shade). Wrap Text has Through; Square/Tight/Through pictures with room on both sides get text on both sides
  (`wrapBoth.ts`, docs/write-layout.md).
- **Links and alt text**: Insert › Link (Ctrl+K) on a selected shape links the shape; Ctrl+click on a linked picture or
  shape follows the link (its ScreenTip is the tooltip); the context menu of a linked picture or shape has Edit / Open /
  Remove Link (Remove keeps the object). HYPERLINK fields read from files are shown like links and stay fields when edited.
  Alt Text has Mark as decorative.
- **Arrange**: Align ▾ with Align to Page / Margin / Selected Objects (one object: aligned semantically, relative to the
  page or margin; several: moved), Distribute Horizontally / Vertically; Bring Forward ▾ / Send Backward ▾ (z-order,
  Bring in Front of Text, Send Behind Text); the **Selection Pane** (Alt+F10, `ui/arrangeControls.tsx`): every picture
  and shape top-most first with Word's default names, click (Ctrl: add) selects, double-click renames, the eye hides /
  shows (not shown, not printed), Show All / Hide All, ▲ ▼ reorder. Position ▾ › More Layout Options… opens Word's
  Position tab: alignment, absolute position or relative position (%) per axis with every reference (margin, page,
  column, character, the margin areas; paragraph, line), Move object with text, Lock anchor, Allow overlap, Layout in
  table cell. Layout › Arrange holds the order, pane, align and group commands too.
- **Drawing canvas**: shapes drawn on it become members (moved inside it, selected like group members), the canvas
  resizes without scaling them, Shape Format › Size › Fit shrinks it to its members.

### Write tables round 2, ruler and special characters (P9-W5)
- **Table structure** (Rust commands, `features/tables2.ts`): Insert / Delete column and row are grid-aware (a merged cell
  spanning the inserted column grows, deleting a column inside a span shrinks it, ragged rows are padded, a new row copies
  the row's merges and continues vertical merges). Table Layout › Merge › **Split Table** (Ctrl+Shift+Enter) splits above
  the caret's row (`SplitTable`; in the first row an empty paragraph goes above the table); Delete / Backspace in the
  empty paragraph between two tables joins them (`MergeTables`). Insert › Table ▾ › **Convert Text to Table…** (number of
  columns, rows shown, separate at paragraphs / commas / tabs / another character – Word's guess preselected) and Table
  Layout › Data › **Convert to Text** (`ConvertTextToTable`, `ConvertTableToText`). Cell Size › **AutoFit ▾**: AutoFit
  Contents (column widths measured from the cells' text), AutoFit Window (100 % of the text width), Fixed Column Width
  (`AutoFitTable`: `tblLayout`, `tblW`). Distribute Rows / Columns as before.
- **Table Properties** (`ui/tables2Dialogs.tsx`) has Word's tabs: *Table* (preferred width in cm or percent, alignment,
  indent from left, text wrapping None / Around with **Positioning…**: horizontal and vertical position or alignment
  relative to margin / page / column / paragraph, distance from the surrounding text, Allow overlap → `w:tblpPr`, and
  "Automatically resize to fit contents"), *Row* (height at least / exactly, allow row to break across pages, repeat as
  header row), *Column* (preferred width of the selected columns), *Cell* (vertical alignment). A floating table is drawn
  as a CSS float to the side of its position (centred: no wrapping).
- **Table Design**: table style text formatting (`tblStylePr` run properties: the header row's bold and white text, banded
  colours, sizes, fonts) now reaches the cell paragraphs that use the default paragraph style, as in Word
  (`data-ts-*` CSS variables on the cells; the core's `Document::resolve_run_props_in_cell`). Borders ▾ applies the
  current pen and ends with View Gridlines and **Borders and Shading…** (Setting None / Box / All / Grid / Custom, style,
  colour, width, a preview whose lines toggle on click, Apply to Cell / Table, Shading tab). New group **Border Painter**:
  Border Styles gallery (picking one turns the painter on), Line Style, Line Weight, Pen Color and the Border Painter
  toggle – while on, a click on a cell edge paints it and the facing edge of the neighbour cell (`SetCellProps`); Esc ends
  it. View › Show › **Gridlines** (also Table Layout › View Gridlines) shows or hides the dashed lines of borderless edges.
- **Ruler** (`ui/Ruler.tsx`, `features/rulerDrag.ts`): the first-line triangle, the hanging triangle, the left-indent box
  and the right-indent triangle are dragged like Word's (the paragraph follows live through a preview decoration; one
  `SetParagraphProps` on release; Alt: no snapping); in a table the column boundaries are markers that drag the column
  widths (the neighbour gives or takes the difference). The scale and the snapping are in cm (0.25 cm) or inches (1/8")
  by the locale or File › Options › Advanced.
- **Columns**: unequal columns (Left / Right presets, More Columns… without "Equal column width") are laid out with their
  own widths and spacing in the editor and in print (docs/write-layout.md "Unequal columns"); the line between is drawn at
  the real gap.
- **Symbols and special characters**: Insert › Symbol › More Symbols… has a Font list (the grid in that font; the symbol is
  inserted in it, typing continues in the previous font) and shows the selected character's shortcut key. Word's keys
  insert special characters (docs/shortcuts.md). **AutoCorrect** as you type (`features/autoCorrect.ts`): straight quotes
  → smart quotes (German „…“ in a German UI), " -- " → en dash and "word--word" → em dash when the next space is typed,
  (c) (r) (tm) → © ® ™ and "..." → … at once; ordinals (1st) superscript only when switched on (off by default). File ›
  Options › Proofing switches each rule; the options are kept in this browser. Equations are not part of this round.
- **File › Options** is Write's own dialog now: General (User Name…), Proofing (AutoCorrect), Advanced (ruler unit).

### Write comments, notes and fields round 2 (P9-W6)
- **Comment text** is formatted: the balloon editor (`comments/RichComposer.tsx`, a small Tiptap editor in the draft,
  reply and edit boxes) takes Ctrl+B / Ctrl+I / Ctrl+U (also the B I U buttons under it), links (typed URLs become links)
  and line breaks; the content goes to the core as paragraphs of runs (`AddComment`/`ReplyComment`/`EditComment` with
  `content`, `comments/richText.ts`) and the balloons and the pane show it formatted. Lists inside comments are not
  offered (a comment's paragraphs have no numbering of their own yet).
- **@mentions**: typing `@` in the balloon editor opens a list of the document's authors (the comment authors, the people
  of `people.xml`, the document author and the user), filtered by what follows (`@an`); ↑/↓, Enter or Tab or a click
  inserts the mention: an `@Name` run in Word's `Mention` style linking to `mailto:` the person's address (the name when
  the account has no e-mail). The author, initials and date of a comment come from File › Options › User Name, else the
  document author (as before). Saving writes `people.xml` (`w15:person` with `w15:presenceInfo`: the account read from
  the file, else `providerId="None"`).
- **Comments in notes and headers**: New Comment works on a selection inside a footnote or endnote (both ends in one
  note; the core also accepts header/footer paragraphs, which are edited in the header dialog). Pictures are commented
  like text (the selected picture is the range); table cells as before. Comments inside text boxes are not supported.
- **Review › Tracking › Display for Review**: *All Markup* (balloons, the default), *Simple Markup* (a marker per thread
  in the margin, no highlights; a click opens that balloon next to its marker, a second click closes it), *No Markup* and
  *Original* (no markers, no highlights; the Comments pane still opens). In print layout the balloons follow the page
  gaps: a balloon that would sit in the grey gap or cross a page bottom moves to the top of the next page and pushes the
  following ones down (docs/write-layout.md "Comment balloons"). Show Comments, Previous / Next and Delete ▾ (Delete All,
  Delete All Resolved) work as before. File › Print › **Print Markup** now prints Word's "Document showing markup": every
  page scaled to 72 % at the left, its comments as balloons at the right next to their text (with replies, formatted).
- **Notes**: typed text in a note is kept as one run per format (`ReplaceNote` merges runs; typing goes through
  `InsertText`); Enter and Backspace inside notes (and headers/footers) are the ordinary `SplitParagraph` /
  `JoinWithPrevious` commands now (one undo step each). References › Footnote and Endnote… › **Convert…** converts all
  footnotes to endnotes, all endnotes to footnotes or swaps them (`ConvertNotes`); the context menu of a note offers
  Convert to Endnote / Footnote for that note. **Separators…** (same dialog) edits the footnote and endnote separators and
  continuation separators: Word's line, none, or own text (`SetNoteSeparators`; drawn by the page chrome). Footnotes
  "below text" (`w:pos beneathText`) stay out of scope (P9-W2 limit).
- **Fields**: F9 updates the selection's fields, Ctrl+A F9 all of them – in one undo step together with the tables of
  contents in scope (rebuilt with the page numbers of the pagination; TOC switches `\o`, `\h`, `\z`, `\u`, `\n`,
  `\t "Style,level"` honoured). New fields: `SECTIONPAGES`, `STYLEREF "Heading 1"` (`\l` last on the page, `\n` its
  number; in a header the page chrome shows the heading of each page), `SEQ` with `\c` (repeat), `\h` (hide), `\s n`
  (restart after headings), `REF` with `\r`, `\w`, `\p` ("above"/"below"). **Alt+F9** shows the codes of all fields
  (`{ PAGE }`), **Shift+F9** of the selected ones (also in the context menu); **Ctrl+F11** / **Ctrl+Shift+F11** lock and
  unlock the selection's fields (`w:fldLock`; locked fields keep their result on F9 and before saving). Insert › Field ▾
  › **Field…** is Word's Field dialog: the field names, their switches and formats (date/time pictures, SEQ number formats,
  bookmarks, styles, document properties) and the resulting field code.

## Building blocks (`@rusuite/ui-shared`)

| Export | Use |
| --- | --- |
| `Ribbon` | `tabs: RibbonTab[]` (`{ id, label, groups: { label, items }[], toolbarLabel? }`); empty groups and tabs without groups are omitted. Active tab controlled (`activeTab`/`onTabChange`) or not (`defaultTab`); collapse likewise (`collapsed`/`defaultCollapsed`/`onCollapsedChange`). `backstage` adds the File tab; `accent` colors it. Contextual tabs (P8-28) carry `contextual: { group, color }` (`contextualTabs(tabs, group, color)`, `CONTEXT_COLORS` drawing / picture / table / chart / media / master): they follow the standard tabs, consecutive tabs of one group share a coloured header naming the context ("Table Tools", `ribbon.ctx.*` in the shared catalog) above their labels on a tinted background, the selected one is drawn in the group colour, and the panel's top border takes it. Calc's Chart Design / Format (Chart Tools) and Write's Table Design / Layout (Table Tools) and Picture Format (Picture Tools) use it as well. |
| `Backstage` | Full-pane File view: Home, New, Open…, Save, Save As…, Print, Export PDF…, Close; with cloud connections (`session.connectors`, P8-36) Open… and Save As… are pages – "This device" (the app's own command) plus the Connections, see "Cloud connections"; the Home page lists the session's recent files (re-opened through `DocumentSession.openRecent`), the Print page shows `print` (see Printing). Commands without a handler are not shown; `fileDisabledReason` disables the file commands with a note. Esc / Back returns. `openBackstage(page)` opens it from anywhere (Ctrl+P). The Home page ends with the **Privacy** entry (P7-12, ADR 0009): where data is kept, the "Keep autosave copies in this browser" checkbox (default on; `DocumentSession.setKeepAutosave`, stored in `localStorage` `rusuite.keepAutosave`; off = no recovery entries, recent entries without content) and "Remove local copies from this browser" (`DocumentSession.clearLocalData` → `DocStorage.clearAll`: IndexedDB recent list, snapshots and recovery entries; desktop: recovery entries only, the recent list holds paths). |
| `RibbonButton` | Large (24 px icon over the label) or small (icon, optional label); `pressed` makes it a toggle (`aria-pressed`); tooltip = label + formatted `shortcut`. |
| `RibbonSplitButton`, `RibbonMenuButton` | Main action + arrow, or a button that only opens; the popup is a keyboard menu (`RibbonMenuItem[]`, with separators/section labels and radio items) or any panel. |
| `RibbonGallery`, `RibbonTableSizePicker` | Grid of choices with previews (inline in a group, or as a dropdown), arrow-key navigation; rows × columns picker. |
| `RibbonRow`, `RibbonStack`, `RibbonDivider`, `RIBBON_SELECT` | Layout of small controls (two rows per group). |
| `FontControls`, `StyleToggles`, `ColorControls`, `AlignmentControls`, `NumberFormatSelect`, `BordersDropdown` | The formatting toolbar's groups as standalone controls (the flat `Toolbar` still composes them). |
| `triggerShortcut(combo)` | Runs an entry of the app's `useShortcuts` map (dispatches the key on `window`), so ribbon commands reuse the ShortcutLayer's dialogs (Save As, help, New with its unsaved-changes question). |
| `UnsavedGuard`, `ConfirmDiscard`, `ensureSaved` | Unsaved-changes safety, see below. |
| `AutosaveStatus` | Status-bar item "Autosaved HH:MM" after the session stored a recovery snapshot (cleared by a save or a replaced document). |

## Keyboard

Alt pressed and released alone focuses the active tab (again: back to where the focus was). ←/→/Home/End move between tabs
(File included), Enter/Space activate (File opens the backstage), ↓ enters the tab's commands, Esc returns to the document.
Ctrl+F1 (or double-clicking a tab, or the chevron) collapses/expands; while collapsed, activating a tab shows its groups over the
document until a command runs, Esc, or a click elsewhere. Menus and galleries use the arrow keys; Esc closes them.
Ribbon dropdown panels near the window's right edge move left to stay in the window (P8-39).

## Tabs per app

- **Calc**: Home (Undo; Clipboard: Paste ▾ values, Cut, Copy – `calcActions`; Font incl. borders; Alignment incl. wrap and
  Merge & Center ▾ (Merge & Center – a toggle that unmerges a merged selection –, Merge Across, Merge Cells, Unmerge Cells);
  Number: the Number Format box (Excel's eleven entries with previews), Accounting ▾, %, Comma Style, decimals ±
  (see [number-formats.md](number-formats.md)); Styles: Conditional Formatting ▾; Cells: Insert ▾ (Insert Cells…, rows, columns, sheet), Delete ▾ (Delete Cells…, rows, columns, sheet), Format ▾ (row height, column width, autofit, hide/unhide
  rows and columns, Hide Sheet / Unhide Sheet…, Organize Sheets: Rename Sheet, Move or Copy Sheet…, Tab Color…; Protection:
  Protect Sheet… / Unprotect Sheet…, Lock Cell; Format cells…); Editing: Clear, Find ▾ Replace, Sort & Filter ▾ (Sort A
  to Z, Sort Z to A, Custom Sort…, Filter, Clear, Reapply)), Insert (Tables › PivotTable, Table; Illustrations › Pictures; New sheet, rows/columns, Charts, Links › Link), Page Layout (P8-35), Formulas (see below), Data (Get & Transform › From Text/CSV; Sort & Filter: A→Z,
  Z→A, Sort (Custom Sort dialog), Filter toggle, Clear, Reapply; Data Tools: Text to Columns, Remove Duplicates, Data Validation…; Forecast › What-If Analysis › Goal Seek…; Outline: Group ▾, Ungroup ▾, Subtotal, Show/Hide Detail), Review (Comments, Notes ▾, Protect: Protect Sheet… / Unprotect Sheet, Protect Workbook; see below), View (Show: gridlines, headings, formula bar; zoom 50–200 % via CSS `zoom` on the grid with hit-testing
  scaled; Window: Freeze Panes ▾ (Freeze/Unfreeze Panes, Freeze Top Row, Freeze First Column); shortcuts help). Zoom,
  gridlines, headings and frozen panes are the active sheet's `SheetView` (`setSheetView` / `setFreeze`, undoable, saved in
  the file's `<sheetView>`); the formula bar toggle is the app's.
- **Calc sort and AutoFilter** (`apps/calc/src/sortFilter`, P8-5): Sort A→Z / Z→A from a single cell is the core's
  `sortSheetByColumn` (its region, or the AutoFilter range); a larger selection sorts itself with the header guessed,
  after Excel's Sort Warning ("Expand the selection" / "Continue with the current selection") when data continues beside a
  multi-row selection (the current region is computed from the cached cells, `sort.ts`). Custom Sort…: levels (column –
  header text with "My data has headers" –, sort as Automatic/Numbers/Text, order), Add/Delete/Copy level, move up/down,
  case sensitive; a column used twice is refused → `sortRange`. The cell context menu has Sort A to Z / Z to A / Custom
  Sort… (flat items: the shared ContextMenu has no submenus). Filter (Ctrl+Shift+L) → `setAutoFilter` (a single cell: its
  region). The header row gets dropdown buttons drawn on the canvas at the right edge of each header cell (`filter.ts`:
  layout, hit-testing with a 2 px slop, a funnel when filtered, an arrow on the sorted column); a press (pointer event) or
  Alt+↓ on a header cell opens the panel: Sort A to Z / Z to A (the AutoFilter range), Clear Filter From "…", Text or
  Number Filters ▸ (click to expand: Equals…, Does Not Equal…, Begins/Ends With…, Contains…, Greater/Less Than (Or Equal
  To)…, Between…, Custom Filter… → the Custom AutoFilter dialog with two criteria and And/Or; Top 10… dialog; Above/Below
  Average at once), a search box and the value check-list from `filterValues` with (Select All) (tri-state), counts and
  "(Blanks)"; OK → `setFilterColumn` (all values ticked = no filter; nothing ticked = OK disabled; while searching only the
  ticked results). Number vs Text Filters follows the majority of the cached cell kinds. Filtered rows arrive as hidden
  `filtered` rows; the row numbers of a filtered range turn blue and the status bar shows "n of m records found".
  Round 2 (P9-C5): Custom Sort's Sort On adds Cell Color / Font Color / Conditional Formatting Icon (the order column
  lists the colours or icons of that column from the core's `lineColors`, conditional formats included, with On Top / On
  Bottom; colour levels may repeat a column), Order › Custom List… opens the Custom Lists dialog (Excel's day and month
  lists plus lists typed this session – Excel keeps custom lists in the application, so they are not saved), Options…
  holds Case sensitive and the orientation (Sort left to right: the levels pick rows, `sortRange.columns`). The context
  menu adds Put Selected Cell Color / Font Color / Icon On Top (when the cell has one) and Filter by Selected Cell's Value
  / Color / Font Color / Icon (an AutoFilter over the current region is created first). The filter panel adds Sort by
  Color ▸ and Filter by Color ▸ (cell colours, font colours, icons of the column) when the column has more than one, and a
  date column shows the values as a year › month › day tree (tri-state boxes, ± to expand; OK sends Excel's date groups:
  whole years, whole months or days, `Filter::DateGroups`). Typing a value right under the AutoFilter range extends the
  range (undo shrinks it). Sorting moves conditional formats and validations with their rows.
 frozen panes split the cell canvas into up to four quadrants (`panes.ts`: one viewport
  per quadrant, frozen ones fixed, a divider line, headers split the same way, pointer positions mapped per quadrant,
  scroll-into-view only for the scrolling part). Merged cells (`merges.ts`) paint as one cell (top-left content and fill over
  the range, inner gridlines masked, outer borders only, no overflow); selections snap to whole merges, the active cell is a
  merge's top-left cell (editing, typing, Delete and the name box use it), arrow keys skip covered cells, and paste / the
  fill handle refuse to change part of a merge with a toast. Merging cells that hold more than one value asks first (only
  the upper-left value is kept). Hidden sheets have no tab (tab menu Hide / Unhide… with a list of the hidden sheets;
  "very hidden" ones are not offered); the sheet a hide/unhide patch names (`activateSheet`) becomes active; the last
  visible sheet can be neither hidden nor deleted; hidden sheets are not printed.
  Dynamic arrays (P8-12, `grid/spill.ts`): selecting an array formula or a cell it spills into outlines the spill range in
  thin blue (dashed red while the formula shows `#SPILL!`); a spilled cell shows the formula greyed and read-only in the
  formula bar, typing into it is allowed and blocks the spill. A selected `#SPILL!` formula cell gets a warning indicator left
  of it (tooltip "Spill range isn't blank", menu: Select obstructing cells). Paste, the fill handle, Ctrl+D/R and sorting
  refuse to change spilled cells ("You can't change part of an array"); Delete on the formula cell removes the whole spill,
  on spilled cells alone it does nothing. Copying spilled cells copies their values (with their formula they paste blank and
  spill again); spilled cells count as data for Ctrl+arrows, regions and the used range. The formula editor knows `A1#`
  (coloured over the whole spill range), `@`, `#SPILL!` and `#CALC!`.
- **Calc conditional formatting** (P8-13, `apps/calc/src/condFormat`, `grid/cf.ts`): Home › Styles › Conditional
  Formatting ▾ is Excel's menu with flyouts (click, Enter or → opens one, ← / Esc closes it; hover opens too):
  Highlight Cells Rules (Greater Than… / Less Than… / Between… / Equal To… / Text that Contains… / Duplicate Values…) and
  Top/Bottom Rules (Top/Bottom 10 Items…, 10 %…, Above/Below Average…) open Excel's small dialogs with the six presets
  (Light Red Fill with Dark Red Text … Red Border) or Custom Format…; Data Bars (6 gradient colours), Color Scales (Excel's
  12) and Icon Sets (17, grouped Directional / Shapes / Indicators / Ratings) apply at once; New Rule… is the full dialog
  (the six rule types, 2-/3-colour scale, data bar and icon set editors with threshold types, cell value / specific text /
  blanks / errors, top/bottom, average, unique/duplicate, "Use a formula"; Format… edits the dxf: font style, underline,
  strikethrough, colours, outline border, number format); Clear Rules ▸ from the selection / the sheet; Manage Rules… lists
  the rules by priority for the selection or the sheet (description, format sample, editable "applies to", Stop If True;
  New / Edit / Delete, Move Up / Down) and sends its edits on OK / Apply as one compound (`manageCommands`: removals, then
  per position a reorder, update or add). New rules go on top (priority 1). The grid draws the snapshot's `cf` results:
  the dxf over the cell style, colour-scale fills (blank cells too), gradient data bars from the left (negative values red,
  left of a dotted zero axis fitted from the visible values), 16 px vector icons (`ICON_SETS`, shared with the gallery SVGs
  and the print view) with the text after them, and Show Bar/Icon Only. Patches with `cfSheets` re-fetch the active sheet's
  viewport (debounced 40 ms; other sheets reload when shown). The print view prints fills, bars (CSS gradients) and icons
  (inline SVG). `window.__calcCfOps` holds the last frame's bar/icon ops for the end-to-end tests.
  Round 2 (P9-C5): Highlight Cells Rules › A Date Occurring… (yesterday … next month) and New Rule › Format only cells
  with › Dates Occurring; above/below average with 1–3 standard deviations; icon thresholds with `>=` or `>` per icon;
  data bars with Excel 2010's options – Data Bars ▸ Gradient Fill and Solid Fill galleries (automatic minimum/maximum,
  0–100 %), and in the rule dialog Fill (solid/gradient), Border (none/solid + colour), Bar Direction and Negative Value
  and Axis… (negative fill and border colour, axis automatic / cell midpoint / none, axis colour). The core computes each
  bar (`CfResult.bar`: start and end as fractions of the cell, the axis position, final colours); the grid draws it as
  given. A rule's number format shows in the cell (`CfResult.display`). Rules Manager: Show formatting rules for adds This
  Table / This PivotTable (at the active cell), Duplicate Rule copies the selected rule above itself. Clear Rules ▸ adds
  This Table / This PivotTable. Copy + Paste of our own copy carries the rules (Paste Formats too; a pasted part joins an
  equivalent rule, so copying a cell next to its rule extends the rule's range; the destination's own rules are
  removed), Cut + Paste moves them, sorting moves them with the rows, renaming a sheet rewrites rule formulas. Home ›
  Clipboard › Format Painter (double-click: sticky until Esc or a second click) paints formats, conditional formats and
  validation on the next selected range (one compound: `pasteRange` formats + Paste Special › Validation).
- **Calc notes, comments and links** (P8-26, `apps/calc/src/comments`): the Review tab has Comments (New Comment
  Ctrl+Shift+F2 – a cell with a thread opens it to reply –, Delete (the selection's threads, else its notes),
  Previous/Next Comment (row by row, wrapping; opens the thread's card), Show Comments (the Comments pane right of the
  grid: the sheet's threads by cell with All/Open/Resolved filter, reply box, Resolve/Reopen, Edit, Delete, New Comment))
  and Notes ▾ (New/Edit Note Shift+F2, Previous/Next Note, Show/Hide Note, Show All Notes – a view toggle, not saved –,
  Convert to Comments). Indicators come with the cells (`CellView.note` / `comment`; annotated empty cells are in the
  snapshot): a red triangle for a note, a purple bubble for a thread (outlined when resolved), drawn over the selection.
  Hovering an annotated cell shows the note box (Excel's default position 15 px right / 10 px above the cell's corner,
  128 × 74 px, connector line), the thread card or the link tip; leaving the cell keeps the card 350 ms so the pointer can
  reach it (`hoverAt`, `holdHover`), and every hover action is also on the ribbon, the context menu and the pane (mobile
  guardrail). Visible notes are drawn on an HTML layer over the cells (`AnnotationLayer`, positioned from the grid's
  `screen` mapping after every frame, clipped to the cell area): click selects a box (dashed outline, eight handles;
  drag moves, handles resize → `setNote` with `bounds`; Delete removes the note; Esc deselects), double-click edits. The
  note editor is a `contenteditable` box with the runs as spans (`richText.ts`: `<br>` line breaks, caret/selection as
  character offsets) and a small toolbar (bold, italic, size, colour → `formatRuns` on the selection, the whole note when
  nothing is selected); Esc or clicking away commits (`setNote`, an unchanged or empty new note sends nothing). A new note
  starts with the author's name in bold, as in Excel. The author name is asked once ("Your name", initials) and kept in
  this browser's local storage only (`rusuite.user`, ADR 0009); `setUser` records it in the document's person list. The
  status bar shows the hovered note's cell and author. The cell context menu adds New Comment / Reply to Comment, Delete
  Comment, New/Edit Note, Show/Hide Note, Delete Note, Link / Edit Hyperlink…, Open Hyperlink, Remove Hyperlink. Insert ›
  Links › Link (Ctrl+K) opens Excel's dialog (existing file or web page – `www.` gets `http://`, an e-mail address becomes
  `mailto:` –, place in this document – cell reference + sheet, or a defined name –, e-mail address with subject; Text to
  display, ScreenTip; Remove Link when editing) → `setHyperlink` (the core gives the cells the Hyperlink style: theme
  hyperlink colour `#0563C1`, underline; an empty cell gets the address as text). Ctrl+click follows a link or a
  `HYPERLINK()` cell (target from `cellAnnotations`): web pages and mail through a hidden `<a target="_blank"
  rel="noopener">` (no `window.open`; `javascript:`/`data:` refused), places by selecting them (`goToTarget`). Copy and
  paste copies notes and links, cut and paste moves notes, threads and links (`pasteRange.annotations`); sorting and row /
  column edits move them with their cells. File › Print › Comments and notes: None, At end of sheet (pages listing cell,
  kind, author, text and replies after each sheet) or As displayed on sheet (the visible notes as boxes over the cells).
- **Calc data validation** (P8-13, `apps/calc/src/validation`): Data › Data Tools › Data Validation… (Settings: Allow
  any / whole / decimal / list / date / time / text length / custom, operator, minimum/maximum or value – dates and times
  typed as dates –, list source `a,b,c` or `=$A$1:$A$5`, Ignore blank, In-cell dropdown; Input Message; Error Alert:
  Stop / Warning / Information, title, message; Clear All). Any value without an input message removes the validation. A
  selected list cell shows a ▼ button right of it (also Alt+↓) with the core's `listValues`; a picked value is written
  directly. The input message shows as a yellow note under the selected cell. Committing an edit in a validated cell asks
  the core (`validateInput`) first; a failed check shows Excel's alert while the editor stays open: Stop → Retry (back to
  the edit, text selected) / Cancel (discard); Warning "Continue?" → Yes (keep) / No (back) / Cancel; Information → OK /
  Cancel. Paste and fill are not checked (as in Excel). Data Validation ▾ (P9-C5) adds Circle Invalid Data (the core's
  `invalidCells`: at most 255 cells whose values fail their validation, blanks never; red ellipses on the grid, a circle
  goes when its cell is corrected, new invalid entries wait for the next Circle Invalid Data) and Clear Validation
  Circles. List sources may be ranges on other sheets (saved as `x14:dataValidation`), defined names or structured
  references; validations follow copy, cut, sort and Format Painter like conditional formats.
- **Calc charts** (P8-20, `apps/calc/src/charts`, renderer `@rusuite/ui-shared` `chart/`): Insert › Charts (Recommended
  Charts dialog with live previews; Column or Bar ▾, Line or Area ▾, Pie or Doughnut ▾, Scatter ▾, Combo ▾ galleries of
  Excel's sub-types). While a chart is selected the contextual **Chart Design** (Add Chart Element ▾ with flyouts, Quick
  Layout ▾, Change Colors ▾, Chart Styles ▾, Switch Row/Column, Select Data…, Change Chart Type…, Move Chart…) and
  **Format** (Current Selection list, Format Selection, Reset to Match Style, Shape Fill, Shape Outline, Size) tabs appear;
  inserting a chart shows Chart Design. Charts are drawn over the cells, selected by click (element, then point), moved by
  drag, resized with 8 handles (Alt snaps to cells), deleted with Delete, copied with Ctrl+C/V; Esc deselects;
  double-click opens the Format pane; a click on the selected title edits it inline; right-click has the chart menu.
  Details: [charts.md](charts.md) "Calc UI".
- **Calc names and Formulas tab** (P8-23, `apps/calc/src/names`, `formulas`, `audit`, `numfmt`): the **Name Box** left of the
  formula bar is a combobox: it shows the active cell (or the name of a selected named range); typing a reference
  (`B7`, `A1:C3`, `A:A`, `Sheet2!B2`) or a name and Enter goes there, any other valid name is defined (workbook scope)
  for the selection – an invalid one toasts Excel's rule; ▾ (or ↓) lists the names of the sheet and the workbook and
  navigates. **Go To** (Ctrl+G, F5) lists them too and accepts references. **Formulas**: Function Library (Insert
  Function… – Shift+F3 and the formula bar's fx –: search by name and description, a category list, the signature and
  arguments of the selected function, OK inserts `NAME()` at the caret or starts a formula; AutoSum ▾ (Alt+=: Sum,
  Average, Count Numbers, Max, Min of the numbers above, else left of the active cell, pointed at; More Functions…);
  Recently Used, Financial, Logical, Text, Date & Time, Lookup & Reference, Math & Trig, More Functions (Statistical,
  Information) ▾ menus from `functions.json` (category = the section of functions.md); the recent list is kept in
  `localStorage` `rusuite.calc.recentFunctions`), Defined Names (Name Manager… – Ctrl+F3: name, value, refers to, scope,
  comment; New / Edit / Delete; Filter (scope, errors, defined); the selected name's Refers to edited in place with ✓ / ✕
  and the range picker that collapses the dialog –; Define Name ▾ (New Name: name with live validation, scope,
  comment, refers to – the selection by default, range picker); Use in Formula ▾ (inserts a name at the caret); Create
  from Selection… – Ctrl+Shift+F3: top row / left column / bottom row / right column, Excel's defaults guessed from the
  selection), Formula Auditing (Trace Precedents / Trace Dependents: blue arrows from the engine's dependency graph
  (`precedents` / `dependents` requests) with a dot at the start and a box around precedent ranges, a dashed arrow from a
  sheet icon for other sheets; each click adds the arrows; Remove Arrows ▾ (all, precedent, dependent arrows); Show
  Formulas – Ctrl+` (the key left of 1) –: cells show their input, formulas left-aligned, spilled cells blank; Error
  Checking, Evaluate Formula, Watch Window – P9-C4, below –), Calculation (P9-C4). In formulas, names autocomplete with the functions (accepting inserts the name without `(`), are coloured
  over the range they refer to and outlined on the grid while editing (point mode shows the name's range), and
  `Sheet1!Name` is accepted by the editor's syntax check.
- **Calc tables and data tools** (P8-35, `apps/calc/src/tables`, `datatools`, `outline`, `pictures`): Insert › Table
  (Ctrl+T / Ctrl+L) opens Create Table (the range – the current region of a single cell, `=$A$1:$B$4` –, "My table has
  headers" guessed like Excel; a range overlapping a table is refused). Tables draw with their style (Excel's 60 built-in
  Light/Medium/Dark styles, `tables/styles.ts`), header filter buttons (the AutoFilter dropdown, per table), and the
  contextual **Table Design** tab (Table Tools): Table Name (renames, references follow), Resize Table…, Summarize with
  PivotTable, Remove Duplicates, Convert to Range (the look stays as formats); Style Options (Header Row, Total Row, Banded
  Rows/Columns, First/Last Column, Filter Button); Quick Styles gallery. The active totals cell has a dropdown just right of
  it (None, Average, Count, Count Numbers, Max, Min, Sum, StdDev, Var, More Functions…). Typing below or right of a table
  extends it; a formula typed in an empty column fills the column (calculated column). Point mode inserts `[@Col]` for a
  cell of the same row of a table; the formula editor colours structured references over their cells and completes table
  names, columns and `#All`/`#Data`/`#Headers`/`#Totals`/`#This Row` after `[`. **Paste** ▾ has Excel's gallery (Paste,
  Formulas, Formulas & Number Formatting, Keep Source Formatting, No Borders, Keep Source Column Widths, Transpose, Values,
  Values & Number Formatting, Values & Source Formatting, Formatting, Paste Link) and Paste Special… (Ctrl+Alt+V: what,
  operation None/Add/Subtract/Multiply/Divide, Skip blanks, Transpose, Paste Link). Data › **Text to Columns** is a
  three-step wizard (delimited / fixed width with a ruler to click, drag and double-click break lines; delimiters, text
  qualifier, consecutive delimiters; column formats General/Text/Date (order)/Skip, destination, decimal and thousands
  separators); opening a `.csv`/`.txt` (File › Open or Data › From Text/CSV) runs the same wizard as the **Text Import
  Wizard** (file origin UTF-8/Windows-1252/UTF-16 detected) and makes a new document. Save As with a `.csv` name asks for the
  separator (comma, semicolon, tab), quoting and BOM and warns that only the active sheet's values are kept. **Remove
  Duplicates** (columns, "My data has headers") reports "n duplicate values found and removed; m unique values remain.".
  **Goal Seek** (Set cell, To value, By changing cell; secant with bisection, 100 steps, 0.001) shows its status and
  applies the value on OK (undoable). **Outline**: Group/Ungroup rows or columns (Alt+Shift+→/←), the outline bars left
  of the row headers / above the column headers with level buttons and −/+ at the summary line (below/right; Settings
  in the core's `OutlineProps`), Show/Hide Detail, Clear Outline, and **Subtotal** (at each change in, use function, add
  subtotal to, replace current, summary below data; Remove All) with its outline. **Pictures** (Insert › Pictures:
  PNG/JPEG/GIF/BMP/SVG/WebP, scaled to 640 px, moved and resized on the grid like charts, Delete removes the selected one;
  saved as `xdr:pic`). **Page Layout**: Print Area ▾ (Set / Clear), Breaks ▾ (Insert / Remove Page Break at the active
  cell, Reset All), Print Titles… (print area, rows to repeat at top, columns to repeat at left – the built-in names
  `Print_Area` / `Print_Titles`, used by File › Print); View › Workbook Views › Normal / **Page Break Preview** (grey
  outside the printed area, automatic breaks dashed, manual ones solid, "Page n" watermarks; drag a line to move a break).
  Not done (per the brief): Flash Fill, Consolidate, Auto Outline, slicers.
- **Calc pivot tables** (P8-33, `apps/calc/src/pivot`, details in [pivot.md](pivot.md) "UI"): Insert › Tables › PivotTable
  (Create PivotTable: Table/Range from the current region with the range picker, New / Existing Worksheet +
  Location; Recommended PivotTables since P9-C3) creates an empty table (Excel's placeholder box) and opens the
  **PivotTable Fields** pane right of the grid (search, field checkboxes, Filters / Columns / Rows / Values with
  pointer drag and drop and a ▾ menu per entry, Defer Layout Update + Update). While a cell of a table is selected
  the contextual **PivotTable Analyze** (Name, Options ▾ incl. Generate GetPivotData, Active Field, Refresh ▾,
  Change Data Source…, Clear ▾, Select ▾, Move PivotTable…, Field List, +/- Buttons, Field Headers) and **Design**
  (Subtotals ▾, Grand Totals ▾, Report Layout ▾, style options, the 84-style gallery) tabs appear under
  "PivotTable Tools". The grid draws the table style from the cells' pivot roles, −/+ buttons (press or
  double-click), header and page dropdowns (item check-list with search, sort, clear; page fields with
  Select Multiple Items), refuses content edits ("We can't change this part of a PivotTable."), asks before
  Delete removes a whole table, selects the table with Ctrl+A inside it, autofits the table's columns after
  each update, shows "Data changed – Refresh" over a sheet with a stale table (and a status-bar hint) and, in
  point mode, inserts `GETPIVOTDATA(…)` for a clicked value.
- **Calc formulas, names and calculation tools** (P9-C4, `apps/calc/src/formulas`, `audit`): **Calculation** group
  (collapses first on a narrow window): Calculation Options ▾ (Automatic / Automatic Except for Data Tables / Manual,
  `setCalcOptions`, undoable, saved as `<calcPr calcMode>`), Calculate Now (F9) and Calculate Sheet (Shift+F9). In
  manual mode an edit calculates only the edited formula; while other cells await recalculation the status bar shows
  **Calculate** (a button: Calculate Now). **File › Options › Formulas** (the app's options; with the assistant: General ›
  Open the app's options…): calculation mode, R1C1 reference style (formulas shown and typed as `R[-1]C*2`, column
  headings numbered, the Name Box shows `R2C3`; stored as A1 and saved as `refMode="R1C1"`), Enable background error
  checking and the five error checking rules (Excel's defaults: all but "Formulas referring to empty cells"; kept in
  `localStorage` `rusuite.calc.errorChecking`). **Define Name ▾ › Apply Names…**: the names to apply and Ignore
  Relative/Absolute (default on) → `applyNames` over the selection (a single cell: the sheet). **Use in Formula ▾ ›
  Paste Names…** and **F3** (also inside a formula): the visible names; OK / double click inserts one at the caret
  (outside an edit: starts `=Name`), Paste List writes names and definitions (as text) from the active cell down.
  **Formula Auditing** adds, in one row of icons after Remove Arrows: Show Formulas, **Error Checking** ▾ (Error
  Checking…, Error Checking Options…), **Evaluate Formula** and **Watch Window**. Background error checking paints a
  green triangle in the top-left corner of every flagged cell (the core's `errorChecks`, refreshed after each edit); on the
  active flagged cell a "!" button left of the cell opens the menu: the rule's title, its fix (Convert to Number,
  Copy Formula from Neighbours, Lock Cell, Show Calculation Steps…), Ignore Error (this session), Edit in Formula Bar,
  Error Checking Options… (a `#SPILL!` cell keeps its spill indicator there). The **Error Checking** dialog goes to the
  first flagged cell from the active one: "Error in cell Sheet1!A1", the input, the rule's title and text; the fix,
  Ignore Error, Edit in Formula Bar, Options…, Previous / Next; "The error check is complete for the entire sheet." when
  nothing is left. **Evaluate Formula**: Reference (`Sheet1!$C$3`) and Evaluation with the next part underlined;
  Evaluate replaces it by its value (Excel's order: inner parts first, references read by a function are part of the
  function's step), Restart when done, Step In on a reference to a formula cell shows that cell's formula, Step Out
  returns with the reference evaluated. **Watch Window** (pane): Add Watch… adds the selected cells, Delete Watch the
  picked row; Book, Sheet, Name, Cell, Value, Formula, refreshed after every edit; a double click goes to the cell.
  Trace arrows follow edits (each traced cell's arrows are fetched again after a change) and move with row and column
  inserts / deletes. The editor's syntax check accepts the intersection operator (`A1:B5 B3:C7`), unions in
  parentheses (`SUM((A1,B2))`), 3-D references (`Sheet1:Sheet3!A1`) and lambda calls (`LAMBDA(x,x+1)(2)`).
- **Calc pivot tables round 2** (P9-C3, details in [pivot.md](pivot.md) "Round 2"): Insert › Tables › Recommended
  PivotTables (candidates for the current region with a preview; OK creates the table on a new sheet) and PivotChart
  (inside a table a PivotChart of it right of the table, else Create PivotChart). PivotTable Analyze gains Group
  (Group Selection, Ungroup, Group Field → the Grouping dialog: Auto / Starting at / Ending at, By levels with Number
  of days, or By interval), Options ▾ › Show Report Filter Pages…, Calculations › Fields, Items, & Sets ▾
  (Calculated Field…, Calculated Item…: Name, Formula, the list with Insert, Add / Modify, Delete) and Tools
  (PivotChart, Recommended PivotTables); Design gains Blank Rows ▾ and style previews with the banded options. The
  header dropdowns add More Sort Options… (by the labels or a value field), Label / Date Filters ▸ and Value
  Filters ▸ (… Top 10…) opening the filter dialogs; Value Field Settings lists Distinct Count and fifteen Show Values
  As modes. Show Details and Show Report Filter Pages switch to the new sheet.
- **Calc entry and clipboard** (P8-39): a typed constant is recognised as Excel does (`engine_formula::entry`): `1,234`,
  `12%`, `$1,234.50` / `€12` / `12 €`, `(5)`, `1e3`, `1 1/2`, dates (`3/4/2024`, `2024-03-04`, `4.3.2024`, `4-Mar`,
  `March 4, 2024`, `Mar 2024`), times (`13:45`, `1:30 PM`) and date + time; a General cell gets the matching format
  (`#,##0`, `0%`, currency, `0.00E+00`, `# ?/?`, `m/d/yyyy`, `d-mmm`, `h:mm`, …), an `@` (Text) cell keeps the typed text.
  The formula bar shows dates as `m/d/yyyy`, times as `h:mm:ss AM/PM` and percentages as `12%` (the raw number when that
  form would not round-trip exactly). The formula bar is a one-line textarea (line breaks of Alt+Enter survive editing
  there). Ctrl+Enter commits without moving and puts the entry into every cell of a selected range. Ctrl+C puts the
  displayed values on the system clipboard (formulas as their results; cells with line breaks quoted, as Excel's TSV); the
  internal copy keeps formulas and formats. Number format keys: Ctrl+Shift+~ General, ! `#,##0.00`, @ `h:mm AM/PM`,
  # `d-mmm-yy`, $ currency, % `0%`, ^ `0.00E+00`; Ctrl+5 strikethrough; Ctrl+; / Ctrl+Shift+: start the editor with
  today's date / the current time; Ctrl+PageDown / PageUp switch sheets (desktop; browsers keep some of these keys).
  Renaming a sheet rewrites the formulas that name it (`=Sheet2!A1` → `='Data 2'!A1`). The fill handle continues
  weekdays and months (`Mon`, `January`; the source's letter case). Not done: German decimal commas in typed numbers
  (pending the locale decision of number-formats.md). A formula typed into a General cell takes the number format of
  the first formatted cell it refers to when it is a single reference or simple arithmetic on references (`=A1`,
  `=A1*2`, `=-(A2)+1`; not functions, comparisons, text or ranges), as Excel (P8-44).
- **Calc Insert / Delete Cells** (P8-44, `state/shiftCells.ts`): Home › Insert ▾ › Insert Cells…, Delete ▾ › Delete
  Cells…, the cell menu's Insert… / Delete… and Ctrl++ / Ctrl+- on a cell selection open Excel's dialog (Shift cells
  right / down – left / up –, Entire row, Entire column) → `insertCells` / `deleteCells` (`engine_formula::CellShift`:
  the edit of whole columns / rows restricted to the selection's rows / columns). Cells, styles, notes, threads,
  hyperlinks, merges inside the band, rule ranges and every formula, name, rule and chart reference follow (an area
  reference only when it lies inside the band across, as in Excel; others stay); dimensions, charts and pictures stay.
  Refused like Excel: cutting a merge ("We can't do that to a merged cell."), shifting cells of a table or the AutoFilter
  range, of a pivot table, or pushing cells off the sheet. A selection spanning every row / column inserts whole columns
  / rows. Undo is the opposite command plus the deleted cells and the original text of rewritten formulas.
- **Calc Format Cells** (P8-44, `numfmt/NumberFormatDialog.tsx`, `FormatCellsTabs.tsx`, `formatCells.ts`): Ctrl+1 (and
  Format ▾ › Format cells…, the cell menu) opens Excel's dialog on Number; the other tabs are Alignment (horizontal,
  vertical, indent, wrap text, shrink to fit, merge cells, orientation −90…90° as `alignment.textRotation`), Font
  (family, style, size, underline none/single/double, colour, strikethrough, superscript, subscript, preview), Border
  (presets None / Outline / Inside, the eight edge buttons around a clickable 2 × 2 preview incl. both diagonals, seven
  line styles, colour → the core's `setBorders`, which sets outer and inner edges per cell and can remove lines), Fill
  (No Color, theme and standard colours; Pattern Color and Pattern Style with Excel's 17 patterns – the background colour
  under them –, sample) and Protection (Locked, Hidden). OK sends only what changed (`formatCommands`), as one compound.
  The grid draws rotated text (inside its cell; a rotation refits the row height like Excel), shrinks the font of
  shrink-to-fit cells, draws diagonal borders, pattern fills (`grid/patterns.ts`, a 4 × 4 tile per pattern) and double
  / accounting underlines (accounting: across the cell, lower); the print view shows the same (rotation, both
  diagonals, patterns as an SVG background, double / accounting underlines). `fmt-xlsx` reads and writes
  `textRotation`, `shrinkToFit`, `<protection>`, the diagonal (`diagonalUp` / `diagonalDown`, one line style as in
  SpreadsheetML), `patternFill/@patternType` with `fgColor` / `bgColor` and `<u val="singleAccounting|doubleAccounting">`.
- **Calc Home › Borders ▾** (P9-C1, `ui/bordersMenu.tsx`): Excel's list – Bottom, Top, Left, Right Border, No Border, All
  Borders, Outside Borders, Thick Outside Borders (medium), Bottom Double Border, Thick Bottom Border, Top and Bottom
  Border, More Borders… (Format Cells › Border). Each is one `setBorders` command (one undo step); an edited outline edge
  also clears the facing side of the neighbouring cells, as Excel draws one line per edge.
- **Calc protection** (P9-C1, `apps/calc/src/protection`): Review › Protect › Protect Sheet… opens Excel's dialog
  ("Protect worksheet and contents of locked cells", Password to unprotect sheet, "Allow all users of this worksheet
  to:" with Excel's 15 options and defaults), then Confirm Password when a password was given ("Confirmation password
  is not identical."). The core hashes the password as Excel does (SHA-512, 16 random bytes of salt from the browser,
  100000 spins; files with the legacy 16-bit `password` hash are verified too). The button turns into Unprotect Sheet
  (a password prompt when there is one; a wrong password keeps the prompt open with Excel's message). Protect Workbook
  opens Protect Structure and Windows (Structure, Windows, optional password); the button stays pressed while the
  workbook is protected and then unprotects. On a protected sheet every change is checked in the core (`sheet_protected`
  with Excel's message as a toast): cell input and clearing need unlocked cells, formatting / column / row / insert /
  delete / sort / AutoFilter / pivot / object / hyperlink commands need the option that allows them, merges, Insert /
  Delete Cells, rules, validation, outline and tables are refused; typing into a locked cell shows the message without
  opening the editor. A locked structure refuses adding, deleting, renaming, moving, copying, hiding, unhiding and
  recolouring sheets (`workbook_protected`). Hidden formulas (Format Cells › Protection › Hidden) show an empty, read-only
  formula bar while the sheet is protected. The status bar shows a padlock on a protected sheet; the sheet tab menu has
  Protect Sheet… / Unprotect Sheet…; Home › Format ▾ has Protect Sheet… and Lock Cell (toggles `locked` on the
  selection). Selecting locked cells is not restricted on screen (the option is stored and saved).
- **Calc sheets** (P9-C1): Move or Copy… (sheet tab menu, Home › Format ▾ › Organize Sheets) with To book (this
  workbook), Before sheet (the visible sheets and "(move to end)") and Create a copy – one `moveSheet` or
  `duplicateSheet` with `index` (copies are named "Sheet1 (2)"), one undo step. Unhide lists the hidden sheets with
  multi-select (Ctrl+click toggles, Shift+click extends; Excel 365) and shows them in one step. Ctrl+PageUp/PageDown
  switch to the previous / next visible sheet. A coloured tab is filled with its colour while inactive and shows it as
  a bar when active. Saving writes the active sheet (`activeTab`, `tabSelected`); opening shows the file's active sheet.
- **Calc circular references** (P8-44): as Excel with iterative calculation off, the cells of a cycle show 0 (their
  dependents compute with it) and the status bar says "Circular reference: B8" (the cycle's first cell; with a sheet
  prefix in a workbook of several sheets) for as long as the cycle exists (`CalcDocument` re-checks it after every
  command with `Engine::cycle_through`).
- **Calc Backspace and column widening** (P8-44): Backspace opens the cell editor on the active cell with the content
  cleared (Enter clears the cell, Esc keeps it; a selected chart, picture or note box is deleted instead); Delete clears
  the selection. Typing a number (a constant, not a formula) into a column nobody sized widens the column to fit the
  displayed number (`state/autoWiden.ts`, a separate `setColWidth` after the entry), as Excel; columns never get
  narrower, wrapped and merged cells are left alone.
- **Calc structured references follow table edits** (P9-C2): deleting table columns (right-click › Delete Table
  Columns, the new Insert Table Rows Above / Insert Table Columns to the Left / Delete Table Rows entries of the cell
  menu inside a table, sheet column deletes through a table, Resize Table to fewer columns) turns every reference to a
  deleted column into `#REF!` (`Table1[Qty]`, `[@Qty]`, `Table1[[#Headers],[Qty]]`) and shrinks column ranges whose end
  column goes (`[[Qty]:[Tax]]` → `[[Price]:[Tax]]`) in cell formulas, defined names, conditional formatting and data
  validation formulas and the tables' calculated columns; renames reach the rules too. Undo restores every text.
- **Calc custom table styles** (P9-C2, `tables/TableStyleDialog.tsx`): Table Design › Quick Styles lists Custom first
  (named previews), then Light, Medium, Dark, then New Table Style… and Clear. The dialog has Name, the element list
  (Whole Table, First / Second Column Stripe, First / Second Row Stripe, Last Column, First Column, Header Row, Total
  Row; formatted ones in bold), Fill, Font color, Bold, Italic, Border (style and colour around the element), Stripe Size
  1–9 for stripes, Clear, a preview and "Set as default table style for this document". Right-click on a gallery item:
  Apply, Modify… / Duplicate… (built-in styles duplicate as their elements) / Delete (custom), Set As Default (new tables
  get it). One `setTableStyles` command each; tables of a deleted style get the default style, a renamed style's tables
  follow it. Later elements win over earlier ones (Excel's order); borders sit on the element's outer edges.
- **Calc slicers** (P9-C2, `apps/calc/src/slicers`): Insert › Filters › Slicer, Table Design › Insert Slicer and
  PivotTable Analyze › Filter › Insert Slicer open Insert Slicers (a checkbox per column / field; outside a table or
  pivot table a message explains). Each slicer is a floating panel right of its data: caption with Multi-Select (Alt+S)
  and Clear Filter (Alt+C), buttons per item (selected, unselected, no data dimmed; `(blank)` last). A click selects that
  item alone; Ctrl+click or Multi-Select toggles (with nothing filtered it deselects the clicked item; the last item
  cannot be deselected). Table slicers set the table's value filter (the filter dropdown shows it); pivot slicers filter
  every connected pivot table (row / column / page fields or a field on no axis). Drag to move, corner handles to
  resize, Delete removes it (with its filter). The contextual Slicer tab: Slicer Caption, Report Connections (pivot
  tables of the same cache), Slicer Settings (name, caption, Display header, ascending / descending), Slicer Styles
  (Light 1–6, Other 1–2, Dark 1–6), Buttons (Columns, Height), Size (Height, Width).
- **Calc Flash Fill** (P9-C2, `datatools/flashFill.ts`): Data › Data Tools › Flash Fill and Ctrl+E fill the active
  column's empty cells from the examples typed into it, learning from the other columns of the current region (tokens
  from the start or the end, one delimiter's parts, initials, fixed substrings, literals, UPPER / lower / Proper, number
  formats through the core's formatter); "Flash Fill changed N cells" (one undo step) or a message when no pattern fits.
  After a second example is entered the suggestions show greyed in the cells below with "Enter: Flash Fill"; Enter fills
  them, Esc or any other action drops them.
- **Calc Consolidate** (P9-C2, `datatools/ConsolidateDialog.tsx`): Data › Data Tools › Consolidate: Function (Sum,
  Count, Average, Max, Min, Product, Count Numbers, StdDev, StdDevp, Var, Varp), Reference with the range picker, Add,
  All references, Delete, Use labels in Top row / Left column, Create links to source data (formulas such as
  `=SUM(Q1!$B$2,Q2!$B$2)`; not on a source's own sheet). The result starts at the active cell (one undo step); the
  references stay for the session; the destination is named `Consolidate_Area`.
- **Calc Auto Outline** (P9-C2): Data › Outline › Group ▾ › Auto Outline groups the rows (and columns) whose formulas a
  summary row right below (column right of) them refers to – nested summaries nest the groups; "Cannot create an
  outline." when no formula summarizes; Ungroup ▾ › Clear Outline removes it. Outline Settings: Summary rows below
  detail, Summary columns to right of detail, Create (Auto Outline with them).
- **Calc print titles and print areas** (P9-C2): the print preview and PDF repeat the Print Titles rows on the pages
  after them (anywhere on the sheet, not only `$1:$k`) and the columns to repeat at left on the page columns after them,
  with the corner cells; title lines above / left of a print area print with it. A print area of several ranges
  (`A1:C9,E1:F4` in Page Layout › Print Titles) prints each range on its own pages. The desktop Open dialog lists
  "Excel workbook, CSV, TXT" (and each type alone); text files open in the Text Import Wizard as on the web, as an
  untitled workbook.
- **Write**: Home (Undo; Clipboard; Font; Paragraph: lists, indent, line spacing, alignment; Styles gallery Normal/Title/Heading
  1–6; Editing: Find and replace), Insert (Table picker, Picture, Page break, Line break), Layout (Margins, Orientation, Size →
  `SetPage`), View (zoom, shortcuts help).
- **Write**: Home (Undo; Clipboard; Font; Paragraph: lists, multilevel list, indent, line spacing, alignment, shading, borders,
  tabs; Styles gallery (quick styles with live previews, ▾ Create a Style / Clear Formatting / Apply Styles, Styles pane; P8-21); Editing: Find and replace), Insert (Table picker, Picture, Links: Link /
  Bookmark / Cross-reference, Header/Footer/Page number, Text: Field, Date & Time, Symbols: Symbol ▾, Footnotes, Page break,
  Line break), Design (Document Formatting: Style Sets gallery ▾ Reset / Save as a New Style Set; Formatting: Paragraph
  Spacing ▾, Set as Default; P9-W3), Layout (Margins, Orientation, Size → `SetSection`/`SetPage`, Columns ▾, Breaks ▾ incl. Column, Hyphenation ▾),
  References (Table of contents, Captions: Insert Caption, Insert Table of Figures ▾, Cross-reference, Bookmark, Update Fields;
  Footnotes; P8-27), Review (Comments: New, Delete ▾, Previous/Next, Resolve, Show Comments, Comments Pane; P8-25), View (views, ruler, Navigation Pane, zoom, spelling, shortcuts help); contextual Table Design and
  Table Layout in a table, Picture Format on a picture (P8-17).
- **Show**: Home (Undo; Clipboard: shapes/slides clipboard + Duplicate; Slides: New slide ▾ layouts, Layout ▾, Duplicate,
  Delete, Hide slide; Font + grow/shrink; Paragraph + line spacing ▾; Drawing: shapes gallery, Arrange ▾
  order/align/distribute/group, fill and outline), Insert (New slide, Table ▾ picker 10 × 8 + Insert table…, Picture,
  Shapes ▾ grouped library, Text box), Design (Background
  colour, Apply to all, Reset), Transitions (Preview; gallery None/Fade/Push/Wipe/Cover/Split/Cut/Zoom + Effect Options ▾;
  Timing: Duration, Apply to all, Advance slide On mouse click / After mm:ss), Animations (Preview; Animation styles ▾ grouped
  Entrance/Emphasis/Exit + None, Effect Options ▾; Add animation ▾, Animation pane; Timing: Start, Duration, Delay, Move
  earlier/later), Slide Show (From Beginning / Current Slide, Set Up Slide Show, Hide Slide, Rehearse Timings, Use
  Timings, Loop until Esc, Presenter View; P8-28), View (Presentation Views: Normal, Outline View, Slide Sorter, Notes
  Page, Reading View; Slide Master; Show: Ruler, Gridlines, Guides, Notes, Grid and Guides…; present from
  beginning/current, Presenter view, zoom Fit/50–200 %, shortcuts help), Home › Editing › Select ▾ (Select All, Select
  Objects, Selection Pane),
  contextual Shape Format while shapes are selected (Format shape…, Alt text…, Change picture…/Reset size; Insert shapes:
  Shapes ▾, Change shape ▾; Shape styles ▾, fill, outline, Arrows ▾, Connector type ▾ + Reroute; Arrange ▾, Rotate ▾), or
  Table Design + Layout while one table is selected, Chart Design + Format while one chart is selected, Playback (+ Shape
  Format) while audio/video is selected (P8-24); Insert also has Chart, Links (Link, Action) and Media (Video, Audio), and
  New Slide ▾ ends with Reuse Slides…; Present in the strip. Right-click menus on shapes, on the slide and on thumbnails (`apps/show/src/canvas/menus.ts`).

Each app keeps its status bar; Calc and Show also show the zoom there, all three the last autosave.

Every app's View tab also has **Language / Sprache** (English, Deutsch); the same picker sits at the bottom of the File
backstage. The UI language follows the browser by default and switches in place; see [i18n.md](i18n.md) (P7-11).

## Cloud connections (P8-36)

**Desktop apps only (P8-42, owner decision 2026-10-16):** the web CSP stays `connect-src 'self'`, so the web build has no
connections: `WasmBackend` creates no `Connectors`, File › Open / Save As go straight to the device dialogs (no Connections
section, no "Add a connection…") and the Privacy entry has no "Forget all connections". The web code paths (IndexedDB
store, `fetch` provider, CSP detection) stay for the e2e suite, which pretends to be a desktop app with
`window.__RUSUITE_PLATFORM__ = "desktop"` (`simulatedDesktop()` in `backend.ts`, set via `addInitScript`; it only reveals
UI, the CSP still blocks other hosts). The text below describes the desktop apps.

Generic and opt-in (owner 2026-10-16; ADR 0009 amendment): the user adds a WebDAV server (Nextcloud, ownCloud, a NAS,
a hosted drive); Rusuite offers no cloud and contacts nothing until then. Code: `packages/ui-shared/src/connectors`
(`FileProvider`, `Connectors` controller = `Backend.connectors` = `session.connectors`, transports, stores, UI).

- **File › Open / File › Save As** (backstage pages): left, "This device" (Open: the file dialog / file input;
  Save As: the native save dialog / the download name prompt – the app's previous command, autofocused) and
  **Connections** – the configured ones (a connection blocked by the site's CSP is disabled with the reason) and
  **Add a connection…**. Ctrl+O / Ctrl+Shift+S still go straight to the device dialogs.
- **Add / Edit connection** dialog: Name, Server URL (`https://…`; `http://` only with "Allow unencrypted http://
  (local network only)"), User name, Password, Folder (root), "Remember password on this device" (web: kept
  unencrypted in the browser's storage – said in the dialog; desktop: the system keyring; off: asked once per
  page/session), the host that will be contacted, **Test connection** (lists the folder: "Connected. The folder lists
  N entries." or the reason – wrong password, CORS with the site origin and a Help link, the CSP message, offline).
- **File browser** (`FileBrowser`): connection name and URL with Edit connection… / Remove connection (asks);
  breadcrumbs; a folder tree (lazy, expandable); the list (`role=listbox`, 32 px rows: name, size, modified; folders
  first, natural order; only the app's file type unless "Show all files"); New folder (inline name), Rename (F2,
  inline), Delete (Del, asks; folders with their contents), Refresh. Keyboard: ↑/↓/Home/End/PgUp/PgDn select,
  Enter opens a folder or the file, Backspace goes up. Open: double-click / Enter / Open. Save As: "File name"
  (the document's name; the app's extension is added) and Save; an existing file asks "Replace file".
- **Remote documents**: opening binds the document to connection + path + ETag (`Connectors.location`); the window
  title reads "Budget.xlsx – Nextcloud – Rusuite Calc" and the status bar shows the connection (`RemoteStatus`, in
  `AutosaveStatus`). Save (Ctrl+S, File › Save, the unsaved-changes question) writes back with `If-Match`; a 409/412
  asks **"<name> changed on the server"**: Overwrite / Save a copy ("<name> (copy).xlsx", then bound to it) / Reload
  theirs (opens the server's version, discarding local changes) / Cancel. A local Save As or download unbinds.
  Errors and going offline show a notice (bottom right; the changes stay, autosave copies stay local as before).
- **Recent files** list remote entries with a cloud icon and "Nextcloud › /Docs/Budget.xlsx"; they re-open from the
  server. File › Home › Privacy adds the connections paragraph and **Forget all connections** (records, secrets,
  remote recent entries); "Remove local copies" also clears the remote recent entries.
- Apps wire one line: `SessionAdapter.saveAs(name)` = the guard's `doc.save(name)` (Save As under a name without a
  prompt), which Save As › a connection runs while `Connectors.pendingSave` points at the target.

## AI assistant (P8-37)

**Desktop apps only (P8-42):** on the web build `Backend.ai` exists with `available: false` – no Home › AI group, no
Ctrl+Shift+A, no pane, no status-bar item, no requests – and File › Options… › AI shows only "The AI assistant is available
in the desktop apps." with a "Download the desktop apps" link (`AiDesktopOnly`). The text below describes the desktop apps.

Opt-in, the user's own provider account and key, client-side (ADR 0009 amendment; design `docs/ai-plan.md`). Code:
`packages/ui-shared/src/ai` (`Assistant` = `Backend.ai` = `session.ai`, providers, prompts, schemas, panel) and
`packages/ui-shared/src/settings` (the Options dialog); per app `apps/*/src/ai/` (an `AiAppAdapter`: actions, context,
selection summary, Insert / Replace buttons).

- **File › Options…** opens the shared Options dialog (all apps; Write's own options – the comment author – are its
  General page). **AI** page: "Enable the AI assistant" (off by default), the data notice "Text you select is sent to
  <provider> only when you use an AI action", Provider (Anthropic (Claude) / OpenAI-compatible), API key (masked;
  where it is kept: web – this browser's storage, unencrypted; desktop – the system keyring), Forget key, Base URL
  (advanced for Anthropic), Model (known ids + Other… free text), Max tokens, Temperature ("used only where the model
  accepts it"), "Include the whole document by default", the origin that will be contacted, **Test** (lists the
  provider's models: "Connected. The provider lists N models." or the reason), Cancel / Save.
- **Home › AI › Assistant** (all apps, toggle) or **Ctrl+Shift+A** opens the **Assistant** task pane on the right
  (320 px): header with AI settings and Close; when off or without a key a short text and "AI settings…"; the data
  notice; "Context: <selection summary>" (Write: selection or current paragraph with its length; Calc:
  `Sheet1!B2:D9`; Show: "slide 2 of 6" or the selected text box) and **Include whole document** – with the size
  ("about N characters, ~T tokens"), amber above 50 000 characters, cut at 400 000; the action chips (disabled with a
  reason: "Select something first", "The active cell has no formula", …; chips that need text – Translate to…, Draft,
  Formula, Transform, Outline – arm the prompt box); the turns of this document (prompt, context, streamed answer or a
  preview of the structured result, errors, the apply buttons, Copy for text, tokens and model); the prompt box (Enter
  sends, Shift+Enter new line), model picker, Send / **Stop**, "This document: N input · M output tokens", Clear
  conversation. Esc closes the pane.
- **Results are ordinary edits**: Write – Replace selection (the range captured when the request started; the
  current selection if that text changed) and Insert (paragraphs after the selection's block), Insert draft
  (headings + paragraphs) and Insert table (header row bold) – each one transaction → one undo step. Calc – Insert
  formula (validated; into the active cell of the request), Apply (transform: writes the previewed rows from the
  destination's top-left as one undo step, then selects them), Insert chart (selects the range, the chart insert),
  Insert into active cell (free answers). Show – Insert slides (after the current slide, "Title and Content" with
  the deck's theme, one undo step), Set as speaker notes, Replace slide text (the selected text box or the body,
  levels kept when the line count matches), Apply layout.
- **Status bar**: "AI: <provider>" while AI is enabled (click toggles the pane; "working…" while a request runs).
- **Errors** in the turn, localized by kind with the provider's message: wrong key, rate limit ("Try again in N s"),
  overloaded, offline / interrupted, CORS, **CSP** ("This site's security policy does not allow connections to the
  AI provider…" – only when the page has a CSP; the desktop apps have none and the web build does not offer the assistant), refusal, cut off (raise Max tokens), no usable result.

## Save and Save As on the desktop (P7-7)

The desktop shell remembers the document's file (`DocPath` in `apps/*/src-tauri/src/lib.rs`): Open (dialog or recent file)
binds it once the core opened the file, Save As re-binds it, New / a recovered document unbind it (the shell watches
`dispatch` replies). `Backend.saveFile(name, bytes, { saveAs })` → `save_file`: a plain **Save** (Ctrl+S, File › Save, Save in
the unsaved-changes question) of a bound document writes that file without a dialog; an untitled document or **Save As**
(Ctrl+Shift+S, File › Save As…) shows the native save dialog, starting in the current file's folder. The result is the
written file (`SaveResult`: `SavedFile { name, path }`), whose name becomes the document's name (`markSaved`) and the window
title. Calc and Write go straight to the native dialog for Save As; Show still asks for the name first and then opens the
dialog with it. The web shell is unchanged: Save downloads, Save As asks for the download's name.

## Unsaved changes (P7-6)

Before a command replaces or closes a modified document – New (Ctrl+N), Open (Ctrl+O, File › Open…), a recent file, Restore in
the recovery banner, File › Close and closing the window – the app asks **"Save changes to <name>?"** with **Save** /
**Don't save** / **Cancel** (Esc = Cancel), as Office does. Save runs the app's save flow and the command only proceeds when
the file was written: an untitled document is named first in the browser (the Save As prompt; the desktop's native save dialog
is the Save As), and a cancelled name prompt or save dialog cancels the command.

- `ensureSaved(prompts, doc)` is the flow (`DocState`: `dirty()`, `name()`, `defaultName`, `save(asName?)`);
  `UnsavedGuard(backend, doc)` is the per-window controller (`ensureSaved()`, `run(action)`, the pending question rendered by
  `<ConfirmDiscard guard>`). Recent files and Restore ask through `SessionAdapter.confirmReplace`.
- Closing the window: web – the browser's native `beforeunload` prompt while dirty (`guard.watchWindow()`). Desktop – the
  UI keeps the shell's `CloseGuard` set while dirty (`set_close_guard`, `guard.syncDirty()`); the shell then holds a close
  request and emits `rusuite://close-requested`, the guard asks, clears the flag and closes the window again
  (`core:window:allow-close`).
- Recovery banner: entries older than 7 days are dropped (`RECOVERY_MAX_AGE_MS`); with several entries it offers
  **Discard all**.

## Show: slide show and presenter view (P7-8)

- **Slide show** (F5 / Shift+F5, Present): the slide full screen (`present/Presenter.tsx`), driven by the pure state machine
  `present/showState.ts` (`reduceShow`, `keyAction`, `clickAction`): click/tap right half next, left half previous; B/W
  blank the screen black/white; number + Enter jumps; after the last slide a black "End of slide show" slide, then exit;
  the pointer hides after 3 s idle. The slides are fixed when the show starts (hidden ones skipped unless started on one).
- **Presenter view** (Alt+F5, View › Presenter view): the main window shows the presenter console
  (`present/PresenterConsole.tsx`): current slide, next slide, speaker notes with A−/A+ text size (remembered), elapsed
  timer with reset, clock, slide counter, Previous / Next / Black screen / End show and a slide strip to jump. A second
  window (`?audience=<id>`, rendered by `present/Audience.tsx` without a backend) shows the slide; on the web it is a
  `window.open` popup (fullscreen on its first click or key), on the desktop a `WebviewWindow` labelled `audience`
  (fullscreen on a second monitor when there is one; capabilities `presenter.json`, `audience.json`).
- **Sync** (`present/sync.ts`): `BroadcastChannel` on the web, Tauri events on the desktop, behind `SyncChannel`. The
  presenter owns the show and sends `deck` (slides, theme, media) and `state` `{slideIndex, blackout, ended}`; the audience
  sends `hello`, its keys/clicks as `action`, and `bye` when closed (which ends the show); `end` closes it.
- If the window cannot be opened (popup blocked), the show runs in the main window with a speaker notes overlay and a
  Notes toggle in the corner.

## Show: shape library, connectors and tables (P8-16)

- **Outlines** (`apps/show/src/shapes/paths.ts`): every auto shape and connector is drawn from the core's `shapePaths`
  (one Konva `Path` per sub-path with its fill / stroke flags). One process-wide cache keyed by geometry + box size +
  adjust values, so a patch that changes any of them makes a new entry (LRU, 5000 entries); missing outlines are fetched
  in one batch per tick and the renderers re-render when they arrive (a rectangle / ellipse fallback meanwhile). The editor,
  thumbnails, presenter and print use the same cache (print awaits `ensure`); the audience window gets the slides'
  entries with the `deck` message. Text sits in the preset's own text rectangle (ECMA `a:rect`, from the same
  `shapePaths` reply, scaled to the drawn box; the whole box until it arrives).
- **Insert › Shapes** (`ui/ShapeGallery.tsx`): Recently used (kept in `localStorage`), Lines (straight / elbow / curved
  connectors with and without arrowheads), Rectangles, Basic shapes, Block arrows, Flowchart, Stars and banners, Callouts;
  icons from the same outlines. A pointer click arms drawing (`ShowState.drawMode`, crosshair, `data-draw-mode` on the
  stage): drag a box (Shift: square) or click for the default 1-inch size at the click; Esc or a right-click cancels.
  Enter / Space on an item inserts it centred at once. Home › Drawing has a compact gallery plus More shapes ▾.
- **Adjust handles** (`shapes/handles.ts`, `canvas/EditHandles.tsx`): yellow diamonds for the presets' `a:ahXY` /
  `a:ahPolar` handles as the core computes them (`shapePaths` `handles`: position, the adjust value per axis with samples of
  the coordinate over its range, inverted piecewise-linearly while dragging; polar handles turn around the box centre),
  live preview while dragging, one `SetGeometry` on release (all adjust values of the shape). The handle math lives in
  `packages/ui-shared/src/geometry/handles.ts` (P9-X1), shared with Write's drawings; Show keeps its Konva rendering.
- **Connectors** (`shapes/connectors.ts`): drawing or dragging an end over a shape shows its connection sites (grey, red
  when within 12 px); releasing on one glues it (`AddShape` with `start`/`end`, or `SetTransform` + `SetConnector`: the
  core lets go of ends whose shape did not move and re-glues them from the patch, then reroutes; a connector moved together
  with every shape it is glued to – one drag or nudge of the selection – keeps its route, P8-40). End handles are green
  when glued. An elbow with two turns has a middle handle (`adj1`). Shape Format › Arrows (9 presets + Small / Medium /
  Large), Connector type (Straight / Elbow / Curved) and Reroute connectors (each glued end to the site nearest to the
  other end). Duplicating / pasting keeps a connector glued only to shapes copied with it.
- **Tables** (`shapes/tables.ts`, `canvas/tableLayout.ts`, `canvas/TableOverlay.tsx`): drawn on the canvas (fills, text,
  borders; rows grow with their text), with PowerPoint's 74 built-in styles (generated from the core's family rules,
  `generated/tableStyles.json`) and the presentation's own (`tableStyles`), parts applied like the core's
  `TableStyleDef::cell` (unknown style ids draw no style formatting). While one table is selected a DOM layer (pointer
  events, inset 5 px so the Transformer handles and the frame for moving stay reachable) takes clicks (edit the cell in
  the text overlay), drags across cells (cell selection, highlighted) and drags on column / row borders (`SetTableGrid`;
  neighbouring columns share the change, rows grow); right-click opens the table menu. In a cell Tab / Shift+Tab and the
  arrows at the text's edges move between cells (Tab in the last cell adds a row; Tab / Shift+Tab select the text of the
  cell they move to, ← enters at its end, → at its start, P8-40), Enter makes a new paragraph; the text is
  committed with `SetTableCellText`. Table Design: style options (header / total row, banded rows / columns, first / last
  column → `SetTableStyle`), table styles gallery + Clear table, Shading and Borders (all, outside, inside, none, each
  side; explicit lines in `SetTableCellProps`) for the cell selection (else the edited cell, else the whole table).
  Layout: Delete ▾ rows / columns / table, Insert above / below / left / right (as many as selected), Merge / Split cells,
  Distribute rows / columns, horizontal and vertical alignment, Cell margins ▾ (Normal / None / Narrow / Wide).

## Show: transitions and animations (P8-8)

- **Model rules in the UI** (`apps/show/src/anim/effects.ts`): the rules of `crates/model-show/src/anim.rs` mirrored for the
  menus (directions per transition kind / effect, defaults, which effects exist per kind), the labels (transition
  directions name the side the slide comes from: `left` = "From Right"; animation directions the side of the shape) and
  the click numbers (every On Click animation starts a number, With/After Previous share it, leading ones are 0).
- **Transitions tab** → `setTransition` for the current slide (a new kind gets its default duration and direction and keeps
  the advance settings; "None" with On mouse click and no After = no transition) and `applyTransitionToAll`. Effect
  Options lists only the kind's directions. The slide sorter shows a small star under the number of slides with a
  transition or animations.
- **Animations tab**: the gallery applies its effect to the selected animation, else to each selected shape's first one
  (`updateAnimation`, default duration, direction reset when it no longer fits), shapes without one get a new On Click
  animation (`addAnimation`); None removes them. Add animation always appends. Effect Options / Start / Duration / Delay
  patch the selected animation, else every animation of the selected shapes. While the Animations tab or the pane is
  shown, number badges sit left of the animated shapes on the stage (a badge selects its animation).
- **Animation pane** (`ui/AnimationPane.tsx`, right of the stage): rows in play order with number, kind star (green
  entrance, gold emphasis, red exit), shape name and effect; click / arrows select, Delete or the bin removes, Alt+↑/↓ and
  the ▲/▼ buttons move, dragging a row by its grip (pointer events) drops it at the insertion line (`reorderAnimation`);
  Play all previews.
- **Preview** (both tabs) plays on the editor stage (`canvas/AnimOverlay.tsx`): the transition from the previous slide
  (black before the first), or the slide's whole sequence; a click or Esc stops it.
- **Playback** (`anim/playback.ts`, pure; `anim/driver.ts`, Konva): a slide's animations form click groups (group 0 =
  animations before the first On Click one, played when the slide appears); With Previous starts with the previous
  animation, After Previous when it ends, each plus its delay. Shapes whose first animation is an entrance start hidden;
  `shapeStates(slide, n)` rebuilds the visibility and Grow/Shrink scale after any number of groups, so ← can step back.
  Effects are frames of `effectFrame` (fade, fly from outside the slide, wipe via a clip, zoom), Spin and Grow/Shrink are
  Konva tweens. Transitions animate two slide pictures with the Web Animations API (`transitionFrames`: fade, push / cover
  with direction, wipe and split via `clip-path`, zoom; cut/none instant).
- **In the show** (`present/AnimatedSlide.tsx`): `ShowState.step` counts the click steps done on the slide; next plays the
  next group before moving on, ← goes back one step (onto the previous slide with all its steps done); jumps start at
  step 0. "On mouse click" off means a click does not leave the slide (keys and the timer still do). "After" advances
  automatically once the step's animations (and the transition) have finished; S stops / restarts it. The sync `state`
  message carries `step`, so the audience window and the presenter console's Next preview (the current slide after its
  next click while steps are left) follow. The show element has `data-step`, the slide `data-hidden-shapes`.

## Show: themes, layouts, master view, footers, sections, pictures (P8-22)

- **Rendering** (`apps/show/src/design/`): `color.ts` is a TS port of `model_show::Theme::resolve` / `apply_mods`
  (DrawingML tint, shade, lumMod/lumOff, satMod/satOff, hueMod, alpha; `p:bgRef` 1001… into `bgFillStyles`, 1… into
  `fillStyles`) – a port rather than a request because thumbnails, print and the audience window render synchronously
  without a core round trip. `deck.ts` resolves what a slide inherits: background slide → layout → master (solid or
  linear / radial gradient on the Konva background), the master's and layout's decorative shapes under the slide unless
  the slide (or, for the master's, the layout) hides background graphics, placeholders by `idx` / kind / class
  (`Layout::find`), and text defaults per outline level (level 1 = the placeholder's effective defaults, deeper levels the
  master's body text style). Field runs show the live slide number (the slide's position; `‹#›` on layouts) and today's
  date in the field's `datetimeN` format written in the app's locale (`fields.ts`, `Intl.DateTimeFormat`). Pictures
  (`picture.ts`): the crop's source rectangle, recolour then brightness / contrast per pixel into a cached bitmap,
  transparency as opacity, the outer shadow cast by the outline under the picture, the outline shape as a clip (from
  `shapePaths`), the border on top; DOM previews use `cssFilter` (= the core's `css_filter`). `DeckContext` carries the
  master, the slide order and the sections, so editor, thumbnails, presenter, audience window and print agree.
- **Design tab** (`ui/DesignTab.tsx`): Themes (the core's eight built-ins from `getThemes`, each a live thumbnail of a
  sample title slide with its fonts, colours and master background) → `ApplyTheme`; Variants (the current theme's accents
  rotated, four variants) and Colors ▾ (the built-ins' palettes) → `SetThemeColors`; Fonts ▾ (ten own heading / body
  pairings) → `SetThemeFonts`; Background Styles ▾ (styles 1–3 × Light 1, Light 2, Dark 2, Dark 1 on the master);
  Slide Size ▾ (Standard 4:3, Widescreen 16:9, Custom… in cm) → `SetSlideSize` (with content on the slides PowerPoint's prompt: Maximize or Ensure Fit, P8-32); Format Background opens the pane.
- **Format Background pane** (right of the stage): Solid fill (colour) or Gradient fill (the theme's gradient background
  style in a theme colour), Hide background graphics, Apply to All (every slide gets the current slide's fill and
  graphics setting), Reset Background. Slides take explicit fills only (`SetBackground`), so a gradient chosen in the
  normal view goes to the master (and the current slide's own fill is removed); in the master view the pane edits the
  selected master or layout. Picture or texture fill (P8-32): Insert… a picture file, Tile picture as texture, Transparency.
- **Layouts**: Home / Insert › New Slide ▾ and Home › Layout ▾ show the presentation's layouts as thumbnails (the
  master view's pseudo slides), → `AddSlide` / `SetSlideLayout`; Home › Reset → `ResetSlide`. Context menus list every
  layout.
- **Slide Master view** (View › Slide Master; `ui/MasterView.tsx`, `design/master.ts`): the panel shows the master and
  its layouts (with how many slides use each); the stage shows the selected one as a pseudo slide – one shape per
  placeholder with PowerPoint's sample text (five body levels, date / footer / `‹#›`) over its background and decorative
  shapes. Moving / resizing a placeholder with the normal selection tools and level-1 run / paragraph formatting from
  the Home tab become `SetMasterPlaceholderProps` (the core passes them on to layouts and slides that still inherit);
  other edits (text, deeper levels, deleting) show a status message. Slide Master tab: Insert Layout, Delete (unused
  layouts only), Duplicate, Themes ▾ / Colors ▾ / Fonts ▾, Format Background, Background Styles ▾, Hide Background
  Graphics (layouts), Slide Size, Close Master View. Rename, Insert Placeholder, Title / Footers and the text level: see P8-32 below.
- **Header & Footer** (Insert, `ui/DesignDialogs.tsx`): Slide tab – Date and time (update automatically in one of the
  13 formats, or fixed text), Slide number, Footer, Don't show on title slide; Apply (current slide) / Apply to All →
  `SetHeaderFooter`. Notes and Handouts tab – date, header, page number and footer of printed notes pages and handouts
  (stored in the print options). Insert › Slide Number / Date & Time insert a field run at the caret of the text being
  edited (without an editor they open the dialog).
- **Sections** (`design/sections.ts`, slide panel): collapsible headers with the slide count when collapsed; right-click
  → Rename Section… (also right after Home › Add Section), Remove Section, Remove Section & Slides, Remove All Sections,
  Move Section Up / Down, Collapse / Expand All. Dropping a slide on a header or between another section's slides moves
  it there: `MoveSlide` plus `RestoreSections` with the wanted membership in one undo step (the core's `MoveSlide` alone
  joins the section of the slide before). The presenter console's slide strip shows section names.
- **Picture Format tab** (`ui/PictureTab.tsx`, for selected pictures): Corrections ▾ (brightness × contrast −40…+40 %),
  Color ▾ (no recolour, grayscale, sepia, black and white 25 / 50 / 75 %, duotone per accent; transparency 0–80 %),
  Change Picture…, Reset Picture ▾ (picture / picture & size), Picture Styles (ten combinations of outline shape,
  border and shadow), Picture Border (colour, weight), Shadow ▾ (presets), Crop, Alt Text. Previews are the picture with
  the CSS filter. Crop mode (`canvas/CropOverlay.tsx`): the whole image dimmed under a dark veil, the cropped part bright
  in a frame with eight black handles (32 px hit areas, pointer events); Enter or a click outside → `CropPicture` with the
  new box, Esc cancels. Compress Pictures is not offered.

## Show: master and layout editing, picture backgrounds, table styles, preset data (P8-32)

- **Slide Master tab** (`ui/MasterView.tsx`, `design/master.ts`): Rename (also in the panel's context menu: the Rename Layout
  dialog → `RenameLayout`; standard layouts keep their kind and show the name, custom ones become `custom:<name>`), Master
  Layout group: Insert Placeholder ▾ (Content, Picture, Title, Date, Footer, Slide Number → `AddPlaceholder` centred at half
  the slide; date / footer / number / title at the master's position; the master holds one per kind), Title and Footers
  check boxes of a layout (add / remove those placeholders), Text level (All levels, Level 1–9). Delete on a pseudo shape →
  `RemovePlaceholder`. Text formatting of the master's body placeholder goes to the outline level of its sample paragraph
  (`SetMasterTextStyle`; paragraph 1 through `SetMasterPlaceholderProps`), with a chosen Text level only to that level (also
  levels 6–9, which the sample text does not show); Tab / Shift+Tab with the body placeholder selected step the level (status
  message "Formatting applies to text level N"). Layout placeholders keep level 1 only (deeper levels: status message). Typing
  in a pseudo shape stores its text as the placeholder's custom prompt (`SetPlaceholderPrompt`; the sample text again or
  nothing removes it); slides show a layout's custom prompt in empty placeholders, the master view shows it instead of the
  sample text (on the master's body one line per level).
- **Format Background › Picture or texture fill** (`ui/DesignTab.tsx`): Insert… opens a file picker (images only, else a
  status message) → `SetBackgroundPicture` (the core adds the image to the media store) for the current slide / the selected
  master or layout; Tile picture as texture and Transparency (0–100 %) change it (`SetBackground` with the same image).
  Rendering (`canvas/SlideView.tsx`): white, then the image stretched over the slide or as a repeating pattern at its pixel
  size, with its opacity; images of picture backgrounds are fetched like pictures (`getMedia`).
- **Slide size prompt** (`ui/DesignDialogs.tsx`): choosing a size while slides have content asks Maximize (content as large as
  possible, scaled by the larger ratio) or Ensure Fit (the smaller ratio) → `SetSlideSize { scale }`; Cancel keeps the size.
- **Table Design › Table Styles**: the inline gallery shows Medium Style 2 (plain and accents 1–6); More table styles ▾ lists
  all 74 built-ins grouped Light (with No Style, Themed Style 1/2), Medium, Dark (and the presentation's own as Document),
  each preview a 5 × 4 sample drawn with the selected table's options. Names are localized from the family and accent.
  **Layout › Split Cells…**: number of columns and rows for the selected cell (a merged cell starts with its spans; merged
  cells split only into divisors of their spans) → `SplitTableCellGrid`; the context menu keeps Split cells (undo a merge).
- **Lock aspect ratio** (Format Shape › Size) is the shape's `lockAspect` (`SetLockAspect`, saved as `noChangeAspect`);
  corner drags of locked shapes keep their proportions (pictures and media start locked).
- **Last view**: Save sends the current view (`savePptx { lastView }`), stamped into `viewProps.xml` without an undo step;
  files open in it.
- **Shape library**: 110 presets in PowerPoint's groups (Basic shapes with pie, chord, teardrop, frame, half frame, L-shape,
  diagonal stripe, cross, cylinder, cube, bevel, donut, "not allowed", block arc, folded corner, smiley, lightning bolt, sun,
  moon; Block arrows with quad, left-right-up, bent and U-turn arrows; Equation shapes; the whole Flowchart group (28 and
  offline storage); ribbons and waves under Stars and banners; cloud and line callouts). Adjust defaults come from the core
  (`generated/presetInfo.json`).
- **Media in the click sequence** (`anim/playback.ts`, `present/ShowOverlay.tsx`): every clip "In Click Sequence" is a click
  step after the slide's animations (as the core writes the timing); its click starts it, going back stops it.

## Show: charts, links, action buttons, audio/video, Reuse Slides (P8-24)

- **Charts** (`apps/show/src/charts/`, details in [charts.md](charts.md) "Show"): Insert › Chart opens the Insert Chart dialog
  (PowerPoint's type list, sub-type icons and a live preview drawn by the shared renderer); the chart is inserted centred at
  2/3 of the slide with PowerPoint's sample data, selected, and Chart Design is shown. On the slide it is drawn by the
  shared renderer in the presentation's theme colours on a transparent area (editor, thumbnails, presenter, audience
  window, print); it moves and resizes like any shape. Chart Design: Add Chart Element ▾ (one menu, a section per
  element), Quick Layout ▾, Change Colors ▾, Chart Styles ▾ (live previews), Switch Row/Column, Edit Data (an in-app grid:
  row 1 series names, column A categories; Add Series / Add Category, × removes; OK sends `setChartData`), Change Chart
  Type. Format: the series the fill / outline apply to, Format pane (right of the stage), Reset to Match Style, Shape Fill,
  Shape Outline.
- **Links** (`apps/show/src/links/`): Insert › Link / Ctrl+K opens Insert Hyperlink: Web Page or File Address (`www.…` →
  `https://…`, `name@host` → `mailto:`) or Place in This Document (First / Last / Next / Previous / Last Slide Viewed and
  every slide with its thumbnail and title), ScreenTip, Remove Link. With text being edited it links the selection (the
  word at the caret when nothing is selected; the dialog takes the editor's session, which closes); otherwise the
  selected shapes' click action. Insert › Action (Action Settings, Mouse Click): None or Hyperlink to Next / Previous /
  First / Last / Last Slide Viewed / End Show / Slide… / URL…; Run program and Play sound are shown disabled. Linked runs
  are drawn underlined in the theme's hyperlink colour.
- **Action buttons**: the twelve `actionButton*` presets are the Action Buttons group of the shape library (icons drawn from
  the core's paths: the frame, the icon with a darkened fill, outlines); inserting one gives it PowerPoint's default
  action (Back/Forward: previous/next slide, Beginning/Home: first, End: last, Return: last slide viewed).
- **In the slide show** (`present/ShowOverlay.tsx`): a DOM layer over the slide holds an anchor (`target="_blank"`,
  `rel="noopener noreferrer"`, only `http(s)`/`mailto`/`tel`/`ftp`) per web link – the browser opens it, no `window.open`
  (mobile guardrail) – and a button per jump (`linkAction`: go to the slide (if it is in the show), first, last, next,
  previous, the slide shown before, end the show). Regions: the boxes of top-level shapes with a click action and the
  text fragments of linked runs (unrotated boxes). A click on a link does not advance the show.
- **Audio / video** (`apps/show/src/media/`; PowerPoint plays MP4 (H.264/AAC); WebM/Ogg play in the browser only): Insert › Video / Audio pick a file (mp4, webm, ogv / mp3, wav, ogg, m4a;
  other types are refused with a message) → `insertMedia` (video: half the slide at 16:9, centred; audio: a 1.27 cm icon),
  selected, Playback shown. The editor shows the poster frame, else a dark frame with a play button (video) or a speaker
  (audio); print shows the same. Playback: Start (When Clicked On / Automatically / In Click Sequence), Loop until Stopped,
  Hide While Not Playing, Volume ▾ (Low 25 %, Medium 50 %, High, Mute), Poster Frame ▾ (Image from File…, Reset); trimming
  is not offered. In the show each clip is an HTML5 `<video>`/`<audio>` with controls at the shape's place (blob URLs);
  Automatically clips start when the slide appears, In Click Sequence ones play when clicked (they do not join the
  animation click steps), loop, volume and mute as set, hidden while not playing when asked. The deployed CSP needs
  `media-src 'self' blob:` for playback (it currently falls back to `default-src 'self'`).
- **Reuse Slides** (`apps/show/src/reuse/ReusePane.tsx`): New Slide ▾ › Reuse Slides… opens a pane right of the stage:
  Browse… reads another .pptx through the core without opening it (`peekPresentation`), its slides are listed as
  thumbnails in their own design; a click inserts that slide after the current one, Insert All Slides all of them
  (`insertSlides`, one undo step). Keep source formatting copies each used layout as a custom layout; otherwise the
  slide takes this presentation's layout of the same kind (custom layouts: inferred from the placeholders) and its
  placeholders are re-mapped like a layout change. Media are copied (identical ones shared), links to slides that are
  not inserted are dropped.

## Show: views, rulers, guides, Selection pane, text options, slide-show tools (P8-28)

- **Views** (View › Presentation Views; `ShowState.view`; a file opens in its saved `lastView`): *Normal*. *Outline View*
  (`views/OutlinePane.tsx`, `outline.ts`): the left pane lists every slide's number, an icon and its outline – the title
  placeholder, then the body placeholder's paragraphs indented by level – as one text field per slide (first line = title,
  each body paragraph indented by level + 1 tabs). Leaving a field writes the placeholders (`SetTextBody`, old run and
  paragraph formatting kept by index); Tab / Shift+Tab demote / promote the selected lines at once: a body line without
  tabs becomes a new Title and Content slide after this one, a demoted title joins the previous slide's body (the slide is
  removed). *Slide Sorter* (`views/SlideSorter.tsx`, `sorter.ts`): all slides as thumbnails in a grid with section
  headers and the slide's time when it has an After timing; click selects, Ctrl+click toggles, Shift+click a range;
  dragging (pointer events) moves the selection before the slide under the pointer – also into another section or onto a
  section header – as one undo step (`MoveSlide`s + `RestoreSections`); Delete, Ctrl+D, Ctrl+C/X/V, Ctrl+A, the
  thumbnail menu and Slide Show › Hide Slide act on the selection; a zoom slider sets the thumbnail size; double-click or
  Enter opens the slide in Normal. *Notes Page* (`views/NotesPageView.tsx`): the page as printed (portrait 7.5 × 10",
  slide picture in the upper half, the notes editable below; printing's Notes Pages layout is the same). *Reading View*
  (`views/ReadingView.tsx`): the show inside the window with transitions and animations and a status bar (slide x of n,
  Previous, Menu with every slide and End Show, Next, Normal, Slide Sorter, Slide Show); Esc returns to Normal.
- **Rulers, grid, guides** (View › Show, `canvas/guides.ts`, `Rulers.tsx`; stored with the presentation in
  `ViewProps` → `ppt/viewProps.xml`; guides in 1/8 pt, grid / ruler display in a Rusuite extension): *Ruler* – a horizontal and a vertical ruler in inches
  (English UI) or centimetres, counted from the slide centre like PowerPoint's, with the pointer's position marked.
  *Gridlines* (Shift+F9) – a dotted grid; *Grid and Guides…* (View, slide menu): Snap objects to grid, spacing 1/8, 1/6,
  1/5, 1/4, 1/3, 1/2, 1 or 2 cm / in, display grid, display drawing guides, smart guides. *Guides* (Alt+F9) – turning
  them on without any adds the two centre guides; drag a guide to move it (its distance from the centre is shown),
  Ctrl+drag copies it, dragging it off the slide deletes it; right-click: Add Vertical / Horizontal Guide, Delete Guide,
  colour. Every change is one `SetViewProps` (undoable). *Smart guides*: while dragging or resizing, red dashed lines at
  the edges / centres of other shapes and the slide, gap marks for equal spacing between three objects (`equalSpacing`:
  continuing two neighbours' gap or centring between two), snapping within 4 screen px; drawing guides always snap while
  shown; otherwise the box goes to the grid when Snap objects to grid is on (also resize handles); Alt moves freely.
  Arrow keys move by the grid step onto the grid while snapping (else 1 px), Ctrl+arrows always 1 px, Shift+arrows 10 px.
- **Selection & arrange**: Home › Select ▾ / Shape Format › Arrange › *Selection Pane* (`ui/SelectionPane.tsx`,
  `selection.ts`): the slide's shapes top to bottom (group children indented); click selects, Ctrl/Shift+click adds,
  double-click or F2 renames (`SetName`), the eye hides / shows (`SetShapesHidden`; hidden shapes are not drawn in the
  editor, show, thumbnails or print and are saved as `p:cNvPr/@hidden`), Show All / Hide All, ▲ / ▼ and dragging a row by
  its grip reorder (`ZOrder` steps, one undo step). Arrange ▾: order, align (left / centre / right / top / middle /
  bottom), distribute, *Align to Slide* / *Align Selected Objects*, Group / Ungroup / *Regroup* (the last ungrouped
  shapes), Rotate (90° right / left, flips, *More Rotation Options…*). Several selected shapes resize and rotate as one
  box (the Transformer). *Format Shape pane* (`ui/FormatShapePane.tsx`, right of the stage; shape menu Size and
  Position… / Text Options…): Size & Properties – height, width, rotation, lock aspect ratio (for the session; pictures
  locked by default), position from the top-left corner; Text Options › Text Box – vertical alignment, text direction
  (horizontal, rotate all text 90° / 270°, stacked), Do not Autofit / Shrink text on overflow / Resize shape to fit text,
  margins, wrap text in shape, columns (number, spacing) → `SetBodyProps`.
- **Autofit** (`text/autofit.ts`, `text/layout.ts`): Shrink text on overflow computes PowerPoint's steps (line spacing −10
  / −20 %, then the font 92.5 … 25 %) and stores them as `fontScale` / `lineReduction` (written as
  `a:normAutofit/@fontScale`, `@lnSpcReduction`), recomputed when the text is committed, the box is resized or the
  setting changes; the canvas draws the stored scale. Resize shape to fit text grows the box to the text when it is
  committed (horizontal text). The *AutoFit Options* button (`canvas/AutofitButton.tsx`) appears under the selected shape
  while its text overflows or is shrunk: the three choices and the Format pane's text options.
- **Slide-show tools** (`present/ShowTools.tsx`, `tools.ts`; the full-window show): a tool bar in the lower left on
  pointer movement (Previous, Next, Pointer Options ▾, See All Slides, Zoom), laser pointer (Ctrl+L), pen (Ctrl+P),
  highlighter (Ctrl+I) in six colours, eraser (Ctrl+E), arrow (Ctrl+A), E erases the slide's ink, Ctrl+M shows / hides
  ink; ink lives for the session only (never saved). G or − (at 100 %) shows *See all slides*, + / − zoom into the slide
  about the pointer (1.5 … 4 ×), Esc first leaves zoom / see all / the pen. B / W, number + Enter, presenter notes A− / A+,
  timer reset as before. *Set Up Slide Show* (`ui/ViewDialogs.tsx` → `SetShowSettings`, `ppt/presProps.xml`
  `p:showPr`): loop continuously until Esc, show without narration / animation, all slides or from … to …, advance
  manually or using timings (custom shows are not offered). *Rehearse Timings*: the show from the start with a Recording
  bar (next, pause, the slide's time, repeat, total); at the end "keep the new slide timings?" – Yes sets each slide's
  After (whole seconds, `SetTransition`) and Use Timings in one undo step. Hidden slides are skipped (crossed-out number
  in the panel and the sorter).

## Show quality pass (P8-40)

Corrections from the exploratory test ([qa/show-2026-10.md](qa/show-2026-10.md)):
- **Text editing**: while typing in a shape, Ctrl/Cmd combinations reach the shortcut map – Ctrl+B / I / U format the
  selected text, Ctrl+K opens Insert Hyperlink for it (the overlay keeps Tab, arrows, Esc, Ctrl+Enter and
  Ctrl+Shift+> / < for itself).
- **Placeholders**: an empty picture placeholder shows "Picture" centred without a bullet; vertical placeholders
  (Title and Vertical Text, Vertical Title and Text: the layout's `vertical`) draw their text turned 90° like `vert="eaVert"`.
- **Home**: Clipboard › Duplicate is a small button next to Copy and Drawing shows ten quick shapes (two rows of five; the
  rest under More shapes ▾), so the Home tab fits a 1400 px window without collapsing a group; Arrange ▾ › Ungroup is
  enabled only when a group is selected.
- **Ribbon (all apps, `ui-shared`)**: a large button's label wraps at 80 px but is never narrower than its longest word (German
  compounds no longer run into the neighbouring button); menu items stay on one line and menus taller than the window
  scroll; the tab strip scrolls instead of running under the right slot (Present) on narrow windows.
- **Notes Page**: the slide picture's frame is drawn over the picture (all four edges visible).

## Show pre-release fixes (P8-45)

Deferred items of the exploratory test ([qa/show-2026-10.md](qa/show-2026-10.md)):
- **In-place text editor (S-01)** (`canvas/TextOverlay.tsx`, `canvas/richEditor.ts`, `text/editing.ts`): editing a shape's
  or a table cell's text shows it as the slide draws it. The editor is a `contenteditable` over the shape's text rectangle,
  at the slide's px size and scaled with the zoom (rotated with the shape, vertical text turned like the slide); its content
  is rebuilt after every edit from the session's rich body laid out by the slide's own `layoutText` – one block per
  paragraph (the layout's indent, hanging bullet or number from the master's level styles as CSS `::before`, spacing
  before / after, line spacing, alignment), one span per run (font, size, bold, italic, underline, colour, highlight,
  super / subscript, hyperlinks) and the shrink-on-overflow scale computed live, so the text does not move when editing
  starts or ends (an empty bulleted paragraph shows its bullet while editing, like PowerPoint). Typing, Enter, Backspace /
  Delete (also by word), paste (plain text, lines become paragraphs) and cut arrive as `beforeinput` / clipboard events and
  splice the rich body: typed text takes the formatting of the run before the caret (a paragraph's first run at its start;
  an empty paragraph keeps the formatting of the text it had), fields are never continued and links only inside them;
  Enter's new paragraph keeps the level, bullet and alignment. IME composition is left to the browser and read back when it
  ends. Tab / Shift+Tab change the level, Ctrl+Shift+> / < the font size, Ctrl+Z / Ctrl+Y undo and redo the typing of the
  session; Ctrl+B / I / U / K go to the shortcut map as before. The session's body goes to the core as one `SetTextBody`
  (ADR 0008; no ProseMirror). Not covered: tabs inside a paragraph (Tab always changes the level), the slide number field
  shows its stored text while editing. (Shift+Enter inserts a line break since P9-S1.)
- **Insert › Text box (S-14)** arms drawing like Shapes (the button stays pressed; a second click disarms it): a click on
  the slide inserts a text box of the default size with its top-left at the click, a drag draws it; the editor opens in it.
  Activated with Enter / Space it inserts at once in the slide centre (keyboard).
- **Combo charts (S-10)**: the shared renderer (`packages/ui-shared/src/chart/layout.ts`) draws the series in Excel's /
  PowerPoint's z-order – areas at the back, then bars / columns, then lines, then scatter – so Stacked Area – Clustered
  Column shows its columns in front of the area (hit testing follows: a click on a column picks the column).
- **Transition defaults (S-17)**: a transition chosen in the gallery starts with PowerPoint's Effect Options – Push From
  Bottom (saved `dir="u"`), Split Vertical Out (`orient="vert"`), Zoom In (`dir="in"`); Wipe and Cover From Right (the
  format's default). A transition read from a file without a direction keeps the format's default (`TransitionKind::
  default_direction`).
- **Picture › Color previews (S-18)**: duotone and sepia previews are exact (an SVG `feColorMatrix` equal to the pixel
  pipeline), so each duotone shows its accent colour.
- **Group names (S-19)**: a new group is named "Group N" with N one more than the largest number in the slide's shape
  names (as PowerPoint), not after its id.

## Show: rich in-place text, autofit text boxes, master text levels (P9-S1)

- **Line breaks**: Shift+Enter in the in-place editor breaks the line inside the paragraph (`a:br`; U+000B in the
  editor's text, `\n` in the run as the reader stores it); Enter starts a new paragraph with the same level, bullet,
  alignment and spacing. The slide's layout and the editor break the line at it; copy writes it as a newline.
- **Keys while editing**: Ctrl+A selects the shape's text (not the slide's shapes), Ctrl+] / Ctrl+[ and
  Ctrl+Shift+> / < step the selection's font size from the caret run's size at its level; formatting from the ribbon or
  Ctrl+B / I / U applies to the selection at once (the selection is taken from the DOM before the shortcut runs, so a
  quick Shift+→ then Ctrl+B formats exactly what is selected). Each formatting change is its own undo step; typing stays
  one step per session.
- **Insert › Text box**: a click inserts a one-line box 2.5 cm wide that does not wrap (`wrap="none"`) and grows in width
  while typing; a drag draws a box of the dragged width whose height fits the text. Both resize to fit (`spAutoFit`): the
  editor's frame follows the text live and the commit stores the fitted box (grows and shrinks). Format Shape › Text box
  offers Do not autofit / Shrink text on overflow / Resize shape to fit text; placeholders shrink on overflow
  (`normAutofit` with the computed `fontScale`).
- **Prompt text** ("Click to add title"): drawn on the stage in the layout placeholder's formatting (size, font, colour,
  alignment, bullet; no longer faded); an empty placeholder in edit mode keeps the prompt under the caret until the first
  keystroke. Never drawn in the slide show, print or export.
- **Shape style text colour**: filled shapes from the Shapes gallery draw their text white (the shape's `textColor`,
  written as `p:style/a:fontRef` with `bg1`); a run's own colour wins. Imported `fontRef` colours stay on the shape.
- **Master and layout text**: the Slide Master view's placeholders are edited with the same in-place editor. Formatting
  of a deeper sample paragraph of a layout's body, chart, table or picture placeholder (or of the Slide Master › Text level
  chosen for a layout) goes to that level of the layout placeholder's own list style (`SetMasterPlaceholderProps` with
  `level`; on the master: the master text style of the placeholder's class). Slides re-render from the changed master /
  layout at once.
- **Indents per level**: the text layout uses each level's `marL` / `indent` from the master text style and the layout's
  own levels: the bullet hangs at `marL + indent`, the text starts at `marL` (a wider bullet pushes it on); a paragraph
  without a bullet in a hanging level starts where the bullet would; a positive `indent` indents the first line. Text
  boxes use the "other" style (0.5" per level). The core sets margins with `SetMasterTextStyle` / `SetMasterPlaceholderProps`
  (`marginLeft`, `indent`); there is no Paragraph dialog for them yet.
- **Insert Placeholder** adds Chart and Table (`p:ph type="chart"` / `"tbl"`, prompts "Click icon to add chart / table")
  next to Content, Picture, Title and the footers; Rename and delete work as before.

## Show: tables and shapes round 2 (P9-S2)

- **Table styles** follow PowerPoint's own `a:tblStyle` definitions (border weights, double total-row lines, tints,
  shades and alpha fills, the Themed styles' table background, the corner cells; see `ooxml-subset.md`, "Table
  styles"). **Table Design › Table Styles**: the inline gallery is PowerPoint's *Best Match for Document* row (every
  family drawn in the theme's Accent 1: Themed Style 1 / 2, Light 1–3, Medium 1–4, Dark 1 and Dark 2 – Accent 1/Accent 2);
  ▾ More shows Best Match, Light (No Style, Themed and Light styles), Medium and Dark. Resting the pointer on a style (or
  focusing it) previews it on the selected table; leaving the gallery ends the preview. **Clear Table** removes the style
  and the cells' own fills and borders. The Table Style Options check boxes set `TableLook`; saved files reference the
  style id (`a:tableStyleId`) and write only the cells' own fills and borders.
- **Draw Borders** group (Table Design): Pen Style (solid, dashed, dotted), Pen Weight (¼–6 pt) and Pen Color set the pen;
  **Borders ▾** has PowerPoint's twelve options (No Border, All, Outside, Inside, Top, Bottom, Left, Right, Inside
  Horizontal / Vertical, Diagonal Down / Up) and draws them with the pen on the selected cells (No Border also removes
  the diagonals).
- **Layout** (table): Text Direction ▾ (Horizontal, Rotate all text 90° / 270°, Stacked; `a:tcPr/@vert`, drawn rotated or
  one character per line), Cell Margins ▾ Normal / None / Narrow / Wide / **Custom Margins…** (the *Cell Text Layout*
  dialog: vertical alignment, text direction, the four internal margins in cm or inches), Merge, Split Cells…,
  Distribute Rows / Columns, Align Top / Middle / Bottom as before.
- **Format Shape pane** for a selected table: a *Table Cells* page (fill: automatic from the style, no fill or a colour;
  a border side — all, outside, top … diagonals — with its style, weight and colour) and *Text Options* for the cells
  (vertical alignment, text direction, margins). They act on the cell selection (else the whole table).
- **Resize grips** of columns and rows are 32 px wide hit targets (the line stays thin); a tap on a grip without dragging
  edits the cell under it.
- **Freeform: Shape / Scribble** (Insert › Shapes › Lines): Freeform — each click adds a corner joined by a straight
  segment, dragging draws freehand (smoothed into curves), a click on the start point closes and fills the shape,
  double-click, Enter or Esc ends it open; Scribble — one drag, released ends it. Saved as `a:custGeom` in the shape's
  box; open drawings are lines in the accent colour, closed ones get the accent fill.
- **Edit Points** (Shape Format › Insert Shapes, the shape's context menu): the outline's vertices as black squares;
  drag one to move it (its curve handles move along), Ctrl+click a vertex to delete it, Ctrl+click the outline to add
  one; right-click a vertex: Delete Point, Smooth Point, Straight / Curved Segment, Open / Close Path, Exit Edit Points
  (on the outline: Add Point). A preset becomes a custom geometry at the first edit (as in PowerPoint); the box follows
  the points. Esc or another selection ends it.
- **Shape library**: all 177 non-connector presets of ECMA-376; the gallery shows PowerPoint's (new: snipped / rounded
  diagonal rectangles, heptagon, decagon, dodecagon, plaque, arc, brackets and braces, left-up / bent-up / curved /
  striped / notched arrows, the seven arrow callouts, circular arrow, explosions, stars with 7–32 points, curved ribbons,
  scrolls, line callouts 3 and the accent-bar / no-border variants) with their adjust handles.
- **Adjust handles by keyboard**: with one shape selected, Tab / Shift+Tab focus its handles in turn (a blue ring; after
  the last one the shape again), the arrow keys move the focused handle like a drag (Shift: 10 px), Esc leaves it. The
  handles, text rectangle and outline come from the core (`shapePaths`).
- **Connectors** reroute after every move of a glued shape (drag, keyboard, Align / Distribute, Format pane), with
  PowerPoint's 1–4-turn elbow routes: through the middle of the gap between facing sites, detours around the end shape
  when it lies behind the start, and around overlapping boxes.

## Show: views and design round 2 (P9-S3)

- **Outline View** edits rich text: each slide is one editable block of lines (title, then the body paragraphs indented
  by level) whose runs keep their bold, italic, underline, colour and font. Ctrl+B / I / U toggle the selection's
  formatting; Tab / Shift+Tab (also Alt+Shift+→ / ←) demote / promote the selected lines – a demoted title joins the
  previous slide's body and its slide goes, a promoted body line starts a new slide, Enter after a title starts a new
  slide (structure changes apply at once, text when the slide's block is left); Alt+Shift+↑ / ↓ move lines. The ▭ icon
  (or Alt+Shift+− / +) collapses / expands a slide to its title; Alt+Shift+1 / 9 collapse / expand all. The context
  menu has Promote, Demote, Collapse, Expand, Collapse All, Expand All and **Show Text Formatting** (off: plain text
  with bold titles; on: the runs' formatting at a reduced size).
- **Slide Sorter**: the Transitions tab (gallery, Effect Options, duration, On Mouse Click / After) changes every
  selected slide (Ctrl / Shift+click several; also with several thumbnails selected in the Normal view); section
  headers collapse on click and have the section menu; Ctrl+↑ / Ctrl+↓ move the selection one place, into the
  neighbouring section at a section border (also in the thumbnail pane); the zoom slider is saved with the file.
- **Sections**: Home › Section ▾ (Add Section, Rename Section…, Remove Section, Remove All Sections, Collapse All,
  Expand All) besides the header menus; collapsing is shared by the thumbnail pane and the sorter.
- **Custom shows**: Slide Show › Custom Slide Show ▾ lists the custom shows (a click starts one) and **Custom Shows…**:
  New / Edit (Define Custom Show: name, the deck's slides with check boxes, Add », the show's slides with ↑ / ✕ / ↓,
  a slide may appear twice), Remove, Copy, Show. Saved as `p:custShowLst`. Insert › Link (Place in This Document) and
  Insert › Action (Hyperlink to › Custom Show…) link to a custom show, with **Show and return** – the show goes back to
  the slide of the link when the custom show ends.
- **Set Up Slide Show**: Show type (presented by a speaker, browsed by an individual with Show scrollbar, browsed at a
  kiosk – loops and uses timings), Show slides (All, From … To …, Custom show), Show options (loop, without narration,
  without animation, **Pen color**, the slide show's ink default), Advance slides. F5 runs the chosen custom show.
- **Format Background** pane: Solid fill; **Gradient fill** – 30 preset gradients (light, top spotlight, medium, bottom
  spotlight, radial × the six accents), Type (linear, radial, rectangular, path), Angle, the stops on a bar (select,
  Add / Remove stop, colour, position, transparency); **Picture or texture fill** – Insert…, Transparency, Tile picture
  as texture with Offset X / Y and Scale X / Y, else Offset left / right / top / bottom; **Pattern fill** – PowerPoint's
  48 patterns with foreground and background colour; Hide background graphics; **Apply to All** puts the background
  on the slide master (new slides get it too) and removes the layouts' and slides' own; Reset Background. Gradients
  and patterns are stored on the slide (`p:bg`) or, in the master view, on the master / layout.
- **Design › Variants › Effects ▾**: effect schemes (the theme's subtle / moderate / intense effect styles,
  `a:effectStyleLst`); shapes whose style refers to an effect style (`a:effectRef`, kept from files) draw its shadow.
  **Background Styles ▾** keeps PowerPoint's 12 styles (3 background fill styles × 4 colours, `p:bgRef` on the master).
- **Slide Size** with content: Maximize and Ensure Fit scale the master's and layouts' placeholders and shapes with the
  same factor about the centre as the slides' shapes (Maximize: the larger ratio, content may overflow; Ensure Fit:
  the smaller).
- **Guides of masters and layouts**: in the Slide Master view the guides commands (Add Vertical / Horizontal Guide,
  drag, Ctrl+drag copies, off the slide deletes, colour) act on the selected master or layout (orange, as in
  PowerPoint; saved as `p15:sldGuideLst`); on slides they are drawn under the slide's own guides, not draggable, and
  shapes snap to them.
- **Window state saved with the file** (`viewProps.xml`): the last view, the Normal view zoom (Fit or a percentage),
  the Slide Sorter zoom, the width of the thumbnail pane (drag its edge, or ← / → on it) and whether the notes pane
  shows; Save stamps them without an undo step, opening restores them.
- **Print** (Show): the range field is **Slides** by number (`1-3, 5, 8-`; hidden slides keep their numbers), and with
  sections a **Section** choice prints one section; File › Export PDF… uses the same choice.

## Show: animations, transitions and media round 2 (P9-S4)

- **Animation gallery** (Animations › Animation styles / Add Animation): Entrance, Emphasis, Exit and **Motion Paths**
  sections like PowerPoint's – entrance / exit Appear, Fade, Fly In, **Float In** (Float Out), **Split**, Wipe,
  **Shape** (circle, box, diamond, plus in Effect Options), **Wheel**, **Random Bars**, **Grow & Turn** (Shrink & Turn),
  Zoom, **Swivel**, **Bounce**; emphasis **Pulse, Color Pulse, Teeter**, Spin, Grow/Shrink, **Desaturate, Darken,
  Lighten, Transparency, Object / Line / Fill / Brush / Font Color, Underline, Bold Flash, Bold Reveal, Wave**; motion
  paths **Lines, Arcs, Turns, Shapes, Loops, Custom Path**; with an audio / video clip selected also **Media › Play,
  Pause, Stop**. **Effect Options** shows what the effect has: Direction, the four Shapes, Spokes (1, 2, 3, 4, 8),
  Spin direction and amount (quarter … two spins), Grow/Shrink size (tiny 25 % … huge 400 %), Transparency (25–100 %),
  the ten standard colours, **Sequence** for shapes with text (As One Object, All at Once, **By Paragraph**), Edit
  Points / **Reverse Path Direction** for paths, and **More Effect Options…** (the dialog below).
- **Custom Path**: chosen in the gallery, the stage takes a drag (crosshair; Esc cancels) – the drawn line becomes the
  path from the shape's centre. While the Animations tab or the pane is shown, every motion path of the slide is drawn
  dotted from its shape (green start, red end); the selected one shows its vertices as handles – a drag moves a vertex
  (Bézier handles move along) and saves the whole path.
- **Trigger ▾**: In the Click Sequence, On Click of any shape of the slide, On Bookmark of a clip's bookmarks.
  Triggered animations form their own sequences: the pane lists them under "Trigger: <shape / bookmark>", their numbers
  count per trigger; in the show a click on the trigger shape plays its next step (it does not advance the slide), a
  clip passing its bookmark plays the bookmark's animations.
- **Animation Painter**: a click copies the selected shape's animations onto the next shape clicked (replacing that
  shape's); a double-click keeps it armed for several shapes until it is clicked again or Esc.
- **Timing**: Start, **Duration** and **Delay** spinners with PowerPoint's limits (0.01–59 s and 0–59 s; the arrows step
  by 0.25 s), **Timing…** opens the dialog. **Move Earlier / Later** use PowerPoint's semantics: an On Click animation
  moves together with the With / After Previous animations of its step past the whole neighbouring step; a With / After
  Previous animation swaps with its neighbour row and keeps its Start (so it joins the step it lands in); triggered
  animations move within their trigger's sequence.
- **Effect Options / Timing / Text Animation dialog**: Effect (animate text all at once, by word, by letter with the %
  delay between; Auto-reverse for emphasis and paths), Timing (Start, Delay, Duration, **Repeat** none / 2 / 3 / 4 / 5 /
  10 / Until Next Click / Until End of Slide, **Rewind when done playing**, Triggers), Text Animation (Group text as one
  object, all paragraphs at once, by 1st … 5th level paragraphs, **Animate attached shape**, **In reverse order**).
- **Paragraph builds in the show**: every paragraph up to the chosen level starts a click step (deeper paragraphs come
  with their parent; empty paragraphs are skipped; With / After Previous builds play their steps one after the other);
  the shape stays visible while its text comes, unless "Animate attached shape" is on.
- **Transitions gallery**: the eight classic kinds inline, **More transitions** with every kind under Subtle (None,
  Morph, Fade, Push, Wipe, Split, Reveal, Cut, Cover, Shred, Zoom) and Exciting (Fall Over, Drape, Curtains, Wind,
  Prestige, Fracture, Crush, Peel Off, Page Curl, Airplane, Origami, Honeycomb, Glitter, Vortex, Ripple, Switch, Flip,
  Gallery, Cube, Doors, Box). Effect Options list each kind's directions and variants (Glitter diamonds / hexagons,
  Shred strips / particles, Reveal smoothly / through black, Page Curl double / single, Morph objects / words /
  characters); a kind chosen in the gallery starts with PowerPoint's pick (Push From Bottom, Split Vertical Out, Zoom
  In, Switch and Flip Right, the others the file format's default). **Sound ▾**: [No Sound], [Stop Previous Sound],
  Other Sound… (a wav / mp3 / ogg file), Loop Until Next Sound; Apply To All copies the sound too.
- **Transitions in the show** play only when the show moves **forward** to a slide (Next, a link or number + Enter to a
  later slide); going back or jumping to an earlier slide shows it at once, as PowerPoint does. The transition's sound
  starts with it (and stops the previous one; looping sounds play until the next sound or the end of the show).
  How the PowerPoint 2010+ transitions are drawn (two slide pictures, Web Animations): Morph – a fade; Reveal – the old
  slide slides off and fades (through black: darkens first); Shred – the old slide blurs and squeezes out, the new one
  opens from the centre (out) or fades in under it; Fall Over – the old slide tips over its bottom edge; Drape – the old
  slide is pulled aside with a skew; Curtains – the old slide opens from the middle; Wind – the old slide blows away
  skewed, the new one drifts in; Prestige – the old slide tilts back and falls, the new one rises tilted; Fracture – the
  old slide shrinks to a jagged polygon; Crush – the old slide shrinks and turns away; Peel Off and Page Curl – the old
  slide turns about its side edge (Page Curl single: about a corner); Airplane – the old slide flies up and away small;
  Origami – the old slide folds away about its vertical axis; Honeycomb – the new slide opens as a growing hexagon;
  Glitter – the new slide sparkles in (high contrast, from the side); Vortex – the new slide spins in from a blur, the
  old one spins out small; Ripple – the new slide opens as a growing circle; Switch – both slides swing about the
  vertical axis; Flip – the slides turn like a card; Gallery – the slides pass by side by side; Cube and Box – the new
  face turns in about the side the motion comes from; Doors – the old slide opens like two doors in the middle.
- **How the new effects are drawn** (Konva): Float rises (falls) by a tenth of the slide while fading; Split, Shape,
  Wheel and Random Bars reveal the shape through a clip mask (Shape In closes from the edges, Out grows from the
  centre; Random Bars use 24 bars in a fixed shuffled order); Grow & Turn grows from nothing turning 90°; Zoom Slide
  Center comes from the middle of the slide; Swivel turns about its vertical (horizontal) axis; Bounce drops in from a
  quarter of the slide; Pulse grows by 5 % and back; Color Pulse, Object / Fill / Line / Font / Brush Color blend the
  fill, outline or text colour; Teeter rocks ±4°; Desaturate, Darken, Lighten are Konva HSL / Brighten filters; Wave
  lifts the shape by 5 % of the slide and back; Underline / Bold Flash / Bold Reveal change the text's style. Paragraph
  steps move and fade the text of their paragraphs (shaped reveals fade). By Letter / By Word lengthen the effect by the
  letters' delays (the shape animates as one; letters are not drawn one by one). Emphasis and motion paths built by
  paragraph play on the whole shape at each step. Repeat Until Next Click / Until End of Slide keep the effect looping
  until the show moves on.
- **Playback tab** (audio / video): **Bookmarks** (Add Bookmark at a time mm:ss.fff – named "Bookmark N" like
  PowerPoint, Remove Bookmark ▾), **Editing** (**Trim Video / Trim Audio…**: a preview that plays the trimmed part,
  Start Time and End Time; Fade In / Fade Out spinners), Start, **Play Across Slides**, Loop until Stopped, Hide While
  Not Playing, **Rewind after Playing**, Volume, Poster Frame. In the show a clip plays from its trimmed start, stops
  (or loops) at its trimmed end, fades its volume in and out, fires its bookmarks' triggers when it passes them,
  rewinds to the start when set, and – Play Across Slides – keeps sounding when the show moves on, until the show ends;
  Play / Pause / Stop animations control it in the click sequence.
- **Print and PDF export** print each slide as in the Normal view (PowerPoint's print behaviour): every shape, whatever
  its entrance or exit animation, no emphasis colours or motion-path positions; audio and video as their poster frame
  (or the placeholder).
- The Animation pane: triggered animations under their trigger heading, ¶ marks a paragraph build, ⚙ opens the Timing
  dialog, Move Earlier / Later as above.

## Printing (P7-9)

**File › Print** (Ctrl+P) is the Office print page: on the left the **Print** button, a note that copies, printer and
two-sided printing are chosen in the system print dialog (where "Save as PDF" makes a PDF), and the settings; on the right
the **preview** with page navigation and the page count. **File › Export PDF…** is a secondary entry: the same pipeline with
the current settings, straight to the system dialog (desktop and browser alike: pick "Save as PDF" there).

- **Pipeline** (`packages/ui-shared/src/print.ts`): each app builds a `PrintDoc` – one HTML string per page, every page laid
  out on the whole sheet (margins are padding; `@page { size: W H; margin: 0 }`), so the preview's page count is the printed
  one. The preview shows it in an `<iframe srcdoc>` (`print/PrintPreview.tsx`, sandboxed without scripts); printing mounts
  it as `#rusuite-print-root`, the only visible element under `@media print`, then calls `Backend.print()`
  (`printDocument`). Page ranges (`All` / `1-3,5`, `7-`, `-2`) drop the pages outside the range (`parsePageRange`,
  `applyPageRange`). The settings component is `PrintPanel` with `PrintSelect`/`PrintCheck`/`PrintNumber`/`PrintText`,
  the document is built by `usePrintDoc(build)` (debounced, stale builds dropped).
- **Calc** (`apps/calc/src/print`): active sheet / entire workbook (every sheet from a new page, `&P`/`&N` over the whole
  printout) / selection; orientation, paper A4/Letter/Legal/A3, Excel margin presets, scaling (100 %, custom %, fit sheet on
  one page, fit all columns, fit all rows); wide sheets paginate into page columns, ordered down, then over; gridlines, row
  and column headings, rows to repeat at the top; header and footer as left/center/right slots with `&P &N &D &T &A &F`. Merged
  cells print as one cell (`colspan`/`rowspan`, cut at page breaks).
- **Write** (`apps/write/src/print`): the print layout's pages (P8-31): every fragment of a page is a slice of a cloned
  block cut between two lines, plus repeated table headers and the page's footnotes – with the document's own page setup
  at 100 % the pages are the editor's pages; overrides for paper, orientation, margins and a content scale measure the
  clones at the printed width and paginate them with the same engine; headers/footers with `{PAGE}` on every page.
- **Show** (`apps/show/src/print`): slide pictures from the editor's `SlideView` on off-screen Konva stages (cached per
  slide); layouts full-page slides (paper "Slide size" or a paper size), notes pages (slide + speaker notes), handouts with
  2/3/4/6 numbered, framed slides per page (3: with note lines); frame slides, scale to fit (or a percentage), print hidden
  slides.

**Desktop** (`print_webview` in each `src-tauri/src/lib.rs`, used by `TauriBackend.print()`, falling back to
`window.print()`): `tauri::WebviewWindow::print()` exists in Tauri 2.12 (desktop only; its doc comment says "only supported
on macOS", but wry implements all three):
- **Linux (WebKitGTK)**: `webkit2gtk::PrintOperation::run_dialog` – the GTK print dialog (printers, "Print to File" as PDF/PS,
  copies, page setup). The command is synchronous, so it runs on the main thread and returns when the dialog closes; WebKitGTK
  does not reliably fire `afterprint`, so the print root stays mounted for 60 s (`DESKTOP_PRINT_KEEP_MS`) or until the next
  print, in case the pages are rendered after the dialog returned.
- **macOS (WKWebView)**: `NSPrintOperation` (macOS 11+) with the system print panel, whose PDF menu saves a PDF.
- **Windows (WebView2)**: wry evaluates `window.print()` – Chromium's print preview dialog with "Save as PDF".
## Logos and the portal (P7-10)

One family in `apps/portal/logos/` (hand-written SVG, 1024 viewBox): a full-bleed rounded tile (`rx` 225 = 22 %) in the app's
dark tone, a glyph inside the 512 px live area (256–768) built from rounded rects (`rx` 40, 96–112 px bars), the app's light
tone for the glyph and white for its one "active" element.

| Logo | Tile / light tone | Glyph |
| --- | --- | --- |
| `calc.svg` | `#1E7A46` / `#2DA866` | 2×2 cells, the selected cell white |
| `write.svg` | `#1F4E9A` / `#3B7DD8` | three text lines, the short heading line white |
| `show.svg` | `#C2410C` / `#F0763A` | 16:9 slide on a stand, white play triangle |
| `rusuite.svg` | `#1E293B` | three slanted bars in the three light tones |

`<name>-mono.svg` replaces the light tone with white at 55 % opacity (one hue plus white); they are the favicons (inlined as
data URIs in `apps/*/index.html`, `logos/rusuite-mono.svg` for the portal). `<name>.png` are 1024 px exports
(`rsvg-convert`, see docs/setup.md), the source of the Tauri icons in `apps/*/src-tauri/icons/`.

The portal (`apps/portal/index.html` + `styles.css`, no build step, ~12 KB with the SVGs) is the site root: header with the
mark and the one-line pitch, a card per app (logo, name, one sentence, "Open … in browser" in the app colour, "Desktop
downloads" → GitHub releases), footer with the alpha note, the repo link and the build from `/version.json`. Light/dark via
`prefers-color-scheme`, system fonts, no external requests. An **EN / DE** switch (top right, `apps/portal/i18n.js` + `apps/portal/locales/`) translates the page
and stores the choice where the apps read it; since P8-47 the header shows the text wordmark "rusuit.es" (system fonts; "rusuit" in the Write blue, ".es" in the Show orange; h1 with accessible name "Rusuite"), the hero carries the free/open-source statement (MIT, no accounts, no tracking), an "Open source" section follows the cards, and every page has `<link rel="canonical" href="https://rusuit.es/…">`; a German browser gets German by default (P7-11).

## Privacy (P7-12, ADR 0009)

- nginx sends a `Content-Security-Policy` (`connect-src 'self'`, no third-party origins; `style-src 'unsafe-inline'` stays because React `style` props and the print preview `srcdoc` need it), `Referrer-Policy: no-referrer` and a minimal `Permissions-Policy`. The policy is defined once in `deploy/nginx/rusuit.es.conf`; the `$csp_connect` line is the single place for future provider origins (`docs/cloud-connectors-plan.md`). `packages/e2e/serve.mjs` reads the same policy, so the local e2e run enforces it too. Pages must not use inline scripts (the portal's version script is `version.js`).
- `scripts/privacy-check.sh` (CI) rejects `fetch(`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`, `EventSource`, `navigator.share` outside the portal's `version.js`/`i18n.js`, and HTTP clients in `apps/*/src-tauri/Cargo.toml`.
- e2e `privacy.spec.ts` records all requests of each app while opening, editing, autosaving and saving and asserts they are the page's own static files; it also covers the Privacy entry (EN/DE; `PRIVACY_SHOTS=<dir>` saves screenshots).
- The portal says it in one sentence and links `privacy.html`.

## Report a problem (P8-43)

The one server endpoint of Rusuite (ADR 0009 amendment "Report a problem"): the dialog posts to the site's relay
(`POST /api/report`, `services/report-relay`), which creates a **public** GitHub issue. Code:
`packages/ui-shared/src/report` (`reportProblem` controller per window, dialog, `client.ts` – the only `fetch`, in the
privacy-check allow-list, reachable only from the controller's `submit`).

- **Entry points**: the **?** Help menu at the right end of the ribbon's tab strip (all apps; `HelpMenu` in the
  ribbon's `rightSlot`, items Report a problem… and Keyboard shortcuts – in the strip rather than a Home group, so
  no tab panel loses width and no group collapses because of it) and File › **Report a problem…** (backstage, under
  Options…). The backstage mounts the dialog (`ReportOverlay`, attached to the session's backend).
- **Dialog**: Type (Bug / Feature request / Question), Title (≤ 120, counter), Description (20–4000, a placeholder per
  type), Steps to reproduce (bugs only); Screenshots: Add screenshot… (PNG/JPEG, ≤ 3, 2 MB each, 5 MB together;
  thumbnail, Remove) and Capture this window (`html-to-image`, the dialog excluded; JPEG fallback over 2 MB; the note
  says it includes the visible document content); "Include diagnostics" (on) with "Show exactly what is sent" – the
  JSON taken when the dialog opened (user agent, viewport, `docStats` counts – Calc cells of the active sheet, Write
  blocks, Show slides –, the last uncaught error message), sent unchanged; the amber notice "Your report, including
  screenshots, will be posted publicly at github.com/refaustria/rusuite/issues. Do not include confidential
  content." with **I understand** (required: Submit is disabled without it). Submit → "Sending…" → success card
  "Thank you! Your report is issue #N." with **Open the issue on GitHub** (an `<a target="_blank">`), the
  screenshots-not-attached warning when the relay says so, and "You can send another report in 60 min."
- **Errors**: 429 "Too many reports – you can send another report in N min." (Submit disabled until then), offline,
  relay unreachable, 502 "GitHub did not accept the report – try again later.", 413, 400 with the relay's message.
  The fields stay filled after an error (also when the dialog is closed and reopened); a sent report clears them.
- **Who sends**: app and version from `Backend.ping()`, platform (web/desktop), OS name, UI language, and
  `instanceId` – a random v4 UUID made once in `localStorage` `rusuite.report.instance` (desktop: the webview's storage
  in the app data directory; never from hardware). The client gate (`rusuite.report.nextAllowedAt`) allows one report
  per hour; the relay enforces the same limit. URL: web `/api/report` (same origin, CSP unchanged); desktop
  `REPORT_RELAY_URL` at build time (Vite `envPrefix`), default `https://rusuit.es/api/report`.
- **Privacy**: nothing is sent before Submit (e2e `report.spec.ts` audits the requests); the payload has no document
  content (the relay also refuses unknown fields); File › Home › Privacy has the paragraph `privacy.report`; the portal's
  privacy page has a "Reporting a problem" section.

## Show: presenter view, rehearsal and reuse round 2 (P9-S5)

- **Presenter view** (Alt+F5, View › Presenter view): the **speaker notes are editable** (the text is saved to the deck
  when the field loses focus or the slide changes, one undo step per edit; show keys do not apply while typing, Esc
  leaves the field). The header has the total time with **Pause timer / Resume timer** and **Reset timer**, and the
  **time on the current slide** (it starts again on every slide and stops while paused). Buttons below the slide:
  Previous, Next, **Black screen, White screen** (B / W), the pointer menu (laser pointer, pen, highlighter, eraser,
  arrow, six ink colours, erase all, show / hide ink), **See all slides** (G), **Zoom** (+ / −) and, on the desktop,
  **Swap displays** (the presenter view and the slide show change monitors). Ink, the laser pointer and the zoom are
  drawn on the slide show window too.
- **Keep ink annotations?** At the end of a show (single window or presenter view) with ink: Keep turns every stroke
  into a freeform named "Ink N" on its slide (pen ink on top; highlighter ink below the slide's shapes, because the
  model's outlines have no transparency – it marks the text from behind), one undo step; Discard drops it. PowerPoint
  writes ink as `p14:contentPart` ink parts (InkML); Rusuite writes freeforms (`a:custGeom`), which PowerPoint,
  LibreOffice and older Office versions all show and edit.
- **Slide Show › Monitor: <name> ▾** (Monitors group): Automatic (a screen other than the presenter view's; with one
  screen a normal window), Primary Monitor, or one of the screens; the choice is remembered. The desktop app lists the
  monitors from the shell and opens the slide show window full screen on the chosen one. In the browser **Detect
  screens…** asks for the Window Management permission and lists the screens; the slide show window then opens on the
  chosen screen. When the browser blocks the window, the Presentation API (a second display or a cast target) is tried
  before falling back to the single-window show with the notes overlay.
- **Slide Show › Record ▾** (From Current Slide… / From Beginning…): a rehearsal with the pen at hand; at the end the
  slide timings (Use Timings on) and the ink are saved without asking. Narration (audio, camera) is not recorded.
  **Rehearse Timings** keeps PowerPoint's Recording tool bar (Next, Pause, the slide's time, Repeat, the total) and its
  closing question; the timings are saved as `advTm` (whole seconds) and Use Timings is turned on.
- **Set Up group**: PowerPoint's **Play Narrations**, **Use Timings** and **Show Media Controls** check boxes (Loop
  until Esc stays in Set Up Slide Show). Without media controls the clips in the show have no play bar.
- **Reuse Slides › Keep source formatting** brings the source slide's master with its theme and all its layouts as a
  further design of the presentation (shared when the same master is reused again; the presentation's own design when
  it is the same); the slides keep their layouts on it, the thumbnails and the show draw them with that design, and the
  file has one more `p:sldMasterId`. Without it ("Use destination theme") slides take this presentation's layout of the
  same kind and name. Limits: the layout galleries and the Slide Master view show the main design only; a slide of a
  further design changes layout among its own design's layouts.
- **Design › More themes ▾ › Browse for Themes…** reads a `.thmx`, `.potx` or `.pptx` and applies its design to all
  slides: the theme, the master and its layouts replace the presentation's (scaled to the slide size – a `.thmx` counts
  as made for 16:9, a template has its own size; further designs go), every slide moves to
  the new layout of its kind (custom layouts: by name, else inferred from the placeholders), one undo step. **Save
  Current Theme…** writes the theme, master and layouts as a `.thmx` (the desktop app asks where; the browser downloads
  it) – it never becomes the document's file.
- **Slide Master › Insert Placeholder ▾** has **Text** (a text-only body placeholder, `type="body"`) beside Content.
  Empty placeholders prompt per type ("Click to add text", "Click icon to add picture", chart, table). Empty **picture
  placeholders** show an **Insert Picture** icon on the stage: the picked image fills the placeholder (cropped to its
  proportions, centred), stays a placeholder of the layout and keeps its z-order. (Content placeholders keep their
  text click target; the core's `insertPicture` accepts them too.)
- **Date fields** (Insert › Date & Time with Update automatically, the footers' date) are saved showing the current
  date and time in the UI language, as PowerPoint writes them; the document keeps its stored text.
- Files: non-standard colour maps of masters (`p:clrMap`, e.g. dark masters with `bg1="dk1"`) and slides
  (`p:clrMapOvr`) are honoured when colours are read and written; LibreOffice masters without a size in their footer
  list styles take it from their runs; picture shapes keep their adjust values (rounded corners …).
- Already present before P9-S5: Rehearse Timings with its tool bar and question, the slide-show tools (pointer
  options, ink, See all slides, magnifier) in the single-window show, the combo chart z-order (areas behind columns,
  P8-45) and the shared chart presets (Show imports the ui-shared chart preset module directly; re-exporting it from
  the ui-shared index is left for X2).

