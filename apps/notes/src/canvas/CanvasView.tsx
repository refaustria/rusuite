// A canvas page (P11-N4): an infinite-right/down surface with the page's text boxes (the page editor, laid out by
// the `CanvasLayout` plugin), images, and ink. Select mode: click on empty space → a new text box with the caret
// in it; drag on empty space → rubber-band selection; a box moves by its top bar and is resized by its right edge
// (8 px grid, Alt: free). Draw tools (Draw tab): pen, highlighter, stroke eraser, lasso. Zoom 25–400 %
// (Ctrl+wheel, pinch, the zoom control); scrolling pans and the surface grows with its content.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import type { Editor } from "@tiptap/core";
import { FOCUS_RING } from "@rusuite/ui-shared";
import type { NotesController } from "../controller";
import type { PageMirror } from "../editor/mirror";
import { useT } from "../i18n";
import { createTextBox, deleteItems, moveItems, patchItemsStep, type CanvasCtx } from "./actions";
import { useBlobUrl } from "./blobs";
import {
  boundsOf,
  clampZoom,
  encodeStroke,
  normPressure,
  ptToPx,
  pxToPt,
  radiusAt,
  rectInLasso,
  rectsIntersect,
  snap,
  strokeHit,
  strokeInLasso,
  unionRect,
  type InkPoint,
  type Rect,
} from "./geometry";
import { canvasStepsFor, useBoxes, useCanvasData } from "./hooks";
import { InkLayer, strokeGeom } from "./ink";
import { setLayout, type LayoutItem } from "./layout";
import { addStroke, newId, removeStrokes, type CanvasItem } from "./model";
import { clearSelection, getTools, setSelection, useTools } from "./tools";

/** Free space kept right of and below the content (px at 100 %). */
const GROW = 800;
/** Offset of the surface origin inside the scroll area (px, unscaled). */
const ORIGIN = { x: 40, y: 12 };
const ERASER_R = 8;
const DRAG_START = 4;

type Gesture =
  | { kind: "blank"; x0: number; y0: number; moved: boolean; id: number }
  | { kind: "move"; x0: number; y0: number; ax: number; ay: number; items: string[]; strokes: string[]; id: number; moved: boolean }
  | { kind: "resize"; x0: number; item: string; w0: number; h0: number; aspect: number | null; id: number }
  | { kind: "ink"; pts: InkPoint[]; id: number; tool: "pen" | "highlighter"; color: string; width: number }
  | { kind: "erase"; id: number; hit: Set<string> }
  | { kind: "lasso"; pts: Array<{ x: number; y: number }>; id: number };

interface Preview {
  dx: number;
  dy: number;
  items: ReadonlySet<string>;
  strokes: ReadonlySet<string>;
  resize: { id: string; w: number; h: number } | null;
}

/** Pointer capture (synthetic events of tests and some pens have no capturable pointer). */
function capture(el: Element | null, id: number): void {
  try {
    el?.setPointerCapture(id);
  } catch {
    /* not capturable */
  }
}
function release(el: Element | null, id: number): void {
  try {
    if (el?.hasPointerCapture(id)) el.releasePointerCapture(id);
  } catch {
    /* gone */
  }
}

const NO_PREVIEW: Preview = { dx: 0, dy: 0, items: new Set(), strokes: new Set(), resize: null };
const EMPTY_SET: ReadonlySet<string> = new Set();

export function CanvasView({
  ctl,
  editor,
  mirror,
  notebook,
  header,
  children,
}: {
  ctl: NotesController;
  editor: Editor;
  mirror: PageMirror;
  notebook: string | null;
  header: ReactNode;
  children: ReactNode;
}) {
  const t = useT();
  const steps = canvasStepsFor(mirror);
  const ctx: CanvasCtx = useMemo(() => ({ view: editor.view, doc: mirror.doc, steps }), [editor, mirror, steps]);
  const { items, strokes } = useCanvasData(mirror);
  const { boxes, active } = useBoxes(editor);
  const tool = useTools((s) => s.tool);
  const selItems = useTools((s) => s.items);
  const selStrokes = useTools((s) => s.strokes);
  const [zoom, setZoom] = useState(() => clampZoom(ctl.getState().settings.zoom || 1));
  const [preview, setPreview] = useState<Preview>(NO_PREVIEW);
  const [erased, setErased] = useState<ReadonlySet<string>>(EMPTY_SET);
  const [band, setBand] = useState<Rect | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const liveRef = useRef<HTMLCanvasElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const anchor = useRef<{ px: number; py: number; cx: number; cy: number } | null>(null);
  const penUntil = useRef(0);
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d0: number; z0: number } | null>(null);

  // ---- layout of the text boxes (the editor's plugin) ----------------------------------------------------
  const zIndex = useMemo(() => new Map(items.map((it, i) => [it.id, i])), [items]);
  const layoutItems = useMemo<LayoutItem[]>(
    () =>
      items
        .filter((it) => it.kind === "text")
        .map((it) => {
          const moving = preview.items.has(it.id);
          const w = preview.resize?.id === it.id ? preview.resize.w : ptToPx(it.w);
          return { id: it.id, x: ptToPx(it.x) + (moving ? preview.dx : 0), y: ptToPx(it.y) + (moving ? preview.dy : 0), w, z: zIndex.get(it.id) ?? 0 };
        }),
    [items, preview, zIndex],
  );
  useEffect(() => {
    if (!editor.isDestroyed) setLayout(editor.view, { enabled: true, items: layoutItems });
  }, [editor, layoutItems]);
  useEffect(
    () => () => {
      if (!editor.isDestroyed) setLayout(editor.view, { enabled: false });
    },
    [editor],
  );
  // A new page starts with nothing selected and the text tool.
  useEffect(() => () => clearSelection(), [mirror]);
  useEffect(() => {
    const on = () => clearSelection();
    editor.on("focus", on);
    return () => void editor.off("focus", on);
  }, [editor]);

  // ---- geometry -------------------------------------------------------------------------------------------
  const visuals = useMemo(() => items.filter((it) => it.kind !== "text"), [items]);
  const itemRect = useCallback(
    (id: string): Rect | null => {
      const b = boxes.find((x) => x.id === id);
      if (b) return { x: b.x, y: b.y, w: b.w, h: b.h };
      const it = items.find((x) => x.id === id);
      if (!it || it.kind === "text") return null;
      const moving = preview.items.has(id);
      const rs = preview.resize?.id === id ? preview.resize : null;
      return { x: ptToPx(it.x) + (moving ? preview.dx : 0), y: ptToPx(it.y) + (moving ? preview.dy : 0), w: rs ? rs.w : ptToPx(it.w || 96), h: rs ? rs.h : ptToPx(it.h || 72) };
    },
    [boxes, items, preview],
  );
  const content = useMemo(() => {
    let r: Rect | null = null;
    for (const b of boxes) if (!(b.implicit && b.empty)) r = unionRect(r, b);
    for (const it of visuals) r = unionRect(r, itemRect(it.id)!);
    for (const s of strokes) r = unionRect(r, strokeGeom(s).bbox);
    return r;
  }, [boxes, visuals, strokes, itemRect]);
  const [viewport, setViewport] = useState({ w: 1000, h: 700 });
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewport({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const W = Math.max((content ? content.x + content.w : 0) + GROW, viewport.w / zoom);
  const H = Math.max((content ? content.y + content.h : 0) + GROW, viewport.h / zoom);

  const toSurface = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
    const r = surfaceRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom };
  };

  // ---- zoom -----------------------------------------------------------------------------------------------
  const zoomAt = useCallback(
    (z: number, cx?: number, cy?: number) => {
      const next = clampZoom(z);
      const el = scrollRef.current;
      const s = surfaceRef.current;
      if (el && s) {
        const er = el.getBoundingClientRect();
        const r = s.getBoundingClientRect();
        const x = cx ?? er.left + er.width / 2;
        const y = cy ?? er.top + er.height / 2;
        anchor.current = { px: (x - r.left) / zoom, py: (y - r.top) / zoom, cx: x, cy: y };
      }
      setZoom(next);
    },
    [zoom],
  );
  useLayoutEffect(() => {
    const a = anchor.current;
    const el = scrollRef.current;
    const s = surfaceRef.current;
    anchor.current = null;
    if (!a || !el || !s) return;
    const r = s.getBoundingClientRect();
    el.scrollLeft += r.left + a.px * zoom - a.cx;
    el.scrollTop += r.top + a.py * zoom - a.cy;
  }, [zoom]);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoomAt(zoom * Math.exp(-e.deltaY * 0.0025), e.clientX, e.clientY);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoom, zoomAt]);

  /** Two touch pointers: pinch zoom (returns true while pinching). */
  const trackTouch = (e: RPointerEvent, phase: "down" | "move" | "up"): boolean => {
    if (e.pointerType !== "touch") return false;
    const m = touches.current;
    if (phase === "up") {
      m.delete(e.pointerId);
      if (m.size < 2) pinch.current = null;
      return false;
    }
    m.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (m.size !== 2) return !!pinch.current;
    const [a, b] = [...m.values()] as [{ x: number; y: number }, { x: number; y: number }];
    const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    if (!pinch.current) pinch.current = { d0: d, z0: zoom };
    else zoomAt(pinch.current.z0 * (d / pinch.current.d0), (a.x + b.x) / 2, (a.y + b.y) / 2);
    return true;
  };

  // ---- live ink (canvas 2D, at pointer rate) --------------------------------------------------------------
  const live = useRef<{ ctx: CanvasRenderingContext2D; ox: number; oy: number; dpr: number } | null>(null);
  const liveBegin = () => {
    const cv = liveRef.current;
    const el = scrollRef.current;
    const s = surfaceRef.current;
    if (!cv || !el || !s) return;
    const er = el.getBoundingClientRect();
    const sr = s.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    cv.style.left = `${er.left}px`;
    cv.style.top = `${er.top}px`;
    cv.style.width = `${er.width}px`;
    cv.style.height = `${er.height}px`;
    cv.width = Math.round(er.width * dpr);
    cv.height = Math.round(er.height * dpr);
    cv.style.display = "block";
    const c = cv.getContext("2d");
    if (!c) return;
    // Surface px → canvas device px.
    c.setTransform(dpr * zoom, 0, 0, dpr * zoom, (sr.left - er.left) * dpr, (sr.top - er.top) * dpr);
    c.lineCap = "round";
    c.lineJoin = "round";
    live.current = { ctx: c, ox: sr.left, oy: sr.top, dpr };
  };
  const liveEnd = () => {
    const cv = liveRef.current;
    live.current = null;
    // Cleared after the committed stroke is painted (no flicker).
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (live.current || !cv) return;
        cv.getContext("2d")?.clearRect(0, 0, cv.width, cv.height);
        cv.style.display = "none";
      }),
    );
  };
  const drawInk = (g: Extract<Gesture, { kind: "ink" }>, from: number) => {
    const l = live.current;
    if (!l) return;
    const c = l.ctx;
    const w = g.width * (ptToPx(1) / 10);
    c.strokeStyle = g.color;
    if (g.tool === "highlighter") {
      // Redrawn whole: overlapping translucent segments would darken.
      c.save();
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, c.canvas.width, c.canvas.height);
      c.restore();
      c.globalAlpha = 0.45;
      c.lineWidth = w;
      c.beginPath();
      g.pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
      if (g.pts.length === 1) c.lineTo(g.pts[0]!.x + 0.01, g.pts[0]!.y);
      c.stroke();
      return;
    }
    c.globalAlpha = 1;
    for (let i = Math.max(1, from); i < g.pts.length; i++) {
      const a = g.pts[i - 1]!;
      const b = g.pts[i]!;
      c.lineWidth = 2 * radiusAt(w, (a.p + b.p) / 2, true);
      c.beginPath();
      c.moveTo(a.x, a.y);
      c.lineTo(b.x, b.y);
      c.stroke();
    }
    if (g.pts.length === 1) {
      const p = g.pts[0]!;
      c.fillStyle = g.color;
      c.beginPath();
      c.arc(p.x, p.y, radiusAt(w, p.p, true), 0, Math.PI * 2);
      c.fill();
    }
  };
  const drawLasso = (pts: Array<{ x: number; y: number }>) => {
    const l = live.current;
    if (!l) return;
    const c = l.ctx;
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, c.canvas.width, c.canvas.height);
    c.restore();
    c.globalAlpha = 1;
    c.strokeStyle = "#0078D4";
    c.lineWidth = 1.5 / zoom;
    c.setLineDash([5 / zoom, 4 / zoom]);
    c.beginPath();
    pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
    c.stroke();
    c.setLineDash([]);
  };

  // ---- selection ------------------------------------------------------------------------------------------
  const selectIn = (test: (r: Rect) => boolean, strokeTest: (s: (typeof strokes)[number]) => boolean, add: boolean) => {
    const its = new Set(add ? selItems : []);
    const sts = new Set(add ? selStrokes : []);
    for (const b of boxes) if (!b.implicit && test(b)) its.add(b.id);
    for (const it of visuals) {
      const r = itemRect(it.id);
      if (r && test(r)) its.add(it.id);
    }
    for (const s of strokes) if (strokeTest(s)) sts.add(s.id);
    setSelection(its, sts);
  };
  const selectionRect = useMemo(() => {
    let r: Rect | null = null;
    for (const id of selItems) {
      const ir = itemRect(id);
      if (ir) r = unionRect(r, ir);
    }
    for (const s of strokes) if (selStrokes.has(s.id)) r = unionRect(r, strokeGeom(s).bbox);
    if (r && preview.strokes.size && !selItems.size) r = { ...r, x: r.x + preview.dx, y: r.y + preview.dy };
    return r;
  }, [selItems, selStrokes, strokes, itemRect, preview]);

  const focusSurface = () => scrollRef.current?.focus({ preventScroll: true });

  const startMove = (e: RPointerEvent, itemsToMove: string[], strokesToMove: string[], ax: number, ay: number) => {
    const p = toSurface(e);
    gesture.current = { kind: "move", x0: p.x, y0: p.y, ax, ay, items: itemsToMove, strokes: strokesToMove, id: e.pointerId, moved: false };
    capture(surfaceRef.current, e.pointerId);
  };

  const onBarDown = (e: RPointerEvent, id: string) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const add = e.shiftKey || e.ctrlKey || e.metaKey;
    const its = selItems.has(id) ? new Set(selItems) : new Set(add ? [...selItems, id] : [id]);
    const sts = selItems.has(id) || add ? selStrokes : EMPTY_SET;
    setSelection(its, sts);
    (editor.view.dom as HTMLElement).blur();
    focusSurface();
    const r = itemRect(id);
    startMove(e, [...its], [...sts], r?.x ?? 0, r?.y ?? 0);
  };

  const onResizeDown = (e: RPointerEvent, id: string, keepAspect: boolean) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const r = itemRect(id);
    if (!r) return;
    const p = toSurface(e);
    gesture.current = { kind: "resize", x0: p.x, item: id, w0: r.w, h0: r.h, aspect: keepAspect && r.w > 0 ? r.h / r.w : null, id: e.pointerId };
    capture(surfaceRef.current, e.pointerId);
  };

  const onSelectionDown = (e: RPointerEvent) => {
    if (e.button !== 0 || !selectionRect) return;
    e.stopPropagation();
    e.preventDefault();
    // Boxes land on the grid (the first selected one is the anchor); strokes alone move in grid steps.
    const first = [...selItems].map(itemRect).find((r): r is Rect => !!r);
    startMove(e, [...selItems], [...selStrokes], first?.x ?? 0, first?.y ?? 0);
  };

  // ---- pointer handling -----------------------------------------------------------------------------------
  const onSurfaceDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (trackTouch(e, "down")) return;
    if (getTools().tool !== "select" || e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest(".ProseMirror > *")) {
      clearSelection();
      return;
    }
    const img = target.closest<HTMLElement>("[data-canvas-image]");
    if (img) {
      e.preventDefault();
      const id = img.dataset.canvasImage!;
      const add = e.shiftKey || e.ctrlKey || e.metaKey;
      const its = selItems.has(id) ? new Set(selItems) : new Set(add ? [...selItems, id] : [id]);
      setSelection(its, selItems.has(id) || add ? selStrokes : []);
      focusSurface();
      const r = itemRect(id);
      startMove(e, [...its], selItems.has(id) || add ? [...selStrokes] : [], r?.x ?? 0, r?.y ?? 0);
      return;
    }
    e.preventDefault();
    const p = toSurface(e);
    gesture.current = { kind: "blank", x0: p.x, y0: p.y, moved: false, id: e.pointerId };
    capture(surfaceRef.current, e.pointerId);
  };

  const onSurfaceMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (trackTouch(e, "move")) return;
    const g = gesture.current;
    const p = toSurface(e);
    if (!g) {
      if (getTools().tool !== "select" || e.pointerType !== "mouse") return;
      const b = boxes.find((x) => !x.implicit && p.x >= x.x - 4 && p.x <= x.x + x.w + 6 && p.y >= x.y - 18 && p.y <= x.y + x.h + 4);
      const id = b?.id ?? null;
      if (id !== hover) setHover(id);
      return;
    }
    if (g.id !== e.pointerId) return;
    if (g.kind === "blank") {
      if (!g.moved && Math.hypot(p.x - g.x0, p.y - g.y0) * zoom < DRAG_START) return;
      g.moved = true;
      setBand({ x: Math.min(g.x0, p.x), y: Math.min(g.y0, p.y), w: Math.abs(p.x - g.x0), h: Math.abs(p.y - g.y0) });
    } else if (g.kind === "move") {
      const rx = p.x - g.x0;
      const ry = p.y - g.y0;
      if (!g.moved && Math.hypot(rx, ry) * zoom < DRAG_START) return;
      g.moved = true;
      const grid = !e.altKey;
      // The dragged thing's top-left lands on the grid.
      const dx = snap(g.ax + rx, grid) - g.ax;
      const dy = snap(g.ay + ry, grid) - g.ay;
      setPreview({ dx, dy, items: new Set(g.items), strokes: new Set(g.strokes), resize: null });
    } else if (g.kind === "resize") {
      const w = Math.max(40, snap(g.w0 + (p.x - g.x0), !e.altKey));
      setPreview({ ...NO_PREVIEW, resize: { id: g.item, w, h: g.aspect ? w * g.aspect : g.h0 } });
    }
  };

  const endGesture = (e: RPointerEvent<HTMLDivElement>, cancelled: boolean) => {
    trackTouch(e, "up");
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    gesture.current = null;
    release(surfaceRef.current, e.pointerId);
    if (cancelled) {
      setPreview(NO_PREVIEW);
      setBand(null);
      return;
    }
    const p = toSurface(e);
    if (g.kind === "blank") {
      setBand(null);
      if (g.moved) {
        const r = { x: Math.min(g.x0, p.x), y: Math.min(g.y0, p.y), w: Math.abs(p.x - g.x0), h: Math.abs(p.y - g.y0) };
        selectIn(
          (b) => rectsIntersect(r, b),
          (s) => {
            const sg = strokeGeom(s);
            return rectsIntersect(r, sg.bbox) && sg.pts.some((q) => q.x >= r.x && q.x <= r.x + r.w && q.y >= r.y && q.y <= r.y + r.h);
          },
          e.shiftKey,
        );
        focusSurface();
      } else {
        clearSelection();
        // The caret lands about where the click was.
        const grid = !e.altKey;
        createTextBox(ctx, pxToPt(Math.max(0, snap(g.x0 - 4, grid))), pxToPt(Math.max(0, snap(g.y0 - 10, grid))));
      }
    } else if (g.kind === "move") {
      const pv = preview;
      setPreview(NO_PREVIEW);
      if (!g.moved || (!pv.dx && !pv.dy)) return;
      const patches = g.items
        .map((id) => items.find((x) => x.id === id))
        .filter((x): x is CanvasItem => !!x)
        .map((it) => ({ id: it.id, x: Math.max(0, pxToPt(ptToPx(it.x) + pv.dx)), y: Math.max(0, pxToPt(ptToPx(it.y) + pv.dy)) }));
      moveItems(ctx, patches, new Set(g.strokes), pv.dx, pv.dy);
    } else if (g.kind === "resize") {
      const rs = preview.resize;
      setPreview(NO_PREVIEW);
      if (!rs) return;
      const it = items.find((x) => x.id === g.item);
      patchItemsStep(ctx, [{ id: g.item, w: pxToPt(rs.w), ...(it && it.kind !== "text" ? { h: pxToPt(rs.h) } : {}) }]);
    }
  };

  // ---- draw tools (the tool layer) ------------------------------------------------------------------------
  const onToolDown = (e: RPointerEvent<HTMLDivElement>) => {
    const tl = getTools();
    if (e.pointerType === "pen") penUntil.current = Date.now() + 500;
    // Palm rejection (lite): no touch input while a pen is in use.
    if (e.pointerType === "touch" && Date.now() < penUntil.current) return;
    if (trackTouch(e, "down")) {
      if (gesture.current?.kind === "ink") gesture.current = null;
      liveEnd();
      return;
    }
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (gesture.current) return;
    e.preventDefault();
    capture(e.currentTarget, e.pointerId);
    const p = toSurface(e);
    if (tl.tool === "pen" || tl.tool === "highlighter") {
      clearSelection();
      const pen = tl.tool === "pen";
      const g: Gesture = {
        kind: "ink",
        id: e.pointerId,
        tool: tl.tool,
        color: pen ? tl.penColor : tl.hlColor,
        width: pen ? tl.penWidth : tl.hlWidth,
        pts: [{ ...p, p: normPressure(e.pressure, e.pointerType) }],
      };
      gesture.current = g;
      liveBegin();
      drawInk(g, 0);
    } else if (tl.tool === "eraser") {
      gesture.current = { kind: "erase", id: e.pointerId, hit: new Set() };
      eraseAt(p);
    } else if (tl.tool === "lasso") {
      gesture.current = { kind: "lasso", id: e.pointerId, pts: [p] };
      liveBegin();
    }
  };

  const eraseAt = (p: { x: number; y: number }) => {
    const g = gesture.current;
    if (g?.kind !== "erase") return;
    const r = ERASER_R / zoom;
    let changed = false;
    for (const s of strokes) {
      if (g.hit.has(s.id)) continue;
      const sg = strokeGeom(s);
      const b = sg.bbox;
      if (p.x < b.x - r || p.x > b.x + b.w + r || p.y < b.y - r || p.y > b.y + b.h + r) continue;
      if (strokeHit(sg.pts, sg.widthPx, p.x, p.y, r)) {
        g.hit.add(s.id);
        changed = true;
      }
    }
    if (changed) setErased(new Set(g.hit));
  };

  const onToolMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "pen") penUntil.current = Date.now() + 500;
    if (trackTouch(e, "move")) return;
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    const co = e.nativeEvent.getCoalescedEvents?.();
    const events = co && co.length ? co : [e.nativeEvent];
    if (g.kind === "ink") {
      const from = g.pts.length;
      for (const ev of events) g.pts.push({ ...toSurface(ev), p: normPressure(ev.pressure, ev.pointerType) });
      drawInk(g, from);
    } else if (g.kind === "erase") {
      for (const ev of events) eraseAt(toSurface(ev));
    } else if (g.kind === "lasso") {
      for (const ev of events) g.pts.push(toSurface(ev));
      drawLasso(g.pts);
    }
  };

  const onToolUp = (e: RPointerEvent<HTMLDivElement>, cancelled: boolean) => {
    trackTouch(e, "up");
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    gesture.current = null;
    if (g.kind === "ink") {
      const points = cancelled ? [] : encodeStroke(g.pts);
      if (points.length >= 3) steps.step(() => addStroke(mirror.doc, { id: newId("s"), tool: g.tool, color: g.color, width: g.width, points }));
      liveEnd();
    } else if (g.kind === "erase") {
      if (!cancelled && g.hit.size) steps.step(() => removeStrokes(mirror.doc, g.hit));
      setErased(EMPTY_SET);
    } else if (g.kind === "lasso") {
      liveEnd();
      if (cancelled) return;
      const poly = g.pts;
      if (boundsOf(poly).w * zoom < DRAG_START && boundsOf(poly).h * zoom < DRAG_START) return clearSelection();
      selectIn(
        (r) => rectInLasso(r, poly),
        (s) => strokeInLasso(strokeGeom(s).pts, poly),
        e.shiftKey,
      );
      focusSurface();
    }
  };

  // ---- keys -----------------------------------------------------------------------------------------------
  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest(".ProseMirror")) return;
    const mod = e.ctrlKey || e.metaKey;
    if ((e.key === "Delete" || e.key === "Backspace") && (selItems.size || selStrokes.size)) {
      e.preventDefault();
      deleteItems(ctx, selItems, selStrokes);
      clearSelection();
    } else if (e.key === "Escape") {
      clearSelection();
    } else if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      void (e.shiftKey ? ctl.redo() : ctl.undo());
    } else if (mod && e.key.toLowerCase() === "y") {
      e.preventDefault();
      void ctl.redo();
    } else if (mod && (e.key === "+" || e.key === "=")) {
      e.preventDefault();
      zoomAt(zoom * 1.25);
    } else if (mod && e.key === "-") {
      e.preventDefault();
      zoomAt(zoom / 1.25);
    }
  };

  // ---- render ---------------------------------------------------------------------------------------------
  const pens = useMemo(() => strokes.filter((s) => s.tool !== "highlighter"), [strokes]);
  const highlights = useMemo(() => strokes.filter((s) => s.tool === "highlighter"), [strokes]);
  const surfaceStyle: CSSProperties = { position: "absolute", left: ORIGIN.x, top: ORIGIN.y, width: W, height: H, transform: `scale(${zoom})`, transformOrigin: "0 0" };
  const cursor = tool === "pen" || tool === "highlighter" ? "crosshair" : tool === "eraser" ? "cell" : tool === "lasso" ? "crosshair" : undefined;
  const chromeFor = boxes.filter((b) => !b.implicit && (b.id === active || b.id === hover || selItems.has(b.id) || preview.items.has(b.id) || preview.resize?.id === b.id));

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1">
      <div
        ref={scrollRef}
        className="notes-canvas-scroll relative min-h-0 min-w-0 flex-1 overflow-auto bg-ui-bg outline-none"
        data-testid="canvas-scroll"
        tabIndex={-1}
        onKeyDown={onKeyDown}
        style={{ touchAction: "pan-x pan-y" }}
      >
        <div className="notes-canvas-header px-10 pt-8" style={{ maxWidth: 760 + 80 }}>
          {header}
        </div>
        <div className="relative" style={{ width: W * zoom + ORIGIN.x * 2, height: H * zoom + ORIGIN.y * 2 }}>
          <div
            ref={surfaceRef}
            className="notes-canvas-surface"
            data-testid="canvas-surface"
            data-zoom={zoom}
            data-tool={tool}
            style={surfaceStyle}
            onPointerDown={onSurfaceDown}
            onPointerMove={onSurfaceMove}
            onPointerUp={(e) => endGesture(e, false)}
            onPointerCancel={(e) => endGesture(e, true)}
            onPointerLeave={() => hover && !gesture.current && setHover(null)}
          >
            <InkLayer strokes={highlights} kind="highlighter" width={W} height={H} hidden={erased} moving={preview.strokes} dx={preview.dx} dy={preview.dy} />
            {visuals.map((it) => (
              <CanvasVisual key={it.id} ctl={ctl} notebook={notebook} item={it} rect={itemRect(it.id)!} z={2 + (zIndex.get(it.id) ?? 0)} />
            ))}
            <div className="notes-canvas-text">{children}</div>
            <InkLayer strokes={pens} kind="pen" width={W} height={H} hidden={erased} moving={preview.strokes} dx={preview.dx} dy={preview.dy} />
            {tool === "select" &&
              chromeFor.map((b) => (
                <div
                  key={b.id}
                  data-canvas-chrome=""
                  data-testid="canvas-box"
                  data-box={b.id}
                  data-selected={selItems.has(b.id) || undefined}
                  className={`notes-box-frame ${selItems.has(b.id) ? "is-selected" : ""}`}
                  style={{ left: b.x - 4, top: b.y - 4, width: b.w + 8, height: b.h + 8 }}
                >
                  <div className="notes-box-bar" data-testid="canvas-box-bar" title={t("notes.canvas.moveBox")} onPointerDown={(e) => onBarDown(e, b.id)} />
                  <div className="notes-box-resize" data-testid="canvas-box-resize" title={t("notes.canvas.resizeBox")} onPointerDown={(e) => onResizeDown(e, b.id, false)} />
                </div>
              ))}
            {tool === "select" &&
              visuals
                .filter((it) => selItems.has(it.id))
                .map((it) => {
                  const r = itemRect(it.id)!;
                  return (
                    <div key={it.id} data-canvas-chrome="" className="notes-image-frame" style={{ left: r.x, top: r.y, width: r.w, height: r.h }}>
                      <div className="notes-image-resize" data-testid="canvas-image-resize" title={t("notes.canvas.resizeBox")} onPointerDown={(e) => onResizeDown(e, it.id, true)} />
                    </div>
                  );
                })}
            {band && <div className="notes-canvas-band" data-testid="canvas-band" style={{ left: band.x, top: band.y, width: band.w, height: band.h }} />}
            {tool !== "select" && (
              <div
                className="notes-canvas-tool"
                data-testid="canvas-tool-layer"
                style={{ cursor }}
                onPointerDown={onToolDown}
                onPointerMove={onToolMove}
                onPointerUp={(e) => onToolUp(e, false)}
                onPointerCancel={(e) => onToolUp(e, true)}
              />
            )}
            {selectionRect && (selStrokes.size > 0 || selItems.size > 0) && (
              <div
                data-canvas-chrome=""
                className="notes-canvas-selection"
                data-testid="canvas-selection"
                data-items={selItems.size}
                data-strokes={selStrokes.size}
                style={{
                  left: selectionRect.x - 6,
                  top: selectionRect.y - 6,
                  width: selectionRect.w + 12,
                  height: selectionRect.h + 12,
                  pointerEvents: tool === "lasso" || (tool === "select" && selStrokes.size > 0) ? "auto" : "none",
                }}
                onPointerDown={onSelectionDown}
              />
            )}
          </div>
        </div>
        <canvas ref={liveRef} className="notes-live-ink" data-testid="canvas-live" aria-hidden="true" />
      </div>
      <ZoomControl zoom={zoom} onZoom={(z) => zoomAt(z)} />
    </div>
  );
}

function ZoomControl({ zoom, onZoom }: { zoom: number; onZoom: (z: number) => void }) {
  const t = useT();
  const btn = `inline-flex h-7 w-7 items-center justify-center rounded hover:bg-ui-hover ${FOCUS_RING}`;
  return (
    <div className="notes-canvas-zoom" data-testid="canvas-zoom">
      <button type="button" className={btn} aria-label={t("notes.zoomOut")} title={t("notes.zoomOut")} onClick={() => onZoom(zoom / 1.25)}>
        −
      </button>
      <button
        type="button"
        className={`min-w-12 rounded px-1 text-xs tabular-nums hover:bg-ui-hover ${FOCUS_RING}`}
        data-testid="canvas-zoom-level"
        title={t("cmd.zoomTo100")}
        onClick={() => onZoom(1)}
      >
        {Math.round(zoom * 100)} %
      </button>
      <button type="button" className={btn} aria-label={t("notes.zoomIn")} title={t("notes.zoomIn")} onClick={() => onZoom(zoom * 1.25)}>
        +
      </button>
    </div>
  );
}

/** An image (or attachment) item. */
function CanvasVisual({ ctl, notebook, item, rect, z }: { ctl: NotesController; notebook: string | null; item: CanvasItem; rect: Rect; z: number }) {
  const t = useT();
  const url = useBlobUrl(ctl, notebook, item.kind === "image" ? item.blob : null);
  const style: CSSProperties = { position: "absolute", left: rect.x, top: rect.y, width: rect.w, height: rect.h, zIndex: z };
  if (item.kind === "image") {
    return (
      <div className="notes-canvas-image" data-canvas-image={item.id} data-testid="canvas-image" style={style}>
        {url ? <img src={url} alt="" draggable={false} /> : <span className="notes-canvas-missing">{t("notes.canvas.image")}</span>}
      </div>
    );
  }
  return (
    <div className="notes-canvas-image notes-canvas-file" data-canvas-image={item.id} data-testid="canvas-file" style={style}>
      📎
    </div>
  );
}
