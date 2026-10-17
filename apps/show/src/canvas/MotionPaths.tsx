// Motion paths on the editor stage (P9-S4), like PowerPoint: while the
// Animations tab or the Animation pane is shown, each motion path of the
// slide is drawn as a dotted line from its shape's centre (green start
// triangle, red end mark); the selected one shows its vertices as handles
// (Edit Points) – dragging one sends the whole new path. Add Animation ›
// Custom Path arms `CustomPathDraw`: a drag over the stage draws the path
// (released: the animation is added).

import { useMemo, useRef, useState } from "react";
import { Circle, Group, Path as KPath, RegularPolygon } from "react-konva";
import type { Animation } from "../generated/Animation";
import type { Slide } from "../generated/Slide";
import { effectivePath } from "../anim/effects";
import { drawnPath, moveVertex, formatPath, parsePath, pathEnd, svgOfPath, vertices } from "../anim/motion";
import { boundsPx } from "../geometry";
import { findShape } from "../model";
import { useShow, type ShowStore } from "../state/store";

/** The centre of an animated shape (slide px). */
function centerOf(slide: Slide, a: Animation): { x: number; y: number } | null {
  const hit = findShape(slide.shapes, a.shape);
  if (!hit) return null;
  const b = boundsPx((hit.parents.length ? hit.top : hit.shape).transform);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

export function MotionPathLayer({ store, slide, width, height, scale }: { store: ShowStore; slide: Slide; width: number; height: number; scale: number }) {
  const tab = useShow(store, (s) => s.ribbonTab);
  const pane = useShow(store, (s) => s.animPane);
  const selected = useShow(store, (s) => s.animSelection);
  const [drag, setDrag] = useState<{ id: number; index: number; dx: number; dy: number } | null>(null);
  const paths = useMemo(
    () =>
      (slide.animations ?? []).flatMap((a) => {
        if (a.kind !== "path") return [];
        const cmds = parsePath(effectivePath(a) ?? "");
        const c = centerOf(slide, a);
        return cmds && c ? [{ a, cmds, c }] : [];
      }),
    [slide],
  );
  if ((tab !== "animations" && !pane) || !paths.length) return null;
  const lw = 1.5 / scale;
  return (
    <Group name="motion-paths">
      {paths.map(({ a, cmds: base, c }) => {
        const on = a.id === selected;
        const cmds = drag && drag.id === a.id ? moveVertex(base, drag.index, drag.dx, drag.dy) : base;
        const end = pathEnd(cmds);
        return (
          <Group key={a.id} name="motion-path" motionPath={a.id}>
            <KPath
              data={svgOfPath(cmds, c.x, c.y, width, height)}
              stroke={on ? "#c2410c" : "#555"}
              strokeWidth={lw}
              dash={[4 / scale, 3 / scale]}
              hitStrokeWidth={10 / scale}
              onClick={(e) => {
                e.cancelBubble = true;
                store.selectAnimation(a.id);
              }}
            />
            <RegularPolygon x={c.x} y={c.y} sides={3} radius={6 / scale} rotation={90} fill="#2f9e44" listening={false} />
            <RegularPolygon x={c.x + end.x * width} y={c.y + end.y * height} sides={3} radius={6 / scale} rotation={90} fill="#e03131" listening={false} />
            {on &&
              vertices(cmds)
                .filter((v) => v.index > 0)
                .map((v) => (
                  <Circle
                    key={v.index}
                    name="path-vertex"
                    x={c.x + v.x * width}
                    y={c.y + v.y * height}
                    radius={5 / scale}
                    fill="#fff"
                    stroke="#c2410c"
                    strokeWidth={lw}
                    draggable
                    onMouseDown={(e) => (e.cancelBubble = true)}
                    onDragMove={(e) => {
                      const k = base.find((_, i) => i === v.index);
                      if (!k || k.c === "Z") return;
                      setDrag({ id: a.id, index: v.index, dx: (e.target.x() - c.x) / width - k.x, dy: (e.target.y() - c.y) / height - k.y });
                    }}
                    onDragEnd={(e) => {
                      const k = base[v.index];
                      setDrag(null);
                      if (!k || k.c === "Z") return;
                      const next = moveVertex(base, v.index, (e.target.x() - c.x) / width - k.x, (e.target.y() - c.y) / height - k.y);
                      void store.setAnimationPath(a.id, formatPath(next));
                    }}
                  />
                ))}
          </Group>
        );
      })}
    </Group>
  );
}

/** Add Animation › Custom Path: a drag on the stage (DOM layer over it) draws the path of the selected shape. */
export function CustomPathDraw({ store, slide, width, height, scale }: { store: ShowStore; slide: Slide; width: number; height: number; scale: number }) {
  const armed = useShow(store, (s) => s.pathDraw);
  const selection = useShow(store, (s) => s.selection);
  const [points, setPoints] = useState<{ x: number; y: number }[] | null>(null);
  const box = useRef<HTMLDivElement>(null);
  if (!armed) return null;
  const at = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  };
  // the path starts at the shape's centre, whatever point the drag starts at
  const shape = selection[0] !== undefined ? findShape(slide.shapes, selection[0]) : null;
  const b = shape ? boundsPx(shape.top.transform) : null;
  const origin = b ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null;
  return (
    <div
      ref={box}
      className="absolute inset-0 z-20 cursor-crosshair touch-none"
      data-testid="custom-path-draw"
      onKeyDown={(e) => e.key === "Escape" && store.armCustomPath(false)}
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        setPoints([at(e)]);
      }}
      onPointerMove={(e) => {
        if (points) setPoints([...points, at(e)]);
      }}
      onPointerUp={(e) => {
        if (!points) return;
        const all = [...points, at(e)];
        setPoints(null);
        // relative to the drag's start, then moved to start at the shape
        const path = drawnPath(all, { width, height });
        if (path) void store.finishCustomPath(path);
        else store.armCustomPath(false);
      }}
    >
      {points && origin && (
        <svg className="pointer-events-none absolute inset-0" width={width * scale} height={height * scale}>
          <polyline
            points={points.map((p) => `${(p.x - points[0]!.x + origin.x) * scale},${(p.y - points[0]!.y + origin.y) * scale}`).join(" ")}
            fill="none"
            stroke="#c2410c"
            strokeWidth={1.5}
            strokeDasharray="4 3"
          />
        </svg>
      )}
    </div>
  );
}
