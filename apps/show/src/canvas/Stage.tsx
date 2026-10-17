// The slide editor: the current slide scaled to the viewport, selection
// (click, shift-click, marquee), a Transformer for move/resize/rotate
// (one `SetTransform` per gesture) with smart guides (snapping to the
// slide and the other shapes, equal spacing; red dashed lines), drawing
// guides and the grid (P8-28; Alt turns snapping off), double-click text
// editing (also of a group's child) and the right-click menus. Drawing
// guides are draggable lines (Ctrl+drag copies, off the slide deletes,
// right-click: add / delete / colour).

import { useCallback, useEffect, useRef, useState } from "react";
import { Group, Layer, Line as KLine, Rect, Shape as KShape, Stage, Transformer } from "react-konva";
import type Konva from "konva";
import { ContextMenu, formatNumber, useLocale, type ContextMenuItem } from "@rusuite/ui-shared";
import type { NodeId } from "../generated/NodeId";
import type { Shape } from "../generated/Shape";
import { boundsPx, boxAttrs, EMU_PER_PX, fitScale, rectFromPoints, shapesInRect, slidePx, type Rect as R } from "../geometry";
import { dist, dragBox, snap45, type Pt } from "../shapes/geom";
import { choiceOf, clickBox } from "../shapes/presets";
import { freeformDown, freeformFinish, freeformGeometry, freeformMove, freeformPreview, freeformUp, startFreeform, type FreeformState } from "../shapes/freeform";
import { EditPointsLayer, FreeformPreview } from "./EditPointsLayer";
import { handlesOf } from "../shapes/handles";
import { usePathVersion } from "../shapes/paths";
import type { ConnEnd, SlideSite } from "../shapes/connectors";
import { AdjustHandles, ConnectorHandles, PreviewLine, SiteDots, connectorTarget } from "./EditHandles";
import { TableOverlay } from "./TableOverlay";
import { findShape } from "../model";
import { gestureCommand } from "../state/commands";
import { DEFAULT_VIEW, useShow, viewSlide, type ShowStore } from "../state/store";
import { CropOverlay } from "./CropOverlay";
import { guideMenu, masterMenu } from "./menus";
import { shapeMenu, slideMenu, tableMenu } from "./menus";
import { NO_GUIDES, SNAP_PX, anchorAxes, sameGuides, snapPoint, snapTargets, type Guides, type SnapTargets } from "./snap";
import { DESIGN_GUIDE_COLOR, guideLabel, guideSets, guideTargets, rulerUnit, snapMove, snapToGrid } from "./guides";
import type { Guide } from "../generated/Guide";
import { SlideView } from "./SlideView";
import { stableDeck } from "../design/deck";
import { TextOverlay } from "./TextOverlay";
import { AutofitButton } from "./AutofitButton";
import { AnimBadges, StagePreview } from "./AnimOverlay";
import { useT } from "../i18n";

/** Union of rectangles (slide px). */
function union(rects: R[]): R | null {
  if (!rects.length) return null;
  const x0 = Math.min(...rects.map((r) => r.x));
  const y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.width));
  const y1 = Math.max(...rects.map((r) => r.y + r.height));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** What a drag can snap to: the slide and other shapes, the drawing guides, the other shapes' boxes. */
interface SnapLines {
  shapes: SnapTargets;
  guides: SnapTargets;
  others: R[];
}

/** State of a drag of the selection: where it started and what it can snap to. */
interface DragSnap {
  pointer: { x: number; y: number };
  starts: Map<Konva.Node, { x: number; y: number }>;
  box: R;
  lines: SnapLines;
}

/** Smart guides: PowerPoint's red dashed lines. */
export const SMART_GUIDE_COLOR = "#e3242b";
/** Drawing guides' default colour. */
export const GUIDE_COLOR = "#a6a6a6";

/** The top-level shape group a Konva event target belongs to, and the innermost shape group. */
function shapeTargets(target: Konva.Node): { top: NodeId | null; leaf: NodeId | null } {
  let leaf: NodeId | null = null;
  let top: NodeId | null = null;
  for (let n: Konva.Node | null = target; n; n = n.getParent()) {
    const id = n.getAttr("shapeId") as NodeId | undefined;
    if (id !== undefined) {
      if (leaf === null) leaf = id;
      if (n.name() === "shape") top = id;
    }
  }
  return { top, leaf };
}

/** View › Gridlines: dotted lines every `step` slide px. */
function GridLines({ width, height, step, scale }: { width: number; height: number; step: number; scale: number }) {
  // at least 6 screen px between lines (PowerPoint thins the grid when zoomed out)
  const k = Math.max(1, Math.ceil(6 / Math.max(0.01, step * scale)));
  const s = step * k;
  return (
    <KShape
      name="gridlines"
      listening={false}
      sceneFunc={(c, shape) => {
        c.beginPath();
        for (let x = s; x < width; x += s) {
          c.moveTo(x, 0);
          c.lineTo(x, height);
        }
        for (let y = s; y < height; y += s) {
          c.moveTo(0, y);
          c.lineTo(width, y);
        }
        c.strokeShape(shape);
      }}
      stroke="rgba(0,0,0,0.28)"
      strokeWidth={1 / scale}
      dash={[1 / scale, 3 / scale]}
    />
  );
}

/** The distance from the slide centre shown next to a guide being dragged. */
function GuideLabel({ guide, text, scale }: { guide: Guide; text: string; scale: number }) {
  const at = (guide.pos / EMU_PER_PX) * scale;
  const style = guide.orient === "vertical" ? { left: at + 6, top: 8 } : { left: 8, top: at + 6 };
  return (
    <span data-testid="guide-label" className="pointer-events-none absolute rounded bg-black/75 px-1 text-[11px] text-white" style={style}>
      {text}
    </span>
  );
}

export function EditorStage({ store, width, height }: { store: ShowStore; width: number; height: number }) {
  const t = useT();
  const pres = useShow(store, (s) => s.pres);
  const selection = useShow(store, (s) => s.selection);
  const editing = useShow(store, (s) => s.editing);
  const mediaVersion = useShow(store, (s) => s.mediaVersion);
  const tablePreview = useShow(store, (s) => s.tablePreview);
  // outlines (and with them the adjust handles) arrive asynchronously
  usePathVersion();
  const stageRef = useRef<Konva.Stage>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number; add: boolean } | null>(null);
  const commitPending = useRef<Set<Konva.Node> | null>(null);
  const [guides, setGuidesState] = useState<Guides>(NO_GUIDES);
  const guidesRef = useRef<Guides>(NO_GUIDES);
  const drag = useRef<DragSnap | null>(null);
  const resizeTargets = useRef<SnapLines | null>(null);
  const view = useShow(store, (s) => s.pres?.view) ?? DEFAULT_VIEW;
  // the slides' guides, or the master's / layout's in the master view, and the inherited ones
  const guidePres = useShow(store, (s) => s.pres);
  const guideCurrent = useShow(store, (s) => s.current);
  const guideMaster = useShow(store, (s) => s.masterView);
  const guideSet = guidePres ? guideSets(guidePres, guideMaster, guideCurrent) : { editable: [], inherited: [] };
  const viewRef = useRef(view);
  viewRef.current = view;
  /** A drawing guide being dragged: its index and position (EMU) so far. */
  const [guideDrag, setGuideDrag] = useState<{ index: number; pos: number } | null>(null);
  const locale = useLocale();
  /** Pointer at the last mouse-down (a drag's start: Konva fires `dragstart` only after the first move). */
  const downPointer = useRef<{ x: number; y: number } | null>(null);
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; items: ContextMenuItem[] } | null>(null);
  const drawMode = useShow(store, (s) => s.drawMode);
  /** A shape or connector being drawn (EMU). */
  const [drawing, setDrawing] = useState<{ start: ConnEnd; end: ConnEnd; shift: boolean } | null>(null);
  // Freeform: Shape / Scribble in progress (P9-S2)
  const [free, setFree] = useState<FreeformState | null>(null);
  const freeRef = useRef<FreeformState | null>(null);
  /** The last click of a freeform drawing (a second one at the same place soon after is a double-click). */
  const lastFreeClick = useRef<{ p: Pt; t: number } | null>(null);
  freeRef.current = free;
  const editPoints = useShow(store, (s) => s.editPoints);
  const handleFocus = useShow(store, (s) => s.handleFocus);
  /** Connection sites shown (connector being drawn or an end dragged). */
  const [sites, setSites] = useState<{ sites: SlideSite[]; active: SlideSite | null; line?: [Pt, Pt] } | null>(null);
  /** A shape drawn instead of the model's while a handle is dragged. */
  const [preview, setPreview] = useState<Shape | null>(null);

  const masterView = useShow(store, (s) => s.masterView);
  const cropping = useShow(store, (s) => s.crop);
  const slide = useShow(store, (s) => viewSlide(s));
  const size = pres ? slidePx(pres.slideSize) : { width: 1280, height: 720 };
  const scale = pres ? fitScale(width, height, pres.slideSize) : 0;

  // Attach the transformer to the selected top-level shapes.
  useEffect(() => {
    const stage = stageRef.current;
    const tr = trRef.current;
    if (!stage || !tr) return;
    const sl = store.currentSlide();
    const only = selection.length === 1 ? sl?.shapes.find((x) => x.id === selection[0]) : undefined;
    const nodes = drawMode || cropping || only?.kind.kind === "connector" || (only && store.getState().editPoints === only.id)
      ? []
      : selection.map((id) => stage.findOne(`#shape-${id}`)).filter((n): n is Konva.Node => !!n);
    tr.nodes(nodes);
    tr.getLayer()?.batchDraw();
  }, [selection, slide, drawMode, cropping, store, editPoints]);

  const setGuides = useCallback((g: Guides) => {
    if (sameGuides(g, guidesRef.current)) return;
    guidesRef.current = g;
    setGuidesState(g);
  }, []);

  /** Snap lines of the slide, of the shapes not in `moving` (visible ones) and of the drawing guides. */
  const targetsFor = useCallback(
    (moving: Set<NodeId>): SnapLines | null => {
      const sl = store.currentSlide();
      const p = store.getState().pres;
      if (!sl || !p) return null;
      const others = sl.shapes.filter((s) => !moving.has(s.id) && !s.hidden).map((s) => boundsPx(s.transform));
      const sets = guideSets(p, store.getState().masterView, store.getState().current);
      return { shapes: snapTargets(slidePx(p.slideSize), others), guides: guideTargets({ guides: sets.editable, showGuides: !!p.view?.showGuides }, sets.inherited), others };
    },
    [store],
  );
  /** Grid step in slide px while "Snap objects to grid" is on (else 0). */
  const gridStep = () => (viewRef.current.snapToGrid ? viewRef.current.gridSpacing / EMU_PER_PX : 0);

  const onShapeDragStart = useCallback(
    (node: Konva.Node) => {
      // The transformer starts dragging the other selected nodes itself: keep the first start.
      if (drag.current?.starts.has(node)) return;
      const stage = stageRef.current;
      const sl = store.currentSlide();
      const pointer = downPointer.current ?? stage?.getPointerPosition();
      if (!stage || !sl || !pointer) return;
      const trNodes = trRef.current?.nodes() ?? [];
      const nodes = trNodes.includes(node) ? trNodes : [node];
      const ids = new Set(nodes.map((n) => n.getAttr("shapeId") as NodeId));
      const box = union(sl.shapes.filter((s) => ids.has(s.id)).map((s) => boundsPx(s.transform)));
      const lines = targetsFor(ids);
      if (!box || !lines) return;
      drag.current = { pointer, starts: new Map(nodes.map((n) => [n, n.getAbsolutePosition()])), box, lines };
    },
    [store, targetsFor],
  );

  /** Every dragged node follows the pointer by the same delta, corrected by the snap of the selection's box. */
  const shapeDragBound = useCallback(
    (node: Konva.Node, pos: { x: number; y: number }, evt: MouseEvent | undefined) => {
      const d = drag.current;
      const start = d?.starts.get(node);
      const pointer = stageRef.current?.getPointerPosition();
      if (!d || !start || !pointer || scale <= 0) return pos;
      const dx = pointer.x - d.pointer.x;
      const dy = pointer.y - d.pointer.y;
      if (evt?.altKey) {
        setGuides(NO_GUIDES);
        return { x: start.x + dx, y: start.y + dy };
      }
      const moved = { ...d.box, x: d.box.x + dx / scale, y: d.box.y + dy / scale };
      const snap = snapMove(moved, d.lines, d.lines.others, { shapes: viewRef.current.snapToShapes, grid: gridStep(), threshold: SNAP_PX / scale });
      setGuides(snap.guides);
      return { x: start.x + dx + snap.dx * scale, y: start.y + dy + snap.dy * scale };
    },
    [scale, setGuides],
  );

  /** Resize handles snap too (one unrotated shape; Alt turns it off). */
  const anchorBound = useCallback(
    (_old: { x: number; y: number }, pos: { x: number; y: number }, evt: MouseEvent | undefined) => {
      const tr = trRef.current;
      const nodes = tr?.nodes() ?? [];
      if (!tr || nodes.length !== 1 || evt?.altKey || Math.abs(nodes[0]!.rotation()) > 0.01 || scale <= 0) {
        setGuides(NO_GUIDES);
        return pos;
      }
      if (!resizeTargets.current) resizeTargets.current = targetsFor(new Set([nodes[0]!.getAttr("shapeId") as NodeId]));
      const l = resizeTargets.current;
      if (!l) return pos;
      const smart = viewRef.current.snapToShapes;
      const t: SnapTargets = { xs: [...(smart ? l.shapes.xs : []), ...l.guides.xs], ys: [...(smart ? l.shapes.ys : []), ...l.guides.ys] };
      const axes = anchorAxes(tr.getActiveAnchor());
      const p = snapPoint({ x: pos.x / scale, y: pos.y / scale }, t, SNAP_PX / scale, axes);
      // the grid where no guide caught the handle
      const g = gridStep();
      const x = g > 0 && axes.x && !p.guides.v.length ? snapToGrid(p.x, g) : p.x;
      const y = g > 0 && axes.y && !p.guides.h.length ? snapToGrid(p.y, g) : p.y;
      setGuides(p.guides);
      return { x: x * scale, y: y * scale };
    },
    [scale, setGuides, targetsFor],
  );

  const endSnap = useCallback(() => {
    drag.current = null;
    resizeTargets.current = null;
    setGuides(NO_GUIDES);
  }, [setGuides]);

  /** One command per gesture: collects every changed node of the transformer. */
  const commitGesture = useCallback((dragged?: Konva.Node) => {
    endSnap();
    if (commitPending.current) {
      if (dragged) commitPending.current.add(dragged);
      return;
    }
    const pending = new Set<Konva.Node>(dragged ? [dragged] : []);
    commitPending.current = pending;
    queueMicrotask(() => {
      commitPending.current = null;
      const sl = store.currentSlide();
      if (!sl) return;
      for (const n of trRef.current?.nodes() ?? []) pending.add(n);
      const items = [...pending].flatMap((node) => {
        const id = node.getAttr("shapeId") as NodeId;
        const shape = sl.shapes.find((s) => s.id === id);
        if (!shape) return [];
        const attrs = { x: node.x(), y: node.y(), rotation: node.rotation(), scaleX: node.scaleX(), scaleY: node.scaleY() };
        // Snap the node back to the model; the patch re-renders it at the new place
        // (and a rejected command leaves it where the model says).
        const b = boxAttrs(shape.transform);
        node.setAttrs({ x: b.x, y: b.y, rotation: b.rotation, scaleX: 1, scaleY: 1 });
        return [{ shape, attrs }];
      });
      void store.run(store.withAutofit(gestureCommand(items)));
    });
  }, [store, endSnap]);

  // freeform drawing: the tolerances in EMU at this zoom, ending on Enter / Esc
  const freeTol = { snap: (8 / Math.max(scale, 1e-6)) * EMU_PER_PX, step: (3 / Math.max(scale, 1e-6)) * EMU_PER_PX };
  const finishFree = (s: FreeformState) => {
    setFree(null);
    const g = s.done ? freeformGeometry(s, freeTol.step / 2) : null;
    const mode = store.getState().drawMode;
    if (g && mode) void store.insertFreeform(mode, g.transform, g.path);
    else store.setDrawMode(null);
  };
  const finishRef = useRef(finishFree);
  finishRef.current = finishFree;
  const tolRef = useRef(freeTol);
  tolRef.current = freeTol;
  useEffect(() => setFree(null), [drawMode]);
  const drawingFree = free !== null;
  useEffect(() => {
    if (!drawingFree) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" && e.key !== "Escape") return;
      const s = freeRef.current;
      if (!s) return;
      e.preventDefault();
      e.stopPropagation();
      finishRef.current(freeformFinish(s, tolRef.current));
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [drawingFree]);

  if (!pres || !slide || scale === 0) return null;

  const pointer = (): { x: number; y: number } | null => {
    const p = stageRef.current?.getPointerPosition();
    return p ? { x: p.x / scale, y: p.y / scale } : null;
  };

  // ----- Insert › Shapes: click or drag on the slide (P8-16)
  const choice = drawMode ? choiceOf(drawMode) : null;
  const emuPointer = (): Pt | null => {
    const p = pointer();
    return p ? { x: p.x * EMU_PER_PX, y: p.y * EMU_PER_PX } : null;
  };
  const endAt = (p: Pt): ConnEnd => (choice?.kind === "connector" ? connectorTarget(slide.shapes, p, scale).end : { p, site: null });
  const onPointerDown = (e: Konva.KonvaEventObject<PointerEvent>) => {
    if (!choice || e.evt.button !== 0) return;
    const p = emuPointer();
    if (!p) return;
    if (choice.kind === "freehand") {
      setFree(freeformDown(free ?? startFreeform(choice.mode), p));
      return;
    }
    const start = endAt(p);
    setDrawing({ start, end: start, shift: e.evt.shiftKey });
  };
  const onPointerMove = (e: Konva.KonvaEventObject<PointerEvent>) => {
    if (!choice) return;
    const p = emuPointer();
    if (!p) return;
    if (choice.kind === "freehand") {
      if (free) setFree(freeformMove(free, p, freeTol));
      return;
    }
    if (choice.kind === "connector") {
      const r = connectorTarget(slide.shapes, p, scale);
      setSites(r.hover ? { sites: r.sites, active: r.end.site } : null);
    }
    if (drawing) setDrawing({ ...drawing, end: endAt(p), shift: e.evt.shiftKey });
  };
  const onPointerUp = () => {
    if (choice?.kind === "freehand") {
      const p = emuPointer();
      if (!free || !p) return;
      const next = freeformUp(free, p, freeTol);
      if (next.done) {
        lastFreeClick.current = null;
        finishFree(next);
        return;
      }
      // a double-click (two clicks at one place) ends the freeform open
      const clicked = !free.dragged && choice.mode === "freeform";
      const prev = lastFreeClick.current;
      const now = performance.now();
      if (clicked && prev && now - prev.t < 500 && dist(prev.p, p) <= freeTol.snap) {
        lastFreeClick.current = null;
        finishFree(freeformFinish(next, freeTol));
        return;
      }
      lastFreeClick.current = clicked ? { p, t: now } : null;
      setFree(next);
      return;
    }
    const d = drawing;
    if (!choice || !drawMode || !d) return;
    setDrawing(null);
    setSites(null);
    const a = d.start.site ?? d.start.p;
    const b = d.end.site ?? d.end.p;
    const click = dist(a, b) < (3 / scale) * EMU_PER_PX;
    if (choice.kind === "connector") {
      const end: ConnEnd = click ? { p: { x: a.x + clickBox(choice, 0, 0).w, y: a.y }, site: null } : d.shift && !d.end.site ? { p: snap45(a, b), site: null } : d.end;
      void store.insertConnector(drawMode, d.start, end);
      return;
    }
    const box = click ? clickBox(choice, a.x, a.y) : { ...dragBox(a, b, d.shift), rotationDeg: 0 };
    void store.insertChoice(drawMode, box, !click);
  };
  const drawPreview = (() => {
    if (!drawing || !choice) return null;
    const a = drawing.start.site ?? drawing.start.p;
    const b = drawing.end.site ?? drawing.end.p;
    if (choice.kind === "connector") return <PreviewLine a={a} b={drawing.shift && !drawing.end.site ? snap45(a, b) : b} scale={scale} />;
    const r = dragBox(a, b, drawing.shift);
    return <Rect name="draw-preview" x={r.x / EMU_PER_PX} y={r.y / EMU_PER_PX} width={r.w / EMU_PER_PX} height={r.h / EMU_PER_PX} stroke="#2563eb" strokeWidth={1 / scale} dash={[4 / scale, 3 / scale]} listening={false} />;
  })();

  const onMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    downPointer.current = stageRef.current?.getPointerPosition() ?? null;
    const target = e.target;
    if (choice) return;
    if (target.getParent()?.className === "Transformer" || target.getClassName?.() === "Transformer") return;
    if (target.hasName?.("edit-handle")) return;
    const shift = e.evt.shiftKey || e.evt.ctrlKey || e.evt.metaKey;
    const { top } = shapeTargets(target);
    if (top === null) {
      if (store.getState().editing) void store.commitEdit();
      if (!shift) store.select([]);
      const p = pointer();
      if (p) setMarquee({ x0: p.x, y0: p.y, x1: p.x, y1: p.y, add: shift });
      return;
    }
    const sel = store.getState().selection;
    if (shift) store.select([top], "toggle");
    else if (!sel.includes(top)) store.select([top]);
  };

  const onMouseMove = () => {
    if (!marquee || choice) return;
    const p = pointer();
    if (p) setMarquee({ ...marquee, x1: p.x, y1: p.y });
  };

  const onMouseUp = () => {
    if (!marquee || choice) return;
    const r: R = rectFromPoints(marquee.x0, marquee.y0, marquee.x1, marquee.y1);
    setMarquee(null);
    if (r.width < 2 && r.height < 2) return;
    store.select(shapesInRect(slide.shapes, r), marquee.add ? "add" : "replace");
  };

  const onDblClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (choice || e.target.hasName?.("edit-handle")) return;
    const { leaf } = shapeTargets(e.target);
    if (leaf === null) return;
    const hit = findShape(slide.shapes, leaf);
    if (hit) store.startEdit(hit.shape.id);
  };

  const onContextMenu = (e: Konva.KonvaEventObject<PointerEvent>) => {
    e.evt.preventDefault();
    const { top } = shapeTargets(e.target);
    if (store.getState().editing) void store.commitEdit();
    if (top === null) store.select([]);
    else if (!store.getState().selection.includes(top)) store.select([top]);
    if (choice) {
      store.setDrawMode(null);
      return;
    }
    setMenu({ at: { x: e.evt.clientX, y: e.evt.clientY }, items: masterView ? masterMenu(store) : top === null ? slideMenu(store) : shapeMenu(store) });
  };

  // Pictures keep their aspect ratio on corner handles (Shift frees it); other shapes keep it with Shift.
  const sel = store.selectedShapes();
  // corner drags keep the proportions of shapes with a locked aspect ratio (pictures start locked)
  const pictures = sel.length > 0 && sel.every((s) => !!s.lockAspect);
  const m = marquee ? rectFromPoints(marquee.x0, marquee.y0, marquee.x1, marquee.y1) : null;
  const one = !drawMode && !editing && sel.length === 1 ? sel[0]! : null;
  const overrides = new Map<NodeId, Shape>(preview ? [[preview.id, preview]] : []);
  // Table Design › Table Styles: the style under the pointer, shown on the selected table
  if (tablePreview && one?.kind.kind === "table") overrides.set(one.id, { ...one, kind: { kind: "table", value: { ...one.kind.value, styleId: tablePreview } } });

  return (
    <div
      className="relative"
      style={{ width: size.width * scale, height: size.height * scale, cursor: drawMode ? "crosshair" : undefined }}
      data-testid="editor-stage"
      data-guides={guides.v.length + guides.h.length}
      data-spacing-guides={guides.spacing?.length ?? 0}
      data-drawing-guides={view.showGuides ? guideSet.editable.length : 0}
      data-design-guides={view.showGuides ? guideSet.inherited.length : 0}
      data-grid={view.showGrid ? "true" : undefined}
      data-draw-mode={drawMode ?? undefined}
      data-master-view={masterView ? (masterView.kind === "master" ? "master" : masterView.value) : undefined}
      data-adjust-handles={one?.kind.kind === "auto" ? handlesOf(one).length : undefined}
      onPointerDownCapture={(e) => {
        // a press on the slide takes the keyboard from the ribbon / backstage (arrows nudge, Tab cycles handles)
        const a = document.activeElement;
        if (a instanceof HTMLElement && a !== document.body && !e.currentTarget.contains(a)) a.blur();
      }}
    >
      <Stage
        ref={stageRef}
        width={size.width * scale}
        height={size.height * scale}
        scaleX={scale}
        scaleY={scale}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onDblClick={onDblClick}
        onContextMenu={onContextMenu}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <Layer>
          <SlideView
            deck={stableDeck(pres)}
            slide={slide}
            media={store.media}
            mediaVersion={mediaVersion}
            interactive={!drawMode}
            prompts
            design={masterView ? (masterView.kind === "master" ? "master" : "layout") : undefined}
            hiddenText={editing?.shape ?? null}
            hiddenCell={editing?.cell ?? null}
            overrides={overrides.size ? overrides : undefined}
            onShapeDragEnd={commitGesture}
            onShapeDragStart={onShapeDragStart}
            shapeDragBound={shapeDragBound}
          />
          {view.showGrid && <GridLines width={size.width} height={size.height} step={view.gridSpacing / EMU_PER_PX} scale={scale} />}
          {view.showGuides &&
            guideSet.inherited.map((g, i) => {
              const vertical = g.orient === "vertical";
              const at = g.pos / EMU_PER_PX;
              return (
                <KLine
                  key={`d${i}-${g.orient}-${g.pos}`}
                  name="design-guide"
                  points={vertical ? [at, 0, at, size.height] : [0, at, size.width, at]}
                  stroke={`#${g.color ?? DESIGN_GUIDE_COLOR}`}
                  strokeWidth={1 / scale}
                  dash={[6 / scale, 3 / scale]}
                  listening={false}
                />
              );
            })}
          {view.showGuides &&
            guideSet.editable.map((g, i) => {
              const vertical = g.orient === "vertical";
              const at = (guideDrag?.index === i ? guideDrag.pos : g.pos) / EMU_PER_PX;
              return (
                <KLine
                  key={`g${i}-${g.orient}-${g.pos}`}
                  name="drawing-guide"
                  points={vertical ? [at, 0, at, size.height] : [0, at, size.width, at]}
                  stroke={g.color ? `#${g.color}` : masterView ? `#${DESIGN_GUIDE_COLOR}` : GUIDE_COLOR}
                  strokeWidth={1 / scale}
                  dash={[6 / scale, 3 / scale]}
                  hitStrokeWidth={10 / scale}
                  draggable={!drawMode}
                  dragBoundFunc={function (this: Konva.Node, pos: { x: number; y: number }) {
                    return vertical ? { x: pos.x, y: this.getAbsolutePosition().y } : { x: this.getAbsolutePosition().x, y: pos.y };
                  }}
                  onMouseEnter={(e) => {
                    const c = e.target.getStage()?.container();
                    if (c) c.style.cursor = vertical ? "ew-resize" : "ns-resize";
                  }}
                  onMouseLeave={(e) => {
                    const c = e.target.getStage()?.container();
                    if (c) c.style.cursor = "";
                  }}
                  onDragMove={(e) => {
                    const off = vertical ? e.target.x() : e.target.y();
                    setGuideDrag({ index: i, pos: Math.round(g.pos + off * EMU_PER_PX) });
                  }}
                  onDragEnd={(e) => {
                    const off = vertical ? e.target.x() : e.target.y();
                    e.target.position({ x: 0, y: 0 });
                    setGuideDrag(null);
                    void store.dropGuide(i, Math.round(g.pos + off * EMU_PER_PX), e.evt.ctrlKey || e.evt.metaKey);
                  }}
                  onContextMenu={(e) => {
                    e.evt.preventDefault();
                    e.cancelBubble = true;
                    setMenu({ at: { x: e.evt.clientX, y: e.evt.clientY }, items: guideMenu(store, i) });
                  }}
                />
              );
            })}
          <Transformer
            ref={trRef}
            flipEnabled={false}
            keepRatio={pictures}
            shiftBehavior={pictures ? "inverted" : "default"}
            anchorDragBoundFunc={anchorBound}
            ignoreStroke
            rotationSnaps={[0, 45, 90, 135, 180, 225, 270, 315]}
            boundBoxFunc={(oldBox, newBox) => (newBox.width < 1 && newBox.height < 1 ? oldBox : newBox)}
            onTransformEnd={() => commitGesture()}
          />
          {guides.v.map((x) => (
            <KLine key={`v${x}`} name="guide" points={[x, 0, x, size.height]} stroke={SMART_GUIDE_COLOR} strokeWidth={1 / scale} dash={[4 / scale, 3 / scale]} listening={false} />
          ))}
          {guides.h.map((y) => (
            <KLine key={`h${y}`} name="guide" points={[0, y, size.width, y]} stroke={SMART_GUIDE_COLOR} strokeWidth={1 / scale} dash={[4 / scale, 3 / scale]} listening={false} />
          ))}
          {(guides.spacing ?? []).flatMap((m, mi) =>
            m.segments.map(([a, b], si) => {
              const t = 4 / scale;
              const pts = m.axis === "x" ? [a, m.at, b, m.at] : [m.at, a, m.at, b];
              const ends = m.axis === "x" ? [[a, m.at - t, a, m.at + t], [b, m.at - t, b, m.at + t]] : [[m.at - t, a, m.at + t, a], [m.at - t, b, m.at + t, b]];
              return (
                <Group key={`s${mi}-${si}`} name="spacing-guide" listening={false}>
                  <KLine points={pts} stroke={SMART_GUIDE_COLOR} strokeWidth={1 / scale} />
                  {ends.map((e, k) => <KLine key={k} points={e} stroke={SMART_GUIDE_COLOR} strokeWidth={1 / scale} />)}
                </Group>
              );
            }),
          )}
          {free && <FreeformPreview points={freeformPreview(free)} scale={scale} />}
          {one?.kind.kind === "auto" && editPoints === one.id && (
            <EditPointsLayer
              shape={one}
              scale={scale}
              onCommit={(cmds, fill) => void store.applyEditPoints(one.id, cmds, fill)}
              onMenu={(at, items) => setMenu({ at, items })}
              onExit={() => store.setEditPoints(false)}
            />
          )}
          {one?.kind.kind === "auto" && editPoints !== one.id && (
            <AdjustHandles shape={preview?.id === one.id ? preview : one} scale={scale} focus={handleFocus} onPreview={setPreview} onCommit={(id, adjust) => void store.setAdjust(id, adjust)} />
          )}
          {one?.kind.kind === "connector" && (
            <ConnectorHandles
              shape={one}
              shapes={slide.shapes}
              scale={scale}
              onTarget={(x) => setSites(x)}
              onPreview={setPreview}
              onMoveEnd={(which, to) => void store.moveConnectorEnd(one.id, which, to)}
              onAdjust={(adjust) => void store.setConnectorAdjust(one.id, adjust)}
            />
          )}
          {sites && <SiteDots sites={sites.sites} active={sites.active} scale={scale} />}
          {sites?.line && <PreviewLine a={sites.line[0]} b={sites.line[1]} scale={scale} />}
          {drawPreview}
          {m && (
            <Rect
              name="marquee"
              x={m.x}
              y={m.y}
              width={m.width}
              height={m.height}
              fill="rgba(59,130,246,0.12)"
              stroke="#3b82f6"
              strokeWidth={1 / scale}
              listening={false}
            />
          )}
        </Layer>
      </Stage>
      {guideDrag && guideSet.editable[guideDrag.index] && (
        <GuideLabel
          guide={{ ...guideSet.editable[guideDrag.index]!, pos: guideDrag.pos }}
          text={guideLabel({ orient: guideSet.editable[guideDrag.index]!.orient, pos: guideDrag.pos }, pres.slideSize, rulerUnit(locale), (n) => formatNumber(n, { minimumFractionDigits: 2, maximumFractionDigits: 2 }))}
          scale={scale}
        />
      )}
      <TableOverlay store={store} scale={scale} onMenu={(at) => setMenu({ at, items: tableMenu(store) })} />
      {one?.kind.kind === "auto" && !masterView && !cropping && <AutofitButton store={store} shape={one} scale={scale} />}
      {editing && <TextOverlay store={store} scale={scale} />}
      {!masterView && <AnimBadges store={store} slide={slide} scale={scale} />}
      {!masterView && <StagePreview store={store} deck={stableDeck(pres)} slides={pres.slides} index={pres.slides.indexOf(slide)} width={size.width * scale} height={size.height * scale} />}
      {cropping && <CropOverlay store={store} scale={scale} />}
      <ContextMenu at={menu?.at ?? null} label={t("show.slideEditor")} items={menu?.items ?? []} onClose={() => setMenu(null)} />
    </div>
  );
}
