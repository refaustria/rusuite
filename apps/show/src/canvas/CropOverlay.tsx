// Picture Format › Crop: a DOM layer over the stage while a picture is
// cropped. The whole image is shown dimmed under a dark veil, the cropped
// part bright inside a frame with eight black crop handles (pointer
// events, ≥ 32 px hit areas); dragging a handle moves that edge, dragging
// inside the frame moves the image under it. Enter or a click outside
// applies (`CropPicture` with the box), Esc cancels.

import { useEffect, useRef, type PointerEvent as RPointerEvent } from "react";
import { EMU_PER_PX } from "../geometry";
import { cssFilter, dragCrop, fullImageBox } from "../design/picture";
import { resolveColor } from "../design/color";
import { useShow, type ShowStore } from "../state/store";
import { useT } from "../i18n";
import type { Crop } from "../generated/Crop";
import type { Transform } from "../generated/Transform";

const HANDLES: { id: string; x: number; y: number; cursor: string }[] = [
  { id: "tl", x: 0, y: 0, cursor: "nwse-resize" },
  { id: "t", x: 0.5, y: 0, cursor: "ns-resize" },
  { id: "tr", x: 1, y: 0, cursor: "nesw-resize" },
  { id: "r", x: 1, y: 0.5, cursor: "ew-resize" },
  { id: "br", x: 1, y: 1, cursor: "nwse-resize" },
  { id: "b", x: 0.5, y: 1, cursor: "ns-resize" },
  { id: "bl", x: 0, y: 1, cursor: "nesw-resize" },
  { id: "l", x: 0, y: 0.5, cursor: "ew-resize" },
];

/** Moves the image under the frame by `dx`/`dy` EMU (the crop shifts, the box stays). */
export function panCrop(crop: Crop, box: { w: number; h: number }, dx: number, dy: number): Crop {
  const fw = box.w / Math.max(0.01, 1 - crop.left - crop.right);
  const fh = box.h / Math.max(0.01, 1 - crop.top - crop.bottom);
  const r = (v: number) => Math.round(v * 100000) / 100000;
  return { left: r(crop.left - dx / fw), right: r(crop.right + dx / fw), top: r(crop.top - dy / fh), bottom: r(crop.bottom + dy / fh) };
}

export function CropOverlay({ store, scale }: { store: ShowStore; scale: number }) {
  const t = useT();
  const crop = useShow(store, (s) => s.crop);
  const pres = useShow(store, (s) => s.pres);
  const drag = useRef<{ id: string; x: number; y: number; crop: Crop; box: Transform } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") void store.commitCrop();
      else if (e.key === "Escape") store.cancelCrop();
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [store]);

  if (!crop) return null;
  const shape = store.shape(crop.shape);
  if (!shape || shape.kind.kind !== "picture") return null;
  const url = store.media.get(shape.kind.value.media);
  const px = (emu: number) => (emu / EMU_PER_PX) * scale;
  const full = fullImageBox(crop.crop, crop.box);
  const filter = cssFilter({ ...(shape.kind.value.props ?? {}), shadow: undefined }, (c) => resolveColor(pres?.theme, c));

  const start = (id: string) => (e: RPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    drag.current = { id, x: e.clientX, y: e.clientY, crop: crop.crop, box: crop.box };
  };
  const move = (e: RPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = ((e.clientX - d.x) / scale) * EMU_PER_PX;
    const dy = ((e.clientY - d.y) / scale) * EMU_PER_PX;
    if (d.id === "move") store.updateCrop(panCrop(d.crop, d.box, dx, dy), d.box);
    else {
      const r = dragCrop(d.crop, d.box, d.id, dx, dy);
      store.updateCrop(r.crop, { ...d.box, ...r.box });
    }
  };
  const end = () => {
    drag.current = null;
  };
  const img = (box: { x: number; y: number; w: number; h: number }, extra: React.CSSProperties) =>
    url ? <img alt="" src={url} draggable={false} style={{ position: "absolute", left: px(box.x), top: px(box.y), width: px(box.w), height: px(box.h), maxWidth: "none", filter: filter || undefined, ...extra }} /> : null;

  return (
    <div
      className="absolute inset-0 z-10 overflow-hidden"
      data-testid="crop-overlay"
      data-crop={`${crop.crop.left},${crop.crop.top},${crop.crop.right},${crop.crop.bottom}`}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) void store.commitCrop();
      }}
      onPointerMove={move}
      onPointerUp={end}
    >
      {img(full, { pointerEvents: "none" })}
      <div className="pointer-events-none absolute bg-black/50" style={{ left: px(full.x), top: px(full.y), width: px(full.w), height: px(full.h) }} />
      <div
        role="group"
        aria-label={t("show.pic.cropArea")}
        data-testid="crop-frame"
        className="absolute cursor-move overflow-hidden outline outline-1 outline-black"
        style={{ left: px(crop.box.x), top: px(crop.box.y), width: px(crop.box.w), height: px(crop.box.h) }}
        onPointerDown={start("move")}
      >
        {img({ x: full.x - crop.box.x, y: full.y - crop.box.y, w: full.w, h: full.h }, { pointerEvents: "none" })}
      </div>
      {HANDLES.map((h) => {
        const corner = h.id.length === 2;
        const cx = px(crop.box.x) + h.x * px(crop.box.w);
        const cy = px(crop.box.y) + h.y * px(crop.box.h);
        return (
          <div
            key={h.id}
            data-testid={`crop-handle-${h.id}`}
            aria-label={t("show.pic.cropHandle")}
            className="absolute flex items-center justify-center"
            style={{ left: cx - 16, top: cy - 16, width: 32, height: 32, cursor: h.cursor, touchAction: "none" }}
            onPointerDown={start(h.id)}
          >
            <span className="block bg-black ring-1 ring-white" style={corner ? { width: 12, height: 12 } : h.x === 0.5 ? { width: 18, height: 5 } : { width: 5, height: 18 }} />
          </div>
        );
      })}
    </div>
  );
}
