# Write: print layout and pagination (P8-31, P9-W2)

The browser lays the document out (README: "the browser does the text layout"); Rusuite decides where pages
break. Before P8-31 the print layout packed whole top-level blocks into pages, so a paragraph or table never
crossed a page. P8-31 breaks at line boundaries and table rows, places footnotes at the bottom of their page,
flows multi-column sections across pages and feeds one `PageLayout` to the editor, the print preview and PDF
export. P9-W2 adds sections with their own paper in print, editable footnote continuations, endnotes at section ends,
nested tables split across pages, and the reuse of the previous run (incremental flow, unchanged pages taken over).

## Pipeline

```
editor DOM ──measure──▶ Flow (lines, rows, notes; natural px)  ──paginate──▶ PageLayout ──▶ editor spacers + page chrome
   ▲  (cache per block: PM node, width, DOM mutations)                    │                  print preview / PDF
   └──────────────── spacer decorations (heights from the layout) ◀───────┘                  page fields, TOC, status bar
```

1. **Measure** (`features/layout/measure.ts`). For every top-level block the DOM is read once and cached:
   paragraph line boxes come from `Range.getClientRects()` per text node (plus atom/image rects), merged into
   lines by vertical overlap (`mergeLineRects`); a line occupies `[top, next line's top)`, the last one ends at the
   paragraph's content bottom. Tables are rows (`tr` rects; `data-header` = `w:tblHeader`, `data-cant-split`), each
   row with its cells' lines for splitting; a cell's content is a tree (P9-W2): its lines and the rows of nested tables,
   each nested cell measured on its own (its own spacers subtracted; a nested row's growth subtracted below it). A multi-column box is measured as one virtual column (its lines in DOM
   order, column jumps closed up). Footnotes are measured in the notes area (height, lines and a spacer anchor per line,
   a continuation spacer inside the note subtracted); with endnotes at section ends (`w:endnotePr/w:pos="sectEnd"`) the
   endnotes are measured the same way and leave the notes area's flow. Everything is
   stored relative to the block's border box, so a cached block stays valid when blocks above it change; the
   block chain (top = previous bottom + collapsed margins) is built by `buildFlow` (print layout renders every
   block: no `content-visibility` placeholders). The cache key is the PM node, its element and the element's inline style
   (a section's width decoration, W-18: a changed section re-measures only its blocks), the content width and a
   style epoch; a `MutationObserver` marks blocks whose DOM changed (decorations of other plugins: tab widths,
   list labels, live field values), resize/zoom (60 ms debounce) and style sheet or page setup changes mark all.
   The spacers the layout inserted are subtracted (a line below a spacer moves up by its height).
   `buildFlow` reuses the previous run's flow (P9-W2): the unchanged blocks at the start are taken over as they are, the
   unchanged blocks at the end (same measures, the PM positions moved by one delta) keep their units, shifted in place
   (natural y, positions, indices), and only the blocks in between are built; `flow.reuse` (`from`, `same`, the deltas)
   tells the pagination where the flow changed and how the rest moved. Sections (kinds, sizes) changing builds anew.
   With endnotes at section ends the endnotes of a section are units of the flow after its last block (virtual
   positions: a separator unit, then the notes' lines with their flow options; the next block moves down by their height).
2. **Paginate** (`features/layout/paginate.ts`, pure, unit-tested with a measurement stub). Input: the flow
   (units = lines, table rows, atoms), flow options per paragraph, footnote references per line, sections
   (geometry, columns, kind). It walks the units keeping `shift` (the extra height the spacers add before the
   current point) and fills the body area of each page:
   - a unit fits when its bottom plus the reserved footnote area stays inside the body; a footnote reserves its
     height plus the separator on the page of its reference line; when the reference line no longer fits with
     its note, the line moves to the next page; a note taller than what is left keeps at least one line on the
     page and continues on the next one (continuation separator) – no second pass is needed, the reservation is
     part of the fit test (at most 3 re-breaks per page guard the case where moving a line moves its note);
   - **widow/orphan control** (Word's default on): never one line of a paragraph alone at the bottom or the top
     of a page (a 2- or 3-line paragraph moves whole); **keep lines together** moves the paragraph;
     **keep with next** moves a paragraph (chains of them) to the next page with the first line of the next
     block, unless that empties the page; **page break before**, page breaks (`pageBreak`) and section breaks other
     than continuous start a new page; a column break outside columns ends the page;
   - **tables** break between rows; header rows (`repeat_header`) repeat at the top of every continuation page and
     never stay alone at a page bottom. A row that can break and does not fit the rest of the page splits there when
     every cell's first line fits (Word's "Allow row to break across pages"), a row taller than a page always: every
     cell continues at its own line boundary (P9-W2: a spacer inside the cell before its first line on the next page);
     a cell's nested table rows split the same way, each nested cell independently, the outer cell's content after the
     nested table follows the nested row's visual bottom; a nested row with `cant_split` moves whole (spacers at the
     start of its cells), a nested header row moves with the next row's first line (nested header rows are not
     repeated, as in Word). The page records the row's window on each page (`rowWindows`) for printing. A row that
     can not break and is taller than a page is clipped at the body bottom (`clips`; its cells get a `clip-path`) and
     the following block is pulled up to the next page by a negative spacer (a following row of the same table can not
     be pulled up: it starts below the whole row);
   - **columns**: a multi-column section fills column 1, then 2… within the page and goes on to the next page;
     the last page of the section is balanced; a column break starts the next column;
   - **page geometry** per section (size, margins, orientation); the body starts below the measured header
     (`max(top margin, header distance + header height)`) and ends above the measured footer; first/even headers and
     page numbering (restart, format) as before.
   - **reuse** (P9-W2): resuming after an edit, when the walk starts a page at a unit of the flow's moved end exactly
     where the previous result started the same page (same index and sheet, shift equal up to the natural delta, nothing
     carried, the same spacer height), that page and all after it are the previous ones moved by the deltas (fragments,
     spacers, `vtop`, checkpoints): a keystroke walks only the pages until the breaks meet again.
   The result is the `PageLayout`: `pages[{ section, number, geometry, body, columns[{ x, width, fragments[{ block,
   fromLine, toLine, rect }] }], header, footer, footnotes[{ id, from, to }] }]`, plus the spacers to insert and the
   page of every document position (`pageStarts`).
3. **Apply in the editor** (`features/pagination.ts`). The document stays one ProseMirror flow; page gaps are
   *spacers*: widget decorations of the computed height – before a top-level block, inside a paragraph at the PM
   position where the page's first line starts (`display:block` span: the line wrapping is unchanged because it
   is inserted at a soft line break), at the top of each cell of the row that starts a page, or (in a
   multi-column box) a `column-span: all` spacer plus zero-height `break-before: column` markers at the computed
   column ends. A spacer's negative margin takes back the collapsed margin only for the unit's own anchor (not for the
   spacers inside the cells of a split row). A spacer of height `body top of page p+1 − (natural top + shift)` puts the next line exactly at
   the next page's body top. The page chrome (white sheets, grey gaps, headers, footers, footnote separators,
   repeated table headers, "Page N" on hover) is one absolutely positioned layer over the page frame
   (`ui/PageChrome.tsx`), virtualized to the pages near the viewport. Footnotes are the notes area's own note nodes,
   positioned absolutely at the bottom of their page (node decorations) – one editable copy; the draft view keeps
   the notes area. A note shown in several slices (a footnote continued on the next page, an endnote across a page
   break) is still one element (`placeNote`): positioned at its first slice, an inline spacer inside it before the
   first line of every further slice, and a `clip-path` polygon of the slices so the page between them (and its text)
   shows through and takes the clicks; typing in the continuation edits the note. Endnotes at a section end are
   positioned the same way at their units' places; the space they take is one spacer before the next section's first
   block (their height plus the page gaps inside them, `endnoteReserves`), the chrome draws their separator lines. Glyph boxes overhang their line box a little: a spacer counts for the text below the middle of a
   glyph box, never for half of it. After applying, the plugin measures once more; if the result differs (a columns
   box balanced differently, a float moved), it applies it again (at most 2 extra passes).
4. **Print / PDF** (`print/writePrintDoc.ts`). With the document's page setup at 100 % the print document uses the
   editor's `PageLayout` directly: every page column is a clipping window over a clone of the editor flow (spacers
   and positioned notes removed) from the first fragment's top to the last fragment's bottom, so a paragraph is cut
   exactly between two lines; repeated header rows and the page's footnotes (and endnotes at section ends) are drawn
   like in the editor, in the notes area's style. Every page uses its own section's geometry (P9-W2): its sheet size
   (a named `@page` per extra size and `.rs-print-page:has(> .rs-wsize-k)` boxes, so the PDF has portrait and
   landscape pages) and its text column (a top-level block keeps the editor's layout, moved back by the section's
   offset). A table row split across pages is cut out of a clone that keeps the editor's spacers (`rowWindows`), so each
   cell continues at its own line and the borders stay open at the cut; a clipped row ends at the body bottom. Other
   paper, margins or scale measure the clones at the printed width and run the same `paginate` (one paper size).

## Incremental work for long documents
- Measurement is per block and cached; a keystroke re-measures one paragraph. A full re-measure (zoom, resize,
  styles) reads all blocks in one batch (no layout thrashing: all reads, then all writes). The top-level elements are
  read in one pass (`nodeDOM` per block was quadratic: 60 ms per run on a 200-page document).
- The flow is built incrementally (`buildFlow` with the previous flow: one block's units after a keystroke; without a
  reusable previous flow `firstChange` compares geometry, flow options, notes and spacer positions).
- `paginate` resumes at the last page whose break was decided by units before the first changed one (each page keeps
  the walk's state it started with); the pages before it are reused with their fragments, and the pages after the
  change are taken over as soon as a page starts where it started before (see "reuse" above). A section change
  (`SetSection`, page setup) resumes before that section's first unit (`firstSectionChange`) and keeps the measures of
  the blocks whose width did not change (`relayoutPages`); pages are not taken over then.
- The page data (`toLayout`) walks pages and fragments, not units; note numbers walk the document only when it has notes.
- Decorations are rebuilt only when the spacers or pages changed; the page chrome renders only the visible pages ± 2.
- The layout runs 120 ms after the last edit (60 ms after a resize or zoom), never inside the keystroke. Each run's
  timings are on the editor element (`rusuitePaginationMs`, the last 20 in `rusuitePaginationLog`, with the reason
  `edit` / `full` / `check` / `dom` and the parts measure, flow, paginate, layout).
- Measured numbers: docs/perf.md ("Write – print layout pagination", generated by `scripts/perf.sh pagination`): on the
  generated 200-page document a keystroke on page 100 builds flow and pages in ~3 ms (P8-31: ~20 ms).

## Shapes and text boxes (P8-34)
An inline shape or text box is one box in its line (`.drawing-wrap`, measured like an inline picture: the paragraphs of
its nested editor are not lines of the page). Floating drawings are skipped like floating pictures; the bottom of every
floating picture or drawing of a paragraph extends its last line's `ink`, so the page's `contentEnd` (the white cover
below the content) never hides a float that hangs below the text.

### Drawings round 2 (P9-W4)
- **Text on both sides of a picture.** CSS floats push the line boxes to one side only, so a centred picture with
  Square/Tight/Through wrapping and `wrapText="bothSides"` cannot be a float. When both text areas beside it are at least
  `MIN_SIDE_GAP` (72 px) wide, `floatPlacement` returns mode `both`: the picture is placed out of the flow (absolute, at
  its anchor's place, like In Front of Text) and `features/wrapBoth.ts` keeps the text away with **per-line exclusions**.
  Its exclusion box is the picture's frame plus its distances (`distL/R/T/B`). For every line of the paragraphs crossing
  that band the plugin inserts one inline spacer widget (`.wrap-spacer`, `display:inline-block`) after the last word whose
  right edge is left of the box (at the line start when no word fits), as wide as from that point to the box's right edge;
  the browser then continues the same line right of the picture and breaks the rest as usual. Lines are the browser's
  (glyph rects of the paragraph's text nodes merged by vertical overlap), so a spacer moves the lines after it: each pass
  measures, keeps every spacer that is still right (starts left of the box, ends at its right edge), fixes the first
  wrong or missing one and runs again (at most 40 passes; a picture spans a few lines, a keystroke above it a pass or two).
  Spacers are PM widget decorations: they move with edits, the pagination measures them like text, and print/PDF (clones
  of the editor) show the same lines. Tight and Through use the bounding box like Square (Word's polygon is not modelled).
- **Vertical positions** relative to the page, the margin, the top/bottom margin areas (`topMargin`, `bottomMargin`,
  inside → top, outside → bottom) and percentages of them use the real page box of the anchor paragraph in print layout
  (`verticalPage`: the sheet holding the paragraph, its body top/bottom from the `PageLayout`); `line` positions start at
  the top of the line after the object (`coordsAtPos`). The editor and print agree because print clones the editor.
  Horizontal positions relative to the left/right/inside/outside margin areas and percentages resolve against the page
  width and left margin of the page setup.
- **Linked text boxes** (`textChain.ts`): the first box of a chain is an ordinary nested editor with the whole story; its
  lines are measured (glyph rects) and the box is clipped (`clip-path`) after its last whole line. Every later box shows a
  read-only clone of the story's DOM laid out at its own width: the line holding the first character that did not fit in
  the box before is found by a character reference (child-index path + offset, identical in the clone), the clone is
  shifted up to that line and clipped after the last line that fits. A click in a later box maps the point back to the
  story's DOM (same path) and puts the editor's caret there; a drawn caret shows where typing goes. The clones are plain
  DOM, so print shows the flow. Lines are never cut: a box takes at least one line.
- **Groups and canvases** (`wpg:wgp`, `wpc:wpc`) are one inline node (`Drawing.children` in the group's frame); members are
  absolutely placed spans with their own rotation and flips; grouped text boxes have their own nested editors. Resizing a
  group scales its members (`scaleGroup`, `Drawing::scale_children`); a canvas keeps its members and `Fit` shrinks it to
  them. They are measured like any drawing.
- **Rotated handles**: the resize and rotation handles live in a frame that rotates with the shape (not flipped); a drag
  is converted into the shape's own frame and the opposite handle stays where it is (`rotatedResize`), a floating
  drawing's anchor moving by the frame's shift.
- **Z-order**: `Anchor.z` (`relativeHeight`) orders objects out of the flow (`zIndex`: in front above 3, behind below
  the text); Bring Forward / Send Backward renumber the floating objects with Word's base and step.

## Unequal columns (P9-W5)
CSS multi-column layout only has equal columns. A section with columns of their own widths (`w:cols w:equalWidth="0"`,
Layout › Columns › Left / Right / More Columns…) is laid out as **explicit column boxes** (`features/unequalColumns.ts`):
- The columns box keeps n equal CSS columns *without a gap* (`columnsCss`: `column-count: n; column-gap: 0`), so the
  browser still decides where content breaks into the next column, and everything that relies on it is unchanged: the
  measurement (one virtual column per box), the pagination's column filling, balancing on the last page and its
  `break-before: column` markers, footnotes, print clones.
- Every child block is moved into the place and width of the column it starts in with a margin pair: CSS column k has
  its origin at k·T/n (T = the box's width); the model's column k (`columnLayout`: x_k, w_k) is reached with
  `margin-left = x_k − k·T/n` and `margin-right = T/n − w_k − margin-left` (either may be negative), so the block is
  exactly w_k wide at x_k and its lines break at that width.
- The plugin reads after each layout which CSS column every child's first fragment is in (its left edge minus its
  current margin, divided by T/n) and sets the margins as node decorations (`data-ucol`). Margins change line breaks
  and heights, so it looks again on the next frame until nothing moves (at most 6 passes per change); the pagination
  re-measures the changed blocks through its DOM observer as for any other decoration.
- The measured column geometry (`reg.columns`, from `columnLayout`) is the real one, so the page chrome draws the line
  between the columns at the real gap (the CSS column rule is off for unequal boxes) and print clips each page column at
  its real place.
- Limit: a paragraph that continues in the next column keeps the width of the column it starts in (Word re-wraps the
  continuation at the next column's width); content is distributed by the equal CSS columns' balancing, so the
  columns' bottoms may differ by more than a line where Word balances by the real widths.

## Floating tables (P9-W5)
A table with text wrapping Around (`w:tblpPr`) is a CSS float beside the text in the editor and in print: aligned or
offset to the right → `float: right`, else `float: left` with its horizontal offset; the distances from the text become
margins; a centred table is not floated (CSS cannot wrap text on both sides of a float). The pagination measures it as
a block like any other; positions relative to the page or the margin are approximated relative to the column.

## Limits (approximations, documented in docs/ui.md)
- Word's line breaking is not reproduced; lines are the browser's. Floating pictures wrap with CSS floats (one side),
  or on both sides through per-line spacers when there is room (P9-W4, above); a tight/through wrap polygon is drawn as
  the bounding box; page/margin-relative vertical positions are resolved against the real page box of their anchor
  paragraph.
- A row split across pages keeps its cell borders open at the break; when a table breaks *between* rows, the first
  row on the next page has no top border (Word repeats the inside border there). A clipped row (can not break, taller
  than a page) does not pull a following row of the same table up. A nested row that can not break but is taller than
  a page is split anyway.
- Footnotes reserve their space on the page of their reference (a reference inside a split row: the row's first page).
- With other paper, margins or scale in the print dialog every page uses that paper, rows split across pages print
  without their page gaps (natural layout) and endnotes at section ends print at the end of the document.
