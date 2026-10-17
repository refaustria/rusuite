// Konva handles of the slide editor drawn over the selection (P8-16):
// yellow adjust diamonds of a preset, the ends of a selected connector
// (green = glued) with the elbow's middle handle, and the connection
// sites of the shape under the pointer while a connector end is placed
// (grey, red when it snaps). Drags preview through `onPreview` and commit
// once on release.

import { Circle, Line as KLine, Rect } from "react-konva";
import type Konva from "konva";
import type { NodeId } from "../generated/NodeId";
import type { Shape } from "../generated/Shape";
import { EMU_PER_PX } from "../geometry";
import { lineEnds, mapLocal, toLocal, type Pt } from "../shapes/geom";
import { dragHandle, effectiveAdjust, elbowHandle, handlePos, handlesOf } from "../shapes/handles";
import { connectable, shapeUnder, slideSites, snapToSite, type ConnEnd, type SlideSite } from "../shapes/connectors";
import { pathCache, siteQueryOf, usePathVersion } from "../shapes/paths";

/** Snap radius of connection sites (screen px). */
export const SITE_SNAP_PX = 12;

/** The connection sites of `shape` on the slide (empty until its outline is cached). */
export function sitesOf(shape: Shape): SlideSite[] {
  const q = connectable(shape) ? siteQueryOf(shape) : null;
  const p = q ? pathCache.get(q) : null;
  return p ? slideSites(shape, p.sites) : [];
}

/** Where a connector end at `p` (EMU) goes: snapped to a site of the shape under it, else free. */
export function connectorTarget(shapes: readonly Shape[], p: Pt, scale: number, exclude?: NodeId): { end: ConnEnd; hover: Shape | null; sites: SlideSite[] } {
  const radius = (SITE_SNAP_PX / Math.max(scale, 1e-6)) * EMU_PER_PX;
  const hover = shapeUnder(shapes, p, radius, exclude);
  const sites = hover ? sitesOf(hover) : [];
  const site = snapToSite(sites, p, radius);
  return { end: { p, site }, hover, sites };
}

const px = (v: number) => v / EMU_PER_PX;

/** Grey site dots of the hovered shape; the snapped one red. */
export function SiteDots({ sites, active, scale }: { sites: SlideSite[]; active: SlideSite | null; scale: number }) {
  return (
    <>
      {sites.map((s) => {
        const on = active?.shape === s.shape && active.site === s.site;
        return (
          <Circle
            key={`${s.shape}-${s.site}`}
            name="site-dot"
            x={px(s.x)}
            y={px(s.y)}
            radius={(on ? 5 : 4) / scale}
            fill={on ? "#dc2626" : "#9ca3af"}
            stroke="#ffffff"
            strokeWidth={1 / scale}
            listening={false}
          />
        );
      })}
    </>
  );
}

const pointerEmu = (node: Konva.Node): Pt | null => {
  const stage = node.getStage();
  const p = stage?.getPointerPosition();
  if (!stage || !p) return null;
  const s = stage.scaleX() || 1;
  return { x: (p.x / s) * EMU_PER_PX, y: (p.y / s) * EMU_PER_PX };
};

const diamond = (scale: number) => ({ width: 9 / scale, height: 9 / scale, offsetX: 4.5 / scale, offsetY: 4.5 / scale, rotation: 45 });

/** Yellow adjust handles of one selected auto shape. */
export function AdjustHandles({ shape, scale, onPreview, onCommit, focus = null }: {
  shape: Shape;
  scale: number;
  /** The handle the keyboard moves (Tab; drawn with a focus ring). */
  focus?: number | null;
  onPreview: (s: Shape | null) => void;
  onCommit: (id: NodeId, adjust: Record<string, number>) => void;
}) {
  // the handles arrive with the shape's outline
  usePathVersion();
  if (shape.kind.kind !== "auto") return null;
  const k = shape.kind.value;
  const t = shape.transform;
  const defs = handlesOf(shape);
  const adj = effectiveAdjust(k.geometry, k.adjust);
  const valuesAt = (node: Konva.Node, i: number) => {
    const p = pointerEmu(node);
    return p ? { ...(k.adjust ?? {}), ...dragHandle(defs[i]!, toLocal(t, p.x, p.y)) } : null;
  };
  return (
    <>
      {defs.map((d, i) => {
        const at = mapLocal(t, handlePos(d, adj).x, handlePos(d, adj).y);
        return (
          <Rect
            key={i}
            name="edit-handle adjust-handle"
            x={px(at.x)}
            y={px(at.y)}
            {...diamond(scale)}
            fill="#facc15"
            stroke={focus === i ? "#2563eb" : "#854d0e"}
            strokeWidth={(focus === i ? 3 : 1) / scale}
            data-focused={focus === i ? "true" : undefined}
            hitStrokeWidth={24 / scale}
            draggable
            dragBoundFunc={function (this: Konva.Node, pos) {
              const v = valuesAt(this, i);
              if (!v) return pos;
              const e = effectiveAdjust(k.geometry, v);
              const q = mapLocal(t, handlePos(d, e).x, handlePos(d, e).y);
              const s = this.getStage()!.scaleX() || 1;
              return { x: px(q.x) * s, y: px(q.y) * s };
            }}
            onDragMove={(e) => {
              const v = valuesAt(e.target, i);
              if (v) onPreview({ ...shape, kind: { kind: "auto", value: { ...k, adjust: v } } });
            }}
            onDragEnd={(e) => {
              const v = valuesAt(e.target, i);
              onPreview(null);
              if (v) onCommit(shape.id, v);
            }}
          />
        );
      })}
    </>
  );
}

/** End handles (and the elbow's middle handle) of one selected connector. */
export function ConnectorHandles({ shape, shapes, scale, onTarget, onPreview, onMoveEnd, onAdjust }: {
  shape: Shape;
  shapes: readonly Shape[];
  scale: number;
  /** The sites to show while an end is dragged (`null` when done). */
  onTarget: (t: { sites: SlideSite[]; active: SlideSite | null; line: [Pt, Pt] } | null) => void;
  onPreview: (s: Shape | null) => void;
  onMoveEnd: (which: "start" | "end", to: ConnEnd) => void;
  onAdjust: (adjust: Record<string, number>) => void;
}) {
  if (shape.kind.kind !== "connector") return null;
  const c = shape.kind.value;
  const t = shape.transform;
  const ends = lineEnds(t);
  const target = (node: Konva.Node) => {
    const p = pointerEmu(node);
    return p ? connectorTarget(shapes, p, scale, shape.id) : null;
  };
  const endHandle = (which: "start" | "end", i: 0 | 1) => {
    const glued = which === "start" ? !!c.start : !!c.end;
    const other = ends[1 - i]!;
    return (
      <Circle
        key={which}
        name={`edit-handle connector-${which}`}
        x={px(ends[i].x)}
        y={px(ends[i].y)}
        radius={5 / scale}
        fill={glued ? "#22c55e" : "#ffffff"}
        stroke={glued ? "#15803d" : "#2563eb"}
        strokeWidth={1.5 / scale}
        hitStrokeWidth={24 / scale}
        draggable
        dragBoundFunc={function (this: Konva.Node, pos) {
          const r = target(this);
          const s = this.getStage()!.scaleX() || 1;
          return r?.end.site ? { x: px(r.end.site.x) * s, y: px(r.end.site.y) * s } : pos;
        }}
        onDragMove={(e) => {
          const r = target(e.target);
          if (!r) return;
          const p = r.end.site ?? r.end.p;
          onTarget({ sites: r.sites, active: r.end.site, line: [other, p] });
        }}
        onDragEnd={(e) => {
          const r = target(e.target);
          onTarget(null);
          if (r) onMoveEnd(which, r.end);
        }}
      />
    );
  };
  const bends = c.bends ?? 2;
  const elbow = c.kind !== "straight" && bends === 2 && t.w > 0 ? elbowHandle(t.w, t.h, c.adjust) : null;
  const adj = { adj1: 50000, ...(c.adjust ?? {}) };
  const mid = elbow ? mapLocal(t, handlePos(elbow, adj).x, handlePos(elbow, adj).y) : null;
  const elbowValue = (node: Konva.Node) => {
    const p = pointerEmu(node);
    return p && elbow ? dragHandle(elbow, toLocal(t, p.x, p.y)) : null;
  };
  return (
    <>
      {endHandle("start", 0)}
      {endHandle("end", 1)}
      {mid && elbow && (
        <Rect
          name="edit-handle elbow-handle"
          x={px(mid.x)}
          y={px(mid.y)}
          {...diamond(scale)}
          fill="#facc15"
          stroke="#854d0e"
          strokeWidth={1 / scale}
          hitStrokeWidth={24 / scale}
          draggable
          onDragMove={(e) => {
            const v = elbowValue(e.target);
            if (v) onPreview({ ...shape, kind: { kind: "connector", value: { ...c, adjust: { ...(c.adjust ?? {}), ...v } } } });
          }}
          onDragEnd={(e) => {
            const v = elbowValue(e.target);
            onPreview(null);
            if (v) onAdjust({ ...(c.adjust ?? {}), ...v });
          }}
        />
      )}
    </>
  );
}

/** A dashed preview line (connector being drawn or an end being moved). */
export function PreviewLine({ a, b, scale }: { a: Pt; b: Pt; scale: number }) {
  return <KLine name="connector-preview" points={[px(a.x), px(a.y), px(b.x), px(b.y)]} stroke="#2563eb" strokeWidth={1.5 / scale} dash={[5 / scale, 4 / scale]} listening={false} />;
}
