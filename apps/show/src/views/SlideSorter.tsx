// View › Slide Sorter (P8-28): every slide as a thumbnail in a grid, with
// section headers. Click selects (Ctrl toggles, Shift a range), dragging
// the selection (pointer events) moves it before the slide under the
// pointer – also into another section – in one undo step; Delete,
// Ctrl+D (duplicate), Ctrl+A, Hide Slide and the thumbnail menu act on the
// selection; double-click or Enter opens the slide in the Normal view. The
// zoom slider sets the thumbnail size. Ctrl+↑ / ↓ move the selection one
// place (P9-S3); section headers collapse on click and have the sections'
// context menu (the collapsed state is shared with the thumbnail pane).

import { useRef, useState } from "react";
import { ContextMenu, type ContextMenuItem } from "@rusuite/ui-shared";
import type { NodeId } from "../generated/NodeId";
import type { Slide } from "../generated/Slide";
import { slidePx } from "../geometry";
import { useShow, type ShowStore } from "../state/store";
import { stableDeck } from "../design/deck";
import { sectionRanges } from "../design/sections";
import { sectionMenu, thumbnailMenu } from "../canvas/menus";
import { DeckThumb } from "../ui/Thumbs";
import { hasEffects } from "../anim/effects";
import { sorterThumbWidth, type SorterDrop } from "./sorter";
import { useT } from "../i18n";

const DRAG_START_PX = 5;

export function SlideSorter({ store }: { store: ShowStore }) {
  const t = useT();
  const pres = useShow(store, (s) => s.pres);
  const sel = useShow(store, (s) => s.slideSel);
  const current = useShow(store, (s) => s.current);
  const mediaVersion = useShow(store, (s) => s.mediaVersion);
  const zoom = useShow(store, (s) => s.sorterZoom);
  const collapsedList = useShow(store, (s) => s.collapsedSections);
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; items: ContextMenuItem[] } | null>(null);
  const [drop, setDrop] = useState<(SorterDrop & { key: string }) | null>(null);
  const drag = useRef<{ id: NodeId; x: number; y: number; active: boolean } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  if (!pres) return null;
  const deck = stableDeck(pres);
  const width = sorterThumbWidth(zoom);
  const slides = pres.slides;
  const ranges = sectionRanges(pres);

  /** The drop position under the pointer: before / after the nearest thumbnail, or a section header. */
  const dropAt = (x: number, y: number): (SorterDrop & { key: string }) | null => {
    const el = root.current;
    if (!el) return null;
    for (const h of Array.from(el.querySelectorAll<HTMLElement>("[data-section-index]"))) {
      const r = h.getBoundingClientRect();
      if (y >= r.top && y <= r.bottom && x >= r.left && x <= r.right) {
        const index = Number(h.dataset.sectionIndex);
        return { before: ranges[index]?.slideIds[0] ?? null, section: index, key: `s${index}` };
      }
    }
    let best: { id: NodeId; after: boolean; d: number; index: number } | null = null;
    for (const th of Array.from(el.querySelectorAll<HTMLElement>("[data-slide-id]"))) {
      const r = th.getBoundingClientRect();
      if (y < r.top - 8 || y > r.bottom + 8) continue;
      const cx = (r.left + r.right) / 2;
      const d = Math.abs(x - cx);
      if (!best || d < best.d) best = { id: Number(th.dataset.slideId), after: x > cx, d, index: Number(th.dataset.index) };
    }
    if (!best) return null;
    const i = best.index + (best.after ? 1 : 0);
    const section = ranges.length ? ranges.findIndex((r) => best!.index >= r.start && best!.index < r.start + r.count) : undefined;
    const before = slides[i]?.id ?? null;
    // after the last slide of a section: the end of that section
    if (best.after && section !== undefined && section >= 0 && i >= ranges[section]!.start + ranges[section]!.count) {
      return { before: null, section, key: `e${section}` };
    }
    return { before, section, key: `b${before ?? "end"}` };
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    const ids = store.selectedSlides();
    const index = slides.findIndex((s) => s.id === current);
    const k = e.key.toLowerCase();
    if (mod && !e.shiftKey && !e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) void store.nudgeSlides(e.key === "ArrowUp" ? -1 : 1);
    else if (e.key === "Delete" || e.key === "Backspace") {
      if (ids.length && ids.length < slides.length) void store.deleteSlides(ids);
    } else if (mod && k === "d") void store.duplicateSlides(ids);
    else if (mod && k === "a") {
      if (current !== null) store.selectSlide(current, slides.map((s) => s.id));
    } else if (mod && k === "c") store.copySlides(ids);
    else if (mod && k === "x") {
      store.copySlides(ids);
      if (ids.length < slides.length) void store.deleteSlides(ids);
    } else if (mod && k === "v") void store.paste();
    else if (e.key === "Enter") store.setView("normal");
    else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      const next = slides[Math.min(slides.length - 1, index + 1)];
      if (next) store.clickSlide(next.id, e.shiftKey ? "range" : "replace");
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      const prev = slides[Math.max(0, index - 1)];
      if (prev) store.clickSlide(prev.id, e.shiftKey ? "range" : "replace");
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };

  const thumb = (slide: Slide, i: number) => {
    const selected = sel.includes(slide.id);
    const showDrop = drop && drop.before === slide.id && (drop.section === undefined || drop.key.startsWith("b"));
    return (
      <div
        key={slide.id}
        role="option"
        aria-selected={selected}
        aria-label={t("show.slideN", { n: i + 1 })}
        data-testid="sorter-thumb"
        data-slide-id={slide.id}
        data-index={i}
        data-hidden={slide.hidden ? "true" : undefined}
        className="relative flex cursor-pointer select-none flex-col items-start gap-1 p-1"
        style={{ touchAction: "none" }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          drag.current = { id: slide.id, x: e.clientX, y: e.clientY, active: false };
          (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
          const mode = e.ctrlKey || e.metaKey ? "toggle" : e.shiftKey ? "range" : "replace";
          // a press on a selected slide keeps the selection (it may be the start of a drag)
          if (mode !== "replace" || !sel.includes(slide.id)) store.clickSlide(slide.id, mode);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          if (!d.active && Math.hypot(e.clientX - d.x, e.clientY - d.y) < DRAG_START_PX) return;
          d.active = true;
          setDrop(dropAt(e.clientX, e.clientY));
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          const target = d?.active ? dropAt(e.clientX, e.clientY) : null;
          setDrop(null);
          if (d && !d.active && !(e.ctrlKey || e.metaKey || e.shiftKey) && sel.includes(slide.id)) store.clickSlide(slide.id, "replace");
          if (target) void store.moveSlidesTo(target);
        }}
        onPointerCancel={() => {
          drag.current = null;
          setDrop(null);
        }}
        onDoubleClick={() => {
          store.selectSlide(slide.id);
          store.setView("normal");
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          if (!sel.includes(slide.id)) store.clickSlide(slide.id, "replace");
          setMenu({ at: { x: e.clientX, y: e.clientY }, items: thumbnailMenu(store, slide.id) });
        }}
      >
        {showDrop && <span data-testid="sorter-drop" className="pointer-events-none absolute -left-1.5 top-1 bottom-6 w-1 rounded bg-orange-600" />}
        <span className={`overflow-hidden rounded-sm bg-white ${selected ? "outline outline-3 outline-orange-600" : "outline outline-1 outline-ui-border"} ${slide.hidden ? "opacity-40" : ""}`}>
          <DeckThumb deck={deck} slide={slide} media={store.media} mediaVersion={mediaVersion} width={width} />
        </span>
        <span className="flex w-full items-center gap-1 px-0.5 text-xs text-ui-muted">
          <span className={slide.hidden ? "line-through" : undefined} title={slide.hidden ? t("show.hiddenSlide") : undefined} data-testid="sorter-number">
            {i + 1}
          </span>
          {hasEffects(slide) && <span aria-label={t("show.hasEffects")} role="img">★</span>}
          {slide.transition?.advanceAfterMs !== undefined && (
            <span className="ml-auto tabular-nums">{`${Math.floor(slide.transition.advanceAfterMs / 60000)}:${String(Math.round((slide.transition.advanceAfterMs % 60000) / 1000)).padStart(2, "0")}`}</span>
          )}
        </span>
      </div>
    );
  };

  const grid = (list: Slide[], start: number) => (
    <div className="flex flex-wrap gap-3">
      {list.map((s, k) => thumb(s, start + k))}
      {drop && drop.before === null && ((ranges.length === 0 && start + list.length === slides.length) || drop.key === `e${ranges.findIndex((r) => r.start === start)}`) && (
        <span data-testid="sorter-drop" className="w-1 self-stretch rounded bg-orange-600" style={{ height: (width * slidePx(pres.slideSize).height) / slidePx(pres.slideSize).width }} />
      )}
    </div>
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="slide-sorter">
      <div
        ref={root}
        role="listbox"
        aria-multiselectable="true"
        aria-label={t("show.view.sorter")}
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="min-h-0 flex-1 overflow-auto bg-ui-hover p-4 outline-none"
      >
        {ranges.length === 0
          ? grid(slides, 0)
          : ranges.map((r) => {
              const closed = collapsedList.includes(r.index);
              return (
                <section key={`${r.index}:${r.name}`} aria-label={r.name} className="mb-4">
                  <div
                    role="button"
                    tabIndex={-1}
                    aria-expanded={!closed}
                    data-section-index={r.index}
                    data-testid="sorter-section"
                    className={`mb-2 flex h-8 cursor-pointer items-center gap-2 rounded px-1 text-sm font-medium hover:bg-ui-panel ${drop?.key === `s${r.index}` ? "ring-2 ring-orange-600" : ""}`}
                    onClick={() => store.toggleSection(r.index)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setMenu({ at: { x: e.clientX, y: e.clientY }, items: sectionMenu(store, r.index) });
                    }}
                  >
                    <span aria-hidden="true" className="w-3 text-ui-muted">{closed ? "▸" : "▾"}</span>
                    {r.name}
                    <span className="text-xs text-ui-muted">{t("show.sorter.count", { count: r.count })}</span>
                  </div>
                  {!closed && grid(slides.slice(r.start, r.start + r.count), r.start)}
                </section>
              );
            })}
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-ui-border bg-ui-panel px-3 py-0.5 text-xs text-ui-muted">
        <span>{t("show.sorter.selected", { count: sel.length })}</span>
        <label className="flex items-center gap-1">
          {t("group.zoom")}
          <input
            type="range"
            min={20}
            max={200}
            step={10}
            value={zoom}
            aria-label={t("show.sorter.zoom")}
            data-testid="sorter-zoom"
            className="h-8 w-32"
            onChange={(e) => store.setSorterZoom(Number(e.currentTarget.value))}
          />
          <span className="w-10 tabular-nums">{zoom} %</span>
        </label>
      </div>
      <ContextMenu at={menu?.at ?? null} label={t("show.slideActions")} items={menu?.items ?? []} onClose={() => setMenu(null)} />
    </div>
  );
}
