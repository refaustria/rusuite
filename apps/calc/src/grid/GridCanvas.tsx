// Virtualized canvas grid: one canvas for cells, one for headers, a
// transparent scroll container with a sized spacer on top for native
// scrolling and input events. Frozen panes split the cell canvas into up
// to four quadrants (grid/panes.ts), each drawn with its own viewport;
// pointer positions map back per quadrant. Zoom, gridlines, headings and
// the frozen panes are the active sheet's `SheetView`.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { ContextMenu, LONG_PRESS_MS, type ContextMenuItem } from "@rusuite/ui-shared";
import { calcActions, cellMenu, colHeaderMenu, rowHeaderMenu } from "../calcActions";
import type { Rect } from "../generated/Rect";
import { fillTarget } from "../state/clipboard";
import { sheetViewOf, useCalc, type CalcStore } from "../state/store";
import { drawFilterButtons, filterButton, filterButtonAt, filterButtons, filteredRowSpan } from "../sortFilter/filter";
import { CellEditor } from "./CellEditor";
import { SpillIndicator, SPILL_TAG_W } from "./SpillIndicator";
import { ValidationOverlay } from "../validation/ValidationOverlay";
import { spillOutlineOps } from "./spill";
import { mergeAt } from "./merges";
import { axisScrollTo, axisToScreen, extrasX, extrasY, isSplit, mainPane, panes, splitPaneAt, splitterAt, toSheet, TWIPS_PER_PX, type PaneLayout } from "./panes";
import {
  computeRenderOps, drawFreezeLines, drawHeaders, drawOps, drawRefHighlights, drawAreas, drawSelection, HEADER_H, HEADER_W, prepareCanvas, rangeRect,
  visibleRange, type RefHighlight, type RenderOp, type SheetData,
} from "./render";
import {
  cellSelection, colSelection, contains, isWholeCols, isWholeRows, LAST_COL, LAST_ROW, navigate, normalize, pointerSelect, rowSelection,
  type Cell, type Range, type Selection,
} from "./Selection";
import type { Measure } from "./textLayout";
import { useT } from "../i18n";
import { elementBounds, hitTestChart, sameElement, type ChartElement } from "@rusuite/ui-shared";
import { anchorRect, handleAt, handleCursor, moveRect, resizeRect, type Handle } from "../charts/anchor";
import { chartRefMarks, paintCharts } from "../charts/paint";
import { paintSparklines } from "../sparklines/paint";
import { paintArrows } from "../audit/trace";
import { paintErrorMarks } from "../audit/marks";
import { paintValidationCircles } from "../validation/circles";
import { ErrorTag } from "../audit/ErrorTag";
import { chartMenu } from "../charts/menus";
import { ChartTextEditor } from "../charts/ChartTextEditor";
import { AnnotationLayer } from "../comments/AnnotationLayer";
import { SlicerLayer } from "../slicers/SlicerLayer";
import { FlashPreviewLayer } from "../datatools/FlashPreview";
import { drawIndicators, indicators } from "../comments/model";
import { drawPivotButtons, drawPlaceholder, type PivotButton } from "../pivot/buttons";
import { drawOutlineBar, gutterSize, outlineGroups, outlineHitAt, type BarLayout, type OutlineGroup, type OutlineHit } from "../outline/bar";
import { cropFor, paintPictures } from "../pictures/controller";
import { filterButton as afButton, type FilterButton } from "../sortFilter/filter";
import type { AxisGeometry } from "./geometry";
import { noteTouch, useTouchUi } from "../touch/touchUi";
import { clampZoom, edgeScroll, isDoubleTap, pinchDistance, TOUCH_FILL_OFFSET, TOUCH_HANDLE_HIT, type Tap } from "../touch/gestures";

/** The totals cell dropdown: just right of the active cell (Excel), so the total stays readable. */
function totalsButton(colGeo: AxisGeometry, rowGeo: AxisGeometry, row: number, col: number): FilterButton | null {
  const b = afButton(colGeo, rowGeo, { r0: row, c0: col, r1: row, c1: col }, col);
  return b && { ...b, x: colGeo.offset(col) + colGeo.size(col) + 1 };
}
import { breakLineAt, drawBreakPreview, previewBreaks, withBreak, withoutBreak, type BreakLine } from "../datatools/pageBreaks";

/** Hit zone around a header boundary for resizing, px (a finger gets more, P10-M3). */
const RESIZE_SLOP = 4;
const RESIZE_SLOP_TOUCH = 10;
/** Rows/cols prefetched beyond the viewport. */
const PREFETCH = 8;
/** Fill handle: square size and hit slop, px. */
const HANDLE = 6;
const HANDLE_SLOP = 5;

/** Canvas text measurement with a small cache (the grid's `store.measure`). */
function canvasMeasure(): Measure | null {
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = document.createElement("canvas").getContext("2d");
  } catch {
    ctx = null;
  }
  if (!ctx) return null;
  const cache = new Map<string, number>();
  return (text, font) => {
    const key = `${font}\u0000${text}`;
    let w = cache.get(key);
    if (w === undefined) {
      if (ctx!.font !== font) ctx!.font = font;
      w = ctx!.measureText(text).width;
      if (cache.size > 20_000) cache.clear();
      cache.set(key, w);
    }
    return w;
  };
}

export interface PerfStats {
  frames: number;
  avgDrawMs: number;
  maxDrawMs: number;
  fps: number;
}

type Hit =
  | { kind: "corner" }
  | { kind: "colHeader"; col: number }
  | { kind: "rowHeader"; row: number }
  | { kind: "colEdge"; col: number }
  | { kind: "rowEdge"; row: number }
  | { kind: "cell"; cell: Cell }
  | { kind: "fillHandle" }
  /** The AutoFilter dropdown button of a header cell. */
  | { kind: "filterButton"; col: number }
  /** A chart (`element`: the part under the pointer). */
  | { kind: "chart"; id: number; element: ChartElement | null }
  /** A resize handle of the selected chart. */
  | { kind: "chartHandle"; id: number; handle: Handle }
  /** A −/+ or dropdown button of a pivot table. */
  | { kind: "pivotButton"; button: PivotButton }
  /** A filter button of a table header. */
  | { kind: "tableFilter"; table: number; col: number }
  /** The totals row dropdown of the active cell. */
  | { kind: "totalsButton"; table: number; col: number }
  /** A level or −/+ button of an outline bar. */
  | { kind: "outline"; hit: OutlineHit }
  /** A picture (`handle`: a resize handle of the selected one). */
  | { kind: "picture"; id: number; handle: Handle | null }
  /** A page break line of Page Break Preview. */
  | { kind: "pageBreak"; line: BreakLine }
  /** A splitter of View › Split. */
  | { kind: "splitter"; axis: "x" | "y" | "both" }
  | { kind: "none" };

export function GridCanvas({ store, showPerf = false }: { store: CalcStore; showPerf?: boolean }) {
  const t = useT();
  // The active sheet's view: zoom (applied with CSS `zoom` on the grid), gridlines, headings, frozen panes.
  const sheetView = useCalc(store, (s) => sheetViewOf(s.info, s.activeSheet));
  const zoom = sheetView.zoom / 100;
  const headings = sheetView.showHeadings;
  // The outline bars move the cell canvas right / down.
  const bars = useCalc(store, () => store.outlineMax().join(","));
  const scroller = useRef<HTMLDivElement>(null);
  const spacer = useRef<HTMLDivElement>(null);
  const cellsCanvas = useRef<HTMLCanvasElement>(null);
  const headerCanvas = useRef<HTMLCanvasElement>(null);
  const perfBox = useRef<HTMLDivElement>(null);
  const editorBox = useRef<HTMLDivElement>(null);
  const spillBox = useRef<HTMLDivElement>(null);
  const validationBox = useRef<HTMLDivElement>(null);
  const errorBox = useRef<HTMLDivElement>(null);
  const chartTextBox = useRef<HTMLDivElement>(null);
  const raf = useRef<number | null>(null);
  const grow = useRef({ rows: 0, cols: 0 });
  const resizePreview = useRef<{ axis: "col" | "row"; index: number; size: number } | null>(null);
  const perf = useRef({ frames: 0, totalMs: 0, maxMs: 0, lastFrameAt: 0, intervals: 0, intervalSum: 0 });
  /** Fill-handle drag: the range that would be filled. */
  const fillPreview = useRef<Rect | null>(null);
  /** View › Split: the sheet offsets of the left and top panes (they scroll with the wheel, the rest with the scroll bars). */
  const split0 = useRef({ x: 0, y: 0 });
  /** A splitter being dragged: its screen position (px of the cell area). */
  const splitDrag = useRef<{ x?: number; y?: number } | null>(null);
  /** The fill handle's tip while dragging (Excel): the value the last filled cell gets, near the pointer. */
  const [fillTip, setFillTip] = useState<{ text: string; x: number; y: number } | null>(null);
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; items: ContextMenuItem[]; label: string } | null>(null);
  const actions = useMemo(() => calcActions(store), [store]);
  const clipMark = useCalc(store, (s) => s.clipMark);
  const painterOn = useCalc(store, (s) => s.painter !== null);
  // Circle Invalid Data on this sheet, as `r,c;r,c` (tests and e2e read it).
  const circleCells = useCalc(store, (s) => (s.circles && s.circles.sheet === s.activeSheet ? s.circles.cells.map((c) => `${c.r0},${c.c0}`).join(";") : ""));

  const activeSheet = useCalc(store, (s) => s.activeSheet);
  // While pointing on another sheet the in-cell editor is hidden (the formula bar has the edit).
  const editing = useCalc(store, (s) => s.edit !== null && s.edit.sheet === s.activeSheet);
  const chartTextEdit = useCalc(store, () => store.charts.textEdit !== null);
  const lastPoint = useRef<Cell | null>(null);

  // --- touch (P10-M3): selection handles, touch fill handle, pinch zoom ---
  const touchUi = useTouchUi();
  const touchUiRef = useRef(touchUi);
  touchUiRef.current = touchUi;
  const refMode = useCalc(store, () => store.touchRef);
  const startHandle = useRef<HTMLDivElement>(null);
  const endHandle = useRef<HTMLDivElement>(null);
  const touchFill = useRef<HTMLDivElement>(null);
  /** Tap on the touch fill handle: the Fill sheet. */
  const [, setFillSheet] = useState(false);
  /** The zoom shown while pinching (committed to the sheet view when the fingers lift). */
  const [pinchZoom, setPinchZoom] = useState<number | null>(null);
  const pinchZoomRef = useRef<number | null>(null);
  pinchZoomRef.current = pinchZoom;
  /** The previous tap on a header edge (double tap = autofit). */
  const lastEdgeTap = useRef<Tap | null>(null);
  /** The active pinch: its source, start distance and zoom, the grid point under the fingers' centre. */
  const pinch = useRef<{ source: "pointer" | "touch"; d0: number; z0: number; sx: number; sy: number } | null>(null);
  /** Counts pinches (a tap that was part of one does not select). */
  const pinchSeq = useRef(0);
  /** The selection when the last primary touch went down (restored when it turns into a pinch). */
  const touchDownSel = useRef<Selection | null>(null);
  /** Where the pinch keeps the grid point under the fingers (applied after the zoom renders). */
  const pinchScroll = useRef<{ left: number; top: number } | null>(null);

  const sheetData = useCallback((): SheetData => {
    const sheet = store.getState().activeSheet;
    const cache = store.cache(sheet);
    const geo = store.geometry(sheet);
    return {
      cells: cache.cells, cols: cache.cols, rows: cache.rows, colGeo: geo.col, rowGeo: geo.row, merges: cache.merges,
      cf: cache.cf,
      showFormulas: store.getState().showFormulas,
      pivotLook: store.pivots.looks(sheet),
      tableLook: store.tables.looks(sheet),
      followed: (r, c) => store.comments.isFollowed(sheet, r, c),
    };
  }, [store]);

  /** The outline bars' sizes (with the headings only): row bar width, column bar height. */
  const gutter = useCallback(() => {
    if (!store.sheetView().showHeadings) return { gw: 0, gh: 0 };
    const [r, c] = store.outlineMax();
    return { gw: gutterSize(r), gh: gutterSize(c) };
  }, [store]);

  /** Header sizes (0 when the sheet hides its headings), outline bars included. */
  const headerSize = useCallback(() => {
    const on = store.sheetView().showHeadings;
    const { gw, gh } = gutter();
    return { hw: (on ? HEADER_W : 0) + gw, hh: (on ? HEADER_H : 0) + gh };
  }, [store, gutter]);

  /** The split of the cell area: frozen sizes, scroll offsets, size. */
  const layout = useCallback((): PaneLayout => {
    const el = scroller.current;
    const data = sheetData();
    const v = store.sheetView();
    const { hw, hh } = headerSize();
    // Frozen while scrolled: the frozen area starts at the view's top-left cell (Excel's `topLeftCell`).
    const top = v.frozenRows > 0 ? (v.topRow ?? 0) : 0;
    const left = v.frozenCols > 0 ? (v.leftCol ?? 0) : 0;
    const originY = data.rowGeo.offset(top);
    const originX = data.colGeo.offset(left);
    const split = v.frozenRows === 0 && v.frozenCols === 0;
    const drag = splitDrag.current;
    return {
      frozenW: v.frozenCols > 0 ? data.colGeo.offset(left + v.frozenCols) - originX : 0,
      frozenH: v.frozenRows > 0 ? data.rowGeo.offset(top + v.frozenRows) - originY : 0,
      scrollX: el?.scrollLeft ?? 0,
      scrollY: el?.scrollTop ?? 0,
      width: Math.max(0, (el?.clientWidth ?? 0) - hw),
      height: Math.max(0, (el?.clientHeight ?? 0) - hh),
      originX,
      originY,
      splitX: split ? (drag?.x ?? (v.splitX ?? 0) / TWIPS_PER_PX) : 0,
      splitY: split ? (drag?.y ?? (v.splitY ?? 0) / TWIPS_PER_PX) : 0,
      scrollX0: split0.current.x,
      scrollY0: split0.current.y,
    };
  }, [store, sheetData, headerSize]);

  /** Sheet offsets of cell-area points (the panes' own scrolling). */
  const axisToSheetX = (l: PaneLayout, x: number) => toSheet(l, x, 0).x;
  const axisToSheetY = (l: PaneLayout, y: number) => toSheet(l, 0, y).y;

  /** Canvas position of a sheet offset (scrolled under the frozen part: where it would be). */
  const screenX = (l: PaneLayout, x: number) => axisToScreen(l.frozenW, l.scrollX, x, extrasX(l)) ?? x - l.scrollX - (l.originX ?? 0);
  const screenY = (l: PaneLayout, y: number) => axisToScreen(l.frozenH, l.scrollY, y, extrasY(l)) ?? y - l.scrollY - (l.originY ?? 0);

  /** Page Break Preview's break lines of the active sheet (`[]` when off). */
  const breakLines = (data: SheetData): { lines: BreakLine[]; lastRow: number; lastCol: number } => {
    const st = store.getState();
    if (!st.pageBreakPreview) return { lines: [], lastRow: -1, lastCol: -1 };
    const used = store.usedExtent(st.activeSheet);
    const info = st.info?.sheets.find((x) => x.id === st.activeSheet);
    const lastRow = Math.max(0, used.lastRow), lastCol = Math.max(0, used.lastCol);
    return { lines: previewBreaks(data.colGeo, data.rowGeo, lastRow, lastCol, info?.rowBreaks ?? [], info?.colBreaks ?? [], store.printOptions), lastRow, lastCol };
  };

  /** The outline bars: layout and the visible groups of both axes. */
  const outlineBars = (l: PaneLayout, data: SheetData): { layout: BarLayout; rows: { groups: OutlineGroup[]; max: number; geo: typeof data.rowGeo }; cols: { groups: OutlineGroup[]; max: number; geo: typeof data.colGeo } } => {
    const { gw, gh } = gutter();
    const [rmax, cmax] = store.outlineMax();
    const props = store.outlineProps();
    const layout: BarLayout = { gw, gh, headerW: HEADER_W, headerH: HEADER_H, screenX: (x) => screenX(l, x), screenY: (y) => screenY(l, y), width: l.width, height: l.height };
    const vis = visibleRange(mainPane(l).vp, data.colGeo, data.rowGeo);
    const rowLine = (i: number) => {
      const r = data.rows.get(i);
      return { level: r?.outlineLevel ?? 0, collapsed: r?.collapsed ?? false };
    };
    const colLine = (i: number) => {
      const c = data.cols.get(i);
      return { level: c?.outlineLevel ?? 0, collapsed: c?.collapsed ?? false };
    };
    return {
      layout,
      rows: { groups: rmax > 0 ? outlineGroups(rowLine, vis.r0, vis.r1, rmax, props.summaryBelow, LAST_ROW) : [], max: rmax, geo: data.rowGeo },
      cols: { groups: cmax > 0 ? outlineGroups(colLine, vis.c0, vis.c1, cmax, props.summaryRight, LAST_COL) : [], max: cmax, geo: data.colGeo },
    };
  };

  /** The fill handle's square in cell-canvas coordinates (`null`: off screen or whole rows/columns). */
  const handleRect = useCallback(
    (sel: Range): { x: number; y: number } | null => {
      if (isWholeCols(sel) && isWholeRows(sel)) return null;
      const data = sheetData();
      const l = layout();
      const sx = axisToScreen(l.frozenW, l.scrollX, data.colGeo.offset(sel.c1 + 1), extrasX(l));
      const sy = axisToScreen(l.frozenH, l.scrollY, data.rowGeo.offset(sel.r1 + 1), extrasY(l));
      if (sx === null || sy === null) return null;
      const x = sx - HANDLE / 2 - 1;
      const y = sy - HANDLE / 2 - 1;
      if (x < -HANDLE || y < -HANDLE || x > l.width || y > l.height) return null;
      return { x, y };
    },
    [sheetData, layout],
  );

  const draw = useCallback(() => {
    raf.current = null;
    const t0 = performance.now();
    const state = store.getState();
    const data = sheetData();
    const l = layout();
    const { hw, hh } = headerSize();
    const zoomNow = store.sheetView().zoom / 100;
    const sel = normalize(state.selection);
    const quads = panes(l);

    // Virtual extent: used range + 50 rows (min 200), growing with scrolling/selection.
    const used = store.usedExtent(state.activeSheet);
    const rows = Math.min(LAST_ROW + 1, Math.max(200, used.lastRow + 51, grow.current.rows));
    const cols = Math.min(LAST_COL + 1, Math.max(30, used.lastCol + 11, grow.current.cols));
    const chartSheet = store.isChartSheet(state.activeSheet);
    if (spacer.current) {
      // A chart sheet does not scroll: its chart fills the grid area.
      spacer.current.style.width = chartSheet ? "0px" : `${hw + data.colGeo.offset(cols)}px`;
      spacer.current.style.height = chartSheet ? "0px" : `${hh + data.rowGeo.offset(rows)}px`;
    }
    if (chartSheet) store.charts.chartSheetSize = { w: l.width, h: l.height };

    // The frozen quadrants first: the scrolling one is the viewport remembered for reloads.
    for (const q of [...quads].reverse()) {
      const vis = visibleRange(q.vp, data.colGeo, data.rowGeo);
      void store.ensureRegion(
        state.activeSheet,
        Math.max(0, vis.r0 - PREFETCH), Math.max(0, vis.c0 - 2),
        Math.min(LAST_ROW, vis.r1 + PREFETCH), Math.min(LAST_COL, vis.c1 + 2),
      );
    }

    const cctx = cellsCanvas.current && prepareCanvas(cellsCanvas.current, l.width, l.height, zoomNow);
    if (cctx) {
      drawOps(cctx, [], "#ffffff");
      const edit = state.edit;
      const marks: RefHighlight[] = [];
      if (edit) {
        for (const ref of store.editRefs()) {
          if (store.refSheet(ref) !== state.activeSheet) continue;
          const pointed = edit.point !== null && ref.start === edit.point.start && ref.end === edit.point.end;
          marks.push({ range: ref.range, color: ref.color, dashed: pointed });
        }
      }
      const mark = state.clipMark && state.clipMark.sheet === state.activeSheet ? state.clipMark : null;
      const fp = fillPreview.current;
      const af = store.autoFilter();
      const sortState = store.sortState();
      // The spill range around the active cell: blue, dashed red when blocked (`#SPILL!`).
      const spill = edit ? null : store.activeSpill();
      const cfOps: RenderOp[] = [];
      // The main pane's texts (sheet px clip spans), for the end-to-end tests.
      const textOps: { row: number; col: number; text: string; clipX: number; clipW: number; rotation: number }[] = [];
      const pivotButtonsShown: PivotButton[] = [];
      // Charts over the cells; the selected chart's source ranges are outlined (Excel).
      const frames = store.charts.frames(state.activeSheet);
      const chartSel = store.charts.selected?.sheet === state.activeSheet ? store.charts.selected : null;
      const chartObj = chartSel ? store.charts.get(chartSel.sheet, chartSel.id) : undefined;
      if (chartObj && !edit) {
        const name = state.info?.sheets.find((x) => x.id === state.activeSheet)?.name ?? "";
        marks.push(...chartRefMarks(chartObj.chart, name));
      }
      if (chartSheet) {
        // Chart sheet: no cells, the chart full-size (Excel's Move Chart › New sheet).
        cctx.fillStyle = "#ffffff";
        cctx.fillRect(0, 0, l.width, l.height);
        paintCharts(cctx, frames, { ...quads[quads.length - 1]!.vp, scrollX: 0, scrollY: 0, width: l.width, height: l.height }, chartSel, true);
      }
      for (const q of chartSheet ? [] : quads) {
        const vp = q.vp;
        cctx.save();
        cctx.translate(q.x, q.y);
        cctx.beginPath();
        cctx.rect(0, 0, vp.width, vp.height);
        cctx.clip();
        const base = computeRenderOps(vp, data, store.styles(), store.measure);
        if (data.cf && data.cf.size > 0) for (const o of base) if (o.op === "bar" || o.op === "icon") cfOps.push(o);
        if (q === quads[0]) for (const o of base) if (o.op === "text") textOps.push({ row: o.row, col: o.col, text: o.text, clipX: o.clipX + vp.scrollX, clipW: o.clipW, rotation: o.rotation ?? 0 });
        drawOps(cctx, store.sheetView().showGridlines ? base : base.filter((o) => o.op !== "gridlines"), null);
        // Sparklines inside their cells (P9-C6), under the selection.
        paintSparklines(cctx, store.sparklines.views(state.activeSheet), (r, c) => rangeRect(vp, data, { r0: r, c0: c, r1: r, c1: c }), visibleRange(vp, data.colGeo, data.rowGeo));
        drawSelection(cctx, vp, data, sel, state.selection.anchor);
        if (state.selection.areas?.length) drawAreas(cctx, vp, data, state.selection.areas);
        // Note triangles and comment markers in the cells' top-right corners (over the selection, as in Excel).
        const visCells = visibleRange(vp, data.colGeo, data.rowGeo);
        drawIndicators(cctx, indicators(data.cells, data.colGeo, data.rowGeo, [visCells.r0, visCells.r1], [visCells.c0, visCells.c1]), vp.scrollX, vp.scrollY);
        if (spill) drawOps(cctx, spillOutlineOps(vp, data, spill), null);
        if (af) {
          // AutoFilter dropdowns on the header row (over the selection, as in Excel).
          const vis = visibleRange(vp, data.colGeo, data.rowGeo);
          if (af.r0 >= vis.r0 && af.r0 <= vis.r1) {
            drawFilterButtons(cctx, filterButtons(data.colGeo, data.rowGeo, af, vis.c0, vis.c1, sortState), vp.scrollX, vp.scrollY);
          }
        }
        {
          // Table headers' filter buttons; the totals dropdown of the active totals cell.
          const vis = visibleRange(vp, data.colGeo, data.rowGeo);
          const tb = store.tables.filterButtons(state.activeSheet, data.colGeo, data.rowGeo, vis);
          if (tb.length) drawFilterButtons(cctx, tb, vp.scrollX, vp.scrollY);
          const a = state.selection.anchor;
          const tc = !edit ? store.tables.totalsCellAt(a.row, a.col) : null;
          const btn = tc && totalsButton(data.colGeo, data.rowGeo, a.row, a.col);
          if (btn) drawFilterButtons(cctx, [btn], vp.scrollX, vp.scrollY);
        }
        {
          // Pivot tables: −/+ buttons on item labels, dropdowns on the headers and page fields.
          const vis = visibleRange(vp, data.colGeo, data.rowGeo);
          const pb = store.pivots.buttonsIn(state.activeSheet, data.colGeo, data.rowGeo, vis);
          if (pb.length) {
            drawPivotButtons(cctx, pb, vp.scrollX, vp.scrollY);
            pivotButtonsShown.push(...pb);
          }
          for (const ph of store.pivots.placeholders(state.activeSheet)) {
            const r = rangeRect(vp, data, ph.rect);
            if (r) drawPlaceholder(cctx, r, ph.name, t("calc.pivot.placeholder"));
          }
        }
        if (mark) {
          // Marching ants around the copied / cut range.
          const r = rangeRect(vp, data, mark.range);
          if (r) {
            cctx.lineWidth = 2;
            cctx.strokeStyle = "#ffffff";
            cctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
            cctx.strokeStyle = "#217346";
            cctx.setLineDash([4, 4]);
            cctx.lineDashOffset = -Math.floor(performance.now() / 80) % 8;
            cctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
            cctx.setLineDash([]);
          }
        }
        if (fp) {
          const all = { r0: Math.min(sel.r0, fp.r0), c0: Math.min(sel.c0, fp.c0), r1: Math.max(sel.r1, fp.r1), c1: Math.max(sel.c1, fp.c1) };
          const r = rangeRect(vp, data, all);
          if (r) {
            cctx.strokeStyle = "#5f6368";
            cctx.lineWidth = 1;
            cctx.setLineDash([3, 2]);
            cctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
            cctx.setLineDash([]);
          }
        }
        if (marks.length > 0) drawRefHighlights(cctx, vp, data, marks);
        // Error checking's green triangles in the cells' top-left corners (P9-C4).
        const errs = store.audit.marks(state.activeSheet);
        if (errs.length > 0) paintErrorMarks(cctx, errs, (r, c) => rangeRect(vp, data, { r0: r, c0: c, r1: r, c1: c }));
        // Circle Invalid Data (P9-C5).
        const circles = state.circles;
        if (circles && circles.sheet === state.activeSheet && circles.cells.length > 0) {
          paintValidationCircles(cctx, circles.cells, (r, c) => rangeRect(vp, data, { r0: r, c0: c, r1: r, c1: c }));
        }
        const arrows = store.trace.on(state.activeSheet);
        if (arrows.length > 0) paintArrows(cctx, data.colGeo, data.rowGeo, arrows, vp.scrollX, vp.scrollY);
        paintCharts(cctx, frames, vp, chartSel);
        paintPictures(cctx, store.pictures.frames(state.activeSheet), vp, (p) => store.pictures.image(p), store.pictures.selected?.sheet === state.activeSheet ? store.pictures.selected.id : null, store.pictures.cropping);
        if (state.pageBreakPreview) {
          const b = breakLines(data);
          drawBreakPreview(cctx, data.colGeo, data.rowGeo, b.lines, b.lastRow, b.lastCol, vp, (n) => t("calc.view.page", { n }));
        }
        cctx.restore();
      }
      // Hook for the end-to-end tests: the charts of the last frame (sheet px rectangles and scenes).
      (window as unknown as { __calcCharts?: unknown }).__calcCharts = frames.map((f) => ({ id: f.obj.id, rect: f.rect, scene: f.scene }));
      // The sparklines of the active sheet (groups with their data), for the end-to-end tests.
      (window as unknown as { __calcSparklines?: unknown }).__calcSparklines = store.sparklines.views(state.activeSheet);
      // Render-op hook for the end-to-end tests: the data bars and icons of the last frame.
      (window as unknown as { __calcCfOps?: RenderOp[] }).__calcCfOps = cfOps;
      // The texts and pictures of the last frame (P9-C7 e2e: overflow, `####`, picture placement).
      (window as unknown as { __calcTexts?: unknown }).__calcTexts = textOps;
      (window as unknown as { __calcPictures?: unknown }).__calcPictures = store.pictures.frames(state.activeSheet).map((f) => ({ id: f.pic.id, rect: f.rect, editAs: f.pic.editAs ?? null }));
      // The pivot buttons of the last frame (sheet px), for the end-to-end tests.
      (window as unknown as { __calcPivotButtons?: PivotButton[] }).__calcPivotButtons = pivotButtonsShown;
      drawFreezeLines(cctx, l);
      if (!edit && !chartSel) {
        const h = handleRect(sel);
        if (h) {
          cctx.fillStyle = "#ffffff";
          cctx.fillRect(h.x - 1, h.y - 1, HANDLE + 2, HANDLE + 2);
          cctx.fillStyle = "#217346";
          cctx.fillRect(h.x, h.y, HANDLE, HANDLE);
        }
      }
    }
    const { gw, gh } = gutter();
    const hctx = hw > 0 && headerCanvas.current && prepareCanvas(headerCanvas.current, l.width + hw, l.height + hh, zoomNow);
    if (hctx) {
      hctx.clearRect(0, 0, l.width + hw, l.height + hh);
      hctx.save();
      hctx.translate(gw, gh);
      drawHeaders(hctx, l, data, sel, { bg: "#f3f3f3", fg: "#444", line: "#c8c8c8", active: "#d3e3d8" }, filteredRowSpan(store.autoFilter()), store.calcTools.r1c1());
      const p = resizePreview.current;
      if (p) {
        hctx.strokeStyle = "#217346";
        hctx.lineWidth = 1;
        hctx.beginPath();
        if (p.axis === "col") {
          const x = HEADER_W + screenX(l, data.colGeo.offset(p.index)) + p.size;
          hctx.moveTo(x + 0.5, 0);
          hctx.lineTo(x + 0.5, HEADER_H + l.height);
        } else {
          const y = HEADER_H + screenY(l, data.rowGeo.offset(p.index)) + p.size;
          hctx.moveTo(0, y + 0.5);
          hctx.lineTo(HEADER_W + l.width, y + 0.5);
        }
        hctx.stroke();
      }
      hctx.restore();
      if (gw > 0 || gh > 0) {
        const bars = outlineBars(l, data);
        if (gw > 0) drawOutlineBar(hctx, "rows", bars.rows.groups, bars.rows.max, data.rowGeo, bars.layout);
        if (gh > 0) drawOutlineBar(hctx, "cols", bars.cols.groups, bars.cols.max, data.colGeo, bars.layout);
      }
    }

    {
      // Touch: the selection handles at the active range's corners (in Ref mode: the pointed reference's), the fill
      // handle diagonally off the bottom-right corner.
      const edit = state.edit;
      let range: Range | null = null;
      if (touchUiRef.current && !chartSheet && store.charts.selected?.sheet !== state.activeSheet && !store.pictures.selected) {
        if (!edit) range = sel;
        else if (store.touchRef && edit.point && edit.sheet === state.activeSheet) range = normalize({ anchor: edit.point.anchor, focus: edit.point.focus });
      }
      const z = pinchZoomRef.current ?? zoomNow;
      const size = TOUCH_HANDLE_HIT / z;
      const inside = (x: number, y: number) => x >= hw - 1 && y >= hh - 1 && x <= hw + l.width + 1 && y <= hh + l.height + 1;
      const place = (el: HTMLDivElement | null, x: number, y: number, show: boolean) => {
        if (!el) return;
        if (!show || !inside(x, y)) {
          el.style.display = "none";
          return;
        }
        el.style.display = "flex";
        el.style.width = el.style.height = `${size}px`;
        el.style.left = `${x - size / 2}px`;
        el.style.top = `${y - size / 2}px`;
        el.style.setProperty("--rs-hz", String(z));
      };
      if (range) {
        const x0 = hw + screenX(l, data.colGeo.offset(range.c0)), y0 = hh + screenY(l, data.rowGeo.offset(range.r0));
        const x1 = hw + screenX(l, data.colGeo.offset(range.c1 + 1)), y1 = hh + screenY(l, data.rowGeo.offset(range.r1 + 1));
        // Whole rows or columns get no handles (their far corner is off the sheet).
        const whole = isWholeCols(range) || isWholeRows(range);
        place(startHandle.current, x0, y0, !whole);
        place(endHandle.current, x1, y1, !whole);
        const off = TOUCH_FILL_OFFSET / z;
        place(touchFill.current, x1 + off, y1 + off, !edit && !whole && inside(x1, y1));
      } else {
        for (const el of [startHandle.current, endHandle.current, touchFill.current]) if (el) el.style.display = "none";
      }
    }

    const box = editorBox.current;
    if (box) {
      const at = state.edit?.cell ?? store.activeAnchor();
      const m = mergeAt(data.merges ?? [], at.row, at.col) ?? { r0: at.row, c0: at.col, r1: at.row, c1: at.col };
      box.style.left = `${hw + screenX(l, data.colGeo.offset(m.c0))}px`;
      box.style.top = `${hh + screenY(l, data.rowGeo.offset(m.r0))}px`;
      box.style.minWidth = `${data.colGeo.offset(m.c1 + 1) - data.colGeo.offset(m.c0) + 1}px`;
      box.style.height = `${data.rowGeo.offset(m.r1 + 1) - data.rowGeo.offset(m.r0) + 1}px`;
    }

    const vbox = validationBox.current;
    if (vbox) {
      const a = store.activeAnchor();
      const m = mergeAt(data.merges ?? [], a.row, a.col) ?? { r0: a.row, c0: a.col, r1: a.row, c1: a.col };
      vbox.style.left = `${hw + screenX(l, data.colGeo.offset(m.c0))}px`;
      vbox.style.top = `${hh + screenY(l, data.rowGeo.offset(m.r0))}px`;
      vbox.style.width = `${data.colGeo.offset(m.c1 + 1) - data.colGeo.offset(m.c0)}px`;
      vbox.style.height = `${data.rowGeo.offset(m.r1 + 1) - data.rowGeo.offset(m.r0)}px`;
    }

    // The error indicator sits at the active cell (P9-C4).
    const ebox = errorBox.current;
    if (ebox) {
      const a = store.activeAnchor();
      const m = mergeAt(data.merges ?? [], a.row, a.col) ?? { r0: a.row, c0: a.col, r1: a.row, c1: a.col };
      ebox.style.left = `${hw + screenX(l, data.colGeo.offset(m.c0))}px`;
      ebox.style.top = `${hh + screenY(l, data.rowGeo.offset(m.r0))}px`;
      ebox.style.width = `${data.colGeo.offset(m.c1 + 1) - data.colGeo.offset(m.c0)}px`;
      ebox.style.height = `${data.rowGeo.offset(m.r1 + 1) - data.rowGeo.offset(m.r0)}px`;
    }

    const tbox = chartTextBox.current;
    const te = store.charts.textEdit;
    const tsel = store.charts.selected;
    if (tbox && te && tsel && tsel.sheet === state.activeSheet) {
      const frame = store.charts.frames(state.activeSheet).find((f) => f.obj.id === tsel.id);
      const b = frame?.scene ? elementBounds(frame.scene, te.element) : null;
      if (frame && b) {
        tbox.style.left = `${hw + screenX(l, frame.rect.x + b.x)}px`;
        tbox.style.top = `${hh + screenY(l, frame.rect.y + b.y)}px`;
        tbox.style.minWidth = `${Math.max(80, b.w)}px`;
        tbox.style.height = `${Math.max(20, b.h)}px`;
      }
    }

    // The annotation layer (note boxes, cards) follows the scroll position.
    store.comments.screen = (x, y) => ({ x: screenX(l, x), y: screenY(l, y) });
    store.comments.positioner?.();
    store.slicers.positioner?.();
    store.flashPositioner?.();

    const tag = spillBox.current;
    if (tag) {
      const a = store.activeAnchor();
      tag.style.left = `${hw + screenX(l, data.colGeo.offset(a.col)) - SPILL_TAG_W - 2}px`;
      tag.style.top = `${hh + screenY(l, data.rowGeo.offset(a.row)) + 1}px`;
    }

    const t1 = performance.now();
    const st = perf.current;
    st.frames++;
    st.totalMs += t1 - t0;
    st.maxMs = Math.max(st.maxMs, t1 - t0);
    if (st.lastFrameAt && t0 - st.lastFrameAt < 100) {
      st.intervals++;
      st.intervalSum += t0 - st.lastFrameAt;
    }
    st.lastFrameAt = t0;
    if (perfBox.current) {
      const fps = st.intervals ? 1000 / (st.intervalSum / st.intervals) : 0;
      perfBox.current.textContent =
        `draw avg ${(st.totalMs / st.frames).toFixed(2)} ms · max ${st.maxMs.toFixed(1)} ms · ${fps.toFixed(0)} fps · ${st.frames} frames`;
      const w = window as unknown as { __calcPerf?: PerfStats; __calcPerfReset?: () => void };
      w.__calcPerf = { frames: st.frames, avgDrawMs: st.totalMs / st.frames, maxDrawMs: st.maxMs, fps };
      w.__calcPerfReset = () => {
        perf.current = { frames: 0, totalMs: 0, maxMs: 0, lastFrameAt: 0, intervals: 0, intervalSum: 0 };
      };
    }
  }, [store, sheetData, layout, headerSize, handleRect, gutter]);

  const schedule = useCallback(() => {
    if (raf.current !== null) return;
    if (typeof requestAnimationFrame === "function") raf.current = requestAnimationFrame(draw);
    else draw();
  }, [draw]);

  useEffect(() => {
    // While an edit is open (e.g. after a toolbar click) the focus belongs to its editor.
    store.focusGrid = () => {
      if (store.getState().edit) store.focusEditor();
      else scroller.current?.focus({ preventScroll: true });
    };
    const unsub = store.subscribe(schedule);
    schedule();
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined" && scroller.current) {
      ro = new ResizeObserver(schedule);
      ro.observe(scroller.current);
    }
    return () => {
      unsub();
      ro?.disconnect();
      if (raf.current !== null && typeof cancelAnimationFrame === "function") cancelAnimationFrame(raf.current);
      raf.current = null;
    };
  }, [store, schedule]);

  useEffect(() => {
    const m = canvasMeasure();
    if (m) store.measure = m;
  }, [store]);

  useEffect(
    // `data-busy` while the core has requests pending (e2e `grid.waitIdle()`); set directly, no re-render.
    () => store.watchBusy((busy) => scroller.current?.toggleAttribute("data-busy", busy)),
    [store],
  );

  useEffect(() => {
    // View › Split: the wheel over a left / top pane scrolls that pane (the scroll bars move the others).
    const el = scroller.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      const l = layout();
      if (!isSplit(l)) return;
      const rect = el.getBoundingClientRect();
      const scale = screenScale(el);
      const { hw, hh } = headerSize();
      const at = splitPaneAt(l, (e.clientX - rect.left) / scale - hw, (e.clientY - rect.top) / scale - hh);
      const dy = at.row === 0 && (l.splitY ?? 0) > 0 ? e.deltaY : 0;
      const dx = at.col === 0 && (l.splitX ?? 0) > 0 ? (e.shiftKey ? e.deltaY : e.deltaX) : 0;
      if (dy === 0 && dx === 0) return;
      if ((dy !== 0 && e.deltaX !== 0 && dx === 0) || (dx !== 0 && !e.shiftKey && e.deltaY !== 0 && dy === 0)) return;
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 20 : e.deltaMode === 2 ? 400 : 1;
      split0.current = { x: Math.max(0, split0.current.x + dx * unit), y: Math.max(0, split0.current.y + dy * unit) };
      schedule();
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [layout, headerSize, schedule]);

  // --- pinch zoom (P10-M3) ------------------------------------------------

  const pinchRoot = () => scroller.current?.parentElement?.getBoundingClientRect() ?? null;
  const pinchStart = (source: "pointer" | "touch", a: { x: number; y: number }, b: { x: number; y: number }) => {
    const el = scroller.current;
    const root = pinchRoot();
    if (!el || !root) return;
    const d0 = pinchDistance(a, b);
    if (d0 < 1) return;
    const z0 = pinchZoomRef.current ?? store.sheetView().zoom / 100;
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    if (!pinch.current) {
      pinchSeq.current++;
      // The first finger's press selected (a header, a drag): a pinch leaves the selection as it was.
      const before = touchDownSel.current;
      touchDownSel.current = null;
      if (before && !store.getState().edit) store.select(before);
    }
    pinch.current = { source, d0, z0, sx: el.scrollLeft + (cx - root.left) / z0, sy: el.scrollTop + (cy - root.top) / z0 };
    // The browser must not pan while the fingers zoom.
    el.style.touchAction = "none";
  };
  const pinchMove = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const p = pinch.current;
    const root = pinchRoot();
    if (!p || !root) return;
    const z = clampZoom((p.z0 * pinchDistance(a, b)) / p.d0);
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    pinchScroll.current = { left: Math.max(0, p.sx - (cx - root.left) / z), top: Math.max(0, p.sy - (cy - root.top) / z) };
    setPinchZoom(z);
  };
  const pinchEnd = () => {
    if (!pinch.current) return;
    pinch.current = null;
    if (scroller.current) scroller.current.style.touchAction = "";
    const z = pinchZoomRef.current;
    if (z === null) return;
    const zoom = Math.round(z * 100);
    void store.setSheetView({ zoom }).finally(() => {
      pinchScroll.current = null;
      setPinchZoom(null);
    });
  };
  const pinchRef = useRef({ start: pinchStart, move: pinchMove, end: pinchEnd });
  pinchRef.current = { start: pinchStart, move: pinchMove, end: pinchEnd };

  useLayoutEffect(() => {
    const el = scroller.current;
    const at = pinchScroll.current;
    if (pinchZoom === null || !el || !at) return;
    el.scrollLeft = at.left;
    el.scrollTop = at.top;
    schedule();
  }, [pinchZoom, schedule]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    // Two touch pointers pinch (pointer events: hybrids and the tests) …
    const pts = new Map<number, { x: number; y: number }>();
    const two = () => [...pts.values()].slice(0, 2) as [{ x: number; y: number }, { x: number; y: number }];
    const down = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2 && !pinch.current) pinchRef.current.start("pointer", ...two());
    };
    const move = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch.current?.source === "pointer" && pts.size >= 2) pinchRef.current.move(...two());
    };
    const up = (e: PointerEvent) => {
      if (!pts.delete(e.pointerId)) return;
      if (pinch.current?.source === "pointer" && pts.size < 2) pinchRef.current.end();
    };
    // … and two touches (phones: the browser may cancel the pointers when it starts panning; the touches go on).
    const pt = (t: Touch) => ({ x: t.clientX, y: t.clientY });
    const tstart = (e: TouchEvent) => {
      if (e.touches.length >= 2) {
        if (e.cancelable) e.preventDefault();
        pinchRef.current.start("touch", pt(e.touches[0]!), pt(e.touches[1]!));
        return;
      }
      // One finger on the headers, a border or the corner selects or resizes, and in Ref mode on cells it points:
      // no native panning then.
      const t = e.touches[0];
      if (!t) return;
      const h = hitTestRef.current(t.clientX, t.clientY, true);
      const headers = h.kind === "colHeader" || h.kind === "rowHeader" || h.kind === "colEdge" || h.kind === "rowEdge" || h.kind === "corner" || h.kind === "outline" || h.kind === "splitter";
      const pointing = h.kind === "cell" && !!store.getState().edit && store.touchRef;
      if ((headers || pointing) && e.cancelable) e.preventDefault();
    };
    const tmove = (e: TouchEvent) => {
      if (pinch.current?.source !== "touch" || e.touches.length < 2) return;
      if (e.cancelable) e.preventDefault();
      pinchRef.current.move(pt(e.touches[0]!), pt(e.touches[1]!));
    };
    const tend = (e: TouchEvent) => {
      if (pinch.current?.source === "touch" && e.touches.length < 2) pinchRef.current.end();
    };
    el.addEventListener("pointerdown", down, true);
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
    el.addEventListener("touchstart", tstart, { passive: false });
    el.addEventListener("touchmove", tmove, { passive: false });
    el.addEventListener("touchend", tend);
    el.addEventListener("touchcancel", tend);
    return () => {
      el.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
      el.removeEventListener("touchstart", tstart);
      el.removeEventListener("touchmove", tmove);
      el.removeEventListener("touchend", tend);
      el.removeEventListener("touchcancel", tend);
    };
  }, [store]);

  useEffect(() => {
    // The scroll position for Freeze Panes and Save; the split for View › Split.
    store.viewport = () => {
      const l = layout();
      const data = sheetData();
      const v = store.sheetView();
      const main = mainPane(l).vp;
      const paneRow = data.rowGeo.indexAt(main.scrollY);
      const paneCol = data.colGeo.indexAt(main.scrollX);
      const split = isSplit(l);
      return {
        sheet: store.getState().activeSheet,
        topRow: v.frozenRows > 0 ? (v.topRow ?? 0) : split && (l.splitY ?? 0) > 0 ? data.rowGeo.indexAt(l.scrollY0 ?? 0) : paneRow,
        leftCol: v.frozenCols > 0 ? (v.leftCol ?? 0) : split && (l.splitX ?? 0) > 0 ? data.colGeo.indexAt(l.scrollX0 ?? 0) : paneCol,
        paneRow,
        paneCol,
      };
    };
    store.splitHere = () => {
      const l = layout();
      const data = sheetData();
      const a = store.activeAnchor();
      const vp = store.viewport!();
      // At the active cell's top-left corner; with the first visible cell active, in the middle of the window (Excel).
      let sx = a.col > vp.paneCol ? screenX(l, data.colGeo.offset(a.col)) : 0;
      let sy = a.row > vp.paneRow ? screenY(l, data.rowGeo.offset(a.row)) : 0;
      if (sx <= 0 || sx >= l.width) sx = 0;
      if (sy <= 0 || sy >= l.height) sy = 0;
      if (sx === 0 && sy === 0) {
        sx = Math.round(l.width / 2);
        sy = Math.round(l.height / 2);
      }
      const rowAt = sy > 0 ? data.rowGeo.indexAt(axisToSheetY(l, sy)) : vp.paneRow;
      const colAt = sx > 0 ? data.colGeo.indexAt(axisToSheetX(l, sx)) : vp.paneCol;
      return {
        splitX: Math.round(sx * TWIPS_PER_PX), splitY: Math.round(sy * TWIPS_PER_PX),
        topRow: vp.paneRow, leftCol: vp.paneCol, paneRow: rowAt, paneCol: colAt,
      };
    };
    return () => {
      store.viewport = null;
      store.splitHere = null;
    };
  }, [store, layout, sheetData]);

  useEffect(() => {
    // Animate the marching ants while a copy/cut is pending.
    if (!clipMark) return;
    const id = setInterval(schedule, 120);
    return () => clearInterval(id);
  }, [clipMark, schedule]);

  /** Scrolls to the sheet view's saved position (`topLeftCell`s): a sheet shown or opened, panes frozen or split. */
  const scrollToView = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const v = store.sheetView();
    const data = sheetData();
    const top = v.topRow ?? 0, left = v.leftCol ?? 0;
    const frozenR = v.frozenRows, frozenC = v.frozenCols;
    const split = frozenR === 0 && frozenC === 0 && ((v.splitX ?? 0) > 0 || (v.splitY ?? 0) > 0);
    // The scrolling pane's first row / column.
    const paneRow = frozenR > 0 ? Math.max(v.paneRow ?? 0, top + frozenR) : split && (v.splitY ?? 0) > 0 ? (v.paneRow ?? 0) : top;
    const paneCol = frozenC > 0 ? Math.max(v.paneCol ?? 0, left + frozenC) : split && (v.splitX ?? 0) > 0 ? (v.paneCol ?? 0) : left;
    grow.current = { rows: Math.max(grow.current.rows, paneRow + 60), cols: Math.max(grow.current.cols, paneCol + 20) };
    split0.current = { x: split ? data.colGeo.offset(left) : 0, y: split ? data.rowGeo.offset(top) : 0 };
    draw(); // size the spacer before scrolling
    el.scrollTop = Math.max(0, data.rowGeo.offset(paneRow) - (frozenR > 0 ? data.rowGeo.offset(top + frozenR) : 0));
    el.scrollLeft = Math.max(0, data.colGeo.offset(paneCol) - (frozenC > 0 ? data.colGeo.offset(left + frozenC) : 0));
  }, [store, sheetData]);

  useEffect(() => {
    // A sheet shown: at its saved scroll position (A1 for a new one).
    grow.current = { rows: 0, cols: 0 };
    scrollToView();
    schedule();
  }, [activeSheet, schedule, scrollToView]);

  useEffect(schedule, [sheetView, schedule]);
  // The touch handles follow the touch switch, Ref mode and the pinch zoom.
  useEffect(schedule, [touchUi, refMode, pinchZoom, schedule]);

  // Freezing / unfreezing / splitting: the panes start where the view says (frozen while scrolled keeps the position).
  const paneKey = `${sheetView.frozenRows},${sheetView.frozenCols},${sheetView.topRow ?? 0},${sheetView.leftCol ?? 0},${(sheetView.splitX ?? 0) > 0},${(sheetView.splitY ?? 0) > 0}`;
  const lastPaneKey = useRef(paneKey);
  useEffect(() => {
    if (lastPaneKey.current === paneKey) return;
    lastPaneKey.current = paneKey;
    // A splitter moved by dragging keeps both panes where they are.
    if (store.keepScrollOnce) {
      store.keepScrollOnce = false;
      return;
    }
    scrollToView();
  }, [paneKey, scrollToView, store]);

  /** Screen px per grid px (the CSS zoom, as the browser applies it). */
  const screenScale = (el: HTMLElement): number => {
    const w = el.offsetWidth;
    const s = w > 0 ? el.getBoundingClientRect().width / w : 1;
    return Number.isFinite(s) && s > 0 ? s : 1;
  };

  const onScroll = () => {
    const el = scroller.current;
    if (el) {
      const data = sheetData();
      const vp = mainPane(layout()).vp;
      const bottomRow = data.rowGeo.indexAt(vp.scrollY + vp.height);
      const rightCol = data.colGeo.indexAt(vp.scrollX + vp.width);
      // Grow the virtual area when the user nears its end.
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 4 * data.rowGeo.defaultSize) grow.current.rows = bottomRow + 100;
      if (el.scrollLeft + el.clientWidth >= el.scrollWidth - 2 * data.colGeo.defaultSize) grow.current.cols = rightCol + 20;
    }
    schedule();
  };

  // --- hit testing ------------------------------------------------------

  const hitTest = (clientX: number, clientY: number, touch = false): Hit => {
    const el = scroller.current;
    if (!el) return { kind: "none" };
    const rect = el.getBoundingClientRect();
    const scale = screenScale(el);
    const x = (clientX - rect.left) / scale;
    const y = (clientY - rect.top) / scale;
    if (x > el.clientWidth || y > el.clientHeight) return { kind: "none" }; // scrollbars
    const data = sheetData();
    const { hw, hh } = headerSize();
    const { gw, gh } = gutter();
    if (x < gw || y < gh) {
      const bars = outlineBars(layout(), data);
      const hit = outlineHitAt(x, y, bars.rows, bars.cols, bars.layout);
      return hit ? { kind: "outline", hit } : { kind: "none" };
    }
    // Per quadrant: frozen parts map 1:1, the rest is scrolled.
    const lay = layout();
    const { x: cx, y: cy } = toSheet(lay, x - hw, y - hh);
    if (x < hw && y < hh) return { kind: "corner" };
    if (x >= hw && y >= hh) {
      const sp = splitterAt(lay, x - hw, y - hh);
      if (sp) return { kind: "splitter", axis: sp };
    }
    if (x >= hw && y >= hh) {
      const sheet = store.getState().activeSheet;
      const psel = store.pictures.selected;
      if (psel && psel.sheet === sheet) {
        const f = store.pictures.frames(sheet).find((fr) => fr.pic.id === psel.id);
        const handle = f ? handleAt(f.rect, cx, cy) : null;
        if (f && handle) return { kind: "picture", id: f.pic.id, handle };
      }
      const pf = store.pictures.frameAt(sheet, cx, cy);
      if (pf) return { kind: "picture", id: pf.pic.id, handle: null };
      const sel = store.charts.selected;
      if (sel && sel.sheet === sheet) {
        const f = store.charts.frames(sheet).find((fr) => fr.obj.id === sel.id);
        const handle = f ? handleAt(f.rect, cx, cy) : null;
        if (f && handle) return { kind: "chartHandle", id: f.obj.id, handle };
      }
      const f = store.charts.frameAt(sheet, cx, cy);
      if (f) return { kind: "chart", id: f.obj.id, element: f.scene ? hitTestChart(f.scene, cx - f.rect.x, cy - f.rect.y) : null };
    }
    if (x >= hw && y >= hh && !store.getState().edit) {
      const h = handleRect(normalize(store.getState().selection));
      const hx = x - hw - (h?.x ?? 0) - HANDLE / 2;
      const hy = y - hh - (h?.y ?? 0) - HANDLE / 2;
      if (h && Math.abs(hx) <= HANDLE_SLOP && Math.abs(hy) <= HANDLE_SLOP) return { kind: "fillHandle" };
    }
    if (y < hh) {
      const col = data.colGeo.indexAt(cx);
      const start = data.colGeo.offset(col);
      const end = start + data.colGeo.size(col);
      const slop = touch ? RESIZE_SLOP_TOUCH : RESIZE_SLOP;
      if (end - cx <= slop) return { kind: "colEdge", col };
      if (cx - start <= slop && col > 0) return { kind: "colEdge", col: col - 1 };
      return { kind: "colHeader", col };
    }
    if (x < hw) {
      const row = data.rowGeo.indexAt(cy);
      const start = data.rowGeo.offset(row);
      const end = start + data.rowGeo.size(row);
      const slop = touch ? RESIZE_SLOP_TOUCH / 2 : RESIZE_SLOP / 2;
      if (end - cy <= slop + 1) return { kind: "rowEdge", row };
      if (cy - start <= slop && row > 0) return { kind: "rowEdge", row: row - 1 };
      return { kind: "rowHeader", row };
    }
    if (store.getState().pageBreakPreview && !store.getState().edit) {
      const line = breakLineAt(data.colGeo, data.rowGeo, breakLines(data).lines, cx, cy);
      if (line) return { kind: "pageBreak", line };
    }
    const pivotButton = store.pivots.buttonAt(store.getState().activeSheet, data.colGeo, data.rowGeo, cx, cy);
    if (pivotButton) return { kind: "pivotButton", button: pivotButton };
    const filterCol = filterButtonAt(data.colGeo, data.rowGeo, store.autoFilter(), cx, cy);
    if (filterCol !== null) return { kind: "filterButton", col: filterCol };
    const sheetNow = store.getState().activeSheet;
    const tf = store.tables.filterButtonAt(sheetNow, data.colGeo, data.rowGeo, cx, cy);
    if (tf) return { kind: "tableFilter", table: tf.table, col: tf.col };
    {
      const a = store.getState().selection.anchor;
      const tc = store.tables.totalsCellAt(a.row, a.col);
      const b = tc && totalsButton(data.colGeo, data.rowGeo, a.row, a.col);
      if (tc && b && cx >= b.x - 2 && cx <= b.x + b.size + 2 && cy >= b.y - 2 && cy <= b.y + b.size + 2) return { kind: "totalsButton", table: tc.table.id, col: a.col };
    }
    return { kind: "cell", cell: { row: data.rowGeo.indexAt(cy), col: data.colGeo.indexAt(cx) } };
  };

  const hitTestRef = useRef(hitTest);
  hitTestRef.current = hitTest;

  // --- selection handles (P10-M3) ---------------------------------------

  /** The cell a handle's corner at a client point stands for (`bias` −1: a bottom-right corner, 1: a top-left one). */
  const cellUnder = (clientX: number, clientY: number, bias: number): Cell => {
    const el = scroller.current;
    const data = sheetData();
    if (!el) return { row: 0, col: 0 };
    const rect = el.getBoundingClientRect();
    const scale = screenScale(el);
    const { hw, hh } = headerSize();
    const l = layout();
    const x = Math.max(0, Math.min(l.width - 1, (clientX - rect.left) / scale - hw));
    const y = Math.max(0, Math.min(l.height - 1, (clientY - rect.top) / scale - hh));
    const p = toSheet(l, x, y);
    return {
      row: data.rowGeo.indexAt(Math.max(0, p.y + (bias * data.rowGeo.defaultSize) / 2)),
      col: data.colGeo.indexAt(Math.max(0, p.x + (bias * data.colGeo.defaultSize) / 2)),
    };
  };

  /**
   * Drags a selection handle (the range's top-left or bottom-right corner, cell by cell; at the edges the grid scrolls)
   * or the touch fill handle (a tap opens the Fill sheet). In Ref mode the handles resize the pointed reference.
   */
  const handlePointer = (which: "start" | "end" | "fill", e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.pointerType === "touch") noteTouch();
    const el = scroller.current;
    if (!el) return;
    const box = e.currentTarget.getBoundingClientRect();
    const off = which === "fill" ? (box.width * TOUCH_FILL_OFFSET) / TOUCH_HANDLE_HIT : 0;
    // The pointer's offset from the corner the handle stands for.
    const gx = e.clientX - (box.left + box.width / 2 - off), gy = e.clientY - (box.top + box.height / 2 - off);
    const st = store.getState();
    const src = normalize(st.selection);
    const point = st.edit && store.touchRef ? st.edit.point : null;
    const range = point ? normalize({ anchor: point.anchor, focus: point.focus }) : src;
    const fixed: Cell = which === "start" ? { row: range.r1, col: range.c1 } : { row: range.r0, col: range.c0 };
    const x0 = e.clientX, y0 = e.clientY;
    let last = { x: e.clientX, y: e.clientY };
    let moved = false;
    const update = () => {
      const cell = cellUnder(last.x - gx, last.y - gy, which === "start" ? 1 : -1);
      if (which === "fill") {
        fillPreview.current = fillTarget(src, cell);
        schedule();
      } else if (point) store.pointRange(fixed, cell);
      else store.select({ anchor: fixed, focus: cell });
    };
    const timer = setInterval(() => {
      if (!moved) return;
      const rect = el.getBoundingClientRect();
      const scale = screenScale(el);
      const { hw, hh } = headerSize();
      const l = layout();
      const data = sheetData();
      const dx = edgeScroll((last.x - rect.left) / scale - hw, l.width, data.colGeo.defaultSize);
      const dy = edgeScroll((last.y - rect.top) / scale - hh, l.height, data.rowGeo.defaultSize);
      if (dx === 0 && dy === 0) return;
      if (dy > 0) grow.current.rows = Math.max(grow.current.rows, data.rowGeo.indexAt(l.scrollY + l.height) + 50);
      if (dx > 0) grow.current.cols = Math.max(grow.current.cols, data.colGeo.indexAt(l.scrollX + l.width) + 10);
      draw();
      el.scrollLeft += dx;
      el.scrollTop += dy;
      update();
    }, 60);
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      last = { x: ev.clientX, y: ev.clientY };
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
      moved = true;
      update();
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      clearInterval(timer);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (which === "fill") {
        const dst = fillPreview.current;
        fillPreview.current = null;
        schedule();
        if (moved && dst) void store.fill(dst, "auto");
        else if (!moved && ev.type === "pointerup") openFillSheet();
        return;
      }
      if (moved && !point) void store.selectionDone();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };
  const openFillSheet = () => setFillSheet(true);

  const scrollIntoView = (cell: Cell) => {
    const el = scroller.current;
    if (!el) return;
    const data = sheetData();
    const l = layout();
    // A merged cell scrolls in as a whole.
    const m = mergeAt(data.merges ?? [], cell.row, cell.col) ?? { r0: cell.row, c0: cell.col, r1: cell.row, c1: cell.col };
    const x0 = data.colGeo.offset(m.c0);
    const x1 = data.colGeo.offset(m.c1 + 1);
    const y0 = data.rowGeo.offset(m.r0);
    const y1 = data.rowGeo.offset(m.r1 + 1);
    if (cell.row + 20 > grow.current.rows) grow.current.rows = cell.row + 50;
    if (cell.col + 5 > grow.current.cols) grow.current.cols = cell.col + 10;
    draw(); // resize the spacer before scrolling
    const top = axisScrollTo(l.frozenH, l.scrollY, l.height, y0, y1, extrasY(l));
    const left = axisScrollTo(l.frozenW, l.scrollX, l.width, x0, x1, extrasX(l));
    if (top !== null) el.scrollTop = top;
    if (left !== null) el.scrollLeft = left;
  };

  // Keyboard pointing may move the reference cursor off screen.
  const scrollRef = useRef(scrollIntoView);
  scrollRef.current = scrollIntoView;
  // The Name Box and Go To scroll their target into view (after the sheet switch renders).
  useEffect(() => {
    store.revealCell = (row, col) => requestAnimationFrame(() => scrollRef.current({ row, col }));
    return () => {
      store.revealCell = null;
    };
  }, [store]);
  useEffect(
    () =>
      store.subscribe(() => {
        const focus = store.getState().edit?.point?.focus ?? null;
        if (focus && focus !== lastPoint.current) scrollRef.current(focus);
        lastPoint.current = focus;
      }),
    [store],
  );

  // --- mouse ------------------------------------------------------------

  /** Opens the AutoFilter dropdown of column `col` under its header cell. */
  const openFilterMenu = (col: number) => {
    const el = scroller.current;
    const af = store.autoFilter();
    const b = af && filterButton(sheetData().colGeo, sheetData().rowGeo, af, col);
    if (!el || !af || !b) return;
    const data = sheetData();
    const l = layout();
    const { hw, hh } = headerSize();
    const rect = el.getBoundingClientRect();
    const scale = screenScale(el);
    const x = rect.left + (hw + screenX(l, data.colGeo.offset(col))) * scale;
    const y = rect.top + (hh + screenY(l, data.rowGeo.offset(af.r0 + 1))) * scale;
    store.openDialog({ kind: "filterMenu", col, at: { x: Math.max(0, x), y: Math.max(0, y) } });
  };

  /** Opens the filter dropdown of a pivot header or page cell under it. */
  const openPivotFilter = (b: Extract<PivotButton, { kind: "drop" }>) => {
    const el = scroller.current;
    if (!el) return;
    const data = sheetData();
    const l = layout();
    const { hw, hh } = headerSize();
    const rect = el.getBoundingClientRect();
    const scale = screenScale(el);
    const x = rect.left + (hw + screenX(l, data.colGeo.offset(b.col))) * scale;
    const y = rect.top + (hh + screenY(l, data.rowGeo.offset(b.row + 1))) * scale;
    store.select(cellSelection(b.row, b.col));
    store.openDialog({ kind: "pivotFilter", id: b.id, target: b.target, at: { x: Math.max(0, x), y: Math.max(0, y) } });
  };

  /** Opens the filter dropdown of a table header (or the totals menu) under the cell. */
  const openCellMenu = (row: number, col: number, open: (at: { x: number; y: number }) => void) => {
    const el = scroller.current;
    if (!el) return;
    const data = sheetData();
    const l = layout();
    const { hw, hh } = headerSize();
    const rect = el.getBoundingClientRect();
    const scale = screenScale(el);
    const x = rect.left + (hw + screenX(l, data.colGeo.offset(col))) * scale;
    const y = rect.top + (hh + screenY(l, data.rowGeo.offset(row + 1))) * scale;
    open({ x: Math.max(0, x), y: Math.max(0, y) });
  };

  /** Click / drag on a picture: select, move, or resize with a handle (Alt snaps to cell edges). */
  const picturePointer = (hit: Extract<Hit, { kind: "picture" }>, e: ReactPointerEvent<HTMLDivElement>) => {
    if (store.getState().edit) {
      void store.commitEdit(0, 0);
      if (store.getState().edit) return;
    }
    scroller.current?.focus({ preventScroll: true });
    const sheet = store.getState().activeSheet;
    const pics = store.pictures;
    if (pics.selected?.id !== hit.id) pics.select(sheet, hit.id);
    const frame = pics.frames(sheet).find((f) => f.pic.id === hit.id);
    if (!frame) return;
    const geo = store.geometry(sheet);
    const start = frame.rect;
    const scale = scroller.current ? screenScale(scroller.current) : 1;
    const x0 = e.clientX;
    const y0 = e.clientY;
    let moved = false;
    // Picture Format › Crop: the handles cut the image instead of scaling it.
    const cropping = pics.cropping && !!hit.handle;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - x0) / scale;
      const dy = (ev.clientY - y0) / scale;
      if (!moved && Math.hypot(dx, dy) < 3) return;
      moved = true;
      const snap = ev.altKey ? { col: geo.col, row: geo.row } : undefined;
      const rect = hit.handle ? resizeRect(start, hit.handle, dx, dy, cropping ? undefined : snap) : moveRect(start, dx, dy, snap);
      pics.preview = cropping ? { id: hit.id, rect, crop: cropFor(start, rect, frame.pic.crop) } : { id: hit.id, rect };
      schedule();
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      const p = pics.preview;
      if (moved && p && p.crop) void pics.setCrop(p.rect, p.crop).finally(() => (pics.preview = null));
      else if (moved && p) void pics.setRect(p.rect).finally(() => (pics.preview = null));
      else pics.preview = null;
      schedule();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  // Pointer events (mobile guardrail): a press on a filter button opens its dropdown; the rest is the mouse path below.
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if (e.pointerType === "touch") {
      noteTouch();
      // The second finger of a pinch is not a press on the grid.
      if (!e.isPrimary || pinch.current) return;
      touchDownSel.current = store.getState().selection;
    }
    const hit = hitTest(e.clientX, e.clientY, e.pointerType === "touch");
    if (hit.kind === "splitter") {
      // Dragging a splitter moves it; dropped at the window's edge it goes away (Excel).
      e.preventDefault();
      const el = scroller.current;
      if (!el) return;
      const { hw, hh } = headerSize();
      const scale = screenScale(el);
      const rect = el.getBoundingClientRect();
      const start = layout();
      const move = (ev: PointerEvent) => {
        const px = (ev.clientX - rect.left) / scale - hw;
        const py = (ev.clientY - rect.top) / scale - hh;
        splitDrag.current = {
          ...(hit.axis !== "y" ? { x: Math.max(0, Math.min(start.width, px)) } : {}),
          ...(hit.axis !== "x" ? { y: Math.max(0, Math.min(start.height, py)) } : {}),
        };
        schedule();
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
        const d = splitDrag.current;
        splitDrag.current = null;
        if (!d) return;
        const twips = (px: number | undefined, size: number) => (px === undefined ? undefined : px < 8 || px > size - 8 ? 0 : Math.round(px * TWIPS_PER_PX));
        const sx = twips(d.x, start.width), sy = twips(d.y, start.height);
        store.keepScrollOnce = sx !== 0 && sy !== 0;
        void store.setSheetView({ ...(sx !== undefined ? { splitX: sx } : {}), ...(sy !== undefined ? { splitY: sy } : {}) });
        schedule();
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
      return;
    }
    if (hit.kind === "chart" || hit.kind === "chartHandle") {
      store.pictures.deselect();
      store.slicers.deselect();
      e.preventDefault();
      chartPointer(hit, e);
      return;
    }
    if (hit.kind === "picture") {
      e.preventDefault();
      picturePointer(hit, e);
      return;
    }
    if (hit.kind === "pageBreak") {
      // Dragging a break line moves it (an automatic one becomes manual, as in Excel).
      e.preventDefault();
      const line = hit.line;
      let to = line.index;
      const move = (ev: PointerEvent) => {
        const h = hitTest(ev.clientX, ev.clientY);
        if (h.kind === "cell") to = Math.max(1, line.axis === "rows" ? h.cell.row : h.cell.col);
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        if (to === line.index) return;
        const sheet = store.getState().activeSheet;
        const info = store.getState().info?.sheets.find((x) => x.id === sheet);
        const list = (line.axis === "rows" ? info?.rowBreaks : info?.colBreaks) ?? [];
        void store.apply({ type: "setPageBreaks", sheet, axis: line.axis, breaks: withBreak(withoutBreak(list, line.index), to) });
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      return;
    }
    if (hit.kind === "outline") {
      e.preventDefault();
      scroller.current?.focus({ preventScroll: true });
      const sheet = store.getState().activeSheet;
      const h = hit.hit;
      void (h.kind === "level"
        ? store.apply({ type: "showOutlineLevel", sheet, axis: h.axis, level: h.level })
        : store.apply({ type: "setOutlineCollapsed", sheet, axis: h.axis, index: h.index, collapsed: h.collapsed }));
      return;
    }
    if (hit.kind === "tableFilter") {
      e.preventDefault();
      const t0 = store.tables.get(hit.table)?.table;
      if (t0) openCellMenu(t0.r0, hit.col, (at) => store.openDialog({ kind: "filterMenu", col: hit.col, at, table: hit.table }));
      return;
    }
    if (hit.kind === "totalsButton") {
      e.preventDefault();
      const a = store.getState().selection.anchor;
      openCellMenu(a.row, a.col, (at) => store.openDialog({ kind: "totalsMenu", id: hit.table, col: hit.col, at }));
      return;
    }
    if (hit.kind === "pivotButton") {
      e.preventDefault();
      if (store.getState().edit) return;
      scroller.current?.focus({ preventScroll: true });
      if (hit.button.kind === "expand") void store.pivots.pressExpand(hit.button);
      else openPivotFilter(hit.button);
      return;
    }
    if (hit.kind === "filterButton") {
      e.preventDefault();
      openFilterMenu(hit.col);
      return;
    }
    cellPointer(e, hit);
  };

  /** Click / drag on a chart: select (element), move, or resize with a handle; Alt snaps to cell edges. */
  const chartPointer = (hit: Extract<Hit, { kind: "chart" | "chartHandle" }>, e: ReactPointerEvent<HTMLDivElement>) => {
    if (store.getState().edit) {
      void store.commitEdit(0, 0);
      if (store.getState().edit) return;
    }
    scroller.current?.focus({ preventScroll: true });
    const sheet = store.getState().activeSheet;
    const charts = store.charts;
    const before = charts.selected;
    const el = hit.kind === "chart" ? hit.element : null;
    // A second press on the selected title, legend or plot area drags it inside the chart (a manual layout).
    const dragEl = el && before?.id === hit.id && before.element && sameElement(before.element, el) && (el.type === "title" || el.type === "legend" || el.type === "plotArea") ? el : null;
    if (!dragEl && hit.kind === "chart" && charts.click(sheet, hit.id, hit.element)) return;
    const obj = charts.get(sheet, hit.id);
    if (!obj) return;
    if (dragEl) {
      const frame = charts.frames(sheet).find((f) => f.obj.id === hit.id);
      const scene = frame?.scene;
      if (!scene) return;
      const sc = scroller.current ? screenScale(scroller.current) : 1;
      const [ex0, ey0] = [e.clientX, e.clientY];
      let dragged = false;
      const mv = (ev: PointerEvent) => {
        const dx = (ev.clientX - ex0) / sc;
        const dy = (ev.clientY - ey0) / sc;
        if (!dragged && Math.hypot(dx, dy) < 3) return;
        dragged = true;
        const next = charts.movedLayout(obj.chart, scene, dragEl, dx, dy);
        charts.layoutPreview = next ? { id: obj.id, chart: next } : null;
        schedule();
      };
      const done = () => {
        window.removeEventListener("pointermove", mv);
        window.removeEventListener("pointerup", done);
        const p = charts.layoutPreview;
        charts.layoutPreview = null;
        if (dragged && p) void charts.edit(() => p.chart);
        else if (!dragged && hit.kind === "chart") charts.click(sheet, hit.id, hit.element);
        schedule();
      };
      window.addEventListener("pointermove", mv);
      window.addEventListener("pointerup", done);
      return;
    }
    // A chart sheet's chart neither moves nor resizes.
    if (store.isChartSheet(sheet)) return;
    const geo = store.geometry(sheet);
    const start = anchorRect(obj.anchor, geo.col, geo.row);
    const scale = scroller.current ? screenScale(scroller.current) : 1;
    const x0 = e.clientX;
    const y0 = e.clientY;
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - x0) / scale;
      const dy = (ev.clientY - y0) / scale;
      if (!moved && Math.hypot(dx, dy) < 3) return;
      moved = true;
      const snap = ev.altKey ? { col: geo.col, row: geo.row } : undefined;
      const rect = hit.kind === "chartHandle" ? resizeRect(start, hit.handle, dx, dy, snap) : moveRect(start, dx, dy, snap);
      charts.preview = { id: hit.id, rect };
      schedule();
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const p = charts.preview;
      charts.preview = null;
      if (moved && p) void charts.setRect(p.rect);
      schedule();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // The mouse's own events only keep the focus and the text selection where they are: everything runs on
  // pointer events (mouse, pen and touch alike; the touch guardrail of the plan).
  const onMouseDown = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if (hitTest(e.clientX, e.clientY).kind !== "none") e.preventDefault();
  };

  /** A press on cells, headers, edges or the fill handle (the selection, resizing, filling, point mode). */
  const cellPointer = (e: ReactPointerEvent<HTMLDivElement>, first: Hit) => {
    let hit = first;
    if (hit.kind === "none") return;
    if (
      hit.kind === "chart" || hit.kind === "chartHandle" || hit.kind === "picture" || hit.kind === "outline" || hit.kind === "pageBreak" || hit.kind === "filterButton"
      || hit.kind === "tableFilter" || hit.kind === "totalsButton" || hit.kind === "splitter" || (hit.kind === "pivotButton" && !store.getState().edit)
    ) return;
    // Touch: a tap selects (on release, so that a swipe scrolls the sheet instead); no drag selection.
    if (e.pointerType === "touch" && hit.kind === "cell") {
      if (store.getState().edit && store.touchRef) {
        // Ref mode (P10-M3): a tap inserts the cell's reference at the caret, a drag a range (the grid does not pan).
        e.preventDefault();
        pointWithMouse(hit, false, false);
        return;
      }
      // A drag pans the grid natively; only a tap (no long press, no pinch) selects.
      const cell = hit.cell;
      const x0 = e.clientX, y0 = e.clientY, t0 = performance.now();
      const pinches = pinchSeq.current;
      let menu = false;
      const onMenu = () => {
        menu = true;
      };
      const done = () => {
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", done);
        window.removeEventListener("contextmenu", onMenu, true);
      };
      const up = (ev: PointerEvent) => {
        if (ev.pointerId !== e.pointerId) return;
        done();
        if (menu || pinches !== pinchSeq.current || Math.hypot(ev.clientX - x0, ev.clientY - y0) > 10 || performance.now() - t0 >= LONG_PRESS_MS) return;
        tapCell(cell);
      };
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", done);
      window.addEventListener("contextmenu", onMenu, true);
      return;
    }
    // While editing, a pivot button is just its cell (point mode).
    if (hit.kind === "pivotButton") hit = { kind: "cell", cell: { row: hit.button.row, col: hit.button.col } };
    e.preventDefault();
    store.pictures.deselect();
    store.slicers.deselect();
    const edit = store.getState().edit;
    if (store.comments.selectedNote) {
      store.comments.selectedNote = null;
      store.notify();
    }
    if (!edit && hit.kind === "cell" && (e.ctrlKey || e.metaKey)) {
      // Ctrl+click follows a hyperlink (a plain click selects the cell).
      const sheet = store.getState().activeSheet;
      const at = { sheet, ...hit.cell };
      if (store.comments.link(at) || store.cache(sheet).cells.get(hit.cell.row)?.get(hit.cell.col)?.link) {
        scroller.current?.focus({ preventScroll: true });
        void store.comments.follow(at);
        return;
      }
    }
    if (edit && (hit.kind === "cell" || hit.kind === "colHeader" || hit.kind === "rowHeader") && store.canPoint()) {
      pointWithMouse(hit, e.shiftKey);
      return;
    }
    if (edit && hit.kind !== "colEdge" && hit.kind !== "rowEdge") {
      // Clicking elsewhere outside point mode commits; a rejected formula keeps the editor.
      const sheet = store.getState().activeSheet;
      void store.commitEdit(0, 0);
      if (store.getState().edit || store.getState().activeSheet !== sheet) {
        store.focusEditor();
        return;
      }
    }
    if (store.getState().edit) store.focusEditor();
    else scroller.current?.focus({ preventScroll: true });
    const sel = store.getState().selection;

    if (hit.kind === "fillHandle") {
      const src = normalize(sel);
      const sheet = store.getState().activeSheet;
      let asked = "";
      const move = (ev: PointerEvent) => {
        const h = hitTest(Math.max(ev.clientX, 0), Math.max(ev.clientY, 0));
        const to = h.kind === "cell" ? h.cell : null;
        const next = to ? fillTarget(src, to) : fillPreview.current;
        if (next !== fillPreview.current) {
          fillPreview.current = next;
          schedule();
        }
        // The tip follows the pointer; its text comes from the core once per target.
        const root = scroller.current?.parentElement;
        const box = root?.getBoundingClientRect();
        const scale = scroller.current ? screenScale(scroller.current) : 1;
        const at = box ? { x: (ev.clientX - box.left) / scale + 14, y: (ev.clientY - box.top) / scale + 16 } : { x: 0, y: 0 };
        const key = next ? `${next.r0},${next.c0},${next.r1},${next.c1}` : "";
        if (!next) {
          asked = "";
          setFillTip(null);
          return;
        }
        setFillTip((tip) => (tip ? { ...tip, ...at } : tip));
        if (key === asked) return;
        asked = key;
        void store.api.fillPreview(sheet, src, next, ev.ctrlKey || ev.metaKey ? "alternate" : "auto").then(
          (text) => {
            if (asked !== key) return;
            setFillTip(text === null ? null : { text, ...at });
          },
          () => setFillTip(null),
        );
      };
      const up = (ev: PointerEvent) => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
        asked = "\u0000";
        setFillTip(null);
        const dst = fillPreview.current;
        fillPreview.current = null;
        schedule();
        if (dst) void store.fill(dst, ev.ctrlKey || ev.metaKey ? "alternate" : "auto");
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
      return;
    }

    if (hit.kind === "colEdge" || hit.kind === "rowEdge") {
      const data = sheetData();
      const axis = hit.kind === "colEdge" ? "col" : "row";
      const index = hit.kind === "colEdge" ? hit.col : hit.row;
      const startSize = axis === "col" ? data.colGeo.size(index) : data.rowGeo.size(index);
      const startPos = axis === "col" ? e.clientX : e.clientY;
      const scale = scroller.current ? screenScale(scroller.current) : 1;
      resizePreview.current = { axis, index, size: startSize };
      const touch = e.pointerType === "touch";
      let dragging = !touch;
      const move = (ev: PointerEvent) => {
        if (pinch.current) return;
        const pos = axis === "col" ? ev.clientX : ev.clientY;
        // A finger's jitter is not a resize.
        if (!dragging && Math.abs(pos - startPos) < 5) return;
        dragging = true;
        resizePreview.current = { axis, index, size: Math.max(0, startSize + (pos - startPos) / scale) };
        schedule();
      };
      const up = (ev: PointerEvent) => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
        const p = resizePreview.current;
        resizePreview.current = null;
        schedule();
        if (p && p.size !== startSize) {
          void (axis === "col" ? store.setColWidth(index, p.size) : store.setRowHeight(index, p.size));
        } else if (touch && ev.type === "pointerup") {
          // A double tap on a border autofits, like the double-click.
          const tap: Tap = { key: `${axis}${index}`, x: ev.clientX, y: ev.clientY, at: performance.now() };
          if (isDoubleTap(lastEdgeTap.current, tap)) {
            lastEdgeTap.current = null;
            void (axis === "col" ? store.autofitCols([index]) : store.autofitRow(index));
          } else lastEdgeTap.current = tap;
        }
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
      return;
    }

    let next: Selection;
    if (hit.kind === "corner") next = { anchor: { row: 0, col: 0 }, focus: { row: LAST_ROW, col: LAST_COL } };
    else if (hit.kind === "colHeader") next = e.shiftKey ? colSelection(sel.anchor.col, hit.col) : colSelection(hit.col);
    else if (hit.kind === "rowHeader") next = e.shiftKey ? rowSelection(sel.anchor.row, hit.row) : rowSelection(hit.row);
    else next = pointerSelect(sel, hit.cell, e.shiftKey);
    store.select(next);
    if (hit.kind === "corner") return;

    const anchor = next.anchor;
    const move = (ev: PointerEvent) => {
      if (pinch.current) return;
      const h = hitTest(Math.max(ev.clientX, 0), Math.max(ev.clientY, 0));
      if (hit.kind === "colHeader" && (h.kind === "colHeader" || h.kind === "cell" || h.kind === "colEdge")) {
        const col = h.kind === "cell" ? h.cell.col : h.col;
        store.select(colSelection(anchor.col, col));
      } else if (hit.kind === "rowHeader" && (h.kind === "rowHeader" || h.kind === "cell" || h.kind === "rowEdge")) {
        const row = h.kind === "cell" ? h.cell.row : h.row;
        store.select(rowSelection(anchor.row, row));
      } else if (hit.kind === "cell" && h.kind === "cell") {
        store.select({ anchor, focus: h.cell });
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
      // The Format Painter paints the range just selected.
      void store.selectionDone();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
  };

  /**
   * A tap on a cell (touch, P10-M3): selects it; a tap on the cell already selected starts editing it (Excel mobile);
   * while editing (not in Ref mode) a tap on another cell commits the edit first.
   */
  const tapCell = (cell: Cell) => {
    if (store.getState().edit) {
      const sheet = store.getState().activeSheet;
      void store.commitEdit(0, 0);
      if (store.getState().edit || store.getState().activeSheet !== sheet) return;
    }
    store.pictures.deselect();
    store.slicers.deselect();
    if (store.comments.selectedNote) {
      store.comments.selectedNote = null;
      store.notify();
    }
    scroller.current?.focus({ preventScroll: true });
    const cur = normalize(store.getState().selection);
    const m = mergeAt(store.merges(), cell.row, cell.col) ?? { r0: cell.row, c0: cell.col, r1: cell.row, c1: cell.col };
    if (!store.getState().selection.areas?.length && cur.r0 === m.r0 && cur.c0 === m.c0 && cur.r1 === m.r1 && cur.c1 === m.c1) {
      if (store.pivots.toggleLabel(cell.row, cell.col)) return;
      store.beginEdit(null);
      return;
    }
    store.select(cellSelection(cell.row, cell.col));
  };

  /** Point mode: a click inserts the cell's reference, a drag a range, a header whole columns/rows. */
  const pointWithMouse = (hit: Extract<Hit, { kind: "cell" | "colHeader" | "rowHeader" }>, extend: boolean, focus = true) => {
    const focusEditor = () => {
      if (focus) store.focusEditor();
    };
    const corners = (h: Hit): [Cell, Cell] | null => {
      if (h.kind === "cell") return [h.cell, h.cell];
      if (h.kind === "colHeader") return [{ row: 0, col: h.col }, { row: LAST_ROW, col: h.col }];
      if (h.kind === "rowHeader") return [{ row: h.row, col: 0 }, { row: h.row, col: LAST_COL }];
      return null;
    };
    const [a, f] = corners(hit)!;
    const edit = store.getState().edit;
    if (hit.kind === "cell" && !extend && edit) {
      // Generate GetPivotData: a value of a pivot table is referenced by its items, not by its address (Excel).
      const gpd = store.pivots.getPivotDataAt(hit.cell.row, hit.cell.col, edit.sheet);
      if (gpd && store.insertAtPoint(gpd)) {
        focusEditor();
        return;
      }
      // A cell of a table on the edited cell's row: `[@Col]` (Excel's "this row" reference).
      const sheetNow = store.getState().activeSheet;
      const tref = sheetNow === edit.sheet ? store.tables.pointRef(sheetNow, edit.cell, hit.cell) : null;
      if (tref && store.insertAtPoint(tref)) {
        focusEditor();
        return;
      }
    }
    const point = store.getState().edit?.point;
    const anchor = extend && point && store.getState().edit?.selEnd === point.end ? point.anchor : a;
    store.pointRange(anchor, f);
    focusEditor();
    const move = (ev: PointerEvent) => {
      const h = hitTest(Math.max(ev.clientX, 0), Math.max(ev.clientY, 0));
      if (h.kind !== hit.kind) return;
      const c = corners(h);
      if (c) store.pointRange(anchor, c[1]);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const hit = hitTest(e.clientX, e.clientY);
    // Notes, threads and links show their box / card / tip on hover (also reachable from the Review tab and the context menu).
    if (e.buttons === 0) store.comments.hoverAt(hit.kind === "cell" ? hit.cell : null);
    const cursor =
      hit.kind === "colEdge" ? "col-resize" : hit.kind === "rowEdge" ? "row-resize" : hit.kind === "fillHandle" ? "crosshair" : hit.kind === "filterButton" || hit.kind === "pivotButton" || hit.kind === "tableFilter" || hit.kind === "totalsButton" || hit.kind === "outline" ? "default"
        : hit.kind === "picture" ? (hit.handle ? handleCursor(hit.handle) : "move")
        : hit.kind === "pageBreak" ? (hit.line.axis === "rows" ? "row-resize" : "col-resize")
        : hit.kind === "splitter" ? (hit.axis === "x" ? "col-resize" : hit.axis === "y" ? "row-resize" : "move")
        : hit.kind === "chartHandle" ? handleCursor(hit.handle) : hit.kind === "chart" ? (store.charts.selected?.id === hit.id ? "move" : "default") : "cell";
    if (scroller.current && scroller.current.style.cursor !== cursor) scroller.current.style.cursor = cursor;
  };

  const onDoubleClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    const hit = hitTest(e.clientX, e.clientY);
    if (hit.kind === "chart") {
      // Double-click on a chart element opens the Format pane for it.
      const charts = store.charts;
      charts.select(store.getState().activeSheet, hit.id, hit.element && hit.element.type !== "chartArea" ? hit.element : null);
      charts.pane = true;
      store.notify();
      return;
    }
    if (hit.kind === "splitter") {
      // Double-click on a splitter removes it (Excel).
      void store.setSheetView(hit.axis === "x" ? { splitX: 0 } : hit.axis === "y" ? { splitY: 0 } : { splitX: 0, splitY: 0 });
      return;
    }
    if (hit.kind === "chartHandle" || hit.kind === "picture" || hit.kind === "outline" || hit.kind === "pageBreak") return;
    if (hit.kind === "colEdge") void store.autofitCols([hit.col]);
    else if (hit.kind === "rowEdge") void store.autofitRow(hit.row);
    else if (hit.kind === "fillHandle") void store.fillToData(e.ctrlKey || e.metaKey ? "alternate" : "auto");
    else if (hit.kind === "cell" && !store.getState().edit) {
      store.select(cellSelection(hit.cell.row, hit.cell.col));
      // Double-click on a pivot item with inner items expands / collapses it; on a value it shows the details.
      if (store.pivots.toggleLabel(hit.cell.row, hit.cell.col)) return;
      if (store.pivots.showDetailsAt(hit.cell.row, hit.cell.col)) return;
      store.beginEdit(null);
    }
  };

  // --- keyboard ---------------------------------------------------------

  const pageRows = () => {
    const data = sheetData();
    const vis = visibleRange(mainPane(layout()).vp, data.colGeo, data.rowGeo);
    return Math.max(1, vis.r1 - vis.r0);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // Undo/redo, B/I/U, F2 and Delete are shortcut-map entries (ShortcutLayer).
    if (e.defaultPrevented || e.target !== scroller.current || store.getState().edit) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key;
    if (key === "Delete" || key === "Backspace" || key === "F2") return;
    if (store.pictures.selected) {
      // A selected picture: Esc deselects; Delete removes it (ShortcutLayer); typing does not edit cells.
      if (key === "Escape") {
        e.preventDefault();
        // Esc ends cropping first, then deselects (Excel).
        if (store.pictures.cropping) store.pictures.toggleCrop();
        else store.pictures.deselect();
        return;
      }
      if (key.length === 1 && !ctrl && !e.altKey) {
        e.preventDefault();
        return;
      }
      store.pictures.deselect();
    }
    if (store.charts.selected) {
      // A selected chart: Esc goes up (element → chart → cells); typing does not edit cells.
      if (key === "Escape") {
        e.preventDefault();
        store.charts.escape();
        return;
      }
      if (key.length === 1 && !ctrl && !e.altKey) {
        e.preventDefault();
        return;
      }
      if (!ctrl && !key.startsWith("Arrow") && !["Tab", "Enter", "PageUp", "PageDown", "Home", "End"].includes(key)) return;
      store.charts.deselect();
    }
    if (key === "Escape" && (store.comments.selectedNote || store.comments.pinned || store.comments.composing)) {
      e.preventDefault();
      store.comments.selectedNote = null;
      store.comments.pin(null);
      store.comments.cancelCompose();
      return;
    }
    // Flash Fill's greyed suggestions: Enter fills them, Esc drops them.
    if (store.flash.preview && !ctrl && !e.shiftKey && (key === "Enter" || key === "Escape")) {
      e.preventDefault();
      if (key === "Enter") void store.flash.accept();
      else store.flash.dismiss();
      return;
    }
    if (key === "Escape" && store.getState().painter) {
      e.preventDefault();
      store.stopFormatPainter();
      return;
    }
    if (key === "Escape" && store.getState().clipMark) {
      e.preventDefault();
      store.clearClip();
      return;
    }
    if (key === "ArrowDown" && e.altKey && !ctrl) {
      // Alt+↓ on an AutoFilter header cell opens its dropdown (Excel); so it does on a pivot header or page cell.
      e.preventDefault();
      const af = store.autoFilter();
      const { row, col } = store.activeAnchor();
      const data = sheetData();
      const pb = store.pivots.buttonsIn(store.getState().activeSheet, data.colGeo, data.rowGeo, { r0: row, c0: col, r1: row, c1: col }).find((b) => b.kind === "drop");
      if (pb && pb.kind === "drop") openPivotFilter(pb);
      else if (af && row === af.r0 && col >= af.c0 && col <= af.c1) openFilterMenu(col);
      else store.openValidationList?.();
      return;
    }
    if (ctrl && (key === "a" || key === "A" || (key === "*" && e.shiftKey)) && store.pivots.selectWhole()) {
      // Ctrl+A / Ctrl+Shift+* inside a pivot table selects the table.
      e.preventDefault();
      return;
    }
    const next = navigate(store.getState().selection, { key, shift: e.shiftKey, ctrl }, store.navContext(pageRows()));
    if (next) {
      e.preventDefault();
      store.select(next);
      const moved = e.shiftKey && key !== "Tab" && key !== "Enter" ? next.focus : next.anchor;
      const whole = normalize(next);
      if (!(whole.r0 === 0 && whole.r1 === LAST_ROW && whole.c0 === 0)) scrollIntoView(moved);
      return;
    }
    if (key.length === 1 && !ctrl && !e.altKey && !(key === " " && e.shiftKey)) {
      // Typing replaces the cell content.
      e.preventDefault();
      store.beginEdit(key);
    }
  };

  const onCopy = (e: ClipboardEvent<HTMLDivElement>, cut = false) => {
    if (store.getState().edit) return;
    if (store.charts.selected) {
      store.clearClip();
      e.clipboardData?.setData("text/plain", store.charts.copy());
      e.preventDefault();
      if (cut) void store.charts.remove();
      return;
    }
    store.charts.forgetClip();
    const tsv = store.copy(cut);
    e.clipboardData?.setData("text/plain", tsv);
    e.preventDefault();
  };

  const onPaste = (e: ClipboardEvent<HTMLDivElement>) => {
    if (store.getState().edit) return;
    e.preventDefault();
    // An image on the clipboard (a screenshot, a copied picture) becomes a picture at the active cell (Excel).
    const image = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
    if (image && !store.hasClip()) {
      void store.pictures.pasteImage(image).then(
        (ok) => {
          if (!ok) store.pushError(new Error(t("calc.picture.unsupported")));
        },
        (err) => store.pushError(err),
      );
      return;
    }
    const text = e.clipboardData?.getData("text/plain") ?? "";
    if (store.charts.hasClip() && (text === "" || text === store.charts.clipText)) {
      void store.charts.paste();
      return;
    }
    // Our own copy (same text, or nothing readable) pastes with formats and shifted formulas.
    if (text === "" && store.hasClip()) void store.paste();
    else void store.paste(text || store.clipboard);
  };

  // --- context menu -------------------------------------------------------

  const onContextMenu = (e: ReactMouseEvent<HTMLDivElement>) => {
    const hit = hitTest(e.clientX, e.clientY);
    if (
      hit.kind === "none" || hit.kind === "corner" || hit.kind === "filterButton" || hit.kind === "pivotButton" || hit.kind === "tableFilter" || hit.kind === "totalsButton"
      || hit.kind === "outline" || hit.kind === "picture" || hit.kind === "pageBreak" || hit.kind === "splitter" || store.getState().edit
    ) return;
    e.preventDefault();
    if (hit.kind === "chart" || hit.kind === "chartHandle") {
      const sheet = store.getState().activeSheet;
      if (store.charts.selected?.id !== hit.id) store.charts.select(sheet, hit.id, null);
      setMenu({ at: { x: e.clientX, y: e.clientY }, items: chartMenu(store), label: t("calc.chart.chart") });
      return;
    }
    const sel = normalize(store.getState().selection);
    let items: ContextMenuItem[];
    let label: string;
    if (hit.kind === "colHeader" || hit.kind === "colEdge") {
      const col = hit.col;
      if (!(isWholeCols(sel) && col >= sel.c0 && col <= sel.c1)) store.select(colSelection(col));
      [items, label] = [colHeaderMenu(actions), t("calc.column")];
    } else if (hit.kind === "rowHeader" || hit.kind === "rowEdge") {
      const row = hit.row;
      if (!(isWholeRows(sel) && row >= sel.r0 && row <= sel.r1)) store.select(rowSelection(row));
      [items, label] = [rowHeaderMenu(actions), t("calc.row")];
    } else {
      if (hit.kind === "cell" && !contains(sel, hit.cell.row, hit.cell.col)) store.select(cellSelection(hit.cell.row, hit.cell.col));
      [items, label] = [cellMenu(actions, store.selectionHasMerge(), actions.annotationState(), !!store.tables.active()), t("calc.cell")];
    }
    setMenu({ at: { x: e.clientX, y: e.clientY }, items, label });
  };

  return (
    <>
      <div
        className="relative min-h-0 flex-1 overflow-hidden bg-white"
        data-testid="grid-root"
        data-zoom={Math.round((pinchZoom ?? zoom) * 100)}
        style={(pinchZoom ?? zoom) !== 1 ? { zoom: pinchZoom ?? zoom } : undefined}
      >
        <canvas
          ref={cellsCanvas}
          className="absolute"
          style={{ left: headings ? HEADER_W + gutterSize(Number(bars.split(",")[0])) : 0, top: headings ? HEADER_H + gutterSize(Number(bars.split(",")[1])) : 0 }}
          aria-hidden="true"
          data-testid="grid-cells"
          data-frozen={`${sheetView.frozenRows},${sheetView.frozenCols}`}
          data-top-left={`${sheetView.topRow ?? 0},${sheetView.leftCol ?? 0}`}
          data-split={`${sheetView.splitX ?? 0},${sheetView.splitY ?? 0}`}
          data-circles={circleCells}
        />
        <canvas ref={headerCanvas} className="absolute left-0 top-0" style={headings ? undefined : { display: "none" }} aria-hidden="true" />
        <div
          ref={scroller}
          data-testid="grid"
          role="grid"
          data-calc-grid=""
          aria-label={t("calc.cells")}
          aria-rowcount={LAST_ROW + 1}
          aria-colcount={LAST_COL + 1}
          tabIndex={0}
          className="absolute inset-0 overflow-auto outline-none"
          style={{ cursor: painterOn ? "copy" : "cell" }}
          onScroll={onScroll}
          onPointerDown={onPointerDown}
          onMouseDown={onMouseDown}
          onPointerMove={onPointerMove}
          onPointerLeave={() => store.comments.hoverAt(null)}
          onDoubleClick={onDoubleClick}
          onKeyDown={onKeyDown}
          onCopy={(e) => onCopy(e)}
          onCut={(e) => onCopy(e, true)}
          onPaste={onPaste}
          onContextMenu={onContextMenu}
        >
          <div ref={spacer} style={{ width: 1, height: 1 }} />
        </div>
        {editing && <CellEditor store={store} boxRef={editorBox} onMount={draw} />}
        {touchUi && (
          <>
            {/* Selection handles (touch): drag to resize the range (in Ref mode: the reference). */}
            <div ref={startHandle} data-testid="selection-handle-start" data-ref-mode={refMode ? "" : undefined} aria-hidden="true" className="rs-sel-handle" style={{ display: "none" }} onPointerDown={(e) => handlePointer("start", e)} />
            <div ref={endHandle} data-testid="selection-handle-end" data-ref-mode={refMode ? "" : undefined} aria-hidden="true" className="rs-sel-handle" style={{ display: "none" }} onPointerDown={(e) => handlePointer("end", e)} />
          </>
        )}
        <SpillIndicator store={store} boxRef={spillBox} onMount={draw} />
        <ValidationOverlay store={store} boxRef={validationBox} onMount={draw} />
        <ErrorTag store={store} boxRef={errorBox} onMount={draw} />
        {chartTextEdit && <ChartTextEditor store={store} boxRef={chartTextBox} onMount={draw} />}
        <AnnotationLayer store={store} />
        <SlicerLayer store={store} />
        <FlashPreviewLayer store={store} />
        {fillTip && (
          <div
            role="tooltip"
            data-testid="fill-tip"
            className="pointer-events-none absolute z-30 whitespace-nowrap border border-ui-border bg-ui-panel px-1.5 py-0.5 text-xs text-ui-fg shadow"
            style={{ left: fillTip.x, top: fillTip.y }}
          >
            {fillTip.text}
          </div>
        )}
        {showPerf && (
          <div
            ref={perfBox}
            data-testid="perf"
            className="pointer-events-none absolute bottom-5 right-5 rounded bg-black/70 px-2 py-1 font-mono text-xs text-white"
          />
        )}
      </div>
      {/* Outside the zoomed grid: the menu is placed at viewport coordinates. */}
      <ContextMenu
        at={menu?.at ?? null}
        label={menu?.label ?? ""}
        items={menu?.items ?? []}
        onClose={() => {
          setMenu(null);
          if (!store.getState().dialog) store.focusGrid();
        }}
      />
    </>
  );
}
