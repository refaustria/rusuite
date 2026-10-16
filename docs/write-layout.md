# Write: print layout and pagination (P8-31)

The browser lays the document out (README: "the browser does the text layout"); Rusuite decides where pages
break. Before P8-31 the print layout packed whole top-level blocks into pages, so a paragraph or table never
crossed a page. P8-31 breaks at line boundaries and table rows, places footnotes at the bottom of their page,
flows multi-column sections across pages and feeds one `PageLayout` to the editor, the print preview and PDF
export.

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
   row with its cells' lines for splitting. A multi-column box is measured as one virtual column (its lines in DOM
   order, column jumps closed up). Footnotes are measured in the notes area (height, lines). Everything is
   stored relative to the block's border box, so a cached block stays valid when blocks above it change; the
   block chain (top = previous bottom + collapsed margins) is recomputed on every run (print layout renders every
   block: no `content-visibility` placeholders). The cache key is the PM node, the content width and a
   style epoch; a `MutationObserver` marks blocks whose DOM changed (decorations of other plugins: tab widths,
   list labels, live field values), resize/zoom (60 ms debounce) and style sheet or page setup changes mark all.
   The spacers the layout inserted are subtracted (a line below a spacer moves up by its height).
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
     never stay alone at a page bottom; a row taller than a page splits its cells at line boundaries unless
     `cant_split` (then it overflows its page);
   - **columns**: a multi-column section fills column 1, then 2… within the page and goes on to the next page;
     the last page of the section is balanced; a column break starts the next column;
   - **page geometry** per section (size, margins, orientation); the body starts below the measured header
     (`max(top margin, header distance + header height)`) and ends above the measured footer; first/even headers and
     page numbering (restart, format) as before.
   The result is the `PageLayout`: `pages[{ section, number, geometry, body, columns[{ x, width, fragments[{ block,
   fromLine, toLine, rect }] }], header, footer, footnotes[{ id, from, to }] }]`, plus the spacers to insert and the
   page of every document position (`pageStarts`).
3. **Apply in the editor** (`features/pagination.ts`). The document stays one ProseMirror flow; page gaps are
   *spacers*: widget decorations of the computed height – before a top-level block, inside a paragraph at the PM
   position where the page's first line starts (`display:block` span: the line wrapping is unchanged because it
   is inserted at a soft line break), at the top of each cell of the row that starts a page, or (in a
   multi-column box) a `column-span: all` spacer plus zero-height `break-before: column` markers at the computed
   column ends. A spacer of height `body top of page p+1 − (natural top + shift)` puts the next line exactly at
   the next page's body top. The page chrome (white sheets, grey gaps, headers, footers, footnote separators,
   repeated table headers, "Page N" on hover) is one absolutely positioned layer over the page frame
   (`ui/PageChrome.tsx`), virtualized to the pages near the viewport. Footnotes are the notes area's own note nodes,
   positioned absolutely at the bottom of their page (node decorations) – one editable copy; the draft view keeps
   the notes area. Glyph boxes overhang their line box a little: a spacer counts for the text below the middle of a
   glyph box, never for half of it. After applying, the plugin measures once more; if the result differs (a columns
   box balanced differently, a float moved), it applies it again (at most 2 extra passes).
4. **Print / PDF** (`print/writePrintDoc.ts`). With the document's page setup at 100 % the print document uses the
   editor's `PageLayout` directly: every page column is a clipping window over a clone of the editor flow (spacers
   and positioned notes removed) from the first fragment's top to the last fragment's bottom, so a paragraph is cut
   exactly between two lines; repeated header rows and the page's footnotes are drawn like in the editor. Other
   paper, margins or scale measure the clones at the printed width and run the same `paginate`.

## Incremental work for long documents
- Measurement is per block and cached; a keystroke re-measures one paragraph. A full re-measure (zoom, resize,
  styles) reads all blocks in one batch (no layout thrashing: all reads, then all writes).
- `paginate` resumes at the last page whose break was decided by units before the first changed one (`firstChange`
  compares geometry, flow options, notes and spacer positions; each page keeps the walk's state it started with); the
  pages before it are reused.
- Decorations are rebuilt only when the spacers or pages changed; the page chrome renders only the visible pages ± 2.
- Measured numbers: docs/perf.md ("Write – print layout pagination").

## Limits (approximations, documented in docs/ui.md)
- Word's line breaking is not reproduced; lines are the browser's. Floating pictures wrap with CSS floats (one
  side); page/margin-relative vertical positions are resolved against the real page box of their anchor paragraph.
- A row split across pages keeps its cell borders open at the break; nested tables are not split.
- A footnote continuation on the next page is a read-only copy (the editable note is the part on the reference's
  page).
