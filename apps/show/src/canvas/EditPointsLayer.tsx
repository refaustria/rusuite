// Shape Format › Edit Shape › Edit Points (P9-S2): the vertices of the
// selected shape's outline as black squares over the slide. Dragging a
// vertex moves it; Ctrl+click on a vertex deletes it, Ctrl+click on the
// outline adds one; right-click opens PowerPoint's point menu (Add /
// Delete Point, Straight / Curved Segment, Smooth Point, Open / Close
// Path, Exit Edit Points). Every change becomes the shape's custom
// geometry (the box refitted, see `shapes/editPoints`).

import { Line as KLine, Path, Rect } from "react-konva";
import type Konva from "konva";
import type { ContextMenuItem } from "@rusuite/ui-shared";
import type { PathCmd } from "../generated/PathCmd";
import type { Shape } from "../generated/Shape";
import { EMU_PER_PX } from "../geometry";
import { addVertex, deleteVertex, editOutline, moveVertex, nearestSegment, setSegment, smoothVertex, toggleClosed, vertices } from "../shapes/editPoints";
import { mapLocal, toLocal, type Pt } from "../shapes/geom";
import { svgPath, usePathVersion } from "../shapes/paths";
import { useT } from "../i18n";

const px = (v: number) => v / EMU_PER_PX;

export function EditPointsLayer({ shape, scale, onCommit, onMenu, onExit }: {
  shape: Shape;
  scale: number;
  onCommit: (cmds: PathCmd[], fill: boolean) => void;
  onMenu: (at: { x: number; y: number }, items: ContextMenuItem[]) => void;
  onExit: () => void;
}) {
  usePathVersion();
  const t = useT();
  const out = editOutline(shape);
  if (!out) return null;
  const { cmds, fill } = out;
  const tr = shape.transform;
  const toSlide = (x: number, y: number) => mapLocal(tr, x, y);
  const local = (node: Konva.Node): Pt | null => {
    const stage = node.getStage();
    const p = stage?.getPointerPosition();
    if (!stage || !p) return null;
    const s = stage.scaleX() || 1;
    return toLocal(tr, (p.x / s) * EMU_PER_PX, (p.y / s) * EMU_PER_PX);
  };
  const commit = (next: PathCmd[]) => {
    if (next !== cmds) onCommit(next, fill);
  };
  const closed = cmds[cmds.length - 1]?.kind === "close";
  const pathMenu = (extra: ContextMenuItem[]): ContextMenuItem[] => [
    ...extra,
    { id: "ep-close", label: t(closed ? "show.editPoints.open" : "show.editPoints.close"), onSelect: () => commit(toggleClosed(cmds)) },
    { id: "ep-exit", label: t("show.editPoints.exit"), onSelect: onExit },
  ];
  // the outline in slide px (the box's rotation and flips applied point by point)
  const slideCmds = cmds.map((c): PathCmd => {
    const m = (x: number, y: number) => {
      const p = toSlide(x, y);
      return { x: px(p.x), y: px(p.y) };
    };
    if (c.kind === "moveTo" || c.kind === "lineTo") return { ...c, ...m(c.x, c.y) };
    if (c.kind === "cubicTo") {
      const a = m(c.x1, c.y1);
      const b = m(c.x2, c.y2);
      const e = m(c.x, c.y);
      return { kind: "cubicTo", x1: a.x, y1: a.y, x2: b.x, y2: b.y, x: e.x, y: e.y };
    }
    if (c.kind === "quadTo") {
      const a = m(c.x1, c.y1);
      const e = m(c.x, c.y);
      return { kind: "quadTo", x1: a.x, y1: a.y, x: e.x, y: e.y };
    }
    return c;
  });
  const tol = (8 / scale) * EMU_PER_PX;
  const segmentAt = (node: Konva.Node) => {
    const p = local(node);
    return p ? nearestSegment(cmds, p, tol) : null;
  };
  const size = 7 / scale;
  return (
    <>
      <Path
        name="edit-points-outline"
        data={svgPath(slideCmds, 1)}
        stroke="#b91c1c"
        strokeWidth={1 / scale}
        hitStrokeWidth={16 / scale}
        onMouseDown={(e) => {
          e.cancelBubble = true;
          if (!(e.evt.ctrlKey || e.evt.metaKey)) return;
          const seg = segmentAt(e.target);
          if (seg) commit(addVertex(cmds, seg.index, seg.t));
        }}
        onContextMenu={(e) => {
          e.evt.preventDefault();
          e.cancelBubble = true;
          const seg = segmentAt(e.target);
          onMenu({ x: e.evt.clientX, y: e.evt.clientY }, pathMenu(seg ? [{ id: "ep-add", label: t("show.editPoints.add"), onSelect: () => commit(addVertex(cmds, seg.index, seg.t)) }] : []));
        }}
      />
      {vertices(cmds).map((v) => {
        const at = toSlide(v.x, v.y);
        const segAfter = v.index + 1 < cmds.length && cmds[v.index + 1]!.kind !== "close" ? v.index + 1 : null;
        return (
          <Rect
            key={v.index}
            name="edit-handle edit-point"
            x={px(at.x)}
            y={px(at.y)}
            width={size}
            height={size}
            offsetX={size / 2}
            offsetY={size / 2}
            fill="#111827"
            stroke="#ffffff"
            strokeWidth={1 / scale}
            hitStrokeWidth={24 / scale}
            draggable
            onMouseDown={(e) => {
              e.cancelBubble = true;
              if (e.evt.ctrlKey || e.evt.metaKey) commit(deleteVertex(cmds, v.index));
            }}
            onDragEnd={(e) => {
              const p = local(e.target);
              if (p) commit(moveVertex(cmds, v.index, p.x - v.x, p.y - v.y));
            }}
            onContextMenu={(e) => {
              e.evt.preventDefault();
              e.cancelBubble = true;
              const seg = segAfter ?? v.index;
              const curved = cmds[seg]?.kind === "cubicTo";
              onMenu(
                { x: e.evt.clientX, y: e.evt.clientY },
                pathMenu([
                  { id: "ep-delete", label: t("show.editPoints.delete"), onSelect: () => commit(deleteVertex(cmds, v.index)) },
                  { id: "ep-smooth", label: t("show.editPoints.smooth"), onSelect: () => commit(smoothVertex(cmds, v.index)) },
                  { id: "ep-segment", label: t(curved ? "show.editPoints.straight" : "show.editPoints.curved"), onSelect: () => commit(setSegment(cmds, seg, curved ? "straight" : "curved")) },
                ]),
              );
            }}
          />
        );
      })}
    </>
  );
}

/** The polyline of a freeform drawing in progress (slide EMU points) as a Konva line. */
export function FreeformPreview({ points, scale }: { points: Pt[]; scale: number }) {
  if (points.length < 1) return null;
  return <KLine name="freeform-preview" points={points.flatMap((p) => [px(p.x), px(p.y)])} stroke="#2563eb" strokeWidth={1.5 / scale} lineJoin="round" lineCap="round" listening={false} />;
}
