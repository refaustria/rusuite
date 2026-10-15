// Virtualized canvas grid: one canvas for cells, one for headers, a
// transparent scroll container with a sized spacer on top for native
// scrolling and input events.

import { useCallback, useEffect, useRef, type ClipboardEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import { useCalc, type CalcStore } from "../state/store";
import { CellEditor } from "./CellEditor";
import { rowHeightPx } from "./geometry";
import {
  CELL_PADDING, computeRenderOps, drawHeaders, drawOps, drawSelection, HEADER_H, HEADER_W, prepareCanvas, visibleRange,
  type SheetData, type Viewport,
} from "./render";
import {
  cellSelection, colSelection, LAST_COL, LAST_ROW, navigate, normalize, pointerSelect, rowSelection, type Cell, type Selection,
} from "./Selection";
import { fontCss, fontPx, styleAt } from "./style";

/** Hit zone around a header boundary for resizing, px. */
const RESIZE_SLOP = 4;
/** Rows/cols prefetched beyond the viewport. */
const PREFETCH = 8;

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
  | { kind: "none" };

export function GridCanvas({ store, showPerf = false }: { store: CalcStore; showPerf?: boolean }) {
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

  const activeSheet = useCalc(store, (s) => s.activeSheet);
  const editing = useCalc(store, (s) => s.edit !== null);

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

    const cctx = cellsCanvas.current && prepareCanvas(cellsCanvas.current, vp.width, vp.height);
    if (cctx) {
      const ops = computeRenderOps(vp, data, store.styles());
      drawOps(cctx, ops, "#ffffff");
      drawSelection(cctx, vp, data, sel, state.selection.anchor);
    }
    const hctx = headerCanvas.current && prepareCanvas(headerCanvas.current, vp.width + HEADER_W, vp.height + HEADER_H);
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
      const { row, col } = state.selection.anchor;
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
  }, [store, sheetData, viewport]);

  const schedule = useCallback(() => {
    if (raf.current !== null) return;
    if (typeof requestAnimationFrame === "function") raf.current = requestAnimationFrame(draw);
    else draw();
  }, [draw]);

  useEffect(() => {
    store.focusGrid = () => scroller.current?.focus({ preventScroll: true });
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
    // New sheet: back to the top-left corner.
    grow.current = { rows: 0, cols: 0 };
    if (scroller.current) {
      scroller.current.scrollTop = 0;
      scroller.current.scrollLeft = 0;
    }
    schedule();
  }, [activeSheet, schedule]);

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
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    if (x > el.clientWidth || y > el.clientHeight) return { kind: "none" }; // scrollbars
    const data = sheetData();
    const vp = viewport();
    const cx = x - HEADER_W + vp.scrollX;
    const cy = y - HEADER_H + vp.scrollY;
    if (x < HEADER_W && y < HEADER_H) return { kind: "corner" };
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

  // --- autofit ----------------------------------------------------------

  const measureCtx = () => {
    const c = document.createElement("canvas");
    try {
      return c.getContext("2d");
    } catch {
      return null;
    }
  };

  const autofitCol = (col: number) => {
    const data = sheetData();
    const vis = visibleRange(viewport(), data.colGeo, data.rowGeo);
    const ctx = measureCtx();
    let widest = 0;
    for (let r = vis.r0; r <= vis.r1; r++) {
      const cell = data.cells.get(r)?.get(col);
      if (!cell || !cell.display) continue;
      const style = styleAt(store.styles(), cell.style);
      if (ctx) {
        ctx.font = fontCss(style);
        widest = Math.max(widest, ctx.measureText(cell.display).width);
      } else {
        widest = Math.max(widest, cell.display.length * fontPx(style) * 0.55);
      }
    }
    void store.setColWidth(col, widest === 0 ? null : Math.ceil(widest + 2 * CELL_PADDING + 3));
  };

  const autofitRow = (row: number) => {
    const data = sheetData();
    const vis = visibleRange(viewport(), data.colGeo, data.rowGeo);
    let tallest = 0;
    for (let c = vis.c0; c <= vis.c1; c++) {
      const cell = data.cells.get(row)?.get(c);
      if (cell && cell.display) tallest = Math.max(tallest, fontPx(styleAt(store.styles(), cell.style)));
    }
    const def = rowHeightPx(15);
    const px = Math.ceil(tallest * (def / fontPx({})));
    void store.setRowHeight(row, tallest === 0 || px <= def ? null : px);
  };

  // --- mouse ------------------------------------------------------------

  const onMouseDown = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const hit = hitTest(e.clientX, e.clientY);
    if (hit.kind === "none") return;
    e.preventDefault();
    if (store.getState().edit) void store.commitEdit(0, 0);
    scroller.current?.focus({ preventScroll: true });
    const sel = store.getState().selection;

    if (hit.kind === "colEdge" || hit.kind === "rowEdge") {
      const data = sheetData();
      const axis = hit.kind === "colEdge" ? "col" : "row";
      const index = hit.kind === "colEdge" ? hit.col : hit.row;
      const startSize = axis === "col" ? data.colGeo.size(index) : data.rowGeo.size(index);
      const startPos = axis === "col" ? e.clientX : e.clientY;
      resizePreview.current = { axis, index, size: startSize };
      const move = (ev: MouseEvent) => {
        const pos = axis === "col" ? ev.clientX : ev.clientY;
        resizePreview.current = { axis, index, size: Math.max(0, startSize + pos - startPos) };
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

  const onMouseMove = (e: ReactMouseEvent<HTMLDivElement>) => {
    const hit = hitTest(e.clientX, e.clientY);
    const cursor = hit.kind === "colEdge" ? "col-resize" : hit.kind === "rowEdge" ? "row-resize" : "cell";
    if (scroller.current && scroller.current.style.cursor !== cursor) scroller.current.style.cursor = cursor;
  };

  const onDoubleClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    const hit = hitTest(e.clientX, e.clientY);
    if (hit.kind === "colEdge") autofitCol(hit.col);
    else if (hit.kind === "rowEdge") autofitRow(hit.row);
    else if (hit.kind === "cell") {
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
    if (e.target !== scroller.current || store.getState().edit) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key;
    const lower = key.toLowerCase();
    if (ctrl && !e.altKey) {
      if (lower === "z" && !e.shiftKey) return void (e.preventDefault(), store.undo());
      if (lower === "y" || (lower === "z" && e.shiftKey)) return void (e.preventDefault(), store.redo());
      if (lower === "b") return void (e.preventDefault(), store.toggleFont("bold"));
      if (lower === "i") return void (e.preventDefault(), store.toggleFont("italic"));
      if (lower === "u") return void (e.preventDefault(), store.toggleFont("underline"));
    }
    if (key === "F2") {
      e.preventDefault();
      store.beginEdit(null);
      return;
    }
    if (key === "Delete" || key === "Backspace") {
      e.preventDefault();
      void store.clearSelection();
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
    if (key.length === 1 && !ctrl && !e.altKey) {
      // Typing replaces the cell content.
      e.preventDefault();
      store.beginEdit(key);
    }
  };

  const onCopy = (e: ClipboardEvent<HTMLDivElement>) => {
    if (store.getState().edit) return;
    const tsv = store.copy();
    e.clipboardData?.setData("text/plain", tsv);
    e.preventDefault();
  };

  const onPaste = (e: ClipboardEvent<HTMLDivElement>) => {
    if (store.getState().edit) return;
    e.preventDefault();
    const text = e.clipboardData?.getData("text/plain") || store.clipboard;
    void store.paste(text);
  };

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden bg-white" data-testid="grid-root">
      <canvas ref={cellsCanvas} className="absolute" style={{ left: HEADER_W, top: HEADER_H }} aria-hidden="true" />
      <canvas ref={headerCanvas} className="absolute left-0 top-0" aria-hidden="true" />
      <div
        ref={scroller}
        data-testid="grid"
        role="grid"
        aria-label="Cells"
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
        onCopy={onCopy}
        onPaste={onPaste}
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
  );
}
