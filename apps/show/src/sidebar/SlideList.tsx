// The slide sorter: thumbnails rendered from the model (a small read-only
// Konva stage per slide, memoized on the slide object, which patches
// replace only when the slide changed), click to select, drag to reorder
// (`MoveSlide`, with an insertion line), "+" menu (`AddSlide`), a context
// menu (new/duplicate/delete, copy/paste, layout, hide) and Ctrl+C/V for
// slides. Hidden slides are dimmed with a struck-through number.

import { memo, useMemo, useState } from "react";
import { Layer, Stage } from "react-konva";
import { ContextMenu, Dropdown, type ContextMenuItem } from "@rusuite/ui-shared";
import type { LayoutKind } from "../generated/LayoutKind";
import type { Slide } from "../generated/Slide";
import { slidePx } from "../geometry";
import { slideDropIndex } from "../state/commands";
import { useShow, type ShowStore } from "../state/store";
import { SlideView, type DeckContext } from "../canvas/SlideView";
import { thumbnailMenu } from "../canvas/menus";

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
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; items: ContextMenuItem[] } | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  /** Insertion line: before thumbnail `index` (`slides.length` = after the last). */
  const [dropAt, setDropAt] = useState<number | null>(null);
  // Stable while size, layouts and theme are unchanged, so unchanged thumbnails do not re-render.
  const deck = useMemo<DeckContext | null>(
    () => (pres ? { slideSize: pres.slideSize, layouts: pres.layouts, theme: pres.theme } : null),
    [pres?.slideSize, pres?.layouts, pres?.theme],
  );

  if (!pres || !deck) return <nav aria-label="Slides" className="w-48 shrink-0 border-r border-ui-border bg-ui-panel" />;
  const slides = pres.slides;
  const index = slides.findIndex((s) => s.id === current);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.shiftKey && !e.altKey && (e.key.toLowerCase() === "c" || e.key.toLowerCase() === "v" || e.key.toLowerCase() === "x")) {
      const k = e.key.toLowerCase();
      if (k === "v") void store.paste();
      else if (current !== null) {
        store.copySlides([current]);
        if (k === "x" && slides.length > 1) void store.deleteSlides([current]);
      }
    } else if (mod && !e.shiftKey && e.key.toLowerCase() === "d") {
      if (current !== null) void store.duplicateSlide(current);
    } else if (e.key === "Delete" || e.key === "Backspace") {
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
            const r = e.currentTarget.getBoundingClientRect();
            const after = r.height > 0 && e.clientY > r.top + r.height / 2;
            setDropAt(i + (after ? 1 : 0));
          }}
          onDrop={(e) => {
            e.preventDefault();
            const id = Number(e.dataTransfer.getData("text/plain"));
            const from = slides.findIndex((s) => s.id === id);
            const r = e.currentTarget.getBoundingClientRect();
            const after = r.height > 0 && e.clientY > r.top + r.height / 2;
            setDragging(null);
            setDropAt(null);
            const to = from >= 0 ? slideDropIndex(from, i, after) : null;
            if (to !== null) void store.moveSlide(id, to);
          }}
          onDragEnd={() => {
            setDragging(null);
            setDropAt(null);
          }}
          onClick={() => store.selectSlide(slide.id)}
          onContextMenu={(e) => {
            e.preventDefault();
            store.selectSlide(slide.id);
            setMenu({ at: { x: e.clientX, y: e.clientY }, items: thumbnailMenu(store, slide.id) });
          }}
          data-hidden={slide.hidden ? "true" : undefined}
          className={`relative flex cursor-pointer gap-2 rounded p-1 text-xs ${slide.id === current ? "bg-ui-active" : "hover:bg-ui-hover"} ${dragging === i ? "opacity-50" : ""}`}
        >
          {dropAt === i && <span data-testid="drop-indicator" className="pointer-events-none absolute -top-1 left-5 right-0 h-0.5 rounded bg-orange-600" />}
          {dropAt === slides.length && i === slides.length - 1 && (
            <span data-testid="drop-indicator" className="pointer-events-none absolute -bottom-1 left-5 right-0 h-0.5 rounded bg-orange-600" />
          )}
          <span className={`w-4 pt-1 text-right text-ui-muted ${slide.hidden ? "line-through" : ""}`} title={slide.hidden ? "Hidden slide" : undefined}>
            {i + 1}
          </span>
          <span className={`overflow-hidden rounded border border-ui-border bg-white ${slide.hidden ? "opacity-40" : ""}`}>
            <Thumb deck={deck} slide={slide} media={store.media} mediaVersion={mediaVersion} />
          </span>
        </div>
      ))}
      <ContextMenu at={menu?.at ?? null} label="Slide actions" items={menu?.items ?? []} onClose={() => setMenu(null)} />
    </nav>
  );
}
