// The slide editor: the current slide scaled to the viewport, selection
// (click, shift-click, marquee), a Transformer for move/resize/rotate
// (one `SetTransform` per gesture), double-click text editing.

import { useCallback, useEffect, useRef, useState } from "react";
import { Layer, Rect, Stage, Transformer } from "react-konva";
import type Konva from "konva";
import type { NodeId } from "../generated/NodeId";
import { boxAttrs, fitScale, rectFromPoints, shapesInRect, slidePx, type Rect as R } from "../geometry";
import { findShape } from "../model";
import { gestureCommand } from "../state/commands";
import { useShow, type ShowStore } from "../state/store";
import { SlideView } from "./SlideView";
import { TextOverlay } from "./TextOverlay";

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
  const pres = useShow(store, (s) => s.pres);
  const current = useShow(store, (s) => s.current);
  const selection = useShow(store, (s) => s.selection);
  const editing = useShow(store, (s) => s.editing);
  const mediaVersion = useShow(store, (s) => s.mediaVersion);
  const stageRef = useRef<Konva.Stage>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number; add: boolean } | null>(null);
  const commitPending = useRef<Set<Konva.Node> | null>(null);

  const slide = pres?.slides.find((s) => s.id === current) ?? null;
  const size = pres ? slidePx(pres.slideSize) : { width: 1280, height: 720 };
  const scale = pres ? fitScale(width, height, pres.slideSize) : 0;

  // Attach the transformer to the selected top-level shapes.
  useEffect(() => {
    const stage = stageRef.current;
    const tr = trRef.current;
    if (!stage || !tr) return;
    const nodes = selection
      .map((id) => stage.findOne(`#shape-${id}`))
      .filter((n): n is Konva.Node => !!n);
    tr.nodes(nodes);
    tr.getLayer()?.batchDraw();
  }, [selection, slide]);

  /** One command per gesture: collects every changed node of the transformer. */
  const commitGesture = useCallback((dragged?: Konva.Node) => {
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
  }, [store]);

  if (!pres || !slide || scale === 0) return null;

  const pointer = (): { x: number; y: number } | null => {
    const p = stageRef.current?.getPointerPosition();
    return p ? { x: p.x / scale, y: p.y / scale } : null;
  };

  const onMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const target = e.target;
    if (target.getParent()?.className === "Transformer" || target.getClassName?.() === "Transformer") return;
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
    if (!marquee) return;
    const p = pointer();
    if (p) setMarquee({ ...marquee, x1: p.x, y1: p.y });
  };

  const onMouseUp = () => {
    if (!marquee) return;
    const r: R = rectFromPoints(marquee.x0, marquee.y0, marquee.x1, marquee.y1);
    setMarquee(null);
    if (r.width < 2 && r.height < 2) return;
    store.select(shapesInRect(slide.shapes, r), marquee.add ? "add" : "replace");
  };

  const onDblClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const { leaf } = shapeTargets(e.target);
    if (leaf === null) return;
    const hit = findShape(slide.shapes, leaf);
    if (hit) store.startEdit(hit.shape.id);
  };

  const m = marquee ? rectFromPoints(marquee.x0, marquee.y0, marquee.x1, marquee.y1) : null;

  return (
    <div className="relative" style={{ width: size.width * scale, height: size.height * scale }} data-testid="editor-stage">
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
      >
        <Layer>
          <SlideView
            deck={pres}
            slide={slide}
            media={store.media}
            mediaVersion={mediaVersion}
            interactive
            prompts
            hiddenText={editing?.shape ?? null}
            onShapeDragEnd={commitGesture}
          />
          <Transformer
            ref={trRef}
            flipEnabled={false}
            keepRatio={false}
            ignoreStroke
            rotationSnaps={[0, 45, 90, 135, 180, 225, 270, 315]}
            boundBoxFunc={(oldBox, newBox) => (newBox.width < 1 && newBox.height < 1 ? oldBox : newBox)}
            onTransformEnd={() => commitGesture()}
          />
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
      {editing && <TextOverlay store={store} scale={scale} />}
    </div>
  );
}
