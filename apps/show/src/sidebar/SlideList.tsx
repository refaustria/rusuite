// The slide sorter: thumbnails rendered from the model (a small read-only
// Konva stage per slide, memoized on the slide object, which patches
// replace only when the slide changed), click to select, drag to reorder
// (`MoveSlide`), "+" menu (`AddSlide`), Duplicate/Delete context actions.

import { memo, useEffect, useMemo, useState } from "react";
import { Layer, Stage } from "react-konva";
import { Dropdown } from "@rusuite/ui-shared";
import type { LayoutKind } from "../generated/LayoutKind";
import type { NodeId } from "../generated/NodeId";
import type { Slide } from "../generated/Slide";
import { slidePx } from "../geometry";
import { useShow, type ShowStore } from "../state/store";
import { SlideView, type DeckContext } from "../canvas/SlideView";

export const THUMB_WIDTH = 152;

export const LAYOUTS: { value: LayoutKind; label: string }[] = [
  { value: "title", label: "Title slide" },
  { value: "titleContent", label: "Title and content" },
  { value: "blank", label: "Blank" },
];

const Thumb = memo(function Thumb({
  deck, slide, media, mediaVersion,
}: { deck: DeckContext; slide: Slide; media: ReadonlyMap<number, string>; mediaVersion: number }) {
  const size = slidePx(deck.slideSize);
  const scale = THUMB_WIDTH / size.width;
  return (
    <Stage width={THUMB_WIDTH} height={size.height * scale} scaleX={scale} scaleY={scale} listening={false}>
      <Layer listening={false}>
        <SlideView deck={deck} slide={slide} media={media} mediaVersion={mediaVersion} />
      </Layer>
    </Stage>
  );
});

export function SlideList({ store }: { store: ShowStore }) {
  const pres = useShow(store, (s) => s.pres);
  const current = useShow(store, (s) => s.current);
  const mediaVersion = useShow(store, (s) => s.mediaVersion);
  const [menu, setMenu] = useState<{ id: NodeId; x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  // Stable while size, layouts and theme are unchanged, so unchanged thumbnails do not re-render.
  const deck = useMemo<DeckContext | null>(
    () => (pres ? { slideSize: pres.slideSize, layouts: pres.layouts, theme: pres.theme } : null),
    [pres?.slideSize, pres?.layouts, pres?.theme],
  );

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [menu]);

  if (!pres || !deck) return <nav aria-label="Slides" className="w-48 shrink-0 border-r border-ui-border bg-ui-panel" />;
  const slides = pres.slides;
  const index = slides.findIndex((s) => s.id === current);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Delete" || e.key === "Backspace") {
      if (current !== null) void store.deleteSlides([current]);
    } else if (e.key === "ArrowDown" && index < slides.length - 1) store.selectSlide(slides[index + 1]!.id);
    else if (e.key === "ArrowUp" && index > 0) store.selectSlide(slides[index - 1]!.id);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <nav
      aria-label="Slides"
      tabIndex={0}
      onKeyDown={onKeyDown}
      data-testid="slide-list"
      className="flex w-48 shrink-0 flex-col gap-1 overflow-y-auto border-r border-ui-border bg-ui-panel p-2 outline-none"
    >
      <div className="mb-1 flex items-center justify-between text-xs text-ui-muted">
        <span>Slides</span>
        <Dropdown label="New slide" trigger={<span className="px-1 text-base leading-none">+</span>} items={LAYOUTS} onSelect={(l) => void store.addSlide(l)} />
      </div>
      {slides.map((slide, i) => (
        <div
          key={slide.id}
          role="button"
          tabIndex={-1}
          aria-label={`Slide ${i + 1}`}
          aria-current={slide.id === current ? "true" : undefined}
          data-testid="thumbnail"
          draggable
          onDragStart={(e) => {
            setDragging(i);
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", String(slide.id));
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
          }}
          onDrop={(e) => {
            e.preventDefault();
            const id = Number(e.dataTransfer.getData("text/plain"));
            const from = slides.findIndex((s) => s.id === id);
            setDragging(null);
            if (from >= 0 && from !== i) void store.moveSlide(id, i);
          }}
          onDragEnd={() => setDragging(null)}
          onClick={() => store.selectSlide(slide.id)}
          onContextMenu={(e) => {
            e.preventDefault();
            store.selectSlide(slide.id);
            setMenu({ id: slide.id, x: e.clientX, y: e.clientY });
          }}
          className={`flex cursor-pointer gap-2 rounded p-1 text-xs ${slide.id === current ? "bg-ui-active" : "hover:bg-ui-hover"} ${dragging === i ? "opacity-50" : ""}`}
        >
          <span className="w-4 pt-1 text-right text-ui-muted">{i + 1}</span>
          <span className="overflow-hidden rounded border border-ui-border bg-white">
            <Thumb deck={deck} slide={slide} media={store.media} mediaVersion={mediaVersion} />
          </span>
        </div>
      ))}
      {menu && (
        <div
          role="menu"
          aria-label="Slide actions"
          className="fixed z-50 flex flex-col rounded border border-ui-border bg-ui-bg p-1 text-sm shadow-lg"
          style={{ left: menu.x, top: menu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button type="button" role="menuitem" className="rounded px-2 py-1 text-left hover:bg-ui-hover" onClick={() => { setMenu(null); void store.duplicateSlide(menu.id); }}>
            Duplicate slide
          </button>
          <button type="button" role="menuitem" className="rounded px-2 py-1 text-left hover:bg-ui-hover" onClick={() => { setMenu(null); void store.deleteSlides([menu.id]); }}>
            Delete slide
          </button>
        </div>
      )}
    </nav>
  );
}
