// Virtualized canvas grid: one canvas for cells, one for headers, a
// transparent scroll container with a sized spacer on top for native
// scrolling and input events. Frozen panes split the cell canvas into up
// to four quadrants (grid/panes.ts), each drawn with its own viewport;
// pointer positions map back per quadrant. Zoom, gridlines, headings and
// the frozen panes are the active sheet's `SheetView`.

import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { ContextMenu, type ContextMenuItem } from "@rusuite/ui-shared";
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
import { axisScrollTo, axisToScreen, mainPane, panes, toSheet, type PaneLayout } from "./panes";
import {
  computeRenderOps, drawFreezeLines, drawHeaders, drawOps, drawRefHighlights, drawSelection, HEADER_H, HEADER_W, prepareCanvas, rangeRect,
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
import { paintPictures } from "../pictures/controller";
import { filterButton as afButton, type FilterButton } from "../sortFilter/filter";
import type { AxisGeometry } from "./geometry";

/** The totals cell dropdown: just right of the active cell (Excel), so the total stays readable. */
function totalsButton(colGeo: AxisGeometry, rowGeo: AxisGeometry, row: number, col: number): FilterButton | null {
  const b = afButton(colGeo, rowGeo, { r0: row, c0: col, r1: row, c1: col }, col);
  return b && { ...b, x: colGeo.offset(col) + colGeo.size(col) + 1 };
}
import { breakLineAt, drawBreakPreview, previewBreaks, withBreak, withoutBreak, type BreakLine } from "../datatools/pageBreaks";

/** Hit zone around a header boundary for resizing, px. */
const RESIZE_SLOP = 4;
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
    return {
      frozenW: v.frozenCols > 0 ? data.colGeo.offset(v.frozenCols) : 0,
      frozenH: v.frozenRows > 0 ? data.rowGeo.offset(v.frozenRows) : 0,
      scrollX: el?.scrollLeft ?? 0,
      scrollY: el?.scrollTop ?? 0,
      width: Math.max(0, (el?.clientWidth ?? 0) - hw),
      height: Math.max(0, (el?.clientHeight ?? 0) - hh),
    };
  }, [store, sheetData, headerSize]);

  /** Canvas position of a sheet offset (scrolled under the frozen part: where it would be). */
  const screenX = (l: PaneLayout, x: number) => axisToScreen(l.frozenW, l.scrollX, x) ?? x - l.scrollX;
  const screenY = (l: PaneLayout, y: number) => axisToScreen(l.frozenH, l.scrollY, y) ?? y - l.scrollY;

  /** Page Break Preview's break lines of the active sheet (`[]` when off). */
  const breakLines = (data: SheetData): { lines: BreakLine[]; lastRow: number; lastCol: number } => {
    const st = store.getState();
    if (!st.pageBreakPreview) return { lines: [], lastRow: -1, lastCol: -1 };
    const used = store.usedExtent(st.activeSheet);
    const info = st.info?.sheets.find((x) => x.id === st.activeSheet);
    const lastRow = Math.max(0, used.lastRow), lastCol = Math.max(0, used.lastCol);
    return { lines: previewBreaks(data.colGeo, data.rowGeo, lastRow, lastCol, info?.rowBreaks ?? [], info?.colBreaks ?? []), lastRow, lastCol };
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
      const sx = axisToScreen(l.frozenW, l.scrollX, data.colGeo.offset(sel.c1 + 1));
      const sy = axisToScreen(l.frozenH, l.scrollY, data.rowGeo.offset(sel.r1 + 1));
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
        drawOps(cctx, store.sheetView().showGridlines ? base : base.filter((o) => o.op !== "gridlines"), null);
        // Sparklines inside their cells (P9-C6), under the selection.
        paintSparklines(cctx, store.sparklines.views(state.activeSheet), (r, c) => rangeRect(vp, data, { r0: r, c0: c, r1: r, c1: c }), visibleRange(vp, data.colGeo, data.rowGeo));
        drawSelection(cctx, vp, data, sel, state.selection.anchor);
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
        paintPictures(cctx, store.pictures.frames(state.activeSheet), vp, (p) => store.pictures.image(p), store.pictures.selected?.sheet === state.activeSheet ? store.pictures.selected.id : null);
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

  useEffect(() => {
    // Animate the marching ants while a copy/cut is pending.
    if (!clipMark) return;
    const id = setInterval(schedule, 120);
    return () => clearInterval(id);
  }, [clipMark, schedule]);

  useEffect(() => {
    // New sheet: back to the top-left corner.
    grow.current = { rows: 0, cols: 0 };
    if (scroller.current) {
      scroller.current.scrollTop = 0;
      scroller.current.scrollLeft = 0;
    }
    schedule();
  }, [activeSheet, schedule]);

  useEffect(schedule, [sheetView, schedule]);

  useEffect(() => {
    // Freezing starts from the top-left corner: the frozen rows/columns are the sheet's first ones.
    if ((sheetView.frozenRows > 0 || sheetView.frozenCols > 0) && scroller.current) {
      scroller.current.scrollTop = 0;
      scroller.current.scrollLeft = 0;
    }
  }, [sheetView.frozenRows, sheetView.frozenCols]);

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

  const hitTest = (clientX: number, clientY: number): Hit => {
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
    const { x: cx, y: cy } = toSheet(layout(), x - hw, y - hh);
    if (x < hw && y < hh) return { kind: "corner" };
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
      if (end - cx <= RESIZE_SLOP) return { kind: "colEdge", col };
      if (cx - start <= RESIZE_SLOP && col > 0) return { kind: "colEdge", col: col - 1 };
      return { kind: "colHeader", col };
    }
    if (x < hw) {
      const row = data.rowGeo.indexAt(cy);
      const start = data.rowGeo.offset(row);
      const end = start + data.rowGeo.size(row);
      if (end - cy <= RESIZE_SLOP / 2 + 1) return { kind: "rowEdge", row };
      if (cy - start <= RESIZE_SLOP / 2 && row > 0) return { kind: "rowEdge", row: row - 1 };
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
    const top = axisScrollTo(l.frozenH, l.scrollY, l.height, y0, y1);
    const left = axisScrollTo(l.frozenW, l.scrollX, l.width, x0, x1);
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
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - x0) / scale;
      const dy = (ev.clientY - y0) / scale;
      if (!moved && Math.hypot(dx, dy) < 3) return;
      moved = true;
      const snap = ev.altKey ? { col: geo.col, row: geo.row } : undefined;
      const rect = hit.handle ? resizeRect(start, hit.handle, dx, dy, snap) : moveRect(start, dx, dy, snap);
      pics.preview = { id: hit.id, rect };
      schedule();
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const p = pics.preview;
      if (moved && p) void pics.setRect(p.rect).finally(() => (pics.preview = null));
      else pics.preview = null;
      schedule();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // Pointer events (mobile guardrail): a press on a filter button opens its dropdown; the rest is the mouse path below.
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const hit = hitTest(e.clientX, e.clientY);
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
    if (hit.kind !== "filterButton") return;
    e.preventDefault();
    openFilterMenu(hit.col);
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

  const onMouseDown = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    let hit = hitTest(e.clientX, e.clientY);
    if (hit.kind === "none") return;
    if (
      hit.kind === "filterButton" || hit.kind === "chart" || hit.kind === "chartHandle" || hit.kind === "picture" || hit.kind === "outline" || hit.kind === "pageBreak"
      || hit.kind === "tableFilter" || hit.kind === "totalsButton" || (hit.kind === "pivotButton" && !store.getState().edit)
    ) {
      // Handled on pointerdown; keep the selection and the focus where they are.
      e.preventDefault();
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
      const move = (ev: MouseEvent) => {
        const h = hitTest(Math.max(ev.clientX, 0), Math.max(ev.clientY, 0));
        const to = h.kind === "cell" ? h.cell : null;
        const next = to ? fillTarget(src, to) : fillPreview.current;
        if (next !== fillPreview.current) {
          fillPreview.current = next;
          schedule();
        }
      };
      const up = (ev: MouseEvent) => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
        const dst = fillPreview.current;
        fillPreview.current = null;
        schedule();
        if (dst) void store.fill(dst, ev.ctrlKey || ev.metaKey ? "alternate" : "auto");
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
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
      const move = (ev: MouseEvent) => {
        const pos = axis === "col" ? ev.clientX : ev.clientY;
        resizePreview.current = { axis, index, size: Math.max(0, startSize + (pos - startPos) / scale) };
        schedule();
      };
      const up = () => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
        const p = resizePreview.current;
        resizePreview.current = null;
        schedule();
        if (p && p.size !== startSize) {
          void (axis === "col" ? store.setColWidth(index, p.size) : store.setRowHeight(index, p.size));
        }
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
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
    const move = (ev: MouseEvent) => {
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
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      // The Format Painter paints the range just selected.
      void store.selectionDone();
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  /** Point mode: a click inserts the cell's reference, a drag a range, a header whole columns/rows. */
  const pointWithMouse = (hit: Extract<Hit, { kind: "cell" | "colHeader" | "rowHeader" }>, extend: boolean) => {
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
        store.focusEditor();
        return;
      }
      // A cell of a table on the edited cell's row: `[@Col]` (Excel's "this row" reference).
      const sheetNow = store.getState().activeSheet;
      const tref = sheetNow === edit.sheet ? store.tables.pointRef(sheetNow, edit.cell, hit.cell) : null;
      if (tref && store.insertAtPoint(tref)) {
        store.focusEditor();
        return;
      }
    }
    const point = store.getState().edit?.point;
    const anchor = extend && point && store.getState().edit?.selEnd === point.end ? point.anchor : a;
    store.pointRange(anchor, f);
    store.focusEditor();
    const move = (ev: MouseEvent) => {
      const h = hitTest(Math.max(ev.clientX, 0), Math.max(ev.clientY, 0));
      if (h.kind !== hit.kind) return;
      const c = corners(h);
      if (c) store.pointRange(anchor, c[1]);
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const onMouseMove = (e: ReactMouseEvent<HTMLDivElement>) => {
    const hit = hitTest(e.clientX, e.clientY);
    // Notes, threads and links show their box / card / tip on hover (also reachable from the Review tab and the context menu).
    if (e.buttons === 0) store.comments.hoverAt(hit.kind === "cell" ? hit.cell : null);
    const cursor =
      hit.kind === "colEdge" ? "col-resize" : hit.kind === "rowEdge" ? "row-resize" : hit.kind === "fillHandle" ? "crosshair" : hit.kind === "filterButton" || hit.kind === "pivotButton" || hit.kind === "tableFilter" || hit.kind === "totalsButton" || hit.kind === "outline" ? "default"
        : hit.kind === "picture" ? (hit.handle ? handleCursor(hit.handle) : "move")
        : hit.kind === "pageBreak" ? (hit.line.axis === "rows" ? "row-resize" : "col-resize")
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
        store.pictures.deselect();
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
      || hit.kind === "outline" || hit.kind === "picture" || hit.kind === "pageBreak" || store.getState().edit
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
      <div className="relative min-h-0 flex-1 overflow-hidden bg-white" data-testid="grid-root" style={zoom !== 1 ? { zoom } : undefined}>
        <canvas
          ref={cellsCanvas}
          className="absolute"
          style={{ left: headings ? HEADER_W + gutterSize(Number(bars.split(",")[0])) : 0, top: headings ? HEADER_H + gutterSize(Number(bars.split(",")[1])) : 0 }}
          aria-hidden="true"
          data-testid="grid-cells"
          data-frozen={`${sheetView.frozenRows},${sheetView.frozenCols}`}
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
          onMouseMove={onMouseMove}
          onMouseLeave={() => store.comments.hoverAt(null)}
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
        <SpillIndicator store={store} boxRef={spillBox} onMount={draw} />
        <ValidationOverlay store={store} boxRef={validationBox} onMount={draw} />
        <ErrorTag store={store} boxRef={errorBox} onMount={draw} />
        {chartTextEdit && <ChartTextEditor store={store} boxRef={chartTextBox} onMount={draw} />}
        <AnnotationLayer store={store} />
        <SlicerLayer store={store} />
        <FlashPreviewLayer store={store} />
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
