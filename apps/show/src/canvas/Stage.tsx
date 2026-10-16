// The slide editor: the current slide scaled to the viewport, selection
// (click, shift-click, marquee), a Transformer for move/resize/rotate
// (one `SetTransform` per gesture) with smart guides (snapping to the
// slide and the other shapes; Alt turns it off), double-click text
// editing (also of a group's child) and the right-click menus.

import { useCallback, useEffect, useRef, useState } from "react";
import { Layer, Line as KLine, Rect, Stage, Transformer } from "react-konva";
import type Konva from "konva";
import { ContextMenu, type ContextMenuItem } from "@rusuite/ui-shared";
import type { NodeId } from "../generated/NodeId";
import type { Shape } from "../generated/Shape";
import { boundsPx, boxAttrs, EMU_PER_PX, fitScale, rectFromPoints, shapesInRect, slidePx, type Rect as R } from "../geometry";
import { dist, dragBox, snap45, type Pt } from "../shapes/geom";
import { choiceOf, clickBox } from "../shapes/presets";
import type { ConnEnd, SlideSite } from "../shapes/connectors";
import { AdjustHandles, ConnectorHandles, PreviewLine, SiteDots, connectorTarget } from "./EditHandles";
import { TableOverlay } from "./TableOverlay";
import { findShape } from "../model";
import { gestureCommand } from "../state/commands";
import { useShow, viewSlide, type ShowStore } from "../state/store";
import { CropOverlay } from "./CropOverlay";
import { masterMenu } from "./menus";
import { shapeMenu, slideMenu, tableMenu } from "./menus";
import { NO_GUIDES, SNAP_PX, anchorAxes, sameGuides, snapBox, snapPoint, snapTargets, type Guides, type SnapTargets } from "./snap";
import { SlideView } from "./SlideView";
import { stableDeck } from "../design/deck";
import { TextOverlay } from "./TextOverlay";
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

/** State of a drag of the selection: where it started and what it can snap to. */
interface DragSnap {
  pointer: { x: number; y: number };
  starts: Map<Konva.Node, { x: number; y: number }>;
  box: R;
  targets: SnapTargets;
}

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

export function EditorStage({ store, width, height }: { store: ShowStore; width: number; height: number }) {
  const t = useT();
  const pres = useShow(store, (s) => s.pres);
  const selection = useShow(store, (s) => s.selection);
  const editing = useShow(store, (s) => s.editing);
  const mediaVersion = useShow(store, (s) => s.mediaVersion);
  const stageRef = useRef<Konva.Stage>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number; add: boolean } | null>(null);
  const commitPending = useRef<Set<Konva.Node> | null>(null);
  const [guides, setGuidesState] = useState<Guides>(NO_GUIDES);
  const guidesRef = useRef<Guides>(NO_GUIDES);
  const drag = useRef<DragSnap | null>(null);
  const resizeTargets = useRef<SnapTargets | null>(null);
  /** Pointer at the last mouse-down (a drag's start: Konva fires `dragstart` only after the first move). */
  const downPointer = useRef<{ x: number; y: number } | null>(null);
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; items: ContextMenuItem[] } | null>(null);
  const drawMode = useShow(store, (s) => s.drawMode);
  /** A shape or connector being drawn (EMU). */
  const [drawing, setDrawing] = useState<{ start: ConnEnd; end: ConnEnd; shift: boolean } | null>(null);
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
    const nodes = drawMode || cropping || only?.kind.kind === "connector"
      ? []
      : selection.map((id) => stage.findOne(`#shape-${id}`)).filter((n): n is Konva.Node => !!n);
    tr.nodes(nodes);
    tr.getLayer()?.batchDraw();
  }, [selection, slide, drawMode, cropping, store]);

  const setGuides = useCallback((g: Guides) => {
    if (sameGuides(g, guidesRef.current)) return;
    guidesRef.current = g;
    setGuidesState(g);
  }, []);

  /** Snap lines of the slide and of the shapes not in `moving`. */
  const targetsFor = useCallback(
    (moving: Set<NodeId>): SnapTargets | null => {
      const sl = store.currentSlide();
      const p = store.getState().pres;
      if (!sl || !p) return null;
      return snapTargets(slidePx(p.slideSize), sl.shapes.filter((s) => !moving.has(s.id)).map((s) => boundsPx(s.transform)));
    },
    [store],
  );

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
      const targets = targetsFor(ids);
      if (!box || !targets) return;
      drag.current = { pointer, starts: new Map(nodes.map((n) => [n, n.getAbsolutePosition()])), box, targets };
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
      const snap = snapBox(moved, d.targets, SNAP_PX / scale);
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
      const t = resizeTargets.current;
      if (!t) return pos;
      const p = snapPoint({ x: pos.x / scale, y: pos.y / scale }, t, SNAP_PX / scale, anchorAxes(tr.getActiveAnchor()));
      setGuides(p.guides);
      return { x: p.x * scale, y: p.y * scale };
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
      void store.run(gestureCommand(items));
    });
  }, [store, endSnap]);

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
    const start = endAt(p);
    setDrawing({ start, end: start, shift: e.evt.shiftKey });
  };
  const onPointerMove = (e: Konva.KonvaEventObject<PointerEvent>) => {
    if (!choice) return;
    const p = emuPointer();
    if (!p) return;
    if (choice.kind === "connector") {
      const r = connectorTarget(slide.shapes, p, scale);
      setSites(r.hover ? { sites: r.sites, active: r.end.site } : null);
    }
    if (drawing) setDrawing({ ...drawing, end: endAt(p), shift: e.evt.shiftKey });
  };
  const onPointerUp = () => {
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
    void store.insertChoice(drawMode, box);
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
  const pictures = sel.length > 0 && sel.every((s) => s.kind.kind === "picture");
  const m = marquee ? rectFromPoints(marquee.x0, marquee.y0, marquee.x1, marquee.y1) : null;
  const one = !drawMode && !editing && sel.length === 1 ? sel[0]! : null;
  const overrides = preview ? new Map([[preview.id, preview]]) : undefined;

  return (
    <div
      className="relative"
      style={{ width: size.width * scale, height: size.height * scale, cursor: drawMode ? "crosshair" : undefined }}
      data-testid="editor-stage"
      data-guides={guides.v.length + guides.h.length}
      data-draw-mode={drawMode ?? undefined}
      data-master-view={masterView ? (masterView.kind === "master" ? "master" : masterView.value) : undefined}
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
            overrides={overrides}
            onShapeDragEnd={commitGesture}
            onShapeDragStart={onShapeDragStart}
            shapeDragBound={shapeDragBound}
          />
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
            <KLine key={`v${x}`} name="guide" points={[x, 0, x, size.height]} stroke="#e8590c" strokeWidth={1 / scale} dash={[4 / scale, 3 / scale]} listening={false} />
          ))}
          {guides.h.map((y) => (
            <KLine key={`h${y}`} name="guide" points={[0, y, size.width, y]} stroke="#e8590c" strokeWidth={1 / scale} dash={[4 / scale, 3 / scale]} listening={false} />
          ))}
          {one?.kind.kind === "auto" && (
            <AdjustHandles shape={preview?.id === one.id ? preview : one} scale={scale} onPreview={setPreview} onCommit={(id, adjust) => void store.setAdjust(id, adjust)} />
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
      <TableOverlay store={store} scale={scale} onMenu={(at) => setMenu({ at, items: tableMenu(store) })} />
      {editing && <TextOverlay store={store} scale={scale} />}
      {!masterView && <AnimBadges store={store} slide={slide} scale={scale} />}
      {!masterView && <StagePreview store={store} deck={stableDeck(pres)} slides={pres.slides} index={pres.slides.indexOf(slide)} width={size.width * scale} height={size.height * scale} />}
      {cropping && <CropOverlay store={store} scale={scale} />}
      <ContextMenu at={menu?.at ?? null} label={t("show.slideEditor")} items={menu?.items ?? []} onClose={() => setMenu(null)} />
    </div>
  );
}
