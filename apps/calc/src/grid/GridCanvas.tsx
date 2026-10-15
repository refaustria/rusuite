// Virtualized canvas grid: one canvas for cells, one for headers, a
// transparent scroll container with a sized spacer on top for native
// scrolling and input events.

import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import { ContextMenu, type ContextMenuItem } from "@rusuite/ui-shared";
import { calcActions, cellMenu, colHeaderMenu, rowHeaderMenu } from "../calcActions";
import type { Rect } from "../generated/Rect";
import { fillTarget } from "../state/clipboard";
import { useCalc, type CalcStore } from "../state/store";
import { CellEditor } from "./CellEditor";
import {
  computeRenderOps, drawHeaders, drawOps, drawRefHighlights, drawSelection, HEADER_H, HEADER_W, prepareCanvas, rangeRect, visibleRange,
  type RefHighlight, type SheetData, type Viewport,
} from "./render";
import {
  cellSelection, colSelection, contains, isWholeCols, isWholeRows, LAST_COL, LAST_ROW, navigate, normalize, pointerSelect, rowSelection,
  type Cell, type Range, type Selection,
} from "./Selection";
import type { Measure } from "./textLayout";
import { useT } from "../i18n";

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
  | { kind: "none" };

export interface GridViewOptions {
  /** View zoom (1 = 100 %), applied with CSS `zoom` on the grid. */
  zoom?: number;
  /** Draw the cell gridlines (default true). */
  gridlines?: boolean;
}

export function GridCanvas({ store, showPerf = false, zoom = 1, gridlines = true }: { store: CalcStore; showPerf?: boolean } & GridViewOptions) {
  const t = useT();
  const view = useRef({ zoom, gridlines });
  view.current = { zoom, gridlines };
  const scroller = useRef<HTMLDivElement>(null);
  const spacer = useRef<HTMLDivElement>(null);
  const cellsCanvas = useRef<HTMLCanvasElement>(null);
  const headerCanvas = useRef<HTMLCanvasElement>(null);
  const perfBox = useRef<HTMLDivElement>(null);
  const editorBox = useRef<HTMLDivElement>(null);
  const raf = useRef<number | null>(null);
  const grow = useRef({ rows: 0, cols: 0 });
  const resizePreview = useRef<{ axis: "col" | "row"; index: number; size: number } | null>(null);
  const perf = useRef({ frames: 0, totalMs: 0, maxMs: 0, lastFrameAt: 0, intervals: 0, intervalSum: 0 });
  /** Fill-handle drag: the range that would be filled. */
  const fillPreview = useRef<Rect | null>(null);
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; items: ContextMenuItem[]; label: string } | null>(null);
  const actions = useMemo(() => calcActions(store), [store]);
  const clipMark = useCalc(store, (s) => s.clipMark);

  const activeSheet = useCalc(store, (s) => s.activeSheet);
  // While pointing on another sheet the in-cell editor is hidden (the formula bar has the edit).
  const editing = useCalc(store, (s) => s.edit !== null && s.edit.sheet === s.activeSheet);
  const lastPoint = useRef<Cell | null>(null);

  const sheetData = useCallback((): SheetData => {
    const sheet = store.getState().activeSheet;
    const cache = store.cache(sheet);
    const geo = store.geometry(sheet);
    return { cells: cache.cells, cols: cache.cols, rows: cache.rows, colGeo: geo.col, rowGeo: geo.row };
  }, [store]);

  const viewport = useCallback((): Viewport => {
    const el = scroller.current;
    return {
      scrollX: el?.scrollLeft ?? 0,
      scrollY: el?.scrollTop ?? 0,
      width: Math.max(0, (el?.clientWidth ?? 0) - HEADER_W),
      height: Math.max(0, (el?.clientHeight ?? 0) - HEADER_H),
    };
  }, []);

  /** The fill handle's square in cell-canvas coordinates (`null`: off screen or whole rows/columns). */
  const handleRect = useCallback(
    (sel: Range): { x: number; y: number } | null => {
      if (isWholeCols(sel) && isWholeRows(sel)) return null;
      const data = sheetData();
      const vp = viewport();
      const x = data.colGeo.offset(sel.c1 + 1) - vp.scrollX - HANDLE / 2 - 1;
      const y = data.rowGeo.offset(sel.r1 + 1) - vp.scrollY - HANDLE / 2 - 1;
      if (x < -HANDLE || y < -HANDLE || x > vp.width || y > vp.height) return null;
      return { x, y };
    },
    [sheetData, viewport],
  );

  const draw = useCallback(() => {
    raf.current = null;
    const t0 = performance.now();
    const state = store.getState();
    const data = sheetData();
    const vp = viewport();
    const sel = normalize(state.selection);

    // Virtual extent: used range + 50 rows (min 200), growing with scrolling/selection.
    const used = store.usedExtent(state.activeSheet);
    const rows = Math.min(LAST_ROW + 1, Math.max(200, used.lastRow + 51, grow.current.rows));
    const cols = Math.min(LAST_COL + 1, Math.max(30, used.lastCol + 11, grow.current.cols));
    if (spacer.current) {
      spacer.current.style.width = `${HEADER_W + data.colGeo.offset(cols)}px`;
      spacer.current.style.height = `${HEADER_H + data.rowGeo.offset(rows)}px`;
    }

    const vis = visibleRange(vp, data.colGeo, data.rowGeo);
    void store.ensureRegion(
      state.activeSheet,
      Math.max(0, vis.r0 - PREFETCH), Math.max(0, vis.c0 - 2),
      Math.min(LAST_ROW, vis.r1 + PREFETCH), Math.min(LAST_COL, vis.c1 + 2),
    );

    const cctx = cellsCanvas.current && prepareCanvas(cellsCanvas.current, vp.width, vp.height, view.current.zoom);
    if (cctx) {
      const base = computeRenderOps(vp, data, store.styles(), store.measure);
      const ops = view.current.gridlines ? base : base.filter((o) => o.op !== "gridlines");
      drawOps(cctx, ops, "#ffffff");
      drawSelection(cctx, vp, data, sel, state.selection.anchor);
      const mark = state.clipMark;
      if (mark && mark.sheet === state.activeSheet) {
        // Marching ants around the copied / cut range.
        const r = rangeRect(vp, data, mark.range);
        if (r) {
          cctx.save();
          cctx.lineWidth = 2;
          cctx.strokeStyle = "#ffffff";
          cctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
          cctx.strokeStyle = "#217346";
          cctx.setLineDash([4, 4]);
          cctx.lineDashOffset = -Math.floor(performance.now() / 80) % 8;
          cctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
          cctx.restore();
        }
      }
      const fp = fillPreview.current;
      if (fp) {
        const all = { r0: Math.min(sel.r0, fp.r0), c0: Math.min(sel.c0, fp.c0), r1: Math.max(sel.r1, fp.r1), c1: Math.max(sel.c1, fp.c1) };
        const r = rangeRect(vp, data, all);
        if (r) {
          cctx.save();
          cctx.strokeStyle = "#5f6368";
          cctx.lineWidth = 1;
          cctx.setLineDash([3, 2]);
          cctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
          cctx.restore();
        }
      }
      if (!state.edit) {
        const h = handleRect(sel);
        if (h) {
          cctx.fillStyle = "#ffffff";
          cctx.fillRect(h.x - 1, h.y - 1, HANDLE + 2, HANDLE + 2);
          cctx.fillStyle = "#217346";
          cctx.fillRect(h.x, h.y, HANDLE, HANDLE);
        }
      }
      const edit = state.edit;
      if (edit) {
        const marks: RefHighlight[] = [];
        for (const ref of store.editRefs()) {
          if (store.refSheet(ref) !== state.activeSheet) continue;
          const pointed = edit.point !== null && ref.start === edit.point.start && ref.end === edit.point.end;
          marks.push({ range: ref.range, color: ref.color, dashed: pointed });
        }
        drawRefHighlights(cctx, vp, data, marks);
      }
    }
    const hctx = headerCanvas.current && prepareCanvas(headerCanvas.current, vp.width + HEADER_W, vp.height + HEADER_H, view.current.zoom);
    if (hctx) {
      drawHeaders(hctx, vp, data, sel, { bg: "#f3f3f3", fg: "#444", line: "#c8c8c8", active: "#d3e3d8" });
      const p = resizePreview.current;
      if (p) {
        hctx.strokeStyle = "#217346";
        hctx.lineWidth = 1;
        hctx.beginPath();
        if (p.axis === "col") {
          const x = HEADER_W + data.colGeo.offset(p.index) - vp.scrollX + p.size;
          hctx.moveTo(x + 0.5, 0);
          hctx.lineTo(x + 0.5, HEADER_H + vp.height);
        } else {
          const y = HEADER_H + data.rowGeo.offset(p.index) - vp.scrollY + p.size;
          hctx.moveTo(0, y + 0.5);
          hctx.lineTo(HEADER_W + vp.width, y + 0.5);
        }
        hctx.stroke();
      }
    }

    const box = editorBox.current;
    if (box) {
      const { row, col } = state.edit?.cell ?? state.selection.anchor;
      box.style.left = `${HEADER_W + data.colGeo.offset(col) - vp.scrollX}px`;
      box.style.top = `${HEADER_H + data.rowGeo.offset(row) - vp.scrollY}px`;
      box.style.minWidth = `${data.colGeo.size(col) + 1}px`;
      box.style.height = `${data.rowGeo.size(row) + 1}px`;
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
  }, [store, sheetData, viewport, handleRect]);

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

  useEffect(schedule, [zoom, gridlines, schedule]);

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
      const vp = viewport();
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
    const vp = viewport();
    const cx = x - HEADER_W + vp.scrollX;
    const cy = y - HEADER_H + vp.scrollY;
    if (x < HEADER_W && y < HEADER_H) return { kind: "corner" };
    if (x >= HEADER_W && y >= HEADER_H && !store.getState().edit) {
      const h = handleRect(normalize(store.getState().selection));
      const hx = x - HEADER_W - (h?.x ?? 0) - HANDLE / 2;
      const hy = y - HEADER_H - (h?.y ?? 0) - HANDLE / 2;
      if (h && Math.abs(hx) <= HANDLE_SLOP && Math.abs(hy) <= HANDLE_SLOP) return { kind: "fillHandle" };
    }
    if (y < HEADER_H) {
      const col = data.colGeo.indexAt(cx);
      const start = data.colGeo.offset(col);
      const end = start + data.colGeo.size(col);
      if (end - cx <= RESIZE_SLOP) return { kind: "colEdge", col };
      if (cx - start <= RESIZE_SLOP && col > 0) return { kind: "colEdge", col: col - 1 };
      return { kind: "colHeader", col };
    }
    if (x < HEADER_W) {
      const row = data.rowGeo.indexAt(cy);
      const start = data.rowGeo.offset(row);
      const end = start + data.rowGeo.size(row);
      if (end - cy <= RESIZE_SLOP / 2 + 1) return { kind: "rowEdge", row };
      if (cy - start <= RESIZE_SLOP / 2 && row > 0) return { kind: "rowEdge", row: row - 1 };
      return { kind: "rowHeader", row };
    }
    return { kind: "cell", cell: { row: data.rowGeo.indexAt(cy), col: data.colGeo.indexAt(cx) } };
  };

  const scrollIntoView = (cell: Cell) => {
    const el = scroller.current;
    if (!el) return;
    const data = sheetData();
    const vp = viewport();
    const x0 = data.colGeo.offset(cell.col);
    const x1 = x0 + data.colGeo.size(cell.col);
    const y0 = data.rowGeo.offset(cell.row);
    const y1 = y0 + data.rowGeo.size(cell.row);
    if (cell.row + 20 > grow.current.rows) grow.current.rows = cell.row + 50;
    if (cell.col + 5 > grow.current.cols) grow.current.cols = cell.col + 10;
    draw(); // resize the spacer before scrolling
    if (y0 < vp.scrollY) el.scrollTop = y0;
    else if (y1 > vp.scrollY + vp.height) el.scrollTop = y1 - vp.height;
    if (x0 < vp.scrollX) el.scrollLeft = x0;
    else if (x1 > vp.scrollX + vp.width) el.scrollLeft = x1 - vp.width;
  };

  // Keyboard pointing may move the reference cursor off screen.
  const scrollRef = useRef(scrollIntoView);
  scrollRef.current = scrollIntoView;
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

  const onMouseDown = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const hit = hitTest(e.clientX, e.clientY);
    if (hit.kind === "none") return;
    e.preventDefault();
    const edit = store.getState().edit;
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
    const cursor =
      hit.kind === "colEdge" ? "col-resize" : hit.kind === "rowEdge" ? "row-resize" : hit.kind === "fillHandle" ? "crosshair" : "cell";
    if (scroller.current && scroller.current.style.cursor !== cursor) scroller.current.style.cursor = cursor;
  };

  const onDoubleClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    const hit = hitTest(e.clientX, e.clientY);
    if (hit.kind === "colEdge") void store.autofitCols([hit.col]);
    else if (hit.kind === "rowEdge") void store.autofitRow(hit.row);
    else if (hit.kind === "fillHandle") void store.fillToData(e.ctrlKey || e.metaKey ? "alternate" : "auto");
    else if (hit.kind === "cell" && !store.getState().edit) {
      store.select(cellSelection(hit.cell.row, hit.cell.col));
      store.beginEdit(null);
    }
  };

  // --- keyboard ---------------------------------------------------------

  const pageRows = () => {
    const data = sheetData();
    const vis = visibleRange(viewport(), data.colGeo, data.rowGeo);
    return Math.max(1, vis.r1 - vis.r0);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // Undo/redo, B/I/U, F2 and Delete are shortcut-map entries (ShortcutLayer).
    if (e.defaultPrevented || e.target !== scroller.current || store.getState().edit) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key;
    if (key === "Delete" || key === "Backspace" || key === "F2") return;
    if (key === "Escape" && store.getState().clipMark) {
      e.preventDefault();
      store.clearClip();
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
    const tsv = store.copy(cut);
    e.clipboardData?.setData("text/plain", tsv);
    e.preventDefault();
  };

  const onPaste = (e: ClipboardEvent<HTMLDivElement>) => {
    if (store.getState().edit) return;
    e.preventDefault();
    const text = e.clipboardData?.getData("text/plain") ?? "";
    // Our own copy (same text, or nothing readable) pastes with formats and shifted formulas.
    if (text === "" && store.hasClip()) void store.paste();
    else void store.paste(text || store.clipboard);
  };

  // --- context menu -------------------------------------------------------

  const onContextMenu = (e: ReactMouseEvent<HTMLDivElement>) => {
    const hit = hitTest(e.clientX, e.clientY);
    if (hit.kind === "none" || hit.kind === "corner" || store.getState().edit) return;
    e.preventDefault();
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
      [items, label] = [cellMenu(actions), t("calc.cell")];
    }
    setMenu({ at: { x: e.clientX, y: e.clientY }, items, label });
  };

  return (
    <>
      <div className="relative min-h-0 flex-1 overflow-hidden bg-white" data-testid="grid-root" style={zoom !== 1 ? { zoom } : undefined}>
        <canvas ref={cellsCanvas} className="absolute" style={{ left: HEADER_W, top: HEADER_H }} aria-hidden="true" />
        <canvas ref={headerCanvas} className="absolute left-0 top-0" aria-hidden="true" />
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
          style={{ cursor: "cell" }}
          onScroll={onScroll}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
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
