// The slide sorter: thumbnails rendered from the model (a small read-only
// Konva stage per slide, memoized on the slide object, which patches
// replace only when the slide changed), click to select, drag to reorder
// (`MoveSlide`, with an insertion line), "+" menu (`AddSlide`), a context
// menu (new/duplicate/delete, copy/paste, layout, hide) and Ctrl+C/V for
// slides. Hidden slides are dimmed with a struck-through number; slides
// with a transition or animations show a small star under it (P8-8).
// Sections (P8-22): collapsible headers with a context menu (rename,
// remove, remove with slides, remove all, move up / down, collapse /
// expand all); dropping a slide on a header or between another section's
// slides moves it into that section.

import { memo, useState } from "react";
import { Layer, Stage } from "react-konva";
import { ContextMenu, Dropdown, withLabel, type ContextMenuItem } from "@rusuite/ui-shared";
import type { LayoutKind } from "../generated/LayoutKind";
import type { Slide } from "../generated/Slide";
import { slidePx } from "../geometry";
import { slideDropIndex } from "../state/commands";
import { SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN, useShow, type ShowStore } from "../state/store";
import { SlideView, type DeckContext } from "../canvas/SlideView";
import { stableDeck } from "../design/deck";
import { sectionMenu, thumbnailMenu } from "../canvas/menus";
import { useT } from "../i18n";
import { hasEffects } from "../anim/effects";
import { sectionRanges } from "../design/sections";
import { layoutName } from "../design/layouts";

export const THUMB_WIDTH = 152;

export const LAYOUTS: { value: LayoutKind; readonly label: string }[] = [
  withLabel({ value: "title" as LayoutKind }, "show.layout.title"),
  withLabel({ value: "titleContent" as LayoutKind }, "show.layout.titleContent"),
  withLabel({ value: "blank" as LayoutKind }, "show.layout.blank"),
];

const Thumb = memo(function Thumb({
  deck, slide, media, mediaVersion, width = THUMB_WIDTH,
}: { deck: DeckContext; slide: Slide; media: ReadonlyMap<number, string>; mediaVersion: number; width?: number }) {
  const size = slidePx(deck.slideSize);
  const scale = width / size.width;
  return (
    <Stage width={width} height={size.height * scale} scaleX={scale} scaleY={scale} listening={false}>
      <Layer listening={false}>
        <SlideView deck={deck} slide={slide} media={media} mediaVersion={mediaVersion} />
      </Layer>
    </Stage>
  );
});

export function SlideList({ store }: { store: ShowStore }) {
  const t = useT();
  const pres = useShow(store, (s) => s.pres);
  const current = useShow(store, (s) => s.current);
  const mediaVersion = useShow(store, (s) => s.mediaVersion);
  const width = useShow(store, (s) => s.sidebarWidth);
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; items: ContextMenuItem[] } | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  /** Insertion line: before thumbnail `index` (`slides.length` = after the last). */
  const [dropAt, setDropAt] = useState<number | null>(null);
  /** Collapsed sections (by index). */
  const collapsedList = useShow(store, (s) => s.collapsedSections);
  const collapsed = new Set(collapsedList);
  /** A section header the dragged slide is over. */
  const [dropSection, setDropSection] = useState<number | null>(null);
  // Stable while size, layouts and theme are unchanged, so unchanged thumbnails do not re-render.
  const deck = pres ? stableDeck(pres) : null;

  if (!pres || !deck) return <nav aria-label={t("show.slides")} className="w-48 shrink-0 border-r border-ui-border bg-ui-panel" />;
  const slides = pres.slides;
  const index = slides.findIndex((s) => s.id === current);
  const layoutChoices = pres.layouts.map((l) => ({ value: l.kind, label: layoutName(l) }));

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
    } else if (mod && !e.shiftKey && !e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      // Ctrl+↑ / ↓: the slide one place up / down
      void store.nudgeSlides(e.key === "ArrowUp" ? -1 : 1);
    } else if (e.key === "ArrowDown" && index < slides.length - 1) store.selectSlide(slides[index + 1]!.id);
    else if (e.key === "ArrowUp" && index > 0) store.selectSlide(slides[index - 1]!.id);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  const ranges = sectionRanges(pres);
  /** Drops the dragged slide before (or after) thumbnail `i`, also into another section. */
  const dropOn = (id: number, i: number, after: boolean) => {
    const from = slides.findIndex((s) => s.id === id);
    if (from < 0) return;
    if (ranges.length) {
      const sec = ranges.findIndex((r) => i >= r.start && i < r.start + r.count);
      if (sec < 0) return;
      const r = ranges[sec]!;
      const others = r.slideIds.filter((x) => x !== id);
      const target = slides[i]!.id;
      const pos = target === id ? r.slideIds.indexOf(id) : others.indexOf(target) + (after ? 1 : 0);
      void store.moveSlideToSection(id, sec, pos);
      return;
    }
    const to = slideDropIndex(from, i, after);
    if (to !== null) void store.moveSlide(id, to);
  };

  const thumb = (slide: Slide, i: number) => (
    <div
      key={slide.id}
      role="button"
      tabIndex={-1}
      aria-label={t("show.slideN", { n: i + 1 })}
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
        e.stopPropagation();
        const id = Number(e.dataTransfer.getData("text/plain"));
        const r = e.currentTarget.getBoundingClientRect();
        const after = r.height > 0 && e.clientY > r.top + r.height / 2;
        setDragging(null);
        setDropAt(null);
        dropOn(id, i, after);
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
      <span className="flex w-4 flex-col items-end gap-1 pt-1 text-ui-muted">
        <span className={slide.hidden ? "line-through" : undefined} title={slide.hidden ? t("show.hiddenSlide") : undefined}>
          {i + 1}
        </span>
        {hasEffects(slide) && (
          <svg role="img" aria-label={t("show.hasEffects")} data-testid="effects-star" width="11" height="11" viewBox="0 0 20 20">
            <title>{t("show.hasEffects")}</title>
            <path d="M10 1.8l2.4 5 5.5.7-4 3.8 1 5.4L10 14l-4.9 2.7 1-5.4-4-3.8 5.5-.7z" fill="currentColor" />
          </svg>
        )}
      </span>
      <span className={`overflow-hidden rounded border border-ui-border bg-white ${slide.hidden ? "opacity-40" : ""}`}>
        <Thumb deck={deck} slide={slide} media={store.media} mediaVersion={mediaVersion} width={Math.max(60, width - (SIDEBAR_DEFAULT - THUMB_WIDTH))} />
      </span>
    </div>
  );

  return (
    <nav
      aria-label={t("show.slides")}
      tabIndex={0}
      onKeyDown={onKeyDown}
      data-testid="slide-list"
      className="relative z-10 flex shrink-0 flex-col border-r border-ui-border bg-ui-panel outline-none"
      style={{ width }}
    >
      {/* the pane's edge: drag to resize (saved as restoredLeft) */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t("show.sidebar.resize")}
        aria-valuenow={width}
        aria-valuemin={SIDEBAR_MIN}
        aria-valuemax={SIDEBAR_MAX}
        tabIndex={0}
        data-testid="sidebar-resize"
        className="absolute -right-1 top-0 z-20 h-full w-2 cursor-ew-resize hover:bg-ui-active"
        onPointerDown={(e) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
          const x0 = e.clientX;
          const w0 = width;
          const el = e.currentTarget as HTMLElement;
          const move = (ev: PointerEvent) => store.setSidebarWidth(w0 + ev.clientX - x0);
          const up = () => {
            el.removeEventListener("pointermove", move);
            el.removeEventListener("pointerup", up);
          };
          el.addEventListener("pointermove", move);
          el.addEventListener("pointerup", up);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
            e.preventDefault();
            e.stopPropagation();
            store.setSidebarWidth(width + (e.key === "ArrowRight" ? 16 : -16));
          }
        }}
      />
      <div className="flex items-center justify-between px-2 pt-2 text-xs text-ui-muted">
        <span>{t("show.slides")}</span>
        <Dropdown label={t("show.newSlide")} trigger={<span className="px-1 text-base leading-none">+</span>} items={layoutChoices} onSelect={(l) => void store.addSlide(l)} />
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2">
      {ranges.length === 0
        ? slides.map((slide, i) => thumb(slide, i))
        : ranges.map((r) => {
            const closed = collapsed.has(r.index);
            return (
              <section key={`${r.index}:${r.name}`} aria-label={r.name} data-testid="section" className="flex flex-col gap-1">
                <div
                  role="button"
                  tabIndex={-1}
                  aria-expanded={!closed}
                  data-testid="section-header"
                  className={`flex min-h-8 cursor-pointer items-center gap-1 rounded px-1 text-xs font-medium hover:bg-ui-hover ${dropSection === r.index ? "ring-2 ring-orange-600" : ""}`}
                  onClick={() => store.toggleSection(r.index)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenu({ at: { x: e.clientX, y: e.clientY }, items: sectionMenu(store, r.index) });
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDropSection(r.index);
                    setDropAt(null);
                  }}
                  onDragLeave={() => setDropSection(null)}
                  onDrop={(e) => {
                    e.preventDefault();
                    const id = Number(e.dataTransfer.getData("text/plain"));
                    setDropSection(null);
                    setDragging(null);
                    if (slides.some((s) => s.id === id)) void store.moveSlideToSection(id, r.index, 0);
                  }}
                >
                  <span aria-hidden="true" className="w-3 text-ui-muted">{closed ? "▸" : "▾"}</span>
                  <span className="truncate" data-testid="section-name">{r.name}</span>
                  {closed && <span className="ml-auto text-ui-muted">({r.count})</span>}
                </div>
                {!closed && slides.slice(r.start, r.start + r.count).map((slide, k) => thumb(slide, r.start + k))}
              </section>
            );
          })}
      </div>
      <ContextMenu at={menu?.at ?? null} label={t("show.slideActions")} items={menu?.items ?? []} onClose={() => setMenu(null)} />
    </nav>
  );
}
